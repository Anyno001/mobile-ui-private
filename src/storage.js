import {
    CALENDAR_CYCLE_STORAGE_KEY, CALENDAR_HOLIDAY_STORAGE_KEY, CALENDAR_OCCASION_STORAGE_KEY,
    CALENDAR_STORAGE_KEY, CALENDAR_WEATHER_STORAGE_KEY, CHARACTER_BEHAVIOR_KEY,
    PM_IDB_NAME, PM_IDB_STORE,
} from './constants.js';
import { BUDGET_CONFIG_KEY, normalizeBudgetConfig } from './budget.js';
import {
    normalizeCharacterBehaviorStore, normalizeGroupMetaStore,
} from './behavior-config.js';
import { enqueueDirectorySave, waitForDirectorySave } from './directory-save-coordinator.js';
import { createEmptyPhoneUiState, normalizePhoneUiState } from './interactive-scene-model.js';

let database = null;
let openInFlight = null;

const EMOJI_STORE_KEY = 'ST_SMS_EMOJIS';
const EMOJI_FALLBACK_KEY = `${EMOJI_STORE_KEY}_LOCAL_FALLBACK`;
const GROUP_META_STORE_KEY = 'ST_SMS_GROUP_META';
const GROUP_META_FALLBACK_KEY = `${GROUP_META_STORE_KEY}_LOCAL_FALLBACK`;
const INTERACTIVE_STORE_KEY = 'ST_INTERACTIVE_SCENES_V1';
const INTERACTIVE_FALLBACK_KEY = `${INTERACTIVE_STORE_KEY}_LOCAL_FALLBACK`;
const PHONE_UI_STATE_KEY = 'ST_SMS_PHONE_UI_STATE';
export const DESKTOP_BG_KEY = 'ST_SMS_BG_DESKTOP';
export const PLUGIN_LOCAL_STORAGE_KEYS = Object.freeze([
    'ST_SMS_DATA_V2', 'ST_SMS_CONFIG', 'ST_SMS_THEME', 'ST_SMS_POKE_CONFIG', 'ST_SMS_WORDY_LIMIT',
    BUDGET_CONFIG_KEY, 'ST_SMS_BG_GLOBAL', 'ST_SMS_BG_LOCAL', DESKTOP_BG_KEY, GROUP_META_STORE_KEY, GROUP_META_FALLBACK_KEY,
    EMOJI_STORE_KEY, EMOJI_FALLBACK_KEY, CHARACTER_BEHAVIOR_KEY, 'ST_SMS_API_PROFILES', 'ST_SMS_BIDIRECTIONAL',
    INTERACTIVE_STORE_KEY, INTERACTIVE_FALLBACK_KEY, PHONE_UI_STATE_KEY, 'ST_SMS_PHONE_QR_INITIALIZED',
    CALENDAR_STORAGE_KEY, CALENDAR_OCCASION_STORAGE_KEY, CALENDAR_HOLIDAY_STORAGE_KEY,
    CALENDAR_WEATHER_STORAGE_KEY, CALENDAR_CYCLE_STORAGE_KEY,
]);
export const PLUGIN_IDB_STATIC_KEYS = Object.freeze([
    'ST_SMS_DATA_V2', EMOJI_STORE_KEY, GROUP_META_STORE_KEY, INTERACTIVE_STORE_KEY, 'ST_SMS_BG_GLOBAL', DESKTOP_BG_KEY,
]);
export const PLUGIN_IDB_DYNAMIC_PREFIXES = Object.freeze(['ST_SMS_BG_LOCAL_']);

export function pmOpenIDB() {
    if (database) {
        try {
            database.transaction(PM_IDB_STORE, 'readonly');
            return Promise.resolve(database);
        } catch (error) {
            database = null;
        }
    }
    // Reuse an in-flight open so concurrent first-frame callers don't each open a
    // connection (leaking all but the last). Cleared once the open settles.
    if (openInFlight) return openInFlight;
    openInFlight = new Promise(resolve => {
        try {
            const request = indexedDB.open(PM_IDB_NAME, 1);
            request.onupgradeneeded = () => {
                const db = request.result;
                if (!db.objectStoreNames.contains(PM_IDB_STORE)) db.createObjectStore(PM_IDB_STORE);
            };
            request.onsuccess = () => {
                database = request.result;
                database.onversionchange = () => {
                    database?.close();
                    database = null;
                };
                resolve(database);
            };
            request.onerror = () => resolve(null);
            // Another tab holding an older-version connection can block the open;
            // without this the promise would hang forever and freeze all storage.
            request.onblocked = () => resolve(null);
        } catch (error) {
            resolve(null);
        }
    }).finally(() => { openInFlight = null; });
    return openInFlight;
}

