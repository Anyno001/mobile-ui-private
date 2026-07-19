import { IDB_MARKER } from './constants.js';
import { DESKTOP_BG_KEY, isBigData, pmIDBDel, pmIDBGet, pmIDBSet } from './storage.js';

const GLOBAL_BG_KEY = 'ST_SMS_BG_GLOBAL';
const LOCAL_BG_INDEX_KEY = 'ST_SMS_BG_LOCAL';
const LOCAL_BG_PREFIX = 'ST_SMS_BG_LOCAL_';

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
        const result = Object.create(null);
        let migrated = 0;
        const stagedKeys = [];
        for (const [key, value] of Object.entries(storedLocal)) {
            if (value === IDB_MARKER) {
                result[key] = (await pmIDBGet(LOCAL_BG_PREFIX + key)) || '';
            } else if (isBigData(value)) {
                result[key] = value;
                const storageKey = LOCAL_BG_PREFIX + key;
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
            try { localStorage.setItem(LOCAL_BG_INDEX_KEY, JSON.stringify(storedLocal)); }
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

export async function saveBgLocal() {
    const current = window.__pmBgLocal || {};
    if (!current || typeof current !== 'object' || Array.isArray(current)) throw new Error('会话背景数据损坏：必须是对象');
    assertBackgroundEntries(current, '会话背景数据');
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
}
