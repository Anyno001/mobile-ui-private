import assert from 'node:assert/strict';

// 剧情助手的无限流：假酒馆上跑完整流程。AI 楼层带「停站」状态块 -> 掷骰造世界、写进进度并注入档案；
// 触发楼被 swipe 成不带「停站」-> 档案撤销；档案生成中发下一条会等待；切聊天作废生成；独立版在场时天音不开副本；无限流不调用检测模型。
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
globalThis.SillyTavern = { libs: { yaml: { parse: text => JSON.parse(text), stringify: value => JSON.stringify(value, null, 2) } } };

const { startPlotInjector } = await import('../src/plot-injector/plot-injector.js');

const tick = (ms = 0) => new Promise(resolve => setTimeout(resolve, ms));
const STOP = '<末班车状态>\n列车：停站\n</末班车状态>';
const ROAD = '<末班车状态>\n列车：车上\n</末班车状态>';
const WORLD_REPLY = '【标题】雾中旧站\n【档案】\n外观：雾很大。\n因果：天黑后铃响。';

function makeWorld() {
    const handlers = new Map();
    const files = new Map();
    const aiCalls = [];
    const eventSource = {
        on(name, fn) { if (!handlers.has(name)) handlers.set(name, []); handlers.get(name).push(fn); },
        removeListener(name, fn) { handlers.set(name, (handlers.get(name) || []).filter(item => item !== fn)); },
        async emit(name, ...args) { for (const fn of handlers.get(name) || []) await fn(...args); },
    };
    const context = {
        chat: [{ is_user: true, mes: '出发吧' }, { is_user: false, mes: `列车缓缓停下。\n${STOP}` }],
        characters: [{ name: '测试卡', avatar: 'test.png' }],
        characterId: 0,
        groupId: null,
        chatId: 'chat-1',
        chatMetadata: {},
        eventSource,
        eventTypes: { WORLDINFO_ENTRIES_LOADED: 'wi_loaded', CHAT_CHANGED: 'chat_changed', MESSAGE_RECEIVED: 'msg_received', MESSAGE_UPDATED: 'msg_updated', MESSAGE_DELETED: 'msg_deleted', MESSAGE_SWIPED: 'msg_swiped', GENERATION_STARTED: 'gen_started', GENERATION_ENDED: 'gen_ended', GENERATION_STOPPED: 'gen_stopped' },
        getRequestHeaders: () => ({ 'X-CSRF-Token': 't' }),
        saveMetadataDebounced() {},
        async saveMetadata() {},
        // 卡里带一个已关闭的「恐怖类型写法」条目，开副本时应读到并带进造世界提示。
        async loadWorldInfo() { return { entries: { 0: { uid: 0, comment: '🎭 恐怖类型：中式民俗', content: '写法：先写异象。', disable: true } } }; },
    };
    context.chatMetadata.world_info = '测试书';
    const respond = (status, body) => ({ ok: status < 400, status, text: async () => body, json: async () => JSON.parse(body) });
    const fetchImpl = async (url, init = {}) => {
        const u = String(url).split('?')[0];
        if (u.startsWith('/user/files/')) {
            const name = u.slice('/user/files/'.length);
            return files.has(name) ? respond(200, files.get(name)) : respond(404, '');
        }
        const body = init.body ? JSON.parse(init.body) : {};
        if (u === '/api/files/upload') { files.set(body.name, Buffer.from(body.data, 'base64').toString('utf8')); return respond(200, '{}'); }
        if (u === '/api/files/delete') return respond(files.delete(body.path.replace('user/files/', '')) ? 200 : 404, '');
        return respond(404, '');
    };
    let delay = 0;
    const callAI = async (system, user, options) => { aiCalls.push({ system, user, options }); if (delay) await tick(delay); return WORLD_REPLY; };
    const toastImpl = Object.fromEntries(['info', 'success', 'warning', 'error'].map(kind => [kind, () => {}]));
    return { context, files, aiCalls, eventSource, fetchImpl, callAI, toastImpl, setDelay: ms => { delay = ms; } };
}

