import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
    LIVE_HOST_SETTING_MAX, appendLiveDanmaku, createEmptyInteractiveScope, createEmptyInteractiveStore, createLiveRoom,
    deriveInteractiveActorId, ensureInteractiveActor, isLiveRoomWarmedUp, normalizeInteractiveStore, updateLiveRoom,
} from '../src/interactive-scene-model.js';
import { parseBackupData } from '../src/settings-backup-validate.js';
import {
    LIVE_FLY_LIMIT, describeLiveRoom, formatLiveOnline, getLiveDanmakuMotion, liveCoverIndex, liveOnlineCount,
    renderLiveCompose, renderLiveList, renderLiveRoom,
} from '../src/live-views.js';
import { PHONE_UI_STORAGE_KEY } from '../src/storage.js';
import { PHONE_UI_PAGES } from '../src/interactive-scene-constants.js';
import { createCommunityTaskController, createLiveGenerationRunner } from '../src/interactive-scene-scheduler.js';
import { installInteractiveScenes } from '../src/interactive-scenes.js';

let passed = 0;
const check = async (name, run) => {
    try { await run(); passed += 1; } catch (error) { console.error(`FAIL ${name}`); throw error; }
};
const clone = value => JSON.parse(JSON.stringify(value));
const SCOPE = 'story';
const storyActor = { type: 'story', displayName: '林晚', bindingKey: 'character:linwan.png', profile: '图书管理员' };
const makeScope = () => {
    const store = createEmptyInteractiveStore();
    const scope = store.scopes[SCOPE] = createEmptyInteractiveScope();
    const actor = ensureInteractiveActor(scope, SCOPE, storyActor);
    return { store, scope, actor };
};

// ===== 数据层：hostSetting 与 updateLiveRoom =====
await check('createLiveRoom 保存 hostSetting 并截断到上限', () => {
    const { scope, actor } = makeScope();
    const room = createLiveRoom(scope, SCOPE, { title: '深夜电台', category: '聊天', hostActorId: actor.actorId, hostNameSnapshot: '林晚', hostSetting: '  温柔  ', nsfw: true });
    assert.equal(room.hostSetting, '温柔');
    assert.equal(room.nsfw, true);
    assert.equal(Object.hasOwn(createLiveRoom(scope, SCOPE, { title: '无设定' }), 'hostSetting'), false);
    assert.equal(createLiveRoom(scope, SCOPE, { title: '长设定', hostSetting: '设'.repeat(LIVE_HOST_SETTING_MAX + 50) }).hostSetting.length, LIVE_HOST_SETTING_MAX);
});
await check('v3 严格校验接受合法 hostSetting 并往返保留', () => {
    const { store, scope, actor } = makeScope();
    createLiveRoom(scope, SCOPE, { title: '深夜电台', hostActorId: actor.actorId, hostNameSnapshot: '林晚', hostSetting: '温柔的钢琴主播' });
    const room = Object.values(normalizeInteractiveStore(clone(store)).scopes[SCOPE].liveRooms)[0];
    assert.equal(room.hostSetting, '温柔的钢琴主播');
});
await check('v3 严格校验拒绝非法 hostSetting，空串不落盘', () => {
    const { store, scope } = makeScope();
    createLiveRoom(scope, SCOPE, { title: '直播' });
    const attempt = hostSetting => {
        const raw = clone(store);
        Object.values(raw.scopes[SCOPE].liveRooms)[0].hostSetting = hostSetting;
        return normalizeInteractiveStore(raw);
    };
    assert.throws(() => attempt(' 带空白'), /hostSetting 不能包含首尾空白/);
    assert.throws(() => attempt('设'.repeat(LIVE_HOST_SETTING_MAX + 1)), /hostSetting 长度不能超过 1000/);
    assert.throws(() => attempt(42), /hostSetting 必须是字符串/);
    assert.equal(Object.hasOwn(Object.values(attempt('').scopes[SCOPE].liveRooms)[0], 'hostSetting'), false);
});
await check('updateLiveRoom 改字段、清主播绑定，不动弹幕与来源', () => {
    const { scope, actor } = makeScope();
    const room = createLiveRoom(scope, SCOPE, { title: '旧标题', category: '音乐', hostActorId: actor.actorId, hostNameSnapshot: '林晚', hostSetting: '旧设定', sourceSceneId: 'scene-a' });
    appendLiveDanmaku(scope, SCOPE, room, [{ author: '观众', content: '你好', kind: 'chat' }]);
    const before = room.createdAt;
    updateLiveRoom(scope, room.id, { title: ' 新标题 ', category: '游戏', hostIsUser: true, hostActorId: actor.actorId, hostNameSnapshot: '我', hostSetting: '', nsfw: true });
    assert.deepEqual([room.title, room.category, room.hostIsUser, room.nsfw, room.hostNameSnapshot], ['新标题', '游戏', true, true, '我']);
    assert.equal(Object.hasOwn(room, 'hostActorId'), false, '主播是我时不保留角色绑定');
    assert.equal(Object.hasOwn(room, 'hostSetting'), false);
    assert.equal(room.danmaku.length, 1);
    assert.equal(room.sourceSceneId, 'scene-a');
    assert.equal(room.createdAt, before);
    assert.throws(() => updateLiveRoom(scope, room.id, { title: '  ' }), /标题不能为空/);
    assert.throws(() => updateLiveRoom(scope, room.id, { title: 'x', hostActorId: 'actor_missing' }), /主播角色不存在/);
    assert.throws(() => updateLiveRoom(scope, 'live_missing', { title: 'x' }), /直播间不存在/);
    normalizeInteractiveStore(clone({ version: 3, scopes: { [SCOPE]: scope } }));
});
await check('备份校验：hostSetting 往返与拒绝', () => {
    const { store, scope, actor } = makeScope();
    createLiveRoom(scope, SCOPE, { title: '直播', hostActorId: actor.actorId, hostNameSnapshot: '林晚', hostSetting: '温柔' });
    const current = { theme: {}, interactiveScenes: createEmptyInteractiveStore() };
    const backupWith = hostSetting => {
        const raw = clone(store);
        const room = Object.values(raw.scopes[SCOPE].liveRooms)[0];
        if (hostSetting === undefined) delete room.hostSetting; else room.hostSetting = hostSetting;
        return { schemaVersion: 3, interactiveScenes: raw };
    };
    const parsed = parseBackupData(backupWith('温柔'), current).interactiveScenes.scopes[SCOPE];
    assert.equal(Object.values(parsed.liveRooms)[0].hostSetting, '温柔');
    parseBackupData(backupWith(undefined), current);
    assert.throws(() => parseBackupData(backupWith('设'.repeat(1001)), current), /hostSetting 长度不能超过 1000/);
    assert.throws(() => parseBackupData(backupWith(' 空白 '), current), /hostSetting 不能包含首尾空白/);
    assert.throws(() => parseBackupData(backupWith(7), current), /hostSetting 必须是字符串/);
});

