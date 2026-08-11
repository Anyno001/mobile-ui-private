import {
    createEmptyCycleStore, normalizeCycleStore,
} from './calendar-cycle-model.js';
import { createEmptyHolidayCache, normalizeHolidayCache } from './calendar-holiday.js';
import { createEmptyCalendarStore, normalizeCalendarStore } from './calendar-model.js';
import { createEmptyOccasionStore, normalizeOccasionStore } from './calendar-occasion-model.js';
import { createEmptyOutfitStore, normalizeOutfitStore } from './calendar-outfit-model.js';
import { createEmptyRecipeStore, normalizeRecipeStore } from './calendar-recipe-model.js';
import {
    loadCalendar, loadCalendarCycles, loadCalendarHolidays, loadCalendarOccasions, loadCalendarOutfits, loadCalendarRecipes, loadCalendarWeather,
    saveCalendar, saveCalendarCycles, saveCalendarHolidays, saveCalendarOccasions, saveCalendarOutfits, saveCalendarRecipes, saveCalendarWeather,
} from './calendar-storage.js';
import { createEmptyWeatherStore, normalizeWeatherStore } from './calendar-weather.js';
import { cloneEmojiLibrary } from './emoji-media.js';
import { normalizeBudgetConfig } from './budget.js';
import { normalizeInjectionConfig } from './behavior-config.js';
import { normalizeAmbientStatus, normalizeInteractiveStore, normalizePhoneUiState } from './interactive-scene-model.js';
import { materializeLocalBackgrounds, saveBgGlobal, saveBgLocal, saveDesktopBg } from './storage-background.js';
import { normalizeTodayTrendStore } from './today-trend-model.js';
import { loadTodayTrendStore, saveTodayTrendStore } from './today-trend-storage.js';
import { normalizeWorldBookConfig } from './worldbook-config.js';
import {
    loadInteractiveScenes, loadPhoneUiState, saveBidirectional, saveInjectionConfig,
    saveCharacterBehavior, saveEmojis, saveGroupMeta, saveHistoriesStrict, saveInteractiveScenes,
    completeBranchLineageBackup, loadBranchLineage, rollbackBranchLineageBackup, saveBranchLineageForBackup,
    savePhoneUiState, saveBranchLineage, saveBudgetConfig, saveGalBubbleEnabled, savePokeConfig, saveProfiles, saveTheme, saveWordyLimit, saveWorldBookConfig,
} from './storage.js';

const clone = value => JSON.parse(JSON.stringify(value));

function structurallyEqual(left, right) {
    if (Object.is(left, right)) return true;
    if (Array.isArray(left) || Array.isArray(right)) {
        if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
        return left.every((value, index) => structurallyEqual(value, right[index]));
    }
    if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false;
    const leftKeys = Object.keys(left).sort();
    const rightKeys = Object.keys(right).sort();
    if (leftKeys.length !== rightKeys.length || leftKeys.some((key, index) => key !== rightKeys[index])) return false;
    return leftKeys.every(key => structurallyEqual(left[key], right[key]));
}

function assertCanonicalCalendarField(value, normalized, field) {
    if (!structurallyEqual(value, normalized)) {
        throw new Error(`备份字段 ${field} 内容无效或不是规范格式`);
    }
    return normalized;
}

function assertCycleBackupInvariants(store) {
    for (const [storageId, scope] of Object.entries(store.scopes)) {
        if (scope.enabled && !scope.lastPeriodStart) {
            throw new Error(`备份字段 calendarCycles.scopes.${storageId} 启用周期提示时必须设置末次经期开始日期`);
        }
    }
}

export function applyCalendarBackupFields(data, result, objectValue, { includeRecipes = false, includeOutfits = false } = {}) {
    const fields = [
        ['calendarStore', normalizeCalendarStore],
        ['calendarOccasions', normalizeOccasionStore],
        ['calendarHolidays', normalizeHolidayCache],
        ['calendarWeather', normalizeWeatherStore],
        ['calendarCycles', normalizeCycleStore],
        ...(includeRecipes ? [['calendarRecipes', normalizeRecipeStore]] : []),
        ...(includeOutfits ? [['calendarOutfits', normalizeOutfitStore]] : []),
    ];
    for (const [field, normalize] of fields) {
        if (!Object.hasOwn(data, field)) continue;
        const value = objectValue(data[field], field);
        const normalized = normalize(value);
        if (field === 'calendarCycles') assertCycleBackupInvariants(normalized);
        const canonicalValue = field === 'calendarWeather' && !Object.hasOwn(value, 'climateRevision')
            ? { ...value, climateRevision: normalized.climateRevision }
            : value;
        result[field] = assertCanonicalCalendarField(canonicalValue, normalized, field);
    }
    return result;
}

