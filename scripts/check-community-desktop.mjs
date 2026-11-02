import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { renderPhoneDesktop } from '../src/interactive-scene-views.js';
import { normalizePhoneUiState, PHONE_UI_STATE_VERSION, toggleScenePin, pinnedSceneIdsOf } from '../src/interactive-scene-model.js';
import { buildDesktopPins, storageSourceLabel } from '../src/interactive-scene-global-pins.js';
import { renderCommunitySource } from '../src/community-injection.js';
import { LIVE_APP_ICON_SVG, LIVE_ICON_SVG } from '../src/icons.js';

let count = 0;
const check = (name, fn) => { fn(); count += 1; };
const NOW = Date.UTC(2026, 6, 15, 12, 0, 0);
const ago = minutes => NOW - minutes * 60000;
const render = (scenes = {}, pinned = [], templates = []) => renderPhoneDesktop({ scenes }, { pinnedSceneIds: pinned }, templates, { now: NOW });
const scene = (id, title, extra = {}) => ({ id, title, platform: 'weibo', posts: [], ...extra });

// 1. 桌面网格
check('没有「发布一条」浮条，社区与直播是普通图标', () => {
    const html = render();
    assert.doesNotMatch(html, /pm-desktop-community-dock|发布一条/);
    assert.match(html, /data-app="community" data-action="desktop-community" aria-label="社区"/);
    assert.match(html, /data-app="live" data-action="desktop-live" aria-label="噼哩噼哩"/);
    assert.match(html, /<span class="pm-desktop-app-label">社区<\/span>/, '社区图标仍叫「社区」，它是各个社区的容器');
    assert.match(html, /<span class="pm-desktop-app-label">噼哩噼哩<\/span>/, '直播图标改名「噼哩噼哩」');
    assert.doesNotMatch(html, /pm-desktop-app-label">直播</);
});
check('网格顺序：会话、联系人、日历、今日风向、社区、直播、剧情助手、设置', () => {
    const order = [...render().matchAll(/class="pm-desktop-app" data-app="([\w-]+)"/g)].map(match => match[1]);
    assert.deepEqual(order.slice(0, 8), ['chat', 'directory', 'calendar', 'today-trend', 'community', 'live', 'story-oracle', 'settings']);
    assert.equal(order[8], 'gallery', '相册规格未列出，排在规格列出的八个之后');
    assert.deepEqual(order.slice(9), order.slice(9).filter(app => ['shop', 'origin', 'greenlin'].includes(app)), '之后只追加新的独立 App（桃宝、金手指、格林推演）');
    assert.equal(new Set(order).size, order.length, '桌面图标不重复');
});
check('桌面图标统一纯线条：直播图标不填色', () => {
    assert.doesNotMatch(LIVE_APP_ICON_SVG, /fill="currentColor"/);
    assert.doesNotMatch(LIVE_ICON_SVG, /<rect[^>]*fill="currentColor"/, '描边版保持原样');
    assert.doesNotMatch(render(), /data-app="live"[^<]*<span[^>]*>[\s\S]*?<rect[^>]*fill="currentColor"/);
});

// 2. 小组件
check('没有固定社区也没有模板时不渲染小组件', () => {
    assert.doesNotMatch(render(), /pm-desktop-pins/);
    assert.doesNotMatch(render({ a: scene('a', '社区甲') }, []), /pm-desktop-pins/);
    assert.doesNotMatch(render({}, ['gone']), /pm-desktop-pins/, '固定的社区已被删除时视为没有');
});
check('固定社区行：点缀色、名称、相对时间、移除', () => {
    const html = render({ a: scene('a', '雨城热搜', { themeAccent: '#123abc', posts: [{ id: 'p', createdAt: ago(5), comments: [] }] }) }, ['a']);
    assert.match(html, /<h3>固定社区<\/h3>/);
    assert.match(html, /data-community-platform="weibo" style="--pm-community-accent:#123abc"/, '自选主题色优先，写入社区点缀色变量');
    assert.doesNotMatch(html, /--scene-accent/, '旧变量 --scene-accent 已清除');
    assert.match(html, /data-action="desktop-open-scene" data-scene-id="a"/);
    assert.match(html, /<b>雨城热搜<\/b><span class="pm-desktop-pin-status">5分钟前更新<\/span>/);
    assert.match(html, /data-action="unpin-scene" data-scene-id="a" aria-label="移除 雨城热搜 快捷方式">移除<\/button>/);
});
check('平台默认点缀色、评论时间参与最近更新、没有帖子写「还很安静」', () => {
    const html = render({
        a: scene('a', '书房', { platform: 'review', posts: [{ id: 'p', createdAt: ago(300), comments: [{ id: 'c', createdAt: ago(20) }] }] }),
        b: scene('b', '空社区', { platform: 'night' }),
    }, ['a', 'b']);
    assert.match(html, /class="pm-desktop-pin" data-community-platform="review"><button/, '没有自选色时只带平台标记，点缀色由样式表按平台取值');
    assert.match(html, /class="pm-desktop-pin" data-community-platform="night"><button/);
    assert.doesNotMatch(html, /style="--pm-community-accent/, '没有自选色时不内联写入点缀色');
    assert.match(html, /<b>书房<\/b><span class="pm-desktop-pin-status">20分钟前更新<\/span>/, '评论比帖子新时取评论时间');
    assert.match(html, /<b>空社区<\/b><span class="pm-desktop-pin-status">还很安静<\/span>/);
});
check('时间戳不可用但有帖子时写「已有内容」', () => {
    assert.match(render({ a: scene('a', '旧档', { posts: [{ id: 'p', createdAt: 1, comments: [] }] }) }, ['a']), /已有内容/);
});
check('默认 3 行，其余折成「还有 N 个」，点开在桌面展开全部', () => {
    const scenes = Object.fromEntries(['a', 'b', 'c', 'd', 'e'].map(id => [id, scene(id, `社区${id}`)]));
    const html = render(scenes, ['a', 'b', 'c', 'd', 'e']);
    assert.equal((html.match(/data-action="unpin-scene"/g) || []).length, 3);
    assert.match(html, /<button type="button" class="pm-desktop-pin-more" data-action="desktop-toggle-pins" aria-expanded="false">还有 2 个<\/button>/);
    const expanded = renderPhoneDesktop({ scenes: Object.fromEntries(['a', 'b', 'c', 'd', 'e'].map(id => [id, scene(id, `社区${id}`)])) }, { pinnedSceneIds: ['a', 'b', 'c', 'd', 'e'] }, [], { now: NOW, pinsExpanded: true });
    assert.equal((expanded.match(/data-action="desktop-open-scene"/g) || []).length, 5, '展开后列出全部固定社区');
    assert.match(expanded, /data-action="desktop-toggle-pins" aria-expanded="true">收起<\/button>/);
    assert.doesNotMatch(html, /社区d|社区e/);
    const three = render(Object.fromEntries(['a', 'b', 'c'].map(id => [id, scene(id, `社区${id}`)])), ['a', 'b', 'c']);
    assert.doesNotMatch(three, /pm-desktop-pin-more|还有/);
});
check('共享模板单独成组，行内有导入与移除，标题转义', () => {
    const html = render({ a: scene('a', '本地') }, ['a'], [{ id: 'tpl', title: '共享 < 社区', platform: 'night', themeAccent: '' }]);
    assert.match(html, /<h3>固定社区<\/h3>[\s\S]*<h3>可导入的模板<\/h3>/);
    assert.match(html, /<b>共享 &lt; 社区<\/b>/);
    assert.match(html, /data-action="desktop-import-community-template" data-template-id="tpl"[^>]*>导入<\/button>/);
    assert.match(html, /data-action="dismiss-community-template" data-template-id="tpl"[^>]*>移除<\/button>/);
    assert.match(html, /class="pm-desktop-pin pm-desktop-template" data-community-platform="night"><span/, '模板没有自选色时带平台标记，用平台默认色');
    const only = render({}, [], [{ id: 'tpl', title: '模板', platform: 'weibo' }]);
    assert.match(only, /<h3>可导入的模板<\/h3>/);
    assert.doesNotMatch(only, /<h3>固定社区<\/h3>/, '没有固定社区时不显示该组标题');
});
check('社区名与模板名中的标记被转义', () => {
    const html = render({ a: scene('a', '<img src=x onerror=alert(1)>') }, ['a']);
    assert.doesNotMatch(html, /<img src=x/);
    assert.match(html, /&lt;img src=x/);
});

// 3. 正文注入按平台渲染
const actors = { u1: { displayName: '路人甲' } };
const base = { type: 'community', actors, selection: { mode: 'all', postIds: [] } };
const post = (id, author, content, extra = {}) => ({ id, authorId: 'u1', authorNameSnapshot: author, content, comments: [], ...extra });
const cm = (id, author, content, extra = {}) => ({ id, authorId: 'u1', authorNameSnapshot: author, content, ...extra });
const lines = source => renderCommunitySource({ ...base, ...source }).split('\n');

check('weibo：标题行、热搜、转发、评论', () => {
    const out = lines({ scene: { title: '雨城热搜', platform: 'weibo', hot: [{ title: '词一', badge: '沸' }, { title: '词二', badge: '' }], posts: [
        post('p1', '苏小满', '今天的雨', { comments: [cm('c1', '阿禾', '前排')] }),
        post('p2', '吃瓜', '转发这条', { repost: { author: '雨城日报', content: '地铁停运' } }),
    ] } });
    assert.deepEqual(out, ['【社区·微博广场：雨城热搜】', '热搜：词一、词二', '苏小满：今天的雨', '  评论 阿禾：前排', '吃瓜：转发这条（转发 @雨城日报：地铁停运）']);
});
check('douban：【标题】作者：正文，楼层与回复', () => {
    const out = lines({ scene: { title: '租房组', platform: 'douban', posts: [
        post('p1', '失眠的鱼', '弹钢琴怎么办', { title: '隔壁每晚弹琴', comments: [cm('a', '阿禾', '去敲门'), cm('b', '不吃香菜', '找物业', { quoteId: 'a' }), cm('c', '鱼', '更新')] }),
        post('p2', '匿名', '没有标题的帖'),
    ] } });
    assert.deepEqual(out, ['【社区·小组论坛：租房组】', '【隔壁每晚弹琴】失眠的鱼：弹钢琴怎么办', '  2楼 阿禾：去敲门', '  3楼 不吃香菜（回复 阿禾）：找物业', '  4楼 鱼：更新', '匿名：没有标题的帖']);
});
check('review：《书名》作者 ★N｜书评标题｜作者：正文，短评带星级', () => {
    const out = lines({ scene: { title: '午夜书房', platform: 'review', posts: [
        post('p1', '林晚', '读到火场那一段', { work: '雪国', workAuthor: '川端康成', rating: 4, title: '不会落地的雪', comments: [cm('a', '阿禾', '很美', { rating: 5 }), cm('b', '丁', '一般')] }),
        post('p2', '小周', '随笔'),
    ] } });
    assert.deepEqual(out, ['【社区·书评：午夜书房】', '《雪国》川端康成 ★4｜不会落地的雪｜林晚：读到火场那一段', '  短评 阿禾 ★5：很美', '  短评 丁：一般', '小周：随笔']);
});
check('confess：[心情] 作者：正文', () => {
    const out = lines({ scene: { title: '树洞', platform: 'confess', posts: [
        post('p1', '一只猫', '他帮我撑伞', { mood: '心动', comments: [cm('a', '路人', '好甜')] }),
        post('p2', '匿名', '没有心情'),
    ] } });
    assert.deepEqual(out, ['【社区·树洞：树洞】', '[心动] 一只猫：他帮我撑伞', '  评论 路人：好甜', '匿名：没有心情']);
});
check('night：今夜信箱、写给、落款、回信缩进', () => {
    const out = lines({ scene: { title: '夜间来信', platform: 'night', tonight: { title: '写给一个你不该爱的人', openedAt: 1 }, posts: [
        post('p1', '雾', '我最难受的是阳台', { to: '家室里的他', sign: '雾里', comments: [cm('a', '迟归', '你值得更好')] }),
        post('p2', 'K', '没有收信人也没有落款'),
    ] } });
    assert.deepEqual(out, ['【社区·夜间来信：夜间来信】', '今夜信箱：写给一个你不该爱的人', '写给 家室里的他：我最难受的是阳台 —— 雾里', '  回信 迟归：你值得更好', '来信：没有收信人也没有落款 —— K']);
});
check('直播段按 kind 标注主播与礼物，普通弹幕不标', () => {
    const out = lines({
        scene: { title: '雨城热搜', platform: 'weibo', posts: [post('p1', '甲', '正文')] },
        liveRoom: { title: '深夜电台', danmaku: [
            { authorNameSnapshot: '阿夏', content: '晚上好', kind: 'host' }, { authorNameSnapshot: '甲', content: '前排', kind: 'chat' },
            { authorNameSnapshot: '乙', content: '送出一束花', kind: 'gift' }, { authorNameSnapshot: '丙', content: '没有 kind' },
        ] },
    });
    assert.deepEqual(out.slice(-5), ['【深夜电台】', '  [主播] 阿夏：晚上好', '  甲：前排', '  [礼物] 乙：送出一束花', '  丙：没有 kind']);
});
check('指定帖子只注入所选，热搜随场景保留；全未选中且无直播时为空', () => {
    const scene = { title: '雨城', platform: 'weibo', hot: [{ title: '词', badge: '' }], posts: [post('p1', '甲', '第一条'), post('p2', '乙', '第二条')] };
    const picked = renderCommunitySource({ ...base, scene, selection: { mode: 'selected', postIds: ['p2'] } });
    assert.match(picked, /乙：第二条/);
    assert.doesNotMatch(picked, /第一条/);
    assert.match(picked, /热搜：词/);
    assert.equal(renderCommunitySource({ ...base, scene, selection: { mode: 'selected', postIds: [] } }), '', '只剩热搜时不输出空壳');
});
check('截断：正文 4000、评论 1000、弹幕 200，不拆开代理对', () => {
    const out = renderCommunitySource({ ...base,
        scene: { title: 't', platform: 'weibo', posts: [post('p', '甲', `${'a'.repeat(3999)}😀😀`, { comments: [cm('c', '乙', `${'b'.repeat(999)}😀😀`)] })] },
        liveRoom: { title: 'l', danmaku: [{ authorNameSnapshot: '丙', content: `${'m'.repeat(199)}😀😀` }] } });
    for (const line of out.split('\n')) assert.equal(/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/.test(line), false);
    assert.ok(out.includes(`${'a'.repeat(3999)}😀\n`));
    assert.ok(out.includes(`${'b'.repeat(999)}😀\n`));
});
check('未知平台与缺少平台回落到小组论坛，空场景返回空串', () => {
    assert.match(renderCommunitySource({ ...base, scene: { title: '旧社区', preset: 'book', posts: [post('p', '甲', '正文')] } }), /^【社区·书评：旧社区】/);
    assert.match(renderCommunitySource({ ...base, scene: { title: '无平台', posts: [post('p', '甲', '正文')] } }), /^【社区·小组论坛：无平台】/);
    assert.equal(renderCommunitySource({ ...base, scene: { title: '空', platform: 'weibo', posts: [] } }), '');
    assert.equal(renderCommunitySource(null), '');
});

check('固定社区：数据里没有这个聊天时保留固定项，有这个聊天但社区已删才清掉', () => {
    const raw = { version: PHONE_UI_STATE_VERSION, scopes: { chatA: { pinnedSceneIds: ['scene_a'] }, chatB: { pinnedSceneIds: ['scene_b', 'scene_gone'] } } };
    const store = { version: 3, scopes: { chatB: { scenes: { scene_b: scene('scene_b', 'B') } } } };
    const state = normalizePhoneUiState(raw, store);
    assert.deepEqual(state.globalPins, [{ storageId: 'chatA', sceneId: 'scene_a' }, { storageId: 'chatB', sceneId: 'scene_b' }]);
    assert.equal(state.scopes.chatA.pinnedSceneIds, undefined, '旧的按聊天固定项迁入全局后不再保留');
});
check('全局固定：迁移保持顺序去重，已有全局项在前；二次规范化不变', () => {
    const store = { version: 3, scopes: { chatA: { scenes: { a1: scene('a1', 'A1'), a2: scene('a2', 'A2') } }, chatB: { scenes: { b1: scene('b1', 'B1') } } } };
    const raw = { version: PHONE_UI_STATE_VERSION, globalPins: [{ storageId: 'chatB', sceneId: 'b1' }, { storageId: 'chatB', sceneId: 'b1' }, { storageId: 'chatA', sceneId: 'gone' }],
        scopes: { chatA: { pinnedSceneIds: ['a2', 'a1', 'a2'] }, chatB: { pinnedSceneIds: ['b1'] } } };
    const state = normalizePhoneUiState(raw, store);
    assert.deepEqual(state.globalPins, [{ storageId: 'chatB', sceneId: 'b1' }, { storageId: 'chatA', sceneId: 'a2' }, { storageId: 'chatA', sceneId: 'a1' }]);
    assert.deepEqual(normalizePhoneUiState(state, store), state);
    assert.deepEqual(pinnedSceneIdsOf(state, 'chatA'), ['a2', 'a1']);
});
check('全局固定：在任意聊天里切换都改同一份列表，社区被删后清掉', () => {
    const store = { version: 3, scopes: { chatA: { scenes: { a1: scene('a1', 'A1') } }, chatB: { scenes: { b1: scene('b1', 'B1') } } } };
    let state = normalizePhoneUiState({ version: PHONE_UI_STATE_VERSION, scopes: {} }, store);
    state = toggleScenePin(state, 'chatA', 'a1', store);
    state = toggleScenePin(state, 'chatB', 'b1', store);
    assert.deepEqual(state.globalPins, [{ storageId: 'chatA', sceneId: 'a1' }, { storageId: 'chatB', sceneId: 'b1' }]);
    state = toggleScenePin(state, 'chatA', 'a1', store);
    assert.deepEqual(state.globalPins, [{ storageId: 'chatB', sceneId: 'b1' }]);
    const deleted = { version: 3, scopes: { chatA: { scenes: {} }, chatB: store.scopes.chatB } };
    state = toggleScenePin(state, 'chatA', 'a1', store);
    assert.deepEqual(normalizePhoneUiState(state, deleted).globalPins, [{ storageId: 'chatB', sceneId: 'b1' }]);
});
check('桌面：别的聊天固定的社区也显示，带来源名与 storage 标识；自己的不带', () => {
    const store = { version: 3, scopes: {
        'sms_cur.png__c1': { scenes: { own: scene('own', '本聊社区') } },
        'sms_other.png__c2': { scenes: { far: scene('far', '外聊社区') } },
    } };
    const state = { version: PHONE_UI_STATE_VERSION, scopes: {}, globalPins: [
        { storageId: 'sms_other.png__c2', sceneId: 'far' }, { storageId: 'sms_cur.png__c1', sceneId: 'own' }, { storageId: 'sms_other.png__c2', sceneId: 'gone' }] };
    const characters = [{ name: '小林', avatar: 'cur.png' }, { name: '阿远', avatar: 'other.png' }];
    const pins = buildDesktopPins({ store, phoneUiState: state, currentStorageId: 'sms_cur.png__c1', characters });
    assert.deepEqual(pins.map(pin => pin.scene.id), ['far', 'own'], '按固定先后排列，找不到的不显示');
    const html = renderPhoneDesktop({ scenes: store.scopes['sms_cur.png__c1'].scenes }, { desktopPins: pins }, [], { now: NOW });
    assert.match(html, /data-scene-id="far" data-storage-id="sms_other.png__c2"/);
    assert.match(html, /pm-desktop-pin-status">阿远 · /);
    assert.match(html, /data-action="unpin-scene" data-scene-id="far" data-storage-id="sms_other.png__c2"/);
    assert.doesNotMatch(html, /data-scene-id="own" data-storage-id/);
    assert.equal(storageSourceLabel('sms_unknown.png__c', characters), '', '取不到来源名时不显示');
    assert.equal(storageSourceLabel('sms_other.png__c2', { 0: characters[1] }), '阿远');
});
check('固定社区：写入前重读浏览器存储，不拿本窗口旧缓存覆盖', () => {
    const code = readFileSync(new URL('../src/interactive-scenes.js', import.meta.url), 'utf8');
    assert.match(code, /latestPhoneUiState = store => \{ runtime\.phoneUiState = null;/);
    assert.match(code, /getStorageId: \(\) => runtime\.openSceneStorageId \|\| getStorageId\(\)/, '操作有效性要认当前打开社区所在的聊天');
    for (const call of ['patchPhoneUiScope', 'toggleScenePin', 'dismissCommunityTemplate', 'publishCommunityTemplate', 'unpublishCommunityTemplate']) {
        assert.ok(code.includes(`${call}(latestPhoneUiState(`), `${call} 要基于最新状态`);
    }
});

console.log(`community desktop checks passed (${count})`);
