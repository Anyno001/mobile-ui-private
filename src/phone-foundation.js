import {
    POPOVER_SUPPORTED,
} from './constants.js';
import { normalizeInjectionConfig } from './behavior-config.js';
import { normalizeBudgetConfig } from './budget.js';
import { THEME_PRESETS } from './config.js';
import { createEmojiRenderBudget } from './emoji-media.js';
import { contrastText, cssUrlEscape, escapeHtml } from './ui.js';
import { createBubbles } from './messaging.js';
import { applyContextInjections, clearExtensionPrompts } from './phone-injection.js';
import { bindIsland } from './phone-island-gesture.js';
import {
    registerResolvedHostEvent, resolveCommunityMessageEvents, resolveHostEvent,
} from './interactive-scene-scheduler.js';
import { createAutomaticTaskController } from './runtime.js';
import {
    saveBidirectional, saveHistories, saveHistoriesBeforeUnload, saveTheme,
} from './storage.js';

const warnedHostEventRegistrationFailures = new Set();

function warnHostEventRegistrationFailureOnce(key, eventName, error) {
    if (warnedHostEventRegistrationFailures.has(key)) return;
    warnedHostEventRegistrationFailures.add(key);
    const errorType = typeof error?.name === 'string' && error.name ? error.name : 'Error';
    console.warn(`[phone-mode] 宿主事件 ${eventName} 注册失败，该集成功能可能不可用。`, errorType);
}

export const PHONE_BASE_WIDTH = 330;
export const PHONE_BASE_HEIGHT = 580;
export const PHONE_MIN_SCALE = 0.6;
export const PHONE_MAX_SCALE = 1.5;

export function normalizePhoneScale(
    value,
    viewportWidth = globalThis.window?.innerWidth ?? 1200,
) {
    const width = Number(viewportWidth);
    const compact = width <= 500;
    const widthLimit = Math.max(0.1, (compact ? width * 0.92 : width - 24) / PHONE_BASE_WIDTH);
    const maximum = Math.max(Math.min(PHONE_MAX_SCALE, widthLimit), Math.min(PHONE_MIN_SCALE, widthLimit));
    const minimum = Math.min(PHONE_MIN_SCALE, maximum);
    const numeric = Number(value);
    const candidate = Number.isFinite(numeric) ? numeric : 1;
    return Math.round(Math.min(maximum, Math.max(minimum, candidate)) * 1000) / 1000;
}

export function phoneSizeForScale(scale) {
    const normalized = Number.isFinite(Number(scale)) ? Number(scale) : 1;
    return {
        width: Math.round(PHONE_BASE_WIDTH * normalized),
        height: Math.round(PHONE_BASE_HEIGHT * normalized),
    };
}

export function phoneSizeForViewport(
    scale,
    viewportWidth = globalThis.window?.innerWidth ?? 1200,
    viewportHeight = globalThis.window?.visualViewport?.height ?? globalThis.window?.innerHeight ?? 1000,
) {
    const normalized = normalizePhoneScale(scale, viewportWidth);
    const naturalSize = phoneSizeForScale(normalized);
    const height = Number(viewportHeight);
    const compact = Number(viewportWidth) <= 500 || height <= 700;
    const heightBudget = Math.max(
        Math.round(PHONE_BASE_HEIGHT * 0.1),
        Math.round(compact ? height * 0.82 : height - 24),
    );
    return { scale: normalized, width: naturalSize.width, height: Math.min(naturalSize.height, heightBudget) };
}

export function applyPhoneScale(element, scale = globalThis.window?.__pmTheme?.phoneScale) {
    if (!element) return null;
    const size = phoneSizeForViewport(scale);
    element.style.setProperty('--pm-phone-width', `${size.width}px`);
    element.style.setProperty('--pm-phone-height', `${size.height}px`);
    return size;
}

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
    disarm(reason);
}

