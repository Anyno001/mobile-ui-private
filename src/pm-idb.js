import { PM_IDB_NAME, PM_IDB_STORE } from './constants.js';

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
