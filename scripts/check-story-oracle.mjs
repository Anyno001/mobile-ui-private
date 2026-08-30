import assert from 'node:assert/strict';
import { appendStoryOracleTurn, buildStoryOraclePlanInjection, clearStoryOraclePlans, clearStoryOracleScope, createEmptyStoryOracleStore, DEFAULT_STORY_ORACLE_SYSTEM_PROMPT, parseStoryPlans, parseUserGenerationResponse, resetStoryOraclePlanInjection, setStoryOraclePlanCustomInjection, setStoryOraclePlanEnabled, setStoryOraclePlanIntensity, setStoryOracleSettings, setStoryOracleWorldBookSelection, STORY_ORACLE_HISTORY_MODES, STORY_ORACLE_MODES, storyOracleMessages, storyOraclePlanInjectionText, storyOraclePlanIntensityControllable, storyOraclePlans, storyOracleSettings, storyOracleWorldBookSelection, USER_GENERATION_PROTOCOL_LIMITS } from '../src/story-oracle-model.js';
import { loadStoryOracleStore, saveStoryOracleStore, STORY_ORACLE_FALLBACK_KEY } from '../src/story-oracle-storage.js';
import { copyUserGenerationContent, USER_GENERATION_SYSTEM_PROMPT } from '../src/story-oracle.js';
import { addUserGenerationItem, createEmptyUserGenerationStore, normalizeUserGenerationStore, removeUserGenerationItem, USER_GENERATION_LIMITS, userGenerationItems } from '../src/user-generation-model.js';
import { loadUserGenerationStore, saveUserGenerationStore, USER_GENERATION_FALLBACK_KEY } from '../src/user-generation-storage.js';
import { renderSafeMarkdown, splitMarkdownBubbles } from '../src/ui.js';
import { readFile } from 'node:fs/promises';

let store = createEmptyStoryOracleStore();
store = appendStoryOracleTurn(store, 'chat-a', 'q1', 'a1', 'question');
store = appendStoryOracleTurn(store, 'chat-a', 'q2', 'a2', 'advisor');
store = appendStoryOracleTurn(store, 'chat-b', 'q3', 'a3', 'question');
assert.equal(storyOracleMessages(store, 'chat-a', 'question').length, 2);
assert.equal(storyOracleMessages(store, 'chat-a', 'advisor').length, 2);
assert.equal(storyOracleMessages(store, 'chat-b', 'question').length, 2);
assert.deepEqual(STORY_ORACLE_MODES, ['question', 'advisor', 'user-generation']);
assert.deepEqual(STORY_ORACLE_HISTORY_MODES, ['question', 'lorebook', 'advisor', 'user-generation']);
store = appendStoryOracleTurn(store, 'chat-a', '生成魅魔', '需要确认关系方向。', 'user-generation');
assert.equal(storyOracleMessages(store, 'chat-a', 'user-generation').length, 2, 'User 生成历史必须使用独立模式槽');
assert.equal(storyOracleMessages(store, 'chat-a', 'question').length, 2, 'User 生成历史不得回落污染剧情聊天');

const collectingResponse = parseUserGenerationResponse(`我还需要确认一个关键方向。
<UserGenerationState>
status: collecting
missing: 与目标互动对象的关系
question: 你希望她与目标对象是危险盟友、恋人，还是猎物与猎手？
</UserGenerationState>`);
assert.equal(collectingResponse.invalid, false);
assert.equal(collectingResponse.status, 'collecting');
assert.match(collectingResponse.displayText, /关键方向/);
assert.doesNotMatch(collectingResponse.displayText, /UserGenerationState/);

