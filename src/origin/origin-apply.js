// Origin 系统核心 · 操作 → 状态。
// 来源：vicliaaa/origin-sillytavern v1.5 的 completeTask / applyEffects / addItem / addPerk / addSkill / drawCore / 成就 / applyBlock（作者已授权移植）。
// 所有函数就地改写传入的 st，调用方必须传「写时浅拷」出来的副本（见 origin-state 的 cloneForWrite）。
// cx：{ turn, floor, s(设置), random, events[], uses[], draws[], logged[], grantT{}, ptT[] }。本楼内的去重表在 cx 里，不进状态。
import { cleanNum, parseBlock } from './origin-parse.js';
import { hostOf } from './origin-state.js';

export function createCx(over = {}) {
    return { turn: 0, floor: null, s: {}, random: Math.random, events: [], uses: [], draws: [], logged: [], grantT: {}, ptT: [], ...over };
}
function stamp(cx, o) { return cx && cx.floor != null ? { ...o, floor: cx.floor } : o; }

export function pushLog(st, text, mark, cx) {
    st.log.push(stamp(cx, { text, mark: mark || '' }));
    if (cx && cx.logged) cx.logged.push(text);
    if (st.log.length > 40) st.log = st.log.slice(-40);
}

export function findTask(st, idOrTitle) {
    const d = String(idOrTitle == null ? '' : idOrTitle).replace(/[^0-9]/g, '');
    if (d !== '') { const t = st.tasks.find((x) => String(x.id) === d); if (t) return t; }
    const q = String(idOrTitle == null ? '' : idOrTitle).trim();
    if (!q) return undefined;
    return st.tasks.find((x) => x.status === 'active' && (x.title === q || q.indexOf(x.title) >= 0 || (x.title && x.title.indexOf(q) >= 0)));
}

export function tRemain(t, turn) {
    if (!t.limit || t.limit <= 0) return null;
    const elapsed = turn - (t.startTurn || t.turn || turn);
    return t.limit - elapsed;
}

