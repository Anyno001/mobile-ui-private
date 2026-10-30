import { BACK_ICON_SVG, BOOK_ICON_SVG, EDIT_ICON_SVG, REFRESH_ICON_SVG, SPARKLES_ICON_SVG, TRASH_ICON_SVG } from './icons.js';
import { escapeAttr, escapeHtml } from './ui.js';
import { trendChangeChip, trendInitial, trendInlineActions, trendModuleHead, trendRelationLabel, trendRelationMeter, trendRelationPill } from './today-trend-ui.js';

const GRAPH_LIMIT = 8;
const GOOD = new Set(['like', 'trust']);
const BAD = new Set(['hostile', 'dislike']);

function circleEditor(circle = {}, cancelAction = 'today-trend-cancel-editor') {
    return `<form class="pm-today-trend-editor pm-today-trend-item-editor" data-today-trend-form="circle"><input type="hidden" name="id" value="${escapeAttr(circle.id || '')}"><label class="pm-today-trend-field">圈层名称<input class="pm-today-trend-input" name="name" maxlength="120" required value="${escapeAttr(circle.name || '')}"></label><label class="pm-today-trend-field">范围<textarea class="pm-today-trend-input" name="scope" maxlength="600" required>${escapeHtml(circle.scope || '')}</textarea></label><label class="pm-today-trend-field">风评<textarea class="pm-today-trend-input" name="evaluation" maxlength="600" required>${escapeHtml(circle.evaluation || '')}</textarea></label><div class="pm-today-trend-form-actions pm-action-pair"><button type="button" data-action="${escapeAttr(cancelAction)}">取消</button><button type="submit">保存</button></div></form>`;
}

function circleActions(circle, generateAttrs, visible = true) {
    return trendInlineActions({ visible, actions: [
        { action: 'today-trend-regenerate-circle-schema', icon: REFRESH_ICON_SVG, label: `重新生成${circle.name}`, attrs: `data-circle-id="${escapeAttr(circle.id)}" ${generateAttrs}` },
        { action: 'today-trend-edit-circle', icon: EDIT_ICON_SVG, label: `编辑${circle.name}`, attrs: `data-circle-id="${escapeAttr(circle.id)}"` },
        { action: 'today-trend-delete-circle', icon: TRASH_ICON_SVG, label: `删除${circle.name}`, danger: true, attrs: `data-circle-id="${escapeAttr(circle.id)}" data-label="${escapeAttr(circle.name)}"` },
    ] });
}

const changeText = change => change?.from ? { ...change, label: `${trendRelationLabel(change.from)} → ${trendRelationLabel(change.to)}` } : change;

// 以「我」为中心的连线图。坐标为百分比，随容器宽度伸缩；节点从正上方顺时针排开，关系标签放在连线靠近中心的 40% 处，避开节点名字。
function relationGraph(circles, selectedId, changes) {
    const n = circles.length;
    const nodes = circles.map((circle, index) => {
        const angle = -Math.PI / 2 + (index * 2 * Math.PI) / n;
        const x = 50 + 38 * Math.cos(angle), y = 46 + 36 * Math.sin(angle);
        const cx = (50 + x) / 2 + 6 * Math.sin(angle), cy = (46 + y) / 2 - 6 * Math.cos(angle);
        return { circle, x, y, cx, cy, lx: 0.36 * 50 + 0.48 * cx + 0.16 * x, ly: 0.36 * 46 + 0.48 * cy + 0.16 * y };
    });
    const round = value => Math.round(value * 10) / 10;
    const lines = nodes.map(node => `<path d="M50 46Q${round(node.cx)} ${round(node.cy)} ${round(node.x)} ${round(node.y)}"/>`).join('');
    const labels = nodes.map(({ circle, lx, ly }) => {
        const change = changes?.circles?.[circle.id];
        const mark = change?.kind === 'up' ? ' ↑' : change?.kind === 'down' ? ' ↓' : '';
        return `<span class="pm-today-trend-graph-label" style="--pm-today-trend-graph-x:${round(lx)}%;--pm-today-trend-graph-y:${round(ly)}%">${escapeHtml(trendRelationLabel(circle.status))}${mark}</span>`;
    }).join('');
    const buttons = nodes.map(({ circle, x, y }) => `<button type="button" class="pm-today-trend-graph-node" data-action="today-trend-select-circle" data-circle-id="${escapeAttr(circle.id)}" data-relation="${escapeAttr(circle.status)}" aria-pressed="${circle.id === selectedId}" style="--pm-today-trend-graph-x:${round(x)}%;--pm-today-trend-graph-y:${round(y)}%"><i aria-hidden="true">${escapeHtml(trendInitial(circle.name))}</i><span>${escapeHtml(circle.name)}</span></button>`).join('');
    return `<div class="pm-today-trend-graph" role="group" aria-label="关系图"><svg class="pm-today-trend-graph-lines" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">${lines}</svg>${labels}<span class="pm-today-trend-graph-center" aria-hidden="true">我</span>${buttons}</div>`;
}

