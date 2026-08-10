import { CLOSE_ICON_SVG, MORE_ICON_SVG } from './icons.js';
import { escapeAttr, escapeHtml } from './ui.js';

// 仪表盘 meta 前导小时钟：灰色装饰，弱化存在但点出「时间维度」语义（呼应原型 updated/meta 行首图标）。
export const TREND_METER_CLOCK_ICON_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/></svg>';

// 仪表盘式 meta：时钟 + 若干 { label, value } 段，段间以 × 装饰分隔（非运算符）。label 为英文装饰标签，value 来自真实字段。
export function trendMeter(segments = []) {
    const body = segments.filter(segment => segment && segment.label != null && segment.value != null)
        .map(({ label, value }, index) => `${index ? '<span class="pm-today-trend-meter-x" aria-hidden="true">&times;</span>' : ''}<span class="pm-today-trend-meter-k">${escapeHtml(String(label))}</span><span class="pm-today-trend-meter-v">${escapeHtml(String(value))}</span>`).join('');
    return body ? `<span class="pm-today-trend-meter">${TREND_METER_CLOCK_ICON_SVG}${body}</span>` : '';
}

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

export function trendFloorStatus({ syncedFloor = 0, busy = false, targetFloor = null, targeted = false } = {}) {
    const floor = Number.isInteger(syncedFloor) && syncedFloor >= 0 ? syncedFloor : 0;
    const target = Number.isInteger(targetFloor) && targetFloor >= 0 ? targetFloor : null;
    const state = busy ? 'updating' : floor > 0 ? 'synced' : 'unsynced';
    const status = busy ? targeted ? '正在更新模块' : target === null ? '正在同步' : `同步至 ${target}` : floor > 0 ? '已同步' : '尚未同步';
    return `<span class="pm-today-trend-floor" data-today-trend-floor="${floor}" data-state="${state}" role="status" aria-live="polite" aria-label="FLOOR ${floor}，${escapeAttr(status)}"><span class="pm-today-trend-floor-reading"><span class="pm-today-trend-floor-label">FLOOR</span><strong class="pm-today-trend-floor-value">${floor}</strong></span><span class="pm-today-trend-floor-status">${busy ? '<i aria-hidden="true"></i>' : ''}${escapeHtml(status)}</span></span>`;
}

export function trendModuleHead({ title, menuId, menuOpenId, actions = [], meta = '', metaHtml = '', eyebrow = '', adornment = '', asideHtml = '' }) {
    const renderedMeta = metaHtml || (meta ? `<span>${escapeHtml(meta)}</span>` : '');
    const menu = trendActionMenu({ id: menuId, open: menuOpenId === menuId, label: `${title}操作`, actions });
    return `<header class="pm-today-trend-module-head${eyebrow ? ' is-decorative' : ''}"><div>${eyebrow ? `<p class="pm-today-trend-module-eyebrow">${escapeHtml(eyebrow)}</p>` : ''}<h2>${escapeHtml(title)}${adornment}</h2>${renderedMeta}</div><span class="pm-today-trend-head-tools">${menu}${asideHtml}</span></header>`;
}

export function trendRuleEditor({ rule, value = '' } = {}) {
    if (!rule) return '';
    return `<form class="pm-today-trend-editor pm-today-trend-rule-editor" data-today-trend-form="rule-editor"><input type="hidden" name="rule" value="${escapeAttr(rule)}"><label class="pm-today-trend-field">提示词<textarea class="pm-today-trend-input" name="text" maxlength="12000" required autofocus>${escapeHtml(value)}</textarea></label><div class="pm-today-trend-form-actions"><button type="button" data-action="today-trend-cancel-rule-editor">返回</button><button type="submit">保存提示词</button></div></form>`;
}

export function trendToggleField(name, label, checked) {
    return `<label class="pm-today-trend-switch"><span>${escapeHtml(label)}</span><input name="${escapeAttr(name)}" type="checkbox" role="switch" aria-checked="${checked === true}"${checked ? ' checked' : ''}><i aria-hidden="true"></i></label>`;
}
