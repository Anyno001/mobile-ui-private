import { readFile } from 'node:fs/promises';
import {
    createEmptyInteractiveScope, createEmptyInteractiveStore, deriveInteractiveActorId, normalizeInteractiveStore,
} from '../src/interactive-scene-model.js';
import {
    VIDEO_LIMITS, addVideoComment, addVideoReply, appendVideoDanmaku, appendVideoReplies, applyVideoCreate, createVideo, deleteVideo,
    deleteVideoComment, deleteVideoDanmaku, deleteVideoReply, placeVideoComments, placeVideoReplies, toggleVideoCommentLike,
    updateVideo, updateVideoComment, updateVideoDanmaku, updateVideoReply,
} from '../src/video-model.js';
import { buildCommunityRequest, parseCommunityResponse } from '../src/interactive-scene-ai.js';
import { parseBackupData } from '../src/settings-backup-validate.js';
import { inheritPhoneDataOnBranch } from '../src/branch-scope-inheritance.js';
import { getStorageIdFor } from '../src/host-context.js';
import { renderLiveList } from '../src/live-views.js';
import {
    VIDEO_FLY_LIMIT, VIDEO_TICK_MS, commentLikeCount, describeVideoCard, sceneIndexAt, sortComments, videoStats, visibleDanmaku,
} from '../src/video-format.js';
import { renderAppTabs, renderVideoCompose, renderVideoHome, renderVideoWatch } from '../src/video-views.js';
import { SCOPE, check, clone, envelope, eq, makeScope, match, me, nomatch, ok, sampleCreate, stats, story, throwsRe } from './video-check-kit.mjs';