export function createEmptyCalendarBackupFields() {
    return {
        calendarStore: createEmptyCalendarStore(),
        calendarOccasions: createEmptyOccasionStore(),
        calendarHolidays: createEmptyHolidayCache(),
        calendarWeather: createEmptyWeatherStore(),
        calendarCycles: createEmptyCycleStore(),
        calendarRecipes: createEmptyRecipeStore(),
        calendarOutfits: createEmptyOutfitStore(),
    };
}

export async function runBackupTransaction({
    capture, prepare = async snapshot => snapshot, apply, persist, beforeApply = async () => {}, afterPersist = async () => {}, complete = async () => {},
}) {
    const snapshot = await capture();
    let prepared;
    try {
        prepared = await prepare(snapshot);
    } catch (error) {
        error.backupPhase = 'prepare';
        throw error;
    }
    let applied;
    try {
        await beforeApply('apply');
        const nextState = await apply(undefined, prepared);
        applied = await persist(nextState, 'apply');
        await afterPersist('apply', nextState);
        await complete(nextState, applied);
    } catch (error) {
        let rollbackState;
        try {
            await beforeApply('rollback');
            rollbackState = await apply(snapshot);
            await persist(snapshot, 'rollback', applied);
            await afterPersist('rollback', rollbackState);
        } catch (rollbackError) {
            const combined = new Error(`${error.message}；原数据回滚失败：${rollbackError.message}`);
            combined.cause = error;
            combined.backupPhase = 'rollback-failed';
            combined.rollbackError = rollbackError;
            combined.rollbackState = rollbackState;
            throw combined;
        }
        error.backupPhase = 'rolled-back';
        throw error;
    }
}


