import { calendarDateFromParts, createCalendarDate, parseCalendarDate } from './calendar-model.js';

export const HOLIDAY_CACHE_VERSION = 1;
export const HOLIDAY_COUNTRIES = Object.freeze(['CN', 'US', 'JP']);
export const HOLIDAY_KINDS = Object.freeze(['holiday', 'observed', 'workday', 'in_lieu', 'cultural']);
export const HOLIDAY_LIMITS = Object.freeze({ years: 6, entries: 80, name: 100 });
export const HOLIDAY_YEAR_RANGE = Object.freeze({ min: 1900, max: 2100 });
export const FIXED_CULTURAL_FESTIVALS = Object.freeze([
    Object.freeze({ month: 2, day: 14, name: '情人节' }),
    Object.freeze({ month: 3, day: 14, name: '白色情人节' }),
    Object.freeze({ month: 10, day: 31, name: '万圣节' }),
    Object.freeze({ month: 12, day: 25, name: '圣诞节' }),
]);
export const HOLIDAY_COUNTRY_YEAR_RANGES = Object.freeze({
    CN: HOLIDAY_YEAR_RANGE,
    US: HOLIDAY_YEAR_RANGE,
    JP: Object.freeze({ min: 2007, max: 2099 }),
});
export const CHINESE_DAYS_YEAR_URL = year => `https://cdn.jsdelivr.net/npm/chinese-days/dist/years/${year}.json`;

const plainRecord = value => value && typeof value === 'object' && !Array.isArray(value);
const pad = value => String(value).padStart(2, '0');
const dateKey = date => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
export function holidayYearRange(country) {
    return HOLIDAY_COUNTRY_YEAR_RANGES[country] || null;
}
export function isHolidayYearSupported(country, value) {
    const range = holidayYearRange(country), year = Number(value);
    return !!range && Number.isInteger(year) && year >= range.min && year <= range.max;
}

function entry(date, name, kind = 'holiday', source = 'local-rule') {
    if (!parseCalendarDate(date)) throw new Error('节假日日期无效');
    const cleanName = String(name ?? '').trim().slice(0, HOLIDAY_LIMITS.name);
    if (!cleanName || !HOLIDAY_KINDS.includes(kind)) throw new Error('节假日字段无效');
    return { date, name: cleanName, kind, source };
}

function sortEntries(entries) {
    const seen = new Set();
    return entries.filter(item => {
        const key = `${item.date}|${item.kind}|${item.name}`;
        if (seen.has(key)) return false;
        seen.add(key); return true;
    }).sort((left, right) => left.date.localeCompare(right.date) || left.kind.localeCompare(right.kind));
}

