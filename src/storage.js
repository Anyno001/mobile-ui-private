import {
    CALENDAR_CYCLE_STORAGE_KEY, CALENDAR_HOLIDAY_STORAGE_KEY, CALENDAR_OCCASION_STORAGE_KEY,
    CALENDAR_RECIPE_STORAGE_KEY, CALENDAR_STORAGE_KEY, CALENDAR_WEATHER_STORAGE_KEY, CHARACTER_BEHAVIOR_KEY,
    INJECTION_CONFIG_KEY, TODAY_TREND_FALLBACK_KEY, TODAY_TREND_STORAGE_KEY, WORLD_BOOK_CONFIG_KEY,
} from './constants.js';
import { BUDGET_CONFIG_KEY, normalizeBudgetConfig } from './budget.js';
import {
    normalizeCharacterBehaviorStore, normalizeGroupMetaStore, normalizeInjectionConfig,
} from './behavior-config.js';
import {
    enqueueDirectorySave, getActiveDirectoryBranchScopes,
} from './directory-save-coordinator.js';
import { createEmptyPhoneUiState, normalizePhoneUiState } from './interactive-scene-model.js';
import { pmIDBDel, pmIDBGet, pmIDBKeys, pmIDBReadEntry, pmIDBSet, pmOpenIDB } from './pm-idb.js';
import { THEME_PRESETS } from './config.js';
import { normalizeWorldBookConfig } from './worldbook-config.js';

export { pmIDBDel, pmIDBGet, pmIDBKeys, pmIDBSet, pmOpenIDB } from './pm-idb.js';

const EMOJI_STORE_KEY = 'ST_SMS_EMOJIS';
const EMOJI_FALLBACK_KEY = `${EMOJI_STORE_KEY}_LOCAL_FALLBACK`;
const GROUP_META_STORE_KEY = 'ST_SMS_GROUP_META';
const GROUP_META_FALLBACK_KEY = `${GROUP_META_STORE_KEY}_LOCAL_FALLBACK`;
const INTERACTIVE_STORE_KEY = 'ST_INTERACTIVE_SCENES_V1';
const INTERACTIVE_FALLBACK_KEY = `${INTERACTIVE_STORE_KEY}_LOCAL_FALLBACK`;
const PHONE_UI_STATE_KEY = 'ST_SMS_PHONE_UI_STATE';
export const BRANCH_LINEAGE_STORE_KEY = 'ST_SMS_BRANCH_LINEAGE_V1';
export const DESKTOP_BG_KEY = 'ST_SMS_BG_DESKTOP';
export const PLUGIN_LOCAL_STORAGE_KEYS = Object.freeze([
    'ST_SMS_DATA_V2', 'ST_SMS_CONFIG', 'ST_SMS_THEME', 'ST_SMS_POKE_CONFIG', 'ST_SMS_WORDY_LIMIT',
    BUDGET_CONFIG_KEY, 'ST_SMS_BG_GLOBAL', 'ST_SMS_BG_LOCAL', DESKTOP_BG_KEY, GROUP_META_STORE_KEY, GROUP_META_FALLBACK_KEY,
    EMOJI_STORE_KEY, EMOJI_FALLBACK_KEY, CHARACTER_BEHAVIOR_KEY, INJECTION_CONFIG_KEY, WORLD_BOOK_CONFIG_KEY, 'ST_SMS_API_PROFILES', 'ST_SMS_BIDIRECTIONAL',
    INTERACTIVE_STORE_KEY, INTERACTIVE_FALLBACK_KEY, PHONE_UI_STATE_KEY, 'ST_SMS_PHONE_QR_INITIALIZED',
    CALENDAR_STORAGE_KEY, CALENDAR_OCCASION_STORAGE_KEY, CALENDAR_HOLIDAY_STORAGE_KEY,
    CALENDAR_WEATHER_STORAGE_KEY, CALENDAR_CYCLE_STORAGE_KEY, CALENDAR_RECIPE_STORAGE_KEY,
    TODAY_TREND_FALLBACK_KEY,
]);
export const PLUGIN_IDB_STATIC_KEYS = Object.freeze([
    'ST_SMS_DATA_V2', EMOJI_STORE_KEY, GROUP_META_STORE_KEY, INTERACTIVE_STORE_KEY, BRANCH_LINEAGE_STORE_KEY, 'ST_SMS_BG_GLOBAL', DESKTOP_BG_KEY,
    TODAY_TREND_STORAGE_KEY,
]);
export const PLUGIN_IDB_DYNAMIC_PREFIXES = Object.freeze(['ST_SMS_BG_LOCAL_']);

