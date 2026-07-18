import assert from 'node:assert/strict';
import { getStorageId } from '../src/host-context.js';
import { deriveInteractiveActorId } from '../src/interactive-scene-model.js';
import { renderCommunitySource } from '../src/community-injection.js';
import {
    buildContextInjectionPrompts, clearExtensionPrompts, replaceExtensionPrompts,
} from '../src/phone-injection.js';
import { resolveCommunitySources, resolvePhoneSources } from '../src/permissions.js';
import { calendarScopeFor, createEmptyCalendarStore, renderCalendarInjection } from '../src/calendar-model.js';
import { allocateContextBudget, normalizeBudgetConfig, BUDGET_SOURCES, DEFAULT_BUDGET_CONFIG } from '../src/budget.js';

function assertNoUnpairedSurrogates(value, label) {
    for (let index = 0; index < value.length; index += 1) {
        const unit = value.charCodeAt(index);
        assert.equal(unit >= 0xD800 && unit <= 0xDBFF
            && (index + 1 >= value.length || value.charCodeAt(index + 1) < 0xDC00 || value.charCodeAt(index + 1) > 0xDFFF), false, `${label} 含孤立高代理项`);
        assert.equal(unit >= 0xDC00 && unit <= 0xDFFF
            && (index === 0 || value.charCodeAt(index - 1) < 0xD800 || value.charCodeAt(index - 1) > 0xDBFF), false, `${label} 含孤立低代理项`);
    }
}

assert.equal(getStorageId(() => null), 'sms_unknown__default');
assert.equal(getStorageId(() => ({ characterId: 0, characters: [{ avatar: 'alice.png' }] })), 'sms_unknown__default');
assert.equal(getStorageId(() => ({ characterId: 0, characters: [{ avatar: 'alice.png' }], chatId: 'chat-a' })), 'sms_alice.png__chat-a');

const phone = resolvePhoneSources({
    currentStorageId: 'story-a', currentActorName: 'Alice',
    selectedByStorage: { 'story-a': ['Alice', 'Bob', '__group_team'], 'story-b': ['Alice'] },
    historiesByStorage: {
        'story-a': { Alice: [{ role: 'assistant', content: 'A' }], Bob: [{ role: 'assistant', content: 'B' }], __group_team: [{ role: 'assistant', content: 'G' }] },
        'story-b': { Alice: [{ role: 'assistant', content: '泄漏' }] },
    },
    groupsByStorage: { 'story-a': { __group_team: { name: '群', members: ['Alice', 'Carol'], injection: { position: 0, depth: 0, historyLimit: 20 } } } },
});
assert.equal(phone.allowed, true);
assert.deepEqual(phone.sources.map(source => source.sourceId), ['Alice', '__group_team']);
assert.equal(phone.sources.some(source => source.history.some(item => item.content === '泄漏')), false);
assert.deepEqual(resolvePhoneSources({ currentStorageId: 'sms_unknown__default', currentActorName: 'Alice' }).sources, []);
const inheritedSelections = Object.create({ 'story-a': ['Alice'] });
assert.deepEqual(resolvePhoneSources({ currentStorageId: 'story-a', currentActorName: 'Alice', selectedByStorage: inheritedSelections, historiesByStorage: { 'story-a': { Alice: [] } } }).sources, []);
const accessorSelections = {};
Object.defineProperty(accessorSelections, 'story-a', { enumerable: true, get() { throw new Error('不得读取'); } });
assert.equal(resolvePhoneSources({ currentStorageId: 'story-a', currentActorName: 'Alice', selectedByStorage: accessorSelections }).allowed, false);

let pollutedPhoneIteratorReads = 0;
const pollutedPhoneSelection = ['Bob'];
Object.setPrototypeOf(pollutedPhoneSelection, {
    *[Symbol.iterator]() { pollutedPhoneIteratorReads += 1; yield 'Alice'; },
});
const pollutedPhone = resolvePhoneSources({
    currentStorageId: 'story-a', currentActorName: 'Alice',
    selectedByStorage: { 'story-a': pollutedPhoneSelection },
    historiesByStorage: { 'story-a': { Alice: [{ role: 'assistant', content: '不得授权' }], Bob: [] } },
    groupsByStorage: { 'story-a': {} },
});
assert.equal(pollutedPhone.allowed, false);
assert.deepEqual(pollutedPhone.sources, []);
assert.equal(pollutedPhoneIteratorReads, 0);

