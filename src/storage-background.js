import { IDB_MARKER } from './constants.js';
import { DESKTOP_BG_KEY, isBigData, pmIDBDel, pmIDBGet, pmIDBSet } from './storage-primitives.js';
import { enqueueDirectorySave } from './directory-save-coordinator.js';

const GLOBAL_BG_KEY = 'ST_SMS_BG_GLOBAL';
const LOCAL_BG_INDEX_KEY = 'ST_SMS_BG_LOCAL';
const LOCAL_BG_PREFIX = 'ST_SMS_BG_LOCAL_';
const LOCAL_BG_CACHE_LIMIT = 2;
const localBackgroundCache = new Map();

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
        const storedGlobal = localStorage.getItem(GLOBAL_BG_KEY) || '';
        if (storedGlobal === IDB_MARKER) {
            window.__pmBgGlobal = (await pmIDBGet(GLOBAL_BG_KEY)) || '';
        } else if (isBigData(storedGlobal)) {
            window.__pmBgGlobal = storedGlobal;
            await migrateSingleBackground(GLOBAL_BG_KEY, storedGlobal);
        } else {
            window.__pmBgGlobal = storedGlobal;
        }
    } catch (error) {
        window.__pmBgGlobal = '';
    }

    try {
        const storedLocal = readLocalBackgroundPointers();
        const pointers = Object.create(null);
        const staged = [];
        for (const [key, value] of Object.entries(storedLocal)) {
            if (value === IDB_MARKER) {
                pointers[key] = IDB_MARKER;
            } else if (isBigData(value)) {
                const storageKey = LOCAL_BG_PREFIX + key;
                if (await pmIDBSet(storageKey, value)) {
                    pointers[key] = IDB_MARKER;
                    staged.push({ key, storageKey, value });
                } else {
                    pointers[key] = value;
                }
            } else {
                pointers[key] = value;
            }
        }

        if (staged.length) {
            try { localStorage.setItem(LOCAL_BG_INDEX_KEY, JSON.stringify(pointers)); }
            catch (error) {
                for (const { key, storageKey, value } of staged) {
                    await pmIDBDel(storageKey);
                    pointers[key] = value;
                }
            }
        }
        localBackgroundCache.clear();
        window.__pmBgLocal = pointers;
    } catch (error) {
        localBackgroundCache.clear();
        window.__pmBgLocal = Object.create(null);
    }
}

function cacheLocalBackground(key, value) {
    localBackgroundCache.delete(key);
    localBackgroundCache.set(key, value);
    while (localBackgroundCache.size > LOCAL_BG_CACHE_LIMIT) {
        localBackgroundCache.delete(localBackgroundCache.keys().next().value);
    }
    return value;
}

export async function loadLocalBackground(key) {
    const pointer = window.__pmBgLocal?.[key];
    if (pointer !== IDB_MARKER) return typeof pointer === 'string' ? pointer : '';
    if (localBackgroundCache.has(key)) return cacheLocalBackground(key, localBackgroundCache.get(key));
    const value = await pmIDBGet(LOCAL_BG_PREFIX + key);
    if (typeof value !== 'string') throw new Error('会话背景读取失败：IndexedDB 不可用或数据缺失');
    return cacheLocalBackground(key, value);
}

export async function materializeLocalBackgrounds(data = window.__pmBgLocal) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('会话背景数据损坏：必须是对象');
    assertBackgroundEntries(data, '会话背景数据');
    const result = Object.create(null);
    for (const [key, value] of Object.entries(data)) {
        result[key] = value === IDB_MARKER ? await loadLocalBackground(key) : value;
    }
    return result;
}

const UNSAFE_BACKGROUND_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
function assertBackgroundEntries(value, label) {
    for (const [key, entry] of Object.entries(value)) {
        if (UNSAFE_BACKGROUND_KEYS.has(key)) throw new Error(`${label}损坏：包含危险键 ${key}`);
        if (typeof entry !== 'string') throw new Error(`${label}损坏：${key} 必须是字符串`);
    }
}

function readLocalBackgroundPointers() {
    let serialized;
    try { serialized = localStorage.getItem(LOCAL_BG_INDEX_KEY); }
    catch (error) { throw new Error('会话背景索引读取失败：浏览器存储不可用'); }
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
        if (hadPrimary && !await pmIDBDel(storageKey)) throw new Error(`${label}删除失败：IndexedDB 不可用`);
        primaryMutated = hadPrimary;
        try { localStorage.setItem(storageKey, value); }
        catch (error) { await rollbackPrimary(new Error(`${label}保存失败：浏览器存储不可用`)); }
    }
}

export async function saveBgGlobal() {
    return saveSingleBackground({ storageKey: GLOBAL_BG_KEY, value: window.__pmBgGlobal || '', label: '全局背景' });
}

export async function saveDesktopBg() {
    return saveSingleBackground({ storageKey: DESKTOP_BG_KEY, value: window.__pmDesktopBg || '', label: '桌面背景' });
}

export async function saveBgLocal({ data = window.__pmBgLocal, coordinated = false } = {}) {
    const persist = async (snapshot, protectedScopes = []) => {
        if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) throw new Error('会话背景数据损坏：必须是对象');
        assertBackgroundEntries(snapshot, '会话背景数据');
        let current = snapshot;
        if (protectedScopes.length) {
            const pointers = readLocalBackgroundPointers();
            current = structuredClone(snapshot);
            for (const scope of protectedScopes) {
                const prefix = `${scope}_`;
                for (const key of Object.keys(current)) {
                    if (key.startsWith(prefix)) delete current[key];
                }
                for (const [key, pointer] of Object.entries(pointers)) {
                    if (!key.startsWith(prefix)) continue;
                    current[key] = pointer;
                }
            }
        }
        const pointers = Object.create(null);
        const previousPointers = readLocalBackgroundPointers();
        const mutations = [];
        const prepareMutation = async key => {
            const storageKey = LOCAL_BG_PREFIX + key;
            const hadPrimary = previousPointers[key] === IDB_MARKER;
            const previousValue = await readPreviousBackground(storageKey, hadPrimary, '会话背景');
            return { key: storageKey, hadPrimary, previousValue };
        };
        try {
            for (const [key, value] of Object.entries(current)) {
                if (value === IDB_MARKER) {
                    if (previousPointers[key] !== IDB_MARKER) throw new Error(`会话背景数据损坏：${key} 缺少主存储`);
                    pointers[key] = IDB_MARKER;
                    continue;
                }
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
                if (!await pmIDBDel(mutation.key)) throw new Error('会话背景删除失败：IndexedDB 不可用');
                mutations.push(mutation);
            }
            try { localStorage.setItem(LOCAL_BG_INDEX_KEY, JSON.stringify(pointers)); }
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
        localBackgroundCache.clear();
        return structuredClone(pointers);
    };
    if (coordinated) return persist(structuredClone(data));
    return enqueueDirectorySave('backgrounds', data, persist);
}