export function isBigData(value) {
    return typeof value === 'string' && value.length > 4096 && (value.startsWith('data:') || value.startsWith('blob:'));
}

export function saveHistories() {
    saveHistoriesStrict().catch(error => console.warn('[phone-mode] 短信历史保存失败', error));
}

export async function saveHistoriesStrict(data = window.__pmHistories, { requireLocalMirror = false, coordinated = false } = {}) {
    const persist = async (snapshot, protectedScopes = []) => {
        let value = snapshot;
        if (protectedScopes.length) {
            const current = await pmIDBGet('ST_SMS_DATA_V2');
            if (current && typeof current === 'object' && !Array.isArray(current)) {
                value = structuredClone(snapshot);
                for (const scope of protectedScopes) {
                    if (Object.hasOwn(current, scope)) value[scope] = structuredClone(current[scope]);
                    else delete value[scope];
                }
            }
        }
        const saved = await pmIDBSet('ST_SMS_DATA_V2', value);
        if (!saved) throw new Error('聊天记录保存失败：IndexedDB 不可用');
        try {
            localStorage.setItem('ST_SMS_DATA_V2', JSON.stringify(value));
        } catch (error) {
            if (requireLocalMirror) throw new Error('聊天记录保存失败：浏览器存储不可用');
            console.warn('[phone-mode] localStorage 已满，短信历史仅保存在 IDB');
        }
        return true;
    };
    if (coordinated) return persist(structuredClone(data));
    return enqueueDirectorySave('histories', data,
        (snapshot, protectedScopes) => persist(snapshot, protectedScopes), arguments.length === 0);
}

export function saveHistoriesBeforeUnload() {
    const data = window.__pmHistories;
    if (!data || !Object.keys(data).length) return;
    try {
        localStorage.setItem('ST_SMS_DATA_V2', JSON.stringify(data));
    } catch (error) {
        try {
            const slim = {};
            for (const [storyId, contacts] of Object.entries(data)) {
                slim[storyId] = {};
                for (const [persona, history] of Object.entries(contacts)) {
                    slim[storyId][persona] = Array.isArray(history) ? history.slice(-10) : history;
                }
            }
            localStorage.setItem('ST_SMS_DATA_V2', JSON.stringify(slim));
        } catch (backupError) {
            console.warn('[phone-mode] beforeunload: localStorage 完全无法写入');
        }
    }
    pmIDBSet('ST_SMS_DATA_V2', data).catch(() => {});
}

export async function loadHistoriesFromIDB({ requireConfirmedPrimary = false } = {}) {
    try {
        const keys = await pmIDBKeys();
        if (!Array.isArray(keys)) throw new Error('无法枚举 IndexedDB');
        const hasPrimary = keys.includes('ST_SMS_DATA_V2');
        if (!hasPrimary) {
            const rawFallback = localStorage.getItem('ST_SMS_DATA_V2');
            if (!rawFallback) {
                window.__pmHistories = {};
                return true;
            }
            const fallback = JSON.parse(rawFallback);
            if (!fallback || typeof fallback !== 'object' || Array.isArray(fallback)) {
                throw new Error('localStorage 后备记录格式无效');
            }
            window.__pmHistories = fallback;
            return true;
        }
        const value = await pmIDBGet('ST_SMS_DATA_V2');
        if (value === null || value === undefined) {
            if (requireConfirmedPrimary) throw new Error('IndexedDB 主记录读取失败');
            try {
                const fallback = JSON.parse(localStorage.getItem('ST_SMS_DATA_V2'));
                if (fallback && typeof fallback === 'object' && Object.keys(fallback).length > 0) {
                    window.__pmHistories = fallback;
                }
            } catch (error) {}
            return true;
        }
        const parsed = typeof value === 'string' ? JSON.parse(value) : value;
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            throw new Error('IndexedDB 主记录格式无效');
        }
        const idbCount = Object.keys(parsed).length;
        window.__pmHistories = parsed;
        try {
            localStorage.setItem('ST_SMS_DATA_V2', JSON.stringify(parsed));
        } catch (error) {
            console.warn('[phone-mode] localStorage 已满，仅使用 IDB 存储');
        }
        console.log('[phone-mode] 从 IndexedDB 加载了短信历史，共', idbCount, '个会话');
        return true;
    } catch (error) {
        console.warn('[phone-mode] IDB 恢复失败，尝试 localStorage 兜底', error);
        try {
            const fallback = JSON.parse(localStorage.getItem('ST_SMS_DATA_V2'));
            if (fallback && typeof fallback === 'object' && Object.keys(fallback).length > 0) {
                window.__pmHistories = fallback;
            }
        } catch (fallbackError) {}
        return false;
    }
}

