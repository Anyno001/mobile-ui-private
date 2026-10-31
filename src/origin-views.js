// 金手指页面模板：只按状态与视图模型输出 HTML，不读写存储、不调引擎。视觉全部在 styles/origin.css。
// 版式：首页顶栏同剧情助手（左大标题+副标题，右操作、主页键最右）；底栏悬浮胶囊五页签；⋯ 里是二级页。
// 任务页：主线置顶大卡 + 组头下拉筛选 + 每条两行、点开原位展开（按钮右对齐、主操作最右），同时只开一行。
import { appNameOf, appSloganOf } from './app-names.js';
import {
    BACK_ICON_SVG, CHEVRON_DOWN_ICON_SVG, CLOSE_ICON_SVG, HOME_ICON_SVG, MORE_ICON_SVG, ORIGIN_APP_ICON_SVG, SEND_ICON_SVG,
} from './icons.js';
import { tRemain } from './origin/origin-apply.js';
import { originBoundRole } from './origin-settings.js';
import { escapeAttr as rawAttr, escapeHtml as rawHtml } from './ui.js';

// 状态里的 id、数量是数字，转成字符串再转义。
const escapeAttr = value => rawAttr(String(value ?? ''));
const escapeHtml = value => rawHtml(String(value ?? ''));

export const ORIGIN_TABS = Object.freeze([
    Object.freeze({ id: 'task', label: '任务', mod: '' }),
    Object.freeze({ id: 'bag', label: '背包', mod: 'bag' }),
    Object.freeze({ id: 'shop', label: '商城', mod: 'shop' }),
    Object.freeze({ id: 'gacha', label: '抽奖', mod: 'gacha' }),
    Object.freeze({ id: 'chat', label: '对话', mod: 'chat' }),
]);
export const ORIGIN_SUBPAGES = Object.freeze([
    Object.freeze({ id: 'stat', label: '属性', mod: 'stat' }),
    Object.freeze({ id: 'ach', label: '成就', mod: 'ach' }),
    Object.freeze({ id: 'log', label: '记录', mod: '' }),
    Object.freeze({ id: 'settings', label: '设置', mod: '' }),
]);
export const TASK_FILTERS = Object.freeze([['all', '全部'], ['主线', '主线'], ['支线', '支线'], ['日常', '日常'], ['owner', '给角色']]);
const TIERS = new Set(['N', 'R', 'SR', 'SSR', 'UR']);

const esc = escapeHtml;
const num = (value, fallback = 0) => (Number.isFinite(Number(value)) ? Number(value) : fallback);
const act = (action, extra = '') => `data-origin-action="${action}"${extra ? ` ${extra}` : ''}`;
const iconButton = (action, label, svg, extra = '') => `<button type="button" class="pm-origin-icon-button" ${act(action, extra)} aria-label="${escapeAttr(label)}" title="${escapeAttr(label)}">${svg}</button>`;
const opButton = (action, label, extra = '', main = false) => `<button type="button" class="pm-origin-op${main ? ' is-main' : ''}" ${act(action, extra)}>${esc(label)}</button>`;
const link = (action, label, extra = '') => `<button type="button" class="pm-origin-link" ${act(action, extra)}>${esc(label)}</button>`;
const bar = value => `<progress class="pm-origin-bar" max="100" value="${Math.max(0, Math.min(100, Math.round(num(value))))}"></progress>`;
const empty = text => `<p class="pm-origin-empty">${esc(text)}</p>`;
const tierChip = tier => (tier ? `<span class="pm-origin-tier" data-tier="${TIERS.has(tier) ? tier : 'other'}">${esc(tier)}</span>` : '');
export const visibleOriginTabs = settings => ORIGIN_TABS.filter(tab => !tab.mod || settings.mods[tab.mod] !== false);
export const visibleOriginSubpages = settings => ORIGIN_SUBPAGES.filter(page => !page.mod || settings.mods[page.mod] !== false);
const isOwned = task => Boolean(task.owner && task.owner !== '宿主');
const chatLabel = settings => (originBoundRole(settings) ? '私聊' : '对话');

