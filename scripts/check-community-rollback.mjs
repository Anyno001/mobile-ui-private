// 社区与直播间的删楼回退（community-floor-rollback.js）定向检查：楼层标记、旧版本记录、回退、存取。
import assert from 'node:assert/strict';
import {
    applyCommunityFloorRollback, communityFloorMark, pruneCommunityRollback, setCommunityFloorProvider, withoutFloorMarks,
} from '../src/community-floor-rollback.js';
import {
    addSceneComment, appendLiveDanmaku, appendScenePosts, createEmptyInteractiveScope, createLiveRoom, deleteLiveDanmaku, deleteSceneComment,
    deleteScenePost, deleteSceneWork, normalizeInteractiveStore, normalizeScene, updateLiveDanmaku, updateSceneComment, updateScenePost,
} from '../src/interactive-scene-model.js';
import { INTERACTIVE_LIMITS } from '../src/interactive-scene-constants.js';
import { floorMarkFor } from '../src/phone-floor-rollback.js';
import { parseBackupData } from '../src/settings-backup-validate.js';

let checks = 0;
const pending = [];
const check = (name, run) => { try { const out = run(); if (out?.then) pending.push(out.catch(error => { error.message = `${name}：${error.message}`; throw error; })); } catch (error) { error.message = `${name}：${error.message}`; throw error; } checks += 1; };

let sendSeq = 0;
const ai = text => ({ is_user: false, mes: text, name: 'AI', send_date: `t${(sendSeq += 1)}` });
const user = text => ({ is_user: true, mes: text, name: '我', send_date: `t${(sendSeq += 1)}` });
let chat = [];
let limit = 30;
setCommunityFloorProvider(() => ({ ...floorMarkFor(chat), limit }));
const seeds = [{ type: 'story', displayName: '小雪', bindingKey: 'story' }, { type: 'user', displayName: '我', bindingKey: 'user' }];
const limits = INTERACTIVE_LIMITS;

function freshScope() {
    const scope = createEmptyInteractiveScope();
    const scene = normalizeScene({ id: 'scene_1', title: '测试', platform: 'weibo', preset: 'weibo', posts: [] }, { scope, scopeId: 'sid' });
    scope.scenes[scene.id] = scene;
    scope.sceneOrder = [scene.id];
    scope.activeSceneId = scene.id;
    return { scope, scene };
}
const post = (scope, scene, content) => appendScenePosts(scope, 'sid', scene, [{ author: '路人', content, tags: [], comments: [] }], seeds)[0];

check('新帖子、评论、弹幕带发出时的楼层标记；没有主线时不带', () => {
    chat = [user('a'), ai('b')];
    const { scope, scene } = freshScope();
    const created = post(scope, scene, '第一帖');
    assert.equal(created.floor, 2);
    assert.equal(created.floorAnchor, floorMarkFor(chat).floorAnchor);
    const comment = addSceneComment(scope, 'sid', scene, created.id, seeds[1], '沙发');
    assert.equal(comment.floor, 2);
    const room = createLiveRoom(scope, 'sid', { title: '直播', hostIsUser: false, hostNameSnapshot: '小雪' });
    const [danmaku] = appendLiveDanmaku(scope, 'sid', room, [{ author: '路人', content: '来了' }], seeds);
    assert.equal(danmaku.floor, 2);
    setCommunityFloorProvider(null);
    assert.deepEqual(communityFloorMark(), {});
    assert.equal(post(scope, scene, '无主线').floor, undefined);
    setCommunityFloorProvider(() => ({ ...floorMarkFor(chat), limit }));
});

check('正文同步来的帖子与自带回帖不记楼层', () => {
    chat = [ai('x')];
    const { scope, scene } = freshScope();
    const [synced] = appendScenePosts(scope, 'sid', scene, [{ author: '路人', content: '正文帖', tags: [], comments: [{ author: 'a', content: '回帖' }], source: { type: 'igs', floor: 0, key: 'igs:abc:0:def' } }], seeds);
    assert.equal(synced.floor, undefined);
    assert.equal(synced.comments[0].floor, undefined);
});

check('主线删回去：之后才发的帖子、评论、弹幕去掉，之前的保留', () => {
    chat = [user('a'), ai('b')];
    const { scope, scene } = freshScope();
    const early = post(scope, scene, '早帖');
    const room = createLiveRoom(scope, 'sid', { title: '直播', hostIsUser: false, hostNameSnapshot: '小雪' });
    appendLiveDanmaku(scope, 'sid', room, [{ author: '路人', content: '早弹幕' }], seeds);
    chat = [...chat, user('c'), ai('d')];
    post(scope, scene, '晚帖');
    addSceneComment(scope, 'sid', scene, early.id, seeds[1], '晚评论');
    appendLiveDanmaku(scope, 'sid', room, [{ author: '路人', content: '晚弹幕' }], seeds);
    chat = chat.slice(0, 2);
    const result = applyCommunityFloorRollback(scope, chat, { limits });
    assert.deepEqual(scene.posts.map(item => item.content), ['早帖']);
    assert.deepEqual(scene.posts[0].comments, []);
    assert.deepEqual(room.danmaku.map(item => item.content), ['早弹幕']);
    assert.deepEqual(result.scenes, ['scene_1']);
    assert.deepEqual(result.rooms, [room.id]);
    assert.equal(result.contentChanged, true);
});

