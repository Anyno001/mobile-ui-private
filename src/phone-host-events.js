import { beginBranchInheritance, resolveBranchInheritance } from './branch-scope-inheritance.js';
import { resolveCommunityMessageEvents, resolveHostEvent } from './interactive-scene-scheduler.js';

const warnedRegistrationFailures = new Set();
function warnRegistrationFailureOnce(key, eventName, error) {
    if (warnedRegistrationFailures.has(key)) return;
    warnedRegistrationFailures.add(key);
    const errorType = typeof error?.name === 'string' && error.name ? error.name : 'Error';
    console.warn(`[phone-mode] 宿主事件 ${eventName} 注册失败，该集成功能可能不可用。`, errorType);
}

function reportTodayTrendObservationFailure(error) {
    const errorType = typeof error?.name === 'string' && error.name ? error.name : 'Error';
    console.warn('[phone-mode] 今日风向自动推演观察失败，本轮不会自动推演。', errorType);
}

function observeTodayTrendAfterHostEvent(deps, runtime, getCtx, getStorageId) {
    const storageId = getStorageId();
    if (!storageId) return;
    runtime.todayTrendObservationStorageId = storageId;
    if (runtime.todayTrendObservationQueued) return;
    runtime.todayTrendObservationQueued = true;
    // 同一同步事件批次只排一个微任务，并在执行时读取最终 chat，避免重复扫描完整长聊天。
    Promise.resolve().then(() => {
        runtime.todayTrendObservationQueued = false;
        const queuedStorageId = runtime.todayTrendObservationStorageId;
        runtime.todayTrendObservationStorageId = null;
        if (!queuedStorageId || getStorageId() !== queuedStorageId) return null;
        return deps.observeTodayTrendTurn?.(getCtx()?.chat || []);
    })
        .catch(reportTodayTrendObservationFailure);
}

export function createPhoneHostEventController({ state, runtime, deps, getCtx, getStorageId, isAutoPokeAllowed, disarmAutoPoke, invalidateGeneration, applyBidirectionalInjection, handleHostChatChanged }) {
    function hookGenerationEvent() {
        const context = getCtx();
        const eventTypes = context?.eventTypes || context?.event_types;
        if (!context?.eventSource || !eventTypes) return;
        if (runtime.hostEventSource !== context.eventSource) {
            runtime.hostEventSource = context.eventSource;
            runtime.hostEventRegistrations = new Set();
            runtime.eventHooked = false;
        }
        const registrations = runtime.hostEventRegistrations instanceof Set
            ? runtime.hostEventRegistrations : (runtime.hostEventRegistrations = new Set());
        if (runtime.eventHooked) return;
        runtime.lastChatLength = (context.chat || []).length;
        const registerOnce = (key, eventName, callback) => {
            if (registrations.has(key)) return true;
            if (!eventName || typeof context.eventSource?.on !== 'function') return false;
            try {
                context.eventSource.on(eventName, callback); registrations.add(key); return true;
            } catch (error) { warnRegistrationFailureOnce(key, eventName, error); return false; }
        };
        const injectionEvents = [
            eventTypes.GENERATION_STARTED || 'generation_started', eventTypes.SETTINGS_UPDATED || 'settings_updated',
            eventTypes.CHATCOMPLETION_SOURCE_CHANGED || 'chatcompletion_source_changed', eventTypes.OAI_PRESET_CHANGED_AFTER || 'oai_preset_changed_after',
        ].filter(Boolean);
        const results = injectionEvents.map(eventName => registerOnce(`injection:${eventName}`, eventName,
            () => applyBidirectionalInjection().catch(() => undefined)));
        for (const eventName of resolveCommunityMessageEvents(eventTypes)) {
            results.push(registerOnce(`community:${eventName}`, eventName, () => {
                const currentContext = getCtx();
                try { deps.observeCommunityTurn?.(currentContext?.chat || []); } catch (error) {}
                Promise.resolve(deps.observeCalendarTurn?.()).catch(() => {});
                observeTodayTrendAfterHostEvent(deps, runtime, getCtx, getStorageId);
            }));
        }
        const received = resolveHostEvent(eventTypes, 'MESSAGE_RECEIVED');
        results.push(registerOnce('resolved:MESSAGE_RECEIVED', received, () => {
            const chat = getCtx()?.chat || []; const previousLength = runtime.lastChatLength;
            const currentLength = chat.length;
            if (currentLength > previousLength) {
                runtime.lastChatLength = currentLength;
                const hasCompletedAssistantMessage = chat.slice(previousLength).some(message => !message?.is_user);
                if (hasCompletedAssistantMessage && isAutoPokeAllowed() && typeof window.__pmIncrementCounters === 'function') window.__pmIncrementCounters();
            } else if (currentLength < previousLength) runtime.lastChatLength = currentLength;
        }));
        const changed = resolveHostEvent(eventTypes, 'CHAT_CHANGED');
        results.push(registerOnce('resolved:CHAT_CHANGED', changed, () => {
            const currentContext = getCtx(); const branch = resolveBranchInheritance(currentContext);
            const inheritBranch = deps.beginBranchInheritance || beginBranchInheritance;
            const metadata = currentContext?.chatMetadata || currentContext?.chat_metadata;
            return inheritBranch(currentContext, {
                getStorageId, invalidateInteractiveStore: deps.invalidateInteractiveStore,
                reloadCalendarStore: deps.reloadCalendarStore, reloadTodayTrendStore: deps.reloadTodayTrendStore,
            }).then(result => {
                runtime.lastBranchInheritance = { status: result?.status || 'unknown', reason: result?.reason || null, sourceId: result?.sourceId || null, targetId: result?.targetId || null, sourcePresence: result?.sourcePresence || null, targetPresence: result?.targetPresence || null };
                runtime.lastBranchInheritanceError = null;
                if (result?.status === 'cloned') console.info('[phone-mode] 分支手机数据继承完成');
                else if (result?.status === 'skipped' && metadata?.main_chat) console.warn('[phone-mode] 分支手机数据继承已跳过', result.reason || 'unknown');
                return result;
            }).catch(error => {
                runtime.lastBranchInheritance = { status: 'failed', reason: null, sourceId: branch?.sourceId || null, targetId: branch?.targetId || null, sourcePresence: null, targetPresence: null };
                runtime.lastBranchInheritanceError = { name: typeof error?.name === 'string' && error.name ? error.name : 'Error', message: typeof error?.message === 'string' ? error.message.slice(0, 240) : '' };
                console.warn('[phone-mode] 分支手机数据继承失败', error?.name || 'Error'); return { status: 'failed', error };
            }).finally(() => handleHostChatChanged({
                state, runtime, chatLength: (currentContext?.chat || []).length,
                cancelCommunityGeneration: deps.cancelCommunityGeneration, cancelCalendarTasks: deps.cancelCalendarTasks,
                cancelTodayTrendInitialization: deps.cancelTodayTrendInitialization, cancelTodayTrendRuleRegeneration: deps.cancelTodayTrendRuleRegeneration,
                cancelTodayTrendGeneration: deps.cancelTodayTrendGeneration, disarmAutoPoke, endPhone: window.__pmEnd, invalidateGeneration,
            }));
        }));
        runtime.eventHooked = results.every(Boolean);
        if (runtime.eventHooked) console.log('[phone-mode] hooked', injectionEvents.length, 'injection events');
    }
    return { hookGenerationEvent };
}