// ---- 顶栏 ----
function homeHeader(state, settings, ui) {
    const sub = state ? `积分 ${num(state.points)} · Lv.${num(state.level, 1)}` : appSloganOf('origin');
    const menu = ui.menuOpen ? renderMenu(state, settings) : '';
    return `<header class="pm-origin-header"><div class="pm-origin-header-text"><h2>${esc(settings.sysName || appNameOf('origin'))}</h2><small>${esc(sub)}</small></div>
<div class="pm-origin-more-wrap">${state ? iconButton('menu', '更多', MORE_ICON_SVG, `aria-haspopup="menu" aria-expanded="${ui.menuOpen === true}"`) : ''}${menu}</div>${iconButton('desktop', '返回桌面', HOME_ICON_SVG)}</header>`;
}

function subHeader(title) {
    return `<header class="pm-origin-header is-sub">${iconButton('back', '返回', BACK_ICON_SVG)}<h2>${esc(title)}</h2><span class="pm-origin-icon-spacer" aria-hidden="true"></span></header>`;
}

function renderMenu(state, settings) {
    const item = (action, label, extra = '') => `<button type="button" role="menuitem" ${act(action, extra)}>${esc(label)}</button>`;
    const pages = visibleOriginSubpages(settings).map(page => item('page', page.label, `data-page="${page.id}"`)).join('');
    const tools = item('pause', state.paused ? '恢复系统' : '暂停系统')
        + (settings.mods.chat !== false ? item('chat-clear', `清空${chatLabel(settings)}`) : '')
        + item('disable', '关闭金手指');
    return `<div class="pm-control-menu pm-origin-menu" role="menu">${pages}<span class="pm-origin-menu-gap" aria-hidden="true"></span>${tools}</div>`;
}

function tabbar(settings, active) {
    const tabs = visibleOriginTabs(settings);
    return `<nav class="pm-origin-tabbar" aria-label="${escapeAttr(appNameOf('origin'))}"><div class="pm-origin-tabs" role="tablist">${tabs.map(tab => `<button type="button" role="tab" class="pm-origin-tab" ${act('tab', `data-tab="${tab.id}"`)} aria-selected="${tab.id === active}">${esc(tab.id === 'chat' ? chatLabel(settings) : tab.label)}</button>`).join('')}</div></nav>`;
}

function banners(state, ui) {
    let out = '';
    if (state.paused) out += `<div class="pm-origin-banner"><span>系统已暂停：不派发任务，时限冻结。</span>${opButton('pause', '恢复')}</div>`;
    if (ui.legacy) out += `<div class="pm-origin-banner"><span>检测到原版Origin存档。</span>${opButton('legacy-dismiss', '忽略')}${opButton('legacy-import', '导入', '', true)}</div>`;
    return out;
}

// ---- 通用两行条目：点开原位展开，同时只开一行 ----
function row(ui, key, { title, sub = '', side = '', desc = '', detail = '', ops = '' }) {
    const open = ui.openRow === key;
    const can = Boolean(detail || ops);
    const head = `<span class="pm-origin-row-main"><b>${title}</b>${sub ? `<small>${sub}</small>` : ''}</span>${side ? `<span class="pm-origin-row-side">${side}</span>` : ''}`;
    return `<article class="pm-origin-row${open ? ' is-open' : ''}">${can
        ? `<button type="button" class="pm-origin-row-head" ${act('row', `data-key="${escapeAttr(key)}"`)} aria-expanded="${open}">${head}</button>`
        : `<div class="pm-origin-row-head">${head}</div>`}${desc ? `<p class="pm-origin-row-desc">${desc}</p>` : ''}${open ? `${detail}${ops ? `<div class="pm-origin-ops">${ops}</div>` : ''}` : ''}</article>`;
}
const kv = (label, text) => (text ? `<p class="pm-origin-kv"><span>${esc(label)}</span>${esc(text)}</p>` : '');

