import { SAVE_LIMIT } from './constants.js';
import { normalizeMessageHistory } from './chat-message-model.js';
import { saveHistories } from './storage.js';
import { getConversationSaveKey } from './conversation-state.js';

const cloneHistory = history => JSON.parse(JSON.stringify(history));

function isValidConversationAddress(storageId, saveKey) {
    return typeof storageId === 'string' && storageId !== 'sms_unknown__default'
        && typeof saveKey === 'string' && Boolean(saveKey.trim());
}

/**
 * 将已由调用方准备好的历史窗口写入运行时仓库。
 *
 * 此原语不归一化、不克隆也不落盘：自动消息的补偿路径需要保留旧引用，
 * 群聊流式生成需要在每个 block 后立即提交当前窗口。调用方据此决定持久化时机。
 */
export function replaceConversationHistory(storageId, saveKey, history) {
    if (!isValidConversationAddress(storageId, saveKey) || !Array.isArray(history)) return null;
    if (!window.__pmHistories[storageId]) window.__pmHistories[storageId] = {};
    const key = saveKey.trim();
    const previousHistory = window.__pmHistories[storageId][key];
    window.__pmHistories[storageId][key] = history;
    return { history, previousHistory };
}

/**
 * 恢复 replaceConversationHistory 前的精确运行时状态。
 * previousHistory 为 undefined 时删除条目，与自动消息既有补偿语义保持一致。
 */
export function restoreConversationHistory(storageId, saveKey, previousHistory) {
    if (!isValidConversationAddress(storageId, saveKey)) return false;
    const histories = window.__pmHistories[storageId];
    if (!histories) return false;
    const key = saveKey.trim();
    if (previousHistory === undefined) delete histories[key];
    else histories[key] = previousHistory;
    return true;
}

export function persistConversationHistory(
    state, getStorageId, saveKeyOverride, storageIdOverride, historyOverride, normalizationContext,
) {
    const id = storageIdOverride || state.activeStorageId || getStorageId();
    if (!id || id === 'sms_unknown__default') {
        console.warn('[phone-mode] persistCurrentHistory: storageId 尚未就绪，跳过保存');
        return false;
    }
    const saveKey = saveKeyOverride ?? getConversationSaveKey(state);
    if (typeof saveKey !== 'string' || !saveKey.trim()) return false;
    const history = Array.isArray(historyOverride) ? historyOverride : state.conversationHistory;
    const context = normalizationContext || state;
    normalizeMessageHistory(history, {
        isGroup: context.isGroupChat === true,
        groupMembers: Array.isArray(context.groupMembers) ? context.groupMembers : [],
        legacySeed: `${id}:${saveKey.trim()}`,
    });
    const committed = replaceConversationHistory(id, saveKey, cloneHistory(history.slice(-SAVE_LIMIT)));
    if (!committed) return false;
    saveHistories();
    return true;
}

export function readConversationHistory(storageId, saveKey) {
    const history = window.__pmHistories[storageId]?.[saveKey];
    return Array.isArray(history) ? cloneHistory(history.slice(-SAVE_LIMIT)) : [];
}
