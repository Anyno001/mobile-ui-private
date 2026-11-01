// 与 gal 前端（IGS）联动：正文聊天 → 手机私聊/群聊的定向检查（接IGS聊天计划 §4）。
import assert from 'node:assert/strict';
import {
    applyIgsChatSync, chatFloorHashes, chatMessageText, indexChatFloors, normalizeChatFloors, resolveIgsChats, routeChatBlock, summarizeChats,
} from '../src/igs-chat-core.js';
import { IGS_LINK_STORAGE_KEY, normalizeIgsLinkConfig } from '../src/igs-feed-core.js';
import { installIgsFeedSync } from '../src/igs-feed-sync.js';
import { messageFingerprint, resolveFloorMark, chatFingerprints } from '../src/phone-floor-rollback.js';
import { resolvePhoneSources } from '../src/permissions.js';
import { createEmptyInteractiveScope } from '../src/interactive-scene-model.js';

let checks = 0;
const check = (name, run) => { try { run(); } catch (error) { error.message = `${name}：${error.message}`; throw error; } checks += 1; };
const checkAsync = async (name, run) => { try { await run(); } catch (error) { error.message = `${name}：${error.message}`; throw error; } checks += 1; };

// 桩：楼层正文里 `[igs-msg:` 之后跟一段 JSON（块数组），collect 原样解析。真实解析由 IGS 负责，这里只测天音这一侧。
const floorText = (blocks, lead = '正文') => `${lead}[igs-msg:${JSON.stringify(blocks)}]`;
const collectOf = info => {
    const start = info.text.indexOf('[igs-msg:');
    return start < 0 ? [] : JSON.parse(info.text.slice(start + 9, info.text.lastIndexOf(']')));
};
const msg = (sender, text, type = '', system = false) => ({ kind: 'msg', sender, text, type, system });
const block = (index, title, messages) => ({ index, title, messages });
let sendSeq = 0;
const ai = text => ({ is_user: false, mes: text, name: 'AI', send_date: `t${(sendSeq += 1)}` });
const user = text => ({ is_user: true, mes: text, name: '我', send_date: `t${(sendSeq += 1)}` });
const selfNames = new Set(['我', '{{user}}', '<user>', '小明']);
let groupSeq = 0;
const run = (scope, chat, extra = {}) => {
    const floors = indexChatFloors(chat);
    return applyIgsChatSync(scope, { floors, window: floors, collect: collectOf, selfNames, now: 1000, createGroupKey: () => `__group_t${(groupSeq += 1)}`, ...extra });
};
const emptyScope = () => ({ histories: {}, groups: {} });

check('私聊：对方一人落到与他的私聊，User 发的为 user；楼层标记记来源楼', () => {
    const chat = [user('开场'), ai(floorText([block(0, '', [msg('小雪', '在吗'), msg('小明', '在'), msg('小雪', '晚上见')])]))];
    const scope = emptyScope();
    const result = run(scope, chat);
    assert.equal(result.added, 3);
    assert.deepEqual(result.createdContacts, ['小雪']);
    const history = scope.histories['小雪'];
    assert.deepEqual(history.map(entry => [entry.role, entry.content]), [['assistant', '在吗'], ['user', '在'], ['assistant', '晚上见']]);
    assert.equal(history[0].floor, 2);
    assert.equal(history[0].floorAnchor, messageFingerprint(chat[1]));
    assert.equal(history[0].source.type, 'igs');
    assert.ok(history[0].sentAt < history[1].sentAt && history[1].sentAt < history[2].sentAt);
    // 删楼回退把它当成来源楼之后发的：来源楼还在就保留，删掉就去掉。
    assert.equal(resolveFloorMark(history[0], chatFingerprints(chat)).keep, true);
    assert.equal(resolveFloorMark(history[0], chatFingerprints(chat.slice(0, 1))).keep, false);
});

