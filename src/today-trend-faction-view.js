import { BOOK_ICON_SVG, EDIT_ICON_SVG, REFRESH_ICON_SVG, TRASH_ICON_SVG } from './icons.js';
import { TODAY_TREND_LIMITS, TODAY_TREND_RELATION_STATUSES, todayTrendStatusLabel } from './today-trend-model.js';
import { resolveTodayTrendTitleIcon } from './today-trend-title-icon-mapping.js';
import { escapeAttr, escapeHtml } from './ui.js';
import { trendChangeChip, trendDetailBar, trendFactTile, trendInitial, trendInitialStack, trendModuleHead, trendRelationLabel, trendRelationPill } from './today-trend-ui.js';

const options = selected => TODAY_TREND_RELATION_STATUSES.map(status => `<option value="${status}" ${status === selected ? 'selected' : ''}>${todayTrendStatusLabel(status)}</option>`).join('');
const relationOf = faction => faction.relation && typeof faction.relation === 'object' && !Array.isArray(faction.relation) ? faction.relation : { status: 'neutral', evaluation: '' };
const changeText = change => change?.from ? { ...change, label: `${trendRelationLabel(change.from)} → ${trendRelationLabel(change.to)}` } : change;

function editor(faction = {}, factions = []) {
    const parents = factions.filter(item => item.id !== faction.id), related = new Set(Array.isArray(faction.relatedFactionIds) ? faction.relatedFactionIds : []), details = Array.isArray(faction.details) ? faction.details : [];
    return `<form class="pm-today-trend-editor pm-today-trend-item-editor" data-today-trend-form="faction"><input type="hidden" name="id" value="${escapeAttr(faction.id || '')}"><label class="pm-today-trend-field">名称<input class="pm-today-trend-input" name="name" maxlength="120" required value="${escapeAttr(faction.name || '')}"></label><label class="pm-today-trend-field">一句话介绍<textarea class="pm-today-trend-input" name="summary" maxlength="600" required>${escapeHtml(faction.summary || '')}</textarea></label><label class="pm-today-trend-field">父势力<select class="pm-today-trend-input" name="parentId"><option value="">无</option>${parents.map(item => `<option value="${escapeAttr(item.id)}" ${item.id === faction.parentId ? 'selected' : ''}>${escapeHtml(item.name)}</option>`).join('')}</select></label><fieldset><legend>外部关联</legend>${parents.filter(item => item.id !== faction.parentId && item.parentId !== faction.id).map(item => `<label><input type="checkbox" name="relatedFactionIds" value="${escapeAttr(item.id)}" ${related.has(item.id) ? 'checked' : ''}>${escapeHtml(item.name)}</label>`).join('') || '<p>没有可作为外部关联的势力。</p>'}</fieldset><fieldset><legend>关键资料</legend><div data-today-trend-details>${details.map(detail => `<div class="pm-today-trend-detail-row"><input class="pm-today-trend-input" name="detailLabel" maxlength="120" required value="${escapeAttr(detail.label)}"><input class="pm-today-trend-input" name="detailValue" maxlength="600" required value="${escapeAttr(detail.value)}"><button class="pm-today-trend-detail-remove" type="button" data-action="today-trend-remove-detail">删除</button></div>`).join('')}</div><button class="pm-today-trend-detail-add" type="button" data-action="today-trend-add-detail" ${details.length >= TODAY_TREND_LIMITS.factionDetails ? 'disabled' : ''}>添加资料</button></fieldset><label class="pm-today-trend-field">对当前角色状态<select class="pm-today-trend-input" name="status">${options(faction.relation?.status || 'neutral')}</select></label><label class="pm-today-trend-field">一句话评价<textarea class="pm-today-trend-input" name="evaluation" maxlength="600" required>${escapeHtml(faction.relation?.evaluation || '')}</textarea></label><div class="pm-today-trend-form-actions pm-action-pair"><button type="button" data-action="today-trend-cancel-editor">取消</button><button type="submit">保存</button></div></form>`;
}

function pill(faction, minimalUi, disabled) {
    return trendRelationPill({ status: relationOf(faction).status, name: faction.name, idAttr: `data-faction-id="${escapeAttr(faction.id)}"`, disabled, action: minimalUi ? 'today-trend-cycle-faction-status' : '' });
}

function factionRow(faction, changes) {
    return `<button type="button" class="pm-today-trend-list-row" data-action="today-trend-open-faction" data-faction-id="${escapeAttr(faction.id)}"><i class="pm-today-trend-initial" data-relation="${escapeAttr(relationOf(faction).status)}" aria-hidden="true">${escapeHtml(trendInitial(faction.name))}</i><span class="pm-today-trend-list-text"><b>${escapeHtml(faction.name)}</b><small>${escapeHtml(faction.summary)}</small></span>${trendChangeChip(changeText(changes?.factions?.[faction.id]))}${trendRelationPill({ status: relationOf(faction).status })}</button>`;
}