const completeResponse = parseUserGenerationResponse(`<UserGenerationState>
status: complete
missing:
question:
</UserGenerationState>
<UserGenerationResult>
title: 成年魅魔旅者
summary: 擅长诱导谈判、但厌恶强迫的成年魅魔。
content: 姓名：莉蕾娅
年龄：26 岁，明确为成年人。
性格：冷静、狡黠，尊重明确边界。
</UserGenerationResult>`);
assert.equal(completeResponse.invalid, false);
assert.equal(completeResponse.status, 'complete');
assert.equal(completeResponse.result.title, '成年魅魔旅者');
assert.match(completeResponse.result.content, /明确为成年人/);
assert.match(USER_GENERATION_SYSTEM_PROMPT, /未成年人参与成人内容时，拒绝该部分/);
assert.equal(parseStoryPlans(`<StoryPlan>标题：伪路线\n目标：不得入库</StoryPlan>${completeResponse.result.content}`).plans.length, 1,
    '路线解析本身保持原契约，调用方必须按模式隔离解析');

const revisionResponse = parseUserGenerationResponse(`<UserGenerationState>\nstatus: revision\nmissing:\nquestion:\n</UserGenerationState>\n<UserGenerationResult>\ntitle: 修订版\nsummary:\ncontent: 完整新版本正文\n</UserGenerationResult>`);
assert.equal(revisionResponse.status, 'revision');
assert.equal(revisionResponse.invalid, false);
assert.equal(parseUserGenerationResponse('<UserGenerationState>\nstatus: collecting\nmissing: 性格\nquestion: 请补充').invalid, true, '未闭合控制区块必须拒绝');
assert.equal(parseUserGenerationResponse('<UserGenerationState>\nstatus: collecting\nmissing: 性格\nquestion: 一问\nquestion: 二问\n</UserGenerationState>').invalid, true, '重复字段必须拒绝');
assert.equal(parseUserGenerationResponse('<UserGenerationState>\nstatus: complete\nmissing:\nquestion:\n</UserGenerationState><UserGenerationResult>\ntitle:\nsummary: 摘要\ncontent: 正文\n</UserGenerationResult>').invalid, true, '缺少标题必须拒绝');
assert.equal(parseUserGenerationResponse(`<UserGenerationState>\nstatus: complete\nmissing:\nquestion:\n</UserGenerationState><UserGenerationResult>\ntitle: 超长\nsummary:\ncontent: ${'x'.repeat(USER_GENERATION_PROTOCOL_LIMITS.contentChars + 1)}\n</UserGenerationResult>`).invalid, true, '超长正文必须拒绝');
assert.equal(parseUserGenerationResponse('<UserGenerationState>\nstatus: collecting\nmissing: 性格\nquestion: 继续？\n</UserGenerationState><UserGenerationResult>\ntitle: 不应存在\nsummary:\ncontent: 正文\n</UserGenerationResult>').invalid, true, 'collecting 与成品区块混合必须拒绝');
assert.equal(parseUserGenerationResponse('<UserGenerationState>\nstatus: complete\nmissing:\nquestion:\n</UserGenerationState><UserGenerationResult>\ntitle: 重复字段\nsummary:\ncontent: 正文\ntitle: 第二标题\n</UserGenerationResult>').invalid, true, 'content 后重复协议字段必须拒绝');
const adultExplicit = parseUserGenerationResponse('<UserGenerationState>\nstatus: complete\nmissing:\nquestion:\n</UserGenerationState><UserGenerationResult>\ntitle: 成年角色\nsummary:\ncontent: 所有参与露骨成人内容的角色均已年满18岁。包含双方自愿的露骨性亲密场景。\n</UserGenerationResult>');
assert.equal(adultExplicit.invalid, false, '明确成年人的成人向成品必须允许');
const missingAdult = parseUserGenerationResponse('<UserGenerationState>\nstatus: complete\nmissing:\nquestion:\n</UserGenerationState><UserGenerationResult>\ntitle: 年龄缺失\nsummary:\ncontent: 包含双方自愿的性交场景。\n</UserGenerationResult>');
assert.equal(missingAdult.invalid, true, '露骨成人内容缺少成年声明时不得形成待保存成品');
assert.match(missingAdult.reason, /必须声明所有参与角色均已年满18岁/);
assert.match(parseUserGenerationResponse('<UserGenerationState>\nstatus: complete\nmissing:\nquestion:\n</UserGenerationState><UserGenerationResult>\ntitle: 所有参与露骨成人内容的角色均已年满18岁\nsummary:\ncontent: 包含双方自愿的性交场景。\n</UserGenerationResult>').reason, /必须声明所有参与角色均已年满18岁/, '成年声明只出现在标题时必须拒绝');
assert.match(parseUserGenerationResponse('<UserGenerationState>\nstatus: complete\nmissing:\nquestion:\n</UserGenerationState><UserGenerationResult>\ntitle: 成年角色\nsummary: 所有参与露骨成人内容的角色均已年满18岁\ncontent: 包含双方自愿的性交场景。\n</UserGenerationResult>').reason, /必须声明所有参与角色均已年满18岁/, '成年声明只出现在摘要时必须拒绝');
assert.match(parseUserGenerationResponse('<UserGenerationState>\nstatus: complete\nmissing:\nquestion:\n</UserGenerationState><UserGenerationResult>\ntitle: 违规请求\nsummary:\ncontent: 16 岁高中生参与性交场景。\n</UserGenerationResult>').reason, /不得涉及未成年人/);
assert.match(parseUserGenerationResponse('<UserGenerationState>\nstatus: complete\nmissing:\nquestion:\n</UserGenerationState><UserGenerationResult>\ntitle: 部分成年声明\nsummary:\ncontent: 甲方年龄 24 岁，乙方年龄未知，双方参与性交场景。\n</UserGenerationResult>').reason, /必须声明所有参与角色均已年满18岁/, '只声明一名参与者成年不得覆盖其他年龄未知参与者');
assert.match(parseUserGenerationResponse('<UserGenerationState>\nstatus: complete\nmissing:\nquestion:\n</UserGenerationState><UserGenerationResult>\ntitle: 泛化成年声明\nsummary:\ncontent: 角色均为成年人，包含性交场景。\n</UserGenerationResult>').reason, /必须声明所有参与角色均已年满18岁/, '泛化成年人措辞不得替代统一可验证声明');
assert.equal(parseUserGenerationResponse('<UserGenerationState>\nstatus: complete\nmissing:\nquestion:\n</UserGenerationState><UserGenerationResult>\ntitle: 普通学生\nsummary:\ncontent: 16 岁高中生，热爱天文，不包含成人内容。\n</UserGenerationResult>').invalid, false, '未成年人普通角色设定不得被误拒');
assert.match(USER_GENERATION_SYSTEM_PROMPT, /所有参与露骨成人内容的角色均已年满18岁/, '系统提示词必须告知模型统一成年声明契约');


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
let injectedPlan = storyOraclePlans(planStore, 'route-chat')[0];
assert.equal(injectedPlan.intensity, 'natural', '历史路线缺少强度字段时必须回落自然推进');
assert.match(storyOraclePlanInjectionText(injectedPlan), /节奏：自然推进：让剧情沿当前矛盾产生明确进展，但保留后续选择与余地。/);
planStore = setStoryOraclePlanIntensity(planStore, 'route-chat', injectedPlan.id, 'fast');
injectedPlan = storyOraclePlans(planStore, 'route-chat')[0];
assert.equal(injectedPlan.intensity, 'fast');
assert.match(storyOraclePlanInjectionText(injectedPlan), /节奏：尽快引爆：推动关键冲突进入不可逆的直接对峙、揭示或选择。/);
const manualInjection = storyOraclePlanInjectionText(injectedPlan).replace(/节奏：.+/, '节奏：按玩家自行确定的节奏推进。');
planStore = setStoryOraclePlanCustomInjection(planStore, 'route-chat', injectedPlan.id, manualInjection);
injectedPlan = storyOraclePlans(planStore, 'route-chat')[0];
assert.equal(storyOraclePlanIntensityControllable(injectedPlan), false, '手动改写节奏行后必须锁定强度档');
assert.throws(() => setStoryOraclePlanIntensity(planStore, 'route-chat', injectedPlan.id, 'slow'), /恢复默认/);
assert.match(buildStoryOraclePlanInjection([injectedPlan]).content, /按玩家自行确定的节奏推进/);
planStore = resetStoryOraclePlanInjection(planStore, 'route-chat', injectedPlan.id);
injectedPlan = storyOraclePlans(planStore, 'route-chat')[0];
assert.equal(storyOraclePlanIntensityControllable(injectedPlan), true, '恢复默认后必须重新接管强度档');
planStore = setStoryOraclePlanIntensity(planStore, 'route-chat', injectedPlan.id, 'slow');
assert.match(storyOraclePlanInjectionText(storyOraclePlans(planStore, 'route-chat')[0]), /节奏：只铺垫：呈现征兆、信息和关系张力，不让核心冲突在本轮定局。/);
assert.throws(() => setStoryOraclePlanEnabled(planStore, 'route-chat', 'missing-plan', true), /不存在/);
planStore = clearStoryOraclePlans(planStore, 'route-chat');
assert.deepEqual(storyOraclePlans(planStore, 'route-chat'), []);
planStore = appendStoryOracleTurn(planStore, 'route-chat', '问题', '回答', 'question');
planStore = clearStoryOracleScope(planStore, 'route-chat', 'question');
assert.deepEqual(storyOracleMessages(planStore, 'route-chat', 'question'), []);

