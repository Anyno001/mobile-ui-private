import { DEFAULT_CALENDAR_GENERATION_RULE, calendarDateRangeKeys, parseCalendarDate } from './calendar-model.js';
import { normalizeCycleScope, phaseForDay, predictCyclePhase } from './calendar-cycle-model.js';
import { holidayYearFromCache } from './calendar-holiday.js';
import { DEFAULT_OUTFIT_GENERATION_RULE, outfitForDate } from './calendar-outfit-model.js';
import { DEFAULT_RECIPE_GENERATION_RULE, RECIPE_MEAL_LABELS, RECIPE_MEAL_TYPES, recipeDayFor } from './calendar-recipe-model.js';
import { cycleRingSvg, weatherSceneKind, weatherSceneSvg } from './calendar-scene-art.js';
import { weatherCodeLabel } from './calendar-weather.js';
import { resolveWeatherForDate, storyWeatherEventLabel, weatherSourceLabel } from './calendar-weather-source.js';
import {
    BACK_ICON_SVG, CLOSE_ICON_SVG, EDIT_ICON_SVG, FORWARD_ICON_SVG, MOON_ICON_SVG, MORE_ICON_SVG, PLUS_ICON_SVG,
    RECIPE_ICON_SVG, REFRESH_ICON_SVG, TRASH_ICON_SVG, WEATHER_SUN_ICON_SVG,
} from './icons.js';
import { escapeAttr, escapeHtml } from './ui.js';

const detailDate = new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric' });
const detailWeekday = new Intl.DateTimeFormat('zh-CN', { weekday: 'long' });
const CYCLE_DETAILS = {
    period: { label: '经期' },
    ovulatory: { label: '易孕期' },
};
const MEAL_ICONS = { breakfast: WEATHER_SUN_ICON_SVG, lunch: RECIPE_ICON_SVG, dinner: MOON_ICON_SVG, snack: RECIPE_ICON_SVG };

export const occasionTypeLabel = (type, repeat = 'yearly', intervalDays = 1) => {
    if (repeat === 'daily') return '每日重复';
    if (repeat === 'weekly') return '每周重复';
    if (repeat === 'biweekly') return '每两周重复';
    if (repeat === 'monthly') return '每月重复';
    if (repeat === 'custom') { const days = Number(intervalDays); return `每${Number.isInteger(days) && days >= 1 && days <= 9999 ? days : 1}天重复`; }
    return type === 'birthday' ? '生日' : '纪念日';
};

const pill = (tone, label) => `<span class="pm-calendar-pill is-${tone}">${escapeHtml(label)}</span>`;
const metaChip = label => `<span class="pm-calendar-card-meta">${escapeHtml(label)}</span>`;

// 卡片右上角「⋯」展开当条的编辑/删除；同一时间只展开一张。
function entryCard({ kind, key, pillHtml, title, note = '', meta = '', body = '', actions = '', openMenu = '' }) {
    const expanded = Boolean(actions) && openMenu === key;
    const menu = actions ? `<button type="button" class="pm-calendar-card-more" data-action="calendar-entry-menu" data-entry-key="${escapeAttr(key)}" aria-expanded="${expanded}" aria-label="${escapeAttr(`${title}的操作`)}">${MORE_ICON_SVG}</button>` : '';
    return `<article class="pm-calendar-card is-${kind}"><div class="pm-calendar-card-top">${pillHtml}${menu}</div>
        <b class="pm-calendar-card-title">${escapeHtml(title)}</b>${note ? `<p class="pm-calendar-card-note">${escapeHtml(note)}</p>` : ''}${body}${meta ? `<div class="pm-calendar-card-foot">${meta}</div>` : ''}
        ${expanded ? `<div class="pm-calendar-card-actions">${actions}</div>` : ''}</article>`;
}

function entryActions(kind, id, title) {
    const attrs = `data-entry-kind="${kind}" data-entry-id="${escapeAttr(id)}"`;
    return `<button type="button" data-action="calendar-edit-entry" ${attrs} aria-label="编辑${escapeAttr(title)}">${EDIT_ICON_SVG}<span>编辑</span></button><button type="button" class="is-danger" data-action="calendar-delete-entry" ${attrs} aria-label="删除${escapeAttr(title)}">${TRASH_ICON_SVG}<span>删除</span></button>`;
}

