import { EDIT_ICON_SVG, REFRESH_ICON_SVG, SETTINGS_ICON_SVG, SPARKLES_ICON_SVG, TRASH_ICON_SVG } from './icons.js';
import { todayTrendStatusLabel } from './today-trend-model.js';
import { escapeAttr, escapeHtml } from './ui.js';

const statusBadge = status => `<span class="pm-today-trend-status" data-status="${escapeAttr(status)}">${escapeHtml(todayTrendStatusLabel(status))}</span>`;

function circleEditor(circle = {}) {
    return `<form class="pm-today-trend-editor" data-today-trend-form="circle">
        <input type="hidden" name="id" value="${escapeAttr(circle.id || '')}">
        <label>圈层名称<input name="name" maxlength="120" required value="${escapeAttr(circle.name || '')}"></label>
        <label>范围<textarea name="scope" maxlength="600" required>${escapeHtml(circle.scope || '')}</textarea></label>
        <div class="pm-today-trend-editor-actions"><button type="submit" data-action="today-trend-save-circle">保存</button><button type="button" data-action="today-trend-cancel-editor">取消</button></div>
    </form>`;
}

export function renderTodayTrendReputationView({ scope, mode = 'content', editingCircleId = null, generationAvailable = false, generationBusy = false } = {}) {
    const circles = Array.isArray(scope?.reputation?.circles) ? scope.reputation.circles : [];
    const generateAttrs = `${generationAvailable && !generationBusy ? '' : 'disabled'} aria-busy="${generationBusy}"`;
    const busyLabel = generationBusy ? '<span>正在生成…</span>' : '';
    if (mode === 'settings') {
        const rows = circles.map(circle => `<article class="pm-today-trend-circle-setting" data-circle-id="${escapeAttr(circle.id)}">
            ${editingCircleId === circle.id ? circleEditor(circle) : `<b>${escapeHtml(circle.name)}</b><p>${escapeHtml(circle.scope)}</p><div><button type="button" data-action="today-trend-edit-circle" data-circle-id="${escapeAttr(circle.id)}">${EDIT_ICON_SVG}编辑</button><button type="button" data-action="today-trend-regenerate-circle-schema" data-circle-id="${escapeAttr(circle.id)}" ${generateAttrs}>${REFRESH_ICON_SVG}重新生成名称+范围</button><button type="button" data-action="today-trend-delete-circle" data-circle-id="${escapeAttr(circle.id)}">${TRASH_ICON_SVG}删除</button></div>`}
        </article>`).join('');
        return `<section class="pm-today-trend-view pm-today-trend-reputation-settings"><header><button type="button" data-action="today-trend-open-reputation">返回</button><h2>个人风评设置</h2></header>
            ${rows || '<p class="pm-today-trend-empty">尚未建立风评圈层。</p>'}
            ${editingCircleId === '__new__' ? circleEditor() : '<button type="button" data-action="today-trend-add-circle">添加圈层</button>'}
            <section class="pm-today-trend-rule"><h3>模块规则</h3><p>圈层关系固定为敌对、厌恶、中立、喜欢、信任；这里不提供篡改状态协议的入口。</p><button type="button" data-action="today-trend-edit-reputation-rule">查看/编辑规则</button><button type="button" data-action="today-trend-regenerate-reputation-rule">重新生成规则</button></section>
        </section>`;
    }
    const rows = circles.map(circle => `<article class="pm-today-trend-circle" data-circle-id="${escapeAttr(circle.id)}"><div><b>${escapeHtml(circle.name)}</b>${statusBadge(circle.status)}</div><p>${escapeHtml(circle.evaluation)}</p><button type="button" data-action="today-trend-refresh-circle" data-circle-id="${escapeAttr(circle.id)}" ${generateAttrs} aria-label="刷新 ${escapeAttr(circle.name)}">${REFRESH_ICON_SVG}</button></article>`).join('');
    return `<section class="pm-today-trend-view pm-today-trend-reputation"><header><h2>个人风评</h2><button type="button" data-action="today-trend-open-reputation-settings" aria-label="个人风评设置">${SETTINGS_ICON_SVG}</button></header>${rows || '<p class="pm-today-trend-empty">尚未生成个人风评。</p>'}<button type="button" data-action="today-trend-generate-reputation" ${generateAttrs}>${SPARKLES_ICON_SVG}本模块生成</button>${busyLabel}</section>`;
}
