// 不从 calendar-model 引入：calendar-model 的正文识别要调用本模块，互相引用会形成循环。
const pad = value => String(value).padStart(2, '0');
const formatCalendarDate = date => `${String(date.getFullYear()).padStart(4, '0')}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
function createCalendarDate(year, month, day) {
    if (![year, month, day].every(Number.isInteger) || year < 1 || year > 9999) return null;
    const date = new Date(2000, month - 1, day, 12, 0, 0, 0);
    date.setFullYear(year);
    return date;
}
function parseCalendarDate(value) {
    const match = String(value ?? '').trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
    return match ? createCalendarDate(Number(match[1]), Number(match[2]), Number(match[3])) : null;
}

// 农历：显示与正文识别共用。依赖浏览器内置的 Intl 中国历，不可用时全部返回空值。
let formatter = null;
try { formatter = new Intl.DateTimeFormat('zh-CN-u-ca-chinese', { year: 'numeric', month: 'long', day: 'numeric' }); } catch {}

const STEMS = '甲乙丙丁戊己庚辛壬癸', BRANCHES = '子丑寅卯辰巳午未申酉戌亥';
const MONTH_NAMES = ['正', '二', '三', '四', '五', '六', '七', '八', '九', '十', '冬', '腊'];
const MONTH_ALIASES = { 一: 1, 正: 1, 端: 1, 冬: 11, 十一: 11, 腊: 12, 十二: 12 };
const DIGITS = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
const DAY_DIGITS = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];
const monthIndex = { 正月: 1, 一月: 1, 二月: 2, 三月: 3, 四月: 4, 五月: 5, 六月: 6, 七月: 7, 八月: 8, 九月: 9, 十月: 10, 十一月: 11, 冬月: 11, 十二月: 12, 腊月: 12 };

export const ganzhiOfYear = year => `${STEMS[((year - 4) % 10 + 10) % 10]}${BRANCHES[((year - 4) % 12 + 12) % 12]}`;

/** 公历日期 → { year（对应公历年）, ganzhi, month, leap, day }；不可用时返回 null。 */
export function lunarParts(date) {
    if (!formatter || !(date instanceof Date)) return null;
    try {
        const parts = formatter.formatToParts(date);
        const pick = type => parts.find(part => part.type === type)?.value || '';
        const monthText = pick('month'), leap = monthText.startsWith('闰');
        const month = monthIndex[monthText.replace(/^闰/, '')], day = Number(pick('day'));
        const year = Number(pick('relatedYear') || pick('year'));
        if (!month || !Number.isInteger(day) || !Number.isInteger(year)) return null;
        return { year, ganzhi: pick('yearName') || ganzhiOfYear(year), month, leap, day };
    } catch { return null; }
}

export const lunarMonthName = (month, leap = false) => `${leap ? '闰' : ''}${MONTH_NAMES[month - 1] || ''}月`;
export function lunarDayName(day) {
    if (day <= 10) return `初${DAY_DIGITS[day - 1]}`;
    if (day < 20) return `十${DAY_DIGITS[day - 11]}`;
    if (day === 20) return '二十';
    if (day < 30) return `廿${DAY_DIGITS[day - 21]}`;
    return '三十';
}
/** 月历格子用：初一显示月名（闰月缩成两字），其余显示日名。 */
export function lunarCellLabel(date) {
    const parts = lunarParts(date);
    if (!parts) return '';
    if (parts.day !== 1) return lunarDayName(parts.day);
    return parts.leap ? `闰${MONTH_NAMES[parts.month - 1]}` : lunarMonthName(parts.month);
}
/** 「丙午年二月初二」 */
export function lunarFullLabel(date) {
    const parts = lunarParts(date);
    return parts ? `${parts.ganzhi}年${lunarMonthName(parts.month, parts.leap)}${lunarDayName(parts.day)}` : '';
}
/** 月份标题：本月 1 日与月末所在的农历月，例如「丙午年 正月–二月」。 */
export function lunarMonthRangeLabel(year, month) {
    const first = lunarParts(createCalendarDate(year, month, 1));
    const days = new Date(Date.UTC(2001, month, 0)).getUTCDate() + (month === 2 && (year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)) ? 1 : 0);
    const last = lunarParts(createCalendarDate(year, month, days));
    if (!first || !last) return '';
    const head = lunarMonthName(first.month, first.leap), tail = lunarMonthName(last.month, last.leap);
    return `${last.ganzhi}年 ${head === tail ? head : `${head}–${tail}`}`;
}

function lunarNewYear(year) {
    for (let day = 0; day < 40; day += 1) {
        const date = createCalendarDate(year, 1, 20 + day);
        const parts = date && lunarParts(date);
        if (parts && parts.month === 1 && !parts.leap && parts.day === 1) return date;
    }
    return null;
}

/** 农历（对应公历年 year 的那一个农历年）月日 → 公历日期键；该年无此闰月或无三十日时返回 null。 */
export function lunarToSolar(year, month, day, leap = false) {
    const newYear = lunarNewYear(year);
    if (!newYear) return null;
    const estimate = new Date(newYear);
    estimate.setDate(estimate.getDate() + Math.round((month - 1) * 29.53) + day - 1);
    for (let offset = -20; offset <= 50; offset += 1) {
        const date = new Date(estimate);
        date.setDate(date.getDate() + offset);
        const parts = lunarParts(date);
        if (parts && parts.year === year && parts.month === month && parts.day === day && parts.leap === leap) return formatCalendarDate(date);
    }
    return null;
}

const numberOf = text => {
    if (/^\d+$/.test(text)) return Number(text);
    if (MONTH_ALIASES[text]) return MONTH_ALIASES[text];
    if (text.length === 1) return DIGITS[text] ?? null;
    if (text.startsWith('十')) return 10 + (DIGITS[text[1]] ?? NaN);
    const match = text.match(/^([二三])十([一二三四五六七八九])?$/);
    return match ? DIGITS[match[1]] * 10 + (match[2] ? DIGITS[match[2]] : 0) : null;
};
const parseLunarDay = text => {
    const match = text.match(/^(?:初([一二三四五六七八九十])|廿([一二三四五六七八九])|卅|(\d{1,2})|([一二三]?十[一二三四五六七八九]?|[一二三四五六七八九]))$/);
    if (!match) return null;
    if (match[1]) return DIGITS[match[1]];
    if (match[2]) return 20 + DIGITS[match[2]];
    if (text === '卅') return 30;
    return numberOf(match[3] || match[4]);
};

const LUNAR_DATE_PATTERN = /(?:(\d{4})\s*年|([甲乙丙丁戊己庚辛壬癸][子丑寅卯辰巳午未申酉戌亥])\s*年)?\s*(闰)?\s*(正|冬|腊|十[一二]|[一二三四五六七八九十]|\d{1,2})\s*月\s*(初[一二三四五六七八九十]|廿[一二三四五六七八九]|卅|[一二三]?十[一二三四五六七八九]?|[一二三四五六七八九]|\d{1,2})(?![\d十一二三四五六七八九])\s*([日号])?/;
const LUNAR_MARK = /农历|阴历|旧历|[甲乙丙丁戊己庚辛壬癸][子丑寅卯辰巳午未申酉戌亥]年/;
const LUNAR_DAY_WORD = /月\s*(?:初|廿|卅)|正月|冬月|腊月/;

/** 正文是否按农历书写：有「农历/干支年」字样，或出现「初三、廿八、正月、腊月」这类只属于农历的写法。 */
export const looksLunar = text => LUNAR_MARK.test(text) || LUNAR_DAY_WORD.test(text);

/**
 * 识别正文里的农历日期并换算为公历日期键。年份：写了公历年按该年；写了干支年取离提示日期最近的同干支年；
 * 都没写取离提示日期最近的一年。识别不到返回 null。
 */
export function extractLunarDate(text, hint = '') {
    if (!formatter) return null;
    const full = String(text ?? '');
    // 「2026年3月20日 农历二月初二」并写时只看农历字样之后的部分。
    const mark = full.search(/农历|阴历|旧历/);
    const source = mark >= 0 ? full.slice(mark) : full;
    const match = source.match(LUNAR_DATE_PATTERN);
    if (!match) return null;
    const explicitLunar = looksLunar(source) || mark >= 0;
    // 「三月十五日」这类无农历标记、带日/号的写法属于公历，交给公历识别。
    if (!explicitLunar && (match[6] || !/[初廿卅]/.test(match[5]))) return null;
    const month = numberOf(match[4]), day = parseLunarDay(match[5]), leap = Boolean(match[3]);
    if (!month || month > 12 || !day || day > 30) return null;
    const reference = parseCalendarDate(hint) || new Date();
    const referenceYear = reference.getFullYear();
    let years;
    if (match[1]) years = [Number(match[1])];
    else if (match[2]) {
        const offset = ((STEMS.indexOf(match[2][0]) * 6 - BRANCHES.indexOf(match[2][1]) * 5) % 60 + 60) % 60; // 干支序号
        const base = referenceYear - (((referenceYear - 4) % 60 + 60) % 60) + offset;
        years = [base - 60, base, base + 60];
    } else years = [referenceYear - 1, referenceYear, referenceYear + 1];
    const candidates = years.map(year => lunarToSolar(year, month, day, leap)).filter(Boolean);
    const distance = value => Math.abs(parseCalendarDate(value).getTime() - reference.getTime());
    return candidates.sort((left, right) => distance(left) - distance(right))[0] || null;
}