function eventRows(scope, occasionsByDate, date, openMenu = '') {
    const occasionCards = (occasionsByDate.get(date) || []).map(occasion => {
        const key = `occasion:${occasion.id}`;
        const yearly = !occasion.repeat || occasion.repeat === 'yearly';
        const tone = yearly ? 'occasion' : 'schedule';
        const label = yearly ? occasionTypeLabel(occasion.type, occasion.repeat, occasion.intervalDays) : '日程';
        const repeatLabel = yearly ? '每年' : occasionTypeLabel(occasion.type, occasion.repeat, occasion.intervalDays);
        const meta = metaChip(`${repeatLabel}${occasion.leapAdjusted ? ' · 闰日顺延' : ''}`);
        return entryCard({ kind: 'occasion', key, pillHtml: pill(tone, label), title: occasion.title, note: occasion.note, meta,
            actions: entryActions('occasion', occasion.id, occasion.title), openMenu });
    });
    const eventCards = (scope.events[date] || []).map(event => entryCard({
        kind: 'event', key: `event:${event.id}`, pillHtml: pill('schedule', '日程'), title: event.title, note: event.note,
        actions: entryActions('event', event.id, event.title), openMenu,
    }));
    return [...occasionCards, ...eventCards].join('');
}

function holidayRows(cache, date) {
    const year = Number(date.slice(0, 4));
    const row = holidayYearFromCache(cache, cache?.selectedCountry, year);
    return (row?.entries || []).filter(item => item.date === date).map(item => {
        const kind = item.kind === 'workday' ? '调休工作日' : item.kind === 'in_lieu' ? '调休' : item.kind === 'observed' ? '替代休息日' : '节假日';
        return entryCard({ kind: 'holiday', key: `holiday:${item.date}:${item.name}`, pillHtml: pill('holiday', kind), title: item.name });
    }).join('');
}

function recipeRows(recipeScope, date, openMenu = '') {
    const day = recipeDayFor(recipeScope, date);
    return RECIPE_MEAL_TYPES.flatMap(mealType => {
        const text = day[mealType]?.text;
        if (!text) return [];
        const key = `recipe:${mealType}`, label = RECIPE_MEAL_LABELS[mealType], expanded = openMenu === key;
        return [`<article class="pm-calendar-meal" data-recipe-meal="${mealType}"><span class="pm-calendar-meal-icon" aria-hidden="true">${MEAL_ICONS[mealType] || RECIPE_ICON_SVG}</span>
            <div class="pm-calendar-meal-copy"><b>${label}</b><p>${escapeHtml(text)}</p></div>
            <button type="button" class="pm-calendar-card-more" data-action="calendar-entry-menu" data-entry-key="${key}" aria-expanded="${expanded}" aria-label="${label}的操作">${MORE_ICON_SVG}</button>
            ${expanded ? `<div class="pm-calendar-card-actions"><button type="button" data-action="calendar-recipe-edit" data-meal-type="${mealType}" aria-label="编辑${label}">${EDIT_ICON_SVG}<span>编辑</span></button><button type="button" class="is-danger" data-action="calendar-recipe-delete" data-meal-type="${mealType}" aria-label="删除${label}">${TRASH_ICON_SVG}<span>删除</span></button></div>` : ''}</article>`];
    }).join('');
}

// AI 写的穿搭多为「上装、下装、鞋、配饰」逗号串；能干净切开就把第一项作标题、其余作小胶囊。
function outfitParts(text) {
    const parts = String(text).split(/[、，,；;。]/).map(part => part.trim()).filter(Boolean);
    return parts.length >= 2 && parts.length <= 8 && parts.every(part => part.length <= 20) ? parts : null;
}

function outfitRow(outfit, subjectLabel = '', openMenu = '') {
    if (!outfit?.text) return '';
    const parts = outfitParts(outfit.text);
    const title = parts ? parts[0] : '';
    const body = parts
        ? `<div class="pm-calendar-card-tags">${parts.slice(1).map(part => `<span>${escapeHtml(part)}</span>`).join('')}</div>`
        : `<p class="pm-calendar-card-note">${escapeHtml(outfit.text)}</p>`;
    const actions = '<button type="button" data-action="calendar-outfit-edit" aria-label="编辑OOTD">' + EDIT_ICON_SVG + '<span>编辑</span></button><button type="button" class="is-danger" data-action="calendar-outfit-delete" aria-label="删除OOTD">' + TRASH_ICON_SVG + '<span>删除</span></button>';
    const pillHtml = `${pill('outfit', 'OOTD')}${subjectLabel ? `<span class="pm-calendar-card-subject">${escapeHtml(subjectLabel)}</span>` : ''}`;
    return entryCard({ kind: 'outfit', key: 'outfit', pillHtml, title, body, actions, openMenu });
}

function relativeHeading(relativeLabel, parsed, className = 'pm-calendar-detail-date') {
    return `<div class="${className}">${relativeLabel ? `<strong>${escapeHtml(relativeLabel)}</strong>` : ''}<span><time datetime="${escapeAttr(parsed.date)}">${escapeHtml(detailDate.format(parsed.value))}</time><em>${escapeHtml(detailWeekday.format(parsed.value))}</em></span></div>`;
}