const legacySettingsStore = {
    version: 1,
    scopes: { legacy: { modes: {}, settings: { pace: 'fast', breakLimit: true, customPrompt: '优先保留伏笔。' } } },
};
const migratedSettings = storyOracleSettings(legacySettingsStore, 'legacy');
assert.match(migratedSettings.systemPrompt, /本轮剧情推进强度：尽快引爆。/);
assert.match(migratedSettings.systemPrompt, /优先保留伏笔。/);
assert.match(migratedSettings.systemPrompt, /不要凭空编造/);
assert.equal(Object.hasOwn(migratedSettings, 'pace'), false, '迁移后设置只能保留单一系统提示词字段');
const naturalOnlySettings = storyOracleSettings({ version: 1, scopes: { legacy: { modes: {}, settings: { pace: 'natural' } } } }, 'legacy');
assert.match(naturalOnlySettings.systemPrompt, /本轮剧情推进强度：自然推进。/, '显式自然节奏不得被当成缺省设置丢弃');
const breakLimitFalseSettings = storyOracleSettings({ version: 1, scopes: { legacy: { modes: {}, settings: { breakLimit: false } } } }, 'legacy');
assert.match(breakLimitFalseSettings.systemPrompt, /本轮剧情推进强度：自然推进。/, '显式关闭旧限制也必须进入可诊断迁移路径');
assert.doesNotMatch(breakLimitFalseSettings.systemPrompt, /解除对剧情分析/, 'breakLimit=false 不得错误启用旧解除限制指令');
const savedSettingsStore = setStoryOracleSettings(createEmptyStoryOracleStore(), 'settings-chat', { systemPrompt: '只基于已给上下文回答。' });
assert.equal(storyOracleSettings(savedSettingsStore, 'settings-chat').systemPrompt, '只基于已给上下文回答。');
assert.equal(storyOracleSettings(createEmptyStoryOracleStore(), 'settings-chat').systemPrompt, DEFAULT_STORY_ORACLE_SYSTEM_PROMPT);

