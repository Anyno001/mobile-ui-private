import { normalizeCycleStore } from './calendar-cycle-model.js';
import { normalizeHolidayCache } from './calendar-holiday.js';
import { calendarScopeFor, normalizeCalendarScope, normalizeCalendarStore } from './calendar-model.js';
import { normalizeOccasionScope, normalizeOccasionStore } from './calendar-occasion-model.js';
import { normalizeOutfitStore } from './calendar-outfit-model.js';
import { normalizeRecipeScope, normalizeRecipeStore } from './calendar-recipe-model.js';
import {
    loadCalendar, loadCalendarCycles, loadCalendarOccasions, loadCalendarOutfits, loadCalendarRecipes,
    saveCalendar, saveCalendarCycles, saveCalendarHolidays, saveCalendarOccasions, saveCalendarOutfits, saveCalendarRecipes, saveCalendarWeather,
} from './calendar-storage.js';
import { enqueueDirectoryOperation } from './directory-save-coordinator.js';
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
    let commitGeneration = 0;
    const invalidateCommits = () => { commitGeneration += 1; };

    const commitScope = (storageId, mutate, task = null, { refreshInjection = true } = {}) => {
        const generation = commitGeneration;
        return enqueueDirectoryOperation('schedule', async () => {
            if (generation !== commitGeneration || (task && !tasks.active(task))) return false;
            const previousStore = clone(loadCalendar());
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
            const cancelled = generation !== commitGeneration || (!!task && !tasks.active(task));
            if (!injectionError && !cancelled) return next;

            let rollbackError = null;
            try {
                const rollbackStore = clone(loadCalendar());
                if (Object.hasOwn(previousStore.scopes, storageId)) rollbackStore.scopes[storageId] = clone(previousStore.scopes[storageId]);
                else delete rollbackStore.scopes[storageId];
                if (!saveCalendar(rollbackStore)) throw new Error('日历回滚保存失败：浏览器存储不可用');
                runtime.store = normalizeCalendarStore(rollbackStore);
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
    };

    const commitStore = (mutate, task = null, { refreshInjection = true } = {}) => {
        const generation = commitGeneration;
        return enqueueDirectoryOperation('schedule', async () => {
            if (generation !== commitGeneration || (task && !tasks.active(task))) return false;
            const previousStore = clone(loadCalendar());
            const normalized = normalizeCalendarStore(await mutate(clone(previousStore)));
            if (generation !== commitGeneration || (task && !tasks.active(task))) return false;
            if (!saveCalendar(normalized)) throw new Error('日历保存失败：浏览器存储不可用');
            runtime.store = normalized;
            if (!refreshInjection) return normalized;

            let injectionError = null;
            try {
                const result = await applyBidirectionalInjection?.();
                injectionError = injectionFailure(result, '提交');
            } catch (error) {
                injectionError = error;
            }
            const cancelled = generation !== commitGeneration || (!!task && !tasks.active(task));
            if (!injectionError && !cancelled) return normalized;

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
    };

    const commitRecipe = (storageId, mutate, task = null, { refreshInjection = true } = {}) => {
        const generation = commitGeneration;
        return enqueueDirectoryOperation('recipes', async () => {
            if (generation !== commitGeneration || (task && !tasks.active(task))) return false;
            const previousStore = clone(loadCalendarRecipes());
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
                const rollbackStore = clone(loadCalendarRecipes());
                if (Object.hasOwn(previousStore.scopes, storageId)) rollbackStore.scopes[storageId] = clone(previousStore.scopes[storageId]);
                else delete rollbackStore.scopes[storageId];
                if (!saveCalendarRecipes(rollbackStore)) throw new Error('菜谱回滚保存失败：浏览器存储不可用');
                runtime.recipeStore = normalizeRecipeStore(rollbackStore);
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
    };

    const commitOutfits = (storageId, mutate, task = null, { refreshInjection = true } = {}) => {
        const generation = commitGeneration;
        return enqueueDirectoryOperation('outfits', async () => {
            if (generation !== commitGeneration || (task && !tasks.active(task))) return false;
            const previousStore = clone(loadCalendarOutfits());
            const candidate = clone(previousStore);
            const next = normalizeOutfitStore(await mutate(candidate));
            if (generation !== commitGeneration || (task && !tasks.active(task))) return false;
            if (!saveCalendarOutfits(next)) throw new Error('穿搭保存失败：浏览器存储不可用');
            runtime.outfitStore = next;
            if (!refreshInjection) return next;
            let injectionError = null;
            try {
                const result = await applyBidirectionalInjection?.();
                injectionError = injectionFailure(result, '穿搭提交');
            } catch (error) { injectionError = error; }
            if (generation !== commitGeneration) {
                if (injectionError) throw injectionError;
                return false;
            }
            const cancelled = !!task && !tasks.active(task);
            if (!injectionError && !cancelled) return next;
            let rollbackError = null;
            try {
                if (!saveCalendarOutfits(previousStore)) throw new Error('穿搭回滚保存失败：浏览器存储不可用');
                runtime.outfitStore = normalizeOutfitStore(previousStore);
                const rollbackResult = await applyBidirectionalInjection?.();
                const rollbackInjectionError = injectionFailure(rollbackResult, '穿搭补偿');
                if (rollbackInjectionError) throw rollbackInjectionError;
            } catch (error) { rollbackError = error; }
            if (rollbackError) {
                const original = injectionError || new Error('穿搭任务取消后的状态补偿失败');
                const combined = new Error(`${original.message}；穿搭状态回滚失败：${rollbackError.message}`);
                combined.cause = original; combined.rollbackError = rollbackError; combined.outfitRollbackError = true;
                throw combined;
            }
            if (injectionError) throw injectionError;
            return false;
        });
    };

    const commitOccasions = (storageId, mutate) => enqueueDirectoryOperation('schedule', async () => {
        const previousStore = clone(loadCalendarOccasions());
        const candidate = clone(previousStore);
        const current = normalizeOccasionScope(candidate.scopes[storageId]);
        const next = normalizeOccasionScope(await mutate(current));
        candidate.scopes[storageId] = next;
        const normalized = normalizeOccasionStore(candidate);
        try {
            if (!saveCalendarOccasions(normalized)) throw new Error('生日与纪念日保存失败：浏览器存储不可用');
            runtime.occasionStore = normalized;
            const result = await applyBidirectionalInjection?.();
            const injectionError = injectionFailure(result, '生日与纪念日提交');
            if (!injectionError) return next;
            throw injectionError;
        } catch (error) {
            if (!saveCalendarOccasions(previousStore)) {
                const rollbackError = new Error('生日与纪念日回滚失败：浏览器存储不可用');
                const combined = new Error(`${error.message}；${rollbackError.message}`);
                combined.cause = error;
                combined.rollbackError = rollbackError;
                combined.occasionRolledBack = false;
                combined.occasionRollbackError = true;
                throw combined;
            }
            runtime.occasionStore = normalizeOccasionStore(previousStore);
            try {
                const rollbackResult = await applyBidirectionalInjection?.();
                const rollbackError = injectionFailure(rollbackResult, '生日与纪念日补偿');
                if (rollbackError) throw rollbackError;
            } catch (rollbackError) {
                const combined = new Error(`${error.message}；生日与纪念日回滚注入失败：${rollbackError.message}`);
                combined.cause = error;
                combined.rollbackError = rollbackError;
                combined.occasionRolledBack = true;
                combined.occasionRollbackError = true;
                throw combined;
            }
            throw error;
        }
    });

    const commitSchedule = (storageId, mutate) => enqueueDirectoryOperation('schedule', async () => {
        const previousCalendarStore = clone(loadCalendar());
        const previousOccasionStore = clone(loadCalendarOccasions());
        const calendarCandidate = clone(previousCalendarStore);
        const occasionCandidate = clone(previousOccasionStore);
        const current = {
            calendar: calendarScopeFor(calendarCandidate, storageId),
            occasions: normalizeOccasionScope(occasionCandidate.scopes[storageId]),
        };
        const result = await mutate(current);
        calendarCandidate.scopes[storageId] = normalizeCalendarScope(result.calendar);
        occasionCandidate.scopes[storageId] = normalizeOccasionScope(result.occasions);
        const calendar = normalizeCalendarStore(calendarCandidate);
        const occasionStore = normalizeOccasionStore(occasionCandidate);
        try {
            if (!saveCalendar(calendar)) throw new Error('日历保存失败：浏览器存储不可用');
            if (!saveCalendarOccasions(occasionStore)) throw new Error('生日与纪念日保存失败：浏览器存储不可用');
            runtime.store = calendar;
            runtime.occasionStore = occasionStore;
            const injectionResult = await applyBidirectionalInjection?.();
            const error = injectionFailure(injectionResult, '日程提交');
            if (!error) return { calendar: calendarCandidate.scopes[storageId], occasions: occasionCandidate.scopes[storageId] };
            throw error;
        } catch (error) {
            const calendarRolledBack = saveCalendar(previousCalendarStore);
            const occasionsRolledBack = saveCalendarOccasions(previousOccasionStore);
            if (!calendarRolledBack || !occasionsRolledBack) {
                runtime.store = normalizeCalendarStore(loadCalendar());
                runtime.occasionStore = normalizeOccasionStore(loadCalendarOccasions());
                const rollbackError = new Error('日程转换回滚失败：浏览器存储不可用');
                const combined = new Error(`${error.message}；${rollbackError.message}`);
                combined.cause = error;
                combined.calendarRolledBack = calendarRolledBack;
                combined.occasionsRolledBack = occasionsRolledBack;
                combined.rollbackError = rollbackError;
                combined.scheduleRollbackError = true;
                throw combined;
            }
            runtime.store = normalizeCalendarStore(previousCalendarStore);
            runtime.occasionStore = normalizeOccasionStore(previousOccasionStore);
            try {
                const rollbackResult = await applyBidirectionalInjection?.();
                const rollbackError = injectionFailure(rollbackResult, '日程转换补偿');
                if (rollbackError) throw rollbackError;
            } catch (rollbackError) {
                const combined = new Error(`${error.message}；日程转换回滚注入失败：${rollbackError.message}`);
                combined.cause = error;
                combined.rollbackError = rollbackError;
                combined.calendarRolledBack = true;
                combined.occasionsRolledBack = true;
                combined.scheduleRollbackError = true;
                throw combined;
            }
            throw error;
        }
    });

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

    const commitCycle = (storageId, mutate) => enqueueDirectoryOperation('cycles', async () => {
        const current = normalizeCycleStore(loadCalendarCycles());
        const normalized = normalizeCycleStore(await mutate(current));
        if (!saveCalendarCycles(normalized)) throw new Error('生理周期数据保存失败：浏览器存储不可用');
        runtime.cycleStore = normalized;
        return getCycles(storageId, getCycleSubject(storageId));
    });

    return { commitScope, commitStore, commitRecipe, commitOutfits, commitOccasions, commitSchedule, commitHolidays, commitWeather, commitCycle, invalidateCommits };
}
