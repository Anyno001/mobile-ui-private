import {
    normalizeMessageHistory,
} from './chat-message-model.js';
import {
    persistConversationHistory, readConversationHistory,
} from './conversation-persistence.js';
import {
    applyConversationTarget, getConversationSaveKey, snapshotConversationContext,
} from './conversation-state.js';
import { renderConversationHistory } from './conversation-rendering.js';
import { loadGroupMeta } from './storage.js';

/**
 * 获取当前会话的 saveKey（群聊/单聊）
 */
const getSaveKey = getConversationSaveKey;

/**
 * 保存当前对话历史到 window.__pmHistories
 */
const persistCurrentHistory = persistConversationHistory;
const getStoredHistory = readConversationHistory;


/**
 * 安装会话管理功能
 * 集中管理：__pmSwitchContact（切换联系人/群聊）、__pmSwitch（切换并重绘历史）
 * 保留旧 _prevSaveKey 语义和 window 全局契约
 */
export function installConversation(state, deps) {
    const { getStorageId, applyBidirectionalInjection } = deps;

    window.__pmSwitchContact = async (key, options = {}) => {
        if (!key?.trim()) return; key = key.trim();
        await loadGroupMeta();
        const id = getStorageId();
        // 修复：如果上下文尚未就绪导致 ID 为 unknown，给出警告，避免存入错误 key
        if (!id || id === 'sms_unknown__default') {
            console.warn('[phone-mode] __pmSwitchContact: SillyTavern 上下文尚未就绪，storageId 无效，跳过切换');
            return;
        }
        const groupMeta = window.__pmGroupMeta[id]?.[key];
        // 修复：在修改全局状态前快照旧 saveKey，防止落盘时把当前会话记录写入目标会话
        const previousConversation = snapshotConversationContext(state);
        state.activeStorageId = id;
        applyConversationTarget(state, key, groupMeta);
        window.__pmSwitch(
            key,
            options.skipPreviousPersist === true ? undefined : previousConversation.saveKey,
            options.skipPreviousPersist === true ? undefined : previousConversation.storageId,
            { ...options, previousConversationContext: previousConversation.normalizationContext },
        );
    };

    window.__pmSwitch = (name, _prevSaveKey, _prevStorageId, options = {}) => {
        if (!name?.trim()) return; name = name.trim();
        deps.closeContactSwitcher?.('conversation-switch');
        deps.closeControlCenter?.();
        deps.closeOverlay?.('conversation-switch');
        deps.clearActiveQuote?.();
        const id = getStorageId();
        if (!id || id === 'sms_unknown__default') {
            console.warn('[phone-mode] __pmSwitch: storageId 尚未就绪，跳过切换');
            return;
        }
        // 切换前先把当前联系人的最新 state.conversationHistory 落盘，
        // 修复：调用方（__pmConfirmGroup）可能在调用本函数前已修改了 state.isGroupChat/state.currentGroupKey，
        // 导致落盘时 saveKey 错误地指向新目标，把旧聊天记录写入新会话。优先使用调用方传入的 _prevSaveKey。
        if (options.skipPreviousPersist !== true && (_prevSaveKey || state.currentPersona)) {
            persistCurrentHistory(
                state, getStorageId, _prevSaveKey ?? getSaveKey(state), _prevStorageId,
                undefined, options.previousConversationContext,
            );
        }
        state.activeStorageId = id;
        state.currentPersona = name;
        state.conversationHistory = getStoredHistory(id, name);
        const historyChanged = normalizeMessageHistory(state.conversationHistory, {
            isGroup: state.isGroupChat,
            groupMembers: state.groupMembers,
            legacySeed: `${id}:${name}`,
        });
        if (historyChanged) persistCurrentHistory(state, getStorageId, name, id);
        if (state.phoneWindow) renderConversationHistory({ state, deps, storageId: id, name });
        if (options.preservePage !== true) {
            deps.showPhoneChatPage?.(id);
        }
        applyBidirectionalInjection();
    };

    // 导出内部函数供其他模块使用
    Object.assign(deps, {
        persistCurrentHistory: (saveKey, storageId, history, normalizationContext) => persistCurrentHistory(
            state, getStorageId, saveKey, storageId, history, normalizationContext,
        ),
        getSaveKey: () => getSaveKey(state),
    });
}
