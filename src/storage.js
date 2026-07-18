import {
    CALENDAR_CYCLE_STORAGE_KEY, CALENDAR_HOLIDAY_STORAGE_KEY, CALENDAR_OCCASION_STORAGE_KEY,
    CALENDAR_STORAGE_KEY, CALENDAR_WEATHER_STORAGE_KEY, CHARACTER_BEHAVIOR_KEY, IDB_MARKER,
    PM_IDB_NAME, PM_IDB_STORE,
} from './constants.js';
import { BUDGET_CONFIG_KEY, normalizeBudgetConfig } from './budget.js';
import {
    normalizeCharacterBehaviorStore, normalizeGroupMetaStore,
} from './behavior-config.js';
import { createEmptyPhoneUiState, normalizePhoneUiState } from './interactive-scene-model.js';

let database = null;

const EMOJI_STORE_KEY = 'ST_SMS_EMOJIS';
const EMOJI_FALLBACK_KEY = `${EMOJI_STORE_KEY}_LOCAL_FALLBACK`;
const GROUP_META_STORE_KEY = 'ST_SMS_GROUP_META';
const GROUP_META_FALLBACK_KEY = `${GROUP_META_STORE_KEY}_LOCAL_FALLBACK`;
const INTERACTIVE_STORE_KEY = 'ST_INTERACTIVE_SCENES_V1';
const INTERACTIVE_FALLBACK_KEY = `${INTERACTIVE_STORE_KEY}_LOCAL_FALLBACK`;
const PHONE_UI_STATE_KEY = 'ST_SMS_PHONE_UI_STATE';
const DESKTOP_BG_KEY = 'ST_SMS_BG_DESKTOP';
export const PLUGIN_LOCAL_STORAGE_KEYS = Object.freeze([
    'ST_SMS_DATA_V2', 'ST_SMS_CONFIG', 'ST_SMS_THEME', 'ST_SMS_POKE_CONFIG', 'ST_SMS_WORDY_LIMIT',
    BUDGET_CONFIG_KEY, 'ST_SMS_BG_GLOBAL', 'ST_SMS_BG_LOCAL', DESKTOP_BG_KEY, GROUP_META_STORE_KEY, GROUP_META_FALLBACK_KEY,
    EMOJI_STORE_KEY, EMOJI_FALLBACK_KEY, CHARACTER_BEHAVIOR_KEY, 'ST_SMS_API_PROFILES', 'ST_SMS_BIDIRECTIONAL',
    INTERACTIVE_STORE_KEY, INTERACTIVE_FALLBACK_KEY, PHONE_UI_STATE_KEY,
    CALENDAR_STORAGE_KEY, CALENDAR_OCCASION_STORAGE_KEY, CALENDAR_HOLIDAY_STORAGE_KEY,
    CALENDAR_WEATHER_STORAGE_KEY, CALENDAR_CYCLE_STORAGE_KEY,
]);
export const PLUGIN_IDB_STATIC_KEYS = Object.freeze([
    'ST_SMS_DATA_V2', EMOJI_STORE_KEY, GROUP_META_STORE_KEY, INTERACTIVE_STORE_KEY, 'ST_SMS_BG_GLOBAL', DESKTOP_BG_KEY,
]);
export const PLUGIN_IDB_DYNAMIC_PREFIXES = Object.freeze(['ST_SMS_BG_LOCAL_']);

export function pmOpenIDB() {
    return new Promise(resolve => {
        if (database) {
            try {
                database.transaction(PM_IDB_STORE, 'readonly');
                resolve(database);
                return;
            } catch (error) {
                database = null;
            }
        }
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
        } catch (error) {
            resolve(null);
        }
    });
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
    const saved = await pmIDBSet('ST_SMS_DATA_V2', data);
    if (!saved) throw new Error('聊天记录保存失败：IndexedDB 不可用');
    try {
        localStorage.setItem('ST_SMS_DATA_V2', JSON.stringify(data));
    } catch (error) {
        console.warn('[phone-mode] localStorage 已满，短信历史仅保存在 IDB');
    }
    return true;
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

async function migrateSingleBackground(storageKey, value) {
    if (!await pmIDBSet(storageKey, value)) return false;
    try {
        localStorage.setItem(storageKey, IDB_MARKER);
        return true;
    } catch (error) {
        await pmIDBDel(storageKey);
        return false;
    }
}


