import assert from 'node:assert/strict';
import { createAmbientStatusController } from '../src/phone-lifecycle.js';

function createTimers() {
    let nextId = 1;
    const tasks = new Map();
    return {
        setTimer(fn, delay) {
            assert.equal(delay, 30000);
            const id = nextId++;
            tasks.set(id, fn);
            return id;
        },
        clearTimer(id) { tasks.delete(id); },
        runAll() { for (const fn of [...tasks.values()]) fn(); },
        get size() { return tasks.size; },
    };
}

function createHarness({ persistResult = true, throwOnPersist = false } = {}) {
    const theme = { ambientStatusEnabled: false };
    const clock = { textContent: '' };
    const bar = { hidden: true, querySelector: selector => selector === '.pm-status-time' ? clock : null };
    const timers = createTimers();
    let suspended = false;
    let formatted = 0;
    const controller = createAmbientStatusController({
        getTheme: () => theme,
        persistTheme: () => {
            if (throwOnPersist) throw new Error('quota');
            return persistResult;
        },
        getBar: () => bar,
        isSuspended: () => suspended,
        setTimer: timers.setTimer,
        clearTimer: timers.clearTimer,
        formatTime: () => `12:${String(formatted++).padStart(2, '0')}`,
        now: () => new Date(0),
    });
    return { bar, clock, controller, theme, timers, setSuspended: value => { suspended = value; } };
}

{
    const h = createHarness();
    assert.equal(h.controller.sync(), false);
    assert.equal(h.bar.hidden, true);
    assert.equal(h.timers.size, 0);
    assert.equal(h.controller.setEnabled(true), true);
    assert.equal(h.controller.sync(), true);
    assert.equal(h.bar.hidden, false);
    assert.equal(h.clock.textContent, '12:00');
    assert.equal(h.timers.size, 1);
    assert.equal(h.controller.sync(), true);
    assert.equal(h.timers.size, 1);
    h.timers.runAll();
    assert.equal(h.clock.textContent, '12:02');
    h.setSuspended(true);
    assert.equal(h.controller.sync(), false);
    assert.equal(h.timers.size, 0);
    assert.equal(h.bar.hidden, false);
    h.setSuspended(false);
    assert.equal(h.controller.sync(), true);
    assert.equal(h.timers.size, 1);
    h.controller.stop();
    assert.equal(h.timers.size, 0);
    assert.equal(h.controller.setEnabled(false), true);
    assert.equal(h.controller.sync(), false);
    assert.equal(h.bar.hidden, true);
}

for (const options of [{ persistResult: false }, { throwOnPersist: true }]) {
    const h = createHarness(options);
    assert.equal(h.controller.setEnabled(true), false);
    assert.equal(h.theme.ambientStatusEnabled, false);
    assert.equal(h.controller.sync(), false);
    assert.equal(h.timers.size, 0);
}

{
    const h = createHarness();
    h.theme.ambientStatusEnabled = true;
    const controller = createAmbientStatusController({
        getTheme: () => h.theme,
        persistTheme: () => true,
        getBar: () => null,
        setTimer: h.timers.setTimer,
        clearTimer: h.timers.clearTimer,
    });
    assert.equal(controller.sync(), false);
    assert.equal(h.timers.size, 0);
}

console.log('Ambient status lifecycle verified.');