let ownPhoneIteratorReads = 0;
const ownPhoneIteratorSelection = Object.assign(['Alice'], {
    [Symbol.iterator]: function* iterator() { ownPhoneIteratorReads += 1; yield 'Alice'; },
});
for (const selection of [
    Object.assign(['Alice'], { extra: true }),
    Object.assign(['Alice'], { [Symbol('extra')]: true }),
    ownPhoneIteratorSelection,
]) {
    const result = resolvePhoneSources({
        currentStorageId: 'story-a', currentActorName: 'Alice', selectedByStorage: { 'story-a': selection },
        historiesByStorage: { 'story-a': { Alice: [] } }, groupsByStorage: {},
    });
    assert.equal(result.allowed, false);
    assert.deepEqual(result.sources, []);
}
assert.equal(ownPhoneIteratorReads, 0);
let phoneIndexGetterReads = 0;
const accessorPhoneSelection = [];
Object.defineProperty(accessorPhoneSelection, '0', {
    enumerable: true, configurable: true,
    get() { phoneIndexGetterReads += 1; return 'Alice'; },
});
accessorPhoneSelection.length = 1;
const accessorPhoneSelectionResult = resolvePhoneSources({
    currentStorageId: 'story-a', currentActorName: 'Alice', selectedByStorage: { 'story-a': accessorPhoneSelection },
    historiesByStorage: { 'story-a': { Alice: [] } }, groupsByStorage: {},
});
assert.equal(accessorPhoneSelectionResult.allowed, false);
assert.deepEqual(accessorPhoneSelectionResult.sources, []);
assert.equal(phoneIndexGetterReads, 0);

let groupMembersGetterReads = 0;
const accessorGroup = { name: '危险群', injection: { position: 0, depth: 0, historyLimit: 20 } };
Object.defineProperty(accessorGroup, 'members', {
    enumerable: true,
    get() { groupMembersGetterReads += 1; return ['Alice']; },
});
const accessorGroupResult = resolvePhoneSources({
    currentStorageId: 'story-a', currentActorName: 'Alice',
    selectedByStorage: { 'story-a': ['__group_danger'] },
    historiesByStorage: { 'story-a': { __group_danger: [{ role: 'assistant', content: '不得授权' }] } },
    groupsByStorage: { 'story-a': { __group_danger: accessorGroup } },
});
assert.equal(accessorGroupResult.allowed, false);
assert.deepEqual(accessorGroupResult.sources, []);
assert.equal(groupMembersGetterReads, 0);

let pollutedMembersIteratorReads = 0;
const pollutedMembers = ['Bob'];
Object.setPrototypeOf(pollutedMembers, {
    *[Symbol.iterator]() { pollutedMembersIteratorReads += 1; yield 'Alice'; },
});
const pollutedMembersResult = resolvePhoneSources({
    currentStorageId: 'story-a', currentActorName: 'Alice',
    selectedByStorage: { 'story-a': ['__group_danger'] },
    historiesByStorage: { 'story-a': { __group_danger: [{ role: 'assistant', content: '不得授权' }] } },
    groupsByStorage: { 'story-a': { __group_danger: { name: '危险群', members: pollutedMembers, injection: { position: 0, depth: 0, historyLimit: 20 } } } },
});
assert.equal(pollutedMembersResult.allowed, false);
assert.deepEqual(pollutedMembersResult.sources, []);
assert.equal(pollutedMembersIteratorReads, 0);

const sparseMembers = [];
sparseMembers.length = 1;
assert.equal(resolvePhoneSources({
    currentStorageId: 'story-a', currentActorName: 'Alice', selectedByStorage: { 'story-a': ['__group_sparse'] },
    historiesByStorage: { 'story-a': { __group_sparse: [] } },
    groupsByStorage: { 'story-a': { __group_sparse: { name: '稀疏群', members: sparseMembers } } },
}).allowed, false);

