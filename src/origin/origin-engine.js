// Origin 系统核心 · 对外接口 createOriginEngine(host)。
// 来源：vicliaaa/origin-sillytavern v1.5（作者已授权移植）。酒馆事件绑定、注入、收块全在这里，界面只调下面返回的方法。
// host：getContext() / generate(kind, prompt) / saveMetadata() / settings() / saveSettings() / notify({kind,text})；可选 legacyActive()。
// 状态共享只读：getState 返回冻结对象，修改一律走 dispatch（写时浅拷）。
import {
    ORIGIN_LEGACY_KEY, ORIGIN_META_KEY, cloneForWrite, createInitialState, deepFreeze, fillSettings, hash53, hostOf, isAiMsg, newSeed, seededRandom,
} from './origin-state.js';
import { pickTaskLine, parseGachaLines, parseRpChatLines, parseShopLines, splitBlock, splitReplyBlock } from './origin-parse.js';
import { createCx, applyManual } from './origin-apply.js';
import { buildInjection, injectInto } from './origin-inject.js';
import { flatChat, gachaPrompt, rpChatPrompt, shopPrompt, stripHtml, sysChatPrompt, taskPrompt } from './origin-gen.js';
import {
    bindPending, buildPath, createLedger, deserializeLedger, dropFloor, getEntry, makeEntry, pendingFor, recordOp, replay, serializeLedger, setEntry, truncate,
} from './origin-ledger.js';

export const ORIGIN_ENGINE_SYMBOL = Symbol.for('origin.engine');
const BUSY_MS = 60000;
// 界面允许通过 dispatch 发起的操作（计划里的列表 + 清空对话）；其余是核心内部用的。
const EXTERNAL = new Set(['buy', 'use', 'draw', 'addTask', 'editTask', 'completeTask', 'deleteTask', 'addItem', 'deleteItem', 'addShop', 'deleteShop', 'addGacha', 'deleteGacha', 'addStat', 'deleteStat', 'addSkill', 'deleteSkill', 'addPerk', 'deletePerk', 'setWorld', 'setDirection', 'pause', 'resume', 'reset', 'chatClear']);
const BY_INDEX = { buy: 'shop', use: 'bag', deleteItem: 'bag', deleteShop: 'shop', deleteGacha: 'gachaPool', deleteStat: 'stats', deleteSkill: 'skills', deletePerk: 'perks' };
const TASK_OPS = new Set(['completeTask', 'deleteTask', 'editTask']);

// 同一页面里 IGS 与天音共用一份核心：先加载的一方创建，后加载的一方复用，各自用 getSharedOriginEngine(host) 登记自己的 host。
// 核心实际用的 host 是「总开关开着的那一方」（都开时取先登记的）：只开一边时只有那一边的设置、生成通道、通知生效。
// 返回的引擎多一个 release()：本方卸载时调用，撤下本方 host 并重新同步。
export function getSharedOriginEngine(host) {
    const g = globalThis;
    let hub = g[ORIGIN_ENGINE_SYMBOL];
    if (!hub) {
        const hosts = [];
        const enabledOf = (h) => { try { return Boolean(h.settings() && h.settings().enabled); } catch (e) { return false; } };
        const pick = () => hosts.find(enabledOf) || hosts[0] || null;
        const call = (name) => (...args) => { const h = pick(); return h && typeof h[name] === 'function' ? h[name](...args) : undefined; };
        const proxy = {
            getContext: call('getContext'), settings: call('settings'), saveMetadata: call('saveMetadata'), saveSettings: call('saveSettings'),
            generate: call('generate'), notify: call('notify'), legacyActive: call('legacyActive'),
            // 任何一方在跑自己的后台请求时都不注入。
            isBackground: () => hosts.some((h) => { try { return typeof h.isBackground === 'function' && h.isBackground(); } catch (e) { return false; } }),
        };
        const engine = createOriginEngine(proxy);
        hub = { engine, hosts };
        g[ORIGIN_ENGINE_SYMBOL] = hub;
    }
    if (host && !hub.hosts.includes(host)) hub.hosts.push(host);
    const { engine, hosts } = hub;
    return Object.assign(Object.create(engine), {
        release: () => { const i = hosts.indexOf(host); if (i >= 0) hosts.splice(i, 1); if (!hosts.length) engine.stop(); else engine.sync(); },
    });
}

