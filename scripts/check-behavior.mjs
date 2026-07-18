import assert from 'node:assert/strict';
import {
    CALENDAR_CYCLE_STORAGE_KEY, CALENDAR_HOLIDAY_STORAGE_KEY, CALENDAR_OCCASION_STORAGE_KEY,
    CALENDAR_STORAGE_KEY, CALENDAR_WEATHER_STORAGE_KEY, EXTENSION_PROMPT_POSITIONS, MAX_INJECTION_DEPTH,
} from '../src/constants.js';
import {
    buildCharacterBehaviorPrompt, buildChatPreferencePrompt,
    DEFAULT_CHARACTER_BEHAVIOR, getCharacterBehavior,
    normalizeCharacterBehavior, normalizeCharacterBehaviorStore,
    normalizeGroupInjection, normalizeGroupMeta, normalizeGroupMetaStore,
} from '../src/behavior-config.js';
import {
    addOrUpdateProfile, clearPluginData, loadBgSettings, loadCharacterBehavior, loadGroupMeta, pmIDBDel, pmIDBGet, pmIDBSet,
    PLUGIN_IDB_DYNAMIC_PREFIXES, PLUGIN_IDB_STATIC_KEYS, PLUGIN_LOCAL_STORAGE_KEYS,
    saveBgGlobal, saveBgLocal, saveDesktopBg, saveCharacterBehavior, saveGroupMeta, saveHistoriesStrict,
} from '../src/storage.js';
import { applyConversationInjections } from '../src/phone-injection.js';
import { deriveInteractiveActorId, normalizeInteractiveStore } from '../src/interactive-scene-model.js';
import { renderPhoneDesktop, runDesktopPageTransition } from '../src/interactive-scenes.js';
import { getDanmakuMotion, getDanmakuTone, renderCommunityLauncher, renderCommunityWorkspace } from '../src/interactive-scene-views.js';
import { runControlMenuAction } from '../src/phone-control-center.js';
import {
    createBackupStateHandlers, installSettingsUi, parseBackupData, runBackgroundTransaction, runBackupTransaction,
} from '../src/settings-ui.js';
import {
    buildGroupInjectedInstruction, buildGroupSystemPrompt,
    buildIndependentGroupUserPrompt, buildIndependentSingleUserPrompt,
    buildSingleInjectedInstruction, buildSingleSystemPrompt,
} from '../src/chat-prompts.js';
import {
    advanceAutoPokeCounters, commitAutomaticResult,
    createAutomaticTaskController, createRuntimeState, runAutoPokeCounterCycle,
} from '../src/runtime.js';
import { createPhonePageController } from '../src/phone-lifecycle.js';
import {
    handlePhonePageSuspension, installPhonePageSuspensionListeners, updatePhonePageSuspensionHandler,
} from '../src/phone-foundation.js';
import { bindPhonePageActions, finalizeDeletedScene, runDeleteSceneAction } from '../src/interactive-scene-phone.js';

const suspensionCalls = [];
handlePhonePageSuspension({
    cancelCommunityGeneration: reason => suspensionCalls.push(['community', reason]),
    cancelCalendarTasks: reason => suspensionCalls.push(['calendar', reason]),
}, 'beforeunload', {
    save: () => suspensionCalls.push(['save', 'beforeunload']),
    disarm: reason => suspensionCalls.push(['disarm', reason]),
});
assert.deepEqual(suspensionCalls, [
    ['save', 'beforeunload'],
    ['community', 'beforeunload'],
    ['calendar', 'beforeunload'],
    ['disarm', 'beforeunload'],
]);

const pageWindowListeners = new Map();
const pageDocumentListeners = new Map();
const pageWindow = {
    addEventListener(type, listener) {
        assert.equal(pageWindowListeners.has(type), false, `${type} 监听器只能注册一次`);
        pageWindowListeners.set(type, listener);
    },
};
const pageDocument = {
    visibilityState: 'visible',
    addEventListener(type, listener) {
        assert.equal(pageDocumentListeners.has(type), false, `${type} 监听器只能注册一次`);
        pageDocumentListeners.set(type, listener);
    },
};
assert.equal(installPhonePageSuspensionListeners(pageWindow, pageDocument), true);
assert.equal(installPhonePageSuspensionListeners(pageWindow, pageDocument), false);
const pageHandlerCalls = [];
updatePhonePageSuspensionHandler(pageWindow, {
    cancelCommunityGeneration: reason => pageHandlerCalls.push(['old-community', reason]),
    cancelCalendarTasks: reason => pageHandlerCalls.push(['old-calendar', reason]),
}, reason => pageHandlerCalls.push(['old-disarm', reason]),
() => pageHandlerCalls.push(['old-save']));
updatePhonePageSuspensionHandler(pageWindow, {
    cancelCommunityGeneration: reason => pageHandlerCalls.push(['current-community', reason]),
    cancelCalendarTasks: reason => pageHandlerCalls.push(['current-calendar', reason]),
}, reason => pageHandlerCalls.push(['current-disarm', reason]),
() => pageHandlerCalls.push(['current-save']));
pageWindowListeners.get('beforeunload')();
pageDocument.visibilityState = 'hidden';
pageDocumentListeners.get('visibilitychange')();
assert.deepEqual(pageHandlerCalls, [
    ['current-save'], ['current-community', 'beforeunload'], ['current-calendar', 'beforeunload'], ['current-disarm', 'beforeunload'],
    ['current-save'], ['current-community', 'document-hidden'], ['current-calendar', 'document-hidden'], ['current-disarm', 'document-hidden'],
]);
assert.equal(pageWindowListeners.size, 1);
assert.equal(pageDocumentListeners.size, 1);

assert.deepEqual(normalizeCharacterBehavior(null), DEFAULT_CHARACTER_BEHAVIOR);
assert.deepEqual(normalizeCharacterBehavior({
    privateStylePrompt: '  冷淡一点  ',
    groupStylePrompt: 42,
    messageLength: 'invalid',
    transferFrequency: 'never',
    imageFrequency: 'frequent',
    emojiFrequency: 'rare',
}), {
    privateStylePrompt: '冷淡一点',
    groupStylePrompt: '',
    messageLength: 'persona',
    transferFrequency: 'never',
    imageFrequency: 'frequent',
    emojiFrequency: 'rare',
});

const behaviorStore = normalizeCharacterBehaviorStore({
    story: {
        ' Alice ': { messageLength: 'short' },
        Bob: { emojiFrequency: 'frequent' },
    },
    broken: [],
});
assert.equal(behaviorStore.story.Alice.messageLength, 'short');
assert.equal(getCharacterBehavior(behaviorStore, 'story', 'Bob').emojiFrequency, 'frequent');
assert.deepEqual(getCharacterBehavior(behaviorStore, 'missing', 'Nobody'), DEFAULT_CHARACTER_BEHAVIOR);
assert.equal(buildCharacterBehaviorPrompt({}, 'story', 'Alice', false), '');
const singleBehaviorPrompt = buildCharacterBehaviorPrompt({ story: {
    Alice: { privateStylePrompt: '冷淡一点', messageLength: 'short', transferFrequency: 'never' },
} }, 'story', 'Alice', false);
assert.match(singleBehaviorPrompt, /Alice：线上风格：冷淡一点/);
assert.match(singleBehaviorPrompt, /消息长度：偏短/);
assert.match(singleBehaviorPrompt, /转账：不要使用/);
assert.match(singleBehaviorPrompt, /不得覆盖系统格式/);
const groupBehaviorPrompt = buildCharacterBehaviorPrompt({ story: {
    Alice: { privateStylePrompt: '私聊风格', groupStylePrompt: '群聊风格' },
    Bob: { emojiFrequency: 'frequent' },
} }, 'story', ['Alice', 'Bob', 'Missing'], true);
assert.match(groupBehaviorPrompt, /Alice：线上风格：群聊风格/);
assert.doesNotMatch(groupBehaviorPrompt, /私聊风格/);
assert.match(groupBehaviorPrompt, /Bob：消息长度：跟随角色人设/);
assert.match(groupBehaviorPrompt, /表情包：经常使用/);

const emojiPermission = '\n\n[表情包权限]\n你可以使用 [emo:默认:1]。';
const disabledEmojiPrompt = buildChatPreferencePrompt({
    store: { story: { Alice: { emojiFrequency: 'never' } } },
    storageId: 'story', names: 'Alice', isGroup: false,
    emojiPrompt: emojiPermission, wordyPrompt: '\n\n[字数限制]短句。',
});
assert.doesNotMatch(disabledEmojiPrompt, /表情包权限/);
assert.match(disabledEmojiPrompt, /表情包：不要使用/);
assert.match(disabledEmojiPrompt, /字数限制/);

const mixedEmojiPrompt = buildChatPreferencePrompt({
    store: { story: {
        Alice: { emojiFrequency: 'never' },
        Bob: { emojiFrequency: 'frequent' },
    } },
    storageId: 'story', names: ['Alice', 'Bob'], isGroup: true,
    emojiPrompt: emojiPermission,
});
assert.match(mixedEmojiPrompt, /表情包权限/);
assert.match(mixedEmojiPrompt, /以下成员不得使用表情包：Alice/);
assert.match(mixedEmojiPrompt, /Bob：消息长度：跟随角色人设/);

const unconfiguredPreference = buildChatPreferencePrompt({
    store: {}, storageId: 'story', names: 'Alice', isGroup: false,
    emojiPrompt: emojiPermission,
});
assert.equal(unconfiguredPreference, emojiPermission);

const promptFixture = {
    currentPersona: 'Alice', userName: 'User', userBlock: '用户名字：User',
    contextBlockMain: '【场景参考】\n咖啡店', cardScenario: '咖啡店',
    worldBookText: '世界设定', mainChatText: '角色：主线正文证据',
    smsHistoryText: 'User：短信历史', directorNote: '',
    userMsgClean: '你好', userMsg: '你好',
    groupName: '测试群', memberList: 'Alice、Bob',
};
const singleInjectedPrompt = buildSingleInjectedInstruction(promptFixture);
const groupInjectedPrompt = buildGroupInjectedInstruction(promptFixture);
assert.match(singleInjectedPrompt, /【主线最近对话】\n角色：主线正文证据/);
assert.match(groupInjectedPrompt, /【主线最近对话】\n角色：主线正文证据/);
const singleSystemPrompt = buildSingleSystemPrompt({
    ...promptFixture,
    cardDesc: '角色设定', cardPersonality: '性格', cardFirstMes: '开场', cardMesExample: '示例',
});
const groupSystemPrompt = buildGroupSystemPrompt({
    ...promptFixture,
    cardDesc: '角色设定', cardPersonality: '性格',
});
assert.match(singleSystemPrompt, /【主线最近对话】\n角色：主线正文证据/);
assert.match(groupSystemPrompt, /【主线最近对话】\n角色：主线正文证据/);
const independentSingleUserPrompt = buildIndependentSingleUserPrompt(promptFixture);
const independentGroupUserPrompt = buildIndependentGroupUserPrompt(promptFixture);
assert.doesNotMatch(independentSingleUserPrompt, /主线正文证据/);
assert.doesNotMatch(independentGroupUserPrompt, /主线正文证据/);

const emptyMainChatFixture = { ...promptFixture, mainChatText: '' };
assert.doesNotMatch(buildSingleInjectedInstruction(emptyMainChatFixture), /【主线最近对话】/);
assert.doesNotMatch(buildGroupInjectedInstruction(emptyMainChatFixture), /【主线最近对话】/);

const automaticRuntime = createRuntimeState();
const automaticState = { phoneActive: false, isMinimized: false };
let automaticStorageId = 'story-a';
let documentVisible = true;
const automaticController = createAutomaticTaskController({
    runtime: automaticRuntime,
    state: automaticState,
    getStorageId: () => automaticStorageId,
    isDocumentVisible: () => documentVisible,
});
assert.equal(automaticController.isAllowed(), false);
assert.equal(automaticController.arm(), false);
automaticState.phoneActive = true;
assert.equal(automaticController.arm(), true);
assert.equal(automaticController.isAllowed(), true);
const aliceTask = automaticController.begin('story-a', 'Alice');
assert.ok(aliceTask);
assert.equal(automaticController.begin('story-a', 'Alice'), null);
assert.equal(automaticController.begin('story-b', 'Alice'), null);
assert.equal(automaticController.isActive(aliceTask), true);
automaticStorageId = 'story-b';
assert.equal(automaticController.isActive(aliceTask), false);
const sameContactOtherStorageTask = automaticController.begin('story-b', 'Alice');
assert.ok(sameContactOtherStorageTask);
assert.equal(automaticController.isActive(sameContactOtherStorageTask), true);
assert.equal(automaticController.finish(sameContactOtherStorageTask), true);
automaticStorageId = 'story-a';
documentVisible = false;
assert.equal(automaticController.isAllowed(), false);
assert.equal(automaticController.arm(), false);
documentVisible = true;
assert.equal(automaticController.arm(), true);
const staleTask = automaticController.begin('story-a', 'Bob');
assert.ok(staleTask);
assert.equal(automaticController.disarm('test-hidden'), 'test-hidden');
assert.equal(automaticController.isAllowed(), false);
assert.equal(automaticController.isActive(staleTask), false);
assert.equal(automaticController.finish(staleTask), false);
assert.equal(automaticController.arm(), true);
automaticState.isMinimized = true;
assert.equal(automaticController.isAllowed(), false);
assert.equal(automaticController.arm(), false);
automaticState.isMinimized = false;

const counterConfigs = {
    Alice: { autoPoke: { enabled: true, interval: 2, counter: 1 } },
    Bob: { autoPoke: { enabled: true, interval: 3, counter: 0 } },
    Carol: { autoPoke: { enabled: false, interval: 1, counter: 0 } },
};
assert.deepEqual(advanceAutoPokeCounters(counterConfigs, () => true), {
    updated: true,
    toPoke: ['Alice'],
});
assert.equal(counterConfigs.Alice.autoPoke.counter, 2);
assert.equal(counterConfigs.Bob.autoPoke.counter, 1);
const failedCounterConfigs = {
    Alice: { autoPoke: { enabled: true, interval: 2, counter: 1 } },
};
assert.deepEqual(advanceAutoPokeCounters(failedCounterConfigs, () => false), {
    updated: false,
    toPoke: [],
});
assert.equal(failedCounterConfigs.Alice.autoPoke.counter, 1);

const failedCycleConfigs = {
    Alice: { autoPoke: { enabled: true, interval: 2, counter: 1 } },
};
const failedCycleRuns = [];
assert.equal(await runAutoPokeCounterCycle({
    configs: failedCycleConfigs,
    persist: () => false,
    isAllowed: () => true,
    run: async contactName => { failedCycleRuns.push(contactName); },
}), false);
assert.deepEqual(failedCycleRuns, []);
assert.equal(failedCycleConfigs.Alice.autoPoke.counter, 1);

const serialCycleRuns = [];
assert.equal(await runAutoPokeCounterCycle({
    configs: {
        Alice: { autoPoke: { enabled: true, interval: 1, counter: 0 } },
        Bob: { autoPoke: { enabled: true, interval: 1, counter: 0 } },
    },
    persist: () => true,
    isAllowed: () => true,
    run: async contactName => {
        serialCycleRuns.push(`start:${contactName}`);
        await Promise.resolve();
        serialCycleRuns.push(`end:${contactName}`);
    },
}), true);
assert.deepEqual(serialCycleRuns, ['start:Alice', 'end:Alice', 'start:Bob', 'end:Bob']);

const createCommitHarness = () => {
    const state = { active: true, history: 'old-history', counter: 3 };
    const historyWrites = [];
    const counterWrites = [];
    return {
        state, historyWrites, counterWrites,
        options: {
            isActive: () => state.active,
            applyHistory: () => { state.history = 'new-history'; },
            restoreHistory: () => { state.history = 'old-history'; },
            persistHistory: async () => { historyWrites.push(state.history); },
            applyCounter: () => { state.counter = 0; },
            restoreCounter: () => { state.counter = 3; },
            persistCounter: () => { counterWrites.push(state.counter); return true; },
        },
    };
};

const successfulCommit = createCommitHarness();
assert.equal(await commitAutomaticResult(successfulCommit.options), true);
assert.deepEqual(successfulCommit.historyWrites, ['new-history']);
assert.deepEqual(successfulCommit.counterWrites, [0]);
assert.deepEqual(successfulCommit.state, { active: true, history: 'new-history', counter: 0 });

const invalidatedDuringHistory = createCommitHarness();
invalidatedDuringHistory.options.persistHistory = async () => {
    invalidatedDuringHistory.historyWrites.push(invalidatedDuringHistory.state.history);
    if (invalidatedDuringHistory.historyWrites.length === 1) invalidatedDuringHistory.state.active = false;
};
assert.equal(await commitAutomaticResult(invalidatedDuringHistory.options), false);
assert.deepEqual(invalidatedDuringHistory.historyWrites, ['new-history', 'old-history']);
assert.deepEqual(invalidatedDuringHistory.counterWrites, []);
assert.equal(invalidatedDuringHistory.state.history, 'old-history');
assert.equal(invalidatedDuringHistory.state.counter, 3);