// ===== 1. schema =====
const fullStore = () => {
    const { store, scope } = makeScope();
    const video = createVideo(scope, SCOPE, { title: '雨夜', uploaderSeed: story, category: '生活', description: '想法', duration: 90 });
    applyVideoCreate(scope, SCOPE, video.id, sampleCreate(), { actorSeeds: [story, me] });
    return { store, scope, video };
};
const tamper = (change) => {
    const { store, video } = fullStore();
    const raw = clone(store);
    change(raw.scopes[SCOPE].videos[video.id], raw.scopes[SCOPE], raw);
    return normalizeInteractiveStore(raw);
};
await check('schema：合法视频往返不变，缺省可选键不输出', () => {
    const { store, video } = fullStore();
    const round = normalizeInteractiveStore(clone(store));
    eq(round.scopes[SCOPE].videos, store.scopes[SCOPE].videos);
    eq(round.scopes[SCOPE].videoOrder, [video.id]);
    ok(video.scenes.length === 2 && video.cover.desc === '封面' && video.scenes[1].image.desc === '画面描述');
    ok(!Object.hasOwn(video.scenes[0], 'image'));
    eq(video.comments[0].replies.length, 3);
});
await check('schema：分镜 at 不递增、超出时长、超过 8 段、为空都被拒', () => {
    throwsRe(() => tamper(v => { v.scenes[1].at = 0; }), /at 必须严格递增/);
    throwsRe(() => tamper(v => { v.scenes[1].at = 90; }), /at 必须是 0-89 的整数/);
    throwsRe(() => tamper(v => { v.scenes = Array.from({ length: 9 }, (_, index) => ({ at: index, text: `段${index}` })); }), /不能超过 8 项/);
    throwsRe(() => tamper(v => { v.scenes = []; }), /至少需要 1 段/);
    tamper(v => { v.scenes = Array.from({ length: 8 }, (_, index) => ({ at: index * 10, text: `段${index}` })); });
});
await check('schema：回复超过 10 条、评论超过 60、弹幕超过 300 被拒', () => {
    const reply = index => ({ id: `r${index}`, authorId: Object.keys(fullStore().scope.actors)[0], authorNameSnapshot: '甲', content: 'x', createdAt: 1 });
    throwsRe(() => tamper((v, scope) => { const author = Object.keys(scope.actors)[0]; v.comments[0].replies = Array.from({ length: 11 }, (_, i) => ({ ...reply(i), authorId: author })); }), /replies 不能超过 10 项/);
    throwsRe(() => tamper((v, scope) => { const author = Object.keys(scope.actors)[0]; v.comments = Array.from({ length: 61 }, (_, i) => ({ id: `c${i}`, authorId: author, authorNameSnapshot: '甲', content: 'x', createdAt: 1, liked: false, replies: [] })); }), /comments 不能超过 60 项/);
    throwsRe(() => tamper((v, scope) => { const author = Object.keys(scope.actors)[0]; v.danmaku = Array.from({ length: 301 }, (_, i) => ({ id: `d${i}`, authorId: author, authorNameSnapshot: '甲', content: 'x', at: 1, createdAt: 1 })); }), /danmaku 不能超过 300 项/);
});
await check('schema：时长范围、多余键、悬空 actor、重复 id、危险键', () => {
    throwsRe(() => tamper(v => { v.duration = 9; }), /duration 必须是 10-1800/);
    throwsRe(() => tamper(v => { v.duration = 1801; }), /duration 必须是 10-1800/);
    throwsRe(() => tamper(v => { v.extra = 1; }), /包含额外字段：extra/);
    throwsRe(() => tamper(v => { v.comments[0].authorId = 'ghost'; }), /引用了不存在的 actor/);
    throwsRe(() => tamper(v => { v.comments[1].id = v.comments[0].id; }), /id 重复/);
    throwsRe(() => tamper(v => { v.title = ' 带空白'; }), /title 不能包含首尾空白/);
    throwsRe(() => tamper(v => { v.cover = { desc: 'x'.repeat(201) }; }), /长度不能超过 200/);
    throwsRe(() => tamper((v, scope) => { scope.videoOrder = ['__proto__']; }), /危险键|引用了不存在的视频/);
    throwsRe(() => tamper(v => { v.uploaderActorId = 'ghost'; }), /引用了不存在的 actor/);
});
await check('schema：缺 videos 的 v3 读入为空，两键只出现其一被拒，v2 迁移后为空', () => {
    const { store } = fullStore();
    const raw = clone(store);
    delete raw.scopes[SCOPE].videos;
    delete raw.scopes[SCOPE].videoOrder;
    const loaded = normalizeInteractiveStore(raw).scopes[SCOPE];
    eq([loaded.videos, loaded.videoOrder], [{}, []]);
    const half = clone(store);
    delete half.scopes[SCOPE].videoOrder;
    throwsRe(() => normalizeInteractiveStore(half), /videos 与 videoOrder 必须同时存在/);
    const v2 = normalizeInteractiveStore({ version: 2, scopes: { s: { activeSceneId: null, sceneOrder: [], scenes: {}, actors: {} } } });
    eq([v2.scopes.s.videos, v2.scopes.s.videoOrder], [{}, []]);
});
await check('schema：备份校验接受视频，拒绝未列入顺序、悬空作者与单键', () => {
    const { store } = fullStore();
    const current = { theme: {}, interactiveScenes: createEmptyInteractiveStore() };
    const backup = change => { const raw = clone(store); change?.(raw.scopes[SCOPE]); return { schemaVersion: 3, interactiveScenes: raw }; };
    eq(parseBackupData(backup(), current).interactiveScenes.scopes[SCOPE].videos, store.scopes[SCOPE].videos);
    throwsRe(() => parseBackupData(backup(scope => { scope.videoOrder = []; }), current), /videoOrder|未列入/);
    throwsRe(() => parseBackupData(backup(scope => { delete scope.videoOrder; }), current), /同时存在|videoOrder/);
    throwsRe(() => parseBackupData(backup(scope => { Object.values(scope.videos)[0].comments[0].authorId = 'ghost'; }), current), /actor/);
    throwsRe(() => parseBackupData(backup(scope => { Object.values(scope.videos)[0].scenes = []; }), current), /scenes|至少/);
});
await check('schema：每个 scope 最多 20 条视频，超出淘汰最早的', () => {
    const { scope } = makeScope();
    const ids = Array.from({ length: 22 }, (_, index) => createVideo(scope, SCOPE, { title: `视频${index}`, uploaderName: '路人' }).id);
    eq(scope.videoOrder, ids.slice(2));
    eq(Object.keys(scope.videos).length, VIDEO_LIMITS.videos);
    ok(!Object.hasOwn(scope.videos, ids[0]));
});

