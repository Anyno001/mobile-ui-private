const revisions = { histories: 0, groupMeta: 0 };
const queues = { histories: Promise.resolve(), groupMeta: Promise.resolve() };

function assertStore(store) {
    if (!Object.hasOwn(queues, store)) throw new Error(`未知目录存储：${store}`);
}

export function getDirectorySaveRevision() {
    return { ...revisions };
}

export function enqueueDirectorySave(store, data, operation, marksGlobalSave = false) {
    assertStore(store);
    if (typeof operation !== 'function') throw new TypeError('目录保存操作必须是函数');
    if (marksGlobalSave) revisions[store] += 1;
    const snapshot = JSON.parse(JSON.stringify(data));
    const pending = queues[store].catch(() => {}).then(() => operation(snapshot));
    queues[store] = pending;
    return pending;
}
