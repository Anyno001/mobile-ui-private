import assert from 'node:assert/strict';

// 剧情注入器宿主层：假酒馆上下文上跑完整流程——读写 user/files、按聊天记项目、条目加载时注入、
// 天音后台请求期间不注入、每 N 楼经 callAI（剧情检测模块、隔离生成）检测并推进、同页有独立版时让出、destroy 解绑。
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
// 酒馆自带 SillyTavern.libs.yaml；测试只需要 stringify/parse 往返，用 JSON 代替。
globalThis.SillyTavern = { libs: { yaml: { parse: text => JSON.parse(text), stringify: value => JSON.stringify(value, null, 2) } } };

const { startPlotInjector } = await import('../src/plot-injector/plot-injector.js');
const { PLOT_ROLE_MODULES, flattenMessages, standalonePlotInjector } = await import('../src/plot-injector/plot-host.js');
const { runTianyinBackground } = await import('../src/origin-host.js');
const { volumesFromValue } = await import('../src/plot-injector/core/outline.js');
const { API_ROUTE_MODULES } = await import('../src/api-routes.js');

const tick = (ms = 0) => new Promise(resolve => setTimeout(resolve, ms));
const OUTLINE = {
    剧情_卷一_测试: {
        阶段一_开端: { 时间范围: '开始时', AI指令: '推进开端。', 主线节点: [{ 名称: '甲事件', 地点: '甲地', 事件: '甲发生。', 偏转: '无。' }] },
        阶段二_发展: { 时间范围: '开端之后', 主线节点: [{ 名称: '乙事件', 地点: '乙地', 事件: '乙发生。', 偏转: '无。' }] },
    },
};

function makeWorld() {
    const handlers = new Map();
    const files = new Map();
    const aiCalls = [];
    const toasts = [];
    const eventSource = {
        on(name, fn) { if (!handlers.has(name)) handlers.set(name, []); handlers.get(name).push(fn); },
        removeListener(name, fn) { handlers.set(name, (handlers.get(name) || []).filter(item => item !== fn)); },
        async emit(name, ...args) { for (const fn of handlers.get(name) || []) await fn(...args); },
        count: () => [...handlers.values()].reduce((sum, list) => sum + list.length, 0),
    };
    const context = {
        chat: [],
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
    };
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
    let reply = () => '{"done":["甲事件"],"stageDone":true,"reason":"甲已发生"}';
    const callAI = async (system, user, options) => { aiCalls.push({ system, user, options }); return reply(); };
    const toastImpl = Object.fromEntries(['info', 'success', 'warning', 'error'].map(kind => [kind, message => toasts.push({ kind, message })]));
    return { context, files, aiCalls, toasts, eventSource, fetchImpl, callAI, toastImpl, setReply: fn => { reply = fn; } };
}

async function boot(world, extra = {}) {
    const plot = startPlotInjector({ getCtx: () => world.context, callAI: world.callAI, fetchImpl: world.fetchImpl, toastImpl: world.toastImpl, ...extra });
    await plot.ready;
    return plot;
}

async function withProject(plot) {
    const { data, runtime } = plot.getPlotApi();
    const project = await data.createProject('龙宫线');
    data.saveProject({ ...project, setting: { ...project.setting, text: '世界观：测试' }, outline: { volumes: volumesFromValue(OUTLINE) } });
    await runtime.switchProject(project.id);
    return project;
}

async function loreNow(world) {
    const payload = { globalLore: [], characterLore: [], chatLore: [], personaLore: [] };
    await world.eventSource.emit('wi_loaded', payload);
    return payload.chatLore;
}

await check('三个用途对应 API 按模块分配里的剧情聊天/设定/检测', async () => {
    assert.deepEqual(PLOT_ROLE_MODULES, { discuss: 'oracle', outline: 'plotSetting', check: 'plotCheck' });
    const labels = Object.fromEntries(API_ROUTE_MODULES.map(item => [item.key, item.label]));
    assert.equal(labels.oracle, '剧情聊天');
    assert.equal(labels.plotSetting, '剧情设定');
    assert.equal(labels.plotCheck, '剧情检测');
});

