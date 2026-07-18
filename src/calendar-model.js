export const CALENDAR_STORE_VERSION = 1;
export const CALENDAR_LIMITS = Object.freeze({ scopes: 80, dates: 366, eventsPerDate: 40, title: 120, note: 1000 });
export const CALENDAR_SOURCES = Object.freeze(['manual', 'context', 'ai']);

const plainRecord = value => value && typeof value === 'object' && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
const cleanText = (value, max) => String(value ?? '').trim().slice(0, max);
const unsafeKey = value => value === 'prototype' || Object.hasOwn(Object.prototype, value);
const uid = () => `calendar_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
const pad = value => String(value).padStart(2, '0');

export function formatCalendarDate(date) {
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function parseCalendarDate(value) {
    const match = String(value ?? '').trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return null;
    const year = Number(match[1]), month = Number(match[2]), day = Number(match[3]);
    const date = new Date(year, month - 1, day, 12, 0, 0, 0);
    return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day ? date : null;
}

export function calendarDateFromParts(year, month, day) {
    const date = new Date(Number(year), Number(month) - 1, Number(day), 12, 0, 0, 0);
    if (![year, month, day].every(value => Number.isInteger(Number(value)))) return null;
    return date.getFullYear() === Number(year) && date.getMonth() === Number(month) - 1
        && date.getDate() === Number(day) ? formatCalendarDate(date) : null;
}

export function calendarWeekKeys(start = new Date(), days = 7) {
    const base = new Date(start.getFullYear(), start.getMonth(), start.getDate(), 12, 0, 0, 0);
    return Array.from({ length: Math.max(1, Math.min(31, days)) }, (_, index) => {
        const date = new Date(base); date.setDate(base.getDate() + index); return formatCalendarDate(date);
    });
}

export function createEmptyCalendarStore() {
    return { version: CALENDAR_STORE_VERSION, scopes: {} };
}


function normalizeTimestamp(value, fallback = 0) {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value) : fallback;
}

export function normalizeCalendarEvent(value, expectedDate = '', now = Date.now()) {
    if (!plainRecord(value)) throw new Error('日程必须是对象');
    const date = parseCalendarDate(expectedDate || value.date) ? (expectedDate || value.date) : '';
    if (!date) throw new Error('日程日期无效');
    const title = cleanText(value.title, CALENDAR_LIMITS.title);
    if (!title) throw new Error('日程标题不能为空');
    const source = CALENDAR_SOURCES.includes(value.source) ? value.source : 'manual';
    const createdAt = normalizeTimestamp(value.createdAt, now);
    return {
        id: cleanText(value.id, 80) || uid(),
        date,
        title,
        note: cleanText(value.note, CALENDAR_LIMITS.note),
        source,
        createdAt,
        updatedAt: Math.max(createdAt, normalizeTimestamp(value.updatedAt, createdAt)),
    };
}

export function normalizeCalendarScope(value) {
    const source = plainRecord(value) ? value : {};
    const events = {};
    let dateCount = 0;
    for (const [date, rawEvents] of Object.entries(plainRecord(source.events) ? source.events : {})) {
        if (dateCount >= CALENDAR_LIMITS.dates || !parseCalendarDate(date) || !Array.isArray(rawEvents)) continue;
        const seen = new Set();
        const normalized = [];
        for (const rawEvent of rawEvents.slice(0, CALENDAR_LIMITS.eventsPerDate)) {
            try {
                const event = normalizeCalendarEvent(rawEvent, date);
                if (seen.has(event.id)) continue;
                seen.add(event.id); normalized.push(event);
            } catch (error) {}
        }
        if (normalized.length) { events[date] = normalized; dateCount += 1; }
    }
    return {
        autoAdjust: source.autoAdjust === true,
        events,
        lastGeneratedAt: normalizeTimestamp(source.lastGeneratedAt),
        lastAdjustedAt: normalizeTimestamp(source.lastAdjustedAt),
    };
}

export function normalizeCalendarStore(value) {
    const source = plainRecord(value) ? value : {};
    const scopes = {};
    for (const [storageId, rawScope] of Object.entries(plainRecord(source.scopes) ? source.scopes : {})) {
        if (Object.keys(scopes).length >= CALENDAR_LIMITS.scopes) break;
        if (!storageId || storageId !== storageId.trim() || storageId.length > 160 || unsafeKey(storageId)) continue;
        scopes[storageId] = normalizeCalendarScope(rawScope);
    }
    return { version: CALENDAR_STORE_VERSION, scopes };
}

export function calendarScopeFor(store, storageId) {
    const normalized = normalizeCalendarStore(store);
    return normalized.scopes[storageId] || createEmptyCalendarScope();
}

export function upsertCalendarEvent(scope, rawEvent, now = Date.now()) {
    const next = normalizeCalendarScope(scope);
    const date = String(rawEvent?.date || '');
    const title = cleanText(rawEvent?.title, CALENDAR_LIMITS.title);
    const source = CALENDAR_SOURCES.includes(rawEvent?.source) ? rawEvent.source : 'manual';
    const duplicate = !rawEvent?.id ? (next.events[date] || [])
        .find(item => item.title === title && item.source === source) : null;
    const event = normalizeCalendarEvent({ ...rawEvent, id: rawEvent?.id || duplicate?.id }, date, now);
    for (const [date, events] of Object.entries(next.events)) {
        next.events[date] = events.filter(item => item.id !== event.id);
        if (!next.events[date].length) delete next.events[date];
    }
    const events = next.events[event.date] || [];
    next.events[event.date] = [...events, event].slice(-CALENDAR_LIMITS.eventsPerDate)
        .sort((left, right) => left.createdAt - right.createdAt || left.id.localeCompare(right.id));
    return next;
}

export function deleteCalendarEvent(scope, eventId) {
    const next = normalizeCalendarScope(scope);
    let removed = false;
    for (const [date, events] of Object.entries(next.events)) {
        const filtered = events.filter(event => event.id !== eventId);
        if (filtered.length !== events.length) removed = true;
        if (filtered.length) next.events[date] = filtered; else delete next.events[date];
    }
    return { scope: next, removed };
}

export function findCalendarEvent(scope, eventId) {
    for (const events of Object.values(normalizeCalendarScope(scope).events)) {
        const event = events.find(item => item.id === eventId);
        if (event) return event;
    }
    return null;
}

const relativeDates = Object.freeze({ 今天: 0, 今日: 0, 明天: 1, 明日: 1, 后天: 2 });

export function extractCalendarDate(text, now = new Date()) {
    const source = String(text ?? '').trim();
    const tagged = source.match(/<\s*(\d{4})[\s年./-]+(\d{1,2})[\s月./-]+(\d{1,2})\s*日?\s*>/);
    const absolute = source.match(/(?:^|\D)(\d{4})[\s年./-]+(\d{1,2})[\s月./-]+(\d{1,2})\s*日?/);
    const parts = tagged || absolute;
    if (parts) return calendarDateFromParts(Number(parts[1]), Number(parts[2]), Number(parts[3]));
    const monthDay = source.match(/(?:^|\D)(\d{1,2})\s*月\s*(\d{1,2})\s*[日号]?/);
    if (monthDay) {
        let year = now.getFullYear();
        let value = calendarDateFromParts(year, Number(monthDay[1]), Number(monthDay[2]));
        if (value && parseCalendarDate(value) < new Date(now.getFullYear(), now.getMonth(), now.getDate())) {
            value = calendarDateFromParts(year + 1, Number(monthDay[1]), Number(monthDay[2]));
        }
        return value;
    }
    for (const [label, offset] of Object.entries(relativeDates)) {
        if (!source.includes(label)) continue;
        const date = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12, 0, 0, 0);
        date.setDate(date.getDate() + offset); return formatCalendarDate(date);
    }
    return null;
}

export function parseCalendarInput(input, now = new Date()) {
    const source = String(input ?? '').trim();
    const date = extractCalendarDate(source, now);
    if (!date) return { ok: false, reason: '未识别到日期，请使用 YYYY MM DD 或 <YYYY MM DD><日程>。' };
    const tagParts = [...source.matchAll(/<\s*([^<>]+?)\s*>/g)].map(match => match[1].trim());
    const dateTagIndex = tagParts.findIndex(part => extractCalendarDate(`<${part}>`, now) === date);
    const taggedTitle = dateTagIndex >= 0 ? tagParts[dateTagIndex + 1] : '';
    const stripped = source
        .replace(/<\s*[^<>]+?\s*>/g, ' ')
        .replace(/\d{4}[\s年./-]+\d{1,2}[\s月./-]+\d{1,2}\s*日?/g, ' ')
        .replace(/\d{1,2}\s*月\s*\d{1,2}\s*[日号]?/g, ' ')
        .replace(/今天|今日|明天|明日|后天/g, ' ')
        .replace(/\s+/g, ' ').trim();
    const title = cleanText(taggedTitle || stripped, CALENDAR_LIMITS.title);
    return title ? { ok: true, event: { date, title, note: '', source: 'manual' } }
        : { ok: false, reason: '已识别日期，但日程标题为空。' };
}

export function extractContextCalendarEvents(text, now = new Date()) {
    const lines = String(text ?? '').split(/\r?\n|[。！？]/).map(line => line.trim()).filter(Boolean);
    const seen = new Set();
    const events = [];
    for (const line of lines.slice(-80)) {
        const date = extractCalendarDate(line, now);
        if (!date) continue;
        const title = cleanText(line.replace(/<\s*[^<>]+?\s*>/g, ' ').replace(/\s+/g, ' '), CALENDAR_LIMITS.title);
        const key = `${date}\u0000${title}`;
        if (!title || seen.has(key)) continue;
        seen.add(key); events.push({ date, title, note: '从当前聊天上下文识别', source: 'context' });
    }
    return events.slice(0, 20);
}


function firstJsonObject(raw) {
    const source = String(raw ?? '').replace(/```(?:json)?/gi, '').trim();
    for (let start = source.indexOf('{'); start >= 0; start = source.indexOf('{', start + 1)) {
        let depth = 0, quoted = false, escaped = false;
        for (let index = start; index < source.length; index += 1) {
            const character = source[index];
            if (quoted) {
                if (escaped) escaped = false;
                else if (character === '\\') escaped = true;
                else if (character === '"') quoted = false;
                continue;
            }
            if (character === '"') quoted = true;
            else if (character === '{') depth += 1;
            else if (character === '}' && --depth === 0) {
                try { return JSON.parse(source.slice(start, index + 1)); } catch (error) { break; }
            }
        }
    }
    throw new Error('AI 未返回可解析的日历 JSON');
}

