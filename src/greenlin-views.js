// 格林推演页面模板：只按视图模型输出 HTML，不读写存储、不碰宿主 API。版式复用金手指（pm-origin-*），少量自有版面在 styles/greenlin.css。
// 内容全部只读；未公开（hidden / limited）的人物与伏线默认折叠，点开后原位展开并带「未公开」小字。
import { appNameOf, appSloganOf } from './app-names.js';
import { CHEVRON_DOWN_ICON_SVG, GREENLIN_APP_ICON_SVG, HOME_ICON_SVG, PLUG_ICON_SVG, REFRESH_ICON_SVG } from './icons.js';
import {
    GREENLIN_TABS, SEED_DOT_COUNT, SEED_STATUS_LABELS, RUMOR_STATUS_LABELS, seedDeadlineText,
} from './greenlin-model.js';
import { escapeAttr as rawAttr, escapeHtml as rawHtml } from './ui.js';

const esc = value => rawHtml(String(value ?? ''));
const attr = value => rawAttr(String(value ?? ''));
const act = (action, extra = '') => `data-gl-action="${action}"${extra ? ` ${extra}` : ''}`;
const iconButton = (action, label, svg) => `<button type="button" class="pm-origin-icon-button" ${act(action)} aria-label="${attr(label)}" title="${attr(label)}">${svg}</button>`;

const NEW_MARK = '<i class="pm-gl-new">新</i>';
const HIDDEN_MARK = '<span class="pm-gl-mark">未公开</span>';

function header(title, sub, { refresh = true } = {}) {
    return `<header class="pm-origin-header"><div class="pm-origin-header-text"><h2>${esc(title)}</h2><small>${esc(sub)}</small></div>${refresh ? iconButton('refresh', '刷新', REFRESH_ICON_SVG) : ''}${iconButton('desktop', '返回桌面', HOME_ICON_SVG)}</header>`;
}

function tabbar(active) {
    return `<nav class="pm-origin-tabbar" aria-label="${attr(appNameOf('greenlin'))}"><div class="pm-origin-tabs" role="tablist">${GREENLIN_TABS.map(tab => `<button type="button" role="tab" class="pm-origin-tab" ${act('tab', `data-tab="${tab.id}"`)} aria-selected="${tab.id === active}">${esc(tab.label)}</button>`).join('')}</div></nav>`;
}

const groupHead = (title, count) => `<div class="pm-origin-group-head"><h3>${esc(title)}${count === undefined ? '' : ` · ${count}`}</h3></div>`;
const side = (html, cls = '') => (html ? `<span class="pm-origin-row-side pm-gl-side${cls}">${html}</span>` : '');
function row(name, small, sideHtml = '', { gone = false, extraSmall = '' } = {}) {
    return `<div class="pm-origin-row${gone ? ' pm-gl-gone' : ''}"><div class="pm-origin-row-head"><div class="pm-origin-row-main"><b>${name}</b>${small ? `<small>${esc(small)}</small>` : ''}${extraSmall}</div>${sideHtml}</div></div>`;
}
const kv = (key, value) => (value ? `<p class="pm-origin-kv"><span>${esc(key)}</span>${esc(value)}</p>` : '');
const dots = (count, cls = '') => `<span class="pm-gl-dots${cls}" role="img" aria-label="阶段 ${count} / ${SEED_DOT_COUNT}">${Array.from({ length: SEED_DOT_COUNT }, (_, i) => `<i class="pm-gl-dot${i < count ? ' is-on' : ''}"></i>`).join('')}</span>`;
const emptyNote = textValue => `<p class="pm-origin-empty">${esc(textValue)}</p>`;

// 未公开折叠行：放在分组末尾；展开状态只在本次打开期间保持。
function foldRow(key, count, open) {
    const label = open ? `收起未公开的 ${count} 条` : `另有 ${count} 条未公开`;
    return `<button type="button" class="pm-origin-link pm-gl-fold" ${act('fold', `data-fold="${key}"`)} aria-expanded="${open}"><span>${esc(label)}</span>${CHEVRON_DOWN_ICON_SVG}</button>`;
}
function hiddenBlock(key, items, ui, render) {
    if (!items.length) return '';
    const open = ui.open[key] === true;
    return `${foldRow(key, items.length, open)}${open ? `<div class="pm-origin-list">${items.map(render).join('')}</div>` : ''}`;
}

