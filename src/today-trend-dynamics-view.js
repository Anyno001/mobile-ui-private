import { BOOK_ICON_SVG, CHARACTER_ICON_SVG, EDIT_ICON_SVG, REFRESH_ICON_SVG, SETTINGS_ICON_SVG, SPARKLES_ICON_SVG, TIME_ORIGIN_ICON_SVG, TRASH_ICON_SVG } from './icons.js';
import { escapeAttr, escapeHtml } from './ui.js';
import {
    TODAY_TREND_EVENT_OUTCOME_LABELS, TODAY_TREND_EVENT_TYPE_LABELS, trendActionMenu, trendChangeChip, trendDetailBar, trendEventLatest,
    trendFactTile, trendInitialStack, trendModuleHead, trendStageText, trendStepsBar, trendToggleField, trendTypePill,
} from './today-trend-ui.js';

const TYPES = Object.freeze({ normal: '常规动态', incident: '突发事件', rumor: '流言蜚语', underground: '地下线' });
const text = value => escapeHtml(String(value ?? ''));
const icon = (action, glyph, label, attrs = '', danger = false) => ({ action, icon: glyph, label, attrs, danger });
const outcomes = (selected, rumor) => Object.entries(TODAY_TREND_EVENT_OUTCOME_LABELS).filter(([key]) => rumor ? ['confirmed', 'debunked'].includes(key) : ['resolved', 'failed', 'terminated', 'inconclusive'].includes(key)).map(([key, label]) => `<option value="${key}"${key === selected ? ' selected' : ''}>${label}</option>`).join('');

