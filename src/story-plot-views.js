// 剧情助手里的「剧情」页（剧情注入器的项目、进度、设定、大纲）与首页项目卡的模板：只按视图模型输出 HTML。
// 数据与动作在 story-plot.js；按钮统一用 data-plot-action，「⋯」菜单沿用剧情助手的 toggle-more。
import {
    BACK_ICON_SVG, BOOK_ICON_SVG, CHAT_ICON_SVG, CHECK_ICON_SVG, CHEVRON_DOWN_ICON_SVG, EDIT_ICON_SVG, BOOKMARK_ICON_SVG, FLAG_ICON_SVG, MORE_ICON_SVG, PLUS_ICON_SVG,
    ROUTE_ICON_SVG, SEARCH_ICON_SVG, TRASH_ICON_SVG, DOWNLOAD_ICON_SVG, REFRESH_ICON_SVG, FORWARD_ICON_SVG, SPARKLES_ICON_SVG,
} from './icons.js';
import { escapeAttr as rawEscapeAttr, escapeHtml as rawEscapeHtml } from './ui.js';
import { PACES } from './plot-injector/core/inject.js';
import { CHANGE_FIELD, NODE_FIELDS, changeLines, mainNodeNames, outlineIssues, stageLabel, stageNodes, volumeLabel } from './plot-injector/core/outline.js';
import { STATE_LABELS, offNodes } from './plot-injector/core/progress.js';
import { clockPhase, clockSize, hookCondition, hookLimit, hookSteps, isThreadNode } from './plot-injector/core/threads.js';
import { splitBlocks } from './plot-injector/core/setting.js';
import { findWorld, phaseLabels } from './plot-injector/core/infinite.js';
import { renderInfiniteOutline, renderInfiniteProgress } from './story-plot-infinite-views.js';

// 剧情数据来自 YAML，值可能是数字或布尔：先转字符串再转义。
const escapeHtml = value => rawEscapeHtml(value == null ? '' : String(value));
const escapeAttr = value => rawEscapeAttr(value == null ? '' : String(value));

export const PLOT_TABS = Object.freeze([['progress', '进度'], ['setting', '设定'], ['outline', '大纲']]);
const HANDLE_LABELS = Object.freeze({ ask: '询问', auto: '自动切到下一段', nodes: '只勾节点' });
const OFF_LABELS = Object.freeze({ ask: '询问', auto: '自动改写后续', off: '不检查' });
const THREAD_LABELS = Object.freeze({ ask: '询问', auto: '自动收录为支线', off: '不识别' });
const NODE_TAGS = Object.freeze({ main: '主线', side: '支线', world: '世界动态' });

const disabledAttr = enabled => (enabled ? '' : 'disabled');
const firstChar = value => Array.from(String(value || '').trim())[0] || '剧';
const btn = (action, label, { cls = 'pm-plot-op', attrs = '', enabled = true } = {}) => `<button type="button" class="${cls}" data-plot-action="${action}" ${attrs} ${disabledAttr(enabled)}>${label}</button>`;
const FORWARD_CHEVRON = `<span class="pm-plot-chevron" aria-hidden="true">${FORWARD_ICON_SVG}</span>`;
const nodeTitle = node => String(node.name || node.label || '').trim() || '未命名节点';

function renderMore(id, items, openMenuId) {
    const open = openMenuId === id;
    return `<div class="pm-story-oracle-more-wrap"><button type="button" class="pm-story-oracle-icon-button" data-story-oracle-action="toggle-more" data-story-oracle-menu-id="${escapeAttr(id)}" aria-haspopup="menu" aria-expanded="${open}" aria-label="更多操作" title="更多操作">${MORE_ICON_SVG}</button><div class="pm-control-menu pm-story-oracle-more-menu" role="menu" ${open ? '' : 'hidden'}>${items.join('')}</div></div>`;
}

const menuItem = (action, icon, label, { attrs = '', danger = false, enabled = true } = {}) => `<button type="button" role="menuitem" ${danger ? 'class="pm-control-menu-danger"' : ''} data-plot-action="${action}" ${attrs} ${disabledAttr(enabled)}>${icon}<span>${label}</span></button>`;

// 当前阶段在全部阶段里的位置，画成首页卡片上的分段进度条。
function progressBar(vm) {
    const total = vm.units.length;
    if (!total) return '';
    const cells = vm.units.map(unit => {
        const state = vm.states[unit.id];
        return `<i class="${state === 'done' ? 'is-done' : state === 'active' ? 'is-active' : ''}"></i>`;
    }).join('');
    return `<div class="pm-plot-progress" aria-hidden="true">${cells}</div>`;
}

const activeUnit = vm => vm.units.find(unit => vm.states[unit.id] === 'active') || null;
const placeOf = unit => (unit ? `${volumeLabel(unit.volume.key)} · ${stageLabel(unit.stage.key)}` : '');
// 检测结果提示卡（演完、偏离、失败）：按钮直接在卡上，点了由 story-plot.js 执行对应动作。
export function renderPlotNotices(notices) {
    return (notices || []).map(item => `<section class="pm-plot-notice" data-plot-notice="${escapeAttr(item.id)}" role="status">
      <b>${escapeHtml(item.title)}</b>${item.body ? `<p>${escapeHtml(item.body)}</p>` : ''}
      ${item.actions?.length ? `<div class="pm-plot-notice-actions">${item.actions.map((action, index) => `<button type="button" class="pm-plot-chip${action.primary ? ' is-ink' : ''}" data-plot-action="notice" data-plot-notice-id="${escapeAttr(item.id)}" data-plot-index="${index}">${escapeHtml(action.label)}</button>`).join('')}</div>` : ''}
    </section>`).join('');
}

