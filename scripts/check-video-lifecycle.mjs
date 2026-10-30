import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { deriveInteractiveActorId } from '../src/interactive-scene-model.js';
import { installInteractiveScenes } from '../src/interactive-scenes.js';
import { VIDEO_TICK_MS } from '../src/video-format.js';
import { check, envelope, eq, match, nomatch, ok } from './video-check-kit.mjs';

// ===== 5. 生命周期与真实安装层 =====
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const waitFor = async (predicate, label) => {
    for (let index = 0; index < 400; index += 1) { if (predicate()) return; await wait(5); }
    throw new Error(`等待超时：${label}`);
};
const unescapeHtml = value => value.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
const makePage = () => {
    const page = { dataset: {}, hidden: true, className: '', listeners: new Map(), html: '', fields: new Map(), nodes: new Map(), scrolls: [], sceneWrites: 0, sceneHtml: '' };
    const reset = () => { page.fields = new Map(); page.nodes = new Map(); page.scene = null; page.fly = null; };
    Object.defineProperty(page, 'innerHTML', { get() { return this.html; }, set(value) { this.html = value; reset(); } });
    page.addEventListener = (type, listener) => { page.listeners.set(type, listener); };
    const defaultValue = id => {
        const input = page.html.match(new RegExp(`id="${id}"[^>]*?value="([^"]*)"`));
        if (input) return unescapeHtml(input[1]);
        const area = page.html.match(new RegExp(`id="${id}"[^>]*>([^<]*)</textarea>`));
        return area ? unescapeHtml(area[1]) : '';
    };
    page.querySelector = selector => {
        if (selector.startsWith('#')) {
            const id = selector.slice(1);
            if (!page.html.includes(`id="${id}"`)) return null;
            if (!page.fields.has(id)) page.fields.set(id, { id, value: defaultValue(id), focus() {} });
            return page.fields.get(id);
        }
        if (selector === '.pm-video-scene' && page.html.includes('class="pm-video-scene"')) {
            page.scene ||= {
                dataset: { sceneIndex: page.html.match(/data-scene-index="(\d+)"/)?.[1] },
                set outerHTML(value) { page.sceneWrites += 1; page.sceneHtml = value; this.dataset.sceneIndex = value.match(/data-scene-index="(\d+)"/)?.[1]; },
            };
            return page.scene;
        }
        if (selector === '.pm-video-fly' && page.html.includes('pm-video-fly')) {
            page.fly ||= { innerHTML: page.html.match(/pm-video-fly" aria-hidden="true">([\s\S]*?)<\/div>/)?.[1] || '' };
            return page.fly;
        }
        return null;
    };
    page.querySelectorAll = selector => {
        if (selector !== '[data-entry-id]') return [];
        return [...page.html.matchAll(/data-entry-id="([^"]+)"/g)].map(found => {
            const id = found[1];
            if (!page.nodes.has(id)) {
                const node = { dataset: { entryId: id }, classes: new Set(), scrollIntoView: options => page.scrolls.push({ id, options }) };
                node.classList = { add: name => node.classes.add(name), remove: name => node.classes.delete(name), toggle() {} };
                page.nodes.set(id, node);
            }
            return page.nodes.get(id);
        });
    };
    return page;
};