// ---- 总览 ----
function overviewPage(view) {
    const parts = view.latestParts;
    const title = parts ? parts.title : '暂无纪要';
    const desc = parts?.rest ? `<p class="pm-origin-hero-desc">${esc(parts.rest)}</p>` : '';
    const hero = `<section class="pm-origin-hero"><div class="pm-origin-hero-head"><div class="pm-origin-hero-top"><span>${esc(view.timeLine)}</span><span>${view.changes > 0 ? `${view.changes} 处变化` : '暂无变化'}</span></div><b class="pm-gl-title">${esc(title)}</b></div>${desc}</section>`;
    const dims = view.dims.length ? `${groupHead('局势')}<div class="pm-origin-row pm-gl-dims">${view.dims.map(dim => {
        const mark = dim.delta > 0 ? `<em class="is-up">↑${dim.delta}</em>` : dim.delta < 0 ? `<em>↓${-dim.delta}</em>` : '<em></em>';
        return `<div class="pm-gl-dim"><span>${esc(dim.name)}</span><progress class="pm-origin-bar" max="100" value="${dim.value}"></progress><b>${dim.value}</b>${mark}</div>`;
    }).join('')}</div>` : '';
    const signals = view.signals.length ? `${groupHead('场外信号')}<div class="pm-origin-list">${view.signals.map(item => row(esc(item.text), '', side(esc(item.label)))).join('')}</div>` : '';
    return `${hero}${dims}${signals}`;
}

// ---- 人物 ----
function actorSmall(actor) {
    if (actor.life === 'missing') return actor.location ? `最后出现在${actor.location}` : '下落不明';
    if (actor.life === 'dead') return actor.deathSummary || (actor.diedAtDay ? `第 ${actor.diedAtDay} 日离世` : '');
    return [actor.location, actor.action].filter(Boolean).join(' · ');
}
function actorRow(actor) {
    const status = actor.life === 'missing' ? '<span class="pm-gl-accent">失踪</span>' : actor.life === 'dead' ? '已故' : '';
    return row(esc(actor.name), actorSmall(actor), side(`${status}${actor.hidden ? HIDDEN_MARK : ''}`), { gone: actor.life === 'dead' });
}
function actorsPage(view, ui) {
    const hero = view.heroActor;
    let heroHtml = '';
    if (hero) {
        const where = [hero.name, hero.location].filter(Boolean).join(' · ');
        heroHtml = `<section class="pm-origin-hero"><div class="pm-origin-hero-head"><div class="pm-origin-hero-top"><span>${esc(where)}</span><span>${[view.heroUpdated ? '行动更新' : '', hero.hidden ? '未公开' : ''].filter(Boolean).join(' · ')}</span></div><b class="pm-gl-title">${esc(hero.action || '暂无当前行动')}</b></div>${kv('长期', hero.longTerm)}${kv('上一步', hero.previous)}</section>`;
    }
    const others = view.actors.filter(actor => actor !== hero);
    const open = others.filter(actor => !actor.hidden);
    const hidden = others.filter(actor => actor.hidden);
    const list = open.length ? `<div class="pm-origin-list">${open.map(actorRow).join('')}</div>` : (hero || hidden.length ? '' : emptyNote('推演里还没有人物'));
    return `${heroHtml}${open.length || (!hero && !hidden.length) ? groupHead(hero ? '其他人物' : '人物', open.length) : ''}${list}${hiddenBlock('actors', hidden, ui, actorRow)}`;
}

