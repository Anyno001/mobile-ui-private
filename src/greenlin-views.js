// 格林推演页面模板：只按视图模型输出 HTML，不读写存储、不碰宿主 API。版式复用金手指（pm-origin-*），少量自有版面在 styles/greenlin.css。
// 内容全部只读，账本由 AI 生成，一律转义后再进 HTML。折叠与展开只记在本次打开的 ui.open 里；未公开的人物与伏线默认折叠。
import { appNameOf, appSloganOf } from './app-names.js';
import {
    CHEVRON_DOWN_ICON_SVG, GL_CHART_ICON_SVG, GL_CHAT_ICON_SVG, GL_CHECK_ICON_SVG, GL_CITY_ICON_SVG, GL_EVENT_ICON_SVG, GL_GLOBE_DECO_ICON_SVG, GL_LOCK_ICON_SVG, GL_PHONE_ICON_SVG,
    GL_WORK_ICON_SVG, GREENLIN_APP_ICON_SVG, HOME_ICON_SVG, PLUG_ICON_SVG, REFRESH_ICON_SVG,
} from './icons.js';
import {
    DOT_COUNT, EVENT_STATUS_LABELS, GREENLIN_TABS, RUMOR_STATUS_LABELS, SEED_STATUS_LABELS, sealChar,
} from './greenlin-model.js';
import { escapeAttr as rawAttr, escapeHtml as rawHtml } from './ui.js';

const esc = value => rawHtml(String(value ?? ''));
const attr = value => rawAttr(String(value ?? ''));
const act = (action, extra = '') => `data-gl-action="${action}"${extra ? ` ${extra}` : ''}`;
const iconButton = (action, label, svg) => `<button type="button" class="pm-origin-icon-button" ${act(action)} aria-label="${attr(label)}" title="${attr(label)}">${svg}</button>`;

const NEW_MARK = '<i class="pm-gl-new">新</i>';
const UPDATE_MARK = '<i class="pm-gl-new">更新</i>';
const HIDDEN_MARK = '<span class="pm-gl-mark">未公开</span>';

function header(title, sub, { refresh = true } = {}) {
    return `<header class="pm-origin-header"><div class="pm-origin-header-text"><h2>${esc(title)}</h2><small>${esc(sub)}</small></div>${refresh ? iconButton('refresh', '刷新', REFRESH_ICON_SVG) : ''}${iconButton('desktop', '返回桌面', HOME_ICON_SVG)}</header>`;
}

function tabbar(active) {
    return `<nav class="pm-origin-tabbar" aria-label="${attr(appNameOf('greenlin'))}"><div class="pm-origin-tabs" role="tablist">${GREENLIN_TABS.map(tab => `<button type="button" role="tab" class="pm-origin-tab" ${act('tab', `data-tab="${tab.id}"`)} aria-selected="${tab.id === active}">${esc(tab.label)}</button>`).join('')}</div></nav>`;
}

const groupHead = (title, sideText = '') => `<div class="pm-origin-group-head"><h3>${esc(title)}</h3>${sideText ? `<span class="pm-gl-group-side">${esc(sideText)}</span>` : ''}</div>`;
const side = (html, cls = '') => (html ? `<span class="pm-origin-row-side pm-gl-side${cls}">${html}</span>` : '');
const kv = (key, value) => (value ? `<p class="pm-origin-kv"><span>${esc(key)}</span>${esc(value)}</p>` : '');
const dots = (count, label) => `<span class="pm-gl-dots" role="img" aria-label="${attr(`${label} ${count} / ${DOT_COUNT}`)}">${Array.from({ length: DOT_COUNT }, (_, i) => `<i class="pm-gl-dot${i < count ? ' is-on' : ''}"></i>`).join('')}</span>`;
// 装饰：事件分类图标圆、姓氏圆章、地球仪（主卡右下角，只用在世界页主卡）。
const EVENT_ICONS = { work: GL_WORK_ICON_SVG, city: GL_CITY_ICON_SVG, chat: GL_CHAT_ICON_SVG, phone: GL_PHONE_ICON_SVG, chart: GL_CHART_ICON_SVG, other: GL_EVENT_ICON_SVG };
const iconLead = svg => `<span class="pm-gl-lead" aria-hidden="true">${svg}</span>`;
const seal = (name, cls = '') => `<span class="pm-gl-seal${cls}" aria-hidden="true">${esc(sealChar(name))}</span>`;
const GLOBE_DECO = `<span class="pm-gl-deco" aria-hidden="true">${GL_GLOBE_DECO_ICON_SVG}</span>`;
const emptyNote = textValue => `<p class="pm-origin-empty">${esc(textValue)}</p>`;

