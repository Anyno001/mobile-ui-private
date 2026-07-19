import assert from 'node:assert/strict';
import {
  addPendingMessage, clearPendingMessages, clearPendingStorage,
  combinePendingMessages, getPendingMessage, getPendingMessages,
  removePendingBatch, removePendingMessage, setPendingBatchStatus,
  setPendingStatus, updatePendingMessage,
} from '../src/pending-messages.js';
import { createHistoryWindow } from '../src/history-window.js';

const runtime = { pendingMessages: new Map(), pendingSequence: 0 };
assert.equal(addPendingMessage(runtime, '', 'Alice', { plainText: 'x' }), null);
assert.equal(addPendingMessage(runtime, 'story', 'Alice', {}), null);

const first = addPendingMessage(runtime, 'story', 'Alice', {
  rawText: ' 你好 / [emo:猫:1] ',
  plainText: '你好 / [emo:猫:1]',
  directorNote: '',
  bubbleParts: ['你好', '[emo:猫:1]'],
});
const second = addPendingMessage(runtime, 'story', 'Alice', {
  rawText: '【靠近一点】', plainText: '', directorNote: '靠近一点', bubbleParts: [],
});
const other = addPendingMessage(runtime, 'story', 'Bob', {
  rawText: 'Bob', plainText: 'Bob', bubbleParts: ['Bob'],
});
assert.equal(first.id, 1);
assert.equal(second.id, 2);
assert.equal(other.id, 3);
assert.deepEqual(getPendingMessages(runtime, 'story', 'Alice'), [first, second]);
assert.equal(getPendingMessage(runtime, 'story', 'Alice', second.id), second);
assert.deepEqual(combinePendingMessages(runtime, 'story', 'Alice'), {
  items: [first, second],
  plainText: '你好 / [emo:猫:1]',
  directorNote: '靠近一点',
  bubbleParts: ['你好', '[emo:猫:1]'],
  quoteConflict: false,
});

const quoteA = { messageId: 'msg_a', bubbleId: 'bubble_a', sender: 'Alice', text: '消息 A' };
const quoteB = { messageId: 'msg_b', bubbleId: 'bubble_b', sender: 'Bob', text: '消息 B' };
const quotedRuntime = { pendingMessages: new Map(), pendingSequence: 0 };
const quotedFirst = addPendingMessage(quotedRuntime, 'story', 'group', {
  rawText: '回复 A', plainText: '回复 A', bubbleParts: ['回复 A'], quote: quoteA,
});
const quotedSecond = addPendingMessage(quotedRuntime, 'story', 'group', {
  rawText: '继续回复 A', plainText: '继续回复 A', bubbleParts: ['继续回复 A'], quote: quoteA,
});
assert.deepEqual(combinePendingMessages(quotedRuntime, 'story', 'group'), {
  items: [quotedFirst, quotedSecond],
  plainText: '回复 A / 继续回复 A',
  directorNote: '',
  bubbleParts: ['回复 A', '继续回复 A'],
  quoteConflict: false,
  quote: quoteA,
}, '相同引用目标允许合并为一个最终用户 entry');

const quotedThird = addPendingMessage(quotedRuntime, 'story', 'group', {
  rawText: '回复 B', plainText: '回复 B', bubbleParts: ['回复 B'], quote: quoteB,
});
const conflictingBatch = combinePendingMessages(quotedRuntime, 'story', 'group');
assert.equal(conflictingBatch.quoteConflict, true, '不同引用目标不得静默合并');
assert.equal(Object.hasOwn(conflictingBatch, 'quote'), false, '引用冲突时不得任意保留第一条引用');
assert.deepEqual(conflictingBatch.items, [quotedFirst, quotedSecond, quotedThird]);

