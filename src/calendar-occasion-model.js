import { calendarDateFromParts, calendarDateRangeKeys, normalizeCalendarTime, parseCalendarDate } from './calendar-model.js';

export const OCCASION_STORE_VERSION = 1;
export const OCCASION_TYPES = Object.freeze(['birthday', 'anniversary']);
export const OCCASION_LEAP_DAY_RULES = Object.freeze(['feb28', 'mar1', 'skip']);
export const OCCASION_REPEAT_RULES = Object.freeze(['daily', 'weekly', 'biweekly', 'monthly', 'custom', 'yearly']);
export const OCCASION_LIMITS = Object.freeze({ scopes: 80, occasions: 80, title: 120, note: 1000, intervalDays: 9999, excludedDates: 9999, seasonWeeks: 104, seasonName: 20 });

const plainRecord = value => value && typeof value === 'object' && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
const cleanText = (value, max) => String(value ?? '').trim().slice(0, max);
const unsafeKey = value => value === 'prototype' || Object.hasOwn(Object.prototype, value);
const timestamp = (value, fallback = 0) => Number.isFinite(value) && value >= 0 ? Math.floor(value) : fallback;
const uid = () => `occasion_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
const pad = value => String(value).padStart(2, '0');
const dateKey = value => {
    const date = parseCalendarDate(value);
    return date ? `${date.getFullYear().toString().padStart(4, '0')}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` : '';
};
const normalizedExcludedDates = value => [...new Set((Array.isArray(value) ? value : [])
    .map(dateKey).filter(Boolean))].sort().slice(0, OCCASION_LIMITS.excludedDates);
const WEEKDAY_REPEATS = new Set(['weekly', 'biweekly']);
const normalizedWeekdays = value => [...new Set((Array.isArray(value) ? value : [])
    .map(Number).filter(day => Number.isInteger(day) && day >= 0 && day <= 6))].sort((left, right) => left - right);
const DAY_MS = 86400000;
// 以周一为一周第一天，返回该周周一（与 parseCalendarDate 一样取当天正午，避免夏令时误差）。
const mondayOf = date => { const monday = new Date(date); monday.setDate(date.getDate() - ((date.getDay() + 6) % 7)); return monday; };
const weeksBetween = (from, to) => Math.round((mondayOf(to).getTime() - mondayOf(from).getTime()) / (7 * DAY_MS));

/** 阶段：{ start: 'YYYY-MM-DD', weeks: 1–104, name?: 阶段名称（如学期、赛季，≤20 字） }，无效时返回 null。 */
export function normalizeOccasionSeason(value) {
    if (!plainRecord(value)) return null;
    const start = dateKey(value.start);
    const weeks = Number(value.weeks);
    const name = cleanText(value.name, OCCASION_LIMITS.seasonName);
    return start && Number.isInteger(weeks) && weeks >= 1 && weeks <= OCCASION_LIMITS.seasonWeeks ? { start, weeks, ...(name ? { name } : {}) } : null;
}

export function occasionSeasonEnd(seasonValue) {
    const season = normalizeOccasionSeason(seasonValue);
    return season ? calendarDateRangeKeys(season.start, season.weeks * 7 - 1, season.weeks * 7 - 1)[0] || '' : '';
}

/** 某日在阶段中的第几周；阶段外或未设阶段返回 null。 */
export function seasonWeekIndex(seasonValue, date) {
    const season = normalizeOccasionSeason(seasonValue);
    const target = parseCalendarDate(dateKey(date));
    if (!season || !target) return null;
    const elapsed = Math.round((target.getTime() - parseCalendarDate(season.start).getTime()) / DAY_MS);
    if (elapsed < 0 || elapsed >= season.weeks * 7) return null;
    return { week: Math.floor(elapsed / 7) + 1, total: season.weeks };
}

export function isLeapYear(year) {
    return Number.isInteger(year) && year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function normalizedRepeat(value) {
    return OCCASION_REPEAT_RULES.includes(value) ? value : 'yearly';
}

function normalizedIntervalDays(value) {
    const numeric = Number(value);
    return Number.isInteger(numeric) && numeric >= 1 && numeric <= OCCASION_LIMITS.intervalDays ? numeric : 1;
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
    const repeat = hasRepeat ? normalizedRepeat(value.repeat) : undefined;
    const time = normalizeCalendarTime(value.time);
    const weekdays = WEEKDAY_REPEATS.has(repeat) ? normalizedWeekdays(value.weekdays) : [];
    const seasonOnly = value.seasonOnly === true && Boolean(repeat) && repeat !== 'yearly';
    return {
        id: cleanText(value.id, 80) || uid(), type, month, day, title,
        ...(time ? { time } : {}),
        note: cleanText(value.note, OCCASION_LIMITS.note),
        leapDayRule: OCCASION_LEAP_DAY_RULES.includes(value.leapDayRule) ? value.leapDayRule : 'feb28',
        ...(repeat ? { repeat } : {}),
        ...(repeat === 'custom' ? { intervalDays: normalizedIntervalDays(value.intervalDays) } : {}),
        ...(weekdays.length ? { weekdays } : {}),
        ...(seasonOnly ? { seasonOnly } : {}),
        ...(hasDate ? { date: `${date.getFullYear().toString().padStart(4, '0')}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` } : {}),
        ...(normalizedExcludedDates(value.excludedDates).length ? { excludedDates: normalizedExcludedDates(value.excludedDates) } : {}),
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
    const season = normalizeOccasionSeason(source.season);
    return season ? { occasions, season } : { occasions };
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
    return { scope: { ...next, occasions }, removed: occasions.length !== next.occasions.length };
}

export function excludeOccasionDate(scope, occasionId, occurrenceDate, now = Date.now()) {
    const date = dateKey(occurrenceDate);
    if (!date) throw new Error('要清理的日程日期无效');
    const next = normalizeOccasionScope(scope);
    const occasion = findOccasion(next, occasionId);
    if (!occasion) throw new Error('重复日程不存在');
    const occursOnDate = expandOccasions({ occasions: [occasion], season: next.season }, {
        start: parseCalendarDate(date), days: 1,
    }).some(item => item.id === occasionId && item.date === date);
    if (!occursOnDate) throw new Error('该日期没有可清理的重复日程');
    return upsertOccasion(next, {
        ...occasion, excludedDates: [...(occasion.excludedDates || []), date], updatedAt: now,
    }, now);
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
    const normalizedScope = normalizeOccasionScope(scope);
    const season = normalizedScope.season || null;
    const seasonStart = season ? parseCalendarDate(season.start) : null;
    const seasonEnd = season ? occasionSeasonEnd(season) : '';
    for (const occasion of normalizedScope.occasions) {
        const repeat = occasion.repeat || 'yearly';
        const excludedDates = new Set(occasion.excludedDates || []);
        if (repeat === 'yearly') {
            for (const year of years) {
                const occurrence = occasionDateForYear(occasion, year);
                if (occurrence && dates.has(occurrence.date) && !excludedDates.has(occurrence.date)) result.push({ ...occasion, ...occurrence });
            }
            continue;
        }
        const anchor = anchorDate(occasion.date, occasion.month, occasion.day);
        const weekdays = occasion.weekdays?.length ? new Set(occasion.weekdays) : null;
        if (occasion.seasonOnly && !season) continue;
        const weekBase = seasonStart || anchor;
        for (const date of dateKeys) {
            const parsed = parseCalendarDate(date);
            const anchorKey = `${anchor.getFullYear().toString().padStart(4, '0')}-${pad(anchor.getMonth() + 1)}-${pad(anchor.getDate())}`;
            if (!parsed || date < anchorKey) continue;
            if (occasion.seasonOnly && (date < season.start || date > seasonEnd)) continue;
            const sameWeekday = weekdays ? weekdays.has(parsed.getDay()) : parsed.getDay() === anchor.getDay();
            const elapsedDays = Math.round((parsed.getTime() - anchor.getTime()) / 86400000);
            const sameMonthDay = parsed.getDate() === anchor.getDate();
            const lastDayOfMonth = !calendarDateFromParts(parsed.getFullYear(), parsed.getMonth() + 1, anchor.getDate())
                && parsed.getDate() === daysInCalendarMonth(parsed.getFullYear(), parsed.getMonth() + 1);
            if (excludedDates.has(date)) continue;
            if (repeat === 'daily'
                || (repeat === 'weekly' && sameWeekday)
                || (repeat === 'biweekly' && sameWeekday && (weekdays
                    ? ((weeksBetween(weekBase, parsed) % 2) + 2) % 2 === 0 : elapsedDays % 14 === 0))
                || (repeat === 'monthly' && (sameMonthDay || lastDayOfMonth))) {
                result.push({ ...occasion, date, leapAdjusted: false });
            } else if (repeat === 'custom' && elapsedDays % normalizedIntervalDays(occasion.intervalDays) === 0) {
                result.push({ ...occasion, date, leapAdjusted: false });
            }
        }
    }
    return result.sort((left, right) => left.date.localeCompare(right.date)
        || left.type.localeCompare(right.type) || left.title.localeCompare(right.title));
}
