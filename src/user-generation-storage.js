import { pmIDBReadEntry, pmIDBSet } from './storage-primitives.js';
import { createEmptyUserGenerationStore, normalizeUserGenerationStore, USER_GENERATION_STORE_VERSION } from './user-generation-model.js';

export const USER_GENERATION_STORE_KEY = 'ST_SMS_USER_GENERATION_V1';
export const USER_GENERATION_FALLBACK_KEY = `${USER_GENERATION_STORE_KEY}_LOCAL_FALLBACK`;
let saveQueue = Promise.resolve();
const writableHandles = new WeakSet();

function createWritableHandle() {
    const handle = Object.freeze({});
    writableHandles.add(handle);
    return handle;
}

const isStoreShape = value => value && typeof value === 'object' && !Array.isArray(value)
    && value.version === USER_GENERATION_STORE_VERSION && Array.isArray(value.items);

function parse(value) {
    if (typeof value !== 'string' || !value.trim()) return { store: null, valid: false, present: false };
    try {
        const parsed = JSON.parse(value);
        return { store: isStoreShape(parsed) ? normalizeUserGenerationStore(parsed) : null, valid: isStoreShape(parsed), present: true };
    } catch (error) {
        return { store: null, valid: false, present: true };
    }
}

export async function loadUserGenerationStore({ idbRead = pmIDBReadEntry, storage = globalThis.localStorage } = {}) {
    let idb = null;
    try { idb = await idbRead(USER_GENERATION_STORE_KEY); } catch (error) { idb = { ok: false, error }; }
    if (idb?.ok && idb.value !== undefined && isStoreShape(idb.value)) {
        try {
            return { store: normalizeUserGenerationStore(idb.value), recovered: false, writable: true, writeHandle: createWritableHandle(), readOnlyReason: '', warning: null };
        } catch (error) {}
    }
    let fallback = { store: null, valid: false, present: false };
    try { fallback = parse(storage?.getItem(USER_GENERATION_FALLBACK_KEY)); } catch (error) {}
    if (fallback.valid) {
        const primaryBroken = idb?.ok === true && idb.value !== undefined;
        return {
            store: fallback.store, recovered: true, writable: !primaryBroken,
            writeHandle: primaryBroken ? null : createWritableHandle(),
            readOnlyReason: primaryBroken ? '主存储数据损坏或版本不兼容' : '',
            warning: primaryBroken ? 'User 库主存储无法识别，已从本地后备数据恢复；当前为只读保护状态，原始数据未覆盖。' : '已从本地后备数据恢复；主存储不可用，后续保存将写入本地后备存储。',
        };
    }
    if (idb?.ok && idb.value === undefined && !fallback.present) {
        return { store: createEmptyUserGenerationStore(), recovered: false, writable: true, writeHandle: createWritableHandle(), readOnlyReason: '', warning: null };
    }
    if (idb?.ok && idb.value !== undefined) {
        return { store: createEmptyUserGenerationStore(), recovered: true, writable: false, writeHandle: null, readOnlyReason: '历史数据损坏或版本不兼容', warning: 'User 库数据损坏或版本不兼容，原始数据未覆盖，已使用只读空工作区。' };
    }
    if (fallback.present) {
        return { store: createEmptyUserGenerationStore(), recovered: false, writable: false, writeHandle: null, readOnlyReason: '后备数据损坏', warning: 'User 库后备数据损坏，原始数据未覆盖，本次会话不会持久化。' };
    }
    return {
        store: createEmptyUserGenerationStore(), recovered: false, writable: Boolean(storage),
        writeHandle: storage ? createWritableHandle() : null, readOnlyReason: storage ? '' : '存储不可用',
        warning: storage ? 'IndexedDB 不可用，后续保存将写入本地后备存储。' : 'User 库存储不可用，本次会话不会持久化。',
    };
}

export async function saveUserGenerationStore(store, { idbSet = pmIDBSet, storage = globalThis.localStorage, readOnlyReason = '', writeHandle = null, shouldWrite = null } = {}) {
    if (readOnlyReason) throw new Error(`User 库当前为只读保护状态：${readOnlyReason}`);
    if (!writableHandles.has(writeHandle)) throw new Error('User 库写入句柄无效或已失效');
    const operation = async () => {
        if (typeof shouldWrite === 'function' && !shouldWrite()) return false;
        const normalized = normalizeUserGenerationStore(store);
        let idbSaved = false;
        try { idbSaved = await idbSet(USER_GENERATION_STORE_KEY, normalized); } catch (error) {}
        if (idbSaved) {
            try { storage?.removeItem(USER_GENERATION_FALLBACK_KEY); } catch (error) {}
            return true;
        }
        try {
            if (typeof storage?.setItem !== 'function') throw new Error('localStorage unavailable');
            storage.setItem(USER_GENERATION_FALLBACK_KEY, JSON.stringify(normalized));
            return true;
        } catch (error) {
            throw new Error('User 库保存失败：IndexedDB 与本地后备存储均不可用');
        }
    };
    const result = saveQueue.then(operation, operation);
    saveQueue = result.catch(() => undefined);
    return result;
}