const historyFailure = createCommitHarness();
historyFailure.options.persistHistory = async () => { throw new Error('history failed'); };
await assert.rejects(commitAutomaticResult(historyFailure.options), /history failed/);
assert.equal(historyFailure.state.history, 'old-history');
assert.equal(historyFailure.state.counter, 3);

const counterFailure = createCommitHarness();
counterFailure.options.persistCounter = () => false;
await assert.rejects(commitAutomaticResult(counterFailure.options), /自动消息计数保存失败/);
assert.deepEqual(counterFailure.historyWrites, ['new-history', 'old-history']);
assert.equal(counterFailure.state.history, 'old-history');
assert.equal(counterFailure.state.counter, 3);

const invalidatedAfterCounter = createCommitHarness();
invalidatedAfterCounter.options.persistCounter = () => {
    invalidatedAfterCounter.counterWrites.push(invalidatedAfterCounter.state.counter);
    if (invalidatedAfterCounter.counterWrites.length === 1) invalidatedAfterCounter.state.active = false;
    return true;
};
assert.equal(await commitAutomaticResult(invalidatedAfterCounter.options), false);
assert.deepEqual(invalidatedAfterCounter.historyWrites, ['new-history', 'old-history']);
assert.deepEqual(invalidatedAfterCounter.counterWrites, [0, 3]);
assert.equal(invalidatedAfterCounter.state.history, 'old-history');
assert.equal(invalidatedAfterCounter.state.counter, 3);

const failedCompensation = createCommitHarness();
failedCompensation.options.persistHistory = async () => {
    failedCompensation.historyWrites.push(failedCompensation.state.history);
    if (failedCompensation.historyWrites.length === 1) failedCompensation.state.active = false;
    else throw new Error('rollback failed');
};
await assert.rejects(commitAutomaticResult(failedCompensation.options), AggregateError);
assert.equal(failedCompensation.state.history, 'old-history');
assert.equal(failedCompensation.state.counter, 3);

const doubleFailedCompensation = createCommitHarness();
doubleFailedCompensation.options.persistHistory = async () => {
    doubleFailedCompensation.historyWrites.push(doubleFailedCompensation.state.history);
    if (doubleFailedCompensation.historyWrites.length > 1) throw new Error('history rollback failed');
};
doubleFailedCompensation.options.persistCounter = () => {
    doubleFailedCompensation.counterWrites.push(doubleFailedCompensation.state.counter);
    if (doubleFailedCompensation.counterWrites.length === 1) {
        doubleFailedCompensation.state.active = false;
        return true;
    }
    return false;
};
await assert.rejects(
    commitAutomaticResult(doubleFailedCompensation.options),
    error => {
        assert.ok(error instanceof AggregateError);
        assert.equal(error.errors.length, 2);
        assert.match(error.errors[0].message, /计数补偿失败/);
        assert.match(error.errors[1].message, /history rollback failed/);
        return true;
    },
);
assert.equal(doubleFailedCompensation.state.history, 'old-history');
assert.equal(doubleFailedCompensation.state.counter, 3);

assert.deepEqual(EXTENSION_PROMPT_POSITIONS, {
    NONE: -1, IN_PROMPT: 0, IN_CHAT: 1, BEFORE_PROMPT: 2,
});
assert.equal(MAX_INJECTION_DEPTH, 10000);
assert.deepEqual(normalizeGroupInjection({ position: '1', depth: '12000', historyLimit: 0 }), {
    position: 1,
    depth: MAX_INJECTION_DEPTH,
    historyLimit: 1,
});
assert.deepEqual(normalizeGroupInjection({ position: -1, depth: 0, historyLimit: 1 }), {
    position: -1,
    depth: 0,
    historyLimit: 1,
});
assert.deepEqual(normalizeGroupInjection({ position: 3, depth: -4, historyLimit: 500 }), {
    position: 0,
    depth: 0,
    historyLimit: 100,
});
assert.deepEqual(normalizeGroupInjection({ position: 1, depth: '4px', historyLimit: '2.9' }), {
    position: 1,
    depth: 0,
    historyLimit: 2,
});

const group = normalizeGroupMeta({
    name: ' 同学群 ',
    members: ['小红', '小明', '小红', ''],
    extras: ['路人甲', '小明', '路人甲'],
    memberColors: { 小红: '#AABBCC', 路人甲: '#123456', 陌生人: '#000000', 小明: 'red' },
    injection: { position: 2, depth: 4, historyLimit: 30 },
});
assert.deepEqual(group.members, ['小红', '小明']);
assert.deepEqual(group.extras, ['路人甲']);
assert.deepEqual(group.memberColors, { 小红: '#AABBCC', 路人甲: '#123456' });
assert.deepEqual(group.injection, { position: 2, depth: 4, historyLimit: 30 });

const caseFoldedGroup = normalizeGroupMeta({
    name: 'Case',
    members: ['Alice', 'alice', 'BOB'],
    extras: ['Bob', 'Carol', 'carol'],
    memberColors: { ALICE: '#abcdef', bob: '#ABCDEF', Carol: '#12345g' },
});
assert.deepEqual(caseFoldedGroup.members, ['Alice', 'BOB']);
assert.deepEqual(caseFoldedGroup.extras, ['Carol']);
assert.deepEqual(caseFoldedGroup.memberColors, { Alice: '#abcdef', BOB: '#ABCDEF' });

const prototypeStore = JSON.parse('{"__proto__":{"constructor":{"messageLength":"long"}}}');
const normalizedPrototypeStore = normalizeCharacterBehaviorStore(prototypeStore);
assert.equal(Object.hasOwn(normalizedPrototypeStore, '__proto__'), true);
assert.equal(Object.hasOwn(normalizedPrototypeStore.__proto__, 'constructor'), true);
assert.equal(normalizedPrototypeStore.__proto__.constructor.messageLength, 'long');
assert.equal({}.messageLength, undefined);
const prototypeColor = normalizeGroupMeta({
    name: 'Proto', members: ['__proto__', 'Alice'],
    memberColors: JSON.parse('{"__proto__":"#010203"}'),
});
assert.equal(Object.hasOwn(prototypeColor.memberColors, '__proto__'), true);
assert.equal(prototypeColor.memberColors.__proto__, '#010203');
assert.equal(Object.getPrototypeOf(prototypeColor.memberColors), Object.prototype);

const caseFoldedBehavior = normalizeCharacterBehaviorStore({
    story: {
        Alice: { messageLength: 'short' },
        alice: { messageLength: 'long' },
    },
});
assert.deepEqual(Object.keys(caseFoldedBehavior.story), ['Alice']);
assert.equal(caseFoldedBehavior.story.Alice.messageLength, 'short');

const exactKeys = normalizeGroupMetaStore({
    ' storage with spaces ': {
        ' group key with spaces ': { name: '群', members: ['A', 'B'] },
    },
});
assert.equal(Object.hasOwn(exactKeys, ' storage with spaces '), true);
assert.equal(Object.hasOwn(exactKeys[' storage with spaces '], ' group key with spaces '), true);

const inheritedInput = Object.create({ inherited: { Alice: { messageLength: 'long' } } });
inheritedInput.own = { Alice: { messageLength: 'short' } };
assert.deepEqual(normalizeCharacterBehaviorStore(inheritedInput), {});

const localValues = new Map();
const localStorageWrites = [];
const localStorageControl = {
    failGet: new Set(),
    failSet: new Set(),
    failSetCounts: new Map(),
    failSetOnCalls: new Map(),
    setCalls: new Map(),
};
globalThis.window = {};
globalThis.localStorage = {
    getItem(key) {
        if (localStorageControl.failGet.delete(key)) throw new Error('injected get failure');
        return localValues.has(key) ? localValues.get(key) : null;
    },
    setItem(key, value) {
        const callNumber = (localStorageControl.setCalls.get(key) || 0) + 1;
        localStorageControl.setCalls.set(key, callNumber);
        const scheduledFailures = localStorageControl.failSetOnCalls.get(key);
        if (scheduledFailures?.delete(callNumber)) throw new Error('injected scheduled set failure');
        const remainingFailures = localStorageControl.failSetCounts.get(key) || 0;
        if (remainingFailures > 0) {
            if (remainingFailures === 1) localStorageControl.failSetCounts.delete(key);
            else localStorageControl.failSetCounts.set(key, remainingFailures - 1);
            throw new Error('injected counted set failure');
        }
        if (localStorageControl.failSet.delete(key)) throw new Error('injected set failure');
        localStorageWrites.push({ key, value: String(value) });
        localValues.set(key, String(value));
    },
    removeItem(key) { localValues.delete(key); },
};
localValues.set('ST_SMS_CHARACTER_BEHAVIOR', JSON.stringify({
    story: { Alice: { messageLength: 'short' } },
}));
loadCharacterBehavior();
assert.equal(window.__pmCharacterBehavior.story.Alice.messageLength, 'short');
window.__pmCharacterBehavior.story.Alice.messageLength = 'invalid';
saveCharacterBehavior();
assert.equal(window.__pmCharacterBehavior.story.Alice.messageLength, 'persona');
assert.equal(JSON.parse(localValues.get('ST_SMS_CHARACTER_BEHAVIOR')).story.Alice.messageLength, 'persona');

localValues.set('ST_SMS_GROUP_META', JSON.stringify({
    story: {
        valid: { name: '群', members: ['Alice', 'Bob'], legacyField: { keep: true } },
        invalid: { name: '坏群', members: ['Alice'] },
    },
}));
await loadGroupMeta();
assert.deepEqual(window.__pmGroupMeta.story.valid.legacyField, { keep: true });
assert.equal(window.__pmGroupMeta.story.invalid, undefined);
window.__pmGroupMeta.story.valid.injection = { position: -1, depth: MAX_INJECTION_DEPTH + 1 };
await saveGroupMeta();
const savedGroup = JSON.parse(localValues.get('ST_SMS_GROUP_META_LOCAL_FALLBACK')).story.valid;
assert.equal(savedGroup.injection.position, -1);
assert.equal(savedGroup.injection.depth, MAX_INJECTION_DEPTH);

window.__pmProfiles = [{ apiUrl: 'https://old.example', apiKey: 'old-key', model: 'old-model' }];
localValues.set('ST_SMS_API_PROFILES', JSON.stringify(window.__pmProfiles));
localStorageControl.failSet.add('ST_SMS_API_PROFILES');
assert.equal(addOrUpdateProfile({ apiUrl: 'https://new.example', apiKey: 'new-key', model: 'new-model' }), false);
assert.deepEqual(window.__pmProfiles, [{ apiUrl: 'https://old.example', apiKey: 'old-key', model: 'old-model' }]);
assert.equal(JSON.parse(localValues.get('ST_SMS_API_PROFILES'))[0].apiUrl, 'https://old.example');

const uiAlerts = [];
const uiElements = new Map([
    ['pm-custom-title', { value: '  雨夜电台  ' }],
    ['pm-custom-right', { value: '#123456' }],
    ['pm-custom-left', { value: '#654321' }],
    ['pm-border-color', { value: '#abcdef' }],
    ['pm-cfg-url', { value: 'https://new.example' }],
    ['pm-cfg-key', { value: 'new-key' }],
    ['pm-cfg-model', { value: 'new-model' }],
    ['pm-overlay', { removed: false, remove() { this.removed = true; } }],
]);
globalThis.alert = message => uiAlerts.push(String(message));
const originalFileReader = globalThis.FileReader;
let fileReadCompletion = Promise.resolve();
globalThis.FileReader = class FakeFileReader {
    readAsText(file) {
        fileReadCompletion = Promise.resolve().then(() => this.onload({ target: { result: file.text } }));
    }
};
globalThis.document = {
    getElementById: id => uiElements.get(id) || null,
    querySelectorAll: () => [],
};
const appliedThemes = [];
const uiNotes = [];
let importCloseCalls = 0;
let importInjectionCalls = 0;
let importInjectionImpl = async () => undefined;
let importClearInjectionCalls = 0;
let importCancelCommunityCalls = 0;
installSettingsUi({
    makeOverlay: () => {}, applyTheme: () => appliedThemes.push(structuredClone(window.__pmTheme)), applyBackground: () => {},
    fitNameFont: () => {}, addNote: note => uiNotes.push(note), getCurrentPersona: () => 'default', getStorageId: () => 'story',
    runtime: { modelList: [] },
    closePhone: () => { importCloseCalls += 1; },
    applyBidirectionalInjection: async () => {
        importInjectionCalls += 1;
        return importInjectionImpl();
    },
    clearBidirectionalInjection: () => { importClearInjectionCalls += 1; },
    cancelCommunityGeneration: () => { importCancelCommunityCalls += 1; },
    getInteractiveStore: async () => ({ scopes: {} }),
});

const importInput = {
    files: [{ text: JSON.stringify({
        schemaVersion: 5,
        calendarCycles: {
            version: 1,
            scopes: { story: { enabled: true, lastPeriodStart: null, cycleLength: 28, periodLength: 5, overrides: {} } },
        },
    }) }],
    value: 'calendar-invalid.json',
};
const importWritesBefore = localStorageWrites.length;
const importGlobalsBefore = {
    histories: structuredClone(window.__pmHistories),
    theme: structuredClone(window.__pmTheme),
    config: structuredClone(window.__pmConfig),
};
const importAlertsBefore = uiAlerts.length;
window.__pmImportData(importInput);
await fileReadCompletion;
assert.equal(importInput.value, '');
assert.equal(importCancelCommunityCalls, 0, 'prepare 失败不得取消社区任务');
assert.equal(importClearInjectionCalls, 0, 'prepare 失败不得清理现有注入');
assert.equal(importInjectionCalls, 0, 'prepare 失败不得执行恢复性注入');
assert.equal(importCloseCalls, 0, 'prepare 失败不得关闭手机界面');
assert.equal(localStorageWrites.length, importWritesBefore, 'prepare 失败不得写入 localStorage');
assert.deepEqual(window.__pmHistories, importGlobalsBefore.histories);
assert.deepEqual(window.__pmTheme, importGlobalsBefore.theme);
assert.deepEqual(window.__pmConfig, importGlobalsBefore.config);
assert.equal(uiElements.get('pm-overlay').removed, false);
assert.equal(uiAlerts.length, importAlertsBefore + 1);
assert.match(uiAlerts.at(-1), /导入失败，未修改现有数据/);
assert.doesNotMatch(uiAlerts.at(-1), /原数据已恢复/);

const baseTheme = { preset: 'default', customRight: '', customLeft: '', borderColor: '#1a1a1a', darkMode: 'light', customTitle: '' };
for (const [handler, setup, invoke] of [
    ['__pmSetDarkMode', () => {}, () => window.__pmSetDarkMode('dark')],
    ['__pmSetPreset', () => {}, () => window.__pmSetPreset('blue')],
    ['__pmSetCustomColor', () => {}, () => window.__pmSetCustomColor()],
    ['__pmClearCustomColor', () => { window.__pmTheme = { ...window.__pmTheme, preset: 'custom', customRight: '#111111', customLeft: '#222222' }; }, () => window.__pmClearCustomColor()],
    ['__pmSetBorderColor', () => {}, () => window.__pmSetBorderColor()],
    ['__pmSetCustomTitle', () => { uiElements.get('pm-custom-title').value = '  雨夜电台  '; }, () => window.__pmSetCustomTitle()],
]) {
    window.__pmTheme = structuredClone(baseTheme);
    setup();
    const previous = structuredClone(window.__pmTheme);
    localStorageControl.failSet.add('ST_SMS_THEME');
    assert.equal(invoke(), false, `${handler} should report persistence failure`);
    assert.deepEqual(window.__pmTheme, previous, `${handler} should restore the previous theme`);
    assert.deepEqual(appliedThemes.at(-1), previous, `${handler} should reapply the previous theme`);
    assert.match(uiAlerts.at(-1), /主题保存失败/);
}
window.__pmTheme = structuredClone(baseTheme);
assert.equal(window.__pmSetDarkMode('dark'), true);
assert.equal(window.__pmTheme.darkMode, 'dark');
assert.equal(JSON.parse(localValues.get('ST_SMS_THEME')).darkMode, 'dark');
assert.equal(appliedThemes.at(-1).darkMode, 'dark');
window.__pmTheme = structuredClone(baseTheme);
uiElements.get('pm-custom-title').value = '  雨夜电台  ';
assert.equal(window.__pmSetCustomTitle(), true);
assert.equal(window.__pmTheme.customTitle, '雨夜电台');
assert.equal(JSON.parse(localValues.get('ST_SMS_THEME')).customTitle, '雨夜电台');
assert.equal(appliedThemes.at(-1).customTitle, '雨夜电台');

window.__pmProfiles = [{ apiUrl: 'https://old.example', apiKey: 'old-key', model: 'old-model' }];
localStorageControl.failSet.add('ST_SMS_API_PROFILES');
assert.equal(window.__pmDeleteProfile(0), false);
assert.equal(window.__pmProfiles.length, 1);
assert.match(uiAlerts.at(-1), /档案删除失败/);
let profilePageRefreshes = 0;
window.__pmShowConfig = page => { assert.equal(page, 'api'); profilePageRefreshes += 1; };
assert.equal(window.__pmDeleteProfile(0), true);
assert.deepEqual(JSON.parse(localValues.get('ST_SMS_API_PROFILES')), []);
assert.equal(profilePageRefreshes, 1);

