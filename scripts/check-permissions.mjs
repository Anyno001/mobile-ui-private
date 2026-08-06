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
import {
    normalizeOutfitStore, updateOutfitProfile, upsertOutfit,
} from '../src/calendar-outfit-model.js';
import { allocateContextBudget, estimateContextTokens, normalizeBudgetConfig, BUDGET_SOURCES, DEFAULT_BUDGET_CONFIG } from '../src/budget.js';

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
assert.deepEqual(phone.sources.map(source => source.sourceId), ['Alice', 'Bob', '__group_team'],
    '联系人下拉中显式点亮的同一存储会话都应参与手机 Prompt 来源解析');
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
assert.deepEqual(aliasedConversation.sources.map(source => source.sourceId), ['Alice', '爱丽丝'],
    '当前会话键不得覆盖助手已显式点亮的其他同存储私聊');
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
    get() { unauthorizedHistoryReads += 1; return '恶意访问器不得读取'; },
});
const unauthorizedGroup = resolvePhoneSources({
    currentStorageId: 'story-a', currentActorName: 'Alice', selectedByStorage: { 'story-a': ['__group_other'] },
    historiesByStorage: { 'story-a': { __group_other: [unauthorizedMessage] } },
    groupsByStorage: { 'story-a': { __group_other: { name: '他人群', members: ['Bob'] } } },
});
assert.equal(unauthorizedGroup.allowed, false,
    '显式群聊授权不应跳过历史结构审计');
assert.deepEqual(unauthorizedGroup.sources, []);
assert.equal(unauthorizedHistoryReads, 0);
const explicitNonMemberGroup = resolvePhoneSources({
    currentStorageId: 'story-a', currentActorName: 'Alice', selectedByStorage: { 'story-a': ['__group_other'] },
    historiesByStorage: { 'story-a': { __group_other: [{ role: 'assistant', content: '用户明确选择的群聊正文' }] } },
    groupsByStorage: { 'story-a': { __group_other: { name: '他人群', members: ['Bob'] } } },
});
assert.equal(explicitNonMemberGroup.allowed, true);
assert.deepEqual(explicitNonMemberGroup.sources.map(source => source.sourceId), ['__group_other'],
    '当前角色不在成员表中不得阻止用户显式点亮的群聊参与注入');

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
const community = resolveCommunitySources({ currentStorageId: 'story-a', sceneIdsByStorage: { 'story-a': ['scene-a', 'deleted'] }, store });
assert.equal(community.allowed, true);
assert.deepEqual(community.sources.map(source => source.sourceId), ['scene-a']);
assert.deepEqual(community.sources[0].selection, { mode: 'all', postIds: [] });
assert.match(renderCommunitySource(community.sources[0]), /帖子正文/);
assert.match(renderCommunitySource(community.sources[0]), /评论正文/);
assert.match(renderCommunitySource(community.sources[0]), /新帖子正文/);
assert.match(renderCommunitySource(community.sources[0]), /弹幕正文/);

const selectedCommunity = resolveCommunitySources({
    currentStorageId: 'story-a',
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
    currentStorageId: 'story-a',
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
    currentStorageId: 'story-a',
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
    currentStorageId: 'story-a',
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
        currentStorageId: 'story-a',
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
    currentStorageId: 'story-a',
    sceneIdsByStorage: { 'story-a': accessorSceneSelection }, store,
});
assert.equal(accessorSceneSelectionResult.allowed, false);
assert.deepEqual(accessorSceneSelectionResult.sources, []);
assert.equal(communityIndexGetterReads, 0);

const sparseSceneSelection = [];
sparseSceneSelection.length = 1;
assert.equal(resolveCommunitySources({
    currentStorageId: 'story-a',
    sceneIdsByStorage: { 'story-a': sparseSceneSelection }, store,
}).allowed, false);