export function addItem(st, name, count, src, cx) {
    name = String(name || '').replace(/^[「『"']+|[」』"']+$/g, '').trim();
    count = parseInt(count, 10) || 1;
    if (!name || /积分|经验|等级|好感|回合/.test(name) || /^[+-]?\d+$/.test(name)) return false;
    if (src !== 'buy' && cx.grantT[name]) return false; // 同一楼已经发过这件了（完成发一次、发放句再说一次）
    cx.grantT[name] = true;
    const ex = st.bag.find((b) => b.name === name);
    if (ex) ex.count = (ex.count || 1) + count; else st.bag.push({ name, count, desc: '', effect: '' });
    pushLog(st, '获得物品「' + name + '」×' + count + (src ? '（' + src + '）' : ''), '·', cx);
    return true;
}

export function addPerk(st, name, desc, kind, cx) {
    name = String(name || '').replace(/^[「『【"']+|[」』】"']+$/g, '').replace(/^(开启|获得|解锁|激活|授予|了)+/, '').replace(/(已)?(开启|解锁|激活)$/, '').trim();
    if (!name || name.length < 2) return false;
    if (!kind) { const km = name.match(/(权限|特权|称号|资格|功能|头衔|身份)/); kind = km ? km[1] : '权限'; }
    const ex = st.perks.find((k) => k.name === name);
    if (ex) { if (desc && !ex.desc) ex.desc = desc; return false; }
    st.perks.push(stamp(cx, { name, kind, desc: String(desc || '').trim(), turn: cx.turn }));
    pushLog(st, '开启' + kind + '「' + name + '」' + (desc ? '：' + desc : ''), '★', cx);
    return true;
}

export function addSkill(st, name, desc, cx) {
    name = String(name || '').replace(/^[「『"']+|[」』"']+$/g, '').trim();
    if (!name) return false;
    const ex = st.skills.find((k) => k.name === name);
    if (ex) { if (desc && !ex.desc) ex.desc = desc; return false; }
    st.skills.push(stamp(cx, { name, desc: String(desc || '').trim(), turn: cx.turn }));
    pushLog(st, '获得技能「' + name + '」' + (desc ? '：' + desc : ''), '★', cx);
    return true;
}

export function addRewardLog(st, text, kind, cx) {
    text = String(text || '').trim();
    if (!text) return false;
    if (st.rewardsLog.some((r) => r.text === text && r.turn === cx.turn)) return false;
    st.rewardsLog.push(stamp(cx, { turn: cx.turn, kind: kind || '', text }));
    if (st.rewardsLog.length > 40) st.rewardsLog = st.rewardsLog.slice(-40);
    return true;
}

// 把一段奖励文字里能认出来的东西全部发下去：物品×N、技能、权限；积分由 applyEffects 处理
export function grantFromText(st, str, cx) {
    if (!str) return 0;
    let n = 0;
    str = String(str);
    for (const r of str.matchAll(/([一-龥A-Za-z·]{2,12}?)\s*[×xX]\s*(\d{1,3})/g)) {
        if (addItem(st, r[1].replace(/^(和|与|及|还有|以及|获得|发放|奖励|存入|背包|的)+/, ''), r[2], '奖励', cx)) n += 1;
    }
    for (const r of str.matchAll(/(?:开启|获得|解锁|激活|授予|获取)(?:了)?\s*[「『【]?([^「」『』【】\n，,。；;：:、]{2,24}?(?:权限|特权|资格|功能|称号|头衔))[」』】]?/g)) {
        if (addPerk(st, r[1], '', null, cx)) n += 1;
    }
    for (const r of str.matchAll(/(?:权限|特权|称号|头衔)\s*[：:]\s*[「『【]?([^」』】\n，,。；;]{2,30})/g)) {
        if (addPerk(st, r[1], '', null, cx)) n += 1;
    }
    return n;
}

// 解析 "积分300 魅力+2 好感-10" 之类，sign=+1奖励 / -1惩罚（惩罚里已带符号则尊重）
export function applyEffects(st, str, sign, cx) {
    if (!str) return;
    let m;
    if (sign > 0) {
        grantFromText(st, str, cx);
        const reK = /技能\s*[：:]?\s*[「『"']?([^「」『』"'，,;；、。\s]{1,20})[」』"']?(?:[（(]([^）)]{0,80})[）)])?/g;
        while ((m = reK.exec(str))) addSkill(st, m[1], m[2] || '', cx);
    }
    const reP = /积分\s*([+-]?\d+)/g;
    while ((m = reP.exec(str))) {
        const dv = cleanNum(m[1]) * (m[1].match(/^[+-]/) ? 1 : sign >= 0 ? 1 : -1);
        st.points += dv;
        cx.ptT.push(dv);
    }
    const reS = /([一-龥A-Za-z·]{1,8}?)\s*([+-]\d+)/g;
    while ((m = reS.exec(str))) {
        const name = m[1].trim();
        if (name === '积分' || !name) continue;
        let s2 = st.stats.find((x) => x.name === name);
        if (!s2) { s2 = { name, val: 0 }; st.stats.push(s2); }
        s2.val += cleanNum(m[2]);
    }
}

export function completeTask(st, t, cx) {
    if (!t || t.status !== 'active') return;
    t.status = 'done';
    t.progress = 100;
    applyEffects(st, t.reward, 1, cx);
    const gain = t.type === '主线' ? 50 : t.type === '支线' ? 20 : 10;
    st.exp += gain;
    while (st.exp >= st.expMax) { st.exp -= st.expMax; st.level += 1; st.expMax = Math.round(st.expMax * 1.4); }
    pushLog(st, '完成「' + t.title + '」' + (t.reward ? '　奖励：' + t.reward : ''), '✓', cx);
    note(cx, { kind: 'done', title: t.title, reward: t.reward || '' });
}

const doneCount = (st) => st.tasks.filter((t) => t.status === 'done').length;
export const ACHIEVEMENTS = [
    { id: 'first', name: '初出茅庐', desc: '完成第一个任务', cond: (st) => doneCount(st) >= 1 },
    { id: 'five', name: '渐入佳境', desc: '完成5个任务', cond: (st) => doneCount(st) >= 5 },
    { id: 'fifteen', name: '任务达人', desc: '完成15个任务', cond: (st) => doneCount(st) >= 15 },
    { id: 'rich', name: '腰缠万贯', desc: '积分累积到1000', cond: (st) => st.points >= 1000 },
];
const hasAch = (st, id) => st.achievements.some((a) => a.id === id);

export function unlockAch(st, id, name, desc, bonus, cx) {
    if (hasAch(st, id)) return false;
    if (st.achievements.some((a) => a.name === name)) return false;
    st.achievements.push(stamp(cx, { id, name, desc: desc || '' }));
    if (bonus) st.points += bonus;
    cx.events.push('宿主解锁成就「' + name + '」' + (desc ? '（' + desc + '）' : '') + (bonus ? '，奖励积分' + bonus : ''));
    cx.notes = (cx.notes || []).concat([{ kind: 'achieve', name, desc: desc || '' }]);
    pushLog(st, '解锁成就「' + name + '」' + (bonus ? '　+' + bonus : ''), '★', cx);
    return true;
}
export function checkAchievements(st, cx) {
    if (!cx.s.achieveOn) return false;
    let ch = false;
    for (const a of ACHIEVEMENTS) if (!hasAch(st, a.id) && a.cond(st)) { unlockAch(st, a.id, a.name, a.desc, 50, cx); ch = true; }
    return ch;
}

// 限时任务到期判定。暂停中不判；每个 AI 楼结算完、每次手动操作后各判一次（原插件在生成提示词时判）。
export function checkExpiry(st, cx) {
    if (st.paused) return false;
    let ch = false;
    for (const t of st.tasks) {
        if (t.status !== 'active') continue;
        const r = tRemain(t, cx.turn);
        if (r === null || r > 0) continue;
        t.status = 'failed';
        applyEffects(st, t.penalty, -1, cx);
        pushLog(st, '任务「' + t.title + '」超时失败' + (t.penalty ? '　' + t.penalty : ''), '!', cx);
        if (cx.s.punishEvent) cx.events.push('任务「' + t.title + '」超时失败' + (t.penalty ? '（' + t.penalty + '）' : '') + '，请让剧情出现一个相称的不利后果' + (cx.s.penaltyPref ? '（后果倾向：' + cx.s.penaltyPref + '）' : ''));
        cx.notes = (cx.notes || []).concat([{ kind: 'fail', title: t.title }]);
        ch = true;
    }
    return ch;
}

export function drawCore(st, free, cx) {
    if (!st.gachaPool || !st.gachaPool.length) return null;
    if (!free) { if (st.points < cx.s.drawCost) return null; st.points -= cx.s.drawCost; }
    const tot = st.gachaPool.reduce((a, b) => a + (b.weight || 0), 0);
    let r = cx.random() * tot;
    let pick = st.gachaPool[0];
    for (const g of st.gachaPool) { r -= (g.weight || 0); if (r <= 0) { pick = g; break; } }
    if (/技能/.test(pick.effect || '') || /^技能/.test(pick.tier || '')) addSkill(st, pick.name, pick.desc || '', cx);
    else {
        const ex = st.bag.find((b) => b.name === pick.name);
        if (ex) ex.count = (ex.count || 1) + 1; else st.bag.push({ name: pick.name, count: 1, desc: pick.desc || '', effect: pick.effect || '' });
    }
    if (pick.tier === 'SSR' || pick.tier === 'UR') unlockAch(st, 'lucky', '欧皇附体', '抽到 SSR 及以上', 0, cx);
    pushLog(st, '抽奖 → ' + (pick.tier ? '[' + pick.tier + ']' : '') + pick.name + '（入背包）', '★', cx);
    cx.draws.push({ name: pick.name, tier: pick.tier || '', desc: pick.desc || '' });
    return pick;
}

export function note(cx, o) { cx.notes = (cx.notes || []).concat([o]); }
const newTaskOf = (st, cx, f) => ({ id: st.nextId++, type: f.type, owner: f.owner, title: f.title, desc: f.desc, cond: f.cond, reward: f.reward, penalty: f.penalty, limit: f.limit, progress: 0, status: 'active', turn: cx.turn, startTurn: cx.turn, ...(cx.floor != null ? { floor: cx.floor } : {}) });

function opProgress(st, op, cx, ext) {
    let t = findTask(st, op.ref);
    if (!t && op.alt != null) t = findTask(st, op.alt);
    if (!t && ext.proseTitle) {
        const host = hostOf(cx.s);
        t = newTaskOf(st, cx, { type: '支线', owner: host || '宿主', title: ext.proseTitle, desc: ext.proseTitle, cond: '', reward: '', penalty: '', limit: 0 });
        st.tasks.push(t);
        st.lastTaskTurn = cx.turn;
        pushLog(st, '（自动补建任务）' + t.title, '·', cx);
        note(cx, { kind: 'new', title: t.title });
    }
    if (!t) return false;
    const np = Math.max(0, Math.min(100, cleanNum(op.pct)));
    const same = np === t.progress;
    t.progress = np;
    if (op.why && !(same && /无进展|无变化|没有进展/.test(op.why))) pushLog(st, t.title + '：' + op.why, '', cx);
    if (t.status === 'active' && t.progress >= 100) completeTask(st, t, cx);
    return true;
}
function opFail(st, t, cx) {
    t.status = 'failed';
    applyEffects(st, t.penalty, -1, cx);
    pushLog(st, '任务「' + t.title + '」失败' + (t.penalty ? '　' + t.penalty : ''), '!', cx);
    if (cx.s.punishEvent) cx.events.push('任务「' + t.title + '」失败' + (t.penalty ? '（' + t.penalty + '）' : '') + '，请让剧情出现一个相称的不利后果' + (cx.s.penaltyPref ? '（后果倾向：' + cx.s.penaltyPref + '）' : ''));
    note(cx, { kind: 'fail', title: t.title });
}
function opNewTask(st, op, cx, ext) {
    const title = op.title || ext.proseTitle || '';
    if (!title) return false;
    const host = hostOf(cx.s);
    const t = newTaskOf(st, cx, { type: op.ty, owner: ((op.owner || host || '宿主').trim() || '宿主'), title, desc: op.desc, cond: op.cond, reward: op.reward, penalty: op.penalty, limit: op.limit });
    st.tasks.push(t);
    st.lastTaskTurn = cx.turn;
    pushLog(st, '新任务[' + t.type + ']「' + t.title + '」', '·', cx);
    note(cx, { kind: 'new', title: t.title, taskType: t.type });
    return true;
}
const fuzzy = (list, nm) => list.find((x) => x.name === nm) || list.find((x) => nm.indexOf(x.name) >= 0 || x.name.indexOf(nm) >= 0);

function opBuy(st, op, cx) {
    const it = fuzzy(st.shop, op.name);
    if (!it || st.points < it.price) return false;
    st.points -= it.price;
    const ex = st.bag.find((b) => b.name === it.name);
    if (ex) ex.count = (ex.count || 1) + 1; else st.bag.push({ name: it.name, count: 1, desc: it.desc, effect: it.effect || '' });
    pushLog(st, '（角色）购买「' + it.name + '」(-' + it.price + ')', '·', cx);
    return true;
}
function opUse(st, op, cx) {
    const b = fuzzy(st.bag, op.name);
    if (!b) return false;
    b.count = (b.count || 1) - (op.n || 1);
    if (b.count <= 0) st.bag.splice(st.bag.indexOf(b), 1);
    pushLog(st, '消耗物品「' + op.name + '」', '·', cx);
    return true;
}
function opGet(st, op, cx) {
    if (op.inline) return addItem(st, op.name, op.count, '', cx);
    if (!addItem(st, op.name, op.count, '', cx)) return false;
    const b = st.bag.find((x) => x.name === op.name);
    if (b && op.desc && !b.desc) b.desc = op.desc;
    return true;
}

// 数据块解析出的操作 → 状态。ext：{ proseTitle }。返回改动条数。
export function applyOps(st, ops, cx, ext = {}) {
    const prevP = st.points;
    let changed = 0;
    const hit = (v) => { if (v) changed += 1; };
    for (const op of ops) {
        switch (op.k) {
            case 'progress': hit(opProgress(st, op, cx, ext)); break;
            case 'done': { const t = findTask(st, op.ref); if (t && t.status === 'active') { completeTask(st, t, cx); changed += 1; } break; }
            case 'fail': { const t = findTask(st, op.ref); if (t && t.status === 'active') { opFail(st, t, cx); changed += 1; } break; }
            case 'newTask': hit(opNewTask(st, op, cx, ext)); break;
            case 'points': st.points += op.n; if (op.reason) pushLog(st, '积分' + op.raw + '（' + op.reason + '）', '', cx); changed += 1; break;
            case 'stat': {
                let s2 = st.stats.find((x) => x.name === op.name);
                if (!s2) { s2 = { name: op.name, val: 0 }; st.stats.push(s2); }
                s2.val += op.n; changed += 1; break;
            }
            case 'shopItem': {
                const it = { name: op.name, price: op.price, desc: op.desc, effect: op.effect };
                const ex = st.shop.find((x) => x.name === op.name);
                if (ex) Object.assign(ex, it); else st.shop.push(it);
                if (st.shop.length > 12) st.shop = st.shop.slice(-12);
                st.lastShopTurn = cx.turn; changed += 1; break;
            }
            case 'get': hit(opGet(st, op, cx)); break;
            case 'perk': hit(addPerk(st, op.name, op.desc, op.kind, cx)); break;
            case 'buy': hit(opBuy(st, op, cx)); break;
            case 'draw': {
                const pk = drawCore(st, false, cx);
                if (pk) { cx.events.push('抽奖抽中了' + (pk.tier ? pk.tier + '级' : '') + '「' + pk.name + '」' + (pk.desc ? '（' + pk.desc + '）' : '') + '，请把开箱那一刻写进正文'); changed += 1; }
                break;
            }
            case 'use': hit(opUse(st, op, cx)); break;
            case 'say': pushLog(st, op.text, '“', cx); note(cx, { kind: 'broadcast', text: op.text }); changed += 1; break;
            case 'chat':
                st.chat.push({ who: /系统/.test(op.who) ? 'sys' : 'char', name: op.who, text: op.text, turn: cx.turn, ...(cx.floor != null ? { floor: cx.floor } : {}) });
                if (st.chat.length > 80) st.chat = st.chat.slice(-80);
                changed += 1; break;
            case 'skill': hit(addSkill(st, op.name, op.desc, cx)); break;
            case 'limit': {
                const t = findTask(st, op.ref);
                if (t && t.status === 'active' && op.n > 0) { t.limit = op.n; t.startTurn = cx.turn; pushLog(st, t.title + '：时限改为 ' + op.n + ' 回合', '·', cx); changed += 1; }
                break;
            }
            case 'achieve': hit(unlockAch(st, op.key, op.name, op.desc, 100, cx)); break;
            default: break;
        }
    }
    for (const op of ops) if (op.k === 'gachaSet') { st.gachaPool = op.items.map((x) => ({ ...x })); st.lastGachaTurn = cx.turn; changed += 1; }
    for (const op of ops) {
        if (op.k === 'balance' && op.v !== prevP && op.v !== st.points) { st.points = op.v; pushLog(st, '积分同步为 ' + op.v + '（按数据块余额）', '·', cx); changed += 1; }
    }
    return changed;
}

// 频率门：距上个任务不足 freq 回合，或尚有主线/支线未完成，则本回合不发新任务。
export function allowNewTask(st, s, turn) {
    if (turn - st.lastTaskTurn < s.freq) return false;
    if (s.blockWhenUnfinished && st.tasks.some((t) => t.status === 'active' && (t.type === '主线' || t.type === '支线'))) return false;
    return true;
}

// ---------- 手动操作（界面 dispatch 的 type）。就地改 st，返回 { ok, reason, text }；失败时调用方丢弃副本。 ----------
const fail = (reason, text) => ({ ok: false, reason, text });
const OK = { ok: true };
const TYPES = ['主线', '支线', '日常'];
const taskById = (st, op) => {
    const t = st.tasks.find((x) => String(x.id) === String(op.id));
    if (!t) return { err: fail('no-task', '没有这个任务' + (op.expectTitle ? '「' + op.expectTitle + '」' : '')) };
    if (op.expectTitle != null && t.title !== op.expectTitle) return { err: fail('task-changed', '任务「' + op.expectTitle + '」在当前版本里不是同一个') };
    return { t };
};

function mTask(st, op, cx) {
    if (op.type === 'addTask') {
        const title = String(op.title || '').trim();
        if (!title) return fail('empty', '任务标题为空');
        const type = TYPES.includes(op.taskType) ? op.taskType : '支线';
        st.tasks.push(newTaskOf(st, cx, { type, owner: String(op.owner || '宿主').trim() || '宿主', title, desc: op.desc || '', cond: op.cond || '', reward: op.reward || '', penalty: op.penalty || '', limit: Math.max(0, cleanNum(op.limit)) }));
        st.lastTaskTurn = cx.turn;
        pushLog(st, '手动添加任务「' + title + '」', '·', cx);
        note(cx, { kind: 'new', title, taskType: type });
        return OK;
    }
    const { t, err } = taskById(st, op);
    if (err) return err;
    if (op.type === 'deleteTask') { st.tasks.splice(st.tasks.indexOf(t), 1); return OK; }
    if (op.type === 'completeTask') {
        if (t.status !== 'active') return fail('not-active', '任务「' + t.title + '」已不在进行中');
        completeTask(st, t, cx);
        return OK;
    }
    const p = op.patch || {};
    if (typeof p.title === 'string' && p.title.trim()) t.title = p.title.trim();
    if (TYPES.includes(p.taskType)) t.type = p.taskType;
    for (const k of ['desc', 'cond', 'reward', 'penalty']) if (typeof p[k] === 'string') t[k] = p[k];
    if (typeof p.owner === 'string' && p.owner.trim()) t.owner = p.owner.trim();
    if (p.limit != null && Number.isFinite(Number(p.limit))) { t.limit = Math.max(0, Math.round(Number(p.limit))); if (t.limit > 0 && !t.startTurn) t.startTurn = cx.turn; }
    if (p.progress != null && Number.isFinite(Number(p.progress))) t.progress = Math.max(0, Math.min(100, Math.round(Number(p.progress))));
    return OK;
}

function mUse(st, op, cx) {
    const b = st.bag.find((x) => x.name === op.name);
    if (!b) return fail('no-item', '当前版本的背包里没有「' + op.name + '」');
    const isTicket = /签|抽奖/.test(b.name);
    b.count = (b.count || 1) - 1;
    if (b.count <= 0) st.bag.splice(st.bag.indexOf(b), 1);
    if (isTicket) { pushLog(st, '使用「' + b.name + '」抽奖', '·', cx); drawCore(st, true, cx); return OK; }
    if (b.effect) applyEffects(st, b.effect, 1, cx);
    cx.uses.push({ name: b.name, desc: b.effect || b.desc || '' });
    pushLog(st, '使用道具「' + b.name + '」', '·', cx);
    return OK;
}
function mBuy(st, op, cx) {
    const it = st.shop.find((x) => x.name === op.name);
    if (!it) return fail('no-goods', '商城里没有「' + op.name + '」');
    if (st.points < it.price) return fail('no-points', '积分不够购买「' + it.name + '」（需' + it.price + '，现有' + st.points + '）');
    st.points -= it.price;
    const ex = st.bag.find((b) => b.name === it.name);
    if (ex) ex.count = (ex.count || 1) + 1; else st.bag.push({ name: it.name, count: 1, desc: it.desc, effect: it.effect || '' });
    pushLog(st, '购买「' + it.name + '」(-' + it.price + ')', '·', cx);
    return OK;
}

// 列表类增删：按名字定位，名字是跨 swipe 回放时判断「还成不成立」的依据。
function mList(st, op, cx) {
    const name = String(op.name || '').trim();
    switch (op.type) {
        case 'addItem': {
            if (!name) return fail('empty', '物品名为空');
            const c = Math.max(1, parseInt(op.count, 10) || 1);
            const ex = st.bag.find((b) => b.name === name);
            if (ex) ex.count = (ex.count || 1) + c; else st.bag.push({ name, count: c, desc: op.desc || '', effect: op.effect || '' });
            return OK;
        }
        case 'deleteItem': { const i = st.bag.findIndex((b) => b.name === name); if (i < 0) return fail('no-item', '背包里没有「' + name + '」'); st.bag.splice(i, 1); return OK; }
        case 'addShop': if (!name) return fail('empty', '商品名为空'); st.shop.push({ name, price: parseInt(op.price, 10) || 300, desc: op.desc || '', effect: String(op.effect || '').trim() }); return OK;
        case 'deleteShop': { const i = st.shop.findIndex((b) => b.name === name); if (i < 0) return fail('no-goods', '商城里没有「' + name + '」'); st.shop.splice(i, 1); return OK; }
        case 'addGacha': if (!name) return fail('empty', '奖品名为空'); st.gachaPool.push({ name, tier: String(op.tier || 'R').trim(), weight: parseInt(op.weight, 10) || 20, desc: op.desc || '', effect: String(op.effect || '').trim() }); return OK;
        case 'deleteGacha': { const i = st.gachaPool.findIndex((b) => b.name === name); if (i < 0) return fail('no-prize', '奖池里没有「' + name + '」'); st.gachaPool.splice(i, 1); return OK; }
        case 'addStat': if (!name) return fail('empty', '属性名为空'); st.stats.push({ name, val: parseInt(op.val, 10) || 0 }); return OK;
        case 'deleteStat': { const i = st.stats.findIndex((b) => b.name === name); if (i < 0) return fail('no-stat', '没有属性「' + name + '」'); st.stats.splice(i, 1); return OK; }
        case 'addSkill': return addSkill(st, name, op.desc || '', cx) ? OK : fail('exists', '技能「' + name + '」已存在或名称无效');
        case 'deleteSkill': { const i = st.skills.findIndex((b) => b.name === name); if (i < 0) return fail('no-skill', '没有技能「' + name + '」'); st.skills.splice(i, 1); return OK; }
        case 'addPerk': return addPerk(st, name, op.desc || '', null, cx) ? OK : fail('exists', '权限「' + name + '」已存在或名称无效');
        case 'deletePerk': { const i = st.perks.findIndex((b) => b.name === name); if (i < 0) return fail('no-perk', '没有权限「' + name + '」'); st.perks.splice(i, 1); return OK; }
        default: return null;
    }
}

const capChat = (st) => { if (st.chat.length > 80) st.chat = st.chat.slice(-80); };
const chatRow = (cx, o) => ({ ...o, turn: cx.turn, ...(cx.floor != null ? { floor: cx.floor } : {}) });
function mChat(st, op, cx) {
    switch (op.type) {
        case 'chatMe': st.chat.push(chatRow(cx, { who: 'me', text: String(op.text || '') })); capChat(st); return OK;
        case 'chatSys': {
            const n0 = cx.logged.length;
            if (op.block) applyOps(st, parseBlock(op.block).ops, cx, {});
            const notes = cx.logged.slice(n0).join('；');
            st.chat.push(chatRow(cx, { who: 'sys', text: op.text || '（系统没有回应）', note: notes }));
            capChat(st);
            if (op.toStory) cx.events.push('宿主刚在系统频道对系统说「' + String(op.ask || '').slice(0, 80) + '」，系统答「' + String(op.text || '').slice(0, 80) + '」' + (notes ? '（随之生效：' + notes + '）' : '') + '。这段对话只有宿主和系统知道，其他角色听不见，但宿主的言行可以受它影响');
            return OK;
        }
        case 'chatCall': {
            const host = hostOf(cx.s) || '他';
            st.chat.push(chatRow(cx, { who: 'call', text: String(op.text || '') }));
            capChat(st);
            cx.events.push('系统私下对 ' + host + ' 说：「' + op.text + '」——这句话只有 ' + host + ' 听得见，请让他在本回合对此有所反应（回嘴、照做、不理都行，按人设来），其他角色不知道');
            return OK;
        }
        case 'chatRp': for (const l of op.lines || []) st.chat.push(chatRow(cx, { who: l.who, name: l.name, text: l.text })); capChat(st); return OK;
        case 'chatClear': st.chat = []; return OK;
        default: return null;
    }
}

function mPause(st, op, cx) {
    if (op.type === 'pause') {
        if (st.paused) return fail('paused', '已经是暂停状态');
        st.paused = true;
        st.pausedAt = cx.turn;
        pushLog(st, '系统暂停：退出剧情，时限冻结', '·', cx);
        return OK;
    }
    if (!st.paused) return fail('not-paused', '当前没有暂停');
    const shift = Math.max(0, cx.turn - (st.pausedAt == null ? cx.turn : st.pausedAt));
    for (const t of st.tasks) if (t.status === 'active' && t.limit > 0) t.startTurn = (t.startTurn || t.turn || 0) + shift;
    st.lastTaskTurn += shift;
    st.lastShopTurn = (st.lastShopTurn || -99) + shift;
    st.lastGachaTurn = (st.lastGachaTurn || -99) + shift;
    st.paused = false;
    st.pausedAt = null;
    pushLog(st, '系统恢复（冻结了 ' + shift + ' 回合）', '·', cx);
    return OK;
}

// 一条手动 / 内部操作 → 状态。就地改 st（调用方传副本）。成功后补判到期与成就，与原插件生成提示词前的检查等价。
export function applyManual(st, op, cx) {
    let r;
    switch (op.type) {
        case 'buy': r = mBuy(st, op, cx); break;
        case 'use': r = mUse(st, op, cx); break;
        case 'draw':
            if (!st.gachaPool.length) r = fail('empty-pool', '奖池是空的');
            else if (!op.free && st.points < cx.s.drawCost) r = fail('no-points', '积分不够（需' + cx.s.drawCost + '）');
            else { drawCore(st, !!op.free, cx); r = OK; }
            break;
        case 'addTask': case 'editTask': case 'completeTask': case 'deleteTask': r = mTask(st, op, cx); break;
        case 'pause': case 'resume': r = mPause(st, op, cx); break;
        case 'applyBlock': {
            const n = applyOps(st, parseBlock(op.block).ops, cx, { proseTitle: '' });
            r = n ? OK : fail('nothing', '没有可生效的内容');
            break;
        }
        case 'setShop': st.shop = (op.items || []).map((x) => ({ ...x })); st.lastShopTurn = cx.turn; pushLog(st, '商城已刷新（' + st.shop.length + '件）', '·', cx); r = OK; break;
        case 'setGacha': st.gachaPool = (op.items || []).map((x) => ({ ...x })); pushLog(st, '奖池已重出（' + st.gachaPool.length + '件）', '·', cx); r = OK; break;
        default: r = mList(st, op, cx) || mChat(st, op, cx) || fail('unknown-op', '未知操作 ' + op.type);
    }
    if (r.ok) { checkExpiry(st, cx); checkAchievements(st, cx); }
    return r;
}
