import { createEmojiRenderBudget } from './emoji-media.js';
import { createBubbles } from './messaging.js';
import { bindPressGesture } from './press-gesture.js';
import { escapeHtml } from './ui.js';
import { formatStoryTimeLabel, normalizeStoryDate, normalizeStoryTime } from './chat-message-model.js';

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

function historyEntryFor(state, metadata) {
    const messageId = metadata?.messageId;
    if (!messageId || metadata?.pendingId !== undefined) return null;
    const history = state.conversationHistory || [];
    const indexed = history[Number(metadata.historyIndex)];
    if (indexed?.messageId === messageId) return indexed;
    for (let index = history.length - 1; index >= 0; index -= 1) {
        if (history[index]?.messageId === messageId) return history[index];
    }
    return null;
}

export function createPhoneMessageRenderer({ state, quote, getStoryToday = () => '', onBubblesRendered = () => {} }) {
    let emojiRenderBudget = createEmojiRenderBudget();
    const bubbleQuoteGestureUnbinders = new Map();
    const resetEmojiRenderBudget = () => { emojiRenderBudget = createEmojiRenderBudget(); };
    // 整段重画历史时逐条设 scrollTop 会每条都强制排版（条数平方级）；批量期间只在结束时滚到底一次。
    let scrollBatchDepth = 0;
    const scrollToEnd = list => { if (scrollBatchDepth === 0) list.scrollTop = list.scrollHeight; };
    function batchRender(render) {
        scrollBatchDepth += 1;
        try { return render(); } finally {
            scrollBatchDepth -= 1;
            const list = scrollBatchDepth === 0 ? state.phoneWindow?.querySelector('.pm-msg-list') : null;
            if (list) list.scrollTop = list.scrollHeight;
        }
    }
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

    /** 消息的剧情日期或钟点与列表里最后一条分隔条不同时，先插一条时间分隔（仿微信）；没有钟点的消息只按日期分。 */
    function ensureDateDivider(list, metadata) {
        const entry = historyEntryFor(state, metadata);
        const storyDate = normalizeStoryDate(entry?.storyDate);
        if (!storyDate) return;
        const storyTime = normalizeStoryTime(entry?.storyTime);
        const dividers = list.getElementsByClassName('pm-date-divider');
        const last = dividers[dividers.length - 1]?.dataset;
        if (last?.storyDate === storyDate && (!storyTime || last.storyTime === storyTime)) return;
        const node = document.createElement('div');
        node.className = 'pm-note pm-date-divider';
        node.dataset.storyDate = storyDate;
        if (storyTime) node.dataset.storyTime = storyTime;
        node.textContent = formatStoryTimeLabel(storyDate, storyTime, getStoryToday());
        list.appendChild(node);
    }

    /** 删除消息后清掉下方已没有消息的日期分隔。 */
    function pruneDateDividers() {
        const list = state.phoneWindow?.querySelector('.pm-msg-list'); if (!list) return;
        for (const divider of [...list.getElementsByClassName('pm-date-divider')]) {
            let next = divider.nextElementSibling, hasMessage = false;
            while (next && !next.classList.contains('pm-date-divider')) {
                if (next.dataset.messageId || next.querySelector?.('[data-message-id]')) { hasMessage = true; break; }
                next = next.nextElementSibling;
            }
            if (!hasMessage) divider.remove();
        }
    }

    function addBubble(text, side, senderName, historyIndex, metadata) {
        const list = state.phoneWindow?.querySelector('.pm-msg-list'); if (!list) return [];
        ensureDateDivider(list, metadata);
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
        // 图片卡要读气泡上的 messageId/bubbleId，元数据写完再补图。
        try { onBubblesRendered(nodes); } catch (error) { console.warn('[phone-mode] 图片卡渲染失败', error); }
        scrollToEnd(list);
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
        list.appendChild(node); scrollToEnd(list);
    }
    function addDirector(text, metadata) {
        const list = state.phoneWindow?.querySelector('.pm-msg-list'); if (!list) return null;
        ensureDateDivider(list, metadata);
        const node = document.createElement('div'); node.className = 'pm-director'; applyBubbleMetadata(node, metadata);
        node.innerHTML = `<span class="pm-director-icon">🎬</span><span class="pm-director-text">${escapeHtml(text)}</span>`;
        list.appendChild(node); scrollToEnd(list); return node;
    }
    function showTyping() {
        const list = state.phoneWindow?.querySelector('.pm-msg-list');
        if (!list || document.getElementById('pm-typing')) return;
        const node = document.createElement('div'); node.id = 'pm-typing'; node.className = 'pm-bubble pm-left pm-typing-bubble';
        node.innerHTML = '<span></span><span></span><span></span>'; list.appendChild(node); list.scrollTop = list.scrollHeight;
    }
    const hideTyping = () => document.getElementById('pm-typing')?.remove();
    return {
        addBubble, addNote, addDirector, batchRender, rebaseRenderedHistory, resetEmojiRenderBudget, showTyping, hideTyping,
        clearBubbleQuoteGesture, clearBubbleQuoteGestures, pruneDateDividers,
    };
}