let actorDisplayNameReads = 0;
const accessorActor = { actorId, type: 'story', bindingKey: 'character:alice', profile: '', createdAt: 1 };
Object.defineProperty(accessorActor, 'displayName', {
    enumerable: true,
    get() { actorDisplayNameReads += 1; return '伪造作者'; },
});
const actorAccessorResult = resolveCommunitySources({
    currentStorageId: 'story-a',
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
assert.equal(defaultPlan.prompts.length, 2);
const defaultPhonePrompts = defaultPlan.prompts.filter(prompt => prompt.source === 'phone');
assert.equal(defaultPhonePrompts.length, 2);
assert.match(defaultPhonePrompts[0].content, /^\[手机短信记忆 — 私密\]\n/);
assert.match(defaultPhonePrompts[0].content, /允许的短信/);
assert.match(defaultPhonePrompts[1].content, /Bob 私聊/);
assert.ok(defaultPhonePrompts.every(prompt => /\n\[结束\]$/.test(prompt.content)));
assert.ok(defaultPhonePrompts.every(prompt => !/其他角色卡短信|帖子正文/.test(prompt.content)));
assert.equal(defaultPlan.diagnostics.communityPermission.reason, 'no-selection');
assert.equal(defaultPlan.diagnostics.phone.promptCount, 2);

const groupedBubblePlan = buildContextInjectionPrompts({
    currentStorageId: 'story-a', currentActorName: 'Alice', userName: 'User', emojis: [],
    selectedByStorage: { 'story-a': ['Alice'] },
    historiesByStorage: { 'story-a': { Alice: [
        { role: 'assistant', content: '第一条' },
        { role: 'assistant', content: '第二条' },
        { role: 'assistant', content: '第三条' },
        { role: 'user', content: '回复一' },
        { role: 'user', content: '回复二' },
        { role: 'assistant', content: '第四条' },
    ] } },
    groupsByStorage: {}, interactiveStore: store,
});
const groupedBubblePrompt = groupedBubblePlan.prompts.find(prompt => prompt.source === 'phone');
assert.match(groupedBubblePrompt.content, /Alice：第一条｜第二条｜第三条\nUser：回复一｜回复二\nAlice：第四条/,
    '单聊正文注入必须合并连续同发送者气泡，并在发送者切换时换行');

const groupBubblePlan = buildContextInjectionPrompts({
    currentStorageId: 'story-a', currentActorName: 'Alice', userName: 'User', emojis: [],
    selectedByStorage: { 'story-a': ['__group_team'] },
    historiesByStorage: { 'story-a': { __group_team: [
        { role: 'assistant', content: '群消息一' }, { role: 'assistant', content: '群消息二' },
    ] } },
    groupsByStorage: { 'story-a': { __group_team: { name: '测试群', members: ['Alice', 'Bob'] } } },
    interactiveStore: store,
});
const groupBubblePrompt = groupBubblePlan.prompts.find(prompt => prompt.source === 'phone');
assert.match(groupBubblePrompt.content, /群消息一\n群消息二/,
    '群聊正文注入必须维持逐气泡换行，不受单聊合并规则影响');

const productionPhoneCalls = [];
const productionPhoneResult = applyContextInjections({
    context: { setExtensionPrompt: (...args) => productionPhoneCalls.push(args) },
    runtime: { trackedExtensionPromptKeys: new Set() },
    ...baseInjectionInput,
    injectionConfig: { phone: { position: 1, depth: 0, historyLimit: 20 } },
    budgetConfig: {
        targetTokens: 3000,
        sourceWeights: { phone: 1, community: 0, calendar: 0, todayTrend: 0 },
        sourcePriority: ['phone', 'community', 'calendar', 'todayTrend'],
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
assert.equal(productionPhoneResult.writtenBySource.phone, 2);
assert.equal(productionPhoneResult.diagnostics.phone.promptCount, 2);

const zeroPhonePlan = buildContextInjectionPrompts({
    ...baseInjectionInput,
    budgetConfig: {
        targetTokens: 3000,
        sourceWeights: { phone: 0, community: 1, calendar: 0, todayTrend: 0 },
        redistributeUnused: false,
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
        communitySceneIdsByStorage: { 'story-a': ['scene-a'] },
    },
    injectionConfig: { community: { position: 2, depth: 3 } },
});
assert.equal(communityPlan.prompts.length, 3);
const communityPrompt = communityPlan.prompts.find(prompt => prompt.key.includes(':community:'));
assert.ok(communityPrompt);
assert.match(communityPrompt.content, /帖子正文/);
assert.equal(communityPrompt.position, 2);
assert.equal(communityPrompt.depth, 3);
const productionCommunityCalls = [];
const productionCommunityResult = applyContextInjections({
    context: { setExtensionPrompt: (...args) => productionCommunityCalls.push(args) },
    runtime: { trackedExtensionPromptKeys: new Set() },
    ...baseInjectionInput,
    injectionConfig: { community: { position: 2, depth: 3 } },
    budgetConfig: {
        targetTokens: 3000,
        sourceWeights: { phone: 0, community: 1, calendar: 0, todayTrend: 0 },
        redistributeUnused: false,
        communitySceneIdsByStorage: { 'story-a': ['scene-a'] },
        communitySelectionsByStorage: { 'story-a': { 'scene-a': { mode: 'selected', postIds: ['post-a'] } } },
    },
    safeMaxTokens: 3000,
});
const productionCommunityWrite = productionCommunityCalls.find(call => String(call[1]).startsWith('[互动社区记忆 — 当前角色可见]\n'));
assert.ok(productionCommunityWrite, '社区注入必须实际写入宿主 Extension Prompt');
assert.match(productionCommunityWrite[0], /:community:/);
assert.match(productionCommunityWrite[1], /帖子正文[\s\S]*评论正文/);
assert.doesNotMatch(productionCommunityWrite[1], /新帖子正文/);
assert.equal(productionCommunityWrite[2], 2);
assert.equal(productionCommunityWrite[3], 3);
assert.equal(productionCommunityResult.writtenBySource.community, 1);
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
});
assert.deepEqual(migratedTwoSourceBudget.sourceWeights, { phone: 3, community: 1, calendar: 0, todayTrend: 0 });
assert.deepEqual(migratedTwoSourceBudget.sourcePriority, ['community', 'phone', 'calendar', 'todayTrend']);
assert.equal(Object.hasOwn(migratedTwoSourceBudget, 'calendarEnabled'), false);
assert.equal(Object.hasOwn(migratedTwoSourceBudget, 'calendarPosition'), false);
assert.equal(Object.hasOwn(migratedTwoSourceBudget, 'calendarDepth'), false);

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
    injectionOutfitEnabled: true,
});
assert.deepEqual(calendarScopeFor(legacyDisabledMigration.store, 'inherited'), {
    ...calendarScopeFor(legacyDisabledMigration.store, 'inherited'),
    injectionScheduleEnabled: false,
    injectionWeatherEnabled: false,
    injectionCycleEnabled: false,
    injectionRecipeEnabled: false,
    injectionOutfitEnabled: true,
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
    injectionConfig: { calendar: { position: 0, depth: 0 } },
    calendarStore: createEmptyCalendarStore(),
});
assert.equal(emptyCalendarPlan.prompts.find(p => p.key.includes(':calendar:')), undefined, '空数据无 prompt');

// 3. Enabled with events → has calendar prompt, correct key format
const now = new Date();
const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
const threeDaysAgo = calendarDateRangeKeys(now, -3, -3)[0];
const twoDaysAgo = calendarDateRangeKeys(now, -2, -2)[0];
const yesterday = calendarDateRangeKeys(now, -1, -1)[0];
const sixDaysLater = calendarDateRangeKeys(now, 6, 6)[0];
const sevenDaysLater = calendarDateRangeKeys(now, 7, 7)[0];
const thirtyDaysLater = calendarDateRangeKeys(now, 30, 30)[0];
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
    injectionConfig: { calendar: { position: 1, depth: 2 } },
    budgetConfig: {
        targetTokens: 2000,
        sourceWeights: { phone: 1, community: 0, calendar: 1 },
        sourcePriority: ['phone', 'community', 'calendar'],
        redistributeUnused: true,
    },
    calendarStore: calendarStoreWithEvents,
});
assert.equal(calendarPlan.prompts.length, 3);
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
assert.match(fullCalendarBody, /生理周期（<user>）：经期/);
assert.match(fullCalendarBody, /生理周期（角色乙）：经期/);
assert.doesNotMatch(fullCalendarBody, /生理周期规则：/, '逐日周期标签不得保留默认安全期推断规则');
const recurrenceWindowBody = renderCalendarContextInjection({
    currentStorageId: 'recurrence-window',
    calendarStore: { version: 1, scopes: { 'recurrence-window': { injectionScheduleEnabled: true, events: {} } } },
    occasionStore: { version: 1, scopes: { 'recurrence-window': { occasions: [{
        id: 'daily-short', type: 'anniversary', date: threeDaysAgo,
        month: Number(threeDaysAgo.slice(5, 7)), day: Number(threeDaysAgo.slice(8, 10)),
        title: '每日短周期', note: '', repeat: 'daily', leapDayRule: 'feb28', createdAt: 1, updatedAt: 1,
    }, {
        id: 'custom-29', type: 'anniversary', date: today,
        month: todayParts[1], day: todayParts[2], title: '二十九日周期', note: '', repeat: 'custom', intervalDays: 29,
        leapDayRule: 'feb28', createdAt: 2, updatedAt: 2,
    }, {
        id: 'custom-30', type: 'anniversary', date: today,
        month: todayParts[1], day: todayParts[2], title: '三十日周期', note: '', repeat: 'custom', intervalDays: 30,
        leapDayRule: 'feb28', createdAt: 3, updatedAt: 3,
    }] } } },
    start: now,
});
assert.equal((recurrenceWindowBody.match(/每日重复日程：每日短周期/g) || []).length, 10,
    '小于 30 天的重复日程必须只按普通日程的前 3 天至后 6 天窗口注入');
