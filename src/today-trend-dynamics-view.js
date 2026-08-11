import { BACK_ICON_SVG, BOOK_ICON_SVG, EDIT_ICON_SVG, REFRESH_ICON_SVG, SETTINGS_ICON_SVG, SPARKLES_ICON_SVG, TRASH_ICON_SVG } from './icons.js';
import { escapeAttr, escapeHtml } from './ui.js';
import { trendInlineActions, trendMeter, trendModuleHead, trendToggleField } from './today-trend-ui.js';

const TYPES = Object.freeze({ normal: '常规动态', incident: '突发事件', rumor: '流言蜚语', underground: '地下线' });
const OUTCOMES = Object.freeze({ resolved: '已解决', failed: '已失败', terminated: '已终止', inconclusive: '无定论', confirmed: '已证实', debunked: '已证伪', absorbed: '已承接' });
const text = value => escapeHtml(String(value || ''));
const icon = (action, glyph, label, attrs = '', danger = false) => ({ action, icon: glyph, label, attrs, danger });
const outcomes = (selected, rumor) => Object.entries(OUTCOMES).filter(([key]) => rumor ? ['confirmed', 'debunked'].includes(key) : ['resolved', 'failed', 'terminated', 'inconclusive'].includes(key)).map(([key, label]) => `<option value="${key}"${key === selected ? ' selected' : ''}>${label}</option>`).join('');
const SVG = (body, className = '') => `<svg class="${className}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
const EVENT_ICONS = Object.freeze({
    location: SVG('<path d="M20 10c0 5-8 11-8 11S4 15 4 10a8 8 0 1 1 16 0z"/><circle cx="12" cy="10" r="2.5"/>'),
    signal: SVG('<path d="M5 9.5a10 10 0 0 1 14 0M8 13a6 6 0 0 1 8 0M11 16.5a2 2 0 0 1 2 0"/><circle cx="12" cy="19" r="1" fill="currentColor" stroke="none"/>'),
    rumor: SVG('<path d="M4 5h16v11H8l-4 4z"/><path d="M8 9h8M8 12h5"/>'),
    document: SVG('<path d="M5 5h14v14H5z"/><path d="M8 9h8M8 12h8M8 15h5"/>'),
    incident: SVG('<path d="m13 2-8 12h6l-1 8 8-12h-6z"/>'),
    normal: SVG('<circle cx="12" cy="12" r="8"/><path d="M8 12h8M12 8v8"/>'),
    underground: SVG('<path d="M4 7h16M6 7v10h12V7M9 17v3h6v-3"/><path d="M9 11h6"/>'),
});
function eventIcon(event) {
    const title = String(event.title || '');
    if (/航线|区域|地点|港|城/.test(title)) return EVENT_ICONS.location;
    if (/联络|窗口|信号|协作/.test(title)) return EVENT_ICONS.signal;
    if (/传闻|流言/.test(title)) return EVENT_ICONS.rumor;
    if (/公告|签署/.test(title)) return EVENT_ICONS.document;
    return EVENT_ICONS[event.type] || EVENT_ICONS.normal;
}
function badge(event) {
    const labels = { incident: '突发', rumor: '流言', underground: '地下线' };
    return labels[event.type] ? `<span class="pm-today-trend-event-badge">${labels[event.type]}</span>` : '';
}
function pill(archived, state) {
    return `<span class="pm-today-trend-event-pill${archived ? '' : ' is-live'}">${!archived ? '<i aria-hidden="true"></i>' : ''}${text(state)}</span>`;
}
function eventForm(event = {}, kind = 'event') {
    const participants = Array.isArray(event.participants) ? event.participants : [];
    const fields = kind === 'archive' ? `<label class="pm-today-trend-field">完结结果<select class="pm-today-trend-input" name="outcome">${outcomes(event.type === 'rumor' ? 'confirmed' : 'resolved', event.type === 'rumor')}</select></label><label class="pm-today-trend-field">最终结果<textarea class="pm-today-trend-input" name="finalResult" maxlength="600" required></textarea></label>` : `<label class="pm-today-trend-field">名称<input class="pm-today-trend-input" name="title" maxlength="120" required value="${escapeAttr(event.title || '')}"></label><label class="pm-today-trend-field">类型<select class="pm-today-trend-input" name="type">${Object.entries(TYPES).map(([key,label]) => `<option value="${key}"${key === (event.type || 'normal') ? ' selected' : ''}>${label}</option>`).join('')}</select></label><label class="pm-today-trend-field">阶段<input class="pm-today-trend-input" name="stageLabel" maxlength="8" required value="${escapeAttr(event.stageLabel || '准备中')}"></label><label class="pm-today-trend-field">起因<textarea class="pm-today-trend-input" name="origin" maxlength="600" required>${text(event.origin || '')}</textarea></label><label class="pm-today-trend-field">涉及主体<input class="pm-today-trend-input" name="participants" maxlength="600" value="${escapeAttr(participants.join('、'))}"></label><label class="pm-today-trend-field">最新阶段<textarea class="pm-today-trend-input" name="latestStage" maxlength="600" required>${text(event.latestStage || '')}</textarea></label>`;
    return `<form class="pm-today-trend-editor" data-today-trend-form="${kind === 'archive' ? 'event-archive' : kind === 'promotion' ? 'event-promotion' : 'event'}">${kind === 'promotion' ? `<input type="hidden" name="sourceEventId" value="${escapeAttr(event.id || '')}">` : `<input type="hidden" name="id" value="${escapeAttr(event.id || '')}">`}${fields}<div class="pm-today-trend-form-actions"><button type="button" data-action="today-trend-cancel-event-editor">取消</button><button type="submit">${kind === 'archive' ? '确认归档' : kind === 'promotion' ? '确认升级' : '保存'}</button></div></form>`;
}
function settingsForm(settings) {
    return `<form class="pm-today-trend-editor" data-today-trend-form="dynamics-settings"><label class="pm-today-trend-field">同时追踪上限<input class="pm-today-trend-input" name="trackingLimit" type="number" min="1" max="80" required value="${settings.trackingLimit}"></label>${trendToggleField('appendOnlyOnActualProgress', '仅实际进展时追加阶段', settings.appendOnlyOnActualProgress)}${trendToggleField('autoComplete', '自动判断完结', settings.autoComplete)}${trendToggleField('archiveCompleted', '完结后归档', settings.archiveCompleted)}${trendToggleField('incidentEnabled', '启用突发事件', settings.incident.enabled)}<label class="pm-today-trend-field">突发概率（0-100）<input class="pm-today-trend-input" name="incidentProbability" type="number" min="0" max="100" required value="${settings.incident.probability}"></label>${trendToggleField('rumorEnabled', '启用流言蜚语', settings.rumor.enabled)}${trendToggleField('undergroundEnabled', '启用地下线', settings.underground.enabled)}<div class="pm-today-trend-form-actions"><button type="button" data-action="today-trend-open-dynamics">取消</button><button type="submit">设置</button></div></form>`;
}
function eventCard(event, archived, actionsVisible, generateAttrs) {
    const state = archived ? OUTCOMES[event.outcome] || event.outcome : event.stageLabel;
    const eventAttrs = `data-event-id="${escapeAttr(event.id)}"`;
    const actions = archived ? [icon('today-trend-delete-event', TRASH_ICON_SVG, `删除${event.title}`, `${eventAttrs} data-label="${escapeAttr(event.title)}"`, true)] : [icon('today-trend-advance-event', REFRESH_ICON_SVG, `重新生成${event.title}`, `${eventAttrs} ${generateAttrs}`), icon('today-trend-edit-event', EDIT_ICON_SVG, `编辑${event.title}`, eventAttrs), icon('today-trend-archive-event', TRASH_ICON_SVG, `归档${event.title}`, eventAttrs), ...(event.type === 'underground' ? [icon('today-trend-promote-underground', SPARKLES_ICON_SVG, `升级${event.title}`, eventAttrs)] : [])];
    const stages = Array.isArray(event.stages) ? event.stages : [];
    const participants = Array.isArray(event.participants) ? event.participants : [];
    const stageList = stages.map((stage, index) => `<li${!archived && index === stages.length - 1 ? ' class="is-current"' : ''}><span class="pm-today-trend-stage-tag">${!archived && index === stages.length - 1 ? '最新阶段' : `阶段 ${String(index + 1).padStart(2, '0')}`}</span>${text(stage)}</li>`).join('');
    const history = archived
        ? `<details class="pm-today-trend-event-history"><summary>阶段记录（${stages.length}）</summary><ol>${stageList}</ol></details>`
        : `<ol class="pm-today-trend-event-history is-live">${stageList}</ol>`;
    return `<article class="pm-today-trend-event-card${archived ? ' is-archived' : ''}" data-event-id="${escapeAttr(event.id)}" data-event-type="${escapeAttr(event.type)}"><span class="pm-today-trend-event-marker" aria-hidden="true">${eventIcon(event)}</span><div class="pm-today-trend-event-body"><header><div class="pm-today-trend-event-heading"><b>${text(event.title)}</b><span class="pm-today-trend-event-tags">${badge(event)}${pill(archived, state)}</span></div>${trendInlineActions({ visible: actionsVisible, actions })}</header><dl class="pm-today-trend-event-facts"><div><dt>起因</dt><dd>${text(event.origin)}</dd></div><div><dt>主体</dt><dd>${text(participants.join('、') || '未记录')}</dd></div></dl>${history}${archived ? `<div class="pm-today-trend-event-latest"><strong>最终结果</strong><span>${text(event.finalResult)}</span></div>` : ''}</div></article>`;
}
export function renderTodayTrendDynamicsView({ scope, preset = null, editingEventId = null, editingRule = null, ruleDraft = null, mode = 'content', dynamicsTab = 'active', menuOpenId = null, generationAvailable = false, generationBusy = false, floorStatus = '' } = {}) {
    if (!scope) return '<p class="pm-today-trend-empty">当前聊天尚未初始化今日风向。</p>';
    const attrs = `${generationAvailable && !generationBusy ? '' : 'disabled'} aria-busy="${generationBusy}"`;
    if (mode === 'settings') return `<section class="pm-today-trend-view">${trendModuleHead({ title: '事件追踪设置', menuId: 'dynamics-settings', menuOpenId, actions: [icon('today-trend-open-dynamics', BACK_ICON_SVG, '返回事件追踪')] })}${settingsForm(scope.dynamicsSettings)}</section>`;
    const activeEvents = Array.isArray(scope.dynamics?.active) ? scope.dynamics.active : [];
    const archivedEvents = Array.isArray(scope.dynamics?.archived) ? scope.dynamics.archived : [];
    const target = String(editingEventId || '').replace(/^(archive:|promote:)/, '');
    if (editingEventId) { const event = target === '__new__' ? {} : activeEvents.find(item => item.id === target); const kind = String(editingEventId).startsWith('archive:') ? 'archive' : String(editingEventId).startsWith('promote:') ? 'promotion' : 'event'; return `<section class="pm-today-trend-view">${event ? eventForm(event, kind) : eventForm()}</section>`; }
    const actionsVisible = menuOpenId === 'dynamics-module';
    const active = activeEvents.map(event => eventCard(event, false, actionsVisible, attrs)).join('') || '<p class="pm-today-trend-empty">暂无正在追踪的动态。</p>';
    const archived = archivedEvents.map(event => eventCard(event, true, actionsVisible, attrs)).join('') || '<p class="pm-today-trend-empty">暂无已完结动态。</p>';
    const activeCount = activeEvents.length;
    const archivedCount = archivedEvents.length;
    const tab = dynamicsTab === 'archived' ? 'archived' : 'active';
    const title = tab === 'archived' ? '事件归档' : '事件追踪';
    const trackerMeta = trendMeter(tab === 'archived' ? [{ label: 'DONE', value: archivedCount }, { label: 'TOTAL', value: activeCount + archivedCount }] : [{ label: 'LIVE', value: activeCount }, { label: 'MAX', value: scope.dynamicsSettings.trackingLimit }]);
    const tabSwitch = `<div class="pm-today-trend-dynamics-tabs" role="tablist" aria-label="事件追踪状态"><button id="pm-today-trend-active-tab" type="button" role="tab" data-action="today-trend-set-dynamics-tab" data-tab="active" aria-selected="${tab === 'active'}" aria-controls="pm-today-trend-active-panel" tabindex="${tab === 'active' ? '0' : '-1'}">正在追踪</button><button id="pm-today-trend-archived-tab" type="button" role="tab" data-action="today-trend-set-dynamics-tab" data-tab="archived" aria-selected="${tab === 'archived'}" aria-controls="pm-today-trend-archived-panel" tabindex="${tab === 'archived' ? '0' : '-1'}">已完结</button></div>`;
    const activePanel = `<section id="pm-today-trend-active-panel" class="pm-today-trend-dynamics-section${tab === 'active' ? '' : ' is-hidden'}" role="tabpanel" aria-labelledby="pm-today-trend-active-tab"${tab === 'active' ? '' : ' hidden'}><h3 id="pm-today-trend-active-title">正在追踪</h3><div class="pm-today-trend-event-list${activeCount ? ' has-events' : ''}">${active}</div></section>`;
    const archivedPanel = `<section id="pm-today-trend-archived-panel" class="pm-today-trend-dynamics-section${tab === 'archived' ? '' : ' is-hidden'}" role="tabpanel" aria-labelledby="pm-today-trend-archived-tab"${tab === 'archived' ? '' : ' hidden'}><h3 id="pm-today-trend-archived-title">已完结</h3><div class="pm-today-trend-event-list is-archived${archivedCount ? ' has-events' : ''}">${archived}</div></section>`;
    return `<section class="pm-today-trend-view pm-today-trend-dynamics">${trendModuleHead({ title, eyebrow: 'EVENT TRACKER', metaHtml: trackerMeta, asideHtml: floorStatus, menuId: 'dynamics-module', menuOpenId, actions: [icon('today-trend-advance-all-events', REFRESH_ICON_SVG, '重新生成事件追踪', attrs), icon('today-trend-edit-dynamics-rule', BOOK_ICON_SVG, '编辑事件追踪提示词'), icon('today-trend-open-dynamics-settings', SETTINGS_ICON_SVG, '事件追踪设置')] })}${tabSwitch}${activePanel}${archivedPanel}</section>`;
}
