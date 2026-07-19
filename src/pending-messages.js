import { normalizeQuoteSnapshot } from './chat-message-model.js';

function getStorageBucket(runtime, storageId, create = false) {
    if (!(runtime.pendingMessages instanceof Map) || !storageId) return null;
    let bucket = runtime.pendingMessages.get(storageId);
    if (!bucket && create) {
        bucket = new Map();
        runtime.pendingMessages.set(storageId, bucket);
    }
    return bucket || null;
}

export function getPendingMessages(runtime, storageId, saveKey) {
    const items = getStorageBucket(runtime, storageId)?.get(saveKey);
    return Array.isArray(items) ? items : [];
}

export function getPendingMessage(runtime, storageId, saveKey, itemId) {
    return getPendingMessages(runtime, storageId, saveKey).find(item => item.id === itemId) || null;
}

export function addPendingMessage(runtime, storageId, saveKey, value) {
    if (!storageId || !saveKey) return null;
    const rawText = String(value?.rawText || '').trim();
    const plainText = String(value?.plainText || '').trim();
    const directorNote = String(value?.directorNote || '').trim();
    const bubbleParts = Array.isArray(value?.bubbleParts) ? value.bubbleParts.map(String).filter(Boolean) : [];
    const quote = normalizeQuoteSnapshot(value?.quote);
    if (!plainText && !directorNote) return null;
    const bucket = getStorageBucket(runtime, storageId, true);
    let items = bucket.get(saveKey);
    if (!Array.isArray(items)) {
        items = [];
        bucket.set(saveKey, items);
    }
    const item = {
        id: ++runtime.pendingSequence,
        rawText,
        plainText,
        directorNote,
        bubbleParts,
        ...(quote ? { quote } : {}),
        status: 'pending',
        createdAt: Date.now(),
    };
    items.push(item);
    return item;
}

export function updatePendingMessage(runtime, storageId, saveKey, itemId, value) {
    const item = getPendingMessage(runtime, storageId, saveKey, itemId);
    if (!item || item.status === 'submitting') return null;
    const plainText = String(value?.plainText || '').trim();
    const directorNote = String(value?.directorNote || '').trim();
    if (!plainText && !directorNote) return null;
    item.rawText = String(value?.rawText || '').trim();
    item.plainText = plainText;
    item.directorNote = directorNote;
    item.bubbleParts = Array.isArray(value?.bubbleParts)
        ? value.bubbleParts.map(String).filter(Boolean)
        : [];
    item.status = 'pending';
    return item;
}

export function removePendingMessage(runtime, storageId, saveKey, itemId) {
    const bucket = getStorageBucket(runtime, storageId);
    const items = bucket?.get(saveKey);
    if (!Array.isArray(items)) return false;
    const index = items.findIndex(item => item.id === itemId);
    if (index < 0) return false;
    if (items[index].status === 'submitting') return false;
    items.splice(index, 1);
    if (!items.length) bucket.delete(saveKey);
    if (!bucket.size) runtime.pendingMessages.delete(storageId);
    return true;
}

export function clearPendingMessages(runtime, storageId, saveKey) {
    const bucket = getStorageBucket(runtime, storageId);
    if (!bucket?.delete(saveKey)) return false;
    if (!bucket.size) runtime.pendingMessages.delete(storageId);
    return true;
}

export function setPendingStatus(runtime, storageId, saveKey, status) {
    const items = getPendingMessages(runtime, storageId, saveKey);
    for (const item of items) item.status = status;
    return items.length;
}

export function setPendingBatchStatus(runtime, storageId, saveKey, itemIds, status) {
    const ids = new Set(itemIds);
    let changed = 0;
    for (const item of getPendingMessages(runtime, storageId, saveKey)) {
        if (!ids.has(item.id)) continue;
        item.status = status;
        changed += 1;
    }
    return changed;
}

export function removePendingBatch(runtime, storageId, saveKey, itemIds) {
    const ids = new Set(itemIds);
    const bucket = getStorageBucket(runtime, storageId);
    const items = bucket?.get(saveKey);
    if (!Array.isArray(items)) return 0;
    let removed = 0;
    for (let index = items.length - 1; index >= 0; index -= 1) {
        if (!ids.has(items[index].id)) continue;
        items.splice(index, 1);
        removed += 1;
    }
    if (!items.length) bucket.delete(saveKey);
    if (!bucket.size) runtime.pendingMessages.delete(storageId);
    return removed;
}

function sameQuote(left, right) {
    return left.messageId === right.messageId && left.bubbleId === right.bubbleId;
}

export function combinePendingMessages(runtime, storageId, saveKey) {
    const items = getPendingMessages(runtime, storageId, saveKey)
        .filter(item => item.status !== 'submitting');
    const quotes = items.map(item => normalizeQuoteSnapshot(item.quote)).filter(Boolean);
    const distinctQuotes = [];
    for (const quote of quotes) {
        if (!distinctQuotes.some(existing => sameQuote(existing, quote))) distinctQuotes.push(quote);
    }
    const result = {
        items,
        plainText: items.map(item => item.plainText).filter(Boolean).join(' / '),
        directorNote: items.map(item => item.directorNote).filter(Boolean).join('；'),
        bubbleParts: items.flatMap(item => item.bubbleParts),
        quoteConflict: distinctQuotes.length > 1,
    };
    if (distinctQuotes.length === 1) result.quote = distinctQuotes[0];
    return result;
}

export function clearPendingStorage(runtime, storageId) {
    return runtime.pendingMessages instanceof Map ? runtime.pendingMessages.delete(storageId) : false;
}
