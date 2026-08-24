import { enqueueDirectorySave } from './directory-save-coordinator.js';
import { pmIDBGet, pmIDBKeys, pmIDBSet } from './storage-primitives.js';

const HISTORY_KEY = 'ST_SMS_DATA_V2';
export const HISTORY_RECOVERY_KEY = 'ST_SMS_DATA_V2_RECOVERY_V1';
const HISTORY_RECOVERY_VERSION = 1;
let nextRecoveryToken = 0;
let historyLocalSnapshotRevision = 0;

function isHistoryStore(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

function parseHistoryStore(value, label) {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    if (!isHistoryStore(parsed)) throw new Error(`${label}格式无效`);
    return parsed;
}

function fingerprintText(value) {
    let hash = 2166136261;
    for (let index = 0; index < value.length; index += 1) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    return `${value.length}:${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

function serializeSlimHistoryStore(data) {
    const slim = {};
    for (const [storyId, contacts] of Object.entries(data)) {
        slim[storyId] = {};
        for (const [persona, history] of Object.entries(contacts)) {
            slim[storyId][persona] = Array.isArray(history) ? history.slice(-10) : history;
        }
    }
    return JSON.stringify(slim);
}

function createRecoveryToken() {
    nextRecoveryToken += 1;
    const random = Math.random().toString(36).slice(2, 10);
    return `${Date.now().toString(36)}-${nextRecoveryToken.toString(36)}-${random}`;
}

function parseRecoveryMarker(raw) {
    if (!raw) return null;
    try {
        const marker = JSON.parse(raw);
        if (!marker || typeof marker !== 'object' || Array.isArray(marker)
            || marker.version !== HISTORY_RECOVERY_VERSION
            || typeof marker.token !== 'string' || !marker.token
            || typeof marker.fingerprint !== 'string' || !/^\d+:[0-9a-f]{8}$/.test(marker.fingerprint)) return null;
        return marker;
    } catch (error) {
        return null;
    }
}

function readRecoveryMarkerRaw() {
    try { return localStorage.getItem(HISTORY_RECOVERY_KEY); }
    catch (error) { return null; }
}

function clearRecoveryMarkerIfCurrent(token, fingerprint) {
    try {
        const marker = parseRecoveryMarker(localStorage.getItem(HISTORY_RECOVERY_KEY));
        const localSnapshot = localStorage.getItem(HISTORY_KEY);
        if (marker?.token === token && marker.fingerprint === fingerprint
            && typeof localSnapshot === 'string' && fingerprintText(localSnapshot) === fingerprint) {
            localStorage.removeItem(HISTORY_RECOVERY_KEY);
            return true;
        }
    } catch (error) {}
    return false;
}

function readRecoverySnapshot() {
    let markerRaw = null;
    let snapshotRaw = null;
    try {
        markerRaw = localStorage.getItem(HISTORY_RECOVERY_KEY);
        if (!markerRaw) return { status: 'none' };
        const marker = parseRecoveryMarker(markerRaw);
        if (!marker) return { status: 'invalid' };
        snapshotRaw = localStorage.getItem(HISTORY_KEY);
        if (typeof snapshotRaw !== 'string' || fingerprintText(snapshotRaw) !== marker.fingerprint) {
            return { status: 'invalid' };
        }
        return {
            status: 'valid', marker,
            value: parseHistoryStore(snapshotRaw, 'localStorage 恢复记录'),
        };
    } catch (error) {
        return { status: 'invalid' };
    }
}

async function preserveProtectedScopes(snapshot, protectedScopes) {
    const value = structuredClone(snapshot);
    if (!protectedScopes.length) return value;
    const current = await pmIDBGet(HISTORY_KEY);
    if (!isHistoryStore(current)) return value;
    for (const scope of protectedScopes) {
        if (Object.hasOwn(current, scope)) value[scope] = structuredClone(current[scope]);
        else delete value[scope];
    }
    return value;
}

async function resolveHistoriesSnapshot({ requireConfirmedPrimary = false } = {}) {
    const recovery = readRecoverySnapshot();
    if (recovery.status === 'valid') {
        const repaired = await pmIDBSet(HISTORY_KEY, recovery.value);
        if (repaired) clearRecoveryMarkerIfCurrent(recovery.marker.token, recovery.marker.fingerprint);
        else console.warn('[phone-mode] 短信历史恢复快照已加载，但 IndexedDB 修复失败');
        return { value: recovery.value, source: 'recovery', mirrorPrimary: false };
    }
    if (recovery.status === 'invalid') {
        console.warn('[phone-mode] 短信历史恢复标记无效，保留本地数据并回退主存储');
    }

    const keys = await pmIDBKeys();
    if (!Array.isArray(keys)) throw new Error('无法枚举 IndexedDB');
    if (!keys.includes(HISTORY_KEY)) {
        const rawFallback = localStorage.getItem(HISTORY_KEY);
        if (!rawFallback) return { value: {}, source: 'empty', mirrorPrimary: false };
        return {
            value: parseHistoryStore(rawFallback, 'localStorage 后备记录'),
            source: 'fallback', mirrorPrimary: false,
        };
    }

    const value = await pmIDBGet(HISTORY_KEY);
    if (value === null || value === undefined) {
        if (requireConfirmedPrimary) throw new Error('IndexedDB 主记录读取失败');
        const rawFallback = localStorage.getItem(HISTORY_KEY);
        if (!rawFallback) return { value: {}, source: 'empty', mirrorPrimary: false };
        return {
            value: parseHistoryStore(rawFallback, 'localStorage 后备记录'),
            source: 'fallback', mirrorPrimary: false,
        };
    }
    return {
        value: parseHistoryStore(value, 'IndexedDB 主记录'),
        source: 'idb', mirrorPrimary: recovery.status === 'none',
    };
}

export async function readHistoriesSnapshot(options = {}) {
    return (await resolveHistoriesSnapshot(options)).value;
}

export function saveHistories() {
    saveHistoriesStrict().catch(error => console.warn('[phone-mode] 短信历史保存失败', error));
}

export async function saveHistoriesStrict(data = window.__pmHistories, { requireLocalMirror = false, coordinated = false } = {}) {
    const recoveryMarkerAtInvocation = readRecoveryMarkerRaw();
    const localSnapshotRevisionAtInvocation = historyLocalSnapshotRevision;
    const persist = async (snapshot, protectedScopes = []) => {
        const value = await preserveProtectedScopes(snapshot, protectedScopes);
        if (!await pmIDBSet(HISTORY_KEY, value)) throw new Error('聊天记录保存失败：IndexedDB 不可用');
        const currentRecoveryMarker = readRecoveryMarkerRaw();
        if (currentRecoveryMarker !== recoveryMarkerAtInvocation
            || historyLocalSnapshotRevision !== localSnapshotRevisionAtInvocation) return true;
        try {
            localStorage.setItem(HISTORY_KEY, JSON.stringify(value));
            if (currentRecoveryMarker) {
                try {
                    if (localStorage.getItem(HISTORY_RECOVERY_KEY) === currentRecoveryMarker) {
                        localStorage.removeItem(HISTORY_RECOVERY_KEY);
                    }
                } catch (error) {}
            }
        }
        catch (error) {
            if (requireLocalMirror) throw new Error('聊天记录保存失败：浏览器存储不可用');
            console.warn('[phone-mode] localStorage 已满，短信历史仅保存在 IDB');
        }
        return true;
    };
    if (coordinated) return persist(data);
    return enqueueDirectorySave('histories', data, (snapshot, protectedScopes) => persist(snapshot, protectedScopes), arguments.length === 0);
}

export function saveHistoriesBeforeUnload() {
    const data = window.__pmHistories;
    if (!data || !Object.keys(data).length) return;
    let localSnapshot = JSON.stringify(data);
    try { localStorage.setItem(HISTORY_KEY, localSnapshot); }
    catch (error) {
        try {
            localSnapshot = serializeSlimHistoryStore(data);
            localStorage.setItem(HISTORY_KEY, localSnapshot);
        } catch (backupError) {
            console.warn('[phone-mode] beforeunload: localStorage 完全无法写入');
            localSnapshot = '';
        }
    }
    if (!localSnapshot) return;

    let marker = {
        version: HISTORY_RECOVERY_VERSION,
        token: createRecoveryToken(),
        fingerprint: fingerprintText(localSnapshot),
    };
    let markerWritten = false;
    try {
        localStorage.setItem(HISTORY_RECOVERY_KEY, JSON.stringify(marker));
        markerWritten = true;
    } catch (error) {
        // 完整快照可能刚好占满配额；缩减到既有的最近十条策略后再为恢复标记腾出空间。
        try {
            const slimSnapshot = serializeSlimHistoryStore(data);
            if (slimSnapshot !== localSnapshot) {
                localStorage.setItem(HISTORY_KEY, slimSnapshot);
                localSnapshot = slimSnapshot;
                marker = { ...marker, fingerprint: fingerprintText(localSnapshot) };
                localStorage.setItem(HISTORY_RECOVERY_KEY, JSON.stringify(marker));
                markerWritten = true;
            }
        } catch (backupError) {}
    }
    historyLocalSnapshotRevision += 1;
    if (!markerWritten) console.warn('[phone-mode] beforeunload: 短信历史恢复标记无法写入');

    enqueueDirectorySave('histories', data, async (snapshot, protectedScopes) => {
        const value = await preserveProtectedScopes(snapshot, protectedScopes);
        if (!await pmIDBSet(HISTORY_KEY, value)) throw new Error('聊天记录卸载保存失败：IndexedDB 不可用');
        clearRecoveryMarkerIfCurrent(marker.token, marker.fingerprint);
        return true;
    }).catch(() => {});
}

export async function loadHistoriesFromIDB({ requireConfirmedPrimary = false } = {}) {
    try {
        const resolved = await resolveHistoriesSnapshot({ requireConfirmedPrimary });
        window.__pmHistories = resolved.value;
        if (resolved.mirrorPrimary) {
            try { localStorage.setItem(HISTORY_KEY, JSON.stringify(resolved.value)); }
            catch (error) { console.warn('[phone-mode] localStorage 已满，仅使用 IDB 存储'); }
        }
        if (resolved.source === 'idb') {
            console.log('[phone-mode] 从 IndexedDB 加载了短信历史，共', Object.keys(resolved.value).length, '个会话');
        }
        return true;
    } catch (error) {
        console.warn('[phone-mode] IDB 恢复失败，尝试 localStorage 兜底', error);
        try {
            const fallback = parseHistoryStore(localStorage.getItem(HISTORY_KEY), 'localStorage 后备记录');
            if (Object.keys(fallback).length > 0) window.__pmHistories = fallback;
        } catch (fallbackError) {}
        return false;
    }
}
