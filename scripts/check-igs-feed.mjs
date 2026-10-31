// 与 gal 前端（IGS）联动：桥接、对账、开关、续写与贴吧/虎扑版式的定向检查。
import assert from 'node:assert/strict';
import {
    IGS_LINK_STORAGE_KEY, applyIgsSync, entriesForFloor, hashText, igsRequestExtras, igsSyncHasWork, indexIgsFloors, isIgsPostTouched,
    normalizeIgsLinkConfig, resolveIgsFeeds,
} from '../src/igs-feed-core.js';
import { installIgsFeedSync } from '../src/igs-feed-sync.js';
import { createEmptyInteractiveScope, normalizeInteractiveStore, normalizeScene } from '../src/interactive-scene-model.js';
import { buildCommunityRequest } from '../src/prompts/interactive/interactive.js';
import { renderCommunitySource } from '../src/community-injection.js';
import { groupTiebaFloors, tiebaBarName } from '../src/community-views/view-tieba.js';
import { pickHupuHotReplies } from '../src/community-views/view-hupu.js';
import { applyIgsShopSync, igsPriceCents, igsShopHasWork, isIgsShopItemTouched, shopEntriesForFloor } from '../src/igs-shop-core.js';
import { createEmptyShopScope, normalizeShopScope } from '../src/shop-model.js';
import { applyIgsLiveSync, igsLiveHasWork, mapIgsDanmaku, walkIgsLive } from '../src/igs-live-core.js';
import { createLiveRoom } from '../src/interactive-scene-model.js';

let checks = 0;
const check = (name, run) => { run(); checks += 1; };
const checkAsync = async (name, run) => { await run(); checks += 1; };

// 桩：楼层正文里 `[igs-fx:` 后面跟一段 JSON（帖子数组），collectPosts 原样解析。真实格式由 IGS 负责，这里只测天音这一侧。
const floorText = (posts, lead = '正文') => `${lead}[igs-fx:${JSON.stringify(posts)}]`;
const stubFeeds = (calls = { collect: 0 }) => ({
    version: 1,
    collectPosts(text) {
        calls.collect += 1;
        const start = text.indexOf('[igs-fx:');
        return start < 0 ? [] : JSON.parse(text.slice(start + 8, text.lastIndexOf(']')));
    },
    parseExtra(platform, extra) {
        if (platform !== 'review') return { text: extra };
        const work = /《([^》]+)》/.exec(extra)?.[1] || '';
        const rating = Number(/([1-5])星/.exec(extra)?.[1] || 0);
        return { work, rating };
    },
});
const ai = text => ({ is_user: false, mes: text });
const user = text => ({ is_user: true, mes: text });
const seeds = {
    story: { type: 'story', displayName: '林晚', bindingKey: 'character:linwan.png', profile: '' },
    user: { type: 'user', displayName: '我', bindingKey: 'persona:me', profile: '' },
};
let idSeq = 0;
const createId = () => `scene_t${(idSeq += 1)}`;
const syncOnce = (scope, chat, feeds = stubFeeds(), floors = null) => {
    const index = indexIgsFloors(chat);
    const adding = floors ? index.floors.filter(info => floors.includes(info.floor)) : index.floors;
    const entries = adding.flatMap(info => entriesForFloor(feeds, info, '我'));
    const work = igsSyncHasWork(scope, index, entries);
    const result = work ? applyIgsSync(scope, { index, entries, scopeId: 'sid', seeds: [seeds.story, seeds.user], createId, now: 1_900_000_000_000 }) : null;
    return { work, result };
};
// 每轮对账后的 scope 必须能通过 v3 严格校验（与真实提交时的 normalizeInteractiveStore 一致）。
const strictRoundTrip = scope => normalizeInteractiveStore(JSON.parse(JSON.stringify({ version: 3, scopes: { sid: scope } }))).scopes.sid;
const allPosts = scope => scope.sceneOrder.flatMap(id => scope.scenes[id].posts);

const weiboPost = (text, offset, extra = '雨城热搜') => ({ platform: 'weibo', owner: '', author: '苏小满', text, extra, replies: [{ author: '阿禾', text: '前排' }], offset });

check('配置默认值', () => {
    assert.deepEqual(normalizeIgsLinkConfig(null), { enabled: false, autoSync: true, autoContinue: false, syncLive: true, syncChats: true, autoCreateContacts: true, chatFloors: 20 }, '同步直播间跟着总开关一起开');
    assert.deepEqual(normalizeIgsLinkConfig({ enabled: true, autoSync: false, autoContinue: 'yes', syncLive: false }), { enabled: true, autoSync: false, autoContinue: false, syncLive: false, syncChats: true, autoCreateContacts: true, chatFloors: 20 });
});

check('接口探测：没有、过旧、抛错都安静降级', () => {
    assert.equal(resolveIgsFeeds({}).status, 'missing');
    assert.equal(resolveIgsFeeds({ IGS: { api: { feeds: { version: 0, collectPosts() {}, parseExtra() {} } } } }).status, 'outdated');
    assert.equal(resolveIgsFeeds({ IGS: { api: { feeds: { version: 1 } } } }).status, 'outdated', '缺函数按过旧处理');
    const throwing = { get IGS() { throw new Error('boom'); } };
    assert.equal(resolveIgsFeeds(throwing).status, 'missing');
    assert.equal(resolveIgsFeeds({ IGS: { api: { feeds: stubFeeds() } } }).status, 'ready');
    assert.equal(resolveIgsFeeds({ IGS: { api: { feeds: { ...stubFeeds(), version: 3 } } } }).status, 'ready', '更高版本照样能用');
});

