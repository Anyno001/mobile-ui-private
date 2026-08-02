import { BACK_ICON_SVG, BOOK_ICON_SVG, EDIT_ICON_SVG, REFRESH_ICON_SVG, SPARKLES_ICON_SVG, TRASH_ICON_SVG } from './icons.js';
import { todayTrendStatusLabel } from './today-trend-model.js';
import { escapeAttr, escapeHtml } from './ui.js';
import { trendActionMenu, trendModuleHead, trendRuleEditor } from './today-trend-ui.js';

const statusBadge = status => `<span class="pm-today-trend-status" data-status="${escapeAttr(status)}">${escapeHtml(todayTrendStatusLabel(status))}</span>`;
function circleEditor(circle = {}) {
    return `<form class="pm-today-trend-editor" data-today-trend-form="circle"><input type="hidden" name="id" value="${escapeAttr(circle.id || '')}"><label class="pm-today-trend-field">圈层名称<input class="pm-today-trend-input" name="name" maxlength="120" required value="${escapeAttr(circle.name || '')}"></label><label class="pm-today-trend-field">范围<textarea class="pm-today-trend-input" name="scope" maxlength="600" required>${escapeHtml(circle.scope || '')}</textarea></label><div class="pm-today-trend-form-actions"><button type="submit">保存</button><button type="button" data-action="today-trend-cancel-editor">取消</button></div></form>`;
}

export function renderTodayTrendReputationView({ scope, preset = null, mode = 'content', editingCircleId = null, editingRule = null, ruleDraft = null, menuOpenId = null, generationAvailable = false, generationBusy = false } = {}) {
    const circles = Array.isArray(scope?.reputation?.circles) ? scope.reputation.circles : [];
    const generateAttrs = `${generationAvailable && !generationBusy ? '' : 'disabled'} aria-busy="${generationBusy}"`;
    if (mode === 'settings') {
        const rows = circles.map(circle => `<article class="pm-today-trend-row" data-circle-id="${escapeAttr(circle.id)}">${editingCircleId === circle.id ? circleEditor(circle) : `<div><b>${escapeHtml(circle.name)}</b><p>${escapeHtml(circle.scope)}</p></div>${trendActionMenu({ id: `circle:${circle.id}`, open: menuOpenId === `circle:${circle.id}`, label: `${circle.name}操作`, actions: [{ action: 'today-trend-edit-circle', icon: EDIT_ICON_SVG, label: `编辑${circle.name}`, attrs: `data-circle-id="${escapeAttr(circle.id)}"` }, { action: 'today-trend-regenerate-circle-schema', icon: REFRESH_ICON_SVG, label: `重新生成${circle.name}`, attrs: `data-circle-id="${escapeAttr(circle.id)}" ${generateAttrs}` }, { action: 'today-trend-delete-circle', icon: TRASH_ICON_SVG, label: `删除${circle.name}`, danger: true, attrs: `data-circle-id="${escapeAttr(circle.id)}"` }] })}`}</article>`).join('');
        return `<section class="pm-today-trend-view">${trendModuleHead({ title: '个人风评设置', menuId: 'reputation-settings', menuOpenId, actions: [{ action: 'today-trend-open-reputation', icon: BACK_ICON_SVG, label: '返回个人风评' }, { action: 'today-trend-add-circle', icon: SPARKLES_ICON_SVG, label: '添加圈层' }] })}${rows || '<p class="pm-today-trend-empty">尚未建立风评圈层。</p>'}${editingCircleId === '__new__' ? circleEditor() : ''}</section>`;
    }
    const rows = circles.map(circle => `<article class="pm-today-trend-row" data-circle-id="${escapeAttr(circle.id)}"><div><b>${escapeHtml(circle.name)}</b>${statusBadge(circle.status)}<p>${escapeHtml(circle.evaluation)}</p></div></article>`).join('');
    const editor = editingRule === 'reputation' ? trendRuleEditor({ rule: editingRule, value: ruleDraft ?? preset?.moduleRules?.reputation ?? '' }) : '';
    return `<section class="pm-today-trend-view">${trendModuleHead({ title: '个人风评', menuId: 'reputation-module', menuOpenId, actions: [{ action: 'today-trend-generate-reputation', icon: REFRESH_ICON_SVG, label: '重新生成个人风评', attrs: generateAttrs }, { action: 'today-trend-edit-reputation-rule', icon: BOOK_ICON_SVG, label: '编辑个人风评 Prompt' }] })}${editor}${rows || '<p class="pm-today-trend-empty">尚未生成个人风评。</p>'}${generationBusy ? '<span class="pm-today-trend-progress">正在生成…</span>' : ''}</section>`;
}
