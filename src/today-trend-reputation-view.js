import { BACK_ICON_SVG, BOOK_ICON_SVG, EDIT_ICON_SVG, REFRESH_ICON_SVG, SPARKLES_ICON_SVG, TRASH_ICON_SVG } from './icons.js';
import { todayTrendStatusLabel } from './today-trend-model.js';
import { escapeAttr, escapeHtml } from './ui.js';
import { trendInlineActions, trendMeter, trendModuleHead } from './today-trend-ui.js';

const REPUTATION_LEVELS = Object.freeze(['trust', 'like', 'neutral', 'dislike', 'hostile']);
const reputationStatusLabel = status => status === 'like' ? '喜爱' : todayTrendStatusLabel(status);
const GOOD_STATUSES = new Set(['like', 'trust']);
const BAD_STATUSES = new Set(['hostile', 'dislike']);
const REPUTATION_ICONS = Object.freeze({
    hostile: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><path d="m5 5 14 14"/>',
    dislike: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.6"/>',
    neutral: '<circle cx="8" cy="8" r="2.6"/><circle cx="16" cy="8" r="2.6"/><path d="M4 19c0-3 1.8-5 4-5s4 2 4 5M12 19c0-3 1.8-5 4-5s4 2 4 5"/>',
    like: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.6"/>',
    trust: '<path d="M12 3l7 3v5c0 4.4-3 7.8-7 9-4-1.2-7-4.6-7-9V6z"/><path d="m9 12 2 2 4-4.5"/>',
});
const statusBadge = status => `<span class="pm-today-trend-status" data-status="${escapeAttr(status)}">${escapeHtml(reputationStatusLabel(status))}</span>`;
const reputationMark = status => `<span class="pm-today-trend-reputation-mark" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${REPUTATION_ICONS[status] || REPUTATION_ICONS.neutral}</svg></span>`;


function reputationMeter(circle, disabled) {
    const label = reputationStatusLabel(circle.status);
    const levels = REPUTATION_LEVELS.map(level => `<button type="button" class="${level === circle.status ? 'is-active' : ''}" data-action="today-trend-set-circle-status" data-circle-id="${escapeAttr(circle.id)}" data-status="${level}" aria-checked="${level === circle.status}" role="radio" tabindex="${level === circle.status ? '0' : '-1'}" aria-label="${escapeAttr(reputationStatusLabel(level))}"${disabled ? ' disabled' : ''}><i aria-hidden="true"></i></button>`).join('');
    return `<div class="pm-today-trend-reputation-meter" role="radiogroup" aria-label="修改${escapeAttr(circle.name)}的好感度，当前：${escapeAttr(label)}">${levels}</div>`;
}
function circleEditor(circle = {}, cancelAction = 'today-trend-cancel-editor') {
    return `<form class="pm-today-trend-editor" data-today-trend-form="circle"><input type="hidden" name="id" value="${escapeAttr(circle.id || '')}"><label class="pm-today-trend-field">圈层名称<input class="pm-today-trend-input" name="name" maxlength="120" required value="${escapeAttr(circle.name || '')}"></label><label class="pm-today-trend-field">范围<textarea class="pm-today-trend-input" name="scope" maxlength="600" required>${escapeHtml(circle.scope || '')}</textarea></label><label class="pm-today-trend-field">风评<textarea class="pm-today-trend-input" name="evaluation" maxlength="600" required>${escapeHtml(circle.evaluation || '')}</textarea></label><div class="pm-today-trend-form-actions"><button type="submit">保存</button><button type="button" data-action="${escapeAttr(cancelAction)}">取消</button></div></form>`;
}

function circleActions(circle, generateAttrs, visible) {
    return trendInlineActions({ visible, actions: [
        { action: 'today-trend-edit-circle', icon: EDIT_ICON_SVG, label: `编辑${circle.name}`, attrs: `data-circle-id="${escapeAttr(circle.id)}"` },
        { action: 'today-trend-regenerate-circle-schema', icon: REFRESH_ICON_SVG, label: `重新生成${circle.name}`, attrs: `data-circle-id="${escapeAttr(circle.id)}" ${generateAttrs}` },
        { action: 'today-trend-delete-circle', icon: TRASH_ICON_SVG, label: `删除${circle.name}`, danger: true, attrs: `data-circle-id="${escapeAttr(circle.id)}"` },
    ] });
}