function dropdown(kind, options, value, open) {
    const current = options.find(([id]) => id === value) || options[0];
    const menu = open ? `<div class="pm-control-menu pm-origin-menu is-compact" role="menu">${options.map(([id, label]) => `<button type="button" role="menuitemradio" aria-checked="${id === current[0]}" ${act('filter', `data-kind="${kind}" data-value="${escapeAttr(id)}"`)}>${esc(label)}</button>`).join('')}</div>` : '';
    return `<div class="pm-origin-more-wrap"><button type="button" class="pm-origin-dropdown" ${act('dropdown', `data-kind="${kind}"`)} aria-haspopup="menu" aria-expanded="${open}">${esc(current[1])}${CHEVRON_DOWN_ICON_SVG}</button>${menu}</div>`;
}
const groupHead = (label, count, control = '') => `<div class="pm-origin-group-head"><h3>${esc(label)} · ${num(count)}</h3>${control}</div>`;
const tail = (main, ...links) => `<div class="pm-origin-tail">${main}${links.length ? `<div class="pm-origin-links">${links.join('')}</div>` : ''}</div>`;
const primary = (action, label, busy = false) => `<button type="button" class="pm-origin-primary" ${act(action)}${busy ? ' disabled aria-busy="true"' : ''}>${esc(label)}</button>`;

// ---- 任务 ----
function remainText(task, turn) {
    const remain = tRemain(task, turn);
    if (remain === null) return '';
    return `<span class="pm-origin-remain${remain <= 1 ? ' is-urgent' : ''}">剩${Math.max(0, remain)}回合</span>`;
}
const taskTerms = task => kv('条件', task.cond) + kv('奖励', task.reward) + kv('惩罚', task.penalty);
const taskOps = task => {
    const id = `data-id="${escapeAttr(task.id)}"`;
    return opButton('task-del', '删除', id) + opButton('task-edit', '编辑', id) + opButton('task-done', '完成', id, true);
};
const progress = task => `<div class="pm-origin-progress">${bar(task.progress)}<span>${num(task.progress)}%</span></div>`;

function hero(task, ui, turn) {
    const key = `task:${task.id}`;
    const open = ui.openRow === key;
    return `<article class="pm-origin-hero${open ? ' is-open' : ''}"><button type="button" class="pm-origin-hero-head" ${act('row', `data-key="${escapeAttr(key)}"`)} aria-expanded="${open}"><span class="pm-origin-hero-top"><span>当前主线</span>${remainText(task, turn)}</span><b>${esc(task.title)}</b></button>
${task.desc ? `<p class="pm-origin-hero-desc">${esc(task.desc)}</p>` : ''}${progress(task)}${open ? `${taskTerms(task)}<div class="pm-origin-ops">${taskOps(task)}</div>` : ''}</article>`;
}

function taskPage(state, ui) {
    const active = state.tasks.filter(task => task.status === 'active');
    const busy = ui.busy === 'task';
    const end = tail(primary('task-gen', busy ? '正在请求…' : '请求新任务', busy), link('task-add', '添加任务'), link('task-direction', '设定任务方向'));
    if (!active.length) return `<div class="pm-origin-blank"><span class="pm-origin-blank-art" aria-hidden="true">${ORIGIN_APP_ICON_SVG}</span><h3>暂无进行中的任务</h3><p>系统会随剧情派发任务，也可以现在请求一个。</p></div>${end}`;
    const options = TASK_FILTERS.filter(([id]) => id !== 'owner' || active.some(isOwned));
    const filter = options.some(([id]) => id === ui.taskFilter) ? ui.taskFilter : 'all';
    const main = filter === 'all' ? active.find(task => task.type === '主线' && !isOwned(task)) : null;
    const rest = active.filter(task => task !== main && (filter === 'all' || (filter === 'owner' ? isOwned(task) : task.type === filter)));
    const label = filter === 'all' ? (main ? '其他任务' : '全部任务') : `${options.find(([id]) => id === filter)[1]}任务`;
    const rows = rest.map(task => row(ui, `task:${task.id}`, {
        title: esc(task.title), sub: `${isOwned(task) ? `给${esc(task.owner)}` : esc(task.type)} · 进度${num(task.progress)}%`,
        side: remainText(task, state.turn), detail: (task.desc ? `<p class="pm-origin-row-desc">${esc(task.desc)}</p>` : '') + progress(task) + taskTerms(task), ops: taskOps(task),
    })).join('');
    return `${main ? hero(main, ui, state.turn) : ''}${groupHead(label, rest.length, dropdown('task', options, filter, ui.dropdown === 'task'))}
<div class="pm-origin-list">${rows || empty(`暂无${filter === 'all' ? '其他' : options.find(([id]) => id === filter)[1]}任务`)}</div>${end}`;
}

