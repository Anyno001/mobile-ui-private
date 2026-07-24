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

function resolveAutoPokeProbability(autoPoke) {
    if (autoPoke.probability != null) return Math.max(0, Math.min(100, Number(autoPoke.probability) || 0));
    const interval = Number.parseInt(autoPoke.interval, 10);
    const probability = Number.isFinite(interval) && interval > 0 ? Math.round(100 / interval) : 30;
    autoPoke.probability = Math.max(0, Math.min(100, probability));
    autoPoke.counter = 0;
    delete autoPoke.interval;
    return autoPoke.probability;
}

// 按百分比概率独立投骰子决定每个启用了的会话本轮是否主动发消息。
// rng 默认 Math.random；测试可注入确定性随机源。
// counter 现在是 0/1 抽签旗标：抽中置 1；下一次投骰遇到上一轮抽中但还没提交完成的会直接进入执行队列、不重复投骰。
export function advanceAutoPokeCounters(configs, persist, rng = Math.random) {
    const snapshots = [];
    const toPoke = [];
    for (const [contactName, config] of Object.entries(configs || {})) {
        if (!config?.autoPoke?.enabled) continue;
        const autoPoke = config.autoPoke;
        const snapshot = {
            autoPoke,
            previousCounter: autoPoke.counter,
            previousProbability: autoPoke.probability,
            hadProbability: Object.prototype.hasOwnProperty.call(autoPoke, 'probability'),
            previousInterval: autoPoke.interval,
            hadInterval: Object.prototype.hasOwnProperty.call(autoPoke, 'interval'),
        };
        const probability = resolveAutoPokeProbability(autoPoke);
        const previousCounter = autoPoke.counter === 1 ? 1 : 0;
        snapshots.push(snapshot);
        if (previousCounter === 1) {
            // 沿用上一轮的抽签结果，避免重投导致重复触发；成功后 applyCounter 会清掉旗标
            toPoke.push(contactName);
            continue;
        }
        const roll = Math.max(0, Math.min(99.9999, (typeof rng === 'function' ? rng() : Math.random()) * 100));
        if (roll < probability) {
            autoPoke.counter = 1;
            toPoke.push(contactName);
        }
    }
    if (!snapshots.length) return { updated: false, toPoke: [] };
    if (persist()) return { updated: true, toPoke };
    for (const snapshot of snapshots) {
        snapshot.autoPoke.counter = snapshot.previousCounter;
        if (snapshot.hadProbability) snapshot.autoPoke.probability = snapshot.previousProbability;
        else delete snapshot.autoPoke.probability;
        if (snapshot.hadInterval) snapshot.autoPoke.interval = snapshot.previousInterval;
        else delete snapshot.autoPoke.interval;
    }
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