await check('消息数组拼成 system + user 两段', async () => {
    const flat = flattenMessages([{ role: 'system', content: 'S1' }, { role: 'system', content: 'S2' }, { role: 'user', content: 'U' }, { role: 'assistant', content: 'A' }]);
    assert.equal(flat.system, 'S1\n\nS2');
    assert.equal(flat.user, '用户：U\n\nAI：A');
});

await check('只装天音：建项目写进 user/files，设定和当前阶段注入为常驻虚拟条目，项目记在当前聊天', async () => {
    const world = makeWorld();
    const plot = await boot(world);
    assert.equal(plot.getPlotApi().owner, 'tianyin');
    const project = await withProject(plot);
    const lore = await loreNow(world);
    assert.deepEqual(lore.map(entry => entry.comment), ['剧情注入器·设定', '剧情注入器·卷一·测试·阶段一']);
    assert.ok(lore.every(entry => entry.constant && !entry.disable && entry.world === '剧情注入器'));
    assert.equal(world.context.chatMetadata.plotInjector.projectId, project.id);
    await plot.flush();
    const index = JSON.parse(world.files.get('pi-index.json'));
    assert.equal(index.projects[0].id, project.id);
    assert.equal(index.active['char:test.png'], project.id, '本卡还没有默认时顺带设为默认');
    assert.ok(world.files.has(`pi-p-${project.id}.json`));
    await plot.destroy();
});

await check('天音自己的后台请求期间不注入', async () => {
    const world = makeWorld();
    const plot = await boot(world);
    await withProject(plot);
    let inside = null;
    await runTianyinBackground(async () => { inside = await loreNow(world); });
    assert.equal(inside.length, 0);
    assert.equal((await loreNow(world)).length, 2);
    await plot.destroy();
});

await check('每 N 楼经 callAI 检测：用剧情检测模块、隔离生成，判定演完后提示，打开下一段换详细', async () => {
    const world = makeWorld();
    const plot = await boot(world);
    await withProject(plot);
    const { runtime } = plot.getPlotApi();
    const shown = [];
    plot.notice.subscribe(list => shown.splice(0, shown.length, ...list));
    world.context.chat.push({ mes: '甲在甲地发生了。', is_user: false }, { mes: '嗯', is_user: true }, { mes: '甲事件结束。', is_user: false });
    await world.eventSource.emit('msg_received', 2);
    await tick(10);
    assert.equal(world.aiCalls.length, 1);
    assert.equal(world.aiCalls[0].options.module, 'plotCheck');
    assert.equal(world.aiCalls[0].options.isolated, true);
    assert.ok(world.aiCalls[0].options.signal);
    assert.match(world.aiCalls[0].user, /甲事件结束/);
    assert.ok(shown.some(item => item.id === 'advance'), '演完后弹出推进提示');
    assert.equal(runtime.progress().lastCheckFloor, 3);
    runtime.openNext();
    const lore = await loreNow(world);
    assert.equal(lore[1].comment, '剧情注入器·卷一·测试·阶段二');
    await plot.destroy();
});

await check('主回复生成中先挂起检测，生成结束再检测；天音后台请求触发的生成事件不算主回复', async () => {
    const world = makeWorld();
    const plot = await boot(world);
    await withProject(plot);
    await world.eventSource.emit('gen_started', 'normal', {}, false);
    world.context.chat.push({ mes: '一', is_user: false }, { mes: '二', is_user: true }, { mes: '三', is_user: false });
    await world.eventSource.emit('msg_received', 2);
    await tick(10);
    assert.equal(world.aiCalls.length, 0, '生成中不检测');
    await world.eventSource.emit('gen_ended');
    await tick(10);
    assert.equal(world.aiCalls.length, 1, '生成结束后检测');
    await plot.destroy();
});

