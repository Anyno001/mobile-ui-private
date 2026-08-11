import assert from 'node:assert/strict';
import { bindBubbleQuoteGesture } from '../src/phone-message-rendering.js';
import { bindPressGesture } from '../src/press-gesture.js';

class FakeElement {
  constructor() { this.listeners = new Map(); this.disabled = false; this.captured = []; this.released = []; }
  addEventListener(type, handler) { if (!this.listeners.has(type)) this.listeners.set(type, new Set()); this.listeners.get(type).add(handler); }
  removeEventListener(type, handler) { this.listeners.get(type)?.delete(handler); }
  setPointerCapture(pointerId) { this.captured.push(pointerId); }
  releasePointerCapture(pointerId) { this.released.push(pointerId); }
  emit(type, fields = {}) {
    const event = {
      button: 0, pointerId: 1, pointerType: 'mouse', clientX: 0, clientY: 0,
      prevented: false, stopped: false,
      preventDefault() { this.prevented = true; },
      stopPropagation() { this.stopped = true; },
      ...fields,
    };
    for (const handler of this.listeners.get(type) || []) handler(event);
    return event;
  }
}

function createTimers() {
  let nextId = 1; let now = 0; const tasks = new Map();
  return {
    setTimer(fn, delay = 0) { const id = nextId++; tasks.set(id, { fn, due: now + delay, delay }); return id; },
    clearTimer(id) { tasks.delete(id); },
    runAll() { const queued = [...tasks.values()]; tasks.clear(); queued.forEach(task => task.fn()); },
    advance(ms) {
      now += ms;
      const due = [...tasks.entries()].filter(([, task]) => task.due <= now);
      due.forEach(([id]) => tasks.delete(id));
      due.forEach(([, task]) => task.fn());
    },
    get delays() { return [...tasks.values()].map(task => task.delay); },
    get size() { return tasks.size; },
  };
}

class PropagatingElement extends FakeElement {
  constructor(parent = null, className = '') { super(); this.parent = parent; this.className = className; }
  closest(selector) {
    const classNames = selector.split(',').map(candidate => candidate.trim()).filter(candidate => candidate.startsWith('.')).map(candidate => candidate.slice(1));
    for (let node = this; node; node = node.parent) {
      const nodeClasses = String(node.className || '').split(/\s+/).filter(Boolean);
      if (classNames.some(className => nodeClasses.includes(className))) return node;
    }
    return null;
  }
  dispatch(type, fields = {}) {
    const path = []; for (let node = this; node; node = node.parent) path.unshift(node);
    const event = { button: 0, pointerId: 1, pointerType: 'mouse', clientX: 0, clientY: 0, detail: 1, target: this, prevented: false, stopped: false, preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; }, ...fields };
    for (const node of path) { for (const entry of node.listeners.get(`${type}:capture`) || []) { entry(event); if (event.stopped) return event; } }
    for (const node of path.reverse()) { for (const entry of node.listeners.get(type) || []) { entry(event); if (event.stopped) return event; } }
    return event;
  }
  addEventListener(type, handler, capture = false) { const key = capture ? `${type}:capture` : type; if (!this.listeners.has(key)) this.listeners.set(key, new Set()); this.listeners.get(key).add(handler); }
  removeEventListener(type, handler, capture = false) { this.listeners.get(capture ? `${type}:capture` : type)?.delete(handler); }
}

