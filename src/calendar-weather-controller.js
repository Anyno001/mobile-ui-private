import { fetchWeatherForecast, weatherLocationKey } from './calendar-weather.js';
import { createStoryWeatherEvent } from './calendar-weather-source.js';

export function createCalendarWeatherController({
    tasks, runtime, getScope, getReferenceDate, getView, setView, commitWeather, commitScope, commitStore,
    fetchImpl, applyBidirectionalInjection, status, errorStatus, rerender,
}) {
    const currentLocationKey = () => runtime.weatherStore.location ? weatherLocationKey(runtime.weatherStore.location) : '';
    const hasCurrentEvent = (scope, referenceDate) => scope?.weatherEvent?.endDate >= referenceDate
        && scope.weatherEvent.locationKey === currentLocationKey();

    async function ensureStoryWeatherEvent(storageId, { refreshInjection = true } = {}) {
        const current = getScope(storageId);
        if (!current.weatherEventEnabled || !runtime.weatherStore.location) return false;
        const referenceDate = getReferenceDate(current);
        if (hasCurrentEvent(current, referenceDate)) return false;
        const event = createStoryWeatherEvent(runtime.weatherStore, referenceDate, storageId, {
            forcedType: current.weatherEventType,
            intensity: current.weatherEventIntensity,
            forcedDays: current.weatherEventDays || undefined,
            revision: current.weatherEventRevision,
        });
        if (!event) return false;
        await commitScope(storageId, value => {
            if (!value.weatherEventEnabled || hasCurrentEvent(value, referenceDate)) return value;
            return { ...value, weatherEvent: event };
        }, null, { refreshInjection });
        return true;
    }

    function storyWeatherEventForScope(storageId, scope, referenceDate) {
        if (!scope?.weatherEventEnabled || hasCurrentEvent(scope, referenceDate) || !runtime.weatherStore.location) {
            return null;
        }
        return createStoryWeatherEvent(runtime.weatherStore, referenceDate, storageId, {
            forcedType: scope.weatherEventType,
            intensity: scope.weatherEventIntensity,
            forcedDays: scope.weatherEventDays || undefined,
            revision: scope.weatherEventRevision,
        });
    }

    async function regenerateStoryWeatherEvent(storageId) {
        const current = getScope(storageId);
        if (!current.weatherEventEnabled || !runtime.weatherStore.location) return false;
        const revision = Number.isSafeInteger(current.weatherEventRevision) && current.weatherEventRevision >= 0
            ? current.weatherEventRevision + 1 : 1;
        const referenceDate = getReferenceDate(current);
        const event = createStoryWeatherEvent(runtime.weatherStore, referenceDate, storageId, {
            forcedType: current.weatherEventType,
            intensity: current.weatherEventIntensity,
            forcedDays: current.weatherEventDays || undefined,
            revision,
        });
        if (!event) return false;
        await commitScope(storageId, value => ({ ...value, weatherEventRevision: revision, weatherEvent: event }), null, { refreshInjection: false });
        await applyBidirectionalInjection?.();
        status(storageId, '剧情天气事件已重新生成。');
        rerender(storageId);
        return true;
    }

    async function restoreLocationChange(previousStore, previousWeatherStore, originalError) {
        let rollbackError = null;
        try {
            await commitStore(() => previousStore, null, { refreshInjection: false });
            commitWeather(previousWeatherStore);
            await applyBidirectionalInjection?.();
        } catch (error) {
            rollbackError = error;
        }
        if (!rollbackError) throw originalError;
        const combined = new Error(`${originalError.message}；天气地点切换回滚失败：${rollbackError.message}`);
        combined.cause = originalError;
        combined.rollbackError = rollbackError;
        combined.weatherLocationRollbackError = true;
        throw combined;
    }

    async function selectWeatherLocation(storageId, index) {
        const location = runtime.weatherSearchResults[index];
        if (!location) {
            const error = new Error('天气位置不存在，请重新搜索');
            errorStatus(storageId, error);
            throw error;
        }
        const task = tasks.begin(storageId, 'weather-forecast');
        if (!task) return false;
        try {
            const result = await fetchWeatherForecast(location, runtime.weatherStore, {
                fetchImpl, signal: task.signal,
            });
            if (!tasks.active(task)) return false;
            const locationChanged = result.locationKey !== currentLocationKey();
            if (!locationChanged) {
                commitWeather(result.store);
                runtime.weatherSearchResults = [];
                await ensureStoryWeatherEvent(storageId, { refreshInjection: false });
                await applyBidirectionalInjection?.();
            } else {
                const previousStore = structuredClone(runtime.store);
                const previousWeatherStore = structuredClone(runtime.weatherStore);
                try {
                    await commitStore(store => ({ ...store, scopes: Object.fromEntries(
                        Object.entries(store.scopes).map(([id, scope]) => [id, { ...scope, weatherEvent: undefined }]),
                    ) }), null, { refreshInjection: false });
                    commitWeather(result.store);
                    runtime.weatherSearchResults = [];
                    await ensureStoryWeatherEvent(storageId, { refreshInjection: false });
                    await applyBidirectionalInjection?.();
                } catch (error) {
                    await restoreLocationChange(previousStore, previousWeatherStore, error);
                }
            }
            const degraded = result.source !== 'forecast';
            status(storageId, result.source === 'cached_forecast' ? '天气服务不可用，已显示该位置的缓存预报。'
                : result.source === 'climate_estimate' ? '天气服务不可用，已保存位置并使用气候推演。' : '天气位置与预报已更新。',
            degraded ? { duration: 10000 } : undefined);
            rerender(storageId);
            return true;
        } catch (error) {
            if (!tasks.active(task)) return false;
            errorStatus(storageId, error);
            throw error;
        } finally { tasks.finish(task); }
    }

    async function refreshWeather(storageId) {
        if (!runtime.weatherStore.location) {
            const error = new Error('请先搜索并选择天气位置');
            errorStatus(storageId, error);
            throw error;
        }
        const task = tasks.begin(storageId, 'weather-forecast');
        if (!task) return false;
        const currentView = getView(storageId);
        setView(storageId, { ...currentView, weatherRefreshing: true, weatherRefreshTask: task });
        rerender(storageId);
        try {
            const result = await fetchWeatherForecast(runtime.weatherStore.location, runtime.weatherStore, { resetCache: true, fetchImpl, signal: task.signal });
            if (!tasks.active(task)) return false;
            commitWeather(result.store);
            await applyBidirectionalInjection?.();
            const degraded = result.source !== 'forecast';
            status(storageId, result.source === 'cached_forecast' ? '天气服务不可用，已显示缓存预报。'
                : result.source === 'climate_estimate' ? '天气服务不可用，继续使用气候推演。' : '天气预报已更新。', degraded ? { duration: 10000 } : undefined);
            rerender(storageId);
            return true;
        } catch (error) {
            if (!tasks.active(task)) return false;
            errorStatus(storageId, error);
            throw error;
        } finally {
            tasks.finish(task);
            const latestView = getView(storageId);
            if (latestView.weatherRefreshTask === task) {
                setView(storageId, { ...latestView, weatherRefreshing: false, weatherRefreshTask: null });
                rerender(storageId);
            }
        }
    }

    return { ensureStoryWeatherEvent, storyWeatherEventForScope, regenerateStoryWeatherEvent, selectWeatherLocation, refreshWeather };
}
