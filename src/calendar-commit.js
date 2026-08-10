import { normalizeCycleStore } from './calendar-cycle-model.js';
import { normalizeHolidayCache } from './calendar-holiday.js';
import { calendarScopeFor, normalizeCalendarScope, normalizeCalendarStore } from './calendar-model.js';
import { normalizeOccasionScope, normalizeOccasionStore } from './calendar-occasion-model.js';
import { normalizeOutfitScope, normalizeOutfitStore } from './calendar-outfit-model.js';
import { normalizeRecipeScope, normalizeRecipeStore } from './calendar-recipe-model.js';
import {
    loadCalendar, loadCalendarCycles, loadCalendarOccasions, loadCalendarOutfits, loadCalendarRecipes,
    saveCalendar, saveCalendarCycles, saveCalendarHolidays, saveCalendarOccasions, saveCalendarOutfits, saveCalendarRecipes, saveCalendarWeather,
} from './calendar-storage.js';
import { enqueueDirectoryOperation } from './directory-save-coordinator.js';
import { normalizeWeatherStore } from './calendar-weather.js';

const clone = value => JSON.parse(JSON.stringify(value));

const replaceScope = (store, storageId, scope, normalizeStore) => {
    const normalized = normalizeStore({ version: store.version, scopes: { [storageId]: scope } });
    if (!Object.hasOwn(normalized.scopes, storageId)) return store;
    return {
        ...store,
        scopes: { ...store.scopes, [storageId]: normalized.scopes[storageId] },
    };
};

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
            const previousStore = loadCalendar();
            const current = calendarScopeFor({ ...previousStore, scopes: { [storageId]: previousStore.scopes[storageId] } }, storageId);
            const next = normalizeCalendarScope(await mutate(current));
            if (generation !== commitGeneration || (task && !tasks.active(task))) return false;
            const candidate = replaceScope(previousStore, storageId, next, normalizeCalendarStore);
            if (!saveCalendar(candidate)) throw new Error('日历保存失败：浏览器存储不可用');
            runtime.store = candidate;
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
                const currentStore = loadCalendar();
                const rollbackScopes = { ...currentStore.scopes };
                if (Object.hasOwn(previousStore.scopes, storageId)) rollbackScopes[storageId] = previousStore.scopes[storageId];
                else delete rollbackScopes[storageId];
                const rollbackStore = { ...currentStore, scopes: rollbackScopes };
                if (!saveCalendar(rollbackStore)) throw new Error('日历回滚保存失败：浏览器存储不可用');
                runtime.store = rollbackStore;
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
            if (generation !== commitGeneration) {
                if (injectionError) throw injectionError;
                return false;
            }
            const cancelled = !!task && !tasks.active(task);
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
            const previousStore = loadCalendarRecipes();
            const current = normalizeRecipeScope(previousStore.scopes[storageId]);
            const next = normalizeRecipeScope(await mutate(current));
            if (generation !== commitGeneration || (task && !tasks.active(task))) return false;
            const candidate = replaceScope(previousStore, storageId, next, normalizeRecipeStore);
            if (!saveCalendarRecipes(candidate)) throw new Error('菜谱保存失败：浏览器存储不可用');
            runtime.recipeStore = candidate;
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
                const currentStore = loadCalendarRecipes();
                const rollbackScopes = { ...currentStore.scopes };
                if (Object.hasOwn(previousStore.scopes, storageId)) rollbackScopes[storageId] = previousStore.scopes[storageId];
                else delete rollbackScopes[storageId];
                const rollbackStore = { ...currentStore, scopes: rollbackScopes };
                if (!saveCalendarRecipes(rollbackStore)) throw new Error('菜谱回滚保存失败：浏览器存储不可用');
                runtime.recipeStore = rollbackStore;
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
            const previousStore = loadCalendarOutfits();
            const targetStore = {
                ...previousStore,
                scopes: { [storageId]: normalizeOutfitScope(previousStore.scopes[storageId]) },
            };
            const nextScope = normalizeOutfitStore(await mutate(targetStore)).scopes[storageId] || normalizeOutfitScope();
            if (generation !== commitGeneration || (task && !tasks.active(task))) return false;
            const candidate = replaceScope(previousStore, storageId, nextScope, normalizeOutfitStore);
            if (!saveCalendarOutfits(candidate)) throw new Error('穿搭保存失败：浏览器存储不可用');
            runtime.outfitStore = candidate;
            if (!refreshInjection) return candidate;
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
            if (!injectionError && !cancelled) return candidate;
            let rollbackError = null;
            try {
                const currentStore = loadCalendarOutfits();
                const rollbackScopes = { ...currentStore.scopes };
                if (Object.hasOwn(previousStore.scopes, storageId)) rollbackScopes[storageId] = previousStore.scopes[storageId];
                else delete rollbackScopes[storageId];
                const rollbackStore = { ...currentStore, scopes: rollbackScopes };
                if (!saveCalendarOutfits(rollbackStore)) throw new Error('穿搭回滚保存失败：浏览器存储不可用');
                runtime.outfitStore = rollbackStore;
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

    const commitOccasions = (storageId, mutate) => {
        const generation = commitGeneration;
        return enqueueDirectoryOperation('schedule', async () => {
            if (generation !== commitGeneration) return false;
            const previousStore = loadCalendarOccasions();
            const current = normalizeOccasionScope(previousStore.scopes[storageId]);
            const next = normalizeOccasionScope(await mutate(current));
            if (generation !== commitGeneration) return false;
            const candidate = replaceScope(previousStore, storageId, next, normalizeOccasionStore);
            try {
                if (!saveCalendarOccasions(candidate)) throw new Error('生日与纪念日保存失败：浏览器存储不可用');
                runtime.occasionStore = candidate;
                const result = await applyBidirectionalInjection?.();
                const injectionError = injectionFailure(result, '生日与纪念日提交');
                if (generation !== commitGeneration && !injectionError) return false;
                if (!injectionError) return next;
                throw injectionError;
            } catch (error) {
                if (generation !== commitGeneration) throw error;
                if (!saveCalendarOccasions(previousStore)) {
                    const rollbackError = new Error('生日与纪念日回滚失败：浏览器存储不可用');
                    const combined = new Error(`${error.message}；${rollbackError.message}`);
                    combined.cause = error;
                    combined.rollbackError = rollbackError;
                    combined.occasionRolledBack = false;
                    combined.occasionRollbackError = true;
                    throw combined;
                }
                runtime.occasionStore = previousStore;
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
    };

    const commitSchedule = (storageId, mutate) => {
        const generation = commitGeneration;
        return enqueueDirectoryOperation('schedule', async () => {
            if (generation !== commitGeneration) return false;
            const previousCalendarStore = loadCalendar();
            const previousOccasionStore = loadCalendarOccasions();
            const current = {
                calendar: calendarScopeFor({ ...previousCalendarStore, scopes: { [storageId]: previousCalendarStore.scopes[storageId] } }, storageId),
                occasions: normalizeOccasionScope(previousOccasionStore.scopes[storageId]),
            };
            const result = await mutate(current);
            if (generation !== commitGeneration) return false;
            const calendarScope = normalizeCalendarScope(result.calendar);
            const occasionScope = normalizeOccasionScope(result.occasions);
            const calendar = replaceScope(previousCalendarStore, storageId, calendarScope, normalizeCalendarStore);
            const occasionStore = replaceScope(previousOccasionStore, storageId, occasionScope, normalizeOccasionStore);
            try {
                if (!saveCalendar(calendar)) throw new Error('日历保存失败：浏览器存储不可用');
                if (!saveCalendarOccasions(occasionStore)) throw new Error('生日与纪念日保存失败：浏览器存储不可用');
                runtime.store = calendar;
                runtime.occasionStore = occasionStore;
                const injectionResult = await applyBidirectionalInjection?.();
                const error = injectionFailure(injectionResult, '日程提交');
                if (generation !== commitGeneration && !error) return false;
                if (!error) return { calendar: calendarScope, occasions: occasionScope };
                throw error;
            } catch (error) {
                if (generation !== commitGeneration) throw error;
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
                runtime.store = previousCalendarStore;
                runtime.occasionStore = previousOccasionStore;
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

    const commitCycle = (storageId, mutate) => {
        const generation = commitGeneration;
        return enqueueDirectoryOperation('cycles', async () => {
            if (generation !== commitGeneration) return false;
            const previousStore = loadCalendarCycles();
            const targetStore = {
                ...previousStore,
                scopes: Object.hasOwn(previousStore.scopes, storageId) ? { [storageId]: previousStore.scopes[storageId] } : {},
            };
            const result = normalizeCycleStore(await mutate(targetStore));
            if (generation !== commitGeneration) return false;
            const scopes = { ...previousStore.scopes };
            if (Object.hasOwn(result.scopes, storageId)) scopes[storageId] = result.scopes[storageId];
            else delete scopes[storageId];
            const candidate = { ...previousStore, scopes };
            if (!saveCalendarCycles(candidate)) throw new Error('生理周期数据保存失败：浏览器存储不可用');
            runtime.cycleStore = candidate;
            return getCycles(storageId, getCycleSubject(storageId));
        });
    };

    return { commitScope, commitStore, commitRecipe, commitOutfits, commitOccasions, commitSchedule, commitHolidays, commitWeather, commitCycle, invalidateCommits };
}
