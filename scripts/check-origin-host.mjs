import assert from 'node:assert/strict';

// 金手指宿主层与界面：设置规范化不改入参、host 字段齐全、后台请求标记、两边共用一个核心与 release 撤下、
// 假聊天上的完整流程（派任务、结算数据块、注入、积分不足）、冻结状态下渲染不原地改、表单、备份与桌面登记。
let passed = 0;
const check = async (name, run) => {
    try { await run(); passed += 1; } catch (error) { console.error(`FAIL ${name}`); throw error; }
};

const memory = new Map();
globalThis.localStorage = {
    getItem: key => (memory.has(key) ? memory.get(key) : null),
    setItem: (key, value) => { memory.set(key, String(value)); },
    removeItem: key => { memory.delete(key); },
};
globalThis.window = globalThis;

const ENGINE_KEY = Symbol.for('origin.engine');
const settingsModule = await import('../src/origin-settings.js');
const { ORIGIN_SETTINGS_KEY, loadOriginSettings, normalizeOriginSettings, saveOriginSettings, originBoundRole } = settingsModule;
const { createOriginHost, isTianyinBackground, originLegacyActive, runTianyinBackground, startOriginHost, trackBackgroundCalls } = await import('../src/origin-host.js');
const { renderOriginPage, visibleOriginTabs } = await import('../src/origin-views.js');
const { renderOriginSettings } = await import('../src/origin-settings-view.js');
const { ORIGIN_FORMS, readOriginSheet, renderOriginSheet } = await import('../src/origin-forms.js');
const { parseBackupData } = await import('../src/settings-backup-validate.js');
const { PLUGIN_LOCAL_STORAGE_KEYS } = await import('../src/storage.js');
const { PHONE_UI_PAGES } = await import('../src/interactive-scene-constants.js');
const { DESKTOP_ICON_IDS } = await import('../src/desktop-icon-storage.js');
const { DESKTOP_APPS } = await import('../src/desktop-layout.js');
const { renderPhoneDesktop } = await import('../src/interactive-scene-views.js');
const { API_ROUTE_MODULES } = await import('../src/api-routes.js');
const { appNameOf, appSloganOf } = await import('../src/app-names.js');

const enable = patch => { memory.set(ORIGIN_SETTINGS_KEY, JSON.stringify({ ...normalizeOriginSettings(null), enabled: true, ...patch })); };
const disable = () => memory.delete(ORIGIN_SETTINGS_KEY);

// 最小酒馆上下文：事件源、聊天、元数据、生成接口。
function fakeContext() {
    const handlers = new Map();
    const ctx = {
        chatId: 'chat-1', chatMetadata: {}, chat: [], characters: [{ name: '林', description: '测试角色' }], characterId: 0,
        eventTypes: {
            CHAT_COMPLETION_PROMPT_READY: 'prompt', GENERATION_STARTED: 'started', GENERATION_ENDED: 'ended', GENERATION_STOPPED: 'stopped',
            MESSAGE_RECEIVED: 'received', MESSAGE_SWIPED: 'swiped', MESSAGE_DELETED: 'deleted', MESSAGE_UPDATED: 'updated', MESSAGE_EDITED: 'edited', CHAT_CHANGED: 'changed',
        },
        eventSource: {
            on: (name, fn) => { if (!handlers.has(name)) handlers.set(name, new Set()); handlers.get(name).add(fn); },
            removeListener: (name, fn) => handlers.get(name)?.delete(fn),
        },
        saves: 0,
        saveMetadataDebounced() { this.saves += 1; },
        quietCalls: [],
        async generateQuietPrompt(arg) { this.quietCalls.push(arg); return '新任务|类型:支线|标题:买一束花|描述:送给林|条件:送出|奖励:积分200|惩罚:|时限:|对象:宿主'; },
        emit: (name, ...args) => { for (const fn of [...(handlers.get(name) || [])]) fn(...args); },
        listenerCount: () => [...handlers.values()].reduce((sum, set) => sum + set.size, 0),
    };
    return ctx;
}
const freshEngine = () => { delete globalThis[ENGINE_KEY]; };