function eventForm(event = {}, kind = 'event') {
    const participants = Array.isArray(event.participants) ? event.participants : [];
    const fields = kind === 'archive' ? `<label class="pm-today-trend-field">完结结果<select class="pm-today-trend-input" name="outcome">${outcomes(event.type === 'rumor' ? 'confirmed' : 'resolved', event.type === 'rumor')}</select></label><label class="pm-today-trend-field">最终结果<textarea class="pm-today-trend-input" name="finalResult" maxlength="600" required></textarea></label>` : `<label class="pm-today-trend-field">名称<input class="pm-today-trend-input" name="title" maxlength="120" required value="${escapeAttr(event.title || '')}"></label><label class="pm-today-trend-field">类型<select class="pm-today-trend-input" name="type">${Object.entries(TYPES).map(([key,label]) => `<option value="${key}"${key === (event.type || 'normal') ? ' selected' : ''}>${label}</option>`).join('')}</select></label><label class="pm-today-trend-field">阶段<input class="pm-today-trend-input" name="stageLabel" maxlength="8" required value="${escapeAttr(event.stageLabel || '准备中')}"></label><label class="pm-today-trend-field">起因<textarea class="pm-today-trend-input" name="origin" maxlength="600" required>${text(event.origin || '')}</textarea></label><label class="pm-today-trend-field">涉及主体<input class="pm-today-trend-input" name="participants" maxlength="600" value="${escapeAttr(participants.join('、'))}"></label><label class="pm-today-trend-field">最新阶段<textarea class="pm-today-trend-input" name="latestStage" maxlength="600" required>${text(event.latestStage || '')}</textarea></label>`;
    return `<form class="pm-today-trend-editor pm-today-trend-item-editor" data-today-trend-form="${kind === 'archive' ? 'event-archive' : kind === 'promotion' ? 'event-promotion' : 'event'}">${kind === 'promotion' ? `<input type="hidden" name="sourceEventId" value="${escapeAttr(event.id || '')}">` : `<input type="hidden" name="id" value="${escapeAttr(event.id || '')}">`}${fields}<div class="pm-today-trend-form-actions pm-action-pair"><button type="button" data-action="today-trend-cancel-event-editor">取消</button><button type="submit">${kind === 'archive' ? '确认归档' : kind === 'promotion' ? '确认升级' : '保存'}</button></div></form>`;
}
function settingsForm(settings) {
    return `<form class="pm-today-trend-editor" data-today-trend-form="dynamics-settings"><label class="pm-today-trend-field">同时追踪上限<input class="pm-today-trend-input" name="trackingLimit" type="number" min="1" max="80" required value="${settings.trackingLimit}"></label>${trendToggleField('appendOnlyOnActualProgress', '仅实际进展时追加阶段', settings.appendOnlyOnActualProgress)}${trendToggleField('autoComplete', '自动判断完结', settings.autoComplete)}${trendToggleField('archiveCompleted', '完结后归档', settings.archiveCompleted)}${trendToggleField('incidentEnabled', '启用突发事件', settings.incident.enabled)}<label class="pm-today-trend-field">突发概率（0-100）<input class="pm-today-trend-input" name="incidentProbability" type="number" min="0" max="100" required value="${settings.incident.probability}"></label>${trendToggleField('rumorEnabled', '启用流言蜚语', settings.rumor.enabled)}${trendToggleField('undergroundEnabled', '启用地下线', settings.underground.enabled)}<div class="pm-today-trend-form-actions pm-action-pair"><button type="button" data-action="today-trend-open-dynamics">取消</button><button type="submit">保存</button></div></form>`;
}
function dayTimeLabel(stage) {
    if (typeof stage.timeRange === 'string') return stage.timeRange;
    if (stage.timeRange?.start && stage.timeRange?.end) return `${stage.timeRange.start}–${stage.timeRange.end}`;
    if (stage.timeRange?.label) return stage.timeRange.label;
    return stage.timeLabel || stage.time || '';
}
function stageBoundary(stage) {
    if (stage?.kind === 'day-summary' && stage.storyDate) {
        const time = dayTimeLabel(stage);
        return { key: `day:${stage.storyDate}`, dateTime: stage.storyDate, label: time ? `${stage.storyDate} · ${time}` : stage.storyDate };
    }
    if (stage?.kind === 'period-summary' && stage.startDate && stage.endDate) {
        const sameDate = stage.startDate === stage.endDate;
        const time = stage.startTime && stage.endTime ? `${stage.startTime}–${stage.endTime}` : '';
        const label = sameDate ? `${stage.startDate}${time ? ` · ${time}` : ''}`
            : `${stage.startDate}${stage.startTime ? ` ${stage.startTime}` : ''} – ${stage.endDate}${stage.endTime ? ` ${stage.endTime}` : ''}`;
        return { key: `period:${stage.startDate}:${stage.startTime || ''}:${stage.endDate}:${stage.endTime || ''}`, dateTime: stage.startDate, label };
    }
    return null;
}
function stageDetails(stage, eventId, detailById, loadingDetailIds) {
    const refs = stage?.kind === 'day-summary' && Array.isArray(stage.detailRefs) ? stage.detailRefs : [];
    const buttons = refs.map(detailId => {
        const state = detailById[detailId];
        const label = state?.status === 'available' ? state.text : state?.status === 'unavailable' ? '详情不可用' : '展开当日详情';
        const disabled = loadingDetailIds.has(detailId) || state?.status === 'available' || state?.status === 'unavailable' ? ' disabled' : '';
        return `<button type="button" class="pm-today-trend-detail-action" data-action="today-trend-load-detail" data-event-id="${escapeAttr(eventId)}" data-detail-id="${escapeAttr(detailId)}"${disabled}>${escapeHtml(label)}</button>`;
    }).join('');
    return buttons ? `<div class="pm-today-trend-detail-actions">${buttons}</div>` : '';
}

// 阶段时间线：最新在上。日期跟着阶段走，同一天只写一次。
function timeline(event, archived, detailById, loadingDetailIds) {
    const stages = Array.isArray(event.stages) ? event.stages : [];
    let previousKey = '';
    const items = stages.map((stage, index) => {
        const boundary = stageBoundary(stage);
        const date = boundary && boundary.key !== previousKey ? `<time datetime="${escapeAttr(boundary.dateTime)}">${text(boundary.label)}</time>` : '';
        previousKey = boundary?.key || '';
        const current = !archived && index === stages.length - 1;
        return `<li${current ? ' class="is-current"' : ''}>${date}<b>${current ? '最新阶段' : `阶段 ${index + 1}`}</b><p>${text(trendStageText(stage))}</p>${stageDetails(stage, event.id, detailById, loadingDetailIds)}</li>`;
    }).reverse().join('');
    return items ? `<ol class="pm-today-trend-timeline">${items}</ol>` : '<p class="pm-today-trend-empty">暂无阶段记录。</p>';
}