for (const field of ['name', 'injection']) {
    let reads = 0;
    const group = { name: '访问器群', members: ['Alice'], injection: { position: 0, depth: 0, historyLimit: 20 } };
    Object.defineProperty(group, field, {
        enumerable: true, configurable: true,
        get() { reads += 1; return field === 'name' ? '伪造群名' : { position: 0, depth: 0, historyLimit: 20 }; },
    });
    const result = resolvePhoneSources({
        currentStorageId: 'story-a', currentActorName: 'Alice', selectedByStorage: { 'story-a': ['__group_accessor'] },
        historiesByStorage: { 'story-a': { __group_accessor: [] } },
        groupsByStorage: { 'story-a': { __group_accessor: group } },
    });
    assert.equal(result.allowed, false);
    assert.deepEqual(result.sources, []);
    assert.equal(reads, 0);
}

let unauthorizedHistoryReads = 0;
const unauthorizedMessage = { role: 'assistant' };
Object.defineProperty(unauthorizedMessage, 'content', {
    enumerable: true,
    get() { unauthorizedHistoryReads += 1; return '未授权正文'; },
});
const unauthorizedGroup = resolvePhoneSources({
    currentStorageId: 'story-a', currentActorName: 'Alice', selectedByStorage: { 'story-a': ['__group_other'] },
    historiesByStorage: { 'story-a': { __group_other: [unauthorizedMessage] } },
    groupsByStorage: { 'story-a': { __group_other: { name: '他人群', members: ['Bob'] } } },
});
assert.equal(unauthorizedGroup.allowed, true);
assert.deepEqual(unauthorizedGroup.sources, []);
assert.equal(unauthorizedHistoryReads, 0);

let historyContentGetterReads = 0;
const accessorMessage = { role: 'assistant' };
Object.defineProperty(accessorMessage, 'content', {
    enumerable: true,
    get() { historyContentGetterReads += 1; return '不得读取'; },
});
const accessorHistoryResult = resolvePhoneSources({
    currentStorageId: 'story-a', currentActorName: 'Alice',
    selectedByStorage: { 'story-a': ['Alice'] },
    historiesByStorage: { 'story-a': { Alice: [accessorMessage] } },
    groupsByStorage: { 'story-a': {} },
});
assert.equal(accessorHistoryResult.allowed, false);
assert.deepEqual(accessorHistoryResult.sources, []);
assert.equal(historyContentGetterReads, 0);

for (const field of ['role', 'directorNote']) {
    let reads = 0;
    const message = { role: 'assistant', content: '正文', directorNote: '' };
    Object.defineProperty(message, field, {
        enumerable: true, configurable: true,
        get() { reads += 1; return field === 'role' ? 'assistant' : '引导'; },
    });
    const result = resolvePhoneSources({
        currentStorageId: 'story-a', currentActorName: 'Alice', selectedByStorage: { 'story-a': ['Alice'] },
        historiesByStorage: { 'story-a': { Alice: [message] } }, groupsByStorage: {},
    });
    assert.equal(result.allowed, false);
    assert.deepEqual(result.sources, []);
    assert.equal(reads, 0);
}

let pollutedHistoryIteratorReads = 0;
const pollutedHistory = [{ role: 'assistant', content: '正文' }];
Object.setPrototypeOf(pollutedHistory, {
    *[Symbol.iterator]() { pollutedHistoryIteratorReads += 1; yield { role: 'assistant', content: '伪造正文' }; },
});
const pollutedHistoryResult = resolvePhoneSources({
    currentStorageId: 'story-a', currentActorName: 'Alice', selectedByStorage: { 'story-a': ['Alice'] },
    historiesByStorage: { 'story-a': { Alice: pollutedHistory } }, groupsByStorage: {},
});
assert.equal(pollutedHistoryResult.allowed, false);
assert.deepEqual(pollutedHistoryResult.sources, []);
assert.equal(pollutedHistoryIteratorReads, 0);

