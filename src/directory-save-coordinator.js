const revisions = { histories: 0, groupMeta: 0 };
const queues = { histories: Promise.resolve(), groupMeta: Promise.resolve() };

function assertStore(store) {
    if (!Object.hasOwn(queues, store)) throw new Error(`未知目录存储：${store}`);
}

export function getDirectorySaveRevision() {
    return { ...revisions };
}

// Wait for any pending save on a store to settle (never rejects), so a cold-start
// reload does not overwrite in-memory data with stale storage while a save is in flight.
export function waitForDirectorySave(store) {
    assertStore(store);
    return queues[store].catch(() => {});
}

export function enqueueDirectorySave(store, data, operation, marksGlobalSave = false) {
    assertStore(store);
    if (typeof operation !== 'function') throw new TypeError('目录保存操作必须是函数');
    // Snapshot inside the queue's error channel: a non-serializable payload (undefined,
    // circular reference) must reject the returned promise, not throw synchronously and
    // bypass the caller's .catch.
    const pending = queues[store].catch(() => {}).then(async () => {
        const snapshot = JSON.parse(JSON.stringify(data));
        const result = await operation(snapshot);
        // Only bump the global revision after the save actually succeeds, so a failed
        // background save cannot make commitGeneratedDirectory falsely report a conflict.
        if (marksGlobalSave) revisions[store] += 1;
        return result;
    });
    queues[store] = pending;
    return pending;
}
