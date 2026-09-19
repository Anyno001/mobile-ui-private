import { TODAY_TREND_FALLBACK_KEY, TODAY_TREND_STORAGE_KEY } from './constants.js';
import { createEmptyTodayTrendStore, migrateTodayTrendStore, normalizeTodayTrendStore } from './today-trend-model.js';
import { pmIDBGet, pmIDBSet } from './pm-idb.js';
import { todayTrendJournal } from './today-trend-journal.js';
import { createTodayTrendV2Authority } from './today-trend-v2-authority.js';
import { buildReadOnlyShadow, normalizeTodayTrendV2Candidate } from './today-trend-v2-model.js';

export const TODAY_TREND_STORAGE_KEYS = Object.freeze({ primary: TODAY_TREND_STORAGE_KEY, fallback: TODAY_TREND_FALLBACK_KEY });

const clone = value => structuredClone(value);

function readFallback(storage) {
    try {
        const raw = storage?.getItem(TODAY_TREND_FALLBACK_KEY);
        return raw ? JSON.parse(raw) : null;
    } catch (error) {
        console.warn('[phone-mode] 今日风向后备数据读取失败', error);
        return null;
    }
}

function normalizeLoaded(value) {
    return migrateTodayTrendStore(value).store;
}

export function createTodayTrendStorage({
    idbGet = pmIDBGet, idbSet = pmIDBSet, storage = globalThis.localStorage,
    v2Authority = createTodayTrendV2Authority({ storage }), journal = null,
} = {}) {
    const readV1Source = async () => {
        try {
            const primary = await idbGet(TODAY_TREND_STORAGE_KEY);
            if (primary !== null && primary !== undefined) return { store: normalizeLoaded(primary), sourceMedium: 'idb' };
        } catch (error) {
            console.warn('[phone-mode] 今日风向主存储读取失败', error);
        }
        const fallback = readFallback(storage);
        if (fallback !== null) {
            try { return { store: normalizeLoaded(fallback), sourceMedium: 'localStorage' }; }
            catch (error) { console.warn('[phone-mode] 今日风向后备数据无效', error); }
        }
        return { store: createEmptyTodayTrendStore(), sourceMedium: 'idb' };
    };
    const load = async () => {
        const v2 = await v2Authority.load();
        if (v2.active) {
            const migrationBackup = typeof v2Authority.readMigrationBackup === 'function'
                ? await v2Authority.readMigrationBackup() : null;
            if (v2.authority?.serveV2 || v2.authority?.writeV2 || migrationBackup === null) {
                return normalizeTodayTrendStore(v2.store);
            }
        }
        const source = await readV1Source();
        if (v2.active) {
            if (JSON.stringify(normalizeTodayTrendStore(v2.store)) !== JSON.stringify(source.store)) {
                const error = new Error('v2 只读影子与 v1 服务数据不一致');
                error.code = 'TT_SHADOW_MISMATCH';
                throw error;
            }
            return source.store;
        }
        return source.store;
    };
    const loadCanonical = async () => {
        const v2 = await v2Authority.load();
        if (v2.active) return v2.v2Store;
        const source = await readV1Source();
        return normalizeTodayTrendV2Candidate(source.store);
    };
    const migrateToV2 = async () => {
        if (typeof v2Authority.migrate !== 'function') throw new TypeError('v2 authority 不支持迁移');
        const source = await readV1Source();
        return v2Authority.migrate(source.store, { sourceMedium: source.sourceMedium });
    };

    const save = async (value, options = {}) => {
        if (journal) { await journal.ready(); journal.assertWritable(options.transactionId ?? null); }
        const v2Candidate = value?.version === 2 && Object.hasOwn(value, 'globalEnvelope');
        const normalizedV2 = v2Candidate ? normalizeTodayTrendV2Candidate(value) : null;
        const normalized = v2Candidate ? buildReadOnlyShadow(normalizedV2) : normalizeTodayTrendStore(value);
        const v2 = await v2Authority.status();
        if (!v2.available) {
            const error = new Error('无法确认 v2 authority 状态，拒绝降级写入 v1');
            error.code = 'TT_V2_AUTHORITY_UNAVAILABLE';
            throw error;
        }
        let acquiredForOperation = false;
        const previousFlags = v2.authority ? { readV2: v2.authority.readV2, serveV2: v2.authority.serveV2 } : null;
        if (options.allowAuthorityAcquire && !v2.owned) {
            if (v2.authority?.ownerTabId) {
                const error = new Error('其他标签当前持有 v2 写入权威');
                error.code = 'TT_AUTHORITY_BUSY';
                throw error;
            }
            await v2Authority.acquire({
                readV2: true, writeV2: true, serveV2: v2.authority?.serveV2 === true,
                initialStore: !v2.authority || v2.authority.storeRevision === 0 ? normalized : undefined,
            });
            acquiredForOperation = true;
        }
        if (v2.authority?.writeV2 || acquiredForOperation) {
            let result;
            let operationError = null;
            try {
                result = await v2Authority.save(normalizedV2 || normalized, options);
            } catch (error) {
                operationError = error;
            }
            let releaseError = null;
            if (acquiredForOperation) {
                try {
                    const released = await v2Authority.release(previousFlags || undefined);
                    if (released !== true) {
                        const error = new Error('临时 authority 未确认释放成功');
                        error.code = 'TT_AUTHORITY_RELEASE_FAILED';
                        releaseError = error;
                    }
                }
                catch (error) { releaseError = error; }
            }
            if (operationError) {
                if (releaseError) operationError.releaseError = releaseError;
                throw operationError;
            }
            if (releaseError) {
                const error = new Error(`今日风向保存成功，但临时 authority 释放失败：${releaseError.message}`, { cause: releaseError });
                error.code = 'TT_AUTHORITY_RELEASE_FAILED';
                error.committedReceipt = result;
                throw error;
            }
            return options.returnReceipt ? result : result.store;
        }
        if (v2Candidate) {
            const error = new Error('v2 canonical candidate 禁止降级写入 v1 或 localStorage');
            error.code = 'TT_V2_CANONICAL_REQUIRES_AUTHORITY';
            throw error;
        }
        if (v2.authority && (v2.authority.readV2 || v2.authority.storeRevision > 0)) {
            const error = new Error('v2 authority 已冻结 v1 写入');
            error.code = v2.authority.ownerTabId ? 'TT_AUTHORITY_LOST' : 'TT_V1_WRITE_FROZEN';
            throw error;
        }
        if (options.transactionId || options.journalWrite) {
            const error = new Error('Today Trend 可恢复事务要求 v2 authority 写入，禁止降级到 v1 或 localStorage');
            error.code = 'TT_SAGA_REQUIRES_V2';
            throw error;
        }
        const snapshot = clone(normalized);
        if (await idbSet(TODAY_TREND_STORAGE_KEY, snapshot)) {
            try { storage?.removeItem(TODAY_TREND_FALLBACK_KEY); }
            catch (error) { console.warn('[phone-mode] 今日风向后备数据清理失败', error); }
            return snapshot;
        }
        try {
            if (!storage || typeof storage.setItem !== 'function') throw new Error('localStorage 不可用');
            storage.setItem(TODAY_TREND_FALLBACK_KEY, JSON.stringify(snapshot));
            return snapshot;
        } catch (error) {
            throw new Error('今日风向保存失败：浏览器存储不可用', { cause: error });
        }
    };

    const status = () => v2Authority.status();
    const readMigrationBackup = () => v2Authority.readMigrationBackup?.() ?? null;
    const captureV2Backup = async () => {
        const state = await v2Authority.status();
        if (!state.available) throw Object.assign(new Error('无法确认 v2 authority 状态'), { code: 'TT_V2_AUTHORITY_UNAVAILABLE' });
        if (!state.authority?.readV2 || state.authority.storeRevision === 0) return null;
        const loaded = await v2Authority.load();
        return { v2Store: loaded.v2Store, migrationBackup: await readMigrationBackup(), storeRevision: state.authority.storeRevision };
    };
    const restoreV2Backup = (value, options) => {
        if (typeof v2Authority.restoreBackup !== 'function') throw new TypeError('v2 authority 不支持备份恢复');
        return v2Authority.restoreBackup(value, options);
    };
    return { load, loadCanonical, save, status, migrateToV2, readMigrationBackup, captureV2Backup, restoreV2Backup, v2Authority, journal };
}

const defaultStorage = createTodayTrendStorage({ journal: todayTrendJournal });
export const loadTodayTrendStore = () => defaultStorage.load();
export const loadTodayTrendV2Store = () => defaultStorage.loadCanonical();
export const saveTodayTrendStore = (value, options) => defaultStorage.save(value, options);
export const getTodayTrendStorageStatus = () => defaultStorage.status();
export const migrateTodayTrendStorageToV2 = () => defaultStorage.migrateToV2();
export const loadTodayTrendMigrationBackup = () => defaultStorage.readMigrationBackup();
export const captureTodayTrendV2Backup = () => defaultStorage.captureV2Backup();
export const restoreTodayTrendV2Backup = (value, options) => defaultStorage.restoreV2Backup(value, options);
export const todayTrendV2Authority = defaultStorage.v2Authority;
export { todayTrendJournal };