window.__pmConfig = { apiUrl: 'https://old.example', apiKey: 'old-key', model: 'old-model', useIndependent: false };
window.__pmProfiles = [{ apiUrl: 'https://old.example', apiKey: 'old-key', model: 'old-model' }];
localValues.set('ST_SMS_API_PROFILES', JSON.stringify(window.__pmProfiles));
localValues.set('ST_SMS_CONFIG', JSON.stringify(window.__pmConfig));
localStorageControl.failSet.add('ST_SMS_CONFIG');
assert.equal(window.__pmSaveConfig(), false);
assert.equal(window.__pmConfig.apiUrl, 'https://old.example');
assert.equal(uiElements.get('pm-overlay').removed, false);
assert.match(uiAlerts.at(-1), /API 配置保存失败/);

localStorageControl.failSet.add('ST_SMS_API_PROFILES');
assert.equal(window.__pmSaveConfig(), false);
assert.equal(window.__pmConfig.apiUrl, 'https://old.example');
assert.equal(JSON.parse(localValues.get('ST_SMS_CONFIG')).apiUrl, 'https://old.example');
assert.equal(window.__pmProfiles.length, 1);
assert.equal(uiElements.get('pm-overlay').removed, false);
assert.match(uiAlerts.at(-1), /API 档案保存失败，API 配置已恢复/);

const nextConfigWrite = (localStorageControl.setCalls.get('ST_SMS_CONFIG') || 0) + 1;
localStorageControl.failSet.add('ST_SMS_API_PROFILES');
localStorageControl.failSetOnCalls.set('ST_SMS_CONFIG', new Set([nextConfigWrite + 1]));
assert.equal(window.__pmSaveConfig(), false);
assert.equal(window.__pmConfig.apiUrl, 'https://new.example');
assert.equal(JSON.parse(localValues.get('ST_SMS_CONFIG')).apiUrl, 'https://new.example');
assert.equal(window.__pmProfiles[0].apiUrl, 'https://old.example');
assert.equal(uiElements.get('pm-overlay').removed, false);
assert.match(uiAlerts.at(-1), /API 配置回滚也失败/);

uiElements.get('pm-overlay').removed = false;
window.__pmConfig = { apiUrl: 'https://old.example', apiKey: 'old-key', model: 'old-model', useIndependent: false };
window.__pmProfiles = [{ apiUrl: 'https://old.example', apiKey: 'old-key', model: 'old-model' }];
assert.equal(window.__pmSaveConfig(), true);
assert.equal(window.__pmConfig.apiUrl, 'https://new.example');
assert.equal(JSON.parse(localValues.get('ST_SMS_CONFIG')).apiUrl, 'https://new.example');
assert.equal(JSON.parse(localValues.get('ST_SMS_API_PROFILES')).some(profile => profile.apiUrl === 'https://new.example'), true);
assert.equal(uiElements.get('pm-overlay').removed, true);
assert.match(uiNotes.at(-1), /已保存/);
delete globalThis.document;
delete globalThis.alert;

const promptCalls = [];
const injectionRuntime = { trackedExtensionPromptKeys: new Set(['PHONE_SMS_MEMORY:stale']) };
applyConversationInjections({
    context: { setExtensionPrompt: (...args) => promptCalls.push(args) },
    runtime: injectionRuntime,
    checked: ['__group_closed', '__group_open'],
    histories: {
        __group_closed: [{ role: 'assistant', content: '绝密关闭内容' }],
        __group_open: [{ role: 'assistant', content: '允许注入内容' }],
    },
    groups: {
        __group_closed: normalizeGroupMeta({ name: '关闭群', members: ['A', 'B'], injection: { position: -1 } }),
        __group_open: normalizeGroupMeta({ name: '开放群', members: ['C', 'D'], injection: { position: 2, depth: 4, historyLimit: 1 } }),
    },
    userName: '用户', emojis: [],
});
assert.equal(promptCalls.some(call => String(call[1]).includes('绝密关闭内容')), false);
const openCall = promptCalls.find(call => String(call[1]).includes('允许注入内容'));
assert.ok(openCall);
assert.equal(openCall[2], 2);
assert.equal(openCall[3], 4);
assert.ok(promptCalls.some(call => call[0] === 'PHONE_SMS_MEMORY:stale' && call[1] === ''));

const idbValues = new Map();
const idbOperations = [];
const idbControl = {
    abortAll: true,
    abortOperations: [],
};
function consumeIDBAbort(type, key) {
    if (idbControl.abortAll) return true;
    const index = idbControl.abortOperations.findIndex(rule => rule.type === type && rule.key === key);
    if (index < 0) return false;
    idbControl.abortOperations.splice(index, 1);
    return true;
}
globalThis.indexedDB = {
    open() {
        const request = {};
        queueMicrotask(() => {
            request.result = {
                objectStoreNames: { contains: () => true },
                transaction() {
                    const transaction = {};
                    transaction.objectStore = () => ({
                        put(value, key) {
                            idbOperations.push({ type: 'put', key });
                            queueMicrotask(() => {
                                if (consumeIDBAbort('put', key)) {
                                    transaction.onabort?.();
                                    return;
                                }
                                idbValues.set(key, structuredClone(value));
                                transaction.oncomplete?.();
                            });
                        },
                        get(key) {
                            const getRequest = {};
                            queueMicrotask(() => {
                                if (consumeIDBAbort('get', key)) {
                                    transaction.onabort?.();
                                    return;
                                }
                                getRequest.result = idbValues.has(key)
                                    ? structuredClone(idbValues.get(key))
                                    : undefined;
                                getRequest.onsuccess?.();
                                transaction.oncomplete?.();
                            });
                            return getRequest;
                        },
                        delete(key) {
                            idbOperations.push({ type: 'delete', key });
                            queueMicrotask(() => {
                                if (consumeIDBAbort('delete', key)) {
                                    transaction.onabort?.();
                                    return;
                                }
                                idbValues.delete(key);
                                transaction.oncomplete?.();
                            });
                        },
                    });
                    return transaction;
                },
                close() {},
            };
            request.onsuccess?.();
        });
        return request;
    },
};
assert.equal(await pmIDBSet('abort-test', { value: 1 }), false);
assert.equal(await pmIDBGet('abort-test'), null);
assert.equal(await pmIDBDel('abort-test'), false);

idbControl.abortAll = false;
const migrationBackground = label => `data:image/png;base64,${label}${'x'.repeat(5000)}`;
const desktopMigrationValue = migrationBackground('desktop-migration');
localValues.set('ST_SMS_BG_DESKTOP', desktopMigrationValue);
localValues.delete('ST_SMS_BG_GLOBAL');
localValues.set('ST_SMS_BG_LOCAL', '{}');
idbControl.abortOperations.push({ type: 'put', key: 'ST_SMS_BG_DESKTOP' });
await loadBgSettings();
assert.equal(window.__pmDesktopBg, desktopMigrationValue, '迁移失败时当前桌面背景仍必须可用');
assert.equal(localValues.get('ST_SMS_BG_DESKTOP'), desktopMigrationValue, 'IndexedDB 写入失败不得把桌面原值替换为 marker');
assert.equal(idbValues.has('ST_SMS_BG_DESKTOP'), false);
localValues.delete('ST_SMS_BG_DESKTOP');

const localMigrationAlice = migrationBackground('local-alice');
const localMigrationBob = migrationBackground('local-bob');
localValues.set('ST_SMS_BG_LOCAL', JSON.stringify({ story_Alice: localMigrationAlice, story_Bob: localMigrationBob }));
idbControl.abortOperations.push({ type: 'put', key: 'ST_SMS_BG_LOCAL_story_Bob' });
await loadBgSettings();
assert.deepEqual(JSON.parse(localValues.get('ST_SMS_BG_LOCAL')), {
    story_Alice: '__idb__',
    story_Bob: localMigrationBob,
}, '局部背景只能为已成功迁移的条目提交 marker');
assert.equal(idbValues.get('ST_SMS_BG_LOCAL_story_Alice'), localMigrationAlice);
assert.equal(idbValues.has('ST_SMS_BG_LOCAL_story_Bob'), false);
assert.equal(window.__pmBgLocal.story_Bob, localMigrationBob);

const localMigrationCarol = migrationBackground('local-carol');
idbValues.delete('ST_SMS_BG_LOCAL_story_Alice');
localValues.set('ST_SMS_BG_LOCAL', JSON.stringify({ story_Carol: localMigrationCarol }));
localStorageControl.failSet.add('ST_SMS_BG_LOCAL');
await loadBgSettings();
assert.deepEqual(JSON.parse(localValues.get('ST_SMS_BG_LOCAL')), { story_Carol: localMigrationCarol }, '索引提交失败必须保留原始局部背景');
assert.equal(idbValues.has('ST_SMS_BG_LOCAL_story_Carol'), false, '索引提交失败必须补偿删除已写入的主数据');
assert.equal(window.__pmBgLocal.story_Carol, localMigrationCarol);
localValues.set('ST_SMS_BG_LOCAL', '{}');

const assertRejectedBackgroundLoad = async serialized => {
    const idbSnapshot = new Map(idbValues);
    localValues.set('ST_SMS_BG_LOCAL', serialized);
    idbOperations.length = 0;
    await loadBgSettings();
    assert.deepEqual(idbOperations.filter(operation => operation.type !== 'get'), []);
    assert.deepEqual(idbValues, idbSnapshot);
    assert.equal(Object.getPrototypeOf(window.__pmBgLocal), null);
    assert.deepEqual(Object.keys(window.__pmBgLocal), []);
    assert.equal(localValues.get('ST_SMS_BG_LOCAL'), serialized);
};
localValues.set('ST_SMS_BG_LOCAL', '{"story_Alice":"https://example.test/background.png"}');
await loadBgSettings();
assert.equal(Object.getPrototypeOf(window.__pmBgLocal), null);
assert.equal(window.__pmBgLocal.story_Alice, 'https://example.test/background.png');
await assertRejectedBackgroundLoad('{broken');
await assertRejectedBackgroundLoad('[]');
await assertRejectedBackgroundLoad('null');
await assertRejectedBackgroundLoad('42');
await assertRejectedBackgroundLoad('{"story_Alice":42}');
await assertRejectedBackgroundLoad('{"story_Alice":null}');
await assertRejectedBackgroundLoad('{"story_Alice":{}}');
await assertRejectedBackgroundLoad('{"story_Alice":[]}');
await assertRejectedBackgroundLoad(`{"__proto__":"${`data:image/png;base64,${'x'.repeat(5000)}`}"}`);
await assertRejectedBackgroundLoad('{"constructor":"https://example.test/background.png"}');
await assertRejectedBackgroundLoad('{"prototype":"https://example.test/background.png"}');
const readFailureIdbSnapshot = new Map(idbValues);
localValues.set('ST_SMS_BG_LOCAL', '{"story_Alice":"https://example.test/background.png"}');
localStorageControl.failGet.add('ST_SMS_BG_LOCAL');
idbOperations.length = 0;
await loadBgSettings();
assert.deepEqual(idbOperations.filter(operation => operation.type !== 'get'), []);
assert.deepEqual(idbValues, readFailureIdbSnapshot);
assert.equal(Object.getPrototypeOf(window.__pmBgLocal), null);
assert.deepEqual(Object.keys(window.__pmBgLocal), []);
assert.equal(localValues.get('ST_SMS_BG_LOCAL'), '{"story_Alice":"https://example.test/background.png"}');

idbValues.set('ST_SMS_BG_LOCAL_story_Alice', 'data:image/png;base64,old');
localValues.set('ST_SMS_BG_LOCAL', JSON.stringify({ story_Alice: '__idb__' }));
window.__pmBgLocal = {};
idbControl.abortOperations.push({ type: 'delete', key: 'ST_SMS_BG_LOCAL_story_Alice' });
await assert.rejects(saveBgLocal(), /会话背景删除失败：IndexedDB 不可用/);
assert.equal(idbValues.get('ST_SMS_BG_LOCAL_story_Alice'), 'data:image/png;base64,old');

localValues.set('ST_SMS_BG_LOCAL', JSON.stringify({ story_Alice: 'https://example.test/old.png' }));
window.__pmBgLocal = { story_Alice: 'https://example.test/new.png' };
await saveBgLocal();
assert.deepEqual(JSON.parse(localValues.get('ST_SMS_BG_LOCAL')), window.__pmBgLocal);

const assertRejectedBackgroundIndex = async (serialized, pattern) => {
    const idbSnapshot = new Map(idbValues);
    localValues.set('ST_SMS_BG_LOCAL', serialized);
    window.__pmBgLocal = { story_Alice: 'https://example.test/new.png' };
    await assert.rejects(saveBgLocal(), pattern);
    assert.equal(localValues.get('ST_SMS_BG_LOCAL'), serialized);
    assert.deepEqual(idbValues, idbSnapshot);
};
localValues.set('ST_SMS_BG_LOCAL', '{broken');
await assert.rejects(saveBgLocal(), /会话背景索引损坏：无法解析/);
localValues.set('ST_SMS_BG_LOCAL', '[]');
await assert.rejects(saveBgLocal(), /会话背景索引损坏：必须是对象/);
await assertRejectedBackgroundIndex('{"story_Alice":42}', /story_Alice 必须是字符串/);
await assertRejectedBackgroundIndex('{"story_Alice":null}', /story_Alice 必须是字符串/);
await assertRejectedBackgroundIndex('{"story_Alice":{}}', /story_Alice 必须是字符串/);
await assertRejectedBackgroundIndex('{"story_Alice":[]}', /story_Alice 必须是字符串/);
await assertRejectedBackgroundIndex('{"__proto__":"__idb__"}', /包含危险键 __proto__/);
localValues.set('ST_SMS_BG_LOCAL', '{}');
localStorageControl.failGet.add('ST_SMS_BG_LOCAL');
await assert.rejects(saveBgLocal(), /会话背景索引读取失败：浏览器存储不可用/);
localValues.set('ST_SMS_BG_LOCAL', '{}');
window.__pmBgLocal = JSON.parse('{"__proto__":"https://example.test/background.png"}');
await assert.rejects(saveBgLocal(), /会话背景数据损坏：包含危险键 __proto__/);
assert.equal(localValues.get('ST_SMS_BG_LOCAL'), '{}');
const undefinedIdbSnapshot = new Map(idbValues);
window.__pmBgLocal = { story_Alice: undefined };
idbOperations.length = 0;
await assert.rejects(saveBgLocal(), /会话背景数据损坏：story_Alice 必须是字符串/);
assert.equal(localValues.get('ST_SMS_BG_LOCAL'), '{}');
assert.deepEqual(idbValues, undefinedIdbSnapshot);
assert.deepEqual(idbOperations, []);
window.__pmBgLocal = { story_Alice: { url: 'https://example.test/background.png' } };
await assert.rejects(saveBgLocal(), /会话背景数据损坏：story_Alice 必须是字符串/);
assert.equal(localValues.get('ST_SMS_BG_LOCAL'), '{}');

const largeBackground = suffix => `data:image/png;base64,${suffix}${'x'.repeat(5000)}`;
const newDesktopBackground = largeBackground('new-desktop');
localValues.delete('ST_SMS_BG_DESKTOP');
idbValues.delete('ST_SMS_BG_DESKTOP');
window.__pmDesktopBg = newDesktopBackground;
idbControl.abortOperations.push({ type: 'put', key: 'ST_SMS_BG_DESKTOP' });
await assert.rejects(saveDesktopBg(), /桌面背景保存失败：IndexedDB 不可用/);
assert.equal(idbValues.has('ST_SMS_BG_DESKTOP'), false, '桌面背景主体写失败不得留下主数据');
assert.equal(localValues.has('ST_SMS_BG_DESKTOP'), false, '桌面背景主体写失败不得提交索引');

localValues.delete('ST_SMS_BG_DESKTOP');
window.__pmDesktopBg = newDesktopBackground;
localStorageControl.failSet.add('ST_SMS_BG_DESKTOP');
await assert.rejects(saveDesktopBg(), /桌面背景索引保存失败：浏览器存储不可用/);
assert.equal(idbValues.has('ST_SMS_BG_DESKTOP'), false, '桌面背景索引失败必须补偿删除新主数据');
assert.equal(localValues.has('ST_SMS_BG_DESKTOP'), false, '桌面背景索引失败必须保留旧索引状态');

const oldDesktopBackground = largeBackground('old-desktop');
idbValues.set('ST_SMS_BG_DESKTOP', oldDesktopBackground);
localValues.set('ST_SMS_BG_DESKTOP', '__idb__');
window.__pmDesktopBg = '';
localStorageControl.failSet.add('ST_SMS_BG_DESKTOP');
await assert.rejects(saveDesktopBg(), /桌面背景保存失败：浏览器存储不可用/);
assert.equal(idbValues.get('ST_SMS_BG_DESKTOP'), oldDesktopBackground,
    '桌面背景小数据索引失败必须恢复旧主数据');
assert.equal(localValues.get('ST_SMS_BG_DESKTOP'), '__idb__', '桌面背景小数据索引失败必须保留旧指针');

