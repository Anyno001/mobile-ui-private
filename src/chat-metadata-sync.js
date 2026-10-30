/**
 * 手机聊天记录随酒馆聊天文件保存：chatMetadata.tianyin_phone 是 IndexedDB 之外的第二份副本。
 *
 * - 写：IndexedDB 写成功后，把当前聊天的那一份同步进 chatMetadata，用酒馆的 saveMetadataDebounced 落盘；
 *   页面挂起时立即 saveMetadata。本模块不自建计时器，防抖计时器归酒馆所有。
 * - 读：打开手机、切换聊天时对账。两边都有且不同，比较 updatedAt，新的为准，整份替换不逐条合并。
 * - 本地 updatedAt 记在 localStorage（CHAT_METADATA_STAMP_KEY），按 storageId 记录本地最后一次改动的时间。
 */
import {
    applyFloorRollback as computeFloorRollback, createRollbackRecord, normalizeRollbackList, pruneRollbackList,
} from './phone-floor-rollback.js';

export const CHAT_METADATA_KEY = 'tianyin_phone';
export const CHAT_METADATA_VERSION = 1;
export const CHAT_METADATA_CONTACT_LIMIT = 2000;
export const CHAT_METADATA_STAMP_KEY = 'ST_SMS_CHAT_METADATA_STAMPS_V1';
const STAMP_LIMIT = 500;

const plainRecord = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const validStorageId = id => typeof id === 'string' && Boolean(id) && id !== 'sms_unknown__default';

export function buildChatMetadataPayload({
    storageId, histories, groupMeta, rollback = [], updatedAt, limit = CHAT_METADATA_CONTACT_LIMIT,
}) {
    const scoped = {};
    for (const [key, history] of Object.entries(plainRecord(histories) ? histories : {})) {
        if (Array.isArray(history)) scoped[key] = history.length > limit ? history.slice(-limit) : history;
    }
    return {
        version: CHAT_METADATA_VERSION,
        storageId,
        updatedAt,
        histories: scoped,
        groupMeta: plainRecord(groupMeta) ? groupMeta : {},
        rollback: Array.isArray(rollback) ? rollback : [],
    };
}

/** 校验元数据里的记录；结构不对返回 null，按「元数据为空」处理。 */
export function readChatMetadataPayload(metadata) {
    const raw = plainRecord(metadata) ? metadata[CHAT_METADATA_KEY] : null;
    if (!plainRecord(raw) || raw.version !== CHAT_METADATA_VERSION) return null;
    if (!Number.isFinite(raw.updatedAt) || !plainRecord(raw.histories)) return null;
    const histories = {};
    for (const [key, history] of Object.entries(raw.histories)) {
        if (!key.trim() || !Array.isArray(history)) continue;
        histories[key] = history.filter(plainRecord);
    }
    return {
        version: CHAT_METADATA_VERSION,
        storageId: typeof raw.storageId === 'string' ? raw.storageId : '',
        updatedAt: raw.updatedAt,
        histories,
        groupMeta: plainRecord(raw.groupMeta) ? raw.groupMeta : {},
        rollback: normalizeRollbackList(raw.rollback),
    };
}

// 指纹不含回退旧版本：两边记录相同时，不因旧版本不同而互相覆盖。
export function chatPayloadFingerprint(payload) {
    return JSON.stringify([payload?.histories || {}, payload?.groupMeta || {}]);
}

/**
 * 元数据每个联系人只留最近 limit 条。采用元数据时，被截掉的更早消息若本地还有，接回前面。
 * 只在元数据恰好满 limit 条时接，避免把对方已删的消息复活。
 */
export function mergeTruncatedHistories(local, remote, limit = CHAT_METADATA_CONTACT_LIMIT) {
    const merged = {};
    for (const [key, remoteHistory] of Object.entries(remote)) {
        const localHistory = Array.isArray(local?.[key]) ? local[key] : [];
        const firstId = remoteHistory[0]?.messageId;
        const anchor = remoteHistory.length >= limit && firstId
            ? localHistory.findIndex(entry => entry?.messageId === firstId) : -1;
        merged[key] = anchor > 0 ? [...localHistory.slice(0, anchor), ...remoteHistory] : remoteHistory.slice();
    }
    return merged;
}

/** 对账决定：none 不动 / push 写元数据 / adopt 用元数据覆盖本地。 */
export function decideChatMetadataSync({ remote, hasLocal, localStamp, localFingerprint }) {
    if (!remote) return hasLocal ? 'push' : 'none';
    if (!hasLocal) return 'adopt';
    if (chatPayloadFingerprint(remote) === localFingerprint) return 'same';
    return localStamp > remote.updatedAt ? 'push' : 'adopt';
}