// ===== 2. 删改 =====
await check('删改：评论、回复、弹幕的增删改，点赞切换，满 10 条回复丢最早', () => {
    const { scope, video } = fullStore();
    const comment = addVideoComment(scope, SCOPE, video, me, '  我的评论  ');
    eq([comment.content, comment.liked, comment.replies], ['我的评论', false, []]);
    updateVideoComment(video, comment.id, '改过');
    eq(video.comments.find(item => item.id === comment.id).content, '改过');
    throwsRe(() => updateVideoComment(video, comment.id, '  '), /不能为空/);
    eq(toggleVideoCommentLike(video, comment.id), true);
    eq(toggleVideoCommentLike(video, comment.id), false);
    const first = addVideoReply(scope, SCOPE, video, comment.id, me, '回复一', '乙');
    eq(first.replyTo, '乙');
    updateVideoReply(video, comment.id, first.id, '回复改');
    deleteVideoReply(video, comment.id, first.id);
    eq(video.comments.find(item => item.id === comment.id).replies, []);
    for (let index = 0; index < 12; index += 1) addVideoReply(scope, SCOPE, video, comment.id, me, `r${index}`);
    const replies = video.comments.find(item => item.id === comment.id).replies;
    eq([replies.length, replies[0].content, replies.at(-1).content], [10, 'r2', 'r11']);
    deleteVideoComment(video, comment.id);
    ok(!video.comments.some(item => item.id === comment.id));
    throwsRe(() => deleteVideoComment(video, 'ghost'), /评论不存在/);
    const [danmaku] = appendVideoDanmaku(scope, SCOPE, video, [{ author: '甲', content: '  新弹幕  ', at: 999 }]);
    eq([danmaku.content, danmaku.at], ['新弹幕', video.duration]);
    updateVideoDanmaku(video, danmaku.id, '改弹幕');
    deleteVideoDanmaku(video, danmaku.id);
    throwsRe(() => deleteVideoDanmaku(video, danmaku.id), /弹幕不存在/);
    updateVideo(scope, video.id, { title: '新标题', category: '游戏', description: '新简介', nsfw: true });
    eq([video.title, video.category, video.nsfw], ['新标题', '游戏', true]);
    throwsRe(() => updateVideo(scope, video.id, { title: ' ' }), /标题不能为空/);
    deleteVideo(scope, video.id);
    eq([scope.videoOrder, scope.videos], [[], {}]);
});
await check('删改：随机插入位置头中尾，createdAt 与顺序一致，用户那条保留 id', () => {
    const outcomes = [];
    for (const slot of [0, 2, 4]) {
        const { scope, video } = fullStore();
        const mine = addVideoComment(scope, SCOPE, video, me, '用户评论');
        const before = video.comments.length - 1;
        const generated = ['甲', '乙', '丙', '丁'].map(author => ({ author, content: `${author}说` }));
        const result = placeVideoComments(scope, SCOPE, video, generated, { userCommentId: mine.id, slot, skipNames: ['我'] });
        outcomes.push(result.userIndex - before);
        eq(video.comments[result.userIndex].id, mine.id);
        const times = video.comments.map(item => item.createdAt);
        ok(times.every((time, index) => index === 0 || time >= times[index - 1]), '时间按新顺序递增');
        eq(video.comments.length, before + 5);
    }
    eq(outcomes, [0, 2, 4]);
});
await check('删改：生成的评论不会冒用用户名，楼中楼插位与上限', () => {
    const { scope, video } = fullStore();
    placeVideoComments(scope, SCOPE, video, [{ author: '我', content: '冒名' }, { author: '路人', content: '正常' }], { skipNames: ['我'] });
    ok(!video.comments.some(item => item.content === '冒名'));
    const target = video.comments[0];
    const mine = addVideoReply(scope, SCOPE, video, target.id, me, '用户回复', '乙');
    const generated = Array.from({ length: 6 }, (_, index) => ({ author: `人${index}`, content: `接${index}`, replyTo: '我' }));
    const result = placeVideoReplies(scope, SCOPE, video, target.id, generated, { userReplyId: mine.id, slot: 3, skipNames: ['我'] });
    ok(target.replies.length <= VIDEO_LIMITS.replies);
    eq(target.replies[result.userIndex].id, mine.id);
    appendVideoReplies(scope, SCOPE, video, target.id, [{ author: '尾', content: '又一条' }]);
    eq(target.replies.length, VIDEO_LIMITS.replies);
});
await check('删改：分支继承重映射视频里的作者 id 和 UP主', async () => {
    const source = getStorageIdFor('alice.png', 'parent-chat');
    const target = getStorageIdFor('alice.png', 'branch-chat');
    const { store, scope } = makeScope(source);
    const video = createVideo(scope, source, { title: '继承', uploaderSeed: story, uploaderName: '林晚' });
    applyVideoCreate(scope, source, video.id, sampleCreate(), { actorSeeds: [story, me] });
    let saved = null;
    const stores = { histories: { [source]: { A: [{ content: 'x' }] } }, groupMeta: {}, pokeConfig: {}, characterBehavior: {}, bidirectional: {}, backgrounds: {}, interactive: clone(store), phoneUi: { version: 1, scopes: {} }, calendar: { version: 1, scopes: {} }, occasions: { version: 1, scopes: {} }, cycles: { version: 1, scopes: {} }, recipes: { version: 1, scopes: {} }, outfits: { version: 1, scopes: {} }, budget: { communitySceneIdsByStorage: {}, communitySelectionsByStorage: {} } };
    const result = await inheritPhoneDataOnBranch({
        context: { chatId: 'branch-chat', characterId: 0, characters: [{ avatar: 'alice.png' }], chatMetadata: { main_chat: 'parent-chat' } },
        loadStores: async () => structuredClone(stores), saveStores: async value => { saved = structuredClone(value); },
        loadLineage: async () => ({}), saveLineage: async () => {},
    });
    eq(result.status, 'cloned');
    const copy = Object.values(saved.interactive.scopes[target].videos)[0];
    const actors = saved.interactive.scopes[target].actors;
    eq(copy.uploaderActorId, deriveInteractiveActorId(target, 'story', story.bindingKey));
    ok(Object.hasOwn(actors, copy.uploaderActorId));
    const authors = [...copy.danmaku, ...copy.comments, ...copy.comments.flatMap(item => item.replies)].map(item => item.authorId);
    ok(authors.length > 0 && authors.every(authorId => Object.hasOwn(actors, authorId)), '作者都指向目标 scope 的 actor');
    ok(!authors.some(authorId => Object.hasOwn(saved.interactive.scopes[source].actors, authorId) && !Object.hasOwn(actors, authorId)));
});