// ---- 背包、商城、抽奖 ----
function bagPage(state, ui) {
    const rows = state.bag.map((item, i) => row(ui, `bag:${i}:${item.name}`, {
        title: esc(item.name), side: `<span class="pm-origin-count">×${num(item.count, 1)}</span>`, desc: item.desc ? esc(item.desc) : '',
        detail: kv('效果', item.effect), ops: opButton('bag-del', '删除', `data-i="${i}"`) + opButton('bag-use', '使用', `data-i="${i}"`, true),
    })).join('');
    return `${groupHead('物品', state.bag.length)}<div class="pm-origin-list">${rows || empty('背包是空的。商城购买、抽奖与任务奖励都会放在这里。')}</div>${tail('', link('bag-add', '添加物品'))}`;
}

function shopPage(state, ui) {
    const rows = state.shop.map((item, i) => row(ui, `shop:${i}:${item.name}`, {
        title: esc(item.name), side: `<span class="pm-origin-price"><b>${num(item.price)}</b>积分</span>`, desc: item.desc ? esc(item.desc) : '',
        detail: kv('效果', item.effect), ops: opButton('shop-del', '删除', `data-i="${i}"`) + opButton('shop-buy', '购买', `data-i="${i}"`, true),
    })).join('');
    const busy = ui.busy === 'shop';
    return `${groupHead('商品', state.shop.length)}<div class="pm-origin-list">${rows || empty('商城暂无商品')}</div>${tail(primary('shop-gen', busy ? '正在刷新…' : '按世界与方向刷新商城', busy), link('shop-add', '添加商品'))}`;
}

function drawCard(draw) {
    if (!draw) return '';
    return `<section class="pm-origin-draw" data-tier="${TIERS.has(draw.tier) ? draw.tier : 'other'}" role="status"><span class="pm-origin-draw-top">${tierChip(draw.tier)}<small>已放入背包</small>${iconButton('draw-close', '收起', CLOSE_ICON_SVG)}</span><b>${esc(draw.name)}</b>${draw.desc ? `<p>${esc(draw.desc)}</p>` : ''}</section>`;
}

function gachaPage(state, settings, ui) {
    const pool = state.gachaPool;
    const total = pool.reduce((sum, item) => sum + num(item.weight), 0) || 1;
    const tiers = [...new Set(pool.map(item => String(item.tier || '').trim()).filter(Boolean))];
    const options = [['all', '全部'], ...tiers.map(tier => [tier, tier])];
    const filter = options.some(([id]) => id === ui.gachaFilter) ? ui.gachaFilter : 'all';
    const shown = pool.map((item, i) => ({ item, i })).filter(({ item }) => filter === 'all' || String(item.tier || '').trim() === filter);
    const rows = shown.map(({ item, i }) => row(ui, `gacha:${i}:${item.name}`, {
        title: `${tierChip(item.tier)}${esc(item.name)}`, sub: `概率${Math.round(num(item.weight) / total * 100)}%`, desc: item.desc ? esc(item.desc) : '',
        detail: kv('效果', item.effect), ops: opButton('gacha-del', '删除', `data-i="${i}"`),
    })).join('');
    const busy = ui.busy === 'gacha';
    const cost = num(settings.drawCost);
    return `<div class="pm-origin-draw-zone"><button type="button" class="pm-origin-primary" ${act('gacha-draw')}${pool.length ? '' : ' disabled'}>抽一次 · ${cost}积分</button><small>当前积分 ${num(state.points)}</small></div>${drawCard(ui.lastDraw)}
${groupHead(filter === 'all' ? '奖池' : `${filter}奖品`, shown.length, tiers.length > 1 ? dropdown('gacha', options, filter, ui.dropdown === 'gacha') : '')}
<div class="pm-origin-list">${rows || empty(pool.length ? `暂无${filter}奖品` : '奖池为空')}</div>${tail('', link('gacha-gen', busy ? '正在重出…' : '重出奖池'), link('gacha-add', '添加奖品'))}`;
}