localValues.delete('ST_SMS_BG_DESKTOP');
idbValues.delete('ST_SMS_BG_DESKTOP');
window.__pmDesktopBg = newDesktopBackground;
localStorageControl.failSet.add('ST_SMS_BG_DESKTOP');
idbControl.abortOperations.push({ type: 'delete', key: 'ST_SMS_BG_DESKTOP' });
await assert.rejects(saveDesktopBg(),
    /桌面背景索引保存失败：浏览器存储不可用；桌面背景主数据补偿失败/);
assert.equal(idbValues.get('ST_SMS_BG_DESKTOP'), newDesktopBackground,
    '桌面背景补偿失败必须保留可诊断的实际主数据状态');
assert.equal(localValues.has('ST_SMS_BG_DESKTOP'), false);
idbValues.delete('ST_SMS_BG_DESKTOP');

const newGlobalBackground = largeBackground('new-global');
localValues.delete('ST_SMS_BG_GLOBAL');
idbValues.delete('ST_SMS_BG_GLOBAL');
window.__pmBgGlobal = newGlobalBackground;
idbControl.abortOperations.push({ type: 'put', key: 'ST_SMS_BG_GLOBAL' });
await assert.rejects(saveBgGlobal(), /全局背景保存失败：IndexedDB 不可用/);
assert.equal(idbValues.has('ST_SMS_BG_GLOBAL'), false, '全局背景主体写失败不得留下主数据');
assert.equal(localValues.has('ST_SMS_BG_GLOBAL'), false, '全局背景主体写失败不得提交索引');

localValues.delete('ST_SMS_BG_GLOBAL');
window.__pmBgGlobal = newGlobalBackground;
localStorageControl.failSet.add('ST_SMS_BG_GLOBAL');
await assert.rejects(saveBgGlobal(), /全局背景索引保存失败/);
assert.equal(idbValues.has('ST_SMS_BG_GLOBAL'), false);
assert.equal(localValues.has('ST_SMS_BG_GLOBAL'), false);

const oldGlobalBackground = largeBackground('old-global');
idbValues.set('ST_SMS_BG_GLOBAL', oldGlobalBackground);
localValues.set('ST_SMS_BG_GLOBAL', '__idb__');
window.__pmBgGlobal = '';
localStorageControl.failSet.add('ST_SMS_BG_GLOBAL');
await assert.rejects(saveBgGlobal(), /全局背景保存失败/);
assert.equal(idbValues.get('ST_SMS_BG_GLOBAL'), oldGlobalBackground);
assert.equal(localValues.get('ST_SMS_BG_GLOBAL'), '__idb__');

localValues.delete('ST_SMS_BG_GLOBAL');
window.__pmBgGlobal = newGlobalBackground;
localStorageControl.failSet.add('ST_SMS_BG_GLOBAL');
idbControl.abortOperations.push({ type: 'delete', key: 'ST_SMS_BG_GLOBAL' });
await assert.rejects(saveBgGlobal(), /全局背景索引保存失败：浏览器存储不可用；全局背景主数据补偿失败/);
assert.equal(idbValues.get('ST_SMS_BG_GLOBAL'), newGlobalBackground);
assert.equal(localValues.has('ST_SMS_BG_GLOBAL'), false);
idbValues.delete('ST_SMS_BG_GLOBAL');

idbValues.set('ST_SMS_BG_GLOBAL', oldGlobalBackground);
localValues.set('ST_SMS_BG_GLOBAL', '__idb__');
window.__pmBgGlobal = '';
localStorageControl.failSet.add('ST_SMS_BG_GLOBAL');
idbControl.abortOperations.push({ type: 'put', key: 'ST_SMS_BG_GLOBAL' });
await assert.rejects(saveBgGlobal(), /全局背景保存失败：浏览器存储不可用；全局背景主数据补偿失败/);
assert.equal(idbValues.has('ST_SMS_BG_GLOBAL'), false);
assert.equal(localValues.get('ST_SMS_BG_GLOBAL'), '__idb__');

const oldAliceBackground = largeBackground('old-alice');
const newAliceBackground = largeBackground('new-alice');
const newBobBackground = largeBackground('new-bob');
idbValues.set('ST_SMS_BG_LOCAL_story_Alice', oldAliceBackground);
localValues.set('ST_SMS_BG_LOCAL', JSON.stringify({
    story_Alice: '__idb__',
    story_Carol: 'https://example.test/carol.png',
}));
window.__pmBgLocal = {
    story_Alice: newAliceBackground,
    story_Bob: newBobBackground,
    story_Carol: 'https://example.test/carol-new.png',
};
localStorageControl.failSet.add('ST_SMS_BG_LOCAL');
await assert.rejects(saveBgLocal(), /会话背景索引保存失败/);
assert.equal(idbValues.get('ST_SMS_BG_LOCAL_story_Alice'), oldAliceBackground);
assert.equal(idbValues.has('ST_SMS_BG_LOCAL_story_Bob'), false);
assert.deepEqual(JSON.parse(localValues.get('ST_SMS_BG_LOCAL')), {
    story_Alice: '__idb__',
    story_Carol: 'https://example.test/carol.png',
});

idbValues.set('ST_SMS_BG_LOCAL_story_Alice', oldAliceBackground);
localValues.set('ST_SMS_BG_LOCAL', JSON.stringify({ story_Alice: '__idb__' }));
window.__pmBgLocal = {
    story_Alice: newAliceBackground,
    story_Bob: newBobBackground,
};
idbControl.abortOperations.push({ type: 'put', key: 'ST_SMS_BG_LOCAL_story_Bob' });
await assert.rejects(saveBgLocal(), /会话背景保存失败：IndexedDB 不可用/);
assert.equal(idbValues.get('ST_SMS_BG_LOCAL_story_Alice'), oldAliceBackground);
assert.equal(idbValues.has('ST_SMS_BG_LOCAL_story_Bob'), false);
assert.deepEqual(JSON.parse(localValues.get('ST_SMS_BG_LOCAL')), { story_Alice: '__idb__' });

idbValues.delete('ST_SMS_BG_LOCAL_story_Alice');
localValues.set('ST_SMS_BG_LOCAL', '{}');
window.__pmBgLocal = { story_Alice: newAliceBackground };
localStorageControl.failSet.add('ST_SMS_BG_LOCAL');
idbControl.abortOperations.push({ type: 'delete', key: 'ST_SMS_BG_LOCAL_story_Alice' });
await assert.rejects(saveBgLocal(), /会话背景索引保存失败：浏览器存储不可用；会话背景主数据补偿失败/);
assert.equal(idbValues.get('ST_SMS_BG_LOCAL_story_Alice'), newAliceBackground);
assert.equal(localValues.get('ST_SMS_BG_LOCAL'), '{}');
idbValues.delete('ST_SMS_BG_LOCAL_story_Alice');

window.__pmHistories = { story: { Alice: [{ role: 'user', content: '保留' }] } };
idbControl.abortAll = true;
await assert.rejects(saveHistoriesStrict(), /IndexedDB 不可用/);
idbControl.abortAll = false;

const currentBackup = {
    histories: {}, config: {}, theme: { darkMode: 'dark', ambientStatusEnabled: true }, profiles: [], groupMeta: {}, pokeConfig: {},
    bidirectional: {}, emojis: [], characterBehavior: {}, wordyLimit: false,
    desktopBg: 'https://example.test/current-desktop.png', bgGlobal: '', bgLocal: {}, interactiveScenes: { version: 1, scopes: {} },
    calendarStore: { version: 1, scopes: { current: { events: {} } } },
    calendarOccasions: { version: 1, scopes: {} },
    calendarHolidays: { version: 1, selectedCountry: 'JP', years: {} },
    calendarWeather: { version: 1, location: null, lastSuccess: null },
    calendarCycles: { version: 1, scopes: {} },
    phoneUiState: {
        version: 1,
        scopes: { story: { pinnedSceneIds: [], lastPage: 'chat', lastSceneId: null, lastTab: 'feed' } },
    },
    ambientStatus: { enabled: true },
};
const parsedLegacyBackup = parseBackupData({ histories: { story: {} } }, currentBackup);
assert.deepEqual(parsedLegacyBackup.histories, { story: {} });
assert.equal(parsedLegacyBackup.desktopBg, currentBackup.desktopBg, 'v1-v5 备份不得覆盖后加入的桌面背景');
assert.deepEqual(parsedLegacyBackup.interactiveScenes, currentBackup.interactiveScenes);
assert.deepEqual(parsedLegacyBackup.phoneUiState, currentBackup.phoneUiState);
assert.deepEqual(parsedLegacyBackup.ambientStatus, currentBackup.ambientStatus);
for (const schemaVersion of [undefined, 2, 3]) {
    const backup = {
        ...(schemaVersion === undefined ? {} : { schemaVersion }),
        theme: { darkMode: 'light', ambientStatusEnabled: false },
        phoneUiState: {
            version: 1,
            scopes: { story: { pinnedSceneIds: ['forged'], lastPage: 'community', lastSceneId: 'forged', lastTab: 'live' } },
        },
        ambientStatus: { enabled: false },
    };
    const parsed = parseBackupData(backup, currentBackup);
    assert.equal(parsed.theme.darkMode, 'light');
    assert.equal(parsed.theme.ambientStatusEnabled, true);
    assert.deepEqual(parsed.phoneUiState, currentBackup.phoneUiState);
    assert.deepEqual(parsed.ambientStatus, currentBackup.ambientStatus);
    assert.equal(Object.hasOwn(backup.theme, 'ambientStatusEnabled'), true);
}
assert.throws(() => parseBackupData({ schemaVersion: '3' }, currentBackup), /备份版本无效/);
assert.throws(() => parseBackupData({ schemaVersion: 7 }, currentBackup), /高于当前支持版本 6/);
const parsedV4Backup = parseBackupData({
    schemaVersion: 4,
    theme: { darkMode: 'light', ambientStatusEnabled: true },
    interactiveScenes: {
        version: 1,
        scopes: {
            story: {
                activeSceneId: 'scene-v4', sceneOrder: ['scene-v4'],
                scenes: { 'scene-v4': { id: 'scene-v4', title: 'v4 社区' } },
            },
        },
    },
    phoneUiState: {
        version: 1,
        scopes: {
            story: {
                pinnedSceneIds: ['scene-v4', 'missing'], lastPage: 'community', lastSceneId: 'scene-v4', lastTab: 'live',
            },
            other: {
                pinnedSceneIds: ['scene-v4'], lastPage: 'community', lastSceneId: 'scene-v4', lastTab: 'prompt',
            },
        },
    },
    ambientStatus: { enabled: false },
}, currentBackup);
assert.equal(parsedV4Backup.theme.darkMode, 'light');
assert.equal(parsedV4Backup.theme.ambientStatusEnabled, false);
assert.deepEqual(parsedV4Backup.ambientStatus, { enabled: false });
assert.deepEqual(parsedV4Backup.phoneUiState.scopes.story, {
    pinnedSceneIds: ['scene-v4'], lastPage: 'community', lastSceneId: 'scene-v4', lastTab: 'live',
});
assert.deepEqual(parsedV4Backup.phoneUiState.scopes.other, {
    pinnedSceneIds: [], lastPage: 'desktop', lastSceneId: null, lastTab: 'prompt',
});
const parsedV4Defaults = parseBackupData({ schemaVersion: 4 }, currentBackup);
assert.deepEqual(parsedV4Defaults.phoneUiState, { version: 1, scopes: {} });
assert.deepEqual(parsedV4Defaults.ambientStatus, { enabled: false });
assert.throws(() => parseBackupData({ schemaVersion: 4, phoneUiState: [] }, currentBackup), /phoneUiState 必须是对象/);
assert.throws(() => parseBackupData({ schemaVersion: 4, ambientStatus: [] }, currentBackup), /ambientStatus 必须是对象/);
assert.equal(parsedV4Defaults.calendarHolidays.selectedCountry, 'JP', 'v4 备份不得清空现有日历数据');
const parsedV5Backup = parseBackupData({
    schemaVersion: 5,
    calendarStore: { version: 1, scopes: {} },
    calendarOccasions: { version: 1, scopes: {} },
    calendarHolidays: { version: 1, selectedCountry: 'US', years: {} },
    calendarWeather: { version: 1, location: null, lastSuccess: null },
    calendarCycles: { version: 1, scopes: {} },
}, currentBackup);
assert.deepEqual(parsedV5Backup.calendarStore.scopes, {});
assert.equal(parsedV5Backup.calendarHolidays.selectedCountry, 'US');
assert.equal(parsedV5Backup.desktopBg, currentBackup.desktopBg);
assert.equal(parseBackupData({ schemaVersion: 6 }, currentBackup).desktopBg, '');
assert.equal(parseBackupData({ schemaVersion: 6, desktopBg: 'https://example.test/imported.png' }, currentBackup).desktopBg, 'https://example.test/imported.png');
assert.throws(() => parseBackupData({ schemaVersion: 6, desktopBg: {} }, currentBackup), /desktopBg 必须是字符串/);
assert.throws(() => parseBackupData({ schemaVersion: 5, calendarStore: [] }, currentBackup), /calendarStore 必须是对象/);
assert.throws(() => parseBackupData({ schemaVersion: 5, calendarWeather: [] }, currentBackup), /calendarWeather 必须是对象/);
const assertInvalidV5CalendarField = (field, value, pattern = new RegExp(field)) => {
    assert.throws(() => parseBackupData({ schemaVersion: 5, [field]: value }, currentBackup), pattern);
};
assertInvalidV5CalendarField('calendarStore', {
    version: 1,
    scopes: { story: { autoAdjust: false, events: { '2026-07-01': [{ id: 'bad', date: '2026-07-01', title: '', note: '', source: 'manual', createdAt: 1, updatedAt: 1 }] }, lastGeneratedAt: 0, lastAdjustedAt: 0 } },
});
assertInvalidV5CalendarField('calendarStore', {
    version: 1, scopes: {}, unsupported: true,
});
assertInvalidV5CalendarField('calendarOccasions', {
    version: 1,
    scopes: { story: { occasions: [{ id: 'bad', type: 'birthday', month: 2, day: 30, title: '坏日期', note: '', leapDayRule: 'feb28', createdAt: 1, updatedAt: 1 }] } },
});
assertInvalidV5CalendarField('calendarHolidays', {
    version: 1, selectedCountry: 'XX', years: {},
});
assertInvalidV5CalendarField('calendarWeather', {
    version: 1,
    location: { name: '上海', latitude: 31.2, longitude: 121.4, country: 'CN', admin1: '', timezone: 'Asia/Shanghai' },
    lastSuccess: {
        locationKey: '35,139|东京', fetchedAt: 1,
        forecast: { days: [{ date: '2026-07-01', weatherCode: 1, tempMax: 30, tempMin: 20 }], attribution: 'Weather data by Open-Meteo (CC BY 4.0)' },
    },
});
assertInvalidV5CalendarField('calendarCycles', {
    version: 1,
    scopes: { story: { enabled: true, lastPeriodStart: null, cycleLength: 28, periodLength: 5, overrides: {} } },
}, /启用周期提示时必须设置/);

