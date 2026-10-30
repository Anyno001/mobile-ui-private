import { BACK_ICON_SVG, BOOK_ICON_SVG, EDIT_ICON_SVG, REFRESH_ICON_SVG, SPARKLES_ICON_SVG, TRASH_ICON_SVG } from './icons.js';
import { TODAY_TREND_LIMITS } from './today-trend-model.js';
import { resolveTodayTrendTitleIcon } from './today-trend-title-icon-mapping.js';
import { escapeAttr, escapeHtml } from './ui.js';
import { trendActionMenu, trendChangeChip, trendDetailBar, trendEventLatest, trendInitialStack, trendModuleHead, trendStepsBar, trendTypePill } from './today-trend-ui.js';

const icon = name => resolveTodayTrendTitleIcon({ title: name, kind: 'world' });

function itemEditor(item = {}) {
    return `<form class="pm-today-trend-editor pm-today-trend-item-editor pm-today-trend-world-item-editor" data-today-trend-form="world-item"><input type="hidden" name="id" value="${escapeAttr(item.id || '')}"><label class="pm-today-trend-field">项目名称<input class="pm-today-trend-input" name="name" maxlength="120" required value="${escapeAttr(item.name || '')}"></label><label class="pm-today-trend-field">一句话态势<textarea class="pm-today-trend-input" name="summary" maxlength="600" required>${escapeHtml(item.summary || '')}</textarea></label><div class="pm-today-trend-form-actions pm-action-pair"><button type="button" data-action="today-trend-cancel-world-editor">取消</button><button type="submit">保存</button></div></form>`;
}

function itemActions(item, attrs, menuOpenId) {
    return trendActionMenu({ id: `world:${item.id}`, open: menuOpenId === `world:${item.id}`, label: `${item.name}操作`, actions: [
        { action: 'today-trend-refresh-world-item', icon: REFRESH_ICON_SVG, label: `重新生成${item.name}`, attrs: `data-world-item-id="${escapeAttr(item.id)}" ${attrs}` },
        { action: 'today-trend-edit-world-item', icon: EDIT_ICON_SVG, label: `编辑${item.name}`, attrs: `data-world-item-id="${escapeAttr(item.id)}"` },
        { action: 'today-trend-delete-world-item', icon: TRASH_ICON_SVG, label: `删除${item.name}`, danger: true, attrs: `data-world-item-id="${escapeAttr(item.id)}" data-label="${escapeAttr(item.name)}"` },
    ] });
}

// 正在发生：进行中的事件做成可横滑的焦点卡，有变化的排在前面。
function eventCarousel(scope, changes) {
    const events = (Array.isArray(scope?.dynamics?.active) ? scope.dynamics.active : [])
        .map((event, index) => ({ event, index, changed: Boolean(changes?.events?.[event.id]) }))
        .sort((a, b) => Number(b.changed) - Number(a.changed) || a.index - b.index).slice(0, 5).map(item => item.event);
    if (!events.length) return '';
    const cards = events.map(event => {
        const stages = Array.isArray(event.stages) ? event.stages : [];
        const people = Array.isArray(event.participants) ? event.participants : [];
        return `<button type="button" class="pm-today-trend-hero" data-action="today-trend-open-event" data-event-id="${escapeAttr(event.id)}" data-event-type="${escapeAttr(event.type)}"><span class="pm-today-trend-card-tags">${trendTypePill(event.type)}${trendChangeChip(changes?.events?.[event.id])}</span><b class="pm-today-trend-hero-title">${escapeHtml(event.title)}</b><span class="pm-today-trend-hero-copy">${escapeHtml(trendEventLatest(event))}</span>${trendStepsBar(stages.length)}<span class="pm-today-trend-card-meta">${trendInitialStack(people)}<small>${escapeHtml(event.stageLabel || `阶段 ${stages.length}`)}</small></span></button>`;
    }).join('');
    return `<section class="pm-today-trend-section" aria-label="正在发生"><header class="pm-today-trend-block-head"><div><h2>正在发生</h2></div><button type="button" class="pm-today-trend-text-action" data-action="today-trend-open-dynamics">全部事件</button></header><div class="pm-today-trend-carousel">${cards}</div></section>`;
}