// ---- 对话 ----
function chatPage(state, settings, ui) {
    const role = originBoundRole(settings);
    const list = state.chat.slice(-60);
    const bubbles = list.map(entry => {
        if (entry.who === 'call') return `<p class="pm-origin-call">以系统身份喊话 · 下回合生效<br>${esc(entry.text)}</p>`;
        const side = entry.who === 'me' ? 'is-me' : 'is-sys';
        const name = entry.who === 'char' ? `<small>${esc(entry.name || role)}</small>` : '';
        return `<div class="pm-origin-bubble ${side}">${name}<span>${esc(entry.text)}</span>${entry.note ? `<em>${esc(entry.note)}</em>` : ''}</div>`;
    }).join('');
    const hint = role ? `暂无${role}与系统的私聊。${settings.rpChat === 'manual' ? '' : '私聊随正文生成。'}` : '可以向系统询问提示、讨价还价或闲聊。';
    const gen = role && settings.rpChat === 'manual' ? `<div class="pm-origin-tail">${link('chat-gen', ui.busy === 'chat' ? '正在生成…' : '生成一段私聊')}</div>` : '';
    const typing = ui.busy === 'chat' && !role ? '<div class="pm-origin-bubble is-sys is-typing"><span>正在回复…</span></div>' : '';
    return `<div class="pm-origin-chat">${bubbles || empty(hint)}${typing}</div>${gen}`;
}

function composer(settings) {
    const role = originBoundRole(settings);
    const label = role ? `以系统的口吻对${role}说话` : '对系统说的话';
    return `<form class="pm-origin-composer" data-origin-form="chat"><input id="pm-origin-chat-input" type="text" maxlength="400" autocomplete="off" placeholder="${escapeAttr(label)}" aria-label="${escapeAttr(label)}"><button type="submit" aria-label="${role ? '喊话' : '发送'}" title="${role ? '喊话' : '发送'}">${SEND_ICON_SVG}</button></form>`;
}

// ---- 二级页：属性、成就、记录 ----
function statPage(state, ui) {
    const section = (title, rows, emptyText, addAction, addLabel) => `${groupHead(title, rows.length)}<div class="pm-origin-list">${rows.join('') || empty(emptyText)}</div><div class="pm-origin-links is-left">${link(addAction, addLabel)}</div>`;
    const stats = state.stats.map((item, i) => row(ui, `stat:${i}:${item.name}`, { title: esc(item.name), side: `<span class="pm-origin-count">${num(item.val)}</span>`, ops: opButton('stat-del', '删除', `data-i="${i}"`) }));
    const skills = state.skills.map((item, i) => row(ui, `skill:${i}:${item.name}`, { title: esc(item.name), desc: item.desc ? esc(item.desc) : '', ops: opButton('skill-del', '删除', `data-i="${i}"`) }));
    const perks = state.perks.map((item, i) => row(ui, `perk:${i}:${item.name}`, { title: esc(item.name), sub: esc(item.kind || '权限'), desc: item.desc ? esc(item.desc) : '', ops: opButton('perk-del', '删除', `data-i="${i}"`) }));
    const rewards = state.rewardsLog.slice(-15).reverse().map(entry => `<p class="pm-origin-log"><span>第${num(entry.turn)}回合 · ${esc(entry.kind)}</span>${esc(entry.text)}</p>`).join('');
    const exp = num(state.expMax, 100) || 100;
    return `<section class="pm-origin-level"><span><b>Lv.${num(state.level, 1)}</b><small>经验 ${num(state.exp)}/${exp}</small></span>${bar(num(state.exp) / exp * 100)}</section>
${section('属性', stats, '暂无属性', 'stat-add', '添加属性')}${section('技能', skills, '任务奖励、抽奖与剧情中解锁的技能记录在这里。', 'skill-add', '添加技能')}${section('权限与特权', perks, '系统开启的权限、称号与功能记录在这里。', 'perk-add', '添加权限')}
<details class="pm-origin-fold"><summary>奖励流水 · ${state.rewardsLog.length}条</summary><div class="pm-origin-list">${rewards || empty('正文中的奖励原文会保存在这里。')}</div></details>`;
}