await check('换聊天：没记过项目的聊天用本卡默认；聊天记过的项目优先', async () => {
    const world = makeWorld();
    const plot = await boot(world);
    const a = await withProject(plot);
    const { data, runtime } = plot.getPlotApi();
    const b = await data.createProject('海岛线');
    await runtime.switchProject(b.id, 'chat');
    assert.equal(runtime.activeId(), b.id);
    assert.equal(data.activeIdFor('char:test.png'), a.id);
    world.context.chatMetadata = {};
    world.context.chatId = 'chat-2';
    await world.eventSource.emit('chat_changed');
    assert.equal(runtime.activeId(), a.id);
    world.context.chatMetadata = { plotInjector: { projectId: b.id, byProject: {} } };
    await world.eventSource.emit('chat_changed');
    assert.equal(runtime.activeId(), b.id);
    await plot.destroy();
});

await check('读独立版写下的数据：同一份 pi-index.json 与 chat_metadata 直接可用', async () => {
    const world = makeWorld();
    const first = await boot(world);
    const project = await withProject(first);
    await first.flush();
    await first.destroy();
    const second = await boot(world);
    await second.getPlotApi().data.loadProject(project.id);
    assert.equal(second.getPlotApi().runtime.activeId(), project.id);
    assert.equal((await loreNow(world)).length, 2);
    await second.destroy();
});

await check('同页有独立版时让出：不注入、不检测，界面拿到的是独立版的数据层与运行时', async () => {
    const world = makeWorld();
    const fake = { version: '0.1.15', data: { tag: 'standalone-data' }, runtime: { tag: 'standalone-runtime' } };
    let present = false;
    const plot = await boot(world, { standaloneImpl: () => (present ? fake : null) });
    await withProject(plot);
    present = true;
    assert.equal(plot.getPlotApi().owner, 'standalone');
    assert.equal(plot.getPlotApi().data, fake.data);
    assert.equal((await loreNow(world)).length, 0, '独立版在时天音不注入');
    world.context.chat.push({ mes: '一', is_user: false }, { mes: '二', is_user: true }, { mes: '三', is_user: false });
    await world.eventSource.emit('msg_received', 2);
    await tick(10);
    assert.equal(world.aiCalls.length, 0, '独立版在时天音不检测');
    await plot.destroy();
    assert.equal(standalonePlotInjector({ __plotInjector: fake }), fake);
    assert.equal(standalonePlotInjector({ __plotInjector: { open() {} } }), null, '缺数据层或运行时的不算');
});

await check('检测接口失败自动重试 3 次，仍失败弹提示，不抛出', async () => {
    const world = makeWorld();
    const plot = await boot(world);
    await withProject(plot);
    world.setReply(() => { throw new Error('接口挂了'); });
    world.context.chat.push({ mes: '一', is_user: false });
    const started = Date.now();
    const result = await plot.getPlotApi().runtime.checkNow({ manual: true });
    assert.equal(result, null);
    assert.equal(world.aiCalls.length, 4);
    assert.ok(Date.now() - started >= 6000, '重试间隔 2 秒');
    assert.ok(plot.notice.list().some(item => item.id === 'checkfail'));
    await plot.destroy();
});

// v0.1.24 运行层：检测带进度钟与支线钩子并合并结果、失败只记 lastFailFloor、新线询问收录、读进度时按对照表归位、开关遮罩。
const THREAD_OUTLINE = {
    剧情_卷一_测试: {
        阶段一_开端: {
            时间范围: '开始时',
            主线节点: [{ 名称: '甲事件', 事件: '甲发生。' }],
            支线事件: [{ 名称: '酒馆密谈', 事件: '陌生人约谈。', 条件: '主角到过酒馆' }],
            世界动态: [{ 类型: '山匪逼近', 内容: '山匪袭击村庄。', 进度钟: 4, 后果: '村庄被洗劫。' }],
        },
        阶段二_发展: { 时间范围: '之后', 主线节点: [{ 名称: '乙事件', 事件: '乙发生。' }] },
    },
};

async function withThreads(plot) {
    const { data, runtime } = plot.getPlotApi();
    const project = await data.createProject('钩子线');
    data.saveProject({ ...project, outline: { ...project.outline, volumes: volumesFromValue(THREAD_OUTLINE) } });
    await runtime.switchProject(project.id);
    return project;
}

