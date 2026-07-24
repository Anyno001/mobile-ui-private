import { DEFAULT_CALENDAR_GENERATION_RULE, parseCalendarDate } from './calendar-model.js';
import { predictCyclePhase } from './calendar-cycle-model.js';
import { holidayYearFromCache } from './calendar-holiday.js';
import { DEFAULT_RECIPE_GENERATION_RULE, RECIPE_MEAL_LABELS, RECIPE_MEAL_TYPES, recipeDayFor } from './calendar-recipe-model.js';
import { weatherCodeLabel } from './calendar-weather.js';
import { resolveWeatherForDate, weatherSourceLabel } from './calendar-weather-source.js';
import {
    CLOSE_ICON_SVG, CYCLE_FERTILE_ICON_SVG, EDIT_ICON_SVG, FLOWER_BUD_ICON_SVG,
    MORE_ICON_SVG, REFRESH_ICON_SVG, TRASH_ICON_SVG, WEATHER_ICON_SVG,
} from './icons.js';
import { escapeAttr, escapeHtml } from './ui.js';

const detailDate = new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric' });
const detailWeekday = new Intl.DateTimeFormat('zh-CN', { weekday: 'long' });
const CYCLE_DETAILS = {
    period: { label: '经期', icon: FLOWER_BUD_ICON_SVG },
    ovulatory: { label: '易孕期', icon: CYCLE_FERTILE_ICON_SVG },
};

export const occasionTypeLabel = type => type === 'birthday' ? '生日' : '纪念日';

function inlineEntryActions(kind, id, title) {
    const attrs = `data-entry-kind="${kind}" data-entry-id="${escapeAttr(id)}"`;
    return `<span class="pm-calendar-inline-actions"><button type="button" data-action="calendar-edit-entry" ${attrs} aria-label="编辑${escapeAttr(title)}" title="编辑">${EDIT_ICON_SVG}</button><button type="button" class="is-danger" data-action="calendar-delete-entry" ${attrs} aria-label="删除${escapeAttr(title)}" title="删除">${TRASH_ICON_SVG}</button></span>`;
}