function eventCard(event, archived, changes) {
    const stages = Array.isArray(event.stages) ? event.stages : [];
    const people = Array.isArray(event.participants) ? event.participants : [];
    const state = archived ? `<span class="pm-today-trend-pill">${text(TODAY_TREND_EVENT_OUTCOME_LABELS[event.outcome] || event.outcome || '已完结')}</span>` : trendChangeChip(changes?.events?.[event.id]);
    const copy = archived ? event.finalResult || trendEventLatest(event) : trendEventLatest(event);
    return `<button type="button" class="pm-today-trend-card${archived ? ' is-archived' : ''}" data-action="today-trend-open-event" data-event-id="${escapeAttr(event.id)}" data-event-type="${escapeAttr(event.type)}"><span class="pm-today-trend-card-tags">${trendTypePill(event.type)}${state}</span><b class="pm-today-trend-card-title">${text(event.title)}</b><span class="pm-today-trend-card-copy">${text(copy)}</span>${archived ? '' : trendStepsBar(stages.length)}<span class="pm-today-trend-card-meta">${trendInitialStack(people)}<small>${text(archived ? `共 ${stages.length} 个阶段` : event.stageLabel || `阶段 ${stages.length}`)}</small></span></button>`;
}

function eventDetail(event, archived, { attrs, changes, detailById, loadingDetailIds, menuOpenId }) {
    const eventAttrs = `data-event-id="${escapeAttr(event.id)}"`;
    const actions = archived ? [icon('today-trend-delete-event', TRASH_ICON_SVG, `删除${event.title}`, `${eventAttrs} data-label="${escapeAttr(event.title)}"`, true)]
        : [icon('today-trend-advance-event', REFRESH_ICON_SVG, `重新生成${event.title}`, `${eventAttrs} ${attrs}`), icon('today-trend-edit-event', EDIT_ICON_SVG, `编辑${event.title}`, eventAttrs), icon('today-trend-archive-event', TRASH_ICON_SVG, `归档${event.title}`, eventAttrs), ...(event.type === 'underground' ? [icon('today-trend-promote-underground', SPARKLES_ICON_SVG, `升级${event.title}`, eventAttrs)] : [])];
    const participants = Array.isArray(event.participants) ? event.participants : [];
    const state = archived ? TODAY_TREND_EVENT_OUTCOME_LABELS[event.outcome] || event.outcome || '已完结' : event.stageLabel || '进行中';
    return `<section class="pm-today-trend-view pm-today-trend-detail" data-event-id="${escapeAttr(event.id)}" data-event-type="${escapeAttr(event.type)}">${trendDetailBar({ backAction: 'today-trend-close-detail', backLabel: '返回', menuId: `event:${event.id}`, menuOpenId, actions })}
        <span class="pm-today-trend-card-tags">${trendTypePill(event.type)}<span class="pm-today-trend-pill">${text(state)}</span>${archived ? '' : trendChangeChip(changes?.events?.[event.id])}</span>
        <h2 class="pm-today-trend-detail-title">${text(event.title)}</h2>
        <div class="pm-today-trend-facts">${trendFactTile({ icon: TIME_ORIGIN_ICON_SVG, label: '起因', value: event.origin || '未记录' })}${trendFactTile({ icon: CHARACTER_ICON_SVG, label: '涉及主体', value: participants.join('、') || '未记录' })}</div>
        ${archived ? `<section class="pm-today-trend-detail-section"><h3>最终结果</h3><blockquote class="pm-today-trend-quote">${text(event.finalResult)}</blockquote></section>` : ''}
        <section class="pm-today-trend-detail-section"><h3>阶段记录</h3>${timeline(event, archived, detailById, loadingDetailIds)}</section>
    </section>`;
}