await check('检测提示带进度钟与支线钩子，结果按 applyCheck 合并：钟推进、钩子激活', async () => {
    const world = makeWorld();
    const plot = await boot(world);
    await withThreads(plot);
    const { runtime } = plot.getPlotApi();
    world.setReply(() => '{"done":[],"stageDone":false,"clocks":[{"name":"山匪逼近","tick":2}],"hooks":["酒馆密谈"],"newThread":null,"reason":"推进"}');
    world.context.chat.push({ mes: '主角走进酒馆。', is_user: false });
    await runtime.checkNow({ manual: true });
    assert.match(world.aiCalls[0].system, /"clocks"/);
    assert.match(world.aiCalls[0].user, /【世界进度钟】/);
    assert.match(world.aiCalls[0].user, /【支线钩子】/);
    const threads = runtime.progress().threads;
    const clock = Object.values(threads.clocks)[0];
    const hook = Object.values(threads.hooks)[0];
    assert.equal(clock.filled, 2);
    assert.equal(hook.at, 1, '条件钩子在检测时的楼数激活');
    assert.ok(runtime.diagnose().logs.some(item => /进度钟「山匪逼近」推进到 2\/4/.test(item.text)));
    const lore = await loreNow(world);
    assert.match(lore[0].content, /酒馆密谈/, '激活的支线写进当前阶段条目');
    assert.doesNotMatch(lore[0].content, /进度钟: 4/, '带新键的节点不原样写进阶段 YAML');
    await plot.destroy();
});

await check('检测失败只记 lastFailFloor，不动 lastCheckFloor；之后按两者较大值计间隔，成功后删掉', async () => {
    const world = makeWorld();
    const plot = await boot(world);
    await withProject(plot);
    const { runtime } = plot.getPlotApi();
    world.setReply(() => { throw new Error('接口挂了'); });
    world.context.chat.push({ mes: '一', is_user: false }, { mes: '二', is_user: true }, { mes: '三', is_user: false });
    await world.eventSource.emit('msg_received', 2);
    await tick(6500);
    assert.equal(runtime.progress().lastCheckFloor, 0);
    assert.equal(runtime.progress().lastFailFloor, 3);
    const calls = world.aiCalls.length;
    world.context.chat.push({ mes: '四', is_user: false });
    await world.eventSource.emit('msg_received', 3);
    await tick(10);
    assert.equal(world.aiCalls.length, calls, '失败后照样隔 N 楼再试');
    world.setReply(() => '{"done":[],"stageDone":false,"reason":"无"}');
    await runtime.checkNow({ manual: true });
    assert.equal(runtime.progress().lastCheckFloor, 4);
    assert.ok(!('lastFailFloor' in runtime.progress()));
    world.context.chat.splice(2);
    await world.eventSource.emit('msg_deleted');
    assert.equal(runtime.progress().lastCheckFloor, 2, '删楼后夹到现有楼数');
    await plot.destroy();
});

await check('正文开了大纲外的新线：询问模式弹提示卡，收录后进当前阶段支线并入大纲历史；忽略后不再提', async () => {
    const world = makeWorld();
    const plot = await boot(world);
    const project = await withProject(plot);
    const { data, runtime } = plot.getPlotApi();
    const shown = [];
    plot.notice.subscribe(list => shown.splice(0, shown.length, ...list));
    world.setReply(() => '{"done":[],"stageDone":false,"newThread":{"name":"追查玉佩","summary":"主角决定追查玉佩来历"},"reason":"无"}');
    world.context.chat.push({ mes: '主角捡起玉佩。', is_user: false });
    await runtime.checkNow({ manual: true });
    const card = shown.find(item => item.id === 'thread');
    assert.ok(card, '弹出新线提示');
    card.actions[0].run();
    const after = data.project(project.id);
    assert.ok(after.outline.volumes[0].stages[0].data.支线事件.some(node => node.名称 === '追查玉佩' && node.来源 === '玩家'));
    assert.equal(after.outline.history[0].label, '收录支线');
    world.setReply(() => '{"done":[],"stageDone":false,"newThread":{"name":"另一条线"},"reason":"无"}');
    shown.splice(0);
    await runtime.checkNow({ manual: true });
    shown.find(item => item.id === 'thread').actions[1].run();
    assert.deepEqual(runtime.progress().threads.ignored, ['另一条线']);
    shown.splice(0);
    await runtime.checkNow({ manual: true });
    assert.ok(!shown.some(item => item.id === 'thread'), '忽略过的线不再提示');
    data.updateSettings({ newThreadMode: 'off' });
    world.setReply(() => '{"done":[],"stageDone":false,"newThread":{"name":"第三条线"},"reason":"无"}');
    await runtime.checkNow({ manual: true });
    assert.doesNotMatch(world.aiCalls[world.aiCalls.length - 1].system, /newThread/, '不识别时提示里不要 newThread');
    await plot.destroy();
});

