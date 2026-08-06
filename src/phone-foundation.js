import { normalizeInjectionConfig } from './behavior-config.js';
import { normalizeBudgetConfig } from './budget.js';
import { createPhoneAppearance } from './phone-appearance.js';
import { createPhoneGenerationController } from './phone-generation.js';
import { createPhoneHostEventController } from './phone-host-events.js';
import { createPhoneInjectionController } from './phone-injection-controller.js';
import { bindIsland } from './phone-island-gesture.js';
import { createPhoneMessageRenderer } from './phone-message-rendering.js';
import { createPhoneOverlayController } from './phone-overlay.js';
import { createPhoneQuoteController } from './phone-quote.js';
import { createPhoneThemeController } from './phone-theme.js';
import { createAutomaticTaskController } from './runtime.js';
import {
    saveHistoriesBeforeUnload, saveTheme,
} from './storage.js';
export {
    applyPhoneScale, normalizePhoneScale,
    PHONE_BASE_HEIGHT, PHONE_BASE_WIDTH, PHONE_MAX_SCALE, PHONE_MIN_SCALE,
    phoneSizeForScale, phoneSizeForViewport,
} from './phone-scale.js';
import { applyPhoneScale, normalizePhoneScale, PHONE_BASE_HEIGHT, PHONE_BASE_WIDTH } from './phone-scale.js';

export function installPhonePageSuspensionListeners(windowRef = window, documentRef = document) {
    if (windowRef.__pmBeforeUnloadRegistered) return false;
    windowRef.addEventListener('beforeunload', () => windowRef.__pmPageSuspensionHandler?.('beforeunload'));
    documentRef.addEventListener('visibilitychange', () => {
        if (documentRef.visibilityState === 'hidden') {
            windowRef.__pmPageSuspensionHandler?.('document-hidden');
        }
    });
    windowRef.__pmBeforeUnloadRegistered = true;
    return true;
}

export function updatePhonePageSuspensionHandler(windowRef, deps, disarm, save = saveHistoriesBeforeUnload) {
    windowRef.__pmPageSuspensionHandler = reason => handlePhonePageSuspension(
        deps, reason, { disarm, save },
    );
    return windowRef.__pmPageSuspensionHandler;
}

export function handlePhonePageSuspension(deps, reason, {
    save = saveHistoriesBeforeUnload,
    disarm = () => {},
} = {}) {
    save();
    deps.cancelCommunityGeneration?.(reason);
    deps.cancelCalendarTasks?.(reason);
    deps.cancelTodayTrendInitialization?.(reason);
    deps.cancelTodayTrendRuleRegeneration?.(reason);
    deps.cancelTodayTrendGeneration?.(reason, true);
    disarm(reason);
}

export function handleHostChatChanged({
    state, runtime, chatLength = 0, cancelCommunityGeneration, cancelCalendarTasks, cancelTodayTrendInitialization, cancelTodayTrendRuleRegeneration, cancelTodayTrendGeneration,
    disarmAutoPoke, endPhone = globalThis.window?.__pmEnd, invalidateGeneration,
}) {
    runtime.lastChatLength = Number.isInteger(chatLength) && chatLength >= 0 ? chatLength : 0;
    cancelCommunityGeneration?.('host-chat-changed');
    cancelCalendarTasks?.('host-chat-changed');
    cancelTodayTrendInitialization?.('host-chat-changed');
    cancelTodayTrendRuleRegeneration?.('host-chat-changed');
    cancelTodayTrendGeneration?.('host-chat-changed', true);
    disarmAutoPoke?.('host-chat-changed');
    if (state.phoneActive && typeof endPhone === 'function') {
        endPhone(true);
        return 'closed';
    }
    invalidateGeneration?.();
    return 'invalidated';
}