let prepareBeforeApplyCalls = 0;
let prepareApplyCalls = 0;
let preparePersistCalls = 0;
await assert.rejects(runBackupTransaction({
    capture: async () => structuredClone(currentBackup),
    prepare: current => parseBackupData({
        schemaVersion: 5,
        calendarCycles: {
            version: 1,
            scopes: { story: { enabled: true, lastPeriodStart: null, cycleLength: 28, periodLength: 5, overrides: {} } },
        },
    }, current),
    beforeApply: async () => { prepareBeforeApplyCalls += 1; },
    apply: async () => { prepareApplyCalls += 1; },
    persist: async () => { preparePersistCalls += 1; },
}), /启用周期提示时必须设置/);
assert.equal(prepareBeforeApplyCalls, 0, '备份校验失败不得进入事务副作用阶段');
assert.equal(prepareApplyCalls, 0, '备份校验失败不得修改内存状态');
assert.equal(preparePersistCalls, 0, '备份校验失败不得写入存储');
assert.throws(() => parseBackupData({ schemaVersion: 3, histories: 'broken' }, currentBackup), /histories 必须是对象/);
assert.throws(() => parseBackupData({ schemaVersion: 3, profiles: {} }, currentBackup), /profiles 必须是数组/);
assert.throws(() => parseBackupData({ schemaVersion: 3, wordyLimit: 'yes' }, currentBackup), /wordyLimit 必须是布尔值/);
assert.throws(() => parseBackupData({
    schemaVersion: 3,
    interactiveScenes: { version: 1, scopes: [] },
}, currentBackup), /scopes 必须是对象/);
assert.throws(() => parseBackupData({
    schemaVersion: 3,
    interactiveScenes: { version: 1, scopes: { story: { activeSceneId: null, sceneOrder: {}, scenes: {} } } },
}, currentBackup), /sceneOrder 必须是数组/);
const recoveredEmptyLegacyScope = parseBackupData({
    schemaVersion: 3,
    interactiveScenes: { version: 1, scopes: { story: { activeSceneId: 'missing', sceneOrder: [], scenes: {} } } },
}, currentBackup).interactiveScenes.scopes.story;
assert.equal(recoveredEmptyLegacyScope.activeSceneId, null);
const recoveredLegacyOrphan = parseBackupData({
    schemaVersion: 3,
    interactiveScenes: { version: 1, scopes: { story: { activeSceneId: null, sceneOrder: [], scenes: { orphan: { id: 'orphan' } } } } },
}, currentBackup).interactiveScenes.scopes.story;
assert.deepEqual(recoveredLegacyOrphan.sceneOrder, []);
assert.deepEqual(recoveredLegacyOrphan.scenes, {});
assert.throws(() => parseBackupData({
    schemaVersion: 3,
    interactiveScenes: { version: 1, scopes: { story: { activeSceneId: 'scene', sceneOrder: ['scene'], scenes: { scene: { id: 'scene', posts: ['broken'] } } } } },
}, currentBackup), /posts\.0 必须是对象/);
assert.throws(() => parseBackupData({
    schemaVersion: 3,
    interactiveScenes: { version: 1, scopes: { story: { activeSceneId: 'scene', sceneOrder: ['scene'], scenes: { scene: { id: 'scene', posts: [{ content: '帖子', comments: {} }] } } } } },
}, currentBackup), /comments 必须是数组/);
assert.throws(() => parseBackupData({
    schemaVersion: 3,
    interactiveScenes: { version: 1, scopes: { story: { activeSceneId: 'scene', sceneOrder: ['scene'], scenes: { scene: { id: 'scene', posts: [{ content: '帖子', comments: ['broken'] }] } } } } },
}, currentBackup), /comments\.0 必须是对象/);
assert.throws(() => parseBackupData({
    schemaVersion: 3,
    interactiveScenes: { version: 1, scopes: { story: { activeSceneId: 'scene', sceneOrder: ['scene'], scenes: { scene: { id: 'scene', live: { danmaku: ['broken'] } } } } } },
}, currentBackup), /danmaku\.0 必须是对象/);
assert.throws(() => parseBackupData({
    schemaVersion: 3,
    interactiveScenes: { version: 1, scopes: { story: { activeSceneId: 'scene', sceneOrder: ['scene'], scenes: { scene: { id: 'scene', posts: [{ content: 123 }] } } } } },
}, currentBackup), /content 必须是字符串/);

const interactiveBackupWithScene = (scene, scope = {}) => ({
    schemaVersion: 3,
    interactiveScenes: {
        version: 1,
        scopes: {
            story: {
                activeSceneId: 'scene',
                sceneOrder: ['scene'],
                scenes: { scene },
                ...scope,
            },
        },
    },
});
const assertInvalidInteractiveScene = (scene, pattern, scope) => {
    assert.throws(() => parseBackupData(interactiveBackupWithScene(scene, scope), currentBackup), pattern);
};
const validInteractiveScene = {
    id: 'scene', title: '社区', preset: 'weibo', styleInput: '', generatedPrompt: '自然交流',
    contentRating: 'legacy-value', createdAt: 100, updatedAt: 200,
    posts: [{
        id: 'post', author: '作者', content: '帖子', tags: ['日常'], createdAt: 110,
        comments: [{ id: 'comment', author: '评论者', content: '评论', createdAt: 120 }], liked: false,
    }],
    live: {
        title: '直播间', status: 'idle',
        danmaku: [{ id: 'danmaku', author: '观众', content: '弹幕', createdAt: 130 }],
    },
};
const parsedMigratedBackup = parseBackupData(interactiveBackupWithScene(validInteractiveScene), currentBackup);
const migratedScene = parsedMigratedBackup.interactiveScenes.scopes.story.scenes.scene;
assert.equal(parsedMigratedBackup.interactiveScenes.version, 2);
assert.equal(Object.hasOwn(migratedScene, 'contentRating'), false);
assert.equal(migratedScene.content, validInteractiveScene.content);
assert.equal(migratedScene.posts[0].content, validInteractiveScene.posts[0].content);
assert.equal(migratedScene.posts[0].authorNameSnapshot, '作者');
assert.equal(migratedScene.posts[0].comments[0].authorNameSnapshot, '评论者');
assert.equal(migratedScene.live.danmaku[0].authorNameSnapshot, '观众');
assert.ok(parsedMigratedBackup.interactiveScenes.scopes.story.actors[migratedScene.posts[0].authorId]);
assert.ok(parsedMigratedBackup.interactiveScenes.scopes.story.actors[migratedScene.posts[0].comments[0].authorId]);
const parsedLegacyScene = parseBackupData(interactiveBackupWithScene({ id: 'scene' }, { activeSceneId: null }), currentBackup);
assert.equal(parsedLegacyScene.interactiveScenes.scopes.story.activeSceneId, 'scene');
const normalizedLegacyIds = parseBackupData(interactiveBackupWithScene({ id: ' scene ', title: '社区' }, {
    activeSceneId: ' scene ',
    sceneOrder: [' scene '],
    scenes: { ' scene ': { id: ' scene ', title: '社区' } },
}), currentBackup).interactiveScenes.scopes.story;
assert.deepEqual(normalizedLegacyIds.sceneOrder, ['scene']);
assert.equal(normalizedLegacyIds.activeSceneId, 'scene');
assert.equal(normalizedLegacyIds.scenes.scene.id, 'scene');
assert.equal(Object.getPrototypeOf(normalizedLegacyIds.scenes), Object.prototype);
assert.throws(() => parseBackupData(interactiveBackupWithScene({ id: 'scene' }, {
    activeSceneId: 'scene',
    sceneOrder: [' scene ', 'scene'],
    scenes: { ' scene ': { id: ' scene ' }, scene: { id: 'scene' } },
}), currentBackup), /归一化后.*(?:重复|冲突)|包含重复场景/);
assert.throws(() => parseBackupData(JSON.parse('{"schemaVersion":3,"interactiveScenes":{"version":2,"scopes":{"story":{"activeSceneId":"scene","sceneOrder":["scene"],"actors":{},"scenes":{"scene":{"id":"scene","title":"社区","preset":"weibo","styleInput":"","generatedPrompt":"","createdAt":1,"updatedAt":1,"posts":[{"id":"post","authorId":"toString","authorNameSnapshot":"伪造","content":"帖子","tags":[],"createdAt":1,"comments":[],"liked":false}],"live":{"title":"直播","status":"idle","danmaku":[]}}}}}}}'), currentBackup), /authorId 未指向有效 actor|包含危险键/);
const mismatchedLegacySceneStore = {
    version: 1,
    scopes: {
        story: {
            activeSceneId: 'safe', sceneOrder: ['safe'],
            scenes: { safe: { id: 'other', title: '旧场景' } },
        },
    },
};
assert.throws(() => normalizeInteractiveStore(mismatchedLegacySceneStore), /id 必须与场景键一致/);
assert.throws(() => parseBackupData({ schemaVersion: 3, interactiveScenes: mismatchedLegacySceneStore }, currentBackup), /id 必须与场景键一致/);
const overflowSceneOrder = Array.from({ length: 13 }, (_, index) => `scene${index}`);
const overflowLegacyStore = {
    version: 1,
    scopes: {
        story: {
            activeSceneId: 'scene0',
            sceneOrder: overflowSceneOrder,
            scenes: Object.fromEntries(overflowSceneOrder.map(sceneId => [sceneId, { title: sceneId }])),
        },
    },
};
const normalizedOverflowModel = normalizeInteractiveStore(overflowLegacyStore);
const normalizedOverflowBackup = parseBackupData({
    schemaVersion: 3, interactiveScenes: overflowLegacyStore,
}, currentBackup).interactiveScenes;
assert.deepEqual(normalizedOverflowBackup, normalizedOverflowModel);
assert.deepEqual(normalizedOverflowModel.scopes.story.sceneOrder, overflowSceneOrder.slice(-12));
assert.equal(normalizedOverflowModel.scopes.story.activeSceneId, 'scene12');
assert.equal(normalizedOverflowModel.scopes.story.scenes.scene1.id, 'scene1');
assert.equal(normalizedOverflowModel.scopes.story.scenes.scene0, undefined);
assert.deepEqual(normalizeInteractiveStore(normalizedOverflowModel), normalizedOverflowModel);

const normalizedLegacyBackup = parseBackupData(interactiveBackupWithScene({
    ...validInteractiveScene,
    title: ` ${'社'.repeat(81)} `,
    preset: '',
    styleInput: ` ${'风'.repeat(2001)} `,
    generatedPrompt: ` ${'提'.repeat(6001)} `,
    posts: [{
        id: 'post', author: ` ${'作'.repeat(81)} `, content: ` ${'帖'.repeat(4001)} `,
        tags: [` ${'标'.repeat(31)} `], createdAt: 110,
        comments: [{ id: 'comment', author: ` ${'评'.repeat(81)} `, content: ` ${'论'.repeat(1001)} `, createdAt: 120 }],
        liked: false,
    }],
    live: {
        ...validInteractiveScene.live,
        title: ` ${'直'.repeat(101)} `,
        danmaku: [{ id: 'danmaku', author: ` ${'观'.repeat(81)} `, content: ` ${'弹'.repeat(201)} `, createdAt: 130 }],
    },
}), currentBackup).interactiveScenes.scopes.story.scenes.scene;
assert.equal(normalizedLegacyBackup.title, '社'.repeat(80));
assert.equal(normalizedLegacyBackup.preset, 'weibo');
assert.equal(normalizedLegacyBackup.styleInput, '风'.repeat(2000));
assert.equal(normalizedLegacyBackup.generatedPrompt, '提'.repeat(6000));
assert.equal(normalizedLegacyBackup.posts[0].content, '帖'.repeat(4000));
assert.equal(normalizedLegacyBackup.posts[0].authorNameSnapshot, '作'.repeat(80));
assert.deepEqual(normalizedLegacyBackup.posts[0].tags, ['标'.repeat(30)]);
assert.equal(normalizedLegacyBackup.posts[0].comments[0].content, '论'.repeat(1000));
assert.equal(normalizedLegacyBackup.live.title, '直'.repeat(100));
assert.equal(normalizedLegacyBackup.live.danmaku[0].content, '弹'.repeat(200));

const legacyStoreWithScene = (scene = validInteractiveScene, scope = {}) => interactiveBackupWithScene(scene, scope).interactiveScenes;
const mutateLegacyStore = mutation => {
    const store = structuredClone(legacyStoreWithScene());
    mutation(store, store.scopes.story, store.scopes.story.scenes.scene);
    return store;
};
const assertAcceptedByBothInteractivePaths = (name, store) => {
    const normalizedModel = normalizeInteractiveStore(store);
    const normalizedBackup = parseBackupData({ schemaVersion: 3, interactiveScenes: store }, currentBackup).interactiveScenes;
    assert.deepEqual(normalizedBackup, normalizedModel, `${name}: model 与 backup 归一化结果必须一致`);
    assert.deepEqual(normalizeInteractiveStore(normalizedModel), normalizedModel, `${name}: v1→v2 迁移结果必须满足 v2 闭包`);
};
const assertRejectedByBothInteractivePaths = (name, store) => {
    assert.throws(() => normalizeInteractiveStore(store), undefined, `${name}: model 必须拒绝`);
    assert.throws(
        () => parseBackupData({ schemaVersion: 3, interactiveScenes: store }, currentBackup),
        undefined,
        `${name}: backup 必须拒绝`,
    );
};
const missingVersionStore = legacyStoreWithScene();
delete missingVersionStore.version;
for (const [name, store] of [
    ['完整 v1 store', legacyStoreWithScene()],
    ['缺失 version 的 legacy v1 store', missingVersionStore],
    ['缺失可选字段的最小 v1 scene', legacyStoreWithScene({ id: 'scene', posts: [{}], live: { danmaku: [{}] } })],
    ['可安全 trim/截断的 v1 文本', legacyStoreWithScene({
        id: 'scene', title: ` ${'场'.repeat(90)} `, styleInput: ` ${'风'.repeat(2100)} `,
        posts: [{ author: ` ${'作'.repeat(90)} `, content: ` ${'帖'.repeat(4100)} `, tags: [` ${'标'.repeat(40)} `] }],
        live: { title: ` ${'直'.repeat(110)} `, danmaku: [{ content: ` ${'弹'.repeat(210)} ` }] },
    })],
    ['null-prototype 字典', (() => {
        const store = legacyStoreWithScene();
        store.scopes = Object.assign(Object.create(null), store.scopes);
        store.scopes.story.scenes = Object.assign(Object.create(null), store.scopes.story.scenes);
        return store;
    })()],
]) assertAcceptedByBothInteractivePaths(name, store);

const rejectedLegacyFixtures = [
    ['store 额外字段', mutateLegacyStore(store => { store.debug = true; })],
    ['scopes 非对象', { version: 1, scopes: [] }],
    ['scope 非对象', mutateLegacyStore((store) => { store.scopes.story = []; })],
    ['scope 额外字段', mutateLegacyStore((store, scope) => { scope.actors = {}; })],
    ['sceneOrder 非数组', mutateLegacyStore((store, scope) => { scope.sceneOrder = {}; })],
    ['scene 非对象', mutateLegacyStore((store, scope) => { scope.scenes.scene = []; })],
    ['scene 额外字段', mutateLegacyStore((store, scope, scene) => { scene.debug = true; })],
    ['live 非对象', mutateLegacyStore((store, scope, scene) => { scene.live = null; })],
    ['live 额外字段', mutateLegacyStore((store, scope, scene) => { scene.live.debug = true; })],
    ['posts 非数组', mutateLegacyStore((store, scope, scene) => { scene.posts = {}; })],
    ['post 非对象', mutateLegacyStore((store, scope, scene) => { scene.posts = [null]; })],
    ['post 额外字段', mutateLegacyStore((store, scope, scene) => { scene.posts[0].debug = true; })],
    ['content 数字', mutateLegacyStore((store, scope, scene) => { scene.posts[0].content = 123; })],
    ['content 布尔值', mutateLegacyStore((store, scope, scene) => { scene.posts[0].content = true; })],
    ['content null', mutateLegacyStore((store, scope, scene) => { scene.posts[0].content = null; })],
    ['content 显式 undefined', mutateLegacyStore((store, scope, scene) => { scene.posts[0].content = undefined; })],
    ['author 数字', mutateLegacyStore((store, scope, scene) => { scene.posts[0].author = 1; })],
    ['author 对象', mutateLegacyStore((store, scope, scene) => { scene.posts[0].author = {}; })],
    ['tags 非数组', mutateLegacyStore((store, scope, scene) => { scene.posts[0].tags = {}; })],
    ['tag 非字符串', mutateLegacyStore((store, scope, scene) => { scene.posts[0].tags = [1]; })],
    ['liked 非布尔值', mutateLegacyStore((store, scope, scene) => { scene.posts[0].liked = 'yes'; })],
    ['comments 非数组', mutateLegacyStore((store, scope, scene) => { scene.posts[0].comments = {}; })],
    ['comment 非对象', mutateLegacyStore((store, scope, scene) => { scene.posts[0].comments = [false]; })],
    ['comment 额外字段', mutateLegacyStore((store, scope, scene) => { scene.posts[0].comments[0].liked = false; })],
    ['danmaku 非数组', mutateLegacyStore((store, scope, scene) => { scene.live.danmaku = {}; })],
    ['danmaku 非对象', mutateLegacyStore((store, scope, scene) => { scene.live.danmaku = [false]; })],
    ['danmaku 额外字段', mutateLegacyStore((store, scope, scene) => { scene.live.danmaku[0].debug = true; })],
    ['tags 数量超限', mutateLegacyStore((store, scope, scene) => { scene.posts[0].tags = Array(6).fill('标签'); })],
    ['posts 数量超限', mutateLegacyStore((store, scope, scene) => { scene.posts = Array.from({ length: 81 }, () => ({ content: '帖子' })); })],
    ['comments 数量超限', mutateLegacyStore((store, scope, scene) => { scene.posts[0].comments = Array.from({ length: 41 }, () => ({ content: '评论' })); })],
    ['danmaku 数量超限', mutateLegacyStore((store, scope, scene) => { scene.live.danmaku = Array.from({ length: 241 }, () => ({ content: '弹幕' })); })],
    ['非法 orphan scene', mutateLegacyStore((store, scope) => {
        scope.scenes.orphan = { id: 'orphan', posts: [{ content: 123, debug: true }] };
    })],
    ['非法淘汰 scene', (() => {
        const store = legacyStoreWithScene();
        const sceneIds = Array.from({ length: 13 }, (_, index) => `scene${index}`);
        store.scopes.story.activeSceneId = 'scene12';
        store.scopes.story.sceneOrder = sceneIds;
        store.scopes.story.scenes = Object.fromEntries(sceneIds.map((sceneId, index) => [
            sceneId,
            index === 0 ? { id: sceneId, posts: [{ content: 123, debug: true }] } : { id: sceneId },
        ]));
        return store;
    })()],
    ['继承 scopes', (() => {
        const store = Object.create({ scopes: legacyStoreWithScene().scopes });
        store.version = 1;
        return store;
    })()],
    ['继承 sceneOrder', (() => {
        const store = legacyStoreWithScene();
        const scope = Object.create({ sceneOrder: ['scene'] });
        scope.activeSceneId = 'scene';
        scope.scenes = store.scopes.story.scenes;
        store.scopes.story = scope;
        return store;
    })()],
    ['继承 scenes', (() => {
        const store = legacyStoreWithScene();
        const scope = Object.create({ scenes: store.scopes.story.scenes });
        scope.activeSceneId = 'scene';
        scope.sceneOrder = ['scene'];
        store.scopes.story = scope;
        return store;
    })()],
    ['accessor scopes', (() => {
        const store = { version: 1 };
        Object.defineProperty(store, 'scopes', { enumerable: true, get: () => legacyStoreWithScene().scopes });
        return store;
    })()],
    ['accessor scene content', (() => {
        const store = structuredClone(legacyStoreWithScene());
        const post = store.scopes.story.scenes.scene.posts[0];
        const content = post.content;
        Object.defineProperty(post, 'content', { enumerable: true, get: () => content });
        return store;
    })()],
];
for (const key of ['createdAt', 'updatedAt']) {
    for (const value of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 0, -1, '100']) {
        rejectedLegacyFixtures.push([`scene.${key} 非法时间戳 ${String(value)}`, mutateLegacyStore((store, scope, scene) => { scene[key] = value; })]);
    }
}
for (const [path, mutation] of [
    ['post.createdAt', (scene, value) => { scene.posts[0].createdAt = value; }],
    ['comment.createdAt', (scene, value) => { scene.posts[0].comments[0].createdAt = value; }],
    ['danmaku.createdAt', (scene, value) => { scene.live.danmaku[0].createdAt = value; }],
]) {
    for (const value of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 0, -1, '100']) {
        rejectedLegacyFixtures.push([`${path} 非法时间戳 ${String(value)}`, mutateLegacyStore((store, scope, scene) => mutation(scene, value))]);
    }
}
for (const [name, store] of rejectedLegacyFixtures) assertRejectedByBothInteractivePaths(name, store);

