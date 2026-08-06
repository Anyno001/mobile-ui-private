export function createPhoneQuoteController(state) {
    let quoteHighlightTimer = null;
    let quoteHighlightTarget = null;

    function clearQuoteHighlight() {
        if (quoteHighlightTimer !== null) clearTimeout(quoteHighlightTimer);
        quoteHighlightTimer = null;
        quoteHighlightTarget?.classList.remove('pm-quote-target');
        quoteHighlightTarget = null;
    }

    function renderActiveQuote() {
        const preview = state.phoneWindow?.querySelector('.pm-quote-preview');
        if (!preview) return;
        const quote = state.activeQuote;
        preview.hidden = !quote;
        if (!quote) {
            preview.querySelector('.pm-quote-preview-sender')?.replaceChildren();
            preview.querySelector('.pm-quote-preview-text')?.replaceChildren();
            return;
        }
        preview.querySelector('.pm-quote-preview-sender')?.replaceChildren(document.createTextNode(quote.sender || '群聊消息'));
        preview.querySelector('.pm-quote-preview-text')?.replaceChildren(document.createTextNode(quote.text));
    }

    function clearActiveQuote() {
        state.activeQuote = null;
        renderActiveQuote();
    }

    function setActiveQuote(quote) {
        if (!quote) return false;
        state.activeQuote = quote;
        renderActiveQuote();
        state.phoneWindow?.querySelector('.pm-input')?.focus();
        return true;
    }

    function findQuotedBubble(quote) {
        const list = state.phoneWindow?.querySelector('.pm-msg-list');
        if (!list || !quote?.bubbleId) return null;
        return [...list.querySelectorAll('[data-bubble-id]')]
            .find(node => node.dataset.bubbleId === quote.bubbleId && node.dataset.messageId === quote.messageId);
    }

    function syncReplyCardAvailability(card) {
        if (!card) return false;
        const quote = {
            messageId: card.dataset.quoteMessageId,
            bubbleId: card.dataset.quoteBubbleId,
        };
        const available = !!findQuotedBubble(quote);
        card.classList.toggle('is-missing', !available);
        card.disabled = !available;
        card.setAttribute('aria-disabled', String(!available));
        card.setAttribute('aria-label', available
            ? '定位到被引用的消息'
            : '原消息已删除或已被裁剪，当前显示引用快照');
        return available;
    }

    function refreshReplyCardAvailability() {
        const list = state.phoneWindow?.querySelector('.pm-msg-list');
        if (!list) return 0;
        const cards = [...list.querySelectorAll('.pm-reply-card')];
        cards.forEach(syncReplyCardAvailability);
        return cards.length;
    }

    function locateQuotedBubble(quote) {
        const target = findQuotedBubble(quote);
        if (!target) return false;
        const reduceMotion = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches === true;
        target.scrollIntoView?.({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'center' });
        clearQuoteHighlight();
        target.classList.add('pm-quote-target');
        quoteHighlightTarget = target;
        quoteHighlightTimer = setTimeout(() => {
            if (quoteHighlightTarget === target) {
                target.classList.remove('pm-quote-target');
                quoteHighlightTarget = null;
            }
            quoteHighlightTimer = null;
        }, 1800);
        return true;
    }

    return {
        setActiveQuote, clearActiveQuote, renderActiveQuote, findQuotedBubble, locateQuotedBubble,
        refreshReplyCardAvailability, clearQuoteHighlight, syncReplyCardAvailability,
    };
}