// 一行。name 已转义；open 为 undefined 表示不可展开；可展开的行头是按钮，展开后摘要改成完整文字并接详情。
function row(name, small, sideHtml = '', { gone = false, extraSmall = '', clamp = false, lead = '', smallHtml = '' } = {}) {
    return `<div class="pm-origin-row${gone ? ' pm-gl-gone' : ''}"><div class="pm-origin-row-head">${lead}<div class="pm-origin-row-main"><b>${name}</b>${smallHtml ? `<small>${smallHtml}</small>` : small ? `<small${clamp ? ' class="pm-gl-clamp"' : ''}>${esc(small)}</small>` : ''}${extraSmall}</div>${sideHtml}</div></div>`;
}
function expandRow(key, open, { name, small, full, sideHtml = '', detail = '', gone = false, keepSmall = false, lead = '' }) {
    const head = `<button type="button" class="pm-origin-row-head" ${act('fold', `data-fold="${attr(key)}"`)} aria-expanded="${open}">${lead}<div class="pm-origin-row-main"><b>${name}</b>${(keepSmall || !open) && small ? `<small class="pm-gl-clamp">${esc(small)}</small>` : ''}</div>${sideHtml}</button>`;
    const body = open ? `${full ? `<p class="pm-origin-row-desc">${esc(full)}</p>` : ''}${detail ? `<div class="pm-gl-detail">${detail}</div>` : ''}` : '';
    return `<div class="pm-origin-row${gone ? ' pm-gl-gone' : ''}${open ? ' is-open' : ''}">${head}${body}</div>`;
}

// 折叠行：放在分组末尾；展开状态只在本次打开期间保持。
function foldRow(key, label, open) {
    return `<button type="button" class="pm-origin-link pm-gl-fold" ${act('fold', `data-fold="${attr(key)}"`)} aria-expanded="${open}"><span>${esc(label)}</span>${CHEVRON_DOWN_ICON_SVG}</button>`;
}
// items 已转成 HTML 行；折叠标题按 open 状态在两种写法间切换。
function foldBlock(key, items, ui, closedLabel, openLabel) {
    if (!items.length) return '';
    const open = ui.open[key] === true;
    return `${foldRow(key, open ? openLabel : closedLabel, open)}${open ? `<div class="pm-origin-list">${items.join('')}</div>` : ''}`;
}

// ---- 世界 ----
function eventRow(event, ui) {
    const open = ui.open[`ev:${event.key}`] === true;
    const mark = event.isNew ? NEW_MARK : event.isUpdated ? UPDATE_MARK : '';
    const tag = event.status === 'active' ? '' : EVENT_STATUS_LABELS[event.status];
    const faces = event.actorNames.length ? `<p class="pm-gl-faces"><span class="pm-gl-stack">${event.actorNames.slice(0, 4).map(name => seal(name)).join('')}</span><span>${esc(event.actors)}</span></p>` : '';
    const detail = `${faces}${kv('地点', event.places)}${kv('下次检查', event.nextCheck)}`;
    return expandRow(`ev:${event.key}`, open, {
        name: `${esc(event.title)}${mark}`, small: event.state, full: event.state || '尚无状态摘要', sideHtml: side(esc(tag)), detail, gone: event.closed, lead: iconLead(EVENT_ICONS[event.kind] || EVENT_ICONS.other),
    });
}