const invalidInteractiveCases = [
    [{ ...validInteractiveScene, createdAt: '100' }, /createdAt 必须是有效时间戳/],
    [{ ...validInteractiveScene, updatedAt: 0 }, /updatedAt 必须是有效时间戳/],
    [{ ...validInteractiveScene, unsupported: true }, /(?:额外字段：unsupported|unsupported 不受支持)/],
    [{ ...validInteractiveScene, posts: Array.from({ length: 81 }, (_, index) => ({ content: `帖子${index}` })) }, /posts 不能超过 80 项/],
    [{ ...validInteractiveScene, posts: [{ content: 123 }] }, /content 必须是字符串/],
    [{ ...validInteractiveScene, posts: [{ id: '', content: '帖子' }] }, /id (?:必须是非空字符串|格式无效)/],
    [{ ...validInteractiveScene, posts: [{ author: {}, content: '帖子' }] }, /author 必须是字符串/],
    [{ ...validInteractiveScene, posts: [{ content: '帖子', createdAt: Number.NaN }] }, /createdAt 必须是有效时间戳/],
    [{ ...validInteractiveScene, posts: [{ content: '帖子', liked: 'yes' }] }, /liked 必须是布尔值/],
    [{ ...validInteractiveScene, posts: [{ content: '帖子', tags: ['日常', 1] }] }, /tags 必须是字符串数组/],
    [{ ...validInteractiveScene, posts: [{ content: '帖子', tags: Array(6).fill('标签') }] }, /tags 不能超过 5 项/],
    [{ ...validInteractiveScene, posts: [{ content: '帖子', comments: Array.from({ length: 41 }, (_, index) => ({ content: `评论${index}` })) }] }, /comments 不能超过 40 项/],
    [{ ...validInteractiveScene, posts: [{ content: '帖子', comments: [{ content: '评论', liked: false }] }] }, /(?:额外字段：liked|liked 不受支持)/],
    [{ ...validInteractiveScene, live: { ...validInteractiveScene.live, status: 'streaming' } }, /live\.status 必须是 idle/],
    [{ ...validInteractiveScene, live: { ...validInteractiveScene.live, danmaku: Array.from({ length: 241 }, (_, index) => ({ content: `弹幕${index}` })) } }, /danmaku 不能超过 240 项/],
];
for (const [scene, pattern] of invalidInteractiveCases) assertInvalidInteractiveScene(scene, pattern);

const recoveredNullActiveScene = parseBackupData(interactiveBackupWithScene(validInteractiveScene, {
    activeSceneId: null,
}), currentBackup).interactiveScenes.scopes.story;
assert.equal(recoveredNullActiveScene.activeSceneId, 'scene');
assert.throws(() => parseBackupData(JSON.parse('{"schemaVersion":3,"interactiveScenes":{"version":1,"scopes":{"__proto__":{"activeSceneId":null,"sceneOrder":[],"scenes":{}}}}}'), currentBackup), /包含危险键[： ]__proto__/);
assert.throws(() => parseBackupData(JSON.parse('{"schemaVersion":3,"interactiveScenes":{"version":1,"scopes":{"story":{"activeSceneId":"__proto__","sceneOrder":["__proto__"],"scenes":{"__proto__":{"id":"__proto__"}}}}}}'), currentBackup), /包含危险键[： ]__proto__/);

const parsedV3Backup = parseBackupData({
    schemaVersion: 3,
    profiles: [{ apiUrl: 'https://example.test' }],
    interactiveScenes: { version: 1, scopes: { story: { activeSceneId: null, sceneOrder: [], scenes: {} } } },
}, currentBackup);
assert.equal(parsedV3Backup.profiles.length, 1);
assert.ok(parsedV3Backup.interactiveScenes.scopes.story);

const v2ScopeId = 'story';
const v2ActorId = deriveInteractiveActorId(v2ScopeId, 'story', 'character:alice');
const validV2InteractiveStore = {
    version: 2,
    scopes: {
        [v2ScopeId]: {
            activeSceneId: 'scene',
            sceneOrder: ['scene'],
            actors: {
                [v2ActorId]: {
                    actorId: v2ActorId,
                    type: 'story',
                    displayName: 'Alice',
                    bindingKey: 'character:alice',
                    profile: '',
                    createdAt: 100,
                },
            },
            scenes: {
                scene: {
                    id: 'scene', title: 'v2 社区', preset: 'weibo', styleInput: '', generatedPrompt: '',
                    createdAt: 100, updatedAt: 200,
                    posts: [{
                        id: 'post', authorId: v2ActorId, authorNameSnapshot: 'Alice', content: 'v2 帖子',
                        tags: [], createdAt: 110,
                        comments: [{
                            id: 'comment', authorId: v2ActorId, authorNameSnapshot: 'Alice',
                            content: 'v2 评论', createdAt: 120,
                        }],
                        liked: false,
                    }],
                    live: {
                        title: 'v2 直播', status: 'idle',
                        danmaku: [{
                            id: 'danmaku', authorId: v2ActorId, authorNameSnapshot: 'Alice',
                            content: 'v2 弹幕', createdAt: 130,
                        }],
                    },
                },
            },
        },
    },
};
const parsedV2Backup = parseBackupData({ schemaVersion: 3, interactiveScenes: validV2InteractiveStore }, currentBackup);
assert.equal(parsedV2Backup.interactiveScenes.version, 2);
assert.equal(parsedV2Backup.interactiveScenes.scopes[v2ScopeId].scenes.scene.posts[0].authorId, v2ActorId);
assert.throws(() => parseBackupData({
    schemaVersion: 3,
    interactiveScenes: {
        ...validV2InteractiveStore,
        scopes: {
            [v2ScopeId]: {
                ...validV2InteractiveStore.scopes[v2ScopeId],
                scenes: { scene: { ...validV2InteractiveStore.scopes[v2ScopeId].scenes.scene, contentRating: 'general' } },
            },
        },
    },
}, currentBackup), /额外字段.*contentRating/);
assert.throws(() => parseBackupData({
    schemaVersion: 3,
    interactiveScenes: {
        ...validV2InteractiveStore,
        scopes: { [v2ScopeId]: { ...validV2InteractiveStore.scopes[v2ScopeId], actors: undefined } },
    },
}, currentBackup), /(?:actors 必须是对象|缺少 actors registry)/);
assert.throws(() => parseBackupData({
    schemaVersion: 3,
    interactiveScenes: {
        ...validV2InteractiveStore,
        scopes: {
            [v2ScopeId]: {
                ...validV2InteractiveStore.scopes[v2ScopeId],
                scenes: {
                    scene: {
                        ...validV2InteractiveStore.scopes[v2ScopeId].scenes.scene,
                        posts: [{
                            id: 'post', authorId: 'missing', authorNameSnapshot: '伪造', content: '悬空',
                            tags: [], createdAt: 110, comments: [], liked: false,
                        }],
                    },
                },
            },
        },
    },
}, currentBackup), /(?:authorId 未指向有效 actor|引用了不存在的 actor)/);
assert.throws(() => parseBackupData({
    schemaVersion: 3,
    interactiveScenes: {
        ...validV2InteractiveStore,
        scopes: {
            [v2ScopeId]: {
                ...validV2InteractiveStore.scopes[v2ScopeId],
                actors: { [v2ActorId]: { ...validV2InteractiveStore.scopes[v2ScopeId].actors[v2ActorId], bindingKey: 'character:tampered' } },
            },
        },
    },
}, currentBackup), /(?:actorId 与绑定信息不一致|与绑定信息不一致)/);

let backgroundState = { current: 'old' };
const persistedBackgroundStates = [];
let failBackgroundPersist = true;
await assert.rejects(runBackgroundTransaction({
    capture: () => structuredClone(backgroundState),
    mutate: () => { backgroundState.current = 'new'; },
    restore: snapshot => { backgroundState = structuredClone(snapshot); },
    persist: async () => {
        persistedBackgroundStates.push(structuredClone(backgroundState));
        if (failBackgroundPersist) {
            failBackgroundPersist = false;
            throw new Error('背景保存失败');
        }
    },
}), /背景保存失败/);
assert.deepEqual(backgroundState, { current: 'old' });
assert.deepEqual(persistedBackgroundStates, [{ current: 'new' }, { current: 'old' }]);

backgroundState = { current: 'old' };
let backgroundPersistCount = 0;
await assert.rejects(runBackgroundTransaction({
    capture: () => structuredClone(backgroundState),
    mutate: () => { backgroundState.current = 'new'; },
    restore: snapshot => { backgroundState = structuredClone(snapshot); },
    persist: async () => {
        backgroundPersistCount += 1;
        throw new Error(backgroundPersistCount === 1 ? '背景保存失败' : '背景回滚失败');
    },
}), /背景保存失败；原背景回滚失败：背景回滚失败/);
assert.deepEqual(backgroundState, { current: 'old' });

let backupState = { version: 'A' };
const persistedBackupStates = [];
let failImportedPersist = true;
await assert.rejects(runBackupTransaction({
    capture: async () => structuredClone(backupState),
    apply: async snapshot => {
        backupState = structuredClone(snapshot || { version: 'B' });
        return structuredClone(backupState);
    },
    persist: async state => {
        persistedBackupStates.push(structuredClone(state));
        if (state.version === 'B' && failImportedPersist) {
            failImportedPersist = false;
            throw new Error('导入阶段失败');
        }
    },
}), /导入阶段失败/);
assert.deepEqual(backupState, { version: 'A' });
assert.deepEqual(persistedBackupStates, [{ version: 'B' }, { version: 'A' }]);

backupState = { version: 'A' };
await assert.rejects(runBackupTransaction({
    capture: async () => structuredClone(backupState),
    apply: async snapshot => {
        backupState = structuredClone(snapshot || { version: 'B' });
        return structuredClone(backupState);
    },
    persist: async state => {
        if (state.version === 'B') throw new Error('导入失败');
        throw new Error('回滚失败');
    },
}), /导入失败；原数据回滚失败：回滚失败/);
assert.deepEqual(backupState, { version: 'A' });

backupState = { version: 'A' };
const backupLifecyclePhases = [];
let failLifecyclePersist = true;
await assert.rejects(runBackupTransaction({
    capture: async () => structuredClone(backupState),
    beforeApply: async phase => { backupLifecyclePhases.push(phase); },
    apply: async snapshot => {
        backupState = structuredClone(snapshot || { version: 'B' });
        return structuredClone(backupState);
    },
    persist: async state => {
        if (state.version === 'B' && failLifecyclePersist) {
            failLifecyclePersist = false;
            throw new Error('生命周期导入失败');
        }
    },
}), /生命周期导入失败/);
assert.deepEqual(backupLifecyclePhases, ['apply', 'rollback']);
assert.deepEqual(backupState, { version: 'A' });

const createBackupTransactionFixture = (sceneId, ambientStatusEnabled) => ({
    histories: { story: { Alice: [{ role: 'assistant', content: sceneId }] } },
    config: { model: sceneId },
    theme: { darkMode: ambientStatusEnabled ? 'dark' : 'light', ambientStatusEnabled },
    profiles: [],
    groupMeta: {},
    pokeConfig: {},
    bidirectional: {},
    emojis: [],
    characterBehavior: {},
    wordyLimit: false,
    desktopBg: '',
    bgGlobal: '',
    bgLocal: {},
    interactiveScenes: {
        version: 1,
        scopes: {
            story: {
                activeSceneId: sceneId,
                sceneOrder: [sceneId],
                scenes: { [sceneId]: { id: sceneId, title: sceneId } },
            },
        },
    },
    phoneUiState: {
        version: 1,
        scopes: {
            story: {
                pinnedSceneIds: [sceneId], lastPage: 'community', lastSceneId: sceneId, lastTab: 'feed',
            },
        },
    },
    ambientStatus: { enabled: ambientStatusEnabled },
    calendarStore: { version: 1, scopes: { story: { autoAdjust: false, events: {}, lastGeneratedAt: 0, lastAdjustedAt: 0 } } },
    calendarOccasions: { version: 1, scopes: { story: { occasions: [] } } },
    calendarHolidays: { version: 1, selectedCountry: sceneId === 'scene-old' ? 'JP' : 'US', years: {} },
    calendarWeather: { version: 1, location: { name: sceneId, latitude: 35, longitude: 139, country: 'JP', timezone: 'Asia/Tokyo' }, lastSuccess: null },
    calendarCycles: { version: 1, scopes: { story: { enabled: true, lastPeriodStart: '2026-07-01', cycleLength: sceneId === 'scene-old' ? 28 : 30, periodLength: 5, overrides: {} } } },
});
const originalBackupFixture = createBackupTransactionFixture('scene-old', true);
const importedBackupFixture = createBackupTransactionFixture('scene-new', false);
localValues.set('ST_SMS_BG_DESKTOP', '');
localValues.set('ST_SMS_BG_GLOBAL', '');
localValues.set('ST_SMS_BG_LOCAL', '{}');
idbValues.delete('ST_SMS_BG_GLOBAL');
idbValues.delete('ST_SMS_BG_LOCAL_story_Alice');
let interactiveInvalidations = 0;
const backupHandlers = createBackupStateHandlers({
    invalidateInteractiveStore: () => { interactiveInvalidations += 1; },
});
await backupHandlers.persist(await backupHandlers.apply(originalBackupFixture));

globalThis.document = {
    getElementById: id => uiElements.get(id) || null,
    querySelectorAll: () => [],
};
globalThis.alert = message => uiAlerts.push(String(message));
const runCommittedImportFailureCase = async ({ configModel, injection, expectedDetail }) => {
    uiElements.get('pm-overlay').removed = false;
    const alertsBefore = uiAlerts.length;
    const closeCallsBefore = importCloseCalls;
    const injectionCallsBefore = importInjectionCalls;
    const clearCallsBefore = importClearInjectionCalls;
    const cancelCallsBefore = importCancelCommunityCalls;
    importInjectionImpl = injection;
    const input = {
        files: [{ text: JSON.stringify({
            schemaVersion: 5,
            config: { apiUrl: 'https://imported.example', apiKey: 'imported-key', model: configModel, useIndependent: false },
        }) }],
        value: `${configModel}.json`,
    };

    window.__pmImportData(input);
    await fileReadCompletion;

    assert.equal(input.value, '');
    assert.equal(window.__pmConfig.model, configModel, '后处理注入失败前导入数据必须已经应用到运行时');
    assert.equal(JSON.parse(localValues.get('ST_SMS_CONFIG')).model, configModel, '后处理注入失败前导入数据必须已经持久化');
    assert.equal(importClearInjectionCalls, clearCallsBefore + 1, '成功事务必须在 apply 前清理旧注入');
    assert.equal(importCancelCommunityCalls, cancelCallsBefore + 1, '成功事务必须取消旧社区任务');
    assert.equal(importInjectionCalls, injectionCallsBefore + 1, '事务提交后必须尝试刷新注入');
    assert.equal(importCloseCalls, closeCallsBefore + 1, '数据已提交时即使注入失败也必须关闭旧界面');
    assert.equal(uiElements.get('pm-overlay').removed, true, '数据已提交时即使注入失败也必须移除旧遮罩');
    assert.equal(uiAlerts.length, alertsBefore + 1);
    assert.match(uiAlerts.at(-1), /数据已导入，但注入刷新失败/);
    assert.match(uiAlerts.at(-1), expectedDetail);
    assert.doesNotMatch(uiAlerts.at(-1), /未修改现有数据|原数据已恢复/);
};