// ===== 3. 提示词与解析 =====
const demoVideo = { title: '雨夜', category: '生活', description: '想法', duration: 90, scenes: [{ at: 0, text: '开场' }, { at: 30, text: '高潮' }], uploaderIsUser: false, uploaderNameSnapshot: '林晚' };
const build = (kind, extra = {}) => buildCommunityRequest({
    kind, nsfw: false, context: '正文', actorRoster: ['林晚'], video: demoVideo, uploaderName: '林晚', uploaderIsUser: false,
    comment: { author: '乙', content: '好看', replies: [] }, segment: { from: 0, to: 30, scenes: demoVideo.scenes }, ...extra,
});
await check('提示词：四种 kind 都能构建，成人条款在开关两种状态下都在', () => {
    for (const kind of ['video_create', 'video_comments', 'video_replies', 'video_danmaku']) {
        for (const nsfw of [false, true]) {
            const prompts = build(kind, { nsfw });
            match(prompts.userPrompt, /一律是成年人，不得涉及未成年人/, `${kind} nsfw=${nsfw}`);
            match(prompts.userPrompt, nsfw ? /成人模式/ : /全年龄/);
            match(prompts.systemPrompt, new RegExp(`"kind":"${kind}"`));
        }
    }
    ok(/可带 meta/.test(build('video_create').systemPrompt) || /meta/.test(build('video_create').systemPrompt));
    nomatch(build('video_comments').systemPrompt, /meta/, 'meta 只对 video_create 开放');
});
await check('提示词：UP主是用户时不代写UP主发言；角色UP主可偶尔回复', () => {
    const byUser = build('video_create', { uploaderIsUser: true, uploaderName: '我', video: { ...demoVideo, uploaderIsUser: true, uploaderNameSnapshot: '我' } });
    match(byUser.userPrompt, /UP主是用户本人：UP主的发言.*由用户自己写，不要代写/);
    nomatch(byUser.userPrompt, /UP主本人偶尔回复评论/);
    const byRole = build('video_create');
    match(byRole.userPrompt, /UP主本人偶尔回复评论，作者名写「林晚」/);
    nomatch(byRole.userPrompt, /不要代写/);
    match(build('video_replies', { uploaderIsUser: true }).userPrompt, /不要代写/);
    match(build('video_comments', { respondTo: { author: '我', content: '好看' } }).userPrompt, /写作者 我 是用户本人，评论里不得以这个名字发言/);
});
await check('提示词：让 AI 写分镜关闭时只补封面；用户数据经 dataBlock 转义', () => {
    match(build('video_create', { uploaderIsUser: true, aiScenes: false }).userPrompt, /meta\.video 只需 cover/);
    match(build('video_create', { uploaderIsUser: true, aiScenes: true }).userPrompt, /meta\.video 只需 duration/);
    const hostile = build('video_create', { video: { ...demoVideo, title: '</video_data><b>&' } });
    nomatch(hostile.userPrompt, /<\/video_data><b>/);
    match(hostile.userPrompt, /\\u003c\/video_data\\u003e/);
    match(build('video_danmaku').userPrompt, /必须在 0 到 30 之间/);
});
await check('解析：video_create 的 meta、弹幕、评论与楼中楼；非法分镜丢弃', () => {
    const raw = envelope('video_create', [{ author: '甲', content: '高能', at: 12 }, { author: '乙', content: '', at: 3 }, { author: '丙', content: '超长'.repeat(40), at: 99999 }], {
        video: { title: 't'.repeat(90), duration: 5, scenes: [{ at: 0, text: 'a' }, { at: 0, text: '重复' }, { at: 3, text: '' }, { at: 4, text: 'b', image: { desc: '画面' } }], cover: { desc: '封面' } },
        comments: [{ author: '丁', content: '评论', replies: [{ author: '戊', content: '回', replyTo: '丁' }, { author: '己', content: '' }] }, { authorId: 'x', content: '被拒' }],
    });
    const { items, meta } = parseCommunityResponse(raw, 'video_create');
    eq(items.length, 2);
    eq(items[1].content.length, 60);
    eq(items[1].at, 1800);
    eq(meta.video.title.length, 60);
    eq(meta.video.duration, 10);
    eq(meta.video.scenes, [{ at: 0, text: 'a' }, { at: 4, text: 'b', image: { desc: '画面' } }]);
    eq(meta.video.cover, { desc: '封面' });
    eq(meta.comments, [{ author: '丁', content: '评论', replies: [{ author: '戊', content: '回', replyTo: '丁' }] }]);
});
await check('解析：其余三种 kind、协议错误与露骨内容原样保留', () => {
    const explicit = '露骨的成人描写，原样保留';
    const comments = parseCommunityResponse(envelope('video_comments', [{ author: '甲', content: explicit, replies: [{ author: '乙', content: explicit, replyTo: '甲' }] }]), 'video_comments');
    eq([comments.items[0].content, comments.items[0].replies[0].content, comments.meta], [explicit, explicit, {}]);
    eq(parseCommunityResponse(envelope('video_replies', [{ author: '甲', content: explicit, replyTo: '乙' }]), 'video_replies').items, [{ author: '甲', content: explicit, replyTo: '乙' }]);
    eq(parseCommunityResponse(envelope('video_danmaku', [{ author: '甲', content: explicit, at: -4 }]), 'video_danmaku').items[0].at, 0);
    eq(parseCommunityResponse(envelope('video_comments', [{ author: '甲', content: 'x' }], { video: { title: 'y' } }), 'video_comments').meta, {}, 'meta 只对 video_create 开放');
    throwsRe(() => parseCommunityResponse(JSON.stringify({ version: 2, kind: 'video_comments', items: [], extra: 1 }), 'video_comments'), /额外字段/);
    throwsRe(() => parseCommunityResponse(envelope('video_replies', [{ author: '甲', content: 'x' }]), 'video_comments'), /协议不匹配|未返回/);
    throwsRe(() => parseCommunityResponse(envelope('video_comments', []), 'video_comments'), /未返回有效内容/);
    throwsRe(() => parseCommunityResponse(envelope('video_create', []), 'video_create'), /未返回有效内容/);
});