export async function loadEmojis() {
    try {
        const fallback = localStorage.getItem(EMOJI_FALLBACK_KEY);
        if (fallback) {
            const parsed = JSON.parse(fallback);
            window.__pmEmojis = Array.isArray(parsed) ? parsed : [];
            return;
        }
    } catch (error) {
        try { localStorage.removeItem(EMOJI_FALLBACK_KEY); } catch (removeError) {}
    }
    const value = await pmIDBGet(EMOJI_STORE_KEY);
    window.__pmEmojis = Array.isArray(value) ? value : [];
}

export async function saveEmojis() {
    const saved = await pmIDBSet(EMOJI_STORE_KEY, window.__pmEmojis);
    if (saved) {
        try { localStorage.removeItem(EMOJI_FALLBACK_KEY); } catch (error) {}
        return;
    }
    try {
        localStorage.setItem(EMOJI_FALLBACK_KEY, JSON.stringify(window.__pmEmojis));
    } catch (error) {
        throw new Error('表情包保存失败：浏览器存储不可用或空间不足');
    }
}

export function loadTheme() {
    try {
        const saved = JSON.parse(localStorage.getItem('ST_SMS_THEME'));
        if (saved && typeof saved === 'object' && !Array.isArray(saved)) {
            window.__pmTheme = { ...window.__pmTheme, ...saved };
        }
        const preset = window.__pmTheme.preset;
        if (preset !== 'custom' && !Object.hasOwn(THEME_PRESETS, preset)) {
            window.__pmTheme.preset = 'default';
            saveTheme();
        }
        if (window.__pmTheme.layout !== 'standard') {
            window.__pmTheme.layout = 'standard';
            saveTheme();
        }
    } catch (error) {}
    window.__pmTheme.ambientStatusEnabled = window.__pmTheme.ambientStatusEnabled === true;
}

export function saveTheme() {
    try {
        localStorage.setItem('ST_SMS_THEME', JSON.stringify(window.__pmTheme));
        return true;
    } catch (error) {
        return false;
    }
}

export function loadPokeConfig() {
    try { window.__pmPokeConfig = JSON.parse(localStorage.getItem('ST_SMS_POKE_CONFIG')) || {}; }
    catch (error) { window.__pmPokeConfig = {}; }
}

function preserveActiveLocalScopes(storageKey, store, snapshot) {
    const activeScopes = getActiveDirectoryBranchScopes(store);
    if (!activeScopes.length) return snapshot;
    try {
        const raw = localStorage.getItem(storageKey);
        const current = raw ? JSON.parse(raw) : {};
        if (!current || typeof current !== 'object' || Array.isArray(current)) throw new Error('活动分支 scope 读取结果无效');
        const merged = structuredClone(snapshot);
        for (const storageId of activeScopes) {
            if (Object.hasOwn(current, storageId)) merged[storageId] = structuredClone(current[storageId]);
            else delete merged[storageId];
        }
        return merged;
    } catch (error) {
        throw new Error(`活动分支 scope 读取失败：${store}`);
    }
}

