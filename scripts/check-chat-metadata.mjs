// 阻止的故障：手机记录换设备/清浏览器数据后丢失，或切换聊天、分支、对账时用旧副本覆盖新记录。
// 影响：用户聊天记录丢失或串到别的聊天。现有检查只覆盖 IndexedDB，不覆盖 chatMetadata 副本。
// 删除条件：放弃 chatMetadata 副本时随模块一起删除。
import assert from 'node:assert/strict';
import {
    CHAT_METADATA_KEY, CHAT_METADATA_STAMP_KEY, buildChatMetadataPayload, createChatMetadataSync,
    decideChatMetadataSync, mergeTruncatedHistories, readChatMetadataPayload,
} from '../src/chat-metadata-sync.js';
import {
    applyFloorRollback, createRollbackRecord, floorMarkFor, normalizeRollbackFloors, pruneRollbackList,
} from '../src/phone-floor-rollback.js';

const memoryStorage = () => {
    const map = new Map();
    return {
        getItem: key => (map.has(key) ? map.get(key) : null),
        setItem: (key, value) => map.set(key, String(value)),
        removeItem: key => map.delete(key),
        map,
    };
};

function harness({ storageId = 'sms_a__chat1', metadata = {}, histories = {}, groupMeta = {}, loaded = true } = {}) {
    globalThis.window = { __pmHistories: histories, __pmGroupMeta: groupMeta };
    const host = { storageId, metadata, debounced: 0, immediate: 0, savedHistories: 0, savedGroupMeta: 0 };
    let clock = 1000;
    const storage = memoryStorage();
    const sync = createChatMetadataSync({
        getCtx: () => ({
            chat: host.chat,
            chatMetadata: host.metadata,
            saveMetadataDebounced: () => { host.debounced += 1; },
            saveMetadata: async () => { host.immediate += 1; },
        }),
        getStorageId: () => host.storageId,
        ensureHistoriesLoaded: async () => loaded,
        awaitBranch: async () => {},
        saveHistories: async () => { host.savedHistories += 1; },
        saveGroupMeta: async () => { host.savedGroupMeta += 1; },
        loadGroupMeta: async () => window.__pmGroupMeta,
        storage,
        now: () => clock,
        limit: 3,
    });
    return { host, sync, storage, tick: (value = 1) => { clock += value; return clock; } };
}

const msg = id => ({ role: 'user', content: id, messageId: id, bubbles: [] });
const remotePayload = (storageId, histories, updatedAt, groupMeta = {}) => ({
    [CHAT_METADATA_KEY]: { version: 1, storageId, updatedAt, histories, groupMeta },
});

// 结构校验：坏数据按「元数据为空」处理。
assert.equal(readChatMetadataPayload({ [CHAT_METADATA_KEY]: { version: 2, updatedAt: 1, histories: {} } }), null);
assert.equal(readChatMetadataPayload({ [CHAT_METADATA_KEY]: { version: 1, histories: {} } }), null);
assert.deepEqual(readChatMetadataPayload(remotePayload('s', { A: [msg('1'), 'bad'] }, 5)).histories, { A: [msg('1')] });

// 每个联系人只留最近 limit 条。
assert.deepEqual(buildChatMetadataPayload({
    storageId: 's', histories: { A: [msg('1'), msg('2'), msg('3'), msg('4')] }, updatedAt: 1, limit: 3,
}).histories.A.map(m => m.messageId), ['2', '3', '4']);

// 截断接回：只在元数据满 limit 条且能对上首条时接。
assert.deepEqual(
    mergeTruncatedHistories({ A: [msg('1'), msg('2'), msg('3'), msg('4')] }, { A: [msg('2'), msg('3'), msg('5')] }, 3).A
        .map(m => m.messageId), ['1', '2', '3', '5'],
);
assert.deepEqual(mergeTruncatedHistories({ A: [msg('1'), msg('2')] }, { A: [msg('2')] }, 3).A.map(m => m.messageId), ['2']);

// 新的为准，整份替换。
assert.equal(decideChatMetadataSync({ remote: null, hasLocal: false }), 'none');
assert.equal(decideChatMetadataSync({ remote: null, hasLocal: true }), 'push');
assert.equal(decideChatMetadataSync({ remote: { updatedAt: 5, histories: {} }, hasLocal: false }), 'adopt');
assert.equal(decideChatMetadataSync({ remote: { updatedAt: 5, histories: {} }, hasLocal: true, localStamp: 9, localFingerprint: 'x' }), 'push');
assert.equal(decideChatMetadataSync({ remote: { updatedAt: 9, histories: {} }, hasLocal: true, localStamp: 5, localFingerprint: 'x' }), 'adopt');

