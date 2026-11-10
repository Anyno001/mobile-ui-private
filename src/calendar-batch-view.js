import { parseBatchDayText } from './calendar-batch-model.js';
import { calendarTimeLabel, parseCalendarDate, relativeCalendarLabel, sortByCalendarTime } from './calendar-model.js';
import { occasionSeasonEnd } from './calendar-occasion-model.js';
import { BACK_ICON_SVG, FORWARD_ICON_SVG } from './icons.js';
import { escapeAttr, escapeHtml } from './ui.js';

const dayFormat = new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric' });
const weekdayFormat = new Intl.DateTimeFormat('zh-CN', { weekday: 'short' });
const WEEKDAY_OPTIONS = [[1, '一'], [2, '二'], [3, '三'], [4, '四'], [5, '五'], [6, '六'], [0, '日']];
const REPEAT_OPTIONS = [['daily', '每天'], ['weekly', '每周'], ['biweekly', '每两周'], ['monthly', '每月'], ['custom', '每N天']];
const REPEAT_LABELS = Object.fromEntries(REPEAT_OPTIONS);

const group = (title, body, extra = '') => `<section class="pm-calendar-setting-group${extra}"><h3>${escapeHtml(title)}</h3><div class="pm-calendar-data-tools">${body}</div></section>`;
const chip = (attrs, label, checked, disabled = false) => `<label class="pm-calendar-batch-chip"><input type="checkbox" ${attrs} ${checked ? 'checked' : ''} ${disabled ? 'disabled' : ''}><span>${escapeHtml(label)}</span></label>`;

export const batchRuleSummary = rule => {
    const repeat = rule.repeat === 'custom' ? `每${rule.intervalDays || 1}天` : REPEAT_LABELS[rule.repeat] || '';
    const days = ['weekly', 'biweekly'].includes(rule.repeat) && rule.weekdays?.length
        ? `周${WEEKDAY_OPTIONS.filter(([value]) => rule.weekdays.includes(value)).map(([, label]) => label).join('、')}` : '';
    return [repeat + days, calendarTimeLabel(rule.time)].filter(Boolean).join(' ');
};

function ruleCard(id, rule) {
    const weekly = ['weekly', 'biweekly'].includes(rule.repeat);
    const weekdays = new Set(rule.weekdays || []);
    return `<div class="pm-calendar-batch-rule" data-batch-rule="${escapeAttr(id)}">
        <input name="title" maxlength="120" value="${escapeAttr(rule.title || '')}" placeholder="标题" aria-label="重复日程标题">
        <div class="pm-calendar-batch-pair"><input name="time" maxlength="20" value="${escapeAttr(rule.timeText ?? calendarTimeLabel(rule.time))}" placeholder="时间，例如20:00或晚间" aria-label="时间"><select name="repeat" data-action="calendar-batch-rule-repeat" aria-label="频率">${REPEAT_OPTIONS.map(([value, label]) => `<option value="${value}" ${rule.repeat === value ? 'selected' : ''}>${label}</option>`).join('')}</select></div>
        ${rule.repeat === 'custom' ? `<label class="pm-calendar-batch-inline">间隔天数<input name="intervalDays" type="number" min="1" max="9999" inputmode="numeric" value="${escapeAttr(String(rule.intervalDays || 1))}" aria-label="间隔天数"></label>` : ''}
        ${weekly ? `<div class="pm-calendar-batch-chips" role="group" aria-label="星期">${WEEKDAY_OPTIONS.map(([value, label]) => chip(`name="weekday" value="${value}"`, label, weekdays.has(value))).join('')}</div>` : ''}
        <div class="pm-calendar-batch-pair"><label class="pm-calendar-batch-inline">起始日<input name="start" type="date" value="${escapeAttr(rule.start || '')}" aria-label="起始日"></label>${chip('name="seasonOnly"', '仅在阶段内', rule.seasonOnly === true)}</div>
        <input name="note" maxlength="1000" value="${escapeAttr(rule.note || '')}" placeholder="备注（可选）" aria-label="备注">
        <div class="pm-calendar-editor-actions">${id === 'new' ? '<button type="button" data-action="calendar-batch-rule-cancel">取消</button>' : `<button type="button" data-action="calendar-batch-rule-delete" data-rule-id="${escapeAttr(id)}">删除</button>`}<button type="button" class="is-primary" data-action="calendar-batch-rule-save" data-rule-id="${escapeAttr(id)}">保存</button></div>
    </div>`;
}