function preserveActiveBudgetScopes(snapshot) {
    const activeScopes = getActiveDirectoryBranchScopes('budget');
    if (!activeScopes.length) return snapshot;
    try {
        const current = normalizeBudgetConfig(JSON.parse(localStorage.getItem(BUDGET_CONFIG_KEY)));
        const merged = normalizeBudgetConfig(snapshot);
        for (const storageId of activeScopes) {
            if (Object.hasOwn(current.communitySceneIdsByStorage, storageId)) {
                merged.communitySceneIdsByStorage[storageId] = structuredClone(current.communitySceneIdsByStorage[storageId]);
            } else delete merged.communitySceneIdsByStorage[storageId];
            if (Object.hasOwn(current.communitySelectionsByStorage, storageId)) {
                merged.communitySelectionsByStorage[storageId] = structuredClone(current.communitySelectionsByStorage[storageId]);
            } else delete merged.communitySelectionsByStorage[storageId];
        }
        return merged;
    } catch (error) {
        throw new Error('活动分支预算 scope 读取失败');
    }
}

export function savePokeConfig() {
    try {
        window.__pmPokeConfig = preserveActiveLocalScopes('ST_SMS_POKE_CONFIG', 'pokeConfig', window.__pmPokeConfig);
        localStorage.setItem('ST_SMS_POKE_CONFIG', JSON.stringify(window.__pmPokeConfig));
        return true;
    } catch (error) {
        return false;
    }
}

export function loadWordyLimit() {
    try { window.__pmWordyLimit = !!JSON.parse(localStorage.getItem('ST_SMS_WORDY_LIMIT')); }
    catch (error) { window.__pmWordyLimit = false; }
}

export function saveWordyLimit() {
    try {
        localStorage.setItem('ST_SMS_WORDY_LIMIT', JSON.stringify(window.__pmWordyLimit));
        return true;
    } catch (error) {
        return false;
    }
}

export function loadBudgetConfig() {
    try {
        window.__pmBudgetConfig = normalizeBudgetConfig(JSON.parse(localStorage.getItem(BUDGET_CONFIG_KEY)));
    } catch (error) {
        window.__pmBudgetConfig = normalizeBudgetConfig();
    }
    return window.__pmBudgetConfig;
}

export function saveBudgetConfig(candidate = window.__pmBudgetConfig) {
    try {
        const normalized = preserveActiveBudgetScopes(normalizeBudgetConfig(candidate));
        localStorage.setItem(BUDGET_CONFIG_KEY, JSON.stringify(normalized));
        window.__pmBudgetConfig = normalized;
        return true;
    } catch (error) {
        return false;
    }
}


export async function loadGroupMeta() {
    try {
        const fallback = localStorage.getItem(GROUP_META_FALLBACK_KEY);
        if (fallback) {
            window.__pmGroupMeta = normalizeGroupMetaStore(JSON.parse(fallback) || {});
            return window.__pmGroupMeta;
        }
    } catch (error) {
        try { localStorage.removeItem(GROUP_META_FALLBACK_KEY); } catch (removeError) {}
    }
    const value = await pmIDBGet(GROUP_META_STORE_KEY);
    if (value && typeof value === 'object') {
        window.__pmGroupMeta = normalizeGroupMetaStore(value);
        return window.__pmGroupMeta;
    }
    try {
        window.__pmGroupMeta = normalizeGroupMetaStore(JSON.parse(localStorage.getItem(GROUP_META_STORE_KEY)) || {});
    } catch (error) {
        window.__pmGroupMeta = {};
    }
    return window.__pmGroupMeta;
}

export async function saveGroupMeta(data) {
    const { coordinated = false } = arguments[1] || {};
    const updatesGlobalState = arguments.length === 0;
    const snapshot = normalizeGroupMetaStore(updatesGlobalState ? window.__pmGroupMeta : data);
    if (updatesGlobalState) window.__pmGroupMeta = snapshot;
    const persist = async (frozen, protectedScopes = []) => {
        let value = frozen;
        if (protectedScopes.length) {
            const current = await pmIDBGet(GROUP_META_STORE_KEY);
            if (current && typeof current === 'object' && !Array.isArray(current)) {
                value = normalizeGroupMetaStore(frozen);
                for (const scope of protectedScopes) {
                    if (Object.hasOwn(current, scope)) value[scope] = structuredClone(current[scope]);
                    else delete value[scope];
                }
            }
        }
        const saved = await pmIDBSet(GROUP_META_STORE_KEY, value);
        if (saved) {
            try { localStorage.setItem(GROUP_META_STORE_KEY, JSON.stringify(value)); } catch (error) {}
            try { localStorage.removeItem(GROUP_META_FALLBACK_KEY); } catch (error) {}
        } else {
            try { localStorage.setItem(GROUP_META_FALLBACK_KEY, JSON.stringify(value)); }
            catch { throw new Error('群聊配置保存失败：浏览器存储不可用或空间不足'); }
        }
        return value;
    };
    if (coordinated) return persist(structuredClone(snapshot));
    return enqueueDirectorySave('groupMeta', snapshot,
        (frozen, protectedScopes) => persist(frozen, protectedScopes), updatesGlobalState);
}