function worldDetail(item, { attrs, changes, editingWorldItemId, menuOpenId }) {
    const resolved = icon(item.name);
    const bar = trendDetailBar({ backAction: 'today-trend-close-detail', backLabel: '返回世界态势', menuId: `world:${item.id}`, menuOpenId, actions: [
        { action: 'today-trend-refresh-world-item', icon: REFRESH_ICON_SVG, label: `重新生成${item.name}`, attrs: `data-world-item-id="${escapeAttr(item.id)}" ${attrs}` },
        { action: 'today-trend-edit-world-item', icon: EDIT_ICON_SVG, label: `编辑${item.name}`, attrs: `data-world-item-id="${escapeAttr(item.id)}"` },
        { action: 'today-trend-delete-world-item', icon: TRASH_ICON_SVG, label: `删除${item.name}`, danger: true, attrs: `data-world-item-id="${escapeAttr(item.id)}" data-label="${escapeAttr(item.name)}"` },
    ] });
    const body = editingWorldItemId === item.id ? itemEditor(item)
        : `<span class="pm-today-trend-detail-icon" data-today-trend-icon="${escapeAttr(resolved.key)}" aria-hidden="true">${resolved.svg}</span><span class="pm-today-trend-card-tags">${trendChangeChip(changes?.world?.[item.id])}</span><h2 class="pm-today-trend-detail-title">${escapeHtml(item.name)}</h2><p class="pm-today-trend-detail-copy">${escapeHtml(item.summary)}</p>`;
    return `<section class="pm-today-trend-view pm-today-trend-detail" data-world-item-id="${escapeAttr(item.id)}">${bar}${body}</section>`;
}

export function renderTodayTrendWorldView({ scope, mode = 'content', detailId = null, changes = null, editingWorldItemId = null, menuOpenId = null, generationAvailable = false, generationBusy = false } = {}) {
    const items = Array.isArray(scope?.world?.items) ? scope.world.items : [];
    const generateAttrs = `${generationAvailable && !generationBusy ? '' : 'disabled'} aria-busy="${generationBusy}"`;
    if (mode === 'settings') {
        const rows = items.map(item => `<article class="pm-today-trend-row" data-world-item-id="${escapeAttr(item.id)}">${editingWorldItemId === item.id ? itemEditor(item) : `<div><b>${escapeHtml(item.name)}</b><p>${escapeHtml(item.summary)}</p></div>${itemActions(item, generateAttrs, menuOpenId)}`}</article>`).join('');
        return `<section class="pm-today-trend-view">${trendModuleHead({ title: '世界态势设置', menuId: 'world-settings', menuOpenId, actions: [{ action: 'today-trend-open-world', icon: BACK_ICON_SVG, label: '返回世界态势' }, { action: 'today-trend-add-world-item', icon: SPARKLES_ICON_SVG, label: '添加项目', attrs: items.length >= TODAY_TREND_LIMITS.worldItems ? 'disabled' : '' }] })}${rows || '<p class="pm-today-trend-empty">尚未建立世界态势项目。</p>'}${editingWorldItemId === '__new__' ? itemEditor() : ''}</section>`;
    }
    const detailItem = detailId ? items.find(item => item.id === detailId) : null;
    if (detailItem) return worldDetail(detailItem, { attrs: generateAttrs, changes, editingWorldItemId, menuOpenId });
    const tiles = items.map(item => {
        const resolved = icon(item.name);
        return `<button type="button" class="pm-today-trend-tile" data-action="today-trend-open-world-item" data-world-item-id="${escapeAttr(item.id)}"><span class="pm-today-trend-tile-icon" data-today-trend-icon="${escapeAttr(resolved.key)}" aria-hidden="true">${resolved.svg}</span><b>${escapeHtml(item.name)}</b><span class="pm-today-trend-tile-copy">${trendChangeChip(changes?.world?.[item.id])}${escapeHtml(item.summary)}</span></button>`;
    }).join('');
    const head = trendModuleHead({ title: '世界态势', meta: items.length ? `${items.length} 项` : '', menuId: 'world-module', menuOpenId, exposedActionCount: 0, actions: [
        { action: 'today-trend-generate-world', icon: REFRESH_ICON_SVG, label: '重新生成世界态势', attrs: generateAttrs },
        { action: 'today-trend-edit-world-rule', icon: BOOK_ICON_SVG, label: '编辑世界态势提示词' },
    ] });
    const body = tiles ? `<div class="pm-today-trend-tiles">${tiles}</div>` : '<p class="pm-today-trend-empty">尚未生成世界态势</p>';
    return `<section class="pm-today-trend-view pm-today-trend-world">${eventCarousel(scope, changes)}<section class="pm-today-trend-section">${head}${body}</section></section>`;
}
