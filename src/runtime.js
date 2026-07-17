export function createRuntimeState() {
    return {
        modelList: [],
        eventHooked: false,
        firstOpen: true,
        lastChatLength: 0,
        historyLoadPromise: null,
        visibilityTimer: null,
        autoPokeArmed: false,
        automaticEpoch: 0,
        automaticSequence: 0,
        automaticTasks: new Map(),
        pendingMessages: new Map(),
        pendingSequence: 0,
        overlayOpener: null,
        trackedExtensionPromptKeys: new Set(),
        injectionEpoch: 0,
    };
}

export function createAutomaticTaskController({ runtime, state, getStorageId, isDocumentVisible }) {
    const isAllowed = () => state.phoneActive
        && !state.isMinimized
        && runtime.autoPokeArmed
        && isDocumentVisible();

    const arm = () => {
        if (!state.phoneActive || state.isMinimized || !isDocumentVisible()) return false;
        runtime.automaticEpoch += 1;
        runtime.automaticTasks.clear();
        runtime.autoPokeArmed = true;
        return true;
    };

    const disarm = (reason = 'automatic-task-disarmed') => {
        runtime.autoPokeArmed = false;
        runtime.automaticEpoch += 1;
        runtime.automaticTasks.clear();
        return reason;
    };

    const begin = (storageId, contactName) => {
        if (!isAllowed() || !storageId || !contactName || getStorageId() !== storageId) return null;
        const taskKey = `${storageId}\u0000${contactName}`;
        if (runtime.automaticTasks.has(taskKey)) return null;
        const task = Object.freeze({
            id: ++runtime.automaticSequence,
            epoch: runtime.automaticEpoch,
            storageId,
            contactName,
            taskKey,
        });
        runtime.automaticTasks.set(taskKey, task);
        return task;
    };

    const isActive = task => !!task
        && runtime.automaticTasks.get(task.taskKey) === task
        && runtime.automaticEpoch === task.epoch
        && getStorageId() === task.storageId
        && isAllowed();

    const finish = task => {
        if (!task || runtime.automaticTasks.get(task.taskKey) !== task) return false;
        runtime.automaticTasks.delete(task.taskKey);
        return true;
    };

    return { isAllowed, arm, disarm, begin, isActive, finish };
}

export function advanceAutoPokeCounters(configs, persist) {
    const snapshots = [];
    const toPoke = [];
    for (const [contactName, config] of Object.entries(configs || {})) {
        if (!config?.autoPoke?.enabled) continue;
        const interval = Math.max(1, Number(config.autoPoke.interval) || 1);
        const previousCounter = Math.max(0, Number(config.autoPoke.counter) || 0);
        snapshots.push({ autoPoke: config.autoPoke, previousCounter });
        config.autoPoke.counter = Math.min(previousCounter + 1, interval);
        if (config.autoPoke.counter >= interval) toPoke.push(contactName);
    }
    if (!snapshots.length) return { updated: false, toPoke: [] };
    if (persist()) return { updated: true, toPoke };
    for (const snapshot of snapshots) snapshot.autoPoke.counter = snapshot.previousCounter;
    return { updated: false, toPoke: [] };
}

export async function runAutoPokeCounterCycle({
    configs,
    persist,
    isAllowed,
    run,
    onUpdated,
}) {
    if (!isAllowed()) return false;
    const { updated, toPoke } = advanceAutoPokeCounters(configs, persist);
    if (!updated) return false;
    onUpdated?.();
    for (const contactName of toPoke) {
        if (!isAllowed()) break;
        await run(contactName);
    }
    return true;
}

async function runCompensations(steps) {
    const errors = [];
    for (const step of steps) {
        try {
            await step();
        } catch (error) {
            errors.push(error);
        }
    }
    return errors;
}

export async function commitAutomaticResult({
    isActive,
    applyHistory,
    restoreHistory,
    persistHistory,
    applyCounter,
    restoreCounter,
    persistCounter,
}) {
    if (!isActive()) return false;
    applyHistory();
    try {
        await persistHistory();
    } catch (error) {
        restoreHistory();
        throw error;
    }

    if (!isActive()) {
        restoreHistory();
        const rollbackErrors = await runCompensations([persistHistory]);
        if (rollbackErrors.length) {
            throw new AggregateError(rollbackErrors, '自动消息任务失效，历史补偿失败');
        }
        return false;
    }

    applyCounter();
    if (!persistCounter()) {
        restoreCounter();
        restoreHistory();
        const rollbackErrors = await runCompensations([persistHistory]);
        if (rollbackErrors.length) {
            throw new AggregateError(rollbackErrors, '自动消息计数保存失败，历史补偿也失败');
        }
        throw new Error('自动消息计数保存失败');
    }

    if (!isActive()) {
        restoreCounter();
        restoreHistory();
        const rollbackErrors = await runCompensations([
            async () => {
                if (!persistCounter()) throw new Error('自动消息计数补偿失败');
            },
            persistHistory,
        ]);
        if (rollbackErrors.length) {
            throw new AggregateError(rollbackErrors, '自动消息任务失效，提交补偿失败');
        }
        return false;
    }
    return true;
}