{
  const element = new FakeElement(); const timers = createTimers(); let presses = 0; let holds = 0;
  const unbind = bindPressGesture(element, { onPress: () => presses++, onHold: () => holds++, setTimer: timers.setTimer, clearTimer: timers.clearTimer });
  element.emit('pointerdown'); assert.deepEqual(element.captured, [1]); assert.equal(timers.size, 1);
  element.emit('pointerup'); assert.equal(timers.size, 0); assert.deepEqual(element.released, [1]);
  element.emit('click'); assert.equal(presses, 1); assert.equal(holds, 0);
  unbind(); assert.equal(element.listeners.get('click').size, 0);
}
{
  const element = new FakeElement(); const timers = createTimers(); let presses = 0; let holds = 0;
  bindPressGesture(element, { onPress: () => presses++, onHold: () => holds++, setTimer: timers.setTimer, clearTimer: timers.clearTimer });
  element.emit('pointerdown', { pointerId: 7 }); timers.runAll(); assert.equal(holds, 1);
  element.emit('pointercancel', { pointerId: 7 });
  const click = element.emit('click', { pointerId: 7 }); assert.equal(click.prevented, true); assert.equal(click.stopped, true); assert.equal(presses, 0);
}
{
  const element = new FakeElement(); const timers = createTimers(); let holds = 0;
  bindPressGesture(element, { onHold: () => holds++, setTimer: timers.setTimer, clearTimer: timers.clearTimer });
  element.emit('pointerdown'); element.emit('pointercancel'); timers.runAll(); assert.equal(holds, 0);
  element.emit('pointerdown', { pointerId: 2 }); element.emit('lostpointercapture', { pointerId: 2 }); timers.runAll(); assert.equal(holds, 0);
}
{
  const element = new FakeElement(); const timers = createTimers(); let presses = 0; let holds = 0;
  bindPressGesture(element, { onPress: () => presses++, onHold: () => holds++, setTimer: timers.setTimer, clearTimer: timers.clearTimer });
  element.emit('pointerdown', { pointerId: 3 }); timers.runAll(); element.emit('lostpointercapture', { pointerId: 3 }); assert.equal(holds, 1);
  element.emit('pointerdown', { pointerId: 4 }); element.emit('pointerup', { pointerId: 4 }); element.emit('click', { pointerId: 4 });
  assert.equal(presses, 1); assert.equal(holds, 1);
}
{
  const element = new FakeElement(); const timers = createTimers(); let holds = 0;
  const unbind = bindPressGesture(element, { onHold: () => holds++, setTimer: timers.setTimer, clearTimer: timers.clearTimer });
  element.emit('pointerdown', { pointerId: 5 }); assert.equal(timers.size, 1); unbind(); assert.equal(timers.size, 0); timers.runAll(); assert.equal(holds, 0);
}
{
  const element = new FakeElement(); const timers = createTimers(); let holds = 0;
  bindPressGesture(element, { onHold: () => holds++, setTimer: timers.setTimer, clearTimer: timers.clearTimer });
  element.emit('pointerdown', { pointerId: 6 });
  element.emit('pointercancel', { pointerId: 99 }); assert.equal(timers.size, 1);
  timers.runAll(); assert.equal(holds, 1);
}
{
  const element = new FakeElement(); const timers = createTimers(); let presses = 0; let holds = 0;
  bindPressGesture(element, { onPress: () => presses++, onHold: () => holds++, setTimer: timers.setTimer, clearTimer: timers.clearTimer });
  element.emit('pointerdown', { pointerId: 8 }); timers.runAll(); element.emit('pointercancel', { pointerId: 8 });
  element.emit('pointerdown', { pointerId: 9 }); element.emit('pointerup', { pointerId: 9 }); element.emit('click', { pointerId: 9 });
  assert.equal(holds, 1); assert.equal(presses, 1);
}
for (const pointerType of ['mouse', 'touch', 'pen']) {
  const element = new FakeElement(); const eventTarget = new FakeElement(); const timers = createTimers(); let holds = 0;
  bindPressGesture(element, { onHold: () => holds++, setTimer: timers.setTimer, clearTimer: timers.clearTimer, eventTarget, moveThreshold: 10 });
  element.emit('pointerdown', { pointerId: 20, pointerType, clientX: 10, clientY: 10 });
  element.emit('pointermove', { pointerId: 20, pointerType, clientX: 16, clientY: 18 });
  timers.runAll(); assert.equal(holds, 1, `${pointerType}: movement at threshold must preserve hold`);
}
{
  const element = new FakeElement(); const eventTarget = new FakeElement(); const timers = createTimers(); let presses = 0; let holds = 0;
  bindPressGesture(element, { onPress: () => presses++, onHold: () => holds++, setTimer: timers.setTimer, clearTimer: timers.clearTimer, eventTarget, moveThreshold: 10 });
  element.emit('pointerdown', { pointerId: 21, clientX: 5, clientY: 5 });
  element.emit('pointermove', { pointerId: 21, clientX: 16, clientY: 5 });
  assert.equal(timers.size, 0); assert.deepEqual(element.released, [21], 'movement cancellation must release pointer capture');
  timers.runAll(); assert.equal(holds, 0);
  const click = element.emit('click', { pointerId: 21 });
  assert.equal(click.prevented, true); assert.equal(presses, 0);
}
{
  const element = new FakeElement(); const eventTarget = new FakeElement(); const timers = createTimers(); let presses = 0; let holds = 0;
  bindPressGesture(element, { onPress: () => presses++, onHold: () => holds++, setTimer: timers.setTimer, clearTimer: timers.clearTimer, eventTarget });
  element.emit('pointerdown', { pointerId: 22 }); eventTarget.emit('blur');
  assert.equal(timers.size, 0); timers.runAll(); assert.equal(holds, 0);
  const click = element.emit('click', { pointerId: 22 });
  assert.equal(click.prevented, true); assert.equal(presses, 0);
}
for (const cancelEvent of ['pointercancel', 'lostpointercapture']) {
  const element = new FakeElement(); const eventTarget = new FakeElement(); const timers = createTimers(); let presses = 0;
  bindPressGesture(element, { onPress: () => presses++, setTimer: timers.setTimer, clearTimer: timers.clearTimer, eventTarget });
  element.emit('pointerdown', { pointerId: 23 }); element.emit(cancelEvent, { pointerId: 23 });
  const click = element.emit('click', { pointerId: 23 });
  assert.equal(click.prevented, true, `${cancelEvent}: synthesized click must be suppressed`);
  assert.equal(presses, 0);
}
{
  const element = new FakeElement(); const eventTarget = new FakeElement(); const timers = createTimers(); let presses = 0; let holds = 0;
  bindPressGesture(element, { onPress: () => presses++, onHold: () => holds++, setTimer: timers.setTimer, clearTimer: timers.clearTimer, eventTarget });
  element.emit('pointerdown', { pointerId: 24 }); timers.runAll();
  element.emit('pointerup', { pointerId: 24 });
  const legacyClick = element.emit('click', { pointerId: undefined, detail: 1 });
  assert.equal(legacyClick.prevented, true); assert.equal(legacyClick.stopped, true);
  assert.equal(holds, 1); assert.equal(presses, 0, 'legacy pointer click after hold must not trigger short press');
}
{
  const element = new FakeElement(); const eventTarget = new FakeElement(); const timers = createTimers(); let presses = 0;
  bindPressGesture(element, { onPress: () => presses++, setTimer: timers.setTimer, clearTimer: timers.clearTimer, eventTarget });
  element.emit('pointerdown', { pointerId: 25 }); element.emit('pointercancel', { pointerId: 25 });
  const legacyClick = element.emit('click', { pointerId: undefined, detail: 1 });
  assert.equal(legacyClick.prevented, true); assert.equal(presses, 0, 'legacy pointer click after cancel must not trigger short press');
  element.emit('pointerdown', { pointerId: 26 }); element.emit('pointerup', { pointerId: 26 });
  element.emit('click', { pointerId: undefined, detail: 1 });
  assert.equal(presses, 1, 'a later normal pointer press must remain available without retained suppression state');
}
{
  const element = new FakeElement(); const eventTarget = new FakeElement(); const timers = createTimers(); let presses = 0;
  bindPressGesture(element, { onPress: () => presses++, setTimer: timers.setTimer, clearTimer: timers.clearTimer, eventTarget });
  element.emit('pointerdown', { pointerId: 27 }); element.emit('pointerup', { pointerId: 27 });
  element.emit('click', { pointerId: 27, detail: 1 });
  assert.equal(presses, 1, 'pointerup and synthesized click must produce exactly one short press');
}
{
  const element = new FakeElement(); const eventTarget = new FakeElement(); const timers = createTimers(); let presses = 0;
  bindPressGesture(element, { onPress: () => presses++, setTimer: timers.setTimer, clearTimer: timers.clearTimer, eventTarget });
  element.emit('click', { pointerId: undefined, detail: 0 });
  assert.equal(presses, 1, 'keyboard click must remain available');
}
{
  const element = new FakeElement(); const eventTarget = new FakeElement(); const timers = createTimers();
  const unbind = bindPressGesture(element, { setTimer: timers.setTimer, clearTimer: timers.clearTimer, eventTarget });
  assert.equal(eventTarget.listeners.get('blur').size, 1); unbind();
  assert.equal(eventTarget.listeners.get('blur').size, 0);
  assert.deepEqual(element.released, [], 'unbind without an active pointer must not release an unrelated pointer');
  assert.equal(element.listeners.get('pointermove').size, 0);
}
{
  const element = new FakeElement(); const eventTarget = new FakeElement(); const timers = createTimers(); let holds = 0;
  bindPressGesture(element, {
    onHold: () => { holds++; return true; }, allowNativeClick: true, clickCapture: true,
    setTimer: timers.setTimer, clearTimer: timers.clearTimer, eventTarget,
  });
  element.emit('pointerdown', { pointerId: 28 }); element.emit('pointerup', { pointerId: 28 });
  const shortClick = element.emit('click', { pointerId: 28, detail: 1 });
  assert.equal(shortClick.prevented, false, 'native-click mode must preserve ordinary short clicks');
  element.emit('pointerdown', { pointerId: 29 }); timers.runAll(); element.emit('pointerup', { pointerId: 29 });
  const keyboardClick = element.emit('click', { pointerId: undefined, detail: 0 });
  assert.equal(keyboardClick.prevented, false, 'keyboard click during pending pointer suppression must remain available');
  assert.equal(element.emit('contextmenu').prevented, true, 'keyboard click must not consume pending pointer context-menu suppression');
  const holdClick = element.emit('click', { pointerId: 29, detail: 1 });
  assert.equal(holds, 1); assert.equal(holdClick.prevented, true); assert.equal(holdClick.stopped, true,
    'keyboard click must not consume the following synthesized pointer click suppression');
}
{
  const element = new FakeElement(); const eventTarget = new FakeElement(); const timers = createTimers(); let holds = 0; let allowed = false;
  bindPressGesture(element, {
    onHold: () => { holds++; return true; }, allowNativeClick: true,
    shouldStart: () => allowed, setTimer: timers.setTimer, clearTimer: timers.clearTimer, eventTarget,
  });
  element.emit('pointerdown', { pointerId: 30 }); assert.equal(timers.size, 0, 'rejected targets must not arm a hold timer');
  allowed = true; element.emit('pointerdown', { pointerId: 31 }); assert.equal(timers.size, 1);
  timers.runAll(); assert.equal(holds, 1);
}
{
  const element = new FakeElement(); const eventTarget = new FakeElement(); const timers = createTimers();
  bindPressGesture(element, {
    onHold: () => true, allowNativeClick: true, shouldPreventContextMenu: () => false,
    setTimer: timers.setTimer, clearTimer: timers.clearTimer, eventTarget,
  });
  assert.equal(element.emit('contextmenu').prevented, false, 'ordinary mouse context menus must remain available');
  element.emit('pointerdown', { pointerId: 32 }); timers.runAll();
  assert.equal(element.emit('contextmenu').prevented, true, 'a completed hold must suppress its synthetic context menu');
}
{
  const root = new FakeElement(); const eventTarget = new FakeElement(); const timers = createTimers(); const quotes = [];
  const state = { isSelectMode: false };
  const unbind = bindBubbleQuoteGesture(root, {
    state,
    quote: { setActiveQuote(value) { quotes.push(value); return true; } },
    text: '长按引用正文', senderName: 'Alice',
    metadata: { messageId: 'message-1', bubbleId: 'bubble-1' },
    gestureRuntime: { setTimer: timers.setTimer, clearTimer: timers.clearTimer, eventTarget },
  });
  root.emit('pointerdown', { pointerId: 33, pointerType: 'touch', target: { closest: () => null } });
  assert.deepEqual(root.captured, [33], 'ordinary bubble holds must retain pointer capture for reliable move cancellation');
  assert.deepEqual(timers.delays, [550], 'bubble quote hold must use the 550ms contract');
  timers.advance(549); assert.equal(quotes.length, 0, 'bubble quote must not trigger before 550ms');
  timers.advance(1);
  assert.deepEqual(quotes, [{ messageId: 'message-1', bubbleId: 'bubble-1', sender: 'Alice', text: '长按引用正文' }]);
  timers.advance(550); assert.equal(quotes.length, 1, 'completed hold must trigger quote exactly once');
  const click = root.emit('click', { pointerId: 33, detail: 1 });
  assert.equal(click.prevented, true, 'completed bubble hold must suppress the following native click');
  root.emit('pointerdown', { pointerId: 331, pointerType: 'touch', target: { closest: () => null } });
  timers.advance(550); root.emit('pointercancel', { pointerId: 331 });
  root.emit('pointerdown', { pointerId: 332, pointerType: 'touch', target: { closest: () => null } });
  root.emit('pointerup', { pointerId: 332, pointerType: 'touch' });
  const nextClick = root.emit('click', { pointerId: 332, detail: 1 });
  assert.equal(nextClick.prevented, false, 'a new pointer sequence must clear stale click suppression after a canceled completed hold');
  root.emit('pointerdown', { pointerId: 34, target: { closest: () => ({}) } });
  assert.equal(timers.size, 0, 'quote buttons and reply cards must not arm bubble holds');
  state.isSelectMode = true;
  root.emit('pointerdown', { pointerId: 35, target: { closest: () => null } });
  assert.equal(timers.size, 0, 'message selection mode must disable bubble quote holds');
  state.isSelectMode = false;
  root.emit('pointerdown', { pointerId: 36, pointerType: 'mouse', target: { closest: () => null } });
  root.emit('pointercancel', { pointerId: 36 });
  assert.equal(root.emit('contextmenu', { pointerType: undefined, target: { closest: () => null } }).prevented, false,
    'legacy mouse context menus without pointerType must remain available');
  assert.equal(root.emit('contextmenu', { pointerType: 'mouse', target: { closest: () => null } }).prevented, false,
    'ordinary mouse context menus on bubbles must remain available');
  unbind();
}
{
  const root = new FakeElement();
  assert.equal(bindBubbleQuoteGesture(root, {
    state: { isSelectMode: false }, quote: { setActiveQuote() { return true; } }, text: 'pending',
    metadata: { pendingId: 'pending-1', messageId: 'message-1', bubbleId: 'bubble-1' },
  }), null, 'pending messages must not expose long-press quote');
  assert.equal(root.listeners.size, 0);
}
{
  const root = new PropagatingElement();
  const voiceCard = new PropagatingElement(root, 'pm-voice-card');
  const voice = new PropagatingElement(voiceCard, 'pm-voice-card-icon');
  const replyCard = new PropagatingElement(root, 'pm-reply-card');
  const reply = new PropagatingElement(replyCard, 'pm-reply-card-text');
  const quoteAction = new PropagatingElement(root, 'pm-quote-action');
  const quoteButton = new PropagatingElement(quoteAction, 'pm-quote-action-icon');
  const eventTarget = new FakeElement(); const timers = createTimers(); const quotes = [];
  let voiceClicks = 0; let replyClicks = 0; let quoteButtonClicks = 0;
  voiceCard.addEventListener('click', () => { voiceClicks++; });
  replyCard.addEventListener('click', () => { replyClicks++; });
  quoteAction.addEventListener('click', () => { quoteButtonClicks++; });
  bindBubbleQuoteGesture(root, {
    state: { isSelectMode: false },
    quote: { setActiveQuote(value) { quotes.push(value); return true; } },
    text: '语音正文', metadata: { messageId: 'message-nested', bubbleId: 'bubble-nested', sender: '角色' },
    gestureRuntime: { setTimer: timers.setTimer, clearTimer: timers.clearTimer, eventTarget },
  });
  voice.dispatch('pointerdown', { pointerId: 40, pointerType: 'touch' });
  assert.deepEqual(root.captured, [], 'voice-card presses must not redirect native click through parent pointer capture');
  voice.dispatch('pointerup', { pointerId: 40, pointerType: 'touch' });
  voice.dispatch('click', { pointerId: 40, pointerType: 'touch' });
  assert.equal(voiceClicks, 1, 'ordinary click inside a voice card must execute exactly once');
  assert.equal(quotes.length, 0, 'ordinary voice-card click must not quote');
  reply.dispatch('pointerdown', { pointerId: 41, pointerType: 'touch' });
  reply.dispatch('pointerup', { pointerId: 41, pointerType: 'touch' });
  reply.dispatch('click', { pointerId: 41, pointerType: 'touch' });
  assert.equal(replyClicks, 1, 'click inside a reply card must execute exactly once');
  quoteButton.dispatch('pointerdown', { pointerId: 42, pointerType: 'touch' });
  quoteButton.dispatch('pointerup', { pointerId: 42, pointerType: 'touch' });
  quoteButton.dispatch('click', { pointerId: 42, pointerType: 'touch' });
  assert.equal(quoteButtonClicks, 1, 'click inside a quote button must execute exactly once');
  voice.dispatch('pointerdown', { pointerId: 43, pointerType: 'touch' });
  assert.deepEqual(root.captured, [], 'voice-card holds must preserve the original native click target until suppression');
  timers.advance(550);
  voice.dispatch('pointerup', { pointerId: 43, pointerType: 'touch' });
  voice.dispatch('click', { pointerId: 43, pointerType: 'touch' });
  assert.equal(voiceClicks, 1, 'voice-card click must be suppressed after its hold becomes a quote');
  assert.deepEqual(quotes, [{ messageId: 'message-nested', bubbleId: 'bubble-nested', sender: '角色', text: '语音正文' }]);
}
for (const fixture of [
  { senderName: undefined, metadata: { messageId: 'single-left', bubbleId: 'single-left-bubble', sender: '单聊角色' }, expectedSender: '单聊角色' },
  { senderName: '群成员', metadata: { messageId: 'group-left', bubbleId: 'group-left-bubble', sender: '备用名' }, expectedSender: '群成员' },
  { senderName: undefined, metadata: { messageId: 'self', bubbleId: 'self-bubble' }, expectedSender: '我' },
]) {
  const root = new FakeElement(); const timers = createTimers(); let activeQuote = null;
  bindBubbleQuoteGesture(root, {
    state: { isSelectMode: false }, quote: { setActiveQuote(value) { activeQuote = value; return true; } },
    text: '元数据正文', senderName: fixture.senderName, metadata: fixture.metadata,
    gestureRuntime: { setTimer: timers.setTimer, clearTimer: timers.clearTimer, eventTarget: new FakeElement() },
  });
  root.emit('pointerdown', { pointerId: 50, pointerType: 'touch', target: { closest: () => null } }); timers.advance(550);
  assert.deepEqual(activeQuote, { messageId: fixture.metadata.messageId, bubbleId: fixture.metadata.bubbleId, sender: fixture.expectedSender, text: '元数据正文' });
}
console.log('Press gesture behavior verified.');