function factionDetail(faction, { factions, byId, changes, minimalUi, generationBusy, attrs, menuOpenId }) {
    const idAttr = `data-faction-id="${escapeAttr(faction.id)}"`;
    const bar = trendDetailBar({ backAction: 'today-trend-close-detail', backLabel: '返回', menuId: `faction:${faction.id}`, menuOpenId, actions: [
        { action: 'today-trend-refresh-faction', icon: REFRESH_ICON_SVG, label: `重新生成${faction.name}`, attrs: `${idAttr} ${attrs}` },
        { action: 'today-trend-edit-faction', icon: EDIT_ICON_SVG, label: `编辑${faction.name}`, attrs: idAttr },
        { action: 'today-trend-delete-faction', icon: TRASH_ICON_SVG, label: `删除${faction.name}`, danger: true, attrs: `${idAttr} data-label="${escapeAttr(faction.name)}"` },
    ] });
    const relation = relationOf(faction);
    const details = Array.isArray(faction.details) ? faction.details : [];
    const facts = details.map(detail => trendFactTile({ icon: resolveTodayTrendTitleIcon({ title: detail.label, kind: 'world' }).svg, label: detail.label, value: detail.value })).join('');
    const parent = faction.parentId ? byId.get(faction.parentId) : null;
    const children = factions.filter(item => item.parentId === faction.id);
    const related = (Array.isArray(faction.relatedFactionIds) ? faction.relatedFactionIds : []).map(id => byId.get(id)).filter(Boolean);
    const link = item => `<button type="button" class="pm-today-trend-link-row" data-action="today-trend-open-faction" data-faction-id="${escapeAttr(item.id)}"><span>${escapeHtml(item.name)}</span>${trendRelationPill({ status: relationOf(item).status })}</button>`;
    return `<section class="pm-today-trend-view pm-today-trend-detail" data-faction-id="${escapeAttr(faction.id)}">${bar}
        <span class="pm-today-trend-card-tags">${pill(faction, minimalUi, generationBusy)}${trendChangeChip(changeText(changes?.factions?.[faction.id]))}</span>
        <h2 class="pm-today-trend-detail-title">${escapeHtml(faction.name)}</h2><p class="pm-today-trend-detail-copy">${escapeHtml(faction.summary)}</p>
        ${facts ? `<div class="pm-today-trend-facts">${facts}</div>` : ''}
        ${relation.evaluation ? `<section class="pm-today-trend-detail-section"><h3>对当前角色</h3><blockquote class="pm-today-trend-quote">${escapeHtml(relation.evaluation)}</blockquote></section>` : ''}
        ${parent ? `<section class="pm-today-trend-detail-section"><h3>上级势力</h3>${link(parent)}</section>` : ''}
        ${children.length ? `<section class="pm-today-trend-detail-section"><h3>下属势力</h3><div class="pm-today-trend-list">${children.map(child => factionRow(child, changes)).join('')}</div></section>` : ''}
        ${related.length ? `<section class="pm-today-trend-detail-section"><h3>外部关联</h3>${related.map(link).join('')}</section>` : ''}
    </section>`;
}

export function renderTodayTrendFactionView({ scope, mode = 'content', detailId = null, changes = null, editingFactionId = null, menuOpenId = null, generationAvailable = false, generationBusy = false } = {}) {
    const factions = Array.isArray(scope?.factions) ? scope.factions : [], attrs = `${generationAvailable && !generationBusy ? '' : 'disabled'} aria-busy="${generationBusy}"`;
    const minimalUi = scope?.injection?.minimalUi === true;
    if (mode === 'editor') return `<section class="pm-today-trend-view">${trendModuleHead({ title: editingFactionId === '__new__' ? '添加势力' : '编辑势力', menuId: 'faction-editor', menuOpenId })}${editor(factions.find(item => item.id === editingFactionId), factions)}</section>`;
    const byId = new Map(factions.map(faction => [faction.id, faction]));
    const detailFaction = detailId ? byId.get(detailId) : null;
    if (detailFaction) return factionDetail(detailFaction, { factions, byId, changes, minimalUi, generationBusy, attrs, menuOpenId });
    const roots = factions.filter(faction => !faction.parentId || !byId.has(faction.parentId));
    const links = factions.reduce((count, faction) => count + (Array.isArray(faction.relatedFactionIds) ? faction.relatedFactionIds.filter(id => byId.has(id)).length : 0), 0);
    const head = trendModuleHead({ title: '全部势力', meta: factions.length ? `${factions.length} 个势力 · ${links} 条外部关联` : '', menuId: 'faction-module', menuOpenId, exposedActionCount: 0, actions: [
        { action: 'today-trend-generate-factions', icon: REFRESH_ICON_SVG, label: '重新生成势力图谱', attrs },
        { action: 'today-trend-edit-faction-rule', icon: BOOK_ICON_SVG, label: '编辑势力图谱提示词' },
    ] });
    const cards = roots.map(faction => {
        const children = factions.filter(item => item.parentId === faction.id);
        const related = (Array.isArray(faction.relatedFactionIds) ? faction.relatedFactionIds : []).map(id => byId.get(id)).filter(Boolean);
        const meta = trendInitialStack(children.map(child => child.name)) + (related.length ? `<small class="pm-today-trend-link-chip">关联：${escapeHtml(related.map(item => item.name).join('、'))}</small>` : '');
        return `<button type="button" class="pm-today-trend-card" data-action="today-trend-open-faction" data-faction-id="${escapeAttr(faction.id)}"><span class="pm-today-trend-card-tags">${trendRelationPill({ status: relationOf(faction).status })}${trendChangeChip(changeText(changes?.factions?.[faction.id]))}</span><b class="pm-today-trend-card-title">${escapeHtml(faction.name)}</b><span class="pm-today-trend-card-copy">${escapeHtml(faction.summary)}</span>${meta ? `<span class="pm-today-trend-card-meta">${meta}</span>` : ''}</button>`;
    }).join('');
    return `<section class="pm-today-trend-view pm-today-trend-factions">${head}${cards || '<p class="pm-today-trend-empty">尚未记录势力图谱。</p>'}</section>`;
}