// 清过浏览器数据：本地为空，从元数据找回并写回 IndexedDB，不立即重写元数据。
{
    const { host, sync, storage } = harness({ metadata: remotePayload('sms_a__chat1', { 小雪: [msg('1')] }, 500) });
    assert.equal(await sync.reconcile(), 'adopt');
    assert.deepEqual(window.__pmHistories.sms_a__chat1.小雪.map(m => m.messageId), ['1']);
    assert.equal(host.savedHistories, 1);
    assert.equal(host.debounced + host.immediate, 0);
    assert.equal(JSON.parse(storage.getItem(CHAT_METADATA_STAMP_KEY)).sms_a__chat1, 500);
    // 对账写回 IndexedDB 后的通知不算本地改动。
    assert.equal(sync.noteLocalChange(), false);
}

// 旧数据迁移：元数据为空、本地有记录，立即写入元数据。
{
    const { host, sync } = harness({ histories: { sms_a__chat1: { 小雪: [msg('1')] } } });
    assert.equal(await sync.reconcile(), 'push');
    assert.equal(host.immediate, 1);
    assert.deepEqual(host.metadata[CHAT_METADATA_KEY].histories.小雪.map(m => m.messageId), ['1']);
}

// 发消息：只有当前聊天的数组引用变了才写元数据，走酒馆防抖。
{
    const histories = { sms_a__chat1: { 小雪: [msg('1')] }, sms_b__other: { 阿青: [msg('x')] } };
    const { host, sync, tick } = harness({ histories, metadata: remotePayload('sms_a__chat1', { 小雪: [msg('1')] }, 1000) });
    assert.equal(await sync.reconcile(), 'same');
    window.__pmHistories.sms_b__other = { 阿青: [msg('x'), msg('y')] };
    assert.equal(sync.noteLocalChange(), false, '别的聊天变化不写当前元数据');
    tick();
    window.__pmHistories.sms_a__chat1.小雪 = [msg('1'), msg('2')];
    assert.equal(sync.noteLocalChange(), true);
    assert.equal(host.debounced, 1);
    assert.equal(host.metadata[CHAT_METADATA_KEY].updatedAt, 1001);
    assert.deepEqual(host.metadata[CHAT_METADATA_KEY].histories.小雪.map(m => m.messageId), ['1', '2']);
    // 挂起时立即补写一次待保存的元数据。
    assert.equal(sync.flush(), true);
    assert.equal(host.immediate, 1);
    // 删除联系人同样同步。
    delete window.__pmHistories.sms_a__chat1.小雪;
    assert.equal(sync.noteLocalChange(), true);
    assert.deepEqual(host.metadata[CHAT_METADATA_KEY].histories, {});
}

// 切到别的聊天后不往新聊天的元数据里写旧聊天的记录。
{
    const { host, sync } = harness({ histories: { sms_a__chat1: { 小雪: [msg('1')] } } });
    await sync.reconcile();
    host.storageId = 'sms_a__chat2';
    host.metadata = {};
    window.__pmHistories.sms_a__chat1.小雪 = [msg('1'), msg('2')];
    assert.equal(sync.noteLocalChange(), false);
    assert.deepEqual(host.metadata, {});
}

// 本地更新（切换前最后一秒没写进元数据）：下次打开时本地为准，写回元数据。
{
    const { host, sync, storage } = harness({
        histories: { sms_a__chat1: { 小雪: [msg('1'), msg('2')] } },
        metadata: remotePayload('sms_a__chat1', { 小雪: [msg('1')] }, 500),
    });
    storage.setItem(CHAT_METADATA_STAMP_KEY, JSON.stringify({ sms_a__chat1: 900 }));
    assert.equal(await sync.reconcile(), 'push');
    assert.equal(host.debounced, 1);
    assert.equal(host.metadata[CHAT_METADATA_KEY].updatedAt, 900);
}

// 另一台设备更新过：元数据新，以元数据为准。
{
    const { sync, storage } = harness({
        histories: { sms_a__chat1: { 小雪: [msg('1')] } },
        metadata: remotePayload('sms_a__chat1', { 小雪: [msg('1'), msg('3')] }, 2000, { __group_x: { name: '群' } }),
    });
    storage.setItem(CHAT_METADATA_STAMP_KEY, JSON.stringify({ sms_a__chat1: 900 }));
    assert.equal(await sync.reconcile(), 'adopt');
    assert.deepEqual(window.__pmHistories.sms_a__chat1.小雪.map(m => m.messageId), ['1', '3']);
    assert.deepEqual(window.__pmGroupMeta.sms_a__chat1, { __group_x: { name: '群' } });
}

