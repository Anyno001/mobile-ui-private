// Origin 系统核心 · 按楼账本（计划第 2 节）。
// 每个 messageId|swipeId 只存本楼数据块原文、解析出的操作、正文事实与随机种子；状态 = 初始状态 + 当前路径上每楼操作依次回放。
// 手动操作单独成条（after = 当时最后一楼的 id），叠在当前选中的 swipe 之上回放；回放逐条校验，不成立的跳过并写记录。
// 回放结果按「签名链」缓存：签名 = 初始状态 + 设置 + 路径上每一步的标识依次哈希，路径任一步不同则后续全部重算。
import { ORIGIN_CORE_VER, ORIGIN_SAVE_VERSION, cloneForWrite, createInitialState, deepFreeze, hash53, seededRandom } from './origin-state.js';
import { parseBlock } from './origin-parse.js';
import { applyFloor, extractProseFacts } from './origin-prose.js';
import { applyManual, checkAchievements, checkExpiry, createCx, pushLog } from './origin-apply.js';

export const CHECKPOINT_EVERY = 20;
const CHECKPOINT_KEEP = 6;
const MEMO_MAX = 800;
const EMPTY_ENTRY = { seed: 0, block: null, ops: [], facts: {}, h: 'e' };

export function floorKey(chatId, messageId, swipeId) {
    return `${chatId}|${messageId}|${Number(swipeId) || 0}`;
}

export function createLedger(chatId, initial) {
    return {
        chatId, initial: deepFreeze(initial || createInitialState()), initialCustom: Boolean(initial),
        entries: new Map(), ops: [], nextOpId: 1, memo: new Map(), checkpoints: [], rev: 0, legacyDone: false,
    };
}

// 数据块 + 已剪掉块的正文 → 一楼的存档条目。同一 swipe 重算时复用 seed，抽奖结果不变。
export function makeEntry(block, prose, seed) {
    const b = block == null ? null : String(block).trim();
    const ops = b && b !== '无' ? parseBlock(b).ops : [];
    const facts = extractProseFacts(prose, b);
    const fp = hash53(String(prose || '').trim());
    return { seed, block: b, ops, facts, fp, h: hash53(JSON.stringify([b, ops, facts, seed])) };
}
export function setEntry(ledger, messageId, swipeId, entry) {
    const e = { messageId, swipeId: Number(swipeId) || 0, ...entry };
    ledger.entries.set(floorKey(ledger.chatId, e.messageId, e.swipeId), e);
    ledger.rev += 1;
    return e;
}
export function getEntry(ledger, messageId, swipeId) {
    return ledger.entries.get(floorKey(ledger.chatId, messageId, swipeId)) || null;
}

// after：当时最后一楼的 id（-1 = 还没有任何楼）。boundTo：被哪一个用户楼的提示词带走（null = 还没发出去）。
export function recordOp(ledger, op, after, seed) {
    const rec = { id: ledger.nextOpId, after, seed, boundTo: null, op };
    ledger.nextOpId += 1;
    ledger.ops.push(rec);
    ledger.rev += 1;
    return rec;
}

// 删楼：该楼及之后的存档、挂在这些楼之后的手动操作一起回退；绑到被删用户楼的输入退回「未发出」。
export function truncate(ledger, keepCount) {
    for (const [k, e] of ledger.entries) if (e.messageId >= keepCount) ledger.entries.delete(k);
    ledger.ops = ledger.ops.filter((o) => o.after < keepCount);
    for (const o of ledger.ops) if (o.boundTo != null && o.boundTo >= keepCount) o.boundTo = null;
    ledger.rev += 1;
}
export function dropFloor(ledger, messageId) {
    for (const [k, e] of ledger.entries) if (e.messageId === messageId) ledger.entries.delete(k);
    ledger.rev += 1;
}

// 发出提示词时，把还没绑定的手动操作绑到本次的用户楼上；之后无论 roll 多少次都带同一批输入。
export function bindPending(ledger, targetId) {
    let changed = false;
    for (const o of ledger.ops) if (o.boundTo == null && o.after <= targetId) { o.boundTo = targetId; changed = true; }
    return changed;
}

export function settingsKey(s) {
    return JSON.stringify([s.bindTo, s.punishEvent, s.penaltyPref, s.achieveOn, s.drawCost]);
}