export function loadCharacterBehavior() {
    try {
        window.__pmCharacterBehavior = normalizeCharacterBehaviorStore(
            JSON.parse(localStorage.getItem(CHARACTER_BEHAVIOR_KEY)) || {},
        );
    } catch (error) {
        window.__pmCharacterBehavior = {};
    }
}

export function saveCharacterBehavior() {
    window.__pmCharacterBehavior = normalizeCharacterBehaviorStore(window.__pmCharacterBehavior);
    try {
        window.__pmCharacterBehavior = preserveActiveLocalScopes(CHARACTER_BEHAVIOR_KEY,
            'characterBehavior', window.__pmCharacterBehavior);
        localStorage.setItem(CHARACTER_BEHAVIOR_KEY, JSON.stringify(window.__pmCharacterBehavior));
        return true;
    } catch (error) {
        return false;
    }
}

export function loadProfiles() {
    try { window.__pmProfiles = JSON.parse(localStorage.getItem('ST_SMS_API_PROFILES')) || []; }
    catch (error) { window.__pmProfiles = []; }
}

export function saveProfiles() {
    try {
        localStorage.setItem('ST_SMS_API_PROFILES', JSON.stringify(window.__pmProfiles));
        return true;
    } catch (error) {
        return false;
    }
}

export function addOrUpdateProfile(profile) {
    if (!profile.apiUrl || !profile.apiKey) return false;
    const previous = window.__pmProfiles.map(item => ({ ...item }));
    const index = window.__pmProfiles.findIndex(item => item.apiUrl === profile.apiUrl && item.apiKey === profile.apiKey);
    if (index >= 0) window.__pmProfiles[index] = { ...window.__pmProfiles[index], ...profile, savedAt: Date.now() };
    else window.__pmProfiles.push({ ...profile, savedAt: Date.now() });
    if (saveProfiles()) return true;
    window.__pmProfiles = previous;
    return false;
}

export function loadInjectionConfig() {
    try {
        let legacyCalendar = null;
        try {
            const legacyBudget = JSON.parse(localStorage.getItem(BUDGET_CONFIG_KEY));
            legacyCalendar = {
                position: legacyBudget?.calendarPosition,
                depth: legacyBudget?.calendarDepth,
            };
        } catch (error) {}
        window.__pmInjectionConfig = normalizeInjectionConfig(
            JSON.parse(localStorage.getItem(INJECTION_CONFIG_KEY)), legacyCalendar,
        );
    } catch (error) {
        window.__pmInjectionConfig = normalizeInjectionConfig(null);
    }
    return window.__pmInjectionConfig;
}

export function saveInjectionConfig() {
    const normalized = normalizeInjectionConfig(window.__pmInjectionConfig);
    window.__pmInjectionConfig = normalized;
    try {
        localStorage.setItem(INJECTION_CONFIG_KEY, JSON.stringify(normalized));
        return true;
    } catch (error) {
        return false;
    }
}

export function loadWorldBookConfig() {
    try {
        window.__pmWorldBookConfig = normalizeWorldBookConfig(
            JSON.parse(localStorage.getItem(WORLD_BOOK_CONFIG_KEY)),
        );
    } catch (error) {
        window.__pmWorldBookConfig = normalizeWorldBookConfig(null);
    }
    return window.__pmWorldBookConfig;
}