export function parseCalendarAiResponse(raw, { start = new Date(), days = 7 } = {}) {
    const data = firstJsonObject(raw);
    if (!plainRecord(data) || data.version !== 1 || data.kind !== 'calendar_events' || !Array.isArray(data.events)) {
        throw new Error('AI 日历响应协议无效');
    }
    const allowed = new Set(['version', 'kind', 'events']);
    const extra = Object.keys(data).find(key => !allowed.has(key));
    if (extra) throw new Error(`AI 日历响应包含额外字段：${extra}`);
    const allowedDates = new Set(calendarWeekKeys(start, days));
    const seen = new Set();
    const events = [];
    for (const rawEvent of data.events.slice(0, days * 6)) {
        if (!plainRecord(rawEvent)) continue;
        const unsupported = Object.keys(rawEvent).find(key => !['date', 'title', 'note'].includes(key));
        if (unsupported || !allowedDates.has(rawEvent.date)) continue;
        try {
            const event = normalizeCalendarEvent({ ...rawEvent, source: 'ai' }, rawEvent.date);
            const key = `${event.date}\u0000${event.title}`;
            if (seen.has(key)) continue;
            seen.add(key); events.push(event);
        } catch (error) {}
    }
    if (!events.length) throw new Error('AI 未返回未来七日内的有效日程');
    return events;
}