const markdownBlocks = splitMarkdownBubbles('第一段 **重点**。\n\n- 选项一\n- 选项二\n\n```js\nconst unsafe = "<script>";\n```');
assert.deepEqual(markdownBlocks, ['第一段 **重点**。', '- 选项一\n- 选项二', '```js\nconst unsafe = "<script>";\n```'], '段落、列表和代码块必须按完整 Markdown 块拆成气泡');
assert.equal(renderSafeMarkdown(markdownBlocks[0]), '<p>第一段 <strong>重点</strong>。</p>');
assert.equal(renderSafeMarkdown(markdownBlocks[1]), '<ul><li>选项一</li><li>选项二</li></ul>');
assert.match(renderSafeMarkdown(markdownBlocks[2]), /<pre><code class="language-js">/);
assert.doesNotMatch(renderSafeMarkdown(markdownBlocks[2]), /<script>/, 'Markdown 渲染必须先转义不可信 HTML');
assert.match(renderSafeMarkdown('`<img>`'), /&lt;img&gt;/, '行内代码也必须转义 HTML');

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

const userItem = (id, overrides = {}) => ({
    id, title: `User ${id}`, summary: '', content: `Content ${id}`, sourceMessageId: `message-${id}`,
    createdAt: 100, updatedAt: 100, ...overrides,
});
let userStore = addUserGenerationItem(createEmptyUserGenerationStore(), userItem('one'), { now: 100 });
const idempotentUserStore = addUserGenerationItem(userStore, userItem('one', { createdAt: 999, updatedAt: 999, order: 99 }), { now: 999 });
assert.deepEqual(idempotentUserStore, userStore, '同一来源成品重复保存必须幂等，不得因时间或顺序差异产生冲突');
assert.throws(() => addUserGenerationItem(userStore, userItem('one', { content: 'different' })), /已存在不同内容的 ID/);
userStore = addUserGenerationItem(userStore, userItem('two', { createdAt: 200, updatedAt: 200 }), { now: 200 });
assert.deepEqual(userGenerationItems(userStore).map(item => item.id), ['two', 'one'], 'User 库列表必须按最新更新时间排序');
assert.deepEqual(userGenerationItems(removeUserGenerationItem(userStore, 'two')).map(item => item.id), ['one']);
assert.throws(() => normalizeUserGenerationStore({ version: 1, items: [userItem('same'), userItem('same')] }), /重复 ID/);
assert.throws(() => addUserGenerationItem(createEmptyUserGenerationStore(), userItem('empty', { content: '   ' })), /正文\s+不能为空/);
assert.throws(() => addUserGenerationItem(createEmptyUserGenerationStore(), userItem('long', { content: 'x'.repeat(USER_GENERATION_LIMITS.contentChars + 1) })), /正文\s+超过/);
let fullUserStore = createEmptyUserGenerationStore();
for (let index = 0; index < USER_GENERATION_LIMITS.items; index += 1) {
    fullUserStore = addUserGenerationItem(fullUserStore, userItem(`full-${index}`, { createdAt: index + 1, updatedAt: index + 1 }), { now: index + 1 });
}
assert.throws(() => addUserGenerationItem(fullUserStore, userItem('overflow')), /已达到 100 条上限/);

