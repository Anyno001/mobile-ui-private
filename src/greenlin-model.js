// 格林推演（数据库插件的世界后台推演）只读视图模型：把账本整理成页面要用的数据，并和「上次看到的快照」比对。
// 只做纯计算，不读写存储、不碰 DOM。字段与枚举以数据库插件 src/service/simulation/model.ts 的 WorldSimulationLedger_ACU 为准，
// 状态中文名、事实筛选与时间/地点写法照数据库自己的面板 WorldSimulationMaterialsPanel.vue。
// 新版（v7）以 worldEvents / actors / facts / historyMilestones 为主；旧版的局势、伏线、风声、场外信号、编年纪要只在账本里有内容时追加显示。

export const GREENLIN_TABS = Object.freeze([
    Object.freeze({ id: 'world', label: '世界' }),
    Object.freeze({ id: 'actors', label: '人物' }),
    Object.freeze({ id: 'facts', label: '事实' }),
    Object.freeze({ id: 'history', label: '历史' }),
]);

// 世界事件 status：scheduled 待开始、active 进行中、paused 暂停、resolved 已收束、cancelled 已取消。前三种算未结束。
export const EVENT_STATUS_LABELS = Object.freeze({ scheduled: '待开始', active: '进行中', paused: '暂停', resolved: '已收束', cancelled: '已取消' });
const EVENT_CLOSED = new Set(['resolved', 'cancelled']);
// 场外信号 voice：encounter / rumor / ambient。
export const SIGNAL_VOICE_LABELS = Object.freeze({ encounter: '遭遇', rumor: '风声', ambient: '氛围' });
// 伏线 status：阶段由浅到深，圆点数即阶段；resolved 与 retired 已结束，不再亮点。
export const SEED_STATUS_LABELS = Object.freeze({ established: '已埋下', incubating: '酝酿中', active: '进行中', converging: '将收束', resolved: '已了结', retired: '已搁置' });
export const SEED_STAGE_DOTS = Object.freeze({ established: 1, incubating: 2, active: 3, converging: 4, resolved: 5, retired: 0 });
export const DOT_COUNT = 5;
const SEED_CLOSED = new Set(['resolved', 'retired']);
// 风声 status：latent 潜伏、ripe 将传开、revealed 已传开、dead 已平息。
export const RUMOR_STATUS_LABELS = Object.freeze({ latent: '潜伏', ripe: '将传开', revealed: '已传开', dead: '已平息' });
// 人物 life：alive 存活、missing 失踪、dead 已故。
export const ACTOR_LIFE_LABELS = Object.freeze({ alive: '存活', missing: '失踪', dead: '已故' });
const LIFE_ORDER = Object.freeze({ alive: 0, missing: 1, dead: 2 });
// 世界事件的图标分类：先看 tags，再看标题；按顺序命中第一类，都没中用默认类。只写粗分，不求穷举。
const EVENT_KIND_RULES = Object.freeze([
    ['phone', /家庭|家人|父母|母亲|父亲|来电|电话|催婚|相亲/],
    ['chat', /消息|舆论|传闻|八卦|热议|帖|论坛|通知|新闻|群聊/],
    ['chart', /数据|考核|绩效|评估|报表|统计|预算|指标/],
    ['work', /工作|公司|职场|部门|会议|项目|客户|上班/],
    ['city', /城市|地点|街|区|市|检修|施工|地铁|交通|天气/],
]);
export const eventKind = (tags, title) => {
    for (const source of [strings(tags).join(' '), title]) {
        const hit = source && EVENT_KIND_RULES.find(([, re]) => re.test(source));
        if (hit) return hit[0];
    }
    return 'other';
};
// 姓氏圆章取名字首字。
export const sealChar = name => Array.from(text(name))[0] || '?';
// 世界事件首屏最多显示的未结束条数。
export const EVENT_HEAD_COUNT = 5;