assert.doesNotMatch(recurrenceWindowBody, new RegExp(`${sevenDaysLater}｜[^\n]*每日重复日程：每日短周期`),
    '短周期重复日程不得扩展到普通日程窗口之外');
assert.equal((recurrenceWindowBody.match(/自定义周期日程：二十九日周期/g) || []).length, 1,
    '29 天重复日程不得按两个月范围重复展开');
assert.match(recurrenceWindowBody, new RegExp(`${thirtyDaysLater}｜[^\n]*自定义周期日程：三十日周期`),
    '30 天重复日程必须保留两个月范围内的后续实例');
const relativeSafeWindow = renderCalendarContextInjection({
    currentStorageId: 'cycle-window',
    calendarStore: { version: 1, scopes: { 'cycle-window': { injectionCycleEnabled: true, events: {} } } },
    cycleStore: { version: 1, scopes: { 'cycle-window': {
        enabled: true, lastPeriodStart: calendarDateRangeKeys(now, -6, -6)[0], cycleLength: 28, periodLength: 5, overrides: {},
    } } },
    start: now,
});
for (const date of [yesterday, today, calendarDateRangeKeys(now, 1, 1)[0]]) {
    assert.match(relativeSafeWindow, new RegExp(`${date}｜[^\n]*生理周期（<user>）：相对安全期`));
}
for (const date of [calendarDateRangeKeys(now, 2, 2)[0], calendarDateRangeKeys(now, 3, 3)[0]]) {
    assert.match(relativeSafeWindow, new RegExp(`${date}｜[^\n]*生理周期（<user>）：易孕期`));
}
const safeWindow = renderCalendarContextInjection({
    currentStorageId: 'safe-window',
    calendarStore: { version: 1, scopes: { 'safe-window': { injectionCycleEnabled: true, events: {} } } },
    cycleStore: { version: 1, scopes: { 'safe-window': {
        enabled: true, lastPeriodStart: calendarDateRangeKeys(now, -17, -17)[0], cycleLength: 28, periodLength: 5, overrides: {},
    } } },
    start: now,
});
for (const date of [yesterday, today, calendarDateRangeKeys(now, 1, 1)[0], calendarDateRangeKeys(now, 2, 2)[0], calendarDateRangeKeys(now, 3, 3)[0]]) {
    assert.match(safeWindow, new RegExp(`${date}｜[^\n]*生理周期（<user>）：安全期`));
}
for (const body of [relativeSafeWindow, safeWindow]) {
    assert.doesNotMatch(body, new RegExp(`${twoDaysAgo}｜[^\n]*生理周期（`), '周期事实不得超出动态五日窗口的昨天边界');
    assert.doesNotMatch(body, new RegExp(`${calendarDateRangeKeys(now, 4, 4)[0]}｜[^\n]*生理周期（`), '周期事实不得超出动态五日窗口的大后天边界');
}
assert.match(fullCalendarBody, /今天 [^｜]+｜天气：少云，20°\/30°C/);
assert.doesNotMatch(fullCalendarBody, /天气（(?:真实预报|缓存预报|气候推演)）：/,
    '日历上下文不得泄露天气数据来源标签');
