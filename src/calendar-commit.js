import { normalizeCycleStore } from './calendar-cycle-model.js';
import { normalizeHolidayCache } from './calendar-holiday.js';
import { calendarScopeFor, normalizeCalendarScope, normalizeCalendarStore } from './calendar-model.js';
import { normalizeOccasionScope, normalizeOccasionStore } from './calendar-occasion-model.js';
import { normalizeRecipeScope, normalizeRecipeStore } from './calendar-recipe-model.js';
import {
    saveCalendar, saveCalendarCycles, saveCalendarHolidays, saveCalendarOccasions, saveCalendarRecipes, saveCalendarWeather,
} from './calendar-storage.js';
import { normalizeWeatherStore } from './calendar-weather.js';

const clone = value => JSON.parse(JSON.stringify(value));

function injectionFailure(result, phase) {
    const failedWrites = Number.isInteger(result?.failedWrites) && result.failedWrites > 0 ? result.failedWrites : 0;
    const failedKeys = Array.isArray(result?.failedKeys) ? result.failedKeys : [];
    if (!failedWrites && !failedKeys.length) return null;
    const details = [
        failedWrites ? `${failedWrites} 项写入失败` : '',
        failedKeys.length ? `${failedKeys.length} 项清理失败` : '',
    ].filter(Boolean).join('，');
    const error = new Error(`日历${phase}注入失败：${details}`);
    error.injectionResult = result;
    return error;
}