// 首页最上面：本聊天正在用的项目。没有项目时换成一句引导。
export function renderPlotHomeCard(vm) {
    if (!vm.ready) return '<section class="pm-plot-card is-featured"><p class="pm-plot-card-note">正在读取剧情项目…</p></section>';
    if (!vm.hasCard) return '';
    const project = vm.active;
    if (!project) {
        return `<section class="pm-plot-card is-featured"><span class="pm-plot-card-kicker">${BOOK_ICON_SVG}<span>一条if线 = 一个项目</span></span>
          <h3>${vm.projectCount ? '本聊天还没有选项目' : '先建一个项目'}</h3>
          <p class="pm-plot-card-note">写好设定和大纲后，聊天时会按大纲一段段引导，每几楼自动检测演到了哪里。</p>
          <div class="pm-plot-card-actions">${vm.projectCount ? btn('open-sheet', '选择项目', { cls: 'pm-plot-chip' }) : btn('import-project', '导入备份', { cls: 'pm-plot-chip' })}${btn('new-project', '新建项目', { cls: 'pm-plot-chip is-ink' })}</div></section>`;
    }
    if (vm.infinite) {
        const inf = vm.infState && vm.infState.inf;
        const world = inf && inf.phase === 'world' ? findWorld(inf.worlds, inf.worldId) : null;
        const labels = phaseLabels(vm.infConfig.config);
        const place = !inf ? '无限流' : world ? `${labels.world}「${world.title}」` : labels.train;
        return `<section class="pm-plot-card is-featured">
      <span class="pm-plot-card-kicker">${BOOK_ICON_SVG}<span>本聊天的剧情</span></span>
      <button type="button" class="pm-plot-card-title" data-plot-action="open-plot"><b>${escapeHtml(project.name)}</b><span>${escapeHtml(place)}</span></button>
      <div class="pm-plot-card-meta"><span>${inf ? `世界库 ${inf.worlds.length} 份` : ''}</span><span>${vm.infOpening ? '正在造世界…' : ''}</span></div>
    </section>`;
    }
    const unit = activeUnit(vm);
    const main = vm.mainCount;
    const gapText = !vm.units.length ? '大纲为空' : vm.gap > 0 ? `再过 ${vm.gap} 楼检测` : '下一楼检测';
    return `<section class="pm-plot-card is-featured">
      <span class="pm-plot-card-kicker">${BOOK_ICON_SVG}<span>本聊天的剧情</span></span>
      <button type="button" class="pm-plot-card-title" data-plot-action="open-plot"><b>${escapeHtml(project.name)}</b><span>${escapeHtml(placeOf(unit) || '还没有大纲')}</span></button>
      ${progressBar(vm)}
      <div class="pm-plot-card-meta"><span>${main.total ? `主线 ${main.done}/${main.total} 已演` : ''}</span><span>${gapText}</span></div>
      ${vm.units.length ? `<div class="pm-plot-card-actions">${btn('check', vm.checking ? '检测中…' : '立即检测', { cls: 'pm-plot-chip', enabled: !vm.checking && !vm.yielded })}${btn('next', '打开下一段', { cls: 'pm-plot-chip is-ink', enabled: !vm.yielded })}</div>` : `<div class="pm-plot-card-actions">${btn('tab-outline', '去写大纲', { cls: 'pm-plot-chip is-ink' })}</div>`}
    </section>`;
}

// 剧情页顶栏：标题 + 本项目和当前聊天的关系，右侧「⋯」随页签换内容。
function plotHeader(vm) {
    const relation = !vm.viewed ? '还没有项目'
        : vm.viewed.id === vm.activeId ? (vm.viewed.id === vm.cardDefaultId ? '当前聊天使用 · 本卡默认也是它' : '当前聊天使用')
            : vm.viewed.id === vm.cardDefaultId ? '本卡默认（当前聊天用的是别的项目）' : '没有用在当前聊天';
    const items = !vm.viewed ? [] : vm.infinite && vm.tab === 'progress' ? [
        menuItem('preview', SEARCH_ICON_SVG, '预览注入内容'),
    ] : vm.infinite && vm.tab === 'outline' ? [] : vm.tab === 'progress' ? [
        menuItem('preview', SEARCH_ICON_SVG, '预览注入内容'),
        menuItem('index', ROUTE_ICON_SVG, '剧情索引'),
        menuItem('params', EDIT_ICON_SVG, '注入位置'),
        menuItem('reset-base', REFRESH_ICON_SVG, '从这一楼重新计检测'),
    ] : vm.tab === 'setting' ? [
        menuItem('setting-full', EDIT_ICON_SVG, '编辑全文'),
        menuItem('setting-history', REFRESH_ICON_SVG, `历史版本 ${vm.viewed.setting.history.length}`),
    ] : [
        menuItem('outline-paste', EDIT_ICON_SVG, '粘贴YAML'),
        menuItem('outline-export', DOWNLOAD_ICON_SVG, '导出大纲', { enabled: vm.viewed.outline.volumes.length > 0 }),
    ];
    const more = items.length ? renderMore('plot', items, vm.openMenuId) : '<span class="pm-story-oracle-icon-spacer" aria-hidden="true"></span>';
    return `<header class="pm-story-oracle-header"><div class="pm-story-oracle-header-text"><h2>剧情</h2><small>${escapeHtml(relation)}</small></div>${more}</header>`;
}

function projectSwitch(vm) {
    if (!vm.viewed) return '';
    return `<button type="button" class="pm-plot-switch" data-plot-action="open-sheet" aria-haspopup="dialog"><b>${escapeHtml(vm.viewed.name)}</b>${CHEVRON_DOWN_ICON_SVG}<span>共 ${vm.projectCount} 个项目</span></button>`;
}

function plotTabs(vm) {
    return `<div class="pm-story-oracle-tabs" role="tablist" aria-label="剧情">${PLOT_TABS.map(([key, label]) => [key, vm.infinite && key === 'outline' ? '世界库' : label]).map(([key, label]) => `<button type="button" role="tab" class="pm-story-oracle-tab${vm.tab === key ? ' is-selected' : ''}" data-plot-action="tab" data-plot-tab="${key}" aria-selected="${vm.tab === key}">${label}</button>`).join('')}</div>`;
}

const takeover = vm => (vm.yielded ? '<section class="pm-plot-notice" role="status"><b>独立版剧情注入器正在运行</b><p>注入和检测由独立版负责，这里看到和改动的是同一份项目。</p></section>' : '');

// 节点类型标签：主线深色实心、支线浅底、世界动态只写灰字。
const kindTag = node => `<span class="pm-plot-kind is-${escapeAttr(node.kind)}">${NODE_TAGS[node.kind] || ''}</span>`;
const markButton = (action, attrs, label, { dot = false } = {}) => `<button type="button" class="pm-plot-mark${dot ? ' is-dot' : ''}" data-plot-action="${action}" ${attrs}>${escapeHtml(label)}</button>`;

// 节点行：未演继续注入，已演不再注入（名称划掉）。行尾「未演/已演」点一下切换；存储里记的是「已演的节点」，与独立版同一份数据。
// 延续条目的来源不占行尾：钩子写在它的菜单标题里，普通节点放在悬停提示里，行尾只留状态。
function nodeRow(unitId, node, done, { from = '', mark = '' } = {}) {
    const tail = mark || markButton('node', `data-plot-unit="${escapeAttr(unitId)}" data-plot-node="${escapeAttr(node.id)}" aria-pressed="${done}"`, done ? '已演' : '未演');
    return `<div class="pm-plot-line${done ? ' is-done' : ''}"${from ? ` title="来自${escapeAttr(from)}"` : ''}>${kindTag(node)}<span class="pm-plot-line-name">${escapeHtml(nodeTitle(node))}</span>${tail}</div>`;
}

// 支线钩子：待触发、已激活（带粉点）、排队、第 k/n 步；行尾状态字点开手动菜单。
function hookRow(hook) {
    const chain = hook.steps.length && (hook.status === 'active' || hook.status === 'queue');
    const mark = hook.status === 'done' ? '已演' : chain ? `第 ${hook.step + 1}/${hook.steps.length} 步${hook.status === 'queue' ? ' · 排队' : ''}` : { wait: '待触发', active: '已激活', queue: '排队' }[hook.status] || '';
    const button = markButton('hook-menu', `data-plot-key="${escapeAttr(hook.key)}"`, mark, { dot: hook.status === 'active' });
    return nodeRow(hook.unit.id, hook.node, hook.status === 'done', { from: hook.carried ? stageLabel(hook.unit.stage.key) : '', mark: button });
}

// 已过期的支线收成一行「已过期 N 条」，点开列出，行尾「已过期」可恢复。
function expiredRows(hooks, open) {
    if (!hooks.length) return '';
    const rows = open ? hooks.map(hook => `<div class="pm-plot-line is-quiet">${kindTag(hook.node)}<span class="pm-plot-line-name">${escapeHtml(hook.node.name)}</span>${markButton('hook-menu', `data-plot-key="${escapeAttr(hook.key)}"`, '已过期')}</div>`).join('') : '';
    return `<button type="button" class="pm-plot-fold" data-plot-action="expired-toggle" aria-expanded="${open}">已过期 ${hooks.length} 条</button>${rows}`;
}

