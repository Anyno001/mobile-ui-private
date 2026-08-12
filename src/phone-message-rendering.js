import { createEmojiRenderBudget } from './emoji-media.js';
import { createBubbles } from './messaging.js';
import { bindPressGesture } from './press-gesture.js';
import { escapeHtml } from './ui.js';

export function bindBubbleQuoteGesture(root, { state, quote, text, senderName, metadata, gestureRuntime = {} }) {
    if (metadata?.pendingId !== undefined || !metadata?.messageId || !metadata?.bubbleId) return null;
    const isInteractiveQuoteTarget = target => !!target?.closest?.('.pm-quote-action,.pm-reply-card');
    const isNativeClickTarget = target => !!target?.closest?.('.pm-voice-card');
    const canStart = event => !state.isSelectMode && !isInteractiveQuoteTarget(event.target);
    return bindPressGesture(root, {
        delay: 550,
        allowNativeClick: true,
        clickCapture: true,
        shouldStart: canStart,
        shouldCapturePointer: event => !isNativeClickTarget(event.target),
        setTimer: gestureRuntime.setTimer,
        clearTimer: gestureRuntime.clearTimer,
        eventTarget: gestureRuntime.eventTarget,
        shouldPreventContextMenu: event => ['touch', 'pen'].includes(event.pointerType) && canStart(event),
        onHold: () => {
            if (state.isSelectMode) return false;
            return quote.setActiveQuote({
                messageId: String(metadata.messageId),
                bubbleId: String(metadata.bubbleId),
                sender: String(senderName || metadata.sender || '我'),
                text: String(text || ''),
            });
        },
    });
}