function seedRow(seed) {
    const right = seed.closed ? esc(SEED_STATUS_LABELS[seed.status]) : dots(seed.stage, '阶段');
    return row(esc(seed.title), seed.catalyst, side(`${right}${seed.hidden ? HIDDEN_MARK : ''}`), { gone: seed.closed, clamp: true });
}
function rumorRow(rumor) {
    const small = [RUMOR_STATUS_LABELS[rumor.status], rumor.channels.join('、')].filter(Boolean).join(' · ');
    return row(`「${esc(rumor.fact)}」${rumor.isNew ? NEW_MARK : ''}`, small, '', { gone: rumor.status === 'dead' });
}
// 旧版栏目：账本里有内容才追加在世界页末尾；为空的整组不输出。
function legacyBlocks(view, ui) {
    const { dims, signals, seeds, rumors, chronicle } = view.legacy;
    const dimHtml = dims.length ? `${groupHead('局势')}<div class="pm-origin-row pm-gl-dims">${dims.map(dim => {
        const mark = dim.delta > 0 ? `<em class="is-up">↑${dim.delta}</em>` : dim.delta < 0 ? `<em>↓${-dim.delta}</em>` : '<em></em>';
        return `<div class="pm-gl-dim"><span>${esc(dim.name)}</span><progress class="pm-origin-bar" max="100" value="${dim.value}"></progress><b>${dim.value}</b>${mark}</div>`;
    }).join('')}</div>` : '';
    const open = seeds.filter(seed => !seed.hidden);
    const hidden = seeds.filter(seed => seed.hidden);
    const seedHtml = seeds.length ? `${open.length ? `${groupHead('伏线', `${open.filter(seed => !seed.closed).length} 条未结束`)}<div class="pm-origin-list">${open.map(seedRow).join('')}</div>` : ''}${foldBlock('seeds', hidden.map(seedRow), ui, `另有 ${hidden.length} 条未公开`, `收起未公开的 ${hidden.length} 条`)}` : '';
    const rumorHtml = rumors.length ? `${groupHead('风声')}<div class="pm-origin-list">${rumors.map(rumorRow).join('')}</div>` : '';
    const signalHtml = signals.length ? `${groupHead('场外信号')}<div class="pm-origin-list">${signals.map(item => row(esc(item.text), '', side(esc(item.label)))).join('')}</div>` : '';
    const chronicleHtml = chronicle.length ? `${groupHead('编年纪要', `共 ${chronicle.length} 条`)}<div class="pm-origin-list">${chronicle.map(entry => row(`${esc(entry.summary)}${entry.isNew ? NEW_MARK : ''}`, entry.at, '', { extraSmall: entry.missed ? `<small>错过了：${esc(entry.missed)}</small>` : '' })).join('')}</div>` : '';
    return `${dimHtml}${seedHtml}${rumorHtml}${signalHtml}${chronicleHtml}`;
}

function worldPage(view, ui) {
    const { time, date } = view.titleParts;
    const bigTitle = time ? `<span class="pm-gl-time">${esc(time)}</span>${date ? `<span class="pm-gl-date">${esc(date)}</span>` : ''}` : esc(view.title);
    const hero = `<section class="pm-origin-hero pm-gl-hero">${GLOBE_DECO}<div class="pm-origin-hero-head"><div class="pm-origin-hero-top"><span>${esc(view.dayLine)}</span><span>${view.changes > 0 ? `${view.changes} 处变化` : '暂无变化'}</span></div><b class="pm-gl-title">${bigTitle}</b></div><p class="pm-origin-hero-desc">${esc(view.summary)}</p></section>`;
    const { ongoing, closed, head, more } = view.events;
    const eventHtml = ongoing.length || closed.length ? `${groupHead('世界事件', ongoing.length ? `进行中 ${ongoing.length}` : '')}${head.length ? `<div class="pm-origin-list">${head.map(event => eventRow(event, ui)).join('')}</div>` : ''}${foldBlock('evMore', more.map(event => eventRow(event, ui)), ui, `另有 ${more.length} 件进行中`, `收起 ${more.length} 件进行中`)}${foldBlock('evDone', closed.map(event => eventRow(event, ui)), ui, `已收束 ${closed.length} 件`, `收起已收束的 ${closed.length} 件`)}` : '';
    return `${hero}${eventHtml}${legacyBlocks(view, ui)}`;
}