export async function loadBgSettings() {
    try {
        const storedDesktop = localStorage.getItem(DESKTOP_BG_KEY) || '';
        if (storedDesktop === IDB_MARKER) {
            window.__pmDesktopBg = (await pmIDBGet(DESKTOP_BG_KEY)) || '';
        } else if (isBigData(storedDesktop)) {
            window.__pmDesktopBg = storedDesktop;
            await migrateSingleBackground(DESKTOP_BG_KEY, storedDesktop);
        } else {
            window.__pmDesktopBg = storedDesktop;
        }
    } catch (error) {
        window.__pmDesktopBg = '';
    }

    try {
        const storedGlobal = localStorage.getItem('ST_SMS_BG_GLOBAL') || '';
        if (storedGlobal === IDB_MARKER) {
            window.__pmBgGlobal = (await pmIDBGet('ST_SMS_BG_GLOBAL')) || '';
        } else if (isBigData(storedGlobal)) {
            window.__pmBgGlobal = storedGlobal;
            await migrateSingleBackground('ST_SMS_BG_GLOBAL', storedGlobal);
        } else {
            window.__pmBgGlobal = storedGlobal;
        }
    } catch (error) {
        window.__pmBgGlobal = '';
    }

    try {
        const storedLocal = readLocalBackgroundPointers();
        const result = Object.create(null);
        let migrated = 0;
        const stagedKeys = [];
        for (const [key, value] of Object.entries(storedLocal)) {
            if (value === IDB_MARKER) {
                result[key] = (await pmIDBGet('ST_SMS_BG_LOCAL_' + key)) || '';
            } else if (isBigData(value)) {
                result[key] = value;
                const storageKey = 'ST_SMS_BG_LOCAL_' + key;
                if (await pmIDBSet(storageKey, value)) {
                    storedLocal[key] = IDB_MARKER;
                    stagedKeys.push(storageKey);
                    migrated++;
                }
            } else {
                result[key] = value;
            }
        }
        if (migrated > 0) {
            try { localStorage.setItem('ST_SMS_BG_LOCAL', JSON.stringify(storedLocal)); }
            catch (error) {
                for (const storageKey of stagedKeys) await pmIDBDel(storageKey);
            }
        }
        window.__pmBgLocal = result;
    } catch (error) {
        window.__pmBgLocal = Object.create(null);
    }
}

const UNSAFE_BACKGROUND_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
function assertBackgroundEntries(value, label) {
    for (const [key, entry] of Object.entries(value)) {
        if (UNSAFE_BACKGROUND_KEYS.has(key)) throw new Error(`${label}损坏：包含危险键 ${key}`);
        if (typeof entry !== 'string') {
            throw new Error(`${label}损坏：${key} 必须是字符串`);
        }
    }
}

function readLocalBackgroundPointers() {
    let serialized;
    try {
        serialized = localStorage.getItem('ST_SMS_BG_LOCAL');
    } catch (error) {
        throw new Error('会话背景索引读取失败：浏览器存储不可用');
    }
    if (!serialized) return {};
    let parsed;
    try { parsed = JSON.parse(serialized); }
    catch (error) { throw new Error('会话背景索引损坏：无法解析'); }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('会话背景索引损坏：必须是对象');
    assertBackgroundEntries(parsed, '会话背景索引');
    return parsed;
}

async function restoreBackgroundMutations(mutations, label) {
    const failures = [];
    for (const mutation of mutations.slice().reverse()) {
        const restored = mutation.hadPrimary
            ? await pmIDBSet(mutation.key, mutation.previousValue)
            : await pmIDBDel(mutation.key);
        if (!restored) failures.push(mutation.key);
    }
    if (failures.length) throw new Error(`${label}主数据补偿失败`);
}

async function readPreviousBackground(key, hasPrimary, label) {
    if (!hasPrimary) return null;
    const value = await pmIDBGet(key);
    if (value === null) throw new Error(`${label}原数据读取失败：IndexedDB 不可用或数据缺失`);
    return value;
}

function combinedBackgroundError(error, compensationError) {
    const combined = new Error(`${error.message}；${compensationError.message}`);
    combined.cause = error;
    return combined;
}