async function boot(world, extra = {}) {
    const plot = startPlotInjector({ getCtx: () => world.context, callAI: world.callAI, fetchImpl: world.fetchImpl, toastImpl: world.toastImpl, ...extra });
    await plot.ready;
    return plot;
}

async function infiniteProject(plot) {
    const { data, runtime } = plot.getPlotApi();
    const project = await data.createProject('末班车', '', 'infinite');
    await runtime.switchProject(project.id);
    return project;
}

const loreNow = async world => {
    const payload = { globalLore: [], characterLore: [], chatLore: [], personaLore: [] };
    await world.eventSource.emit('wi_loaded', payload);
    return payload.chatLore;
};
const infOf = plot => plot.getPlotApi().runtime.progress().infinite;
const settle = async plot => { const { runtime } = plot.getPlotApi(); for (let i = 0; i < 50 && runtime.isOpening(); i += 1) await tick(5); };

await check('新建无限流项目：mode 与 infinite 模板落盘，进度里有空的世界库', async () => {
    const world = makeWorld();
    const plot = await boot(world);
    const project = await infiniteProject(plot);
    assert.equal(project.mode, 'infinite');
    assert.ok(project.infinite && project.infinite.pools.horror.length > 0);
    assert.equal(infOf(plot).phase, 'train');
    assert.deepEqual(infOf(plot).worlds, []);
    await plot.destroy();
});

await check('带「停站」的 AI 楼层：生成档案、进入世界、注入档案；不调用检测模型', async () => {
    const world = makeWorld();
    const plot = await boot(world);
    await infiniteProject(plot);
    await world.eventSource.emit('msg_received', 1);
    await settle(plot);
    const inf = infOf(plot);
    assert.equal(inf.phase, 'world');
    assert.equal(inf.worlds.length, 1);
    assert.equal(inf.worlds[0].title, '雾中旧站');
    assert.equal(inf.trigger.kind, 'enter');
    assert.equal(inf.trigger.floor, 1);
    assert.equal(world.aiCalls.length, 1);
    assert.equal(world.aiCalls[0].options.module, 'plotSetting');
    assert.equal(world.aiCalls[0].options.isolated, true);
    const lore = await loreNow(world);
    const detail = lore.find(entry => String(entry.content).includes('雾很大'));
    assert.ok(detail, '档案正文注入为常驻条目');
    assert.ok(String(detail.content).includes('<世界档案>'));
    assert.ok(lore.every(entry => entry.constant && !entry.disable));
    await plot.destroy();
});

await check('卡里已关闭的恐怖类型写法条目在命中同标题时带进造世界提示', async () => {
    const world = makeWorld();
    const plot = await boot(world);
    const project = await infiniteProject(plot);
    const { data, runtime } = plot.getPlotApi();
    // 把恐怖类型骰池收成只有「中式民俗」，掷骰结果确定。
    data.updateProject(project.id, item => ({ ...item, infinite: { ...item.infinite, pools: { ...item.infinite.pools, horror: [{ label: '中式民俗', weight: 1 }] } } }));
    await runtime.openWorld();
    assert.ok(world.aiCalls[0].user.includes('写法：先写异象。'));
    await plot.destroy();
});

await check('触发楼被 swipe 成不带「停站」的内容：档案撤销，回到主空间', async () => {
    const world = makeWorld();
    const plot = await boot(world);
    await infiniteProject(plot);
    await world.eventSource.emit('msg_received', 1);
    await settle(plot);
    assert.equal(infOf(plot).worlds.length, 1);
    world.context.chat[1].mes = `列车继续行驶。\n${ROAD}`;
    await world.eventSource.emit('msg_swiped', 1);
    const inf = infOf(plot);
    assert.equal(inf.worlds.length, 0);
    assert.equal(inf.phase, 'train');
    assert.equal(inf.trigger, undefined);
    const lore = await loreNow(world);
    assert.ok(!lore.some(entry => String(entry.content).includes('雾很大')));
    await plot.destroy();
});