function culturalNameKey(value) {
    const normalized = String(value ?? '').toLowerCase().replace(/[\s'’()._-]+/g, '');
    if (['圣诞节', 'christmas', 'christmasday'].includes(normalized)) return 'christmas';
    if (['情人节', 'valentinesday', 'valentineday'].includes(normalized)) return 'valentine';
    if (['白色情人节', 'whiteday'].includes(normalized)) return 'white-day';
    if (['万圣节', 'halloween'].includes(normalized)) return 'halloween';
    if (['七夕', '七夕节', 'qixi', 'qixifestival'].includes(normalized)) return 'qixi';
    return normalized;
}

function createChineseCalendarFormatter() {
    try {
        return new Intl.DateTimeFormat('zh-CN-u-ca-chinese', { month: 'long', day: 'numeric' });
    } catch (error) { return null; }
}

function qixiDate(year, formatter) {
    if (!formatter || typeof formatter.formatToParts !== 'function') return null;
    const start = createCalendarDate(year, 6, 1), end = createCalendarDate(year, 10, 1);
    if (!start || !end) return null;
    for (const date = new Date(start); date < end; date.setDate(date.getDate() + 1)) {
        try {
            const parts = formatter.formatToParts(date);
            const month = parts.find(part => part.type === 'month')?.value;
            const day = Number(parts.find(part => part.type === 'day')?.value);
            if (month === '七月' && day === 7) return dateKey(date);
        } catch (error) { return null; }
    }
    return null;
}

export function buildCulturalFestivals(year, { lunarFormatter } = {}) {
    const numericYear = Number(year);
    if (!Number.isInteger(numericYear) || numericYear < HOLIDAY_YEAR_RANGE.min || numericYear > HOLIDAY_YEAR_RANGE.max) {
        throw new Error('文化节日年份无效');
    }
    const rows = FIXED_CULTURAL_FESTIVALS.map(item =>
        entry(calendarDateFromParts(numericYear, item.month, item.day), item.name, 'cultural', 'cultural-rule'));
    const formatter = lunarFormatter === undefined ? createChineseCalendarFormatter() : lunarFormatter;
    const qixi = qixiDate(numericYear, formatter);
    if (qixi) rows.push(entry(qixi, '七夕', 'cultural', 'chinese-calendar'));
    return sortEntries(rows);
}

const CONTEXT_FESTIVAL_FIELDS = Object.freeze(['worldBookText', 'mainChatText', 'cardScenario']);
const CONTEXT_FESTIVAL_DATE_SOURCE = '(?:\\d{4}年\\d{1,2}月\\d{1,2}日|\\d{4}-(?:\\d{1,2})-(?:\\d{1,2})|\\d{4}/(?:\\d{1,2})/(?:\\d{1,2})|\\d{4}\\.(?:\\d{1,2})\\.(?:\\d{1,2}))';
const CONTEXT_FESTIVAL_NAME_SOURCE = "(?:[\\u4e00-\\u9fff]{2,40}(?:节日|节庆|庆典|纪念日|纪念活动|祭典|祭礼|庆祝日|庆祝活动|祭|节)|[A-Za-z][A-Za-z0-9 '’-]{1,38}(?:Festival|Day|Memorial))";
const CONTEXT_FESTIVAL_DATE_FIRST = new RegExp(`(?<!\\d)(${CONTEXT_FESTIVAL_DATE_SOURCE})(?!\\d)\\s*(?:将|会|拟)?\\s*(?:举行|举办|庆祝|迎接|纪念|定为|称为|名为|是|为)\\s*(${CONTEXT_FESTIVAL_NAME_SOURCE})`, 'g');
const CONTEXT_FESTIVAL_NAME_FIRST = new RegExp(`(${CONTEXT_FESTIVAL_NAME_SOURCE})\\s*(?:将于|定于|将在|于|在)\\s*(?<!\\d)(${CONTEXT_FESTIVAL_DATE_SOURCE})(?!\\d)`, 'g');

function parseContextFestivalDate(value) {
    const chinese = String(value).match(/^(\d{4})年(\d{1,2})月(\d{1,2})日$/);
    const numeric = String(value).match(/^(\d{4})([-/.])(\d{1,2})\2(\d{1,2})$/);
    return chinese ? calendarDateFromParts(Number(chinese[1]), Number(chinese[2]), Number(chinese[3]))
        : numeric ? calendarDateFromParts(Number(numeric[1]), Number(numeric[3]), Number(numeric[4])) : null;
}

function appendContextFestival(rows, dateText, name) {
    const date = parseContextFestivalDate(dateText);
    if (!date) return;
    try { rows.push(entry(date, name, 'cultural', 'context-evidence')); } catch (error) {}
}

export function extractContextFestivals(context) {
    const rows = [];
    for (const field of CONTEXT_FESTIVAL_FIELDS) {
        const source = typeof context?.[field] === 'string' ? context[field].slice(0, 12000) : '';
        const clauses = source.split(/[\r\n。！？!?；;，,]/).map(value => value.trim()).filter(Boolean).slice(-320);
        for (const clause of clauses) {
            for (const match of clause.matchAll(CONTEXT_FESTIVAL_DATE_FIRST)) appendContextFestival(rows, match[1], match[2]);
            for (const match of clause.matchAll(CONTEXT_FESTIVAL_NAME_FIRST)) appendContextFestival(rows, match[2], match[1]);
        }
    }
    return sortEntries(rows);
}

export function mergeCalendarDateFacts(holidayEntries, culturalEntries) {
    const rows = [], seen = new Set();
    for (const raw of [...(Array.isArray(holidayEntries) ? holidayEntries : []), ...(Array.isArray(culturalEntries) ? culturalEntries : [])]) {
        try {
            if (!plainRecord(raw)) continue;
            const normalized = entry(raw.date, raw.name, raw.kind, String(raw.source || '').trim().slice(0, 40) || 'unknown');
            const key = `${normalized.date}|${culturalNameKey(normalized.name)}`;
            if (seen.has(key)) continue;
            seen.add(key); rows.push(normalized);
        } catch (error) {}
    }
    return sortEntries(rows);
}

function nthWeekday(year, month, weekday, nth) {
    const date = new Date(year, month - 1, 1, 12);
    date.setDate(1 + ((7 + weekday - date.getDay()) % 7) + (nth - 1) * 7);
    return dateKey(date);
}

function lastWeekday(year, month, weekday) {
    const date = new Date(year, month, 0, 12);
    date.setDate(date.getDate() - ((7 + date.getDay() - weekday) % 7));
    return dateKey(date);
}

function observedDate(date) {
    const parsed = parseCalendarDate(date);
    if (parsed.getDay() === 6) parsed.setDate(parsed.getDate() - 1);
    else if (parsed.getDay() === 0) parsed.setDate(parsed.getDate() + 1);
    return dateKey(parsed);
}

export function createEmptyHolidayCache() {
    return { version: HOLIDAY_CACHE_VERSION, selectedCountry: 'CN', years: {} };
}

export function parseChineseDaysYear(value, year) {
    if (!isHolidayYearSupported('CN', year) || !plainRecord(value)) throw new Error('中国节假日年度数据无效');
    const result = [];
    const append = (records, kind) => {
        if (!plainRecord(records)) return;
        for (const [date, rawLabel] of Object.entries(records)) {
            if (!date.startsWith(`${year}-`) || !parseCalendarDate(date)) continue;
            const parts = String(rawLabel ?? '').split(',');
            const name = (parts[1] || parts[0] || '').trim();
            if (name) result.push(entry(date, name, kind, 'chinese-days'));
        }
    };
    append(value.holidays, 'holiday');
    append(value.workdays, 'workday');
    append(value.inLieuDays, 'in_lieu');
    if (!result.some(item => item.kind === 'holiday')) throw new Error('中国节假日年度数据缺少 holidays');
    return sortEntries(result);
}


function usBaseHolidays(year) {
    const fixed = [
        [1, 1, 'New Year’s Day'], [6, 19, 'Juneteenth National Independence Day'],
        [7, 4, 'Independence Day'], [11, 11, 'Veterans Day'], [12, 25, 'Christmas Day'],
    ];
    const rows = fixed.filter(([month]) => month !== 6 || year >= 2021)
        .map(([month, day, name]) => entry(calendarDateFromParts(year, month, day), name));
    rows.push(entry(nthWeekday(year, 1, 1, 3), 'Martin Luther King Jr. Day'));
    rows.push(entry(nthWeekday(year, 2, 1, 3), 'Washington’s Birthday'));
    rows.push(entry(lastWeekday(year, 5, 1), 'Memorial Day'));
    rows.push(entry(nthWeekday(year, 9, 1, 1), 'Labor Day'));
    rows.push(entry(nthWeekday(year, 10, 1, 2), 'Columbus Day'));
    rows.push(entry(nthWeekday(year, 11, 4, 4), 'Thanksgiving Day'));
    return rows;
}

export function buildUsFederalHolidays(year) {
    if (!isHolidayYearSupported('US', year)) throw new Error('美国节假日年份无效');
    const numericYear = Number(year), rows = [];
    for (const baseYear of [numericYear - 1, numericYear, numericYear + 1]) {
        for (const holiday of usBaseHolidays(baseYear)) {
            if (holiday.date.startsWith(`${numericYear}-`)) rows.push(holiday);
            const observed = observedDate(holiday.date);
            if (observed !== holiday.date && observed.startsWith(`${numericYear}-`)) {
                rows.push(entry(observed, `${holiday.name} (Observed)`, 'observed'));
            }
        }
    }
    return sortEntries(rows);
}

function japaneseEquinoxDay(year, season) {
    const offset = year - 1980;
    const base = season === 'spring' ? 20.8431 : 23.2488;
    return Math.floor(base + 0.242194 * offset - Math.floor(offset / 4));
}

function japaneseBaseHolidays(year) {
    if (year < 2007 || year > 2099) throw new Error('日本节假日仅支持 2007 至 2099 年');
    const rows = [
        [1, 1, '元日'], [2, 11, '建国記念の日'], [4, 29, '昭和の日'],
        [5, 3, '憲法記念日'], [5, 4, 'みどりの日'], [5, 5, 'こどもの日'],
        [11, 3, '文化の日'], [11, 23, '勤労感謝の日'],
    ].map(([month, day, name]) => entry(calendarDateFromParts(year, month, day), name));
    rows.push(entry(nthWeekday(year, 1, 1, 2), '成人の日'));
    rows.push(entry(calendarDateFromParts(year, 3, japaneseEquinoxDay(year, 'spring')), '春分の日'));
    rows.push(entry(nthWeekday(year, 9, 1, 3), '敬老の日'));
    rows.push(entry(calendarDateFromParts(year, 9, japaneseEquinoxDay(year, 'autumn')), '秋分の日'));
    // 2019 was the imperial transition year and had no Emperor's Birthday holiday.
    if (year >= 2020) rows.push(entry(calendarDateFromParts(year, 2, 23), '天皇誕生日'));
    else if (year <= 2018) rows.push(entry(calendarDateFromParts(year, 12, 23), '天皇誕生日'));
    const marine = year === 2020 ? [7, 23] : year === 2021 ? [7, 22] : null;
    rows.push(entry(marine ? calendarDateFromParts(year, ...marine) : nthWeekday(year, 7, 1, 3), '海の日'));
    if (year >= 2016) {
        const mountain = year === 2020 ? [8, 10] : year === 2021 ? [8, 8] : [8, 11];
        rows.push(entry(calendarDateFromParts(year, ...mountain), '山の日'));
    }
    const sports = year === 2020 ? [7, 24] : year === 2021 ? [7, 23] : null;
    rows.push(entry(sports ? calendarDateFromParts(year, ...sports) : nthWeekday(year, 10, 1, 2), year >= 2020 ? 'スポーツの日' : '体育の日'));
    if (year === 2019) {
        rows.push(entry('2019-04-30', '国民の休日'), entry('2019-05-01', '天皇の即位の日'));
        rows.push(entry('2019-05-02', '国民の休日'), entry('2019-10-22', '即位礼正殿の儀'));
    }
    return rows;
}

export function buildJapanNationalHolidays(year) {
    const numericYear = Number(year);
    let rows = japaneseBaseHolidays(numericYear);
    const occupied = new Set(rows.map(item => item.date));
    for (const holiday of [...rows]) {
        const date = parseCalendarDate(holiday.date);
        if (date.getDay() !== 0) continue;
        do { date.setDate(date.getDate() + 1); } while (occupied.has(dateKey(date)));
        const substitute = dateKey(date);
        occupied.add(substitute);
        rows.push(entry(substitute, `${holiday.name} 振替休日`, 'observed'));
    }
    for (let month = 1; month <= 12; month += 1) {
        const last = new Date(numericYear, month, 0, 12).getDate();
        for (let day = 2; day < last; day += 1) {
            const date = calendarDateFromParts(numericYear, month, day);
            const probe = parseCalendarDate(date);
            if (probe.getDay() === 0 || occupied.has(date)) continue;
            probe.setDate(probe.getDate() - 1); const before = dateKey(probe);
            probe.setDate(probe.getDate() + 2); const after = dateKey(probe);
            if (occupied.has(before) && occupied.has(after)) {
                occupied.add(date); rows.push(entry(date, '国民の休日', 'observed'));
            }
        }
    }
    return sortEntries(rows);
}


function normalizeHolidayEntries(value, country, year) {
    if (!Array.isArray(value) || !isHolidayYearSupported(country, year)) return [];
    const result = [];
    for (const raw of value.slice(0, HOLIDAY_LIMITS.entries)) {
        try {
            if (!plainRecord(raw) || !String(raw.date || '').startsWith(`${year}-`)) continue;
            result.push(entry(raw.date, raw.name, raw.kind, String(raw.source || '').trim().slice(0, 40) || 'unknown'));
        } catch (error) {}
    }
    return sortEntries(result);
}

export function normalizeHolidayCache(value) {
    const source = plainRecord(value) ? value : {};
    const selectedCountry = HOLIDAY_COUNTRIES.includes(source.selectedCountry) ? source.selectedCountry : 'CN';
    const years = {};
    const candidates = [];
    for (const [key, raw] of Object.entries(plainRecord(source.years) ? source.years : {})) {
        if (!plainRecord(raw) || !isHolidayYearSupported(raw.country, raw.year)) continue;
        const expectedKey = `${raw.country}:${Number(raw.year)}`;
        if (key !== expectedKey) continue;
        const entries = normalizeHolidayEntries(raw.entries, raw.country, Number(raw.year));
        if (!entries.length) continue;
        candidates.push({
            key, value: {
                country: raw.country, year: Number(raw.year), entries,
                fetchedAt: Number.isFinite(raw.fetchedAt) && raw.fetchedAt >= 0 ? Math.floor(raw.fetchedAt) : 0,
                source: String(raw.source || '').trim().slice(0, 40) || 'unknown',
            },
        });
    }
    candidates.sort((left, right) => right.value.fetchedAt - left.value.fetchedAt || right.key.localeCompare(left.key));
    for (const candidate of candidates.slice(0, HOLIDAY_LIMITS.years)) years[candidate.key] = candidate.value;
    return { version: HOLIDAY_CACHE_VERSION, selectedCountry, years };
}

export function selectHolidayCountry(cache, country) {
    if (!HOLIDAY_COUNTRIES.includes(country)) throw new Error('节假日国家无效');
    return { ...normalizeHolidayCache(cache), selectedCountry: country };
}

export function putHolidayYear(cache, country, year, entries, { fetchedAt = Date.now(), source = 'local-rule' } = {}) {
    if (!isHolidayYearSupported(country, year)) throw new Error('节假日国家或年份无效');
    const normalizedEntries = normalizeHolidayEntries(entries, country, Number(year));
    if (!normalizedEntries.length) throw new Error('节假日年度数据为空');
    const normalized = normalizeHolidayCache(cache);
    normalized.years[`${country}:${Number(year)}`] = {
        country, year: Number(year), entries: normalizedEntries,
        fetchedAt: Number.isFinite(fetchedAt) && fetchedAt >= 0 ? Math.floor(fetchedAt) : Date.now(),
        source: String(source || '').trim().slice(0, 40) || 'unknown',
    };
    return normalizeHolidayCache(normalized);
}

export function holidayYearFromCache(cache, country, year) {
    return normalizeHolidayCache(cache).years[`${country}:${Number(year)}`] || null;
}

export async function resolveHolidayYear({
    country, year, cache, fetchImpl = globalThis.fetch, timeoutMs = 10000, signal,
} = {}) {
    if (!isHolidayYearSupported(country, year)) throw new Error('节假日国家或年份无效');
    const numericYear = Number(year);
    if (country === 'US' || country === 'JP') {
        const entries = country === 'US' ? buildUsFederalHolidays(numericYear) : buildJapanNationalHolidays(numericYear);
        return { entries, cache: putHolidayYear(cache, country, numericYear, entries, { fetchedAt: 0 }), stale: false, source: 'local-rule' };
    }
    const previous = holidayYearFromCache(cache, country, numericYear);
    if (typeof fetchImpl !== 'function') {
        if (previous) return { entries: previous.entries, cache: normalizeHolidayCache(cache), stale: true, source: previous.source };
        throw new Error('中国节假日服务不可用，且没有可用缓存');
    }
    const controller = new AbortController();
    const abort = () => controller.abort();
    if (signal?.aborted) controller.abort();
    else signal?.addEventListener?.('abort', abort, { once: true });
    const timer = setTimeout(() => controller.abort(), Math.max(1000, Math.min(30000, Number(timeoutMs) || 10000)));
    try {
        const response = await fetchImpl(CHINESE_DAYS_YEAR_URL(numericYear), { signal: controller.signal });
        if (!response?.ok) throw new Error(`HTTP ${response?.status || 0}`);
        const entries = parseChineseDaysYear(await response.json(), numericYear);
        const nextCache = putHolidayYear(cache, country, numericYear, entries, { source: 'chinese-days' });
        return { entries, cache: nextCache, stale: false, source: 'chinese-days' };
    } catch (error) {
        if (previous) return { entries: previous.entries, cache: normalizeHolidayCache(cache), stale: true, source: previous.source, error };
        throw new Error(`中国节假日加载失败：${error?.name === 'AbortError' ? '请求超时或已取消' : error?.message || '未知错误'}`);
    } finally {
        clearTimeout(timer);
        signal?.removeEventListener?.('abort', abort);
    }
}