export function saveWorldBookConfig(candidate = window.__pmWorldBookConfig) {
    const normalized = normalizeWorldBookConfig(candidate);
    try {
        localStorage.setItem(WORLD_BOOK_CONFIG_KEY, JSON.stringify(normalized));
        window.__pmWorldBookConfig = normalized;
        return true;
    } catch (error) {
        return false;
    }
}

export function loadBidirectional() {
    try { window.__pmBidirectional = JSON.parse(localStorage.getItem('ST_SMS_BIDIRECTIONAL')) || {}; }
    catch (error) { window.__pmBidirectional = {}; }
}

export function saveBidirectional() {
    try {
        window.__pmBidirectional = preserveActiveLocalScopes('ST_SMS_BIDIRECTIONAL', 'bidirectional', window.__pmBidirectional);
        localStorage.setItem('ST_SMS_BIDIRECTIONAL', JSON.stringify(window.__pmBidirectional));
        return true;
    } catch (error) {
        return false;
    }
}

export async function loadInteractiveScenes() {
    try {
        const fallback = localStorage.getItem(INTERACTIVE_FALLBACK_KEY);
        if (fallback) return JSON.parse(fallback);
    } catch (error) {
        console.warn('[phone-mode] 互动场景后备数据读取失败', error);
        try { localStorage.removeItem(INTERACTIVE_FALLBACK_KEY); } catch (removeError) {}
    }
    try {
        return await pmIDBGet(INTERACTIVE_STORE_KEY);
    } catch (error) {
        console.warn('[phone-mode] 互动场景读取失败', error);
        return null;
    }
}

export async function saveInteractiveScenes(store, { coordinated = false } = {}) {
    const persist = async (snapshot, protectedScopes = []) => {
        let value = snapshot;
        if (protectedScopes.length) {
            const current = await pmIDBGet(INTERACTIVE_STORE_KEY);
            if (current && typeof current === 'object' && !Array.isArray(current)) {
                const currentScopes = current.scopes;
                if (currentScopes && typeof currentScopes === 'object' && !Array.isArray(currentScopes)) {
                    value = structuredClone(snapshot);
                    value.scopes ||= {};
                    for (const scope of protectedScopes) {
                        if (Object.hasOwn(currentScopes, scope)) {
                            value.scopes[scope] = structuredClone(currentScopes[scope]);
                        } else {
                            delete value.scopes[scope];
                        }
                    }
                }
            }
        }
        const saved = await pmIDBSet(INTERACTIVE_STORE_KEY, value);
        if (saved) {
            try {
                localStorage.removeItem(INTERACTIVE_FALLBACK_KEY);
            } catch (error) {
                try {
                    localStorage.setItem(INTERACTIVE_FALLBACK_KEY, JSON.stringify(value));
                } catch (fallbackError) {
                    throw new Error('互动场景主存储已更新，但后备数据同步失败');
                }
            }
            return;
        }
        try {
            localStorage.setItem(INTERACTIVE_FALLBACK_KEY, JSON.stringify(value));
        } catch (error) {
            throw new Error('互动场景保存失败：浏览器存储不可用');
        }
    };
    if (coordinated) return persist(structuredClone(store));
    return enqueueDirectorySave('interactive', store, persist);
}

export function loadPhoneUiState(interactiveStore) {
    try {
        const saved = localStorage.getItem(PHONE_UI_STATE_KEY);
        if (!saved) return createEmptyPhoneUiState();
        return normalizePhoneUiState(JSON.parse(saved), interactiveStore);
    } catch (error) {
        console.warn('[phone-mode] 手机界面状态读取失败', error);
        return createEmptyPhoneUiState();
    }
}

function preserveActivePhoneUiScopes(snapshot, interactiveStore) {
    const activeScopes = getActiveDirectoryBranchScopes('phoneUi');
    if (!activeScopes.length) return snapshot;
    const current = loadPhoneUiState(interactiveStore);
    const merged = structuredClone(snapshot);
    for (const storageId of activeScopes) {
        if (Object.hasOwn(current.scopes, storageId)) merged.scopes[storageId] = structuredClone(current.scopes[storageId]);
        else delete merged.scopes[storageId];
    }
    return normalizePhoneUiState(merged, interactiveStore);
}

