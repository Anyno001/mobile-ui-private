import {
    calendarDateFromParts, calendarMonthCells, calendarReferenceDate, calendarWeekKeys, createCalendarDate,
    calendarWindowDescription, formatCalendarDate, parseCalendarDate, relativeCalendarLabel, shiftCalendarMonth,
} from './calendar-model.js';
import { expandOccasions } from './calendar-occasion-model.js';
import { holidayYearFromCache, holidayYearRange, isHolidayYearSupported, normalizeHolidayCache } from './calendar-holiday.js';
import { predictCyclePhase } from './calendar-cycle-model.js';
import { outfitForDate } from './calendar-outfit-model.js';
import { RECIPE_MEAL_TYPES, recipeDayFor } from './calendar-recipe-model.js';
import { calendarGenerationCopy } from './calendar-model.js';
import { weatherCodeLabel } from './calendar-weather.js';
import { resolveWeatherForDate, weatherSourceLabel } from './calendar-weather-source.js';
import { weatherSceneKind } from './calendar-scene-art.js';
import {
    BACK_ICON_SVG, CHEVRON_DOWN_ICON_SVG, FORWARD_ICON_SVG, HOME_ICON_SVG, REFRESH_ICON_SVG, SETTINGS_ICON_SVG, SPARKLES_ICON_SVG,
    WEATHER_CLOUD_ICON_SVG, WEATHER_FOG_ICON_SVG, WEATHER_ICON_SVG, WEATHER_PARTLY_CLOUDY_ICON_SVG, WEATHER_SNOW_ICON_SVG,
    WEATHER_STORM_ICON_SVG, WEATHER_SUN_ICON_SVG,
} from './icons.js';
import { renderCalendarManagement, renderSelectedDateDetail } from './calendar-view.js';
import { escapeAttr, escapeHtml } from './ui.js';

const weekdays = ['一', '二', '三', '四', '五', '六', '日'];
const MODES = [
    ['schedule', '日程', '显示日程与假日'], ['weather', '天气', '显示天气'], ['cycle', '生理期', '显示生理期'],
    ['recipe', '菜谱', '显示菜谱'], ['outfit', '穿搭', '显示穿搭'],
];
const MODE_SETTING_TITLES = { schedule: '日程设置', weather: '天气设置', cycle: '生理期设置', recipe: '菜谱设置', outfit: '穿搭设置' };
const SCENE_ICONS = {
    clear: WEATHER_SUN_ICON_SVG, cloudy: WEATHER_PARTLY_CLOUDY_ICON_SVG, fog: WEATHER_FOG_ICON_SVG,
    snow: WEATHER_SNOW_ICON_SVG, storm: WEATHER_STORM_ICON_SVG, rain: WEATHER_ICON_SVG, overcast: WEATHER_CLOUD_ICON_SVG,
};
const shortDate = new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric' });
const headerDate = new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric' });
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

function dateMeta(scope, occasionsByDate, holidayCache, weatherStore, cycleScope, recipeScope, outfitProfile, date) {
    const parsed = parseCalendarDate(date);
    const events = scope.events[date] || [];
    const occasions = occasionsByDate.get(date) || [];
    const holidayYear = holidayYearFromCache(holidayCache, holidayCache?.selectedCountry, parsed.getFullYear());
    const holidays = (holidayYear?.entries || []).filter(item => item.date === date);
    const weather = resolveWeatherForDate(weatherStore, date, { storyWeatherEvent: scope.weatherEvent, storyWeatherEventEnabled: scope.weatherEventEnabled });
    const cycle = predictCyclePhase(cycleScope, date);
    const recipe = recipeDayFor(recipeScope, date);
    const outfit = outfitForDate(outfitProfile, date);
    return { parsed, events, occasions, holidays, weather, cycle, lunar: lunarLabel(parsed),
        hasRecipe: RECIPE_MEAL_TYPES.some(type => recipe[type]?.text), hasOutfit: Boolean(outfit?.text) };
}

const cycleBand = phase => phase === 'period' || phase === 'ovulatory' ? phase : '';