function fixedSection(model) {
    const { rules, season, seasonDraft, books, importPreview, importing, busy } = model;
    const cards = rules.map(({ id, rule }) => ruleCard(id, rule)).join('');
    const seasonValue = seasonDraft || season || {};
    const seasonEnd = season ? occasionSeasonEnd(season) : '';
    const preview = importPreview ? `<div class="pm-calendar-batch-preview" data-batch-import-preview>
        ${importPreview.map((item, index) => `<div class="pm-calendar-batch-preview-item">${chip(`data-batch-import-index="${index}"`, item.title, item.checked && !item.duplicate, item.duplicate)}<small class="pm-calendar-setting-hint">${escapeHtml([batchRuleSummary(item), item.duplicate ? '已存在' : ''].filter(Boolean).join(' · '))}</small></div>`).join('')}
        <div class="pm-calendar-editor-actions"><button type="button" data-action="calendar-batch-import-discard">放弃</button><button type="button" class="is-primary" data-action="calendar-batch-import-apply">写入所选</button></div></div>` : '';
    const importHint = books.length ? '' : '<small class="pm-calendar-attribution">在日历设置的「数据来源」中选择世界书后可用。</small>';
    return group('重复日程', `${cards || '<p class="pm-calendar-setting-hint">暂无重复日程。</p>'}
        <div class="pm-calendar-editor-actions"><button type="button" data-action="calendar-batch-import" ${busy || !books.length ? 'disabled' : ''}>${importing ? '正在读取…' : '从世界书整理'}</button></div>
        ${importHint}
        ${preview}
        <h4 class="pm-calendar-batch-subtitle">阶段</h4>
        <input maxlength="20" data-batch-season-name value="${escapeAttr(seasonValue.name || '')}" placeholder="阶段名称（可选，如学期、赛季）" aria-label="阶段名称">
        <div class="pm-calendar-batch-pair"><label class="pm-calendar-batch-inline">开始日期<input type="date" data-batch-season-start value="${escapeAttr(seasonValue.start || '')}" aria-label="开始日期"></label><label class="pm-calendar-batch-inline">持续周数<input type="number" min="1" max="104" inputmode="numeric" data-batch-season-weeks value="${escapeAttr(String(seasonValue.weeks || ''))}" aria-label="持续周数"></label></div>
        ${seasonEnd ? `<small class="pm-calendar-attribution">至${escapeHtml(seasonEnd)}</small>` : ''}
        <div class="pm-calendar-editor-actions"><button type="button" data-action="calendar-batch-season-clear" ${season ? '' : 'disabled'}>清空</button><button type="button" class="is-primary" data-action="calendar-batch-season-save">保存阶段</button></div>`);
}

// AI生成结果：只列出生成了内容的日子，每天一张卡，一行一件事，可逐条删除。
function resultSection(model) {
    const { draftDates, reference, draftTexts: texts } = model;
    const rows = draftDates.map(date => {
        const parsed = parseCalendarDate(date);
        const relative = relativeCalendarLabel(reference, date);
        const items = parseBatchDayText(texts[date]).map((item, index) => {
            const time = calendarTimeLabel(item.time);
            return `<li><span>${escapeHtml(`${time ? `${time} ` : ''}${item.title}`)}${item.note ? `<small class="pm-calendar-setting-hint">${escapeHtml(item.note)}</small>` : ''}</span><button type="button" data-action="calendar-batch-line-delete" data-date="${date}" data-index="${index}">删除</button></li>`;
        }).join('');
        return `<div class="pm-calendar-batch-day">
            <div class="pm-calendar-batch-day-head"><b>${escapeHtml(dayFormat.format(parsed))}</b><span>${escapeHtml(weekdayFormat.format(parsed))}${relative ? ` · ${escapeHtml(relative)}` : ''}</span></div>
            <ul class="pm-calendar-batch-fixed">${items}</ul>
        </div>`;
    }).join('');
    return rows ? group('生成结果', rows, ' pm-calendar-batch-days') : '';
}

function aiSection(model) {
    const { rangeMode, customStart, customEnd, plan, generating, busy } = model;
    const option = (value, label) => `<option value="${value}" ${rangeMode === value ? 'selected' : ''}>${label}</option>`;
    return group('生成范围', `<select data-action="calendar-batch-range" data-batch-range aria-label="生成范围">${option('week', '这一周')}${option('month', '这个月')}${option('custom', '自选起止日')}</select>
        ${rangeMode === 'custom' ? `<div class="pm-calendar-batch-pair"><label class="pm-calendar-batch-inline">开始<input type="date" data-batch-custom-start value="${escapeAttr(customStart)}" aria-label="开始日期"></label><label class="pm-calendar-batch-inline">结束<input type="date" data-batch-custom-end value="${escapeAttr(customEnd)}" aria-label="结束日期"></label></div><small class="pm-calendar-attribution">最多8周。</small>` : ''}
        <textarea data-batch-plan maxlength="3000" placeholder="我的安排（可选，优先级最高）" aria-label="我的安排">${escapeHtml(plan)}</textarea>
        <small class="pm-calendar-attribution">生成后确认无误再保存。</small>
        <div class="pm-calendar-editor-actions">${generating ? '<button type="button" data-action="calendar-batch-cancel">取消生成</button>' : ''}<button type="button" class="is-primary" data-action="calendar-batch-generate" ${busy ? 'disabled' : ''}>${generating ? '正在生成…' : '生成'}</button></div>`);
}

export function renderCalendarBatchPage(model, status = '') {
    return `<div id="pm-calendar-app" class="pm-calendar-shell is-settings is-batch" data-calendar-view-mode="schedule">
        <header class="pm-calendar-header is-sub"><button type="button" class="pm-calendar-icon-button" data-action="calendar-batch-close" aria-label="返回日历">${BACK_ICON_SVG}</button><h2>${model.mode === 'manual' ? '重复日程与阶段' : 'AI生成日程'}</h2><span class="pm-calendar-header-spacer" aria-hidden="true"></span></header>
        ${model.mode === 'manual' ? '' : `<div class="pm-calendar-batch-bar">
            <button type="button" class="pm-calendar-month-nav" data-action="calendar-batch-prev-week" aria-label="上一周" title="上一周">${BACK_ICON_SVG}</button>
            <input type="date" data-action="calendar-batch-start" value="${escapeAttr(model.start)}" aria-label="起始日">
            <button type="button" class="pm-calendar-month-nav" data-action="calendar-batch-next-week" aria-label="下一周" title="下一周">${FORWARD_ICON_SVG}</button>
            <button type="button" class="pm-calendar-batch-save" data-action="calendar-batch-save" ${model.busy || !model.drafted.size ? 'disabled' : ''}>保存</button>
        </div>`}
        <div class="pm-calendar-management" data-calendar-management="batch">
            ${model.mode === 'manual' ? fixedSection(model) : `${aiSection(model)}${resultSection(model)}`}
        </div>
        <div class="pm-calendar-status" aria-live="polite">${escapeHtml(status)}</div>
    </div>`;
}