export function savePhoneUiState(state, interactiveStore) {
    try {
        const normalized = normalizePhoneUiState(state, interactiveStore);
        const value = preserveActivePhoneUiScopes(normalized, interactiveStore);
        localStorage.setItem(PHONE_UI_STATE_KEY, JSON.stringify(value));
        return true;
    } catch (error) {
        console.error('[phone-mode] 手机界面状态保存失败', error);
        return false;
    }
}

export function savePhoneUiScope(storageId, state, interactiveStore) {
    try {
        if (typeof storageId !== 'string' || !storageId) throw new TypeError('手机页面状态 scope 无效');
        const normalized = normalizePhoneUiState(state, interactiveStore);
        const current = loadPhoneUiState(interactiveStore);
        if (Object.hasOwn(normalized.scopes, storageId)) current.scopes[storageId] = structuredClone(normalized.scopes[storageId]);
        else delete current.scopes[storageId];
        if (Object.hasOwn(normalized, 'sharedScenes')) current.sharedScenes = structuredClone(normalized.sharedScenes);
        else delete current.sharedScenes;
        const merged = normalizePhoneUiState(current, interactiveStore);
        localStorage.setItem(PHONE_UI_STATE_KEY, JSON.stringify(merged));
        return merged;
    } catch (error) {
        console.error('[phone-mode] 手机页面状态保存失败', error);
        return null;
    }
}

export const INTERACTIVE_STORAGE_KEYS = Object.freeze({
    primary: INTERACTIVE_STORE_KEY,
    fallback: INTERACTIVE_FALLBACK_KEY,
});

let branchLineageQueue = Promise.resolve();
const branchLineageRevisions = new Map();

function branchLineageRevision(targetId) {
    return branchLineageRevisions.get(targetId) || 0;
}

function markBranchLineageWrite(targetId) {
    const revision = branchLineageRevision(targetId) + 1;
    branchLineageRevisions.set(targetId, revision);
    return revision;
}

export async function loadBranchLineage() {
    const keys = await pmIDBKeys();
    if (!Array.isArray(keys)) throw new Error('分支继承记录读取失败：无法枚举 IndexedDB');
    if (!keys.includes(BRANCH_LINEAGE_STORE_KEY)) return {};
    const value = await pmIDBGet(BRANCH_LINEAGE_STORE_KEY);
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error('分支继承记录读取失败：数据损坏或 IndexedDB 不可用');
    }
    return value;
}

function assertBranchLineageValue(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error('分支继承记录保存失败：记录必须是对象');
    }
}

async function writeBranchLineage(value) {
    if (!await pmIDBSet(BRANCH_LINEAGE_STORE_KEY, value)) {
        throw new Error('分支继承记录保存失败：IndexedDB 不可用');
    }
}

export function saveBranchLineage(value) {
    assertBranchLineageValue(value);
    const operation = branchLineageQueue.catch(() => {}).then(async () => {
        const current = await loadBranchLineage();
        const next = { ...structuredClone(value), ...current };
        await writeBranchLineage(next);
        for (const targetId of Object.keys(value)) {
            if (!Object.hasOwn(current, targetId)) markBranchLineageWrite(targetId);
        }
        return next;
    });
    branchLineageQueue = operation;
    return operation;
}

export function saveBranchLineageForBackup(value) {
    assertBranchLineageValue(value);
    const operation = branchLineageQueue.catch(() => {}).then(async () => {
        const current = await loadBranchLineage();
        const entries = {};
        for (const [targetId, entry] of Object.entries(value)) {
            if (!Object.hasOwn(current, targetId)) entries[targetId] = structuredClone(entry);
        }
        const next = { ...structuredClone(value), ...current };
        await writeBranchLineage(next);
        const revisions = {};
        for (const targetId of Object.keys(entries)) revisions[targetId] = markBranchLineageWrite(targetId);
        return { entries, revisions };
    });
    branchLineageQueue = operation;
    return operation;
}