check('保留层数内的编辑、删除可还原；删整本书按原顺序插回', () => {
    chat = [user('a'), ai('b')];
    const { scope, scene } = freshScope();
    const one = post(scope, scene, '一');
    post(scope, scene, '二');
    const three = post(scope, scene, '三');
    const comment = addSceneComment(scope, 'sid', scene, one.id, seeds[1], '原评论');
    scene.posts[0].work = '书'; scene.posts[1].work = '书';
    chat = [...chat, user('c'), ai('d')];
    updateScenePost(scene, three.id, '三（改）');
    updateSceneComment(scene, one.id, comment.id, '评论（改）');
    deleteSceneWork(scene, '书');
    assert.deepEqual(scene.posts.map(item => item.content), ['三（改）']);
    chat = chat.slice(0, 2);
    applyCommunityFloorRollback(scope, chat, { limits });
    assert.deepEqual(scene.posts.map(item => item.content), ['一', '二', '三']);
    assert.equal(scene.posts[0].comments[0].content, '原评论');
    assert.equal(scene.floorRollback, undefined);
});

check('删帖、删评论、改删弹幕可还原', () => {
    chat = [user('a'), ai('b')];
    const { scope, scene } = freshScope();
    const one = post(scope, scene, '一');
    const two = post(scope, scene, '二');
    const kept = addSceneComment(scope, 'sid', scene, two.id, seeds[1], '评');
    const room = createLiveRoom(scope, 'sid', { title: '直播', hostIsUser: false, hostNameSnapshot: '小雪' });
    const [d1, d2] = appendLiveDanmaku(scope, 'sid', room, [{ author: '甲', content: '弹一' }, { author: '乙', content: '弹二' }], seeds);
    chat = [...chat, ai('c')];
    deleteScenePost(scene, one.id);
    deleteSceneComment(scene, two.id, kept.id);
    updateLiveDanmaku(room, d2.id, '弹二（改）');
    deleteLiveDanmaku(room, d1.id);
    chat = chat.slice(0, 2);
    applyCommunityFloorRollback(scope, chat, { limits });
    assert.deepEqual(scene.posts.map(item => item.id), [one.id, two.id]);
    assert.equal(scene.posts[1].comments[0].content, '评');
    assert.deepEqual(room.danmaku.map(item => item.content), ['弹一', '弹二']);
});

check('重新生成（最后一楼换了）：本楼之后发的内容保留，只改记锚点；旧版本不撤销', () => {
    chat = [user('a'), ai('b')];
    const { scope, scene } = freshScope();
    const created = post(scope, scene, '帖');
    updateScenePost(scene, created.id, '帖（改）');
    chat = [chat[0], { ...chat[1], send_date: 'swiped' }];
    applyCommunityFloorRollback(scope, chat, { limits });
    assert.equal(scene.posts[0].content, '帖（改）');
    assert.equal(scene.posts[0].floorAnchor, floorMarkFor(chat).floorAnchor);
});

check('试跑（dryRun）：结果与真跑一致，社区与直播间一个字节都不变', () => {
    chat = [user('a'), ai('b')];
    const { scope, scene } = freshScope();
    const one = post(scope, scene, '一');
    const room = createLiveRoom(scope, 'sid', { title: '直播', hostIsUser: false, hostNameSnapshot: '小雪' });
    appendLiveDanmaku(scope, 'sid', room, [{ author: '甲', content: '弹' }], seeds);
    chat = [...chat, ai('c')];
    post(scope, scene, '晚帖');
    deleteScenePost(scene, one.id);
    appendLiveDanmaku(scope, 'sid', room, [{ author: '乙', content: '晚弹' }], seeds);
    const back = chat.slice(0, 2);
    const before = JSON.stringify(scope);
    const probe = applyCommunityFloorRollback(scope, back, { limits, dryRun: true });
    assert.equal(JSON.stringify(scope), before);
    const real = applyCommunityFloorRollback(scope, back, { limits });
    assert.deepEqual([probe.scenes, probe.rooms, probe.contentChanged], [real.scenes, real.rooms, real.contentChanged]);
    assert.deepEqual(scene.posts.map(item => item.content), ['一']);
});

check('保留层数：0 不记旧版本；超出层数的旧版本丢掉', () => {
    chat = [user('a'), ai('b')];
    const { scope, scene } = freshScope();
    const created = post(scope, scene, '帖');
    limit = 0;
    updateScenePost(scene, created.id, '改一');
    assert.equal(scene.floorRollback, undefined);
    limit = 30;
    const records = [{ seq: 1, floor: 1 }, { seq: 2, floor: 40 }];
    assert.deepEqual(pruneCommunityRollback(records, 45, 10).map(item => item.seq), [2]);
    assert.deepEqual(pruneCommunityRollback(records, 45, 0), []);
});

