// 剧情助手里无限流项目的页面模板：进度页换成「执行」卡，大纲页换成世界库。只按视图模型输出 HTML，不新增样式，全部沿用 pm-plot-* 现有类。
// 数据与动作在 story-plot-infinite.js。
import { FORWARD_ICON_SVG } from './icons.js';
import { escapeAttr as rawEscapeAttr, escapeHtml as rawEscapeHtml } from './ui.js';
import { HUB_WORD_KEYS, POOL_KEYS, POOL_LABELS, blankedWordKeys, findWorld, phaseLabels, resolveHub } from './plot-injector/core/infinite.js';
import { describeRead } from './plot-injector/core/infinite-state.js';
import { worldSpecText } from './plot-injector/core/infinite-world.js';

const escapeHtml = value => rawEscapeHtml(value == null ? '' : String(value));
const escapeAttr = value => rawEscapeAttr(value == null ? '' : String(value));
const CHEVRON = `<span class="pm-plot-chevron" aria-hidden="true">${FORWARD_ICON_SVG}</span>`;
const btn = (action, label, { cls = 'pm-plot-op', attrs = '', enabled = true } = {}) => `<button type="button" class="${cls}" data-plot-action="${action}" ${attrs} ${enabled ? '' : 'disabled'}>${label}</button>`;
const WORD_TITLES = Object.freeze({ back: '返回', depart: '出发', away: '在副本里', hub: '在主空间' });

const row = (action, title, meta, attrs = '', pill = '') => `<li><button type="button" class="pm-plot-row" data-plot-action="${action}" ${attrs}><span class="pm-plot-row-text"><b>${escapeHtml(title)}</b>${meta ? `<small>${escapeHtml(meta)}</small>` : ''}</span>${pill}${CHEVRON}</button></li>`;
const clip = (text, size = 40) => {
    const flat = String(text || '').replace(/\s+/g, ' ').trim();
    return flat.length > size ? `${flat.slice(0, size)}…` : flat;
};

// 进度页：当前在主空间还是世界里、上次读到的状态块、两个手动按钮。
export function renderInfiniteProgress(vm) {
    const state = vm.infState;
    if (!state) return '<p class="pm-story-oracle-empty is-inline">正在读取进度…</p>';
    const { inf, infinite } = state;
    const cfg = infinite.config;
    const hubName = resolveHub(cfg).hubName;
    const labels = phaseLabels(cfg);
    const world = inf.phase === 'world' ? findWorld(inf.worlds, inf.worldId) : null;
    const blanked = blankedWordKeys(cfg);
    const note = blanked.length ? `<p class="pm-plot-card-note">${escapeHtml(blanked.map(key => WORD_TITLES[key]).join('、'))}的词被清空，现按默认词读取。</p>` : '';
    const log = inf.log.length ? `<section class="pm-plot-block"><div class="pm-plot-block-head"><b>近期记录</b></div><p>${escapeHtml(inf.log.slice().reverse().join('\n'))}</p></section>` : '';
    return `<section class="pm-plot-card is-featured"><h3>${escapeHtml(world ? `${labels.world}「${world.title}」` : labels.train)}</h3>
      <p class="pm-plot-card-note">${escapeHtml(describeRead(vm.infRead, cfg))}</p>
      <div class="pm-plot-card-meta"><span>世界库 ${inf.worlds.length} 份</span><span>${vm.infOpening ? '正在造世界…' : ''}</span></div>${note}
      <div class="pm-plot-card-actions">${btn('inf-enter', vm.infOpening ? '造世界中…' : '进入新世界', { cls: 'pm-plot-chip is-ink', enabled: inf.phase === 'train' && !vm.infOpening })}${btn('inf-return', `回到${escapeHtml(hubName)}`, { cls: 'pm-plot-chip', enabled: inf.phase === 'world' })}</div></section>${log}`;
}