assert.equal((fullCalendarBody.match(new RegExp(`${today}｜`, 'g')) || []).length, 1, '同一天必须只输出一个日期标题');
const otherStorageBody = renderCalendarContextInjection({
    currentStorageId: 'story-b', calendarStore: calendarStoreWithEvents,
    occasionStore: { version: 1, scopes: { 'story-a': { occasions: [{ id: 'private', type: 'birthday', month: todayParts[1], day: todayParts[2], title: '私密生日' }] } } },
    start: now,
});
assert.doesNotMatch(otherStorageBody, /角色生日|私密生日|项目评审会/, '生活日历不得串用其他 storageId 的私有数据');
assert.doesNotMatch(otherStorageBody, /生理周期（/, '没有启用周期资料的会话不得生成周期事实');

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
assert.match(maximumCycleBody.split('\n')[0], new RegExp(`${today}｜.*生理周期（<user>）：经期`),
    '动态五日的首个周期事实不得在字符上限处被截断');
for (const subject of Object.keys(maximumCycleSubjects)) {
    assert.match(maximumCycleBody, new RegExp(`生理周期（${subject.slice(5)}）：经期`),
        `合法上限周期对象不得丢失日期事实：${subject}`);
}
assert.ok(maximumCycleBody.length <= 6000, '日历上下文仍须遵守 6000 字符上限');