export function createOriginEngine(host) {
    let ledger = null;
    let meta = { world: '', direction: '' };
    let chatId = null;
    let blocked = null;
    let cache = null;
    let generating = null;
    let busyAt = 0;
    let warnedLegacy = false;
    let offs = [];
    const subs = new Set();

    const ctx = () => { try { return host.getContext(); } catch (e) { return null; } };
    const settings = () => fillSettings(host.settings());
    const idOf = (c) => {
        if (!c) return '';
        if (c.chatId) return String(c.chatId);
        if (typeof c.getCurrentChatId === 'function') { try { const id = c.getCurrentChatId(); if (id) return String(id); } catch (e) { /* */ } }
        return '';
    };
    const metaOf = (c) => {
        const m = c && (c.chatMetadata || c.chat_metadata);
        return m && typeof m === 'object' ? m : null;
    };
    const notify = (kind, text) => { try { if (host.notify) host.notify({ kind, text }); } catch (e) { /* */ } };
    // 宿主插件自己发起的后台请求（写词、副模型等）也会触发全局生成事件，不注入、不记生成类型。
    const isBackground = () => { try { return typeof host.isBackground === 'function' && Boolean(host.isBackground()); } catch (e) { return false; } };

    function load() {
        cache = null;
        blocked = null;
        const c = ctx();
        chatId = idOf(c);
        meta = { world: '', direction: '' };
        const md = metaOf(c);
        const raw = md ? md[ORIGIN_META_KEY] : undefined;
        if (raw == null) { ledger = createLedger(chatId, null); return; }
        const r = deserializeLedger(raw, chatId);
        if (!r.ok) {
            blocked = r.reason;
            ledger = createLedger(chatId, null);
            notify('warn', r.reason === 'origin-save-newer' ? '随身系统：本聊天的存档来自更新的版本，已拒绝读取，不会覆盖原数据' : '随身系统：本聊天的存档格式不合法，已拒绝读取，不会覆盖原数据');
            return;
        }
        ledger = r.ledger;
        meta = { world: r.world, direction: r.direction };
    }
    function ensure() {
        if (!ledger || idOf(ctx()) !== chatId) load();
    }
    // 不主动 saveChat：只把账本写进 chatMetadata，落盘交给宿主的防抖保存。
    function persist() {
        if (blocked || !ledger) return false;
        const md = metaOf(ctx());
        if (!md) return false;
        md[ORIGIN_META_KEY] = serializeLedger(ledger, meta);
        try { host.saveMetadata(); } catch (e) { /* */ }
        return true;
    }
    function compute(dropLast) {
        const c = ctx();
        return replay(ledger, buildPath(c && c.chat, isAiMsg, dropLast), settings());
    }
    function current() {
        ensure();
        if (!cache) {
            const rep = compute(false);
            const view = deepFreeze({ ...rep.state, world: meta.world, direction: meta.direction, turn: rep.turn, skipped: rep.skipped });
            cache = { rep, view };
        }
        return cache;
    }
    const getState = () => current().view;
    function emit(type, extra) {
        cache = null;
        const st = getState();
        for (const fn of [...subs]) { try { fn(st, { type, ...(extra || {}) }); } catch (e) { /* 订阅者出错不影响核心 */ } }
    }
    function subscribe(fn) { subs.add(fn); return () => subs.delete(fn); }

    function blocksOf(m, create) {
        const o = m && m.extra && m.extra.origin;
        if (o && typeof o === 'object' && o.blocks && typeof o.blocks === 'object') return o.blocks;
        if (!create) return {};
        if (!m.extra || typeof m.extra !== 'object') m.extra = {};
        m.extra.origin = { ...(m.extra.origin && typeof m.extra.origin === 'object' ? m.extra.origin : {}), blocks: {} };
        return m.extra.origin.blocks;
    }
    const swipeOf = (m) => (m && typeof m.swipe_id === 'number' ? m.swipe_id : 0);

    // ---------- 通知（只对真正新结算的楼 / 刚做的操作发，切 swipe 与重新加载不发） ----------
    function notifyResult(res) {
        if (!res) return;
        for (const n of res.notes || []) {
            if (n.kind === 'new') notify('task-new', '新任务：' + n.title);
            else if (n.kind === 'done') notify('task-done', '任务完成：' + n.title + (n.reward ? '（奖励：' + n.reward + '）' : ''));
            else if (n.kind === 'fail') notify('task-fail', '任务失败：' + n.title);
            else if (n.kind === 'broadcast') notify('broadcast', n.text);
            else if (n.kind === 'achieve') notify('achieve', '解锁成就：' + n.name + (n.desc ? '（' + n.desc + '）' : ''));
        }
        for (const d of res.draws || []) notify('gacha', '抽中' + (d.tier ? '[' + d.tier + ']' : '') + d.name);
        for (const k of res.skipped || []) notify('warn', k.text || '有一条操作在当前版本里不成立，已跳过');
    }
    function notifyFloor(idx) {
        const rep = current().rep;
        const i = rep.steps.findIndex((s) => s.type === 'floor' && s.id === idx);
        if (i >= 0) notifyResult(rep.results[i]);
    }

    // ---------- 收块：结算一个 AI 楼的当前 swipe ----------
    // 数据块原文存 message.extra.origin.blocks[swipe]，正文剪掉块；同一 swipe 重算复用种子，抽奖结果不变。
    function settleAt(idx) {
        const c = ctx();
        const chat = c && c.chat;
        const m = Array.isArray(chat) ? chat[idx] : null;
        if (!m || !isAiMsg(m) || m.is_system) return null;
        const sw = swipeOf(m);
        const text = String(m.mes || '');
        const sp = splitBlock(text);
        const existing = getEntry(ledger, idx, sw);
        let block = null;
        let prose = text;
        if (sp.block != null) {
            block = sp.block;
            prose = sp.text;
            blocksOf(m, true)[sw] = block;
            m.mes = sp.text;
            try { if (Array.isArray(m.swipes) && m.swipes[sw] != null) m.swipes[sw] = m.mes; } catch (e) { /* */ }
            try { if (typeof c.updateMessageBlock === 'function') c.updateMessageBlock(idx, m); } catch (e) { /* */ }
        } else {
            const stored = blocksOf(m, false)[sw];
            block = stored != null ? stored : (existing ? existing.block : null);
        }
        const entry = makeEntry(block, prose, existing ? existing.seed : newSeed());
        if (existing && existing.h === entry.h) return { changed: false, entry: existing };
        return { changed: true, entry: setEntry(ledger, idx, sw, entry) };
    }

    // ---------- 酒馆事件 ----------
    function onPromptReady(ev) {
        try {
            const s = settings();
            if (!s.enabled || !ev || ev.dryRun || !Array.isArray(ev.chat)) return;
            if (generating && generating.type === 'quiet') return;
            if (isBackground()) return;
            if (typeof host.legacyActive === 'function' && host.legacyActive()) {
                if (!warnedLegacy) { warnedLegacy = true; notify('warn', '检测到原版 Origin 扩展正在运行，请先停用原版；本核心不会重复注入'); }
                return;
            }
            ensure();
            if (blocked) return;
            const chat = (ctx() || {}).chat || [];
            const last = chat[chat.length - 1];
            // 重新生成 / 滑动时，酒馆会把最后一条 AI 楼从提示词里拿掉，状态也要退到它之前。
            const dropLast = Boolean(generating && (generating.type === 'swipe' || generating.type === 'regenerate') && last && !last.is_user);
            const path = buildPath(chat, isAiMsg, dropLast);
            const target = path.length ? path[path.length - 1].id : -1;
            if (bindPending(ledger, target)) persist();
            const rep = replay(ledger, path, s);
            const text = buildInjection({ st: rep.state, world: meta.world, direction: meta.direction, ...pendingFor(rep, target) }, s, rep.turn);
            injectInto(ev.chat, text); // 永远放在提示词最后一条，输入不在此清空（治 D1）
        } catch (e) { try { console.error('[Origin] 注入失败', e); } catch (_) { /* */ } }
    }
    function onStarted(type, params, dryRun) {
        if (dryRun === true || isBackground()) return;
        generating = { type: String(type || 'normal') };
    }
    const onEnded = () => { generating = null; };
    function onReceived(messageId) {
        if (!settings().enabled) return;
        ensure();
        if (blocked) return;
        const chat = (ctx() || {}).chat || [];
        const n = Number(messageId);
        const idx = Number.isInteger(n) && chat[n] ? n : chat.length - 1;
        const r = settleAt(idx);
        if (!r || !r.changed) return;
        persist();
        emit('settle', { messageId: idx });
        notifyFloor(idx);
    }
    function onSwiped(messageId) {
        if (!settings().enabled) return;
        ensure();
        if (blocked) return;
        const chat = (ctx() || {}).chat || [];
        const idx = Number(messageId);
        const m = chat[idx];
        // 切到已有 swipe 只切路径、不重算；还没有存档、且正文已有内容的才补结算一次
        if (m && isAiMsg(m) && !getEntry(ledger, idx, swipeOf(m)) && !generating && String(m.mes || '').trim()) {
            if (settleAt(idx)) persist();
        }
        emit('swipe', { messageId: idx });
    }
    function onDeleted() {
        if (!settings().enabled) return;
        ensure();
        if (blocked) return;
        const chat = (ctx() || {}).chat || [];
        truncate(ledger, chat.length);
        // 删的不是最后一楼时后面的楼整体前移：指纹对不上的楼丢掉旧存档，按现有正文重结算。
        for (let i = 0; i < chat.length; i += 1) {
            const m = chat[i];
            if (!isAiMsg(m) || m.is_system) continue;
            const e = getEntry(ledger, i, swipeOf(m));
            if (!e || !e.fp) continue;
            const sp = splitBlock(m.mes);
            if (hash53(String(sp.block != null ? sp.text : (m.mes || '')).trim()) !== e.fp) { dropFloor(ledger, i); settleAt(i); }
        }
        persist();
        emit('delete');
    }
    function onUpdated(messageId) {
        if (!settings().enabled || generating) return;
        ensure();
        if (blocked) return;
        const idx = Number(messageId);
        const r = settleAt(idx);
        if (r && r.changed) { persist(); emit('edit', { messageId: idx }); }
    }
    function onChatChanged() {
        generating = null;
        load();
        emit('load');
    }

    function detach() {
        for (const off of offs) { try { off(); } catch (e) { /* */ } }
        offs = [];
        generating = null;
    }
    function attach() {
        const c = ctx();
        const source = c && c.eventSource;
        const types = (c && (c.eventTypes || c.event_types)) || {};
        if (!source || typeof source.on !== 'function') return false;
        const bind = (name, handler) => {
            if (!name) return;
            source.on(name, handler);
            offs.push(() => (typeof source.removeListener === 'function' ? source.removeListener(name, handler) : source.off && source.off(name, handler)));
        };
        bind(types.CHAT_COMPLETION_PROMPT_READY, onPromptReady);
        bind(types.GENERATION_STARTED, onStarted);
        bind(types.GENERATION_ENDED, onEnded);
        bind(types.GENERATION_STOPPED, onEnded);
        bind(types.MESSAGE_RECEIVED, onReceived);
        bind(types.MESSAGE_SWIPED, onSwiped);
        bind(types.MESSAGE_DELETED, onDeleted);
        bind(types.MESSAGE_UPDATED, onUpdated);
        bind(types.MESSAGE_EDITED, onUpdated);
        bind(types.CHAT_CHANGED, onChatChanged);
        return true;
    }
    // 总开关变化后调用：开就挂监听并读存档，关就全部解绑。
    function sync() {
        const on = Boolean(settings().enabled);
        if (on && !offs.length) { if (attach()) load(); }
        else if (!on && offs.length) detach();
        return { attached: offs.length > 0 };
    }

    // ---------- 手动操作：校验 → 记账 → 存 → 通知 ----------
    // 在当前路径末端的状态上试算；成立才记进账本，记 after = 当时最后一楼的 id，随机种子随操作存。
    function commit(op) {
        ensure();
        if (blocked) return { ok: false, reason: blocked };
        const rep = current().rep;
        const chat = (ctx() || {}).chat || [];
        const after = chat.length - 1;
        const seed = newSeed();
        const cx = createCx({ turn: rep.turn, floor: after >= 0 ? after : null, s: settings(), random: seededRandom(seed) });
        const r = applyManual(cloneForWrite(rep.state), op, cx);
        if (!r.ok) return { ok: false, reason: r.reason, text: r.text };
        const rec = recordOp(ledger, op, after, seed);
        persist();
        emit('op', { opId: rec.id, op: op.type });
        const rep2 = current().rep;
        const i = rep2.steps.findIndex((s) => s.type === 'op' && s.rec.id === rec.id);
        if (i >= 0) notifyResult(rep2.results[i]);
        return { ok: true, opId: rec.id };
    }
    // 界面传下标或 id 都行；账本里一律存名字 / id + 期望标题，换 swipe 后对不上就跳过。
    function normalizeOp(op, st) {
        const out = { ...op };
        if (BY_INDEX[op.type] && out.name == null && out.index != null) {
            const it = st[BY_INDEX[op.type]][Number(out.index)];
            if (!it) return { err: { ok: false, reason: 'no-target', text: '没有找到要操作的对象' } };
            out.name = it.name;
        }
        if (TASK_OPS.has(op.type)) {
            let t = out.id != null ? st.tasks.find((x) => String(x.id) === String(out.id)) : null;
            if (!t && out.index != null) t = st.tasks[Number(out.index)];
            if (!t) return { err: { ok: false, reason: 'no-task', text: '没有找到这个任务' } };
            out.id = t.id;
            if (out.expectTitle == null) out.expectTitle = t.title;
        }
        if (op.type === 'draw') delete out.free;
        return { op: out };
    }
    function dispatch(op) {
        if (!op || !EXTERNAL.has(op.type)) return { ok: false, reason: 'unknown-op' };
        if (!settings().enabled) return { ok: false, reason: 'disabled' };
        ensure();
        if (blocked) return { ok: false, reason: blocked };
        if (op.type === 'setWorld' || op.type === 'setDirection') {
            const v = String(op.value == null ? '' : op.value).trim();
            if (op.type === 'setWorld') meta = { ...meta, world: v };
            // 原插件这里还会把 taskSource 置为 'direction'；注入只区分 'manual' 与其余，该值无任何效果，故不写全局设置。
            else meta = { ...meta, direction: v };
            persist();
            emit('meta');
            return { ok: true };
        }
        if (op.type === 'reset') {
            ledger = createLedger(chatId, null);
            meta = { world: '', direction: '' };
            persist();
            emit('reset');
            return { ok: true };
        }
        const n = normalizeOp(op, current().rep.state);
        if (n.err) return n.err;
        return commit(n.op);
    }

    // ---------- 生成请求：核心拼提示词，宿主 generate(kind, prompt) 发请求 ----------
    const BUSY = { ok: false, reason: 'busy' };
    function material(recentN, cut) {
        const c = ctx() || {};
        let cd = '';
        try { const ch = (c.characters || [])[c.characterId]; if (ch) cd = String(ch.description || '').slice(0, 500); } catch (e) { /* */ }
        const list = (Array.isArray(c.chat) ? c.chat : []).filter((m) => !m.is_system).slice(-recentN);
        return { cd, recent: list.map((m) => (m.is_user ? '我：' : '') + stripHtml(m.mes).slice(0, cut)).join('\n') };
    }
    async function runGen(kind, prompt) {
        try { return { out: String(await host.generate(kind, prompt) || '') }; } catch (e) { return { err: String((e && e.message) || e) }; }
    }
    async function guarded(fn) {
        if (!settings().enabled) return { ok: false, reason: 'disabled' };
        ensure();
        if (blocked) return { ok: false, reason: blocked };
        if (busyAt && Date.now() - busyAt < BUSY_MS) return BUSY;
        busyAt = Date.now();
        try { return await fn(); } finally { busyAt = 0; }
    }
    const view = () => { const v = current().view; return { st: v, world: v.world, direction: v.direction, turn: v.turn, s: settings() }; };

    function genTask() {
        return guarded(async () => {
            const v = view();
            const mt = material(4, 900);
            notify('info', '正在生成任务…');
            const r = await runGen('task', taskPrompt({ ...v, cd: mt.cd.slice(0, 400), recent: mt.recent.slice(-900) }));
            const line = r.out ? pickTaskLine(r.out) : '';
            if (!line) { notify('warn', '没生成出来，再点一次或手动添加'); return { ok: false, reason: r.err || 'no-result' }; }
            const res = commit({ type: 'applyBlock', block: line });
            if (res.ok) notify('info', '任务已派发');
            return res;
        });
    }
    function genShop() {
        return guarded(async () => {
            const v = view();
            notify('info', '正在刷新商城…');
            const r = await runGen('shop', shopPrompt({ ...v, cd: material(1, 0).cd.slice(0, 300) }));
            const items = parseShopLines(r.out);
            if (!items.length) { notify('warn', '刷新失败，重试'); return { ok: false, reason: r.err || 'no-result' }; }
            const res = commit({ type: 'setShop', items });
            if (res.ok) notify('info', '商城已刷新');
            return res;
        });
    }
    function genGacha() {
        return guarded(async () => {
            const v = view();
            notify('info', '正在重出奖池…');
            const r = await runGen('gacha', gachaPrompt({ ...v, cd: material(1, 0).cd.slice(0, 300) }));
            const items = parseGachaLines(r.out);
            if (!items.length) { notify('warn', '重出失败，重试'); return { ok: false, reason: r.err || 'no-result' }; }
            const res = commit({ type: 'setGacha', items });
            if (res.ok) notify('info', '奖池已刷新');
            return res;
        });
    }
    // 系统对话：先记下宿主这句（界面立刻能看到），再记系统的回复与随之生效的数据块；结果可进剧情。
    function sysChat(text) {
        const ask = String(text || '').trim();
        if (!ask) return Promise.resolve({ ok: false, reason: 'empty' });
        return guarded(async () => {
            commit({ type: 'chatMe', text: ask });
            const v = view();
            const mt = material(2, 350);
            const p = sysChatPrompt({ st: v.st, world: v.world, s: v.s, turn: v.turn, recent: mt.recent });
            const r = await runGen('sysChat', flatChat(p.system, p.msgs));
            if (r.err !== undefined) return commit({ type: 'chatSys', text: '（连接失败：' + r.err + '）', block: null, toStory: false, ask });
            const sp = splitReplyBlock(r.out);
            return commit({ type: 'chatSys', text: sp.text, block: sp.block && sp.block !== '无' ? sp.block : null, toStory: v.s.chatToStory !== false, ask });
        });
    }
    function rpChatGen() {
        return guarded(async () => {
            const v = view();
            if (!hostOf(v.s)) return { ok: false, reason: 'no-host' };
            const mt = material(3, 400);
            notify('info', '正在生成私聊…');
            const r = await runGen('rpChat', rpChatPrompt({ st: v.st, world: v.world, s: v.s, cd: mt.cd, recent: mt.recent }));
            const lines = parseRpChatLines(r.out);
            if (!lines.length) { notify('warn', '没生成出来，再试一次'); return { ok: false, reason: r.err || 'no-result' }; }
            return commit({ type: 'chatRp', lines });
        });
    }
    // 系统对角色喊话：下回合他会听到（事件挂在这条操作上，随下一个用户楼发出）。
    function rpChatCall(text) {
        const t = String(text || '').trim();
        if (!t) return Promise.resolve({ ok: false, reason: 'empty' });
        if (!settings().enabled) return Promise.resolve({ ok: false, reason: 'disabled' });
        return Promise.resolve(commit({ type: 'chatCall', text: t }));
    }

    // ---------- 全楼重算：按当前规则重解析每一楼（含已有存档的其他 swipe），种子沿用，手动操作保留并重新校验 ----------
    function recalcAll() {
        if (!settings().enabled) return { ok: false, reason: 'disabled' };
        ensure();
        if (blocked) return { ok: false, reason: blocked };
        const chat = (ctx() || {}).chat || [];
        truncate(ledger, chat.length);
        let n = 0;
        for (let i = 0; i < chat.length; i += 1) {
            const m = chat[i];
            if (!isAiMsg(m) || m.is_system) continue;
            n += 1;
            const cur = swipeOf(m);
            for (const e of [...ledger.entries.values()]) {
                if (e.messageId !== i || e.swipeId === cur) continue;
                const raw = Array.isArray(m.swipes) ? m.swipes[e.swipeId] : null;
                if (raw == null) continue;
                const sp = splitBlock(raw);
                setEntry(ledger, i, e.swipeId, makeEntry(sp.block != null ? sp.block : e.block, sp.block != null ? sp.text : String(raw), e.seed));
            }
            settleAt(i);
        }
        ledger.memo.clear();
        ledger.checkpoints = [];
        persist();
        emit('recalc', { floors: n });
        return { ok: true, floors: n };
    }

    // ---------- 旧存档导入：原插件的 chatMetadata.origin + 楼层 extra.originBlocks / originBase，不覆盖原数据 ----------
    const legacyOf = () => { const md = metaOf(ctx()); const o = md && md[ORIGIN_LEGACY_KEY]; return o && typeof o === 'object' ? o : null; };
    function legacyDetected() {
        ensure();
        if (!ledger || ledger.legacyDone) return false;
        if (legacyOf()) return true;
        return ((ctx() || {}).chat || []).some((m) => isAiMsg(m) && m.extra && m.extra.originBlocks && Object.keys(m.extra.originBlocks).length);
    }
    function legacyInitial(old, chat) {
        const st = createInitialState();
        const first = chat.find((m) => isAiMsg(m));
        let base = null;
        try { base = first && first.extra && first.extra.originBase ? JSON.parse(first.extra.originBase) : null; } catch (e) { base = null; }
        if (base) for (const k of ['points', 'level', 'exp', 'expMax', 'stats', 'tasks', 'bag', 'nextId']) if (base[k] !== undefined) st[k] = base[k];
        if (old) for (const k of ['shop', 'gachaPool', 'skills', 'perks', 'chat']) if (Array.isArray(old[k])) st[k] = old[k];
        return st;
    }
    function importLegacy() {
        ensure();
        if (blocked) return { ok: false, reason: blocked };
        if (!legacyDetected()) return { ok: false, reason: 'no-legacy' };
        const old = legacyOf();
        const chat = (ctx() || {}).chat || [];
        if (!ledger.entries.size && !ledger.ops.length && !ledger.initialCustom) {
            ledger.initial = deepFreeze(legacyInitial(old, chat));
            ledger.initialCustom = true;
        }
        if (old) meta = { world: meta.world || String(old.world || ''), direction: meta.direction || String(old.direction || '') };
        let floors = 0;
        for (let i = 0; i < chat.length; i += 1) {
            const m = chat[i];
            if (!isAiMsg(m) || m.is_system) continue;
            floors += 1;
            const cur = swipeOf(m);
            const ob = (m.extra && m.extra.originBlocks) || {};
            const ids = new Set([cur, ...Object.keys(ob).map(Number).filter(Number.isInteger)]);
            for (const sw of ids) {
                if (getEntry(ledger, i, sw)) continue;
                if (sw === cur) { settleAt(i); if (ob[sw] != null && getEntry(ledger, i, sw) && getEntry(ledger, i, sw).block == null) setEntry(ledger, i, sw, makeEntry(ob[sw], splitBlock(m.mes).text, getEntry(ledger, i, sw).seed)); continue; }
                const raw = Array.isArray(m.swipes) ? String(m.swipes[sw] || '') : '';
                const sp = splitBlock(raw);
                setEntry(ledger, i, sw, makeEntry(ob[sw] != null ? ob[sw] : sp.block, sp.block != null ? sp.text : raw, newSeed()));
            }
        }
        ledger.legacyDone = true;
        persist();
        emit('legacy', { floors });
        return { ok: true, floors };
    }
    function dismissLegacy() {
        ensure();
        if (!ledger) return { ok: false, reason: 'no-ledger' };
        ledger.legacyDone = true;
        persist();
        return { ok: true };
    }

    // 上一楼数据块情况，给面板顶部那一行用。
    function lastFloorStatus() {
        ensure();
        const chat = (ctx() || {}).chat || [];
        for (let i = chat.length - 1; i >= 0; i -= 1) {
            const m = chat[i];
            if (!isAiMsg(m)) continue;
            const e = getEntry(ledger, i, swipeOf(m));
            const stored = blocksOf(m, false)[swipeOf(m)];
            const blk = stored != null ? stored : (e ? e.block : null);
            const wroteNone = blk === '无';
            const has = Boolean(blk) && !wroteNone;
            return { has, lines: has ? String(blk).split('\n').filter((l) => l.trim()).length : 0, wroteNone };
        }
        return { has: false, lines: 0, wroteNone: false };
    }

    return {
        getState, subscribe, dispatch, genTask, genShop, genGacha, sysChat, rpChatGen, rpChatCall,
        recalcAll, importLegacy, legacyDetected, dismissLegacy, lastFloorStatus,
        start: sync, sync, stop: detach, reload: () => { load(); emit('load'); },
        isBlocked: () => blocked,
    };
}
