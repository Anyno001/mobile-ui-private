import { EDIT_ICON_SVG, REFRESH_ICON_SVG, SETTINGS_ICON_SVG, SPARKLES_ICON_SVG, TRASH_ICON_SVG } from './icons.js';
import { TODAY_TREND_LIMITS, TODAY_TREND_RELATION_STATUSES, todayTrendStatusLabel } from './today-trend-model.js';
import { escapeAttr, escapeHtml } from './ui.js';

const statusOptions = selected => TODAY_TREND_RELATION_STATUSES.map(status => `<option value="${status}" ${status === selected ? 'selected' : ''}>${todayTrendStatusLabel(status)}</option>`).join('');
const relation = value => `<span class="pm-today-trend-status" data-status="${escapeAttr(value.status)}">${escapeHtml(todayTrendStatusLabel(value.status))}</span>`;

function factionCard(faction, children, generateAttrs) {
    return `<article class="pm-today-trend-faction-card" data-faction-id="${escapeAttr(faction.id)}"><header><b>${escapeHtml(faction.name)}</b>${relation(faction.relation)}</header><p>${escapeHtml(faction.summary)}</p><dl>${faction.details.map(detail => `<div><dt>${escapeHtml(detail.label)}</dt><dd>${escapeHtml(detail.value)}</dd></div>`).join('')}</dl><p>${escapeHtml(faction.relation.evaluation)}</p><div class="pm-today-trend-card-actions"><button type="button" data-action="today-trend-refresh-faction" data-faction-id="${escapeAttr(faction.id)}" ${generateAttrs}>${REFRESH_ICON_SVG}刷新</button><button type="button" data-action="today-trend-edit-faction" data-faction-id="${escapeAttr(faction.id)}">${EDIT_ICON_SVG}编辑</button><button type="button" data-action="today-trend-delete-faction" data-faction-id="${escapeAttr(faction.id)}">${TRASH_ICON_SVG}删除</button></div>${children}</article>`;
}

function tree(factions, parentId, generateAttrs) {
    const children = factions.filter(faction => faction.parentId === parentId);
    return children.length ? `<div class="pm-today-trend-faction-tree">${children.map(faction => factionCard(faction, tree(factions, faction.id, generateAttrs), generateAttrs)).join('')}</div>` : '';
}

function editor(faction = {}, factions = []) {
    const selectableParents = factions.filter(item => item.id !== faction.id);
    const related = new Set(faction.relatedFactionIds || []);
    const details = Array.isArray(faction.details) ? faction.details : [];
    const externalCandidates = selectableParents.filter(item => item.id !== faction.parentId && item.parentId !== faction.id);
    return `<form class="pm-today-trend-editor" data-today-trend-form="faction"><input type="hidden" name="id" value="${escapeAttr(faction.id || '')}"><label>名称<input name="name" maxlength="120" required value="${escapeAttr(faction.name || '')}"></label><label>一句话介绍<textarea name="summary" maxlength="600" required>${escapeHtml(faction.summary || '')}</textarea></label><label>父势力<select name="parentId"><option value="">无</option>${selectableParents.map(item => `<option value="${escapeAttr(item.id)}" ${item.id === faction.parentId ? 'selected' : ''}>${escapeHtml(item.name)}</option>`).join('')}</select></label><fieldset><legend>外部关联</legend>${externalCandidates.map(item => `<label><input type="checkbox" name="relatedFactionIds" value="${escapeAttr(item.id)}" ${related.has(item.id) ? 'checked' : ''}>${escapeHtml(item.name)}</label>`).join('') || '<p>没有可作为外部关联的势力。</p>'}</fieldset><fieldset><legend>关键资料</legend><div data-today-trend-details>${details.map(detail => `<div><input name="detailLabel" maxlength="120" required value="${escapeAttr(detail.label)}"><input name="detailValue" maxlength="600" required value="${escapeAttr(detail.value)}"><button type="button" data-action="today-trend-remove-detail">删除</button></div>`).join('')}</div><button type="button" data-action="today-trend-add-detail" ${details.length >= TODAY_TREND_LIMITS.factionDetails ? 'disabled' : ''}>添加资料</button></fieldset><label>对当前角色状态<select name="status">${statusOptions(faction.relation?.status || 'neutral')}</select></label><label>一句话评价<textarea name="evaluation" maxlength="600" required>${escapeHtml(faction.relation?.evaluation || '')}</textarea></label><div class="pm-today-trend-editor-actions"><button type="submit" data-action="today-trend-save-faction">保存</button><button type="button" data-action="today-trend-cancel-editor">取消</button></div></form>`;
}

export function renderTodayTrendFactionView({ scope, mode = 'content', editingFactionId = null, generationAvailable = false, generationBusy = false } = {}) {
    const factions = Array.isArray(scope?.factions) ? scope.factions : [];
    const generateAttrs = `${generationAvailable && !generationBusy ? '' : 'disabled'} aria-busy="${generationBusy}"`;
    const busyLabel = generationBusy ? '<span>正在生成…</span>' : '';
    if (mode === 'editor') return `<section class="pm-today-trend-view pm-today-trend-faction-editor"><header><button type="button" data-action="today-trend-open-factions">返回</button><h2>编辑势力</h2></header>${editor(factions.find(item => item.id === editingFactionId), factions)}</section>`;
    if (mode === 'settings') return `<section class="pm-today-trend-view"><header><button type="button" data-action="today-trend-open-factions">返回</button><h2>相关势力设置</h2></header><section class="pm-today-trend-rule"><h3>模块规则</h3><button type="button" data-action="today-trend-edit-faction-rule">查看/编辑规则</button><button type="button" data-action="today-trend-regenerate-faction-rule">重新生成规则</button></section></section>`;
    const byId = new Map(factions.map(faction => [faction.id, faction]));
    const external = factions.flatMap(source => source.relatedFactionIds.map(id => ({ source, target: byId.get(id) }))).filter(({ target }) => target);
    const externalHtml = external.map(({ source, target }) => `<article class="pm-today-trend-external-relation" data-source-faction-id="${escapeAttr(source.id)}" data-target-faction-id="${escapeAttr(target.id)}"><p>${escapeHtml(source.name)} <span aria-hidden="true">→</span> ${escapeHtml(target.name)}</p>${factionCard(target, '', generateAttrs)}</article>`).join('');
    return `<section class="pm-today-trend-view pm-today-trend-factions"><header><h2>相关势力</h2><button type="button" data-action="today-trend-open-faction-settings" aria-label="相关势力设置">${SETTINGS_ICON_SVG}</button></header><h3>势力树</h3>${tree(factions, null, generateAttrs) || '<p class="pm-today-trend-empty">尚未记录相关势力。</p>'}<h3>外部关联</h3>${externalHtml || '<p class="pm-today-trend-empty">暂无外部关联。</p>'}<button type="button" data-action="today-trend-generate-factions" ${generateAttrs}>${SPARKLES_ICON_SVG}扫描并生成</button>${busyLabel}<button type="button" data-action="today-trend-add-faction">手动添加</button></section>`;
}