const emptyUserLoad = await loadUserGenerationStore({
    idbRead: async () => ({ ok: true, value: undefined }), storage: { getItem: () => null },
});
assert.equal(emptyUserLoad.writable, true);
const userFallbackData = JSON.stringify(userStore);
const userFallbackStorage = {
    getItem: key => key === USER_GENERATION_FALLBACK_KEY ? userFallbackData : null,
    setItem: () => assert.fail('主存储损坏后的只读恢复不得写入后备数据'),
    removeItem: () => assert.fail('主存储损坏后的只读恢复不得删除后备数据'),
};
const readOnlyUserLoad = await loadUserGenerationStore({
    idbRead: async () => ({ ok: true, value: { broken: true } }), storage: userFallbackStorage,
});
assert.equal(readOnlyUserLoad.writable, false);
assert.deepEqual(userGenerationItems(readOnlyUserLoad.store).map(item => item.id), ['two', 'one']);
await assert.rejects(() => saveUserGenerationStore(readOnlyUserLoad.store, {
    readOnlyReason: readOnlyUserLoad.readOnlyReason, writeHandle: readOnlyUserLoad.writeHandle,
    idbSet: async () => assert.fail('只读保护不得写入 IDB'), storage: userFallbackStorage,
}), /只读保护状态/);
const recoveredUserLoad = await loadUserGenerationStore({
    idbRead: async () => ({ ok: false, error: new Error('IDB unavailable') }), storage: userFallbackStorage,
});
assert.equal(recoveredUserLoad.writable, true, 'IDB 不可用但后备数据有效时必须允许继续写入后备存储');
let emptyPrimaryFallbackRemoved = false;
const emptyPrimaryFallbackStorage = {
    getItem: key => key === USER_GENERATION_FALLBACK_KEY ? userFallbackData : null,
    setItem: () => assert.fail('IDB 保存成功时不得重写后备数据'),
    removeItem: key => { if (key === USER_GENERATION_FALLBACK_KEY) emptyPrimaryFallbackRemoved = true; },
};
const emptyPrimaryUserLoad = await loadUserGenerationStore({
    idbRead: async () => ({ ok: true, value: undefined }), storage: emptyPrimaryFallbackStorage,
});
assert.equal(emptyPrimaryUserLoad.writable, true, 'IDB 主键为空且后备数据有效时必须允许恢复后继续写入');
assert.equal(await saveUserGenerationStore(emptyPrimaryUserLoad.store, {
    writeHandle: emptyPrimaryUserLoad.writeHandle, idbSet: async () => true, storage: emptyPrimaryFallbackStorage,
}), true, 'IDB 主键为空的 fallback 恢复必须获得有效写入句柄');
assert.equal(emptyPrimaryFallbackRemoved, true, 'fallback 恢复成功写入 IDB 后必须清理后备数据');
let userWrites = 0;
let userActive = true;
const staleUserSave = saveUserGenerationStore(userStore, {
    writeHandle: recoveredUserLoad.writeHandle, shouldWrite: () => userActive,
    idbSet: async () => { userWrites += 1; return true; }, storage: userFallbackStorage,
});
userActive = false;
assert.equal(await staleUserSave, false);
assert.equal(userWrites, 0, '失效 User 库写入不得触碰存储');
await assert.rejects(() => saveUserGenerationStore(userStore, {
    writeHandle: recoveredUserLoad.writeHandle, idbSet: async () => false,
    storage: { setItem: () => { throw new Error('localStorage unavailable'); } },
}), /均不可用/);

