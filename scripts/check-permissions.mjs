import assert from 'node:assert/strict';
import { getStorageId } from '../src/host-context.js';
import { deriveInteractiveActorId } from '../src/interactive-scene-model.js';
import { renderCommunitySource } from '../src/community-injection.js';
import {
    applyContextInjections, buildContextInjectionPrompts, clearExtensionPrompts, renderCalendarContextInjection, replaceExtensionPrompts,
} from '../src/phone-injection.js';
import { resolveCommunitySources, resolvePhoneSources } from '../src/permissions.js';
import {
    calendarDateRangeKeys, calendarScopeFor, createEmptyCalendarStore, migrateLegacyCalendarInjectionConfig, renderCalendarInjection,
} from '../src/calendar-model.js';
import {
    normalizeRecipeStore, setRecipeRegionPreference, upsertRecipeMeal,
} from '../src/calendar-recipe-model.js';
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
const aliasedConversation = resolvePhoneSources({
    currentStorageId: 'story-a', currentActorName: 'Alice', currentConversationKey: '爱丽丝',
    selectedByStorage: { 'story-a': ['Alice', '爱丽丝'] },
    historiesByStorage: { 'story-a': {
        Alice: [{ role: 'assistant', content: '旧角色名会话不得注入' }],
        爱丽丝: [{ role: 'assistant', content: '别名会话正文' }],
    } },
    groupsByStorage: { 'story-a': {} },
});
assert.equal(aliasedConversation.allowed, true);
assert.deepEqual(aliasedConversation.sources.map(source => source.sourceId), ['爱丽丝'],
    '提供当前会话键后只能读取用户正在查看的私聊，不得同时放行宿主角色名旧键');
const legacyActorFallback = resolvePhoneSources({
    currentStorageId: 'story-a', currentActorName: 'Alice',
    selectedByStorage: { 'story-a': ['Alice'] },
    historiesByStorage: { 'story-a': { Alice: [{ role: 'assistant', content: '旧调用链正文' }] } },
    groupsByStorage: { 'story-a': {} },
});
assert.deepEqual(legacyActorFallback.sources.map(source => source.sourceId), ['Alice'],
    '旧调用方未提供当前会话键时仍须按宿主角色名授权');
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

let groupNameAccessorReads = 0;
const nameAccessorGroup = { members: ['Alice'] };
Object.defineProperty(nameAccessorGroup, 'name', {
    enumerable: true, configurable: true,
    get() { groupNameAccessorReads += 1; return '伪造群名'; },
});
const nameAccessorResult = resolvePhoneSources({
    currentStorageId: 'story-a', currentActorName: 'Alice', selectedByStorage: { 'story-a': ['__group_accessor'] },
    historiesByStorage: { 'story-a': { __group_accessor: [] } },
    groupsByStorage: { 'story-a': { __group_accessor: nameAccessorGroup } },
});
assert.equal(nameAccessorResult.allowed, false);
assert.deepEqual(nameAccessorResult.sources, []);
assert.equal(groupNameAccessorReads, 0);

let legacyInjectionAccessorReads = 0;
const injectionAccessorGroup = { name: '访问器群', members: ['Alice'] };
Object.defineProperty(injectionAccessorGroup, 'injection', {
    enumerable: true, configurable: true,
    get() { legacyInjectionAccessorReads += 1; throw new Error('旧群注入配置不得被读取'); },
});
const injectionAccessorResult = resolvePhoneSources({
    currentStorageId: 'story-a', currentActorName: 'Alice', selectedByStorage: { 'story-a': ['__group_legacy_injection'] },
    historiesByStorage: { 'story-a': { __group_legacy_injection: [] } },
    groupsByStorage: { 'story-a': { __group_legacy_injection: injectionAccessorGroup } },
});
assert.equal(injectionAccessorResult.allowed, true);
assert.equal(injectionAccessorResult.sources.length, 1);
assert.equal(legacyInjectionAccessorReads, 0);

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