check('导入：建同步社区、绑定剧情角色、评论导入、严格校验通过', () => {
    const scope = createEmptyInteractiveScope();
    const chat = [user('看看微博'), ai(floorText([{ ...weiboPost('今天雨好大', 3), author: '林晚' }, weiboPost('同城有人吗', 40)]))];
    const { result } = syncOnce(scope, chat);
    assert.equal(result.added, 2);
    assert.equal(result.createdScenes.length, 1);
    const scene = scope.scenes[result.createdScenes[0]];
    assert.deepEqual([scene.platform, scene.igsSync, scene.title], ['weibo', true, '微博广场']);
    assert.equal(scope.activeSceneId, scene.id, '空 scope 新建社区后 activeSceneId 指向它');
    assert.equal(scope.actors[scene.posts[0].authorId].type, 'story', '与剧情角色同名的作者绑定为 story actor');
    assert.equal(scope.actors[scene.posts[1].authorId].type, 'passerby');
    assert.deepEqual(scene.posts[0].tags, ['雨城热搜']);
    assert.equal(scene.posts[0].comments[0].content, '前排');
    assert.deepEqual(Object.keys(scene.posts[0].source).sort(), ['floor', 'key', 'type']);
    assert.equal(scene.posts[0].source.floor, 1);
    const strict = strictRoundTrip(scope);
    assert.equal(strict.scenes[scene.id].igsSync, true, 'igsSync 通过 v3 严格校验');
});

check('去重：同一楼重新扫描不重复导入，也不提交', () => {
    const scope = createEmptyInteractiveScope();
    const chat = [ai(floorText([weiboPost('一条', 0)]))];
    syncOnce(scope, chat);
    const again = syncOnce(scope, chat);
    assert.equal(again.work, false);
    assert.equal(allPosts(scope).length, 1);
});

check('偷看别人的手机不导入；玩家自己的手机导入', () => {
    const scope = createEmptyInteractiveScope();
    const chat = [ai(floorText([{ ...weiboPost('偷看', 0), owner: '林晚' }, { ...weiboPost('自己的', 10), owner: '我' }, { ...weiboPost('占位', 20), owner: '{{user}}' }]))];
    syncOnce(scope, chat);
    assert.deepEqual(allPosts(scope).map(post => post.content).sort(), ['占位', '自己的']);
});

check('只看 AI 楼，不接的平台跳过', () => {
    const scope = createEmptyInteractiveScope();
    // 朋友圈已在 B2 接入；相册、备忘录、淘宝（桃宝单独一个 App，不进社区）仍不接。
    const chat = [user(floorText([weiboPost('用户楼', 0)])), ai(floorText([{ ...weiboPost('相册', 0), platform: 'album' }, { ...weiboPost('备忘', 5), platform: 'memo' }, { ...weiboPost('商品', 9), platform: 'shop' }]))];
    const { work } = syncOnce(scope, chat);
    assert.equal(work, false);
    assert.equal(scope.sceneOrder.length, 0);
});

check('各平台字段：书评拆书名星级，贴吧吧名当社区名，虎扑板块当标签', () => {
    const scope = createEmptyInteractiveScope();
    const chat = [ai(floorText([
        { platform: 'review', author: '阿禾', text: '读完很难过', extra: '《雪国》4星', replies: [], offset: 0 },
        { platform: 'tieba', author: '吧友', text: '有人去过东区吗', extra: '雨城吧', replies: [{ author: '路人', text: '去过' }], offset: 10 },
        { platform: 'hupu', author: '老哥', text: '这球怎么输的', extra: '步行街', replies: [], offset: 20 },
        { platform: 'douban', author: '组员', text: '求助', extra: '雨城租房互助组', replies: [], offset: 30 },
    ]))];
    syncOnce(scope, chat);
    const byPlatform = Object.fromEntries(scope.sceneOrder.map(id => [scope.scenes[id].platform, scope.scenes[id]]));
    assert.deepEqual([byPlatform.review.posts[0].work, byPlatform.review.posts[0].rating], ['雪国', 4]);
    assert.equal(byPlatform.tieba.title, '雨城吧');
    assert.equal(tiebaBarName(byPlatform.tieba.title), '雨城吧', '吧名已以「吧」结尾时不重复');
    assert.deepEqual(byPlatform.hupu.posts[0].tags, ['步行街']);
    assert.equal(byPlatform.douban.title, '雨城租房互助组');
    strictRoundTrip(scope);
});

