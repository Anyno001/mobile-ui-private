import { splitToSentences } from './prompts.js';

const SNAPSHOT_LIMIT = 80;
let fallbackSequence = 0;

function uid(prefix) {
    const randomUuid = globalThis.crypto?.randomUUID?.();
    if (randomUuid) return `${prefix}_${randomUuid}`;
    fallbackSequence += 1;
    return `${prefix}_${Date.now().toString(36)}_${fallbackSequence.toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function stableId(prefix, seed) {
    let hash = 2166136261;
    for (const char of String(seed || '')) {
        hash ^= char.codePointAt(0);
        hash = Math.imul(hash, 16777619);
    }
    return `${prefix}_legacy_${(hash >>> 0).toString(36)}`;
}

function cleanId(value) {
    return typeof value === 'string' && value.trim() ? value.trim() : '';
}

export function createMessageId() {
    return uid('msg');
}

export function normalizeQuoteSnapshot(value) {
    if (!value || typeof value !== 'object') return null;
    const messageId = cleanId(value.messageId);
    const bubbleId = cleanId(value.bubbleId);
    const text = [...String(value.text || '').trim()].slice(0, SNAPSHOT_LIMIT).join('');
    if (!messageId || !bubbleId || !text) return null;
    return {
        messageId,
        bubbleId,
        sender: [...String(value.sender || '').trim()].slice(0, 24).join(''),
        text,
    };
}

export function createQuoteSnapshot(value) {
    return normalizeQuoteSnapshot(value);
}

export function describeMessageEntry(entry, { isGroup = false, groupMembers = [] } = {}) {
    if (Array.isArray(entry?.bubbles) && entry.bubbles.length) {
        return entry.bubbles.map(bubble => ({
            bubbleId: cleanId(bubble?.bubbleId),
            text: String(bubble?.text || ''),
            sender: String(bubble?.sender || ''),
        })).filter(bubble => bubble.text);
    }
    const content = String(entry?.content || '');
    if (isGroup && entry?.role === 'assistant') {
        const memberMap = new Map(groupMembers.map(name => [String(name).trim().toLowerCase(), String(name).trim()]));
        return content.split('\n').flatMap(line => {
            const match = line.match(/^(.{1,20})[：:]\s*(.+)$/);
            const sender = match ? memberMap.get(match[1].trim().toLowerCase()) : '';
            const text = sender ? match[2] : line;
            return splitToSentences(text).map(part => ({ text: part, sender }));
        });
    }
    return splitToSentences(content).map(text => ({ text, sender: '' }));
}

export function ensureMessageEntry(entry, options = {}) {
    if (!entry || typeof entry !== 'object') return { entry, changed: false };
    const legacySeed = String(options.legacySeed || `${entry.role || ''}:${entry.content || ''}`);
    let changed = false;
    if (!cleanId(entry.messageId)) {
        entry.messageId = stableId('msg', legacySeed);
        changed = true;
    }
    const descriptors = describeMessageEntry(entry, options);
    const bubbles = descriptors.map((descriptor, index) => ({
        bubbleId: cleanId(descriptor.bubbleId)
            || stableId('bubble', `${entry.messageId}:${index}:${descriptor.sender}:${descriptor.text}`),
        text: String(descriptor.text || ''),
        sender: String(descriptor.sender || ''),
    })).filter(bubble => bubble.text);
    if (bubbles.some((bubble, index) => bubble.bubbleId !== descriptors[index]?.bubbleId)) changed = true;
    const normalizedBubbles = JSON.stringify(bubbles);
    if (!Array.isArray(entry.bubbles) || JSON.stringify(entry.bubbles) !== normalizedBubbles) {
        entry.bubbles = bubbles;
        changed = true;
    }
    if (entry.bubbleIds !== undefined) {
        delete entry.bubbleIds;
        changed = true;
    }
    if (entry.quote !== undefined) {
        const quote = normalizeQuoteSnapshot(entry.quote);
        if (quote) {
            if (JSON.stringify(quote) !== JSON.stringify(entry.quote)) changed = true;
            entry.quote = quote;
        } else {
            delete entry.quote;
            changed = true;
        }
    }
    return { entry, changed };
}

function duplicateValues(values) {
    const counts = new Map();
    for (const value of values.filter(Boolean)) counts.set(value, (counts.get(value) || 0) + 1);
    return new Set([...counts].filter(([, count]) => count > 1).map(([value]) => value));
}

export function normalizeMessageHistory(history, options = {}) {
    const entries = Array.isArray(history) ? history : [];
    let changed = false;
    entries.forEach((entry, index) => {
        const legacySeed = `${options.legacySeed || 'history'}:${index}:${entry?.role || ''}:${entry?.content || ''}`;
        if (ensureMessageEntry(entry, { ...options, legacySeed }).changed) changed = true;
    });
    const duplicateMessageIds = duplicateValues(entries.map(entry => cleanId(entry?.messageId)));
    const duplicateBubbleIds = duplicateValues(entries.flatMap(entry => (
        Array.isArray(entry?.bubbles) ? entry.bubbles.map(bubble => cleanId(bubble?.bubbleId)) : []
    )));
    if (!duplicateMessageIds.size && !duplicateBubbleIds.size) return changed;

    entries.forEach((entry, entryIndex) => {
        const originalMessageId = cleanId(entry?.messageId);
        if (duplicateMessageIds.has(originalMessageId)) {
            entry.messageId = stableId(
                'msg', `${options.legacySeed || 'history'}:duplicate:${entryIndex}:${originalMessageId}:${entry.role || ''}:${entry.content || ''}`,
            );
            changed = true;
        }
        (Array.isArray(entry?.bubbles) ? entry.bubbles : []).forEach((bubble, bubbleIndex) => {
            const originalBubbleId = cleanId(bubble?.bubbleId);
            if (!duplicateBubbleIds.has(originalBubbleId)) return;
            bubble.bubbleId = stableId(
                'bubble', `${entry.messageId}:duplicate:${bubbleIndex}:${originalBubbleId}:${bubble.sender || ''}:${bubble.text || ''}`,
            );
            changed = true;
        });
    });
    for (const entry of entries) {
        const quote = normalizeQuoteSnapshot(entry?.quote);
        if (!quote) continue;
        if (!duplicateMessageIds.has(quote.messageId) && !duplicateBubbleIds.has(quote.bubbleId)) continue;
        entry.quote = {
            ...quote,
            messageId: stableId('msg', `missing-duplicate:${quote.messageId}`),
            bubbleId: stableId('bubble', `missing-duplicate:${quote.bubbleId}`),
        };
        changed = true;
    }
    return changed;
}

export function createMessageEntry({ role, content, directorNote, quote, descriptors, messageId } = {}) {
    const normalizedQuote = normalizeQuoteSnapshot(quote);
    const bubbles = (Array.isArray(descriptors) ? descriptors : []).map(descriptor => ({
        bubbleId: uid('bubble'),
        text: String(typeof descriptor === 'object' ? descriptor?.text || '' : descriptor || ''),
        sender: String(typeof descriptor === 'object' ? descriptor?.sender || '' : ''),
    })).filter(bubble => bubble.text);
    return {
        role,
        content: String(content || ''),
        messageId: cleanId(messageId) || uid('msg'),
        bubbles,
        ...(directorNote ? { directorNote } : {}),
        ...(normalizedQuote ? { quote: normalizedQuote } : {}),
    };
}