check('群聊：两个以上对方发送者新建群，群名取标题，成员齐全，消息写成「发送者：内容」', () => {
    const chat = [ai(floorText([block(0, '宿舍群', [msg('阿花', '吃饭吗'), msg('阿草', '走'), msg('我', '等我')])]))];
    const scope = emptyScope();
    const result = run(scope, chat);
    assert.equal(result.createdGroups.length, 1);
    const key = result.createdGroups[0];
    assert.deepEqual(scope.groups[key], { name: '宿舍群', members: ['阿花', '阿草'] });
    const history = scope.histories[key];
    assert.deepEqual(history.map(entry => entry.content), ['阿花：吃饭吗', '阿草：走', '等我']);
    assert.equal(history[0].bubbles[0].sender, '阿花');
    assert.equal(history[2].role, 'user');
});

check('标题与已有群同名：落进那个群，新发言人补进成员', () => {
    const scope = { histories: { __group_old: [] }, groups: { __group_old: { name: '宿舍群', members: ['阿花', '阿草'] } } };
    const chat = [ai(floorText([block(0, '宿舍群', [msg('阿叶', '我也来')])]))];
    const result = run(scope, chat);
    assert.deepEqual(result.createdGroups, []);
    assert.deepEqual(scope.groups.__group_old.members, ['阿花', '阿草', '阿叶']);
    assert.equal(scope.histories.__group_old[0].bubbles[0].sender, '阿叶');
});

check('标题空、这一楼群里只有一人说话：延续上一块的群，不分进私聊', () => {
    const chat = [
        ai(floorText([block(0, '宿舍群', [msg('阿花', '一'), msg('阿草', '二')])])),
        ai(floorText([block(0, '', [msg('阿花', '三')])])),
    ];
    const scope = emptyScope();
    const result = run(scope, chat);
    assert.equal(result.createdContacts.length, 0);
    const key = result.createdGroups[0];
    assert.deepEqual(scope.histories[key].map(entry => entry.content), ['阿花：一', '阿草：二', '阿花：三']);
});

check('已有联系人按名字认（不计括号、大小写）；关掉自动新建时不建', () => {
    const scope = { histories: { Alice: [] }, groups: {} };
    run(scope, [ai(floorText([block(0, '', [msg('【alice】', 'hi')])]))]);
    assert.equal(scope.histories.Alice.length, 1);
    const off = emptyScope();
    const result = run(off, [ai(floorText([block(0, '', [msg('陌生人', '你好')])]))], { autoCreate: false });
    assert.equal(result.added, 0);
    assert.deepEqual(Object.keys(off.histories), []);
});

check('系统角色、输入中、撤回跳过；图片/语音/红包拼成天音格式；全是系统角色的块跳过', () => {
    assert.equal(chatMessageText(msg('a', '一张猫', 'image')), '（图片：一张猫）');
    assert.equal(chatMessageText(msg('a', '早点睡', '语音')), '（语音：早点睡）');
    assert.equal(chatMessageText(msg('a', '200', '红包')), '（转账：200）');
    assert.equal(chatMessageText(msg('a', '', 'typing')), '');
    assert.equal(chatMessageText(msg('a', '刚才那句', 'recall')), '');
    assert.equal(chatMessageText(msg('a', '普通', 'sticker')), '普通');
    const scope = emptyScope();
    const chat = [ai(floorText([
        block(0, '', [msg('系统', '已添加好友', '', true)]),
        block(1, '', [msg('小雪', '', 'typing'), msg('小雪', '猫', 'photo'), msg('系统', '对方已读', '', true)]),
    ]))];
    run(scope, chat);
    assert.deepEqual(Object.keys(scope.histories), ['小雪']);
    assert.deepEqual(scope.histories['小雪'].map(entry => entry.content), ['（图片：猫）']);
});

