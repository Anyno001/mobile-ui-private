import assert from 'node:assert/strict';
import { appendStoryOracleTurn, buildStoryOraclePlanInjection, clearStoryOraclePlans, clearStoryOracleScope, createEmptyStoryOracleStore, parseStoryPlans, setStoryOraclePlanEnabled, setStoryOracleWorldBookSelection, storyOracleMessages, storyOraclePlans, storyOracleWorldBookSelection } from '../src/story-oracle-model.js';
import { loadStoryOracleStore, saveStoryOracleStore, STORY_ORACLE_FALLBACK_KEY } from '../src/story-oracle-storage.js';

let store = createEmptyStoryOracleStore();
store = appendStoryOracleTurn(store, 'chat-a', 'q1', 'a1', 'question');
store = appendStoryOracleTurn(store, 'chat-a', 'q2', 'a2', 'advisor');
store = appendStoryOracleTurn(store, 'chat-b', 'q3', 'a3', 'question');
assert.equal(storyOracleMessages(store, 'chat-a', 'question').length, 2);
assert.equal(storyOracleMessages(store, 'chat-a', 'advisor').length, 2);
assert.equal(storyOracleMessages(store, 'chat-b', 'question').length, 2);


const parsedPlans = parseStoryPlans('<StoryPlan>\n标题：河岸调查\n目标：查清失踪船队\n起始迹象：码头有异常货单\n契合点：当前冲突正在扩大\n</StoryPlan><StoryPlan>\n标题：城内追查\n目标：追踪伪造军报\n</StoryPlan>');
assert.equal(parsedPlans.invalid, false);
assert.equal(parsedPlans.plans.length, 2);
assert.equal(parseStoryPlans('<StoryPlan>目标：未闭合').invalid, true);
assert.equal(parseStoryPlans('<StoryPlan>标题：缺目标</StoryPlan>').invalid, true);

let planStore = appendStoryOracleTurn(createEmptyStoryOracleStore(), 'route-chat', '提出方案', '<StoryPlan>标题：河岸调查\n目标：查清失踪船队\n起始迹象：码头有异常货单\n</StoryPlan><StoryPlan>标题：城内追查\n目标：追踪伪造军报\n</StoryPlan>', 'advisor', { selectionKey: 'Book-A' });
assert.equal(storyOraclePlans(planStore, 'route-chat').length, 2);
planStore = setStoryOracleWorldBookSelection(planStore, 'route-chat', ['Book-A', 'Book-B']);
const selectedBooks = storyOracleWorldBookSelection(planStore, 'route-chat', ['Book-A']);
assert.deepEqual(selectedBooks.books, ['Book-A']);
assert.equal(selectedBooks.scopeKey, 'Book-A\u0000Book-B');
assert.equal(typeof selectedBooks.updatedAt, 'number');
const firstPlan = storyOraclePlans(planStore, 'route-chat')[0];
planStore = setStoryOraclePlanEnabled(planStore, 'route-chat', firstPlan.id, true);
assert.equal(storyOraclePlans(planStore, 'route-chat').filter(plan => plan.enabled).length, 1);
assert.match(buildStoryOraclePlanInjection(storyOraclePlans(planStore, 'route-chat')).content, /查清失踪船队/);
assert.match(buildStoryOraclePlanInjection(storyOraclePlans(planStore, 'route-chat'), { maxChars: 1 }).rejected, /预算/);
assert.throws(() => setStoryOraclePlanEnabled(planStore, 'route-chat', 'missing-plan', true), /不存在/);
planStore = clearStoryOraclePlans(planStore, 'route-chat');
assert.deepEqual(storyOraclePlans(planStore, 'route-chat'), []);
planStore = appendStoryOracleTurn(planStore, 'route-chat', '问题', '回答', 'question');
planStore = clearStoryOracleScope(planStore, 'route-chat', 'question');
assert.deepEqual(storyOracleMessages(planStore, 'route-chat', 'question'), []);

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