// 世界进度钟：每钟一行，名称、圆点（深色为已填）、k/n，满格写「已满」；已发生的整行变灰、名称划掉、圆点变浅。点整行开手动菜单。
function clockRows(clocks) {
    if (!clocks.length) return '';
    return `<p class="pm-plot-line-label">世界进度钟</p>${clocks.map(clock => {
        const phase = clockPhase(clock);
        const dots = Array.from({ length: clock.total }, (_, i) => `<i${i < clock.filled ? ' class="is-on"' : ''}></i>`).join('');
        const mark = phase === 'done' ? '已发生' : phase === 'due' ? '已满' : `${clock.filled}/${clock.total}`;
        return `<button type="button" class="pm-plot-clock${phase === 'done' ? ' is-done' : phase === 'due' ? ' is-due' : ''}" data-plot-action="clock-menu" data-plot-key="${escapeAttr(clock.key)}" title="${escapeAttr(clock.event)}"><span class="pm-plot-line-name">${escapeHtml(clock.node.name)}</span><span class="pm-plot-dots" aria-hidden="true">${dots}</span><small>${mark}</small></button>`;
    }).join('')}`;
}

// 当前段的节点：直接接在阶段名下方（不另包卡片）。主线与普通支线、世界动态在前，钩子随后；延续自前面阶段的单列一组；关掉的一类只留一行说明。
function nodeList(vm, unit) {
    const off = new Set(offNodes(vm.progress, unit));
    const live = vm.live;
    const nodes = stageNodes(unit.stage.data).filter(node => !isThreadNode(node));
    const alive = hook => hook.status !== 'expired';
    const own = live.hooks.filter(hook => !hook.carried && alive(hook));
    const later = live.hooks.filter(hook => hook.carried && alive(hook));
    const expired = live.hooks.filter(hook => !alive(hook));
    const closed = [...(vm.switches.sideOn ? [] : ['支线']), ...(vm.switches.worldOn ? [] : ['世界动态'])];
    const carried = vm.carried.map(entry => nodeRow(entry.unit.id, entry.node, entry.off, { from: stageLabel(entry.unit.stage.key) })).join('') + later.map(hookRow).join('');
    const body = `${nodes.map(node => nodeRow(unit.id, node, off.has(node.id))).join('')}${own.map(hookRow).join('')}
      ${carried ? `<p class="pm-plot-line-label">延续自前面阶段</p>${carried}` : ''}${expiredRows(expired, vm.expiredOpen)}${clockRows(live.clocks)}
      ${closed.map(label => `<p class="pm-plot-line-label">${label}已关闭</p>`).join('')}`;
    return body.trim() ? `<div class="pm-plot-nodes">${body}</div>` : '';
}

function timeline(vm) {
    const groups = [];
    for (const unit of vm.units) {
        const last = groups[groups.length - 1];
        if (last && last.volume === unit.volume) last.units.push(unit);
        else groups.push({ volume: unit.volume, units: [unit] });
    }
    const item = unit => {
        const state = vm.states[unit.id];
        const manual = vm.progress.slots[unit.id]?.state;
        const muted = vm.progress.muted.includes(unit.id);
        const notes = [state === 'next' ? STATE_LABELS.next : '', manual ? '手动' : '', muted ? '不提醒' : ''].filter(Boolean).join(' · ');
        const menu = renderMore(`unit:${unit.id}`, [
            menuItem('unit-goto', FLAG_ICON_SVG, '设为当前段', { attrs: `data-plot-unit="${escapeAttr(unit.id)}"`, enabled: state !== 'active' }),
            menuItem('unit-state', EDIT_ICON_SVG, '手动改状态', { attrs: `data-plot-unit="${escapeAttr(unit.id)}"` }),
            muted ? menuItem('unit-unmute', REFRESH_ICON_SVG, '恢复提醒', { attrs: `data-plot-unit="${escapeAttr(unit.id)}"` }) : '',
            menuItem('open-stage', ROUTE_ICON_SVG, '查看阶段', { attrs: `data-plot-stage="${escapeAttr(unit.stage.id)}"` }),
        ].filter(Boolean), vm.openMenuId);
        return `<li class="pm-plot-tl-item is-${state}"><div class="pm-plot-tl-head"><span class="pm-plot-tl-name">${escapeHtml(stageLabel(unit.stage.key))}</span>${notes ? `<small>${escapeHtml(notes)}</small>` : ''}${menu}</div>${state === 'active' ? nodeList(vm, unit) : ''}</li>`;
    };
    return groups.map(group => `<h4 class="pm-plot-vol">${escapeHtml(volumeLabel(group.volume.key))}</h4><ol class="pm-plot-tl">${group.units.map(item).join('')}</ol>`).join('');
}

// 支线、世界动态两个开关，按项目存。
function switchRow(vm) {
    const cell = (key, label) => {
        const on = vm.switches[key];
        return `<div class="pm-plot-switch-cell"><span>${label}</span><button type="button" class="pm-custom-check${on ? ' is-checked' : ''}" role="switch" aria-checked="${on}" aria-label="${label}" data-plot-action="thread-switch" data-plot-key="${key}"></button></div>`;
    };
    return `<div class="pm-plot-switches">${cell('sideOn', '支线')}${cell('worldOn', '世界动态')}</div>`;
}

function activationCard(vm) {
    const other = vm.active ? `当前聊天使用的是「${escapeHtml(vm.active.name)}」。` : '当前聊天还没有使用项目。';
    return `<section class="pm-plot-card"><h3>没有用在当前聊天</h3><p class="pm-plot-card-note">${other}要按这个项目引导，先设为当前聊天使用。</p>
      <div class="pm-plot-card-actions">${btn('use-chat', '设为当前聊天使用', { cls: 'pm-plot-chip is-ink', enabled: vm.hasCard })}${btn('use-card', '设为本卡默认', { cls: 'pm-plot-chip', enabled: vm.hasCard })}</div></section>`;
}