function roundButton({ action, label, icon, className = '', busy = false, disabled = false }) {
    return `<button type="button" class="pm-calendar-round${className ? ` ${className}` : ''}${busy ? ' is-loading' : ''}" data-action="${action}" aria-label="${escapeAttr(label)}" title="${escapeAttr(label)}"${busy ? ' aria-busy="true"' : ''}${busy || disabled ? ' disabled' : ''}>${icon}</button>`;
}

function detailSection(selectedDate, mode, header, content, extraClass = '') {
    return `<section class="pm-calendar-selected-detail${extraClass}" data-calendar-selected-detail="${selectedDate}" data-calendar-detail-mode="${mode}">${header}<div class="pm-calendar-selected-content">${content}</div></section>`;
}
function weatherStatusCard(scope, weatherStore, date, parsed, relativeLabel) {
    const resolved = resolveWeatherForDate(weatherStore, date, {
        storyWeatherEvent: scope.weatherEvent, storyWeatherEventEnabled: scope.weatherEventEnabled,
    });
    if (resolved.status !== 'available') {
        return { content: `<p class="pm-calendar-empty-day">无法推演 · ${escapeHtml(resolved.unavailableReason)}</p>`, isCard: false };
    }
    const condition = weatherCodeLabel(resolved.day.weatherCode);
    const location = weatherStore?.location?.country || weatherStore?.location?.name || '天气记录';
    const eventLabel = resolved.source === 'story_weather_event' ? ` · ${storyWeatherEventLabel(resolved.event?.type)}（剧情天气事件覆盖）` : '';
    const scene = weatherSceneKind(resolved.day.weatherCode);
    return { isCard: true, content: `<div class="pm-calendar-status-card pm-calendar-status-card-weather" data-weather-scene="${scene}">
        <span class="pm-calendar-status-art" aria-hidden="true">${weatherSceneSvg(scene)}</span>
        <div class="pm-calendar-status-content">${relativeHeading(relativeLabel, { date, value: parsed }, 'pm-calendar-status-heading')}
            <b class="pm-calendar-status-value">${resolved.day.tempMin}°–${resolved.day.tempMax}°</b>
            <span class="pm-calendar-status-weather-context">${escapeHtml(condition)} · ${escapeHtml(location)}${escapeHtml(eventLabel)}</span></div>
    </div>` };
}

function cycleStatusCard(cycleScope, date, parsed, relativeLabel) {
    const prediction = predictCyclePhase(cycleScope, date);
    const detail = CYCLE_DETAILS[prediction.phase];
    if (!detail) return { content: '', isCard: false };
    const normalized = normalizeCycleScope(cycleScope);
    const context = prediction.phase === 'period'
        ? '是特殊的日子 &gt; &lt; ！要注意保重身体呀'
        : '哎呀呀，是做安全防护还是……';
    const hasDay = Number.isInteger(prediction.day);
    let foot = '';
    if (hasDay && prediction.phase === 'period') {
        const end = calendarDateRangeKeys(date, 0, Math.max(0, normalized.periodLength - prediction.day)).at(-1);
        foot =`预计 ${detailDate.format(parseCalendarDate(end))}结束`;
    } else if (prediction.nextPeriodStart) foot = `下次经期 ${detailDate.format(parseCalendarDate(prediction.nextPeriodStart))}`;
    const ring = hasDay ? `<span class="pm-calendar-ring">${cycleRingSvg({
        cycleLength: normalized.cycleLength, today: prediction.day,
        phaseOf: day => phaseForDay(day, normalized.cycleLength, normalized.periodLength),
    })}<span class="pm-calendar-ring-center"><b>${prediction.day}</b><small>天 / 共 ${normalized.cycleLength}</small></span></span>` : '';
    return { isCard: true, content: `<div class="pm-calendar-status-card pm-calendar-status-card-cycle" data-cycle-phase="${escapeAttr(prediction.phase)}">
        <div class="pm-calendar-status-content">${relativeHeading(relativeLabel, { date, value: parsed }, 'pm-calendar-status-heading')}
            <b class="pm-calendar-status-value">${detail.label}</b>
            <span class="pm-calendar-status-cycle-context">${context}</span>
            ${foot ? `<span class="pm-calendar-status-foot">${escapeHtml(foot)}</span>` : ''}</div>
        ${ring}
    </div>` };
}