check('B2 各平台附加：朋友圈定位与可见范围、小红书标题、知乎问题与答主身份、新闻栏目与媒体', () => {
    const scope = createEmptyInteractiveScope();
    const chat = [ai(floorText([
        { platform: 'moments', author: '阿禾', text: '新唱片到了', extra: '雨城·河岸唱片行', replies: [{ author: '周屿', text: 'B面更好' }, { author: '阿禾', text: '等我翻面', to: '周屿' }], offset: 0 },
        { platform: 'moments', author: '苏小满', text: '今天不想说话', extra: '仅自己可见', replies: [], offset: 5 },
        { platform: 'moments', author: '林晚', text: '别告诉他', extra: '仅部分好友可见', replies: [], offset: 8 },
        { platform: 'xhs', author: '苏小满', text: '雨天热可可。窗边的位置最好', extra: '雨城东区这家小店', replies: [{ author: '路人', text: '求地址' }], offset: 10 },
        { platform: 'xhs', author: '阿禾', text: '唱片墙终于收好了！一面墙都是', extra: '', replies: [], offset: 15 },
        { platform: 'zhihu', author: '苏小满，便利店夜班店员', text: '谢邀，人在现场。', extra: '在便利店上夜班是什么体验？', replies: [], offset: 20 },
        { platform: 'zhihu', author: '周屿', text: '利益相关。', extra: '在便利店上夜班是什么体验？', replies: [], offset: 25 },
        { platform: 'news', author: '某媒体', text: '东区地铁停运三小时。今晚七点设备故障', extra: '突发·雨城日报', replies: [{ author: '网友', text: '我在现场' }], offset: 30 },
        { platform: 'news', author: '本地生活号', text: '热可可涨价到九块', extra: '本地', replies: [], offset: 35 },
        { platform: 'news', author: '气象台', text: '入冬第一场雪', extra: '雨城晚报', replies: [], offset: 40 },
    ]))];
    syncOnce(scope, chat);
    const byPlatform = Object.fromEntries(scope.sceneOrder.map(id => [scope.scenes[id].platform, scope.scenes[id]]));
    const moments = byPlatform.moments.posts;
    assert.equal(moments[0].place, '雨城·河岸唱片行', '朋友圈附加是定位时存 place');
    assert.equal(Object.hasOwn(moments[0], 'audience'), false);
    assert.deepEqual([moments[1].audience, Object.hasOwn(moments[1], 'place')], ['private', false], '「仅自己可见」存为 private');
    assert.equal(moments[2].audience, 'partial', '「仅部分好友可见」存为 partial');
    assert.equal(moments[0].comments[1].quoteId, moments[0].comments[0].id, '朋友圈「A 回复 B」由 reply.to 解析成 quoteId');
    assert.equal(byPlatform.moments.title, '朋友圈', '附加栏不当社区名');
    const xhs = byPlatform.xhs.posts;
    assert.equal(xhs[0].title, '雨城东区这家小店', '小红书附加是标题');
    assert.equal(xhs[1].title, '唱片墙终于收好了', '没写标题时取正文第一句');
    const zhihu = byPlatform.zhihu.posts;
    assert.deepEqual([zhihu[0].authorNameSnapshot, zhihu[0].authorBio, zhihu[0].question], ['苏小满', '便利店夜班店员', '在便利店上夜班是什么体验？'], '答主「名字，身份」拆出 authorBio');
    assert.equal(Object.hasOwn(zhihu[1], 'authorBio'), false, '没有逗号时整段是名字');
    assert.equal(zhihu[1].question, zhihu[0].question, '同一问题的回答 question 相同，可以分组');
    const news = byPlatform.news.posts;
    assert.deepEqual([news[0].column, news[0].authorNameSnapshot], ['突发', '雨城日报'], '「栏目·媒体」拆开，作者改为媒体');
    assert.deepEqual([news[1].column, news[1].authorNameSnapshot], ['本地', '本地生活号'], '只有栏目时作者保留原写法');
    assert.deepEqual([Object.hasOwn(news[2], 'column'), news[2].authorNameSnapshot], [false, '雨城晚报'], '只有一段且不是栏目时整段当媒体');
    strictRoundTrip(scope);
});

check('B2 同步不改原文：同一楼再扫描不重复，原文变了没动过的删掉', () => {
    const scope = createEmptyInteractiveScope();
    const post = { platform: 'zhihu', author: '阿禾，独立乐评人', text: '先说结论。', extra: '如何评价雨城？', replies: [], offset: 0 };
    syncOnce(scope, [ai(floorText([post]))]);
    assert.equal(syncOnce(scope, [ai(floorText([post]))]).work, false);
    syncOnce(scope, [ai(floorText([{ ...post, text: '改过了。' }]))]);
    assert.deepEqual(allPosts(scope).map(item => item.content), ['改过了。']);
});

check('已有同平台社区被设为同步社区时落进它，不新建', () => {
    const scope = createEmptyInteractiveScope();
    const mine = normalizeScene({ id: 'mine', title: '雨城热搜', platform: 'weibo', igsSync: true });
    scope.scenes.mine = mine; scope.sceneOrder.push('mine'); scope.activeSceneId = 'mine';
    const { result } = syncOnce(scope, [ai(floorText([weiboPost('进我的社区', 0)]))]);
    assert.deepEqual(result.createdScenes, []);
    assert.equal(scope.scenes.mine.posts.length, 1);
});

check('社区满 12 个时不新建，也不挤掉已有社区', () => {
    const scope = createEmptyInteractiveScope();
    for (let index = 0; index < 12; index += 1) {
        const scene = normalizeScene({ id: `s${index}`, title: `社区${index}`, platform: 'douban' });
        scope.scenes[scene.id] = scene; scope.sceneOrder.push(scene.id);
    }
    scope.activeSceneId = 's0';
    const { result } = syncOnce(scope, [ai(floorText([weiboPost('放不下', 0)]))]);
    assert.deepEqual(result.skippedPlatforms, ['weibo']);
    assert.equal(scope.sceneOrder.length, 12);
});

