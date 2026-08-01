import { TODAY_TREND_FALLBACK_KEY, TODAY_TREND_STORAGE_KEY } from './constants.js';
import { createEmptyTodayTrendStore, migrateTodayTrendStore, normalizeTodayTrendStore } from './today-trend-model.js';
import { pmIDBGet, pmIDBSet } from './pm-idb.js';

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

export function createTodayTrendStorage({ idbGet = pmIDBGet, idbSet = pmIDBSet, storage = globalThis.localStorage } = {}) {
    const load = async () => {
        try {
            const primary = await idbGet(TODAY_TREND_STORAGE_KEY);
            if (primary !== null && primary !== undefined) return normalizeLoaded(primary);
        } catch (error) {
            console.warn('[phone-mode] 今日风向主存储读取失败', error);
        }
        const fallback = readFallback(storage);
        if (fallback !== null) {
            try { return normalizeLoaded(fallback); }
            catch (error) { console.warn('[phone-mode] 今日风向后备数据无效', error); }
        }
        return createEmptyTodayTrendStore();
    };

    const save = async value => {
        const normalized = normalizeTodayTrendStore(value);
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

    return { load, save };
}

const defaultStorage = createTodayTrendStorage();
export const loadTodayTrendStore = () => defaultStorage.load();
export const saveTodayTrendStore = value => defaultStorage.save(value);
