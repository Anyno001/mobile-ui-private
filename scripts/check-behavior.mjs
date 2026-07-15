import assert from 'node:assert/strict';
import {
    EXTENSION_PROMPT_POSITIONS, MAX_INJECTION_DEPTH,
} from '../src/constants.js';
import {
    buildCharacterBehaviorPrompt, buildChatPreferencePrompt,
    DEFAULT_CHARACTER_BEHAVIOR, getCharacterBehavior,
    normalizeCharacterBehavior, normalizeCharacterBehaviorStore,
    normalizeGroupInjection, normalizeGroupMeta, normalizeGroupMetaStore,
} from '../src/behavior-config.js';
import {
    loadBgSettings, loadCharacterBehavior, loadGroupMeta, pmIDBDel, pmIDBGet, pmIDBSet,
    saveBgGlobal, saveBgLocal, saveCharacterBehavior, saveGroupMeta, saveHistoriesStrict,
} from '../src/storage.js';
import { applyConversationInjections } from '../src/phone-injection.js';
import { parseBackupData, runBackgroundTransaction, runBackupTransaction } from '../src/settings-ui.js';

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
const localStorageControl = {
    failGet: new Set(),
    failSet: new Set(),
};
globalThis.window = {};
globalThis.localStorage = {
    getItem(key) {
        if (localStorageControl.failGet.delete(key)) throw new Error('injected get failure');
        return localValues.has(key) ? localValues.get(key) : null;
    },
    setItem(key, value) {
        if (localStorageControl.failSet.delete(key)) throw new Error('injected set failure');
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

const promptCalls = [];
const injectionRuntime = { injectionKeys: new Set(['PHONE_SMS_MEMORY:stale']) };
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
const newGlobalBackground = largeBackground('new-global');
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
    histories: {}, config: {}, theme: {}, profiles: [], groupMeta: {}, pokeConfig: {},
    bidirectional: {}, emojis: [], characterBehavior: {}, wordyLimit: false,
    bgGlobal: '', bgLocal: {}, interactiveScenes: { version: 1, scopes: {} },
};
const parsedLegacyBackup = parseBackupData({ histories: { story: {} } }, currentBackup);
assert.deepEqual(parsedLegacyBackup.histories, { story: {} });
assert.deepEqual(parsedLegacyBackup.interactiveScenes, currentBackup.interactiveScenes);
assert.throws(() => parseBackupData({ schemaVersion: '3' }, currentBackup), /备份版本无效/);
assert.throws(() => parseBackupData({ schemaVersion: 4 }, currentBackup), /高于当前支持版本/);
assert.throws(() => parseBackupData({ schemaVersion: 3, histories: 'broken' }, currentBackup), /histories 必须是对象/);
assert.throws(() => parseBackupData({ schemaVersion: 3, profiles: {} }, currentBackup), /profiles 必须是数组/);
assert.throws(() => parseBackupData({ schemaVersion: 3, wordyLimit: 'yes' }, currentBackup), /wordyLimit 必须是布尔值/);
assert.throws(() => parseBackupData({
    schemaVersion: 3,
    interactiveScenes: { version: 1, scopes: [] },
}, currentBackup), /interactiveScenes\.scopes 必须是对象/);
assert.throws(() => parseBackupData({
    schemaVersion: 3,
    interactiveScenes: { version: 1, scopes: { story: { activeSceneId: null, sceneOrder: {}, scenes: {} } } },
}, currentBackup), /sceneOrder 必须是数组/);
assert.throws(() => parseBackupData({
    schemaVersion: 3,
    interactiveScenes: { version: 1, scopes: { story: { activeSceneId: 'missing', sceneOrder: [], scenes: {} } } },
}, currentBackup), /activeSceneId 未指向有效场景/);
assert.throws(() => parseBackupData({
    schemaVersion: 3,
    interactiveScenes: { version: 1, scopes: { story: { activeSceneId: null, sceneOrder: [], scenes: { orphan: { id: 'orphan' } } } } },
}, currentBackup), /未列入 sceneOrder/);
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
    contentRating: 'general', createdAt: 100, updatedAt: 200,
    posts: [{
        id: 'post', author: '作者', content: '帖子', tags: ['日常'], createdAt: 110,
        comments: [{ id: 'comment', author: '评论者', content: '评论', createdAt: 120 }], liked: false,
    }],
    live: {
        title: '直播间', status: 'idle',
        danmaku: [{ id: 'danmaku', author: '观众', content: '弹幕', createdAt: 130 }],
    },
};
const parsedLosslessBackup = parseBackupData(interactiveBackupWithScene(validInteractiveScene), currentBackup);
assert.deepEqual(parsedLosslessBackup.interactiveScenes.scopes.story.scenes.scene, validInteractiveScene);
const parsedLegacyScene = parseBackupData(interactiveBackupWithScene({ id: 'scene' }, {
    activeSceneId: undefined,
}), currentBackup);
assert.equal(parsedLegacyScene.interactiveScenes.scopes.story.activeSceneId, 'scene');