const mixedRuntime = { pendingMessages: new Map(), pendingSequence: 0 };
const unquoted = addPendingMessage(mixedRuntime, 'story', 'group', {
  rawText: '普通消息', plainText: '普通消息', bubbleParts: ['普通消息'],
});
const quoted = addPendingMessage(mixedRuntime, 'story', 'group', {
  rawText: '引用消息', plainText: '引用消息', bubbleParts: ['引用消息'], quote: quoteB,
});
assert.deepEqual(combinePendingMessages(mixedRuntime, 'story', 'group').quote, quoteB,
  '无引用消息与单一引用目标可安全合并');
assert.deepEqual(getPendingMessages(mixedRuntime, 'story', 'group'), [unquoted, quoted]);

const submittingRuntime = { pendingMessages: new Map(), pendingSequence: 0 };
const submittingItem = addPendingMessage(submittingRuntime, 'story', 'group', {
  rawText: '旧提交', plainText: '旧提交', bubbleParts: ['旧提交'], quote: quoteA,
});
const freshItem = addPendingMessage(submittingRuntime, 'story', 'group', {
  rawText: '新暂存', plainText: '新暂存', bubbleParts: ['新暂存'], quote: quoteB,
});
assert.equal(setPendingBatchStatus(submittingRuntime, 'story', 'group', [submittingItem.id], 'submitting'), 1);
assert.deepEqual(combinePendingMessages(submittingRuntime, 'story', 'group'), {
  items: [freshItem],
  plainText: '新暂存',
  directorNote: '',
  bubbleParts: ['新暂存'],
  quoteConflict: false,
  quote: quoteB,
}, 'submitting 项不得污染下一批正文、气泡或引用冲突判定');
assert.deepEqual(getPendingMessages(submittingRuntime, 'story', 'group'), [submittingItem, freshItem],
  '聚合可提交项不得修改暂存存量');

assert.equal(setPendingBatchStatus(runtime, 'story', 'Alice', [first.id], 'submitting'), 1);
assert.equal(removePendingMessage(runtime, 'story', 'Alice', first.id), false);
assert.equal(updatePendingMessage(runtime, 'story', 'Alice', first.id, { plainText: '禁止' }), null);
assert.equal(setPendingStatus(runtime, 'story', 'Alice', 'failed'), 2);
const updated = updatePendingMessage(runtime, 'story', 'Alice', second.id, {
  rawText: '修改后', plainText: '修改后', directorNote: '', bubbleParts: ['修改后'],
});
assert.equal(updated.status, 'pending');
assert.equal(updated.rawText, '修改后');
assert.deepEqual(updated.bubbleParts, ['修改后']);

assert.equal(removePendingBatch(runtime, 'story', 'Alice', [first.id]), 1);
assert.deepEqual(getPendingMessages(runtime, 'story', 'Alice'), [second]);
assert.equal(removePendingMessage(runtime, 'story', 'Alice', second.id), true);
assert.deepEqual(getPendingMessages(runtime, 'story', 'Alice'), []);
assert.equal(runtime.pendingMessages.has('story'), true);
assert.equal(clearPendingMessages(runtime, 'story', 'Bob'), true);
assert.equal(runtime.pendingMessages.has('story'), false);

addPendingMessage(runtime, 'other', 'Alice', { plainText: 'x', bubbleParts: ['x'] });
assert.equal(clearPendingStorage(runtime, 'other'), true);
assert.equal(clearPendingStorage(runtime, 'other'), false);

const source = Array.from({ length: 62 }, (_, index) => ({ index }));
const windowed = createHistoryWindow(source, 60);
assert.equal(windowed.trimmedCount, 2);
assert.equal(windowed.history.length, 60);
assert.equal(windowed.history[0].index, 2);
assert.equal(windowed.toWindowIndex(0), null);
assert.equal(windowed.toWindowIndex(1), null);
assert.equal(windowed.toWindowIndex(2), 0);
assert.equal(windowed.toWindowIndex(60), 58);
assert.equal(windowed.toWindowIndex(61), 59);
assert.equal(createHistoryWindow(source.slice(0, 58), 60).toWindowIndex(57), 57);
console.log('Pending message state verified.');
