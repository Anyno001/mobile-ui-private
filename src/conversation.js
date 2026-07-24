import { SAVE_LIMIT } from './constants.js';
import {
    describeMessageEntry, normalizeMessageHistory,
} from './chat-message-model.js';
import { GROUP_COLORS } from './groups.js';
import {
    saveHistories, loadGroupMeta,
} from './storage.js';

const cloneHistory = history => JSON.parse(JSON.stringify(history));

/**
 * 获取当前会话的 saveKey（群聊/单聊）
 */
function getSaveKey(state) {
    return state.isGroupChat && state.currentGroupKey ? state.currentGroupKey : state.currentPersona;
}

/**
 * 保存当前对话历史到 window.__pmHistories
 */
function persistCurrentHistory(
    state, getStorageId, saveKeyOverride, storageIdOverride, historyOverride, normalizationContext,
) {
    const id = storageIdOverride || state.activeStorageId || getStorageId();
    if (!id || id === 'sms_unknown__default') {
        console.warn('[phone-mode] persistCurrentHistory: storageId 尚未就绪，跳过保存');
        return false;
    }
    const saveKey = saveKeyOverride ?? getSaveKey(state);
    if (typeof saveKey !== 'string' || !saveKey.trim()) return false;
    if (!window.__pmHistories[id]) window.__pmHistories[id] = {};
    const history = Array.isArray(historyOverride) ? historyOverride : state.conversationHistory;
    const context = normalizationContext || state;
    normalizeMessageHistory(history, {
        isGroup: context.isGroupChat === true,
        groupMembers: Array.isArray(context.groupMembers) ? context.groupMembers : [],
        legacySeed: `${id}:${saveKey.trim()}`,
    });
    window.__pmHistories[id][saveKey.trim()] = cloneHistory(history.slice(-SAVE_LIMIT));
    saveHistories();
    return true;
}

function getStoredHistory(id, saveKey) {
    const history = window.__pmHistories[id]?.[saveKey];
    return Array.isArray(history) ? cloneHistory(history.slice(-SAVE_LIMIT)) : [];
}


/**
 * 解析当前手机会话目标，注入位置显式提供 storageId/targetKey，
 * 避免 phone-context-injection / phone-control-center / phone-directory 各算各的目标时漂移。
 *
 * @param {object} state
 * @param {() => string} getStorageId
 * @returns {{storageId:string,targetKey:string,saveKey:string,isGroup:boolean}|null}
 */
export function resolveConversationTarget(state, getStorageId) {
    const storageId = state.activeStorageId || getStorageId();
    const targetKey = state.isGroupChat && state.currentGroupKey ? state.currentGroupKey : state.currentPersona;
    if (!storageId || storageId === 'sms_unknown__default' || !targetKey) return null;
    return { storageId, targetKey, saveKey: targetKey, isGroup: state.isGroupChat };
}


/**
 * 安装会话管理功能
 * 集中管理：__pmSwitchContact（切换联系人/群聊）、__pmSwitch（切换并重绘历史）
 * 保留旧 _prevSaveKey 语义和 window 全局契约
 */
export function installConversation(state, deps) {
    const {
        getStorageId, addNote, addBubble, addDirector, fitNameFont, applyBackground,
        applyBidirectionalInjection, resetEmojiRenderBudget,
    } = deps;

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
        const _prevSaveKey = state.isGroupChat && state.currentGroupKey ? state.currentGroupKey : state.currentPersona;
        const _prevStorageId = state.activeStorageId;
        const previousConversationContext = {
            isGroupChat: state.isGroupChat,
            groupMembers: state.groupMembers.slice(),
        };
        state.activeStorageId = id;
        if (groupMeta) {
            state.isGroupChat = true; state.currentGroupKey = key;
            state.groupMembers = groupMeta.members.slice();
            state.groupExtras = Array.isArray(groupMeta.extras) ? groupMeta.extras.slice() : [];
            state.groupDisplayName = groupMeta.name;
            state.groupRandomNpcEnabled = groupMeta.randomNpcEnabled === true;
            state.groupNature = typeof groupMeta.groupNature === 'string' ? groupMeta.groupNature : '';
            state.groupColorMap = {};
            state.groupMembers.forEach((n, i) => { state.groupColorMap[n] = groupMeta.memberColors?.[n] || GROUP_COLORS[i % GROUP_COLORS.length].bg; });
        } else {
            state.isGroupChat = false; state.groupMembers = []; state.groupExtras = []; state.groupColorMap = {};
            state.groupDisplayName = ''; state.groupRandomNpcEnabled = false; state.groupNature = ''; state.currentGroupKey = '';
        }
        window.__pmSwitch(
            key,
            options.skipPreviousPersist === true ? undefined : _prevSaveKey,
            options.skipPreviousPersist === true ? undefined : _prevStorageId,
            { ...options, previousConversationContext },
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
        if (state.phoneWindow) {
            const nameEl = state.phoneWindow.querySelector('.pm-name');
            const editBtn = state.phoneWindow.querySelector('.pm-name-edit');
            if (nameEl) {
                nameEl.textContent = state.isGroupChat ? state.groupDisplayName || name : name;
            }
            if (editBtn) {
                editBtn.classList.remove('is-hidden');
            }
            fitNameFont();
            const list = state.phoneWindow.querySelector('.pm-msg-list');
            list.innerHTML = '';
            resetEmojiRenderBudget();
            if (state.conversationHistory.length > 0) {
                addNote('历史记录');
                state.conversationHistory.forEach((m, hi) => {
                    const descriptors = describeMessageEntry(m, {
                        isGroup: state.isGroupChat,
                        groupMembers: state.groupMembers,
                    });
                    const baseMetadata = { historyIndex: hi, messageId: m.messageId };
                    if (m.role === 'user' && m.directorNote) addDirector(m.directorNote, baseMetadata);
                    descriptors.forEach((bubble, index) => addBubble(
                        bubble.text,
                        m.role === 'user' ? 'right' : 'left',
                        bubble.sender || undefined,
                        hi,
                        {
                            ...baseMetadata,
                            bubbleId: bubble.bubbleId,
                            sender: bubble.sender || (m.role === 'user' ? '我' : ''),
                            ...(index === 0 && m.quote ? { quote: m.quote } : {}),
                        },
                    ));
                });
                addNote('── 以上为历史 ──');
            } else addNote('开始对话');
            deps.renderPendingConversation?.(id, name);
            applyBackground();
        }
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
