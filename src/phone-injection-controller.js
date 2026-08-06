import { applyContextInjections, clearExtensionPrompts } from './phone-injection.js';

export function createPhoneInjectionController({ state, runtime, deps, getCtx, getStorageId, getUserPersona }) {
    function clearBidirectionalInjection() {
        runtime.injectionEpoch += 1;
        return clearExtensionPrompts({ context: getCtx(), runtime });
    }

    function getCalendarData(getter) {
        try { return deps[getter]?.() || null; } catch (error) { return null; }
    }

    async function applyBidirectionalInjection() {
        const epoch = ++runtime.injectionEpoch;
        const context = getCtx();
        const storageId = getStorageId();
        if (!context || !storageId || storageId === 'sms_unknown__default') {
            return clearExtensionPrompts({ context, runtime });
        }
        const character = context.characters?.[context.characterId];
        const currentActorName = typeof character?.name === 'string' ? character.name.trim() : '';
        if (!currentActorName) return clearExtensionPrompts({ context, runtime });
        const currentConversationKey = state.isGroupChat && state.currentGroupKey
            ? state.currentGroupKey : state.currentPersona;
        let interactiveStore;
        try { interactiveStore = await deps.getInteractiveStore?.(); } catch (error) { interactiveStore = null; }
        if (epoch !== runtime.injectionEpoch || getStorageId() !== storageId) return;
        return applyContextInjections({
            context, runtime, currentStorageId: storageId, currentActorName, currentConversationKey,
            injectionConfig: window.__pmInjectionConfig, selectedByStorage: window.__pmBidirectional,
            historiesByStorage: window.__pmHistories, groupsByStorage: window.__pmGroupMeta,
            interactiveStore, budgetConfig: window.__pmBudgetConfig, userName: getUserPersona().name || '用户',
            emojis: window.__pmEmojis,
            calendarStore: getCalendarData('getCalendarStore'),
            calendarOccasions: getCalendarData('getCalendarOccasionStore'),
            calendarHolidays: getCalendarData('getCalendarHolidayStore'),
            calendarWeather: getCalendarData('getCalendarWeatherStore'),
            calendarCycles: getCalendarData('getCalendarCycleStore'),
            calendarRecipes: getCalendarData('getCalendarRecipeStore'),
            calendarOutfits: getCalendarData('getCalendarOutfitStore'),
            todayTrendStore: runtime.todayTrend?.store,
        });
    }

    return { applyBidirectionalInjection, clearBidirectionalInjection };
}