export function renderTodayTrendReputationView({ scope, preset = null, mode = 'content', editingCircleId = null, editingRule = null, ruleDraft = null, menuOpenId = null, generationAvailable = false, generationBusy = false } = {}) {
    const circles = Array.isArray(scope?.reputation?.circles) ? scope.reputation.circles : [];
    const generateAttrs = `${generationAvailable && !generationBusy ? '' : 'disabled'} aria-busy="${generationBusy}"`;
    if (mode === 'settings') {
        const actionsVisible = menuOpenId === 'reputation-settings';
        const rows = circles.map(circle => `<article class="pm-today-trend-row" data-circle-id="${escapeAttr(circle.id)}">${editingCircleId === circle.id ? circleEditor(circle) : `<div><b>${escapeHtml(circle.name)}</b><p>${escapeHtml(circle.scope)}</p></div>${circleActions(circle, generateAttrs, actionsVisible)}`}</article>`).join('');
        return `<section class="pm-today-trend-view">${trendModuleHead({ title: '个人风评设置', menuId: 'reputation-settings', menuOpenId, actions: [{ action: 'today-trend-open-reputation', icon: BACK_ICON_SVG, label: '返回个人风评' }, { action: 'today-trend-add-circle', icon: SPARKLES_ICON_SVG, label: '添加圈层' }] })}${rows || '<p class="pm-today-trend-empty">尚未建立风评圈层。</p>'}${editingCircleId === '__new__' ? circleEditor() : ''}</section>`;
    }
    const goodCount = circles.filter(circle => GOOD_STATUSES.has(circle.status)).length;
    const badCount = circles.filter(circle => BAD_STATUSES.has(circle.status)).length;
    const metaHtml = trendMeter([{ label: 'PEOPLE', value: circles.length }, { label: 'GOOD', value: goodCount }, { label: 'BAD', value: badCount }]);
    const actionsVisible = menuOpenId === 'reputation-module';
    const rows = circles.map(circle => editingCircleId === circle.id ? `<article class="pm-today-trend-reputation-entry is-editing" data-circle-id="${escapeAttr(circle.id)}">${circleEditor(circle, 'today-trend-cancel-reputation-editor')}</article>` : `<article class="pm-today-trend-reputation-entry" data-circle-id="${escapeAttr(circle.id)}">${reputationMark(circle.status)}<div class="pm-today-trend-reputation-copy"><header><b>${escapeHtml(circle.name)}</b>${statusBadge(circle.status)}${trendInlineActions({ visible: actionsVisible, actions: [{ action: 'today-trend-edit-circle', icon: EDIT_ICON_SVG, label: `编辑${circle.name}`, attrs: `data-circle-id="${escapeAttr(circle.id)}"` }] })}</header><p>${escapeHtml(circle.evaluation)}</p></div><div class="pm-today-trend-reputation-rating">${reputationMeter(circle, generationBusy)}</div></article>`).join('');
    return `<section class="pm-today-trend-view pm-today-trend-reputation">${trendModuleHead({ title: '个人风评', eyebrow: 'PUBLIC OPINION', metaHtml, menuId: 'reputation-module', menuOpenId, actions: [{ action: 'today-trend-generate-reputation', icon: REFRESH_ICON_SVG, label: '重新生成个人风评', attrs: generateAttrs }, { action: 'today-trend-edit-reputation-rule', icon: BOOK_ICON_SVG, label: '编辑个人风评 Prompt' }] })}<div class="pm-today-trend-reputation-list">${rows || '<p class="pm-today-trend-empty">尚未生成个人风评。</p>'}</div>${generationBusy ? '<span class="pm-today-trend-progress">正在生成…</span>' : ''}</section>`;
}
