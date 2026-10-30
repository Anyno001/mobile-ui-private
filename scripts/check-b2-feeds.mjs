// B2 四个社区平台（盆友圈 moments、小红薯 xhs、吱乎 zhihu、今日猴条 news）的定向检查：
// 登记、提示词、解析、存储字段（v3 严格与宽松读入）、备份白名单、点赞名单、发布字段、版式与正文注入。
import assert from 'node:assert/strict';
import { COMMUNITY_PLATFORMS, IGS_SYNC_PLATFORMS, MOMENTS_LIKERS_MAX } from '../src/interactive-scene-constants.js';
import { APP_NAMES } from '../src/app-names.js';
import { COMMUNITY_PLATFORM_PROMPTS, buildCommunityRequest } from '../src/prompts/interactive/interactive.js';
import { parseCommunityResponse } from '../src/interactive-scene-ai.js';
import {
    appendScenePosts, createEmptyInteractiveScope, deriveInteractiveActorId, normalizeInteractiveStore, toggleScenePostLike,
} from '../src/interactive-scene-model.js';
import { B2_POST_KEYS } from '../src/interactive-scene-post-fields.js';
import { parseBackupData } from '../src/settings-backup-validate.js';
import { renderCommunitySource } from '../src/community-injection.js';
import { COMMUNITY_PLATFORM_ACCENTS } from '../src/community-views/view-shared.js';
import { applyViewAction, composePostFields, parseTopicInput, readComposeDraft, readComposeUi, resetViewAfterPublish } from '../src/community-views/view-actions.js';
import { renderCommunityWorkspace } from '../src/interactive-scene-views.js';
import { groupZhihuQuestions } from '../src/community-views/view-zhihu.js';
import { splitNewsText } from '../src/community-views/view-news.js';
import { splitNewsExtra, splitZhihuAuthor } from '../src/igs-feed-core.js';
import { readFileSync } from 'node:fs';

const B2 = ['moments', 'xhs', 'zhihu', 'news'];
let checks = 0;
const check = (name, run) => { try { run(); checks += 1; } catch (error) { error.message = `${name}：${error.message}`; throw error; } };
const envelope = (kind, items) => JSON.stringify({ version: 2, kind, items });
const at = Date.UTC(2030, 0, 1, 12);