function circleList(circles, selectedId, changes) {
    return `<div class="pm-today-trend-list">${circles.map(circle => `<button type="button" class="pm-today-trend-list-row" data-action="today-trend-select-circle" data-circle-id="${escapeAttr(circle.id)}" aria-pressed="${circle.id === selectedId}"><i class="pm-today-trend-initial" data-relation="${escapeAttr(circle.status)}" aria-hidden="true">${escapeHtml(trendInitial(circle.name))}</i><span class="pm-today-trend-list-text"><b>${escapeHtml(circle.name)}</b><small>${escapeHtml(circle.evaluation)}</small></span>${trendChangeChip(changeText(changes?.circles?.[circle.id]))}${trendRelationPill({ status: circle.status })}</button>`).join('')}</div>`;
}

function selectedCard(circle, { minimalUi, generationBusy, generateAttrs, changes, editing }) {
    if (editing) return `<article class="pm-today-trend-card is-editing" data-circle-id="${escapeAttr(circle.id)}">${circleEditor(circle, 'today-trend-cancel-reputation-editor')}</article>`;
    const idAttr = `data-circle-id="${escapeAttr(circle.id)}"`;
    const pill = trendRelationPill({ status: circle.status, name: circle.name, idAttr, disabled: generationBusy, action: minimalUi ? 'today-trend-cycle-circle-status' : '' });
    const meter = minimalUi ? '' : trendRelationMeter({ status: circle.status, name: circle.name, idAttr, disabled: generationBusy });
    return `<article class="pm-today-trend-card pm-today-trend-circle-card" data-circle-id="${escapeAttr(circle.id)}"><header class="pm-today-trend-card-head"><i class="pm-today-trend-initial is-large" aria-hidden="true">${escapeHtml(trendInitial(circle.name))}</i><span class="pm-today-trend-list-text"><b>${escapeHtml(circle.name)}</b><small>${escapeHtml(circle.scope || '')}</small></span>${pill}</header><blockquote class="pm-today-trend-quote">${escapeHtml(circle.evaluation)}</blockquote>${trendChangeChip(changeText(changes?.circles?.[circle.id]))}${meter}<footer class="pm-today-trend-card-actions">${circleActions(circle, generateAttrs)}</footer></article>`;
}

export function renderTodayTrendReputationView({ scope, mode = 'content', selectedCircleId = null, changes = null, editingCircleId = null, menuOpenId = null, generationAvailable = false, generationBusy = false } = {}) {
    const circles = Array.isArray(scope?.reputation?.circles) ? scope.reputation.circles : [];
    const minimalUi = scope?.injection?.minimalUi === true;
    const generateAttrs = `${generationAvailable && !generationBusy ? '' : 'disabled'} aria-busy="${generationBusy}"`;
    if (mode === 'settings') {
        const rows = circles.map(circle => `<article class="pm-today-trend-row" data-circle-id="${escapeAttr(circle.id)}">${editingCircleId === circle.id ? circleEditor(circle) : `<div><b>${escapeHtml(circle.name)}</b><p>${escapeHtml(circle.scope)}</p></div>${circleActions(circle, generateAttrs)}`}</article>`).join('');
        return `<section class="pm-today-trend-view">${trendModuleHead({ title: '个人风评设置', menuId: 'reputation-settings', menuOpenId, actions: [{ action: 'today-trend-open-reputation', icon: BACK_ICON_SVG, label: '返回个人风评' }, { action: 'today-trend-add-circle', icon: SPARKLES_ICON_SVG, label: '添加圈层' }] })}${rows || '<p class="pm-today-trend-empty">尚未建立风评圈层。</p>'}${editingCircleId === '__new__' ? circleEditor() : ''}</section>`;
    }
    const good = circles.filter(circle => GOOD.has(circle.status)).length;
    const bad = circles.filter(circle => BAD.has(circle.status)).length;
    const head = trendModuleHead({ title: circles.length > GRAPH_LIMIT ? '全部圈层' : '关系图', meta: circles.length ? `${circles.length} 个圈层 · ${good} 好评 · ${bad} 差评` : '', menuId: 'reputation-module', menuOpenId, exposedActionCount: 0, actions: [
        { action: 'today-trend-generate-reputation', icon: REFRESH_ICON_SVG, label: '重新生成个人风评', attrs: generateAttrs },
        { action: 'today-trend-edit-reputation-rule', icon: BOOK_ICON_SVG, label: '编辑个人风评提示词' },
    ] });
    if (!circles.length) return `<section class="pm-today-trend-view pm-today-trend-reputation">${head}<p class="pm-today-trend-empty">尚未生成个人风评。</p></section>`;
    const selected = circles.find(circle => circle.id === selectedCircleId) || circles[0];
    const overview = circles.length > GRAPH_LIMIT ? circleList(circles, selected.id, changes) : relationGraph(circles, selected.id, changes);
    const card = selectedCard(selected, { minimalUi, generationBusy, generateAttrs, changes, editing: editingCircleId === selected.id });
    return `<section class="pm-today-trend-view pm-today-trend-reputation">${head}${overview}${card}</section>`;
}