function dayCell(meta, cell, { viewMode, viewMonth, todayKey, selectedDate, bands, index }) {
    const { parsed } = meta, date = cell.date;
    const classes = ['pm-calendar-day'];
    if (parsed.getMonth() !== viewMonth - 1) classes.push('is-other-month');
    if (date === todayKey) classes.push('is-today');
    if (date === selectedDate) classes.push('is-selected');
    let sub = meta.lunar, dots = '', glyph = '';
    const summary = [];
    if (viewMode === 'schedule') {
        if (meta.holidays.length) { classes.push('has-holiday'); sub = meta.holidays[0].name; dots += '<i class="is-holiday"></i>'; }
        if (meta.events.length) { classes.push('has-schedule'); dots += '<i class="is-schedule"></i>'; }
        if (meta.occasions.length) { classes.push('has-occasion'); dots += '<i class="is-occasion"></i>'; }
        summary.push(...meta.holidays.map(item => item.name), ...meta.occasions.map(item => item.title), ...meta.events.map(item => item.title));
    } else if (viewMode === 'weather' && meta.weather.status === 'available') {
        classes.push('has-weather');
        glyph = `<span class="pm-calendar-day-glyph" aria-hidden="true">${SCENE_ICONS[weatherSceneKind(meta.weather.day.weatherCode)]}</span>`;
        summary.push(`${weatherCodeLabel(meta.weather.day.weatherCode)} ${meta.weather.day.tempMax}°`, meta.weather.sourceLabel);
    } else if (viewMode === 'cycle') {
        const band = bands[index];
        if (band) {
            classes.push('has-cycle', `is-cycle-${band}`);
            if (bands[index - 1] !== band || index % 7 === 0) classes.push('is-band-start');
            if (bands[index + 1] !== band || index % 7 === 6) classes.push('is-band-end');
            summary.push(band === 'period' ? '经期' : '易孕期');
        }
    } else if (viewMode === 'recipe' && meta.hasRecipe) { classes.push('has-recipe'); dots += '<i class="is-schedule"></i>'; summary.push('有菜谱'); }
    else if (viewMode === 'outfit' && meta.hasOutfit) { classes.push('has-outfit'); dots += '<i class="is-schedule"></i>'; summary.push('有OOTD'); }
    const label = [shortDate.format(parsed), ...summary.filter(Boolean)].join('，');
    return `<button type="button" class="${classes.join(' ')}" data-action="calendar-select-date" data-calendar-date="${date}" aria-pressed="${date === selectedDate}" aria-label="${escapeAttr(label)}"><b>${parsed.getDate()}</b>${glyph || `<span>${escapeHtml(sub)}</span>`}${dots ? `<i class="pm-calendar-day-dots" aria-hidden="true">${dots}</i>` : ''}</button>`;
}

function headerSubtitle(viewMode, { today, scope, weatherStore, view, recipeScope, occasionsByDate, holidayCache }) {
    if (viewMode === 'weather') {
        if (!weatherStore?.location) return '尚未设置天气位置';
        const source = weatherStore?.lastSuccess?.source || (weatherStore?.lastSuccess ? 'forecast' : null);
        return `${weatherStore.location.name} · ${source ? weatherSourceLabel(source) : '气候推演'}`;
    }
    if (viewMode === 'cycle' || viewMode === 'outfit') {
        const options = viewMode === 'cycle' ? view.cycleSubjects : view.outfitSubjects;
        const value = viewMode === 'cycle' ? view.cycleSubject : view.outfitSubject;
        // 穿搭的「我」也要标出，否则看不出当前记的是谁；生理期默认对象沿用原样。
        const label = value && (viewMode === 'outfit' || value !== '__self__') ? options?.find(item => item.value === value)?.label : '';
        return label ? `记录对象：${label}` : `今天 ${headerDate.format(today)}`;
    }
    if (viewMode === 'recipe') {
        const region = recipeScope?.regionPreference || '';
        const applied = recipeScope?.lastGeneratedRegion || '';
        return region ? `饮食地区：${region}` : applied ? `饮食地区：${applied}（剧情推断）` : `今天 ${headerDate.format(today)}`;
    }
    const week = calendarWeekKeys(today, 7);
    const count = week.reduce((sum, date) => sum + (scope.events[date] || []).length + (occasionsByDate.get(date) || []).length, 0);
    return count ? `未来七日${count}项安排` : `今天 ${headerDate.format(today)}`;
}