export async function pmIDBSet(key, value) {
    const db = await pmOpenIDB();
    if (!db) return false;
    return new Promise(resolve => {
        let settled = false;
        const finish = result => {
            if (settled) return;
            settled = true;
            resolve(result);
        };
        try {
            const transaction = db.transaction(PM_IDB_STORE, 'readwrite');
            transaction.objectStore(PM_IDB_STORE).put(value, key);
            transaction.oncomplete = () => finish(true);
            transaction.onerror = () => finish(false);
            transaction.onabort = () => finish(false);
        } catch (error) {
            finish(false);
        }
    });
}

export async function pmIDBGet(key) {
    const db = await pmOpenIDB();
    if (!db) return null;
    return new Promise(resolve => {
        let settled = false;
        const finish = result => {
            if (settled) return;
            settled = true;
            resolve(result);
        };
        try {
            const transaction = db.transaction(PM_IDB_STORE, 'readonly');
            const request = transaction.objectStore(PM_IDB_STORE).get(key);
            request.onsuccess = () => finish(request.result ?? null);
            request.onerror = () => finish(null);
            transaction.onabort = () => finish(null);
        } catch (error) {
            finish(null);
        }
    });
}

export async function pmIDBDel(key) {
    const db = await pmOpenIDB();
    if (!db) return false;
    return new Promise(resolve => {
        let settled = false;
        const finish = result => {
            if (settled) return;
            settled = true;
            resolve(result);
        };
        try {
            const transaction = db.transaction(PM_IDB_STORE, 'readwrite');
            transaction.objectStore(PM_IDB_STORE).delete(key);
            transaction.oncomplete = () => finish(true);
            transaction.onerror = () => finish(false);
            transaction.onabort = () => finish(false);
        } catch (error) {
            finish(false);
        }
    });
}

export async function pmIDBKeys() {
    const db = await pmOpenIDB();
    if (!db) return null;
    return new Promise(resolve => {
        let settled = false;
        let keys = null;
        const finish = result => {
            if (settled) return;
            settled = true;
            resolve(result);
        };
        try {
            const transaction = db.transaction(PM_IDB_STORE, 'readonly');
            const request = transaction.objectStore(PM_IDB_STORE).getAllKeys();
            request.onsuccess = () => { keys = Array.isArray(request.result) ? request.result : []; };
            request.onerror = () => finish(null);
            transaction.oncomplete = () => finish(keys);
            transaction.onerror = () => finish(null);
            transaction.onabort = () => finish(null);
        } catch (error) {
            finish(null);
        }
    });
}

async function pmIDBReadEntry(key) {
    const db = await pmOpenIDB();
    if (!db) return { ok: false, value: undefined };
    return new Promise(resolve => {
        let settled = false;
        const finish = result => {
            if (settled) return;
            settled = true;
            resolve(result);
        };
        try {
            const transaction = db.transaction(PM_IDB_STORE, 'readonly');
            const request = transaction.objectStore(PM_IDB_STORE).get(key);
            request.onsuccess = () => finish({ ok: true, value: request.result });
            request.onerror = () => finish({ ok: false, value: undefined });
            transaction.onerror = () => finish({ ok: false, value: undefined });
            transaction.onabort = () => finish({ ok: false, value: undefined });
        } catch (error) {
            finish({ ok: false, value: undefined });
        }
    });
}

export function isBigData(value) {
    return typeof value === 'string' && value.length > 4096 && (value.startsWith('data:') || value.startsWith('blob:'));
}

export function saveHistories() {
    saveHistoriesStrict().catch(error => console.warn('[phone-mode] 短信历史保存失败', error));
}

