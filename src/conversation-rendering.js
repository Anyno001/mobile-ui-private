import { describeMessageEntry } from './chat-message-model.js';

export function renderConversationHistory({ state, deps, storageId, name }) {
    const {
        addNote, addBubble, addDirector, fitNameFont, applyBackground,
        resetEmojiRenderBudget,
    } = deps;
    const nameEl = state.phoneWindow.querySelector('.pm-name');
    const editBtn = state.phoneWindow.querySelector('.pm-name-edit');
    if (nameEl) nameEl.textContent = state.isGroupChat ? state.groupDisplayName || name : name;
    if (editBtn) editBtn.classList.remove('is-hidden');
    fitNameFont();
    const list = state.phoneWindow.querySelector('.pm-msg-list');
    list.innerHTML = '';
    resetEmojiRenderBudget();
    if (state.conversationHistory.length > 0) {
        addNote('历史记录');
        state.conversationHistory.forEach((message, historyIndex) => {
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
        });
        addNote('── 以上为历史 ──');
    } else addNote('开始对话');
    deps.renderPendingConversation?.(storageId, name);
    applyBackground();
}
