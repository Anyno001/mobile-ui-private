import {
    calendarDateFromParts, calendarMonthCells, calendarMonthKeys, calendarReferenceDate, createCalendarDate,
    calendarWindowDescription, formatCalendarDate, parseCalendarDate, relativeCalendarLabel, shiftCalendarMonth,
} from './calendar-model.js';
import { expandOccasions } from './calendar-occasion-model.js';
import {
    HOLIDAY_YEAR_RANGE, buildCulturalFestivals, holidayYearFromCache, holidayYearRange,
    isHolidayYearSupported, mergeCalendarDateFacts, normalizeHolidayCache,
} from './calendar-holiday.js';
import { predictCyclePhase } from './calendar-cycle-model.js';
import { RECIPE_MEAL_LABELS, RECIPE_MEAL_TYPES, recipeDayFor } from './calendar-recipe-model.js';
import { calendarGenerationCopy } from './calendar-model.js';
import { weatherCodeLabel } from './calendar-weather.js';
import { resolveWeatherForDate } from './calendar-weather-source.js';
import {
    BACK_ICON_SVG, CALENDAR_ICON_SVG, CHEVRON_DOWN_ICON_SVG, CYCLE_MARK_HTML, FORWARD_ICON_SVG,
    HOME_ICON_SVG, RECIPE_ICON_SVG, REFRESH_ICON_SVG, SPARKLES_ICON_SVG, WEATHER_ICON_SVG,
} from './icons.js';
import { renderCalendarManagement, renderCalendarMonthPanel, renderSelectedDateDetail } from './calendar-view.js';
import { escapeAttr, escapeHtml } from './ui.js';

const weekdays = ['一', '二', '三', '四', '五', '六', '日'];
const cycleLabels = { period: '经期', follicular: '', ovulatory: '易孕期', luteal: '' };
const shortDate = new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric' });
const monthTitle = new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'long' });
let lunarFormatter = null;
try { lunarFormatter = new Intl.DateTimeFormat('zh-CN-u-ca-chinese', { month: 'short', day: 'numeric' }); } catch {}

function lunarDayLabel(value) {
    const day = Number(value);
    if (!Number.isInteger(day) || day < 1 || day > 30) return '';
    if (day <= 10) return `初${['一','二','三','四','五','六','七','八','九','十'][day - 1]}`;
    if (day < 20) return `十${['一','二','三','四','五','六','七','八','九'][day - 11]}`;
    if (day === 20) return '二十';
    if (day < 30) return `廿${['一','二','三','四','五','六','七','八','九'][day - 21]}`;
    return '三十';
}

function lunarLabel(date) {
    if (!lunarFormatter) return '';
    try {
        const parts = lunarFormatter.formatToParts(date);
        const month = parts.find(part => part.type === 'month')?.value || '';
        const day = Number(parts.find(part => part.type === 'day')?.value);
        return day === 1 ? month : lunarDayLabel(day);
    } catch { return ''; }
}

function dateMeta(scope, occasionsByDate, holidayCache, weatherStore, cycleScope, recipeScope, date, viewMode) {
    const parsed = parseCalendarDate(date);
    const events = scope.events[date] || [];
    const occasions = occasionsByDate.get(date) || [];
    const holidayYear = holidayYearFromCache(holidayCache, holidayCache?.selectedCountry, parsed.getFullYear());
    const holidays = (holidayYear?.entries || []).filter(item => item.date === date);
    const weather = resolveWeatherForDate(weatherStore, date);
    const cycle = predictCyclePhase(cycleScope, date);
    const recipe = recipeDayFor(recipeScope, date);
    const firstMeal = RECIPE_MEAL_TYPES.find(type => recipe[type]?.text);
    const summary = viewMode === 'weather'
        ? (weather.status === 'available' ? `${weatherCodeLabel(weather.day.weatherCode)} ${weather.day.tempMax}°` : '') || lunarLabel(parsed)
        : viewMode === 'cycle'
            ? (cycle.phase ? cycleLabels[cycle.phase] || '' : '') || lunarLabel(parsed)
            : viewMode === 'recipe'
                ? (firstMeal ? `${RECIPE_MEAL_LABELS[firstMeal]} ${recipe[firstMeal].text}` : '') || lunarLabel(parsed)
                : holidays[0]?.name || occasions[0]?.title || events[0]?.title || lunarLabel(parsed);
    return { parsed, events, occasions, holidays, weather, cycle, recipe, summary,
        hasSchedule: events.length > 0 || occasions.length > 0, hasRecipe: Boolean(firstMeal) };
}