const safeSnapshotInput = { role: 'assistant', content: '快照正文' };
const safeGroupInput = {
    name: '快照群', members: ['Alice'],
    injection: { position: 2, depth: 3, historyLimit: 4 },
};
const safeSnapshotResult = resolvePhoneSources({
    currentStorageId: 'story-a', currentActorName: 'Alice',
    selectedByStorage: { 'story-a': ['Alice', '__group_snapshot'] },
    historiesByStorage: { 'story-a': { Alice: [safeSnapshotInput], __group_snapshot: [{ role: 'assistant', content: '群快照' }] } },
    groupsByStorage: { 'story-a': { __group_snapshot: safeGroupInput } },
});
assert.equal(safeSnapshotResult.allowed, true);
safeSnapshotInput.content = '事后篡改';
assert.equal(safeSnapshotResult.sources[0].history[0].content, '快照正文');
safeGroupInput.name = '篡改群名';
safeGroupInput.members[0] = 'Mallory';
safeGroupInput.injection.position = -1;
const safeGroupSnapshot = safeSnapshotResult.sources.find(source => source.sourceId === '__group_snapshot').meta;
assert.equal(safeGroupSnapshot.name, '快照群');
assert.deepEqual(safeGroupSnapshot.members, ['Alice']);
assert.equal(safeGroupSnapshot.injection.position, 2);

const sparseSelection = [];
sparseSelection.length = 1;
assert.equal(resolvePhoneSources({
    currentStorageId: 'story-a', currentActorName: 'Alice',
    selectedByStorage: { 'story-a': sparseSelection }, historiesByStorage: { 'story-a': {} },
}).allowed, false);

const actorId = deriveInteractiveActorId('story-a', 'story', 'character:alice');
const scene = {
    id: 'scene-a', title: '社区', preset: 'weibo', styleInput: '', generatedPrompt: '', createdAt: 1, updatedAt: 2,
    posts: [{ id: 'post-a', authorId: actorId, authorNameSnapshot: 'Alice', content: '帖子正文', tags: [], createdAt: 2, comments: [{ id: 'comment-a', authorId: actorId, authorNameSnapshot: 'Alice', content: '评论正文', createdAt: 3 }], liked: false }],
    live: { title: '直播', status: 'idle', danmaku: [{ id: 'danmaku-a', authorId: actorId, authorNameSnapshot: 'Alice', content: '弹幕正文', createdAt: 4 }] },
};
const store = { version: 2, scopes: { 'story-a': { activeSceneId: 'scene-a', sceneOrder: ['scene-a'], actors: { [actorId]: { actorId, type: 'story', displayName: 'Alice', bindingKey: 'character:alice', profile: '', createdAt: 1 } }, scenes: { 'scene-a': scene } } } };
assert.deepEqual(resolveCommunitySources({ currentStorageId: 'story-a', enabled: false, sceneIdsByStorage: { 'story-a': ['scene-a'] }, store }).sources, []);
const community = resolveCommunitySources({ currentStorageId: 'story-a', enabled: true, sceneIdsByStorage: { 'story-a': ['scene-a', 'deleted'] }, store });
assert.equal(community.allowed, true);
assert.deepEqual(community.sources.map(source => source.sourceId), ['scene-a']);
assert.match(renderCommunitySource(community.sources[0]), /帖子正文/);
assert.match(renderCommunitySource(community.sources[0]), /评论正文/);
assert.match(renderCommunitySource(community.sources[0]), /弹幕正文/);

let crossScopeReads = 0;
let unselectedSceneReads = 0;
const isolatedScopes = { 'story-a': { ...store.scopes['story-a'], scenes: { 'scene-a': scene } } };
Object.defineProperty(isolatedScopes, 'story-b', { enumerable: true, get() { crossScopeReads += 1; throw new Error('不得读取其他 scope'); } });
Object.defineProperty(isolatedScopes['story-a'].scenes, 'scene-secret', { enumerable: true, get() { unselectedSceneReads += 1; throw new Error('不得读取未选中 scene'); } });
const isolatedCommunity = resolveCommunitySources({
    currentStorageId: 'story-a', enabled: true,
    sceneIdsByStorage: { 'story-a': ['scene-a'] }, store: { version: 2, scopes: isolatedScopes },
});
assert.equal(isolatedCommunity.allowed, true);
assert.deepEqual(isolatedCommunity.sources.map(source => source.sourceId), ['scene-a']);
assert.equal(crossScopeReads, 0);
assert.equal(unselectedSceneReads, 0);

