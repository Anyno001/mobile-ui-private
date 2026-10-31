import { pmIDBReadEntry, pmIDBSet } from './storage-primitives.js';
import { createEmptyShopStore, normalizeShopStore, SHOP_STORE_VERSION } from './shop-model.js';

// 桃宝单独一个存储键：主存 IndexedDB（PhoneModeDB/kv），IndexedDB 不可用时写 localStorage 后备。
export const SHOP_STORE_KEY = 'ST_SMS_SHOP_V1';
export const SHOP_FALLBACK_KEY = `${SHOP_STORE_KEY}_LOCAL_FALLBACK`;

const isStoreShape = value => !!value && typeof value === 'object' && !Array.isArray(value)
    && value.version === SHOP_STORE_VERSION && !!value.scopes && typeof value.scopes === 'object' && !Array.isArray(value.scopes);

function readFallback(storage) {
    let raw = null;
    try { raw = storage?.getItem(SHOP_FALLBACK_KEY) ?? null; } catch (error) { return { present: false, store: null }; }
    if (typeof raw !== 'string' || !raw.trim()) return { present: false, store: null };
    try {
        const parsed = JSON.parse(raw);
        return { present: true, store: isStoreShape(parsed) ? normalizeShopStore(parsed) : null };
    } catch (error) {
        return { present: true, store: null };
    }
}

// 读不懂的数据不覆盖：返回空的只读 store，并给出提示。
export async function loadShopStore({ idbRead = pmIDBReadEntry, storage = globalThis.localStorage } = {}) {
    const idb = await idbRead(SHOP_STORE_KEY).catch(() => ({ ok: false, value: undefined }));
    if (idb?.ok && idb.value !== undefined) {
        if (isStoreShape(idb.value)) return { store: normalizeShopStore(idb.value), writable: true, warning: '' };
        return { store: createEmptyShopStore(), writable: false, warning: '桃宝数据无法识别，原始数据未覆盖，本次改动不会保存。' };
    }
    const fallback = readFallback(storage);
    if (fallback.store) return { store: fallback.store, writable: true, warning: '' };
    if (fallback.present) return { store: createEmptyShopStore(), writable: false, warning: '桃宝本地后备数据损坏，原始数据未覆盖，本次改动不会保存。' };
    return { store: createEmptyShopStore(), writable: true, warning: '' };
}

let saveQueue = Promise.resolve();

// 串行写入；IndexedDB 写成功后删掉本地后备，失败时写后备，两处都失败才报错。
export function saveShopStore(store, { idbSet = pmIDBSet, storage = globalThis.localStorage } = {}) {
    const operation = async () => {
        const normalized = normalizeShopStore(store);
        let saved = false;
        try { saved = await idbSet(SHOP_STORE_KEY, normalized); } catch (error) { saved = false; }
        if (saved) {
            try { storage?.removeItem(SHOP_FALLBACK_KEY); } catch (error) {}
            return true;
        }
        try {
            storage.setItem(SHOP_FALLBACK_KEY, JSON.stringify(normalized));
            return true;
        } catch (error) {
            throw new Error('桃宝数据保存失败：IndexedDB与本地后备存储均不可用');
        }
    };
    const result = saveQueue.then(operation, operation);
    saveQueue = result.catch(() => undefined);
    return result;
}