// ===== 4. 界面 =====
const uiScope = () => {
    const { scope, video } = fullStore();
    return { scope, video };
};
const watch = (video, ui = {}) => renderVideoWatch({ video, ui: { time: 0, tab: 'intro', now: Date.now(), ...ui } });
const order = (html, names) => names.map(name => html.indexOf(name));
await check('界面：首页两个分区都是真分区，视频卡带时长，空态有投稿按钮', () => {
    const tabs = renderAppTabs('video');
    match(tabs, /data-segment="video" aria-pressed="true">视频</);
    match(tabs, /data-segment="live" aria-pressed="false">直播</);
    const { video } = uiScope();
    const home = renderVideoHome({ videos: [describeVideoCard(video)] });
    match(home, /data-live-view="video-home"/);
    match(home, /<b class="pm-live-heading">噼哩噼哩<\/b>/);
    match(home, /data-video-action="compose">投稿</);
    match(home, /<span class="pm-video-duration">1:30<\/span>/);
    match(home, /data-video-action="open-video" data-video-id="/);
    match(home, /pm-live-cover pm-video-cover is-cover-[1-5]/);
    match(home, /（゜-゜）つロ 干杯/);
    const empty = renderVideoHome({ videos: [] });
    match(empty, /还没有视频[\s\S]*data-video-action="compose">投稿</);
    match(renderVideoHome({ videos: [{ ...describeVideoCard(video), pending: true }] }), /生成中/);
    const live = renderLiveList({ rooms: [], segments: renderAppTabs('live') });
    match(live, /data-segment="live" aria-pressed="true">直播</);
    match(live, /data-live-action="compose">开播</);
    match(live, /还没有直播间/);
});
await check('界面：视频页分镜随时间切换，进度与评论数标签', () => {
    const { video } = uiScope();
    const early = watch(video, { time: 5 });
    const late = watch(video, { time: 45 });
    match(early, /data-scene-index="0">开场</);
    match(late, /data-scene-index="1">高潮</);
    match(early, /0:05 \/ 1:30/);
    match(late, /0:45 \/ 1:30/);
    match(early, />评论 2</);
    match(early, /class="pm-live-heading">雨夜散步</, '标题居中放在顶栏中间栏');
    match(early, /id="pm-video-seek"[^>]*max="90"/);
    match(early, /placeholder="发个弹幕"/);
    eq([sceneIndexAt(video.scenes, 0), sceneIndexAt(video.scenes, 29), sceneIndexAt(video.scenes, 30)], [0, 0, 1]);
    match(watch(video, { time: 45, tab: 'intro' }), /data-video-action="seek" data-at="30"/);
});
await check('界面：评论热门与最新排序', () => {
    const { scope, video } = uiScope();
    for (let index = 0; index < 5; index += 1) addVideoComment(scope, SCOPE, video, me, `排序${index}`);
    video.comments.forEach((comment, index) => { comment.createdAt = 1_000 + index * 10; });
    const latest = sortComments(video.comments, 'latest');
    eq(latest.map(item => item.createdAt), [...video.comments].map(item => item.createdAt).sort((left, right) => right - left));
    const hot = sortComments(video.comments, 'hot');
    const score = comment => commentLikeCount(comment) + comment.replies.length * 3;
    ok(hot.every((comment, index) => index === 0 || score(hot[index - 1]) >= score(comment)), '热门按分数不增');
    const html = watch(video, { tab: 'comments', sort: 'latest' });
    const positions = order(html, latest.map(item => `data-entry-id="${item.id}"`));
    ok(positions.every((position, index) => position > -1 && (index === 0 || position > positions[index - 1])), '最新页面顺序');
    match(watch(video, { tab: 'comments', sort: 'hot' }), /data-sort="hot" aria-pressed="true"/);
    match(html, /data-sort="latest" aria-pressed="true"/);
    const liked = video.comments.find(item => item.content === '排序0');
    const before = commentLikeCount(liked);
    toggleVideoCommentLike(video, liked.id);
    eq(commentLikeCount(liked), before + 1);
});
await check('界面：楼中楼只显示 2 条加展开，UP 标签，回复态输入框', () => {
    const { video } = uiScope();
    const thread = video.comments[0];
    const closed = watch(video, { tab: 'comments' });
    eq((closed.match(/class="pm-video-reply"/g) || []).length, 2);
    match(closed, /data-video-action="toggle-thread"[^>]*aria-expanded="false">共 3 条回复</);
    const opened = watch(video, { tab: 'comments', openThreads: [thread.id] });
    eq((opened.match(/class="pm-video-reply"/g) || []).length, 3);
    match(opened, />收起回复</);
    match(closed, /回复 <em class="pm-video-at">@乙<\/em>：/);
    ok((closed.match(/class="pm-video-up">UP</g) || []).length >= 1, '角色 UP主发的回复带 UP 标');
    nomatch(watch({ ...video, comments: [video.comments[1]] }, { tab: 'comments' }), /pm-video-up/);
    const plain = watch(video, { tab: 'comments' });
    match(plain, /placeholder="发一条友善的评论"/);
    nomatch(plain, /data-video-action="cancel-reply"/);
    const replying = watch(video, { tab: 'comments', replyTo: { commentId: thread.id, name: '乙' } });
    match(replying, /placeholder="回复 @乙"/);
    match(replying, /data-video-action="cancel-reply">取消</);
    nomatch(watch(video, { tab: 'intro' }), /pm-video-composer/);
});
await check('界面：用户发布的视频 UP 标签落在用户自己的评论上', () => {
    const { scope } = makeScope();
    const video = createVideo(scope, SCOPE, { title: '我的', uploaderIsUser: true, uploaderSeed: me });
    const mine = addVideoComment(scope, SCOPE, video, me, '我自己评论');
    const other = placeVideoComments(scope, SCOPE, video, [{ author: '路人', content: '路过' }], {}).comments.find(item => item.content === '路过');
    const html = watch(video, { tab: 'comments' });
    const mineHtml = html.slice(html.indexOf(`data-entry-id="${mine.id}"`), html.indexOf(`data-entry-id="${other.id}"`) > html.indexOf(`data-entry-id="${mine.id}"`) ? html.indexOf(`data-entry-id="${other.id}"`) : undefined);
    match(mineHtml, /pm-video-up/);
    eq((html.match(/pm-video-up">UP</g) || []).length, 1);
});
await check('界面：弹幕窗口、飞行内联变量与转义', () => {
    const { video } = uiScope();
    eq(visibleDanmaku(video, 13).map(entry => entry.item.content), ['前方高能']);
    eq(visibleDanmaku(video, 18).length, 0, '飞过 6 秒后离开窗口');
    eq(visibleDanmaku(video, 11).length, 0, '还没到时间点不出现');
    eq(visibleDanmaku(video, 13)[0].delay, -1);
    ok(visibleDanmaku({ danmaku: Array.from({ length: 30 }, (_, i) => ({ id: `d${i}`, at: 10, createdAt: i, content: `x${i}` })) }, 11).length <= VIDEO_FLY_LIMIT);
    const html = watch(video, { time: 13 });
    match(html, /<span style="--lane:\d;--delay:-1s;--duration:6s">前方高能<\/span>/);
    nomatch(watch({ ...video, title: '<img src=x>' }), /<img src=x>/);
    ok(VIDEO_TICK_MS > 0 && videoStats(video).views === videoStats(video).views, '统计数字稳定');
});
await check('界面：投稿页字段、分区胶囊、UP主选项与编辑态', () => {
    const hosts = [{ key: 'user', label: '我' }, { key: 'actor:a1', label: '林晚' }, { key: 'other', label: '其他' }];
    const mine = renderVideoCompose({ form: { hostKey: 'user', aiScenes: true }, hosts });
    for (const category of ['生活', '游戏', '音乐', '知识', '美食', '影视', 'Vlog']) match(mine, new RegExp(`data-category="${category}"`));
    match(mine, /data-host="user" aria-pressed="true"/);
    match(mine, /id="pm-video-ai-scenes"[^>]*aria-checked="true"/);
    match(mine, /id="pm-video-nsfw"[^>]*aria-checked="false"/);
    match(mine, /data-video-action="submit">投稿</);
    match(mine, /placeholder="给视频起个标题"/);
    const role = renderVideoCompose({ form: { hostKey: 'actor:a1' }, hosts });
    match(role, /placeholder="留空让 AI 起标题"/);
    match(role, /想让 TA 发一条什么视频/);
    nomatch(role, /pm-video-ai-scenes/);
    match(renderVideoCompose({ form: { hostKey: 'other', hostName: '阿夏' }, hosts }), /id="pm-video-host-name"[^>]*value="阿夏"/);
    const editing = renderVideoCompose({ form: { title: 'x', category: '修仙' }, hosts, editing: true });
    match(editing, /data-video-action="submit">保存</);
    match(editing, /data-video-action="delete-video">删除视频</);
    match(editing, /id="pm-video-category-custom"[^>]*value="修仙"/);
    nomatch(editing, /data-host=/);
});
await check('界面：样式契约（reduced-motion、不加灰底与竖线、不用 !important）', async () => {
    const css = await readFile(new URL('../styles/video.css', import.meta.url), 'utf8');
    const reduced = css.match(/@media\(prefers-reduced-motion:reduce\)\{[\s\S]*$/)?.[0] || '';
    match(reduced, /\.pm-live-fly\.pm-video-fly\{[^}]*position:static/);
    match(reduced, /\.pm-video-scene[^{]*\{[^}]*animation:none/);
    nomatch(css, /!important/);
    nomatch(css, /border(-left|-right|-top|-bottom)?\s*:\s*[^0n]/, '不加描边和竖引用线');
    const rules = css.match(/\.pm-video-(comment|reply|replies|main)[^{]*\{[^}]*\}/g) || [];
    ok(rules.length > 0 && rules.every(rule => !/background:var\(--pm-color-(fill|bg-grouped|surface-control)/.test(rule)), '评论区不加灰底');
    match(css, /\.pm-video-comment\.is-fresh,\.pm-video-reply\.is-fresh\{background:var\(--pm-live-video-soft\)/);
    match(css, /\.pm-live-fly\.pm-video-fly span\{[^}]*animation-iteration-count:1/);
    const viewsSource = await readFile(new URL('../src/video-views.js', import.meta.url), 'utf8');
    eq([...viewsSource.matchAll(/style="([^"]*)"/g)].map(m => [...m[1].matchAll(/(--[a-z]+):/g)].map(x => x[1])), [['--lane', '--delay', '--duration']]);
});


// ===== 验收修复的回归 =====
await check('回归1：生成结果合并进已有内容，生成期间用户发的弹幕和评论不丢', () => {
    const { scope } = makeScope();
    const video = createVideo(scope, SCOPE, { title: '占位', uploaderSeed: story, duration: 90, pending: true });
    const mine = addVideoComment(scope, SCOPE, video, me, '生成期间我发的');
    appendVideoDanmaku(scope, SCOPE, video, [{ authorSeed: me, content: '我的弹幕', at: 20 }], [me]);
    applyVideoCreate(scope, SCOPE, video.id, sampleCreate(), { actorSeeds: [story, me] });
    ok(video.comments.some(item => item.id === mine.id && item.content === '生成期间我发的'), '用户评论保留且 id 不变');
    ok(video.danmaku.some(item => item.content === '我的弹幕' && item.at === 20));
    eq(video.comments.length, 3);
    eq(video.danmaku.length, 3);
    eq(video.danmaku.map(item => item.at), [...video.danmaku.map(item => item.at)].sort((left, right) => left - right), '弹幕按时间点排序');
    const times = video.comments.map(item => item.createdAt);
    ok(times.every((time, index) => index === 0 || time >= times[index - 1]), '评论按 createdAt 排序');
});
await check('回归1：弹幕超过 300 时用户内容全部保留，先丢生成的', () => {
    const { scope } = makeScope();
    const video = createVideo(scope, SCOPE, { title: '满了', uploaderSeed: story, duration: 90, pending: true });
    appendVideoDanmaku(scope, SCOPE, video, Array.from({ length: 299 }, (_, index) => ({ authorSeed: me, content: `我${index}`, at: index % 90 })), [me]);
    applyVideoCreate(scope, SCOPE, video.id, { video: {}, danmaku: Array.from({ length: 5 }, (_, index) => ({ author: '路人', content: `生成${index}`, at: index })), comments: [] }, {});
    eq(video.danmaku.length, 300);
    eq(video.danmaku.filter(item => item.content.startsWith('我')).length, 299);
});
await check('回归2：pending 与 draft 往返、严格校验、备份校验；缺字段视为已生成', () => {
    const { store, scope } = makeScope();
    const video = createVideo(scope, SCOPE, { title: '占位', uploaderSeed: story, pending: true, draft: { titleTyped: true, categoryTyped: false, aiScenes: false } });
    eq([video.pending, video.draft], [true, { titleTyped: true, categoryTyped: false, aiScenes: false }]);
    const round = normalizeInteractiveStore(clone(store)).scopes[SCOPE].videos[video.id];
    eq([round.pending, round.draft], [true, video.draft]);
    applyVideoCreate(scope, SCOPE, video.id, sampleCreate(), { actorSeeds: [story, me] });
    ok(!Object.hasOwn(video, 'pending') && !Object.hasOwn(video, 'draft'), '生成成功后清掉 pending 和 draft');
    const legacy = createVideo(makeScope().scope, SCOPE, { title: '旧数据', uploaderSeed: story });
    ok(!Object.hasOwn(legacy, 'pending'), '不带 pending 的视频视为已生成');
    const tamper2 = change => { const raw = clone(store); change(Object.values(raw.scopes[SCOPE].videos)[0]); return raw; };
    throwsRe(() => normalizeInteractiveStore(tamper2(v => { v.pending = false; })), /pending 只能是 true/);
    throwsRe(() => normalizeInteractiveStore(tamper2(v => { v.draft = { titleTyped: true }; })), /draft.categoryTyped 必须是布尔值/);
    throwsRe(() => normalizeInteractiveStore(tamper2(v => { v.draft = { titleTyped: true, categoryTyped: true, aiScenes: true, extra: 1 }; })), /包含额外字段：extra/);
    const pendingStore = makeScope();
    createVideo(pendingStore.scope, SCOPE, { title: '备份', uploaderSeed: story, pending: true, draft: { titleTyped: false, categoryTyped: false, aiScenes: true } });
    const current = { theme: {}, interactiveScenes: createEmptyInteractiveStore() };
    const backup = change => { const raw = clone(pendingStore.store); change?.(Object.values(raw.scopes[SCOPE].videos)[0]); return { schemaVersion: 3, interactiveScenes: raw }; };
    eq(Object.values(parseBackupData(backup(), current).interactiveScenes.scopes[SCOPE].videos)[0].pending, true);
    throwsRe(() => parseBackupData(backup(v => { v.pending = 'yes'; }), current), /pending/);
    throwsRe(() => parseBackupData(backup(v => { v.draft.aiScenes = 1; }), current), /draft/);
});
await check('回归3：回复用户的提示词写明「回复 @某人」', () => {
    const prompts = build('video_replies', { respondTo: { author: '我', content: '我来回复', replyTo: '乙' } });
    match(prompts.userPrompt, /用户这条是在回复 @乙/);
    match(prompts.userPrompt, /\\"replyTo\\":\\"乙\\"/, 'respond_data 里也带 replyTo');
    nomatch(build('video_replies', { respondTo: { author: '我', content: '我来回复' } }).userPrompt, /用户这条是在回复/);
});

// 第 5 组（真实安装层与生命周期）在单独文件里，由这里加载后一起计数。
await import('./check-video-lifecycle.mjs');
console.log(`Video checks passed (${stats.passed} checks, ${stats.assertions} assertions).`);