check('舆论风暴：mention 进微博，热搜词写进 hot（红沸黑热）与 tags', () => {
    const scope = createEmptyInteractiveScope();
    const chat = [ai(floorText([
        { platform: '', kind: 'storm', tone: 'red', author: '网友甲', text: '太厉害了', extra: '林晚夺冠', replies: [], offset: 0 },
        { platform: 'weibo', kind: 'storm', tone: 'black', author: '网友乙', text: '假的吧', extra: '林晚翻车', replies: [], offset: 10 },
    ]))];
    syncOnce(scope, chat);
    const scene = scope.scenes[scope.sceneOrder[0]];
    assert.equal(scene.platform, 'weibo', '没写平台的风暴默认微博');
    assert.deepEqual(scene.hot, [{ title: '林晚夺冠', badge: '沸' }, { title: '林晚翻车', badge: '热' }]);
    assert.deepEqual(scene.posts.map(post => post.tags), [['林晚夺冠'], ['林晚翻车']]);
});

check('楼层编辑后重建：没动过的删掉，动过的保留并标记原文已变', () => {
    const scope = createEmptyInteractiveScope();
    const chat = [ai(floorText([weiboPost('甲', 0), weiboPost('乙', 10), weiboPost('丙', 20)]))];
    syncOnce(scope, chat);
    const [a, b, c] = allPosts(scope);
    b.liked = true;
    c.content = '用户改过的丙';
    assert.equal(isIgsPostTouched(a), false);
    assert.equal(isIgsPostTouched(b), true, '点过赞算动过');
    assert.equal(isIgsPostTouched(c), true, '编辑过算动过');
    chat[0] = ai(floorText([weiboPost('改写后的甲', 0)]));
    const { result } = syncOnce(scope, chat);
    assert.deepEqual([result.removed, result.staled, result.added], [1, 2, 1]);
    const posts = allPosts(scope);
    assert.deepEqual(posts.map(post => [post.content, post.source.stale === true]), [['乙', true], ['用户改过的丙', true], ['改写后的甲', false]]);
    strictRoundTrip(scope);
    assert.equal(syncOnce(scope, chat).work, false, '已标记的不会每轮再改');
});

check('评论过算动过；换回原来的 swipe 时清掉标记', () => {
    const scope = createEmptyInteractiveScope();
    const original = floorText([weiboPost('原版', 0)]);
    const chat = [ai(original)];
    syncOnce(scope, chat);
    const [post] = allPosts(scope);
    post.comments.push({ ...post.comments[0], id: 'comment_user', content: '我也觉得' });
    chat[0] = ai(floorText([weiboPost('另一个 swipe', 0)]));
    syncOnce(scope, chat);
    assert.equal(post.source.stale, true);
    chat[0] = ai(original);
    syncOnce(scope, chat);
    assert.equal(Object.hasOwn(post.source, 'stale'), false, '原文回来了就不再是「原文已变」');
});

check('删楼后楼层号前移，已导入的帖子跟着找回楼层', () => {
    const scope = createEmptyInteractiveScope();
    const chat = [ai(floorText([weiboPost('第一楼', 0)])), user('嗯'), ai(floorText([weiboPost('第三楼', 0)]))];
    syncOnce(scope, chat);
    chat.splice(0, 2);
    const { result } = syncOnce(scope, chat, stubFeeds(), []);
    const posts = allPosts(scope);
    assert.equal(result.removed, 1, '被删掉那一楼的帖子跟着删');
    assert.deepEqual(posts.map(post => [post.content, post.source.floor]), [['第三楼', 0]]);
});

check('上下文注入：全部注入时跳过导入的帖子，单独勾选时写入', () => {
    const scope = createEmptyInteractiveScope();
    syncOnce(scope, [ai(floorText([weiboPost('导入的', 0)]))]);
    const scene = scope.scenes[scope.sceneOrder[0]];
    scene.posts.push({ ...scene.posts[0], id: 'own_post', content: '自己写的', source: undefined });
    delete scene.posts[1].source;
    const all = renderCommunitySource({ type: 'community', scene, actors: scope.actors, selection: { mode: 'all', postIds: [] } });
    assert.match(all, /自己写的/);
    assert.doesNotMatch(all, /导入的/);
    const picked = renderCommunitySource({ type: 'community', scene, actors: scope.actors, selection: { mode: 'selected', postIds: [scene.posts[0].id] } });
    assert.match(picked, /导入的/);
});

check('同步社区的生成提示带衔接说明，普通社区不带', () => {
    const scene = normalizeScene({ id: 's', title: 't', platform: 'weibo', igsSync: true, posts: [] });
    assert.deepEqual(igsRequestExtras(scene, false), {});
    assert.deepEqual(igsRequestExtras({ ...scene, igsSync: undefined }, true), {});
    const extras = igsRequestExtras(scene, true);
    assert.equal(extras.storyLinked, true);
    const linked = buildCommunityRequest({ kind: 'feed_batch', platform: 'weibo', ...extras, recentPosts: '苏小满：雨好大' });
    assert.match(linked.userPrompt, /来自正文剧情/);
    assert.match(linked.userPrompt, /recent_posts_data/);
    assert.doesNotMatch(buildCommunityRequest({ kind: 'feed_batch', platform: 'weibo' }).userPrompt, /来自正文剧情/);
});