async function saveSingleBackground({ storageKey, value, label }) {
    let previousPointer;
    try { previousPointer = localStorage.getItem(storageKey) || ''; }
    catch (error) { throw new Error(`${label}索引读取失败：浏览器存储不可用`); }
    const hadPrimary = previousPointer === IDB_MARKER;
    const previousValue = await readPreviousBackground(storageKey, hadPrimary, label);
    let primaryMutated = false;
    const rollbackPrimary = async error => {
        if (!primaryMutated) throw error;
        try {
            await restoreBackgroundMutations([{ key: storageKey, hadPrimary, previousValue }], label);
        } catch (compensationError) {
            throw combinedBackgroundError(error, compensationError);
        }
        throw error;
    };
    if (isBigData(value)) {
        if (!await pmIDBSet(storageKey, value)) throw new Error(`${label}保存失败：IndexedDB 不可用`);
        primaryMutated = true;
        try { localStorage.setItem(storageKey, IDB_MARKER); }
        catch (error) { await rollbackPrimary(new Error(`${label}索引保存失败：浏览器存储不可用`)); }
    } else {
        if (hadPrimary && !await pmIDBDel(storageKey)) {
            throw new Error(`${label}删除失败：IndexedDB 不可用`);
        }
        primaryMutated = hadPrimary;
        try { localStorage.setItem(storageKey, value); }
        catch (error) { await rollbackPrimary(new Error(`${label}保存失败：浏览器存储不可用`)); }
    }
}

export async function saveBgGlobal() {
    return saveSingleBackground({ storageKey: 'ST_SMS_BG_GLOBAL', value: window.__pmBgGlobal || '', label: '全局背景' });
}

export async function saveDesktopBg() {
    return saveSingleBackground({ storageKey: DESKTOP_BG_KEY, value: window.__pmDesktopBg || '', label: '桌面背景' });
}

export async function saveBgLocal() {
    const current = window.__pmBgLocal || {};
    if (!current || typeof current !== 'object' || Array.isArray(current)) throw new Error('会话背景数据损坏：必须是对象');
    assertBackgroundEntries(current, '会话背景数据');
    const pointers = Object.create(null);
    const previousPointers = readLocalBackgroundPointers();
    const mutations = [];
    const prepareMutation = async key => {
        const storageKey = 'ST_SMS_BG_LOCAL_' + key;
        const hadPrimary = previousPointers[key] === IDB_MARKER;
        const previousValue = await readPreviousBackground(storageKey, hadPrimary, '会话背景');
        return { key: storageKey, hadPrimary, previousValue };
    };
    try {
        for (const [key, value] of Object.entries(current)) {
            if (isBigData(value)) {
                const mutation = await prepareMutation(key);
                if (!await pmIDBSet(mutation.key, value)) throw new Error('会话背景保存失败：IndexedDB 不可用');
                mutations.push(mutation);
                pointers[key] = IDB_MARKER;
            } else {
                if (previousPointers[key] === IDB_MARKER) {
                    const mutation = await prepareMutation(key);
                    if (!await pmIDBDel(mutation.key)) throw new Error('会话背景删除失败：IndexedDB 不可用');
                    mutations.push(mutation);
                }
                pointers[key] = value;
            }
        }
        for (const [key, previousValue] of Object.entries(previousPointers)) {
            if (previousValue !== IDB_MARKER || Object.hasOwn(current, key)) continue;
            const mutation = await prepareMutation(key);
            if (!await pmIDBDel(mutation.key)) {
                throw new Error('会话背景删除失败：IndexedDB 不可用');
            }
            mutations.push(mutation);
        }
        try { localStorage.setItem('ST_SMS_BG_LOCAL', JSON.stringify(pointers)); }
        catch (error) { throw new Error('会话背景索引保存失败：浏览器存储不可用'); }
    } catch (error) {
        if (mutations.length) {
            try {
                await restoreBackgroundMutations(mutations, '会话背景');
            } catch (compensationError) {
                throw combinedBackgroundError(error, compensationError);
            }
        }
        throw error;
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

export async function saveGroupMeta() {
    window.__pmGroupMeta = normalizeGroupMetaStore(window.__pmGroupMeta);
    const saved = await pmIDBSet(GROUP_META_STORE_KEY, window.__pmGroupMeta);
    if (saved) {
        try { localStorage.setItem(GROUP_META_STORE_KEY, JSON.stringify(window.__pmGroupMeta)); } catch (error) {}
        try { localStorage.removeItem(GROUP_META_FALLBACK_KEY); } catch (error) {}
        return;
    }
    try {
        localStorage.setItem(GROUP_META_FALLBACK_KEY, JSON.stringify(window.__pmGroupMeta));
    } catch (error) {
        throw new Error('群聊配置保存失败：浏览器存储不可用或空间不足');
    }
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