export function renderCalendarPageHtml(
    scope, occasionScope, status = '', holidayCache = {}, weatherStore = {}, cycleScope = {}, weatherResults = [],
    view = {}, recipeScope = {}, outfitProfile = {},
) {
    const today = calendarReferenceDate(scope);
    const viewMode = MODES.some(([mode]) => mode === view.viewMode) ? view.viewMode : 'schedule';
    const viewYear = Number.isInteger(view.viewYear) ? view.viewYear : today.getFullYear();
    const viewMonth = Number.isInteger(view.viewMonth) ? view.viewMonth : today.getMonth() + 1;
    const monthCells = calendarMonthCells(viewYear, viewMonth);
    const monthKeys = monthCells.flatMap(cell => cell.date ? [cell.date] : []);
    const previousMonth = shiftCalendarMonth(viewYear, viewMonth, -1);
    const nextMonth = shiftCalendarMonth(viewYear, viewMonth, 1);
    const todayKey = formatCalendarDate(today);
    const monthFirst = calendarDateFromParts(viewYear, viewMonth, 1);
    const selectedDate = monthKeys.includes(view.selectedDate) ? view.selectedDate
        : (viewYear === today.getFullYear() && viewMonth === today.getMonth() + 1 ? todayKey : monthFirst);
    const occasionsByDate = new Map();
    const occasionStart = parseCalendarDate(monthKeys[0]);
    const weekEnd = calendarWeekKeys(today, 7);
    for (const window of [{ start: occasionStart, days: monthKeys.length }, { start: today, days: weekEnd.length }]) {
        for (const occasion of expandOccasions(occasionScope, window)) {
            if (!occasionsByDate.has(occasion.date)) occasionsByDate.set(occasion.date, []);
            const list = occasionsByDate.get(occasion.date);
            if (!list.some(item => item.id === occasion.id)) list.push(occasion);
        }
    }
    const metas = monthCells.map(cell => cell.isPlaceholder ? null
        : dateMeta(scope, occasionsByDate, holidayCache, weatherStore, cycleScope, recipeScope, outfitProfile, cell.date));
    const bands = viewMode === 'cycle' ? metas.map(meta => meta ? cycleBand(meta.cycle.phase) : '') : [];
    const days = monthCells.map((cell, index) => cell.isPlaceholder
        ? '<span class="pm-calendar-day is-placeholder" aria-hidden="true"></span>'
        : dayCell(metas[index], cell, { viewMode, viewMonth, todayKey, selectedDate, bands, index })).join('');
    const legend = viewMode === 'cycle' ? '<div class="pm-calendar-legend" aria-hidden="true"><span class="is-period">经期</span><span class="is-ovulatory">易孕期</span></div>' : '';

    const relativeLabel = relativeCalendarLabel(today, selectedDate) || '';
    const detailRegenerating = viewMode === 'recipe'
        ? view.recipeGenerating === true && view.recipeGenerationTask?.mode === 'recipe-regenerate'
        : viewMode === 'outfit'
            ? view.outfitGenerating === true && view.outfitGenerationTask?.mode === 'outfit-regenerate'
        : viewMode === 'schedule' && view.generating === true && view.generationTask?.mode === 'regenerate';
    const outfitSubjectLabel = view.outfitSubject ? view.outfitSubjects?.find(item => item.value === view.outfitSubject)?.label || '' : '';
    const selectedDetail = renderSelectedDateDetail(
        scope, occasionsByDate, holidayCache, weatherStore, cycleScope, selectedDate, viewMode, relativeLabel, recipeScope,
        view.openEntryMenu || '', detailRegenerating, outfitProfile,
        { canRegenerate: selectedDate >= todayKey, outfitSubjectLabel },
    );
    const headerAction = viewMode === 'weather' ? 'calendar-weather-refresh'
        : viewMode === 'schedule' ? 'calendar-generate'
            : viewMode === 'recipe' ? 'calendar-recipe-generate'
                : viewMode === 'outfit' ? 'calendar-outfit-generate' : '';
    const recipeWindow = calendarWindowDescription(today, 7);
    const headerActionLabel = viewMode === 'weather' ? '刷新天气'
        : viewMode === 'recipe' ? `AI生成${recipeWindow.label}菜谱`
            : viewMode === 'outfit' ? `AI生成${recipeWindow.label}OOTD` : `AI${calendarGenerationCopy(today).actionLabel}`;
    const headerBusy = viewMode === 'weather' ? view.weatherRefreshing === true : viewMode === 'recipe'
        ? view.recipeGenerating === true : viewMode === 'outfit' ? view.outfitGenerating === true : viewMode === 'schedule' && view.generating === true;
    const statusBusy = viewMode === 'recipe'
        ? view.recipeGenerating === true : viewMode === 'outfit' ? view.outfitGenerating === true : viewMode === 'schedule' && view.generating === true;
    const headerIcon = ['schedule', 'recipe', 'outfit'].includes(viewMode) ? SPARKLES_ICON_SVG : REFRESH_ICON_SVG;
    const primary = headerAction ? `<div class="pm-calendar-dock"><button type="button" class="pm-calendar-primary-action${headerBusy ? ' is-loading' : ''}" data-action="${headerAction}" aria-busy="${headerBusy}" ${headerBusy ? 'disabled' : ''}>${headerIcon}<span>${escapeHtml(headerActionLabel)}</span></button></div>` : '';
    const statusClass = statusBusy ? 'pm-calendar-status is-generating' : 'pm-calendar-status';
    const statusLine = `<div class="${statusClass}" aria-live="polite">${escapeHtml(status)}</div>`;

    if (view.settingsOpen === true) {
        const holidayCountry = normalizeHolidayCache(holidayCache).selectedCountry;
        const management = renderCalendarManagement({
            scope, holidayCache, weatherStore, cycleScope, recipeScope, outfitProfile, weatherResults, viewMode,
            holidayAvailable: monthKeys.some(date => isHolidayYearSupported(holidayCountry, Number(date.slice(0, 4)))),
            holidayRange: holidayYearRange(holidayCountry), cycleSubjects: view.cycleSubjects,
            selectedCycleSubject: view.cycleSubject, outfitSubjects: view.outfitSubjects, selectedOutfitSubject: view.outfitSubject,
        });
        return `<div id="pm-calendar-app" class="pm-calendar-shell is-settings" data-calendar-view-mode="${viewMode}">
            <header class="pm-calendar-header is-sub"><button type="button" class="pm-calendar-icon-button" data-action="calendar-settings" aria-label="返回日历">${BACK_ICON_SVG}</button><h2>${MODE_SETTING_TITLES[viewMode]}</h2><span class="pm-calendar-header-spacer" aria-hidden="true"></span></header>
            ${management}
            ${statusLine}
        </div>`;
    }

    const subtitle = headerSubtitle(viewMode, { today, scope, weatherStore, view, recipeScope, occasionsByDate, holidayCache });
    const segments = MODES.map(([mode, label, aria]) =>
        `<button type="button" data-action="calendar-mode-${mode}" aria-label="${aria}" aria-pressed="${viewMode === mode}">${label}</button>`).join('');
    return `<div id="pm-calendar-app" class="pm-calendar-shell" data-calendar-view-mode="${viewMode}">
        <header class="pm-calendar-header"><div class="pm-calendar-title"><h2>日历</h2><p>${escapeHtml(subtitle)}</p></div><button type="button" class="pm-calendar-icon-button" data-action="calendar-settings" aria-label="${MODE_SETTING_TITLES[viewMode]}" title="${MODE_SETTING_TITLES[viewMode]}">${SETTINGS_ICON_SVG}</button><button type="button" class="pm-calendar-icon-button" data-action="calendar-home" aria-label="返回桌面" title="返回桌面">${HOME_ICON_SVG}</button></header>
        <div class="pm-calendar-view-switch" role="group" aria-label="日历信息分类">${segments}</div>
        <section class="pm-calendar-month" data-calendar-month-navigation tabindex="0" aria-label="${viewYear}年${viewMonth}月月历，使用左右方向键切换月份">
            <div class="pm-calendar-month-head"><button type="button" class="pm-calendar-month-nav" data-action="calendar-prev-month" aria-label="上个月" title="上个月" ${previousMonth ? '' : 'disabled'}>${BACK_ICON_SVG}</button><button type="button" class="pm-calendar-month-title" data-action="calendar-month-panel" aria-haspopup="dialog" aria-label="跳转日期"><b>${escapeHtml(monthTitle.format(createCalendarDate(viewYear, viewMonth, 1)))}</b>${CHEVRON_DOWN_ICON_SVG}</button><button type="button" class="pm-calendar-month-nav" data-action="calendar-next-month" aria-label="下个月" title="下个月" ${nextMonth ? '' : 'disabled'}>${FORWARD_ICON_SVG}</button></div>
            <div class="pm-calendar-weekdays">${weekdays.map(day => `<span>${day}</span>`).join('')}</div>
            <div class="pm-calendar-month-grid">${days}</div>
            ${legend}
        </section>
        ${selectedDetail}
        ${statusLine}
        ${primary}
    </div>`;
}