check('模型：igsSync 只能是 true，不能接收的平台丢弃；source.stale 只能是 true', () => {
    assert.equal(normalizeScene({ id: 'a', platform: 'night', igsSync: true }).igsSync, undefined, '夜间来信不能接收');
    assert.equal(normalizeScene({ id: 'b', platform: 'tieba', igsSync: 'yes' }).igsSync, undefined);
    const base = { version: 3, scopes: { s: { activeSceneId: 'x', sceneOrder: ['x'], actors: {}, liveRooms: {}, liveOrder: [], scenes: { x: {
        id: 'x', title: 't', platform: 'weibo', nsfw: false, preset: 'weibo', styleInput: '', generatedPrompt: '', themeAccent: '', createdAt: 1, updatedAt: 1, posts: [],
    } } } } };
    const withScene = patch => JSON.parse(JSON.stringify(base, (key, value) => (key === 'x' && value?.posts ? { ...value, ...patch } : value)));
    assert.throws(() => normalizeInteractiveStore(withScene({ igsSync: false })), /igsSync/);
    assert.equal(normalizeInteractiveStore(withScene({ igsSync: true })).scopes.s.scenes.x.igsSync, true);
});

check('贴吧楼中楼：顺着引用链挂到所属楼层', () => {
    const comments = [
        { id: 'c1', authorNameSnapshot: '甲', content: '二楼' },
        { id: 'c2', authorNameSnapshot: '乙', content: '回二楼', quoteId: 'c1' },
        { id: 'c3', authorNameSnapshot: '丙', content: '三楼' },
        { id: 'c4', authorNameSnapshot: '丁', content: '回乙', quoteId: 'c2' },
    ];
    const { floors, replies } = groupTiebaFloors(comments);
    assert.deepEqual(floors.map(item => item.id), ['c1', 'c3']);
    assert.deepEqual(replies.get('c1').map(item => item.id), ['c2', 'c4']);
    assert.deepEqual(replies.get('c3'), []);
});

check('虎扑：回帖不少于 4 条才有「这些回帖亮了」，最多 3 条', () => {
    const mk = n => Array.from({ length: n }, (_, index) => ({ id: `c${index}`, authorNameSnapshot: `作者${index}`, content: `回帖${index}` }));
    assert.deepEqual(pickHupuHotReplies(mk(3)), []);
    const hot = pickHupuHotReplies(mk(8));
    assert.equal(hot.length, 3);
    assert.deepEqual(hot.map(item => item.id), pickHupuHotReplies(mk(8)).map(item => item.id), '排序稳定');
});

// ===== 运行时 =====
function makeRuntime({ enabled = false, autoContinue = false, chat = [], igs = undefined, syncShop = undefined } = {}) {
    const storage = new Map([[IGS_LINK_STORAGE_KEY, JSON.stringify({ enabled, autoSync: true, autoContinue })]]);
    const storageApi = { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) };
    const touched = { igs: 0, ctx: 0, ai: 0, commits: 0, refresh: 0 };
    const globalObject = {};
    Object.defineProperty(globalObject, 'IGS', { get() { touched.igs += 1; return igs; }, configurable: true });
    const state = { store: { version: 3, scopes: {} } };
    const deps = {
        getCtx: () => { touched.ctx += 1; return { chat, name1: '我' }; },
        getStorageId: () => 'sid',
        loadStore: async () => state.store,
        getStore: () => state.store,
        commit: async (mutator, isValid) => { if (isValid && !isValid()) throw new Error('cancelled'); touched.commits += 1; await mutator(); state.store = normalizeInteractiveStore(JSON.parse(JSON.stringify(state.store))); },
        actorSeeds: () => seeds,
        contextText: async () => ({ context: '', worldBookText: '' }),
        callAI: async () => { touched.ai += 1; return JSON.stringify({ version: 2, kind: 'feed_batch', items: [{ author: '路人', content: '续写的', tags: [], comments: [{ author: 'a', content: 'b' }, { author: 'c', content: 'd' }] }] }); },
        uid: prefix => `${prefix}_${(idSeq += 1)}`,
        createEmptyScope: createEmptyInteractiveScope,
        isGenerationBusy: () => false,
        refreshOpenScene: () => { touched.refresh += 1; }, refreshLauncher() {}, refreshDesktop() {},
        ...(syncShop ? { syncShop } : {}),
    };
    const link = installIgsFeedSync(deps, { globalObject, storage: storageApi });
    return { link, touched, state, chat, storage };
}
const settle = async () => { for (let index = 0; index < 20; index += 1) await new Promise(resolve => setImmediate(resolve)); };

await checkAsync('总开关关着：零调用，不碰 window.IGS、不读楼层', async () => {
    const { link, touched } = makeRuntime({ enabled: false, chat: [ai(floorText([weiboPost('x', 0)]))], igs: { api: { feeds: stubFeeds() } } });
    link.observe('MESSAGE_RECEIVED', 0);
    link.observe('MESSAGE_DELETED', 0);
    await settle();
    assert.deepEqual([touched.igs, touched.ctx, touched.commits], [0, 0, 0]);
    assert.equal(link.viewState().igs.enabled, false);
    assert.equal(link.launcherState().igsEnabled, false);
    await assert.rejects(link.importNow(), /未开启/);
});

await checkAsync('没检测到 IGS：安静降级，设置页显示未检测到', async () => {
    const { link, touched } = makeRuntime({ enabled: true, chat: [ai(floorText([weiboPost('x', 0)]))] });
    link.observe('MESSAGE_RECEIVED', 0);
    await settle();
    assert.equal(touched.commits, 0);
    assert.equal(link.getStatus().api, 'missing');
});