// ===== 渲染层 =====
await check('在线人数稳定、格式与封面色', () => {
    assert.equal(formatLiveOnline(23456), '2.3万 在线');
    assert.equal(formatLiveOnline(4620), '4,620 在线');
    assert.equal(formatLiveOnline(90000), '9.0万 在线');
    for (const id of ['live_a', 'live_b', 'live_c', 'room-1', 'room-2']) {
        const count = liveOnlineCount(id);
        assert.ok(count >= 1200 && count <= 90000, `${id} 在线人数 ${count} 越界`);
        assert.equal(count, liveOnlineCount(id), '同一房间人数必须稳定');
        assert.ok([1, 2, 3, 4, 5].includes(liveCoverIndex(id)));
        assert.equal(liveCoverIndex(id), liveCoverIndex(id));
    }
    const motion = getLiveDanmakuMotion({ id: 'd1', content: '前排' });
    assert.deepEqual(motion, getLiveDanmakuMotion({ id: 'd1', content: '前排' }));
    assert.ok(motion.lane >= 0 && motion.lane < 6 && motion.duration >= 5 && motion.duration <= 10 && motion.delay <= 0);
});
await check('直播列表：房间卡、直播中判定、空态', () => {
    const { scope, actor } = makeScope();
    const live = createLiveRoom(scope, SCOPE, { title: '深夜弹琴<陪你>睡', category: '音乐', hostActorId: actor.actorId, hostNameSnapshot: '林晚' });
    appendLiveDanmaku(scope, SCOPE, live, [{ author: '海盐', content: '好听', kind: 'chat' }]);
    const idle = createLiveRoom(scope, SCOPE, { title: '午夜书房', hostNameSnapshot: '书房' });
    assert.equal(isLiveRoomWarmedUp(scope, live), true);
    assert.equal(isLiveRoomWarmedUp(scope, idle), false);
    const html = renderLiveList({ rooms: [describeLiveRoom(scope, live), describeLiveRoom(scope, idle)] });
    assert.equal((html.match(/class="pm-live-card"/g) || []).length, 2);
    assert.match(html, /直播中/);
    assert.match(html, /未开播/);
    assert.match(html, /林晚 · 音乐/);
    assert.match(html, /深夜弹琴&lt;陪你&gt;睡/, '标题必须转义');
    assert.equal((html.match(/pm-live-count/g) || []).length, 1, '只有直播中的房间显示在线人数');
    assert.match(html, /data-live-action="compose">开播</);
    assert.match(html, /class="pm-live-initial">林</);
    assert.match(html, /<b class="pm-live-heading">噼哩噼哩<\/b>/, '直播列表顶栏标题是「噼哩噼哩」');
    assert.doesNotMatch(html, /<b class="pm-live-heading">直播<\/b>/);
    assert.match(html, /<div class="pm-live-scroll"><p class="pm-live-slogan">（゜-゜）つロ 干杯<\/p>/, '小标语放在列表顶部');
    const empty = renderLiveList({ rooms: [] });
    assert.match(empty, /还没有直播间/);
    assert.match(empty, /pm-live-empty[\s\S]*data-live-action="compose">开播/);
    assert.doesNotMatch(empty, /pm-live-card"/);
});
await check('开播页：胶囊、其他主播输入、成人内容、编辑多删除键', () => {
    const hosts = [{ key: 'user', label: '我' }, { key: 'actor:a1', label: '林晚' }, { key: 'other', label: '其他' }];
    const form = { title: '夜跑', category: '户外', hostKey: 'actor:a1', hostName: '', hostSetting: '设定', nsfw: false };
    const create = renderLiveCompose({ form, hosts });
    assert.match(create, /data-category="户外" aria-pressed="true"/);
    assert.match(create, /data-host="actor:a1" aria-pressed="true"/);
    assert.match(create, /data-host="user" aria-pressed="false"/);
    assert.doesNotMatch(create, /pm-live-host-name/);
    assert.match(create, /id="pm-live-nsfw"[^>]*aria-checked="false"/);
    assert.match(create, /data-live-action="submit">开播</);
    assert.doesNotMatch(create, /delete-room/);
    for (const category of ['聊天', '音乐', '游戏', '户外', '读书', '情感', '明星']) assert.match(create, new RegExp(`data-category="${category}"`));
    const other = renderLiveCompose({ form: { ...form, hostKey: 'other', hostName: '阿夏', category: '修仙', nsfw: true }, hosts, editing: true });
    assert.match(other, /id="pm-live-host-name"[^>]*value="阿夏"/);
    assert.match(other, /id="pm-live-category-custom"[^>]*value="修仙"/);
    assert.match(other, /aria-checked="true"/);
    assert.match(other, /data-live-action="submit">保存</);
    assert.match(other, /data-live-action="delete-room">删除直播间</);
});
await check('直播间页：评论区四类、占位文案、修改弹幕、飘屏上限', () => {
    const { scope, actor } = makeScope();
    const room = createLiveRoom(scope, SCOPE, { title: '深夜电台', hostActorId: actor.actorId, hostNameSnapshot: '林晚' });
    const rows = [
        ...Array.from({ length: 10 }, (_, index) => ({ id: `x${index}`, kind: 'chat', author: '路人', content: `弹幕${index}` })),
        { id: 'd1', kind: 'chat', author: '海盐', content: '好久没听了' },
        { id: 'd2', kind: 'gift', author: '失眠的鱼', content: '一束花' },
        { id: 'd3', kind: 'host', author: '林晚', content: '谢谢小鱼' },
    ];
    const started = { ...describeLiveRoom(scope, room), started: true };
    const html = renderLiveRoom({ room: started, danmaku: rows, ui: { welcome: '我' } });
    const chatPart = html.slice(html.indexOf('class="pm-live-chat'));
    assert.equal((chatPart.match(/class="pm-live-msg /g) || []).length, 5, '评论区只留最近 5 条');
    assert.doesNotMatch(chatPart, /弹幕7</, '更早的评论不再渲染');
    const flyPart = html.slice(html.indexOf('class="pm-live-fly"'), html.indexOf('pm-live-ttl'));
    assert.doesNotMatch(flyPart, /一束花/, '礼物不进横飞');
    const lanes = [...flyPart.matchAll(/--lane:(\d+)/g)].map(match => Number(match[1]));
    assert.equal(new Set(lanes).size, lanes.length, '横飞每条占一条独立轨道，不叠在同一轨道');
    assert.match(html, /is-chat"><span class="pm-live-line"><b class="pm-live-name">海盐：<\/b><span class="pm-live-text">好久没听了/);
    assert.match(html, /is-gift"><span class="pm-live-line"><b class="pm-live-name">失眠的鱼<\/b> 投喂 一束花 ×1/);
    assert.match(html, /is-host"><span class="pm-live-line"><em class="pm-live-tag">主播<\/em><b class="pm-live-name">林晚：<\/b><span class="pm-live-text">谢谢小鱼/);
    assert.match(html, /pm-live-follow/, '主播不是我时带关注');
    assert.match(html, /pm-live-pop[\s\S]*?<span>\d/, '主播胶囊下带热度');
    assert.match(html, /pm-live-viewers">[\s\S]*?<span>[\d.]+万?<\/span><\/span>/, '右上角是人数图标加数字');
    assert.match(renderLiveRoom({ room: started, danmaku: rows.slice(-2), ui: { welcome: '我' } }), /is-system">欢迎 我 进入直播间/);
    const hostView = renderLiveRoom({ room: { ...started, hostIsUser: true }, danmaku: rows, ui: {} });
    assert.equal((hostView.slice(hostView.indexOf('class="pm-live-chat')).match(/class="pm-live-msg /g) || []).length, 6, '主播是我时评论区留 6 条');
    assert.match(html, /placeholder="发个弹幕"/);
    assert.match(html, /正在直播：深夜电台/);
    assert.equal((html.match(/--lane:/g) || []).length, LIVE_FLY_LIMIT, '飘屏只取最近若干条');
    assert.doesNotMatch(html, /data-live-action="edit-danmaku"/);
    assert.doesNotMatch(html, /data-live-action="warmup"/, '已开播的房间没有播放键');
    const mine = renderLiveRoom({ room: { ...started, hostIsUser: true }, danmaku: rows, ui: { welcome: '我', editing: true, busy: true } });
    assert.match(mine, /placeholder="对观众说……"/);
    assert.doesNotMatch(mine, /pm-live-follow/, '主播是我时不带关注');
    assert.doesNotMatch(mine, /进入直播间/, '主播是我时不插欢迎语');
    assert.equal((mine.match(/data-live-action="edit-danmaku"/g) || []).length, rows.length);
    assert.match(mine, /停止修改/);
    assert.match(mine, /data-live-action="poke"[^>]*disabled/);
    const idle = renderLiveRoom({ room: { ...started, started: false }, danmaku: [], ui: {} });
    assert.match(idle, /data-live-action="warmup"/);
    assert.match(idle, /未开播：深夜电台/);
    assert.match(idle, /还没有人发言/);
});
await check('直播间页：用户名等文本全部转义', () => {
    const room = { id: 'r', title: '<img src=x>', hostName: '<b>', hostIsUser: false, initial: '<', cover: 1, started: true, online: '1 在线' };
    const html = renderLiveRoom({ room, danmaku: [{ id: 'd', kind: 'chat', author: '<script>', content: '"><svg onload=1>' }], ui: { status: '<i>' } });
    assert.doesNotMatch(html, /<script>|<svg onload|<img src=x>|<i>/);
});

// ===== 调度：直播间目标与社区共用同一把锁 =====
const makeController = (live = () => true) => {
    const runtime = {};
    return { runtime, controller: createCommunityTaskController({ runtime, isAllowed: () => true, isTargetActive: () => true, isLiveTargetActive: live }) };
};
await check('任务控制器：直播间目标与社区目标互斥', () => {
    const { controller } = makeController();
    assert.equal(controller.begin({ kind: 'x', storageId: SCOPE }), null, '没有 sceneId 也没有 roomId 不能开任务');
    const live = controller.begin({ kind: 'manual-danmaku', storageId: SCOPE, roomId: 'r1' });
    assert.deepEqual([live.roomId, Object.hasOwn(live, 'sceneId')], ['r1', false]);
    assert.equal(controller.begin({ kind: 'manual-feed', storageId: SCOPE, sceneId: 's1' }), null);
    assert.equal(controller.begin({ kind: 'manual-danmaku', storageId: SCOPE, roomId: 'r2' }), null);
    assert.equal(controller.isActive(live), true);
    controller.finish(live);
    assert.ok(controller.begin({ kind: 'manual-feed', storageId: SCOPE, sceneId: 's1' }));
});
await check('任务控制器：取消使直播任务失效，目标不在场时不算活动', () => {
    const { controller } = makeController();
    const task = controller.begin({ kind: 'manual-danmaku', storageId: SCOPE, roomId: 'r1' });
    controller.cancel('left');
    assert.equal(controller.isActive(task), false);
    const away = makeController(() => false);
    assert.equal(away.controller.isActive(away.controller.begin({ kind: 'manual-danmaku', storageId: SCOPE, roomId: 'r1' })), false);
});
const makeRunner = ({ request, live = () => true }) => {
    const { controller } = makeController(live);
    const log = { commits: [], renders: 0, statuses: [], targets: [] };
    const runner = createLiveGenerationRunner({
        controller, getTarget: () => ({ storageId: SCOPE, roomId: 'r1' }),
        request: async target => { log.targets.push(target); return request(target); },
        commitDanmaku: async (target, items, isValid, onComplete) => { log.commits.push({ target, items, valid: isValid() }); await onComplete?.(); },
        onRender: () => { log.renders += 1; }, onStatus: text => log.statuses.push(text),
    });
    return { controller, runner, log };
};
await check('直播生成器：按 { storageId, roomId } 请求并提交，完成后渲染', async () => {
    const { runner, log, controller } = makeRunner({ request: () => [{ author: '甲', content: '哈', kind: 'chat' }] });
    let completed = 0;
    assert.equal(await runner.generateDanmaku(null, { taskKind: 'manual-danmaku', onComplete: () => { completed += 1; } }), true);
    assert.deepEqual(log.targets, [{ storageId: SCOPE, roomId: 'r1' }]);
    assert.equal(log.commits.length, 1);
    assert.equal(log.commits[0].valid, true);
    assert.equal(completed, 1);
    assert.equal(log.renders, 1);
    assert.equal(controller.state().task, null, '完成后释放任务锁');
});
await check('直播生成器：失败显示错误并释放锁，取消静默', async () => {
    const failing = makeRunner({ request: () => { throw new Error('接口炸了'); } });
    await assert.rejects(failing.runner.generateDanmaku(), /接口炸了/);
    assert.equal(failing.log.statuses.length, 1);
    assert.match(failing.log.statuses[0], /接口炸了/);
    assert.equal(failing.controller.state().task, null);
    assert.ok(failing.controller.begin({ kind: 'x', storageId: SCOPE, roomId: 'r1' }), '失败后可以再次生成');
    const away = makeRunner({ request: () => [{ author: '甲', content: '哈' }], live: () => false });
    await assert.rejects(away.runner.generateDanmaku(), /生成已取消/);
    assert.deepEqual(away.log.statuses, []);
    assert.equal(away.log.commits.length, 0, '离开直播间后不得写入结果');
    assert.equal(away.controller.state().task, null);
});
await check('直播生成器：已有任务时拒绝并提示', async () => {
    let release = () => {};
    const gate = new Promise(resolve => { release = resolve; });
    const { runner, log } = makeRunner({ request: async () => { await gate; return [{ author: '甲', content: '哈' }]; } });
    const first = runner.generateDanmaku();
    await assert.rejects(runner.generateDanmaku(), /已有社区生成任务正在进行/);
    release();
    assert.equal(await first, true);
    assert.equal(log.targets.length, 1);
});
await check('旧社区迁来的直播间照常列出', () => {
    const legacy = normalizeInteractiveStore({ version: 1, scopes: { s: { activeSceneId: 'sc', sceneOrder: ['sc'], scenes: { sc: {
        id: 'sc', title: '旧社区', posts: [], live: { title: '旧直播', danmaku: [{ id: 'd1', author: '访客', content: '旧弹幕' }] },
    } } } } });
    const scope = legacy.scopes.s;
    const room = Object.values(scope.liveRooms)[0];
    assert.equal(room.sourceSceneId, 'sc');
    const html = renderLiveList({ rooms: [describeLiveRoom(scope, room)] });
    assert.match(html, /旧直播/);
    assert.match(html, /直播中/);
    assert.match(html, /旧社区/);
});

// ===== 真实安装层：假 DOM 驱动桌面入口、开播、热场、发送、编辑与取消 =====
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const waitFor = async (predicate, label) => {
    for (let index = 0; index < 400; index += 1) { if (predicate()) return; await wait(5); }
    throw new Error(`等待超时：${label}`);
};
const unescapeHtml = value => value.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
const makeLivePage = () => {
    const page = { dataset: {}, hidden: true, className: '', listeners: new Map(), html: '', fields: new Map() };
    Object.defineProperty(page, 'innerHTML', { get() { return this.html; }, set(value) { this.html = value; this.fields = new Map(); } });
    page.chat = { scrollHeight: 100, clientHeight: 50, scrollTop: 0 };
    page.addEventListener = (type, listener) => { page.listeners.set(type, listener); };
    const defaultValue = id => {
        const input = page.html.match(new RegExp(`id="${id}"[^>]*?value="([^"]*)"`));
        if (input) return unescapeHtml(input[1]);
        const area = page.html.match(new RegExp(`id="${id}"[^>]*>([^<]*)</textarea>`));
        return area ? unescapeHtml(area[1]) : '';
    };
    page.querySelector = selector => {
        if (selector === '.pm-live-chat') return page.html.includes('pm-live-chat') ? page.chat : null;
        if (!selector.startsWith('#') || !page.html.includes(`id="${selector.slice(1)}"`)) return null;
        const id = selector.slice(1);
        if (!page.fields.has(id)) page.fields.set(id, { id, value: defaultValue(id) });
        return page.fields.get(id);
    };
    page.querySelectorAll = () => [];
    return page;
};
const previousGlobals = {
    window: globalThis.window, document: globalThis.document, localStorage: globalThis.localStorage,
    indexedDB: globalThis.indexedDB, alert: globalThis.alert,
};
try {
    const storage = new Map();
    globalThis.localStorage = {
        getItem: key => storage.get(key) ?? null,
        setItem: (key, value) => { storage.set(key, String(value)); },
        removeItem: key => { storage.delete(key); },
    };
    globalThis.indexedDB = { open() { throw new Error('IDB unavailable'); } };
    globalThis.alert = () => {};
    const SCOPE_ID = 'live-install-scope';
    const mainUi = {
        dataset: { page: 'desktop' }, livePage: null,
        appendChild(node) { this.livePage = node; },
        querySelector(selector) { return selector === '[data-phone-page="live"]' ? this.livePage : null; },
    };
    const desktopPage = { innerHTML: '' };
    globalThis.document = {
        visibilityState: 'visible',
        getElementById: () => null,
        querySelector(selector) {
            if (selector === '#pm-iphone .pm-main-ui') return mainUi;
            if (selector === '.pm-desktop-page') return desktopPage;
            if (selector === '.pm-community-page') return { innerHTML: '' };
            return null;
        },
        createElement(tag) { assert.equal(tag, 'section'); return makeLivePage(); },
    };
    const dialogs = { confirm: true, prompt: null };
    globalThis.window = {
        power_user: {}, confirm: () => dialogs.confirm, prompt: () => dialogs.prompt,
        __pmShowPhonePage(page) {
            mainUi.dataset.page = page;
            if (mainUi.livePage) mainUi.livePage.hidden = page !== 'live';
            return true;
        },
    };
    const phoneListeners = new Map();
    const phoneWindow = {
        dataset: {}, contains: () => true, querySelectorAll: () => [],
        addEventListener(type, listener) { phoneListeners.set(type, listener); },
        querySelector(selector) {
            if (selector === '.pm-main-ui') return mainUi;
            return selector === '[data-phone-page="live"]' ? mainUi.livePage : null;
        },
    };
    const state = { phoneActive: true, isMinimized: false, phoneWindow };
    const aiCalls = [];
    const aiQueue = [];
    const envelope = items => JSON.stringify({ version: 2, kind: 'danmaku_batch', items });
    const defaultItems = [
        { author: '林晚', content: '谢谢大家', kind: 'host' }, { author: '海盐', content: '好久没听了', kind: 'chat' },
        { author: '失眠的鱼', content: '一束花', kind: 'gift' },
    ];
    const deps = {
        getCtx: () => ({ characters: [{ name: '林晚', avatar: 'linwan.png', description: '图书管理员', personality: '温柔' }], characterId: 0 }),
        getStorageId: () => SCOPE_ID,
        getUserPersona: () => ({ name: '我', description: '' }),
        gatherContext: async () => ({ cardDesc: '', cardPersonality: '', cardScenario: '', worldBookText: '', mainChatText: '' }),
        callAI: async (systemPrompt, userPrompt, options) => {
            aiCalls.push({ systemPrompt, userPrompt, options });
            const next = aiQueue.length ? await aiQueue.shift()() : defaultItems;
            return envelope(next);
        },
        applyBidirectionalInjection: async () => {},
        saveBudgetConfig: () => true,
        getPhoneWindow: () => phoneWindow,
    };
    installInteractiveScenes(state, deps);
    assert.equal(deps.bindPhonePageUi(phoneWindow), true);
    let openedCount = 0;
    const openLive = window.__pmOpenLiveApp;
    window.__pmOpenLiveApp = (...args) => { openedCount += 1; return openLive(...args); };
    const loadStoreNow = () => deps.getInteractiveStore();
    const scopeNow = async () => (await loadStoreNow()).scopes[SCOPE_ID];
    const page = () => mainUi.livePage;
    const html = () => page().html;
    const act = (action, dataset = {}) => {
        const button = {
            tagName: 'BUTTON', dataset: { liveAction: action, ...dataset }, parentElement: null,
            classList: { toggle() {} }, setAttribute() {},
            closest(selector) { return selector === '[data-live-action]' ? this : null; },
        };
        return page().listeners.get('click')({ target: button });
    };
    const setField = (id, value) => { page().querySelector(`#${id}`).value = value; };
    const statusText = () => unescapeHtml((html().match(/class="pm-live-status"[^>]*>([^<]*)</) || [])[1] || '');
    const grabRoom = async () => { const scope = await scopeNow(); return scope.liveRooms[scope.liveOrder.at(-1)]; };
    await check('桌面 desktop-live 能打开直播页，页面状态 live 能恢复', async () => {
        const desktopButton = {
            tagName: 'BUTTON', dataset: { action: 'desktop-live', app: 'live' },
            closest(selector) { return selector === '[data-action]' ? this : selector === '.pm-desktop-page' ? desktopPage : null; },
        };
        phoneListeners.get('click')({ target: desktopButton });
        await waitFor(() => mainUi.dataset.page === 'live' && page()?.html, '打开直播页');
        assert.equal(openedCount, 1);
        assert.equal(page().hidden, false);
        assert.match(html(), /data-live-view="list"/);
        assert.match(html(), /还没有直播间/);
        assert.match(storage.get(PHONE_UI_STORAGE_KEY) || '', /"lastPage":"live"/, '打开直播页必须记住最后页面');
        mainUi.dataset.page = 'desktop';
        await deps.restorePhoneUi();
        assert.equal(mainUi.dataset.page, 'live', '重开手机后回到直播页');
    });
    await check('开播：选剧情角色，主播设定预填，写入 hostActorId、快照、分区与成人内容', async () => {
        await act('compose');
        assert.match(html(), /data-live-view="compose"/);
        assert.match(html(), /data-host="actor:[^"]+" aria-pressed="true"/);
        assert.match(html(), /图书管理员\n温柔<\/textarea>/, '选剧情角色时预填角色设定');
        setField('pm-live-title', '深夜弹琴陪你睡');
        await act('pick-category', { category: '音乐' });
        assert.match(html(), /value="深夜弹琴陪你睡"/, '换分区后标题保留');
        await act('toggle-nsfw');
        await act('submit');
        const scope = await scopeNow();
        const room = await grabRoom();
        assert.equal(scope.liveOrder.length, 1);
        assert.equal(room.hostIsUser, false);
        assert.equal(room.hostActorId, deriveInteractiveActorId(SCOPE_ID, 'story', 'character:linwan.png'));
        assert.deepEqual([room.title, room.category, room.nsfw, room.hostNameSnapshot], ['深夜弹琴陪你睡', '音乐', true, '林晚']);
        assert.equal(room.hostSetting, '图书管理员\n温柔');
        assert.match(html(), /data-live-view="room"/);
        assert.match(html(), /欢迎 我 进入直播间/);
    });
    await check('热场：请求参数带 room、hostIsUser、nsfw，返回按 kind 写入，主播发言归到角色', async () => {
        await act('warmup');
        await waitFor(() => /正在直播：深夜弹琴陪你睡/.test(html()), '热场完成');
        assert.equal(aiCalls.length, 1);
        const call = aiCalls[0];
        for (const expected of ['深夜弹琴陪你睡', '分区：音乐', '主播：林晚', '图书管理员', '主播由你扮演', '成人模式']) {
            assert.ok(call.userPrompt.includes(expected), `提示词缺少：${expected}`);
        }
        assert.ok(call.options.isolated === true && call.options.signal);
        const room = await grabRoom();
        assert.deepEqual(room.danmaku.map(item => item.kind), ['host', 'chat', 'gift']);
        assert.equal(room.danmaku[0].authorId, room.hostActorId, '主播口播归到所选角色');
        assert.match(html(), /<em class="pm-live-tag">主播<\/em><b class="pm-live-name">林晚：<\/b><span class="pm-live-text">谢谢大家/);
        assert.match(html(), /is-gift"><span class="pm-live-line"><b class="pm-live-name">失眠的鱼<\/b> 投喂 一束花 ×1/);
    });
    await check('发送：主播不是我时存为 chat，不触发请求；拍一拍请求下一批；上翻时不强制滚动', async () => {
        page().chat.scrollHeight = 1000; page().chat.scrollTop = 950;
        setField('pm-live-input', '好听！');
        await act('send');
        const room = await grabRoom();
        assert.deepEqual([room.danmaku.at(-1).kind, room.danmaku.at(-1).content, room.danmaku.at(-1).authorNameSnapshot], ['chat', '好听！', '我']);
        assert.equal(aiCalls.length, 1, '主播不是我时发送不自动请求');
        assert.equal(page().querySelector('#pm-live-input').value, '', '发送后清空输入框');
        assert.equal(page().chat.scrollTop, page().chat.scrollHeight, '发送后滚到底');
        aiQueue.push(async () => [{ author: '路人甲', content: '来了', kind: 'chat' }]);
        page().chat.scrollTop = 0;
        setField('pm-live-input', '草稿');
        await act('poke');
        await waitFor(() => aiCalls.length === 2 && /来了/.test(html()), '拍一拍完成');
        assert.equal(page().chat.scrollTop, 0, '用户上翻时新内容不强制滚动');
        assert.equal(page().querySelector('#pm-live-input').value, '草稿', '重绘保留输入草稿');
        page().chat.scrollTop = page().chat.scrollHeight - page().chat.clientHeight;
        aiQueue.push(async () => [{ author: '路人乙', content: '再来', kind: 'chat' }]);
        await act('poke');
        await waitFor(() => /再来/.test(html()), '第二次拍一拍');
        assert.equal(page().chat.scrollTop, page().chat.scrollHeight, '停在底部时跟随新内容');
    });
    await check('修改弹幕：编辑、取消编辑、删除', async () => {
        await act('toggle-edit-danmaku');
        const target = (await grabRoom()).danmaku.find(item => item.content === '好听！');
        assert.match(html(), new RegExp(`data-live-action="edit-danmaku" data-danmaku-id="${target.id}"`));
        dialogs.prompt = null;
        await act('edit-danmaku', { danmakuId: target.id });
        assert.equal((await grabRoom()).danmaku.find(item => item.id === target.id).content, '好听！', '取消编辑不改内容');
        dialogs.prompt = '  更好听  ';
        await act('edit-danmaku', { danmakuId: target.id });
        assert.equal((await grabRoom()).danmaku.find(item => item.id === target.id).content, '更好听');
        dialogs.confirm = false;
        await act('delete-danmaku', { danmakuId: target.id });
        assert.ok((await grabRoom()).danmaku.some(item => item.id === target.id), '确认框取消不删除');
        dialogs.confirm = true;
        await act('delete-danmaku', { danmakuId: target.id });
        assert.equal((await grabRoom()).danmaku.some(item => item.id === target.id), false);
        await act('toggle-edit-danmaku');
        assert.doesNotMatch(html(), /data-live-action="edit-danmaku"/);
    });
    await check('编辑直播间：预填、保存回到直播间、保留绑定与弹幕，取消编辑回直播间', async () => {
        const before = await grabRoom();
        await act('edit-room');
        assert.match(html(), /data-live-view="compose"/);
        assert.match(html(), /value="深夜弹琴陪你睡"/);
        assert.match(html(), /data-live-action="submit">保存</);
        assert.match(html(), /data-live-action="delete-room">删除直播间</);
        await act('cancel-edit');
        assert.match(html(), /data-live-view="room"/);
        await act('edit-room');
        setField('pm-live-title', '改过的标题');
        await act('submit');
        const after = await grabRoom();
        assert.equal(after.id, before.id);
        assert.deepEqual([after.title, after.hostActorId, after.danmaku.length], ['改过的标题', before.hostActorId, before.danmaku.length]);
        assert.match(html(), /data-live-view="room"/);
    });
    await check('开播：选「我」→ hostIsUser，发送存为 host 并自动请求观众弹幕，AI 写的 host 被丢弃', async () => {
        await act('list');
        await act('compose');
        setField('pm-live-title', '我的小直播');
        await act('pick-host', { host: 'user' });
        await act('submit');
        const room = await grabRoom();
        assert.equal(room.hostIsUser, true);
        assert.equal(Object.hasOwn(room, 'hostActorId'), false);
        assert.deepEqual([room.hostNameSnapshot, room.nsfw, Object.hasOwn(room, 'hostSetting')], ['我', false, false]);
        assert.match(html(), /placeholder="对观众说……"/);
        assert.doesNotMatch(html(), /进入直播间/);
        const callsBefore = aiCalls.length;
        aiQueue.push(async () => [{ author: '林晚', content: '我也是主播', kind: 'host' }, { author: '观众甲', content: '听到啦', kind: 'chat' }]);
        setField('pm-live-input', '大家好');
        await act('send');
        await waitFor(() => /听到啦/.test(html()), '观众回应');
        assert.equal(aiCalls.length, callsBefore + 1, '主播是我时发送后自动请求');
        assert.ok(aiCalls.at(-1).userPrompt.includes('主播是用户本人'));
        assert.ok(aiCalls.at(-1).userPrompt.includes('大家好'), '最近弹幕里带上刚发的口播');
        assert.ok(aiCalls.at(-1).userPrompt.includes('成人模式') === false && aiCalls.at(-1).userPrompt.includes('全年龄'));
        const stored = await grabRoom();
        assert.deepEqual(stored.danmaku.map(item => item.kind), ['host', 'chat']);
        assert.equal(stored.danmaku[0].authorNameSnapshot, '我');
        assert.equal(isLiveRoomWarmedUp(await scopeNow(), stored), true);
    });
    await check('开播：主播选「其他」必须填名字，标题必填，自定义分区生效', async () => {
        await act('list');
        const count = (await scopeNow()).liveOrder.length;
        await act('compose');
        await act('submit');
        assert.equal(statusText(), '请填写直播标题');
        setField('pm-live-title', '夜跑');
        await act('pick-host', { host: 'other' });
        await act('submit');
        assert.equal(statusText(), '请填写主播名字');
        assert.equal((await scopeNow()).liveOrder.length, count);
        setField('pm-live-host-name', '阿夏');
        page().listeners.get('input')({ target: { id: 'pm-live-category-custom', value: ' 修仙 ' } });
        await act('submit');
        const room = await grabRoom();
        assert.deepEqual([room.hostIsUser, Object.hasOwn(room, 'hostActorId'), room.hostNameSnapshot, room.category, room.title], [false, false, '阿夏', '修仙', '夜跑']);
    });
    await check('删除直播间：确认框取消不删，确认后回到列表', async () => {
        const count = (await scopeNow()).liveOrder.length;
        dialogs.confirm = false;
        await act('delete-room');
        assert.equal((await scopeNow()).liveOrder.length, count);
        dialogs.confirm = true;
        await act('delete-room');
        assert.equal((await scopeNow()).liveOrder.length, count - 1);
        assert.match(html(), /data-live-view="list"/);
    });
    await check('并发：已有生成任务时拒绝第二次拍一拍并显示提示', async () => {
        const scope = await scopeNow();
        await act('open-room', { roomId: scope.liveOrder[0] });
        let release = () => {};
        const gate = new Promise(resolve => { release = resolve; });
        const callsBefore = aiCalls.length;
        aiQueue.push(async () => { await gate; return [{ author: '路人', content: '慢来', kind: 'chat' }]; });
        const firstPoke = act('poke');
        await waitFor(() => aiCalls.length === callsBefore + 1, '第一次请求发出');
        assert.match(html(), /aria-busy="true"/);
        await act('poke');
        assert.equal(statusText(), '已有社区生成任务正在进行');
        assert.equal(aiCalls.length, callsBefore + 1, '第二次不得再发请求');
        release();
        await firstPoke;
        await waitFor(() => /慢来/.test(html()), '第一次完成');
        assert.match(html(), /aria-busy="false"/);
    });
    await check('离开直播间取消进行中的请求，结果不写入，之后可再次生成', async () => {
        let release = () => {};
        const gate = new Promise(resolve => { release = resolve; });
        const callsBefore = aiCalls.length;
        const room = await grabRoom();
        const countBefore = (await scopeNow()).liveRooms[(await scopeNow()).liveOrder[0]].danmaku.length;
        aiQueue.push(async () => { await gate; return [{ author: '路人', content: '迟到的弹幕', kind: 'chat' }]; });
        const latePoke = act('poke');
        await waitFor(() => aiCalls.length === callsBefore + 1, '请求发出');
        await act('list');
        release();
        await latePoke;
        await wait(30);
        const scope = await scopeNow();
        assert.equal(scope.liveRooms[scope.liveOrder[0]].danmaku.length, countBefore, '离开后结果不得写入');
        assert.equal(room.id !== undefined, true);
        assert.equal(statusText(), '', '取消不显示错误');
        await act('open-room', { roomId: scope.liveOrder[0] });
        aiQueue.push(async () => [{ author: '路人', content: '重新来', kind: 'chat' }]);
        await act('poke');
        await waitFor(() => /重新来/.test(html()), '取消后可再次生成');
    });
    await check('社区正文进展不会触发直播间生成', async () => {
        const callsBefore = aiCalls.length;
        for (let turns = 1; turns <= 6; turns += 1) {
            deps.observeCommunityTurn(Array.from({ length: turns * 2 }, (_, index) => ({ mes: `第${index}句`, is_user: index % 2 === 0 })));
        }
        await wait(20);
        assert.equal(aiCalls.length, callsBefore);
    });
    await check('回桌面后页面状态记为 desktop，再恢复不会误开直播页', async () => {
        await act('desktop');
        await waitFor(() => mainUi.dataset.page === 'desktop', '回到桌面');
        await wait(10);
        mainUi.dataset.page = 'chat';
        await deps.restorePhoneUi();
        assert.equal(mainUi.dataset.page, 'desktop');
    });
}
finally {
    for (const [key, value] of Object.entries(previousGlobals)) {
        if (value === undefined) delete globalThis[key]; else globalThis[key] = value;
    }
}

// ===== 静态契约 =====
const [liveCss, scenesSource, liveViewsSource, liveAppSource] = await Promise.all([
    readFile(new URL('../styles/live.css', import.meta.url), 'utf8'),
    readFile(new URL('../src/interactive-scenes.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/live-views.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/live-app.js', import.meta.url), 'utf8'),
]);
await check('reduced-motion：飘屏不再动画，只静态显示最近三条', () => {
    const block = liveCss.match(/@media\(prefers-reduced-motion:reduce\)\{[\s\S]*$/)?.[0] || '';
    assert.match(block, /\.pm-live-fly span\{[^}]*animation:none/);
    assert.match(block, /\.pm-live-fly span\{[^}]*position:static/);
    assert.match(block, /nth-last-child\(-n\+3\)\{display:block/);
    assert.match(liveCss, /\.pm-live-fly span\{[^}]*animation:pm-live-fly var\(--duration\) linear infinite/);
    assert.doesNotMatch(liveCss, /!important/);
});
await check('桌面 desktop-live 分发、live 页恢复与页面登记', () => {
    assert.match(scenesSource, /action === 'desktop-live'\) \{ await window\.__pmOpenLiveApp\?\.\(\)/);
    assert.match(scenesSource, /uiScope\.lastPage === 'live' && await deps\.showLivePage\?\.\(\{ resume: true \}\)/);
    assert.ok(PHONE_UI_PAGES.includes('live'));
    assert.match(liveAppSource, /window\.__pmOpenLiveApp = /);
    assert.match(liveAppSource, /bridge\.updatePhoneUiScope\(scopeId, \{ lastPage: 'live'/);
});
await check('直播视图只内联四个数据驱动变量', () => {
    const styles = [...liveViewsSource.matchAll(/style="([^"]*)"/g)].map(match => match[1]);
    assert.equal(styles.length, 1);
    assert.deepEqual([...styles[0].matchAll(/(--[a-z]+):/g)].map(match => match[1]), ['--lane', '--delay', '--duration', '--offset']);
});

console.log(`Live app checks passed (${passed} checks).`);