export function rollbackBranchLineageBackup(inserted) {
    assertBranchLineageValue(inserted);
    assertBranchLineageValue(inserted.entries);
    assertBranchLineageValue(inserted.revisions);
    const operation = branchLineageQueue.catch(() => {}).then(async () => {
        const current = await loadBranchLineage();
        const next = structuredClone(current);
        for (const [targetId, entry] of Object.entries(inserted.entries)) {
            if (branchLineageRevision(targetId) === inserted.revisions[targetId]
                && Object.hasOwn(next, targetId) && JSON.stringify(next[targetId]) === JSON.stringify(entry)) {
                delete next[targetId];
                markBranchLineageWrite(targetId);
            }
        }
        await writeBranchLineage(next);
        return next;
    });
    branchLineageQueue = operation;
    return operation;
}

export function commitBranchLineage(targetId, entry) {
    if (typeof targetId !== 'string' || !targetId.trim()) {
        return Promise.reject(new Error('分支继承记录保存失败：目标 scope 无效'));
    }
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
        return Promise.reject(new Error('分支继承记录保存失败：记录条目必须是对象'));
    }
    const operation = branchLineageQueue.catch(() => {}).then(async () => {
        const current = await loadBranchLineage();
        const next = { ...current, [targetId]: structuredClone(entry) };
        await writeBranchLineage(next);
        markBranchLineageWrite(targetId);
        return next;
    });
    branchLineageQueue = operation;
    return operation;
}

export const PHONE_UI_STORAGE_KEY = PHONE_UI_STATE_KEY;

const isPluginIdbKey = key => typeof key === 'string' && (
    PLUGIN_IDB_STATIC_KEYS.includes(key)
    || PLUGIN_IDB_DYNAMIC_PREFIXES.some(prefix => key.startsWith(prefix))
);

export async function clearPluginData({
    localStorageRef = globalThis.localStorage,
    listIdbKeys = pmIDBKeys,
    readIdbEntry = pmIDBReadEntry,
    writeIdb = pmIDBSet,
    deleteIdb = pmIDBDel,
    afterClear = async () => {},
} = {}) {
    if (!localStorageRef) throw new Error('插件数据清理失败：浏览器存储不可用');
    const localSnapshot = new Map();
    for (const key of PLUGIN_LOCAL_STORAGE_KEYS) {
        try { localSnapshot.set(key, localStorageRef.getItem(key)); }
        catch (error) { throw new Error(`插件数据清理失败：无法读取 ${key}`); }
    }
    const listedKeys = await listIdbKeys();
    if (!Array.isArray(listedKeys)) throw new Error('插件数据清理失败：无法枚举 IndexedDB');
    const idbKeys = listedKeys.filter(isPluginIdbKey);
    const idbSnapshot = new Map();
    for (const key of idbKeys) {
        const entry = await readIdbEntry(key);
        if (!entry?.ok) throw new Error(`插件数据清理失败：无法读取 IndexedDB ${key}`);
        idbSnapshot.set(key, entry.value);
    }
    try {
        for (const key of PLUGIN_LOCAL_STORAGE_KEYS) localStorageRef.removeItem(key);
        for (const key of idbKeys) {
            if (!await deleteIdb(key)) throw new Error(`插件数据清理失败：无法删除 IndexedDB ${key}`);
        }
        await afterClear();
        return { localKeys: PLUGIN_LOCAL_STORAGE_KEYS.length, idbKeys: idbKeys.length };
    } catch (error) {
        const rollbackFailures = [];
        for (const [key, value] of localSnapshot) {
            try {
                if (value === null) localStorageRef.removeItem(key);
                else localStorageRef.setItem(key, value);
            } catch (rollbackError) {
                rollbackFailures.push(new Error(`localStorage ${key} 恢复失败：${rollbackError.message}`));
            }
        }
        for (const [key, value] of idbSnapshot) {
            try {
                if (!await writeIdb(key, value)) throw new Error('IndexedDB 不可用');
            } catch (rollbackError) {
                rollbackFailures.push(new Error(`IndexedDB ${key} 恢复失败：${rollbackError.message}`));
            }
        }
        if (rollbackFailures.length) {
            const combined = new Error(`${error.message}；插件数据回滚失败：${rollbackFailures.map(item => item.message).join('；')}`);
            combined.cause = error;
            combined.rollbackError = new AggregateError(rollbackFailures, '插件数据回滚失败');
            throw combined;
        }
        throw error;
    }
}