const text = value => (typeof value === 'string' ? value.trim() : '');
const list = value => (Array.isArray(value) ? value : []);
const strings = value => list(value).map(text).filter(Boolean);
const int = value => (value !== null && value !== '' && value !== undefined && Number.isFinite(Number(value)) ? Math.trunc(Number(value)) : null);
const isOpen = visibility => visibility === 'public' || visibility === undefined || visibility === null;
// 非 public（hidden / limited）都算未公开，默认折叠。
export const isHiddenItem = item => !isOpen(item?.visibility);
const escapeRegExp = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function dimensionValue(dim) {
    const value = Number(dim?.value);
    return Number.isFinite(value) ? Math.max(0, Math.min(100, Math.round(value))) : 0;
}

function actionText(action) { return text(action?.text); }

// ---- 时间与地点（写法同数据库面板：第 N 天 + 时段；地点 区域 · 地点）----
export function timeText(time) {
    const day = int(time?.day);
    if (day === null) return '';
    return [`第 ${day} 天`, text(time?.slot)].filter(Boolean).join(' ');
}
export const locationText = ref => (ref && typeof ref === 'object' ? [text(ref.region), text(ref.place)].filter(Boolean).join(' · ') : '');
export function nextCheckText(next) {
    return [timeText(next), text(next?.reason)].filter(Boolean).join(' · ');
}
// 事实时间：发生型取发生时间；条件型取有效期。
export function factTimeText(fact) {
    if (fact?.temporalKind === 'condition') {
        const from = timeText(fact.validFrom);
        const until = timeText(fact.validUntil);
        if (from && until) return `${from} 至 ${until}`;
        if (from) return `${from}起生效`;
        if (until) return `${until}前有效`;
        return '';
    }
    return timeText(fact?.happenedAt);
}
// 未揭晓事实的右侧小字：内部、锁定、其余（Gated）为管理资料。
export const protectedFactLabel = fact => (fact?.projectionPolicy === 'internal' ? '内部' : fact?.revealState === 'locked' ? '锁定' : '管理资料');
// 确定事实：projectionPolicy=scene 且 revealState=unlocked；其余都是未揭晓。
const isVisibleFact = fact => fact?.projectionPolicy === 'scene' && fact?.revealState === 'unlocked';

// 历史：重要历史与冷层合并（按 id 去重，保持账本原顺序）。
function mergedHistory(ledger) {
    const seen = new Set();
    const out = [];
    for (const item of [...list(ledger?.historyMilestones), ...list(ledger?.historyArchive)]) {
        const id = text(item?.id);
        if (id && seen.has(id)) continue;
        if (id) seen.add(id);
        out.push(item);
    }
    return out;
}
// importance 取值 1–5 整数（数据库校验与归一都限定在此范围）；越界按边界处理，缺失按 1。
export const importanceDots = value => Math.max(1, Math.min(DOT_COUNT, int(value) ?? 1));

// ---- 人物 ----
function actorView(actor) {
    const life = Object.hasOwn(LIFE_ORDER, actor?.life) ? actor.life : 'alive';
    const long = actor?.longTermAction && actor.longTermAction.status !== 'done' && actor.longTermAction.status !== 'abandoned' ? actionText(actor.longTermAction) : '';
    const goals = strings(actor?.goals);
    return {
        id: text(actor?.id), name: text(actor?.name) || '未命名', life, hidden: isHiddenItem(actor), archived: actor?.simulationStatus === 'archived',
        location: text(actor?.location) || locationText(actor?.locationRef), action: actionText(actor?.currentAction),
        shortTerm: actionText(actor?.shortTermAction), goals: goals.length ? goals.join('、') : long,
        resources: strings(actor?.resources).join('、'), constraints: strings(actor?.constraints).join('、'), knownFacts: strings(actor?.knownFacts).join('、'),
        previous: text(actor?.previousActionResult), deathSummary: text(actor?.deathSummary), diedAtDay: int(actor?.diedAtDay),
    };
}