for (const field of ['role', 'directorNote', 'quote']) {
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

const safeQuoteInput = {
    messageId: 'msg_snapshot', bubbleId: 'bubble_snapshot', sender: 'Alice', text: '引用快照正文',
};
const safeSnapshotInput = { role: 'assistant', content: '快照正文', quote: safeQuoteInput };
const safeGroupInput = {
    name: '快照群', members: ['Alice'], injection: { position: 2, depth: 3, historyLimit: 4 },
};
const safeSnapshotResult = resolvePhoneSources({
    currentStorageId: 'story-a', currentActorName: 'Alice',
    selectedByStorage: { 'story-a': ['Alice', '__group_snapshot'] },
    historiesByStorage: { 'story-a': { Alice: [safeSnapshotInput], __group_snapshot: [{ role: 'assistant', content: '群快照' }] } },
    groupsByStorage: { 'story-a': { __group_snapshot: safeGroupInput } },
});
assert.equal(safeSnapshotResult.allowed, true);
safeSnapshotInput.content = '事后篡改';
safeQuoteInput.text = '事后篡改引用';
assert.equal(safeSnapshotResult.sources[0].history[0].content, '快照正文');
assert.equal(safeSnapshotResult.sources[0].history[0].quote.text, '引用快照正文',
    '引用快照必须隔离后续原对象修改');
safeGroupInput.name = '篡改群名';
safeGroupInput.members[0] = 'Mallory';
const safeGroupSnapshot = safeSnapshotResult.sources.find(source => source.sourceId === '__group_snapshot').meta;
assert.equal(safeGroupSnapshot.name, '快照群');
assert.deepEqual(safeGroupSnapshot.members, ['Alice']);
assert.equal(Object.hasOwn(safeGroupSnapshot, 'injection'), false,
    '权限快照不得携带旧群级注入配置');

const sparseSelection = [];
sparseSelection.length = 1;
assert.equal(resolvePhoneSources({
    currentStorageId: 'story-a', currentActorName: 'Alice',
    selectedByStorage: { 'story-a': sparseSelection }, historiesByStorage: { 'story-a': {} },
}).allowed, false);

const actorId = deriveInteractiveActorId('story-a', 'story', 'character:alice');
const scene = {
    id: 'scene-a', title: '社区', preset: 'weibo', styleInput: '', generatedPrompt: '', createdAt: 1, updatedAt: 2,
    posts: [
        { id: 'post-a', authorId: actorId, authorNameSnapshot: 'Alice', content: '帖子正文', tags: [], createdAt: 2, comments: [{ id: 'comment-a', authorId: actorId, authorNameSnapshot: 'Alice', content: '评论正文', createdAt: 3 }], liked: false },
        { id: 'post-new', authorId: actorId, authorNameSnapshot: 'Alice', content: '新帖子正文', tags: [], createdAt: 3, comments: [], liked: false },
    ],
    live: { title: '直播', status: 'idle', danmaku: [{ id: 'danmaku-a', authorId: actorId, authorNameSnapshot: 'Alice', content: '弹幕正文', createdAt: 4 }] },
};
const store = { version: 2, scopes: { 'story-a': { activeSceneId: 'scene-a', sceneOrder: ['scene-a'], actors: { [actorId]: { actorId, type: 'story', displayName: 'Alice', bindingKey: 'character:alice', profile: '', createdAt: 1 } }, scenes: { 'scene-a': scene } } } };
assert.deepEqual(resolveCommunitySources({ currentStorageId: 'story-a', enabled: false, sceneIdsByStorage: { 'story-a': ['scene-a'] }, store }).sources, []);
const community = resolveCommunitySources({ currentStorageId: 'story-a', enabled: true, sceneIdsByStorage: { 'story-a': ['scene-a', 'deleted'] }, store });
assert.equal(community.allowed, true);
assert.deepEqual(community.sources.map(source => source.sourceId), ['scene-a']);
assert.deepEqual(community.sources[0].selection, { mode: 'all', postIds: [] });
assert.match(renderCommunitySource(community.sources[0]), /帖子正文/);
assert.match(renderCommunitySource(community.sources[0]), /评论正文/);
assert.match(renderCommunitySource(community.sources[0]), /新帖子正文/);
assert.match(renderCommunitySource(community.sources[0]), /弹幕正文/);

const selectedCommunity = resolveCommunitySources({
    currentStorageId: 'story-a', enabled: true,
    sceneIdsByStorage: { 'story-a': ['scene-a'] },
    selectionsByStorage: {
        'story-a': { 'scene-a': { mode: 'selected', postIds: ['post-a', 'deleted-post'] } },
    },
    store,
});
assert.equal(selectedCommunity.allowed, true);
assert.deepEqual(selectedCommunity.sources[0].selection, {
    mode: 'selected', postIds: ['post-a', 'deleted-post'],
});
const selectedCommunityText = renderCommunitySource(selectedCommunity.sources[0]);
assert.match(selectedCommunityText, /帖子正文/);
assert.match(selectedCommunityText, /评论正文/);
assert.doesNotMatch(selectedCommunityText, /新帖子正文/);
assert.match(selectedCommunityText, /弹幕正文/);
assert.equal(resolveCommunitySources({
    currentStorageId: 'story-a', enabled: true,
    sceneIdsByStorage: { 'story-a': ['scene-a'] },
    selectionsByStorage: { 'story-a': { 'scene-a': { mode: 'selected', postIds: 'post-a' } } },
    store,
}).reason, 'invalid-post-selection');

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
        'story-a': {
            Alice: [{
                role: 'user', content: '允许的短信',
                quote: {
                    messageId: 'msg_production', bubbleId: 'bubble_production',
                    sender: 'Alice', text: '必须保留的引用快照',
                },
            }],
            Bob: [{ role: 'assistant', content: 'Bob 私聊' }],
        },
        'story-b': { Alice: [{ role: 'assistant', content: '其他角色卡短信' }] },
    },
    groupsByStorage: {}, interactiveStore: store,
};
const defaultPlan = buildContextInjectionPrompts({ ...baseInjectionInput, budgetConfig: undefined });
assert.equal(defaultPlan.prompts.length, 1);
assert.match(defaultPlan.prompts[0].content, /^\[手机短信记忆 — 私密\]\n/);
assert.match(defaultPlan.prompts[0].content, /允许的短信/);
assert.match(defaultPlan.prompts[0].content, /\n\[结束\]$/);
assert.doesNotMatch(defaultPlan.prompts[0].content, /Bob 私聊|其他角色卡短信|帖子正文/);
assert.equal(defaultPlan.diagnostics.communityPermission.reason, 'disabled');
assert.equal(defaultPlan.diagnostics.phone.promptCount, 1);