await check('swipe 中间态（楼层被清空）不撤销；触发楼被删也撤销', async () => {
    const world = makeWorld();
    const plot = await boot(world);
    await infiniteProject(plot);
    await world.eventSource.emit('msg_received', 1);
    await settle(plot);
    world.context.chat[1].mes = '';
    await world.eventSource.emit('msg_swiped', 1);
    assert.equal(infOf(plot).worlds.length, 1);
    world.context.chat.length = 1;
    await world.eventSource.emit('msg_deleted', 1);
    assert.equal(infOf(plot).worlds.length, 0);
    await plot.destroy();
});

await check('世界里读到「回到列车」：关副本，档案留在世界库；该楼 swipe 掉则重新打开', async () => {
    const world = makeWorld();
    const plot = await boot(world);
    await infiniteProject(plot);
    await world.eventSource.emit('msg_received', 1);
    await settle(plot);
    world.context.chat.push({ is_user: false, mes: '<末班车状态>\n列车：回到列车\n</末班车状态>' });
    await world.eventSource.emit('msg_received', 2);
    assert.equal(infOf(plot).phase, 'train');
    assert.equal(infOf(plot).worlds.length, 1);
    world.context.chat[2].mes = '<末班车状态>\n列车：世界里\n</末班车状态>';
    await world.eventSource.emit('msg_swiped', 2);
    assert.equal(infOf(plot).phase, 'world');
    await plot.destroy();
});

await check('档案生成中发下一条：条目加载事件等档案写好再注入', async () => {
    const world = makeWorld();
    world.setDelay(60);
    const plot = await boot(world);
    await infiniteProject(plot);
    await world.eventSource.emit('msg_received', 1);
    assert.equal(plot.getPlotApi().runtime.isOpening(), true);
    const lore = await loreNow(world);
    assert.ok(lore.some(entry => String(entry.content).includes('雾很大')), '等到档案生成后才注入');
    await plot.destroy();
});

await check('档案生成中切聊天：结果作废，不写进进度', async () => {
    const world = makeWorld();
    world.setDelay(60);
    const plot = await boot(world);
    await infiniteProject(plot);
    await world.eventSource.emit('msg_received', 1);
    await world.eventSource.emit('chat_changed');
    await tick(120);
    assert.equal(plot.getPlotApi().runtime.isOpening(), false);
    assert.equal(infOf(plot).worlds.length, 0);
    assert.equal(infOf(plot).phase, 'train');
    await plot.destroy();
});

await check('手动进入新世界、重新打开、回到主空间、删除档案', async () => {
    const world = makeWorld();
    const plot = await boot(world);
    await infiniteProject(plot);
    const { runtime } = plot.getPlotApi();
    await runtime.openWorld();
    assert.equal(infOf(plot).phase, 'world');
    assert.equal(infOf(plot).trigger, undefined, '手动进入没有触发楼');
    const id = infOf(plot).worldId;
    runtime.returnToTrain();
    assert.equal(infOf(plot).phase, 'train');
    runtime.reopenWorld(id);
    assert.equal(infOf(plot).worldId, id);
    runtime.returnToTrain();
    runtime.deleteWorld(id);
    assert.equal(infOf(plot).worlds.length, 0);
    await plot.destroy();
});

await check('独立版在场：天音不读状态块、不开副本、不注入', async () => {
    const world = makeWorld();
    const plot = await boot(world, { standaloneImpl: () => null });
    await infiniteProject(plot);
    const own = plot.getPlotApi().runtime;
    plot.host.standalone = () => ({ runtime: {}, data: {} });
    await world.eventSource.emit('msg_received', 1);
    await tick(10);
    assert.equal(world.aiCalls.length, 0);
    assert.equal(own.progress().infinite.worlds.length, 0);
    assert.equal((await loreNow(world)).length, 0);
    assert.equal(plot.getPlotApi().owner, 'standalone');
    await plot.destroy();
});

console.log(`Plot injector infinite checks passed (${passed} cases).`);