export function installPhoneFoundation(state, deps) {
    const { runtime, getCtx, getStorageId, getUserPersona } = deps;
    const quote = createPhoneQuoteController(state);
    const {
        setActiveQuote, clearActiveQuote, renderActiveQuote, findQuotedBubble, locateQuotedBubble,
        refreshReplyCardAvailability, clearQuoteHighlight, syncReplyCardAvailability,
    } = quote;
    const automaticTasks = createAutomaticTaskController({
        runtime,
        state,
        getStorageId,
        isDocumentVisible: () => typeof document.visibilityState !== 'string'
            || document.visibilityState !== 'hidden',
    });
    const isAutoPokeAllowed = automaticTasks.isAllowed;
    const armAutoPoke = automaticTasks.arm;
    const disarmAutoPoke = automaticTasks.disarm;
    const beginAutomaticTask = automaticTasks.begin;
    const isAutomaticTaskActive = automaticTasks.isActive;
    const finishAutomaticTask = automaticTasks.finish;
    // 监听器只注册一次，但每次安装都更新当前依赖，避免热重载后继续调用旧任务控制器。
    updatePhonePageSuspensionHandler(window, deps, disarmAutoPoke);
    installPhonePageSuspensionListeners(window, document);

    window.__pmHistories = window.__pmHistories || {};
    window.__pmConfig = window.__pmConfig || { apiUrl: '', apiKey: '', model: '', temperature: 1.2, useIndependent: false };
    window.__pmProfiles = window.__pmProfiles || [];
    window.__pmInjectionConfig = normalizeInjectionConfig(window.__pmInjectionConfig);
    window.__pmBidirectional = window.__pmBidirectional || {};
    window.__pmTheme = window.__pmTheme || {
        preset: 'default',
        customRight: '',
        customLeft: '',
        borderColor: '',
        layout: 'standard',
        darkMode: 'light',
        ambientStatusEnabled: false,
        customTitle: '',
        qrLabel: '天音',
        phoneScale: 1,
    };
    window.__pmDesktopBg = window.__pmDesktopBg || '';
    window.__pmBgGlobal = window.__pmBgGlobal || '';
    window.__pmBgLocal = window.__pmBgLocal || {};
    window.__pmGroupMeta = window.__pmGroupMeta || {};
    window.__pmPokeConfig = window.__pmPokeConfig || {};
    window.__pmCharacterBehavior = window.__pmCharacterBehavior || {};
    window.__pmWordyLimit = window.__pmWordyLimit || false;
    window.__pmBudgetConfig = normalizeBudgetConfig(window.__pmBudgetConfig);
    window.__pmEmojis = window.__pmEmojis || []; // [{id, name, images:[{url,desc},...]}]

    const { applyBackground, fitNameFont, migrateOldHistory } = createPhoneAppearance(state, deps);

    const { applyTheme } = createPhoneThemeController(state);
    const { makeOverlay, closeOverlay } = createPhoneOverlayController({ runtime, applyTheme });
    const {
        addBubble, addNote, addDirector, rebaseRenderedHistory, resetEmojiRenderBudget, showTyping, hideTyping,
    } = createPhoneMessageRenderer({ state, quote });
    const {
        beginGeneration, isGenerationTaskActive, finishGeneration, cancelGeneration, invalidateGeneration, syncGenerationControls,
    } = createPhoneGenerationController({ state, getCtx, getStorageId, hideTyping });
    const { applyBidirectionalInjection, clearBidirectionalInjection } = createPhoneInjectionController({
        state, runtime, deps, getCtx, getStorageId, getUserPersona,
    });
    const { hookGenerationEvent } = createPhoneHostEventController({
        state, runtime, deps, getCtx, getStorageId, isAutoPokeAllowed, disarmAutoPoke,
        invalidateGeneration, applyBidirectionalInjection, handleHostChatChanged,
    });


    window.__pmCloseOverlay = () => closeOverlay('close');



    window.__pmToggleBidirectional = name => {
        const id = getStorageId();
        const targetKey = String(name || '').trim();
        const isGroup = Object.hasOwn(window.__pmGroupMeta?.[id] || {}, targetKey);
        return window.__pmToggleConversationInjection?.(id, targetKey, isGroup) || Promise.resolve(false);
    };


    function bindPhoneResize(el, handle) {
        let resizing = false;
        let pointerId = null;
        let startX = 0;
        let startY = 0;
        let startScale = 1;
        let previousScale = 1;

        const visualViewport = window.visualViewport;
        const onViewportResize = () => applyPhoneScale(el);

        const onPointerMove = event => {
            if (!resizing || event.pointerId !== pointerId) return;
            const dx = event.clientX - startX;
            const dy = event.clientY - startY;
            const projected = (dx * PHONE_BASE_WIDTH + dy * PHONE_BASE_HEIGHT)
                / (PHONE_BASE_WIDTH ** 2 + PHONE_BASE_HEIGHT ** 2);
            const nextScale = normalizePhoneScale(startScale + projected);
            window.__pmTheme.phoneScale = nextScale;
            applyPhoneScale(el, nextScale);
            if (event.cancelable) event.preventDefault();
        };
        const finish = event => {
            if (!resizing || (event?.pointerId !== undefined && event.pointerId !== pointerId)) return;
            resizing = false;
            el.classList.remove('is-resizing');
            try { handle.releasePointerCapture?.(pointerId); } catch (error) {}
            pointerId = null;
            const nextScale = normalizePhoneScale(window.__pmTheme.phoneScale);
            window.__pmTheme.phoneScale = nextScale;
            if (!saveTheme()) {
                window.__pmTheme.phoneScale = previousScale;
                applyPhoneScale(el, previousScale);
                alert('手机尺寸保存失败：浏览器存储不可用。');
            }
        };
        const onPointerDown = event => {
            if (state.isMinimized || event.button !== 0) return;
            resizing = true;
            pointerId = event.pointerId;
            startX = event.clientX;
            startY = event.clientY;
            previousScale = Number(window.__pmTheme.phoneScale) || 1;
            startScale = normalizePhoneScale(previousScale);
            window.__pmTheme.phoneScale = startScale;
            el.classList.add('is-resizing');
            handle.setPointerCapture?.(pointerId);
            if (event.cancelable) event.preventDefault();
        };
        handle.addEventListener('pointerdown', onPointerDown);
        handle.addEventListener('lostpointercapture', finish);
        window.addEventListener('pointermove', onPointerMove, { passive: false });
        window.addEventListener('pointerup', finish);
        window.addEventListener('pointercancel', finish);
        window.addEventListener('blur', finish);
        window.addEventListener('resize', onViewportResize);
        visualViewport?.addEventListener('resize', onViewportResize);
        applyPhoneScale(el);
        return () => {
            finish();
            handle.removeEventListener('pointerdown', onPointerDown);
            handle.removeEventListener('lostpointercapture', finish);
            window.removeEventListener('pointermove', onPointerMove);
            window.removeEventListener('pointerup', finish);
            window.removeEventListener('pointercancel', finish);
            window.removeEventListener('blur', finish);
            window.removeEventListener('resize', onViewportResize);
            visualViewport?.removeEventListener('resize', onViewportResize);
        };
    }

    Object.assign(deps, {
        applyTheme, applyBackground, fitNameFont, migrateOldHistory,
        applyBidirectionalInjection, clearBidirectionalInjection, hookGenerationEvent,
        bindIsland, bindPhoneResize, applyPhoneScale,
        addBubble, addNote, addDirector, rebaseRenderedHistory, resetEmojiRenderBudget,
        showTyping, hideTyping, makeOverlay, closeOverlay,
        beginGeneration, isGenerationTaskActive, finishGeneration,
        cancelGeneration, invalidateGeneration, syncGenerationControls,
        isAutoPokeAllowed, armAutoPoke, disarmAutoPoke,
        beginAutomaticTask, isAutomaticTaskActive, finishAutomaticTask,
        setActiveQuote, clearActiveQuote, renderActiveQuote, findQuotedBubble, locateQuotedBubble,
        refreshReplyCardAvailability, clearQuoteHighlight,
    });
}