await check('设置规范化：默认关闭、只读入参、返回新对象、越界取边界', () => {
    const raw = Object.freeze({ enabled: 'yes', freq: 99, limitMin: 5, limitMax: 2, sysName: '   ', personality: '暴躁', mods: Object.freeze({ shop: false }) });
    const out = normalizeOriginSettings(raw);
    assert.notEqual(out, raw);
    assert.equal(out.enabled, false, '非布尔值回落默认关闭');
    assert.equal(out.freq, 10);
    assert.equal(out.limitMax, 5, '上限大于 0 时不小于下限');
    assert.equal(out.sysName, '随身系统');
    assert.equal(out.personality, '冷澈');
    assert.equal(out.mods.shop, false);
    assert.equal(out.mods.chat, true);
    assert.equal(normalizeOriginSettings({ limitMax: 0, limitMin: 3 }).limitMax, 0, '上限 0 表示不限');
    assert.equal(originBoundRole({ bindTo: '宿主' }), '');
    assert.equal(originBoundRole({ bindTo: '林' }), '林');
});

await check('设置读写：读到的对象冻结并按原文缓存，保存合并补丁', () => {
    disable();
    const first = loadOriginSettings();
    assert.ok(Object.isFrozen(first) && Object.isFrozen(first.mods));
    assert.equal(loadOriginSettings(), first, '原文不变时返回同一对象');
    const saved = saveOriginSettings({ enabled: true, mods: { gacha: false } });
    assert.equal(saved.enabled, true);
    assert.equal(saved.mods.gacha, false);
    assert.equal(saved.mods.bag, true);
    assert.notEqual(saved, first);
    assert.throws(() => { 'use strict'; saved.enabled = false; });
    disable();
});

await check('host 字段齐全；settings 返回规范化对象', () => {
    const host = createOriginHost({ getCtx: () => null });
    for (const key of ['getContext', 'settings', 'saveMetadata', 'generate', 'isBackground', 'notify', 'legacyActive']) assert.equal(typeof host[key], 'function', key);
    assert.equal(host.settings().enabled, false);
    assert.equal(host.getContext(), null);
    assert.doesNotThrow(() => host.saveMetadata());
    assert.doesNotThrow(() => host.notify({ kind: 'info', text: '没有接收方也不报错' }));
});

await check('后台请求标记：callAI 期间为真，结束后复位，出错也复位', async () => {
    let seen = null;
    const tracked = trackBackgroundCalls(async () => { seen = isTianyinBackground(); return 'ok'; });
    assert.equal(isTianyinBackground(), false);
    assert.equal(await tracked('s', 'u'), 'ok');
    assert.equal(seen, true);
    await assert.rejects(runTianyinBackground(async () => { throw new Error('x'); }));
    assert.equal(isTianyinBackground(), false);
});

await check('生成通道：未指定模块时走酒馆 generateQuietPrompt（对象参数，失败退字符串）；指定时走 callAI 的 origin 模块', async () => {
    const ctx = fakeContext();
    let calls = 0;
    ctx.generateQuietPrompt = async arg => { calls += 1; if (typeof arg === 'object') throw new Error('旧版'); return `旧版:${arg}`; };
    window.__pmApiRoutes = {};
    const host = createOriginHost({ getCtx: () => ctx, callAI: async () => 'callAI' });
    assert.equal(await host.generate('task', 'p'), '旧版:p');
    assert.equal(calls, 2);
    const routed = [];
    window.__pmApiRoutes = { origin: 'main' };
    const host2 = createOriginHost({ getCtx: () => ctx, callAI: async (system, user, options) => { routed.push([user, options.module, isTianyinBackground()]); return '路由'; } });
    assert.equal(await host2.generate('shop', 'q'), '路由');
    assert.deepEqual(routed, [['q', 'origin', true]]);
    window.__pmApiRoutes = {};
    assert.ok(API_ROUTE_MODULES.some(item => item.key === 'origin' && item.label === '金手指'));
});

