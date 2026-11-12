// Origin 系统核心 · 对外接口 createOriginEngine(host)。
// 来源：vicliaaa/origin-sillytavern v1.5（作者已授权移植）。酒馆事件绑定、注入、收块全在这里，界面只调下面返回的方法。
// host：getContext() / generate(kind, prompt) / saveMetadata() / settings() / saveSettings() / notify({kind,text})；可选 legacyActive()。
// 状态共享只读：getState 返回冻结对象，修改一律走 dispatch（写时浅拷）。
import {
    ORIGIN_LEGACY_KEY, ORIGIN_META_KEY, cloneForWrite, createInitialState, deepFreeze, fillSettings, hash53, hostOf, isAiMsg, newSeed, scaleOfRuleset, seededRandom, statFromPercent,
} from './origin-state.js';
import { pickTaskLine, parseGachaLines, parseRpChatLines, parseShopLines, splitBlock, splitReplyBlock } from './origin-parse.js';
import { createCx, applyManual } from './origin-apply.js';
import { buildInjection, injectInto } from './origin-inject.js';
import { flatChat, gachaPrompt, rpChatPrompt, shopPrompt, stripHtml, sysChatPrompt, taskPrompt } from './origin-gen.js';
import {
    bindPending, buildPath, compact, createLedger, removeFloors, deserializeLedger, dropFloor, getEntry, makeEntry, pendingFor, recordOp, relocateBase, replay, serializeLedger, setEntry, stepOnce, truncate,
} from './origin-ledger.js';
import { collectOriginGrants, economyContext, economyPlan, originCreditText } from './origin-economy.js';
import { anchorKey, pointFloors } from '../points/points-policy.js';

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
        // 可选字段（体系）：被选中的 host 自己提供就用它的，否则按登记顺序取第一个提供了的 host。
        const callOpt = (name) => (...args) => {
            const h = pick();
            const t = h && typeof h[name] === 'function' ? h : hosts.find((x) => typeof x[name] === 'function');
            return t ? t[name](...args) : undefined;
        };
        const proxy = {
            getContext: call('getContext'), settings: call('settings'), saveMetadata: call('saveMetadata'), saveSettings: call('saveSettings'),
            database: call('database'), wallet: call('wallet'), walletSnapshot: call('walletSnapshot'), spendingGate: call('spendingGate'),
            pointsEconomy: call('pointsEconomy'), ensurePointsFloor: call('ensurePointsFloor'),
            withPointsLock: (task) => {
                const h = pick();
                return typeof h?.withPointsLock === 'function' ? h.withPointsLock(task) : task();
            },
            generate: call('generate'), notify: call('notify'), legacyActive: call('legacyActive'), readRuleset: callOpt('readRuleset'),
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
    let database = null;
    let databaseState = null;
    let databaseTail = Promise.resolve();
    let databaseEpoch = 0;
    let pendingSave = null;
    let deferredEvents = [];
    let staging = null;
    let walletValue = 0;
    const databaseOf = () => typeof host.database === 'function' ? host.database() : null;

    const ctx = () => { try { return host.getContext(); } catch (e) { return null; } };
    const settings = () => fillSettings(host.settings());
    // 当前体系（宿主可选提供 readRuleset()，返回 coc7 或 dnd5e）；没提供、数值系统没开或读不到按 CoC。
    const ruleId = () => { try { return typeof host.readRuleset === 'function' && host.readRuleset() === 'dnd5e' ? 'dnd5e' : 'coc7'; } catch (e) { return 'coc7'; } };
    // 回放、手动操作用的设置：带上体系 id 与倍数；倍数进回放签名，旧档没有倍数快照的记录按它重放。
    const calcSettings = () => { const s = settings(); const id = ruleId(); return { ...s, ruleId: id, ruleScale: scaleOfRuleset(id) }; };
    // 记账时的体系倍数快照。
    const snapNow = () => ({ scale: scaleOfRuleset(ruleId()), cost: settings().drawCost });
    // 展示用状态：属性加成按当前体系显示（D&D 为属性点，CoC 为百分制）。
    const shown = (st, k = 1) => {
        if (k === 1) return st;
        return { ...st, stats: (st.stats || []).map((r) => ({ ...r, val: statFromPercent(r.name, r.val, k) })) };
    };
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
    // extra：结构化字段（抽奖带 tier / name / desc，给翻牌演出用）；只认 text 的宿主照旧。
    const notify = (kind, text, extra) => {
        if (staging) { staging.notifications.push([kind, text, extra]); return; }
        try { if (host.notify) host.notify({ kind, text, ...(extra || {}) }); } catch (e) { /* */ }
    };
    // 宿主插件自己发起的后台请求（写词、副模型等）也会触发全局生成事件，不注入、不记生成类型。
    const isBackground = () => { try { return typeof host.isBackground === 'function' && Boolean(host.isBackground()); } catch (e) { return false; } };

    function load() {
        databaseEpoch += 1;
        database = databaseOf();
        pendingSave = null;
        deferredEvents = [];
        databaseState = null;
        if (database) return loadDatabase();
        return loadMetadata();
    }
    function loadMetadata() {
        cache = null;
        blocked = null;
        const c = ctx();
        chatId = idOf(c);
        meta = { world: '', direction: '' };
        const md = metaOf(c);
        const raw = md ? md[ORIGIN_META_KEY] : undefined;
        if (raw == null) { ledger = createLedger(chatId, null); remember(); return; }
        const r = deserializeLedger(raw, chatId);
        if (!r.ok) {
            blocked = r.reason;
            ledger = createLedger(chatId, null);
            notify('warn', r.reason === 'origin-save-newer' ? '随身系统：本聊天的存档来自更新的版本，已拒绝读取，不会覆盖原数据' : '随身系统：本聊天的存档格式不合法，已拒绝读取，不会覆盖原数据');
            return;
        }
        ledger = r.ledger;
        meta = { world: r.world, direction: r.direction };
        remember();
    }
    function ensure() {
        if (!ledger || idOf(ctx()) !== chatId) load();
    }
    // 不主动 saveChat：只把账本写进 chatMetadata，落盘交给宿主的防抖保存。
    function persist() {
        if (staging) { staging.dirty = true; return true; }
        if (blocked || !ledger) return false;
        const md = metaOf(ctx());
        if (!md) return false;
        md[ORIGIN_META_KEY] = serializeLedger(ledger, meta);
        try { host.saveMetadata(); } catch (e) { /* */ }
        return true;
    }
    function compute(dropLast) {
        const c = ctx();
        return replay(ledger, buildPath(c && c.chat, isAiMsg, dropLast), calcSettings());
    }
    function current() {
        ensure();
        if (database && typeof host.walletSnapshot === 'function') {
            const read = host.walletSnapshot();
            if (read?.ok && Number.isSafeInteger(read.balance)) walletValue = read.balance;
        }
        const wallet = database ? walletValue : 0;
        const k = scaleOfRuleset(ruleId());
        if (!cache || cache.wallet !== wallet || cache.k !== k) {
            const rep = compute(false);
            const view = deepFreeze({ ...shown(rep.state, k), points: rep.state.points + wallet, world: meta.world, direction: meta.direction, turn: rep.turn, skipped: rep.skipped });
            cache = { rep, view, wallet, k };
        }
        return cache;
    }
    const getState = () => current().view;
    // 本核心自己的属性加成 [{ name, val }]（只读，同一状态返回同一数组引用）；未启用、没存档、读档被拒时为空。只读自己的 st.stats，不读 IGS。
    const EMPTY_STATS = Object.freeze([]);
    const rawStats = () => {
        try {
            if (!settings().enabled) return EMPTY_STATS;
            ensure();
            if (blocked) return EMPTY_STATS;
            return current().rep.state.stats || EMPTY_STATS;
        } catch (e) { return EMPTY_STATS; }
    };
    function emit(type, extra) {
        if (staging) { staging.events.push([type, extra]); cache = null; return; }
        cache = null;
        const st = getState();
        for (const fn of [...subs]) { try { fn(st, { type, ...(extra || {}) }); } catch (e) { /* 订阅者出错不影响核心 */ } }
    }
    function subscribe(fn) { subs.add(fn); return () => subs.delete(fn); }

    function adoptDatabase(raw) {
        const restored = deserializeLedger(raw, chatId);
        if (!restored.ok || restored.dropped.length) return { ok: false, reason: restored.reason || 'origin-database-invalid' };
        ledger = restored.ledger;
        meta = { world: restored.world, direction: restored.direction };
        cache = null;
        return { ok: true };
    }
    function databaseRaw() {
        const s = settings();
        const rules = Object.fromEntries(['bindTo', 'punishEvent', 'penaltyPref', 'achieveOn', 'drawCost'].map((key) => [key, s[key]]));
        return serializeLedger(ledger, { ...meta, rules });
    }
    function databaseLease() {
        const owner = ctx();
        const id = idOf(owner);
        const messages = owner?.chat;
        const metadata = metaOf(owner);
        const epoch = databaseEpoch;
        const store = database;
        return () => {
            const current = ctx();
            return Boolean(id) && settings().enabled && idOf(current) === id && current?.chat === messages
                && metaOf(current) === metadata && databaseEpoch === epoch && databaseOf() === store;
        };
    }
    function pathLease(allowAppend = false) {
        const chat = (ctx() || {}).chat || [];
        const path = chat.map((message) => {
            const text = String(message?.mes || '');
            return { message, swipe: swipeOf(message), text, split: splitBlock(text) };
        });
        return () => {
            const currentChat = (ctx() || {}).chat || [];
            return (allowAppend ? currentChat.length >= path.length : currentChat.length === path.length)
                && path.every(({ message, swipe, text, split }, i) => currentChat[i] === message && swipeOf(message) === swipe
                    && (String(message?.mes || '') === text || (split.block != null && message?.mes === split.text
                        && (blocksOf(message, false)[swipe] === split.block || (ledger?.base && i <= ledger.base.floor)))));
        };
    }
    async function readWallet(options) {
        let value;
        try { value = await host.wallet(options); } catch { return { ok: false, reason: 'origin-wallet-unavailable' }; }
        if (value?.ok === false) return value;
        const amount = typeof value === 'number' ? value : value?.balance;
        if (!Number.isSafeInteger(amount)) return { ok: false, reason: 'origin-wallet-unavailable' };
        walletValue = amount;
        return { ok: true, balance: amount };
    }
    function databaseFailure(result) {
        blocked = result?.reason || 'origin-database-write-failed';
        notify('warn', `随身系统保存未完成：${blocked}`);
        return { ok: false, reason: blocked, text: `随身系统保存未完成：${blocked}` };
    }
    function loadDatabase() {
        chatId = idOf(ctx());
        ledger = createLedger(chatId);
        meta = { world: '', direction: '' };
        cache = null;
        blocked = 'origin-database-loading';
        remember();
        const alive = databaseLease();
        const store = database;
        const run = async () => {
            if (!alive()) return { ok: false, reason: 'request-stale' };
            let read = await store.load({ shouldStart: alive });
            if (!alive()) return { ok: false, reason: 'request-stale' };
            if (!read.ok) return databaseFailure(read);
            if (!read.raw) {
                const old = metaOf(ctx())?.[ORIGIN_META_KEY];
                const raw = old == null ? databaseRaw() : old;
                const restored = adoptDatabase(raw);
                if (!restored.ok) return databaseFailure(restored);
                const intent = store.prepare(read, databaseRaw());
                read = await store.commit(intent, { shouldStart: alive });
                if (!alive()) return { ok: false, reason: 'request-stale' };
                if (!read.ok) { ledger = createLedger(chatId); cache = null; return databaseFailure(read); }
            }
            const restored = adoptDatabase(read.raw);
            if (!restored.ok) return databaseFailure(restored);
            databaseState = read;
            const wallet = await readWallet();
            if (!alive()) return { ok: false, reason: 'request-stale' };
            if (!wallet.ok) return databaseFailure(wallet);
            blocked = null;
            remember();
            emit('load');
            return { ok: true };
        };
        databaseTail = databaseTail.then(run, run).catch((error) => alive()
            ? databaseFailure({ reason: 'origin-database-load-failed' }) : { ok: false, reason: 'request-stale' });
        return databaseTail;
    }
    function publishDatabase(job, verified) {
        if (job.published) return job.result || { ok: true };
        job.published = true;
        ledger = job.ledger;
        meta = job.meta;
        known = job.known;
        cache = null;
        databaseState = verified;
        pendingSave = null;
        blocked = null;
        for (const [type, extra] of job.events) emit(type, extra);
        if (!job.events.length) emit('saved');
        for (const args of job.notifications) notify(...args);
        for (const action of job.afterCommit) action();
        drainDatabaseEvents();
        return job.result || { ok: true };
    }
    async function saveDatabase(job) {
        let verified;
        try { verified = await database.commit(job.intent, { shouldStart: job.alive }); }
        catch { verified = { ok: false, reason: 'origin-database-write-failed' }; }
        if (!job.ownerAlive()) return { ok: false, reason: 'request-stale' };
        if (!job.alive()) { pendingSave = job; return databaseFailure({ reason: 'origin-database-path-changed' }); }
        if (!verified.ok) { pendingSave = job; return databaseFailure(verified); }
        return publishDatabase(job, verified);
    }
    async function recoverDatabaseBranch(job) {
        if (!job.ownerAlive()) return { ok: false, reason: 'request-stale' };
        const requestedPath = pathLease(true);
        const alive = () => job.ownerAlive() && requestedPath();
        let present = database.read({ intent: job.intent, fresh: true });
        if (!present.ok) return databaseFailure(present);
        const parent = job.intent.record?.payload.parent ?? job.intent.revision;
        if (present.revision !== job.intent.revision && present.revision !== parent) {
            return databaseFailure({ reason: 'origin-database-conflict' });
        }
        if (present.incomplete) {
            present = await database.commit(job.intent, { shouldStart: alive });
            if (!present.ok) return databaseFailure(present);
        }
        const wallet = await readWallet({ intent: job.intent });
        if (!alive()) return databaseFailure({ reason: 'origin-database-path-changed' });
        if (!wallet.ok) return databaseFailure(wallet);
        const previous = { ledger, meta, cache, known, blocked };
        const effects = { events: [], notifications: [], afterCommit: [], dirty: false };
        let recovered;
        try {
            const restored = adoptDatabase(present.raw);
            if (!restored.ok) return databaseFailure(restored);
            known = present.revision === job.intent.revision ? job.known : job.beforeKnown;
            blocked = null;
            staging = effects;
            onDeleted();
            recalcAll();
            const intent = database.prepare(present, databaseRaw());
            if (!intent.ok) return intent;
            const writtenPath = pathLease(true);
            recovered = { ...effects, events: [['recover']], notifications: [], intent, ledger, meta, known,
                beforeKnown: previous.known, wallet: wallet.balance, result: { ok: true, recovered: true },
                alive: () => job.ownerAlive() && writtenPath() };
        } finally {
            staging = null;
            ({ ledger, meta, cache, known, blocked } = previous);
        }
        Object.assign(job, recovered);
        return saveDatabase(job);
    }
    function drainDatabaseEvents() {
        if (blocked || pendingSave || !deferredEvents.length) return;
        const waiting = deferredEvents;
        deferredEvents = [];
        for (const event of waiting) queueDatabase(event.fn, event);
    }
    function queueDatabase(fn, event = null) {
        ensure();
        const ownerAlive = event?.ownerAlive || databaseLease();
        const requestedPath = event?.requestedPath || pathLease(Boolean(event));
        const run = async () => {
            if (!ownerAlive() || !requestedPath()) return { ok: false, reason: 'request-stale' };
            if (blocked || pendingSave || !databaseState) {
                if (event) deferredEvents.push({ fn, ownerAlive, requestedPath });
                return { ok: false, reason: blocked || 'origin-database-unavailable', ...(event ? { deferred: true } : {}) };
            }
            const read = database.read();
            if (!read.ok) return databaseFailure(read);
            if (read.revision !== databaseState.revision) return databaseFailure({ reason: 'origin-database-conflict' });
            const wallet = await readWallet();
            if (!ownerAlive() || !requestedPath()) return { ok: false, reason: 'request-stale' };
            if (!wallet.ok) return databaseFailure(wallet);
            if (host.pointsEconomy?.() === true) {
                const messages = (ctx() || {}).chat || [];
                for (const floor of pointFloors(messages).filter(f => !f.floorId)) {
                    const saved = await host.ensurePointsFloor(floor.messageId);
                    if (!ownerAlive() || !requestedPath()) return { ok: false, reason: 'request-stale' };
                    if (!saved?.ok) return databaseFailure(saved || { reason: 'points-floor-save-failed' });
                }
            }
            const pointsBefore = current().rep.state.points;
            const previous = { ledger, meta, cache, known };
            const copy = deserializeLedger(databaseRaw(), chatId);
            if (!copy.ok) return databaseFailure(copy);
            ledger = copy.ledger;
            meta = { ...meta };
            cache = null;
            const effects = { events: [], notifications: [], afterCommit: [], dirty: false };
            let job;
            try {
                staging = effects;
                const result = fn();
                if (result?.ok === false) return result;
                if (current().rep.state.points < pointsBefore && typeof host.spendingGate === 'function') {
                    const allowed = host.spendingGate();
                    if (allowed?.ok === false) return allowed;
                }
                const intent = database.prepare(databaseState, databaseRaw());
                if (!intent.ok) return intent;
                const writtenPath = pathLease(true);
                job = { ...effects, intent, result, ledger, meta, known, beforeKnown: previous.known,
                    wallet: wallet.balance, ownerAlive, alive: () => ownerAlive() && writtenPath() };
            } finally {
                staging = null;
                ({ ledger, meta, cache, known } = previous);
            }
            return saveDatabase(job);
        };
        const locked = () => typeof host.withPointsLock === 'function' ? host.withPointsLock(run) : run();
        databaseTail = databaseTail.then(locked, locked).catch(() => ownerAlive()
            ? databaseFailure({ reason: 'origin-database-write-failed' }) : { ok: false, reason: 'request-stale' });
        return databaseTail;
    }
    function retrySave() {
        if (!database) return Promise.resolve({ ok: true, skipped: true });
        const job = pendingSave;
        if (!job) return load();
        const run = async () => {
            if (job.published) return job.result || { ok: true };
            if (!job.alive()) return recoverDatabaseBranch(job);
            const present = database.read({ intent: job.intent, fresh: true });
            if (!present.ok) return databaseFailure(present);
            if (present.revision !== job.intent.revision) {
                const wallet = await readWallet({ intent: job.intent });
                if (!job.alive()) return { ok: false, reason: 'request-stale' };
                if (!wallet.ok || wallet.balance !== job.wallet) return databaseFailure({ reason: wallet.reason || 'origin-wallet-changed' });
            }
            return saveDatabase(job);
        };
        const locked = () => typeof host.withPointsLock === 'function' ? host.withPointsLock(run) : run();
        databaseTail = databaseTail.then(locked, locked);
        return databaseTail;
    }
    const savedAction = (fn) => (...args) => databaseOf() ? queueDatabase(() => fn(...args)) : fn(...args);
    const savedEvent = (fn) => (...args) => databaseOf() ? queueDatabase(() => fn(...args), {}) : fn(...args);
    const commitSaved = (op) => databaseOf() ? queueDatabase(() => commit(op)) : commit(op);
    async function whenSaved() {
        let pending;
        do { pending = databaseTail; await pending; } while (pending !== databaseTail);
    }

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
            else if (n.kind === 'points') notify('info', originCreditText(n));
            else if (n.kind === 'fail') notify('task-fail', '任务失败：' + n.title);
            else if (n.kind === 'broadcast') notify('broadcast', n.text);
            else if (n.kind === 'achieve') notify('achieve', '解锁成就：' + n.name + (n.desc ? '（' + n.desc + '）' : ''));
        }
        for (const d of res.draws || []) notify('gacha', '抽中' + (d.tier ? '[' + d.tier + ']' : '') + d.name, { tier: d.tier || '', name: d.name || '', desc: d.desc || '' });
        for (const k of res.skipped || []) notify('warn', k.text || '有一条操作在当前版本里不成立，已跳过');
    }
    function notifyFloor(idx) {
        const rep = current().rep;
        const i = rep.steps.findIndex((s) => s.type === 'floor' && s.id === idx);
        if (i >= 0) notifyResult(rep.results[i]);
    }

    // ---------- 收块：结算一个 AI 楼的当前 swipe ----------
    // 数据块原文存 message.extra.origin.blocks[swipe]，正文剪掉块；同一 swipe 重算复用种子，抽奖结果不变。
    function settleAt(idx, { legacy = false } = {}) {
        const c = ctx();
        const chat = c && c.chat;
        const m = Array.isArray(chat) ? chat[idx] : null;
        if (!m || !isAiMsg(m) || m.is_system) return null;
        // 已并进底稿的楼不再结算（改它、切它的回复都不影响状态）。
        if (ledger.base && idx <= ledger.base.floor) return null;
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
        if (existing?.economy) return { changed: false, entry: existing };
        if (database) entry.wallet = existing?.wallet ?? walletValue;
        if (!existing && !legacy && staging && host.pointsEconomy?.() === true) {
            const anchor = pointFloors(chat).find(f => f.messageId === idx);
            if (!anchor?.floorId) throw new Error('origin-no-anchor');
            entry.economy = economyPlan(`origin:${chatId}:${anchorKey(anchor)}`, { floorId: anchor.floorId, swipeId: anchor.swipeId });
            const before = replay(ledger, buildPath(chat.slice(0, idx), isAiMsg), calcSettings());
            const grants = collectOriginGrants(ledger, chat, entry.economy.id);
            stepOnce(before.state, { type: 'floor', id: idx, turn: before.turn + 1, entry }, calcSettings(), { chat, grants });
        }
        return { changed: true, entry: setEntry(ledger, idx, sw, entry, snapNow()) };
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
            remember();
            const chat = (ctx() || {}).chat || [];
            const last = chat[chat.length - 1];
            // 重新生成 / 滑动时，酒馆会把最后一条 AI 楼从提示词里拿掉，状态也要退到它之前。
            const dropLast = Boolean(generating && (generating.type === 'swipe' || generating.type === 'regenerate') && last && !last.is_user);
            const path = buildPath(chat, isAiMsg, dropLast);
            const target = path.length ? path[path.length - 1].id : -1;
            if (!database && bindPending(ledger, target)) persist();
            if (database) current();
            const cs = calcSettings();
            const rep = replay(ledger, path, cs);
            const st = shown(database ? { ...rep.state, points: rep.state.points + walletValue } : rep.state, cs.ruleScale);
            const text = buildInjection({ st, world: meta.world, direction: meta.direction, ...pendingFor(rep, target) }, { ...s, ruleId: cs.ruleId }, rep.turn);
            injectInto(ev.chat, text);
            if (database) {
                const ids = new Set(ledger.ops.filter((rec) => rec.boundTo == null && rec.after <= target).map((rec) => rec.id));
                if (ids.size) queueDatabase(() => {
                    let changed = false;
                    for (const rec of ledger.ops) {
                        if (ids.has(rec.id) && rec.boundTo == null && rec.after <= target) {
                            rec.boundTo = target;
                            changed = true;
                        }
                    }
                    if (changed) persist();
                    return { ok: true };
                });
            }
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
        remember();
        const chat = (ctx() || {}).chat || [];
        const n = Number(messageId);
        const idx = Number.isInteger(n) && chat[n] ? n : chat.length - 1;
        const r = settleAt(idx);
        if (!r || !r.changed) return;
        emit('settle', { messageId: idx });
        notifyFloor(idx);
        compactOld(idx);
        persist();
    }
    // 正文指纹（与 makeEntry 的 fp 同算法），给底稿当锚点。
    function fpAt(i) {
        const m = ((ctx() || {}).chat || [])[i];
        if (!m) return '';
        const sp = splitBlock(m.mes);
        return hash53(String(sp.block != null ? sp.text : (m.mes || '')).trim());
    }
    // 楼层保留：超出的旧楼并进底稿，消息里存的数据块原文一并清掉（聊天文件变小）。
    function compactOld(through) {
        const c = ctx();
        const messages = (c && c.chat) || [];
        const chat = Number.isInteger(through) ? messages.slice(0, through + 1) : messages;
        const cut = compact(ledger, buildPath(chat, isAiMsg, false), settings(), settings().keepFloors, fpAt);
        if (cut < 0) return;
        const cleanup = () => {
            for (let i = 0; i <= cut; i += 1) {
                const m = chat[i];
                if (m && m.extra && m.extra.origin) delete m.extra.origin;
            }
        };
        if (staging) staging.afterCommit.push(cleanup);
        else cleanup();
        cache = null;
    }
    function onSwiped(messageId) {
        if (!settings().enabled) return;
        ensure();
        if (blocked) return;
        remember();
        const chat = (ctx() || {}).chat || [];
        const idx = Number(messageId);
        const m = chat[idx];
        // 切到已有 swipe 只切路径、不重算；还没有存档、且正文已有内容的才补结算一次
        if (m && isAiMsg(m) && !getEntry(ledger, idx, swipeOf(m)) && !generating && String(m.mes || '').trim()) {
            if (settleAt(idx)) persist();
        }
        emit('swipe', { messageId: idx });
    }
    // 上次见到的楼层对象（浅拷引用）。删楼事件只给新长度，靠它找出删的是哪几楼。
    let known = [];
    const remember = () => { known = ((ctx() || {}).chat || []).slice(); };
    // 删掉的是中间连续一段：返回 { d, k }；删的是末尾或认不出时返回 null。
    function deletedGap(chat) {
        const n = Math.min(chat.length, known.length);
        let d = 0;
        while (d < n && chat[d] === known[d]) d += 1;
        if (d >= chat.length) return null;
        const j = known.indexOf(chat[d], d + 1);
        if (j < 0) return null;
        const k = j - d;
        for (let i = d; i < chat.length && i + k < known.length; i += 1) if (chat[i] !== known[i + k]) return null;
        return { d, k };
    }
    function onDeleted() {
        if (!settings().enabled) return;
        ensure();
        if (blocked) return;
        const chat = (ctx() || {}).chat || [];
        const gap = deletedGap(chat);
        if (gap) {
            // 删的是中间几楼：这几楼连同挂在其后的手动操作一起删，后面的楼带着存档、种子、手动操作整体前移。
            removeFloors(ledger, gap.d, gap.k);
        } else {
            // 认不出删了哪几楼（例如引擎关着时删过）：底稿按锚点找回位置，再按长度截断。
            relocateBase(ledger, fpAt, chat.length);
            truncate(ledger, chat.length);
        }
        truncate(ledger, chat.length);
        // 兜底：指纹对不上的楼丢掉旧存档，按现有正文重结算；认不出删了哪几楼时，没有存档的 AI 楼也补结算一次。
        const from = ledger.base ? ledger.base.floor + 1 : 0;
        for (let i = from; i < chat.length; i += 1) {
            const m = chat[i];
            if (!isAiMsg(m) || m.is_system) continue;
            const e = getEntry(ledger, i, swipeOf(m));
            if (!e) { if (!gap && String(m.mes || '').trim()) settleAt(i); continue; }
            if (!e.fp) continue;
            const sp = splitBlock(m.mes);
            if (hash53(String(sp.block != null ? sp.text : (m.mes || '')).trim()) !== e.fp) { dropFloor(ledger, i); settleAt(i); }
        }
        remember();
        persist();
        emit('delete');
    }
    function onUpdated(messageId) {
        if (!settings().enabled || generating) return;
        ensure();
        if (blocked) return;
        remember();
        const idx = Number(messageId);
        const r = settleAt(idx);
        if (r && r.changed) { persist(); emit('edit', { messageId: idx }); }
    }
    function onChatChanged() {
        generating = null;
        const loaded = load();
        if (!database) emit('load');
        return loaded;
    }

    function detach() {
        databaseEpoch += 1;
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
        bind(types.MESSAGE_RECEIVED, savedEvent(onReceived));
        bind(types.MESSAGE_SWIPED, savedEvent(onSwiped));
        bind(types.MESSAGE_DELETED, savedEvent(onDeleted));
        bind(types.MESSAGE_UPDATED, savedEvent(onUpdated));
        bind(types.MESSAGE_EDITED, savedEvent(onUpdated));
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
        const wallet = database ? walletValue : undefined;
        const anchor = pointFloors(chat).at(-1);
        if (staging && host.pointsEconomy?.() === true && !anchor?.floorId) return { ok: false, reason: 'origin-no-anchor' };
        const economy = staging && host.pointsEconomy?.() === true
            ? economyPlan(`origin:${chatId}:op:${ledger.nextOpId}`, { floorId: anchor.floorId, swipeId: anchor.swipeId }) : null;
        const cx = createCx({ turn: rep.turn, floor: after >= 0 ? after : null, s: calcSettings(), scale: scaleOfRuleset(ruleId()), random: seededRandom(seed), wallet,
            economy: economyContext(economy, economy ? { chat, grants: collectOriginGrants(ledger, chat) } : undefined) });
        const r = applyManual(cloneForWrite(rep.state), op, cx);
        if (!r.ok) return { ok: false, reason: r.reason, text: r.text };
        const rec = recordOp(ledger, op, after, seed, wallet, economy, snapNow());
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
    const view = () => { const v = current().view; return { st: v, world: v.world, direction: v.direction, turn: v.turn, s: calcSettings() }; };

    function genTask() {
        return guarded(async () => {
            const v = view();
            const mt = material(4, 900);
            notify('info', '正在生成任务…');
            const r = await runGen('task', taskPrompt({ ...v, cd: mt.cd.slice(0, 400), recent: mt.recent.slice(-900) }));
            const line = r.out ? pickTaskLine(r.out) : '';
            if (!line) { notify('warn', '没生成出来，再点一次或手动添加'); return { ok: false, reason: r.err || 'no-result' }; }
            const res = await commitSaved({ type: 'applyBlock', block: line });
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
            const res = await commitSaved({ type: 'setShop', items });
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
            const res = await commitSaved({ type: 'setGacha', items });
            if (res.ok) notify('info', '奖池已刷新');
            return res;
        });
    }
    // 系统对话：先记下宿主这句（界面立刻能看到），再记系统的回复与随之生效的数据块；结果可进剧情。
    function sysChat(text) {
        const ask = String(text || '').trim();
        if (!ask) return Promise.resolve({ ok: false, reason: 'empty' });
        return guarded(async () => {
            const asked = await commitSaved({ type: 'chatMe', text: ask });
            if (!asked.ok) return asked;
            const v = view();
            const mt = material(2, 350);
            const p = sysChatPrompt({ st: v.st, world: v.world, s: v.s, turn: v.turn, recent: mt.recent });
            const r = await runGen('sysChat', flatChat(p.system, p.msgs));
            if (r.err !== undefined) return commitSaved({ type: 'chatSys', text: '（连接失败：' + r.err + '）', block: null, toStory: false, ask });
            const sp = splitReplyBlock(r.out);
            return commitSaved({ type: 'chatSys', text: sp.text, block: sp.block && sp.block !== '无' ? sp.block : null, toStory: v.s.chatToStory !== false, ask });
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
            return commitSaved({ type: 'chatRp', lines });
        });
    }
    // 系统对角色喊话：下回合他会听到（事件挂在这条操作上，随下一个用户楼发出）。
    function rpChatCall(text) {
        const t = String(text || '').trim();
        if (!t) return Promise.resolve({ ok: false, reason: 'empty' });
        if (!settings().enabled) return Promise.resolve({ ok: false, reason: 'disabled' });
        return Promise.resolve(commitSaved({ type: 'chatCall', text: t }));
    }

    // ---------- 全楼重算：按当前规则重解析每一楼（含已有存档的其他 swipe），种子沿用，手动操作保留并重新校验 ----------
    function recalcAll() {
        if (!settings().enabled) return { ok: false, reason: 'disabled' };
        ensure();
        if (blocked) return { ok: false, reason: blocked };
        const chat = (ctx() || {}).chat || [];
        truncate(ledger, chat.length);
        let n = 0;
        for (let i = ledger.base ? ledger.base.floor + 1 : 0; i < chat.length; i += 1) {
            const m = chat[i];
            if (!isAiMsg(m) || m.is_system) continue;
            n += 1;
            const cur = swipeOf(m);
            for (const e of [...ledger.entries.values()]) {
                if (e.messageId !== i || e.swipeId === cur) continue;
                const raw = Array.isArray(m.swipes) ? m.swipes[e.swipeId] : null;
                if (raw == null) continue;
                const sp = splitBlock(raw);
                if (e.economy) continue;
                setEntry(ledger, i, e.swipeId, { ...makeEntry(sp.block != null ? sp.block : e.block, sp.block != null ? sp.text : String(raw), e.seed), ...(e.wallet === undefined ? {} : { wallet: e.wallet }) }, snapNow());
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
    // 面板每次重绘都会问一次：按聊天与楼数缓存，不每次扫整个聊天。
    let legacyMemo = null;
    function legacyDetected() {
        ensure();
        if (!ledger || ledger.legacyDone) return false;
        if (legacyOf()) return true;
        const chat = (ctx() || {}).chat || [];
        if (legacyMemo && legacyMemo.ledger === ledger && legacyMemo.len === chat.length) return legacyMemo.hit;
        const hit = chat.some((m) => isAiMsg(m) && m.extra && m.extra.originBlocks && Object.keys(m.extra.originBlocks).length);
        legacyMemo = { ledger, len: chat.length, hit };
        return hit;
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
                if (sw === cur) { settleAt(i, { legacy: true }); if (ob[sw] != null && getEntry(ledger, i, sw) && getEntry(ledger, i, sw).block == null) setEntry(ledger, i, sw, makeEntry(ob[sw], splitBlock(m.mes).text, getEntry(ledger, i, sw).seed), snapNow()); continue; }
                const raw = Array.isArray(m.swipes) ? String(m.swipes[sw] || '') : '';
                const sp = splitBlock(raw);
                setEntry(ledger, i, sw, makeEntry(ob[sw] != null ? ob[sw] : sp.block, sp.block != null ? sp.text : raw, newSeed()), snapNow());
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
        getState, rawStats, subscribe, dispatch: savedAction(dispatch), genTask, genShop, genGacha, sysChat, rpChatGen, rpChatCall,
        recalcAll: savedAction(recalcAll), importLegacy: savedAction(importLegacy), legacyDetected,
        dismissLegacy: savedAction(dismissLegacy), lastFloorStatus, whenSaved, retrySave,
        start: sync, sync, stop: detach, reload: () => {
            const loaded = load(); if (!database) emit('load'); return loaded;
        },
        isBlocked: () => blocked,
    };
}
