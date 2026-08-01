import { EDIT_ICON_SVG, SETTINGS_ICON_SVG, SPARKLES_ICON_SVG, TRASH_ICON_SVG } from './icons.js';
import { escapeAttr, escapeHtml } from './ui.js';

const TYPE_LABELS = Object.freeze({ normal: '常规动态', incident: '突发事件', rumor: '流言蜚语', underground: '地下线' });
const OUTCOME_LABELS = Object.freeze({ resolved: '已解决', failed: '已失败', terminated: '已终止', inconclusive: '无定论', confirmed: '已证实', debunked: '已证伪', absorbed: '已承接' });
const text = value => escapeHtml(String(value || ''));
const button = (name, label, icon = '', attrs = '') => `<button type="button" class="pm-action-button is-secondary" data-action="${name}" ${attrs}>${icon}<span>${text(label)}</span></button>`;
const eventOptions = selected => Object.entries(TYPE_LABELS).map(([type, label]) => `<option value="${type}"${type === selected ? ' selected' : ''}>${label}</option>`).join('');
const outcomeOptions = (selected, rumor) => Object.entries(OUTCOME_LABELS).filter(([outcome]) => rumor ? outcome === 'confirmed' || outcome === 'debunked' : ['resolved', 'failed', 'terminated', 'inconclusive'].includes(outcome)).map(([outcome, label]) => `<option value="${outcome}"${outcome === selected ? ' selected' : ''}>${label}</option>`).join('');
const toggle = (name, label, checked) => `<label class="pm-today-trend-toggle"><input type="checkbox" name="${name}"${checked ? ' checked' : ''}><span>${label}</span></label>`;

function renderEvent(event, archived, generateAttrs) {
    const state = archived ? OUTCOME_LABELS[event.outcome] || event.outcome : event.stageLabel;
    const actions = archived
        ? button('today-trend-delete-event', '删除', TRASH_ICON_SVG, `data-event-id="${escapeAttr(event.id)}"`)
        : [button('today-trend-advance-event', '推进一步', SPARKLES_ICON_SVG, `data-event-id="${escapeAttr(event.id)}" ${generateAttrs}`), button('today-trend-edit-event', '编辑', EDIT_ICON_SVG, `data-event-id="${escapeAttr(event.id)}"`), event.type === 'underground' ? button('today-trend-promote-underground', '升级为突发', SPARKLES_ICON_SVG, `data-event-id="${escapeAttr(event.id)}"`) : '', button('today-trend-archive-event', '标记完结', '', `data-event-id="${escapeAttr(event.id)}"`)].join('');
    return `<article class="pm-today-trend-event-card"><header><b>${text(event.title)}</b><span>${text(TYPE_LABELS[event.type] || event.type)}｜${text(state)}</span></header><p><strong>起因：</strong>${text(event.origin)}</p><p><strong>涉及主体：</strong>${text(event.participants.join('、') || '未记录')}</p><details><summary>阶段记录（${event.stages.length}）</summary><ol>${event.stages.map(stage => `<li>${text(stage)}</li>`).join('')}</ol></details><p><strong>${archived ? '最终结果' : '最新阶段'}：</strong>${text(archived ? event.finalResult : event.latestStage)}</p><footer class="pm-action-row">${actions}</footer></article>`;
}

function eventForm(event = {}) {
    return `<form class="pm-today-trend-event-form" data-today-trend-form="event"><input type="hidden" name="id" value="${escapeAttr(event.id || '')}"><label class="pm-cfg-label">名称<input class="pm-cfg-input" name="title" maxlength="120" required value="${escapeAttr(event.title || '')}"></label><label class="pm-cfg-label">类型<select class="pm-cfg-input" name="type">${eventOptions(event.type || 'normal')}</select></label><label class="pm-cfg-label">阶段<input class="pm-cfg-input" name="stageLabel" maxlength="8" required value="${escapeAttr(event.stageLabel || '准备中')}"></label><label class="pm-cfg-label">起因<textarea class="pm-cfg-input" name="origin" maxlength="600" required>${text(event.origin || '')}</textarea></label><label class="pm-cfg-label">涉及主体（用顿号或逗号分隔）<input class="pm-cfg-input" name="participants" maxlength="600" value="${escapeAttr((event.participants || []).join('、'))}"></label><label class="pm-cfg-label">最新阶段<textarea class="pm-cfg-input" name="latestStage" maxlength="600" required>${text(event.latestStage || '')}</textarea></label><div class="pm-action-row">${button('today-trend-cancel-event-editor', '取消')}<button type="submit" class="pm-action-button is-accent">保存</button></div></form>`;
}

function promotionForm(event) {
    return `<form class="pm-today-trend-event-form" data-today-trend-form="event-promotion"><input type="hidden" name="sourceEventId" value="${escapeAttr(event.id)}"><label class="pm-cfg-label">突发事件名称<input class="pm-cfg-input" name="title" maxlength="120" required value="${escapeAttr(event.title)}"></label><label class="pm-cfg-label">阶段<input class="pm-cfg-input" name="stageLabel" maxlength="8" required value="${escapeAttr(event.stageLabel)}"></label><label class="pm-cfg-label">公开起因<textarea class="pm-cfg-input" name="origin" maxlength="600" required>${text(event.origin)}</textarea></label><label class="pm-cfg-label">涉及主体（用顿号或逗号分隔）<input class="pm-cfg-input" name="participants" maxlength="600" value="${escapeAttr(event.participants.join('、'))}"></label><label class="pm-cfg-label">突发进展<textarea class="pm-cfg-input" name="latestStage" maxlength="600" required>${text(event.latestStage)}</textarea></label><div class="pm-action-row">${button('today-trend-cancel-event-editor', '取消')}<button type="submit" class="pm-action-button is-accent">确认升级</button></div></form>`;
}

