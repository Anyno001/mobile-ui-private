import { applyContextInjections, buildContextInjectionPrompts, clearExtensionPrompts } from './phone-injection.js';
import { enabledStoryOraclePlans } from './story-oracle-model.js';

export function createPhoneInjectionController({ state, runtime, deps, getCtx, getStorageId, getUserPersona }) {
    let injectionQueue = Promise.resolve();

    function clearBidirectionalInjection() {
        runtime.injectionEpoch += 1;
        return clearExtensionPrompts({ context: getCtx(), runtime });
    }

    function getCalendarData(getter) {
        try { return deps[getter]?.() || null; } catch (error) { return null; }
    }

    async function collectInjectionInput(todayTrendStore, { reserveEpoch = true } = {}) {
        const epoch = reserveEpoch ? ++runtime.injectionEpoch : runtime.injectionEpoch;
        const context = getCtx();
        const storageId = getStorageId();
        if (!context || !storageId || storageId === 'sms_unknown__default') {
            return { epoch, context, storageId, clear: true };
        }
        const character = context.characters?.[context.characterId];
        const currentActorName = typeof character?.name === 'string' ? character.name.trim() : '';
        if (!currentActorName) return { epoch, context, storageId, clear: true };
        const currentConversationKey = state.isGroupChat && state.currentGroupKey
            ? state.currentGroupKey : state.currentPersona;
        let interactiveStore;
        try { interactiveStore = await deps.getInteractiveStore?.(); } catch (error) { interactiveStore = null; }
        let storyOracleStore;
        try { storyOracleStore = await deps.getStoryOracleStore?.(); } catch (error) { storyOracleStore = null; }
        if (epoch !== runtime.injectionEpoch || getStorageId() !== storageId) return null;
        const storyOraclePlans = enabledStoryOraclePlans(storyOracleStore, storageId);
        return {
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
            todayTrendStore: todayTrendStore === undefined
                ? runtime.todayTrend?.pendingInjectionStore ?? runtime.todayTrend?.store : todayTrendStore,
            storyOraclePlans,
        };
    }

    async function prepareBidirectionalInjection(todayTrendStore) {
        const input = await collectInjectionInput(todayTrendStore, { reserveEpoch: false });
        if (!input) return null;
        if (input.clear) return { prompts: [], diagnostics: null };
        return buildContextInjectionPrompts(input);
    }

    function applyBidirectionalInjection(todayTrendStore) {
        const operation = injectionQueue.then(async () => {
            const input = await collectInjectionInput(todayTrendStore);
            if (!input) return undefined;
            return input.clear ? clearExtensionPrompts({ context: input.context, runtime }) : applyContextInjections(input);
        });
        injectionQueue = operation.catch(() => {});
        return operation;
    }

    return { applyBidirectionalInjection, prepareBidirectionalInjection, clearBidirectionalInjection };
}