const lossyInteractiveCases = [
    [{ ...validInteractiveScene, title: ' 社区' }, /title 不能包含首尾空白/],
    [{ ...validInteractiveScene, title: 'x'.repeat(81) }, /title 长度不能超过 80/],
    [{ ...validInteractiveScene, preset: '' }, /preset 必须是非空字符串/],
    [{ ...validInteractiveScene, styleInput: ` ${'x'.repeat(10)}` }, /styleInput 不能包含首尾空白/],
    [{ ...validInteractiveScene, generatedPrompt: 'x'.repeat(6001) }, /generatedPrompt 长度不能超过 6000/],
    [{ ...validInteractiveScene, contentRating: 'adult' }, /contentRating 必须是 general 或 mature/],
    [{ ...validInteractiveScene, createdAt: '100' }, /createdAt 必须是有效时间戳/],
    [{ ...validInteractiveScene, updatedAt: 0 }, /updatedAt 必须是有效时间戳/],
    [{ ...validInteractiveScene, unsupported: true }, /unsupported 不受支持/],
    [{ ...validInteractiveScene, posts: Array.from({ length: 81 }, (_, index) => ({ content: `帖子${index}` })) }, /posts 不能超过 80 项/],
    [{ ...validInteractiveScene, posts: [{ content: 'x'.repeat(4001) }] }, /content 长度不能超过 4000/],
    [{ ...validInteractiveScene, posts: [{ content: ' 帖子' }] }, /content 不能包含首尾空白/],
    [{ ...validInteractiveScene, posts: [{ id: '', content: '帖子' }] }, /id 必须是非空字符串/],
    [{ ...validInteractiveScene, posts: [{ author: 'x'.repeat(81), content: '帖子' }] }, /author 长度不能超过 80/],
    [{ ...validInteractiveScene, posts: [{ content: '帖子', createdAt: Number.NaN }] }, /createdAt 必须是有效时间戳/],
    [{ ...validInteractiveScene, posts: [{ content: '帖子', liked: 'yes' }] }, /liked 必须是布尔值/],
    [{ ...validInteractiveScene, posts: [{ content: '帖子', tags: ['', '日常'] }] }, /tags\.0 必须是非空字符串/],
    [{ ...validInteractiveScene, posts: [{ content: '帖子', tags: ['x'.repeat(31)] }] }, /tags\.0 长度不能超过 30/],
    [{ ...validInteractiveScene, posts: [{ content: '帖子', tags: Array(6).fill('标签') }] }, /tags 不能超过 5 项/],
    [{ ...validInteractiveScene, posts: [{ content: '帖子', comments: Array.from({ length: 41 }, (_, index) => ({ content: `评论${index}` })) }] }, /comments 不能超过 40 项/],
    [{ ...validInteractiveScene, posts: [{ content: '帖子', comments: [{ content: 'x'.repeat(1001) }] }] }, /content 长度不能超过 1000/],
    [{ ...validInteractiveScene, posts: [{ content: '帖子', comments: [{ content: '评论', liked: false }] }] }, /liked 不受支持/],
    [{ ...validInteractiveScene, live: { ...validInteractiveScene.live, title: '' } }, /live\.title 必须是非空字符串/],
    [{ ...validInteractiveScene, live: { ...validInteractiveScene.live, status: 'streaming' } }, /live\.status 必须是 idle/],
    [{ ...validInteractiveScene, live: { ...validInteractiveScene.live, danmaku: Array.from({ length: 241 }, (_, index) => ({ content: `弹幕${index}` })) } }, /danmaku 不能超过 240 项/],
    [{ ...validInteractiveScene, live: { ...validInteractiveScene.live, danmaku: [{ content: 'x'.repeat(201) }] } }, /content 长度不能超过 200/],
];
for (const [scene, pattern] of lossyInteractiveCases) assertInvalidInteractiveScene(scene, pattern);

assertInvalidInteractiveScene(validInteractiveScene, /sceneOrder 不能超过 12 项/, {
    activeSceneId: 'scene0',
    sceneOrder: Array.from({ length: 13 }, (_, index) => `scene${index}`),
    scenes: Object.fromEntries(Array.from({ length: 13 }, (_, index) => [`scene${index}`, { id: `scene${index}` }])),
});
assertInvalidInteractiveScene(validInteractiveScene, /activeSceneId 不能在存在场景时为 null/, { activeSceneId: null });
assert.throws(() => parseBackupData(JSON.parse('{"schemaVersion":3,"interactiveScenes":{"version":1,"scopes":{"__proto__":{"activeSceneId":null,"sceneOrder":[],"scenes":{}}}}}'), currentBackup), /包含危险键 __proto__/);
assert.throws(() => parseBackupData(JSON.parse('{"schemaVersion":3,"interactiveScenes":{"version":1,"scopes":{"story":{"activeSceneId":"__proto__","sceneOrder":["__proto__"],"scenes":{"__proto__":{"id":"__proto__"}}}}}}'), currentBackup), /包含危险键 __proto__/);

const parsedV3Backup = parseBackupData({
    schemaVersion: 3,
    profiles: [{ apiUrl: 'https://example.test' }],
    interactiveScenes: { version: 1, scopes: { story: { activeSceneId: null, sceneOrder: [], scenes: {} } } },
}, currentBackup);
assert.equal(parsedV3Backup.profiles.length, 1);
assert.ok(parsedV3Backup.interactiveScenes.scopes.story);

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
delete globalThis.indexedDB;
delete globalThis.localStorage;
delete globalThis.window;

const groupStore = normalizeGroupMetaStore({
    story: {
        valid: { name: '群', members: ['A', 'B'] },
        invalid: { name: '坏群', members: ['A'] },
    },
});
assert.ok(groupStore.story.valid);
assert.equal(groupStore.story.invalid, undefined);

console.log('Behavior configuration verified.');