check('登记：平台表、IGS 同步、谐音名、点缀色、提示词', () => {
    for (const platform of B2) {
        assert.ok(COMMUNITY_PLATFORMS.includes(platform), `${platform} 在 COMMUNITY_PLATFORMS`);
        assert.ok(IGS_SYNC_PLATFORMS.includes(platform), `${platform} 能接收 IGS 帖子`);
        assert.ok(APP_NAMES[platform]?.name && APP_NAMES[platform]?.slogan, `${platform} 有谐音名与小标语`);
        assert.match(COMMUNITY_PLATFORM_ACCENTS[platform], /^#[0-9a-f]{6}$/);
        assert.ok(COMMUNITY_PLATFORM_PROMPTS[platform]?.feedFields, `${platform} 有提示词`);
    }
    assert.deepEqual(B2.map(platform => COMMUNITY_PLATFORM_ACCENTS[platform]), ['#5f88b8', '#d4616c', '#4f8fb8', '#3f5f8f'], '点缀色照稿子：雾蓝、山茶红、天青、墨蓝');
    assert.ok(!IGS_SYNC_PLATFORMS.includes('shop'), '桃宝不进社区同步');
});

check('提示词写真名、界面显示谐音名；成人开关只在提示词', () => {
    const labels = { moments: '朋友圈', xhs: '小红书', zhihu: '知乎', news: '今日头条' };
    for (const platform of B2) {
        const { userPrompt } = buildCommunityRequest({ kind: 'feed_batch', platform, context: '', actorRoster: ['林晚'], nsfw: false });
        assert.match(userPrompt, new RegExp(`平台：${labels[platform]}`));
        assert.doesNotMatch(userPrompt, new RegExp(APP_NAMES[platform].name), '提示词不写谐音名');
        assert.match(userPrompt, /内容尺度：全年龄/);
        assert.match(buildCommunityRequest({ kind: 'feed_batch', platform, context: '', nsfw: true }).userPrompt, /内容尺度：成人模式/);
    }
    assert.match(buildCommunityRequest({ kind: 'feed_batch', platform: 'moments', context: '' }).userPrompt, /不出现路人网友/, '朋友圈作者只写熟人');
    assert.match(buildCommunityRequest({ kind: 'feed_batch', platform: 'news', context: '' }).userPrompt, /author 写媒体名/);
    const ask = buildCommunityRequest({ kind: 'comment_batch', platform: 'zhihu', post: '问题', respondTo: { type: 'post', author: '我', content: '问题？', ask: true } }).userPrompt;
    assert.match(ask, /生成 2-3 个回答/, '知乎提问的回应是回答');
    assert.match(ask, /authorBio/);
    const newsReply = buildCommunityRequest({ kind: 'comment_batch', platform: 'news', post: '新闻', respondTo: { type: 'comment', author: '我', content: '评论', replyOwner: true } }).userPrompt;
    assert.match(newsReply, /媒体不回复评论/);
});

check('解析：朋友圈定位、可见范围、点赞名单去重截断，引用名保留', () => {
    const likers = Array.from({ length: 15 }, (_, index) => `友${index}`);
    const [item] = parseCommunityResponse(envelope('feed_batch', [{
        author: '阿禾', content: '雨停了', place: '东区老街', audience: 'partial', likers: ['林晚', '林晚', ' ', 3, ...likers], image: '面馆热气',
        comments: [{ author: '周屿', content: '加蛋' }, { author: '阿禾', content: '下次', quote: '周屿' }],
    }]), 'feed_batch', 'moments').items;
    assert.equal(item.place, '东区老街');
    assert.equal(item.audience, 'partial');
    assert.equal(item.likers.length, MOMENTS_LIKERS_MAX);
    assert.deepEqual(item.likers.slice(0, 2), ['林晚', '3'], '去重，数字转成名字');
    assert.equal(item.comments[1].quote, '周屿');
    assert.deepEqual(item.image, { desc: '面馆热气' });
    const [plain] = parseCommunityResponse(envelope('feed_batch', [{ author: '甲', content: '公开', audience: 'public', likers: 'x' }]), 'feed_batch', 'moments').items;
    assert.equal(Object.hasOwn(plain, 'audience'), false, '公开或非法可见范围不存');
    assert.equal(Object.hasOwn(plain, 'likers'), false);
});

check('解析：小红书标题必填，缺标题整条丢弃；话题去井号', () => {
    const { items } = parseCommunityResponse(envelope('feed_batch', [
        { author: '甲', title: '雨天咖啡店', content: '热可可', tags: ['#探店#', '日常'] },
        { author: '乙', content: '没有标题' },
    ]), 'feed_batch', 'xhs');
    assert.equal(items.length, 1);
    assert.equal(items[0].title, '雨天咖啡店');
    assert.deepEqual(items[0].tags, ['探店', '日常']);
    assert.throws(() => parseCommunityResponse(envelope('feed_batch', [{ author: '乙', content: '没有标题' }]), 'feed_batch', 'xhs'), /有效内容/);
});

check('解析：知乎 question 与 authorBio、新闻 title 与 column；回应里的答主身份', () => {
    const [answer] = parseCommunityResponse(envelope('feed_batch', [{ author: '苏小满', authorBio: '便利店夜班店员', question: '夜班是什么体验？', content: '谢邀。' }]), 'feed_batch', 'zhihu').items;
    assert.deepEqual([answer.question, answer.authorBio], ['夜班是什么体验？', '便利店夜班店员']);
    const [news] = parseCommunityResponse(envelope('feed_batch', [{ author: '雨城日报', title: '地铁停运', column: '突发', content: '导语\n正文' }]), 'feed_batch', 'news').items;
    assert.deepEqual([news.title, news.column, news.tags], ['地铁停运', '突发', []]);
    const [reply] = parseCommunityResponse(envelope('comment_batch', [{ author: '答主', authorBio: '乐评人', content: '先说结论' }]), 'comment_batch', 'zhihu').items;
    assert.equal(reply.authorBio, '乐评人');
    const [weiboReply] = parseCommunityResponse(envelope('comment_batch', [{ author: '甲', authorBio: '不该出现', content: '评论' }]), 'comment_batch', 'weibo').items;
    assert.equal(Object.hasOwn(weiboReply, 'authorBio'), false, '只有知乎带答主身份');
});

const actorId = deriveInteractiveActorId('sid', 'passerby', 'passerby:阿禾');
const storeWith = (post, platform = 'moments') => ({ version: 3, scopes: { sid: {
    activeSceneId: 's', sceneOrder: ['s'], liveRooms: {}, liveOrder: [],
    actors: { [actorId]: { actorId, type: 'passerby', displayName: '阿禾', bindingKey: 'passerby:阿禾', profile: '', createdAt: 1 } },
    scenes: { s: { id: 's', title: '社区', platform, nsfw: false, preset: platform, styleInput: '', generatedPrompt: '', themeAccent: '', createdAt: 1, updatedAt: 1,
        posts: [{ id: 'p', authorId: actorId, authorNameSnapshot: '阿禾', content: '正文', tags: [], createdAt: 1, comments: [], liked: false, shareCount: 0, shared: false, ...post }] } },
} } });

check('存储 v3：新字段可选、合法值往返，缺省不输出键', () => {
    const fields = { likers: ['林晚', '周屿'], place: '东区', audience: 'private', question: '问题？', authorBio: '店员', ask: true, column: '本地', title: '标题' };
    const post = normalizeInteractiveStore(storeWith(fields)).scopes.sid.scenes.s.posts[0];
    for (const [key, value] of Object.entries(fields)) assert.deepEqual(post[key], value, `${key} 往返`);
    const bare = normalizeInteractiveStore(storeWith({})).scopes.sid.scenes.s.posts[0];
    for (const key of B2_POST_KEYS) assert.equal(Object.hasOwn(bare, key), false, `缺省不输出 ${key}`);
});

check('存储 v3 严格校验：非法值报错', () => {
    const bad = [
        [{ likers: 'x' }, /post\.likers/], [{ likers: Array.from({ length: 13 }, (_, index) => `n${index}`) }, /post\.likers/], [{ likers: ['a', 'a'] }, /重复/],
        [{ likers: [' a'] }, /post\.likers/], [{ audience: 'public' }, /post\.audience/], [{ place: '' }, /post\.place/],
        [{ question: 'x'.repeat(81) }, /post\.question/], [{ ask: true }, /post\.ask/], [{ ask: false, question: '问？' }, /post\.ask/], [{ column: 5 }, /post\.column/],
        [{ unknownKey: 1 }, /unknownKey|post/],
    ];
    for (const [post, pattern] of bad) assert.throws(() => normalizeInteractiveStore(storeWith(post)), pattern, JSON.stringify(post));
});

check('宽松读入（追加帖子）：非法值丢弃，不让整条失效', () => {
    const scope = createEmptyInteractiveScope();
    const scene = { id: 's', posts: [] };
    const [post] = appendScenePosts(scope, 'sid', scene, [{ author: '甲', content: '正文', likers: ['乙', 7, '乙'], audience: 'everyone', ask: true, column: '  ', place: 'x'.repeat(60) }]);
    assert.deepEqual(post.likers, ['乙']);
    assert.equal(Object.hasOwn(post, 'audience'), false);
    assert.equal(Object.hasOwn(post, 'ask'), false, '没有 question 的 ask 丢弃');
    assert.equal(Object.hasOwn(post, 'column'), false);
    assert.equal(Array.from(post.place).length, 40);
});

check('备份：帖子允许键含新字段，非法值拒绝导入', () => {
    const current = { interactiveScenes: { version: 1, scopes: {} } };
    const store = normalizeInteractiveStore(storeWith({ likers: ['林晚'], place: '东区', question: '问？', authorBio: '店员', column: '本地' }));
    const parsed = parseBackupData({ interactiveScenes: store }, current).interactiveScenes.scopes.sid.scenes.s.posts[0];
    assert.deepEqual([parsed.likers, parsed.place, parsed.question, parsed.authorBio, parsed.column], [['林晚'], '东区', '问？', '店员', '本地']);
    const broken = structuredClone(store);
    broken.scopes.sid.scenes.s.posts[0].audience = 'everyone';
    assert.throws(() => parseBackupData({ interactiveScenes: broken }, current), /audience/);
});

check('朋友圈点赞：用户名进名单、取消时移出，其余平台不动名单', () => {
    const scene = { posts: [{ id: 'p', liked: false, likers: ['林晚'] }] };
    toggleScenePostLike(scene, 'p', '我');
    assert.deepEqual([scene.posts[0].liked, scene.posts[0].likers], [true, ['林晚', '我']]);
    toggleScenePostLike(scene, 'p', '我');
    assert.deepEqual([scene.posts[0].liked, scene.posts[0].likers], [false, ['林晚']]);
    const solo = { posts: [{ id: 'p', liked: false }] };
    toggleScenePostLike(solo, 'p', '我'); toggleScenePostLike(solo, 'p', '我');
    assert.equal(Object.hasOwn(solo.posts[0], 'likers'), false, '名单清空后不留空数组');
    const other = { posts: [{ id: 'p', liked: false }] };
    toggleScenePostLike(other, 'p');
    assert.equal(Object.hasOwn(other.posts[0], 'likers'), false);
});

check('发布字段：朋友圈定位与可见范围、小红书标题必填与话题、知乎提问与写回答、新闻不可发布', () => {
    assert.deepEqual(composePostFields('moments', '雨停了', { place: ' 东区 ', audience: 'partial' }), { content: '雨停了', tags: [], place: '东区', audience: 'partial' });
    assert.deepEqual(composePostFields('moments', '公开', { audience: '' }), { content: '公开', tags: [] });
    assert.throws(() => composePostFields('xhs', '正文', { title: ' ' }), /标题/);
    assert.deepEqual(composePostFields('xhs', '正文', { title: '雨天咖啡店', topics: '#探店 日常，日常、初雪 多余' }), { content: '正文', tags: ['探店', '日常', '初雪'], title: '雨天咖啡店' });
    assert.deepEqual(parseTopicInput(''), []);
    assert.deepEqual(composePostFields('zhihu', '夜班是什么体验？', { supplement: '' }), { content: '夜班是什么体验？', tags: [], question: '夜班是什么体验？', ask: true });
    assert.deepEqual(composePostFields('zhihu', '夜班是什么体验？', { supplement: '想换工作' }).content, '想换工作');
    assert.deepEqual(composePostFields('zhihu', '谢邀', {}, { view: { question: '夜班是什么体验？' } }), { content: '谢邀', tags: [], question: '夜班是什么体验？' });
    assert.throws(() => composePostFields('news', '假新闻', {}), /不能由用户发布/);
});

check('编辑页读取：新输入只在存在时带上，旧平台结果不变', () => {
    const values = { '#pm-scene-place-input': { value: ' 东区 ' }, '#pm-scene-topics-input': { value: '探店' }, '#pm-scene-supplement-input': { value: '补充' }, 'input[name="pm-scene-audience"]:checked': { value: 'private' } };
    const app = { querySelector: selector => values[selector] || null };
    const ui = readComposeUi(app);
    assert.deepEqual([ui.place, ui.topics, ui.supplement, ui.audience], ['东区', '探店', '补充', 'private']);
    const draft = readComposeDraft(app);
    assert.deepEqual([draft.place, draft.topics, draft.supplement, draft.audience], [' 东区 ', '探店', '补充', 'private'], '草稿取原样值');
    const empty = readComposeUi({ querySelector: () => null });
    for (const key of ['place', 'topics', 'supplement', 'audience']) assert.equal(Object.hasOwn(empty, key), false);
});

check('视图状态：话题与栏目筛选、问题页、发布后清筛选', () => {
    const view = { open: [], tag: '', question: '' };
    assert.equal(applyViewAction(view, 'filter-tag', { tag: '探店' }), true, '筛选保持滚动');
    assert.equal(view.tag, '探店');
    assert.equal(applyViewAction(view, 'open-question', { question: '问？' }), false);
    assert.equal(view.question, '问？');
    applyViewAction(view, 'close-question');
    assert.equal(view.question, '');
    resetViewAfterPublish(view, 'xhs');
    assert.equal(view.tag, '', '发布后清掉话题筛选，新笔记看得见');
});

check('知乎分组：按 question 分组，提问不算回答，最近有动静的问题在前', () => {
    const posts = [
        { id: 'a', question: '旧问题？', content: '回答', createdAt: 1 },
        { id: 'b', question: '新问题？', content: '新问题？', ask: true, createdAt: 5 },
        { id: 'c', question: '新问题？', content: '答', createdAt: 6 },
        { id: 'd', content: '没有问题的回答', createdAt: 2 },
    ];
    const groups = groupZhihuQuestions(posts);
    assert.deepEqual(groups.map(group => group.question), ['新问题？', '其他回答', '旧问题？']);
    assert.equal(groups[0].ask.id, 'b');
    assert.deepEqual(groups[0].answers.map(post => post.id), ['c']);
});

check('新闻标题：有 title 用 title，没有时取正文第一句', () => {
    assert.deepEqual(splitNewsText({ title: '地铁停运', content: '导语\n正文' }), { title: '地铁停运', paragraphs: ['导语', '正文'] });
    assert.deepEqual(splitNewsText({ content: '东区地铁停运三小时。今晚七点设备故障。\n接驳车已发车' }), { title: '东区地铁停运三小时', paragraphs: ['今晚七点设备故障。', '接驳车已发车'] });
});

check('IGS 附加拆分：新闻栏目与媒体、知乎答主身份', () => {
    assert.deepEqual(splitNewsExtra('突发·雨城日报'), { column: '突发', media: '雨城日报' });
    assert.deepEqual(splitNewsExtra('雨城日报 | 本地'), { column: '本地', media: '雨城日报' });
    assert.deepEqual(splitNewsExtra('雨城日报'), { column: '', media: '雨城日报' });
    assert.deepEqual(splitNewsExtra('娱乐'), { column: '娱乐', media: '' });
    assert.deepEqual(splitZhihuAuthor('苏小满，便利店夜班店员'), { name: '苏小满', bio: '便利店夜班店员' });
    assert.deepEqual(splitZhihuAuthor('周屿'), { name: '周屿', bio: '' });
});

const mkPost = (id, extra = {}) => ({ id, authorId: 'a', authorNameSnapshot: '甲', content: '第一句话。第二句', tags: [], comments: [], liked: false, shareCount: 0, shared: false, createdAt: at, ...extra });
const mkScene = (platform, posts) => ({ id: `s_${platform}`, title: '社区', platform, preset: platform, generatedPrompt: '', themeAccent: '', updatedAt: at, posts });
const render = (scene, view = {}, extra = {}) => renderCommunityWorkspace(scene, 'feed', { pinnedSceneIds: [] }, { view: { open: [], retry: [], ...view }, now: at + 60_000, ...extra });
const count = (html, pattern) => (html.match(pattern) || []).length;

check('版式：顶栏三栏不变，标题居中，右侧只有拍一拍与 ⋯', () => {
    for (const platform of B2) {
        const html = render(mkScene(platform, [mkPost('p1', { title: '标题', question: '问？' })]));
        assert.match(html, /<div class="pm-scene-topbar"><div class="pm-scene-nav-actions">[\s\S]*?<div class="pm-scene-title"><b>社区<\/b><\/div><div class="pm-scene-view-actions">/);
        const right = html.match(/<div class="pm-scene-view-actions">[\s\S]*?<\/div><\/div><div class="pm-scene-status"/)?.[0] || '';
        assert.equal(count(right, /<button type="button" (?:class="pm-header-icon-button pm-scene-title-poke"|class="pm-scene-more")/g), 2, `${platform} 顶栏右侧只有两个按钮`);
        assert.doesNotMatch(html, /style="/, `${platform} 不写内联样式`);
    }
});

check('盆友圈：封面相机发表、「··」浮层、点赞名单与「A 回复 B」、定位与可见范围', () => {
    const comments = [
        { id: 'c1', authorId: 'b', authorNameSnapshot: '周屿', content: 'B面更好', createdAt: at },
        { id: 'c2', authorId: 'a', authorNameSnapshot: '阿禾', content: '等我翻面', createdAt: at, quoteId: 'c1' },
    ];
    const html = render(mkScene('moments', [mkPost('p1', { likers: ['林晚', '苏小满'], place: '河岸唱片行', audience: 'partial', comments })]), {}, { authorName: '我' });
    assert.match(html, /class="pm-scene-moments-camera" data-action="open-compose"/);
    assert.match(html, /class="pm-scene-moments-me"><b>我<\/b>/, '封面压着「我」的名字和头像');
    assert.match(html, /data-action="post-actions" aria-label="赞与评论"[\s\S]*?class="pm-scene-post-actions pm-scene-moments-pop" hidden/);
    assert.match(html, /林晚、苏小满/);
    assert.match(html, /<b>阿禾<\/b> 回复 <b>周屿<\/b>：等我翻面/);
    assert.match(html, /河岸唱片行/);
    assert.match(html, /部分可见/);
    assert.doesNotMatch(html, /pm-scene-bottom-bar|pm-scene-fab/, '没有底栏和悬浮钮');
});

check('小红薯：话题胶囊真筛选、双列、底部正中「+」、笔记页底栏', () => {
    const scene = mkScene('xhs', [mkPost('p1', { title: '雨天咖啡店', tags: ['探店'] }), mkPost('p2', { title: '通勤穿搭', tags: ['穿搭'] }), mkPost('p3', { title: '唱片墙', tags: ['探店'] })]);
    const list = render(scene);
    assert.match(list, /data-action="filter-tag" data-tag="" aria-pressed="true">全部/);
    assert.ok(list.indexOf('data-tag="探店"') < list.indexOf('data-tag="穿搭"'), '胶囊按出现次数排序');
    assert.equal(count(list, /class="pm-scene-xhs-column"/g), 2);
    assert.match(list, /class="pm-scene-float is-center"><button type="button" class="pm-scene-fab is-halo" data-action="open-compose" aria-label="发布笔记"/);
    const filtered = render(scene, { tag: '穿搭' });
    assert.equal(count(filtered, /class="pm-scene-xhs-card"/g), 1, '筛选只留下该话题');
    const note = render(scene, { postId: 'p1' });
    assert.match(note, /placeholder="说点什么…"[\s\S]*data-action="reply-owner"/);
    assert.match(note, /data-action="share"[^>]*aria-label="收藏/);
    assert.doesNotMatch(note, /pm-scene-fab/, '笔记页不出现「+」');
    assert.match(note, /data-action="close-thread"/);
});

check('吱乎：首页「提问」、问题页回答折叠与「写回答」，提问不算回答', () => {
    const long = '谢邀。'.repeat(60);
    const scene = mkScene('zhihu', [
        mkPost('ask', { question: '夜班是什么体验？', content: '想换工作', ask: true }),
        mkPost('a1', { question: '夜班是什么体验？', content: long, authorBio: '店员' }),
    ]);
    const home = render(scene);
    assert.match(home, /class="pm-scene-zhihu-head"><span>1个问题<\/span><button type="button" class="pm-scene-pill" data-action="open-compose">提问<\/button>/);
    assert.match(home, /data-action="open-question" data-question="夜班是什么体验？"/);
    const page = render(scene, { question: '夜班是什么体验？' });
    assert.match(page, /<span>1个回答<\/span>/, '提问那条不算回答');
    assert.match(page, /想换工作/, '补充说明显示在问题下');
    assert.match(page, /pm-scene-zhihu-bio">店员/);
    assert.match(page, /class="pm-scene-zhihu-body"/, '默认折叠');
    assert.match(page, />阅读全文</);
    assert.match(page, /class="pm-scene-dock-button" data-action="open-compose">[\s\S]*?写回答/);
    assert.match(page, /data-action="close-question"/);
    assert.match(render(scene, { question: '夜班是什么体验？', open: ['a1'] }), /pm-scene-zhihu-body is-open/);
    const sheet = render(scene, { question: '夜班是什么体验？', compose: true });
    assert.match(sheet, /<b>写回答<\/b>[\s\S]*?回答问题<\/small>夜班是什么体验？/);
    assert.match(render(scene, { compose: true }), /<b>提问<\/b>[\s\S]*?id="pm-scene-post-input" class="pm-scene-sheet-input is-title" maxlength="50"/);
});

check('今日猴条：栏目胶囊、要闻卡、列表面板、「突发」红标签、没有发布入口', () => {
    const scene = mkScene('news', [
        mkPost('n1', { title: '地铁停运', column: '突发', createdAt: at + 2 }), mkPost('n2', { title: '初雪', column: '本地', createdAt: at + 1 }), mkPost('n3', { title: '涨价', column: '本地', createdAt: at }),
    ]);
    const list = render(scene);
    assert.match(list, /class="pm-scene-news-lead" data-entry-id="n1"/, '最新一条是要闻卡');
    assert.match(list, /pm-scene-news-tag is-breaking">突发/);
    assert.equal(count(list, /class="pm-scene-news-row"/g), 2);
    assert.doesNotMatch(list, /data-action="open-compose"|pm-scene-fab|pm-scene-dock/, '没有发布入口');
    const filtered = render(scene, { tag: '本地' });
    assert.match(filtered, /class="pm-scene-news-lead" data-entry-id="n2"/, '栏目筛选后要闻卡换成该栏目最新一条');
    const article = render(scene, { postId: 'n1' });
    assert.match(article, /placeholder="说说你的看法…"/);
    assert.match(article, />网友评论 0</);
    assert.doesNotMatch(render(scene, { compose: true }), /pm-scene-sheet/, '即使 compose 被置位也不出编辑页之外的东西');
});

check('正文注入：四个平台的帖子都写成可读行', () => {
    const source = platform => renderCommunitySource({ type: 'community', scene: mkScene(platform, [mkPost('p1', {
        likers: ['林晚'], place: '东区', audience: 'private', title: '标题', tags: ['探店'], question: '问？', authorBio: '店员', column: '突发',
        comments: [{ id: 'c1', authorId: 'b', authorNameSnapshot: '乙', content: '评论', createdAt: at }],
    })]), actors: {} });
    assert.match(source('moments'), /【社区·朋友圈：社区】[\s\S]*甲：第一句话。第二句（东区，仅自己可见）\n {2}点赞：林晚\n {2}乙：评论/);
    assert.match(source('xhs'), /【标题】甲：第一句话。第二句 #探店/);
    assert.match(source('zhihu'), /问：问？｜答主 甲（店员）：/);
    assert.match(source('news'), /\[突发\]【标题】甲：/);
});

check('样式：四个平台亮暗点缀色成对，「突发」红亮暗成对，自选主题色时浅底跟随', () => {
    const css = readFileSync(new URL('../styles/community.css', import.meta.url), 'utf8');
    for (const platform of B2) {
        assert.match(css, new RegExp(`\\[data-community-platform="${platform}"\\]\\{--pm-community-accent:#[0-9a-f]{6};--pm-community-accent-soft:#[0-9a-f]{6};\\}`));
        assert.match(css, new RegExp(`#pm-iphone\\[data-theme="dark"\\] \\[data-community-platform="${platform}"\\]\\{--pm-community-accent:#[0-9a-f]{6};--pm-community-accent-soft:#[0-9a-f]{6};\\}`));
    }
    assert.match(css, /--pm-community-breaking:#b8392f;--pm-community-breaking-soft:#fbe4e1;/);
    assert.match(css, /#pm-iphone\[data-theme="dark"\] \.pm-scene-shell\{--pm-scene-headline-size:20px;|#pm-iphone\[data-theme="dark"\] \.pm-scene-shell\{--pm-community-breaking:#ef8b84;/);
    assert.match(css, /\[data-community-platform\]\[style\*="--pm-community-accent"\]/);
    const b2 = css.slice(css.indexOf('/*B2：'));
    assert.doesNotMatch(b2, /rgba?\(|border:\s*[1-9]|border-(?:left|right|top|bottom):\s*[1-9]/, 'B2 区块不加描边、不用半透明色');
    assert.doesNotMatch(b2, /--pm-color-fill\)/, 'B2 区块不用灰色当块底色');
});

console.log(`B2 feed checks passed (${checks}).`);