// 主卡选人：本轮行动有更新的人优先；没有就取第一个参与推演、存活、有当前行动的人。先只看公开的，全是未公开时再看未公开的；已归档的不参与。
export function pickHeroActor(actors, changedIds) {
    const live = actors.filter(a => !a.archived);
    for (const pool of [live.filter(a => !a.hidden), live.filter(a => a.hidden)]) {
        const changed = pool.find(a => a.life === 'alive' && changedIds.has(a.id));
        if (changed) return { actor: changed, updated: true };
        const first = pool.find(a => a.life === 'alive' && a.action);
        if (first) return { actor: first, updated: false };
    }
    return { actor: null, updated: false };
}

// ---- 旧版栏目 ----
function seedView(seed) {
    const status = Object.hasOwn(SEED_STATUS_LABELS, seed?.status) ? seed.status : 'active';
    return {
        id: text(seed?.id), title: text(seed?.title) || '未命名伏线', status, closed: SEED_CLOSED.has(status),
        stage: SEED_STAGE_DOTS[status], hidden: isHiddenItem(seed), catalyst: text(seed?.catalyst),
    };
}
function rumorView(rumor) {
    const status = Object.hasOwn(RUMOR_STATUS_LABELS, rumor?.status) ? rumor.status : 'latent';
    return { id: text(rumor?.id), fact: text(rumor?.fact), status, channels: strings(rumor?.channels) };
}

const byLife = (a, b) => LIFE_ORDER[a.life] - LIFE_ORDER[b.life];

// 比对用快照 v2：世界事件 id → [revision, 状态摘要]、人物当前行动文字、确定事实 id、历史 id；
// 旧栏目（局势、纪要、风声、伏线）的字段照旧保留。id 列表超上限时只留最近的，并记下被丢掉的个数。
const SNAP_ID_CAP = 2000;
const SNAP_MAP_CAP = 400;
const ACTION_CUT = 80;
const cut = ids => ({ ids: ids.slice(-SNAP_ID_CAP), dropped: Math.max(0, ids.length - SNAP_ID_CAP) });
export function makeSnapshot(ledger) {
    const dims = Object.create(null);
    for (const dim of list(ledger?.dimensions)) if (text(dim?.id)) dims[text(dim.id)] = dimensionValue(dim);
    const actions = Object.create(null);
    const actors = list(ledger?.actors);
    for (const actor of actors.slice(0, SNAP_MAP_CAP)) if (text(actor?.id)) actions[text(actor.id)] = actionText(actor.currentAction).slice(0, ACTION_CUT);
    const events = list(ledger?.worldEvents);
    const evKept = events.slice(-SNAP_MAP_CAP);
    const ev = Object.create(null);
    for (const event of evKept) if (text(event?.id)) ev[text(event.id)] = [int(event.revision) ?? 0, text(event.state).slice(0, 60)];
    const chr = cut(list(ledger?.chronicle).map(e => text(e?.id)));
    const rum = cut(list(ledger?.rumors).map(r => text(r?.id)));
    const fc = cut(list(ledger?.facts).filter(isVisibleFact).map(f => text(f?.id)));
    const hs = cut(mergedHistory(ledger).map(h => text(h?.id)));
    return {
        v: 2, dims,
        ev, evCut: events.length - evKept.length, act: actions, actKept: Math.min(actors.length, SNAP_MAP_CAP), fc: fc.ids, fcCut: fc.dropped, hs: hs.ids, hsCut: hs.dropped,
        chr: chr.ids, chrCut: chr.dropped, rum: rum.ids, rumCut: rum.dropped,
    };
}

function relativeTime(stamp, now) {
    let ms = Number(stamp);
    if (!Number.isFinite(ms) || ms <= 0) return '';
    if (ms < 1e11) ms *= 1000;
    const minutes = Math.floor((now - ms) / 60000);
    if (minutes < 1) return '刚刚更新';
    if (minutes < 60) return `${minutes} 分钟前更新`;
    if (minutes < 1440) return `${Math.floor(minutes / 60)} 小时前更新`;
    return `${Math.floor(minutes / 1440)} 天前更新`;
}

