import {
    CHARACTER_BEHAVIOR_KEY, IDB_MARKER, PM_IDB_NAME, PM_IDB_STORE,
} from './constants.js';
import {
    normalizeCharacterBehaviorStore, normalizeGroupMetaStore,
} from './behavior-config.js';

let database = null;

const EMOJI_STORE_KEY = 'ST_SMS_EMOJIS';
const EMOJI_FALLBACK_KEY = `${EMOJI_STORE_KEY}_LOCAL_FALLBACK`;
const GROUP_META_STORE_KEY = 'ST_SMS_GROUP_META';
const GROUP_META_FALLBACK_KEY = `${GROUP_META_STORE_KEY}_LOCAL_FALLBACK`;
const INTERACTIVE_STORE_KEY = 'ST_INTERACTIVE_SCENES_V1';
const INTERACTIVE_FALLBACK_KEY = `${INTERACTIVE_STORE_KEY}_LOCAL_FALLBACK`;

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
        window.__pmTheme = { ...window.__pmTheme, ...JSON.parse(localStorage.getItem('ST_SMS_THEME')) };
        if (window.__pmTheme.layout !== 'standard') {
            window.__pmTheme.layout = 'standard';
            saveTheme();
        }
    } catch (error) {}
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


export async function loadBgSettings() {
    try {
        const storedGlobal = localStorage.getItem('ST_SMS_BG_GLOBAL') || '';
        if (storedGlobal === IDB_MARKER) {
            window.__pmBgGlobal = (await pmIDBGet('ST_SMS_BG_GLOBAL')) || '';
        } else if (isBigData(storedGlobal)) {
            window.__pmBgGlobal = storedGlobal;
            await pmIDBSet('ST_SMS_BG_GLOBAL', storedGlobal);
            try { localStorage.setItem('ST_SMS_BG_GLOBAL', IDB_MARKER); } catch (error) {}
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
        for (const [key, value] of Object.entries(storedLocal)) {
            if (value === IDB_MARKER) {
                result[key] = (await pmIDBGet('ST_SMS_BG_LOCAL_' + key)) || '';
            } else if (isBigData(value)) {
                result[key] = value;
                await pmIDBSet('ST_SMS_BG_LOCAL_' + key, value);
                storedLocal[key] = IDB_MARKER;
                migrated++;
            } else {
                result[key] = value;
            }
        }
        if (migrated > 0) {
            try { localStorage.setItem('ST_SMS_BG_LOCAL', JSON.stringify(storedLocal)); } catch (error) {}
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

export async function saveBgGlobal() {
    const value = window.__pmBgGlobal || '';
    let previousPointer;
    try { previousPointer = localStorage.getItem('ST_SMS_BG_GLOBAL') || ''; }
    catch (error) { throw new Error('全局背景索引读取失败：浏览器存储不可用'); }
    const hadPrimary = previousPointer === IDB_MARKER;
    const previousValue = await readPreviousBackground('ST_SMS_BG_GLOBAL', hadPrimary, '全局背景');
    let primaryMutated = false;
    const rollbackPrimary = async error => {
        if (!primaryMutated) throw error;
        try {
            await restoreBackgroundMutations([{ key: 'ST_SMS_BG_GLOBAL', hadPrimary, previousValue }], '全局背景');
        } catch (compensationError) {
            throw combinedBackgroundError(error, compensationError);
        }
        throw error;
    };
    if (isBigData(value)) {
        if (!await pmIDBSet('ST_SMS_BG_GLOBAL', value)) throw new Error('全局背景保存失败：IndexedDB 不可用');
        primaryMutated = true;
        try { localStorage.setItem('ST_SMS_BG_GLOBAL', IDB_MARKER); }
        catch (error) { await rollbackPrimary(new Error('全局背景索引保存失败：浏览器存储不可用')); }
    } else {
        if (hadPrimary && !await pmIDBDel('ST_SMS_BG_GLOBAL')) {
            throw new Error('全局背景删除失败：IndexedDB 不可用');
        }
        primaryMutated = hadPrimary;
        try { localStorage.setItem('ST_SMS_BG_GLOBAL', value); }
        catch (error) { await rollbackPrimary(new Error('全局背景保存失败：浏览器存储不可用')); }
    }
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
    if (!profile.apiUrl || !profile.apiKey) return;
    const index = window.__pmProfiles.findIndex(item => item.apiUrl === profile.apiUrl && item.apiKey === profile.apiKey);
    if (index >= 0) window.__pmProfiles[index] = { ...window.__pmProfiles[index], ...profile, savedAt: Date.now() };
    else window.__pmProfiles.push({ ...profile, savedAt: Date.now() });
    saveProfiles();
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

export const INTERACTIVE_STORAGE_KEYS = Object.freeze({
    primary: INTERACTIVE_STORE_KEY,
    fallback: INTERACTIVE_FALLBACK_KEY,
});