let clipboardText = '';
assert.equal(await copyUserGenerationContent('仅复制正文', {
    clipboard: { writeText: async text => { clipboardText = text; } }, documentRef: null,
}), true);
assert.equal(clipboardText, '仅复制正文');
let fallbackValue = '';
let fallbackRemoved = false;
const fallbackTextarea = {
    value: '', setAttribute: () => {}, select: () => {}, setSelectionRange: () => {},
    remove: () => { fallbackRemoved = true; },
};
const fallbackDocument = {
    body: { appendChild: node => { fallbackValue = node.value; } },
    createElement: tag => { assert.equal(tag, 'textarea'); return fallbackTextarea; },
    execCommand: command => { assert.equal(command, 'copy'); return true; },
    getSelection: () => ({ removeAllRanges: () => {} }),
};
assert.equal(await copyUserGenerationContent('降级复制正文', {
    clipboard: { writeText: async () => { throw new Error('denied'); } }, documentRef: fallbackDocument,
}), true);
assert.equal(fallbackValue, '降级复制正文');
assert.equal(fallbackRemoved, true, '降级复制无论成功失败都必须清理临时节点');
await assert.rejects(() => copyUserGenerationContent('复制失败', {
    clipboard: { writeText: async () => { throw new Error('denied'); } },
    documentRef: { ...fallbackDocument, execCommand: () => false },
}), /复制失败，请展开后手动选择/);
await assert.rejects(() => copyUserGenerationContent('', {
    clipboard: { writeText: async () => assert.fail('空正文不得调用 Clipboard') }, documentRef: fallbackDocument,
}), /没有可复制的 User 正文/);

console.log('Story Oracle checks passed.');