function progressBody(vm) {
    if (vm.viewed.id !== vm.activeId) return activationCard(vm);
    if (vm.infinite) return renderInfiniteProgress(vm);
    if (!vm.units.length) return `<p class="pm-story-oracle-empty is-inline">大纲为空。到「大纲」页导入YAML，或让AI写一卷。</p><div class="pm-plot-ops">${btn('tab-outline', '去写大纲', { cls: 'pm-plot-op is-ink' })}</div>`;
    const pace = `<div class="pm-story-oracle-segments" role="group" aria-label="推进速度">${PACES.map(item => `<button type="button" class="pm-story-oracle-segment${vm.progress.pace === item.value ? ' is-selected' : ''}" data-plot-action="pace" data-plot-pace="${item.value}" aria-pressed="${vm.progress.pace === item.value}">${item.label}</button>`).join('')}</div>`;
    const ops = `<div class="pm-plot-ops">${btn('check', vm.checking ? '检测中…' : '立即检测', { enabled: !vm.checking && !vm.yielded })}${btn('rewrite', '改写后续', { enabled: !vm.busy })}${btn('next', '打开下一段', { cls: 'pm-plot-op is-ink', enabled: !vm.yielded })}</div>`;
    return `${pace}${switchRow(vm)}${ops}${timeline(vm)}`;
}
function settingDraft(vm) {
    const draft = vm.settingDraft;
    if (!draft) return '';
    const old = new Map(splitBlocks(vm.viewed.setting.text).map(block => [block.key, block]));
    const blocks = splitBlocks(draft.body);
    const picked = new Set(draft.keys);
    const rows = draft.open ? `<ul class="pm-plot-draft-rows">${blocks.map(block => {
        const before = old.get(block.key);
        const status = !before ? '新增' : before.text === block.text ? '未变' : '改动';
        return `<li><button type="button" class="pm-plot-node${picked.has(block.key) ? ' is-done' : ''}" data-plot-action="draft-pick" data-plot-key="${escapeAttr(block.key)}" aria-pressed="${picked.has(block.key)}"><span class="pm-plot-check" aria-hidden="true">${picked.has(block.key) ? CHECK_ICON_SVG : ''}</span><span class="pm-plot-node-name">${escapeHtml(block.title)}</span><small>${status}</small></button></li>`;
    }).join('')}</ul>` : `<p>${escapeHtml(blocks.map(block => block.title).join('、'))}</p>`;
    return `<section class="pm-plot-block is-draft"><div class="pm-plot-block-head"><b>${draft.sync ? '按大纲校对' : 'AI整理'} · 新草稿</b><small>${draft.sync ? `改动 ${draft.keys.length} 块` : `${blocks.length} 块`}${draft.check ? ` · 速查 ${escapeHtml(draft.check)}` : ''}</small></div>${rows}
      <div class="pm-plot-card-actions">${draft.open ? btn('draft-apply-picked', `采用勾选的 ${picked.size} 块`, { cls: 'pm-plot-chip is-ink', enabled: picked.size > 0 }) : btn('draft-apply-all', '全部采用', { cls: 'pm-plot-chip is-ink' })}${btn('draft-toggle', draft.open ? '收起' : '逐块看', { cls: 'pm-plot-chip' })}${btn('draft-drop', '丢弃', { cls: 'pm-plot-chip' })}</div></section>`;
}

function settingFixes(vm) {
    const fixes = vm.viewed.setting.fixes;
    if (!fixes.length) return '';
    return `<section class="pm-plot-block"><div class="pm-plot-block-head"><b>补定 · 待确认</b><small>${fixes.length} 条</small></div>
      <ul class="pm-plot-fixes">${fixes.map((fix, index) => `<li><p>${escapeHtml(fix)}</p><div class="pm-plot-card-actions">${btn('fix-ok', '确认', { cls: 'pm-plot-chip', attrs: `data-plot-index="${index}"` })}${btn('fix-edit', '修改', { cls: 'pm-plot-chip', attrs: `data-plot-index="${index}"`, enabled: !vm.busy })}${btn('fix-drop', '丢弃', { cls: 'pm-plot-chip', attrs: `data-plot-index="${index}"` })}</div></li>`).join('')}</ul></section>`;
}

function settingBody(vm) {
    const blocks = splitBlocks(vm.viewed.setting.text).filter(block => block.text.trim());
    const mute = new Set(vm.viewed.setting.mute || []);
    const cards = blocks.map(block => {
        const title = block.title === '开头' ? '开头（未分块）' : block.title;
        const muted = mute.has(block.key);
        const menu = renderMore(`block:${block.key}`, [
            menuItem('block-edit', EDIT_ICON_SVG, '编辑', { attrs: `data-plot-key="${escapeAttr(block.key)}"` }),
            menuItem('block-mute', BOOKMARK_ICON_SVG, muted ? '恢复注入' : '不注入正文', { attrs: `data-plot-key="${escapeAttr(block.key)}"` }),
            menuItem('block-del', TRASH_ICON_SVG, '删除', { attrs: `data-plot-key="${escapeAttr(block.key)}"`, danger: true }),
        ], vm.openMenuId);
        return `<section class="pm-plot-block"><div class="pm-plot-block-head"><button type="button" class="pm-plot-block-title" data-plot-action="block-edit" data-plot-key="${escapeAttr(block.key)}">${escapeHtml(title)}</button><small>${muted ? '不注入 · ' : ''}约 ${block.text.length} 字</small>${menu}</div><p>${escapeHtml(block.text.replace(/^.*[:：]\s*\n/, ''))}</p></section>`;
    }).join('');
    const empty = blocks.length ? '' : '<p class="pm-story-oracle-empty is-inline">还没有设定。可以先在剧情参谋里聊想法，再点「AI整理」；也可以从世界书导入。</p>';
    const canSync = blocks.length > 0 && vm.viewed.outline.volumes.some(volume => volume.stages.length);
    const ops = `<div class="pm-plot-ops${canSync ? ' is-four' : ''}">${btn('setting-import', '从世界书导入')}${btn('block-new', '新分块')}${canSync ? btn('setting-sync', '按大纲校对', { enabled: !vm.busy }) : ''}${btn('setting-ai', vm.busy === 'setting' ? '整理中…' : 'AI整理', { cls: 'pm-plot-op is-ink', enabled: !vm.busy })}</div>`;
    return `${settingDraft(vm)}${settingFixes(vm)}${cards}${empty}${ops}`;
}

const STAGE_DRAFT = Object.freeze({ 'stage-refine': '细化节点', 'stage-split': '拆成两段', 'stage-merge': '与下一段合并' });

// 解析错误只写一行「第 N 行格式有误」，原文收进「错误详情」；行号取自解析错误（同 PlotInjector tab-outline.js 的 errParts）。
// 解析库的报错是英文；大纲结构类错误是中文说明（无行号），直接显示说明。
const ERR_PREFIX = /^(?:YAML 格式错误(?:（第 \d+ 行）)?|第 \d+ 行)[：:]\s*/;
function errorNote(error, line) {
    const text = String(error || '');
    const no = line || Number((/第 (\d+) 行/.exec(text) || [])[1]) || 0;
    const detail = text.replace(ERR_PREFIX, '').trim();
    const syntax = Boolean(no) || /^[\x21-\x7e]/.test(detail);
    if (!syntax) return `<p class="pm-plot-err">${escapeHtml(detail)}</p>`;
    return `<p class="pm-plot-err">${no ? `第 ${no} 行格式有误` : '格式有误'}</p>${detail ? `<details class="pm-plot-err-detail"><summary>错误详情</summary><p>${escapeHtml(detail)}</p></details>` : ''}`;
}