export function createPhoneMessageRenderer({ state, quote }) {
    let emojiRenderBudget = createEmojiRenderBudget();
    const bubbleQuoteGestureUnbinders = new Map();
    const resetEmojiRenderBudget = () => { emojiRenderBudget = createEmojiRenderBudget(); };
    const clearBubbleQuoteGesture = root => {
        const unbind = bubbleQuoteGestureUnbinders.get(root);
        if (!unbind) return false;
        bubbleQuoteGestureUnbinders.delete(root);
        unbind();
        return true;
    };
    const clearBubbleQuoteGestures = () => {
        for (const unbind of bubbleQuoteGestureUnbinders.values()) unbind();
        bubbleQuoteGestureUnbinders.clear();
    };

    function applyBubbleMetadata(node, metadata) {
        if (!metadata) return;
        if (metadata.historyIndex !== undefined) node.dataset.historyIndex = String(metadata.historyIndex);
        if (metadata.messageId) node.dataset.messageId = String(metadata.messageId);
        if (metadata.bubbleId) node.dataset.bubbleId = String(metadata.bubbleId);
        if (metadata.pendingId !== undefined) node.dataset.pendingId = String(metadata.pendingId);
        if (metadata.pendingStatus) node.dataset.pendingStatus = metadata.pendingStatus;
        if (metadata.pendingId !== undefined) node.classList.add('pm-pending-entry');
    }

    function attachQuoteUi(root, bubble, text, senderName, metadata) {
        if (metadata?.quote && !bubble.querySelector('.pm-reply-card')) {
            const card = document.createElement('button');
            card.type = 'button'; card.className = 'pm-reply-card';
            card.dataset.quoteMessageId = metadata.quote.messageId;
            card.dataset.quoteBubbleId = metadata.quote.bubbleId;
            const sender = document.createElement('span'); sender.className = 'pm-reply-card-sender';
            sender.textContent = metadata.quote.sender || '群聊消息';
            const snapshot = document.createElement('span'); snapshot.className = 'pm-reply-card-text';
            snapshot.textContent = metadata.quote.text;
            card.append(sender, snapshot);
            card.addEventListener('click', event => {
                event.stopPropagation();
                if (quote.syncReplyCardAvailability(card)) quote.locateQuotedBubble({
                    messageId: card.dataset.quoteMessageId, bubbleId: card.dataset.quoteBubbleId,
                });
            });
            quote.syncReplyCardAvailability(card);
            bubble.prepend(card);
        }
        if (metadata?.pendingId !== undefined || !metadata?.messageId || !metadata?.bubbleId || root.querySelector('.pm-quote-action')) return;
        const action = document.createElement('button');
        action.type = 'button'; action.className = 'pm-quote-action'; action.textContent = '引用';
        action.setAttribute('aria-label', `引用${senderName || (metadata.sender || '我')}的消息`);
        action.addEventListener('click', event => {
            event.stopPropagation();
            quote.setActiveQuote({
                messageId: String(metadata.messageId), bubbleId: String(metadata.bubbleId),
                sender: String(senderName || metadata.sender || '我'), text: String(text || ''),
            });
        });
        root.appendChild(action);
    }

    function addBubble(text, side, senderName, historyIndex, metadata) {
        const list = state.phoneWindow?.querySelector('.pm-msg-list'); if (!list) return [];
        const nodes = createBubbles(text, side, senderName, {
            groupColorMap: state.groupColorMap, groupMembers: state.groupMembers, emojis: window.__pmEmojis,
            emojiBudget: emojiRenderBudget,
        });
        nodes.forEach(node => {
            applyBubbleMetadata(node, metadata);
            if (node.classList?.contains('pm-bubble')) {
                node.dataset.side = side; node.dataset.text = text;
                if (historyIndex !== undefined) node.dataset.historyIndex = historyIndex;
                attachQuoteUi(node, node, text, senderName, metadata);
                const unbind = bindBubbleQuoteGesture(node, { state, quote, text, senderName, metadata });
                if (unbind) bubbleQuoteGestureUnbinders.set(node, unbind);
            } else if (node.classList?.contains('pm-group-bubble-wrap')) {
                node.dataset.side = side; node.dataset.text = text;
                if (historyIndex !== undefined) node.dataset.historyIndex = historyIndex;
                const bubble = node.querySelector('.pm-bubble'); if (bubble) {
                    applyBubbleMetadata(bubble, metadata); bubble.dataset.side = side; bubble.dataset.text = text;
                    if (historyIndex !== undefined) bubble.dataset.historyIndex = historyIndex;
                    attachQuoteUi(node, bubble, text, senderName, metadata);
                    const unbind = bindBubbleQuoteGesture(node, { state, quote, text, senderName, metadata });
                    if (unbind) bubbleQuoteGestureUnbinders.set(node, unbind);
                }
            }
            list.appendChild(node);
        });
        list.scrollTop = list.scrollHeight;
        return nodes;
    }

    function rebaseRenderedHistory(trimmedCount) {
        if (!Number.isInteger(trimmedCount) || trimmedCount <= 0) return;
        const list = state.phoneWindow?.querySelector('.pm-msg-list'); if (!list) return;
        for (const child of [...list.children]) {
            const indexed = child.dataset.historyIndex !== undefined ? child : child.querySelector?.('[data-history-index]');
            if (!indexed) continue;
            const previousIndex = Number(indexed.dataset.historyIndex); if (!Number.isInteger(previousIndex)) continue;
            if (previousIndex < trimmedCount) {
                const gestureRoot = child.classList?.contains('pm-select-wrap')
                    ? child.querySelector('.pm-bubble, .pm-group-bubble-wrap') : child;
                if (gestureRoot) clearBubbleQuoteGesture(gestureRoot);
                child.remove();
                continue;
            }
            const nextIndex = String(previousIndex - trimmedCount);
            if (child.dataset.historyIndex !== undefined) child.dataset.historyIndex = nextIndex;
            child.querySelectorAll?.('[data-history-index]').forEach(node => { node.dataset.historyIndex = nextIndex; });
        }
        quote.refreshReplyCardAvailability();
    }

    function addNote(text) {
        const list = state.phoneWindow?.querySelector('.pm-msg-list'); if (!list) return;
        const node = document.createElement('div'); node.className = 'pm-note'; node.textContent = text;
        list.appendChild(node); list.scrollTop = list.scrollHeight;
    }
    function addDirector(text, metadata) {
        const list = state.phoneWindow?.querySelector('.pm-msg-list'); if (!list) return null;
        const node = document.createElement('div'); node.className = 'pm-director'; applyBubbleMetadata(node, metadata);
        node.innerHTML = `<span class="pm-director-icon">🎬</span><span class="pm-director-text">${escapeHtml(text)}</span>`;
        list.appendChild(node); list.scrollTop = list.scrollHeight; return node;
    }
    function showTyping() {
        const list = state.phoneWindow?.querySelector('.pm-msg-list');
        if (!list || document.getElementById('pm-typing')) return;
        const node = document.createElement('div'); node.id = 'pm-typing'; node.className = 'pm-bubble pm-left pm-typing-bubble';
        node.innerHTML = '<span></span><span></span><span></span>'; list.appendChild(node); list.scrollTop = list.scrollHeight;
    }
    const hideTyping = () => document.getElementById('pm-typing')?.remove();
    return {
        addBubble, addNote, addDirector, rebaseRenderedHistory, resetEmojiRenderBudget, showTyping, hideTyping,
        clearBubbleQuoteGesture, clearBubbleQuoteGestures,
    };
}