const productionPhoneCalls = [];
const productionPhoneResult = applyContextInjections({
    context: { setExtensionPrompt: (...args) => productionPhoneCalls.push(args) },
    runtime: { trackedExtensionPromptKeys: new Set() },
    ...baseInjectionInput,
    injectionConfig: { position: 1, depth: 0, historyLimit: 20 },
    budgetConfig: {
        targetTokens: 3000,
        sourceWeights: { phone: 1, community: 0, calendar: 0, recipe: 0 },
        sourcePriority: ['phone', 'community', 'calendar', 'recipe'],
        redistributeUnused: true,
    },
    safeMaxTokens: 3000,
});
const productionPhoneWrite = productionPhoneCalls.find(call => String(call[1]).startsWith('[手机短信记忆 — 私密]\n'));
assert.ok(productionPhoneWrite, '已启用当前角色且手机预算为 3000 时必须实际写入私密短信 prompt');
assert.match(productionPhoneWrite[1], /引用 Alice 的消息：“必须保留的引用快照”/,
    '生产手机注入链必须把引用快照写入最终 Extension Prompt');
assert.equal(productionPhoneWrite[2], 1, '聊天记录内注入必须使用 IN_CHAT 位置');
assert.equal(productionPhoneWrite[3], 0, '深度 0 必须原样传给宿主');
assert.equal(productionPhoneResult.writtenBySource.phone, 1);
assert.equal(productionPhoneResult.diagnostics.phone.promptCount, 1);

const zeroPhonePlan = buildContextInjectionPrompts({
    ...baseInjectionInput,
    budgetConfig: {
        targetTokens: 3000,
        sourceWeights: { phone: 0, community: 1, calendar: 0, recipe: 0 },
        redistributeUnused: false,
        communityEnabled: false,
    },
});
assert.equal(zeroPhonePlan.diagnostics.phone.allocatedTokens, 0);
assert.equal(zeroPhonePlan.diagnostics.phone.promptCount, 0);

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
assert.deepEqual(migratedTwoSourceBudget.sourceWeights, { phone: 3, community: 1, calendar: 0, recipe: 0 });
assert.deepEqual(migratedTwoSourceBudget.sourcePriority, ['community', 'phone', 'calendar', 'recipe']);
assert.equal(Object.hasOwn(migratedTwoSourceBudget, 'calendarEnabled'), false);
assert.equal(migratedTwoSourceBudget.calendarPosition, DEFAULT_BUDGET_CONFIG.calendarPosition);
assert.equal(migratedTwoSourceBudget.calendarDepth, DEFAULT_BUDGET_CONFIG.calendarDepth);