check('User 不在场的聊天照样导入：两人对话落成群聊，消息都是 assistant', () => {
    const scope = emptyScope();
    run(scope, [ai(floorText([block(0, '', [msg('阿花', '他没发现吧'), msg('阿草', '没有')])]))]);
    const [key] = Object.keys(scope.groups);
    assert.equal(scope.groups[key].name, '阿花、阿草');
    assert.ok(scope.histories[key].every(entry => entry.role === 'assistant'));
});

check('去重：同一楼再跑一遍不重复；楼里块以外的文字没变就一条不动', () => {
    const scope = emptyScope();
    const chat = [ai(floorText([block(0, '', [msg('小雪', '在吗')])]))];
    run(scope, chat);
    const again = run(scope, chat);
    assert.equal(again.added, 0);
    assert.equal(again.touched.size, 0);
    assert.equal(scope.histories['小雪'].length, 1);
});

check('改楼/重新生成：旧原文的导入消息没改过的删掉、改过的保留，新原文导入', () => {
    const scope = emptyScope();
    const chat = [ai(floorText([block(0, '', [msg('小雪', '甲'), msg('小雪', '乙')])]))];
    run(scope, chat);
    scope.histories['小雪'][1].content = '乙（我改过）';
    chat[0] = { ...chat[0], mes: floorText([block(0, '', [msg('小雪', '丙')])]), send_date: 'swiped' };
    const result = run(scope, chat);
    assert.equal(result.removed, 1);
    // 同一楼内按块内序号排：新原文的第 1 条排在旧原文第 2 条（用户改过、留下的）前面。
    assert.deepEqual(scope.histories['小雪'].map(entry => entry.content), ['丙', '乙（我改过）']);
});

check('隐藏的楼（/hide）不算删掉：导入的消息保留；主线没有聊天楼时不删', () => {
    const scope = emptyScope();
    const chat = [ai(floorText([block(0, '', [msg('小雪', '在吗')])]))];
    run(scope, chat);
    chat[0] = { ...chat[0], is_system: true };
    const hidden = indexChatFloors(chat);
    const result = applyIgsChatSync(scope, { floors: hidden, liveHashes: chatFloorHashes(chat), window: hidden, collect: collectOf, selfNames, createGroupKey: () => '__group_h' });
    assert.equal(result.removed, 0);
    assert.equal(scope.histories['小雪'].length, 1);
    const empty = applyIgsChatSync(scope, { floors: [], liveHashes: new Set(), window: [], collect: collectOf, selfNames, createGroupKey: () => '__group_e' });
    assert.equal(empty.removed, 0);
    assert.equal(scope.histories['小雪'].length, 1);
});

check('User 名超过 20 字：仍认作 User，不把私聊判成群聊', () => {
    const longName = 'Alexander the Great of Macedon';
    const names = new Set([...selfNames, longName.toLowerCase()]);
    const scope = emptyScope();
    const floors = indexChatFloors([ai(floorText([block(0, '', [msg(longName, '你好'), msg('小红', '嗨')])]))]);
    const result = applyIgsChatSync(scope, { floors, window: floors, collect: collectOf, selfNames: names, createGroupKey: () => '__group_l' });
    assert.deepEqual(result.createdGroups, []);
    assert.deepEqual(scope.histories['小红'].map(entry => entry.role), ['user', 'assistant']);
});

check('发送者叫 __proto__ 一类的名字：跳过，不计入导入', () => {
    const scope = emptyScope();
    const result = run(scope, [ai(floorText([block(0, '', [msg('__proto__', '怪名字')])]))]);
    assert.equal(result.added, 0);
    assert.equal(Object.hasOwn(scope.histories, '__proto__'), false);
});

