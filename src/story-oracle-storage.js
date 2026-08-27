import { pmIDBReadEntry, pmIDBSet } from './storage-primitives.js';
import { createEmptyStoryOracleStore, normalizeStoryOracleStore, STORY_ORACLE_STORE_VERSION } from './story-oracle-model.js';

export const STORY_ORACLE_STORE_KEY = 'ST_SMS_STORY_ORACLE_V1';
export const STORY_ORACLE_FALLBACK_KEY = `${STORY_ORACLE_STORE_KEY}_LOCAL_FALLBACK`;
let saveQueue = Promise.resolve();
const writableHandles = new WeakSet();

function createWritableHandle() {
    const handle = Object.freeze({});
    writableHandles.add(handle);
    return handle;
}

const isStoreShape = value => value && typeof value === 'object' && !Array.isArray(value)
    && value.version === STORY_ORACLE_STORE_VERSION && value.scopes && typeof value.scopes === 'object' && !Array.isArray(value.scopes);

function parse(value) {
    if (typeof value !== 'string' || !value.trim()) return { store: null, valid: false, present: false };
    try {
        const parsed = JSON.parse(value);
        return { store: isStoreShape(parsed) ? normalizeStoryOracleStore(parsed) : null, valid: isStoreShape(parsed), present: true };
    } catch (error) {
        return { store: null, valid: false, present: true };
    }
}

export async function loadStoryOracleStore({ idbRead = pmIDBReadEntry, storage = globalThis.localStorage } = {}) {
    const idb = await idbRead(STORY_ORACLE_STORE_KEY);
    if (idb?.ok && idb.value !== undefined) {
        if (isStoreShape(idb.value)) return { store: normalizeStoryOracleStore(idb.value), recovered: false, writable: true, writeHandle: createWritableHandle(), warning: null };
    }
    let fallback = { store: null, valid: false, present: false };
    try { fallback = parse(storage?.getItem(STORY_ORACLE_FALLBACK_KEY)); } catch (error) {}
    if (fallback.valid) return {
        store: fallback.store, recovered: true, writable: idb?.ok !== true || idb.value === undefined,
        writeHandle: idb?.ok !== true || idb.value === undefined ? createWritableHandle() : null,
        readOnlyReason: idb?.ok ? '主存储数据损坏或版本不兼容' : '',
        warning: idb?.ok ? '主存储数据无法识别，已从本地后备数据恢复；当前为只读保护状态，原始数据未覆盖。' : '已从本地后备数据恢复；主存储不可用，后续保存将写入本地后备存储。',
    };
    if (idb?.ok && idb.value === undefined && !fallback.present) return {
        store: createEmptyStoryOracleStore(), recovered: false, writable: true, writeHandle: createWritableHandle(), readOnlyReason: '', warning: null,
    };
    if (idb?.ok) return {
        store: createEmptyStoryOracleStore(), recovered: true, writable: false,
        readOnlyReason: '历史数据损坏或版本不兼容', warning: 'Story Oracle 历史数据损坏或版本不兼容，原始数据未覆盖，已使用只读空工作区。',
    };
    if (fallback.present) return {
        store: createEmptyStoryOracleStore(), recovered: false, writable: false,
        readOnlyReason: '后备历史损坏', warning: 'Story Oracle 后备历史损坏，原始数据未覆盖，本次会话不会持久化。',
    };
    return {
        store: createEmptyStoryOracleStore(), recovered: false, writable: Boolean(storage), writeHandle: storage ? createWritableHandle() : null, readOnlyReason: storage ? '' : '存储不可用',
        warning: storage ? 'IndexedDB 不可用，后续保存将写入本地后备存储。' : 'Story Oracle 存储不可用，本次会话不会持久化。',
    };
}

export async function saveStoryOracleStore(store, { idbSet = pmIDBSet, storage = globalThis.localStorage, readOnlyReason = '', writeHandle = null, shouldWrite = null } = {}) {
    if (readOnlyReason) throw new Error(`Story Oracle 当前为只读保护状态：${readOnlyReason}`);
    if (!writableHandles.has(writeHandle)) throw new Error('Story Oracle 写入句柄无效或已失效');
    const operation = async () => {
        if (typeof shouldWrite === 'function' && !shouldWrite()) return false;
        const normalized = normalizeStoryOracleStore(store);
        let idbSaved = false;
        try { idbSaved = await idbSet(STORY_ORACLE_STORE_KEY, normalized); } catch (error) {}
        if (idbSaved) {
            try { storage?.removeItem(STORY_ORACLE_FALLBACK_KEY); } catch (error) {}
            return true;
        }
        try {
            if (typeof storage?.setItem !== 'function') throw new Error('localStorage unavailable');
            storage.setItem(STORY_ORACLE_FALLBACK_KEY, JSON.stringify(normalized));
            return true;
        } catch (error) {
            throw new Error('Story Oracle 历史保存失败：IndexedDB 与本地后备存储均不可用');
        }
    };
    const result = saveQueue.then(operation, operation);
    saveQueue = result.catch(() => undefined);
    return result;
}
