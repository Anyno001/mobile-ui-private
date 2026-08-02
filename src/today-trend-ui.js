import { MORE_ICON_SVG } from './icons.js';
import { escapeAttr, escapeHtml } from './ui.js';

export function trendIconButton({ action, icon, label, attrs = '', danger = false, className = '' }) {
    return `<button type="button" class="pm-today-trend-icon-button${danger ? ' is-danger' : ''}${className ? ` ${className}` : ''}" data-action="${escapeAttr(action)}" aria-label="${escapeAttr(label)}" title="${escapeAttr(label)}" ${attrs}>${icon}</button>`;
}

export function trendActionMenu({ id, open = false, label, actions = [] }) {
    const trigger = trendIconButton({ action: 'today-trend-toggle-menu', icon: MORE_ICON_SVG, label, attrs: `data-menu-id="${escapeAttr(id)}" aria-expanded="${open}" aria-haspopup="menu"` });
    const items = actions.map(action => trendIconButton({ ...action, className: 'pm-today-trend-menu-action' })).join('');
    return `<span class="pm-today-trend-menu-wrap">${trigger}${open ? `<span class="pm-today-trend-menu" role="menu" aria-label="${escapeAttr(label)}">${items}</span>` : ''}</span>`;
}

export function trendModuleHead({ title, menuId, menuOpenId, actions = [], meta = '', adornment = '' }) {
    return `<header class="pm-today-trend-module-head"><div><h2>${escapeHtml(title)}</h2>${meta ? `<span>${escapeHtml(meta)}</span>` : ''}${adornment}</div>${trendActionMenu({ id: menuId, open: menuOpenId === menuId, label: `${title}操作`, actions })}</header>`;
}

export function trendToggleField(name, label, checked) {
    return `<label class="pm-today-trend-switch"><span>${escapeHtml(label)}</span><input name="${escapeAttr(name)}" type="checkbox" role="switch" aria-checked="${checked === true}"${checked ? ' checked' : ''}><i aria-hidden="true"></i></label>`;
}