export async function saveHistoriesStrict(data = window.__pmHistories) {
    return enqueueDirectorySave('histories', data, async snapshot => {
        const saved = await pmIDBSet('ST_SMS_DATA_V2', snapshot);
        if (!saved) throw new Error('聊天记录保存失败：IndexedDB 不可用');
        try {
            localStorage.setItem('ST_SMS_DATA_V2', JSON.stringify(snapshot));
        } catch (error) {
            console.warn('[phone-mode] localStorage 已满，短信历史仅保存在 IDB');
        }
        return true;
    }, arguments.length === 0);
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

export async function loadHistoriesFromIDB() {
    try {
        // 冷启动重载前先等待在途的历史保存落盘，避免用旧 IDB 覆盖尚未写完的内存新数据。
        await waitForDirectorySave('histories');
        const value = await pmIDBGet('ST_SMS_DATA_V2');
        if (!value) {
            try {
                const fallback = JSON.parse(localStorage.getItem('ST_SMS_DATA_V2'));
                if (fallback && typeof fallback === 'object' && Object.keys(fallback).length > 0) {
                    window.__pmHistories = fallback;
                    console.log('[phone-mode] IDB 无数据，已从 localStorage 恢复');
                }
            } catch (error) {}
            return;
        }
        const parsed = typeof value === 'string' ? JSON.parse(value) : value;
        if (!parsed || typeof parsed !== 'object') return;
        const idbCount = Object.keys(parsed).length;
        if (idbCount > 0) {
            window.__pmHistories = parsed;
            try {
                localStorage.setItem('ST_SMS_DATA_V2', JSON.stringify(parsed));
            } catch (error) {
                console.warn('[phone-mode] localStorage 已满，仅使用 IDB 存储');
            }
            console.log('[phone-mode] 从 IndexedDB 加载了短信历史，共', idbCount, '个会话');
        }
    } catch (error) {
        console.warn('[phone-mode] IDB 恢复失败，尝试 localStorage 兜底', error);
        try {
            const fallback = JSON.parse(localStorage.getItem('ST_SMS_DATA_V2'));
            if (fallback && typeof fallback === 'object' && Object.keys(fallback).length > 0) {
                window.__pmHistories = fallback;
            }
        } catch (fallbackError) {}
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

export function savePokeConfig() {
    try {
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
    const normalized = normalizeBudgetConfig(candidate);
    try {
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
    const updatesGlobalState = arguments.length === 0;
    const snapshot = normalizeGroupMetaStore(updatesGlobalState ? window.__pmGroupMeta : data);
    if (updatesGlobalState) window.__pmGroupMeta = snapshot;
    return enqueueDirectorySave('groupMeta', snapshot, async frozen => {
        const saved = await pmIDBSet(GROUP_META_STORE_KEY, frozen);
        if (saved) {
            try { localStorage.setItem(GROUP_META_STORE_KEY, JSON.stringify(frozen)); } catch (error) {}
            try { localStorage.removeItem(GROUP_META_FALLBACK_KEY); } catch (error) {}
        } else {
            try { localStorage.setItem(GROUP_META_FALLBACK_KEY, JSON.stringify(frozen)); }
            catch { throw new Error('群聊配置保存失败：浏览器存储不可用或空间不足'); }
        }
        return frozen;
    }, updatesGlobalState);
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

export function loadBidirectional() {
    try { window.__pmBidirectional = JSON.parse(localStorage.getItem('ST_SMS_BIDIRECTIONAL')) || {}; }
    catch (error) { window.__pmBidirectional = {}; }
}

export function saveBidirectional() {
    try {
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

export async function saveInteractiveScenes(store) {
    const saved = await pmIDBSet(INTERACTIVE_STORE_KEY, store);
    if (saved) {
        try {
            localStorage.removeItem(INTERACTIVE_FALLBACK_KEY);
        } catch (error) {
            try {
                localStorage.setItem(INTERACTIVE_FALLBACK_KEY, JSON.stringify(store));
            } catch (fallbackError) {
                throw new Error('互动场景主存储已更新，但后备数据同步失败');
            }
        }
        return;
    }
    try {
        localStorage.setItem(INTERACTIVE_FALLBACK_KEY, JSON.stringify(store));
    } catch (error) {
        throw new Error('互动场景保存失败：浏览器存储不可用');
    }
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

export function savePhoneUiState(state, interactiveStore) {
    try {
        const normalized = normalizePhoneUiState(state, interactiveStore);
        localStorage.setItem(PHONE_UI_STATE_KEY, JSON.stringify(normalized));
        return true;
    } catch (error) {
        console.error('[phone-mode] 手机界面状态保存失败', error);
        return false;
    }
}

export const INTERACTIVE_STORAGE_KEYS = Object.freeze({
    primary: INTERACTIVE_STORE_KEY,
    fallback: INTERACTIVE_FALLBACK_KEY,
});

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