// 一次写多卷的草稿：普通白卡，每卷一行（卷名 + 右侧状态）；只有格式错误的卷展开错误说明和操作，其余卷的原文与重写收进「⋯」。
// 有格式错误或仍在写作时不能追加；全部写完写「全部追加」，没写完写「追加已写完的 k 卷」。
function multiDraft(vm, draft) {
    const good = draft.items.filter(item => item.ok);
    const writing = Boolean(vm.multi);
    const rows = draft.items.map((item, i) => {
        const name = item.ok && item.volumes[0] ? volumeLabel(item.volumes[0].key) : '';
        const attrs = `data-plot-index="${i}"`;
        const title = `第 ${draft.volumeNo + i} 卷${name ? ` · ${escapeHtml(name)}` : ''}`;
        if (!item.ok) {
            return `<li class="pm-plot-multi-row is-error"><div class="pm-plot-multi-head"><b>${title}</b><small>格式错误</small></div>${errorNote(item.error, item.line)}
              <div class="pm-plot-card-actions">${btn('multi-fix', '让AI修正格式', { cls: 'pm-plot-chip is-ink', attrs, enabled: !vm.busy })}${btn('multi-edit', '手动改', { cls: 'pm-plot-chip', attrs })}${btn('multi-redo', '重写这一卷', { cls: 'pm-plot-chip', attrs, enabled: !vm.busy })}</div></li>`;
        }
        const stages = item.volumes.flatMap(volume => volume.stages.map(stage => stageLabel(stage.key))).join('、');
        const menu = renderMore(`multi:${i}`, [
            menuItem('multi-yaml', SEARCH_ICON_SVG, 'YAML原文', { attrs }),
            menuItem('multi-redo', REFRESH_ICON_SVG, '重写这一卷', { attrs, enabled: !vm.busy }),
        ], vm.openMenuId);
        return `<li class="pm-plot-multi-row"><div class="pm-plot-multi-head"><span class="pm-plot-row-text"><b>${title}</b>${stages ? `<small>${escapeHtml(stages)}</small>` : ''}</span><small>已解析</small>${menu}</div></li>`;
    }).join('');
    const pending = writing ? `<li class="pm-plot-multi-row is-pending"><div class="pm-plot-multi-head"><b>第 ${draft.volumeNo + draft.items.length} 卷</b><small class="is-live">写作中</small></div></li>` : '';
    const ready = good.length === draft.items.length && good.length > 0 && !writing;
    const partial = draft.items.length < draft.n;
    const append = btn('multi-append', partial ? `追加已写完的 ${good.length} 卷` : '全部追加', { cls: 'pm-plot-chip is-ink', enabled: ready && !vm.busy });
    return `<section class="pm-plot-block pm-plot-multi-card"><div class="pm-plot-block-head"><b>AI写的大纲</b><small>${good.length}/${draft.n} 卷</small></div>
      <ul class="pm-plot-multi pm-plot-rows">${rows}${pending}</ul>
      <div class="pm-plot-card-actions">${writing ? btn('multi-stop', `写作中 ${vm.multi.k}/${vm.multi.n}，停止`, { cls: 'pm-plot-chip is-ink' }) : append}${writing ? '' : btn('odraft-drop', '丢弃', { cls: 'pm-plot-chip' })}</div></section>`;
}

function outlineDraft(vm) {
    const draft = vm.outlineDraft;
    if (!draft) return '';
    if (draft.mode === 'multi') return multiDraft(vm, draft);
    const title = STAGE_DRAFT[draft.mode] || (draft.mode === 'rewrite' ? '改写后续阶段' : 'AI写的大纲');
    if (!draft.ok) {
        return `<section class="pm-plot-block is-draft"><div class="pm-plot-block-head"><b>${title}</b><small>格式错误</small></div>${errorNote(draft.error, draft.line)}
          <div class="pm-plot-card-actions">${btn('odraft-fix', '让AI修正格式', { cls: 'pm-plot-chip is-ink', enabled: !vm.busy })}${btn('odraft-edit', '手动改', { cls: 'pm-plot-chip' })}${btn('odraft-drop', '丢弃', { cls: 'pm-plot-chip' })}</div></section>`;
    }
    const summary = draft.volumes.map(volume => `${volumeLabel(volume.key)}：${volume.stages.map(stage => stageLabel(stage.key)).join('、')}`).join('\n');
    const actions = STAGE_DRAFT[draft.mode]
        ? btn('odraft-stage', '替换', { cls: 'pm-plot-chip is-ink' })
        : draft.mode === 'rewrite'
            ? btn('odraft-rest', '替换剩余阶段', { cls: 'pm-plot-chip is-ink' })
            : `${btn('odraft-new', draft.volumes.length > 1 ? `全部追加 ${draft.volumes.length} 卷` : '存为新卷', { cls: 'pm-plot-chip is-ink' })}${btn('odraft-append', '追加到最后一卷', { cls: 'pm-plot-chip', enabled: vm.viewed.outline.volumes.length > 0 })}`;
    return `<section class="pm-plot-block is-draft"><div class="pm-plot-block-head"><b>${title}</b><small>已解析</small></div><p>${escapeHtml(summary)}</p>
      <div class="pm-plot-card-actions">${actions}${btn('odraft-drop', '丢弃', { cls: 'pm-plot-chip' })}</div></section>`;
}

function stageMeta(stage) {
    const counts = NODE_FIELDS.map(meta => [meta.label, Array.isArray(stage.data?.[meta.field]) ? stage.data[meta.field].length : 0]).filter(([, count]) => count);
    return [String(stage.data?.时间范围 || '').trim(), ...counts.map(([label, count]) => `${label} ${count}`)].filter(Boolean).join(' · ');
}

// 大纲页顶部的三个面板开关：检查、总览、历史版本。再点一次回到卷与阶段。
function outlinePanels(vm) {
    const item = (key, label) => `<button type="button" class="pm-story-oracle-segment${vm.outlinePanel === key ? ' is-selected' : ''}" data-plot-action="outline-panel" data-plot-panel="${key}" aria-pressed="${vm.outlinePanel === key}">${label}</button>`;
    return `<div class="pm-story-oracle-segments pm-plot-panels" role="group" aria-label="大纲面板">${item('', '卷与阶段')}${item('check', '检查')}${item('overview', '总览')}${item('history', `历史 ${vm.viewed.outline.history.length}`)}</div>`;
}

function historyPanel(vm) {
    const list = vm.viewed.outline.history;
    if (!list.length) return '<p class="pm-story-oracle-empty is-inline">还没有历史版本。删除、恢复、AI替换等改动前的大纲会自动存在这里，最多10份。</p>';
    return `<ul class="pm-story-oracle-group pm-plot-rows">${list.map((item, i) => `<li class="pm-plot-hist"><div class="pm-plot-hist-head"><span class="pm-plot-row-text"><b>${escapeHtml(item.label ? `${item.label}前` : '历史版本')}</b><small>${escapeHtml(new Date(item.at).toLocaleString())} · ${item.text.length} 字</small></span>
        ${btn('hist-view', vm.historyAt === i ? '收起' : '预览', { cls: 'pm-plot-chip', attrs: `data-plot-index="${i}"` })}${btn('hist-restore', '恢复', { cls: 'pm-plot-chip is-ink', attrs: `data-plot-index="${i}"` })}</div>
        ${vm.historyAt === i ? `<pre class="pm-plot-pre">${escapeHtml(item.text)}</pre>` : ''}</li>`).join('')}</ul>`;
}

function checkPanel(vm) {
    const issues = outlineIssues(vm.viewed.outline.volumes);
    if (!issues.length) return '<p class="pm-story-oracle-empty is-inline">没有发现问题。</p>';
    return `<p class="pm-plot-line-label">${issues.length} 项</p><ul class="pm-story-oracle-group pm-plot-rows">${issues.map(item => `<li><button type="button" class="pm-plot-row" ${item.stageId ? `data-plot-action="open-stage" data-plot-stage="${escapeAttr(item.stageId)}"` : 'data-plot-action="outline-panel" data-plot-panel=""'}><span class="pm-plot-row-text"><b>${escapeHtml(item.text)}</b></span>${FORWARD_CHEVRON}</button></li>`).join('')}</ul>`;
}