let pollutedCommunityIteratorReads = 0;
let secretSceneReads = 0;
const pollutedSceneSelection = ['scene-a'];
Object.setPrototypeOf(pollutedSceneSelection, {
    *[Symbol.iterator]() { pollutedCommunityIteratorReads += 1; yield 'scene-secret'; },
});
const pollutedScenes = { 'scene-a': scene };
Object.defineProperty(pollutedScenes, 'scene-secret', {
    enumerable: true,
    get() { secretSceneReads += 1; return scene; },
});
const pollutedCommunity = resolveCommunitySources({
    currentStorageId: 'story-a', enabled: true,
    sceneIdsByStorage: { 'story-a': pollutedSceneSelection },
    store: { version: 2, scopes: { 'story-a': { ...store.scopes['story-a'], scenes: pollutedScenes } } },
});
assert.equal(pollutedCommunity.allowed, false);
assert.deepEqual(pollutedCommunity.sources, []);
assert.equal(pollutedCommunityIteratorReads, 0);
assert.equal(secretSceneReads, 0);

let ownCommunityIteratorReads = 0;
const ownIteratorSceneSelection = ['scene-a'];
Object.defineProperty(ownIteratorSceneSelection, Symbol.iterator, {
    configurable: true,
    value: function* iterator() { ownCommunityIteratorReads += 1; yield 'scene-secret'; },
});
for (const selection of [
    Object.assign(['scene-a'], { extra: true }),
    Object.assign(['scene-a'], { [Symbol('extra')]: true }),
    ownIteratorSceneSelection,
]) {
    const result = resolveCommunitySources({
        currentStorageId: 'story-a', enabled: true,
        sceneIdsByStorage: { 'story-a': selection }, store,
    });
    assert.equal(result.allowed, false);
    assert.deepEqual(result.sources, []);
}
assert.equal(ownCommunityIteratorReads, 0);

let communityIndexGetterReads = 0;
const accessorSceneSelection = [];
Object.defineProperty(accessorSceneSelection, '0', {
    enumerable: true, configurable: true,
    get() { communityIndexGetterReads += 1; return 'scene-a'; },
});
accessorSceneSelection.length = 1;
const accessorSceneSelectionResult = resolveCommunitySources({
    currentStorageId: 'story-a', enabled: true,
    sceneIdsByStorage: { 'story-a': accessorSceneSelection }, store,
});
assert.equal(accessorSceneSelectionResult.allowed, false);
assert.deepEqual(accessorSceneSelectionResult.sources, []);
assert.equal(communityIndexGetterReads, 0);

const sparseSceneSelection = [];
sparseSceneSelection.length = 1;
assert.equal(resolveCommunitySources({
    currentStorageId: 'story-a', enabled: true,
    sceneIdsByStorage: { 'story-a': sparseSceneSelection }, store,
}).allowed, false);

let actorDisplayNameReads = 0;
const accessorActor = { actorId, type: 'story', bindingKey: 'character:alice', profile: '', createdAt: 1 };
Object.defineProperty(accessorActor, 'displayName', {
    enumerable: true,
    get() { actorDisplayNameReads += 1; return '伪造作者'; },
});
const actorAccessorResult = resolveCommunitySources({
    currentStorageId: 'story-a', enabled: true,
    sceneIdsByStorage: { 'story-a': ['scene-a'] },
    store: {
        version: 2,
        scopes: { 'story-a': { ...store.scopes['story-a'], actors: { [actorId]: accessorActor } } },
    },
});
assert.equal(actorAccessorResult.allowed, false);
assert.deepEqual(actorAccessorResult.sources, []);
assert.equal(actorDisplayNameReads, 0);

const unicodeCommunity = renderCommunitySource({
    type: 'community',
    actors: {
        post: { displayName: `${'p'.repeat(79)}😀` },
        comment: { displayName: `${'c'.repeat(79)}😀` },
        danmaku: { displayName: `${'d'.repeat(79)}😀` },
    },
    scene: {
        title: `${'t'.repeat(79)}😀`,
        posts: [{
            authorId: 'post', authorNameSnapshot: '', content: `${'a'.repeat(3999)}😀`,
            comments: [{ authorId: 'comment', authorNameSnapshot: '', content: `${'b'.repeat(999)}😀` }],
        }],
        live: {
            title: `${'l'.repeat(99)}😀`,
            danmaku: [{ authorId: 'danmaku', authorNameSnapshot: '', content: `${'m'.repeat(199)}😀` }],
        },
    },
});
assertNoUnpairedSurrogates(unicodeCommunity, 'community 全字段边界');

