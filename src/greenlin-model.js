// 格林推演（数据库插件的世界后台推演）只读视图模型：把账本整理成页面要用的数据，并和「上次看到的快照」比对。
// 只做纯计算，不读写存储、不碰 DOM。字段与枚举以数据库插件 src/service/simulation/model.ts 的 WorldSimulationLedger_ACU 为准。

export const GREENLIN_TABS = Object.freeze([
    Object.freeze({ id: 'overview', label: '总览' }),
    Object.freeze({ id: 'actors', label: '人物' }),
    Object.freeze({ id: 'seeds', label: '暗线' }),
    Object.freeze({ id: 'log', label: '纪要' }),
]);

// 场外信号 voice：encounter / rumor / ambient。
export const SIGNAL_VOICE_LABELS = Object.freeze({ encounter: '遭遇', rumor: '风声', ambient: '氛围' });
// 伏线 status：阶段由浅到深，圆点数即阶段；resolved 与 retired 已结束，不再亮点。
export const SEED_STATUS_LABELS = Object.freeze({ established: '已埋下', incubating: '酝酿中', active: '进行中', converging: '将收束', resolved: '已了结', retired: '已搁置' });
export const SEED_STAGE_DOTS = Object.freeze({ established: 1, incubating: 2, active: 3, converging: 4, resolved: 5, retired: 0 });
export const SEED_DOT_COUNT = 5;
const SEED_CLOSED = new Set(['resolved', 'retired']);
const SEED_RANK = Object.freeze({ established: 1, incubating: 2, active: 3, converging: 4, resolved: 5, retired: 0 });
// 风声 status：latent 潜伏、ripe 将传开、revealed 已传开、dead 已平息。
export const RUMOR_STATUS_LABELS = Object.freeze({ latent: '潜伏', ripe: '将传开', revealed: '已传开', dead: '已平息' });
// 人物 life：alive 在世、missing 失踪、dead 已故。
export const ACTOR_LIFE_LABELS = Object.freeze({ alive: '在世', missing: '失踪', dead: '已故' });
const LIFE_ORDER = Object.freeze({ alive: 0, missing: 1, dead: 2 });

const text = value => (typeof value === 'string' ? value.trim() : '');
const list = value => (Array.isArray(value) ? value : []);
const int = value => (Number.isFinite(Number(value)) ? Math.trunc(Number(value)) : null);
const isOpen = visibility => visibility === 'public' || visibility === undefined || visibility === null;
// 非 public（hidden / limited）都算未公开，默认折叠。
export const isHiddenItem = item => !isOpen(item?.visibility);

export function dimensionValue(dim) {
    const value = Number(dim?.value);
    return Number.isFinite(value) ? Math.max(0, Math.min(100, Math.round(value))) : 0;
}

function actionText(action) { return text(action?.text); }

// 人物：只取页面要用的字段。
function actorView(actor) {
    const life = Object.hasOwn(LIFE_ORDER, actor?.life) ? actor.life : 'alive';
    const longTerm = actor?.longTermAction && actor.longTermAction.status !== 'done' && actor.longTermAction.status !== 'abandoned' ? actionText(actor.longTermAction) : '';
    return {
        id: text(actor?.id), name: text(actor?.name) || '未命名', life, hidden: isHiddenItem(actor),
        location: text(actor?.location), action: actionText(actor?.currentAction), longTerm,
        previous: text(actor?.previousActionResult), deathSummary: text(actor?.deathSummary),
        diedAtDay: int(actor?.diedAtDay),
    };
}

function seedView(seed) {
    const status = Object.hasOwn(SEED_STATUS_LABELS, seed?.status) ? seed.status : 'active';
    return {
        id: text(seed?.id), title: text(seed?.title) || '未命名伏线', status, closed: SEED_CLOSED.has(status),
        stage: SEED_STAGE_DOTS[status], level: Number(seed?.level) || 0, hidden: isHiddenItem(seed),
        catalyst: text(seed?.catalyst), expiresAtDay: int(seed?.expiresAtDay),
    };
}

