import { BACK_ICON_SVG, CLOSE_ICON_SVG, MORE_ICON_SVG, TODAY_TREND_RELATION_ICON_PATHS } from './icons.js';
import { TODAY_TREND_RELATION_STATUSES, todayTrendStatusLabel } from './today-trend-model.js';
import { escapeAttr, escapeHtml } from './ui.js';

const relationStatus = status => TODAY_TREND_RELATION_STATUSES.includes(status) ? status : 'neutral';
export const trendRelationLabel = status => todayTrendStatusLabel(relationStatus(status));

export function trendRelationIcon(status) {
    const paths = TODAY_TREND_RELATION_ICON_PATHS[status] || TODAY_TREND_RELATION_ICON_PATHS.neutral;
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
}

export function trendRelationSymbol(status) {
    return `<span class="pm-today-trend-relation-symbol" aria-hidden="true">${trendRelationIcon(status)}</span>`;
}

// 名称首个汉字/字母作字头，用于圆形字头与成员叠放。
export function trendInitial(name) {
    return String(name || '').match(/[\p{Script=Han}\p{L}\p{N}]/u)?.[0]?.toUpperCase() || '·';
}

export function trendInitialStack(names = [], max = 3) {
    const list = names.map(name => String(name || '').trim()).filter(Boolean);
    if (!list.length) return '';
    const shown = list.slice(0, max).map(name => `<i class="pm-today-trend-initial" title="${escapeAttr(name)}">${escapeHtml(trendInitial(name))}</i>`).join('');
    const rest = list.length > max ? `<i class="pm-today-trend-initial is-count">+${list.length - max}</i>` : '';
    return `<span class="pm-today-trend-initial-stack" aria-label="${escapeAttr(list.join('、'))}">${shown}${rest}</span>`;
}

// 关系胶囊：简约界面下作为循环切换按钮，否则只显示状态。
export function trendRelationPill({ status, action = '', idAttr = '', name = '', disabled = false } = {}) {
    const value = relationStatus(status);
    const label = trendRelationLabel(value);
    if (action) return `<button type="button" class="pm-today-trend-pill" data-relation="${value}" data-action="${escapeAttr(action)}" ${idAttr} data-status="${value}" aria-label="切换${escapeAttr(name)}的关系状态，当前：${escapeAttr(label)}"${disabled ? ' disabled' : ''}>${escapeHtml(label)}</button>`;
    return `<span class="pm-today-trend-pill" data-relation="${value}">${escapeHtml(label)}</span>`;
}

export function trendRelationMeter({ status, name = '', action = 'today-trend-set-circle-status', idAttr = '', disabled = false } = {}) {
    const value = relationStatus(status);
    const levels = TODAY_TREND_RELATION_STATUSES.map(level => `<button type="button" role="radio" data-relation="${level}" data-action="${escapeAttr(action)}" ${idAttr} data-status="${level}" aria-checked="${level === value}" tabindex="${level === value ? '0' : '-1'}"${level === value ? ' class="is-active"' : ''}${disabled ? ' disabled' : ''}>${escapeHtml(trendRelationLabel(level))}</button>`).join('');
    return `<div class="pm-today-trend-relation-meter" role="radiogroup" aria-label="修改${escapeAttr(name)}的关系，当前：${escapeAttr(trendRelationLabel(value))}">${levels}</div>`;
}

export const TODAY_TREND_EVENT_TYPE_LABELS = Object.freeze({ normal: '常规', incident: '突发', rumor: '流言', underground: '地下线' });
export const TODAY_TREND_EVENT_OUTCOME_LABELS = Object.freeze({ resolved: '已解决', failed: '已失败', terminated: '已终止', inconclusive: '无定论', confirmed: '已证实', debunked: '已证伪', absorbed: '已承接' });

export function trendTypePill(type) {
    const value = Object.hasOwn(TODAY_TREND_EVENT_TYPE_LABELS, type) ? type : 'normal';
    return `<span class="pm-today-trend-pill" data-event-type="${value}">${TODAY_TREND_EVENT_TYPE_LABELS[value]}</span>`;
}