await check('读进度时按大纲对照表归位：别的聊天合并过阶段（阶段 id 别名），本聊天的 current 跟过去并写回', async () => {
    const world = makeWorld();
    const plot = await boot(world);
    const project = await withProject(plot);
    const { data, runtime } = plot.getPlotApi();
    const [first, second] = data.project(project.id).outline.volumes[0].stages;
    world.context.chatMetadata.plotInjector.byProject[project.id] = { projectId: project.id, current: second.id, slots: {}, muted: [], offMuted: [], lastCheckFloor: 0, pace: 'normal' };
    await world.eventSource.emit('chat_changed');
    data.updateProject(project.id, current => ({ ...current, outline: { ...current.outline, volumes: [{ ...current.outline.volumes[0], stages: [first] }], idAlias: { [second.id]: first.id } } }));
    assert.equal(runtime.progress().current, first.id);
    assert.equal(world.context.chatMetadata.plotInjector.byProject[project.id].current, first.id, '归位结果写回聊天');
    await plot.destroy();
});

await check('支线、世界动态按项目关闭：注入与检测都看不到这一类，大纲原样保留', async () => {
    const world = makeWorld();
    const plot = await boot(world);
    const project = await withThreads(plot);
    const { data, runtime } = plot.getPlotApi();
    data.updateProject(project.id, current => ({ ...current, threads: { sideOn: false, worldOn: false } }));
    world.setReply(() => '{"done":[],"stageDone":false,"reason":"无"}');
    world.context.chat.push({ mes: '一', is_user: false });
    await runtime.checkNow({ manual: true });
    assert.doesNotMatch(world.aiCalls[0].user, /酒馆密谈|山匪逼近/);
    assert.doesNotMatch(world.aiCalls[0].system, /"clocks"|"hooks"|newThread/);
    assert.doesNotMatch((await loreNow(world))[0].content, /酒馆密谈|山匪逼近/);
    assert.ok(data.project(project.id).outline.volumes[0].stages[0].data.支线事件.length);
    await plot.destroy();
});

await check('改写后续阶段：改写前的大纲入历史版本', async () => {
    const world = makeWorld();
    const plot = await boot(world);
    const project = await withProject(plot);
    const { data, runtime } = plot.getPlotApi();
    world.setReply(() => `\`\`\`yaml\n${JSON.stringify({ 剧情_卷一_测试: { 阶段一_改写: { 时间范围: '现在', 主线节点: [{ 名称: '丙事件' }] } } })}\n\`\`\``);
    world.context.chat.push({ mes: '一', is_user: false });
    await runtime.rewriteRest('偏了');
    const after = data.project(project.id);
    assert.equal(after.outline.history[0].label, '偏离改写');
    assert.equal(runtime.units()[0].stage.key, '阶段一_改写');
    await plot.destroy();
});

await check('destroy 解绑全部酒馆监听', async () => {
    const world = makeWorld();
    const plot = await boot(world);
    assert.equal(world.eventSource.count(), 9);
    await plot.destroy();
    assert.equal(world.eventSource.count(), 0);
});

console.log(`Plot injector host checks passed (${passed} cases).`);