function worldRows(vm) {
    const state = vm.infState;
    if (!state) return '';
    const { inf } = state;
    const currentId = inf.phase === 'world' ? inf.worldId : '';
    if (!inf.worlds.length) return '<p class="pm-story-oracle-empty is-inline">这条聊天里还没有世界。到「进度」页点「进入新世界」，或等正文状态块写出停站。</p>';
    return `<ul class="pm-story-oracle-group pm-plot-rows">${[...inf.worlds].reverse().map(world => {
        const open = vm.infOpenWorld === world.id;
        const pill = world.id === currentId ? '<span class="pm-story-oracle-pill is-active">当前</span>' : '';
        const head = row('world-open', world.title, `${world.dice.horror}｜${world.dice.client}`, `data-plot-id="${escapeAttr(world.id)}"`, pill);
        if (!open) return head;
        const detail = `<li class="pm-plot-row-empty"><p class="pm-plot-card-note">${escapeHtml(`${world.dice.horror}｜周期 ${world.dice.cycle}｜${world.dice.client}｜情欲${world.dice.lust}`)}</p><p>${escapeHtml(world.body)}</p>
          <div class="pm-plot-card-actions">${btn('world-reopen', '重新打开', { cls: 'pm-plot-chip is-ink', attrs: `data-plot-id="${escapeAttr(world.id)}"`, enabled: inf.phase === 'train' })}${btn('world-del', '删除', { cls: 'pm-plot-chip', attrs: `data-plot-id="${escapeAttr(world.id)}"` })}</div></li>`;
        return `${head}${detail}`;
    }).join('')}</ul>`;
}

function hubRows(infinite) {
    const cfg = infinite.config;
    const hubName = resolveHub(cfg).hubName;
    const wordTitle = key => ({ back: `返回${hubName}`, depart: '出发', away: '在副本里', hub: `在${hubName}` })[key];
    return `<ul class="pm-story-oracle-group pm-plot-rows">${[
        row('hub-edit', '主空间名称', cfg.hubName, 'data-plot-field="hubName"'),
        row('hub-edit', '状态块标签', cfg.blockTag, 'data-plot-field="blockTag"'),
        row('hub-edit', '栏名', clip(cfg.fieldNames.join('、')), 'data-plot-field="fieldNames"'),
        ...HUB_WORD_KEYS.map(key => row('hub-edit', wordTitle(key), clip(cfg.words[key].join('、')) || '已清空，按默认词读取', `data-plot-field="${key}"`)),
    ].join('')}</ul>`;
}

// 大纲页：世界库、骰池、造世界规范、写法条目前缀、主空间参数卡。
export function renderInfiniteOutline(vm) {
    const infinite = vm.infConfig;
    const state = vm.infState;
    const library = vm.viewed.id !== vm.activeId
        ? '<p class="pm-story-oracle-empty is-inline">世界库随聊天保存。把这个项目设为当前聊天使用后，才能看到这条聊天里的世界。</p>'
        : worldRows(vm);
    const count = state ? `${state.inf.worlds.length} 份` : '';
    return `<h4 class="pm-plot-vol">世界库${count ? ` · ${escapeHtml(count)}` : ''}</h4>${library}
      <h4 class="pm-plot-vol">骰池</h4><p class="pm-plot-card-note">每行「名称|权重」。情欲浓度写进档案末尾，由代码决定。</p>
      <ul class="pm-story-oracle-group pm-plot-rows">${POOL_KEYS.map(key => row('pool-edit', POOL_LABELS[key], `${infinite.pools[key].length} 项`, `data-plot-field="${key}"`)).join('')}</ul>
      <h4 class="pm-plot-vol">造世界规范</h4>
      <ul class="pm-story-oracle-group pm-plot-rows">${row('spec-edit', '规范全文', infinite.spec.trim() ? clip(worldSpecText(infinite)) : '默认规范')}</ul>
      <h4 class="pm-plot-vol">恐怖类型写法</h4><p class="pm-plot-card-note">开副本时按「前缀 + 恐怖类型」到角色卡世界书里找同标题的条目，关闭的也能读到。正文放进造世界提示，不进正文注入。</p>
      <ul class="pm-story-oracle-group pm-plot-rows">${row('prefix-edit', '条目标题前缀', infinite.config.horrorPrefix)}</ul>
      <h4 class="pm-plot-vol">主空间</h4><p class="pm-plot-card-note">正文末尾状态块的写法。每组词一行一个，靠前的优先匹配，第一个词用作显示名；清空某组则按默认词读取。</p>
      ${hubRows(infinite)}
      <div class="pm-plot-ops">${btn('hub-reset', '恢复主空间默认')}${btn('spec-reset', '恢复默认规范', { enabled: Boolean(infinite.spec.trim()) })}</div>`;
}