export function handleHostChatChanged({
    state, runtime, chatLength = 0, cancelCommunityGeneration, cancelCalendarTasks,
    disarmAutoPoke, endPhone = globalThis.window?.__pmEnd, invalidateGeneration,
}) {
    runtime.lastChatLength = Number.isInteger(chatLength) && chatLength >= 0 ? chatLength : 0;
    cancelCommunityGeneration?.('host-chat-changed');
    cancelCalendarTasks?.('host-chat-changed');
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
    let quoteHighlightTimer = null;

    function renderActiveQuote() {
        const preview = state.phoneWindow?.querySelector('.pm-quote-preview');
        if (!preview) return;
        const quote = state.activeQuote;
        preview.hidden = !quote;
        if (!quote) {
            preview.querySelector('.pm-quote-preview-sender')?.replaceChildren();
            preview.querySelector('.pm-quote-preview-text')?.replaceChildren();
            return;
        }
        preview.querySelector('.pm-quote-preview-sender')?.replaceChildren(document.createTextNode(quote.sender || '群聊消息'));
        preview.querySelector('.pm-quote-preview-text')?.replaceChildren(document.createTextNode(quote.text));
    }

    function clearActiveQuote() {
        state.activeQuote = null;
        renderActiveQuote();
    }

    function setActiveQuote(quote) {
        if (!quote) return false;
        state.activeQuote = quote;
        renderActiveQuote();
        state.phoneWindow?.querySelector('.pm-input')?.focus();
        return true;
    }

    function findQuotedBubble(quote) {
        const list = state.phoneWindow?.querySelector('.pm-msg-list');
        if (!list || !quote?.bubbleId) return null;
        return [...list.querySelectorAll('[data-bubble-id]')]
            .find(node => node.dataset.bubbleId === quote.bubbleId && node.dataset.messageId === quote.messageId);
    }

    function syncReplyCardAvailability(card) {
        if (!card) return false;
        const quote = {
            messageId: card.dataset.quoteMessageId,
            bubbleId: card.dataset.quoteBubbleId,
        };
        const available = !!findQuotedBubble(quote);
        card.classList.toggle('is-missing', !available);
        card.disabled = !available;
        card.setAttribute('aria-disabled', String(!available));
        card.setAttribute('aria-label', available
            ? '定位到被引用的消息'
            : '原消息已删除或已被裁剪，当前显示引用快照');
        return available;
    }

    function refreshReplyCardAvailability() {
        const list = state.phoneWindow?.querySelector('.pm-msg-list');
        if (!list) return 0;
        const cards = [...list.querySelectorAll('.pm-reply-card')];
        cards.forEach(syncReplyCardAvailability);
        return cards.length;
    }

    function locateQuotedBubble(quote) {
        const target = findQuotedBubble(quote);
        if (!target) return false;
        const reduceMotion = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches === true;
        target.scrollIntoView?.({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'center' });
        target.classList.add('pm-quote-target');
        if (quoteHighlightTimer !== null) clearTimeout(quoteHighlightTimer);
        quoteHighlightTimer = setTimeout(() => target.classList.remove('pm-quote-target'), 1800);
        return true;
    }
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
    let emojiRenderBudget = createEmojiRenderBudget();
    const resetEmojiRenderBudget = () => {
        emojiRenderBudget = createEmojiRenderBudget();
    };
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

    function syncGenerationControls() {
        const disabled = !!state.isGenerating;
        for (const button of document.querySelectorAll('.pm-submit-pending-btn')) {
            const empty = button.dataset.empty === 'true';
            button.disabled = disabled || empty;
        }
        const status = document.querySelector('.pm-control-generation-status');
        if (status) status.textContent = disabled ? 'AI 正在回复，暂存仍可继续编辑' : '';
    }

    function beginGeneration(storageId) {
        if (state.generationTask) return null;
        const id = storageId || getStorageId();
        const context = getCtx();
        if (!context || !id || id === 'sms_unknown__default') return null;
        const controller = new AbortController();
        const task = Object.freeze({
            id: ++state.generationSequence,
            hostEpoch: state.hostEpoch,
            storageId: id,
            context,
            controller,
            signal: controller.signal,
        });
        state.generationTask = task;
        state.isGenerating = true;
        syncGenerationControls();
        return task;
    }

    function isGenerationTaskActive(task) {
        return !!task
            && state.generationTask === task
            && state.hostEpoch === task.hostEpoch
            && getStorageId() === task.storageId;
    }

    function finishGeneration(task) {
        if (state.generationTask !== task) return false;
        state.generationTask = null;
        state.isGenerating = false;
        syncGenerationControls();
        return true;
    }

    function invalidateGeneration() {
        state.generationTask?.controller?.abort('generation-invalidated');
        state.hostEpoch += 1;
        state.generationTask = null;
        state.isGenerating = false;
        hideTyping();
        syncGenerationControls();
    }


    function applyTheme() {
        const t = window.__pmTheme || {}, p = THEME_PRESETS[t.preset] || THEME_PRESETS.default;
        const darkMode = t.darkMode || 'light';
        const rBg = t.customRight || p.right, lBg = t.customLeft || p.left;
        const rTxt = t.customRight ? contrastText(t.customRight) : p.rightText;
        const lTxt = t.customLeft ? contrastText(t.customLeft) : p.leftText;
        const border = t.borderColor || '#1a1a1a';
        const applyProperties = element => {
            if (!element) return;
            element.style.setProperty('--pm-r-bg', rBg); element.style.setProperty('--pm-l-bg', lBg);
            element.style.setProperty('--pm-r-txt', rTxt); element.style.setProperty('--pm-l-txt', lTxt);
            element.style.setProperty('--pm-border', border);
            element.style.setProperty('--pm-frost', p.frost ? '1' : '0');
            element.setAttribute('data-theme', darkMode);
        };
        applyProperties(document.getElementById('pm-overlay'));
        applyProperties(document.getElementById('pm-model-dropdown'));
        applyProperties(state.phoneWindow);
        const desktopTitle = state.phoneWindow?.querySelector('.pm-desktop-toolbar span');
        if (desktopTitle) desktopTitle.textContent = String(t.customTitle || '').trim() || '天音小笺';
    }

    function applyBackground() {
        const phone = state.phoneWindow;
        const msgList = phone?.querySelector('.pm-msg-list'); if (!msgList || !phone) return;
        const desktopBg = window.__pmDesktopBg || '';
        if (desktopBg) phone.style.setProperty('--pm-desktop-bg-image', `url("${cssUrlEscape(desktopBg)}")`);
        else phone.style.removeProperty('--pm-desktop-bg-image');
        const id = getStorageId(), localKey = `${id}_${state.currentPersona}`;
        const bg = window.__pmBgLocal[localKey] || window.__pmBgGlobal || '';
        if (bg) {
            msgList.style.setProperty('background-image', `url("${cssUrlEscape(bg)}")`, 'important');
            msgList.style.setProperty('background-size', 'cover', 'important');
            msgList.style.setProperty('background-position', 'center', 'important');
        } else {
            msgList.style.removeProperty('background-image');
            msgList.style.removeProperty('background-size');
            msgList.style.removeProperty('background-position');
        }
    }

    function fitNameFont() {
        const nameEl = state.phoneWindow?.querySelector('.pm-name');
        if (!nameEl) return;
        nameEl.style.fontSize = '15px';
        requestAnimationFrame(() => {
            let fs = 15;
            while (nameEl.scrollWidth > nameEl.clientWidth && fs > 9) {
                fs -= 0.5; nameEl.style.fontSize = fs + 'px';
            }
        });
    }


    function migrateOldHistory() {
        if (localStorage.getItem('ST_SMS_MIGRATED_V3')) return;
        const c = getCtx(); if (!c) return;
        try {
            const oldData = window.__pmHistories || {}, newData = {}; let migrated = 0;
            for (const oldKey of Object.keys(oldData)) {
                if (oldKey.startsWith('sms_')) { newData[oldKey] = oldData[oldKey]; continue; }
                // 旧格式：数字索引_chatId，迁移为 sms_avatar__chatId
                const m = oldKey.match(/^(\d+)_(.+)$/);
                if (!m) { newData[oldKey] = oldData[oldKey]; continue; }
                const ch = c.characters?.[parseInt(m[1])];
                if (ch?.avatar) { newData[`sms_${ch.avatar}__${m[2]}`] = oldData[oldKey]; migrated++; }
                else newData[oldKey] = oldData[oldKey];
            }
            window.__pmHistories = newData;
            saveHistories();
            localStorage.setItem('ST_SMS_MIGRATED_V3', '1');
        } catch (e) {}
    }


    function clearBidirectionalInjection() {
        runtime.injectionEpoch += 1;
        return clearExtensionPrompts({ context: getCtx(), runtime });
    }

    function getCalendarData(getter) {
        try {
            const store = deps[getter]?.();
            return store || null;
        } catch (error) {
            return null;
        }
    }

    async function applyBidirectionalInjection() {
        const epoch = ++runtime.injectionEpoch;
        const context = getCtx();
        const id = getStorageId();
        if (!context || !id || id === 'sms_unknown__default') {
            return clearExtensionPrompts({ context, runtime });
        }
        const character = context.characters?.[context.characterId];
        const currentActorName = typeof character?.name === 'string' ? character.name.trim() : '';
        if (!currentActorName) return clearExtensionPrompts({ context, runtime });
        const currentConversationKey = state.isGroupChat && state.currentGroupKey
            ? state.currentGroupKey : state.currentPersona;
        let interactiveStore;
        try {
            interactiveStore = await deps.getInteractiveStore?.();
        } catch (error) {
            interactiveStore = null;
        }
        if (epoch !== runtime.injectionEpoch || getStorageId() !== id) return;
        return applyContextInjections({
            context,
            runtime,
            currentStorageId: id,
            currentActorName,
            currentConversationKey,
            injectionConfig: window.__pmInjectionConfig,
            selectedByStorage: window.__pmBidirectional,
            historiesByStorage: window.__pmHistories,
            groupsByStorage: window.__pmGroupMeta,
            interactiveStore,
            budgetConfig: window.__pmBudgetConfig,
            userName: getUserPersona().name || '用户',
            emojis: window.__pmEmojis,
            calendarStore: getCalendarData('getCalendarStore'),
            calendarOccasions: getCalendarData('getCalendarOccasionStore'),
            calendarHolidays: getCalendarData('getCalendarHolidayStore'),
            calendarWeather: getCalendarData('getCalendarWeatherStore'),
            calendarCycles: getCalendarData('getCalendarCycleStore'),
            calendarRecipes: getCalendarData('getCalendarRecipeStore'),
        });
    }

    function hookGenerationEvent() {
        if (runtime.eventHooked) return;
        const c = getCtx();
        if (!c?.eventSource || !c?.event_types) return;
        const et = c.event_types;

        runtime.lastChatLength = (c.chat || []).length;

        const injectionEvents = [
            et.GENERATION_STARTED || 'generation_started',
            et.SETTINGS_UPDATED || 'settings_updated',
            et.CHATCOMPLETION_SOURCE_CHANGED || 'chatcompletion_source_changed',
            et.OAI_PRESET_CHANGED_AFTER || 'oai_preset_changed_after',
        ].filter(Boolean);

        injectionEvents.forEach(ev => {
            try {
                c.eventSource.on(ev, () => applyBidirectionalInjection().catch(() => undefined));
            } catch (error) {
                warnHostEventRegistrationFailureOnce(`injection:${ev}`, ev, error);
            }
        });

        for (const eventName of resolveCommunityMessageEvents(et)) {
            try {
                c.eventSource.on(eventName, () => {
                    try { deps.observeCommunityTurn?.(c.chat || []); } catch (error) {}
                    Promise.resolve(deps.observeCalendarTurn?.()).catch(() => {});
                });
            } catch (error) {
                warnHostEventRegistrationFailureOnce(`community:${eventName}`, eventName, error);
            }
        }

        try {
            registerResolvedHostEvent(c.eventSource, et, 'MESSAGE_RECEIVED', () => {
                const chat = c.chat || [];
                const previousLen = runtime.lastChatLength;
                const currentLen = chat.length;
                if (currentLen > runtime.lastChatLength) {
                    runtime.lastChatLength = currentLen;
                    const hasCompletedAssistantMessage = chat.slice(previousLen).some(message => !message?.is_user);
                    if (hasCompletedAssistantMessage && isAutoPokeAllowed()
                        && typeof window.__pmIncrementCounters === 'function') {
                        window.__pmIncrementCounters();
                    }
                } else if (currentLen < runtime.lastChatLength) {
                    runtime.lastChatLength = currentLen;
                }
            });
        } catch (error) {
            warnHostEventRegistrationFailureOnce('resolved:MESSAGE_RECEIVED', 'MESSAGE_RECEIVED', error);
        }
        try {
            registerResolvedHostEvent(c.eventSource, et, 'CHAT_CHANGED', () => {
                // 宿主切换会使所有在途生成失效；关闭手机并清空旧会话内存，避免跨聊天串档。
                handleHostChatChanged({
                    state, runtime, chatLength: (c.chat || []).length,
                    cancelCommunityGeneration: deps.cancelCommunityGeneration,
                    cancelCalendarTasks: deps.cancelCalendarTasks,
                    disarmAutoPoke,
                    endPhone: window.__pmEnd,
                    invalidateGeneration,
                });
            });
        } catch (error) {
            warnHostEventRegistrationFailureOnce('resolved:CHAT_CHANGED', 'CHAT_CHANGED', error);
        }

        runtime.eventHooked = true;
        console.log('[phone-mode] hooked', injectionEvents.length, 'injection events');
    }

    window.__pmToggleBidirectional = (name) => {
        const id = getStorageId();
        const previous = [...(window.__pmBidirectional[id] || [])];
        const next = previous.filter(item => item !== name);
        if (next.length === previous.length) next.push(name);
        window.__pmBidirectional[id] = next;
        if (!saveBidirectional()) {
            window.__pmBidirectional[id] = previous;
            alert('注入设置保存失败：浏览器存储不可用。');
            window.__pmShowList();
            return false;
        }
        applyBidirectionalInjection();
        window.__pmShowList();
        return true;
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

    function applyBubbleMetadata(node, metadata) {
        if (!metadata) return;
        if (metadata.historyIndex !== undefined) node.dataset.historyIndex = String(metadata.historyIndex);
        if (metadata.messageId) node.dataset.messageId = String(metadata.messageId);
        if (metadata.bubbleId) node.dataset.bubbleId = String(metadata.bubbleId);
        if (metadata.pendingId !== undefined) node.dataset.pendingId = String(metadata.pendingId);
        if (metadata.pendingStatus) node.dataset.pendingStatus = metadata.pendingStatus;
        if (metadata.pendingId !== undefined) node.classList.add('pm-pending-entry');
    }

    function attachQuoteUi(root, bubble, text, senderName, metadata) {
        if (metadata?.quote && !bubble.querySelector('.pm-reply-card')) {
            const card = document.createElement('button');
            card.type = 'button';
            card.className = 'pm-reply-card';
            card.dataset.quoteMessageId = metadata.quote.messageId;
            card.dataset.quoteBubbleId = metadata.quote.bubbleId;
            const sender = document.createElement('span');
            sender.className = 'pm-reply-card-sender';
            sender.textContent = metadata.quote.sender || '群聊消息';
            const snapshot = document.createElement('span');
            snapshot.className = 'pm-reply-card-text';
            snapshot.textContent = metadata.quote.text;
            card.append(sender, snapshot);
            card.addEventListener('click', event => {
                event.stopPropagation();
                if (syncReplyCardAvailability(card)) locateQuotedBubble({
                    messageId: card.dataset.quoteMessageId,
                    bubbleId: card.dataset.quoteBubbleId,
                });
            });
            syncReplyCardAvailability(card);
            bubble.prepend(card);
        }
        if (metadata?.pendingId !== undefined
            || !metadata?.messageId || !metadata?.bubbleId || root.querySelector('.pm-quote-action')) return;
        const action = document.createElement('button');
        action.type = 'button';
        action.className = 'pm-quote-action';
        action.textContent = '引用';
        action.setAttribute('aria-label', `引用${senderName || (metadata.sender || '我')}的消息`);
        action.addEventListener('click', event => {
            event.stopPropagation();
            setActiveQuote({
                messageId: String(metadata.messageId),
                bubbleId: String(metadata.bubbleId),
                sender: String(senderName || metadata.sender || '我'),
                text: String(text || ''),
            });
        });
        root.appendChild(action);
    }

    function addBubble(text, side, senderName, historyIndex, metadata) {
        const list = state.phoneWindow?.querySelector('.pm-msg-list'); if (!list) return [];
        const nodes = createBubbles(text, side, senderName, {
            groupColorMap: state.groupColorMap, groupMembers: state.groupMembers, emojis: window.__pmEmojis,
            emojiBudget: emojiRenderBudget,
        });
        nodes.forEach(b => {
            applyBubbleMetadata(b, metadata);
            if (b.classList?.contains('pm-bubble')) {
                b.dataset.side = side; b.dataset.text = text;
                if (historyIndex !== undefined) b.dataset.historyIndex = historyIndex;
                attachQuoteUi(b, b, text, senderName, metadata);
            } else if (b.classList?.contains('pm-group-bubble-wrap')) {
                b.dataset.side = side; b.dataset.text = text;
                if (historyIndex !== undefined) b.dataset.historyIndex = historyIndex;
                const inner = b.querySelector('.pm-bubble'); if (inner) {
                    applyBubbleMetadata(inner, metadata);
                    inner.dataset.side = side; inner.dataset.text = text;
                    if (historyIndex !== undefined) inner.dataset.historyIndex = historyIndex;
                    attachQuoteUi(b, inner, text, senderName, metadata);
                }
            }
            list.appendChild(b);
        });
        list.scrollTop = list.scrollHeight;
        return nodes;
    }

    function rebaseRenderedHistory(trimmedCount) {
        if (!Number.isInteger(trimmedCount) || trimmedCount <= 0) return;
        const list = state.phoneWindow?.querySelector('.pm-msg-list');
        if (!list) return;
        for (const child of [...list.children]) {
            const indexed = child.dataset.historyIndex !== undefined
                ? child
                : child.querySelector?.('[data-history-index]');
            if (!indexed) continue;
            const previousIndex = Number(indexed.dataset.historyIndex);
            if (!Number.isInteger(previousIndex)) continue;
            if (previousIndex < trimmedCount) {
                child.remove();
                continue;
            }
            const nextIndex = String(previousIndex - trimmedCount);
            if (child.dataset.historyIndex !== undefined) child.dataset.historyIndex = nextIndex;
            child.querySelectorAll?.('[data-history-index]').forEach(node => {
                node.dataset.historyIndex = nextIndex;
            });
        }
        refreshReplyCardAvailability();
    }

    function addNote(text) {
        const list = state.phoneWindow?.querySelector('.pm-msg-list'); if (!list) return;
        const n = document.createElement('div'); n.className = 'pm-note'; n.textContent = text;
        list.appendChild(n); list.scrollTop = list.scrollHeight;
    }
    function addDirector(text, metadata) {
        const list = state.phoneWindow?.querySelector('.pm-msg-list'); if (!list) return null;
        const d = document.createElement('div'); d.className = 'pm-director';
        applyBubbleMetadata(d, metadata);
        d.innerHTML = `<span class="pm-director-icon">🎬</span><span class="pm-director-text">${escapeHtml(text)}</span>`;
        list.appendChild(d); list.scrollTop = list.scrollHeight;
        return d;
    }
    function showTyping() {
        const list = state.phoneWindow?.querySelector('.pm-msg-list');
        if (!list || document.getElementById('pm-typing')) return;
        const t = document.createElement('div'); t.id = 'pm-typing'; t.className = 'pm-bubble pm-left pm-typing-bubble';
        t.innerHTML = '<span></span><span></span><span></span>';
        list.appendChild(t); list.scrollTop = list.scrollHeight;
    }
    function hideTyping() { document.getElementById('pm-typing')?.remove(); }

    function closeOverlay(reason = 'close') {
        const current = document.getElementById('pm-overlay');
        if (!current) return false;
        const onClose = current.__pmOnClose;
        const opener = current.__pmOpener;
        current.remove();
        if (typeof onClose === 'function') onClose(reason);
        if (!['replace', 'phone-close', 'conversation-switch'].includes(reason)
            && opener?.isConnected && typeof opener.focus === 'function') {
            opener.focus({ preventScroll: true });
        }
        return true;
    }

    function makeOverlay(html, options = {}) {
        const previous = document.getElementById('pm-overlay');
        const active = document.activeElement;
        const opener = options.opener || runtime.overlayOpener || previous?.__pmOpener
            || (active && active !== document.body ? active : null);
        runtime.overlayOpener = null;
        closeOverlay('replace');
        const ov = document.createElement('div'); ov.id = 'pm-overlay';
        ov.dataset.theme = window.__pmTheme?.darkMode || 'light';
        if (POPOVER_SUPPORTED) ov.setAttribute('popover', 'manual');
        ov.__pmOnClose = typeof options.onClose === 'function' ? options.onClose : null;
        ov.__pmOpener = opener;
        ov.innerHTML = html;
        ov.addEventListener('click', e => { if (e.target === ov) closeOverlay('backdrop'); });
        document.body.appendChild(ov);
        applyTheme();
        if (ov.showPopover) try { ov.showPopover(); } catch (e) {}
        return ov;
    }
    window.__pmCloseOverlay = () => closeOverlay('close');
    Object.assign(deps, {
        applyTheme, applyBackground, fitNameFont, migrateOldHistory,
        applyBidirectionalInjection, clearBidirectionalInjection, hookGenerationEvent,
        bindIsland, bindPhoneResize, applyPhoneScale,
        addBubble, addNote, addDirector, rebaseRenderedHistory, resetEmojiRenderBudget,
        showTyping, hideTyping, makeOverlay, closeOverlay,
        beginGeneration, isGenerationTaskActive, finishGeneration,
        invalidateGeneration, syncGenerationControls,
        isAutoPokeAllowed, armAutoPoke, disarmAutoPoke,
        beginAutomaticTask, isAutomaticTaskActive, finishAutomaticTask,
        setActiveQuote, clearActiveQuote, renderActiveQuote, findQuotedBubble, locateQuotedBubble,
        refreshReplyCardAvailability,
    });
}