function overviewPanel(vm) {
    const volumes = vm.viewed.outline.volumes;
    if (!volumes.length) return '<p class="pm-story-oracle-empty is-inline">还没有卷。</p>';
    const live = vm.viewed.id === vm.activeId;
    return volumes.map(volume => `<h4 class="pm-plot-vol">${escapeHtml(volumeLabel(volume.key))}</h4><ul class="pm-story-oracle-group pm-plot-rows">${volume.stages.map(stage => {
        const state = live ? vm.states[stage.id] : '';
        const names = mainNodeNames(stage.data);
        return `<li><button type="button" class="pm-plot-row pm-plot-ov${state === 'done' ? ' is-done' : ''}" data-plot-action="open-stage" data-plot-stage="${escapeAttr(stage.id)}"><span class="pm-plot-row-text"><b>${escapeHtml(stageLabel(stage.key))}</b>${names.length ? `<small>${escapeHtml(names.join(' → '))}</small>` : ''}</span>${state === 'active' ? '<span class="pm-story-oracle-pill is-active">进行中</span>' : ''}</button></li>`;
    }).join('') || '<li class="pm-plot-row-empty">这一卷还没有阶段</li>'}</ul>`).join('');
}

function outlineBody(vm) {
    if (vm.infinite) return renderInfiniteOutline(vm);
    const panel = vm.outlinePanel === 'check' ? checkPanel(vm) : vm.outlinePanel === 'overview' ? overviewPanel(vm) : vm.outlinePanel === 'history' ? historyPanel(vm) : '';
    const count = vm.viewed.outline.volumes.length;
    const volumes = vm.viewed.outline.volumes.map((volume, index) => {
        const attrs = `data-plot-vol="${escapeAttr(volume.id)}"`;
        const menu = renderMore(`vol:${volume.id}`, [
            menuItem('vol-rename', EDIT_ICON_SVG, '改卷名', { attrs }),
            menuItem('stage-add', PLUS_ICON_SVG, '加一个阶段', { attrs }),
            menuItem('vol-up', ROUTE_ICON_SVG, '上移', { attrs, enabled: index > 0 }),
            menuItem('vol-down', ROUTE_ICON_SVG, '下移', { attrs, enabled: index < count - 1 }),
            menuItem('vol-export', DOWNLOAD_ICON_SVG, '导出本卷', { attrs }),
            menuItem('vol-del', TRASH_ICON_SVG, '删除本卷', { attrs, danger: true }),
        ], vm.openMenuId);
        const rows = volume.stages.map(stage => {
            const active = vm.viewed.id === vm.activeId && vm.states[stage.id] === 'active';
            const meta = stageMeta(stage);
            return `<li><button type="button" class="pm-plot-row" data-plot-action="open-stage" data-plot-stage="${escapeAttr(stage.id)}"><span class="pm-plot-row-text"><b>${escapeHtml(stageLabel(stage.key))}</b>${meta ? `<small>${escapeHtml(meta)}</small>` : ''}</span>${active ? '<span class="pm-story-oracle-pill is-active">进行中</span>' : ''}${FORWARD_CHEVRON}</button></li>`;
        }).join('');
        return `<div class="pm-plot-vol-head"><h4 class="pm-plot-vol">${escapeHtml(volumeLabel(volume.key))}</h4>${menu}</div><ul class="pm-story-oracle-group pm-plot-rows">${rows || '<li class="pm-plot-row-empty">这一卷还没有阶段</li>'}</ul>`;
    }).join('');
    const empty = volumes ? '' : '<p class="pm-story-oracle-empty is-inline">还没有大纲。可以导入现成的YAML，或让AI按设定写大纲。</p>';
    // 操作键紧接在面板切换条下方（同执行页「操作键在时间线上方」），列表再长也不用滚到底找。
    const ops = `<div class="pm-plot-ops">${btn('outline-import', '导入YAML')}${btn('vol-add', '加一卷')}${btn('outline-ai', vm.busy === 'outline' ? '写作中…' : 'AI写大纲', { cls: 'pm-plot-op is-ink', enabled: !vm.busy })}</div>`;
    return `${outlineDraft(vm)}${outlinePanels(vm)}${panel ? '' : ops}${panel || `${volumes}${empty}`}`;
}

// AI 正在写设定或大纲时的细条，带停止键。
const busyText = vm => (vm.busy === 'setting' ? 'AI正在整理设定…' : vm.multi ? `AI正在写第 ${vm.multi.k}/${vm.multi.n} 卷…` : vm.busy === 'outline' ? 'AI正在写大纲…' : 'AI正在处理…');
const busyBar = vm => (vm.busy ? `<div class="pm-plot-busy" role="status"><span>${busyText(vm)}</span>${btn(vm.multi ? 'multi-stop' : 'stop', '停止', { cls: 'pm-plot-chip' })}</div>` : '');
export function renderPlotPage(vm) {
    const header = plotHeader(vm);
    if (!vm.ready) return { header, body: '<p class="pm-story-oracle-empty">正在读取剧情项目…</p>' };
    // 有项目但这个项目读不出来（文件丢失、网络失败）：给切换入口，不卡在空状态。
    if (!vm.viewed && vm.projectCount) {
        return { header, body: `${takeover(vm)}<button type="button" class="pm-plot-switch" data-plot-action="open-sheet" aria-haspopup="dialog"><b>选择项目</b>${CHEVRON_DOWN_ICON_SVG}<span>共 ${vm.projectCount} 个项目</span></button><p class="pm-story-oracle-empty is-inline">这个项目的文件读取失败，可以换一个项目，或在酒馆的 user/files 里检查 pi-p 开头的文件。</p>` };
    }
    if (!vm.viewed) {
        const body = `${takeover(vm)}<section class="pm-plot-card is-featured"><span class="pm-plot-card-kicker">${BOOK_ICON_SVG}<span>一条if线 = 一个项目</span></span><h3>先建一个项目</h3>
          <p class="pm-plot-card-note">写好设定和大纲后，聊天时会按大纲一段段引导，每几楼自动检测演到了哪里。</p>
          <div class="pm-plot-card-actions">${btn('import-project', '导入备份', { cls: 'pm-plot-chip' })}${btn('new-project', '新建项目', { cls: 'pm-plot-chip is-ink', enabled: vm.hasCard })}</div></section>
          ${vm.hasCard ? '' : '<p class="pm-story-oracle-empty is-inline">先打开一张角色卡的聊天，再新建项目。</p>'}
          <h3 class="pm-plot-subtitle">建好之后</h3><ul class="pm-story-oracle-group">
          <li class="pm-plot-step">${CHAT_ICON_SVG}<span><b>在剧情参谋里聊想法</b><small>原作、角色、基调，一句话也行</small></span></li>
          <li class="pm-plot-step">${BOOK_ICON_SVG}<span><b>AI整理成设定</b><small>也可以从世界书导入</small></span></li>
          <li class="pm-plot-step">${ROUTE_ICON_SVG}<span><b>AI写一卷大纲</b><small>或导入现成的YAML</small></span></li></ul>`;
        return { header, body };
    }
    const content = vm.tab === 'setting' ? settingBody(vm) : vm.tab === 'outline' ? outlineBody(vm) : progressBody(vm);
    const notices = vm.tab === 'progress' && vm.viewed.id === vm.activeId ? renderPlotNotices(vm.notices) : '';
    return { header, body: `${takeover(vm)}${projectSwitch(vm)}${plotTabs(vm)}${busyBar(vm)}${notices}<div class="pm-plot-tab" role="tabpanel">${content}</div>` };
}

