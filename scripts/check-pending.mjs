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
});

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
