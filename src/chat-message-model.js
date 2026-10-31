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

export function formatQuoteContext(value) {
    const quote = normalizeQuoteSnapshot(value);
    if (!quote) return '';
    const sender = quote.sender || '未知发送者';
    const text = quote.text.replace(/\s+/g, ' ').trim();
    return `引用 ${sender} 的消息：“${text}”`;
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

// 逐字段比较，等价于原先两次 JSON.stringify 的比较（键序固定为 bubbleId/text/sender，且不能有多余键）。
function sameBubbles(current, next) {
    if (!Array.isArray(current) || current.length !== next.length) return false;
    return next.every((bubble, index) => {
        const item = current[index];
        if (!item || typeof item !== 'object' || Array.isArray(item)) return false;
        const keys = Object.keys(item);
        return keys.length === 3 && keys[0] === 'bubbleId' && keys[1] === 'text' && keys[2] === 'sender'
            && item.bubbleId === bubble.bubbleId && item.text === bubble.text && item.sender === bubble.sender;
    });
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
    if (!sameBubbles(entry.bubbles, bubbles)) {
        entry.bubbles = bubbles;
        changed = true;
    }
    if (entry.bubbleIds !== undefined) {
        delete entry.bubbleIds;
        changed = true;
    }
    if (entry.storyDate !== undefined && !normalizeStoryDate(entry.storyDate)) {
        delete entry.storyDate;
        changed = true;
    }
    if (entry.sentAt !== undefined && !normalizeSentAt(entry.sentAt)) {
        delete entry.sentAt;
        changed = true;
    }
    if (entry.floor !== undefined && !(Number.isSafeInteger(entry.floor) && entry.floor >= 0)) {
        delete entry.floor;
        delete entry.floorAnchor;
        changed = true;
    } else if (entry.floorAnchor !== undefined && typeof entry.floorAnchor !== 'string') {
        delete entry.floorAnchor;
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

let floorMarkProvider = null;
/** 新消息记下发送时主线的楼层与锚点（删楼回退用）；由 main.js 接上酒馆上下文。 */
export function setFloorMarkProvider(provider) {
    floorMarkProvider = typeof provider === 'function' ? provider : null;
}
function currentFloorMark() {
    try {
        const mark = floorMarkProvider?.();
        return mark && Number.isSafeInteger(mark.floor) && mark.floor >= 0
            ? { floor: mark.floor, floorAnchor: typeof mark.floorAnchor === 'string' ? mark.floorAnchor : '' } : {};
    } catch (error) { return {}; }
}

export function createMessageEntry({ role, content, directorNote, quote, descriptors, messageId, storyDate, sentAt } = {}) {
    const normalizedQuote = normalizeQuoteSnapshot(quote);
    const normalizedStoryDate = normalizeStoryDate(storyDate);
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
        sentAt: normalizeSentAt(sentAt) || Date.now(),
        ...currentFloorMark(),
        ...(normalizedStoryDate ? { storyDate: normalizedStoryDate } : {}),
        ...(directorNote ? { directorNote } : {}),
        ...(normalizedQuote ? { quote: normalizedQuote } : {}),
    };
}

const STORY_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];

function storyDateParts(value) {
    const match = STORY_DATE_PATTERN.exec(String(value || ''));
    if (!match) return null;
    const [year, month, day] = match.slice(1).map(Number);
    const date = new Date(year, month - 1, day);
    if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
    return { year, month, day, date };
}

/** 剧情日期统一为 YYYY-MM-DD；无效值返回空串。 */
export function normalizeStoryDate(value) {
    return storyDateParts(value) ? String(value) : '';
}

function normalizeSentAt(value) {
    return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

function storyDayDiff(from, to) {
    const a = storyDateParts(from), b = storyDateParts(to);
    if (!a || !b) return null;
    return Math.round((Date.UTC(b.year, b.month - 1, b.day) - Date.UTC(a.year, a.month - 1, a.day)) / 86400000);
}

/** 聊天界面日期分隔条：今天/昨天/前天，同年写月日，跨年写全。 */
export function formatStoryDateLabel(storyDate, today = '') {
    const parts = storyDateParts(storyDate);
    if (!parts) return '';
    const weekday = `周${WEEKDAYS[parts.date.getDay()]}`;
    const diff = storyDayDiff(storyDate, today);
    if (diff === 0) return '今天';
    if (diff === 1) return `昨天 ${weekday}`;
    if (diff === 2) return `前天 ${weekday}`;
    const todayParts = storyDateParts(today);
    const sameYear = todayParts && todayParts.year === parts.year;
    return `${sameYear ? '' : `${parts.year}年`}${parts.month}月${parts.day}日 ${weekday}`;
}

/** 发给 AI 的历史里的日期行。 */
export function formatStoryDateHeading(storyDate) {
    const parts = storyDateParts(storyDate);
    if (!parts) return '';
    return `—— ${parts.year}年${parts.month}月${parts.day}日 周${WEEKDAYS[parts.date.getDay()]} ——`;
}

/** 当前这一轮的日期行；与上次聊天隔了几天时一并写明。 */
export function formatCurrentStoryDateHeading(currentStoryDate, previousStoryDate = '') {
    const heading = formatStoryDateHeading(currentStoryDate);
    if (!heading) return '';
    const diff = storyDayDiff(previousStoryDate, currentStoryDate);
    return diff > 0 ? `${heading}（距上次聊天已过 ${diff} 天）` : heading;
}

export function lastStoryDate(history) {
    const entries = Array.isArray(history) ? history : [];
    for (let index = entries.length - 1; index >= 0; index -= 1) {
        const date = normalizeStoryDate(entries[index]?.storyDate);
        if (date) return date;
    }
    return '';
}

/** 编辑框文字：每个气泡一行；群聊 AI 消息写成「名字：内容」。 */
export function messageEntryToEditText(entry, options = {}) {
    const bubbles = describeMessageEntry(entry, options);
    const grouped = options.isGroup && entry?.role === 'assistant';
    return bubbles.map(bubble => (grouped && bubble.sender ? `${bubble.sender}：${bubble.text}` : bubble.text)).join('\n');
}

/**
 * 用编辑框文字重建消息；保留 messageId、引用、剧情引导与时间。
 * 文字为空时返回 null，由调用方决定提示。
 */
export function applyMessageEdit(entry, text, options = {}) {
    const lines = String(text || '').split('\n').map(line => line.trim()).filter(Boolean);
    if (!lines.length || !entry || typeof entry !== 'object') return null;
    const previous = describeMessageEntry(entry, options);
    const grouped = options.isGroup && entry.role === 'assistant';
    let lastSender = '';
    const descriptors = lines.map(line => {
        if (!grouped) return { text: line, sender: '' };
        const match = line.match(/^(.{1,20})[：:]\s*(.+)$/);
        if (match) lastSender = match[1].trim();
        return { text: match ? match[2].trim() : line, sender: lastSender };
    }).filter(descriptor => descriptor.text);
    if (!descriptors.length) return null;
    const bubbles = descriptors.map((descriptor, index) => ({
        bubbleId: previous[index]?.bubbleId && previous[index].text === descriptor.text && previous[index].sender === descriptor.sender
            ? previous[index].bubbleId : uid('bubble'),
        text: descriptor.text,
        sender: descriptor.sender,
    }));
    let content;
    if (grouped) {
        const blocks = [];
        for (const bubble of bubbles) {
            const tail = blocks.at(-1);
            if (tail && tail.sender === bubble.sender) tail.texts.push(bubble.text);
            else blocks.push({ sender: bubble.sender, texts: [bubble.text] });
        }
        content = blocks.map(block => (block.sender ? `${block.sender}：` : '') + block.texts.join(' / ')).join('\n');
    } else content = bubbles.map(bubble => bubble.text).join(' / ');
    return { ...entry, content, bubbles };
}