export function mergeCalendarEvents(scope, events, {
    replaceAiInDates = false, replaceAiInWindow = false, windowStart = new Date(), days = 7,
    timestamp = Date.now(),
} = {}) {
    let next = normalizeCalendarScope(scope);
    const incomingDates = new Set(events.map(event => event.date));
    const replacementDates = replaceAiInWindow ? new Set(calendarWeekKeys(windowStart, days)) : incomingDates;
    if (replaceAiInDates || replaceAiInWindow) {
        for (const date of replacementDates) {
            const retained = (next.events[date] || []).filter(event => event.source !== 'ai');
            if (retained.length) next.events[date] = retained; else delete next.events[date];
        }
    }
    for (const event of events) next = upsertCalendarEvent(next, event, timestamp);
    return next;
}

export function renderCalendarInjection(scope, { start = new Date(), days = 7 } = {}) {
    const normalized = normalizeCalendarScope(scope);
    const lines = [];
    for (const date of calendarWeekKeys(start, days)) {
        for (const event of normalized.events[date] || []) {
            const note = event.note ? `（${event.note.replace(/\s+/g, ' ').slice(0, 180)}）` : '';
            lines.push(`${date}｜${event.title}${note}`);
        }
    }
    return lines.length ? lines.join('\n').slice(0, 6000) : '';
}

export function createEmptyCalendarScope() {
    return { autoAdjust: false, events: {}, lastGeneratedAt: 0, lastAdjustedAt: 0 };
}
