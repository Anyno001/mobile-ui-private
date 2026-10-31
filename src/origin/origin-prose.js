// Origin 系统核心 · 正文兜底解析。
// 来源：vicliaaa/origin-sillytavern v1.5 的 syncPointsFromProse / syncBagFromProse / syncSkillsFromProse / 奖励流水 / 阶段任务（作者已授权移植）。
// 分两步：extractProseFacts 只看文本、与状态无关，结果随楼存进账本；applyProseFacts 把事实叠到状态上。
import { addItem, addPerk, addRewardLog, addSkill, applyOps, completeTask, note, pushLog } from './origin-apply.js';
import { hostOf } from './origin-state.js';

function okTitle(t) {
    t = String(t || '').trim().replace(/^[「『【"']+|[」』】"'。.]+$/g, '').trim();
    return t && !/^(积分|奖励|惩罚|要求|条件|进度|完成|失败|发放|结算)/.test(t) && !/[×x]\s*\d/.test(t) && !/^[+-]?\d+$/.test(t) ? t : '';
}
export function extractProseTitle(text) {
    if (!text) return '';
    text = String(text);
    let m; let r;
    m = text.match(/任务[一二三四五六七八九十\d]{1,3}\s*[：:]\s*([^。！？\n】]{2,40})/); if (m && (r = okTitle(m[1]))) return r;
    m = text.match(/任务\s*[「『]([^」』\n]{2,30})[」』]/); if (m && (r = okTitle(m[1]))) return r;
    m = text.match(/【[^】]{0,10}任务(?!奖励|惩罚|进度|完成|要求|条件|结算|失败)[^：:】]{0,8}[：:]\s*([^】\n]{2,40})】/); if (m && (r = okTitle(m[1]))) return r;
    m = text.match(/任务(?!奖励|惩罚|进度|完成|要求|条件|结算|失败)\s*[：:]\s*([^。！？\n】]{2,40})/); if (m && (r = okTitle(m[1]))) return r;
    return '';
}
export function proseNewTasks(prose) {
    const out = [];
    if (!prose) return out;
    prose = String(prose);
    for (const m of prose.matchAll(/(主线|支线|日常)?\s*任务\s*阶段\s*([一二三四五六七八九十百零\d]+)\s*已?生成/g)) {
        const type = m[1] || '主线';
        const stage = m[2];
        const title = type + '任务·阶段' + stage;
        const after = prose.slice(m.index + m[0].length, m.index + m[0].length + 400);
        const d = after.match(/(?:任务要求|要求|需要|目标)[：:]?\s*([^。\n]{4,80})/);
        out.push({ type, title, desc: d ? d[1].trim() : '', stage });
    }
    return out;
}
export function proseCompletions(prose) {
    const out = [];
    if (!prose) return out;
    for (const m of String(prose).matchAll(/阶段\s*([一二三四五六七八九十百零\d]+)\s*(?:已达成|已完成)/g)) out.push(m[1]);
    return out;
}

const PREVIEW = /(任务奖励|奖励[：:]|完成后|达成后|可获得|将获得|即可获得)/;
const stripTags = (t) => String(t).replace(/<[^>]+>/g, ' ');

// 正文里和积分有关的事实：最后一个余额、各句的积分变动值（已按「扣除/惩罚」定好正负）。
function pointFacts(prose) {
    let bal = null;
    for (const r of prose.matchAll(/(?:积分余额|当前积分|剩余积分|积分)\s*[：:]\s*(\d{1,7})(?!\s*[%％])/g)) bal = parseInt(r[1], 10);
    const deltas = [];
    for (const seg of prose.split(/[。\n]/)) {
        if (!/(奖励发放|发放|到账|结算|已存入|存入|已获得|扣除|扣减|惩罚)/.test(seg)) continue;
        if (PREVIEW.test(seg) && !/(发放|存入|到账|已获得)/.test(seg)) continue;
        const neg = /(扣除|扣减|惩罚|扣)/.test(seg);
        for (const r of seg.matchAll(/积分\s*([+-]?\d{1,6})/g)) {
            let v = parseInt(r[1], 10);
            if (Number.isNaN(v)) continue;
            if (!/^[+-]/.test(r[1]) && neg) v = -v;
            deltas.push(v);
        }
    }
    return { bal: Number.isNaN(bal) ? null : bal, deltas };
}

function bagFacts(prose) {
    const out = [];
    for (const seg of prose.split(/[。\n]/)) {
        if (!/(奖励发放|奖励已发放|发放|已存入背包|存入背包|放入背包|已放入|到账|已获得|获得)/.test(seg)) continue;
        if (PREVIEW.test(seg) && !/(发放|存入|到账|已获得)/.test(seg)) continue; // 只是预告奖励，还没拿到
        for (const r of seg.matchAll(/([一-龥A-Za-z·]{2,12}?)\s*[×xX]\s*(\d{1,3})/g)) {
            const nm = r[1].replace(/^(和|与|及|还有|以及|获得|发放|奖励|存入|背包|的)+/, '').trim();
            const c = parseInt(r[2], 10) || 1;
            if (!nm || /积分|等级|回合|次|人|天|分钟|小时/.test(nm)) continue;
            out.push({ nm, c });
        }
    }
    return out;
}
function skillFacts(prose) {
    const out = [];
    for (const r of prose.matchAll(/(?:获得|解锁|习得|激活)(?:被动|主动)?技能\s*[「『【]([^」』】\n]{1,20})[」』】]/g)) {
        const d = prose.slice(r.index).match(/技能说明\s*[：:]\s*([^】\n。]{2,120})/);
        out.push({ name: r[1], desc: d ? d[1].trim() : '' });
    }
    return out;
}
function rewardFacts(plain) {
    const rewards = [];
    for (const r of plain.matchAll(/【\s*(任务奖励|奖励已发放|奖励发放|系统奖励|结算奖励|奖励结算|奖励)\s*[：:]\s*([^】\n]{1,200})】/g)) rewards.push({ text: r[2].trim(), kind: /发放|结算/.test(r[1]) ? '发放' : '预告' });
    for (const r of plain.matchAll(/(?:^|[。\n])\s*奖励(?:已)?发放\s*[：:]\s*([^。\n】]{1,200})/g)) rewards.push({ text: r[1].trim(), kind: '发放' });
    const perks = [];
    for (const q of plain.matchAll(/(?:开启|解锁|激活|授予)(?:了)?\s*[「『【]?([^「」『』【】\n，,。；;：:、]{2,24}?(?:权限|特权|资格|功能|称号|头衔))[」』】]?/g)) {
        const seg = plain.slice(Math.max(0, q.index - 40), q.index + 40);
        if (/(任务奖励|完成后|达成后|可获得|将获得|即可)/.test(seg) && !/(发放|已开启|已解锁|已激活)/.test(seg)) continue;
        perks.push(q[1]);
    }
    return { rewards, perks };
}

// 只看文本（text 为已剪掉数据块的正文，block 为本楼数据块原文）。结果为空的键不存，随楼落盘很小。
export function extractProseFacts(text, block) {
    text = String(text || '');
    const f = {};
    const title = extractProseTitle(text);
    if (title) f.title = title;
    const b = String(block || '');
    if (b && /(^|\n)\s*积分\|/.test(b)) f.hp = 1;
    if (b && /(^|\n)\s*获得\|/.test(b)) f.hg = 1;
    if (b && /新任务\|/.test(b)) f.hn = 1;
    const prose = stripTags(text);
    const pf = pointFacts(prose);
    if (pf.bal != null) f.bal = pf.bal;
    if (pf.deltas.length) f.deltas = pf.deltas;
    const rf = rewardFacts(prose);
    if (rf.rewards.length) f.rewards = rf.rewards;
    if (rf.perks.length) f.perks = rf.perks;
    const bag = bagFacts(prose);
    if (bag.length) f.bag = bag;
    const sk = skillFacts(prose);
    if (sk.length) f.skills = sk;
    const nt = proseNewTasks(text);
    if (nt.length) f.newTasks = nt;
    const pc = proseCompletions(text);
    if (pc.length) f.done = pc;
    return f;
}

function syncPoints(st, f, prevPoints, cx) {
    if (f.bal != null) {
        // 和注入给它的旧值一样、且数据块里已经报了变动 → 只是抄了旧值，不算数
        if (prevPoints != null && f.bal === prevPoints && f.hp) return;
        if (f.bal !== st.points) { st.points = f.bal; pushLog(st, '积分同步为 ' + f.bal + '（按正文余额）', '·', cx); }
        return;
    }
    if (f.hp) return;
    let ch = false;
    for (const v of f.deltas || []) {
        const ix = cx.ptT.indexOf(v);
        if (ix >= 0) { cx.ptT.splice(ix, 1); continue; }
        st.points += v;
        ch = true;
    }
    if (ch) pushLog(st, '积分按正文补记，现为 ' + st.points, '·', cx);
}

const PERK_IN_REWARD = /([^「」『』【】\n，,。；;：:、]{2,24}?(?:权限|特权|资格|功能|称号|头衔))(?:已)?(?:开启|解锁|激活)?/g;
function syncRewards(st, f, cx) {
    for (const r of f.rewards || []) addRewardLog(st, r.text, r.kind, cx);
    const mine = st.rewardsLog.filter((r) => r.turn === cx.turn);
    const pre = mine.filter((r) => r.kind === '预告');
    // 预告的奖励挂到本回合新建、还没有奖励字段的任务上，完成时统一按它发
    if (pre.length) for (const t of st.tasks) if (t.status === 'active' && !t.reward && t.turn === cx.turn) t.reward = pre[pre.length - 1].text;
    // 已发放的：权限/称号这类当场入栏（物品和积分由别处各自的兜底处理）
    for (const r of mine.filter((x) => x.kind === '发放')) for (const q of r.text.matchAll(PERK_IN_REWARD)) addPerk(st, q[1], '', null, cx);
    for (const name of f.perks || []) addPerk(st, name, '', null, cx);
}

function syncTasks(st, f, cx) {
    if (!f.hn) {
        for (const nt of f.newTasks || []) {
            if (st.tasks.some((t) => t.title === nt.title)) continue;
            for (const t of st.tasks) if (t.status === 'active' && /阶段/.test(t.title)) completeTask(st, t, cx);
            const t = { id: st.nextId++, type: nt.type, owner: hostOf(cx.s) || '宿主', title: nt.title, desc: nt.desc || nt.title, cond: nt.desc || '', reward: '', penalty: '', limit: 0, progress: 0, status: 'active', turn: cx.turn, startTurn: cx.turn, ...(cx.floor != null ? { floor: cx.floor } : {}) };
            st.tasks.push(t);
            st.lastTaskTurn = cx.turn;
            pushLog(st, '（按正文建任务）' + t.title, '·', cx);
            note(cx, { kind: 'new', title: t.title, taskType: t.type });
        }
    }
    for (const sg of f.done || []) {
        const t = st.tasks.find((x) => x.status === 'active' && x.title.indexOf('阶段' + sg) >= 0);
        if (t) completeTask(st, t, cx);
    }
}

// 一个 AI 楼的完整结算：数据块操作 → 正文积分 → 奖励流水/权限 → 背包/技能 → 阶段任务。暂停中整楼不结算。
export function applyFloor(st, { ops = [], facts = {} }, cx) {
    if (st.paused) return;
    const prevPoints = st.points;
    if (ops.length) applyOps(st, ops, cx, { proseTitle: facts.title || '' });
    syncPoints(st, facts, prevPoints, cx);
    syncRewards(st, facts, cx);
    if (!facts.hg) for (const it of facts.bag || []) addItem(st, it.nm, it.c, '按正文补记', cx);
    for (const k of facts.skills || []) addSkill(st, k.name, k.desc, cx);
    syncTasks(st, facts, cx);
}