const storyDate = '2032-03-15';
const storyCalendarPlan = buildContextInjectionPrompts({
    ...baseInjectionInput,
    injectionConfig: { calendar: { position: 1, depth: 2 } },
    budgetConfig: {
        targetTokens: 2000,
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
assert.doesNotMatch(storyCalendarPrompt.content, /生理周期规则：/, '故事日期窗口不得保留默认安全期推断规则');
assert.match(storyCalendarPrompt.content, /今天 2032-03-15｜天气：少云，10°\/20°C；日程：架空纪元会议；纪念日：架空纪念日；节假日：架空节；生理周期（<user>）：经期/);
assert.doesNotMatch(storyCalendarPrompt.content, /天气（(?:真实预报|缓存预报|气候推演)）：/,
    '故事日期窗口只注入天气事实，不暴露数据来源');
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
    injectionConfig: { calendar: { position: 0, depth: 0 } },
    budgetConfig: {
        targetTokens: 2000,
        sourceWeights: { phone: 1, community: 0, calendar: 1 },
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
    injectionConfig: { calendar: { position: 0, depth: 0 } },
    budgetConfig: {
        budgetVersion: 4,
        sourceWeights: { phone: 1, community: 0, calendar: 0 },
        redistributeUnused: false,
        targetTokens: 100,
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
    injectionConfig: { calendar: { position: 2, depth: 4 } },
    budgetConfig: {
        targetTokens: 2000,
        sourceWeights: { phone: 0, community: 0, calendar: 1, todayTrend: 0 },
        sourcePriority: ['calendar', 'phone', 'community', 'todayTrend'], redistributeUnused: true,
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
    budgetConfig: { sourceWeights: { phone: 1, calendar: 0, todayTrend: 0 }, redistributeUnused: false },
    calendarStore: { version: 1, scopes: { 'story-a': {
        baseDate: storyDate,
        events: {},
        injectionRecipeEnabled: false,
    } } },
    calendarRecipes: recipeStore,
});
assert.equal(disabledRecipePlan.prompts.some(prompt => prompt.key.includes(':recipe:')), false);
assert.equal(disabledRecipePlan.diagnostics.recipeEnabled, false);

// === Outfit injection tests ===
let outfitProfile = {};
for (const [offset, text] of [
    [-2, '窗口外前日穿搭'], [-1, '昨日风衣'], [0, '今日针织衫'], [1, '明日短靴'], [2, '窗口外后日穿搭'],
]) {
    outfitProfile = upsertOutfit(outfitProfile, {
        date: calendarDateRangeKeys(new Date(`${storyDate}T12:00:00`), offset, offset)[0], text, source: 'manual',
    }, 1);
}
const outfitStore = normalizeOutfitStore(updateOutfitProfile({ version: 1, scopes: {} }, 'story-a', 'role:Alice', () => outfitProfile));
const outfitPlan = buildContextInjectionPrompts({
    ...baseInjectionInput,
    injectionConfig: { calendar: { position: 2, depth: 4 } },
    budgetConfig: {
        targetTokens: 2000,
        sourceWeights: { phone: 0, community: 0, calendar: 1, todayTrend: 0 },
        sourcePriority: ['calendar', 'phone', 'community', 'todayTrend'], redistributeUnused: true,
    },
    calendarStore: { version: 1, scopes: { 'story-a': {
        baseDate: storyDate, events: {},
        injectionScheduleEnabled: false, injectionWeatherEnabled: false, injectionCycleEnabled: false,
        injectionRecipeEnabled: false, injectionOutfitEnabled: true,
    } } },
    calendarOutfits: outfitStore,
});
const outfitPrompt = outfitPlan.prompts.find(prompt => prompt.key.includes(':outfit:'));
assert.ok(outfitPrompt, '启用且有数据时必须生成独立穿搭 prompt');
assert.equal(outfitPrompt.source, 'outfit', '穿搭 prompt 必须保留独立来源标签');
assert.ok(outfitPlan.diagnostics.calendarFamilyBudget.demandBySource.outfit > 0, '穿搭内容必须计入日历家族需求');
assert.ok(outfitPlan.diagnostics.calendarFamilyBudget.allocations.outfit > 0, '日历预算必须分配给有效穿搭内容');
assert.ok(outfitPlan.diagnostics.budget.allocations.calendar > 0, '穿搭必须消费日历预算');
assert.equal(outfitPrompt.key, 'PHONE_SMS_MEMORY:outfit:story-a%3A%3Arole%3AAlice');
assert.equal(outfitPrompt.position, 2);
assert.equal(outfitPrompt.depth, 4);
assert.match(outfitPrompt.content, /\[角色穿搭\]/);
assert.match(outfitPrompt.content, /昨日风衣|今日针织衫|明日短靴/);
assert.doesNotMatch(outfitPrompt.content, /窗口外前日穿搭|窗口外后日穿搭/,
    '穿搭注入必须严格限制 -1...+1');
assert.equal(outfitPlan.diagnostics.outfitEnabled, true);
let bobOutfitProfile = {};
bobOutfitProfile = upsertOutfit(bobOutfitProfile, {
    date: storyDate, text: 'Bob 的群聊夹克', source: 'manual',
}, 1);
const groupOutfitStore = normalizeOutfitStore(updateOutfitProfile(outfitStore, 'story-a', 'role:Bob', () => bobOutfitProfile));
const groupOutfitPlan = buildContextInjectionPrompts({
    ...baseInjectionInput,
    currentActorName: '宿主角色',
    currentConversationKey: '__group_team',
    groupsByStorage: { 'story-a': { __group_team: { name: '测试群', members: ['Alice', 'Bob'] } } },
    injectionConfig: { calendar: { position: 2, depth: 4 } },
    budgetConfig: {
        targetTokens: 2000,
        sourceWeights: { phone: 0, community: 0, calendar: 1, todayTrend: 0 },
        sourcePriority: ['calendar', 'phone', 'community', 'todayTrend'], redistributeUnused: true,
    },
    calendarStore: { version: 1, scopes: { 'story-a': {
        baseDate: storyDate, events: {},
        injectionScheduleEnabled: false, injectionWeatherEnabled: false, injectionCycleEnabled: false,
        injectionRecipeEnabled: false, injectionOutfitEnabled: true,
    } } },
    calendarOutfits: groupOutfitStore,
});
const groupOutfitPrompts = groupOutfitPlan.prompts.filter(prompt => prompt.source === 'outfit');
assert.equal(groupOutfitPrompts.length, 2, '群聊必须为每个固定成员生成独立穿搭 prompt');
assert.deepEqual(groupOutfitPrompts.map(prompt => prompt.key), [
    'PHONE_SMS_MEMORY:outfit:story-a%3A%3Arole%3AAlice',
    'PHONE_SMS_MEMORY:outfit:story-a%3A%3Arole%3ABob',
]);
assert.ok(groupOutfitPrompts.some(prompt => /角色：Alice/.test(prompt.content) && /今日针织衫/.test(prompt.content)));
assert.ok(groupOutfitPrompts.some(prompt => /角色：Bob/.test(prompt.content) && /Bob 的群聊夹克/.test(prompt.content)));
assert.equal(groupOutfitPrompts.some(prompt => /宿主角色/.test(prompt.content)), false,
    '群聊穿搭不得回退到承载群聊的宿主角色名');
const invalidGroupOutfitPlan = buildContextInjectionPrompts({
    ...baseInjectionInput,
    currentActorName: '宿主角色',
    currentConversationKey: '__group_team',
    groupsByStorage: { 'story-a': { __group_team: { name: '损坏群', members: ['Alice', 7] } } },
    injectionConfig: { calendar: { position: 2, depth: 4 } },
    budgetConfig: {
        targetTokens: 2000,
        sourceWeights: { phone: 0, community: 0, calendar: 1, todayTrend: 0 },
        sourcePriority: ['calendar', 'phone', 'community', 'todayTrend'], redistributeUnused: true,
    },
    calendarStore: { version: 1, scopes: { 'story-a': {
        baseDate: storyDate, events: {}, injectionOutfitEnabled: true,
    } } },
    calendarOutfits: groupOutfitStore,
});
assert.deepEqual(invalidGroupOutfitPlan.prompts.filter(prompt => prompt.source === 'outfit'), [],
    '群聊成员元数据缺失或非法时不得回退注入宿主角色穿搭');
const calendarBudgetOutfitPlan = buildContextInjectionPrompts({
    ...baseInjectionInput,
    injectionConfig: { calendar: { position: 2, depth: 4 } },
    budgetConfig: {
        targetTokens: 2000,
        sourceWeights: { phone: 0, community: 0, calendar: 1, todayTrend: 0 },
        sourcePriority: ['calendar', 'phone', 'community', 'todayTrend'], redistributeUnused: false,
    },
    calendarStore: { version: 1, scopes: { 'story-a': {
        baseDate: storyDate, events: {}, injectionOutfitEnabled: true,
    } } },
    calendarOutfits: outfitStore,
});
assert.equal(calendarBudgetOutfitPlan.prompts.some(prompt => prompt.key.includes(':outfit:')), true,
    '日历预算必须供启用的穿搭使用');
assert.ok(calendarBudgetOutfitPlan.diagnostics.calendarFamilyBudget.allocations.outfit > 0);
const calendarFamilyPlan = buildContextInjectionPrompts({
    ...baseInjectionInput,
    injectionConfig: { calendar: { position: 2, depth: 4 } },
    budgetConfig: {
        budgetVersion: 4,
        targetTokens: 60,
        sourceWeights: { phone: 0, community: 0, calendar: 1, todayTrend: 0 },
        sourcePriority: ['calendar', 'phone', 'community', 'todayTrend'], redistributeUnused: false,
    },
    calendarStore: { version: 1, scopes: { 'story-a': {
        baseDate: storyDate,
        events: { [storyDate]: [{ id: 'family-event', date: storyDate, title: '共享预算日程', note: '', source: 'manual', createdAt: 1, updatedAt: 1 }] },
        injectionScheduleEnabled: true, injectionRecipeEnabled: true, injectionOutfitEnabled: true,
    } } },
    calendarRecipes: recipeStore,
    calendarOutfits: outfitStore,
});
const calendarFamily = calendarFamilyPlan.diagnostics.calendarFamilyBudget;
assert.equal(calendarFamilyPlan.diagnostics.budget.allocations.calendar, 60, '日历家族必须只获得一次顶层额度');
assert.equal(calendarFamily.allocatedTokens, 60, '日历家族子分配总额不得超过顶层日历额度');
assert.ok(calendarFamily.allocations.calendar > 0 && calendarFamily.allocations.recipe > 0 && calendarFamily.allocations.outfit > 0,
    '三类有效日历内容必须各获得一份公平额度');
assert.ok(calendarFamilyPlan.diagnostics.calendar.usedTokens + calendarFamilyPlan.diagnostics.recipe.usedTokens + calendarFamilyPlan.diagnostics.outfit.usedTokens
    <= calendarFamilyPlan.diagnostics.budget.allocations.calendar, '日历家族实际使用量不得超出顶层日历额度');
const disabledOutfitPlan = buildContextInjectionPrompts({
    ...baseInjectionInput,
    budgetConfig: { sourceWeights: { phone: 1, calendar: 0, todayTrend: 0 }, redistributeUnused: false },
    calendarStore: { version: 1, scopes: { 'story-a': { baseDate: storyDate, events: {}, injectionOutfitEnabled: false } } },
    calendarOutfits: outfitStore,
});
assert.equal(disabledOutfitPlan.prompts.some(prompt => prompt.key.includes(':outfit:')), false);
assert.equal(disabledOutfitPlan.diagnostics.outfitEnabled, false);

const todayTrendStore = {
    version: 1,
    presets: {},
    scopes: {
        'story-a': {
            characterName: 'Alice', injection: { enabled: true },
            world: { items: [{ name: '不得注入的世界态势', summary: '不得泄漏' }] },
            reputation: { circles: [{ name: '评审团', status: 'like', evaluation: '认可发挥' }] },
            factions: [{ name: '节目组', relation: { status: 'neutral', evaluation: '持续观察' } }],
            dynamics: {
                active: [{ title: '复赛筹备', stageLabel: '准备中', latestStage: '确认食材' }],
                archived: [{ title: '不得注入的旧事件', stageLabel: '已结束', latestStage: '旧记录' }],
            },
        },
        'story-b': { characterName: 'Bob', injection: { enabled: true }, reputation: { circles: [{ name: '泄漏圈层', status: 'hostile', evaluation: '不得出现' }] }, factions: [], dynamics: { active: [], archived: [] } },
    },
};
const todayTrendPlan = buildContextInjectionPrompts({
    ...baseInjectionInput,
    todayTrendStore,
    injectionConfig: { todayTrend: { position: 2, depth: 7 } },
    budgetConfig: { targetTokens: 2000, sourceWeights: { phone: 0, community: 0, calendar: 0, todayTrend: 1 }, redistributeUnused: false },
});
const todayTrendPrompt = todayTrendPlan.prompts.find(prompt => prompt.source === 'todayTrend');
assert.ok(todayTrendPrompt, '启用今日风向且分配预算时必须生成独立社会状态 prompt');
assert.match(todayTrendPrompt.key, /^ST_SMS_TODAY_TREND_INJECTION_V1:story-a$/);
assert.match(todayTrendPrompt.content, /评审团｜喜欢｜认可发挥[\s\S]*节目组｜中立｜持续观察[\s\S]*复赛筹备｜准备中｜确认食材/);
assert.doesNotMatch(todayTrendPrompt.content, /不得注入的世界态势|不得注入的旧事件|泄漏圈层/);
assert.equal(todayTrendPrompt.position, 2);
assert.equal(todayTrendPrompt.depth, 7);
assert.equal(todayTrendPlan.diagnostics.todayTrend.promptCount, 1);
const redistributedTodayTrendPlan = buildContextInjectionPrompts({
    ...baseInjectionInput,
    todayTrendStore,
    injectionConfig: { todayTrend: { position: 2, depth: 7 } },
    budgetConfig: {
        budgetVersion: 4,
        targetTokens: 2000,
        sourceWeights: { phone: 0, community: 0, calendar: 1, todayTrend: 0 },
        sourcePriority: ['calendar', 'todayTrend', 'phone', 'community'], redistributeUnused: true,
    },
});
assert.ok(redistributedTodayTrendPlan.prompts.some(prompt => prompt.source === 'todayTrend'),
    '风向权重为零但其他模块未消耗额度时必须获得再分配预算');
assert.ok(redistributedTodayTrendPlan.diagnostics.budget.allocations.todayTrend > 0);
const todayTrendCalls = [];
const todayTrendRuntime = { trackedExtensionPromptKeys: new Set() };
applyContextInjections({ context: { setExtensionPrompt: (...args) => todayTrendCalls.push(args) }, runtime: todayTrendRuntime,
    ...baseInjectionInput, todayTrendStore, injectionConfig: { todayTrend: { position: 2, depth: 7 } },
    budgetConfig: { targetTokens: 2000, sourceWeights: { phone: 0, community: 0, calendar: 0, todayTrend: 1 }, redistributeUnused: false },
});
applyContextInjections({ context: { setExtensionPrompt: (...args) => todayTrendCalls.push(args) }, runtime: todayTrendRuntime,
    ...baseInjectionInput, todayTrendStore: { ...todayTrendStore, scopes: { ...todayTrendStore.scopes, 'story-a': { ...todayTrendStore.scopes['story-a'], injection: { enabled: false } } } },
    budgetConfig: { targetTokens: 2000, sourceWeights: { phone: 0, community: 0, calendar: 0, todayTrend: 1 }, redistributeUnused: false },
});
assert.ok(todayTrendCalls.some(call => call[0] === 'ST_SMS_TODAY_TREND_INJECTION_V1:story-a' && call[1] === ''), '关闭今日风向注入必须清理同一稳定 key，不能残重复 prompt');

const longTodayTrendStore = structuredClone(todayTrendStore);
longTodayTrendStore.scopes['story-a'].reputation.circles = [
    { name: '短圈层', status: 'like', evaluation: '简短评价' },
    { name: '截断标记', status: 'neutral', evaluation: '很长的评价'.repeat(30) },
];
const trimmedTodayTrendPlan = buildContextInjectionPrompts({
    ...baseInjectionInput,
    todayTrendStore: longTodayTrendStore,
    injectionConfig: { todayTrend: { position: 2, depth: 7 } },
    budgetConfig: { targetTokens: 45, sourceWeights: { phone: 0, community: 0, calendar: 0, todayTrend: 1 }, redistributeUnused: false },
});
const trimmedTodayTrendPrompt = trimmedTodayTrendPlan.prompts.find(prompt => prompt.source === 'todayTrend');
assert.ok(trimmedTodayTrendPrompt, '小预算仍应保留至少一个完整的今日风向数据行');
assert.match(trimmedTodayTrendPrompt.content, /短圈层｜喜欢｜简短评价/, '小预算必须优先保留完整数据行');
assert.doesNotMatch(trimmedTodayTrendPrompt.content, /截断标记|很长的评价/, '小预算不得保留被截断的数据行');
assert.match(trimmedTodayTrendPrompt.content, /\n\[结束\]$/, '小预算裁剪后必须保留注入结束框架');
assert.ok(estimateContextTokens(trimmedTodayTrendPrompt.content).estimatedTokens
    <= trimmedTodayTrendPlan.diagnostics.budget.allocations.todayTrend, '今日风向裁剪结果不得超出分配预算');
assert.equal(trimmedTodayTrendPlan.diagnostics.truncatedCount, 1, '今日风向完整行裁剪必须记录诊断');