export function renderTodayTrendDynamicsView({ scope, mode = 'content', detailId = null, changes = null, dynamicsTab = 'active', editingEventId = null, menuOpenId = null, generationAvailable = false, generationBusy = false, detailById = {}, loadingDetailIds = new Set() } = {}) {
    if (!scope) return '<p class="pm-today-trend-empty">当前聊天尚未初始化今日风向。</p>';
    const attrs = `${generationAvailable && !generationBusy ? '' : 'disabled'} aria-busy="${generationBusy}"`;
    if (mode === 'settings') return `<section class="pm-today-trend-view">${trendModuleHead({ title: '事件追踪设置', menuId: 'dynamics-settings', menuOpenId })}${settingsForm(scope.dynamicsSettings)}</section>`;
    const activeEvents = Array.isArray(scope.dynamics?.active) ? scope.dynamics.active : [];
    const archivedEvents = Array.isArray(scope.dynamics?.archived) ? scope.dynamics.archived : [];
    const target = String(editingEventId || '').replace(/^(archive:|promote:)/, '');
    if (editingEventId) {
        const event = target === '__new__' ? {} : activeEvents.find(item => item.id === target);
        const kind = String(editingEventId).startsWith('archive:') ? 'archive' : String(editingEventId).startsWith('promote:') ? 'promotion' : 'event';
        const title = kind === 'archive' ? '归档事件' : kind === 'promotion' ? '升级为突发事件' : target === '__new__' ? '添加事件' : '编辑事件';
        return `<section class="pm-today-trend-view">${trendModuleHead({ title, menuId: 'event-editor', menuOpenId })}${event ? eventForm(event, kind) : eventForm()}</section>`;
    }
    const detailActive = detailId ? activeEvents.find(item => item.id === detailId) : null;
    const detailArchived = detailId && !detailActive ? archivedEvents.find(item => item.id === detailId) : null;
    if (detailActive || detailArchived) return eventDetail(detailActive || detailArchived, Boolean(detailArchived), { attrs, changes, detailById, loadingDetailIds, menuOpenId });
    const tab = dynamicsTab === 'archived' ? 'archived' : 'active';
    const tabButton = (name, label, count) => `<button type="button" role="tab" id="pm-today-trend-${name}-tab" data-action="today-trend-set-dynamics-tab" data-tab="${name}" aria-controls="pm-today-trend-${name}-panel" aria-selected="${tab === name}" tabindex="${tab === name ? '0' : '-1'}">${label} ${count}</button>`;
    const menu = trendActionMenu({ id: 'dynamics-module', open: menuOpenId === 'dynamics-module', label: '事件追踪操作', actions: [
        icon('today-trend-advance-all-events', REFRESH_ICON_SVG, '重新生成事件追踪', attrs), icon('today-trend-edit-dynamics-rule', BOOK_ICON_SVG, '编辑事件追踪提示词'), icon('today-trend-open-dynamics-settings', SETTINGS_ICON_SVG, '事件追踪设置'),
    ] });
    const tabs = `<header class="pm-today-trend-tab-head"><div class="pm-today-trend-tabbar" role="tablist" aria-label="事件追踪">${tabButton('active', '进行中', activeEvents.length)}${tabButton('archived', '已完结', archivedEvents.length)}</div>${menu}</header>`;
    let panel;
    if (tab === 'archived') {
        panel = archivedEvents.map(event => eventCard(event, true, changes)).join('') || '<p class="pm-today-trend-empty">暂无已完结事件。</p>';
    } else if (!activeEvents.length) {
        panel = '<p class="pm-today-trend-empty">暂无正在追踪的事件。</p>';
    } else {
        const changed = activeEvents.filter(event => changes?.events?.[event.id]);
        const rest = activeEvents.filter(event => !changes?.events?.[event.id]);
        const group = (label, events) => events.length ? `<h3 class="pm-today-trend-group-title">${label}</h3>${events.map(event => eventCard(event, false, changes)).join('')}` : '';
        panel = changed.length ? group('较上次更新', changed) + group('其他', rest) : activeEvents.map(event => eventCard(event, false, changes)).join('');
    }
    const meta = `<p class="pm-today-trend-section-meta">追踪 ${activeEvents.length} / 上限 ${scope.dynamicsSettings.trackingLimit}</p>`;
    return `<section class="pm-today-trend-view pm-today-trend-dynamics">${tabs}${meta}<div id="pm-today-trend-${tab}-panel" class="pm-today-trend-tab-panel" role="tabpanel" aria-labelledby="pm-today-trend-${tab}-tab">${panel}</div></section>`;
}
