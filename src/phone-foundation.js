import {
    POPOVER_SUPPORTED,
} from './constants.js';
import { normalizeBudgetConfig } from './budget.js';
import { THEME_PRESETS } from './config.js';
import { contrastText, cssUrlEscape, escapeHtml } from './ui.js';
import { createBubbles } from './messaging.js';
import { applyContextInjections, clearExtensionPrompts } from './phone-injection.js';
import {
    registerResolvedHostEvent, resolveCommunityMessageEvents, resolveHostEvent,
} from './interactive-scene-scheduler.js';
import { createAutomaticTaskController } from './runtime.js';
import {
    saveBidirectional, saveHistories, saveHistoriesBeforeUnload,
} from './storage.js';

export function installPhoneFoundation(state, deps) {
    const { runtime, getCtx, getStorageId, getUserPersona } = deps;
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
    // 避免重复加载插件时重复注册
    if (!window.__pmBeforeUnloadRegistered) {
        window.addEventListener('beforeunload', saveHistoriesBeforeUnload);
        // TT酒馆(TauriTavern) WebView 在移动端被挂起/切到后台时不触发 beforeunload，
        // 页面隐藏时既要同步保存，也要撤销自动任务运行权；恢复可见不会自动重新授权。
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'hidden') {
                saveHistoriesBeforeUnload();
                deps.cancelCommunityGeneration?.('document-hidden');
                disarmAutoPoke('document-hidden');
            }
        });
        window.__pmBeforeUnloadRegistered = true;
    }

    window.__pmHistories = window.__pmHistories || {};
    window.__pmConfig = window.__pmConfig || { apiUrl: '', apiKey: '', model: '', useIndependent: false };
    window.__pmProfiles = window.__pmProfiles || [];
    window.__pmBidirectional = window.__pmBidirectional || {};
    window.__pmTheme = window.__pmTheme || {
        preset: 'default',
        customRight: '',
        customLeft: '',
        borderColor: '',
        layout: 'standard',
        darkMode: 'light',
        ambientStatusEnabled: false,
    };
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
        const task = Object.freeze({
            id: ++state.generationSequence,
            hostEpoch: state.hostEpoch,
            storageId: id,
            context,
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
        state.hostEpoch += 1;
        state.generationTask = null;
        state.isGenerating = false;
        hideTyping();
        syncGenerationControls();
    }


    function applyTheme() {
        const t = window.__pmTheme || {}, p = THEME_PRESETS[t.preset] || THEME_PRESETS.default;
        const darkMode = t.darkMode || 'light';
        document.getElementById('pm-overlay')?.setAttribute('data-theme', darkMode);
        const el = state.phoneWindow; if (!el) return;
        const rBg = t.customRight || p.right, lBg = t.customLeft || p.left;
        const rTxt = t.customRight ? contrastText(t.customRight) : p.rightText;
        const lTxt = t.customLeft ? contrastText(t.customLeft) : p.leftText;
        const border = t.borderColor || '#1a1a1a';
        el.style.setProperty('--pm-r-bg', rBg); el.style.setProperty('--pm-l-bg', lBg);
        el.style.setProperty('--pm-r-txt', rTxt); el.style.setProperty('--pm-l-txt', lTxt);
        el.style.setProperty('--pm-border', border);
        el.style.setProperty('--pm-frost', p.frost ? '1' : '0');
        el.setAttribute('data-theme', darkMode);
    }

    function applyBackground() {
        const msgList = state.phoneWindow?.querySelector('.pm-msg-list'); if (!msgList) return;
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

    async function applyBidirectionalInjection() {
        const epoch = ++runtime.injectionEpoch;
        const context = getCtx();
        clearExtensionPrompts({ context, runtime });
        const id = getStorageId();
        if (!context || !id || id === 'sms_unknown__default') return;
        const character = context.characters?.[context.characterId];
        const currentActorName = typeof character?.name === 'string' ? character.name.trim() : '';
        if (!currentActorName) return;
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
            selectedByStorage: window.__pmBidirectional,
            historiesByStorage: window.__pmHistories,
            groupsByStorage: window.__pmGroupMeta,
            interactiveStore,
            budgetConfig: window.__pmBudgetConfig,
            userName: getUserPersona().name || '用户',
            emojis: window.__pmEmojis,
        });
    }

    function hookGenerationEvent() {
        if (runtime.eventHooked) return;
        const c = getCtx();
        if (!c?.eventSource || !c?.event_types) return;
        const et = c.event_types;

        runtime.lastChatLength = (c.chat || []).length;

        const events = [
            et.GENERATION_STARTED || 'generation_started',
            resolveHostEvent(et, 'CHAT_CHANGED'),
            et.SETTINGS_UPDATED || 'settings_updated',
            et.CHATCOMPLETION_SOURCE_CHANGED || 'chatcompletion_source_changed',
            et.OAI_PRESET_CHANGED_AFTER || 'oai_preset_changed_after',
        ].filter(Boolean);

        events.forEach(ev => {
            try {
                c.eventSource.on(ev, () => {
                    try { applyBidirectionalInjection(); } catch (e) {}
                });
            } catch (e) {}
        });

        for (const eventName of resolveCommunityMessageEvents(et)) {
            try {
                c.eventSource.on(eventName, () => {
                    try { deps.observeCommunityTurn?.(c.chat || []); } catch (error) {}
                });
            } catch (error) {}
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
        } catch (error) {}
        try {
            registerResolvedHostEvent(c.eventSource, et, 'CHAT_CHANGED', () => {
                runtime.lastChatLength = (c.chat || []).length;
                // 宿主切换会使所有在途生成失效；关闭手机并清空旧会话内存，避免跨聊天串档。
                deps.cancelCommunityGeneration?.('host-chat-changed');
                disarmAutoPoke('host-chat-changed');
                if (state.phoneActive && typeof window.__pmEnd === 'function') {
                    window.__pmEnd(true);
                } else {
                    invalidateGeneration();
                }
            });
        } catch (error) {}

        runtime.eventHooked = true;
        console.log('[phone-mode] hooked', events.length, 'events');
    }

    window.__pmToggleBidirectional = (name) => {
        const id = getStorageId(), arr = window.__pmBidirectional[id] || [], idx = arr.indexOf(name);
        if (idx >= 0) arr.splice(idx, 1);
        else arr.push(name);
        window.__pmBidirectional[id] = arr; saveBidirectional(); applyBidirectionalInjection(); window.__pmShowList();
    };


    function bindIsland(el, handle) {
        let isDragging = false, startX, startY, startTX = 0, startTY = 0, moved = false;
        const getCoord = (e) => e.touches ? { x: e.touches[0].clientX, y: e.touches[0].clientY } : { x: e.clientX, y: e.clientY };
        const getT = () => { const m = (el.style.transform || '').match(/translate\(\s*([-\d.]+)px\s*,\s*([-\d.]+)px/); return m ? { x: parseFloat(m[1]), y: parseFloat(m[2]) } : { x: 0, y: 0 }; };
        const onStart = (e) => {
            if (e.target.tagName === 'BUTTON') return;
            isDragging = true; moved = false;
            const coords = getCoord(e); startX = coords.x; startY = coords.y;
            const t = getT(); startTX = t.x; startTY = t.y;
            el.style.transition = 'none'; if (e.cancelable) e.preventDefault();
        };
        const onMove = (e) => {
            if (!isDragging) return;
            const coords = getCoord(e), dx = coords.x - startX, dy = coords.y - startY;
            if (!moved && Math.abs(dx) < 5 && Math.abs(dy) < 5) return;
            moved = true; if (e.cancelable) e.preventDefault();
            el.style.setProperty('transform', `translate(${startTX + dx}px, ${startTY + dy}px)`, 'important');
        };
        const onEnd = () => { if (!isDragging) return; isDragging = false; el.style.transition = '.35s cubic-bezier(.18,.89,.32,1.2)'; if (!moved) window.__pmToggleMin(); };
        handle.addEventListener('mousedown', onStart); window.addEventListener('mousemove', onMove); window.addEventListener('mouseup', onEnd);
        handle.addEventListener('touchstart', onStart, { passive: false }); window.addEventListener('touchmove', onMove, { passive: false }); window.addEventListener('touchend', onEnd);
    }

    function applyBubbleMetadata(node, metadata) {
        if (!metadata) return;
        if (metadata.historyIndex !== undefined) node.dataset.historyIndex = String(metadata.historyIndex);
        if (metadata.pendingId !== undefined) node.dataset.pendingId = String(metadata.pendingId);
        if (metadata.pendingStatus) node.dataset.pendingStatus = metadata.pendingStatus;
        if (metadata.pendingId !== undefined) node.classList.add('pm-pending-entry');
    }

    function addBubble(text, side, senderName, historyIndex, metadata) {
        const list = state.phoneWindow?.querySelector('.pm-msg-list'); if (!list) return [];
        const nodes = createBubbles(text, side, senderName, {
            groupColorMap: state.groupColorMap, groupMembers: state.groupMembers, emojis: window.__pmEmojis,
        });
        nodes.forEach(b => {
            applyBubbleMetadata(b, metadata);
            if (b.classList?.contains('pm-bubble')) {
                b.dataset.side = side; b.dataset.text = text;
                if (historyIndex !== undefined) b.dataset.historyIndex = historyIndex;
            } else if (b.classList?.contains('pm-group-bubble-wrap')) {
                b.dataset.side = side; b.dataset.text = text;
                if (historyIndex !== undefined) b.dataset.historyIndex = historyIndex;
                const inner = b.querySelector('.pm-bubble'); if (inner) {
                    applyBubbleMetadata(inner, metadata);
                    inner.dataset.side = side; inner.dataset.text = text;
                    if (historyIndex !== undefined) inner.dataset.historyIndex = historyIndex;
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
        if (ov.showPopover) try { ov.showPopover(); } catch (e) {}
        return ov;
    }
    window.__pmCloseOverlay = () => closeOverlay('close');
    Object.assign(deps, {
        applyTheme, applyBackground, fitNameFont, migrateOldHistory,
        applyBidirectionalInjection, clearBidirectionalInjection, hookGenerationEvent, bindIsland,
        addBubble, addNote, addDirector, rebaseRenderedHistory, showTyping, hideTyping, makeOverlay, closeOverlay,
        beginGeneration, isGenerationTaskActive, finishGeneration,
        invalidateGeneration, syncGenerationControls,
        isAutoPokeAllowed, armAutoPoke, disarmAutoPoke,
        beginAutomaticTask, isAutomaticTaskActive, finishAutomaticTask,
    });
}