const untouchedCalendarMigration = migrateLegacyCalendarInjectionConfig(createEmptyCalendarStore(), {});
assert.equal(untouchedCalendarMigration.migrated, false, '没有旧开关时不得伪造迁移完成状态');
assert.equal(untouchedCalendarMigration.store.legacyInjectionMigrated, undefined);

const legacyDisabledMigration = migrateLegacyCalendarInjectionConfig({
    version: 1,
    scopes: {
        inherited: { events: {} },
        explicit: { events: {}, injectionScheduleEnabled: true, injectionRecipeEnabled: true },
    },
}, { calendarEnabled: false, recipeEnabled: false });
assert.equal(legacyDisabledMigration.migrated, true);
assert.equal(legacyDisabledMigration.store.legacyInjectionMigrated, true);
assert.deepEqual(legacyDisabledMigration.store.injectionDefaults, {
    injectionScheduleEnabled: false,
    injectionWeatherEnabled: false,
    injectionCycleEnabled: false,
    injectionRecipeEnabled: false,
});
assert.deepEqual(calendarScopeFor(legacyDisabledMigration.store, 'inherited'), {
    ...calendarScopeFor(legacyDisabledMigration.store, 'inherited'),
    injectionScheduleEnabled: false,
    injectionWeatherEnabled: false,
    injectionCycleEnabled: false,
    injectionRecipeEnabled: false,
});
assert.equal(calendarScopeFor(legacyDisabledMigration.store, 'explicit').injectionScheduleEnabled, true,
    '既有 scope 的显式日程开关不得被旧总开关覆盖');
assert.equal(calendarScopeFor(legacyDisabledMigration.store, 'explicit').injectionRecipeEnabled, true,
    '既有 scope 的显式菜谱开关不得被旧总开关覆盖');
const futureScope = calendarScopeFor(legacyDisabledMigration.store, 'future-storage');
assert.equal(futureScope.injectionScheduleEnabled, false);
assert.equal(futureScope.injectionWeatherEnabled, false);
assert.equal(futureScope.injectionCycleEnabled, false);
assert.equal(futureScope.injectionRecipeEnabled, false, '迁移后的新 scope 必须继承旧用户关闭状态');

// 1. Default scope switches are enabled, but an empty store still emits no calendar prompt
const defaultPlanWithCalendar = buildContextInjectionPrompts({
    ...baseInjectionInput,
    budgetConfig: undefined,
    calendarStore: createEmptyCalendarStore(),
});
assert.equal(defaultPlanWithCalendar.diagnostics.calendarEnabled, true, '新 scope 的日历模块开关默认开启');
assert.equal(defaultPlanWithCalendar.prompts.some(prompt => prompt.key.includes(':calendar:')), false, '空数据不得生成日历 prompt');

// 2. Enabled but empty store → no prompt
const emptyCalendarPlan = buildContextInjectionPrompts({
    ...baseInjectionInput,
    budgetConfig: {
        calendarPosition: 0,
        calendarDepth: 0,
    },
    calendarStore: createEmptyCalendarStore(),
});
assert.equal(emptyCalendarPlan.prompts.find(p => p.key.includes(':calendar:')), undefined, '空数据无 prompt');

