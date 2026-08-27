import assert from 'node:assert/strict';
import { appendStoryOracleTurn, createEmptyStoryOracleStore, storyOracleMessages } from '../src/story-oracle-model.js';
import { loadStoryOracleStore, saveStoryOracleStore, STORY_ORACLE_FALLBACK_KEY } from '../src/story-oracle-storage.js';

let store = createEmptyStoryOracleStore();
store = appendStoryOracleTurn(store, 'chat-a', 'q1', 'a1', 'question');
store = appendStoryOracleTurn(store, 'chat-a', 'q2', 'a2', 'advisor');
store = appendStoryOracleTurn(store, 'chat-b', 'q3', 'a3', 'question');
assert.equal(storyOracleMessages(store, 'chat-a', 'question').length, 2);
assert.equal(storyOracleMessages(store, 'chat-a', 'advisor').length, 2);
assert.equal(storyOracleMessages(store, 'chat-b', 'question').length, 2);

const empty = await loadStoryOracleStore({ idbRead: async () => ({ ok: true, value: undefined }), storage: { getItem: () => null } });
assert.equal(empty.writable, true, '首次空存储必须可写');
const fallbackData = JSON.stringify({ version: 1, scopes: { 'chat-a': { modes: { question: [{ role: 'user', content: '保留' }] } } } });
const fallbackStorage = { getItem: key => key === STORY_ORACLE_FALLBACK_KEY ? fallbackData : null, setItem: () => assert.fail('只读恢复不得写入'), removeItem: () => assert.fail('只读恢复不得删除后备数据') };
const recovered = await loadStoryOracleStore({ idbRead: async () => ({ ok: true, value: { broken: true } }), storage: fallbackStorage });
assert.equal(recovered.writable, false);
assert.ok(recovered.readOnlyReason);
let blocked = false;
try { await saveStoryOracleStore(recovered.store, { readOnlyReason: recovered.readOnlyReason, idbSet: async () => assert.fail('只读保存不得调用 IDB'), storage: fallbackStorage }); } catch (error) { blocked = true; }
assert.equal(blocked, true, '只读状态必须拒绝保存');

let missingHandleBlocked = false;
try { await saveStoryOracleStore(store, { idbSet: async () => assert.fail('无句柄保存不得调用 IDB') }); } catch (error) { missingHandleBlocked = true; }
assert.equal(missingHandleBlocked, true, '无写入句柄必须拒绝保存');

let active = true;
let writes = 0;
const stale = saveStoryOracleStore(store, { writeHandle: empty.writeHandle, idbSet: async () => { writes += 1; return true; }, shouldWrite: () => active });
active = false;
assert.equal(await stale, false, '失效写入不得进入存储操作');
assert.equal(writes, 0);

const context = { chat: [{ mes: 'dragon' }], chatMetadata: { world_info: 'Book' }, characterId: 'c', characters: { c: { avatar: 'c' } }, loadWorldInfo: async () => ({ entries: { one: { uid: 1, content: 'dragon fact', constant: true, comment: 'Lore' }, two: { uid: 2, content: 'hidden', disable: true, comment: 'Disabled' } } }) };

let failedOnce = true;
let recoveryWrites = 0;
await assert.rejects(
    saveStoryOracleStore(store, { writeHandle: empty.writeHandle, idbSet: async () => {
        if (failedOnce) { failedOnce = false; throw new Error('injected save failure'); }
        recoveryWrites += 1;
        return true;
    } }),
    /均不可用/,
);
assert.equal(await saveStoryOracleStore(store, { writeHandle: empty.writeHandle, idbSet: async () => { recoveryWrites += 1; return true; } }), true, '保存失败后队列必须继续可用');
assert.equal(recoveryWrites, 1);

console.log('Story Oracle checks passed.');