export function renderSelectedDateDetail(
    scope, occasionsByDate, holidayCache, weatherStore, cycleScope, selectedDate, viewMode, relativeLabel = '', recipeScope = {}, openMenu = '',
    detailRegenerating = false, outfitProfile = {}, { canRegenerate = true, outfitSubjectLabel = '' } = {},
) {
    const parsed = parseCalendarDate(selectedDate);
    const heading = relativeHeading(relativeLabel, { date: selectedDate, value: parsed });
    const menuKey = typeof openMenu === 'string' ? openMenu : '';
    const header = tools => `<header class="pm-calendar-detail-head">${heading}<div class="pm-calendar-detail-tools">${tools}</div></header>`;
    const regenerate = (action, label) => canRegenerate || detailRegenerating
        ? roundButton({ action, label, icon: REFRESH_ICON_SVG, className: 'pm-calendar-inline-regenerate', busy: detailRegenerating }) : '';
    if (viewMode === 'outfit') {
        const outfit = outfitForDate(outfitProfile, selectedDate);
        const tools = `${regenerate('calendar-outfit-regenerate', '重新生成当日OOTD')}${roundButton({ action: 'calendar-outfit-edit', label: outfit ? '编辑OOTD' : '记录OOTD', icon: outfit ? EDIT_ICON_SVG : PLUS_ICON_SVG, className: 'pm-calendar-inline-add', disabled: detailRegenerating })}`;
        return detailSection(selectedDate, 'outfit', header(tools), outfitRow(outfit, outfitSubjectLabel, menuKey) || '<p class="pm-calendar-empty-day">这一天还没有记录OOTD。</p>');
    }
    if (viewMode === 'recipe') {
        const tools = `${regenerate('calendar-recipe-regenerate', '重新生成当日菜谱')}${roundButton({ action: 'calendar-recipe-add', label: '新增一条餐食', icon: PLUS_ICON_SVG, className: 'pm-calendar-inline-add', disabled: detailRegenerating })}`;
        return detailSection(selectedDate, 'recipe', header(tools), recipeRows(recipeScope, selectedDate, menuKey) || '<p class="pm-calendar-empty-day">这一天还没有菜谱。</p>');
    }
    if (viewMode === 'weather' || viewMode === 'cycle') {
        const status = viewMode === 'weather'
            ? weatherStatusCard(scope, weatherStore, selectedDate, parsed, relativeLabel)
            : cycleStatusCard(cycleScope, selectedDate, parsed, relativeLabel);
        if (status.isCard) return detailSection(selectedDate, viewMode, '', status.content, ' is-status-card');
        const empty = viewMode === 'weather' ? '这一天没有天气数据' : '这一天没有生理提示，说不定是个平安日~';
        return detailSection(selectedDate, viewMode, header(''), status.content || `<p class="pm-calendar-empty-day">${empty}</p>`);
    }
    const tools = `${regenerate('calendar-regenerate', '重新生成当日日程')}${roundButton({ action: 'calendar-add-date', label: '新增一条日程', icon: PLUS_ICON_SVG, className: 'pm-calendar-inline-add', disabled: detailRegenerating })}`;
    const content = `${holidayRows(holidayCache, selectedDate)}${eventRows(scope, occasionsByDate, selectedDate, menuKey)}`;
    return detailSection(selectedDate, 'schedule', header(tools), content || '<p class="pm-calendar-empty-day">这一天还没有安排</p>');
}

export function weatherSearchResults(results) {
    if (!results.length) return '';
    return `<div class="pm-calendar-location-results">${results.map((location, index) =>
        `<button type="button" data-action="calendar-weather-select" data-location-index="${index}"><b>${escapeHtml(location.name)}</b><span>${escapeHtml([location.admin1, location.country].filter(Boolean).join(' · '))}</span></button>`
    ).join('')}</div>`;
}
function injectionToggle(action, label, enabled, hint = '开启后，角色回复时会参考当前会话中的相关信息。') {
    return `<button type="button" class="pm-calendar-auto-switch" data-action="${action}" role="switch" aria-checked="${enabled === true}"><span><b>${label}</b><small class="pm-calendar-setting-hint">${escapeHtml(hint)}</small></span><i aria-hidden="true"></i></button>`;
}
const group = (title, body, extraClass = '') => `<section class="pm-calendar-setting-group${extraClass}"><h3>${escapeHtml(title)}</h3><div class="pm-calendar-data-tools">${body}</div></section>`;
const ruleEditor = (attr, label, value, action) => `<textarea class="pm-calendar-generation-rule" ${attr} maxlength="3000" aria-label="${label}">${escapeHtml(value)}</textarea><div class="pm-calendar-editor-actions"><button type="button" class="is-primary" data-action="${action}">保存生成规则</button></div>`;
const settings = (mode, body) => `<div class="pm-calendar-management" data-calendar-management="${mode}">${body}</div>`;