// 3. Enabled with events → has calendar prompt, correct key format
const now = new Date();
const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
const threeDaysAgo = calendarDateRangeKeys(now, -3, -3)[0];
const sixDaysLater = calendarDateRangeKeys(now, 6, 6)[0];
const fiftyNineDaysLater = calendarDateRangeKeys(now, 59, 59)[0];
const calendarStoreWithEvents = {
    version: 1,
    scopes: {
        'story-a': {
            autoAdjust: false,
            events: {
                [threeDaysAgo]: [
                    { id: 'evt-past', date: threeDaysAgo, title: '三日前复盘', note: '', source: 'manual', createdAt: 99, updatedAt: 99 },
                ],
                [today]: [
                    { id: 'evt1', date: today, title: '项目评审会', note: '准备演示文档', source: 'manual', createdAt: 100, updatedAt: 100 },
                ],
                [sixDaysLater]: [
                    { id: 'evt-future', date: sixDaysLater, title: '六日后交付', note: '', source: 'manual', createdAt: 101, updatedAt: 101 },
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

const todayParts = today.split('-').map(Number);
const fullCalendarBody = renderCalendarContextInjection({
    currentStorageId: 'story-a',
    currentActorName: '角色甲',
    calendarStore: calendarStoreWithEvents,
    occasionStore: { version: 1, scopes: { 'story-a': { occasions: [{
        id: 'occasion', type: 'birthday', month: todayParts[1], day: todayParts[2], title: '角色生日', note: '准备蛋糕', leapDayRule: 'feb28', createdAt: 1, updatedAt: 1,
    }, {
        id: 'occasion-59', type: 'anniversary', month: Number(fiftyNineDaysLater.slice(5, 7)), day: Number(fiftyNineDaysLater.slice(8, 10)), title: '五十九日纪念', note: '', leapDayRule: 'feb28', createdAt: 2, updatedAt: 2,
    }] } } },
    holidayStore: { version: 1, selectedCountry: 'CN', years: { [`CN:${todayParts[0]}`]: {
        country: 'CN', year: todayParts[0], fetchedAt: 1, source: 'test', entries: [{ date: today, name: '生活节', kind: 'holiday', source: 'test' }],
    } } },
    weatherStore: { version: 1, location: { name: '上海', latitude: 31.2, longitude: 121.4, country: 'CN', admin1: '上海', timezone: 'Asia/Shanghai' }, lastSuccess: {
        locationKey: '31.2,121.4|上海', fetchedAt: 1, source: 'forecast', forecast: { days: [{ date: today, weatherCode: 1, tempMin: 20, tempMax: 30 }] },
    } },
    cycleStore: { version: 1, scopes: { 'story-a': {
        enabled: true, lastPeriodStart: today, cycleLength: 28, periodLength: 5, overrides: {},
        subjects: { 'role:角色乙': { enabled: true, lastPeriodStart: today, cycleLength: 30, periodLength: 4, overrides: {} } },
    } } },
    start: now,
});
assert.match(fullCalendarBody, /项目评审会/);
assert.match(fullCalendarBody, new RegExp(`大前天 ${threeDaysAgo}｜[^\\n]*日程：三日前复盘`));
assert.match(fullCalendarBody, new RegExp(`六天后 ${sixDaysLater}｜[^\\n]*日程：六日后交付`));
assert.match(fullCalendarBody, /生日：角色生日/);
assert.match(fullCalendarBody, new RegExp(`${fiftyNineDaysLater}｜纪念日：五十九日纪念`), '生日与纪念日必须覆盖未来 60 天');
assert.match(fullCalendarBody, /节假日：生活节/);
assert.match(fullCalendarBody, /生理周期（我）：经期/);
assert.match(fullCalendarBody, /生理周期（角色乙）：经期/);
assert.match(fullCalendarBody, /生理周期规则：对所有已启用对象，未注明经期或易孕期的日期按安全期理解。/);
assert.equal((fullCalendarBody.match(/生理周期规则：/g) || []).length, 1, '所有启用周期对象必须共用一条完整安全期规则');
assert.match(fullCalendarBody, /今天 [^｜]+｜天气（真实预报）：少云，20°\/30°C/);
assert.match(fullCalendarBody, /天气（气候推演）：/);
assert.equal((fullCalendarBody.match(new RegExp(`${today}｜`, 'g')) || []).length, 1, '同一天必须只输出一个日期标题');
const otherStorageBody = renderCalendarContextInjection({
    currentStorageId: 'story-b', calendarStore: calendarStoreWithEvents,
    occasionStore: { version: 1, scopes: { 'story-a': { occasions: [{ id: 'private', type: 'birthday', month: todayParts[1], day: todayParts[2], title: '私密生日' }] } } },
    start: now,
});
assert.doesNotMatch(otherStorageBody, /角色生日|私密生日|项目评审会/, '生活日历不得串用其他 storageId 的私有数据');
assert.doesNotMatch(otherStorageBody, /生理周期规则|安全期理解/, '没有启用周期资料的会话不得生成安全期默认规则');

const maximumCycleSubjects = Object.fromEntries(Array.from({ length: 40 }, (_, index) => {
    const suffix = String(index).padStart(2, '0');
    const subject = `role:${`角色${suffix}`.padEnd(115, String(index % 10))}`;
    return [subject, { enabled: true, lastPeriodStart: today, cycleLength: 28, periodLength: 5, overrides: {} }];
}));
const maximumCycleBody = renderCalendarContextInjection({
    currentStorageId: 'story-limit',
    calendarStore: { version: 1, scopes: { 'story-limit': { injectionScheduleEnabled: false, injectionWeatherEnabled: false, injectionCycleEnabled: true, events: {} } } },
    cycleStore: { version: 1, scopes: { 'story-limit': {
        enabled: true, lastPeriodStart: today, cycleLength: 28, periodLength: 5, overrides: {},
        subjects: maximumCycleSubjects,
    } } },
    start: now,
});
const maximumCycleRule = maximumCycleBody.split('\n')[0];
assert.equal(maximumCycleRule, '生理周期规则：对所有已启用对象，未注明经期或易孕期的日期按安全期理解。',
    '周期规则不得在字符上限处被截成半行');
for (const subject of Object.keys(maximumCycleSubjects)) {
    assert.match(maximumCycleBody, new RegExp(`生理周期（${subject.slice(5)}）：经期`),
        `合法上限周期对象不得丢失日期事实：${subject}`);
}
assert.ok(maximumCycleBody.length <= 6000, '日历上下文仍须遵守 6000 字符上限');

const storyDate = '2032-03-15';
const storyCalendarPlan = buildContextInjectionPrompts({
    ...baseInjectionInput,
    budgetConfig: {
        targetTokens: 2000,
        calendarPosition: 1,
        calendarDepth: 2,
        sourceWeights: { phone: 0, community: 0, calendar: 1 },
        sourcePriority: ['calendar', 'phone', 'community'],
        redistributeUnused: true,
    },
    calendarStore: { version: 1, scopes: { 'story-a': {
        baseDate: storyDate, autoAdjust: false,
        events: {
            [storyDate]: [{ id: 'story-event', date: storyDate, title: '架空纪元会议', note: '', source: 'manual', createdAt: 1, updatedAt: 1 }],
            [today]: [{ id: 'device-event', date: today, title: '设备日期诱饵', note: '', source: 'manual', createdAt: 1, updatedAt: 1 }],
        },
        lastGeneratedAt: 0, lastAdjustedAt: 0,
    } } },
    calendarOccasions: { version: 1, scopes: { 'story-a': { occasions: [{
        id: 'story-occasion', type: 'anniversary', month: 3, day: 15, title: '架空纪念日', note: '', leapDayRule: 'feb28', createdAt: 1, updatedAt: 1,
    }] } } },
    calendarHolidays: { version: 1, selectedCountry: 'CN', years: { 'CN:2032': {
        country: 'CN', year: 2032, fetchedAt: 1, source: 'test', entries: [{ date: storyDate, name: '架空节', kind: 'holiday', source: 'test' }],
    } } },
    calendarWeather: {
        version: 1, location: { name: '上海', latitude: 31.2, longitude: 121.4, country: 'CN', admin1: '上海', timezone: 'Asia/Shanghai' },
        lastSuccess: { locationKey: '31.2,121.4|上海', fetchedAt: 1, source: 'forecast', forecast: { days: [{ date: storyDate, weatherCode: 1, tempMin: 10, tempMax: 20 }] } },
    },
    calendarCycles: { version: 1, scopes: { 'story-a': { enabled: true, lastPeriodStart: storyDate, cycleLength: 28, periodLength: 5, overrides: {} } } },
});
const storyCalendarPrompt = storyCalendarPlan.prompts.find(prompt => prompt.key.includes(':calendar:'));
assert.ok(storyCalendarPrompt, '配置时间起点时应生成日历 prompt');
assert.match(storyCalendarPrompt.content, /生理周期规则：对所有已启用对象，未注明经期或易孕期的日期按安全期理解。/);
assert.match(storyCalendarPrompt.content, /今天 2032-03-15｜天气（真实预报）：少云，10°\/20°C；日程：架空纪元会议；纪念日：架空纪念日；节假日：架空节；生理周期（我）：经期/);
assert.match(storyCalendarPrompt.content, /天气（气候推演）：/, '故事日期窗口中预报外日期必须使用气候推演');
assert.equal((storyCalendarPrompt.content.match(/2032-03-15｜/g) || []).length, 1, '同日事实必须合并为单个日期标题');
assert.doesNotMatch(storyCalendarPrompt.content, /设备日期诱饵/,
    '最终日历 prompt 必须使用 scope.baseDate窗口，不得泄漏设备日期诱饵');

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
        sourceWeights: { phone: 1, community: 0, calendar: 0 },
        redistributeUnused: false,
        targetTokens: 100,
        calendarPosition: 0,
        calendarDepth: 0,
    },
    calendarStore: calendarStoreWithEvents,
});
assert.equal(zeroWeightPlan.prompts.find(p => p.key.includes(':calendar:')), undefined, 'weight=0 且 redistributeUnused=false 无 calendar prompt');

// === Recipe injection tests ===
let recipeScope = setRecipeRegionPreference({}, '架空北境');
for (const [offset, mealType, text] of [
    [-2, 'breakfast', '窗口外前日餐'], [-1, 'breakfast', '昨日麦粥'], [0, 'lunch', '今日炖肉'],
    [1, 'dinner', '明日烤鱼'], [2, 'snack', '窗口外后日餐'],
]) {
    recipeScope = upsertRecipeMeal(recipeScope, {
        date: calendarDateRangeKeys(new Date(`${storyDate}T12:00:00`), offset, offset)[0], mealType, text,
    }, 1);
}
const recipeStore = normalizeRecipeStore({ version: 1, scopes: { 'story-a': recipeScope, 'story-b': {
    ...setRecipeRegionPreference({}, '泄漏地区'),
    days: { [storyDate]: { breakfast: { text: '其他会话早餐', source: 'manual', updatedAt: 1 } } },
} } });
const recipePlan = buildContextInjectionPrompts({
    ...baseInjectionInput,
    budgetConfig: {
        targetTokens: 2000, calendarPosition: 2, calendarDepth: 4,
        sourceWeights: { phone: 0, community: 0, calendar: 0, recipe: 1 },
        sourcePriority: ['recipe', 'phone', 'community', 'calendar'], redistributeUnused: true,
    },
    calendarStore: { version: 1, scopes: { 'story-a': {
        baseDate: storyDate,
        events: {},
        injectionScheduleEnabled: false,
        injectionWeatherEnabled: false,
        injectionCycleEnabled: false,
        injectionRecipeEnabled: true,
    } } },
    calendarRecipes: recipeStore,
});
const recipePrompt = recipePlan.prompts.find(prompt => prompt.key.includes(':recipe:'));
assert.ok(recipePrompt, '启用且有数据时必须生成独立菜谱 prompt');
assert.equal(recipePrompt.key, 'PHONE_SMS_MEMORY:recipe:story-a');
assert.equal(recipePrompt.position, 2);
assert.equal(recipePrompt.depth, 4);
assert.match(recipePrompt.content, /\[角色菜谱\]/);
assert.match(recipePrompt.content, /饮食地区\/文化：架空北境/);
assert.match(recipePrompt.content, /昨日麦粥|今日炖肉|明日烤鱼/);
assert.doesNotMatch(recipePrompt.content, /窗口外前日餐|窗口外后日餐|泄漏地区|其他会话早餐/,
    '菜谱注入必须严格限制 -1...+1 且按 storageId 隔离');
assert.notEqual(recipePrompt.key, 'PHONE_SMS_MEMORY:calendar:story-a', '菜谱必须使用独立注入 key');
assert.equal(recipePlan.prompts.some(prompt => prompt.key.includes(':calendar:')), false,
    '菜谱 prompt 不得复用生活日历 key');
assert.equal(recipePlan.diagnostics.recipeEnabled, true);
const disabledRecipePlan = buildContextInjectionPrompts({
    ...baseInjectionInput,
    budgetConfig: { sourceWeights: { phone: 1, recipe: 0 } },
    calendarStore: { version: 1, scopes: { 'story-a': {
        baseDate: storyDate,
        events: {},
        injectionRecipeEnabled: false,
    } } },
    calendarRecipes: recipeStore,
});
assert.equal(disabledRecipePlan.prompts.some(prompt => prompt.key.includes(':recipe:')), false);
assert.equal(disabledRecipePlan.diagnostics.recipeEnabled, false);
