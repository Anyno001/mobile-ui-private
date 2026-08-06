import { enqueueDirectorySave } from './directory-save-coordinator.js';
import { pmIDBGet, pmIDBKeys, pmIDBSet } from './storage-primitives.js';

const HISTORY_KEY = 'ST_SMS_DATA_V2';

export function saveHistories() {
    saveHistoriesStrict().catch(error => console.warn('[phone-mode] 短信历史保存失败', error));
}

export async function saveHistoriesStrict(data = window.__pmHistories, { requireLocalMirror = false, coordinated = false } = {}) {
    const persist = async (snapshot, protectedScopes = []) => {
        let value = snapshot;
        if (protectedScopes.length) {
            const current = await pmIDBGet(HISTORY_KEY);
            if (current && typeof current === 'object' && !Array.isArray(current)) {
                value = structuredClone(snapshot);
                for (const scope of protectedScopes) {
                    if (Object.hasOwn(current, scope)) value[scope] = structuredClone(current[scope]);
                    else delete value[scope];
                }
            }
        }
        if (!await pmIDBSet(HISTORY_KEY, value)) throw new Error('聊天记录保存失败：IndexedDB 不可用');
        try { localStorage.setItem(HISTORY_KEY, JSON.stringify(value)); }
        catch (error) {
            if (requireLocalMirror) throw new Error('聊天记录保存失败：浏览器存储不可用');
            console.warn('[phone-mode] localStorage 已满，短信历史仅保存在 IDB');
        }
        return true;
    };
    if (coordinated) return persist(structuredClone(data));
    return enqueueDirectorySave('histories', data, (snapshot, protectedScopes) => persist(snapshot, protectedScopes), arguments.length === 0);
}

export function saveHistoriesBeforeUnload() {
    const data = window.__pmHistories;
    if (!data || !Object.keys(data).length) return;
    try { localStorage.setItem(HISTORY_KEY, JSON.stringify(data)); }
    catch (error) {
        try {
            const slim = {};
            for (const [storyId, contacts] of Object.entries(data)) {
                slim[storyId] = {};
                for (const [persona, history] of Object.entries(contacts)) slim[storyId][persona] = Array.isArray(history) ? history.slice(-10) : history;
            }
            localStorage.setItem(HISTORY_KEY, JSON.stringify(slim));
        } catch (backupError) { console.warn('[phone-mode] beforeunload: localStorage 完全无法写入'); }
    }
    pmIDBSet(HISTORY_KEY, data).catch(() => {});
}

export async function loadHistoriesFromIDB({ requireConfirmedPrimary = false } = {}) {
    try {
        const keys = await pmIDBKeys();
        if (!Array.isArray(keys)) throw new Error('无法枚举 IndexedDB');
        if (!keys.includes(HISTORY_KEY)) {
            const rawFallback = localStorage.getItem(HISTORY_KEY);
            if (!rawFallback) { window.__pmHistories = {}; return true; }
            const fallback = JSON.parse(rawFallback);
            if (!fallback || typeof fallback !== 'object' || Array.isArray(fallback)) throw new Error('localStorage 后备记录格式无效');
            window.__pmHistories = fallback;
            return true;
        }
        const value = await pmIDBGet(HISTORY_KEY);
        if (value === null || value === undefined) {
            if (requireConfirmedPrimary) throw new Error('IndexedDB 主记录读取失败');
            try {
                const fallback = JSON.parse(localStorage.getItem(HISTORY_KEY));
                if (fallback && typeof fallback === 'object' && Object.keys(fallback).length > 0) window.__pmHistories = fallback;
            } catch (error) {}
            return true;
        }
        const parsed = typeof value === 'string' ? JSON.parse(value) : value;
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('IndexedDB 主记录格式无效');
        window.__pmHistories = parsed;
        try { localStorage.setItem(HISTORY_KEY, JSON.stringify(parsed)); }
        catch (error) { console.warn('[phone-mode] localStorage 已满，仅使用 IDB 存储'); }
        console.log('[phone-mode] 从 IndexedDB 加载了短信历史，共', Object.keys(parsed).length, '个会话');
        return true;
    } catch (error) {
        console.warn('[phone-mode] IDB 恢复失败，尝试 localStorage 兜底', error);
        try {
            const fallback = JSON.parse(localStorage.getItem(HISTORY_KEY));
            if (fallback && typeof fallback === 'object' && Object.keys(fallback).length > 0) window.__pmHistories = fallback;
        } catch (fallbackError) {}
        return false;
    }
}