await runCommittedImportFailureCase({
    configModel: 'post-import-reject',
    injection: async () => { throw new Error('宿主注入接口拒绝'); },
    expectedDetail: /宿主注入接口拒绝/,
});
await runCommittedImportFailureCase({
    configModel: 'post-import-diagnostic',
    injection: async () => ({ written: 1, failedWrites: 2, cleared: 1, failedKeys: ['PHONE_SMS_MEMORY:stale'] }),
    expectedDetail: /导入后的注入刷新失败：2 项写入失败，1 项清理失败/,
});
await backupHandlers.persist(await backupHandlers.apply(originalBackupFixture));
importInjectionImpl = async () => undefined;
delete globalThis.document;
delete globalThis.alert;
if (originalFileReader === undefined) delete globalThis.FileReader;
else globalThis.FileReader = originalFileReader;

assert.equal(JSON.parse(localValues.get(CALENDAR_HOLIDAY_STORAGE_KEY)).selectedCountry, 'JP');
assert.equal(JSON.parse(localValues.get(CALENDAR_WEATHER_STORAGE_KEY)).location.name, 'scene-old');
assert.equal(JSON.parse(localValues.get(CALENDAR_CYCLE_STORAGE_KEY)).scopes.story.cycleLength, 28);
assert.ok(JSON.parse(localValues.get(CALENDAR_STORAGE_KEY)).scopes.story);
assert.ok(JSON.parse(localValues.get(CALENDAR_OCCASION_STORAGE_KEY)).scopes.story);
const initialInvalidations = interactiveInvalidations;
localStorageWrites.length = 0;
localStorageControl.failSet.add('ST_SMS_PHONE_UI_STATE');
await assert.rejects(runBackupTransaction({
    capture: backupHandlers.capture,
    apply: snapshot => backupHandlers.apply(snapshot || importedBackupFixture),
    persist: backupHandlers.persist,
}), /手机界面状态保存失败/);
assert.equal(window.__pmTheme.ambientStatusEnabled, true);
assert.deepEqual(window.__pmPhoneUiState.scopes.story.pinnedSceneIds, ['scene-old']);
assert.equal(JSON.parse(localValues.get('ST_SMS_THEME')).ambientStatusEnabled, true);
assert.deepEqual(JSON.parse(localValues.get('ST_SMS_PHONE_UI_STATE')).scopes.story.pinnedSceneIds, ['scene-old']);
assert.equal(JSON.parse(localValues.get(CALENDAR_HOLIDAY_STORAGE_KEY)).selectedCountry, 'JP');
assert.equal(JSON.parse(localValues.get(CALENDAR_WEATHER_STORAGE_KEY)).location.name, 'scene-old');
assert.equal(JSON.parse(localValues.get(CALENDAR_CYCLE_STORAGE_KEY)).scopes.story.cycleLength, 28);
assert.deepEqual(idbValues.get('ST_INTERACTIVE_SCENES_V1').scopes.story.sceneOrder, ['scene-old']);
assert.deepEqual(
    localStorageWrites.filter(entry => entry.key === 'ST_SMS_THEME').map(entry => JSON.parse(entry.value).ambientStatusEnabled),
    [false, true],
);
assert.equal(interactiveInvalidations, initialInvalidations + 1);

localStorageWrites.length = 0;
localStorageControl.failSetCounts.set('ST_SMS_PHONE_UI_STATE', 2);
let rollbackFailure;
await assert.rejects(runBackupTransaction({
    capture: backupHandlers.capture,
    apply: snapshot => backupHandlers.apply(snapshot || importedBackupFixture),
    persist: backupHandlers.persist,
}), error => {
    rollbackFailure = error;
    assert.match(error.message, /手机界面状态保存失败：浏览器存储不可用；原数据回滚失败：手机界面状态保存失败：浏览器存储不可用/);
    return true;
});
assert.ok(rollbackFailure);
assert.match(rollbackFailure.rollbackError.message, /手机界面状态保存失败/);
assert.equal(window.__pmTheme.ambientStatusEnabled, true);
assert.deepEqual(window.__pmPhoneUiState.scopes.story.pinnedSceneIds, ['scene-old']);
assert.equal(JSON.parse(localValues.get('ST_SMS_THEME')).ambientStatusEnabled, true);
assert.deepEqual(JSON.parse(localValues.get('ST_SMS_PHONE_UI_STATE')).scopes.story.pinnedSceneIds, ['scene-old']);
assert.equal(JSON.parse(localValues.get(CALENDAR_HOLIDAY_STORAGE_KEY)).selectedCountry, 'JP');
assert.equal(JSON.parse(localValues.get(CALENDAR_WEATHER_STORAGE_KEY)).location.name, 'scene-old');
assert.equal(JSON.parse(localValues.get(CALENDAR_CYCLE_STORAGE_KEY)).scopes.story.cycleLength, 28);
assert.deepEqual(idbValues.get('ST_INTERACTIVE_SCENES_V1').scopes.story.sceneOrder, ['scene-old']);
assert.deepEqual(
    localStorageWrites.filter(entry => entry.key === 'ST_SMS_THEME').map(entry => JSON.parse(entry.value).ambientStatusEnabled),
    [false, true],
);

const cleanupLocal = new Map(PLUGIN_LOCAL_STORAGE_KEYS.map(key => [key, `value:${key}`]));
cleanupLocal.set('HOST_EXTENSION_DATA', 'keep-local');
const cleanupStorage = {
    getItem: key => cleanupLocal.has(key) ? cleanupLocal.get(key) : null,
    setItem: (key, value) => cleanupLocal.set(key, String(value)),
    removeItem: key => cleanupLocal.delete(key),
};
const cleanupIdb = new Map([
    ...PLUGIN_IDB_STATIC_KEYS.map(key => [key, { key }]),
    [`${PLUGIN_IDB_DYNAMIC_PREFIXES[0]}orphan`, { key: 'dynamic' }],
    ['HOST_EXTENSION_IDB', { key: 'keep-idb' }],
]);
const cleanupResult = await clearPluginData({
    localStorageRef: cleanupStorage,
    listIdbKeys: async () => [...cleanupIdb.keys()],
    readIdbEntry: async key => ({ ok: cleanupIdb.has(key), value: structuredClone(cleanupIdb.get(key)) }),
    writeIdb: async (key, value) => { cleanupIdb.set(key, structuredClone(value)); return true; },
    deleteIdb: async key => cleanupIdb.delete(key),
});
assert.equal(cleanupResult.localKeys, PLUGIN_LOCAL_STORAGE_KEYS.length);
assert.equal(cleanupResult.idbKeys, PLUGIN_IDB_STATIC_KEYS.length + 1);
assert.equal(cleanupLocal.get('HOST_EXTENSION_DATA'), 'keep-local');
assert.equal(cleanupIdb.get('HOST_EXTENSION_IDB').key, 'keep-idb');
for (const key of PLUGIN_LOCAL_STORAGE_KEYS) assert.equal(cleanupLocal.has(key), false);
for (const key of PLUGIN_IDB_STATIC_KEYS) assert.equal(cleanupIdb.has(key), false);
assert.equal(cleanupIdb.has(`${PLUGIN_IDB_DYNAMIC_PREFIXES[0]}orphan`), false);

const rollbackLocal = new Map([
    [PLUGIN_LOCAL_STORAGE_KEYS[0], 'old-local'],
    ['HOST_EXTENSION_DATA', 'keep-local'],
]);
const rollbackIdb = new Map([
    [PLUGIN_IDB_STATIC_KEYS[0], { value: 'old-static' }],
    [`${PLUGIN_IDB_DYNAMIC_PREFIXES[0]}old`, { value: 'old-dynamic' }],
    ['HOST_EXTENSION_IDB', { value: 'keep-idb' }],
]);
await assert.rejects(clearPluginData({
    localStorageRef: {
        getItem: key => rollbackLocal.has(key) ? rollbackLocal.get(key) : null,
        setItem: (key, value) => rollbackLocal.set(key, String(value)),
        removeItem: key => rollbackLocal.delete(key),
    },
    listIdbKeys: async () => [...rollbackIdb.keys()],
    readIdbEntry: async key => ({ ok: true, value: structuredClone(rollbackIdb.get(key)) }),
    writeIdb: async (key, value) => { rollbackIdb.set(key, structuredClone(value)); return true; },
    deleteIdb: async key => rollbackIdb.delete(key),
    afterClear: async () => { throw new Error('内存重置失败'); },
}), /内存重置失败/);
assert.equal(rollbackLocal.get(PLUGIN_LOCAL_STORAGE_KEYS[0]), 'old-local');
assert.equal(rollbackLocal.get('HOST_EXTENSION_DATA'), 'keep-local');
assert.deepEqual(rollbackIdb.get(PLUGIN_IDB_STATIC_KEYS[0]), { value: 'old-static' });
assert.deepEqual(rollbackIdb.get(`${PLUGIN_IDB_DYNAMIC_PREFIXES[0]}old`), { value: 'old-dynamic' });
assert.deepEqual(rollbackIdb.get('HOST_EXTENSION_IDB'), { value: 'keep-idb' });

let cleanupRollbackError;
await assert.rejects(clearPluginData({
    localStorageRef: {
        getItem: key => key === PLUGIN_LOCAL_STORAGE_KEYS[0] ? 'old-local' : null,
        setItem: () => { throw new Error('local rollback blocked'); },
        removeItem: () => {},
    },
    listIdbKeys: async () => [],
    afterClear: async () => { throw new Error('clear failed'); },
}), error => {
    cleanupRollbackError = error;
    return /插件数据回滚失败/.test(error.message);
});
assert.ok(cleanupRollbackError.rollbackError instanceof AggregateError);

delete globalThis.indexedDB;
delete globalThis.localStorage;
delete globalThis.window;

const pageSections = ['chat', 'desktop', 'community', 'calendar'].map(page => ({ dataset: { phonePage: page }, hidden: false }));
const pageMain = {
    dataset: { page: 'chat' },
    querySelectorAll(selector) {
        assert.equal(selector, '[data-phone-page]');
        return pageSections;
    },
};
let transientCloseCount = 0;
let phoneRoot = {
    querySelector(selector) {
        assert.equal(selector, '.pm-main-ui');
        return pageMain;
    },
};
const pageController = createPhonePageController({
    getRoot: () => phoneRoot,
    closeTransientUi: () => { transientCloseCount += 1; },
});
const chatSectionReference = pageSections[0];
assert.equal(pageController.current(), 'chat');
assert.equal(pageController.show('desktop'), true);
assert.equal(pageController.current(), 'desktop');
assert.deepEqual(pageSections.map(section => [section.dataset.phonePage, section.hidden]), [
    ['chat', true], ['desktop', false], ['community', true], ['calendar', true],
]);
assert.equal(pageController.show('community'), true);
assert.deepEqual(pageSections.map(section => section.hidden), [true, true, false, true]);
assert.equal(pageController.show('calendar'), true);
assert.deepEqual(pageSections.map(section => section.hidden), [true, true, true, false]);
assert.equal(pageController.show('chat'), true);
assert.deepEqual(pageSections.map(section => section.hidden), [false, true, true, true]);
assert.equal(pageSections[0], chatSectionReference, '页面切换不得替换聊天 DOM 节点');
assert.equal(pageController.show('invalid-page'), true);
assert.equal(pageController.current(), 'desktop');
assert.equal(transientCloseCount, 5);
phoneRoot = null;
assert.equal(pageController.show('chat'), false);
assert.equal(pageController.current(), null);

const baseDesktopHtml = renderPhoneDesktop({ scenes: {} }, { pinnedSceneIds: [] });
assert.ok(baseDesktopHtml.length > 0, '无有效会话时基础桌面不得为空');
assert.match(baseDesktopHtml, /<span>天音小笺<\/span>/, '旧主题或无主题时桌面标题必须回退为品牌名');
assert.match(baseDesktopHtml, /class="pm-desktop-community-dock"/);
assert.match(baseDesktopHtml, /data-action="desktop-community" aria-label="发布一条"/);
for (const action of ['desktop-chat', 'desktop-directory', 'desktop-settings', 'desktop-calendar', 'desktop-community', 'desktop-exit']) {
    assert.ok(baseDesktopHtml.includes(`data-action="${action}"`), `基础桌面缺少 ${action} 入口`);
}
globalThis.window = { __pmTheme: { customTitle: '雨夜 & 电台' } };
assert.match(renderPhoneDesktop({ scenes: {} }, { pinnedSceneIds: [] }), /<span>雨夜 &amp; 电台<\/span>/, '桌面必须渲染并转义自定义标题');
delete globalThis.window;

assert.deepEqual(
    ['a', 'b', 'c', 'd'].map(id => getDanmakuTone({ id })),
    ['pink', 'cyan', 'gold', 'blue'],
    '稳定 hash 应覆盖蓝、粉、青、金四种色阶',
);
const fallbackDanmaku = { authorNameSnapshot: '访客', content: '晚上好' };
assert.equal(getDanmakuTone(fallbackDanmaku), getDanmakuTone({ ...fallbackDanmaku }), '缺失 id 时作者与内容组合必须稳定分色');
assert.ok(['blue', 'pink', 'cyan', 'gold'].includes(getDanmakuTone(fallbackDanmaku)), '弹幕色阶必须属于合同允许集合');
assert.deepEqual(getDanmakuMotion({ id: 'stable' }), getDanmakuMotion({ id: 'stable' }), '弹幕运动参数必须稳定');
assert.ok(new Set(['a', 'b', 'c', 'd', 'e', 'f'].map(id => getDanmakuMotion({ id }).lane)).size > 1, '弹幕不得全部落在同一轨道');
const workspaceScene = normalizeInteractiveStore({
    version: 1,
    scopes: { story: { activeSceneId: 'scene', sceneOrder: ['scene'], scenes: { scene: {
        id: 'scene', title: '主题社区', preset: 'weibo', themeAccent: '#123abc',
        generatedPrompt: '自然交流', posts: [], live: { title: '正在直播', status: 'idle', danmaku: [{ id: 'danmaku', author: '访客', content: '弹幕' }] },
    } } } },
}).scopes.story.scenes.scene;
const workspaceHtml = renderCommunityWorkspace(workspaceScene, 'feed', { pinnedSceneIds: [] });
assert.match(workspaceHtml, /style="--scene-accent:#123abc"/);
assert.match(workspaceHtml, /data-action="poke-scene">拍一拍<\/button>/);
assert.match(workspaceHtml, /class="pm-scene-bottom-bar"/);
assert.match(workspaceHtml, /class="pm-scene-exit"[^>]*data-action="exit"/);
assert.doesNotMatch(workspaceHtml, /生成热场内容|编辑社区风格|返回桌面/);
const liveWorkspaceHtml = renderCommunityWorkspace(workspaceScene, 'live', { pinnedSceneIds: [] });
assert.match(liveWorkspaceHtml, /pm-live-stage has-danmaku/);
assert.match(liveWorkspaceHtml, /--duration:[\d.]+s;--offset:-?\d+px/);
const promptWorkspaceHtml = renderCommunityWorkspace(workspaceScene, 'prompt', { pinnedSceneIds: [] });
assert.match(promptWorkspaceHtml, /id="pm-scene-accent" type="color" value="#123abc"/);
assert.match(promptWorkspaceHtml, /class="pm-scene-secondary" data-action="regenerate-prompt"/);

const launcherScope = {
    sceneOrder: ['scene-card'],
    scenes: {
        'scene-card': { id: 'scene-card', title: '雨夜社区', preset: 'weibo', posts: [] },
    },
};
const unpinnedLauncherHtml = renderCommunityLauncher(launcherScope, { pinnedSceneIds: [] });
assert.match(unpinnedLauncherHtml, /class="pm-scene-card-actions"/);
assert.match(unpinnedLauncherHtml, /data-action="toggle-scene-pin"[^>]*aria-pressed="false"[^>]*>固定<\/button>/);
assert.match(unpinnedLauncherHtml, /data-action="delete-scene"[^>]*>删除<\/button>/);
assert.match(unpinnedLauncherHtml, /class="pm-scene-card-open"[^>]*>[\s\S]*?<\/button><div class="pm-scene-card-actions">/, '场景卡片操作必须位于打开场景按钮之外');
const pinnedLauncherHtml = renderCommunityLauncher(launcherScope, { pinnedSceneIds: ['scene-card'] });
assert.match(pinnedLauncherHtml, /data-action="toggle-scene-pin"[^>]*aria-pressed="true"[^>]*>取消固定<\/button>/);

