import { IDB_MARKER, PM_IDB_NAME, PM_IDB_STORE } from './constants.js';

let database = null;

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
        try {
            const transaction = db.transaction(PM_IDB_STORE, 'readwrite');
            transaction.objectStore(PM_IDB_STORE).put(value, key);
            transaction.oncomplete = () => resolve(true);
            transaction.onerror = () => resolve(false);
        } catch (error) {
            resolve(false);
        }
    });
}

export async function pmIDBGet(key) {
    const db = await pmOpenIDB();
    if (!db) return null;
    return new Promise(resolve => {
        try {
            const transaction = db.transaction(PM_IDB_STORE, 'readonly');
            const request = transaction.objectStore(PM_IDB_STORE).get(key);
            request.onsuccess = () => resolve(request.result ?? null);
            request.onerror = () => resolve(null);
        } catch (error) {
            resolve(null);
        }
    });
}

export async function pmIDBDel(key) {
    const db = await pmOpenIDB();
    if (!db) return;
    try {
        const transaction = db.transaction(PM_IDB_STORE, 'readwrite');
        transaction.objectStore(PM_IDB_STORE).delete(key);
    } catch (error) {}
}

function isBigData(value) {
    return typeof value === 'string' && value.length > 4096 && (value.startsWith('data:') || value.startsWith('blob:'));
}


export function saveHistories() {
    pmIDBSet('ST_SMS_DATA_V2', window.__pmHistories).catch(() => {});
    try {
        localStorage.setItem('ST_SMS_DATA_V2', JSON.stringify(window.__pmHistories));
    } catch (error) {
        console.warn('[phone-mode] localStorage 已满，短信历史仅保存在 IDB');
    }
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
        const value = await pmIDBGet('ST_SMS_EMOJIS');
        window.__pmEmojis = Array.isArray(value) ? value : [];
    } catch (error) {
        window.__pmEmojis = [];
    }
}

export async function saveEmojis() {
    await pmIDBSet('ST_SMS_EMOJIS', window.__pmEmojis).catch(() => {});
}

export function loadTheme() {
    try {
        window.__pmTheme = { ...window.__pmTheme, ...JSON.parse(localStorage.getItem('ST_SMS_THEME')) };
    } catch (error) {}
}

export function saveTheme() {
    try { localStorage.setItem('ST_SMS_THEME', JSON.stringify(window.__pmTheme)); } catch (error) {}
}

export function loadPokeConfig() {
    try { window.__pmPokeConfig = JSON.parse(localStorage.getItem('ST_SMS_POKE_CONFIG')) || {}; }
    catch (error) { window.__pmPokeConfig = {}; }
}

export function savePokeConfig() {
    try { localStorage.setItem('ST_SMS_POKE_CONFIG', JSON.stringify(window.__pmPokeConfig)); } catch (error) {}
}

export function loadWordyLimit() {
    try { window.__pmWordyLimit = !!JSON.parse(localStorage.getItem('ST_SMS_WORDY_LIMIT')); }
    catch (error) { window.__pmWordyLimit = false; }
}

export function saveWordyLimit() {
    try { localStorage.setItem('ST_SMS_WORDY_LIMIT', JSON.stringify(window.__pmWordyLimit)); } catch (error) {}
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
        const storedLocal = JSON.parse(localStorage.getItem('ST_SMS_BG_LOCAL')) || {};
        const result = {};
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
        window.__pmBgLocal = {};
    }
}

export async function saveBgGlobal() {
    const value = window.__pmBgGlobal || '';
    if (isBigData(value)) {
        await pmIDBSet('ST_SMS_BG_GLOBAL', value);
        try { localStorage.setItem('ST_SMS_BG_GLOBAL', IDB_MARKER); } catch (error) {}
    } else {
        await pmIDBDel('ST_SMS_BG_GLOBAL');
        try { localStorage.setItem('ST_SMS_BG_GLOBAL', value); } catch (error) {}
    }
}

export async function saveBgLocal() {
    const pointers = {};
    for (const [key, value] of Object.entries(window.__pmBgLocal || {})) {
        if (isBigData(value)) {
            await pmIDBSet('ST_SMS_BG_LOCAL_' + key, value);
            pointers[key] = IDB_MARKER;
        } else {
            await pmIDBDel('ST_SMS_BG_LOCAL_' + key);
            if (value !== undefined) pointers[key] = value;
        }
    }
    try { localStorage.setItem('ST_SMS_BG_LOCAL', JSON.stringify(pointers)); } catch (error) {}
}

export function loadGroupMeta() {
    try { window.__pmGroupMeta = JSON.parse(localStorage.getItem('ST_SMS_GROUP_META')) || {}; }
    catch (error) { window.__pmGroupMeta = {}; }
}

export function saveGroupMeta() {
    try { localStorage.setItem('ST_SMS_GROUP_META', JSON.stringify(window.__pmGroupMeta)); } catch (error) {}
}

export function loadProfiles() {
    try { window.__pmProfiles = JSON.parse(localStorage.getItem('ST_SMS_API_PROFILES')) || []; }
    catch (error) { window.__pmProfiles = []; }
}

export function saveProfiles() {
    try { localStorage.setItem('ST_SMS_API_PROFILES', JSON.stringify(window.__pmProfiles)); } catch (error) {}
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
    try { localStorage.setItem('ST_SMS_BIDIRECTIONAL', JSON.stringify(window.__pmBidirectional)); } catch (error) {}
}