// ---- 暗线 ----
function seedRow(seed) {
    const right = seed.closed ? esc(SEED_STATUS_LABELS[seed.status]) : dots(seed.stage);
    return row(esc(seed.title), seed.catalyst, side(`${right}${seed.hidden ? HIDDEN_MARK : ''}`), { gone: seed.closed });
}
function rumorRow(rumor) {
    const small = [RUMOR_STATUS_LABELS[rumor.status], rumor.channels.join('、')].filter(Boolean).join(' · ');
    return row(`「${esc(rumor.fact)}」${rumor.isNew ? NEW_MARK : ''}`, small, '', { gone: rumor.status === 'dead' });
}
function seedsPage(view, ui) {
    const hero = view.heroSeed;
    let heroHtml = '';
    if (hero) {
        const desc = hero.catalyst ? `<p class="pm-origin-hero-desc">${esc(hero.catalyst)}</p>` : '';
        heroHtml = `<section class="pm-origin-hero"><div class="pm-origin-hero-head"><div class="pm-origin-hero-top"><span>${esc(SEED_STATUS_LABELS[hero.status])}</span><span>${esc([seedDeadlineText(hero), hero.hidden ? '未公开' : ''].filter(Boolean).join(' · '))}</span></div><b class="pm-gl-title">${esc(hero.title)}</b></div>${desc}${dots(hero.stage)}</section>`;
    }
    const others = view.seeds.filter(seed => seed !== hero).sort((a, b) => Number(a.closed) - Number(b.closed));
    const open = others.filter(seed => !seed.hidden);
    const hidden = others.filter(seed => seed.hidden);
    const list = open.length ? `<div class="pm-origin-list">${open.map(seedRow).join('')}</div>` : (hero || hidden.length ? '' : emptyNote('推演里还没有伏线'));
    const rumors = view.rumors.length ? `${groupHead('风声')}<div class="pm-origin-list">${view.rumors.map(rumorRow).join('')}</div>` : '';
    return `${heroHtml}${open.length || (!hero && !hidden.length) ? groupHead(hero ? '其他伏线' : '伏线', open.length) : ''}${list}${hiddenBlock('seeds', hidden, ui, seedRow)}${rumors}`;
}

// ---- 纪要 ----
function logPage(view) {
    if (!view.chronicle.length) return emptyNote('还没有纪要');
    return `<div class="pm-origin-list">${view.chronicle.map(entry => row(`${esc(entry.summary)}${entry.isNew ? NEW_MARK : ''}`, entry.at, '', { extraSmall: entry.missed ? `<small>错过了：${esc(entry.missed)}</small>` : '' })).join('')}</div>`;
}

const PAGES = { overview: overviewPage, actors: actorsPage, seeds: seedsPage, log: logPage };

function pageHeader(tab, view) {
    if (tab === 'actors') {
        const { alive, missing, dead } = view.counts;
        if (!alive && !missing && !dead) return header('人物', '暂无公开人物');
        return header('人物', [`${alive} 人在世`, missing ? `${missing} 人失踪` : '', dead ? `${dead} 人已故` : ''].filter(Boolean).join(' · '));
    }
    if (tab === 'seeds') return header('暗线', `${view.counts.seeds} 条伏线 · ${view.counts.rumors} 则风声`);
    if (tab === 'log') return header('纪要', `共 ${view.chronicle.length} 条${view.newChronicle ? ` · 本次新增 ${view.newChronicle} 条` : ''}`);
    return header(appNameOf('greenlin'), view.subtitle);
}

// 空状态：未检测到数据库插件与当前聊天没有推演共用一版式，前者带「重新检测」。
function emptyView(ui) {
    const missing = ui.mode === 'noapi';
    const title = missing ? '未检测到数据库插件' : '当前聊天还没有推演';
    const note = missing ? '安装并启用后重新打开即可。' : '在数据库插件里完成一次格林推演后，这里会显示最新一轮的结果。';
    const button = missing ? `<button type="button" class="pm-origin-op is-main" ${act('detect')}>重新检测</button>` : '';
    return `${header(appNameOf('greenlin'), appSloganOf('greenlin'), { refresh: !missing })}<div class="pm-origin-scroll pm-gl-scroll-empty"><section class="pm-origin-intro pm-gl-empty"><span class="pm-origin-blank-art" aria-hidden="true">${missing ? PLUG_ICON_SVG : GREENLIN_APP_ICON_SVG}</span><h3>${esc(title)}</h3><p>${esc(note)}</p>${button}</section></div>`;
}

// ui：{ mode: 'ok' | 'noapi' | 'noledger', tab, open: { actors, seeds }, view }
export function renderGreenlinPage(ui) {
    if (ui.mode !== 'ok' || !ui.view) return `<div class="pm-origin-shell pm-gl-shell">${emptyView(ui)}</div>`;
    const tab = Object.hasOwn(PAGES, ui.tab) ? ui.tab : 'overview';
    return `<div class="pm-origin-shell pm-gl-shell">${pageHeader(tab, ui.view)}<div class="pm-origin-scroll" data-gl-tab="${tab}">${PAGES[tab](ui.view, ui)}</div>${tabbar(tab)}</div>`;
}
