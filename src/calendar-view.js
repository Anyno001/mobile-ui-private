import { parseCalendarDate } from './calendar-model.js';
import { predictCyclePhase } from './calendar-cycle-model.js';
import { holidayYearFromCache } from './calendar-holiday.js';
import { weatherCodeLabel } from './calendar-weather.js';
import { EDIT_ICON_SVG, EVENT_EDITOR_ICON_SVG, OCCASION_EDITOR_ICON_SVG, TRASH_ICON_SVG } from './icons.js';
import { escapeAttr, escapeHtml } from './ui.js';

const detailDate = new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric', weekday: 'short' });
const CYCLE_LABELS = { period: '经期', follicular: '安全期', ovulatory: '易孕期', luteal: '安全期' };

export const occasionTypeLabel = type => type === 'birthday' ? '生日' : '纪念日';

function eventRows(scope, occasionsByDate, date) {
    const events = scope.events[date] || [];
    const occasionRows = (occasionsByDate.get(date) || []).map(occasion => `<article class="pm-calendar-event is-occasion" data-occasion-id="${escapeAttr(occasion.id)}">
        <div><b>${escapeHtml(occasion.title)}</b><span>${occasionTypeLabel(occasion.type)}${occasion.leapAdjusted ? '（闰日顺延）' : ''}${occasion.note ? ` · ${escapeHtml(occasion.note)}` : ''}</span></div>
        <div class="pm-calendar-event-actions"><button type="button" data-action="calendar-occasion-edit" data-occasion-id="${escapeAttr(occasion.id)}" aria-label="编辑 ${escapeAttr(occasion.title)}" title="编辑">${EDIT_ICON_SVG}</button><button type="button" data-action="calendar-occasion-delete" data-occasion-id="${escapeAttr(occasion.id)}" aria-label="删除 ${escapeAttr(occasion.title)}">${TRASH_ICON_SVG}</button></div>
    </article>`);
    const eventItems = events.map(event => `<article class="pm-calendar-event" data-event-id="${escapeAttr(event.id)}">
        <div><b>${escapeHtml(event.title)}</b>${event.note ? `<span>${escapeHtml(event.note)}</span>` : ''}</div>
        <div class="pm-calendar-event-actions"><button type="button" data-action="calendar-edit" data-event-id="${escapeAttr(event.id)}" aria-label="编辑 ${escapeAttr(event.title)}" title="编辑">${EDIT_ICON_SVG}</button><button type="button" data-action="calendar-delete" data-event-id="${escapeAttr(event.id)}" aria-label="删除 ${escapeAttr(event.title)}">${TRASH_ICON_SVG}</button></div>
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
    return `<div class="pm-calendar-cycle"><span>生理期提示</span><b>${CYCLE_LABELS[prediction.phase] || prediction.phase}</b>${prediction.status === 'override' ? '<em>手动</em>' : ''}</div>`;
}

export function renderSelectedDateDetail(
    scope, occasionsByDate, holidayCache, weatherStore, cycleScope, selectedDate, viewMode, relativeLabel = '',
) {
    const parsed = parseCalendarDate(selectedDate);
    const content = viewMode === 'weather'
        ? weatherRow(weatherStore, selectedDate)
        : viewMode === 'cycle'
            ? cycleRow(cycleScope, selectedDate)
            : `${holidayRows(holidayCache, selectedDate)}${eventRows(scope, occasionsByDate, selectedDate)}`;
    const emptyLabel = viewMode === 'weather' ? '这一天没有天气数据' : viewMode === 'cycle' ? '这一天没有生理期提示' : '这一天还没有安排';
    return `<section class="pm-calendar-selected-detail" data-calendar-selected-detail="${selectedDate}" data-calendar-detail-mode="${viewMode}">
        <header><div>${relativeLabel ? `<span>${escapeHtml(relativeLabel)}</span>` : ''}<time datetime="${selectedDate}">${escapeHtml(detailDate.format(parsed))}</time></div></header>
        <div class="pm-calendar-selected-content">${content || `<p class="pm-calendar-empty-day">${emptyLabel}</p>`}</div>
    </section>`;
}

export function occasionList(scope) {
    if (!scope.occasions.length) return '<p class="pm-calendar-empty-day">尚未添加生日或纪念日</p>';
    return scope.occasions.map(occasion => `<article class="pm-calendar-event is-occasion" data-occasion-id="${escapeAttr(occasion.id)}">
        <div><b>${escapeHtml(occasion.title)}</b><span>${occasion.month}月${occasion.day}日 · ${occasionTypeLabel(occasion.type)}${occasion.note ? ` · ${escapeHtml(occasion.note)}` : ''}</span></div>
        <div class="pm-calendar-event-actions"><button type="button" data-action="calendar-occasion-edit" data-occasion-id="${escapeAttr(occasion.id)}" aria-label="编辑 ${escapeAttr(occasion.title)}" title="编辑">${EDIT_ICON_SVG}</button><button type="button" data-action="calendar-occasion-delete" data-occasion-id="${escapeAttr(occasion.id)}" aria-label="删除 ${escapeAttr(occasion.title)}">${TRASH_ICON_SVG}</button></div>
    </article>`).join('');
}

export function weatherSearchResults(results) {
    if (!results.length) return '';
    return `<div class="pm-calendar-location-results">${results.map((location, index) =>
        `<button type="button" data-action="calendar-weather-select" data-location-index="${index}"><b>${escapeHtml(location.name)}</b><span>${escapeHtml([location.admin1, location.country].filter(Boolean).join(' · '))}</span></button>`
    ).join('')}</div>`;
}


export function renderCalendarManagement({
    scope, occasionScope, holidayCache, weatherStore, cycleScope, weatherResults, viewMode,
    holidayAvailable = true, holidayRange = null, editorKind = 'event', cycleSubjects = [], selectedCycleSubject = '__self__',
}) {
    if (viewMode === 'weather') {
        return `<details class="pm-calendar-management" data-calendar-management="weather"><summary>天气设置</summary><div class="pm-calendar-management-content"><section class="pm-calendar-data-tools"><h3>天气位置</h3><div class="pm-calendar-data-row"><input data-weather-query placeholder="搜索城市或地区" maxlength="100" aria-label="搜索天气位置"><button type="button" data-action="calendar-weather-search">搜索</button><button type="button" data-action="calendar-weather-refresh">刷新</button></div>${weatherSearchResults(weatherResults)}<small class="pm-calendar-attribution">${weatherStore.location ? escapeHtml(weatherStore.location.name) : '尚未设置天气位置'}</small></section></div></details>`;
    }
    if (viewMode === 'cycle') {
        const startDay = cycleScope.lastPeriodStart ? Number(cycleScope.lastPeriodStart.slice(8, 10)) : 1;
        const subjects = cycleSubjects.length ? cycleSubjects : [{ value: '__self__', label: '<user>' }];
        return `<details class="pm-calendar-management" data-calendar-management="cycle" open><summary>生理期设置</summary><div class="pm-calendar-management-content"><form class="pm-calendar-editor pm-calendar-cycle-editor" data-calendar-cycle-editor>
          <label>记录对象<select name="subject" data-action="calendar-cycle-subject" aria-label="生理期记录对象">${subjects.map(item => `<option value="${escapeAttr(item.value)}" ${item.value === selectedCycleSubject ? 'selected' : ''}>${escapeHtml(item.label)}</option>`).join('')}</select></label>
          <label class="pm-calendar-cycle-toggle"><span><b>启用生理期提示</b><small>仅在本地按当前会话和所选角色保存</small></span><span class="pm-calendar-cycle-switch"><input class="pm-calendar-cycle-input" name="enabled" type="checkbox" ${cycleScope.enabled ? 'checked' : ''} aria-label="启用生理期提示"><span class="pm-custom-check" aria-hidden="true"></span></span></label>
          <label>每月经期通常从几号开始<select name="periodStartDay" aria-label="每月经期开始日">${Array.from({ length: 28 }, (_, index) => index + 1).map(day => `<option value="${day}" ${day === startDay ? 'selected' : ''}>${day} 号</option>`).join('')}</select></label>
          <div class="pm-calendar-cycle-numbers"><label>平均周期<input name="cycleLength" type="number" min="21" max="45" value="${cycleScope.cycleLength || 28}" aria-label="平均周期天数"><small>从一次经期开始到下一次开始，常见约 21–45 天</small></label><label>经期持续<input name="periodLength" type="number" min="2" max="10" value="${cycleScope.periodLength || 5}" aria-label="经期持续天数"><small>每次经期通常持续 2–10 天</small></label></div>
          <div class="pm-calendar-editor-actions"><button type="button" data-action="calendar-cycle-clear">清除所选对象</button><button type="button" class="is-primary" data-action="calendar-cycle-save">保存生理期</button></div>
        </form></div></details>`;
    }
    return `<details class="pm-calendar-management" data-calendar-management="schedule"><summary>安排管理</summary><div class="pm-calendar-management-content">
        <div class="pm-calendar-tools"><button type="button" data-action="calendar-scan">立即识别正文日期</button><button type="button" data-action="calendar-toggle-auto" aria-pressed="${scope.autoAdjust}">回复后自动识别：${scope.autoAdjust ? '开' : '关'}</button></div>
        <div class="pm-calendar-data-row pm-calendar-date-tags-row"><input data-calendar-date-tags value="${escapeAttr((scope.dateTags || ['date']).join(', '))}" maxlength="160" placeholder="date, time_date" aria-label="正文日期标签"><button type="button" data-action="calendar-date-tags-save">保存标签</button></div>
        <section class="pm-calendar-data-tools"><h3>节假日数据</h3><div class="pm-calendar-data-row pm-calendar-holiday-row"><select data-action="calendar-holiday-country" data-calendar-country aria-label="节假日国家"><option value="CN" ${holidayCache.selectedCountry === 'CN' ? 'selected' : ''}>中国</option><option value="US" ${holidayCache.selectedCountry === 'US' ? 'selected' : ''}>美国</option><option value="JP" ${holidayCache.selectedCountry === 'JP' ? 'selected' : ''}>日本</option></select><button type="button" data-action="calendar-holiday-refresh" ${holidayAvailable ? '' : 'disabled aria-disabled="true"'}>刷新节假日</button></div>${holidayAvailable ? '' : `<small class="pm-calendar-attribution">该国家在当前年代无外部数据源（仅支持 ${holidayRange?.min ?? '未知'}–${holidayRange?.max ?? '未知'} 年）</small>`}</section>
        <div class="pm-calendar-editor-stack">
        <div class="pm-calendar-editor-switch" role="group" aria-label="添加内容类型"><button type="button" data-action="calendar-editor-kind" data-editor-kind="event" aria-label="切换到日程编辑器" title="日程" aria-pressed="${editorKind !== 'occasion'}">${EVENT_EDITOR_ICON_SVG}</button><button type="button" data-action="calendar-editor-kind" data-editor-kind="occasion" aria-label="切换到生日或纪念日编辑器" title="生日或纪念日" aria-pressed="${editorKind === 'occasion'}">${OCCASION_EDITOR_ICON_SVG}</button></div>
        <form class="pm-calendar-editor" data-calendar-editor ${editorKind === 'occasion' ? 'hidden' : ''}>
          <h3>添加日程</h3>
          <div class="pm-calendar-date-fields"><input name="year" inputmode="numeric" maxlength="4" placeholder="YYYY" aria-label="年"><input name="month" inputmode="numeric" maxlength="2" placeholder="MM" aria-label="月"><input name="day" inputmode="numeric" maxlength="2" placeholder="DD" aria-label="日"></div>
          <input name="title" maxlength="120" placeholder="日程标题" aria-label="日程标题">
          <textarea name="note" maxlength="1000" placeholder="备注（可选）" aria-label="日程备注"></textarea>
          <input name="tagged" maxlength="500" placeholder="也可输入：<2027 12 03><赴宴>" aria-label="标签格式日程">
          <input name="eventId" type="hidden">
          <div class="pm-calendar-editor-actions"><button type="button" data-action="calendar-parse">识别标签</button><button type="button" data-action="calendar-cancel-edit">清空</button><button type="button" class="is-primary" data-action="calendar-save">保存</button></div>
        </form>
        <form class="pm-calendar-editor pm-calendar-occasion-editor" data-calendar-occasion-editor ${editorKind === 'occasion' ? '' : 'hidden'}>
          <h3>添加生日或纪念日</h3>
          <select name="type" aria-label="类型"><option value="birthday">生日</option><option value="anniversary">纪念日</option></select>
          <div class="pm-calendar-date-fields"><input name="month" inputmode="numeric" maxlength="2" placeholder="MM" aria-label="月"><input name="day" inputmode="numeric" maxlength="2" placeholder="DD" aria-label="日"></div>
          <input name="title" maxlength="120" placeholder="名称，例如：小林生日" aria-label="生日或纪念日名称">
          <textarea name="note" maxlength="1000" placeholder="备注（可选）" aria-label="生日或纪念日备注"></textarea>
          <label>2 月 29 日在非闰年<select name="leapDayRule"><option value="feb28">按 2 月 28 日显示</option><option value="mar1">按 3 月 1 日显示</option><option value="skip">该年不显示</option></select></label>
          <input name="occasionId" type="hidden">
          <div class="pm-calendar-editor-actions"><button type="button" data-action="calendar-occasion-cancel-edit">清空</button><button type="button" class="is-primary" data-action="calendar-occasion-save">保存</button></div>
        </form></div>
        <section class="pm-calendar-occasion-list"><h3>已保存的生日与纪念日</h3>${occasionList(occasionScope)}</section>
    </div></details>`;
}