function rumorView(rumor) {
    const status = Object.hasOwn(RUMOR_STATUS_LABELS, rumor?.status) ? rumor.status : 'latent';
    return { id: text(rumor?.id), fact: text(rumor?.fact), status, channels: list(rumor?.channels).map(text).filter(Boolean) };
}

// 主卡选人：本轮行动有更新的人优先；没有人更新时取第一个在世且有当前行动的人。先只看公开的，全是未公开时再看未公开的。
export function pickHeroActor(actors, changedIds) {
    for (const pool of [actors.filter(a => !a.hidden), actors.filter(a => a.hidden)]) {
        const changed = pool.find(a => a.life === 'alive' && changedIds.has(a.id));
        if (changed) return { actor: changed, updated: true };
        const first = pool.find(a => a.life === 'alive' && a.action);
        if (first) return { actor: first, updated: false };
    }
    return { actor: null, updated: false };
}

// 主卡选伏线：未结束的里面，已进入收束的优先，其次期限最近，再看阶段和强度。同样先公开后未公开。
export function pickHeroSeed(seeds) {
    const rank = seed => [seed.status === 'converging' ? 0 : 1, seed.expiresAtDay ?? Infinity, -seed.stage, -seed.level];
    const compare = (a, b) => { const x = rank(a); const y = rank(b); for (let i = 0; i < x.length; i += 1) if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1; return 0; };
    for (const pool of [seeds.filter(s => !s.closed && !s.hidden), seeds.filter(s => !s.closed && s.hidden)]) {
        if (pool.length) return pool.slice().sort(compare)[0];
    }
    return null;
}

const byLife = (a, b) => LIFE_ORDER[a.life] - LIFE_ORDER[b.life];