await checkAsync('接口抛错：只记一条失败，不抛出', async () => {
    const igs = { api: { feeds: { version: 1, collectPosts() { throw new Error('IGS 内部错误'); }, parseExtra() { return {}; } } } };
    const { link } = makeRuntime({ enabled: true, chat: [ai(floorText([weiboPost('x', 0)]))], igs });
    link.observe('MESSAGE_RECEIVED', 0);
    await settle();
    assert.match(link.getStatus().lastError, /IGS 内部错误/);
});

await checkAsync('自动同步：同一批事件合并成一次提交；续写开关关时不调 AI', async () => {
    const chat = [ai(floorText([weiboPost('新楼', 0)]))];
    const { link, touched, state } = makeRuntime({ enabled: true, chat, igs: { api: { feeds: stubFeeds() } } });
    link.observe('MESSAGE_RECEIVED', 0);
    link.observe('MESSAGE_RECEIVED', 0);
    await settle();
    assert.equal(touched.commits, 1);
    assert.equal(touched.ai, 0);
    assert.equal(Object.values(state.store.scopes.sid.scenes)[0].posts.length, 1);
});

await checkAsync('自动同步不把用户删掉的帖子补回来；手动导入会', async () => {
    const chat = [ai(floorText([weiboPost('会被删', 0)]))];
    const { link, state } = makeRuntime({ enabled: true, chat, igs: { api: { feeds: stubFeeds() } } });
    link.observe('MESSAGE_RECEIVED', 0);
    await settle();
    const scene = Object.values(state.store.scopes.sid.scenes)[0];
    scene.posts = [];
    link.observe('MESSAGE_RECEIVED', 0);
    link.observe('MESSAGE_UPDATED', 0);
    await settle();
    assert.equal(Object.values(state.store.scopes.sid.scenes)[0].posts.length, 0);
    assert.match(await link.importNow(), /导入 1 条/);
    assert.equal(Object.values(state.store.scopes.sid.scenes)[0].posts.length, 1);
});

await checkAsync('续写开关开：每楼只请求一次', async () => {
    const chat = [ai(floorText([weiboPost('楼一', 0)]))];
    const { link, touched, state } = makeRuntime({ enabled: true, autoContinue: true, chat, igs: { api: { feeds: stubFeeds() } } });
    link.observe('MESSAGE_RECEIVED', 0);
    await settle();
    assert.equal(touched.ai, 1);
    link.observe('MESSAGE_SWIPED', 0);
    link.observe('MESSAGE_RECEIVED', 0);
    await settle();
    assert.equal(touched.ai, 1, '同一楼不再续写');
    const posts = Object.values(state.store.scopes.sid.scenes)[0].posts;
    assert.deepEqual(posts.map(post => post.content), ['楼一', '续写的']);
});

await checkAsync('手动导入不触发续写；打开总开关时自动导入一次', async () => {
    const chat = [ai(floorText([weiboPost('已有', 0)]))];
    const { link, touched, state, storage } = makeRuntime({ enabled: false, autoContinue: true, chat, igs: { api: { feeds: stubFeeds() } } });
    assert.equal(link.setConfig({ enabled: true }), true);
    await settle();
    assert.equal(JSON.parse(storage.get(IGS_LINK_STORAGE_KEY)).enabled, true);
    assert.equal(Object.values(state.store.scopes.sid.scenes)[0].posts.length, 1);
    await link.importNow();
    assert.equal(touched.ai, 0);
});

// ===== 淘宝帖子 → 桃宝商品 =====
const shopPost = (text, offset, extra = '¥29.9 月销2万+', replies = [{ author: '买家甲', text: '下雨天真的不湿' }]) => ({ platform: 'shop', owner: '', author: '雨城东区防水铺', text, extra, replies, offset });
const shopFeeds = () => ({ ...stubFeeds(), parseExtra(platform, extra) {
    if (platform !== 'shop') return { text: extra };
    const price = (String(extra).match(/[¥￥]\s*[\d.,]+/) || [''])[0];
    return { price, sales: String(extra).replace(price, '').trim() };
} });
const shopSync = (scope, chat, feeds = shopFeeds()) => {
    const index = indexIgsFloors(chat);
    const entries = index.floors.flatMap(info => shopEntriesForFloor(feeds, info, '我'));
    return igsShopHasWork(scope, index, entries) ? applyIgsShopSync(scope, { index, entries, now: 1_900_000_000_000 }) : null;
};

check('价格拆成分；认不出返回 0', () => {
    assert.equal(igsPriceCents('¥29.9'), 2990);
    assert.equal(igsPriceCents('￥1,299'), 129900);
    assert.equal(igsPriceCents('12.5元'), 1250);
    assert.equal(igsPriceCents('面议'), 0);
    assert.equal(igsPriceCents(''), 0);
});

check('淘宝帖子：作者当店铺、reply 当评价；偷看手机与没价格的跳过；社区不收淘宝帖子', () => {
    const chat = [ai(floorText([shopPost('林晚同款透明雨鞋套', 0), { ...shopPost('偷看的', 10), owner: '林晚' }, shopPost('没价格', 20, '月销1万')]))];
    const scope = createEmptyShopScope();
    assert.deepEqual(shopSync(scope, chat), { added: 1, removed: 0, staled: 0 });
    const [item] = scope.itemOrder.map(id => scope.items[id]);
    assert.deepEqual([item.title, item.shop, item.priceCents, item.reviews[0].content, item.source.type], ['林晚同款透明雨鞋套', '雨城东区防水铺', 2990, '下雨天真的不湿', 'igs']);
    assert.deepEqual(normalizeShopScope(JSON.parse(JSON.stringify(scope))), scope, '导入后的商品通过桃宝归一化');
    assert.equal(syncOnce(createEmptyInteractiveScope(), chat).work, false, '淘宝帖子不进社区');
    assert.equal(shopSync(scope, chat), null, '重复扫描不重复上架，也不写存储');
});