const desktopTransitionCalls = [];
const desktopStore = { scopes: { story: { activeSceneId: null, sceneOrder: [], scenes: {}, actors: {} } } };
let desktopCurrentPage = 'chat';
assert.equal(await runDesktopPageTransition({
    scopeId: 'story',
    loadStore: async () => { desktopTransitionCalls.push('load'); return desktopStore; },
    clearOpenScene: () => desktopTransitionCalls.push('clear'),
    refreshDesktop: (scopeId, store) => { desktopTransitionCalls.push(['render', scopeId, store]); return true; },
    updatePhoneUi: (scopeId, store) => desktopTransitionCalls.push(['persist', scopeId, store]),
    showPhonePage: page => { desktopTransitionCalls.push(['show', page]); desktopCurrentPage = page; return true; },
    getCurrentPage: () => desktopCurrentPage,
}), true);
assert.deepEqual(desktopTransitionCalls, [
    'load',
    ['render', 'story', desktopStore],
    ['show', 'desktop'],
    ['persist', 'story', desktopStore],
    'clear',
]);

const invalidScopeDesktopCalls = [];
let invalidScopeCurrentPage = 'chat';
assert.equal(await runDesktopPageTransition({
    scopeId: 'sms_unknown__default',
    loadStore: async () => { throw new Error('invalid scope must not load store'); },
    clearOpenScene: () => invalidScopeDesktopCalls.push('clear'),
    refreshDesktop: (scopeId, store) => { invalidScopeDesktopCalls.push(['render', scopeId, store]); return true; },
    updatePhoneUi: () => { throw new Error('invalid scope must not persist state'); },
    showPhonePage: page => { invalidScopeDesktopCalls.push(['show', page]); invalidScopeCurrentPage = page; return true; },
    getCurrentPage: () => invalidScopeCurrentPage,
}), true);
assert.deepEqual(invalidScopeDesktopCalls, [
    ['render', 'sms_unknown__default', null],
    ['show', 'desktop'],
    'clear',
]);

const failedDesktopCalls = [];
await assert.rejects(runDesktopPageTransition({
    scopeId: 'story',
    loadStore: async () => { failedDesktopCalls.push('load'); return desktopStore; },
    clearOpenScene: () => failedDesktopCalls.push('clear'),
    refreshDesktop: () => { failedDesktopCalls.push('render'); return false; },
    updatePhoneUi: () => failedDesktopCalls.push('persist'),
    showPhonePage: () => { failedDesktopCalls.push('show'); return true; },
}), /桌面内容渲染失败/);
assert.deepEqual(failedDesktopCalls, ['load', 'render']);

const unavailableDesktopCalls = [];
let unavailableCurrentPage = 'chat';
await assert.rejects(runDesktopPageTransition({
    scopeId: 'story',
    loadStore: async () => desktopStore,
    clearOpenScene: () => unavailableDesktopCalls.push('clear'),
    refreshDesktop: () => { unavailableDesktopCalls.push('render'); return true; },
    updatePhoneUi: () => unavailableDesktopCalls.push('persist'),
    showPhonePage: () => { unavailableDesktopCalls.push('show'); return false; },
    getCurrentPage: () => unavailableCurrentPage,
}), /桌面页面不可用/);
assert.deepEqual(unavailableDesktopCalls, ['render', 'show']);

const rollbackDesktopCalls = [];
let rollbackCurrentPage = 'chat';
await assert.rejects(runDesktopPageTransition({
    scopeId: 'story',
    loadStore: async () => desktopStore,
    clearOpenScene: () => rollbackDesktopCalls.push('clear'),
    refreshDesktop: () => { rollbackDesktopCalls.push('render'); return true; },
    updatePhoneUi: () => { rollbackDesktopCalls.push('persist'); throw new Error('quota'); },
    showPhonePage: page => { rollbackDesktopCalls.push(['show', page]); rollbackCurrentPage = page; return true; },
    getCurrentPage: () => rollbackCurrentPage,
}), /quota/);
assert.deepEqual(rollbackDesktopCalls, ['render', ['show', 'desktop'], 'persist', ['show', 'chat']]);

const supersededRollbackCalls = [];
let supersededCurrentPage = 'chat';
await assert.rejects(runDesktopPageTransition({
    scopeId: 'story',
    loadStore: async () => desktopStore,
    clearOpenScene: () => supersededRollbackCalls.push('clear'),
    refreshDesktop: () => { supersededRollbackCalls.push('render'); return true; },
    updatePhoneUi: () => {
        supersededRollbackCalls.push('persist');
        supersededCurrentPage = 'community';
        throw new Error('quota after navigation');
    },
    showPhonePage: page => { supersededRollbackCalls.push(['show', page]); supersededCurrentPage = page; return true; },
    getCurrentPage: () => supersededCurrentPage,
}), /quota after navigation/);
assert.deepEqual(supersededRollbackCalls, ['render', ['show', 'desktop'], 'persist']);
assert.equal(supersededCurrentPage, 'community', '持久化失败不得覆盖事务期间发生的新导航');

let desktopErrorMessage = '';
let desktopErrorAction = '';
await runControlMenuAction(
    'desktop',
    () => Promise.reject(new Error('desktop unavailable')),
    (error, action) => { desktopErrorMessage = error.message; desktopErrorAction = action; },
);
assert.equal(desktopErrorMessage, 'desktop unavailable');
assert.equal(desktopErrorAction, 'desktop');
let nonDesktopErrorReported = false;
assert.throws(() => runControlMenuAction(
    'settings',
    () => { throw new Error('settings unavailable'); },
    () => { nonDesktopErrorReported = true; },
), /settings unavailable/);
assert.equal(nonDesktopErrorReported, false, '非桌面 action 不得误报为返回桌面失败');
let calendarErrorMessage = '';
let calendarErrorAction = '';
await runControlMenuAction(
    'calendar',
    () => Promise.reject(new Error('calendar unavailable')),
    (error, action) => { calendarErrorMessage = error.message; calendarErrorAction = action; },
);
assert.equal(calendarErrorMessage, 'calendar unavailable', '日历异步错误应通过 report handler 传递');
assert.equal(calendarErrorAction, 'calendar', '错误报告必须知道失败的是日历动作');
let calendarSyncErrorReported = false;
assert.throws(() => runControlMenuAction(
    'calendar',
    () => { throw new Error('calendar sync fail'); },
    () => { calendarSyncErrorReported = true; },
), /calendar sync fail/);
assert.equal(calendarSyncErrorReported, false, '日历同步异常不应误报');
let contactsErrorMessage = '';
let contactsErrorAction = '';
await runControlMenuAction(
    'contacts',
    () => Promise.reject(new Error('contacts unavailable')),
    (error, action) => { contactsErrorMessage = error.message; contactsErrorAction = action; },
);
assert.equal(contactsErrorMessage, 'contacts unavailable', '联系人异步错误应进入控制中心错误边界');
assert.equal(contactsErrorAction, 'contacts');

const finalizerCalls = [];
assert.throws(() => finalizeDeletedScene({
    persistPhoneUi: () => { finalizerCalls.push('phone-ui'); throw new Error('quota'); },
    refreshDesktop: () => { finalizerCalls.push('desktop'); },
    persistBudget: () => { finalizerCalls.push('budget'); throw new Error('budget-write'); },
    clearOpenScene: () => { finalizerCalls.push('clear'); },
    renderLauncher: () => { finalizerCalls.push('launcher'); },
}), /互动场景已删除；手机页面状态保存失败：quota；上下文预算清理保存失败：budget-write/);
assert.deepEqual(finalizerCalls, ['phone-ui', 'desktop', 'budget', 'clear', 'launcher']);
const successfulFinalizerCalls = [];
assert.doesNotThrow(() => finalizeDeletedScene({
    persistPhoneUi: () => successfulFinalizerCalls.push('phone-ui'),
    refreshDesktop: () => successfulFinalizerCalls.push('desktop'),
    persistBudget: () => successfulFinalizerCalls.push('budget'),
    clearOpenScene: () => successfulFinalizerCalls.push('clear'),
    renderLauncher: () => successfulFinalizerCalls.push('launcher'),
}));
assert.deepEqual(successfulFinalizerCalls, ['phone-ui', 'desktop', 'budget', 'clear', 'launcher']);

const deletedSceneRuntime = { openSceneId: 'scene-delete' };
const deletedSceneScope = {
    activeSceneId: 'scene-delete',
    scenes: {
        'scene-keep': { id: 'scene-keep', title: '保留场景' },
        'scene-delete': { id: 'scene-delete', title: '待删除场景' },
    },
    sceneOrder: ['scene-keep', 'scene-delete'],
};
const deleteBudgetConfig = { communitySceneIdsByStorage: { story: ['scene-keep', 'scene-delete'] } };
const deleteFlowCalls = [];
let deletedBudgetCandidate = null;
await assert.rejects(() => runDeleteSceneAction('story', 'scene-delete', {
    scope: deletedSceneScope,
    confirm: message => { deleteFlowCalls.push('confirm'); return message.includes('待删除场景'); },
    invalidate: () => deleteFlowCalls.push('invalidate'),
    commit: async mutator => { deleteFlowCalls.push('commit'); await mutator(); },
    persistPhoneUi: () => deleteFlowCalls.push('phone-ui'),
    refreshDesktop: scopeId => deleteFlowCalls.push(`desktop:${scopeId}`),
    getBudgetConfig: () => deleteBudgetConfig,
    saveBudgetConfig: candidate => {
        deleteFlowCalls.push('budget-save');
        deletedBudgetCandidate = candidate;
        return false;
    },
    clearOpenScene: () => { deleteFlowCalls.push('clear'); deletedSceneRuntime.openSceneId = null; },
    renderLauncher: scopeId => deleteFlowCalls.push(`launcher:${scopeId}`),
}), /互动场景已删除；上下文预算清理保存失败：浏览器存储不可用/);
assert.deepEqual(deleteFlowCalls, [
    'confirm', 'invalidate', 'commit', 'phone-ui', 'desktop:story',
    'budget-save', 'clear', 'launcher:story',
]);
assert.equal(deletedSceneScope.scenes['scene-delete'], undefined);
assert.deepEqual(deletedSceneScope.sceneOrder, ['scene-keep']);
assert.equal(deletedSceneScope.activeSceneId, 'scene-keep');
assert.deepEqual(deletedBudgetCandidate.communitySceneIdsByStorage.story, ['scene-keep']);
assert.deepEqual(deleteBudgetConfig.communitySceneIdsByStorage.story, ['scene-keep', 'scene-delete']);
assert.equal(deletedSceneRuntime.openSceneId, null, '预算保存失败后仍必须清理已删除场景的运行时引用');

const cancelledDeleteScope = {
    activeSceneId: 'scene-cancel',
    scenes: { 'scene-cancel': { id: 'scene-cancel', title: '取消删除' } },
    sceneOrder: ['scene-cancel'],
};
let cancelledCommitCount = 0;
assert.equal(await runDeleteSceneAction('story', 'scene-cancel', {
    scope: cancelledDeleteScope,
    confirm: () => false,
    invalidate: () => assert.fail('取消删除不得失效运行时任务'),
    commit: async () => { cancelledCommitCount += 1; },
    persistPhoneUi: () => assert.fail('取消删除不得保存页面状态'),
    refreshDesktop: () => assert.fail('取消删除不得刷新桌面'),
    getBudgetConfig: () => ({}),
    saveBudgetConfig: () => true,
    clearOpenScene: () => assert.fail('取消删除不得清理打开场景'),
    renderLauncher: () => assert.fail('取消删除不得刷新社区页面'),
}), false);
assert.equal(cancelledCommitCount, 0);
assert.ok(cancelledDeleteScope.scenes['scene-cancel']);

await assert.rejects(() => runDeleteSceneAction('story', 'missing-scene', {
    scope: cancelledDeleteScope,
    confirm: () => assert.fail('不存在的场景不得进入确认'),
}), /互动场景不存在/);

const failedCommitCalls = [];
await assert.rejects(() => runDeleteSceneAction('story', 'scene-cancel', {
    scope: cancelledDeleteScope,
    confirm: () => true,
    invalidate: () => failedCommitCalls.push('invalidate'),
    commit: async () => { failedCommitCalls.push('commit'); throw new Error('commit-failed'); },
    persistPhoneUi: () => failedCommitCalls.push('phone-ui'),
    refreshDesktop: () => failedCommitCalls.push('desktop'),
    getBudgetConfig: () => ({}),
    saveBudgetConfig: () => true,
    clearOpenScene: () => failedCommitCalls.push('clear'),
    renderLauncher: () => failedCommitCalls.push('launcher'),
}), /commit-failed/);
assert.deepEqual(failedCommitCalls, ['invalidate', 'commit']);

const delegatedListeners = new Map();
const delegatedActions = [];
let openSceneMenus = [];
const delegatedErrors = [];
const desktopApp = { kind: 'desktop' };
const calendarApp = { id: 'pm-calendar-app' };
const actionButton = {
    dataset: { action: 'desktop-chat' },
    closest(selector) {
        if (selector === '#pm-scene-app') return null;
        if (selector === '.pm-desktop-page') return desktopApp;
        return null;
    },
};
const actionTarget = {
    closest(selector) {
        assert.equal(selector, '[data-action]');
        return actionButton;
    },
};
const delegatedPhoneRoot = {
    dataset: {},
    addEventListener(type, listener) {
        assert.equal(delegatedListeners.has(type), false);
        delegatedListeners.set(type, listener);
    },
    querySelectorAll(selector) { assert.equal(selector, '.pm-scene-menu:not([hidden])'); return openSceneMenus.filter(menu => !menu.hidden); },
    contains(node) { return node === actionButton || node === calendarActionButton || node === calendarCountryControl; },
};
assert.equal(bindPhonePageActions(
    delegatedPhoneRoot,
    (button, app) => {
        delegatedActions.push({ button, app });
    },
    error => delegatedErrors.push(error),
), true);
assert.equal(bindPhonePageActions(delegatedPhoneRoot, () => {}, () => {}), false);
assert.deepEqual([...delegatedListeners.keys()], ['click', 'change', 'keydown']);
delegatedListeners.get('click')({ target: actionTarget });
await Promise.resolve();
assert.deepEqual(delegatedActions, [{ button: actionButton, app: desktopApp }], '重复绑定后一次点击只能分发一次');
assert.deepEqual(delegatedErrors, []);

const calendarActionButton = {
    dataset: { action: 'calendar-occasion-save' },
    closest(selector) {
        if (selector === '#pm-scene-app') return null;
        if (selector === '#pm-calendar-app') return calendarApp;
        return null;
    },
};
const calendarActionTarget = {
    closest(selector) {
        assert.equal(selector, '[data-action]');
        return calendarActionButton;
    },
};
delegatedListeners.get('click')({ target: calendarActionTarget });
await Promise.resolve();
assert.deepEqual(delegatedActions, [
    { button: actionButton, app: desktopApp },
    { button: calendarActionButton, app: calendarApp },
], '日历页面动作必须进入统一事件委托并保留目标 app');
assert.deepEqual(delegatedErrors, []);

const calendarCountryControl = {
    tagName: 'SELECT',
    dataset: { action: 'calendar-holiday-country' }, value: 'JP',
    closest(selector) {
        if (selector === '[data-action]') return this;
        if (selector === 'select[data-action]') return this;
        if (selector === '#pm-scene-app') return null;
        if (selector === '#pm-calendar-app') return calendarApp;
        return null;
    },
};
const actionsBeforeCountrySelection = delegatedActions.length;
delegatedListeners.get('click')({ target: calendarCountryControl });
delegatedListeners.get('change')({ target: calendarCountryControl });
await Promise.resolve();
assert.equal(delegatedActions.length, actionsBeforeCountrySelection + 1,
    'select 的 click 与 change 组合只能由 change 委托分发一次');
assert.deepEqual(delegatedActions.at(-1), { button: calendarCountryControl, app: calendarApp },
    '日历国家选择变化必须进入统一异步错误边界');
assert.deepEqual(delegatedErrors, []);

let menuFocused = false;
let menuExpanded = 'true';
const menuTrigger = {
    setAttribute(name, value) { assert.equal(name, 'aria-expanded'); menuExpanded = value; },
    focus(options) { assert.deepEqual(options, { preventScroll: true }); menuFocused = true; },
};
const menuWrap = {
    querySelector(selector) { assert.equal(selector, '[data-action="more"]'); return menuTrigger; },
};
const sceneMenu = {
    hidden: false,
    closest(selector) { assert.equal(selector, '.pm-scene-menu-wrap'); return menuWrap; },
};
openSceneMenus = [sceneMenu];
delegatedListeners.get('click')({ target: { closest: () => null } });
assert.equal(sceneMenu.hidden, true, '点击更多菜单外部必须关闭菜单');
assert.equal(menuExpanded, 'false');

sceneMenu.hidden = false;
menuExpanded = 'true';
let escapePrevented = false;
delegatedListeners.get('keydown')({
    key: 'Escape',
    preventDefault() { escapePrevented = true; },
});
assert.equal(sceneMenu.hidden, true, 'Escape 必须关闭更多菜单');
assert.equal(menuExpanded, 'false');
assert.equal(escapePrevented, true);
assert.equal(menuFocused, true, 'Escape 关闭菜单后必须把焦点还给更多按钮');

const groupStore = normalizeGroupMetaStore({
    story: {
        valid: { name: '群', members: ['A', 'B'] },
        invalid: { name: '坏群', members: ['A'] },
    },
});
assert.ok(groupStore.story.valid);
assert.equal(groupStore.story.invalid, undefined);

console.log('Behavior configuration verified.');