check('不原地改：传入的会话数组与群对象冻结后照样能导入、补成员、删旧消息', () => {
    const chat = [ai(floorText([block(0, '宿舍群', [msg('阿叶', '新人')])])), ai(floorText([block(0, '', [msg('小雪', '在吗')])]))];
    const scope = emptyScope();
    run(scope, [chat[1]]);
    const oldFloor = indexChatFloors([chat[1]])[0];
    const imported = scope.histories['小雪'];
    scope.groups.__group_old = Object.freeze({ name: '宿舍群', members: Object.freeze(['阿花', '阿草']) });
    scope.histories.__group_old = Object.freeze([]);
    Object.freeze(imported);
    imported.forEach(entry => Object.freeze(entry));
    chat[1] = { ...chat[1], mes: floorText([block(0, '', [msg('小雪', '换了')])]), send_date: 'new' };
    const result = run(scope, chat);
    assert.deepEqual(scope.groups.__group_old.members, ['阿花', '阿草', '阿叶']);
    assert.ok(result.changedGroups.has('__group_old'));
    assert.deepEqual(scope.histories['小雪'].map(entry => entry.content), ['换了']);
    assert.notEqual(scope.histories['小雪'], imported);
    assert.equal(imported.length, 1);
    assert.ok(oldFloor);
});

check('插入位置：导入的旧楼消息排在之后楼层才发的手机消息前面', () => {
    const chat = [ai(floorText([block(0, '', [msg('小雪', '旧楼')])])), user('x'), ai('y')];
    const scope = { histories: { 小雪: [{ role: 'user', content: '后来手机里发的', messageId: 'm1', bubbles: [], floor: 3, floorAnchor: '', sentAt: 5000 }] }, groups: {} };
    run(scope, chat);
    assert.deepEqual(scope.histories['小雪'].map(entry => entry.content), ['旧楼', '后来手机里发的']);
    assert.ok(scope.histories['小雪'][0].sentAt < 5000);
});

check('adding 只放行本轮的楼：其余楼只参与会话判定，不写入', () => {
    const chat = [
        ai(floorText([block(0, '宿舍群', [msg('阿花', '一'), msg('阿草', '二')])])),
        ai(floorText([block(0, '', [msg('阿花', '三')])])),
    ];
    const floors = indexChatFloors(chat);
    const scope = emptyScope();
    const result = applyIgsChatSync(scope, { floors, window: floors, collect: collectOf, selfNames, adding: new Set([floors[1].hash]), createGroupKey: () => '__group_x' });
    // 上一楼不写入，但会话判定照走：本楼标题空的单人块延续到上一楼的群，群在这时才建。
    assert.equal(result.added, 1);
    assert.deepEqual(scope.groups.__group_x, { name: '宿舍群', members: ['阿花', '阿草'] });
    assert.deepEqual(scope.histories.__group_x.map(entry => entry.content), ['阿花：三']);
    assert.equal(scope.histories['阿花'], undefined);
});

check('剧情时间：能读出日期的写进之后消息的 storyDate', () => {
    const scope = emptyScope();
    run(scope, [ai(floorText([block(0, '', [{ kind: 'time', text: '2025年3月7日 晚上' }, msg('小雪', '睡了吗')])]))]);
    assert.equal(scope.histories['小雪'][0].storyDate, '2025-03-07');
});

check('路由：标题同名群优先于发言人数；全是 User 自己的块跳过', () => {
    const groups = { __group_a: { name: '工作群', members: ['老板', '同事'] } };
    assert.deepEqual(routeChatBlock(block(0, '工作群', [msg('老板', '开会')]), { histories: {}, groups, selfNames }), { key: '__group_a', isGroup: true });
    assert.equal(routeChatBlock(block(0, '', [msg('我', '自言自语')]), { histories: {}, groups, selfNames }), null);
});