export function createBackupStateHandlers(deps = {}) {
    const capture = async () => {
        const interactiveScenes = normalizeInteractiveStore(await loadInteractiveScenes());
        const branchLineage = await loadBranchLineage();
        return {
            histories: clone(window.__pmHistories || {}), config: clone(window.__pmConfig || {}),
            theme: clone(window.__pmTheme || {}), profiles: clone(window.__pmProfiles || []),
            groupMeta: clone(window.__pmGroupMeta || {}), pokeConfig: clone(window.__pmPokeConfig || {}),
            bidirectional: clone(window.__pmBidirectional || {}), injectionConfig: normalizeInjectionConfig(window.__pmInjectionConfig),
            budgetConfig: normalizeBudgetConfig(window.__pmBudgetConfig),
            emojis: cloneEmojiLibrary(window.__pmEmojis),
            characterBehavior: clone(window.__pmCharacterBehavior || {}), wordyLimit: !!window.__pmWordyLimit,
            galBubbleEnabled: window.__pmGalBubbleEnabled === true,
            worldBookConfig: normalizeWorldBookConfig(window.__pmWorldBookConfig),
            desktopBg: window.__pmDesktopBg || '', bgGlobal: window.__pmBgGlobal || '', bgLocal: await materializeLocalBackgrounds(),
            interactiveScenes, phoneUiState: loadPhoneUiState(interactiveScenes),
            ambientStatus: normalizeAmbientStatus({ enabled: window.__pmTheme?.ambientStatusEnabled }),
            calendarStore: loadCalendar(), calendarOccasions: loadCalendarOccasions(),
            calendarHolidays: loadCalendarHolidays(), calendarWeather: loadCalendarWeather(),
            calendarCycles: loadCalendarCycles(), calendarRecipes: loadCalendarRecipes(), calendarOutfits: loadCalendarOutfits(),
            todayTrend: normalizeTodayTrendStore(await loadTodayTrendStore()),
            branchLineage: clone(branchLineage),
        };
    };
    const apply = async state => {
        const interactiveScenes = normalizeInteractiveStore(state.interactiveScenes);
        const phoneUiState = normalizePhoneUiState(state.phoneUiState, interactiveScenes);
        const ambientStatus = normalizeAmbientStatus(state.ambientStatus ?? { enabled: state.theme?.ambientStatusEnabled });
        window.__pmHistories = clone(state.histories || {}); window.__pmConfig = clone(state.config || {});
        window.__pmTheme = clone(state.theme || {}); window.__pmTheme.ambientStatusEnabled = ambientStatus.enabled;
        window.__pmProfiles = clone(state.profiles || []); window.__pmGroupMeta = clone(state.groupMeta || {});
        window.__pmPokeConfig = clone(state.pokeConfig || {}); window.__pmBidirectional = clone(state.bidirectional || {});
        window.__pmInjectionConfig = normalizeInjectionConfig(state.injectionConfig);
        window.__pmBudgetConfig = normalizeBudgetConfig(state.budgetConfig);
        window.__pmEmojis = cloneEmojiLibrary(state.emojis); window.__pmCharacterBehavior = clone(state.characterBehavior || {});
        window.__pmWordyLimit = !!state.wordyLimit; window.__pmGalBubbleEnabled = state.galBubbleEnabled === true;
        window.__pmDesktopBg = typeof state.desktopBg === 'string' ? state.desktopBg : '';
        window.__pmWorldBookConfig = normalizeWorldBookConfig(state.worldBookConfig);
        window.__pmBgGlobal = typeof state.bgGlobal === 'string' ? state.bgGlobal : '';
        window.__pmBgLocal = clone(state.bgLocal || {}); window.__pmPhoneUiState = phoneUiState;
        window.__pmTodayTrend = normalizeTodayTrendStore(state.todayTrend);
        window.__pmBranchLineage = clone(state.branchLineage || {});
        return {
            ...state, interactiveScenes, phoneUiState, ambientStatus,
            calendarStore: normalizeCalendarStore(state.calendarStore),
            calendarOccasions: normalizeOccasionStore(state.calendarOccasions),
            calendarHolidays: normalizeHolidayCache(state.calendarHolidays),
            calendarWeather: normalizeWeatherStore(state.calendarWeather),
            calendarCycles: normalizeCycleStore(state.calendarCycles),
            calendarRecipes: normalizeRecipeStore(state.calendarRecipes),
            calendarOutfits: normalizeOutfitStore(state.calendarOutfits),
            todayTrend: normalizeTodayTrendStore(state.todayTrend),
            branchLineage: clone(state.branchLineage || {}),
        };
    };
    const persist = async (state, phase = 'apply', applied = null) => {
        const interactiveScenes = normalizeInteractiveStore(state.interactiveScenes);
        const phoneUiState = normalizePhoneUiState(state.phoneUiState, interactiveScenes);
        await saveHistoriesStrict();
        try { localStorage.setItem('ST_SMS_CONFIG', JSON.stringify(window.__pmConfig)); }
        catch { throw new Error('API 配置保存失败：浏览器存储不可用'); }
        if (!saveTheme()) throw new Error('主题配置保存失败：浏览器存储不可用');
        if (!saveProfiles()) throw new Error('API 档案保存失败：浏览器存储不可用');
        await saveGroupMeta();
        if (!saveCharacterBehavior() || !savePokeConfig() || !saveBidirectional() || !saveInjectionConfig() || !saveBudgetConfig(state.budgetConfig) || !saveWordyLimit() || !saveGalBubbleEnabled() || !saveWorldBookConfig()) {
            throw new Error('插件配置保存失败：浏览器存储不可用');
        }
        await saveEmojis(); await saveDesktopBg(); await saveBgGlobal();
        window.__pmBgLocal = await saveBgLocal();
        await saveInteractiveScenes(interactiveScenes);
        if (!savePhoneUiState(phoneUiState, interactiveScenes)) throw new Error('手机界面状态保存失败：浏览器存储不可用');
        if (!saveCalendar(state.calendarStore) || !saveCalendarOccasions(state.calendarOccasions)
            || !saveCalendarHolidays(state.calendarHolidays) || !saveCalendarWeather(state.calendarWeather)
            || !saveCalendarCycles(state.calendarCycles) || !saveCalendarRecipes(state.calendarRecipes) || !saveCalendarOutfits(state.calendarOutfits)) {
            throw new Error('日历与菜谱数据保存失败：浏览器存储不可用');
        }
        await saveTodayTrendStore(state.todayTrend);
        if (phase === 'rollback') {
            if (applied?.branchLineageInserted) await rollbackBranchLineageBackup(applied.branchLineageInserted);
            else await saveBranchLineage(state.branchLineage || {});
        } else {
            const branchLineageInserted = await saveBranchLineageForBackup(state.branchLineage || {});
            deps.invalidateInteractiveStore?.(); deps.reloadCalendarStore?.();
            deps.reloadTodayTrendStore?.();
            return { branchLineageInserted };
        }
        deps.invalidateInteractiveStore?.(); deps.reloadCalendarStore?.();
        deps.reloadTodayTrendStore?.();
    };
    const complete = async (_state, applied) => {
        if (applied?.branchLineageInserted) await completeBranchLineageBackup(applied.branchLineageInserted);
    };
    return { capture, apply, persist, complete };
}