function achPage(state) {
    const rows = state.achievements.map(item => `<article class="pm-origin-row"><div class="pm-origin-row-head"><span class="pm-origin-row-main"><b>${esc(item.name)}</b>${item.desc ? `<small>${esc(item.desc)}</small>` : ''}</span></div></article>`).join('');
    return `${groupHead('已解锁', state.achievements.length)}<div class="pm-origin-list">${rows || empty('达成里程碑或剧情高光时解锁。')}</div>`;
}

function logPage(state, ui) {
    const last = ui.lastFloor;
    const note = last ? `<p class="pm-origin-note">上一楼：${last.has ? `有数据块，${num(last.lines)}行` : last.wroteNone ? '数据块为「无」' : '没有数据块，仅按正文解析'}</p>` : '';
    const rows = state.log.slice().reverse().map(entry => `<p class="pm-origin-log">${entry.mark && entry.mark !== '·' ? `<span>${esc(entry.mark)}</span>` : ''}${esc(entry.text)}</p>`).join('');
    return `${note}<div class="pm-origin-list is-plain">${rows || empty('暂无记录')}</div>`;
}

// ---- 入口 ----
function disabledView(settings) {
    return `${homeHeader(null, settings, {})}<div class="pm-origin-scroll"><section class="pm-origin-intro"><span class="pm-origin-blank-art" aria-hidden="true">${ORIGIN_APP_ICON_SVG}</span><h3>${esc(appSloganOf('origin'))}</h3><p>开启后，系统会随剧情派发任务、结算奖励，积分可以在商城和抽奖里使用。数据存在当前聊天里。</p>${primary('enable', '开启金手指')}${link('page', '先看看设置', 'data-page="settings"')}</section></div>`;
}

const SUB_RENDERERS = { stat: statPage, ach: achPage, log: logPage };
const TAB_RENDERERS = { task: taskPage, bag: bagPage, shop: shopPage, gacha: (st, ui, s) => gachaPage(st, s, ui), chat: (st, ui, s) => chatPage(st, s, ui) };

// state：engine.getState()（冻结，只读）；settings：规范化设置；ui：{ tab, page, openRow, menuOpen, dropdown, taskFilter, gachaFilter, busy, status, lastDraw, legacy, lastFloor, blocked, settingsHtml, sheetHtml }
export function renderOriginPage(state, settings, ui) {
    const status = `<p class="pm-origin-status" role="status"${ui.status ? '' : ' hidden'}>${esc(ui.status || '')}</p>`;
    let inner;
    if (ui.page === 'settings') inner = `${subHeader('设置')}${status}<div class="pm-origin-scroll">${ui.settingsHtml || ''}</div>`;
    else if (!settings.enabled) inner = disabledView(settings).replace('<div class="pm-origin-scroll">', `${status}<div class="pm-origin-scroll">`);
    else if (!state) inner = `${homeHeader(null, settings, {})}<div class="pm-origin-scroll"><section class="pm-origin-intro"><h3>请先打开一个聊天</h3><p>${esc(ui.blocked ? '本聊天的存档无法读取，原数据不会被覆盖。' : '金手指的数据随聊天保存。')}</p></section></div>`;
    else if (SUB_RENDERERS[ui.page]) {
        const page = ORIGIN_SUBPAGES.find(item => item.id === ui.page);
        inner = `${subHeader(page.label)}${status}<div class="pm-origin-scroll">${SUB_RENDERERS[ui.page](state, ui)}</div>`;
    } else {
        const tabs = visibleOriginTabs(settings);
        const tab = tabs.some(item => item.id === ui.tab) ? ui.tab : 'task';
        inner = `${homeHeader(state, settings, ui)}${status}<div class="pm-origin-scroll" data-origin-tab="${tab}">${banners(state, ui)}${TAB_RENDERERS[tab](state, ui, settings)}</div>${tab === 'chat' ? composer(settings) : ''}${tabbar(settings, tab)}`;
    }
    return `<div class="pm-origin-shell">${inner}${ui.sheetHtml || ''}</div>`;
}