// ---------- 回放 ----------
// path：[{ id, kind:'ai'|'user'|'other', swipeId }]，当前聊天路径（每楼取当前选中的 swipe）。
function buildSteps(ledger, path) {
    const steps = [];
    let turn = 0;
    const push = (rec) => steps.push({ type: 'op', rec, turn, token: `o${rec.id}:${rec.after}` });
    for (const rec of ledger.ops) if (rec.after === -1) push(rec);
    for (const it of path) {
        if (it.kind === 'ai') {
            turn += 1;
            const entry = getEntry(ledger, it.id, it.swipeId) || EMPTY_ENTRY;
            steps.push({ type: 'floor', id: it.id, swipeId: it.swipeId, turn, entry, token: `f${it.id}:${it.swipeId}:${entry.h}` });
        }
        for (const rec of ledger.ops) if (rec.after === it.id) push(rec);
    }
    return { steps, turn };
}

function finish(st, cx, skipped) {
    return { state: deepFreeze(st), events: cx.events, uses: cx.uses, notes: cx.notes || [], draws: cx.draws, skipped: skipped || [], partial: false };
}

function stepOnce(prev, step, s) {
    if (step.type === 'floor') {
        const cx = createCx({ turn: step.turn, floor: step.id, s, random: seededRandom(step.entry.seed) });
        const st = cloneForWrite(prev);
        applyFloor(st, step.entry, cx);
        checkExpiry(st, cx);
        if (!st.paused) checkAchievements(st, cx);
        return finish(st, cx);
    }
    const rec = step.rec;
    const cx = createCx({ turn: step.turn, floor: rec.after >= 0 ? rec.after : null, s, random: seededRandom(rec.seed) });
    const st = cloneForWrite(prev);
    const r = applyManual(st, rec.op, cx);
    if (r.ok) return finish(st, cx);
    // 当前版本里这条操作不成立：丢弃副本，只在记录里写一行；切回原 swipe 时它会重新成立。
    const st2 = cloneForWrite(prev);
    const cx2 = createCx({ turn: step.turn, floor: cx.floor, s });
    pushLog(st2, '操作已跳过：' + (r.text || r.reason), '⚠', cx2);
    return finish(st2, cx2, [{ opId: rec.id, reason: r.reason, text: r.text || '' }]);
}

function remember(ledger, sig, res) {
    ledger.memo.set(sig, res);
    if (ledger.memo.size > MEMO_MAX) {
        const drop = ledger.memo.size - MEMO_MAX;
        let n = 0;
        for (const k of ledger.memo.keys()) { if (n >= drop) break; ledger.memo.delete(k); n += 1; }
    }
}
function saveCheckpoint(ledger, sig, turn, state) {
    if (ledger.checkpoints.some((c) => c.sig === sig)) return;
    ledger.checkpoints.push({ turn, sig, state });
    if (ledger.checkpoints.length > CHECKPOINT_KEEP) ledger.checkpoints.shift();
}

// 回放当前路径。命中缓存的前缀直接复用，只算后面的。返回 { state, turn, lastAi, steps, results, skipped }。
export function replay(ledger, path, s) {
    const { steps, turn } = buildSteps(ledger, path);
    const baseSig = hash53(ORIGIN_CORE_VER + settingsKey(s) + JSON.stringify(ledger.initial));
    const sigs = [];
    let acc = baseSig;
    for (const st of steps) { acc = hash53(acc + '>' + st.token); sigs.push(acc); }
    let lastAi = -1;
    for (let i = steps.length - 1; i >= 0; i -= 1) if (steps[i].type === 'floor') { lastAi = i; break; }
    let from = 0;
    let prev = ledger.initial;
    for (let i = steps.length - 1; i >= 0; i -= 1) {
        const m = ledger.memo.get(sigs[i]);
        if (!m) continue;
        if (!m.partial || i < lastAi) { from = i + 1; prev = m.state; break; }
    }
    for (let i = from; i < steps.length; i += 1) {
        const res = stepOnce(prev, steps[i], s);
        remember(ledger, sigs[i], res);
        if (steps[i].type === 'floor' && steps[i].turn % CHECKPOINT_EVERY === 0) saveCheckpoint(ledger, sigs[i], steps[i].turn, res.state);
        prev = res.state;
    }
    const results = steps.map((_, i) => ledger.memo.get(sigs[i]) || null);
    const skipped = [];
    for (const r of results) if (r && r.skipped.length) skipped.push(...r.skipped);
    return { state: prev, turn, lastAi, steps, results, skipped, sig: sigs.length ? sigs[sigs.length - 1] : baseSig };
}

// 提示词里要带的「本轮输入」：上一个 AI 楼结算出的事件（成就、失败惩罚、抽奖）+ 之后绑到 targetId 的手动操作。
export function pendingFor(rep, targetId) {
    const events = [];
    const uses = [];
    if (rep.lastAi >= 0 && rep.results[rep.lastAi]) events.push(...rep.results[rep.lastAi].events);
    for (let i = rep.lastAi + 1; i < rep.steps.length; i += 1) {
        const st = rep.steps[i];
        const res = rep.results[i];
        if (st.type !== 'op' || !res) continue;
        if (st.rec.boundTo != null && st.rec.boundTo !== targetId) continue;
        events.push(...res.events);
        uses.push(...res.uses);
    }
    return { pendingEvent: events, pendingUse: uses };
}