export const trendStageText = stage => String((stage && typeof stage === 'object' ? stage.displayText : stage) ?? '');
export function trendEventLatest(event) {
    const stages = Array.isArray(event?.stages) ? event.stages : [];
    return typeof event?.latestStage === 'string' && event.latestStage ? event.latestStage : trendStageText(stages.at(-1));
}

// 信息格：图标 + 小标签 + 值，用于势力资料与事件起因。
export function trendFactTile({ icon, label, value }) {
    return `<div class="pm-today-trend-fact"><span class="pm-today-trend-fact-icon" aria-hidden="true">${icon}</span><div><small>${escapeHtml(label)}</small><b>${escapeHtml(value)}</b></div></div>`;
}

// 较上次更新的变化标记：kind 为 new / changed / up / down。
export function trendChangeChip(change) {
    if (!change) return '';
    const label = change.label || { new: '新', changed: '有更新', up: '升', down: '降' }[change.kind] || '有更新';
    return `<span class="pm-today-trend-change" data-change="${escapeAttr(change.kind)}">${escapeHtml(label)}</span>`;
}

export function trendStepsBar(count, max = 6) {
    const total = Math.min(Math.max(Number(count) || 0, 0), max);
    if (!total) return '';
    return `<span class="pm-today-trend-steps" aria-hidden="true">${'<i></i>'.repeat(total)}</span>`;
}

export function trendIconButton({ action, icon, label, attrs = '', danger = false, className = '' }) {
    return `<button type="button" class="pm-today-trend-icon-button${danger ? ' is-danger' : ''}${className ? ` ${className}` : ''}" data-action="${escapeAttr(action)}" aria-label="${escapeAttr(label)}" title="${escapeAttr(label)}" ${attrs}>${icon}</button>`;
}

export function trendActionMenu({ id, open = false, label, actions = [] }) {
    if (!actions.length) return '';
    const trigger = trendIconButton({
        action: 'today-trend-toggle-menu', icon: MORE_ICON_SVG,
        label: open ? `收起${label}` : label,
        attrs: `data-menu-id="${escapeAttr(id)}" aria-expanded="${open}"`,
    });
    const items = actions.map(action => trendIconButton({ ...action, className: 'pm-today-trend-menu-action' })).join('');
    const close = trendIconButton({ action: 'today-trend-close-menu', icon: CLOSE_ICON_SVG, label: '收起操作', className: 'pm-today-trend-menu-close' });
    return `<span class="pm-today-trend-menu-wrap${open ? ' is-open' : ''}">${open ? `<span class="pm-today-trend-menu" aria-label="${escapeAttr(label)}">${items}${close}</span>` : trigger}</span>`;
}

export function trendInlineActions({ visible = false, actions = [] } = {}) {
    if (!visible) return '';
    return `<span class="pm-today-trend-inline-actions">${actions.map(action => trendIconButton({ ...action, className: `pm-today-trend-inline-action${action.className ? ` ${action.className}` : ''}` })).join('')}</span>`;
}

// 详情页顶栏：左侧返回，右侧最多露出两个操作，其余收进 ⋯。
export function trendDetailBar({ backAction, backLabel, backAttrs = '', actions = [], menuId, menuOpenId }) {
    const exposed = actions.length <= 3 ? actions : actions.slice(0, 2);
    const overflow = actions.length <= 3 ? [] : actions.slice(2);
    const back = trendIconButton({ action: backAction, icon: BACK_ICON_SVG, label: backLabel, attrs: backAttrs });
    const tools = exposed.map(action => trendIconButton(action)).join('')
        + trendActionMenu({ id: menuId, open: menuOpenId === menuId, label: '更多操作', actions: overflow });
    return `<header class="pm-today-trend-detail-bar">${back}<span class="pm-today-trend-detail-tools">${tools}</span></header>`;
}