// 分支：元数据来自父聊天，本地（新 storageId）为空时采用并改记为本聊天。
{
    const { host, sync } = harness({ storageId: 'sms_a__branch', metadata: remotePayload('sms_a__chat1', { 小雪: [msg('1')] }, 500) });
    assert.equal(await sync.reconcile(), 'adopt');
    assert.equal(host.metadata[CHAT_METADATA_KEY].storageId, 'sms_a__branch');
}

// 备份导入后本地为准。
{
    const { sync, storage, tick } = harness({
        histories: { sms_a__chat1: { 小雪: [msg('restored')] } },
        metadata: remotePayload('sms_a__chat1', { 小雪: [msg('old')] }, 1500),
    });
    tick(1000);
    sync.markLocalAuthoritative(['sms_a__chat1']);
    assert.equal(JSON.parse(storage.getItem(CHAT_METADATA_STAMP_KEY)).sms_a__chat1, 2000);
    assert.equal(await sync.reconcile(), 'push');
}

// IndexedDB 读失败时不对账，免得用空内存覆盖本地。
{
    const { host, sync } = harness({ loaded: false, metadata: remotePayload('sms_a__chat1', { 小雪: [msg('1')] }, 500) });
    assert.equal(await sync.reconcile(), 'skipped');
    assert.equal(host.savedHistories, 0);
    assert.equal(await sync.reconcile({ historiesLoaded: false }), 'skipped');
}

// 没有打开聊天（欢迎页）时不写。
{
    const { sync } = harness({ storageId: 'sms_unknown__default' });
    assert.equal(await sync.reconcile(), 'skipped');
    assert.equal(sync.flush(), false);
}

// ---- 删楼回退 ----
const floorMsg = (id, chat) => ({ ...msg(id), ...floorMarkFor(chat) });
const mainMsg = (i, isUser = i % 2 === 0) => ({ is_user: isUser, name: isUser ? '我' : '小雪', send_date: `2026-10-30T10:00:${String(i).padStart(2, '0')}.000Z` });
const mainChat = n => Array.from({ length: n }, (_, i) => mainMsg(i));
const ids = list => list.map(m => m.messageId);

{
    const chat = mainChat(12);
    const at10 = chat.slice(0, 10);
    const history = [floorMsg('a', chat.slice(0, 4)), floorMsg('b', at10), floorMsg('c', chat.slice(0, 11)), floorMsg('d', chat)];
    // 删回第 10 楼：第 11、12 楼之后发的 c、d 撤回。
    let result = applyFloorRollback({ histories: { 小雪: history }, rollback: [], chat: at10 });
    assert.deepEqual(ids(result.histories.小雪), ['a', 'b']);
    // 中间删了第 2 楼：锚点前移，消息保留并改楼层。
    const middle = [...chat.slice(0, 1), ...chat.slice(2)];
    result = applyFloorRollback({ histories: { 小雪: history }, rollback: [], chat: middle });
    assert.deepEqual(ids(result.histories.小雪), ['a', 'b', 'c', 'd']);
    assert.equal(result.histories.小雪[1].floor, 9);
    // 最后一楼滑动换了回复：不当作删楼。
    const swiped = [...chat.slice(0, 11), { ...chat[11], send_date: '2026-10-30T11:00:00.000Z' }];
    result = applyFloorRollback({ histories: { 小雪: history }, rollback: [], chat: swiped });
    assert.deepEqual(ids(result.histories.小雪), ['a', 'b', 'c', 'd']);
    // 主线没变化：不替换数组。
    result = applyFloorRollback({ histories: { 小雪: history }, rollback: [], chat });
    assert.equal(result.histories.小雪, history);
    assert.deepEqual(result.changedKeys, []);
    // 旧消息（无楼层标记）始终保留。
    result = applyFloorRollback({ histories: { 小雪: [msg('legacy')] }, rollback: [], chat: chat.slice(0, 1) });
    assert.deepEqual(ids(result.histories.小雪), ['legacy']);
}

