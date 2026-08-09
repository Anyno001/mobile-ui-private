import { BACK_ICON_SVG, BOOK_ICON_SVG, EDIT_ICON_SVG, REFRESH_ICON_SVG, SPARKLES_ICON_SVG, TRASH_ICON_SVG } from './icons.js';
import { TODAY_TREND_LIMITS } from './today-trend-model.js';
import { escapeAttr, escapeHtml } from './ui.js';
import { trendActionMenu, trendInlineActions, trendMeter, trendModuleHead } from './today-trend-ui.js';

function itemEditor(item = {}) {
    return `<form class="pm-today-trend-editor" data-today-trend-form="world-item"><input type="hidden" name="id" value="${escapeAttr(item.id || '')}"><label class="pm-today-trend-field">项目名称<input class="pm-today-trend-input" name="name" maxlength="120" required value="${escapeAttr(item.name || '')}"></label><label class="pm-today-trend-field">一句话态势<textarea class="pm-today-trend-input" name="summary" maxlength="600" required>${escapeHtml(item.summary || '')}</textarea></label><div class="pm-today-trend-form-actions"><button type="submit">保存</button><button type="button" data-action="today-trend-cancel-world-editor">取消</button></div></form>`;
}

function itemActions(item, attrs, menuOpenId) {
    return trendActionMenu({ id: `world:${item.id}`, open: menuOpenId === `world:${item.id}`, label: `${item.name}操作`, actions: [
        { action: 'today-trend-refresh-world-item', icon: REFRESH_ICON_SVG, label: `重新生成${item.name}`, attrs: `data-world-item-id="${escapeAttr(item.id)}" ${attrs}` },
        { action: 'today-trend-edit-world-item', icon: EDIT_ICON_SVG, label: `编辑${item.name}`, attrs: `data-world-item-id="${escapeAttr(item.id)}"` },
        { action: 'today-trend-delete-world-item', icon: TRASH_ICON_SVG, label: `删除${item.name}`, danger: true, attrs: `data-world-item-id="${escapeAttr(item.id)}"` },
    ] });
}

function itemInlineActions(item, attrs, visible) {
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
        const rows = items.map(item => `<article class="pm-today-trend-row" data-world-item-id="${escapeAttr(item.id)}">${editingWorldItemId === item.id ? itemEditor(item) : `<div><b>${escapeHtml(item.name)}</b><p>${escapeHtml(item.summary)}</p></div>${itemActions(item, generateAttrs, menuOpenId)}`}</article>`).join('');
        return `<section class="pm-today-trend-view">${trendModuleHead({ title: '世界态势设置', menuId: 'world-settings', menuOpenId, actions: [{ action: 'today-trend-open-world', icon: BACK_ICON_SVG, label: '返回世界态势' }, { action: 'today-trend-add-world-item', icon: SPARKLES_ICON_SVG, label: '添加项目', attrs: items.length >= TODAY_TREND_LIMITS.worldItems ? 'disabled' : '' }] })}${rows || '<p class="pm-today-trend-empty">尚未建立世界态势项目。</p>'}${editingWorldItemId === '__new__' ? itemEditor() : ''}</section>`;
    }
    const signalMarker = '<span class="pm-today-trend-world-signal-marker" aria-hidden="true"><i></i></span>';
    const hero = items[0];
    const heroBody = hero ? (editingWorldItemId === hero.id ? itemEditor(hero) : `<p>${escapeHtml(hero.summary)}</p>`) : '';
    const signals = items.slice(1).map((item, index) => {
        const body = editingWorldItemId === item.id ? itemEditor(item) : `<p>${escapeHtml(item.summary)}</p>`;
        const side = index % 2 ? 'is-right' : 'is-left';
        return `<article class="pm-today-trend-world-brief ${side}" data-world-item-id="${escapeAttr(item.id)}">${signalMarker}<div><header class="pm-today-trend-world-item-head"><b>${escapeHtml(item.name)}</b>${itemInlineActions(item, generateAttrs, menuOpenId === 'world-module')}</header>${body}<span class="pm-today-trend-world-brief-tail" aria-hidden="true"></span></div></article>`;
    }).join('');
    const worldMeta = trendMeter([{ label: 'SIGNALS', value: items.length }, { label: 'BRIEFS', value: Math.max(items.length - 1, 0) }]);
    const content = hero ? `<article class="pm-today-trend-world-hero${signals ? ' has-signals' : ''}" data-world-item-id="${escapeAttr(hero.id)}">${signalMarker}<div><header class="pm-today-trend-world-item-head"><b>${escapeHtml(hero.name)}</b>${itemInlineActions(hero, generateAttrs, menuOpenId === 'world-module')}</header>${heroBody}</div></article>${signals ? `<div class="pm-today-trend-world-signals">${signals}</div>` : ''}` : '<p class="pm-today-trend-empty">尚未生成世界态势。</p>';
    return `<section class="pm-today-trend-view pm-today-trend-world"><span class="pm-today-trend-world-grid" aria-hidden="true"></span>${trendModuleHead({ title: '世界态势', eyebrow: 'TODAY’S SIGNAL', metaHtml: worldMeta, menuId: 'world-module', menuOpenId, actions: [{ action: 'today-trend-generate-world', icon: REFRESH_ICON_SVG, label: '重新生成世界态势', attrs: generateAttrs }, { action: 'today-trend-edit-world-rule', icon: BOOK_ICON_SVG, label: '编辑世界态势 Prompt' }] })}${content}${generationBusy ? '<span class="pm-today-trend-progress">正在生成…</span>' : ''}</section>`;
}
