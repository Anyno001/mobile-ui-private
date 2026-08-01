import { enqueueDirectoryOperation } from './directory-save-coordinator.js';
import { loadTodayTrendStore, saveTodayTrendStore } from './today-trend-storage.js';
import { normalizeTodayTrendStore } from './today-trend-model.js';

const clone = value => structuredClone(value);

function injectionFailure(result) {
    if (!result) return null;
    const failedWrites = Number.isInteger(result.failedWrites) ? result.failedWrites : 0;
    const failedKeys = Array.isArray(result.failedKeys) ? result.failedKeys.length : 0;
    return failedWrites || failedKeys ? new Error(`今日风向注入刷新失败：${failedWrites + failedKeys} 项写入或清理失败`) : null;
}

export function createTodayTrendCommitter({
    runtime = {}, load = loadTodayTrendStore, save = saveTodayTrendStore, refreshInjection,
} = {}) {
    let generation = 0;
    const active = task => !task || task.active?.() !== false;
    const invalidateCommits = () => { generation += 1; };

    const commitStore = (mutate, task = null, { refresh = true } = {}) => {
        if (typeof mutate !== 'function') throw new TypeError('今日风向提交变更必须是函数');
        const expectedGeneration = generation;
        return enqueueDirectoryOperation('todayTrend', async () => {
            if (expectedGeneration !== generation || !active(task)) return false;
            const previous = normalizeTodayTrendStore(await load());
            const candidate = normalizeTodayTrendStore(await mutate(clone(previous)));
            if (expectedGeneration !== generation || !active(task)) return false;
            await save(candidate);
            runtime.store = candidate;
            if (!refresh) return candidate;
            let refreshError = null;
            try { refreshError = injectionFailure(await refreshInjection?.(candidate)); }
            catch (error) { refreshError = error; }
            if (!refreshError && expectedGeneration === generation && active(task)) return candidate;
            try {
                await save(previous);
                runtime.store = previous;
                const rollbackError = injectionFailure(await refreshInjection?.(previous));
                if (rollbackError) throw rollbackError;
            } catch (rollbackError) {
                const original = refreshError || new Error('今日风向提交在任务取消后需要回滚');
                const combined = new Error(`${original.message}；今日风向状态回滚失败：${rollbackError.message}`);
                combined.cause = original;
                combined.rollbackError = rollbackError;
                throw combined;
            }
            if (refreshError) throw refreshError;
            return false;
        });
    };

    const commitScope = (storageId, mutate, task = null, options) => commitStore(async store => {
        if (typeof storageId !== 'string' || !storageId) throw new TypeError('今日风向角色资料 ID 必须是非空字符串');
        const scope = await mutate(clone(store.scopes[storageId]));
        if (scope === null) delete store.scopes[storageId];
        else store.scopes[storageId] = scope;
        return store;
    }, task, options);

    return { commitStore, commitScope, invalidateCommits };
}