const baseInjectionInput = {
    currentStorageId: 'story-a', currentActorName: 'Alice', userName: 'User', emojis: [],
    selectedByStorage: { 'story-a': ['Alice', 'Bob'], 'story-b': ['Alice'] },
    historiesByStorage: {
        'story-a': { Alice: [{ role: 'assistant', content: '允许的短信' }], Bob: [{ role: 'assistant', content: 'Bob 私聊' }] },
        'story-b': { Alice: [{ role: 'assistant', content: '其他角色卡短信' }] },
    },
    groupsByStorage: {}, interactiveStore: store,
};
const defaultPlan = buildContextInjectionPrompts({ ...baseInjectionInput, budgetConfig: undefined });
assert.equal(defaultPlan.prompts.length, 1);
assert.match(defaultPlan.prompts[0].content, /允许的短信/);
assert.doesNotMatch(defaultPlan.prompts[0].content, /Bob 私聊|其他角色卡短信|帖子正文/);
assert.equal(defaultPlan.diagnostics.communityPermission.reason, 'disabled');

const communityPlan = buildContextInjectionPrompts({
    ...baseInjectionInput,
    budgetConfig: {
        targetTokens: 2000,
        sourceWeights: { phone: 1, community: 1 },
        sourcePriority: ['community', 'phone'],
        redistributeUnused: true,
        communityEnabled: true,
        communityPosition: 2,
        communityDepth: 3,
        communitySceneIdsByStorage: { 'story-a': ['scene-a'] },
    },
});
assert.equal(communityPlan.prompts.length, 2);
const communityPrompt = communityPlan.prompts.find(prompt => prompt.key.includes(':community:'));
assert.ok(communityPrompt);
assert.match(communityPrompt.content, /帖子正文/);
assert.equal(communityPrompt.position, 2);
assert.equal(communityPrompt.depth, 3);
assert.deepEqual(buildContextInjectionPrompts({ ...baseInjectionInput, currentStorageId: 'sms_unknown__default' }).prompts, []);

const calls = [];
const runtime = { trackedExtensionPromptKeys: new Set(['old', 'retry']) };
const context = { setExtensionPrompt(key, content, position, depth) { calls.push([key, content, position, depth]); if (key === 'retry' && content === '') throw new Error('clear failed'); } };
replaceExtensionPrompts({ context, runtime, prompts: [{ key: 'new', content: '正文', position: 0, depth: 1 }] });
assert.deepEqual([...runtime.trackedExtensionPromptKeys].sort(), ['new', 'retry']);
assert.ok(calls.some(call => call[0] === 'old' && call[1] === ''));
clearExtensionPrompts({ context, runtime });
assert.deepEqual([...runtime.trackedExtensionPromptKeys], ['retry']);

// === Calendar injection tests ===

const migratedTwoSourceBudget = normalizeBudgetConfig({
    sourceWeights: { phone: 3, community: 1 },
    sourcePriority: ['community', 'phone'],
    communityEnabled: true,
});
assert.deepEqual(migratedTwoSourceBudget.sourceWeights, { phone: 3, community: 1, calendar: 0 });
assert.deepEqual(migratedTwoSourceBudget.sourcePriority, ['community', 'phone', 'calendar']);
assert.equal(migratedTwoSourceBudget.calendarEnabled, false);
assert.equal(migratedTwoSourceBudget.calendarPosition, DEFAULT_BUDGET_CONFIG.calendarPosition);
assert.equal(migratedTwoSourceBudget.calendarDepth, DEFAULT_BUDGET_CONFIG.calendarDepth);

// 1. Default: calendarEnabled=false, so no calendar prompt
const defaultPlanWithCalendar = buildContextInjectionPrompts({
    ...baseInjectionInput,
    budgetConfig: undefined,
    calendarStore: createEmptyCalendarStore(),
});
assert.equal(defaultPlanWithCalendar.diagnostics.calendarEnabled, false, 'calendarEnabled default false');

