import { describeMessageEntry } from './chat-message-model.js';
import { HISTORY_RENDER_LIMIT } from './constants.js';

/**
 * 历史全部保留，界面只渲染最近 state.historyRenderLimit 条；
 * 更早的由顶部「查看更早的消息」分批展开。historyIndex 始终是完整历史里的下标。
 */
export function renderConversationHistory({ state, deps, storageId, name }) {
    const {
        addNote, addBubble, addDirector, fitNameFont, applyBackground,
        resetEmojiRenderBudget, clearBubbleQuoteGestures,
    } = deps;
    const nameEl = state.phoneWindow.querySelector('.pm-name');
    const editBtn = state.phoneWindow.querySelector('.pm-name-edit');
    if (nameEl) nameEl.textContent = state.isGroupChat ? state.groupDisplayName || name : name;
    if (editBtn) editBtn.classList.remove('is-hidden');
    fitNameFont();
    const list = state.phoneWindow.querySelector('.pm-msg-list');
    clearBubbleQuoteGestures?.();
    list.innerHTML = '';
    resetEmojiRenderBudget();
    const history = state.conversationHistory;
    if (history.length > 0) {
        const limit = Number.isInteger(state.historyRenderLimit) && state.historyRenderLimit > 0
            ? state.historyRenderLimit : HISTORY_RENDER_LIMIT;
        const start = Math.max(0, history.length - limit);
        if (start > 0) {
            const more = document.createElement('button');
            more.type = 'button';
            more.className = 'pm-action-button is-secondary';
            more.textContent = `查看更早的${Math.min(start, HISTORY_RENDER_LIMIT)}条消息`;
            more.addEventListener('click', () => {
                state.historyRenderLimit = limit + HISTORY_RENDER_LIMIT;
                deps.rerenderConversation?.({ keepScroll: true });
            });
            list.appendChild(more);
        }
        for (let historyIndex = start; historyIndex < history.length; historyIndex += 1) {
            const message = history[historyIndex];
            const descriptors = describeMessageEntry(message, {
                isGroup: state.isGroupChat,
                groupMembers: state.groupMembers,
            });
            const baseMetadata = { historyIndex, messageId: message.messageId };
            if (message.role === 'user' && message.directorNote) addDirector(message.directorNote, baseMetadata);
            descriptors.forEach((bubble, index) => addBubble(
                bubble.text,
                message.role === 'user' ? 'right' : 'left',
                bubble.sender || undefined,
                historyIndex,
                {
                    ...baseMetadata,
                    bubbleId: bubble.bubbleId,
                    sender: bubble.sender || (message.role === 'user' ? '我' : state.currentPersona),
                    ...(index === 0 && message.quote ? { quote: message.quote } : {}),
                },
            ));
        }
        addNote('以上为历史消息');
    } else addNote('开始对话');
    deps.renderPendingConversation?.(storageId, name);
    applyBackground();
}