// 比对用快照：只存 revision、各刻度值、纪要与风声 id、人物当前行动文字。
const SNAP_ID_CAP = 2000;
const cut = ids => ({ ids: ids.slice(-SNAP_ID_CAP), dropped: Math.max(0, ids.length - SNAP_ID_CAP) });
export function makeSnapshot(ledger) {
    const dims = {};
    for (const dim of list(ledger?.dimensions)) if (text(dim?.id)) dims[text(dim.id)] = dimensionValue(dim);
    const actions = {};
    for (const actor of list(ledger?.actors).slice(0, 400)) if (text(actor?.id)) actions[text(actor.id)] = actionText(actor.currentAction).slice(0, 80);
    const seeds = {};
    for (const seed of list(ledger?.seeds).slice(0, 400)) if (text(seed?.id)) seeds[text(seed.id)] = text(seed.status);
    const chr = cut(list(ledger?.chronicle).map(e => text(e?.id)));
    const rum = cut(list(ledger?.rumors).map(r => text(r?.id)));
    return {
        rev: int(ledger?.revision) ?? 0, day: int(ledger?.clock?.day) ?? 0, dims,
        chr: chr.ids, chrCut: chr.dropped, rum: rum.ids, rumCut: rum.dropped, act: actions, sd: seeds,
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

// ledger：getLedger() 的结果；base：本次打开的比对基准（可为 null）。
export function buildGreenlinView(ledger, base, now = Date.now()) {
    const clock = ledger?.clock || {};
    const baseDims = base?.dims || {};
    const baseChr = new Set(base?.chr || []);
    const baseRum = new Set(base?.rum || []);
    const baseAct = base?.act || {};

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
    const actors = list(ledger?.actors).map(actorView);
    const changedIds = new Set(base ? actors.filter(a => a.id && a.action && baseAct[a.id] !== a.action).map(a => a.id) : []);
    const seeds = list(ledger?.seeds).map(seedView);
    const rumors = list(ledger?.rumors).map((rumor, index) => ({ ...rumorView(rumor), index })).filter(r => r.fact).map(r => ({ ...r, isNew: Boolean(base) && r.index >= rumCut && !baseRum.has(r.id) }));

    const publicActors = actors.filter(a => !a.hidden);
    const publicChanged = publicActors.filter(a => changedIds.has(a.id)).length;
    const baseSeeds = base?.sd || {};
    const seedMoved = seed => Boolean(base) && !seed.hidden && !!seed.id && (!Object.hasOwn(baseSeeds, seed.id)
        || (seed.status !== 'retired' && SEED_RANK[seed.status] > (SEED_RANK[baseSeeds[seed.id]] ?? 0)));
    const changes = seeds.filter(seedMoved).length + dims.filter(d => d.delta !== 0).length + chronicle.filter(e => e.isNew).length + rumors.filter(r => r.isNew).length + publicChanged;
    const rounds = int(ledger?.factArchiveRetention?.completedRounds);
    const stamp = relativeTime(ledger?.materialCompletion?.updatedAt, now);
    const hero = pickHeroActor(actors, changedIds);
    const heroSeed = pickHeroSeed(seeds);
    const openSeeds = seeds.filter(s => !s.closed);
    return {
        revision: int(ledger?.revision) ?? 0,
        clock: { day: int(clock.day), slot: text(clock.slot), storyTime: text(clock.storyTime) },
        timeLine: timeLine(clock),
        latestParts: splitSummary(chronicle[0]),
        subtitle: [rounds ? `第 ${rounds} 轮` : '', stamp].filter(Boolean).join(' · ') || appRevisionText(ledger),
        dims, signals, changes,
        latest: chronicle[0] || null,
        chronicle, newChronicle: chronicle.filter(e => e.isNew).length,
        actors: actors.slice().sort(byLife),
        heroActor: hero.actor, heroUpdated: hero.updated,
        seeds, heroSeed, rumors,
        counts: {
            alive: publicActors.filter(a => a.life === 'alive').length,
            missing: publicActors.filter(a => a.life === 'missing').length,
            dead: publicActors.filter(a => a.life === 'dead').length,
            seeds: openSeeds.filter(s => !s.hidden).length,
            rumors: rumors.filter(r => r.status !== 'dead').length,
        },
    };
}

// 左上时间：第 N 日 · 时段，故事内时间只在去掉时段与日期后还有内容时补在后面。
function timeLine(clock) {
    const day = int(clock?.day);
    const slot = text(clock?.slot);
    const base = [day ? `第 ${day} 日` : '', slot].filter(Boolean).join(' · ');
    const story = text(clock?.storyTime);
    let extra = slot ? story.split(slot).join('') : story;
    if (day) extra = extra.replace(new RegExp(`第\\s*${day}\\s*日`, 'g'), '');
    extra = extra.replace(/^[\s,，、·:：;；]+|[\s,，、·:：;；]+$/g, '');
    return [base, extra && extra !== base ? extra : ''].filter(Boolean).join(' · ') || story || '时间未记录';
}

// 纪要拆成大标题（首句）与补充（后文，没有就取错过的说明）。
function splitSummary(entry) {
    if (!entry) return null;
    const match = /^(.+?[。！？!?；;])\s*(.+)$/s.exec(entry.summary);
    const title = (match ? match[1] : entry.summary).replace(/[。；;]$/, '');
    const rest = match ? match[2].trim() : (entry.missed ? `错过了：${entry.missed}` : '');
    return { title, rest };
}

function appRevisionText(ledger) { const rev = int(ledger?.revision); return rev ? `版本 ${rev}` : '世界后台'; }

// 期限文字：到期日在前，没有期限时写阶段。
export function seedDeadlineText(seed) {
    if (!seed) return '';
    if (seed.closed) return SEED_STATUS_LABELS[seed.status];
    return seed.expiresAtDay ? `第 ${seed.expiresAtDay} 日前` : SEED_STATUS_LABELS[seed.status];
}