// 2. Enabled but empty store → no prompt
const emptyCalendarPlan = buildContextInjectionPrompts({
    ...baseInjectionInput,
    budgetConfig: {
        calendarEnabled: true,
        calendarPosition: 0,
        calendarDepth: 0,
    },
    calendarStore: createEmptyCalendarStore(),
});
assert.equal(emptyCalendarPlan.prompts.find(p => p.key.includes(':calendar:')), undefined, '空数据无 prompt');

// 3. Enabled with events → has calendar prompt, correct key format
const now = new Date();
const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
const calendarStoreWithEvents = {
    version: 1,
    scopes: {
        'story-a': {
            autoAdjust: false,
            events: {
                [today]: [
                    { id: 'evt1', date: today, title: '项目评审会', note: '准备演示文档', source: 'manual', createdAt: 100, updatedAt: 100 },
                ],
            },
            lastGeneratedAt: 0,
            lastAdjustedAt: 0,
        },
    },
};
const calendarPlan = buildContextInjectionPrompts({
    ...baseInjectionInput,
    budgetConfig: {
        targetTokens: 2000,
        calendarEnabled: true,
        calendarPosition: 1,
        calendarDepth: 2,
        sourceWeights: { phone: 1, community: 0, calendar: 1 },
        sourcePriority: ['phone', 'community', 'calendar'],
        redistributeUnused: true,
    },
    calendarStore: calendarStoreWithEvents,
});
assert.equal(calendarPlan.prompts.length, 2);
const calendarPrompt = calendarPlan.prompts.find(p => p.key.includes(':calendar:'));
assert.ok(calendarPrompt, '应有 calendar prompt');
assert.equal(calendarPrompt.key, 'PHONE_SMS_MEMORY:calendar:story-a');
assert.match(calendarPrompt.content, /项目评审会/);
assert.match(calendarPrompt.content, /准备演示文档/);
assert.equal(calendarPrompt.position, 1);
assert.equal(calendarPrompt.depth, 2);

// 4. Cross-storage: only currentStorageId's events
const calendarStoreCrossStorage = {
    version: 1,
    scopes: {
        'story-a': {
            autoAdjust: false,
            events: {
                [today]: [
                    { id: 'evt-a', date: today, title: 'Story A 事件', note: '', source: 'manual', createdAt: 100, updatedAt: 100 },
                ],
            },
            lastGeneratedAt: 0, lastAdjustedAt: 0,
        },
        'story-b': {
            autoAdjust: false,
            events: {
                [today]: [
                    { id: 'evt-b', date: today, title: 'Story B 事件', note: '', source: 'manual', createdAt: 100, updatedAt: 100 },
                ],
            },
            lastGeneratedAt: 0, lastAdjustedAt: 0,
        },
    },
};
const crossStoragePlan = buildContextInjectionPrompts({
    ...baseInjectionInput,
    budgetConfig: {
        calendarEnabled: true,
        targetTokens: 2000,
        sourceWeights: { phone: 1, community: 0, calendar: 1 },
        calendarPosition: 0,
        calendarDepth: 0,
    },
    calendarStore: calendarStoreCrossStorage,
});
const crossCalendarPrompt = crossStoragePlan.prompts.find(p => p.key.includes(':calendar:'));
assert.ok(crossCalendarPrompt, '应有 calendar prompt');
assert.match(crossCalendarPrompt.content, /Story A 事件/);
assert.doesNotMatch(crossCalendarPrompt.content, /Story B 事件/, '不应包含其他 storage 的事件');

// 5. Calendar enabled but weight=0 → calendar should get 0 allocation
const zeroWeightPlan = buildContextInjectionPrompts({
    ...baseInjectionInput,
    budgetConfig: {
        calendarEnabled: true,
        sourceWeights: { phone: 1, community: 0, calendar: 0 },
        redistributeUnused: false,
        targetTokens: 100,
        calendarPosition: 0,
        calendarDepth: 0,
    },
    calendarStore: calendarStoreWithEvents,
});
assert.equal(zeroWeightPlan.prompts.find(p => p.key.includes(':calendar:')), undefined, 'weight=0 且 redistributeUnused=false 无 calendar prompt');