export function renderCalendarManagement({
    scope, holidayCache, weatherStore, cycleScope, recipeScope, weatherResults, viewMode,
    holidayAvailable = true, holidayRange = null, cycleSubjects = [], selectedCycleSubject = '__self__',
    outfitProfile = {}, outfitSubjects = [], selectedOutfitSubject = '',
}) {
    if (viewMode === 'outfit') {
        const subjects = outfitSubjects.length ? outfitSubjects : [{ value: '__self__', label: '我' }];
        return settings('outfit', `${group('注入', injectionToggle('calendar-toggle-outfit-injection', '穿搭注入', scope.injectionOutfitEnabled))}
            ${group('数据来源', `<div class="pm-calendar-database-card"><span class="pm-calendar-setting-hint">数据库记忆栏目</span><button type="button" data-action="calendar-outfit-worldbook-columns" aria-label="选择穿搭可读取的数据库记忆栏目">选择栏目</button></div>`)}
            ${group('角色与偏好', `<select data-action="calendar-outfit-subject" aria-label="穿搭记录对象">${subjects.map(item => `<option value="${escapeAttr(item.value)}" ${item.value === selectedOutfitSubject ? 'selected' : ''}>${escapeHtml(item.label)}</option>`).join('')}</select><input data-outfit-color-preference maxlength="120" value="${escapeAttr(outfitProfile?.colorPreference || '')}" placeholder="喜好颜色（可选）" aria-label="喜好颜色"><textarea data-outfit-preference maxlength="800" placeholder="穿衣偏好与限制（可选）" aria-label="穿衣偏好与限制">${escapeHtml(outfitProfile?.preference || '')}</textarea><div class="pm-calendar-editor-actions"><button type="button" class="is-primary" data-action="calendar-outfit-preferences-save">保存偏好</button></div>`)}
            ${group('高级生成规则', ruleEditor('data-outfit-generation-rule', '穿搭生成规则', outfitProfile?.generationRule || DEFAULT_OUTFIT_GENERATION_RULE, 'calendar-outfit-generation-rule-save'))}`);
    }
    if (viewMode === 'recipe') {
        const region = recipeScope?.regionPreference || '';
        const applied = recipeScope?.lastGeneratedRegion || '';
        return settings('recipe', `${group('注入', injectionToggle('calendar-toggle-recipe-injection', '菜谱注入', scope.injectionRecipeEnabled))}
            ${group('饮食地区 / 文化', `<div class="pm-calendar-data-row"><input data-recipe-region maxlength="120" value="${escapeAttr(region)}" placeholder="川渝、潮汕、关西或架空地区；留空按剧情推断" aria-label="菜谱饮食地区或文化"><button type="button" class="is-primary" data-action="calendar-recipe-region-save">保存</button></div><small class="pm-calendar-attribution">${region ? `手动指定：${escapeHtml(region)}` : applied ? `最近剧情推断：${escapeHtml(applied)}` : '尚未生成地区依据'}</small>`)}
            ${group('生成规则', ruleEditor('data-recipe-generation-rule', '菜谱生成规则', recipeScope?.generationRule || DEFAULT_RECIPE_GENERATION_RULE, 'calendar-recipe-generation-rule-save'))}`);
    }
    if (viewMode === 'weather') {
        const storedSource = weatherStore?.lastSuccess?.source || (weatherStore?.lastSuccess ? 'forecast' : null);
        const currentSource = storedSource ? weatherSourceLabel(storedSource) : '仅气候推演';
        const event = scope.weatherEvent;
        const eventStatus = !scope.weatherEventEnabled ? '已关闭；不会覆盖天气。'
            : event ? `当前事件：${storyWeatherEventLabel(event.type)} · ${event.startDate} 至 ${event.endDate} · 剧情天气事件覆盖`
                : weatherStore.location ? '已开启；将在后续剧情日期生成短期天气事件。' : '已开启；请先设置天气位置。';
        const option = (field, value, label) => `<option value="${value}" ${scope[field] === value || (!value && !scope[field]) ? 'selected' : ''}>${label}</option>`;
        const weatherEventConfig = scope.weatherEventEnabled && weatherStore.location ? `<div class="pm-calendar-weather-event-config">
            <div class="pm-calendar-data-row pm-calendar-weather-event-row">
                <select data-action="calendar-weather-event-type" aria-label="天气事件类型">${option('weatherEventType', '', '随机类型')}${option('weatherEventType', 'clear_spell', '放晴')}${option('weatherEventType', 'rainy_spell', '阴雨')}${option('weatherEventType', 'thunderstorm', '强对流')}${option('weatherEventType', 'tropical_storm', '热带风暴')}</select>
                <select data-action="calendar-weather-event-intensity" aria-label="天气事件强度">${option('weatherEventIntensity', '', '随机强度')}${option('weatherEventIntensity', 'mild', '温和')}${option('weatherEventIntensity', 'normal', '标准')}${option('weatherEventIntensity', 'severe', '强烈')}</select>
                <select data-action="calendar-weather-event-days" aria-label="天气事件持续天数"><option value="0" ${!scope.weatherEventDays ? 'selected' : ''}>随机天数</option>${Array.from({ length: 7 }, (_, index) => index + 1).map(days => `<option value="${days}" ${scope.weatherEventDays === days ? 'selected' : ''}>${days} 天</option>`).join('')}</select>
            </div>
            <div class="pm-calendar-weather-event-footer">
                <small class="pm-calendar-attribution">按所选类型、强度与天数生成未来天气事件；选择“随机”保留变化。</small>
                <button type="button" class="pm-calendar-weather-event-regenerate" data-action="calendar-weather-event-regenerate" aria-label="重新生成天气事件" title="重新生成天气事件">${REFRESH_ICON_SVG}<span>重新生成</span></button>
            </div>
        </div>` : '';
        return settings('weather', `${group('注入', injectionToggle('calendar-toggle-weather-injection', '天气注入', scope.injectionWeatherEnabled))}
            ${group('剧情天气事件', `${injectionToggle('calendar-toggle-weather-event', '剧情天气事件', scope.weatherEventEnabled, '开启后会为未来日期生成随机天气事件，覆盖日历显示。')}<small class="pm-calendar-attribution">${escapeHtml(eventStatus)}</small>${weatherEventConfig}`)}
            ${group('天气位置', `<div class="pm-calendar-data-row"><input data-weather-query placeholder="搜索城市或地区" maxlength="100" aria-label="搜索天气位置"><button type="button" data-action="calendar-weather-search">搜索</button><button type="button" data-action="calendar-weather-refresh">刷新</button></div>${weatherSearchResults(weatherResults)}<small class="pm-calendar-attribution">${weatherStore.location ? `${escapeHtml(weatherStore.location.name)} · 当前数据 ${escapeHtml(currentSource)} · 预报外日期使用气候推演` : '尚未设置天气位置 · 无法推演'}</small>`)}`);
    }
    if (viewMode === 'cycle') {
        const startDay = cycleScope.lastPeriodStart ? Number(cycleScope.lastPeriodStart.slice(8, 10)) : 1;
        const subjects = cycleSubjects.length ? cycleSubjects : [{ value: '__self__', label: '<user>' }];
        return settings('cycle', `${group('注入', injectionToggle('calendar-toggle-cycle-injection', '生理期注入', scope.injectionCycleEnabled))}
            ${group('周期资料', `<form class="pm-calendar-editor pm-calendar-cycle-editor" data-calendar-cycle-editor>
              <label>记录对象<select name="subject" data-action="calendar-cycle-subject" aria-label="生理期记录对象">${subjects.map(item => `<option value="${escapeAttr(item.value)}" ${item.value === selectedCycleSubject ? 'selected' : ''}>${escapeHtml(item.label)}</option>`).join('')}</select></label>
              <label class="pm-calendar-cycle-toggle"><span><b>启用生理期提示</b><small>仅在本地按当前会话和所选角色保存</small></span><span class="pm-calendar-cycle-switch"><input class="pm-calendar-cycle-input" name="enabled" type="checkbox" ${cycleScope.enabled ? 'checked' : ''} aria-label="启用生理期提示"><span class="pm-custom-check" aria-hidden="true"></span></span></label>
              <label>每月经期通常从几号开始<select name="periodStartDay" aria-label="每月经期开始日">${Array.from({ length: 28 }, (_, index) => index + 1).map(day => `<option value="${day}" ${day === startDay ? 'selected' : ''}>${day} 号</option>`).join('')}</select></label>
              <div class="pm-calendar-cycle-numbers"><label>平均周期<input name="cycleLength" type="number" min="21" max="45" value="${cycleScope.cycleLength || 28}" aria-label="平均周期天数"><small>从一次经期开始到下一次开始，常见约 21–45 天</small></label><label>经期持续<input name="periodLength" type="number" min="2" max="10" value="${cycleScope.periodLength || 5}" aria-label="经期持续天数"><small>每次经期通常持续 2–10 天</small></label></div>
              <div class="pm-calendar-editor-actions"><button type="button" data-action="calendar-cycle-clear">清除所选对象</button><button type="button" class="is-primary" data-action="calendar-cycle-save">保存生理期</button></div>
            </form>`)}`);
    }
    return settings('schedule', `${group('注入', injectionToggle('calendar-toggle-schedule-injection', '日程注入', scope.injectionScheduleEnabled))}
        ${group('正文日期', `<button type="button" class="pm-calendar-auto-switch" data-action="calendar-toggle-auto" role="switch" aria-checked="${scope.autoAdjust}"><span><b>自动跟随正文日期</b><small>角色回复后，日历日期会随正文更新。</small></span><i aria-hidden="true"></i></button><p class="pm-calendar-setting-hint">识别最后一条正文中标签内的日期与时间，并设为当前故事日期。标签可层层包裹，例如填写 time_bar 即可读取其中的 date 与 time。</p><div class="pm-calendar-data-row pm-calendar-date-tags-row"><input data-calendar-date-tags value="${escapeAttr((scope.dateTags || ['date']).join(', '))}" maxlength="160" placeholder="date, time_bar" aria-label="正文日期标签"><button type="button" class="is-primary" data-action="calendar-date-sync">保存并识别</button></div>`, ' pm-calendar-scan-card')}
        ${group('数据来源', `<div class="pm-calendar-database-card"><span class="pm-calendar-setting-hint">选择生成日程时可参考的数据库记忆栏目。</span><button type="button" data-action="calendar-worldbook-columns" aria-label="选择日历可读取的数据库记忆栏目">选择栏目</button></div><div class="pm-calendar-data-row pm-calendar-holiday-row"><select data-action="calendar-holiday-country" data-calendar-country aria-label="节假日国家"><option value="CN" ${holidayCache.selectedCountry === 'CN' ? 'selected' : ''}>中国</option><option value="US" ${holidayCache.selectedCountry === 'US' ? 'selected' : ''}>美国</option><option value="JP" ${holidayCache.selectedCountry === 'JP' ? 'selected' : ''}>日本</option></select><button type="button" data-action="calendar-holiday-refresh" ${holidayAvailable ? '' : 'disabled aria-disabled="true"'}>刷新节假日</button></div>${holidayAvailable ? '' : `<small class="pm-calendar-attribution">该国家在当前年代无外部数据源（仅支持 ${holidayRange?.min ?? '未知'}–${holidayRange?.max ?? '未知'} 年）</small>`}`)}
        ${group('生成规则', ruleEditor('data-calendar-generation-rule', '日程生成规则', scope.generationRule || DEFAULT_CALENDAR_GENERATION_RULE, 'calendar-generation-rule-save'))}`);
}

