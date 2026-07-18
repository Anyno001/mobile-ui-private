import { predictCyclePhase } from './calendar-cycle-model.js';
import { holidayYearFromCache } from './calendar-holiday.js';
import { weatherCodeLabel } from './calendar-weather.js';
import { TRASH_ICON_SVG } from './icons.js';
import { escapeAttr, escapeHtml } from './ui.js';

const detailDate = new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric', weekday: 'short' });
const CYCLE_LABELS = { period: '经期', follicular: '卵泡期', ovulatory: '排卵期', luteal: '黄体期' };

export const occasionTypeLabel = type => type === 'birthday' ? '生日' : '纪念日';

function eventRows(scope, occasionsByDate, date) {
    const events = scope.events[date] || [];
    const occasionRows = (occasionsByDate.get(date) || []).map(occasion => `<article class="pm-calendar-event is-occasion" data-occasion-id="${escapeAttr(occasion.id)}">
        <div><b>${escapeHtml(occasion.title)}</b><span>${occasionTypeLabel(occasion.type)}${occasion.leapAdjusted ? '（闰日顺延）' : ''}${occasion.note ? ` · ${escapeHtml(occasion.note)}` : ''}</span></div>
        <div class="pm-calendar-event-actions"><button type="button" data-action="calendar-occasion-edit" data-occasion-id="${escapeAttr(occasion.id)}">编辑</button><button type="button" data-action="calendar-occasion-delete" data-occasion-id="${escapeAttr(occasion.id)}" aria-label="删除 ${escapeAttr(occasion.title)}">${TRASH_ICON_SVG}</button></div>
    </article>`);
    const eventItems = events.map(event => `<article class="pm-calendar-event" data-event-id="${escapeAttr(event.id)}">
        <div><b>${escapeHtml(event.title)}</b>${event.note ? `<span>${escapeHtml(event.note)}</span>` : ''}</div>
        <div class="pm-calendar-event-actions"><button type="button" data-action="calendar-edit" data-event-id="${escapeAttr(event.id)}">编辑</button><button type="button" data-action="calendar-delete" data-event-id="${escapeAttr(event.id)}" aria-label="删除 ${escapeAttr(event.title)}">${TRASH_ICON_SVG}</button></div>
    </article>`);
    return [...occasionRows, ...eventItems].join('');
}

function holidayRows(cache, date) {
    const year = Number(date.slice(0, 4));
    const row = holidayYearFromCache(cache, cache?.selectedCountry, year);
    return (row?.entries || []).filter(item => item.date === date).map(item =>
        `<article class="pm-calendar-event is-holiday"><div><b>${escapeHtml(item.name)}</b><span>${escapeHtml(item.kind === 'workday' ? '调休工作日' : item.kind === 'in_lieu' ? '调休' : item.kind === 'observed' ? '替代休息日' : '节假日')}</span></div></article>`
    ).join('');
}

function weatherRow(weatherStore, date) {
    const day = weatherStore?.lastSuccess?.forecast?.days?.find(item => item.date === date);
    if (!day) return '';
    return `<div class="pm-calendar-weather"><span>${escapeHtml(weatherCodeLabel(day.weatherCode))}</span><b>${day.tempMin}°/${day.tempMax}°C</b></div>`;
}

function cycleRow(cycleScope, date) {
    const prediction = predictCyclePhase(cycleScope, date);
    if (!prediction.phase) return '';
    return `<div class="pm-calendar-cycle"><span>周期提示</span><b>${CYCLE_LABELS[prediction.phase] || prediction.phase}</b>${prediction.status === 'override' ? '<em>手动</em>' : ''}</div>`;
}

export function renderSelectedDateDetail(
    scope, occasionsByDate, holidayCache, weatherStore, cycleScope, selectedDate, viewMode,
) {
    const parsed = new Date(`${selectedDate}T12:00:00`);
    const content = viewMode === 'life'
        ? `${weatherRow(weatherStore, selectedDate)}${cycleRow(cycleScope, selectedDate)}`
        : `${holidayRows(holidayCache, selectedDate)}${eventRows(scope, occasionsByDate, selectedDate)}`;
    const emptyLabel = viewMode === 'life' ? '这一天没有天气或周期提示' : '这一天还没有安排';
    return `<section class="pm-calendar-selected-detail" data-calendar-selected-detail="${selectedDate}" data-calendar-detail-mode="${viewMode}">
        <header><div><span>已选日期</span><b>${escapeHtml(detailDate.format(parsed))}</b></div><time datetime="${selectedDate}">${escapeHtml(selectedDate)}</time></header>
        <div class="pm-calendar-selected-content">${content || `<p class="pm-calendar-empty-day">${emptyLabel}</p>`}</div>
    </section>`;
}

export function occasionList(scope) {
    if (!scope.occasions.length) return '<p class="pm-calendar-empty-day">尚未添加生日或纪念日</p>';
    return scope.occasions.map(occasion => `<article class="pm-calendar-event is-occasion" data-occasion-id="${escapeAttr(occasion.id)}">
        <div><b>${escapeHtml(occasion.title)}</b><span>${occasion.month}月${occasion.day}日 · ${occasionTypeLabel(occasion.type)}${occasion.note ? ` · ${escapeHtml(occasion.note)}` : ''}</span></div>
        <div class="pm-calendar-event-actions"><button type="button" data-action="calendar-occasion-edit" data-occasion-id="${escapeAttr(occasion.id)}">编辑</button><button type="button" data-action="calendar-occasion-delete" data-occasion-id="${escapeAttr(occasion.id)}" aria-label="删除 ${escapeAttr(occasion.title)}">${TRASH_ICON_SVG}</button></div>
    </article>`).join('');
}

export function weatherSearchResults(results) {
    if (!results.length) return '';
    return `<div class="pm-calendar-location-results">${results.map((location, index) =>
        `<button type="button" data-action="calendar-weather-select" data-location-index="${index}"><b>${escapeHtml(location.name)}</b><span>${escapeHtml([location.admin1, location.country].filter(Boolean).join(' · '))}</span></button>`
    ).join('')}</div>`;
}
