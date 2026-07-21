import { parseCalendarDate } from './calendar-model.js';
import { predictCyclePhase } from './calendar-cycle-model.js';
import { holidayYearFromCache } from './calendar-holiday.js';
import { weatherCodeLabel } from './calendar-weather.js';
import { CLOSE_ICON_SVG, EDIT_ICON_SVG, EVENT_EDITOR_ICON_SVG, MORE_ICON_SVG, OCCASION_EDITOR_ICON_SVG, TRASH_ICON_SVG } from './icons.js';
import { escapeAttr, escapeHtml } from './ui.js';

const detailDate = new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric' });
const detailWeekday = new Intl.DateTimeFormat('zh-CN', { weekday: 'long' });
const CYCLE_LABELS = { period: '经期', follicular: '安全期', ovulatory: '易孕期', luteal: '安全期' };

export const occasionTypeLabel = type => type === 'birthday' ? '生日' : '纪念日';

function eventRows(scope, occasionsByDate, date) {
    const events = scope.events[date] || [];
    const occasionRows = (occasionsByDate.get(date) || []).map(occasion => `<article class="pm-calendar-event is-occasion" data-occasion-id="${escapeAttr(occasion.id)}">
        <div><b>${escapeHtml(occasion.title)}</b><span>${occasionTypeLabel(occasion.type)}${occasion.leapAdjusted ? '（闰日顺延）' : ''}${occasion.note ? ` · ${escapeHtml(occasion.note)}` : ''}</span></div>
    </article>`);
    const eventItems = events.map(event => `<article class="pm-calendar-event" data-event-id="${escapeAttr(event.id)}">
        <div><b>${escapeHtml(event.title)}</b>${event.note ? `<span>${escapeHtml(event.note)}</span>` : ''}</div>
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
    const entries = [...(scope.events[selectedDate] || []), ...(occasionsByDate.get(selectedDate) || [])];
    const content = viewMode === 'weather'
        ? weatherRow(weatherStore, selectedDate)
        : viewMode === 'cycle'
            ? cycleRow(cycleScope, selectedDate)
            : `${holidayRows(holidayCache, selectedDate)}${eventRows(scope, occasionsByDate, selectedDate)}`;
    const emptyLabel = viewMode === 'weather' ? '这一天没有天气数据' : viewMode === 'cycle' ? '这一天没有生理期提示' : '这一天还没有安排';
    const actions = viewMode === 'schedule' ? `<div class="pm-calendar-detail-actions">
        <button type="button" class="pm-calendar-detail-more" data-action="calendar-detail-menu" aria-label="管理这一天" title="管理这一天" aria-expanded="false" aria-controls="pm-calendar-detail-menu">${MORE_ICON_SVG}</button>
        <span id="pm-calendar-detail-menu" class="pm-calendar-detail-menu" hidden><button type="button" data-action="calendar-manage-date" aria-label="添加或编辑安排" title="添加或编辑安排">${EDIT_ICON_SVG}</button><button type="button" class="is-danger" data-action="calendar-delete-date" aria-label="删除安排" title="删除安排" ${entries.length ? '' : 'disabled aria-disabled="true"'}>${TRASH_ICON_SVG}</button></span>
    </div>` : '';
    return `<section class="pm-calendar-selected-detail" data-calendar-selected-detail="${selectedDate}" data-calendar-detail-mode="${viewMode}">
        <header><div class="pm-calendar-detail-date">${relativeLabel ? `<strong>${escapeHtml(relativeLabel)}</strong>` : ''}<span><time datetime="${selectedDate}">${escapeHtml(detailDate.format(parsed))}</time><em>${escapeHtml(detailWeekday.format(parsed))}</em></span></div>${actions}</header>
        <div class="pm-calendar-selected-content">${content || `<p class="pm-calendar-empty-day">${emptyLabel}</p>`}</div>
    </section>`;
}

export function weatherSearchResults(results) {
    if (!results.length) return '';
    return `<div class="pm-calendar-location-results">${results.map((location, index) =>
        `<button type="button" data-action="calendar-weather-select" data-location-index="${index}"><b>${escapeHtml(location.name)}</b><span>${escapeHtml([location.admin1, location.country].filter(Boolean).join(' · '))}</span></button>`
    ).join('')}</div>`;
}


export function renderCalendarManagement({
    scope, holidayCache, weatherStore, cycleScope, weatherResults, viewMode,
    holidayAvailable = true, holidayRange = null, cycleSubjects = [], selectedCycleSubject = '__self__',
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
    return `<details class="pm-calendar-management" data-calendar-management="schedule"><summary>日历设置</summary><div class="pm-calendar-management-content">
        <section class="pm-calendar-data-tools pm-calendar-scan-card"><h3>正文日期</h3><p>从最后一条正文读取明确日期，并将它设为日历中的“今天”。</p><div class="pm-calendar-data-row pm-calendar-date-tags-row"><input data-calendar-date-tags value="${escapeAttr((scope.dateTags || ['date']).join(', '))}" maxlength="160" placeholder="date, time_date" aria-label="正文日期标签"><button type="button" data-action="calendar-date-sync">保存并识别</button></div><button type="button" class="pm-calendar-auto-switch" data-action="calendar-toggle-auto" role="switch" aria-checked="${scope.autoAdjust}"><span><b>自动识别最后一条正文</b><small>角色回复后自动校准今天日期</small></span><i aria-hidden="true"></i></button></section>
        <section class="pm-calendar-data-tools"><h3>节假日数据</h3><div class="pm-calendar-data-row pm-calendar-holiday-row"><select data-action="calendar-holiday-country" data-calendar-country aria-label="节假日国家"><option value="CN" ${holidayCache.selectedCountry === 'CN' ? 'selected' : ''}>中国</option><option value="US" ${holidayCache.selectedCountry === 'US' ? 'selected' : ''}>美国</option><option value="JP" ${holidayCache.selectedCountry === 'JP' ? 'selected' : ''}>日本</option></select><button type="button" data-action="calendar-holiday-refresh" ${holidayAvailable ? '' : 'disabled aria-disabled="true"'}>刷新节假日</button></div>${holidayAvailable ? '' : `<small class="pm-calendar-attribution">该国家在当前年代无外部数据源（仅支持 ${holidayRange?.min ?? '未知'}–${holidayRange?.max ?? '未知'} 年）</small>`}</section>
    </div></details>`;
}

export function renderCalendarEntryDialog(selectedDate, events = [], occasions = []) {
    const options = [...events.map(item => `<option value="event:${escapeAttr(item.id)}">日程 · ${escapeHtml(item.title)}</option>`), ...occasions.map(item => `<option value="occasion:${escapeAttr(item.id)}">${occasionTypeLabel(item.type)} · ${escapeHtml(item.title)}</option>`)].join('');
    return `<div class="pm-modal pm-calendar-entry-dialog"><div class="pm-modal-header"><span></span><b>管理 ${escapeHtml(selectedDate)}</b><button type="button" class="pm-modal-close" data-calendar-entry-close aria-label="关闭">${CLOSE_ICON_SVG}</button></div><form data-calendar-entry-form><div class="pm-calendar-entry-kind" role="group" aria-label="安排类型"><button type="button" data-calendar-entry-kind="event" aria-pressed="true">${EVENT_EDITOR_ICON_SVG}<span>一次性日程</span></button><button type="button" data-calendar-entry-kind="occasion" aria-pressed="false">${OCCASION_EDITOR_ICON_SVG}<span>每年重复</span></button></div><label>编辑已有安排<select data-calendar-entry-existing><option value="">新建安排</option>${options}</select></label><input name="title" maxlength="120" placeholder="名称" aria-label="安排名称"><textarea name="note" maxlength="1000" placeholder="备注（可选）" aria-label="安排备注"></textarea><div data-calendar-occasion-fields hidden><label>长期类型<select name="occasionType"><option value="anniversary">纪念日</option><option value="birthday">生日</option></select></label><label>2 月 29 日在非闰年<select name="leapDayRule"><option value="feb28">按 2 月 28 日显示</option><option value="mar1">按 3 月 1 日显示</option><option value="skip">该年不显示</option></select></label></div><p class="pm-calendar-entry-error" data-calendar-entry-error role="status" aria-live="polite"></p><div class="pm-calendar-entry-actions"><button type="button" class="is-danger" data-calendar-entry-delete disabled>删除</button><button type="submit" class="is-primary">保存</button></div></form></div>`;
}