// 节点列表里的玩法摘要：支线写条件、时限、步数，世界动态写进度钟格数。
function playNotes(kind, value) {
    if (kind === 'world') return clockSize(value) ? [`进度钟 ${clockSize(value)} 格`] : [];
    if (kind !== 'side') return [];
    const limit = hookLimit(value);
    const steps = hookSteps(value).length;
    return [hookCondition(value) ? '有条件' : '', limit ? (limit.volume ? '时限本卷' : `时限 ${limit.floors} 楼`) : '', steps ? `${steps} 步` : ''].filter(Boolean);
}

// 阶段详情：时间范围、AI指令、节点（按主线/支线/世界动态切换），可编辑。
export function renderPlotStage(vm) {
    const found = vm.stage;
    const back = `<button type="button" class="pm-story-oracle-icon-button" data-story-oracle-action="back" aria-label="返回" title="返回">${BACK_ICON_SVG}</button>`;
    if (!found) return { header: `<header class="pm-story-oracle-header is-sub">${back}<span></span><span class="pm-story-oracle-icon-spacer" aria-hidden="true"></span></header>`, body: '<p class="pm-story-oracle-empty">这个阶段已不存在。</p>' };
    const { volume, stage } = found;
    const menu = renderMore(`stage:${stage.id}`, [
        menuItem('stage-op', SPARKLES_ICON_SVG, '细化节点', { attrs: 'data-plot-op="refine"', enabled: !vm.busy }),
        menuItem('stage-op', SPARKLES_ICON_SVG, '拆成两段', { attrs: 'data-plot-op="split"', enabled: !vm.busy }),
        menuItem('stage-op', SPARKLES_ICON_SVG, '与下一段合并', { attrs: 'data-plot-op="merge"', enabled: !vm.busy && volume.stages[volume.stages.length - 1] !== stage }),
        menuItem('stage-rename', EDIT_ICON_SVG, '改阶段名'),
        menuItem('stage-raw', EDIT_ICON_SVG, '编辑YAML原文'),
        menuItem('stage-up', ROUTE_ICON_SVG, '上移', { enabled: volume.stages[0] !== stage }),
        menuItem('stage-down', ROUTE_ICON_SVG, '下移', { enabled: volume.stages[volume.stages.length - 1] !== stage }),
        menuItem('stage-move', FORWARD_ICON_SVG, '移到其他卷', { enabled: vm.viewed.outline.volumes.length > 1 }),
        menuItem('stage-del', TRASH_ICON_SVG, '删除阶段', { danger: true }),
    ], vm.openMenuId);
    const header = `<header class="pm-story-oracle-header is-sub">${back}<b class="pm-plot-stage-volume">${escapeHtml(volumeLabel(volume.key))}</b>${menu}</header>`;
    const state = vm.viewed.id === vm.activeId ? vm.states[stage.id] : '';
    const kind = NODE_FIELDS.some(meta => meta.kind === vm.nodeKind) ? vm.nodeKind : 'main';
    const meta = NODE_FIELDS.find(item => item.kind === kind);
    const list = Array.isArray(stage.data?.[meta.field]) ? stage.data[meta.field] : [];
    const off = new Set(state ? offNodes(vm.progress, { id: stage.id, stage }) : []);
    const nodes = list.map((item, index) => {
        const value = item && typeof item === 'object' ? item : { 内容: String(item ?? '') };
        const name = String(value.名称 || value.类型 || value.内容 || '').trim() || `${meta.label}${index + 1}`;
        const where = String(value.地点 || value.来源 || '').trim();
        const done = off.has(`${meta.prefix}${index}`);
        const notes = [where, ...playNotes(meta.kind, value), done ? '已演' : ''].filter(Boolean).join(' · ');
        return `<li><button type="button" class="pm-plot-row" data-plot-action="node-edit" data-plot-field="${escapeAttr(meta.field)}" data-plot-index="${index}"><span class="pm-story-oracle-point-icon">${done ? CHECK_ICON_SVG : FLAG_ICON_SVG}</span><span class="pm-plot-row-text"><small>${escapeHtml(notes)}</small><b>${escapeHtml(name)}</b></span></button></li>`;
    }).join('');
    const kinds = `<div class="pm-story-oracle-segments" role="group" aria-label="节点类型">${NODE_FIELDS.map(item => {
        const count = Array.isArray(stage.data?.[item.field]) ? stage.data[item.field].length : 0;
        return `<button type="button" class="pm-story-oracle-segment${item.kind === kind ? ' is-selected' : ''}" data-plot-action="node-kind" data-plot-kind="${item.kind}" aria-pressed="${item.kind === kind}">${item.label} ${count}</button>`;
    }).join('')}</div>`;
    const body = `<article class="pm-story-oracle-detail">
      ${state ? `<span class="pm-story-oracle-pill${state === 'active' ? ' is-active' : ''}">${STATE_LABELS[state]}</span>` : ''}
      <h2>${escapeHtml(stageLabel(stage.key))}</h2>
      <section class="pm-story-oracle-field"><div class="pm-story-oracle-section-head"><h3>时间范围</h3>${btn('stage-field', '编辑', { cls: 'pm-story-oracle-link', attrs: 'data-plot-field="时间范围"' })}</div><p class="pm-story-oracle-quote">${escapeHtml(stage.data?.时间范围 || '（未填）')}</p></section>
      <section class="pm-story-oracle-field"><div class="pm-story-oracle-section-head"><h3>AI指令</h3>${btn('stage-field', '编辑', { cls: 'pm-story-oracle-link', attrs: 'data-plot-field="AI指令"' })}</div><p class="pm-story-oracle-quote">${escapeHtml(stage.data?.AI指令 || '（未填）')}</p></section>
      <section class="pm-story-oracle-field"><div class="pm-story-oracle-section-head"><h3>状态变化</h3>${btn('stage-field', '编辑', { cls: 'pm-story-oracle-link', attrs: `data-plot-field="${CHANGE_FIELD}"` })}</div><p class="pm-story-oracle-quote">${escapeHtml(changeLines(stage.data).join('\n') || '（未填）')}</p></section>
      <section class="pm-story-oracle-field"><div class="pm-story-oracle-section-head"><h3>节点</h3>${btn('node-add', '加一个', { cls: 'pm-story-oracle-link', attrs: `data-plot-field="${escapeAttr(meta.field)}" data-plot-kind="${kind}"` })}</div>${kinds}
        ${nodes ? `<ul class="pm-story-oracle-group pm-plot-rows">${nodes}</ul>` : `<p class="pm-story-oracle-empty is-inline">没有${meta.label}节点。</p>`}</section>
    </article>`;
    const footer = `<div class="pm-story-oracle-actions">${btn('stage-goto', '设为当前段', { cls: 'pm-action-button is-secondary', enabled: vm.viewed.id === vm.activeId && state !== 'active' })}${btn('stage-discuss', '在对话里讨论', { cls: 'pm-action-button is-accent' })}</div>`;
    return { header, body, footer };
}
// 项目面板：点一行打开该项目，长按（电脑右键）进这一项的菜单。
export function renderPlotSheet(vm) {
    if (!vm.sheet) return '';
    let inner;
    const menuProject = vm.sheet.menuId ? vm.projects.find(item => item.id === vm.sheet.menuId) : null;
    if (menuProject) {
        const isChat = menuProject.id === vm.activeId;
        const isCard = menuProject.id === vm.cardDefaultId;
        inner = `<div class="pm-plot-sheet-head"><button type="button" class="pm-story-oracle-icon-button" data-plot-action="sheet-back" aria-label="返回" title="返回">${BACK_ICON_SVG}</button><b>${escapeHtml(menuProject.name)}</b><span class="pm-story-oracle-icon-spacer" aria-hidden="true"></span></div>
          <div class="pm-plot-sheet-menu" role="menu">
            ${menuItem('project-use-chat', CHAT_ICON_SVG, isChat ? '已是当前聊天使用' : '设为当前聊天使用', { attrs: `data-plot-id="${escapeAttr(menuProject.id)}"`, enabled: !isChat && vm.hasCard })}
            ${menuItem('project-use-card', BOOK_ICON_SVG, isCard ? '已是本卡默认' : '设为本卡默认（新聊天也用）', { attrs: `data-plot-id="${escapeAttr(menuProject.id)}"`, enabled: !isCard && vm.hasCard })}
            ${menuItem('project-rename', EDIT_ICON_SVG, '改名、分组', { attrs: `data-plot-id="${escapeAttr(menuProject.id)}"` })}
            ${menuItem('project-export', DOWNLOAD_ICON_SVG, '导出备份', { attrs: `data-plot-id="${escapeAttr(menuProject.id)}"` })}
            ${menuItem('project-delete', TRASH_ICON_SVG, '删除项目', { attrs: `data-plot-id="${escapeAttr(menuProject.id)}"`, danger: true })}
          </div>`;
    } else {
        const groups = vm.groups.map(group => `${group.name ? `<h4 class="pm-plot-sheet-group">${escapeHtml(group.name)}</h4>` : vm.groups.length > 1 ? '<h4 class="pm-plot-sheet-group">未分组</h4>' : ''}
          ${group.items.map(item => {
        const badges = [item.id === vm.activeId ? '当前聊天' : '', item.id === vm.cardDefaultId && item.id !== vm.activeId ? '本卡默认' : ''].filter(Boolean);
        return `<button type="button" class="pm-plot-sheet-item${item.id === vm.viewed?.id ? ' is-selected' : ''}" data-plot-action="sheet-pick" data-plot-id="${escapeAttr(item.id)}" title="长按或右键：设为当前、改名、导出、删除"><span class="pm-story-oracle-seal">${escapeHtml(firstChar(item.name))}</span><span class="pm-plot-row-text"><b>${escapeHtml(item.name)}</b><small>${escapeHtml(item.updatedAt ? new Date(item.updatedAt).toLocaleDateString() : '')}</small></span>${badges.map(text => `<span class="pm-story-oracle-pill">${text}</span>`).join('')}</button>`;
    }).join('')}`).join('');
        inner = `<div class="pm-plot-sheet-head"><b>选择项目</b><span class="pm-plot-sheet-links">${btn('import-project', '导入', { cls: 'pm-story-oracle-link' })}${btn('new-project', `${PLUS_ICON_SVG}<span>新建</span>`, { cls: 'pm-story-oracle-link', enabled: vm.hasCard })}</span></div>
          <div class="pm-plot-sheet-list">${groups || '<p class="pm-story-oracle-empty">还没有项目。</p>'}</div>`;
    }
    return `<div class="pm-story-oracle-sheet-layer pm-plot-sheet-layer"><button type="button" class="pm-story-oracle-scrim" data-plot-action="sheet-close" aria-label="关闭项目面板" tabindex="-1"></button><div class="pm-story-oracle-sheet" role="dialog" aria-label="选择项目">${inner}</div></div>`;
}

