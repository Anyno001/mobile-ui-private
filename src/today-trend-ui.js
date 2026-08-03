import { CLOSE_ICON_SVG, MORE_ICON_SVG } from './icons.js';
import { escapeAttr, escapeHtml } from './ui.js';

export function trendIconButton({ action, icon, label, attrs = '', danger = false, className = '' }) {
    return `<button type="button" class="pm-today-trend-icon-button${danger ? ' is-danger' : ''}${className ? ` ${className}` : ''}" data-action="${escapeAttr(action)}" aria-label="${escapeAttr(label)}" title="${escapeAttr(label)}" ${attrs}>${icon}</button>`;
}

export function trendActionMenu({ id, open = false, label, actions = [] }) {
    const trigger = trendIconButton({
        action: 'today-trend-toggle-menu', icon: MORE_ICON_SVG,
        label: open ? `收起${label}` : label,
        attrs: `data-menu-id="${escapeAttr(id)}" aria-expanded="${open}"`,
    });
    const items = actions.map(action => trendIconButton({ ...action, className: 'pm-today-trend-menu-action' })).join('');
    const close = trendIconButton({ action: 'today-trend-close-menu', icon: CLOSE_ICON_SVG, label: '关闭编辑模式', className: 'pm-today-trend-menu-close' });
    return `<span class="pm-today-trend-menu-wrap${open ? ' is-open' : ''}">${open ? `<span class="pm-today-trend-menu" aria-label="${escapeAttr(label)}">${items}${close}</span>` : trigger}</span>`;
}

export function trendInlineActions({ visible = false, actions = [] } = {}) {
    if (!visible) return '';
    return `<span class="pm-today-trend-inline-actions">${actions.map(action => trendIconButton({ ...action, className: `pm-today-trend-inline-action${action.className ? ` ${action.className}` : ''}` })).join('')}</span>`;
}

export function trendModuleHead({ title, menuId, menuOpenId, actions = [], meta = '', adornment = '' }) {
    return `<header class="pm-today-trend-module-head"><div><h2>${escapeHtml(title)}${adornment}</h2>${meta ? `<span>${escapeHtml(meta)}</span>` : ''}</div>${trendActionMenu({ id: menuId, open: menuOpenId === menuId, label: `${title}操作`, actions })}</header>`;
}

export function trendRuleEditor({ rule, value = '' } = {}) {
    if (!rule) return '';
    return `<form class="pm-today-trend-editor pm-today-trend-rule-editor" data-today-trend-form="rule-editor"><input type="hidden" name="rule" value="${escapeAttr(rule)}"><label class="pm-today-trend-field">模块 Prompt<textarea class="pm-today-trend-input" name="text" maxlength="12000" required>${escapeHtml(value)}</textarea></label><div class="pm-today-trend-form-actions"><button type="button" data-action="today-trend-cancel-rule-editor">取消</button><button type="submit">保存 Prompt</button></div></form>`;
}

export function trendToggleField(name, label, checked) {
    return `<label class="pm-today-trend-switch"><span>${escapeHtml(label)}</span><input name="${escapeAttr(name)}" type="checkbox" role="switch" aria-checked="${checked === true}"${checked ? ' checked' : ''}><i aria-hidden="true"></i></label>`;
}