function archiveForm(event) {
    const rumor = event.type === 'rumor';
    return `<form class="pm-today-trend-event-form" data-today-trend-form="event-archive"><input type="hidden" name="id" value="${escapeAttr(event.id)}"><label class="pm-cfg-label">完结结果<select class="pm-cfg-input" name="outcome">${outcomeOptions(rumor ? 'confirmed' : 'resolved', rumor)}</select></label><label class="pm-cfg-label">最终结果<textarea class="pm-cfg-input" name="finalResult" maxlength="600" required></textarea></label><div class="pm-action-row">${button('today-trend-cancel-event-editor', '取消')}<button type="submit" class="pm-action-button is-accent">确认归档</button></div></form>`;
}

function settingsForm(settings) {
    const rules = [['dynamics', '动态总规则'], ['incident', '突发事件规则'], ['rumor', '流言蜚语规则'], ['underground', '地下线规则']].map(([id, label]) => `<div class="pm-action-row"><span>${label}</span>${button(`today-trend-edit-${id}-rule`, '查看/编辑')}${button(`today-trend-regenerate-${id}-rule`, '重新生成')}</div>`).join('');
    return `<form class="pm-today-trend-event-form" data-today-trend-form="dynamics-settings"><label class="pm-cfg-label">同时追踪上限<input class="pm-cfg-input" name="trackingLimit" type="number" min="1" max="80" required value="${settings.trackingLimit}"></label>${toggle('appendOnlyOnActualProgress', '仅实际进展时追加阶段', settings.appendOnlyOnActualProgress)}${toggle('autoComplete', '自动判断完结', settings.autoComplete)}${toggle('archiveCompleted', '完结后归档', settings.archiveCompleted)}${toggle('incidentEnabled', '启用突发事件', settings.incident.enabled)}<label class="pm-cfg-label">突发概率（0-100）<input class="pm-cfg-input" name="incidentProbability" type="number" min="0" max="100" required value="${settings.incident.probability}"></label>${toggle('rumorEnabled', '启用流言蜚语', settings.rumor.enabled)}${toggle('undergroundEnabled', '启用地下线', settings.underground.enabled)}<section class="pm-today-trend-rule"><h3>动态规则</h3>${rules}</section><div class="pm-action-row">${button('today-trend-open-dynamics', '取消')}<button type="submit" class="pm-action-button is-accent">保存设置</button></div></form>`;
}

export function renderTodayTrendDynamicsView({ scope, editingEventId = null, mode = 'content', generationAvailable = false, generationBusy = false } = {}) {
    if (!scope) return '<p class="pm-today-trend-empty">当前聊天尚未初始化今日风向。</p>';
    const generateAttrs = `${generationAvailable && !generationBusy ? '' : 'disabled'} aria-busy="${generationBusy}"`;
    const busyLabel = generationBusy ? '<span>正在生成…</span>' : '';
    if (mode === 'settings') return `<section class="pm-today-trend-dynamics">${settingsForm(scope.dynamicsSettings)}</section>`;
    const archiveId = String(editingEventId || '').replace(/^archive:/, '');
    if (String(editingEventId || '').startsWith('archive:')) {
        const event = scope.dynamics.active.find(item => item.id === archiveId);
        return event ? `<section class="pm-today-trend-dynamics">${archiveForm(event)}</section>` : '';
    }
    const promoteId = String(editingEventId || '').replace(/^promote:/, '');
    if (String(editingEventId || '').startsWith('promote:')) {
        const event = scope.dynamics.active.find(item => item.id === promoteId);
        return event?.type === 'underground' ? `<section class="pm-today-trend-dynamics">${promotionForm(event)}</section>` : '';
    }
    if (editingEventId) {
        const event = editingEventId === '__new__' ? null : scope.dynamics.active.find(item => item.id === editingEventId);
        return `<section class="pm-today-trend-dynamics">${eventForm(event || {})}</section>`;
    }
    const active = scope.dynamics.active.map(event => renderEvent(event, false, generateAttrs)).join('') || '<p class="pm-today-trend-empty">暂无正在追踪的动态。</p>';
    const archived = scope.dynamics.archived.map(event => renderEvent(event, true, generateAttrs)).join('') || '<p class="pm-today-trend-empty">暂无已完结动态。</p>';
    return `<section class="pm-today-trend-dynamics"><header class="pm-today-trend-module-head"><h2>相关动态</h2><span>追踪上限 ${scope.dynamicsSettings.trackingLimit}</span></header><div class="pm-action-row">${button('today-trend-advance-all-events', '推进全部', SPARKLES_ICON_SVG, generateAttrs)}${busyLabel}${button('today-trend-create-event', '手动创建')}</div><div class="pm-action-row">${button('today-trend-open-dynamics-settings', '动态设置', SETTINGS_ICON_SVG)}</div><h3>正在追踪</h3>${active}<h3>已完结</h3>${archived}</section>`;
}