export function renderCalendarPageHtml(
    scope, occasionScope, status = '', holidayCache = {}, weatherStore = {}, cycleScope = {}, weatherResults = [],
    view = {}, recipeScope = {},
) {
    const today = calendarReferenceDate(scope);
    const viewMode = ['schedule', 'weather', 'cycle', 'recipe'].includes(view.viewMode) ? view.viewMode : 'schedule';
    const viewYear = Number.isInteger(view.viewYear) ? view.viewYear : today.getFullYear();
    const viewMonth = Number.isInteger(view.viewMonth) ? view.viewMonth : today.getMonth() + 1;
    const monthCells = calendarMonthCells(viewYear, viewMonth);
    const monthKeys = monthCells.flatMap(cell => cell.date ? [cell.date] : []);
    const previousMonth = shiftCalendarMonth(viewYear, viewMonth, -1);
    const nextMonth = shiftCalendarMonth(viewYear, viewMonth, 1);
    const monthStart = parseCalendarDate(monthKeys[0]);
    const todayKey = formatCalendarDate(today);
    const monthFirst = calendarDateFromParts(viewYear, viewMonth, 1);
    const selectedDate = monthKeys.includes(view.selectedDate) ? view.selectedDate
        : (viewYear === today.getFullYear() && viewMonth === today.getMonth() + 1 ? todayKey : monthFirst);
    const occasionsByDate = new Map();
    for (const occasion of expandOccasions(occasionScope, { start: monthStart, days: monthKeys.length })) {
        if (!occasionsByDate.has(occasion.date)) occasionsByDate.set(occasion.date, []);
        occasionsByDate.get(occasion.date).push(occasion);
    }
    const days = monthCells.map(cell => {
        if (cell.isPlaceholder) return '<span class="pm-calendar-day is-placeholder" aria-hidden="true"></span>';
        const date = cell.date;
        const meta = dateMeta(scope, occasionsByDate, holidayCache, weatherStore, cycleScope, recipeScope, date, viewMode);
        const classes = ['pm-calendar-day'];
        if (meta.parsed.getMonth() !== viewMonth - 1) classes.push('is-other-month');
        if (date === todayKey) classes.push('is-today');
        if (date === selectedDate) classes.push('is-selected');
        if (viewMode === 'weather' && meta.weather.status === 'available') classes.push('has-weather');
        else if (viewMode === 'cycle' && ['period', 'ovulatory'].includes(meta.cycle.phase)) classes.push(`has-cycle is-cycle-${meta.cycle.phase}`);
        else if (viewMode === 'recipe' && meta.hasRecipe) classes.push('has-recipe');
        else if (viewMode === 'schedule') {
            if (meta.hasSchedule) classes.push('has-schedule');
            if (meta.holidays.length) classes.push('has-holiday');
            if (meta.occasions.length) classes.push('has-occasion');
        }
        const labels = [shortDate.format(meta.parsed), meta.summary,
            viewMode === 'weather' && meta.weather.status === 'available' ? meta.weather.sourceLabel : ''].filter(Boolean).join('，');
        return `<button type="button" class="${classes.join(' ')}" data-action="calendar-select-date" data-calendar-date="${date}" aria-pressed="${date === selectedDate}" aria-label="${escapeAttr(labels)}"><b>${meta.parsed.getDate()}</b><span>${escapeHtml(meta.summary)}</span><i aria-hidden="true"></i></button>`;
    }).join('');

    const relativeLabel = relativeCalendarLabel(today, selectedDate) || '';
    const detailRegenerating = viewMode === 'recipe'
        ? view.recipeGenerating === true && view.recipeGenerationTask?.mode === 'recipe-regenerate'
        : viewMode === 'schedule' && view.generating === true && view.generationTask?.mode === 'regenerate';
    const selectedDetail = renderSelectedDateDetail(
        scope, occasionsByDate, holidayCache, weatherStore, cycleScope, selectedDate, viewMode, relativeLabel, recipeScope,
        view.detailEditing === true, detailRegenerating,
    );
    const headerAction = viewMode === 'weather' ? 'calendar-weather-refresh'
        : viewMode === 'schedule' ? 'calendar-generate'
            : viewMode === 'recipe' ? 'calendar-recipe-generate' : '';
    const recipeWindow = calendarWindowDescription(today, 7);
    const headerActionLabel = viewMode === 'weather' ? '刷新天气'
        : viewMode === 'recipe' ? `AI 生成${recipeWindow.label}菜谱` : calendarGenerationCopy(today).actionLabel;
    const holidayCountry = normalizeHolidayCache(holidayCache).selectedCountry;
    const holidayRange = holidayYearRange(holidayCountry);
    const holidayAvailable = monthKeys.some(date => isHolidayYearSupported(holidayCountry, Number(date.slice(0, 4))));
    const management = renderCalendarManagement({
        scope, holidayCache, weatherStore, cycleScope, recipeScope, weatherResults, viewMode,
        holidayAvailable, holidayRange, editorKind: view.editorKind, cycleSubjects: view.cycleSubjects,
        selectedCycleSubject: view.cycleSubject,
    });
    const monthPanel = renderCalendarMonthPanel(scope, viewYear, viewMonth, view.monthPanelOpen === true);
    const headerBusy = viewMode === 'weather' ? view.weatherRefreshing === true : viewMode === 'recipe'
        ? view.recipeGenerating === true : viewMode === 'schedule' && view.generating === true;
    const statusBusy = viewMode === 'recipe'
        ? view.recipeGenerating === true : viewMode === 'schedule' && view.generating === true;
    const headerIcon = viewMode === 'schedule' || viewMode === 'recipe' ? SPARKLES_ICON_SVG : REFRESH_ICON_SVG;
    const headerButton = headerAction ? `<button type="button" class="pm-calendar-header-action ${headerBusy ? 'is-loading' : ''}" data-action="${headerAction}" aria-label="${headerActionLabel}" title="${headerActionLabel}" aria-busy="${headerBusy}" ${headerBusy ? 'disabled' : ''}>${headerIcon}</button>` : '';
    const statusClass = statusBusy ? 'pm-calendar-status is-generating' : 'pm-calendar-status';
    return `<div id="pm-calendar-app" class="pm-calendar-shell" data-calendar-view-mode="${viewMode}">
        <header class="pm-calendar-header"><span class="pm-calendar-header-side is-left"><button type="button" data-action="calendar-home" aria-label="返回桌面" title="返回桌面">${HOME_ICON_SVG}</button></span><div class="pm-calendar-title-row"><span class="pm-calendar-title-control"><button type="button" data-action="calendar-month-panel" aria-label="打开月份与时间设置" aria-expanded="${view.monthPanelOpen === true}"><b>${escapeHtml(monthTitle.format(createCalendarDate(viewYear, viewMonth, 1)))}</b></button><span class="pm-calendar-title-chevron ${view.monthPanelOpen === true ? 'is-expanded' : ''}" aria-hidden="true">${CHEVRON_DOWN_ICON_SVG}</span></span></div><span class="pm-calendar-header-side is-right">${headerButton}</span></header>
        ${monthPanel}
        <div class="pm-calendar-month" data-calendar-month-navigation tabindex="0" aria-label="${viewYear}年${viewMonth}月月历，使用左右方向键切换月份"><div class="pm-calendar-weekdays">${weekdays.map(day => `<span>周${day}</span>`).join('')}</div><div class="pm-calendar-month-grid">${days}</div></div>
        <div class="pm-calendar-view-switch" role="group" aria-label="月份与日历信息分类"><button type="button" class="pm-calendar-month-nav" data-action="calendar-prev-month" aria-label="上个月" title="上个月" ${previousMonth ? '' : 'disabled'}>${BACK_ICON_SVG}</button><button type="button" data-action="calendar-mode-schedule" aria-label="显示日程与假日" aria-pressed="${viewMode === 'schedule'}" title="日程与假日">${CALENDAR_ICON_SVG}</button><button type="button" data-action="calendar-mode-weather" aria-label="显示天气" aria-pressed="${viewMode === 'weather'}" title="天气">${WEATHER_ICON_SVG}</button><button type="button" data-action="calendar-mode-cycle" aria-label="显示生理期" aria-pressed="${viewMode === 'cycle'}" title="生理期">${CYCLE_MARK_HTML}</button><button type="button" data-action="calendar-mode-recipe" aria-label="显示菜谱" aria-pressed="${viewMode === 'recipe'}" title="菜谱">${RECIPE_ICON_SVG}</button><button type="button" class="pm-calendar-month-nav" data-action="calendar-next-month" aria-label="下个月" title="下个月" ${nextMonth ? '' : 'disabled'}>${FORWARD_ICON_SVG}</button></div>
        ${selectedDetail}
        ${management}
        <div class="${statusClass}" aria-live="polite">${escapeHtml(status)}</div>
    </div>`;
}