const previousGlobals = {
    window: globalThis.window, document: globalThis.document, localStorage: globalThis.localStorage, indexedDB: globalThis.indexedDB,
    alert: globalThis.alert, setInterval: globalThis.setInterval, clearInterval: globalThis.clearInterval, setTimeout: globalThis.setTimeout,
    matchMedia: globalThis.matchMedia, clearTimeout: globalThis.clearTimeout, dateNow: Date.now,
};
const ticks = { set: 0, cleared: 0, active: new Map(), callback: null };
const fresh = { timers: [] };
const clock = { skew: 0 };
try {
    const realNow = Date.now.bind(Date);
    Date.now = () => realNow() + clock.skew;
    const realSetInterval = globalThis.setInterval;
    const realClearInterval = globalThis.clearInterval;
    const realSetTimeout = globalThis.setTimeout;
    globalThis.setInterval = (callback, delay, ...rest) => {
        if (delay !== VIDEO_TICK_MS) return realSetInterval(callback, delay, ...rest);
        const handle = { video: true };
        ticks.set += 1; ticks.active.set(handle, callback); ticks.callback = callback;
        return handle;
    };
    globalThis.clearInterval = handle => {
        if (handle && handle.video === true) { ticks.cleared += 1; ticks.active.delete(handle); return; }
        realClearInterval(handle);
    };
    globalThis.setTimeout = (callback, delay, ...rest) => {
        if (delay === 1800) { const handle = { fresh: true }; fresh.timers.push({ handle, callback }); return handle; }
        return realSetTimeout(callback, delay, ...rest);
    };
    const realClearTimeout = globalThis.clearTimeout;
    globalThis.clearTimeout = handle => { if (handle && handle.fresh === true) return; realClearTimeout(handle); };
    let reduced = false;
    globalThis.matchMedia = () => ({ matches: reduced });
    const storage = new Map();
    globalThis.localStorage = { getItem: key => storage.get(key) ?? null, setItem: (key, value) => { storage.set(key, String(value)); }, removeItem: key => { storage.delete(key); } };
    globalThis.indexedDB = { open() { throw new Error('IDB unavailable'); } };
    globalThis.alert = () => {};
    const SCOPE_ID = 'video-install-scope';
    const mainUi = {
        dataset: { page: 'desktop' }, livePage: null,
        appendChild(node) { this.livePage = node; },
        querySelector(selector) { return selector === '[data-phone-page="live"]' ? this.livePage : null; },
    };
    const desktopPage = { innerHTML: '' };
    const doc = {
        visibilityState: 'visible', getElementById: () => null,
        querySelector(selector) {
            if (selector === '#pm-iphone .pm-main-ui') return mainUi;
            if (selector === '.pm-desktop-page') return desktopPage;
            if (selector === '.pm-community-page') return { innerHTML: '' };
            return null;
        },
        createElement(tag) { assert.equal(tag, 'section'); return makePage(); },
    };
    globalThis.document = doc;
    const dialogs = { confirm: true, prompt: null };
    globalThis.window = {
        power_user: {}, confirm: () => dialogs.confirm, prompt: () => dialogs.prompt,
        __pmShowPhonePage(page) { mainUi.dataset.page = page; if (mainUi.livePage) mainUi.livePage.hidden = page !== 'live'; return true; },
    };
    const phoneListeners = new Map();
    const phoneWindow = {
        dataset: {}, contains: () => true, querySelectorAll: () => [],
        addEventListener(type, listener) { phoneListeners.set(type, listener); },
        querySelector(selector) { return selector === '.pm-main-ui' ? mainUi : selector === '[data-phone-page="live"]' ? mainUi.livePage : null; },
    };
    const state = { phoneActive: true, isMinimized: false, phoneWindow };
    const aiCalls = [];
    const aiQueue = [];
    const defaults = {
        video_create: () => envelope('video_create', [{ author: '路人甲', content: '前方高能', at: 12 }, { author: '我', content: '冒名弹幕', at: 5 }, { author: '路人乙', content: '哈哈哈', at: 40 }], {
            video: { title: 'AI标题', category: 'AI分区', description: 'AI简介', duration: 90, scenes: [{ at: 0, text: '开场' }, { at: 30, text: '高潮' }], cover: '雨夜封面' },
            comments: [{ author: '乙', content: '好看', replies: [{ author: '林晚', content: '谢谢', replyTo: '乙' }] }, { author: '我', content: '冒名评论' }, { author: '戊', content: '课代表' }],
        }),
        video_comments: () => envelope('video_comments', [{ author: '甲', content: '第一' }, { author: '我', content: '冒名' }, { author: '乙', content: '第二' }, { author: '丙', content: '第三' }]),
        video_replies: () => envelope('video_replies', [{ author: '甲', content: '接一', replyTo: '乙' }, { author: '丙', content: '接二' }]),
        video_danmaku: () => envelope('video_danmaku', [{ author: '甲', content: '补一条', at: 3 }, { author: '乙', content: '补二条', at: 20 }]),
    };
    const deps = {
        getCtx: () => ({ characters: [{ name: '林晚', avatar: 'linwan.png', description: '图书管理员', personality: '温柔' }], characterId: 0 }),
        getStorageId: () => SCOPE_ID,
        getUserPersona: () => ({ name: '我', description: '' }),
        gatherContext: async () => ({ cardDesc: '', cardPersonality: '', cardScenario: '', worldBookText: '', mainChatText: '' }),
        callAI: async (systemPrompt, userPrompt, options) => {
            const kind = systemPrompt.match(/"kind":"([a-z_]+)"/)?.[1];
            aiCalls.push({ kind, systemPrompt, userPrompt, options });
            return aiQueue.length ? aiQueue.shift()(kind) : defaults[kind]();
        },
        applyBidirectionalInjection: async () => {},
        saveBudgetConfig: () => true,
        getPhoneWindow: () => phoneWindow,
        showPhoneDesktopPage: async () => { mainUi.dataset.page = 'desktop'; },
        randomSource: () => 0.5,
    };
    installInteractiveScenes(state, deps);
    assert.equal(deps.bindPhonePageUi(phoneWindow), true);
    const page = () => mainUi.livePage;
    const html = () => page().html;
    const scopeNow = async () => (await deps.getInteractiveStore()).scopes[SCOPE_ID];
    const lastVideo = async () => { const scope = await scopeNow(); return scope.videos[scope.videoOrder.at(-1)]; };
    const button = (attr, value, dataset = {}) => ({
        tagName: 'BUTTON', dataset: { [attr]: value, ...dataset }, parentElement: null, classList: { toggle() {} }, setAttribute() {},
        closest(selector) { return selector === `[data-${attr === 'liveAction' ? 'live' : 'video'}-action]` ? this : null; },
    });
    const live = (action, dataset) => page().listeners.get('click')({ target: button('liveAction', action, dataset) });
    const act = (action, dataset) => page().listeners.get('click')({ target: button('videoAction', action, dataset) });
    const setField = (id, value) => { page().querySelector(`#${id}`).value = value; };
    const statusText = () => unescapeHtml((html().match(/class="pm-live-status"[^>]*>([^<]*)</) || [])[1] || '');
    const openApp = async () => {
        mainUi.dataset.page = 'desktop';
        phoneListeners.get('click')({ target: { tagName: 'BUTTON', dataset: { action: 'desktop-live', app: 'live' }, closest(selector) { return selector === '[data-action]' ? this : selector === '.pm-desktop-page' ? desktopPage : null; } } });
        await waitFor(() => mainUi.dataset.page === 'live' && page()?.html, '打开噼哩噼哩');
    };

    await check('安装层：打开噼哩噼哩默认是视频分区，分段切到直播', async () => {
        await openApp();
        match(html(), /data-live-view="video-home"/);
        match(html(), /还没有视频/);
        await live('segment', { segment: 'live' });
        match(html(), /data-live-view="list"/);
        match(html(), /data-live-action="compose">开播</);
        await live('segment', { segment: 'video' });
        match(html(), /data-live-view="video-home"/);
    });
    await check('安装层：用户投稿，标题简介以用户为准，AI 补分镜、弹幕和评论且不冒用用户名', async () => {
        await act('compose');
        match(html(), /data-live-view="video-compose"/);
        setField('pm-video-title', '我的雨夜');
        setField('pm-video-idea', '一段简介');
        await act('pick-category', { category: '生活' });
        match(html(), /id="pm-video-title"[^>]*value="我的雨夜"/, '选分区后标题保留');
        await act('submit');
        const video = await lastVideo();
        eq([video.title, video.description, video.category, video.uploaderIsUser], ['我的雨夜', '一段简介', '生活', true]);
        eq([video.scenes.length, video.duration, video.cover.desc], [2, 90, '雨夜封面']);
        eq([video.danmaku.length, video.comments.length], [2, 2]);
        ok(![...video.danmaku, ...video.comments].some(item => /冒名/.test(item.content)));
        match(html(), /data-live-view="video-watch"/);
        const call = aiCalls.at(-1);
        eq(call.kind, 'video_create');
        match(call.userPrompt, /不要代写/);
        ok(call.options.isolated === true && call.options.signal);
    });
    await check('安装层：不勾「让 AI 写分镜」只保留一段说明；角色UP主留空标题由 AI 起', async () => {
        await act('home');
        await act('compose');
        setField('pm-video-title', '随手拍');
        await act('toggle-ai-scenes');
        await act('submit');
        let video = await lastVideo();
        eq([video.scenes.length, video.duration, video.scenes[0].text], [1, 60, '随手拍']);
        match(aiCalls.at(-1).userPrompt, /meta\.video 只需 cover/);
        await act('home');
        await act('compose');
        const hostKey = html().match(/data-host="(actor:[^"]+)"/)[1];
        await act('pick-host', { host: hostKey });
        match(html(), /想让 TA 发一条什么视频/);
        setField('pm-video-idea', '雨中散步');
        await act('submit');
        video = await lastVideo();
        eq([video.title, video.uploaderIsUser, video.uploaderActorId], ['AI标题', false, deriveInteractiveActorId(SCOPE_ID, 'story', 'character:linwan.png')]);
        match(aiCalls.at(-1).userPrompt, /UP主本人偶尔回复评论，作者名写「林晚」/);
        const reply = video.comments[0].replies[0];
        eq(reply.authorId, video.uploaderActorId, '角色UP主的回复归到同一个 actor');
        await act('tab', { tab: 'comments' });
        ok((html().match(/pm-video-up">UP</g) || []).length >= 1);
    });
    await check('安装层：生成失败保留占位，菜单里可重新生成', async () => {
        await act('home');
        await act('compose');
        setField('pm-video-title', '会失败');
        aiQueue.push(() => { throw new Error('接口炸了'); });
        await act('submit');
        match(statusText(), /接口炸了/);
        let video = await lastVideo();
        eq([video.title, video.danmaku.length, video.comments.length], ['会失败', 0, 0]);
        match(html(), /data-video-action="regenerate"/);
        await act('regenerate');
        video = await lastVideo();
        ok(video.comments.length > 0 && video.danmaku.length > 0);
        nomatch(html(), /data-video-action="regenerate"/);
    });

    const openLatest = async () => {
        if (!/data-live-view="video-home"/.test(html())) await act('home');
        const video = await lastVideo();
        await act('open-video', { videoId: video.id });
        return video;
    };
    const tickOnce = seconds => { clock.skew += seconds * 1000; ticks.callback?.(); };
    await check('生命周期：播放起计时器，时间推进、分镜切换，拖动进度', async () => {
        await openLatest();
        const setBefore = ticks.set;
        await act('toggle-play');
        eq([ticks.set - setBefore, ticks.active.size], [1, 1]);
        match(html(), /data-playing="true"/);
        match(html(), /aria-pressed="true" aria-label="暂停"/);
        const writesBefore = page().sceneWrites;
        tickOnce(35);
        eq(page().querySelector('#pm-video-time').textContent, '0:35 / 1:30', '时间标签随播放推进');
        ok(page().sceneWrites > writesBefore, '跨过分镜点后只换分镜节点');
        match(page().sceneHtml, /data-scene-index="1">高潮</);
        page().listeners.get('input')({ target: { id: 'pm-video-seek', value: '14' } });
        match(page().sceneHtml, /data-scene-index="0">开场</);
        match(page().fly.innerHTML, /前方高能/, '拖到 14 秒时飘过的弹幕出现');
        await act('toggle-play');
        eq(ticks.active.size, 0, '暂停清除计时器');
    });
    await check('生命周期：隐藏、切走页面、播放结束都会清除计时器', async () => {
        await act('toggle-play');
        eq(ticks.active.size, 1);
        doc.visibilityState = 'hidden';
        ticks.callback();
        eq(ticks.active.size, 0, '切到后台暂停');
        doc.visibilityState = 'visible';
        await act('toggle-play');
        mainUi.dataset.page = 'chat';
        ticks.callback();
        eq(ticks.active.size, 0, '离开噼哩噼哩页面暂停');
        mainUi.dataset.page = 'live';
        await act('toggle-play');
        tickOnce(500);
        eq(ticks.active.size, 0, '播到结尾自动停');
        match(html(), /data-playing="false"/);
    });
    await check('生命周期：离开视频页（回首页、切直播、回桌面）后计时器被清除', async () => {
        for (const leave of [() => act('home'), () => live('segment', { segment: 'live' }), () => live('desktop')]) {
            await openLatest();
            await act('toggle-play');
            eq(ticks.active.size, 1);
            const clearedBefore = ticks.cleared;
            await leave();
            eq(ticks.active.size, 0);
            ok(ticks.cleared > clearedBefore, '显式清除了计时器');
            await openApp();
            if (/data-live-view="list"/.test(html())) await live('segment', { segment: 'video' });
        }
        eq(ticks.set - ticks.cleared <= 0 || ticks.active.size === 0, true);
    });
    await check('生命周期：重新打开手机后不会自动继续播放', async () => {
        await openLatest();
        await act('toggle-play');
        mainUi.dataset.page = 'desktop';
        await openApp();
        eq(ticks.active.size, 0);
        match(html(), /data-live-view="video-home"/, '重新打开回到视频首页，不在播放');
        nomatch(html(), /data-playing="true"/);
    });

    await check('安装层：发弹幕记当前时间点；补弹幕、请求评论、修改与删除', async () => {
        await openLatest();
        page().listeners.get('input')({ target: { id: 'pm-video-seek', value: '20' } });
        setField('pm-video-danmaku-input', '好看');
        await act('send-danmaku');
        let video = await lastVideo();
        const sent = video.danmaku.find(item => item.content === '好看');
        eq([sent.at, sent.authorNameSnapshot], [20, '我']);
        const danmakuBefore = video.danmaku.length;
        await act('poke-danmaku');
        video = await lastVideo();
        eq(video.danmaku.length, danmakuBefore + 2);
        ok(video.danmaku.filter(item => /补/.test(item.content)).every(item => item.at >= 0 && item.at <= 30));
        match(aiCalls.at(-1).userPrompt, /必须在 0 到 30 之间/);
        const commentsBefore = video.comments.length;
        await act('poke-comments');
        video = await lastVideo();
        eq(video.comments.length, commentsBefore + 3, '请求评论一批，不冒用用户名');
        ok(!video.comments.some(item => item.content === '冒名'));
    });
    await check('安装层：修改弹幕和评论（编辑、取消、确认删除）', async () => {
        await act('tab', { tab: 'comments' });
        await act('toggle-editing');
        const video = await lastVideo();
        const target = video.comments.find(item => item.content === '第一');
        match(html(), /data-video-action="edit-comment"/);
        dialogs.prompt = null;
        await act('edit-comment', { commentId: target.id });
        eq((await lastVideo()).comments.find(item => item.id === target.id).content, '第一');
        dialogs.prompt = '  改过了  ';
        await act('edit-comment', { commentId: target.id });
        eq((await lastVideo()).comments.find(item => item.id === target.id).content, '改过了');
        dialogs.confirm = false;
        await act('delete-comment', { commentId: target.id });
        ok((await lastVideo()).comments.some(item => item.id === target.id), '确认框取消不删');
        dialogs.confirm = true;
        await act('delete-comment', { commentId: target.id });
        ok(!(await lastVideo()).comments.some(item => item.id === target.id));
        await act('toggle-editing');
        nomatch(html(), /data-video-action="edit-comment"/);
    });

    const sendMine = async text => {
        setField('pm-video-comment-input', text);
        await act('send-comment');
    };
    const mineIndex = async text => {
        const video = await lastVideo();
        return video.comments.findIndex(item => item.content === text);
    };
    await check('回应：发评论后立刻请求一批回复，用户那条随机插在头、中、尾，重绘顺序不变', async () => {
        await act('tab', { tab: 'comments' });
        const slots = [];
        for (const [random, text] of [[0, '头部'], [0.5, '中部'], [0.9999, '尾部']]) {
            deps.randomSource = () => random;
            const before = (await lastVideo()).comments.length;
            const callsBefore = aiCalls.length;
            await sendMine(text);
            eq(aiCalls.length, callsBefore + 1);
            eq(aiCalls.at(-1).kind, 'video_comments');
            match(aiCalls.at(-1).userPrompt, new RegExp(text));
            const video = await lastVideo();
            slots.push((await mineIndex(text)) - before);
            eq(video.comments.length, before + 4, '用户一条加三条回应，冒名的被跳过');
            const times = video.comments.slice(before).map(item => item.createdAt);
            ok(times.every((time, index) => index === 0 || time >= times[index - 1]), 'createdAt 与新顺序一致');
        }
        eq(slots, [0, 2, 3]);
        const stored = (await lastVideo()).comments.map(item => item.id);
        page().listeners.get('click')({ target: button('videoAction', 'sort', { sort: 'hot' }) });
        eq((await lastVideo()).comments.map(item => item.id), stored, '重新渲染不改存储里的顺序');
    });
    await check('回应：滚到用户那条并用 is-fresh 高亮，淡出后移除，reduced-motion 不做动画滚动', async () => {
        deps.randomSource = () => 0.5;
        page().scrolls.length = 0;
        fresh.timers.length = 0;
        await sendMine('看我高亮');
        const mine = (await lastVideo()).comments.find(item => item.content === '看我高亮');
        const node = page().nodes.get(mine.id);
        ok(node.classes.has('is-fresh'));
        eq(page().scrolls.at(-1), { id: mine.id, options: { block: 'center', behavior: 'smooth' } });
        ok(fresh.timers.length >= 1);
        fresh.timers.at(-1).callback();
        ok(!node.classes.has('is-fresh'), '到时间后高亮移除');
        reduced = true;
        await sendMine('少动一点');
        eq(page().scrolls.at(-1).options.behavior, 'auto');
        reduced = false;
    });
    await check('回应：忙碌时不叠加请求，用户内容照存；失败保留用户内容并显示原因', async () => {
        let release = () => {};
        const gate = new Promise(resolve => { release = resolve; });
        aiQueue.push(async () => { await gate; return envelope('video_comments', [{ author: '慢', content: '慢慢来' }]); });
        const callsBefore = aiCalls.length;
        const first = sendMine('第一条在途');
        await waitFor(() => aiCalls.length === callsBefore + 1, '请求发出');
        match(html(), /aria-busy="true"/);
        await sendMine('第二条被占线');
        eq(aiCalls.length, callsBefore + 1, '忙碌时不再发请求');
        eq(statusText(), '上一条还在回应中');
        ok((await mineIndex('第二条被占线')) >= 0, '占线时用户内容照存');
        release();
        await first;
        ok((await mineIndex('第一条在途')) >= 0);
        aiQueue.push(() => { throw new Error('网络断了'); });
        await sendMine('会失败的评论');
        match(statusText(), /网络断了/);
        ok((await mineIndex('会失败的评论')) >= 0, '失败不回滚用户内容');
    });

    await check('回应：回复某条评论带 replyTo，请求 video_replies，满 10 条不超限', async () => {
        deps.randomSource = () => 0.5;
        const video = await lastVideo();
        const target = video.comments.find(item => item.authorNameSnapshot === '乙');
        await act('reply', { commentId: target.id, replyTo: '' });
        match(html(), /placeholder="回复 @乙"/);
        setField('pm-video-comment-input', '我来回复');
        await act('send-comment');
        const stored = (await lastVideo()).comments.find(item => item.id === target.id);
        const mine = stored.replies.find(item => item.content === '我来回复');
        eq([mine.replyTo, aiCalls.at(-1).kind], ['乙', 'video_replies']);
        match(aiCalls.at(-1).userPrompt, /我来回复/);
        ok(stored.replies.length <= 10);
        match(html(), /placeholder="发一条友善的评论"/, '发完回到普通评论态');
        for (let index = 0; index < 4; index += 1) {
            await act('reply', { commentId: target.id, replyTo: '甲' });
            setField('pm-video-comment-input', `追加${index}`);
            await act('send-comment');
        }
        ok((await lastVideo()).comments.find(item => item.id === target.id).replies.length <= 10);
    });
    await check('回应：离开页面会取消在途请求，结果不写入且不报错', async () => {
        let release = () => {};
        const gate = new Promise(resolve => { release = resolve; });
        aiQueue.push(async () => { await gate; return envelope('video_comments', [{ author: '迟到', content: '迟到的评论' }]); });
        const callsBefore = aiCalls.length;
        const pending = sendMine('走之前发的');
        await waitFor(() => aiCalls.length === callsBefore + 1, '请求发出');
        await act('home');
        release();
        await pending;
        await wait(30);
        const video = await lastVideo();
        ok(video.comments.some(item => item.content === '走之前发的'), '用户内容保留');
        ok(!video.comments.some(item => item.content === '迟到的评论'), '离开后结果不得写入');
        eq(statusText(), '', '取消不显示错误');
        eq(ticks.active.size, 0);
    });
    const failNext = message => aiQueue.push(() => { throw new Error(message); });
    await check('回归1：生成期间用户发的评论在生成完成后仍在', async () => {
        await act('home');
        await act('compose');
        setField('pm-video-title', '生成期间发评论');
        let release = () => {};
        const gate = new Promise(resolve => { release = resolve; });
        aiQueue.push(async () => { await gate; return defaults.video_create(); });
        const callsBefore = aiCalls.length;
        const submitting = act('submit');
        await waitFor(() => aiCalls.length === callsBefore + 1, '创建请求发出');
        await act('tab', { tab: 'comments' });
        await sendMine('生成期间发的评论');
        release();
        await submitting;
        const video = await lastVideo();
        ok(video.comments.some(item => item.content === '生成期间发的评论'), '用户评论没有被生成结果覆盖');
        ok(video.comments.length >= 3, '生成的评论也并进来了');
        ok(!Object.hasOwn(video, 'pending'));
    });
    await check('回归2：失败的占位视频上发了评论仍可重试；已生成视频清空内容不会变回生成中', async () => {
        await act('home');
        await act('compose');
        setField('pm-video-title', '失败占位');
        failNext('接口炸了');
        await act('submit');
        eq((await lastVideo()).pending, true);
        await act('tab', { tab: 'comments' });
        failNext('又炸了');
        await sendMine('占位上发的评论');
        let video = await lastVideo();
        ok(video.comments.length === 1 && video.pending === true, '发了评论仍是待生成');
        match(html(), /data-video-action="regenerate"/, '重试入口还在');
        await act('regenerate');
        video = await lastVideo();
        ok(!Object.hasOwn(video, 'pending') && video.comments.some(item => item.content === '占位上发的评论'));
        const stored = (await scopeNow()).videos[video.id];
        stored.comments = [];
        stored.danmaku = [];
        await act('tab', { tab: 'intro' });
        nomatch(html(), /data-video-action="regenerate"/, '已生成的视频清空内容后不再显示重试');
        nomatch(html(), /正在生成内容/);
    });
    await check('回归7：重新生成沿用投稿时自定的标题和「不让 AI 写分镜」，重新打开后也一样', async () => {
        await act('home');
        await act('compose');
        await act('pick-host', { host: html().match(/data-host="(actor:[^"]+)"/)[1] });
        setField('pm-video-title', '我定的标题');
        failNext('炸');
        await act('submit');
        eq((await lastVideo()).draft.titleTyped, true);
        await openApp();
        await openLatest();
        await act('regenerate');
        eq((await lastVideo()).title, '我定的标题', '角色UP主下自定标题不被 AI 覆盖');
        await act('home');
        await act('compose');
        setField('pm-video-title', '不要分镜');
        await act('toggle-ai-scenes');
        failNext('炸');
        await act('submit');
        eq((await lastVideo()).draft.aiScenes, false);
        await openApp();
        await openLatest();
        await act('regenerate');
        match(aiCalls.at(-1).userPrompt, /meta\.video 只需 cover/);
        eq((await lastVideo()).scenes.length, 1);
    });

    await check('回归4：回复失败后所属楼层仍是展开的，用户的新回复看得见', async () => {
        await act('home');
        await act('compose');
        setField('pm-video-title', '多回复');
        aiQueue.push(() => envelope('video_create', [{ author: '路人', content: '弹幕', at: 5 }], {
            video: { title: 'x', duration: 90, scenes: [{ at: 0, text: '开场' }] },
            comments: [{ author: '乙', content: '主楼', replies: ['一', '二', '三', '四'].map(n => ({ author: `人${n}`, content: `回复${n}` })) }],
        }));
        await act('submit');
        await act('tab', { tab: 'comments' });
        const target = (await lastVideo()).comments.find(item => item.content === '主楼');
        match(html(), /aria-expanded="false">共 4 条回复</, '默认折叠');
        await act('reply', { commentId: target.id, replyTo: '' });
        failNext('回复失败了');
        setField('pm-video-comment-input', '我这条回复失败');
        await act('send-comment');
        match(statusText(), /回复失败了/);
        match(html(), /aria-expanded="true">收起回复</, '失败后楼层展开');
        match(html(), /我这条回复失败/, '用户的回复看得见');
    });
    await check('回归5：隐藏时停播并重绘，按钮图标和 aria-pressed 同步', async () => {
        await openLatest();
        await act('toggle-play');
        match(html(), /aria-pressed="true" aria-label="暂停"/);
        doc.visibilityState = 'hidden';
        ticks.callback();
        doc.visibilityState = 'visible';
        eq(ticks.active.size, 0);
        match(html(), /aria-pressed="false" aria-label="播放"/, '按钮回到「播放」');
        match(html(), /data-playing="false"/);
    });
    await check('回归6：手机最小化也停播并同步按钮', async () => {
        await act('toggle-play');
        eq(ticks.active.size, 1);
        state.isMinimized = true;
        ticks.callback();
        state.isMinimized = false;
        eq(ticks.active.size, 0);
        match(html(), /aria-pressed="false" aria-label="播放"/);
    });
    await check('回归8：UP主是用户时，生成内容里冒用UP主名字的评论、弹幕也被跳过', async () => {
        await act('home');
        await act('compose');
        setField('pm-video-title', '改名前发的');
        await act('submit');
        const scope = await scopeNow();
        const video = scope.videos[scope.videoOrder.at(-1)];
        eq(video.uploaderIsUser, true);
        video.uploaderNameSnapshot = '旧昵称';
        aiQueue.push(() => envelope('video_comments', [{ author: '旧昵称', content: '冒用UP主评论' }, { author: '路人', content: '正常评论' }]));
        await act('tab', { tab: 'comments' });
        await act('poke-comments');
        aiQueue.push(() => envelope('video_danmaku', [{ author: '旧昵称', content: '冒用UP主弹幕', at: 1 }, { author: '路人', content: '正常弹幕', at: 2 }]));
        await act('tab', { tab: 'intro' });
        await act('poke-danmaku');
        const after = await lastVideo();
        ok(!after.comments.some(item => /冒用/.test(item.content)) && after.comments.some(item => item.content === '正常评论'));
        ok(!after.danmaku.some(item => /冒用/.test(item.content)) && after.danmaku.some(item => item.content === '正常弹幕'));
    });

    await check('静态契约：新文件不超过 800 行，App 名只在常量里，生命周期文档登记播放计时器', async () => {
        const read = file => readFile(new URL(file, import.meta.url), 'utf8');
        for (const file of ['../src/video-app.js', '../src/video-views.js', '../src/video-model.js', '../src/video-schema.js', '../src/video-parse.js', '../src/video-format.js', '../src/prompts/interactive/video.js', '../styles/video.css', './check-video.mjs', './check-video-lifecycle.mjs', './video-check-kit.mjs']) {
            ok((await read(file)).split('\n').length <= 800, `${file} 超过 800 行`);
        }
        ok((await read('../src/interactive-scenes.js')).split('\n').length <= 800, 'interactive-scenes.js 不得超过 800 行');
        const names = await read('../src/app-names.js');
        match(names, /live: Object\.freeze\(\{ name: '噼哩噼哩', slogan: '（゜-゜）つロ 干杯' \}\)/);
        for (const file of ['../src/video-views.js', '../src/video-app.js', '../src/settings-desktop-icons.js', '../src/interactive-scene-views.js']) {
            nomatch((await read(file)).replace(/\/\/.*$/gm, ''), /['"`]噼哩噼哩['"`]/, `${file} 不得写死 App 名`);
        }
        match(await read('../src/settings-desktop-icons.js'), /live: appNameOf\('live'\)/);
        match(await read('../docs/LIFECYCLE-RESOURCES.md'), /视频播放计时器/);
        match(await read('../package.json'), /"check:video": "node scripts\/check-video\.mjs"/);
        match(await read('../package.json'), /npm run check:live && npm run check:video/);
    });

    // @@NEXT@@
}
finally {
    for (const [key, value] of Object.entries(previousGlobals)) {
        if (key === 'dateNow') Date.now = value; else if (value === undefined) delete globalThis[key]; else globalThis[key] = value;
    }
}