check('楼层改了：没动过的下架，收藏或加购过的保留并标原文已变；删楼后跟着找回楼层', () => {
    const chat = [user('逛一下'), ai(floorText([shopPost('甲', 0), shopPost('乙', 10), shopPost('丙', 20)]))];
    const scope = createEmptyShopScope();
    shopSync(scope, chat);
    const [a, b, c] = ['甲', '乙', '丙'].map(title => Object.values(scope.items).find(item => item.title === title));
    b.favorite = true;
    scope.cart.push({ id: 'cart_1', itemId: c.id, spec: c.specs[0], quantity: 1, checked: true });
    assert.equal(isIgsShopItemTouched(scope, a), false);
    chat[1] = ai(floorText([shopPost('新上的', 0)]));
    assert.deepEqual(shopSync(scope, chat), { added: 1, removed: 1, staled: 2 });
    assert.deepEqual([b.source.stale, c.source.stale], [true, true]);
    const strict = normalizeShopScope(JSON.parse(JSON.stringify(scope)));
    assert.equal(strict.items[b.id].source.stale, true, 'stale 随存储往返');
    chat.splice(0, 1);
    shopSync(scope, chat);
    assert.equal(Object.values(scope.items).find(item => item.title === '新上的').source.floor, 0);
});

await checkAsync('运行时：淘宝帖子交给桃宝；桃宝写失败只记一条，不挡社区同步', async () => {
    const calls = [];
    const chat = [ai(floorText([shopPost('雨鞋套', 0), weiboPost('一起去看雪', 30)]))];
    const { link, state } = makeRuntime({ enabled: true, chat, igs: { api: { feeds: shopFeeds() } }, syncShop: async (storageId, payload) => { calls.push([storageId, payload.entries.length]); throw new Error('存储不可用'); } });
    link.observe('MESSAGE_RECEIVED', 0);
    await settle();
    assert.deepEqual(calls, [['sid', 1]]);
    assert.equal(Object.values(state.store.scopes.sid.scenes)[0].posts.length, 1, '社区照常导入');
    assert.match(link.getStatus().lastError, /桃宝同步失败/);
    const off = makeRuntime({ enabled: false, chat, igs: { api: { feeds: shopFeeds() } }, syncShop: async () => { calls.push('off'); return null; } });
    off.link.observe('MESSAGE_RECEIVED', 0);
    await settle();
    assert.equal(calls.includes('off'), false, '联动关着时不碰桃宝');
});

// ===== 直播段 → 噼哩噼哩直播间 =====
// 桩：楼层正文里 `[live:JSON]` 是该楼的直播段数组，collect 原样返回（真实解析由 IGS 负责）。
const liveText = (segments, lead = '正文') => `${lead}[live:${JSON.stringify(segments)}]`;
const stubLive = (calls = { collect: 0 }) => ({ version: 1, collect(text) {
    calls.collect += 1;
    const start = String(text).indexOf('[live:');
    return start < 0 ? [] : JSON.parse(text.slice(start + 6, text.lastIndexOf(']')));
} });
const seg = (host, title, danmaku, extra = {}) => ({ host, title, view: 'watch', end: false, offset: 0, danmaku, ...extra });
const dm = (author, content, type = 'text', extra = '') => ({ author, content, type, extra, offset: 0 });
const liveFloors = chat => chat.map((message, floor) => (message.is_user ? null : { floor, hash: hashText(message.mes), text: message.mes })).filter(Boolean);
const liveSync = (scope, chat, adding = null) => {
    const live = stubLive();
    const walk = walkIgsLive(liveFloors(chat), info => live.collect(info.text), adding);
    const options = { walk, scopeId: 'sid', seeds: [seeds.story, seeds.user] };
    return igsLiveHasWork(scope, options) ? applyIgsLiveSync(scope, options) : null;
};

check('弹幕类型映射：文字、礼物、醒目留言、上舰，进场与房管不存', () => {
    assert.deepEqual(mapIgsDanmaku(dm('甲', '好听')), { kind: 'chat', content: '好听' });
    assert.deepEqual(mapIgsDanmaku(dm('乙', '小心心', 'gift')), { kind: 'gift', content: '小心心' });
    assert.deepEqual(mapIgsDanmaku(dm('丙', '加油', 'sc', '30')), { kind: 'chat', content: '[醒目留言 ¥30] 加油' });
    assert.deepEqual(mapIgsDanmaku(dm('丁', '', 'guard')), { kind: 'gift', content: '开通了舰长' });
    assert.equal(mapIgsDanmaku(dm('戊', '进入直播间', 'enter')), null);
    assert.equal(mapIgsDanmaku(dm('房管', '注意言辞', 'admin')), null);
});

