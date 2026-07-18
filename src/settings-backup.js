import {
    createEmptyCycleStore, normalizeCycleStore,
} from './calendar-cycle-model.js';
import { createEmptyHolidayCache, normalizeHolidayCache } from './calendar-holiday.js';
import { createEmptyCalendarStore, normalizeCalendarStore } from './calendar-model.js';
import { createEmptyOccasionStore, normalizeOccasionStore } from './calendar-occasion-model.js';
import {
    loadCalendar, loadCalendarCycles, loadCalendarHolidays, loadCalendarOccasions, loadCalendarWeather,
    saveCalendar, saveCalendarCycles, saveCalendarHolidays, saveCalendarOccasions, saveCalendarWeather,
} from './calendar-storage.js';
import { createEmptyWeatherStore, normalizeWeatherStore } from './calendar-weather.js';
import { normalizeAmbientStatus, normalizeInteractiveStore, normalizePhoneUiState } from './interactive-scene-model.js';
import {
    loadInteractiveScenes, loadPhoneUiState, saveBgGlobal, saveBgLocal, saveBidirectional,
    saveCharacterBehavior, saveDesktopBg, saveEmojis, saveGroupMeta, saveHistoriesStrict, saveInteractiveScenes,
    savePhoneUiState, savePokeConfig, saveProfiles, saveTheme, saveWordyLimit,
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

export function applyCalendarBackupFields(data, result, objectValue) {
    const fields = [
        ['calendarStore', normalizeCalendarStore],
        ['calendarOccasions', normalizeOccasionStore],
        ['calendarHolidays', normalizeHolidayCache],
        ['calendarWeather', normalizeWeatherStore],
        ['calendarCycles', normalizeCycleStore],
    ];
    for (const [field, normalize] of fields) {
        if (!Object.hasOwn(data, field)) continue;
        const value = objectValue(data[field], field);
        const normalized = normalize(value);
        if (field === 'calendarCycles') assertCycleBackupInvariants(normalized);
        result[field] = assertCanonicalCalendarField(value, normalized, field);
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
    };
}

export async function runBackupTransaction({ capture, prepare = async snapshot => snapshot, apply, persist, beforeApply = async () => {} }) {
    const snapshot = await capture();
    let prepared;
    try {
        prepared = await prepare(snapshot);
    } catch (error) {
        error.backupPhase = 'prepare';
        throw error;
    }
    try {
        await beforeApply('apply');
        const nextState = await apply(undefined, prepared);
        await persist(nextState);
    } catch (error) {
        let rollbackState;
        try {
            await beforeApply('rollback');
            rollbackState = await apply(snapshot);
            await persist(snapshot);
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
        return {
            histories: clone(window.__pmHistories || {}), config: clone(window.__pmConfig || {}),
            theme: clone(window.__pmTheme || {}), profiles: clone(window.__pmProfiles || []),
            groupMeta: clone(window.__pmGroupMeta || {}), pokeConfig: clone(window.__pmPokeConfig || {}),
            bidirectional: clone(window.__pmBidirectional || {}), emojis: clone(window.__pmEmojis || []),
            characterBehavior: clone(window.__pmCharacterBehavior || {}), wordyLimit: !!window.__pmWordyLimit,
            desktopBg: window.__pmDesktopBg || '', bgGlobal: window.__pmBgGlobal || '', bgLocal: clone(window.__pmBgLocal || {}),
            interactiveScenes, phoneUiState: loadPhoneUiState(interactiveScenes),
            ambientStatus: normalizeAmbientStatus({ enabled: window.__pmTheme?.ambientStatusEnabled }),
            calendarStore: loadCalendar(), calendarOccasions: loadCalendarOccasions(),
            calendarHolidays: loadCalendarHolidays(), calendarWeather: loadCalendarWeather(),
            calendarCycles: loadCalendarCycles(),
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
        window.__pmEmojis = clone(state.emojis || []); window.__pmCharacterBehavior = clone(state.characterBehavior || {});
        window.__pmWordyLimit = !!state.wordyLimit; window.__pmDesktopBg = typeof state.desktopBg === 'string' ? state.desktopBg : '';
        window.__pmBgGlobal = typeof state.bgGlobal === 'string' ? state.bgGlobal : '';
        window.__pmBgLocal = clone(state.bgLocal || {}); window.__pmPhoneUiState = phoneUiState;
        return {
            ...state, interactiveScenes, phoneUiState, ambientStatus,
            calendarStore: normalizeCalendarStore(state.calendarStore),
            calendarOccasions: normalizeOccasionStore(state.calendarOccasions),
            calendarHolidays: normalizeHolidayCache(state.calendarHolidays),
            calendarWeather: normalizeWeatherStore(state.calendarWeather),
            calendarCycles: normalizeCycleStore(state.calendarCycles),
        };
    };
    const persist = async state => {
        const interactiveScenes = normalizeInteractiveStore(state.interactiveScenes);
        const phoneUiState = normalizePhoneUiState(state.phoneUiState, interactiveScenes);
        await saveHistoriesStrict();
        try { localStorage.setItem('ST_SMS_CONFIG', JSON.stringify(window.__pmConfig)); }
        catch { throw new Error('API 配置保存失败：浏览器存储不可用'); }
        if (!saveTheme()) throw new Error('主题配置保存失败：浏览器存储不可用');
        if (!saveProfiles()) throw new Error('API 档案保存失败：浏览器存储不可用');
        await saveGroupMeta();
        if (!saveCharacterBehavior() || !savePokeConfig() || !saveBidirectional() || !saveWordyLimit()) throw new Error('插件配置保存失败：浏览器存储不可用');
        await saveEmojis(); await saveDesktopBg(); await saveBgGlobal(); await saveBgLocal(); await saveInteractiveScenes(interactiveScenes);
        if (!savePhoneUiState(phoneUiState, interactiveScenes)) throw new Error('手机界面状态保存失败：浏览器存储不可用');
        if (!saveCalendar(state.calendarStore) || !saveCalendarOccasions(state.calendarOccasions)
            || !saveCalendarHolidays(state.calendarHolidays) || !saveCalendarWeather(state.calendarWeather)
            || !saveCalendarCycles(state.calendarCycles)) throw new Error('日历数据保存失败：浏览器存储不可用');
        deps.invalidateInteractiveStore?.(); deps.reloadCalendarStore?.();
    };
    return { capture, apply, persist };
}