export function createChatMetadataSync({
    getCtx, getStorageId, ensureHistoriesLoaded, awaitBranch,
    saveHistories, saveGroupMeta, loadGroupMeta, getRollbackFloors = () => 30,
    storage = globalThis.localStorage, now = Date.now, limit = CHAT_METADATA_CONTACT_LIMIT,
}) {
    // 对账后的基线：只有同一 storageId 的联系人数组引用、群聊元信息或回退旧版本变了，才算本地改动。
    let baseline = null;
    let metadataSavePending = false;
    // 删楼回退的旧版本只随聊天元数据保存，内存里按 storageId 持有。
    const rollbackByStorage = new Map();
    let rollbackSeq = 0;
    const getRollback = storageId => rollbackByStorage.get(storageId) || [];
    const setRollback = (storageId, list) => {
        rollbackByStorage.set(storageId, list);
        for (const item of list) rollbackSeq = Math.max(rollbackSeq, item.seq);
    };
    const currentChat = () => {
        const chat = getCtx()?.chat;
        return Array.isArray(chat) ? chat : null;
    };

    const readStamps = () => {
        try {
            const parsed = JSON.parse(storage?.getItem(CHAT_METADATA_STAMP_KEY) || '{}');
            return plainRecord(parsed) ? parsed : {};
        } catch (error) { return {}; }
    };
    const localStamp = storageId => {
        const value = readStamps()[storageId];
        return Number.isFinite(value) ? value : 0;
    };
    const writeStamp = (storageIds, value) => {
        const stamps = readStamps();
        for (const id of storageIds) if (validStorageId(id)) stamps[id] = value;
        const entries = Object.entries(stamps).filter(([, stamp]) => Number.isFinite(stamp))
            .sort((a, b) => b[1] - a[1]).slice(0, STAMP_LIMIT);
        try { storage?.setItem(CHAT_METADATA_STAMP_KEY, JSON.stringify(Object.fromEntries(entries))); }
        catch (error) { console.warn('[phone-mode] 聊天元数据时间戳保存失败', error?.name || 'Error'); }
    };

    const currentScope = storageId => ({
        histories: plainRecord(window.__pmHistories?.[storageId]) ? window.__pmHistories[storageId] : {},
        groupMeta: plainRecord(window.__pmGroupMeta?.[storageId]) ? window.__pmGroupMeta[storageId] : {},
    });
    const snapshotBaseline = storageId => {
        const scope = currentScope(storageId);
        return {
            storageId,
            histories: new Map(Object.entries(scope.histories)),
            groupMeta: JSON.stringify(scope.groupMeta),
            rollback: getRollback(storageId),
        };
    };
    const changedSinceBaseline = storageId => {
        if (!baseline || baseline.storageId !== storageId) return false;
        const scope = currentScope(storageId);
        const keys = Object.keys(scope.histories);
        if (keys.length !== baseline.histories.size) return true;
        if (keys.some(key => baseline.histories.get(key) !== scope.histories[key])) return true;
        if (getRollback(storageId) !== baseline.rollback) return true;
        return JSON.stringify(scope.groupMeta) !== baseline.groupMeta;
    };

    /** 把当前聊天的记录写进 chatMetadata；聊天已切走则不写。 */
    const writeMetadata = (storageId, updatedAt, { immediate = false } = {}) => {
        const context = getCtx();
        const metadata = context?.chatMetadata;
        if (!plainRecord(metadata) || getStorageId() !== storageId) return false;
        const scope = currentScope(storageId);
        metadata[CHAT_METADATA_KEY] = buildChatMetadataPayload({
            storageId, ...scope, rollback: getRollback(storageId), updatedAt, limit,
        });
        if (immediate && typeof context.saveMetadata === 'function') {
            metadataSavePending = false;
            Promise.resolve(context.saveMetadata()).catch(error => {
                console.warn('[phone-mode] 聊天元数据保存失败', error?.name || 'Error');
            });
        } else if (typeof context.saveMetadataDebounced === 'function') {
            metadataSavePending = true;
            context.saveMetadataDebounced();
        }
        return true;
    };

    /** 本地存储写成功后调用：当前聊天的记录有变化就记时间并同步元数据。 */
    const noteLocalChange = () => {
        const storageId = getStorageId();
        if (!validStorageId(storageId) || !changedSinceBaseline(storageId)) return false;
        const updatedAt = now();
        writeStamp([storageId], updatedAt);
        baseline = snapshotBaseline(storageId);
        return writeMetadata(storageId, updatedAt);
    };

    /** 关闭手机、页面挂起时立即补写；未同步的改动先按 noteLocalChange 记账。 */
    const flush = () => {
        const storageId = getStorageId();
        if (!validStorageId(storageId)) return false;
        if (changedSinceBaseline(storageId)) {
            const updatedAt = now();
            writeStamp([storageId], updatedAt);
            baseline = snapshotBaseline(storageId);
            return writeMetadata(storageId, updatedAt, { immediate: true });
        }
        if (!metadataSavePending) return false;
        const context = getCtx();
        if (typeof context?.saveMetadata !== 'function') return false;
        metadataSavePending = false;
        Promise.resolve(context.saveMetadata()).catch(error => {
            console.warn('[phone-mode] 聊天元数据保存失败', error?.name || 'Error');
        });
        return true;
    };

    /** 备份导入后这些聊天以本地为准，下次对账写回元数据。 */
    const markLocalAuthoritative = storageIds => writeStamp(storageIds, now());

    /**
     * 编辑、删除、重新生成前记下改动前的旧版本（最近 N 层内）。
     * changes：[{ saveKey, op: 'edit' | 'remove', entry, afterId, index }]，批量删除按从后往前排。
     * 调用方随后照常保存历史，保存后的通知会把旧版本一并写进元数据。
     */
    const recordPhoneChange = changes => {
        const storageId = getStorageId();
        const chat = currentChat();
        const floors = getRollbackFloors();
        if (!validStorageId(storageId) || !chat || !floors || !Array.isArray(changes) || !changes.length) return false;
        const added = changes.filter(change => change?.entry?.messageId && change.saveKey)
            .map(change => createRollbackRecord({ ...change, chat, seq: ++rollbackSeq }));
        if (!added.length) return false;
        setRollback(storageId, pruneRollbackList([...getRollback(storageId), ...added], chat.length, floors));
        noteLocalChange();
        return true;
    };

    /** 调小保留层数后立即按新层数清理。 */
    const pruneRollback = () => {
        const storageId = getStorageId();
        const chat = currentChat();
        if (!validStorageId(storageId) || !chat) return false;
        setRollback(storageId, pruneRollbackList(getRollback(storageId), chat.length, getRollbackFloors()));
        return noteLocalChange();
    };

    /**
     * 按当前主线回退手机记录（删楼、重新生成、分支、离线删楼后）。
     * 返回有变化的联系人；主线为空时不处理，避免切换聊天途中误判为全部删光。
     */
    const applyFloorRollback = async ({ onChanged } = {}) => {
        const storageId = getStorageId();
        const chat = currentChat();
        if (!validStorageId(storageId) || !chat || !chat.length) return [];
        const scope = currentScope(storageId);
        const result = computeFloorRollback({ histories: scope.histories, rollback: getRollback(storageId), chat });
        if (result.rollbackChanged) setRollback(storageId, result.rollback);
        if (result.changedKeys.length) {
            // 同步回调：在保存前作废进行中的手机生成，免得它稍后把回退掉的消息写回来。
            onChanged?.(result.changedKeys);
            window.__pmHistories[storageId] = result.histories;
            await saveHistories();
        } else if (result.rollbackChanged) noteLocalChange();
        return result.changedKeys;
    };

    /** historiesLoaded：调用方刚读过 IndexedDB 时传入结果；读失败不对账，免得用空内存覆盖本地。 */
    const reconcile = async ({ historiesLoaded } = {}) => {
        const storageId = getStorageId();
        baseline = null;
        if (!validStorageId(storageId)) return 'skipped';
        await awaitBranch?.(storageId);
        const loaded = historiesLoaded === undefined ? await ensureHistoriesLoaded() : historiesLoaded;
        if (loaded === false) return 'skipped';
        await loadGroupMeta?.();
        if (getStorageId() !== storageId) return 'skipped';
        const remote = readChatMetadataPayload(getCtx()?.chatMetadata);
        const scope = currentScope(storageId);
        const hasLocal = Object.keys(scope.histories).length > 0 || Object.keys(scope.groupMeta).length > 0;
        const stamp = localStamp(storageId);
        const localPayload = buildChatMetadataPayload({ storageId, ...scope, updatedAt: stamp, limit });
        const action = decideChatMetadataSync({
            remote, hasLocal, localStamp: stamp, localFingerprint: chatPayloadFingerprint(localPayload),
        });
        // 旧版本跟着采用的一方走；本地内存为空（刚刷新）时取元数据里的。
        if (action === 'adopt' || (remote && !rollbackByStorage.has(storageId))) setRollback(storageId, remote.rollback);
        if (action === 'adopt') {
            if (!window.__pmHistories) window.__pmHistories = {};
            window.__pmHistories[storageId] = mergeTruncatedHistories(scope.histories, remote.histories, limit);
            if (!window.__pmGroupMeta) window.__pmGroupMeta = {};
            if (Object.keys(remote.groupMeta).length) window.__pmGroupMeta[storageId] = remote.groupMeta;
            else delete window.__pmGroupMeta[storageId];
            await saveHistories();
            await saveGroupMeta?.();
            writeStamp([storageId], remote.updatedAt);
            // 元数据来自分支前的父聊天时，写回本聊天自己的 storageId。
            if (remote.storageId !== storageId) writeMetadata(storageId, remote.updatedAt);
        } else if (action === 'push') {
            const updatedAt = stamp || now();
            writeStamp([storageId], updatedAt);
            writeMetadata(storageId, updatedAt, { immediate: !remote });
        }
        if (getStorageId() !== storageId) return action;
        baseline = snapshotBaseline(storageId);
        // 分支、在别处删过楼：按当前主线把记录回退到对应楼层。
        await applyFloorRollback();
        return action;
    };

    return {
        reconcile, noteLocalChange, flush, markLocalAuthoritative,
        recordPhoneChange, pruneRollback, applyFloorRollback,
    };
}