{
    // 第 10 楼时有 a b c；第 11 楼编辑 b、删 c；第 12 楼发 d。删回第 10 楼 → a b(原文) c。
    const chat = mainChat(12);
    const at10 = chat.slice(0, 10), at11 = chat.slice(0, 11);
    const a = floorMsg('a', at10), b = { ...floorMsg('b', at10), content: '原文' }, c = floorMsg('c', at10);
    const bEdited = { ...b, content: '改过' };
    const rollback = [
        createRollbackRecord({ saveKey: '小雪', op: 'edit', entry: b, chat: at11, seq: 1 }),
        createRollbackRecord({ saveKey: '小雪', op: 'remove', entry: c, afterId: 'b', index: 2, chat: at11, seq: 2 }),
    ];
    const history = [a, bEdited, floorMsg('d', chat)];
    const result = applyFloorRollback({ histories: { 小雪: history }, rollback, chat: at10 });
    assert.deepEqual(ids(result.histories.小雪), ['a', 'b', 'c']);
    assert.equal(result.histories.小雪[1].content, '原文');
    assert.deepEqual(result.rollback, []);
    // 只删回第 11 楼：那一层的改动保留，旧版本仍在。
    const partial = applyFloorRollback({ histories: { 小雪: history }, rollback, chat: at11 });
    assert.deepEqual(ids(partial.histories.小雪), ['a', 'b']);
    assert.equal(partial.histories.小雪[1].content, '改过');
    assert.equal(partial.rollback.length, 2);
}

{
    // 批量删除连续两条（从后往前记），回退时按原顺序插回。
    const chat = mainChat(6);
    const at4 = chat.slice(0, 4), at5 = chat.slice(0, 5);
    const [a, b, c, d] = ['a', 'b', 'c', 'd'].map(id => floorMsg(id, at4));
    const rollback = [
        createRollbackRecord({ saveKey: 'K', op: 'remove', entry: c, afterId: 'b', index: 2, chat: at5, seq: 1 }),
        createRollbackRecord({ saveKey: 'K', op: 'remove', entry: b, afterId: 'a', index: 1, chat: at5, seq: 2 }),
    ];
    const result = applyFloorRollback({ histories: { K: [a, d] }, rollback, chat: at4 });
    assert.deepEqual(ids(result.histories.K), ['a', 'b', 'c', 'd']);
}

{
    // 保留层数与体积封顶。
    const chat = mainChat(40);
    const records = Array.from({ length: 40 }, (_, i) => createRollbackRecord({
        saveKey: 'K', op: 'edit', entry: msg(`m${i}`), chat: chat.slice(0, i + 1), seq: i + 1,
    }));
    assert.equal(pruneRollbackList(records, 40, 10).length, 10);
    assert.equal(pruneRollbackList(records, 40, 0).length, 0);
    const big = records.map(item => ({ ...item, entry: { ...item.entry, content: 'x'.repeat(5000) } }));
    const capped = pruneRollbackList(big, 40, 30);
    assert.ok(capped.length < 30 && capped.at(-1).seq === 40, '超体积时先丢最早的');
    assert.equal(normalizeRollbackFloors('abc'), 30);
    assert.equal(normalizeRollbackFloors(999), 200);
    assert.equal(normalizeRollbackFloors(-3), 0);
}

{
    // 控制器：编辑记旧版本→随元数据保存→主线删楼→恢复原文，并写回元数据。
    const chat = mainChat(4);
    const at3 = chat.slice(0, 3);
    const original = { ...floorMsg('b', at3), content: '原文' };
    const { host, sync } = harness({ histories: { sms_a__chat1: { 小雪: [original] } } });
    host.chat = chat;
    await sync.reconcile();
    assert.equal(sync.recordPhoneChange([{ saveKey: '小雪', op: 'edit', entry: original }]), true);
    window.__pmHistories.sms_a__chat1.小雪 = [{ ...original, content: '改过' }];
    sync.noteLocalChange();
    assert.equal(host.metadata[CHAT_METADATA_KEY].rollback.length, 1);
    host.chat = at3;
    let changed = null;
    assert.deepEqual(await sync.applyFloorRollback({ onChanged: keys => { changed = keys; } }), ['小雪']);
    assert.deepEqual(changed, ['小雪']);
    assert.equal(window.__pmHistories.sms_a__chat1.小雪[0].content, '原文');
    sync.noteLocalChange();
    assert.equal(host.metadata[CHAT_METADATA_KEY].rollback.length, 0);
    // 主线为空（切换途中）时不回退。
    host.chat = [];
    assert.deepEqual(await sync.applyFloorRollback(), []);
}

{
    // 刷新后旧版本从元数据恢复；分支到更早楼层时对账即回退。
    const chat = mainChat(6);
    const at4 = chat.slice(0, 4);
    const histories = { 小雪: [floorMsg('a', at4), floorMsg('late', chat)] };
    const { host, sync } = harness({
        storageId: 'sms_a__branch',
        metadata: remotePayload('sms_a__chat1', histories, 500),
    });
    host.chat = at4;
    assert.equal(await sync.reconcile(), 'adopt');
    assert.deepEqual(ids(window.__pmHistories.sms_a__branch.小雪), ['a']);
}

console.log('Chat metadata sync verified.');