// 主卡大字：故事时间里已含的「第 N 天」与时段不再重复（按分隔符切段去掉，或前后以空白隔开的整词去掉）。
export function storyTitle(clock) {
    const story = text(clock?.storyTime);
    if (!story) return '时间未记录';
    const day = int(clock?.day);
    const slot = text(clock?.slot);
    const dayRe = day === null ? null : new RegExp(`^第\\s*${day}\\s*[天日]$`);
    const parts = story.split(/\s*[·，,、]\s*/).map(part => part.trim()).filter(Boolean).filter(part => part !== slot && !(dayRe && dayRe.test(part)));
    let out = parts.join(' · ');
    if (slot) out = out.replace(new RegExp(`(^|\\s)${escapeRegExp(slot)}(?=\\s|$)`, 'g'), ' ');
    if (day !== null) out = out.replace(new RegExp(`(^|\\s)第\\s*${day}\\s*[天日](?=\\s|$)`, 'g'), ' ');
    out = out.replace(/\s+/g, ' ').trim();
    return out || story;
}
// 日期只留月日：「2026年10月15日」→「10月15日」；拆不出月日时照原文。
const monthDay = date => { const m = /(\d{1,2})\s*月\s*(\d{1,2})\s*[日号]/.exec(date); return m ? `${m[1]}月${m[2]}日` : date; };
// 主卡大字：能拆出 时:分 就把时分放大，日期（其余部分）跟在后面；拆不出时整条照旧做标题。
export function splitStoryTime(title) {
    const match = /(\d{1,2}):(\d{2})(?::\d{2})?/.exec(title);
    const hm = match ? `${match[1]}:${match[2]}` : '';
    if (!match) return { time: '', date: '' };
    const date = (title.slice(0, match.index) + ' ' + title.slice(match.index + match[0].length)).replace(/\s+/g, ' ').replace(/^[\s·，,、]+|[\s·，,、]+$/g, '');
    return { time: hm, date: monthDay(date) };
}
// 历史分段的日期：从故事时间里取出年月日，按「第 N 天」与当前天数的差推算；取不到就不显示。
function dayDateFn(clock) {
    const story = text(clock?.storyTime);
    const day = int(clock?.day);
    const match = /(?:(\d{4})\s*年\s*)?(\d{1,2})\s*月\s*(\d{1,2})\s*[日号]/.exec(story);
    if (!match || day === null) return () => '';
    const base = Date.UTC(Number(match[1]) || 2000, Number(match[2]) - 1, Number(match[3]));
    return target => {
        if (!Number.isFinite(target)) return '';
        const d = new Date(base + (target - day) * 86400000);
        return `${d.getUTCMonth() + 1}月${d.getUTCDate()}日`;
    };
}
const dayLine = clock => {
    const day = int(clock?.day);
    return [day === null ? '' : `第 ${day} 天`, text(clock?.slot)].filter(Boolean).join(' · ') || '故事时间';
};