check('旁白把聊天拆开：只有 User 的块跟同楼后面的会话走，不丢', () => {
    const scope = emptyScope();
    const chat = [ai(floorText([block(0, '', [msg('小雪', '在吗')]), block(1, '', [msg('小明', '在')]), block(2, '', [msg('小雪', '晚上见')])]))];
    const result = run(scope, chat);
    assert.equal(result.added, 3);
    assert.deepEqual(scope.histories['小雪'].map(entry => [entry.role, entry.content]), [['assistant', '在吗'], ['user', '在'], ['assistant', '晚上见']]);
    const leading = emptyScope();
    run(leading, [ai(floorText([block(0, '', [msg('小明', '到了吗')]), block(1, '', [msg('小雪', '马上')])]))]);
    assert.deepEqual(leading.histories['小雪'].map(entry => entry.role), ['user', 'assistant']);
});

check('只有 User 的块在楼尾或下一楼开头：跟上一块的会话走；之前没有会话就跳过', () => {
    const scope = emptyScope();
    const chat = [ai(floorText([block(0, '', [msg('小雪', '在吗')])])), user('x'), ai(floorText([block(0, '', [msg('小明', '刚到')])]))];
    run(scope, chat);
    assert.deepEqual(scope.histories['小雪'].map(entry => [entry.role, entry.content]), [['assistant', '在吗'], ['user', '刚到']]);
    const lone = emptyScope();
    assert.equal(run(lone, [ai(floorText([block(0, '', [msg('我', '自言自语')])]))]).added, 0);
});

check('设置与接口探测：默认值、层数封顶、旧版 IGS 不认', () => {
    const config = normalizeIgsLinkConfig(null);
    assert.deepEqual([config.syncChats, config.autoCreateContacts, config.chatFloors], [true, true, 20]);
    assert.equal(normalizeIgsLinkConfig({ chatFloors: 999 }).chatFloors, 200);
    assert.equal(normalizeChatFloors(-3), 0);
    assert.equal(resolveIgsChats({ IGS: { api: { feeds: {} } } }), null);
    assert.equal(resolveIgsChats({ IGS: { api: { chats: { version: 0, collect() {} } } } }), null);
    assert.ok(resolveIgsChats({ IGS: { api: { chats: { version: 1, collect() {} } } } }));
    assert.equal(summarizeChats({ status: 'ok', added: 2, removed: 0, createdContacts: 1, createdGroups: 0 }), '聊天 2 条，新联系人 1 个');
    assert.match(summarizeChats({ status: 'deferred' }), /稍后同步/);
    assert.equal(summarizeChats(null), '');
});

check('双向注入：导入的消息在快照里带 imported 标记', () => {
    const result = resolvePhoneSources({
        currentStorageId: 'sid', currentActorName: '小雪', selectedByStorage: { sid: ['小雪'] },
        historiesByStorage: { sid: { 小雪: [{ role: 'assistant', content: '导入的', source: { type: 'igs', key: 'k' } }, { role: 'user', content: '自己发的' }] } },
        groupsByStorage: {},
    });
    assert.equal(result.allowed, true);
    assert.deepEqual(result.sources[0].history.map(entry => entry.imported === true), [true, false]);
});

// ===== 运行时：igs-feed-sync 把聊天交给 deps.syncChats =====
function makeRuntime({ config = {}, chat = [], syncChatsResult = null, syncChats = null, igs = { api: { feeds: { version: 1, collectPosts: () => [], parseExtra: () => ({}) } } } } = {}) {
    const storage = new Map([[IGS_LINK_STORAGE_KEY, JSON.stringify({ enabled: true, autoSync: true, ...config })]]);
    const storageApi = { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) };
    const calls = { chats: [], loadStore: 0, shop: 0 };
    const state = { store: { version: 3, scopes: {} } };
    const deps = {
        getCtx: () => ({ chat, name1: '小明' }),
        getStorageId: () => 'sid',
        loadStore: async () => { calls.loadStore += 1; return state.store; },
        getStore: () => state.store,
        commit: async mutator => { await mutator(); },
        actorSeeds: () => ({ story: { type: 'story', displayName: '小雪' }, user: { type: 'user', displayName: '我' } }),
        contextText: async () => ({}), callAI: async () => '', uid: prefix => `${prefix}_1`,
        createEmptyScope: createEmptyInteractiveScope, isGenerationBusy: () => false,
        refreshOpenScene() {}, refreshLauncher() {}, refreshDesktop() {},
        syncShop: async () => { calls.shop += 1; return null; },
        syncChats: syncChats || (async (storageId, options) => { calls.chats.push({ storageId, ...options }); return syncChatsResult || { status: 'ok', added: 1, removed: 0, createdContacts: 0, createdGroups: 0 }; }),
    };
    const link = installIgsFeedSync(deps, { globalObject: { IGS: igs }, storage: storageApi });
    return { link, calls, storage };
}
const settle = async () => { for (let index = 0; index < 20; index += 1) await new Promise(resolve => setImmediate(resolve)); };