export function createCalendarCommitters({
    runtime, tasks, applyBidirectionalInjection, getCycles, getCycleSubject,
}) {
    let scopeCommitQueue = Promise.resolve();
    let recipeCommitQueue = Promise.resolve();
    let commitGeneration = 0;
    const invalidateCommits = () => { commitGeneration += 1; };

    const commitScope = (storageId, mutate, task = null, { refreshInjection = true } = {}) => {
        const generation = commitGeneration;
        const operation = scopeCommitQueue.catch(() => {}).then(async () => {
            if (generation !== commitGeneration || (task && !tasks.active(task))) return false;
            const previousStore = clone(runtime.store);
            const candidate = clone(previousStore);
            const current = calendarScopeFor(candidate, storageId);
            const next = normalizeCalendarScope(await mutate(current));
            if (generation !== commitGeneration || (task && !tasks.active(task))) return false;
            candidate.scopes[storageId] = next;
            const normalized = normalizeCalendarStore(candidate);
            if (!saveCalendar(normalized)) throw new Error('日历保存失败：浏览器存储不可用');
            runtime.store = normalized;
            if (!refreshInjection) return next;

            let injectionError = null;
            try {
                const result = await applyBidirectionalInjection?.();
                injectionError = injectionFailure(result, '提交');
            } catch (error) {
                injectionError = error;
            }
            if (generation !== commitGeneration) {
                if (injectionError) throw injectionError;
                return false;
            }
            const cancelled = !!task && !tasks.active(task);
            if (!injectionError && !cancelled) return next;

            let rollbackError = null;
            try {
                if (!saveCalendar(previousStore)) throw new Error('日历回滚保存失败：浏览器存储不可用');
                runtime.store = normalizeCalendarStore(previousStore);
                const rollbackResult = await applyBidirectionalInjection?.();
                const rollbackInjectionError = injectionFailure(rollbackResult, '补偿');
                if (rollbackInjectionError) throw rollbackInjectionError;
            } catch (error) {
                rollbackError = error;
            }

            if (rollbackError) {
                const original = injectionError || new Error('日历任务取消后的状态补偿失败');
                const combined = new Error(`${original.message}；日历状态回滚失败：${rollbackError.message}`);
                combined.cause = original;
                combined.rollbackError = rollbackError;
                combined.calendarRollbackError = true;
                throw combined;
            }
            if (injectionError) throw injectionError;
            return false;
        });
        scopeCommitQueue = operation.catch(() => {});
        return operation;
    };

    const commitRecipe = (storageId, mutate, task = null, { refreshInjection = true } = {}) => {
        const generation = commitGeneration;
        const operation = recipeCommitQueue.catch(() => {}).then(async () => {
            if (generation !== commitGeneration || (task && !tasks.active(task))) return false;
            const previousStore = clone(runtime.recipeStore);
            const candidate = clone(previousStore);
            const current = normalizeRecipeScope(candidate.scopes[storageId]);
            const next = normalizeRecipeScope(await mutate(current));
            if (generation !== commitGeneration || (task && !tasks.active(task))) return false;
            candidate.scopes[storageId] = next;
            const normalized = normalizeRecipeStore(candidate);
            if (!saveCalendarRecipes(normalized)) throw new Error('菜谱保存失败：浏览器存储不可用');
            runtime.recipeStore = normalized;
            if (!refreshInjection) return next;

            let injectionError = null;
            try {
                const result = await applyBidirectionalInjection?.();
                injectionError = injectionFailure(result, '菜谱提交');
            } catch (error) {
                injectionError = error;
            }
            if (generation !== commitGeneration) {
                if (injectionError) throw injectionError;
                return false;
            }
            const cancelled = !!task && !tasks.active(task);
            if (!injectionError && !cancelled) return next;

            let rollbackError = null;
            try {
                if (!saveCalendarRecipes(previousStore)) throw new Error('菜谱回滚保存失败：浏览器存储不可用');
                runtime.recipeStore = normalizeRecipeStore(previousStore);
                const rollbackResult = await applyBidirectionalInjection?.();
                const rollbackInjectionError = injectionFailure(rollbackResult, '菜谱补偿');
                if (rollbackInjectionError) throw rollbackInjectionError;
            } catch (error) {
                rollbackError = error;
            }
            if (rollbackError) {
                const original = injectionError || new Error('菜谱任务取消后的状态补偿失败');
                const combined = new Error(`${original.message}；菜谱状态回滚失败：${rollbackError.message}`);
                combined.cause = original;
                combined.rollbackError = rollbackError;
                combined.recipeRollbackError = true;
                throw combined;
            }
            if (injectionError) throw injectionError;
            return false;
        });
        recipeCommitQueue = operation.catch(() => {});
        return operation;
    };

    const commitOccasions = async (storageId, mutate) => {
        const candidate = clone(runtime.occasionStore);
        const current = normalizeOccasionScope(candidate.scopes[storageId]);
        const next = normalizeOccasionScope(await mutate(current));
        candidate.scopes[storageId] = next;
        const normalized = normalizeOccasionStore(candidate);
        if (!saveCalendarOccasions(normalized)) throw new Error('生日与纪念日保存失败：浏览器存储不可用');
        runtime.occasionStore = normalized;
        await applyBidirectionalInjection?.();
        return next;
    };

    const commitHolidays = nextStore => {
        const normalized = normalizeHolidayCache(nextStore);
        if (!saveCalendarHolidays(normalized)) throw new Error('节假日缓存保存失败：浏览器存储不可用');
        runtime.holidayStore = normalized;
        return normalized;
    };

    const commitWeather = nextStore => {
        const normalized = normalizeWeatherStore(nextStore);
        if (!saveCalendarWeather(normalized)) throw new Error('天气数据保存失败：浏览器存储不可用');
        runtime.weatherStore = normalized;
        return normalized;
    };

    const commitCycle = (storageId, nextStore) => {
        const normalized = normalizeCycleStore(nextStore);
        if (!saveCalendarCycles(normalized)) throw new Error('生理周期数据保存失败：浏览器存储不可用');
        runtime.cycleStore = normalized;
        return getCycles(storageId, getCycleSubject(storageId));
    };

    return { commitScope, commitRecipe, commitOccasions, commitHolidays, commitWeather, commitCycle, invalidateCommits };
}