// ledger：getLedger() 的结果；base：本次打开的比对基准（可为 null；缺新字段的旧快照由存取层挡掉，这里再各自兜底）。
export function buildGreenlinView(ledger, base, now = Date.now()) {
    const clock = ledger?.clock || {};
    const baseDims = base?.dims && typeof base.dims === 'object' ? base.dims : {};
    const baseChr = new Set(list(base?.chr));
    const baseRum = new Set(list(base?.rum));
    const baseAct = base?.act && typeof base.act === 'object' ? base.act : {};
    const hasEv = Boolean(base) && Boolean(base.ev) && typeof base.ev === 'object' && !Array.isArray(base.ev);
    const baseEv = hasEv ? base.ev : {};
    const hasFc = Boolean(base) && Array.isArray(base.fc);
    const baseFc = new Set(list(base?.fc));
    const hasHs = Boolean(base) && Array.isArray(base.hs);
    const baseHs = new Set(list(base?.hs));

    // 人物（名字表含未公开与已归档的，供参与者、关联人物换名）
    const actors = list(ledger?.actors).map(actorView);
    const nameOf = new Map(actors.filter(a => a.id).map(a => [a.id, a.name]));
    const names = ids => strings(ids).map(id => nameOf.get(id) || id).join('、');

    // 世界事件：本轮新增 > 本轮推进（revision 或状态摘要变了）> 原顺序。
    const evCut = int(base?.evCut) || 0;
    const events = list(ledger?.worldEvents).map((event, index) => {
        const id = text(event?.id);
        const status = Object.hasOwn(EVENT_STATUS_LABELS, event?.status) ? event.status : 'active';
        const state = text(event?.state);
        const before = hasEv && id && Object.hasOwn(baseEv, id) && Array.isArray(baseEv[id]) ? baseEv[id] : null;
        const isNew = hasEv && Boolean(id) && !Object.hasOwn(baseEv, id) && index >= evCut;
        const isUpdated = before !== null && (Number(before[0]) !== (int(event?.revision) ?? 0) || text(before[1]) !== state.slice(0, 60));
        return {
            key: id || `#${index}`, title: text(event?.title) || '未命名事件', state, status, closed: EVENT_CLOSED.has(status), isNew, isUpdated,
            kind: eventKind(event?.tags, text(event?.title)), actorNames: strings(event?.actorIds).map(id => nameOf.get(id) || id), actors: names(event?.actorIds), places: list(event?.locationRefs).map(locationText).filter(Boolean).join('、'), nextCheck: nextCheckText(event?.nextCheck),
        };
    });
    const rankOf = event => (event.isNew ? 0 : event.isUpdated ? 1 : 2);
    const ongoing = events.map((e, i) => ({ e, i })).filter(({ e }) => !e.closed).sort((a, b) => rankOf(a.e) - rankOf(b.e) || a.i - b.i).map(item => item.e);
    const closed = events.filter(e => e.closed);
    const newEvents = events.filter(e => e.isNew).length;
    const movedEvents = events.filter(e => e.isUpdated).length;
    const parts = [newEvents ? `本轮新增 ${newEvents} 件` : '', movedEvents ? `推进 ${movedEvents} 件` : ''].filter(Boolean);
    const summary = !events.length ? '暂无世界事件。' : !ongoing.length ? '暂无进行中的事件。' : `${ongoing.length} 件事正在进行${parts.length ? `，${parts.join('、')}` : ''}。`;

    // 人物：动作文字与上次不同的公开人物（含新出现且有动作的）。
    const actKept = int(base?.actKept);
    const actionChanged = (a, map, kept) => (Object.hasOwn(map, a.id) ? map[a.id] !== a.action.slice(0, ACTION_CUT) : kept === null || actors.indexOf(a) < kept);
    const changedIds = new Set(base ? actors.filter(a => !a.hidden && !a.archived && a.id && a.action && actionChanged(a, baseAct, actKept)).map(a => a.id) : []);
    const hero = pickHeroActor(actors, changedIds);
    const heroed = actors.slice().sort(byLife).filter(actor => actor !== hero.actor);
    const actorGroups = {
        open: heroed.filter(a => !a.hidden && !a.archived),
        hidden: heroed.filter(a => a.hidden),
        archived: heroed.filter(a => !a.hidden && a.archived),
    };

    // 事实
    const fcCut = int(base?.fcCut) || 0;
    const factView = (fact, index, isNew = false) => ({
        key: text(fact?.id) || `#${index}`, summary: text(fact?.summary) || '（无摘要）', isNew,
        small: [factTimeText(fact), locationText(fact?.locationRef), names(fact?.actorIds)].filter(Boolean).join(' · '),
        label: protectedFactLabel(fact),
    });
    const visibleFacts = list(ledger?.facts).filter(isVisibleFact)
        .map((fact, index) => factView(fact, index, hasFc && index >= fcCut && !baseFc.has(text(fact?.id))));
    const protectedFacts = list(ledger?.facts).filter(fact => !isVisibleFact(fact)).map((fact, index) => factView(fact, index));
    const archiveFacts = list(ledger?.factArchive).map((fact, index) => factView(fact, index));

    // 历史：重要历史 + 冷层，按发生时间倒序（同一天后写的在前）。
    const hsCut = int(base?.hsCut) || 0;
    const history = mergedHistory(ledger).map((item, index) => ({
        key: text(item?.id) || `#${index}`, index, day: int(item?.happenedAt?.day) ?? -Infinity, summary: text(item?.summary),
        small: [text(item?.happenedAt?.slot), names(item?.actorIds)].filter(Boolean).join(' · '),
        dots: importanceDots(item?.importance), isNew: hasHs && index >= hsCut && !baseHs.has(text(item?.id)),
    })).filter(item => item.summary).sort((a, b) => (a.day === b.day ? b.index - a.index : b.day - a.day));

    // 历史按天分段：段首写第几天与（能推算时的）日期。
    const dateOf = dayDateFn(clock);
    const historyDays = [];
    for (const item of history) {
        const last = historyDays[historyDays.length - 1];
        if (last && last.day === item.day) last.items.push(item);
        else historyDays.push({ day: item.day, label: Number.isFinite(item.day) ? `第 ${item.day} 天` : '时间未定', num: Number.isFinite(item.day) ? String(item.day) : '—', date: dateOf(item.day), items: [item] });
    }

    // 旧栏目
    const dims = list(ledger?.dimensions).map(dim => {
        const value = dimensionValue(dim);
        const before = base && Object.hasOwn(baseDims, text(dim?.id)) ? baseDims[text(dim.id)] : null;
        return { id: text(dim?.id), name: text(dim?.name) || '未命名', value, delta: before === null ? 0 : value - before };
    });
    const signals = list(ledger?.guidance?.signals).map(item => ({ text: text(item?.text), label: SIGNAL_VOICE_LABELS[item?.voice] || '' })).filter(item => item.text);
    const chrCut = int(base?.chrCut) || 0;
    const rumCut = int(base?.rumCut) || 0;
    const chronicle = list(ledger?.chronicle).map((entry, index) => ({
        id: text(entry?.id), at: text(entry?.at), summary: text(entry?.summary), missed: text(entry?.missedNote),
        isNew: Boolean(base) && index >= chrCut && !baseChr.has(text(entry?.id)),
    })).filter(entry => entry.summary).reverse();
    const seeds = list(ledger?.seeds).map(seedView).sort((a, b) => Number(a.closed) - Number(b.closed));
    const rumors = list(ledger?.rumors).map((rumor, index) => ({ ...rumorView(rumor), index })).filter(r => r.fact)
        .map(r => ({ ...r, isNew: Boolean(base) && r.index >= rumCut && !baseRum.has(r.id) }));

    // 「N 处变化」：只数公开的新增事件、推进事件、人物动作更新、新确定事实、新重要历史。
    const changes = newEvents + movedEvents + changedIds.size + visibleFacts.filter(f => f.isNew).length + history.filter(h => h.isNew).length;
    const rounds = int(ledger?.factArchiveRetention?.completedRounds);
    const stamp = relativeTime(ledger?.materialCompletion?.updatedAt, now);
    const rev = int(ledger?.revision);
    return {
        revision: rev ?? 0,
        dayLine: dayLine(clock), title: storyTitle(clock), titleParts: splitStoryTime(storyTitle(clock)), summary, changes,
        subtitle: [rounds ? `第 ${rounds} 轮` : '', stamp].filter(Boolean).join(' · ') || (rev ? `版本 ${rev}` : '世界后台'),
        events: { ongoing, closed, head: ongoing.slice(0, EVENT_HEAD_COUNT), more: ongoing.slice(EVENT_HEAD_COUNT) },
        heroActor: hero.actor, heroUpdated: hero.updated, actorGroups,
        activeCount: actors.filter(a => !a.hidden && !a.archived).length,
        facts: { visible: visibleFacts, protected: protectedFacts, archive: archiveFacts },
        history, historyDays,
        legacy: { dims, signals, seeds, rumors, chronicle, any: Boolean(dims.length || signals.length || seeds.length || rumors.length || chronicle.length) },
    };
}