// 跳转日期：TASKOW 式弹窗，年份翻页 + 12 个月格子 + 当前故事日期；改动只在「应用」时生效。
export function renderCalendarMonthDialog(scope, viewYear, viewMonth) {
    const baseDate = scope.baseDate || '';
    const months = Array.from({ length: 12 }, (_, index) => index + 1).map(month =>
        `<button type="button" data-calendar-month-option="${month}" aria-pressed="${month === viewMonth}">${month}月</button>`).join('');
    return `<div class="pm-modal pm-calendar-month-dialog" role="dialog" aria-modal="true" aria-labelledby="pm-calendar-month-dialog-title" data-calendar-month-panel>
        <div class="pm-modal-header"><span></span><b id="pm-calendar-month-dialog-title">跳转日期</b><button type="button" class="pm-modal-close" data-calendar-month-close aria-label="关闭">${CLOSE_ICON_SVG}</button></div>
        <div class="pm-calendar-month-dialog-body">
            <div class="pm-calendar-year-step"><button type="button" data-calendar-year-step="-1" aria-label="上一年">${BACK_ICON_SVG}</button><label><input type="number" min="1" max="9999" value="${viewYear}" data-calendar-jump-year aria-label="跳转年份"><span>年</span></label><button type="button" data-calendar-year-step="1" aria-label="下一年">${FORWARD_ICON_SVG}</button></div>
            <input type="hidden" value="${viewMonth}" data-calendar-jump-month>
            <div class="pm-calendar-month-options" role="group" aria-label="选择月份">${months}</div>
            <label class="pm-calendar-panel-section">当前故事日期<input class="pm-calendar-base-date-input" type="text" inputmode="numeric" data-calendar-base-date value="${escapeAttr(baseDate)}" placeholder="例如 3726-08-17" aria-label="当前故事日期"></label>
            <div class="pm-calendar-month-links"><button type="button" data-action="calendar-base-clear" ${baseDate ? '' : 'disabled'}>恢复自动识别</button><button type="button" data-action="calendar-set-today">设所选日为今日</button><button type="button" data-action="calendar-today">回到今天</button></div>
            <p class="pm-calendar-entry-error" data-calendar-month-error role="status" aria-live="polite"></p>
            <div class="pm-calendar-entry-actions"><button type="button" data-calendar-month-close>取消</button><button type="button" class="is-primary" data-action="calendar-month-jump">应用</button></div>
        </div>
    </div>`;
}