// ---- 人物 ----
function actorSmall(actor) {
    if (actor.life === 'missing') return actor.location ? `最后出现在${actor.location}` : '下落不明';
    if (actor.life === 'dead') return actor.deathSummary || (actor.diedAtDay ? `第 ${actor.diedAtDay} 天离世` : '');
    return [actor.location, actor.action].filter(Boolean).join(' · ');
}
const actorKey = actor => `ac:${actor.id || actor.name}`;
const actorDetail = actor => `${kv('上一轮', actor.previous)}${kv('短期', actor.shortTerm)}${kv('长期目标', actor.goals)}${kv('资源', actor.resources)}${kv('限制', actor.constraints)}${kv('已知', actor.knownFacts)}`;
function actorRow(actor, ui) {
    const status = actor.life === 'missing' ? '<span class="pm-gl-accent">失踪</span>' : actor.life === 'dead' ? '已故' : '';
    const open = ui.open[actorKey(actor)] === true;
    return expandRow(actorKey(actor), open, {
        name: esc(actor.name), small: actorSmall(actor), keepSmall: true, sideHtml: side(`${status}${actor.hidden ? HIDDEN_MARK : ''}`),
        detail: actorDetail(actor), gone: actor.life === 'dead', lead: seal(actor.name),
    });
}
function actorsPage(view, ui) {
    const hero = view.heroActor;
    let heroHtml = '';
    if (hero) {
        const where = [hero.name, hero.location].filter(Boolean).join(' · ');
        heroHtml = `<section class="pm-origin-hero"><div class="pm-origin-hero-head"><div class="pm-origin-hero-top"><span>${esc(where)}</span><span>${[view.heroUpdated ? '动作更新' : '', hero.hidden ? '未公开' : ''].filter(Boolean).join(' · ')}</span></div><div class="pm-gl-who">${seal(hero.name, ' is-hero')}<b class="pm-gl-title">${esc(hero.action || '暂无当前动作')}</b></div></div>${kv('短期', hero.shortTerm)}${kv('上一轮', hero.previous)}</section>`;
    }
    const { open, hidden, archived } = view.actorGroups;
    const none = !hero && !open.length && !hidden.length && !archived.length;
    const list = open.length ? `<div class="pm-origin-list">${open.map(actor => actorRow(actor, ui)).join('')}</div>` : '';
    const groupTitle = open.length ? groupHead(`${hero ? '其他人物' : '人物'} · ${open.length}`) : '';
    return `${heroHtml}${none ? emptyNote('推演里还没有人物') : ''}${groupTitle}${list}${foldBlock('actorsArchived', archived.map(actor => actorRow(actor, ui)), ui, `另有 ${archived.length} 位已归档`, `收起已归档的 ${archived.length} 位`)}${foldBlock('actors', hidden.map(actor => actorRow(actor, ui)), ui, `另有 ${hidden.length} 条未公开`, `收起未公开的 ${hidden.length} 条`)}`;
}

// ---- 事实 ----
const factRow = fact => row(esc(fact.summary), fact.small, '', {});
const factNewRow = fact => row(`${esc(fact.summary)}${fact.isNew ? NEW_MARK : ''}`, fact.small, '', { lead: iconLead(GL_CHECK_ICON_SVG) });
const protectedRow = fact => row(esc(fact.summary), fact.small, side(esc(fact.label)), { lead: iconLead(GL_LOCK_ICON_SVG) });
function factsPage(view, ui) {
    const { visible, protected: hiddenFacts, archive } = view.facts;
    const head = `${groupHead('确定事实')}${visible.length ? `<div class="pm-origin-list">${visible.map(factNewRow).join('')}</div>` : emptyNote('暂无确定事实')}`;
    return `${head}${foldBlock('factsProtected', hiddenFacts.map(protectedRow), ui, `未揭晓的事实 ${hiddenFacts.length} 条`, `未揭晓的事实 ${hiddenFacts.length} 条`)}${foldBlock('factsArchive', archive.map(factRow), ui, `过期事件 ${archive.length} 条`, `过期事件 ${archive.length} 条`)}`;
}

// ---- 历史 ----
function historyPage(view) {
    if (!view.history.length) return emptyNote('暂无重要历史');
    return view.historyDays.map(group => `<div class="pm-gl-day"><span class="pm-gl-day-n">${esc(group.num)}</span><span>${esc([group.label, group.date].filter(Boolean).join(' · '))}</span></div><div class="pm-origin-list">${group.items.map(item => row(esc(item.summary), item.small, side(dots(item.dots, '重要度')), { smallHtml: item.isNew ? `${NEW_MARK} · ${esc(item.small)}`.replace(/ · $/, '') : '' })).join('')}</div>`).join('');
}

const PAGES = { world: worldPage, actors: actorsPage, facts: factsPage, history: historyPage };

function pageHeader(tab, view) {
    if (tab === 'actors') return header('人物', view.activeCount ? `${view.activeCount} 人参与推演` : '暂无公开人物');
    if (tab === 'facts') return header('事实', `${view.facts.visible.length} 条确定 · ${view.facts.protected.length} 条未揭晓`);
    if (tab === 'history') return header('历史', view.history.length ? `${view.history.length} 条重要历史` : '暂无重要历史');
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

// ui：{ mode: 'ok' | 'noapi' | 'noledger', tab, open: { 折叠与展开键: true }, view }
export function renderGreenlinPage(ui) {
    if (ui.mode !== 'ok' || !ui.view) return `<div class="pm-origin-shell pm-gl-shell">${emptyView(ui)}</div>`;
    const tab = Object.hasOwn(PAGES, ui.tab) ? ui.tab : 'world';
    return `<div class="pm-origin-shell pm-gl-shell">${pageHeader(tab, ui.view)}<div class="pm-origin-scroll" data-gl-tab="${tab}">${PAGES[tab](ui.view, ui)}</div>${tabbar(tab)}</div>`;
}