check('主线为空：不处理（切换聊天途中）', () => {
    chat = [user('a'), ai('b')];
    const { scope, scene } = freshScope();
    post(scope, scene, '帖');
    const result = applyCommunityFloorRollback(scope, [], { limits });
    assert.equal(scene.posts.length, 1);
    assert.deepEqual(result.scenes, []);
});

check('存取：楼层标记与旧版本经严格读入保留；坏的旧版本单条丢掉', () => {
    chat = [user('a'), ai('b')];
    const { scope, scene } = freshScope();
    const created = post(scope, scene, '帖');
    addSceneComment(scope, 'sid', scene, created.id, seeds[1], '评');
    const room = createLiveRoom(scope, 'sid', { title: '直播', hostIsUser: false, hostNameSnapshot: '小雪' });
    const [danmaku] = appendLiveDanmaku(scope, 'sid', room, [{ author: '甲', content: '弹' }], seeds);
    chat = [...chat, ai('c')];
    updateScenePost(scene, created.id, '帖（改）');
    deleteLiveDanmaku(room, danmaku.id);
    scene.floorRollback.push({ seq: 99, target: 'post', op: 'remove', floor: 3, floorAnchor: '', entry: { id: 'bad' } }, { seq: 100, target: 'nope', op: 'edit' });
    const store = normalizeInteractiveStore(JSON.parse(JSON.stringify({ version: 3, scopes: { sid: scope } })));
    const loaded = store.scopes.sid;
    assert.equal(loaded.scenes.scene_1.posts[0].floor, 2);
    assert.equal(loaded.scenes.scene_1.posts[0].comments[0].floor, 2);
    assert.deepEqual(loaded.scenes.scene_1.floorRollback.map(item => item.seq), [1]);
    assert.equal(loaded.liveRooms[room.id].floorRollback[0].entry.content, '弹');
    applyCommunityFloorRollback(loaded, chat.slice(0, 2), { limits });
    assert.equal(loaded.scenes.scene_1.posts[0].content, '帖');
    assert.equal(loaded.liveRooms[room.id].danmaku[0].content, '弹');
});

check('备份导出再导入：带楼层标记与旧版本的社区、直播间不被拒绝', () => {
    chat = [user('a'), ai('b')];
    const { scope, scene } = freshScope();
    const created = post(scope, scene, '帖');
    addSceneComment(scope, 'sid', scene, created.id, seeds[1], '评');
    const room = createLiveRoom(scope, 'sid', { title: '直播', hostIsUser: false, hostNameSnapshot: '小雪' });
    const [danmaku] = appendLiveDanmaku(scope, 'sid', room, [{ author: '甲', content: '弹' }], seeds);
    chat = [...chat, ai('c')];
    updateScenePost(scene, created.id, '帖（改）');
    deleteLiveDanmaku(room, danmaku.id);
    const store = normalizeInteractiveStore(JSON.parse(JSON.stringify({ version: 3, scopes: { sid: scope } })));
    const parsed = parseBackupData({ interactiveScenes: store }, { interactiveScenes: { version: 1, scopes: {} } }).interactiveScenes.scopes.sid;
    assert.equal(parsed.scenes.scene_1.posts[0].floor, 2);
    assert.equal(parsed.scenes.scene_1.floorRollback.length, 1);
    assert.equal(parsed.liveRooms[room.id].floorRollback.length, 1);
});

check('旧数据（没有楼层标记）回退时原样保留', () => {
    const { scope, scene } = freshScope();
    scene.posts.push({ id: 'old', content: '旧帖', comments: [{ id: 'oc', content: '旧评' }] });
    applyCommunityFloorRollback(scope, [user('a')], { limits });
    assert.equal(scene.posts[0].content, '旧帖');
    assert.equal(scene.posts[0].comments.length, 1);
});

check('别的聊天的社区里生成的内容不打楼层标记、不记旧版本，回到那个聊天回退时保留', async () => {
    chat = [user('a'), ai('b')];
    const { scope, scene } = freshScope();
    const early = post(scope, scene, '早帖');
    chat = [...chat, user('c'), ai('d')];
    let foreign;
    await withoutFloorMarks(() => {
        assert.deepEqual(communityFloorMark(), {}, '外聊写入时不带楼层');
        foreign = post(scope, scene, '在别的聊天里生成的帖子');
        const comment = addSceneComment(scope, 'sid', scene, early.id, seeds[1], '外聊评论');
        assert.equal(comment.floor, undefined);
        updateScenePost(scene, early.id, '外聊改过');
        assert.equal(scene.floorRollback, undefined, '外聊的编辑不记旧版本');
    });
    assert.equal(foreign.floor, undefined);
    assert.equal(communityFloorMark().floor, 4, '写完后恢复记楼层');
    chat = chat.slice(0, 2);
    applyCommunityFloorRollback(scope, chat, { limits });
    assert.deepEqual(scene.posts.map(item => item.content).sort(), ['外聊改过', '在别的聊天里生成的帖子'].sort(), '那个聊天回退时外聊内容不得被删');
    assert.equal(scene.posts.find(item => item.id === early.id).comments.length, 1);
});
await Promise.all(pending);
console.log(`Community floor rollback checks passed (${checks}).`);