// 设置页里的「剧情检测」「模型接口」两组。
export function renderPlotSettings(vm) {
    const s = vm.settings;
    const row = (action, label, value) => `<li><button type="button" class="pm-plot-row" data-plot-action="${action}"><span class="pm-plot-row-text"><b>${label}</b></span><span class="pm-plot-row-value">${escapeHtml(value)}</span>${FORWARD_CHEVRON}</button></li>`;
    const toggle = `<li class="pm-plot-toggle-row"><span class="pm-story-oracle-row-label">没演的支线延续到下一段</span><button type="button" class="pm-custom-check${s.carryOver ? ' is-checked' : ''}" role="switch" aria-checked="${s.carryOver}" aria-label="没演的支线延续到下一段" data-plot-action="set-carry"></button></li>`;
    const routes = vm.routes.map(route => `<li><button type="button" class="pm-plot-row" data-plot-action="open-api"><span class="pm-plot-row-text"><b>${route.label}</b></span><span class="pm-plot-row-value">${escapeHtml(route.value)}</span>${FORWARD_CHEVRON}</button></li>`).join('');
    return `<section class="pm-story-oracle-field"><div class="pm-story-oracle-section-head"><h3>剧情检测</h3></div><ul class="pm-story-oracle-group pm-plot-rows">
        ${row('set-every', '每几楼检测一次', `${s.checkEvery} 楼`)}${row('set-floors', '每次读最近几楼', `${s.checkFloors} 楼`)}
        ${row('set-handle', '阶段演完后', HANDLE_LABELS[s.handleMode])}${row('set-off', '偏离大纲时', OFF_LABELS[s.offTrackMode])}${toggle}
        ${row('set-hookcap', '同时注入的激活支线', `${s.hookCap ?? 2} 条`)}${row('set-newthread', '正文出现大纲外的新线时', THREAD_LABELS[s.newThreadMode] || THREAD_LABELS.ask)}</ul></section>
      <section class="pm-story-oracle-field"><div class="pm-story-oracle-section-head"><h3>模型接口</h3>${btn('open-api', '在「API按模块分配」改', { cls: 'pm-story-oracle-link' })}</div><ul class="pm-story-oracle-group pm-plot-rows">${routes}</ul></section>`;
}

// 「更多」二级页里剧情注入器自己的几项：写作基准、导出导入、诊断。
export function renderPlotPrefs(vm) {
    return `<section class="pm-story-oracle-field"><div class="pm-story-oracle-section-head"><h3>写作基准</h3>${btn('guide-edit', '编辑', { cls: 'pm-story-oracle-link' })}</div><p class="pm-story-oracle-quote">${escapeHtml(vm.guideCustom ? vm.settings.guide : '当前使用：内置版本')}</p></section>
      <section class="pm-story-oracle-field"><div class="pm-story-oracle-section-head"><h3>剧情项目</h3></div><ul class="pm-story-oracle-group pm-plot-rows">
        ${`<li><button type="button" class="pm-plot-row" data-plot-action="import-project"><span class="pm-plot-row-text"><b>导入项目备份</b></span>${FORWARD_CHEVRON}</button></li>`}
        ${`<li><button type="button" class="pm-plot-row" data-plot-action="diagnose"><span class="pm-plot-row-text"><b>诊断</b><small>为什么没有自动检测、最近的检测记录</small></span>${FORWARD_CHEVRON}</button></li>`}</ul></section>`;
}