export function renderCalendarEntryDialog(selectedDate, entry = null, kind = 'event') {
    const repeat = kind === 'occasion' ? entry?.repeat || 'yearly' : 'none';
    const yearly = repeat === 'yearly';
    const custom = repeat === 'custom';
    return `<div class="pm-modal pm-calendar-entry-dialog"><div class="pm-modal-header"><span></span><b>日程</b><button type="button" class="pm-modal-close" data-calendar-entry-close aria-label="关闭">${CLOSE_ICON_SVG}</button></div><form data-calendar-entry-form><label>重复<select name="repeat" data-calendar-repeat-select aria-label="日程重复规则"><option value="none" ${repeat === 'none' ? 'selected' : ''}>不重复</option><option value="daily" ${repeat === 'daily' ? 'selected' : ''}>每日重复</option><option value="weekly" ${repeat === 'weekly' ? 'selected' : ''}>每周（同星期）</option><option value="biweekly" ${repeat === 'biweekly' ? 'selected' : ''}>每两周（同星期）</option><option value="monthly" ${repeat === 'monthly' ? 'selected' : ''}>每月（同日）</option><option value="yearly" ${yearly ? 'selected' : ''}>每年重复</option><option value="custom" ${custom ? 'selected' : ''}>自定义</option></select></label><label class="pm-calendar-repeat-interval" data-calendar-interval-days ${custom ? '' : 'hidden aria-hidden="true"'}>每<input name="intervalDays" type="number" min="1" max="9999" step="1" inputmode="numeric" value="${custom ? Number(entry?.intervalDays) || 1 : 1}" ${custom ? '' : 'disabled'} aria-label="每几天重复一次">天重复一次</label><input name="title" maxlength="120" placeholder="名称" aria-label="安排名称"><textarea name="note" maxlength="1000" placeholder="备注（可选）" aria-label="安排备注"></textarea><div data-calendar-occasion-fields ${yearly ? '' : 'hidden aria-hidden="true"'}><label>长期类型<select name="occasionType" ${yearly ? '' : 'disabled'}><option value="anniversary">纪念日</option><option value="birthday">生日</option></select></label><label>2 月 29 日在非闰年<select name="leapDayRule" ${yearly ? '' : 'disabled'}><option value="feb28">按 2 月 28 日显示</option><option value="mar1">按 3 月 1 日显示</option><option value="skip">该年不显示</option></select></label></div><p class="pm-calendar-entry-error" data-calendar-entry-error role="status" aria-live="polite"></p><div class="pm-calendar-entry-actions"><button type="submit" class="is-primary">保存</button></div></form></div>`;
}

