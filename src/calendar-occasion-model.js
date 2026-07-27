import { calendarDateFromParts, calendarDateRangeKeys, parseCalendarDate } from './calendar-model.js';

export const OCCASION_STORE_VERSION = 1;
export const OCCASION_TYPES = Object.freeze(['birthday', 'anniversary']);
export const OCCASION_LEAP_DAY_RULES = Object.freeze(['feb28', 'mar1', 'skip']);
export const OCCASION_REPEAT_RULES = Object.freeze(['daily', 'weekly', 'monthly', 'yearly']);
export const OCCASION_LIMITS = Object.freeze({ scopes: 80, occasions: 80, title: 120, note: 1000 });

const plainRecord = value => value && typeof value === 'object' && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
const cleanText = (value, max) => String(value ?? '').trim().slice(0, max);
const unsafeKey = value => value === 'prototype' || Object.hasOwn(Object.prototype, value);
const timestamp = (value, fallback = 0) => Number.isFinite(value) && value >= 0 ? Math.floor(value) : fallback;
const uid = () => `occasion_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
const pad = value => String(value).padStart(2, '0');

export function isLeapYear(year) {
    return Number.isInteger(year) && year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function normalizedRepeat(value) {
    return OCCASION_REPEAT_RULES.includes(value) ? value : 'yearly';
}

function anchorDate(value, month, day) {
    return parseCalendarDate(value) || parseCalendarDate(`2000-${pad(month)}-${pad(day)}`);
}

export function isValidOccasionMonthDay(month, day) {
    const numericMonth = Number(month), numericDay = Number(day);
    if (!Number.isInteger(numericMonth) || !Number.isInteger(numericDay)) return false;
    const probe = new Date(2000, numericMonth - 1, numericDay, 12, 0, 0, 0);
    return probe.getFullYear() === 2000 && probe.getMonth() === numericMonth - 1 && probe.getDate() === numericDay;
}

function daysInCalendarMonth(year, month) {
    for (let day = 31; day >= 28; day -= 1) {
        if (calendarDateFromParts(year, month, day)) return day;
    }
    return 0;
}

export function createEmptyOccasionStore() {
    return { version: OCCASION_STORE_VERSION, scopes: {} };
}

export function createEmptyOccasionScope() {
    return { occasions: [] };
}

export function normalizeOccasion(value, now = Date.now()) {
    if (!plainRecord(value)) throw new Error('生日或纪念日必须是对象');
    const type = OCCASION_TYPES.includes(value.type) ? value.type : '';
    if (!type) throw new Error('类型必须是生日或纪念日');
    const month = Number(value.month), day = Number(value.day);
    if (!isValidOccasionMonthDay(month, day)) throw new Error('生日或纪念日日期无效');
    const date = anchorDate(value.date, month, day);
    if (!date) throw new Error('重复日程日期无效');
    const title = cleanText(value.title, OCCASION_LIMITS.title);
    if (!title) throw new Error('生日或纪念日标题不能为空');
    const createdAt = timestamp(value.createdAt, now);
    const hasRepeat = Object.hasOwn(value, 'repeat');
    const hasDate = Object.hasOwn(value, 'date');
    return {
        id: cleanText(value.id, 80) || uid(), type, month, day, title,
        note: cleanText(value.note, OCCASION_LIMITS.note),
        leapDayRule: OCCASION_LEAP_DAY_RULES.includes(value.leapDayRule) ? value.leapDayRule : 'feb28',
        ...(hasRepeat ? { repeat: normalizedRepeat(value.repeat) } : {}),
        ...(hasDate ? { date: `${date.getFullYear().toString().padStart(4, '0')}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` } : {}),
        createdAt, updatedAt: Math.max(createdAt, timestamp(value.updatedAt, createdAt)),
    };
}

export function normalizeOccasionScope(value) {
    const source = plainRecord(value) ? value : {};
    const occasions = [], seen = new Set();
    for (const raw of (Array.isArray(source.occasions) ? source.occasions : []).slice(0, OCCASION_LIMITS.occasions)) {
        try {
            const occasion = normalizeOccasion(raw);
            if (seen.has(occasion.id)) continue;
            seen.add(occasion.id); occasions.push(occasion);
        } catch (error) {}
    }
    return { occasions };
}


export function normalizeOccasionStore(value) {
    const source = plainRecord(value) ? value : {};
    const scopes = {};
    for (const [storageId, rawScope] of Object.entries(plainRecord(source.scopes) ? source.scopes : {})) {
        if (Object.keys(scopes).length >= OCCASION_LIMITS.scopes) break;
        if (!storageId || storageId !== storageId.trim() || storageId.length > 160 || unsafeKey(storageId)) continue;
        scopes[storageId] = normalizeOccasionScope(rawScope);
    }
    return { version: OCCASION_STORE_VERSION, scopes };
}

export function occasionScopeFor(store, storageId) {
    return normalizeOccasionStore(store).scopes[storageId] || createEmptyOccasionScope();
}

export function findOccasion(scope, occasionId) {
    return normalizeOccasionScope(scope).occasions.find(item => item.id === occasionId) || null;
}

export function upsertOccasion(scope, rawOccasion, now = Date.now()) {
    const next = normalizeOccasionScope(scope);
    const candidate = normalizeOccasion(rawOccasion, now);
    const duplicate = rawOccasion?.id ? null : next.occasions.find(item => item.type === candidate.type
        && item.month === candidate.month && item.day === candidate.day && item.title === candidate.title);
    const existing = next.occasions.find(item => item.id === candidate.id);
    if (!duplicate && !existing && next.occasions.length >= OCCASION_LIMITS.occasions) throw new Error('生日与纪念日数量已达上限');
    const occasion = duplicate ? normalizeOccasion({
        ...candidate, id: duplicate.id, createdAt: duplicate.createdAt, updatedAt: now,
    }, now) : candidate;
    next.occasions = next.occasions.filter(item => item.id !== occasion.id);
    next.occasions.push(occasion);
    next.occasions.sort((left, right) => left.month - right.month || left.day - right.day
        || left.type.localeCompare(right.type) || left.title.localeCompare(right.title));
    return next;
}

export function deleteOccasion(scope, occasionId) {
    const next = normalizeOccasionScope(scope);
    const occasions = next.occasions.filter(item => item.id !== occasionId);
    return { scope: { occasions }, removed: occasions.length !== next.occasions.length };
}

export function occasionDateForYear(occasionValue, year) {
    const occasion = normalizeOccasion(occasionValue, 0);
    const numericYear = Number(year);
    if (!Number.isInteger(numericYear) || (occasion.repeat || 'yearly') !== 'yearly') return null;
    let month = occasion.month, day = occasion.day, leapAdjusted = false;
    if (month === 2 && day === 29 && !isLeapYear(numericYear)) {
        if (occasion.leapDayRule === 'skip') return null;
        leapAdjusted = true;
        if (occasion.leapDayRule === 'mar1') { month = 3; day = 1; }
        else day = 28;
    }
    const date = calendarDateFromParts(numericYear, month, day);
    return date ? { date, leapAdjusted } : null;
}

export function expandOccasions(scope, { start = new Date(), days = 7 } = {}) {
    const length = Math.max(1, Math.min(366, Number.isInteger(days) ? days : 7));
    const dateKeys = calendarDateRangeKeys(start, 0, length - 1);
    const dates = new Set(dateKeys);
    const years = new Set([...dates].map(date => Number(date.slice(0, 4))));
    const result = [];
    for (const occasion of normalizeOccasionScope(scope).occasions) {
        const repeat = occasion.repeat || 'yearly';
        if (repeat === 'yearly') {
            for (const year of years) {
                const occurrence = occasionDateForYear(occasion, year);
                if (occurrence && dates.has(occurrence.date)) result.push({ ...occasion, ...occurrence });
            }
            continue;
        }
        const anchor = anchorDate(occasion.date, occasion.month, occasion.day);
        for (const date of dateKeys) {
            const parsed = parseCalendarDate(date);
            const anchorKey = `${anchor.getFullYear().toString().padStart(4, '0')}-${pad(anchor.getMonth() + 1)}-${pad(anchor.getDate())}`;
            if (!parsed || date < anchorKey) continue;
            const sameWeekday = parsed.getDay() === anchor.getDay();
            const sameMonthDay = parsed.getDate() === anchor.getDate();
            const lastDayOfMonth = !calendarDateFromParts(parsed.getFullYear(), parsed.getMonth() + 1, anchor.getDate())
                && parsed.getDate() === daysInCalendarMonth(parsed.getFullYear(), parsed.getMonth() + 1);
            if (repeat === 'daily'
                || (repeat === 'weekly' && sameWeekday)
                || (repeat === 'monthly' && (sameMonthDay || lastDayOfMonth))) {
                result.push({ ...occasion, date, leapAdjusted: false });
            }
        }
    }
    return result.sort((left, right) => left.date.localeCompare(right.date)
        || left.type.localeCompare(right.type) || left.title.localeCompare(right.title));
}