await checkAsync('消息事件：带上楼层与配置调用 syncChats，结果写进状态', async () => {
    const { link, calls } = makeRuntime();
    link.observe('MESSAGE_RECEIVED', 3);
    await settle();
    assert.equal(calls.chats.length, 1);
    assert.equal(calls.chats[0].storageId, 'sid');
    assert.equal(calls.chats[0].userName, '小明');
    assert.deepEqual(calls.chats[0].selfNames, ['我']);
    assert.ok(calls.chats[0].plan.floors.has(3));
    assert.equal(calls.chats[0].plan.manual, false);
    assert.equal(calls.chats[0].config.chatFloors, 20);
    assert.match(link.getStatus().lastResult, /聊天 1 条/);
});

await checkAsync('手动导入：plan.manual 为真（聊天走全部楼层）', async () => {
    const { link, calls } = makeRuntime();
    await link.importNow();
    assert.equal(calls.chats.at(-1).plan.manual, true);
    assert.equal(calls.chats.at(-1).plan.full, true);
});

await checkAsync('关掉「同步聊天」：不调用 syncChats', async () => {
    const { link, calls } = makeRuntime({ config: { syncChats: false } });
    link.observe('MESSAGE_RECEIVED', 0);
    await settle();
    assert.equal(calls.chats.length, 0);
});

await checkAsync('打开「同步聊天」或调大层数：只补聊天，不重跑社区与桃宝', async () => {
    const { link, calls } = makeRuntime({ config: { syncChats: false } });
    assert.equal(link.setConfig({ syncChats: true }), true);
    await settle();
    assert.equal(calls.chats.length, 1);
    assert.equal(calls.chats[0].plan.chatsOnly, true);
    assert.deepEqual([calls.loadStore, calls.shop], [0, 0]);
    link.setConfig({ chatFloors: 50 });
    await settle();
    assert.equal(calls.chats.length, 2);
    link.setConfig({ chatFloors: 10 });
    await settle();
    assert.equal(calls.chats.length, 2);
});

await checkAsync('IGS 没有聊天接口：状态记为版本过旧，社区照常同步', async () => {
    const { link, calls } = makeRuntime({ syncChatsResult: { status: 'outdated' } });
    link.observe('MESSAGE_RECEIVED', 0);
    await settle();
    assert.equal(link.getStatus().chatApi, 'outdated');
    assert.ok(calls.loadStore >= 1);
});

await checkAsync('聊天同步抛错：只记一条，不挡社区同步；下一轮成功后清掉', async () => {
    let fail = true;
    const { link, calls } = makeRuntime({ syncChats: async () => { if (fail) throw new Error('存储满了'); return { status: 'ok', added: 0, removed: 0, createdContacts: 0, createdGroups: 0 }; } });
    link.observe('MESSAGE_RECEIVED', 0);
    await settle();
    assert.match(link.getStatus().lastError, /^聊天同步失败/);
    assert.ok(calls.loadStore >= 1);
    fail = false;
    link.observe('MESSAGE_RECEIVED', 1);
    await settle();
    assert.equal(link.getStatus().lastError, '');
});

console.log(`IGS chat sync checks passed (${checks}).`);
