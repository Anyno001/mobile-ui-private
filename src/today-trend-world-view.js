import { EDIT_ICON_SVG, REFRESH_ICON_SVG, SETTINGS_ICON_SVG, SPARKLES_ICON_SVG, TRASH_ICON_SVG } from './icons.js';
import { TODAY_TREND_LIMITS } from './today-trend-model.js';
import { escapeAttr, escapeHtml } from './ui.js';

function itemEditor(item = {}) {
    return `<form class="pm-today-trend-editor" data-today-trend-form="world-item">
        <input type="hidden" name="id" value="${escapeAttr(item.id || '')}">
        <label>项目名称<input name="name" maxlength="120" required value="${escapeAttr(item.name || '')}"></label>
        <label>一句话态势<textarea name="summary" maxlength="600" required>${escapeHtml(item.summary || '')}</textarea></label>
        <div class="pm-today-trend-editor-actions"><button type="submit">保存</button><button type="button" data-action="today-trend-cancel-world-editor">取消</button></div>
    </form>`;
}

export function renderTodayTrendWorldView({ scope, mode = 'content', editingWorldItemId = null, generationAvailable = false, generationBusy = false } = {}) {
    const items = Array.isArray(scope?.world?.items) ? scope.world.items : [];
    const generateAttrs = `${generationAvailable && !generationBusy ? '' : 'disabled'} aria-busy="${generationBusy}"`;
    const busyLabel = generationBusy ? '<span>正在生成…</span>' : '';
    if (mode === 'settings') {
        const rows = items.map(item => `<article class="pm-today-trend-world-setting" data-world-item-id="${escapeAttr(item.id)}">
            ${editingWorldItemId === item.id ? itemEditor(item) : `<div><b>${escapeHtml(item.name)}</b><p>${escapeHtml(item.summary)}</p></div><div class="pm-today-trend-card-actions"><button type="button" data-action="today-trend-edit-world-item" data-world-item-id="${escapeAttr(item.id)}">${EDIT_ICON_SVG}编辑</button><button type="button" data-action="today-trend-delete-world-item" data-world-item-id="${escapeAttr(item.id)}">${TRASH_ICON_SVG}删除</button></div>`}
        </article>`).join('');
        return `<section class="pm-today-trend-view pm-today-trend-world-settings"><header><button type="button" data-action="today-trend-open-world">返回</button><h2>世界态势设置</h2></header>
            ${rows || '<p class="pm-today-trend-empty">尚未建立世界态势项目。</p>'}
            ${editingWorldItemId === '__new__' ? itemEditor() : `<button type="button" data-action="today-trend-add-world-item" ${items.length >= TODAY_TREND_LIMITS.worldItems ? 'disabled' : ''}>添加项目</button>`}
            <section class="pm-today-trend-rule"><h3>模块规则</h3><p>项目名称由当前世界决定，不预设自然、行业或其他固定分类。</p><button type="button" data-action="today-trend-edit-world-rule">查看/编辑规则</button><button type="button" data-action="today-trend-regenerate-world-rule">重新生成规则</button></section>
        </section>`;
    }
    const rows = items.map(item => `<article class="pm-today-trend-world-item" data-world-item-id="${escapeAttr(item.id)}"><div><b>${escapeHtml(item.name)}</b><p>${escapeHtml(item.summary)}</p></div><button type="button" data-action="today-trend-refresh-world-item" data-world-item-id="${escapeAttr(item.id)}" ${generateAttrs} aria-label="刷新 ${escapeAttr(item.name)}" title="刷新 ${escapeAttr(item.name)}">${REFRESH_ICON_SVG}</button></article>`).join('');
    return `<section class="pm-today-trend-view pm-today-trend-world"><header><h2>世界态势</h2><button type="button" data-action="today-trend-open-world-settings" aria-label="世界态势设置" title="世界态势设置">${SETTINGS_ICON_SVG}</button></header>${rows || '<p class="pm-today-trend-empty">尚未生成世界态势。</p>'}<button type="button" data-action="today-trend-generate-world" ${generateAttrs}>${SPARKLES_ICON_SVG}本模块生成</button>${busyLabel}</section>`;
}