export function trendFloorStatus({ currentFloor, syncedFloor = 0, completedBatchFloor = null, phase = 'idle', lastError = null, busy = false, targetFloor = null, batchIndex = null, batchCount = null, targeted = false } = {}) {
    const synced = Number.isInteger(syncedFloor) && syncedFloor >= 0 ? syncedFloor : 0;
    const currentFloorProvided = currentFloor !== undefined;
    const completedBatch = Number.isInteger(completedBatchFloor) && completedBatchFloor >= 0 ? completedBatchFloor : null;
    const floor = completedBatch ?? (Number.isInteger(currentFloor) && currentFloor >= 0 ? currentFloor : currentFloorProvided ? null : synced);
    const target = Number.isInteger(targetFloor) && targetFloor >= 0 ? targetFloor : null;
    const terminalState = phase === 'failed' ? 'failed' : phase === 'canceled' ? 'canceled' : null;
    const state = busy ? 'updating' : terminalState || (floor === null ? 'unavailable' : floor > 0 && synced === floor ? 'synced' : 'unsynced');
    const batchStatus = Number.isSafeInteger(batchIndex) && batchIndex >= 0 && Number.isSafeInteger(batchCount) && batchCount > 0
        ? `第 ${batchIndex + 1}/${batchCount} 批`
        : Number.isSafeInteger(batchCount) && batchCount > 0 ? `准备批处理（共 ${batchCount} 批）` : '';
    const status = busy ? targeted ? '正在更新模块' : batchStatus || (target === null ? '正在同步' : `同步任务 #${target}`)
        : terminalState === 'failed' ? '同步失败' : terminalState === 'canceled' ? '已终止'
        : floor === null ? '楼层不可用' : floor > 0 && synced === floor ? '已同步' : floor > 0 ? '待同步' : '尚未同步';
    const reading = floor === null ? '第 -- 楼' : `第 ${floor} 楼`;
    const statusTitle = terminalState === 'failed' && lastError ? ` title="${escapeAttr(lastError)}"` : '';
    const readingHtml = `<span class="pm-today-trend-floor-value">${reading}</span>`;
    const statusHtml = busy
        ? `<button type="button" class="pm-today-trend-floor-cancel" data-action="today-trend-cancel-generation" aria-label="终止当前更新" title="终止当前更新">${readingHtml}<span class="pm-today-trend-floor-status"><i aria-hidden="true"></i>${escapeHtml(status)} · 点按终止</span></button>`
        : `${readingHtml}<span class="pm-today-trend-floor-status"${statusTitle}>${escapeHtml(status)}</span>`;
    return `<span class="pm-today-trend-floor" data-today-trend-floor="${floor ?? ''}" data-state="${state}" role="status" aria-live="polite" aria-label="${escapeAttr(reading)}，${escapeAttr(status)}">${statusHtml}</span>`;
}

// 分区标题：标题 + 可选说明 + 操作。操作不超过 exposedActionCount 时直接露出，其余收进 ⋯。
export function trendModuleHead({ title, menuId, menuOpenId, actions = [], meta = '', exposedActionCount = 3 }) {
    const exposed = actions.length <= exposedActionCount ? actions : [];
    const overflow = actions.length <= exposedActionCount ? [] : actions;
    const tools = exposed.map(action => trendIconButton(action)).join('')
        + trendActionMenu({ id: menuId, open: menuOpenId === menuId, label: `${title}操作`, actions: overflow });
    return `<header class="pm-today-trend-block-head"><div><h2>${escapeHtml(title)}</h2>${meta ? `<small>${escapeHtml(meta)}</small>` : ''}</div>${tools ? `<span class="pm-today-trend-section-tools">${tools}</span>` : ''}</header>`;
}

export function trendRuleEditor({ rule, value = '' } = {}) {
    if (!rule) return '';
    return `<form class="pm-today-trend-editor pm-today-trend-rule-editor" data-today-trend-form="rule-editor"><input type="hidden" name="rule" value="${escapeAttr(rule)}"><label class="pm-today-trend-field">提示词<textarea class="pm-today-trend-input" name="text" maxlength="12000" required autofocus>${escapeHtml(value)}</textarea></label><div class="pm-today-trend-form-actions pm-action-pair"><button type="button" data-action="today-trend-cancel-rule-editor">返回</button><button type="submit">保存提示词</button></div></form>`;
}

export function trendToggleField(name, label, checked) {
    return `<label class="pm-today-trend-switch"><span>${escapeHtml(label)}</span><input name="${escapeAttr(name)}" type="checkbox" role="switch" aria-checked="${checked === true}"${checked ? ' checked' : ''}><i aria-hidden="true"></i></label>`;
}
