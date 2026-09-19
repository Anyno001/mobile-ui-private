import { PM_IDB_NAME, PM_IDB_STORE } from './constants.js';

let database = null;
let openingPromise = null;

export function pmOpenIDB() {
    if (database) {
        try {
            database.transaction(PM_IDB_STORE, 'readonly');
            return Promise.resolve(database);
        } catch (error) {
            database = null;
        }
    }
    if (openingPromise) return openingPromise;
    const pending = new Promise(resolve => {
        try {
            const request = indexedDB.open(PM_IDB_NAME, 1);
            request.onupgradeneeded = () => {
                const db = request.result;
                if (!db.objectStoreNames.contains(PM_IDB_STORE)) db.createObjectStore(PM_IDB_STORE);
            };
            request.onsuccess = () => {
                const opened = request.result;
                opened.onversionchange = () => {
                    opened.close();
                    if (database === opened) database = null;
                };
                database = opened;
                resolve(opened);
            };
            request.onerror = () => resolve(null);
        } catch (error) {
            resolve(null);
        }
    });
    openingPromise = pending;
    pending.finally(() => { if (openingPromise === pending) openingPromise = null; });
    return pending;
}

function structurallyEqual(left, right) {
    if (Object.is(left, right)) return true;
    if (Array.isArray(left) || Array.isArray(right)) {
        return Array.isArray(left) && Array.isArray(right) && left.length === right.length
            && left.every((value, index) => structurallyEqual(value, right[index]));
    }
    if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false;
    const leftKeys = Object.keys(left).sort();
    const rightKeys = Object.keys(right).sort();
    return leftKeys.length === rightKeys.length && leftKeys.every((key, index) => key === rightKeys[index]
        && structurallyEqual(left[key], right[key]));
}

export async function pmIDBCompareAndSwap({ guardKey, expectedGuard, writes, openIDB = pmOpenIDB } = {}) {
    if (typeof guardKey !== 'string' || !guardKey) throw new TypeError('IDB CAS guard key 必须是非空字符串');
    if (!Array.isArray(writes) || !writes.length) throw new TypeError('IDB CAS writes 必须是非空数组');
    for (const entry of writes) {
        const hasValue = entry && Object.hasOwn(entry, 'value');
        const deletes = entry?.delete === true;
        if (!entry || typeof entry.key !== 'string' || !entry.key || hasValue === deletes) {
            throw new TypeError('IDB CAS write 必须包含非空 key，并且恰好指定 value 或 delete=true');
        }
    }
    if (typeof openIDB !== 'function') throw new TypeError('IDB CAS openIDB 必须是函数');
    const db = await openIDB();
    if (!db) return { ok: false, reason: 'IDB_UNAVAILABLE' };
    return new Promise(resolve => {
        let settled = false;
        let conflict = false;
        const finish = result => {
            if (settled) return;
            settled = true;
            resolve(result);
        };
        try {
            const transaction = db.transaction(PM_IDB_STORE, 'readwrite');
            const store = transaction.objectStore(PM_IDB_STORE);
            const request = store.get(guardKey);
            request.onsuccess = () => {
                if (!structurallyEqual(request.result, expectedGuard)) {
                    conflict = true;
                    transaction.abort();
                    return;
                }
                for (const entry of writes) {
                    if (entry.delete === true) store.delete(entry.key);
                    else store.put(entry.value, entry.key);
                }
            };
            request.onerror = () => {
                try { transaction.abort(); } catch {
                    // 事务可能已因请求失败自动终止；最终结果由事务事件统一收敛。
                }
            };
            transaction.oncomplete = () => finish({ ok: true });
            transaction.onabort = () => finish({ ok: false, reason: conflict ? 'CAS_CONFLICT' : 'IDB_ERROR' });
            transaction.onerror = () => finish({ ok: false, reason: 'IDB_ERROR' });
        } catch (error) {
            finish({ ok: false, reason: 'IDB_ERROR' });
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

export async function pmIDBReadEntry(key) {
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
