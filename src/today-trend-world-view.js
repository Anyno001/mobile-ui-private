import { BACK_ICON_SVG, BOOK_ICON_SVG, EDIT_ICON_SVG, REFRESH_ICON_SVG, SPARKLES_ICON_SVG, TRASH_ICON_SVG } from './icons.js';
import { TODAY_TREND_LIMITS } from './today-trend-model.js';
import { escapeAttr, escapeHtml } from './ui.js';
import { trendInlineActions, trendModuleHead, trendRuleEditor } from './today-trend-ui.js';

function itemEditor(item = {}) {
    return `<form class="pm-today-trend-editor" data-today-trend-form="world-item"><input type="hidden" name="id" value="${escapeAttr(item.id || '')}"><label class="pm-today-trend-field">项目名称<input class="pm-today-trend-input" name="name" maxlength="120" required value="${escapeAttr(item.name || '')}"></label><label class="pm-today-trend-field">一句话态势<textarea class="pm-today-trend-input" name="summary" maxlength="600" required>${escapeHtml(item.summary || '')}</textarea></label><div class="pm-today-trend-form-actions"><button type="submit">保存</button><button type="button" data-action="today-trend-cancel-world-editor">取消</button></div></form>`;
}

function itemActions(item, attrs, visible) {
    return trendInlineActions({ visible, actions: [
        { action: 'today-trend-refresh-world-item', icon: REFRESH_ICON_SVG, label: `重新生成${item.name}`, attrs: `data-world-item-id="${escapeAttr(item.id)}" ${attrs}` },
        { action: 'today-trend-edit-world-item', icon: EDIT_ICON_SVG, label: `编辑${item.name}`, attrs: `data-world-item-id="${escapeAttr(item.id)}"` },
        { action: 'today-trend-delete-world-item', icon: TRASH_ICON_SVG, label: `删除${item.name}`, danger: true, attrs: `data-world-item-id="${escapeAttr(item.id)}"` },
    ] });
}

export function renderTodayTrendWorldView({ scope, preset = null, mode = 'content', editingWorldItemId = null, editingRule = null, ruleDraft = null, menuOpenId = null, generationAvailable = false, generationBusy = false } = {}) {
    const items = Array.isArray(scope?.world?.items) ? scope.world.items : [];
    const generateAttrs = `${generationAvailable && !generationBusy ? '' : 'disabled'} aria-busy="${generationBusy}"`;
    if (mode === 'settings') {
        const actionsVisible = menuOpenId === 'world-settings';
        const rows = items.map(item => `<article class="pm-today-trend-row" data-world-item-id="${escapeAttr(item.id)}">${editingWorldItemId === item.id ? itemEditor(item) : `<div><b>${escapeHtml(item.name)}</b><p>${escapeHtml(item.summary)}</p></div>${itemActions(item, generateAttrs, actionsVisible)}`}</article>`).join('');
        return `<section class="pm-today-trend-view">${trendModuleHead({ title: '世界态势设置', menuId: 'world-settings', menuOpenId, actions: [{ action: 'today-trend-open-world', icon: BACK_ICON_SVG, label: '返回世界态势' }, { action: 'today-trend-add-world-item', icon: SPARKLES_ICON_SVG, label: '添加项目', attrs: items.length >= TODAY_TREND_LIMITS.worldItems ? 'disabled' : '' }] })}${rows || '<p class="pm-today-trend-empty">尚未建立世界态势项目。</p>'}${editingWorldItemId === '__new__' ? itemEditor() : ''}</section>`;
    }
    const actionsVisible = menuOpenId === 'world-module';
    const rows = items.map((item, index) => {
        const body = editingWorldItemId === item.id ? itemEditor(item) : `<p>${escapeHtml(item.summary)}</p>`;
        if (index === 0) return `<article class="pm-today-trend-world-hero" data-world-item-id="${escapeAttr(item.id)}"><div><header class="pm-today-trend-world-item-head"><b>${escapeHtml(item.name)}</b>${itemActions(item, generateAttrs, actionsVisible)}</header>${body}</div></article>`;
        const side = index % 2 ? 'is-left' : 'is-right';
        return `<article class="pm-today-trend-world-brief ${side}" data-world-item-id="${escapeAttr(item.id)}"><div><header class="pm-today-trend-world-item-head"><b>${escapeHtml(item.name)}</b>${itemActions(item, generateAttrs, actionsVisible)}</header>${body}</div></article>`;
    }).join('');
    const editor = editingRule === 'world' ? trendRuleEditor({ rule: editingRule, value: ruleDraft ?? preset?.moduleRules?.world ?? '' }) : '';
    return `<section class="pm-today-trend-view pm-today-trend-world">${trendModuleHead({ title: '世界态势', menuId: 'world-module', menuOpenId, actions: [{ action: 'today-trend-generate-world', icon: REFRESH_ICON_SVG, label: '重新生成世界态势', attrs: generateAttrs }, { action: 'today-trend-edit-world-rule', icon: BOOK_ICON_SVG, label: '编辑世界态势 Prompt' }] })}${editor}${rows || '<p class="pm-today-trend-empty">尚未生成世界态势。</p>'}${generationBusy ? '<span class="pm-today-trend-progress">正在生成…</span>' : ''}</section>`;
}