function eventRows(scope, occasionsByDate, date, editing = false) {
    const events = scope.events[date] || [];
    const occasionRows = (occasionsByDate.get(date) || []).map(occasion => `<article class="pm-calendar-event is-occasion" data-occasion-id="${escapeAttr(occasion.id)}">
        <div><b>${escapeHtml(occasion.title)}</b><span>${occasionTypeLabel(occasion.type)}${occasion.leapAdjusted ? '（闰日顺延）' : ''}${occasion.note ? ` · ${escapeHtml(occasion.note)}` : ''}</span></div>
        ${editing ? inlineEntryActions('occasion', occasion.id, occasion.title) : ''}
    </article>`);
    const eventItems = events.map(event => `<article class="pm-calendar-event" data-event-id="${escapeAttr(event.id)}">
        <div><b>${escapeHtml(event.title)}</b>${event.note ? `<span>${escapeHtml(event.note)}</span>` : ''}</div>
        ${editing ? inlineEntryActions('event', event.id, event.title) : ''}
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
    const resolved = resolveWeatherForDate(weatherStore, date);
    if (resolved.status !== 'available') {
        return `<p class="pm-calendar-empty-day">无法推演 · ${escapeHtml(resolved.unavailableReason)}</p>`;
    }
    return `<div class="pm-calendar-weather"><span class="pm-calendar-status-copy"><b>${resolved.day.tempMin}℃~${resolved.day.tempMax}℃</b><small>${escapeHtml(weatherCodeLabel(resolved.day.weatherCode))}</small></span><span class="pm-calendar-status-icon" aria-hidden="true">${WEATHER_ICON_SVG}</span></div>`;
}

function cycleRow(cycleScope, date) {
    const prediction = predictCyclePhase(cycleScope, date);
    const detail = CYCLE_DETAILS[prediction.phase];
    if (!detail) return '';
    const statusLabel = prediction.status === 'override' ? '手动记录' : '周期预测';
    return `<div class="pm-calendar-cycle is-${prediction.phase}"><span class="pm-calendar-status-copy"><b>${detail.label}</b><small>${statusLabel}</small></span><span class="pm-calendar-status-icon" aria-hidden="true">${detail.icon}</span></div>`;
}

function recipeRows(recipeScope, date, editing = false) {
    const day = recipeDayFor(recipeScope, date);
    return RECIPE_MEAL_TYPES.flatMap(mealType => day[mealType]?.text ? [
        `<article class="pm-calendar-event is-recipe" data-recipe-meal="${mealType}"><div><b>${RECIPE_MEAL_LABELS[mealType]}</b><span>${escapeHtml(day[mealType].text)}</span></div>${editing ? `<span class="pm-calendar-inline-actions"><button type="button" data-action="calendar-recipe-edit" data-meal-type="${mealType}" aria-label="编辑${RECIPE_MEAL_LABELS[mealType]}" title="编辑">${EDIT_ICON_SVG}</button><button type="button" class="is-danger" data-action="calendar-recipe-delete" data-meal-type="${mealType}" aria-label="删除${RECIPE_MEAL_LABELS[mealType]}" title="删除">${TRASH_ICON_SVG}</button></span>` : ''}</article>`,
    ] : []).join('');
}

export function renderSelectedDateDetail(
    scope, occasionsByDate, holidayCache, weatherStore, cycleScope, selectedDate, viewMode, relativeLabel = '', recipeScope = {}, detailEditing = false,
    detailRegenerating = false,
) {
    const parsed = parseCalendarDate(selectedDate);
    if (viewMode === 'recipe') {
        const content = recipeRows(recipeScope, selectedDate, detailEditing);
        const actions = `<div class="pm-calendar-detail-actions"><button type="button" class="pm-calendar-detail-more" data-action="calendar-toggle-detail-edit" aria-label="${detailEditing ? '关闭编辑状态' : '编辑这一天的菜谱'}" title="${detailEditing ? '关闭编辑状态' : '编辑这一天的菜谱'}" aria-pressed="${detailEditing}">${detailEditing ? CLOSE_ICON_SVG : MORE_ICON_SVG}</button></div>`;
        const editActions = detailEditing ? `<div class="pm-calendar-detail-edit-actions"><button type="button" class="pm-calendar-inline-add" data-action="calendar-recipe-add" ${detailRegenerating ? 'disabled' : ''}>+ 新增一条</button><button type="button" class="pm-calendar-inline-regenerate${detailRegenerating ? ' is-loading' : ''}" data-action="calendar-recipe-regenerate" aria-label="重新生成当日菜谱" title="重新生成当日菜谱" aria-busy="${detailRegenerating}" ${detailRegenerating ? 'disabled' : ''}>${REFRESH_ICON_SVG}<span>重新生成</span></button></div>` : '';
        return `<section class="pm-calendar-selected-detail" data-calendar-selected-detail="${selectedDate}" data-calendar-detail-mode="recipe">
          <header><div class="pm-calendar-detail-date">${relativeLabel ? `<strong>${escapeHtml(relativeLabel)}</strong>` : ''}<span><time datetime="${selectedDate}">${escapeHtml(detailDate.format(parsed))}</time><em>${escapeHtml(detailWeekday.format(parsed))}</em></span></div>${actions}</header>
          <div class="pm-calendar-selected-content">${content || '<p class="pm-calendar-empty-day">这一天还没有菜谱。</p>'}${editActions}</div>
        </section>`;
    }
    const content = viewMode === 'weather'
        ? weatherRow(weatherStore, selectedDate)
        : viewMode === 'cycle'
            ? cycleRow(cycleScope, selectedDate)
            : `${holidayRows(holidayCache, selectedDate)}${eventRows(scope, occasionsByDate, selectedDate, detailEditing)}`;
    const emptyLabel = viewMode === 'weather' ? '这一天没有天气数据' : viewMode === 'cycle' ? '这一天没有生理期提示' : '这一天还没有安排';
    const editingLabel = viewMode === 'schedule' ? '编辑这一天' : '';
    const actions = viewMode === 'schedule' ? `<div class="pm-calendar-detail-actions">
        <button type="button" class="pm-calendar-detail-more" data-action="calendar-toggle-detail-edit" aria-label="${detailEditing ? '关闭编辑状态' : editingLabel}" title="${detailEditing ? '关闭编辑状态' : editingLabel}" aria-pressed="${detailEditing}">${detailEditing ? CLOSE_ICON_SVG : MORE_ICON_SVG}</button>
    </div>` : '';
    const addAction = viewMode === 'schedule' && detailEditing ? `<div class="pm-calendar-detail-edit-actions"><button type="button" class="pm-calendar-inline-add" data-action="calendar-add-date" ${detailRegenerating ? 'disabled' : ''}>+ 新增一条</button><button type="button" class="pm-calendar-inline-regenerate${detailRegenerating ? ' is-loading' : ''}" data-action="calendar-regenerate" aria-label="重新生成当日日程" title="重新生成当日日程" aria-busy="${detailRegenerating}" ${detailRegenerating ? 'disabled' : ''}>${REFRESH_ICON_SVG}<span>重新生成</span></button></div>` : '';
    return `<section class="pm-calendar-selected-detail" data-calendar-selected-detail="${selectedDate}" data-calendar-detail-mode="${viewMode}">
        <header><div class="pm-calendar-detail-date">${relativeLabel ? `<strong>${escapeHtml(relativeLabel)}</strong>` : ''}<span><time datetime="${selectedDate}">${escapeHtml(detailDate.format(parsed))}</time><em>${escapeHtml(detailWeekday.format(parsed))}</em></span></div>${actions}</header>
        <div class="pm-calendar-selected-content">${content || `<p class="pm-calendar-empty-day">${emptyLabel}</p>`}${addAction}</div>
    </section>`;
}

export function weatherSearchResults(results) {
    if (!results.length) return '';
    return `<div class="pm-calendar-location-results">${results.map((location, index) =>
        `<button type="button" data-action="calendar-weather-select" data-location-index="${index}"><b>${escapeHtml(location.name)}</b><span>${escapeHtml([location.admin1, location.country].filter(Boolean).join(' · '))}</span></button>`
    ).join('')}</div>`;
}

function injectionToggle(action, label, enabled) {
    return `<button type="button" class="pm-calendar-auto-switch" data-action="${action}" role="switch" aria-checked="${enabled === true}"><span><b>${label}</b><small>开启后供正文生成读取；设置按当前会话独立保存。</small></span><i aria-hidden="true"></i></button>`;
}


export function renderCalendarManagement({
    scope, holidayCache, weatherStore, cycleScope, recipeScope, weatherResults, viewMode,
    holidayAvailable = true, holidayRange = null, cycleSubjects = [], selectedCycleSubject = '__self__',
}) {
    if (viewMode === 'recipe') {
        const region = recipeScope?.regionPreference || '';
        const applied = recipeScope?.lastGeneratedRegion || '';
        const generationRule = recipeScope?.generationRule || DEFAULT_RECIPE_GENERATION_RULE;
        return `<details class="pm-calendar-management" data-calendar-management="recipe" open><summary>菜谱设置</summary><div class="pm-calendar-management-content"><section class="pm-calendar-data-tools">${injectionToggle('calendar-toggle-recipe-injection', '菜谱', scope.injectionRecipeEnabled)}</section><section class="pm-calendar-data-tools"><h3>饮食地区 / 文化</h3><div class="pm-calendar-data-row"><input data-recipe-region maxlength="120" value="${escapeAttr(region)}" placeholder="川渝、潮汕、关西或架空地区；留空按剧情推断" aria-label="菜谱饮食地区或文化"><button type="button" data-action="calendar-recipe-region-save">保存</button></div><small class="pm-calendar-attribution">${region ? `手动指定：${escapeHtml(region)}` : applied ? `最近剧情推断：${escapeHtml(applied)}` : '尚未生成地区依据'}</small></section><section class="pm-calendar-data-tools"><h3>生成规则</h3><textarea class="pm-calendar-generation-rule" data-recipe-generation-rule maxlength="3000" aria-label="菜谱生成规则">${escapeHtml(generationRule)}</textarea><div class="pm-calendar-editor-actions"><button type="button" class="is-primary" data-action="calendar-recipe-generation-rule-save">保存生成规则</button></div></section></div></details>`;
    }
    if (viewMode === 'weather') {
        const storedSource = weatherStore?.lastSuccess?.source || (weatherStore?.lastSuccess ? 'forecast' : null);
        const currentSource = storedSource ? weatherSourceLabel(storedSource) : '仅气候推演';
        return `<details class="pm-calendar-management" data-calendar-management="weather"><summary>天气设置</summary><div class="pm-calendar-management-content"><section class="pm-calendar-data-tools">${injectionToggle('calendar-toggle-weather-injection', '天气', scope.injectionWeatherEnabled)}</section><section class="pm-calendar-data-tools"><h3>天气位置</h3><div class="pm-calendar-data-row"><input data-weather-query placeholder="搜索城市或地区" maxlength="100" aria-label="搜索天气位置"><button type="button" data-action="calendar-weather-search">搜索</button><button type="button" data-action="calendar-weather-refresh">刷新</button></div>${weatherSearchResults(weatherResults)}<small class="pm-calendar-attribution">${weatherStore.location ? `${escapeHtml(weatherStore.location.name)} · 当前数据 ${escapeHtml(currentSource)} · 预报外日期使用气候推演` : '尚未设置天气位置 · 无法推演'}</small></section></div></details>`;
    }
    if (viewMode === 'cycle') {
        const startDay = cycleScope.lastPeriodStart ? Number(cycleScope.lastPeriodStart.slice(8, 10)) : 1;
        const subjects = cycleSubjects.length ? cycleSubjects : [{ value: '__self__', label: '<user>' }];
        return `<details class="pm-calendar-management" data-calendar-management="cycle" open><summary>生理期设置</summary><div class="pm-calendar-management-content"><section class="pm-calendar-data-tools">${injectionToggle('calendar-toggle-cycle-injection', '生理期', scope.injectionCycleEnabled)}</section><form class="pm-calendar-editor pm-calendar-cycle-editor" data-calendar-cycle-editor>
          <label>记录对象<select name="subject" data-action="calendar-cycle-subject" aria-label="生理期记录对象">${subjects.map(item => `<option value="${escapeAttr(item.value)}" ${item.value === selectedCycleSubject ? 'selected' : ''}>${escapeHtml(item.label)}</option>`).join('')}</select></label>
          <label class="pm-calendar-cycle-toggle"><span><b>启用生理期提示</b><small>仅在本地按当前会话和所选角色保存</small></span><span class="pm-calendar-cycle-switch"><input class="pm-calendar-cycle-input" name="enabled" type="checkbox" ${cycleScope.enabled ? 'checked' : ''} aria-label="启用生理期提示"><span class="pm-custom-check" aria-hidden="true"></span></span></label>
          <label>每月经期通常从几号开始<select name="periodStartDay" aria-label="每月经期开始日">${Array.from({ length: 28 }, (_, index) => index + 1).map(day => `<option value="${day}" ${day === startDay ? 'selected' : ''}>${day} 号</option>`).join('')}</select></label>
          <div class="pm-calendar-cycle-numbers"><label>平均周期<input name="cycleLength" type="number" min="21" max="45" value="${cycleScope.cycleLength || 28}" aria-label="平均周期天数"><small>从一次经期开始到下一次开始，常见约 21–45 天</small></label><label>经期持续<input name="periodLength" type="number" min="2" max="10" value="${cycleScope.periodLength || 5}" aria-label="经期持续天数"><small>每次经期通常持续 2–10 天</small></label></div>
          <div class="pm-calendar-editor-actions"><button type="button" data-action="calendar-cycle-clear">清除所选对象</button><button type="button" class="is-primary" data-action="calendar-cycle-save">保存生理期</button></div>
        </form></div></details>`;
    }
    const generationRule = scope.generationRule || DEFAULT_CALENDAR_GENERATION_RULE;
    return `<details class="pm-calendar-management" data-calendar-management="schedule"><summary>日历设置</summary><div class="pm-calendar-management-content">
        <section class="pm-calendar-data-tools">${injectionToggle('calendar-toggle-schedule-injection', '日程', scope.injectionScheduleEnabled)}</section>
        <section class="pm-calendar-data-tools pm-calendar-scan-card"><h3>正文日期</h3><p>识别最后一条正文中的完整日期，并设为当前故事日期。</p><div class="pm-calendar-data-row pm-calendar-date-tags-row"><input data-calendar-date-tags value="${escapeAttr((scope.dateTags || ['date']).join(', '))}" maxlength="160" placeholder="date, time_date" aria-label="正文日期标签"><button type="button" data-action="calendar-date-sync">保存并识别</button></div><button type="button" class="pm-calendar-auto-switch" data-action="calendar-toggle-auto" role="switch" aria-checked="${scope.autoAdjust}"><span><b>自动跟随正文日期</b><small>角色回复后，日历日期会随正文更新。</small></span><i aria-hidden="true"></i></button></section>
        <section class="pm-calendar-data-tools"><h3>节假日数据</h3><div class="pm-calendar-data-row pm-calendar-holiday-row"><select data-action="calendar-holiday-country" data-calendar-country aria-label="节假日国家"><option value="CN" ${holidayCache.selectedCountry === 'CN' ? 'selected' : ''}>中国</option><option value="US" ${holidayCache.selectedCountry === 'US' ? 'selected' : ''}>美国</option><option value="JP" ${holidayCache.selectedCountry === 'JP' ? 'selected' : ''}>日本</option></select><button type="button" data-action="calendar-holiday-refresh" ${holidayAvailable ? '' : 'disabled aria-disabled="true"'}>刷新节假日</button></div>${holidayAvailable ? '' : `<small class="pm-calendar-attribution">该国家在当前年代无外部数据源（仅支持 ${holidayRange?.min ?? '未知'}–${holidayRange?.max ?? '未知'} 年）</small>`}</section>
        <section class="pm-calendar-data-tools"><h3>生成规则</h3><textarea class="pm-calendar-generation-rule" data-calendar-generation-rule maxlength="3000" aria-label="日程生成规则">${escapeHtml(generationRule)}</textarea><div class="pm-calendar-editor-actions"><button type="button" class="is-primary" data-action="calendar-generation-rule-save">保存生成规则</button></div></section>
    </div></details>`;
}

export function renderCalendarMonthPanel(scope, viewYear, viewMonth, open = false) {
    const baseDate = scope.baseDate || '';
    return `<section class="pm-calendar-month-panel" data-calendar-month-panel ${open ? '' : 'hidden'}>
      <section class="pm-calendar-panel-section"><span>跳转月份</span><div class="pm-calendar-month-jump"><label>年份<input type="number" min="1" max="9999" value="${viewYear}" data-calendar-jump-year aria-label="跳转年份"></label><label>月份<input type="number" min="1" max="12" value="${viewMonth}" data-calendar-jump-month aria-label="跳转月份"></label><button type="button" data-action="calendar-month-jump">跳转</button></div></section>
      <section class="pm-calendar-panel-section"><label>当前故事日期<input type="text" inputmode="numeric" data-calendar-base-date value="${escapeAttr(baseDate)}" placeholder="例如 3726-08-17" aria-label="当前故事日期"></label><p>可直接输入日期，或跳转月份后点击下方日期。</p></section>
      <div class="pm-calendar-month-panel-actions"><button type="button" class="is-primary" data-action="calendar-base-save">应用日期</button><button type="button" data-action="calendar-base-clear" ${baseDate ? '' : 'disabled'}>使用设备日期</button><button type="button" data-action="calendar-today">定位当前日期</button></div>
    </section>`;
}

export function renderCalendarEntryDialog(selectedDate, entry = null, kind = 'event') {
    const editing = Boolean(entry);
    const occasion = kind === 'occasion';
    const unavailable = occasion ? '' : 'disabled';
    return `<div class="pm-modal pm-calendar-entry-dialog"><div class="pm-modal-header"><span></span><b>日程</b><button type="button" class="pm-modal-close" data-calendar-entry-close aria-label="关闭">${CLOSE_ICON_SVG}</button></div><form data-calendar-entry-form><button type="button" class="pm-calendar-auto-switch pm-calendar-repeat-toggle" data-calendar-repeat-toggle role="switch" aria-label="安排类型" aria-checked="${occasion}" ${editing ? 'disabled' : ''}><span><b>每年同一天重复</b><small>开启后可设置生日或纪念日</small></span><i aria-hidden="true"></i></button><input name="title" maxlength="120" placeholder="名称" aria-label="安排名称"><textarea name="note" maxlength="1000" placeholder="备注（可选）" aria-label="安排备注"></textarea><div data-calendar-occasion-fields ${occasion ? '' : 'hidden aria-hidden="true"'}><label>长期类型<select name="occasionType" ${unavailable}><option value="anniversary">纪念日</option><option value="birthday">生日</option></select></label><label>2 月 29 日在非闰年<select name="leapDayRule" ${unavailable}><option value="feb28">按 2 月 28 日显示</option><option value="mar1">按 3 月 1 日显示</option><option value="skip">该年不显示</option></select></label></div><p class="pm-calendar-entry-error" data-calendar-entry-error role="status" aria-live="polite"></p><div class="pm-calendar-entry-actions"><button type="submit" class="is-primary">保存</button></div></form></div>`;
}

export function renderRecipeMealDialog(selectedDate, mealType = 'breakfast', meal = null) {
    const normalizedType = RECIPE_MEAL_TYPES.includes(mealType) ? mealType : 'breakfast';
    return `<div class="pm-modal pm-calendar-entry-dialog pm-recipe-meal-dialog"><div class="pm-modal-header"><span></span><b>${meal ? '编辑' : '新增'} ${escapeHtml(selectedDate)} 餐食</b><button type="button" class="pm-modal-close" data-recipe-entry-close aria-label="关闭">${CLOSE_ICON_SVG}</button></div><form data-recipe-entry-form><label>餐次<select name="mealType" aria-label="菜谱餐次">${RECIPE_MEAL_TYPES.map(type => `<option value="${type}" ${type === normalizedType ? 'selected' : ''}>${RECIPE_MEAL_LABELS[type]}</option>`).join('')}</select></label><textarea name="text" maxlength="160" placeholder="填写这顿吃什么" aria-label="餐食内容">${escapeHtml(meal?.text || '')}</textarea><p class="pm-calendar-entry-error" data-recipe-entry-error role="status" aria-live="polite"></p><div class="pm-calendar-entry-actions"><button type="submit" class="is-primary">保存</button></div></form></div>`;
}