check('开播建间、跨楼承接、下播保留并标记；严格校验通过', () => {
    const scope = createEmptyInteractiveScope();
    const chat = [
        ai(liveText([seg('林晚', '深夜弹琴', [dm('海盐', '这首是月光吗'), dm('阿禾', '一束花', 'gift')])])),
        user('继续看'),
        ai(liveText([seg('', '', [dm('雾', '晚安')], { end: true })])),
    ];
    const result = liveSync(scope, chat);
    assert.equal(result.createdRooms.length, 1);
    const room = scope.liveRooms[result.createdRooms[0]];
    assert.deepEqual([room.title, room.hostNameSnapshot, room.hostIsUser, room.ended, room.source.type], ['深夜弹琴', '林晚', false, true, 'igs']);
    assert.ok(room.hostActorId && scope.actors[room.hostActorId].type === 'story', '主播与剧情角色同名时绑定');
    assert.deepEqual(room.danmaku.map(item => [item.kind, item.content]), [['chat', '这首是月光吗'], ['gift', '一束花'], ['chat', '晚安']], '下一楼只有弹幕的段承接上一楼');
    const strict = strictRoundTrip(scope);
    assert.equal(strict.liveRooms[room.id].ended, true);
    assert.equal(strict.liveRooms[room.id].danmaku[0].source.type, 'igs');
    assert.equal(liveSync(scope, chat), null, '重复扫描不重复写');
});

check('主播是用户本人；直播间满了不新建、不挤掉用户自己的', () => {
    const scope = createEmptyInteractiveScope();
    liveSync(scope, [ai(liveText([seg('我', '第一次开播', [dm('路人', '来了')], { view: 'host' })]))]);
    const [room] = Object.values(scope.liveRooms);
    assert.deepEqual([room.hostIsUser, room.hostNameSnapshot], [true, '我']);
    const full = createEmptyInteractiveScope();
    for (let index = 0; index < 12; index += 1) createLiveRoom(full, 'sid', { title: `房间${index}` });
    const before = [...full.liveOrder];
    assert.equal(liveSync(full, [ai(liveText([seg('周屿', '新歌', [dm('a', 'b')])]))]), null, '满额时没有改动，不提交');
    assert.deepEqual(full.liveOrder, before);
    const direct = applyIgsLiveSync(full, { walk: walkIgsLive(liveFloors([ai(liveText([seg('周屿', '新歌', [dm('a', 'b')])]))]), info => stubLive().collect(info.text)), scopeId: 'sid', seeds: [] });
    assert.equal(direct.skipped, 1);
    assert.deepEqual(full.liveOrder, before);
});

check('楼层改了：没改过的弹幕删掉，用户改过的保留；重新开播清掉下播标记', () => {
    const scope = createEmptyInteractiveScope();
    const chat = [ai(liveText([seg('林晚', '深夜弹琴', [dm('甲', '一'), dm('乙', '二')], { end: true })]))];
    liveSync(scope, chat);
    const room = Object.values(scope.liveRooms)[0];
    room.danmaku[1].content = '用户改过的二';
    chat[0] = ai(liveText([seg('林晚', '深夜弹琴', [dm('丙', '三')])]));
    const result = liveSync(scope, chat);
    assert.equal(result.removed, 1);
    assert.deepEqual(room.danmaku.map(item => item.content), ['用户改过的二', '三']);
    assert.equal(Object.hasOwn(room, 'ended'), false, '同一主播同一标题重新开播');
});

check('用户手动建过同名直播间时认领，不重复建', () => {
    const scope = createEmptyInteractiveScope();
    const mine = createLiveRoom(scope, 'sid', { title: '深夜弹琴', hostNameSnapshot: '林晚' });
    const result = liveSync(scope, [ai(liveText([seg('林晚', '深夜弹琴', [dm('甲', '来了')])]))]);
    assert.deepEqual(result.createdRooms, []);
    assert.equal(mine.source.type, 'igs');
    assert.equal(mine.danmaku.length, 1);
});

check('自动同步只为本轮新楼开新直播间', () => {
    const scope = createEmptyInteractiveScope();
    const chat = [ai(liveText([seg('林晚', '旧直播', [dm('甲', '一')])]))];
    assert.equal(liveSync(scope, chat, new Set()), null, '不是本轮的楼：不建');
    assert.equal(liveSync(scope, chat, new Set([hashText(chat[0].mes)])).createdRooms.length, 1);
});

await checkAsync('运行时：同步直播间开关关时不读 IGS.api.live；开时导入并能续写一次', async () => {
    const liveCalls = { collect: 0 };
    const chat = [ai(liveText([seg('林晚', '深夜弹琴', [dm('甲', '好听')])]))];
    const igs = { api: { feeds: stubFeeds(), live: stubLive(liveCalls) } };
    const off = makeRuntime({ enabled: true, chat, igs });
    off.link.setConfig({ syncLive: false });
    off.link.observe('MESSAGE_RECEIVED', 0);
    await settle();
    assert.equal(liveCalls.collect, 0);
    const on = makeRuntime({ enabled: true, autoContinue: true, chat, igs });
    on.link.observe('MESSAGE_RECEIVED', 0);
    await settle();
    const rooms = Object.values(on.state.store.scopes.sid.liveRooms);
    assert.equal(rooms.length, 1);
    assert.equal(on.touched.ai, 1, '续写开关开时对新直播间续写一次');
    on.link.observe('MESSAGE_RECEIVED', 0);
    await settle();
    assert.equal(on.touched.ai, 1, '同一楼不再续写');
});

console.log(`IGS feed sync checks passed (${checks}).`);
