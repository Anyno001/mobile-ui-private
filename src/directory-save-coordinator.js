const revisions = { histories: 0, groupMeta: 0 };
const queues = {
    histories: Promise.resolve(), groupMeta: Promise.resolve(), interactive: Promise.resolve(), backgrounds: Promise.resolve(),
    phoneUi: Promise.resolve(), calendar: Promise.resolve(), occasions: Promise.resolve(), schedule: Promise.resolve(), cycles: Promise.resolve(), recipes: Promise.resolve(),
    outfits: Promise.resolve(),
    pokeConfig: Promise.resolve(), characterBehavior: Promise.resolve(), bidirectional: Promise.resolve(), budget: Promise.resolve(),
};
const branchScopeEvents = new Map();
let nextBranchScopeToken = 0;

function assertStore(store) {
    if (!Object.hasOwn(queues, store)) throw new Error(`未知目录存储：${store}`);
}

export function getDirectorySaveRevision() {
    return { ...revisions };
}

export function enqueueDirectoryOperation(store, operation) {
    assertStore(store);
    if (typeof operation !== 'function') throw new TypeError('目录存储操作必须是函数');
    const pending = queues[store].catch(() => {}).then(operation);
    queues[store] = pending;
    return pending;
}

function branchScopes(store) {
    if (!branchScopeEvents.has(store)) {
        branchScopeEvents.set(store, { active: new Map(), events: [], offset: 0, pendingSaveVersions: new Set() });
    }
    return branchScopeEvents.get(store);
}

export function getDirectoryOperationVersion(store) {
    assertStore(store);
    const state = branchScopes(store);
    return state.offset + state.events.length;
}

export function markDirectoryBranchScope(store, targetId) {
    assertStore(store);
    if (typeof targetId !== 'string' || !targetId) throw new TypeError('分支 scope 必须是非空字符串');
    const state = branchScopes(store);
    const token = `${store}:${++nextBranchScopeToken}`;
    state.active.set(token, targetId);
    state.events.push(targetId);
    return token;
}

export function getActiveDirectoryBranchScopes(store) {
    assertStore(store);
    return [...new Set(branchScopes(store).active.values())];
}

function compactBranchScopeEvents(store) {
    const state = branchScopes(store);
    const earliestVersion = state.pendingSaveVersions.size
        ? Math.min(...state.pendingSaveVersions)
        : state.offset + state.events.length;
    const discarded = Math.max(0, Math.min(state.events.length, earliestVersion - state.offset));
    if (discarded) {
        state.events.splice(0, discarded);
        state.offset += discarded;
    }
}

export function completeDirectoryBranchScope(store, token) {
    assertStore(store);
    if (typeof token !== 'string' || !token) throw new TypeError('分支 scope 必须是非空字符串');
    const state = branchScopes(store);
    if (!state.active.delete(token)) throw new Error('分支 scope 完成令牌无效');
    compactBranchScopeEvents(store);
}

export function getDirectoryBranchScopesSince(store, version) {
    assertStore(store);
    const state = branchScopes(store);
    if (!Number.isInteger(version) || version < 0) throw new TypeError('目录操作版本必须是非负整数');
    return [...new Set(state.events.slice(Math.max(0, version - state.offset)))];
}

export function enqueueDirectorySave(store, data, operation, marksGlobalSave = false) {
    assertStore(store);
    if (typeof operation !== 'function') throw new TypeError('目录保存操作必须是函数');
    if (marksGlobalSave) revisions[store] += 1;
    const version = getDirectoryOperationVersion(store);
    const state = branchScopes(store);
    state.pendingSaveVersions.add(version);
    const snapshot = structuredClone(data);
    return enqueueDirectoryOperation(store, () => operation(snapshot, getDirectoryBranchScopesSince(store, version))).finally(() => {
        state.pendingSaveVersions.delete(version);
        compactBranchScopeEvents(store);
    });
}