export function renderCalendarRepeatDeleteDialog(title, date) {
    return `<div class="pm-modal pm-calendar-entry-dialog"><div class="pm-modal-header"><span></span><b>清理重复日程</b><button type="button" class="pm-modal-close" data-calendar-repeat-delete-cancel aria-label="关闭">${CLOSE_ICON_SVG}</button></div><p>“${escapeHtml(title)}”是重复日程。请选择清理范围。</p><p class="pm-cfg-tip">当天：仅移除 ${escapeHtml(date)} 的这一项；全部：删除整条重复日程。</p><div class="pm-calendar-entry-actions"><button type="button" data-calendar-repeat-delete="day">仅清理当天</button><button type="button" class="is-danger" data-calendar-repeat-delete="all">清理全部重复</button></div></div>`;
}

export function renderRecipeMealDialog(selectedDate, mealType = 'breakfast', meal = null) {
    const normalizedType = RECIPE_MEAL_TYPES.includes(mealType) ? mealType : 'breakfast';
    return `<div class="pm-modal pm-calendar-entry-dialog pm-recipe-meal-dialog"><div class="pm-modal-header"><span></span><b>${meal ? '编辑' : '新增'} ${escapeHtml(selectedDate)} 餐食</b><button type="button" class="pm-modal-close" data-recipe-entry-close aria-label="关闭">${CLOSE_ICON_SVG}</button></div><form data-recipe-entry-form><label>餐次<select name="mealType" aria-label="菜谱餐次">${RECIPE_MEAL_TYPES.map(type => `<option value="${type}" ${type === normalizedType ? 'selected' : ''}>${RECIPE_MEAL_LABELS[type]}</option>`).join('')}</select></label><textarea name="text" maxlength="160" placeholder="填写这顿吃什么" aria-label="餐食内容">${escapeHtml(meal?.text || '')}</textarea><p class="pm-calendar-entry-error" data-recipe-entry-error role="status" aria-live="polite"></p><div class="pm-calendar-entry-actions"><button type="submit" class="is-primary">保存</button></div></form></div>`;
}

export function renderOutfitDialog(selectedDate, outfit = null) {
    return `<div class="pm-modal pm-calendar-entry-dialog pm-outfit-dialog"><div class="pm-modal-header"><span></span><b>${outfit ? '编辑' : '记录'} ${escapeHtml(selectedDate)} OOTD</b><button type="button" class="pm-modal-close" data-outfit-entry-close aria-label="关闭">${CLOSE_ICON_SVG}</button></div><form data-outfit-entry-form><textarea name="text" maxlength="600" placeholder="填写当天实际穿着的关键服饰、鞋履及必要配饰" aria-label="OOTD内容">${escapeHtml(outfit?.text || '')}</textarea><p class="pm-calendar-entry-error" data-outfit-entry-error role="status" aria-live="polite"></p><div class="pm-calendar-entry-actions"><button type="submit" class="is-primary">保存</button></div></form></div>`;
}