await check('原版 Origin 检测：有 #origin-root 且未关闭时为真', () => {
    assert.equal(originLegacyActive({ document: { getElementById: () => null } }), false);
    assert.equal(originLegacyActive({ document: { getElementById: () => ({}) }, extension_settings: { origin: { enabled: false } } }), false);
    assert.equal(originLegacyActive({ document: { getElementById: () => ({}) }, extension_settings: { origin: {} } }), true);
});

await check('总开关：关时不挂监听；开后 sync 挂上；release 后撤下本方 host', () => {
    freshEngine();
    disable();
    const ctx = fakeContext();
    const runtime = startOriginHost({ getCtx: () => ctx });
    assert.equal(ctx.listenerCount(), 0, '默认关闭不挂监听');
    enable();
    runtime.sync();
    assert.ok(ctx.listenerCount() > 0);
    const hub = globalThis[ENGINE_KEY];
    assert.equal(hub.hosts.length, 1);
    runtime.release();
    assert.equal(hub.hosts.length, 0, 'release 后 hosts 撤下');
    assert.equal(ctx.listenerCount(), 0, '最后一个 host 撤下时核心解绑');
    disable();
});

await check('两边同时装：共用一个核心，用总开关开着的那方的 host', () => {
    freshEngine();
    const ctx = fakeContext();
    const igsNotices = [];
    const igsHost = { getContext: () => ctx, settings: () => ({ enabled: false }), saveMetadata() {}, generate: async () => '', notify: n => igsNotices.push(n), isBackground: () => false };
    enable();
    const tianyin = startOriginHost({ getCtx: () => ctx });
    const notices = [];
    tianyin.setNoticeSink(n => notices.push(n));
    const hub = globalThis[ENGINE_KEY];
    hub.hosts.unshift(igsHost);
    assert.equal(hub.hosts.length, 2);
    const result = tianyin.engine.dispatch({ type: 'addTask', title: '测试', taskType: '支线' });
    assert.equal(result.ok, true);
    assert.ok(notices.some(n => n.kind === 'task-new'), '提示走开着的天音 host');
    assert.equal(igsNotices.length, 0, '关着的 IGS host 不收提示');
    tianyin.release();
    assert.deepEqual(hub.hosts, [igsHost], '只撤下天音这方');
    disable();
    freshEngine();
});

await check('假聊天完整流程：手动加任务、结算数据块、注入在末尾、后台请求不注入、积分不足', async () => {
    freshEngine();
    enable();
    const ctx = fakeContext();
    const runtime = startOriginHost({ getCtx: () => ctx });
    const { engine } = runtime;
    assert.equal(engine.dispatch({ type: 'addTask', title: '初见', taskType: '主线', reward: '积分100' }).ok, true);
    assert.ok(ctx.chatMetadata.origin_v2, '存档写进 chatMetadata.origin_v2');
    assert.ok(ctx.saves > 0, '走宿主防抖保存');
    const task = engine.getState().tasks[0];
    assert.ok(Object.isFrozen(engine.getState()) && Object.isFrozen(engine.getState().tasks), 'getState 深度冻结');
    assert.equal(engine.dispatch({ type: 'completeTask', id: task.id }).ok, true);
    const afterDone = engine.getState().points;
    assert.ok(afterDone >= 100, '完成任务发放奖励（另有首个任务成就奖励）');
    ctx.chat.push({ is_user: true, mes: '你好' });
    ctx.chat.push({ is_user: false, name: '林', mes: '她笑了。\n<origin>\n积分|+500|初见\n</origin>', swipe_id: 0, swipes: ['x'], extra: {} });
    ctx.emit('received', 1);
    assert.equal(engine.getState().points, afterDone + 500 + 20, '楼层数据块结算（跨过 300 另得「腰缠万贯」20）');
    assert.doesNotMatch(ctx.chat[1].mes, /<origin>/, '正文剪掉数据块');
    const prompt = [{ role: 'user', content: 'hi' }];
    ctx.emit('prompt', { chat: prompt, dryRun: false });
    assert.equal(prompt.at(-1).role, 'system', '注入放在提示词最后一条');
    const background = [{ role: 'user', content: 'hi' }];
    await runTianyinBackground(async () => ctx.emit('prompt', { chat: background, dryRun: false }));
    assert.equal(background.length, 1, '天音后台请求期间不注入');
    assert.equal(engine.dispatch({ type: 'buy', name: '凝神丹' }).ok, true);
    assert.ok(engine.getState().bag.some(item => item.name === '凝神丹'), '买到的进背包');
    let fail = null;
    for (let i = 0; i < 20 && !fail; i += 1) { const r = engine.dispatch({ type: 'buy', name: '凝神丹' }); if (!r.ok) fail = r; }
    assert.equal(fail?.reason, 'no-points');
    assert.match(fail.text, /积分不够/);
    const gen = await engine.genTask();
    assert.equal(gen.ok, true);
    assert.equal(typeof ctx.quietCalls[0], 'object', '生成走 generateQuietPrompt 对象参数');
    assert.ok(engine.getState().tasks.some(t => t.title === '买一束花'));
    runtime.release();
    disable();
});

