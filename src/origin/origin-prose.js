// Origin 系统核心 · 正文兜底解析。
// 来源：vicliaaa/origin-sillytavern v1.5 的 syncPointsFromProse / syncBagFromProse / syncSkillsFromProse / 奖励流水 / 阶段任务（作者已授权移植）。
// 分两步：extractProseFacts 只看文本、与状态无关，结果随楼存进账本；applyProseFacts 把事实叠到状态上。
import { addItem, addPerk, addRewardLog, addSkill, applyOps, completeTask, newTaskOf, note, pushLog } from './origin-apply.js';
import { hostOf } from './origin-state.js';
import { creditOrigin } from './origin-economy.js';

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

// 正文中的积分变动事实，已按「扣除/惩罚」定好正负；余额陈述不参与记账。
function pointFacts(prose) {
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
    return { deltas };
}

// 第二版正文积分（facts.pv = 2）：认「奖励积分 100 点」「获得 50 积分」「积分增加了 30」「积分+50」；
// 发布任务、列奖励栏、余额与价格不算。旧楼按存档时的版本回放，不重算。
const PT_RE = /积分\s*(增加了?|提升了?|上涨了?|增长了?|减少了?|扣除了?|扣减了?|降低了?)?\s*([+＋\-－])?\s*(\d{1,6})(?!\s*[%％])|(\d{1,6})\s*(?:点|个)?\s*积分/g;
const PT_GAIN = /(奖励|获得|得到|到账|发放|入账|存入|结算|赠送|嘉奖|奖赏|领取|收获|进账|返还)/;
// 不在完成句里时，光写「奖励」不算到账，要有实际收付的动词。
const PT_SETTLE = /(获得|得到|到账|发放|入账|存入|领取|进账|返还|扣除|扣减|没收|失去|损失)/;
const PT_LOSS =/(扣除|扣减|扣|惩罚|罚|失去|损失|减少|没收)/;
const PT_DONE = /(任务完成(?!后|时|即|则)|已完成|顺利完成|完成了|已达成|达成(?!后|时|即|则)|已发放|发放完毕|奖励发放|到账|已获得|入账|已存入|结算|任务失败|已扣除)/;
const PT_PREVIEW = /(发布|新任务|任务内容|任务目标|任务要求|完成条件|完成后|达成后|若|如果|可获得|将获得|即可|将会|将扣除|有机会|最高)/;
const PT_LABEL = /^\s*[【\[（(]?\s*(?:任务)?(?:奖励|失败惩罚|惩罚)\s*[】\]）)]?\s*[：:]/;
const PT_SKIP_BEFORE = /(当前|剩余|现有|余额|共有|累计|总计|合计|现为|变为|达到|需要?|花费|消耗|花了|价格|售价|价值|标价|需)\s*$/;
const PT_TASK_DONE = /任务[^。，,]{0,16}?(?:完成|达成)(?!后|时|即|则)/;
function pointFactsV2(prose) {
    const deltas = [];
    const taskDone = [];
    // 「任务完成！奖励：积分100」：同一行里紧跟在完成句后面、本身不是发布或预告的半句，算作已结算。
    let prev = null;
    for (const seg of prose.split(/(?<=[。！!？?\n])/)) {
        if (!seg.trim()) continue;
        const carried = prev && !PT_PREVIEW.test(seg) ? prev : null;
        const own = PT_DONE.test(seg) || (PT_TASK_DONE.test(seg) && !PT_PREVIEW.test(seg));
        prev = own && /[！!？?]$/.test(seg) ? seg : null;
        if (!seg.includes('积分') || /(不足|不够)/.test(seg)) continue;
        const done = own || !!carried;
        const taskSeg = PT_TASK_DONE.test(seg) || (carried && PT_TASK_DONE.test(carried));
        if (!done && (PT_PREVIEW.test(seg) || PT_LABEL.test(seg))) continue;
        for (const r of seg.matchAll(PT_RE)) {
            if (PT_SKIP_BEFORE.test(seg.slice(Math.max(0, r.index - 6), r.index))) continue;
            const verb = r[1] || '';
            const sign = r[2] || '';
            const v = parseInt(r[3] || r[4], 10);
            if (!v) continue;
            const neg = /^[-－]/.test(sign) || /(减少|扣除|扣减|降低)/.test(verb);
            if (!verb && !sign && !(done ? PT_GAIN.test(seg) || PT_LOSS.test(seg) : PT_SETTLE.test(seg))) continue;
            const loss = neg || (!verb && !sign && PT_LOSS.test(seg) && !/奖励/.test(seg));
            deltas.push(loss ? -v : v);
            if (!loss && taskSeg) taskDone.push(v);
        }
    }
    return { deltas, taskDone };
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
    f.pv = 2;
    const pf = pointFactsV2(prose);
    if (pf.deltas.length) f.deltas = pf.deltas;
    if (pf.taskDone.length) f.td = pf.taskDone;
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

// 第二版：正文写「任务完成，奖励积分 N」而数据块漏了完成行时，奖励正好是 N 的进行中任务只有一个就按完成结算（走任务奖励）。
// 数据块里的积分行与任务奖励已记进 cx.ptT，正文同号的一笔先抵一笔（数额对不上也抵），多出来的才补记。
const rewardPoints = (t) => (Number.isSafeInteger(t.approvedPoints) ? t.approvedPoints
    : [...String(t.reward || '').matchAll(/积分\s*\+?(\d+)/g)].reduce((n, m) => n + Number(m[1]), 0));
function syncPointsV2(st, f, cx) {
    for (const v of f.td || []) {
        if (cx.ptT.includes(v)) continue;
        const hit = st.tasks.filter((t) => t.status === 'active' && rewardPoints(t) === v);
        if (hit.length !== 1) continue;
        completeTask(st, hit[0], cx);
        pushLog(st, '（按正文判定完成）' + hit[0].title, '·', cx);
    }
    for (const v of f.deltas || []) {
        let ix = cx.ptT.indexOf(v);
        if (ix < 0) ix = cx.ptT.findIndex((x) => Math.sign(x) === Math.sign(v));
        if (ix >= 0) { cx.ptT.splice(ix, 1); continue; }
        const amount = creditOrigin(st, v, cx);
        pushLog(st, '积分' + (amount >= 0 ? '+' : '') + amount + '（按正文补记）', '·', cx);
    }
}
function syncPoints(st, f, cx) {
    if (f.pv === 2) return syncPointsV2(st, f, cx);
    if (f.hp) return;
    let ch = false;
    for (const v of f.deltas || []) {
        const ix = cx.ptT.indexOf(v);
        if (ix >= 0) { cx.ptT.splice(ix, 1); continue; }
        creditOrigin(st, v, cx);
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
            const t = newTaskOf(st, cx, { type: nt.type, owner: hostOf(cx.s) || '宿主', title: nt.title,
                desc: nt.desc || nt.title, cond: nt.desc || '', reward: '', penalty: '', limit: 0 });
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
    if (ops.length) applyOps(st, ops, cx, { proseTitle: facts.title || '' });
    syncPoints(st, facts, cx);
    syncRewards(st, facts, cx);
    if (!facts.hg) for (const it of facts.bag || []) addItem(st, it.nm, it.c, '按正文补记', cx);
    for (const k of facts.skills || []) addSkill(st, k.name, k.desc, cx);
    syncTasks(st, facts, cx);
}
