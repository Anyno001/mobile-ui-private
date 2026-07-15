import assert from 'node:assert/strict';
import {
    EXTENSION_PROMPT_POSITIONS, MAX_INJECTION_DEPTH,
} from '../src/constants.js';
import {
    DEFAULT_CHARACTER_BEHAVIOR, getCharacterBehavior,
    normalizeCharacterBehavior, normalizeCharacterBehaviorStore,
    normalizeGroupInjection, normalizeGroupMeta, normalizeGroupMetaStore,
} from '../src/behavior-config.js';
import {
    loadCharacterBehavior, loadGroupMeta, saveCharacterBehavior, saveGroupMeta,
} from '../src/storage.js';

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
globalThis.window = {};
globalThis.localStorage = {
    getItem(key) { return localValues.has(key) ? localValues.get(key) : null; },
    setItem(key, value) { localValues.set(key, String(value)); },
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
loadGroupMeta();
assert.deepEqual(window.__pmGroupMeta.story.valid.legacyField, { keep: true });
assert.equal(window.__pmGroupMeta.story.invalid, undefined);
window.__pmGroupMeta.story.valid.injection = { position: -1, depth: MAX_INJECTION_DEPTH + 1 };
saveGroupMeta();
const savedGroup = JSON.parse(localValues.get('ST_SMS_GROUP_META')).story.valid;
assert.equal(savedGroup.injection.position, -1);
assert.equal(savedGroup.injection.depth, MAX_INJECTION_DEPTH);
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