function sampleState(engine) {
    engine.dispatch({ type: 'addTask', title: '夺回玉佩', taskType: '主线', desc: '从对手手里拿回来', reward: '积分300', limit: 3 });
    engine.dispatch({ type: 'addTask', title: '买一束花', taskType: '支线' });
    engine.dispatch({ type: 'addTask', title: '替林跑腿', taskType: '日常', owner: '林' });
    engine.dispatch({ type: 'addItem', name: '凝神丹', count: 2, desc: '恢复精神' });
    return engine.getState();
}

await check('系统对话撤回：连接失败的一轮整组删除，存档与检查点不留残留，可重新发送', async () => {
    const { findRetractableSysChat, retractOriginSysChat } = await import('../src/origin-chat-retract.js');
    freshEngine();
    enable();
    const ctx = fakeContext();
    const runtime = startOriginHost({ getCtx: () => ctx });
    const { engine } = runtime;
    ctx.generateQuietPrompt = async () => '好的，记下了。';
    assert.equal((await engine.sysChat('第一句')).ok, true);
    ctx.generateQuietPrompt = async () => { throw new Error('HTTP 503: 浏览器执行器连接已断开'); };
    assert.equal((await engine.sysChat('雪烧开了就能喝')).ok, true);
    assert.match(engine.getState().chat.at(-1).text, /连接失败/);
    const savesBefore = ctx.saves;
    const result = retractOriginSysChat({ getCtx: () => ctx, engine, saveMetadata: () => ctx.saveMetadataDebounced() });
    assert.deepEqual(result, { ok: true, text: '雪烧开了就能喝' });
    assert.ok(ctx.saves > savesBefore, '撤回后走宿主防抖保存');
    const saved = JSON.stringify(ctx.chatMetadata.origin_v2);
    assert.doesNotMatch(saved, /雪烧开了就能喝|连接失败/, '存档里不留被撤回的问答');
    assert.deepEqual(engine.getState().chat.map(entry => entry.text), ['第一句', '好的，记下了。'], '界面只剩上一轮');
    assert.equal(retractOriginSysChat({ getCtx: () => ctx, engine }).ok, true, '上一轮成功的问答也能撤回');
    assert.equal(engine.getState().chat.length, 0);
    assert.equal(retractOriginSysChat({ getCtx: () => ctx, engine }).reason, 'origin-retract-none', '没有可撤回的轮次');
    ctx.generateQuietPrompt = async () => '重来一次。';
    assert.equal((await engine.sysChat('雪烧开了就能喝')).ok, true, '撤回后可重新发送');
    assert.deepEqual(engine.getState().chat.map(entry => entry.text), ['雪烧开了就能喝', '重来一次。']);
    const s = loadOriginSettings();
    const chatHtml = renderOriginPage(engine.getState(), s, { tab: 'chat', page: '', busy: '', chatRetract: true });
    assert.match(chatHtml, /pm-origin-bubble-row"><button[^>]*data-origin-action="chat-retract"[^>]*>.*?<\/button><div class="pm-origin-bubble is-me"><span>雪烧开了就能喝/s, '重来键在最后一条用户气泡左侧');
    assert.equal((chatHtml.match(/chat-retract/g) || []).length, 1, '只出现一个重来键');
    assert.doesNotMatch(renderOriginPage(engine.getState(), s, { tab: 'chat', page: '', busy: 'chat', chatRetract: true }), /chat-retract/, '生成中不显示重来键');
    engine.dispatch({ type: 'addTask', title: '别的操作', taskType: '支线' });
    assert.ok(findRetractableSysChat(ctx.chatMetadata.origin_v2), '非对话操作不挡住撤回');
    // 生成中断：只存下了提问，没有系统回复，也要能撤回。
    const raw = ctx.chatMetadata.origin_v2;
    ctx.chatMetadata.origin_v2 = { ...raw, ops: raw.ops.filter(rec => rec.op?.type !== 'chatSys'), checkpoints: [] };
    engine.reload();
    assert.equal(engine.getState().chat.at(-1).who, 'me');
    const cutHtml = renderOriginPage(engine.getState(), s, { tab: 'chat', page: '', busy: '', chatRetract: true });
    assert.match(cutHtml, /data-origin-action="chat-retract"[^>]*>.*?<\/button><div class="pm-origin-bubble is-me"><span>雪烧开了就能喝/s, '中断后没有回复也显示重来键');
    assert.deepEqual(retractOriginSysChat({ getCtx: () => ctx, engine }), { ok: true, text: '雪烧开了就能喝' });
    assert.doesNotMatch(JSON.stringify(ctx.chatMetadata.origin_v2), /雪烧开了就能喝/, '中断的提问不留残留');
    assert.equal(engine.getState().chat.length, 0);
    runtime.release();
    disable();
    freshEngine();
});

await check('系统对话勾选删除：菜单入口、勾选圆点与确认栏，删除所选不留残留', async () => {
    const { listDeletableChats, deleteOriginChats } = await import('../src/origin-chat-retract.js');
    freshEngine();
    enable();
    const ctx = fakeContext();
    const runtime = startOriginHost({ getCtx: () => ctx });
    const { engine } = runtime;
    ctx.generateQuietPrompt = async () => '收到。';
    assert.equal((await engine.sysChat('留下这句')).ok, true);
    assert.equal((await engine.sysChat('手滑发错了')).ok, true);
    ctx.generateQuietPrompt = async () => '第三次回复';
    assert.equal((await engine.sysChat('最后一句')).ok, true);
    const s = loadOriginSettings();
    const menu = renderOriginPage(engine.getState(), s, { tab: 'chat', page: '', menuOpen: true });
    assert.match(menu, /data-origin-action="chat-select"/, '菜单里有勾选删除入口');
    const items = listDeletableChats(ctx.chatMetadata.origin_v2);
    assert.deepEqual(items.map(item => item.text), ['留下这句', '收到。', '手滑发错了', '收到。', '最后一句', '第三次回复']);
    const wrong = items[2].id;
    const view = renderOriginPage(engine.getState(), s, { tab: 'chat', page: '', chatSelect: true, chatItems: items, chatPicked: [wrong] });
    assert.equal((view.match(/class="pm-message-select-check"/g) || []).length, items.length, '每条记录一个勾选圆点');
    assert.match(view, new RegExp(`aria-checked="true" data-checked="1" data-origin-action="chat-pick" data-id="${wrong}"`));
    assert.match(view, /pm-confirm-bar is-active pm-origin-select-bar/, '复用主聊天的确认栏');
    assert.doesNotMatch(view, /id="pm-origin-chat-input"/, '选择时收起输入框');
    assert.match(renderOriginPage(engine.getState(), s, { tab: 'chat', page: '', chatSelect: true, chatItems: items, chatPicked: [] }), /data-origin-action="chat-delete" disabled/, '未选时删除键禁用');
    ctx.chatMetadata.origin_v2.checkpoints = [{ sig: 'stale-chat-snapshot', turn: 0, state: engine.getState() }];
    const result = deleteOriginChats({ getCtx: () => ctx, engine }, [wrong, items[3].id, 99999]);
    assert.deepEqual(result, { ok: true, count: 2 }, '只删存在的记录');
    assert.doesNotMatch(JSON.stringify(ctx.chatMetadata.origin_v2), /手滑发错了/, '存档里不留被删的记录');
    assert.deepEqual(engine.getState().chat.map(entry => entry.text), ['留下这句', '收到。', '最后一句', '第三次回复']);
    const savesBefore = ctx.saves;
    assert.deepEqual(deleteOriginChats({ getCtx: () => ctx, engine, saveMetadata: () => ctx.saveMetadataDebounced() }, [items[4].id]), { ok: true, count: 1 });
    assert.ok(ctx.saves > savesBefore, '删除后保存聊天元数据');
    assert.doesNotMatch(JSON.stringify(ctx.chatMetadata.origin_v2), /最后一句/, '单删提问也清掉回复里的 ask 引用和检查点');
    assert.deepEqual(engine.getState().chat.map(entry => entry.text), ['留下这句', '收到。', '第三次回复'], '单独删除提问保留未勾选的回复');
    engine.reload();
    assert.deepEqual(engine.getState().chat.map(entry => entry.text), ['留下这句', '收到。', '第三次回复'], '重新读档不恢复被删内容');
    assert.equal(deleteOriginChats({ getCtx: () => ctx, engine }, []).ok, false, '空选择不改存档');
    runtime.release();
    disable();
    freshEngine();
});

await check('对话删除保护：无法读取、数据库托管、重载失败时不改原记录', async () => {
    const { deleteOriginChats, listDeletableChats } = await import('../src/origin-chat-retract.js');
    const raw = { ops: [{ id: 1, op: { type: 'chatMe', text: '保留原话' } }], checkpoints: [] };
    const ctx = { chatMetadata: { origin_v2: raw } };
    assert.equal(deleteOriginChats({ getCtx: () => ctx, engine: { isBlocked: () => true } }, [1]).reason, 'origin-retract-blocked');
    const globalObject = { [ENGINE_KEY]: { hosts: [{ settings: () => ({ enabled: true }), database: () => ({}) }] } };
    assert.equal(deleteOriginChats({ getCtx: () => ctx, engine: {}, globalObject }, [1]).reason, 'origin-retract-unsupported');
    let blocked = false;
    let reloads = 0;
    const engine = { isBlocked: () => blocked, reload: () => { reloads += 1; blocked = reloads === 1; } };
    assert.equal(deleteOriginChats({ getCtx: () => ctx, engine }, [1]).reason, 'origin-retract-failed');
    assert.equal(ctx.chatMetadata.origin_v2, raw, '重载失败回滚到原存档对象');
    assert.equal(reloads, 2);
    assert.deepEqual(listDeletableChats({ ops: [
        ...raw.ops, { id: 2, op: { type: 'chatClear' } }, { id: 3, op: { type: 'chatCall', text: '喊话' } },
        { id: 4, op: { type: 'chatRp', lines: [{ who: 'char', name: '林', text: '私聊' }] } },
    ] }).map(row => row.id), [3, 4], '不列出清空以前的记录，支持喊话和私聊');
});

await check('页面渲染：冻结状态下各页不原地改；主线大卡、组头下拉、按钮右对齐主操作最右、底栏五页签', () => {
    freshEngine();
    enable();
    const ctx = fakeContext();
    const runtime = startOriginHost({ getCtx: () => ctx });
    const st = sampleState(runtime.engine);
    const s = loadOriginSettings();
    const base = { tab: 'task', page: '', openRow: '', taskFilter: 'all', gachaFilter: 'all' };
    const task = renderOriginPage(st, s, base);
    assert.match(task, /class="pm-origin-hero/);
    assert.match(task, /当前主线/);
    assert.match(task, /其他任务 · 2/);
    assert.match(task, /data-origin-action="dropdown" data-kind="task"/);
    assert.doesNotMatch(task, /pm-origin-chip/, '页签下不叠筛选胶囊');
    assert.match(task, /剩3回合/);
    assert.match(task, /请求新任务/);
    const opened = renderOriginPage(st, s, { ...base, openRow: `task:${st.tasks[1].id}` });
    const ops = opened.match(/<div class="pm-origin-ops">(.*?)<\/div>/)[1];
    assert.deepEqual([...ops.matchAll(/>([^<]+)<\/button>/g)].map(m => m[1]), ['删除', '编辑', '完成']);
    assert.match(ops, /is-main[^>]*>完成/, '主操作在最右');
    assert.equal((opened.match(/aria-expanded="true"/g) || []).length, 1, '同时只展开一行');
    const filtered = renderOriginPage(st, s, { ...base, taskFilter: 'owner', dropdown: 'task' });
    assert.match(filtered, /给角色任务 · 1/);
    assert.doesNotMatch(filtered, /pm-origin-hero/, '选了分类不出大卡');
    assert.match(filtered, /role="menuitemradio" aria-checked="true"[^>]*>给角色/);
    assert.equal((task.match(/role="tab"/g) || []).length, 5);
    assert.match(renderOriginPage(st, s, { ...base, menuOpen: true }), /data-origin-action="disable"[^>]*>关闭金手指/, '⋯ 菜单里一键关闭');
    assert.match(renderOriginPage(st, s, { ...base, tab: 'gacha' }), /抽一次 · 60积分/);
    const chat = renderOriginPage(st, s, { ...base, tab: 'chat' });
    assert.match(chat, /data-origin-form="chat"/);
    for (const page of ['stat', 'ach', 'log']) assert.match(renderOriginPage(st, s, { ...base, page }), /pm-origin-header is-sub/);
    assert.match(renderOriginPage(st, s, { ...base, tab: 'bag', openRow: 'bag:0:凝神丹' }), /is-main[^>]*>使用/);
    assert.doesNotMatch(task, /style="/, '模板不写内联样式');
    runtime.release();
    disable();
});

await check('页面渲染：未开启时显示开启入口；模块关掉对应页签消失；反串时对话改私聊、底部是喊话', () => {
    const off = normalizeOriginSettings(null);
    const html = renderOriginPage(null, off, { tab: 'task' });
    assert.match(html, /开启金手指/);
    assert.match(html, new RegExp(appSloganOf('origin')));
    assert.doesNotMatch(html, /pm-origin-tabbar/);
    const s = normalizeOriginSettings({ enabled: true, mods: { shop: false }, bindTo: '林' });
    assert.deepEqual(visibleOriginTabs(s).map(t => t.id), ['task', 'bag', 'gacha', 'chat']);
    const st = { points: 0, level: 1, tasks: [], bag: [], shop: [], gachaPool: [], chat: [{ who: 'call', text: '快去' }], stats: [], skills: [], perks: [], rewardsLog: [], achievements: [], log: [], paused: false, turn: 0 };
    const chat = renderOriginPage(Object.freeze(st), s, { tab: 'chat' });
    assert.match(chat, />私聊</);
    assert.match(chat, /aria-label="喊话"/);
    assert.match(chat, /以系统身份喊话/);
    assert.match(renderOriginPage(null, normalizeOriginSettings({ enabled: true }), { tab: 'task' }), /请先打开一个聊天/);
});

await check('设置页：署名与原作链接、本聊天组只在有聊天时出现、清空本局标危险', () => {
    const s = normalizeOriginSettings({ enabled: true });
    const html = renderOriginSettings(s, { available: true, paused: false, world: '', legacy: true });
    assert.match(html, /Origin 系统 原作 vicliaaa，经授权移植/);
    assert.match(html, /github\.com\/vicliaaa\/origin-sillytavern/);
    assert.match(html, /导入旧存档/);
    assert.match(html, /is-danger[^>]*data-origin-action="reset"/);
    assert.doesNotMatch(renderOriginSettings(s, { available: false }), /本聊天/);
    assert.doesNotMatch(renderOriginSettings(normalizeOriginSettings(null), { available: true }), /本聊天/, '未开启时不出本聊天组');
    assert.doesNotMatch(html, /API地址|密钥/, '不做原插件的独立 API');
});

await check('表单：字段齐全、必填为空返回空、拼成核心 op 字段', () => {
    assert.ok(renderOriginSheet('addTask').includes('role="dialog"'));
    const data = new FormData();
    data.set('title', ' ');
    assert.equal(readOriginSheet('addTask', data), null);
    const full = new FormData();
    for (const [key, value] of Object.entries({ title: '救人', taskType: '主线', desc: 'd', cond: 'c', reward: '积分1', penalty: '', limit: '120', owner: '' })) full.set(key, value);
    assert.deepEqual(readOriginSheet('addTask', full), { type: 'addTask', title: '救人', taskType: '主线', desc: 'd', cond: 'c', reward: '积分1', penalty: '', limit: 99, owner: '宿主' });
    const edit = new FormData();
    for (const [key, value] of Object.entries({ title: '救人', taskType: '支线', desc: '', cond: '', reward: '', penalty: '', limit: '2', progress: '40', owner: '' })) edit.set(key, value);
    const op = readOriginSheet('editTask', edit, '7');
    assert.equal(op.id, '7');
    assert.equal(op.patch.progress, 40);
    assert.equal('owner' in op.patch, false, '对象留空不改');
    const dir = new FormData();
    dir.set('value', '复仇');
    assert.deepEqual(readOriginSheet('setDirection', dir), { type: 'setDirection', value: '复仇' });
    for (const kind of Object.keys(ORIGIN_FORMS)) assert.ok(renderOriginSheet(kind), kind);
});

await check('备份：设置字段可选，有时规范化读入，格式错误拒绝；清空数据包含设置键', () => {
    const current = { theme: {}, origin: normalizeOriginSettings({ enabled: true, sysName: '现有' }) };
    assert.deepEqual(parseBackupData({ schemaVersion: 3 }, current).origin, current.origin, '旧备份没有 origin 时保留现有设置');
    const imported = parseBackupData({ schemaVersion: 3, origin: { enabled: true, freq: 999, sysName: '导入' } }, current).origin;
    assert.equal(imported.sysName, '导入');
    assert.equal(imported.freq, 10, '导入时规范化');
    assert.throws(() => parseBackupData({ schemaVersion: 3, origin: [] }, current), /金手指设置格式不正确/);
    assert.ok(PLUGIN_LOCAL_STORAGE_KEYS.includes(ORIGIN_SETTINGS_KEY));
});

await check('桌面与页面登记：图标、页面键、桌面红点', () => {
    assert.ok(PHONE_UI_PAGES.includes('origin'));
    assert.ok(DESKTOP_ICON_IDS.includes('origin'));
    assert.ok(DESKTOP_APPS.some(app => app.id === 'origin'));
    assert.equal(appNameOf('origin'), '金手指');
    window.__pmTheme = {};
    let html = renderPhoneDesktop();
    assert.match(html, /data-app="origin" data-action="desktop-origin"/);
    assert.doesNotMatch(html, /pm-desktop-app-badge/);
    window.__pmDesktopBadges = { origin: true };
    html = renderPhoneDesktop();
    assert.match(html, /aria-label="金手指，有新提示"/);
    assert.match(html, /pm-desktop-app-badge/);
    window.__pmDesktopBadges = {};
});

console.log(`Origin host checks passed (${passed} checks).`);