// ---------- 存档 ----------
// 只存每楼的块原文/操作/事实/种子、手动操作、最近几个检查点；不存逐楼整份状态。
export function serializeLedger(ledger, meta = {}) {
    const entries = [...ledger.entries.values()].map((e) => ({
        messageId: e.messageId, swipeId: e.swipeId, seed: e.seed, block: e.block, ops: e.ops, facts: e.facts, fp: e.fp,
    }));
    return {
        version: ORIGIN_SAVE_VERSION, core: ORIGIN_CORE_VER, chatId: ledger.chatId,
        initial: ledger.initialCustom ? ledger.initial : null,
        entries, ops: ledger.ops, nextOpId: ledger.nextOpId,
        checkpoints: ledger.checkpoints, legacyDone: ledger.legacyDone,
        world: meta.world || '', direction: meta.direction || '',
    };
}

const isNum = Number.isFinite;
function validEntry(e) {
    return e && Number.isInteger(e.messageId) && Number.isInteger(e.swipeId) && isNum(e.seed) && Array.isArray(e.ops) && e.facts && typeof e.facts === 'object';
}
function validOp(o) {
    return o && Number.isInteger(o.id) && Number.isInteger(o.after) && o.op && typeof o.op.type === 'string';
}

// 格式不合法或版本更新时拒收并返回原因，不覆盖原数据。
export function deserializeLedger(raw, chatId) {
    if (!raw || typeof raw !== 'object') return { ok: false, reason: 'origin-save-invalid' };
    if (Number(raw.version) > ORIGIN_SAVE_VERSION) return { ok: false, reason: 'origin-save-newer', version: raw.version };
    if (Number(raw.version) !== ORIGIN_SAVE_VERSION || !Array.isArray(raw.entries) || !Array.isArray(raw.ops)) return { ok: false, reason: 'origin-save-invalid' };
    const ledger = createLedger(chatId, raw.initial && typeof raw.initial === 'object' ? raw.initial : null);
    const dropped = [];
    for (const e of raw.entries) {
        if (!validEntry(e)) { dropped.push(e && e.messageId); continue; }
        const entry = { seed: e.seed, block: e.block == null ? null : String(e.block), ops: e.ops, facts: e.facts, fp: e.fp };
        entry.h = hash53(JSON.stringify([entry.block, entry.ops, entry.facts, entry.seed]));
        ledger.entries.set(floorKey(chatId, e.messageId, e.swipeId), { messageId: e.messageId, swipeId: e.swipeId, ...entry });
    }
    for (const o of raw.ops) {
        if (!validOp(o)) continue;
        ledger.ops.push({ id: o.id, after: o.after, seed: isNum(o.seed) ? o.seed : 0, boundTo: Number.isInteger(o.boundTo) ? o.boundTo : null, op: o.op });
    }
    ledger.nextOpId = Math.max(Number(raw.nextOpId) || 1, ...ledger.ops.map((o) => o.id + 1), 1);
    // 检查点的签名已含核心版本、设置、初始状态与整条路径前缀；版本不同时签名对不上，自然不命中。
    for (const c of Array.isArray(raw.checkpoints) ? raw.checkpoints : []) {
        if (!c || typeof c.sig !== 'string' || !c.state || typeof c.state !== 'object') continue;
        const state = deepFreeze(c.state);
        ledger.checkpoints.push({ turn: c.turn, sig: c.sig, state });
        ledger.memo.set(c.sig, { state, events: [], uses: [], notes: [], draws: [], skipped: [], partial: true });
    }
    ledger.legacyDone = raw.legacyDone === true;
    return { ok: true, ledger, dropped, world: String(raw.world || ''), direction: String(raw.direction || '') };
}

// 路径：当前聊天里每楼取选中的 swipe。dropLast = 生成时要被替换的最后一楼（重新生成 / 滑动）不算。
export function buildPath(chat, isAi, dropLast = false) {
    const list = Array.isArray(chat) ? chat : [];
    const end = dropLast ? list.length - 1 : list.length;
    const path = [];
    for (let i = 0; i < end; i += 1) {
        const m = list[i];
        path.push({ id: i, kind: isAi(m) ? 'ai' : (m && m.is_user ? 'user' : 'other'), swipeId: (m && typeof m.swipe_id === 'number') ? m.swipe_id : 0 });
    }
    return path;
}
