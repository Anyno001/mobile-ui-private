import { POPOVER_SUPPORTED } from './constants.js';
import { escapeHtml } from './ui.js';
import {
    CLOSE_ICON_SVG, CONTROL_ICON_SVG, HOME_ICON_SVG,
    MENU_ICON_SVG, POKE_ICON_SVG, SEND_ICON_SVG,
} from './icons.js';
import { getPendingMessages } from './pending-messages.js';
import { bindPressGesture } from './press-gesture.js';
import {
    loadBgSettings, loadBidirectional, loadBudgetConfig, loadEmojis,
    loadCharacterBehavior, loadGroupMeta, loadHistoriesFromIDB,
    loadPokeConfig, loadProfiles, loadTheme, loadWordyLimit, saveTheme,
} from './storage.js';

export function createAmbientStatusController({
    getTheme,
    persistTheme,
    getBar,
    isSuspended = () => false,
    setTimer = (callback, delay) => setInterval(callback, delay),
    clearTimer = timer => clearInterval(timer),
    formatTime = date => new Intl.DateTimeFormat([], {
        hour: '2-digit', minute: '2-digit',
    }).format(date),
    now = () => new Date(),
}) {
    let timer = null;

    const stop = () => {
        if (timer !== null) clearTimer(timer);
        timer = null;
    };

    const sync = () => {
        const bar = getBar();
        if (!bar) {
            stop();
            return false;
        }
        const enabled = getTheme()?.ambientStatusEnabled === true;
        bar.hidden = !enabled;
        stop();
        if (!enabled || isSuspended()) return false;
        const updateClock = () => {
            const clock = bar.querySelector?.('.pm-status-time');
            if (clock) clock.textContent = formatTime(now());
        };
        updateClock();
        timer = setTimer(updateClock, 30000);
        return true;
    };

    const setEnabled = enabled => {
        const theme = getTheme();
        const previous = theme?.ambientStatusEnabled === true;
        theme.ambientStatusEnabled = enabled === true;
        try {
            if (persistTheme() === false) throw new Error('persist-failed');
        } catch (error) {
            theme.ambientStatusEnabled = previous;
            return false;
        }
        return true;
    };

    return { setEnabled, stop, sync };
}

export function createPhonePageController({ getRoot, closeTransientUi = () => {} }) {
    const pages = new Set(['desktop', 'chat', 'community']);
    const show = page => {
        const targetPage = pages.has(page) ? page : 'desktop';
        const root = getRoot();
        const main = root?.querySelector('.pm-main-ui');
        if (!main) return false;
        closeTransientUi();
        main.dataset.page = targetPage;
        main.querySelectorAll('[data-phone-page]').forEach(section => {
            section.hidden = section.dataset.phonePage !== targetPage;
        });
        return true;
    };
    const current = () => getRoot()?.querySelector('.pm-main-ui')?.dataset.page || null;
    return { current, show };
}

export function installPhoneLifecycle(state, deps) {
    const {
        runtime, getCtx, getStorageId, applyBidirectionalInjection, persistCurrentHistory,
        clearBidirectionalInjection,
        applyBackground, applyTheme, bindIsland, migrateOldHistory, hookGenerationEvent,
        invalidateGeneration, disarmAutoPoke, syncGenerationControls, closeOverlay, closeControlCenter,
    } = deps;
    let unbindSendGesture = null;
    const pageController = createPhonePageController({ getRoot: () => state.phoneWindow, closeTransientUi: () => closeControlCenter?.() });
    const ambientStatus = createAmbientStatusController({
        getTheme: () => window.__pmTheme,
        persistTheme: saveTheme,
        getBar: () => state.phoneWindow?.querySelector('.pm-status-bar') || null,
        isSuspended: () => state.isMinimized,
    });

    window.__pmSetAmbientStatus = (enabled) => {
        const previous = window.__pmTheme?.ambientStatusEnabled === true;
        if (!ambientStatus.setEnabled(enabled)) {
            const input = document.getElementById('pm-ambient-status-enabled');
            if (input) input.checked = previous;
            alert('状态栏设置保存失败：浏览器存储不可用。');
            ambientStatus.sync();
            return false;
        }
        ambientStatus.sync();
        return true;
    };

    window.__pmToggleSelect = () => {
        state.isSelectMode = !state.isSelectMode;
        const list = state.phoneWindow?.querySelector('.pm-msg-list');
        const confirmBar = state.phoneWindow?.querySelector('.pm-confirm-bar');
        if (!list) return;
        if (state.isSelectMode) {
            if (confirmBar) confirmBar.style.display = 'flex';
            // 气泡上已在渲染时打好 data-history-index，直接读取，无需事后映射
            list.querySelectorAll('.pm-bubble, .pm-group-bubble-wrap, .pm-director')
                .forEach(b => {
                if (b.id === 'pm-typing' || b.closest('.pm-select-wrap') || b.closest('.pm-pending-entry')) return;
                const isDirector = b.classList.contains('pm-director');
                const wrap = document.createElement('div'); wrap.className = 'pm-select-wrap';
                const side = isDirector ? 'center' : (b.dataset.side || 'left');
                wrap.style.cssText = 'display:flex;align-items:center;gap:8px;align-self:' + (side === 'right' ? 'flex-end' : side === 'center' ? 'center' : 'flex-start') + ';';
                const cb = document.createElement('div'); cb.className = 'pm-custom-check'; cb.dataset.checked = '0';
                cb.style.cssText = 'width:22px;height:22px;min-width:22px;min-height:22px;border-radius:50%;flex-shrink:0;cursor:pointer;';
                cb.onclick = () => {
                    const checked = cb.dataset.checked === '0' ? '1' : '0';
                    const historyIndex = wrap.dataset.historyIndex;
                    if (historyIndex === undefined || historyIndex === '') {
                        cb.dataset.checked = checked;
                        return;
                    }
                    list.querySelectorAll(`.pm-select-wrap[data-history-index="${historyIndex}"] .pm-custom-check`)
                        .forEach(peer => { peer.dataset.checked = checked; });
                };
                b.parentNode.insertBefore(wrap, b);
                wrap.appendChild(cb); wrap.appendChild(b);
                wrap.dataset.side = side; wrap.dataset.text = b.dataset.text || '';
                // 直接从气泡上读下标，渲染时已打好
                const hi = b.dataset.historyIndex;
                if (hi !== undefined && hi !== '') wrap.dataset.historyIndex = hi;
            });
        } else {
            if (confirmBar) confirmBar.style.display = 'none';
            list.querySelectorAll('.pm-select-wrap').forEach(wrap => {
                const b = wrap.querySelector('.pm-bubble, .pm-group-bubble-wrap, .pm-director');
                if (b) wrap.parentNode.insertBefore(b, wrap); wrap.remove();
            });
        }
    };

    window.__pmDeleteSelected = () => {
        const list = state.phoneWindow?.querySelector('.pm-msg-list'); if (!list) return;
        // 按 data-history-index 收集要删除的下标（精确，不依赖文本匹配）
        const toRemoveIndices = new Set();
        list.querySelectorAll('.pm-select-wrap').forEach(wrap => {
            const cb = wrap.querySelector('.pm-custom-check');
            if (cb?.dataset.checked === '1') {
                const hi = wrap.dataset.historyIndex;
                if (hi !== undefined && hi !== '') toRemoveIndices.add(Number(hi));
            }
        });
        list.querySelectorAll('.pm-select-wrap').forEach(wrap => {
            const hi = wrap.dataset.historyIndex;
            if (hi !== undefined && hi !== '' && toRemoveIndices.has(Number(hi))) {
                wrap.remove();
            } else {
                const b = wrap.querySelector('.pm-bubble, .pm-group-bubble-wrap, .pm-director');
                if (b) wrap.parentNode.insertBefore(b, wrap);
                wrap.remove();
            }
        });
        if (toRemoveIndices.size > 0) {
            state.conversationHistory = state.conversationHistory.filter((_, i) => !toRemoveIndices.has(i));
            persistCurrentHistory();
            applyBidirectionalInjection();
        }
        state.isSelectMode = false;
        const bar = state.phoneWindow?.querySelector('.pm-confirm-bar'); if (bar) bar.style.display = 'none';
    };

    window.__pmToggleMin = () => {
        closeControlCenter?.();
        state.isMinimized = !state.isMinimized;
        if (state.isMinimized) {
            deps.cancelCommunityGeneration?.('phone-minimized');
            disarmAutoPoke('phone-minimized');
        }
        state.phoneWindow.classList.toggle('is-min', state.isMinimized);
        state.phoneWindow.style.removeProperty('transform');
        if (state.isMinimized) ambientStatus.stop(); else ambientStatus.sync();
    };
    window.__pmEnd = (force = false) => {
        // 修复：关闭前先把当前 state.conversationHistory 存档
        // 空历史也必须落盘，否则删除最后一条消息后直接关闭会让旧历史在下次打开时复活。
        if (!force) {
            if (state.currentPersona) persistCurrentHistory();
            try {
                deps.persistPhoneUiSnapshot?.();
            } catch (error) {
                console.error('[phone-mode] 手机页面状态保存失败', error);
            }
        }
        clearBidirectionalInjection();
        deps.cancelCommunityGeneration?.('phone-closed');
        disarmAutoPoke('phone-closed');
        invalidateGeneration();
        ambientStatus.stop();
        unbindSendGesture?.();
        unbindSendGesture = null;
        closeControlCenter?.();
        closeOverlay('phone-close');
        if (state.phoneWindow) { try { state.phoneWindow.hidePopover?.(); } catch (e) {} state.phoneWindow.remove(); }
        state.phoneWindow = null; state.phoneActive = false; state.isMinimized = false; state.isSelectMode = false;
        state.activeStorageId = '';
        state.currentPersona = '';
        state.conversationHistory = [];
        state.isGroupChat = false; state.groupMembers = []; state.groupColorMap = {}; state.groupDisplayName = ''; state.currentGroupKey = '';
        // 修复：关闭时重置冷启动标记，确保下次打开时（尤其是切换角色卡后）重新从 IDB 加载最新数据
        runtime.firstOpen = true;
        // 修复：关闭时清除可见性定时器，重新开启时再创建新的
        if (runtime.visibilityTimer) { clearInterval(runtime.visibilityTimer); runtime.visibilityTimer = null; }
    };

    function loadHistoriesOnce() {
        if (!runtime.historyLoadPromise) {
            runtime.historyLoadPromise = loadHistoriesFromIDB();
        }
        return runtime.historyLoadPromise;
    }

    function ensureVisibility() {
        if (!state.phoneWindow) return;
        const cs = getComputedStyle(state.phoneWindow);
        if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity || '1') < 0.1) {
            state.phoneWindow.style.setProperty('display', 'flex', 'important');
            state.phoneWindow.style.setProperty('visibility', 'visible', 'important');
            state.phoneWindow.style.setProperty('opacity', '1', 'important');
        }
    }
    // 修复：保存定时器 ID，在 __pmEnd 时清除，避免永久泄漏
    runtime.visibilityTimer = setInterval(ensureVisibility, 2000);

    window.__pmOpen = async () => {
        if (state.phoneActive && state.phoneWindow) { try { state.phoneWindow.showPopover?.(); } catch (e) {} state.phoneWindow.style.display = 'flex'; ensureVisibility(); return; }
        // 修复：删除每次打开都用 localStorage 覆盖内存的逻辑
        // localStorage 因容量限制可能保存的是旧数据，而内存和 IDB 才是最新的
        // 冷启动时（内存为空）靠 loadHistoriesFromIDB() 从 IDB 加载后再渲染
        if (!runtime.visibilityTimer) runtime.visibilityTimer = setInterval(ensureVisibility, 2000);
        try {
            const saved = JSON.parse(localStorage.getItem('ST_SMS_CONFIG'));
            window.__pmConfig = saved || { apiUrl: '', apiKey: '', model: '', useIndependent: false };
            if (typeof window.__pmConfig.useIndependent === 'undefined') window.__pmConfig.useIndependent = !!(window.__pmConfig.apiUrl && window.__pmConfig.apiKey);
        } catch (e) { window.__pmConfig = { apiUrl: '', apiKey: '', model: '', useIndependent: false }; }
        loadProfiles(); loadBidirectional(); loadTheme(); loadPokeConfig(); loadCharacterBehavior(); loadWordyLimit(); loadBudgetConfig(); migrateOldHistory();
        await Promise.all([loadGroupMeta(), loadEmojis()]);
        loadBgSettings().then(() => { try { applyBackground(); } catch (e) {} });
        hookGenerationEvent();
        const c = getCtx(), defaultChar = c?.characters?.[c.characterId]?.name ?? 'AI';

        state.phoneWindow = document.createElement('div'); state.phoneWindow.id = 'pm-iphone';
        state.phoneWindow.dataset.layout = window.__pmTheme.layout || 'standard';
        state.phoneWindow.setAttribute('data-theme', window.__pmTheme.darkMode || 'light');
        if (POPOVER_SUPPORTED) state.phoneWindow.setAttribute('popover', 'manual');

        state.phoneWindow.innerHTML = `
<div class="pm-island"></div>
<div class="pm-status-bar" aria-label="设备本地状态" ${window.__pmTheme.ambientStatusEnabled === true ? '' : 'hidden'}><span class="pm-status-time"></span><span>本地</span></div>
<div class="pm-main-ui" data-page="chat">
  <section class="pm-phone-page pm-chat-page" data-phone-page="chat">
    <div class="pm-navbar">
      <button onclick="window.__pmShowList()" class="pm-nav-btn pm-nav-left-btn" title="联系人">${MENU_ICON_SVG}</button>
      <div class="pm-name-wrap">
        <div class="pm-name">${escapeHtml(defaultChar)}</div>
        <button onclick="window.__pmPokeCurrent()" class="pm-name-edit is-hidden" title="拍一拍" aria-label="拍一拍当前会话">${POKE_ICON_SVG}</button>
      </div>
      <div class="pm-nav-right">
        <button onclick="window.__pmShowPhonePage('desktop')" class="pm-nav-btn" title="返回桌面" aria-label="返回桌面">${HOME_ICON_SVG}</button>
        <button onclick="window.__pmEnd()" class="pm-nav-btn pm-close-btn" title="退出手机" aria-label="退出手机">${CLOSE_ICON_SVG}</button>
      </div>
    </div>
    <div class="pm-confirm-bar" style="display:none;">
      <span class="pm-confirm-tip">选择要删除的消息</span>
      <button onclick="window.__pmDeleteSelected()" class="pm-confirm-btn">删除所选</button>
      <button onclick="window.__pmToggleSelect()" class="pm-cancel-btn">取消</button>
    </div>
    <div class="pm-msg-list"></div>
    <div class="pm-input-bar">
      <button type="button" onclick="window.__pmShowControlCenter()" class="pm-expand-btn" title="快捷工具" aria-haspopup="menu" aria-expanded="false">${CONTROL_ICON_SVG}</button>
      <input class="pm-input" placeholder="输入后加入暂存">
      <button type="button" class="pm-up-btn" title="点击加入暂存，长按最终提交给 AI">${SEND_ICON_SVG}</button>
    </div>
  </section>
  <section class="pm-phone-page pm-desktop-page" data-phone-page="desktop" hidden></section>
  <section class="pm-phone-page pm-community-page" data-phone-page="community" hidden></section>
</div>`;
        document.body.appendChild(state.phoneWindow);
        window.__pmShowPhonePage = pageController.show;
        deps.bindPhonePageUi?.(state.phoneWindow);
        ambientStatus.sync();
        if (state.phoneWindow.showPopover) try { state.phoneWindow.showPopover(); } catch (e) {}
        state.phoneActive = true;
        state.isMinimized = false;
        syncGenerationControls();
        state.phoneWindow.querySelector('.pm-input').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); window.__pmSend(); } });
        const sendButton = state.phoneWindow.querySelector('.pm-up-btn');
        unbindSendGesture = bindPressGesture(sendButton, {
            delay: 550,
            onPress: () => window.__pmSend(),
            onHold: () => {
                const storageId = state.activeStorageId || getStorageId();
                const saveKey = state.isGroupChat && state.currentGroupKey ? state.currentGroupKey : state.currentPersona;
                const pending = storageId && saveKey ? getPendingMessages(runtime, storageId, saveKey) : [];
                if (!pending.length) {
                    alert('当前会话还没有暂存消息。');
                    return;
                }
                if (state.isGenerating) {
                    alert('AI 正在回复，请等待当前回复结束后再最终提交。');
                    return;
                }
                if (confirm('确认将当前会话的全部暂存消息最终提交给 AI？')) {
                    window.__pmSubmitPending();
                }
            },
        });
        bindIsland(state.phoneWindow, state.phoneWindow.querySelector('.pm-island'));
        applyTheme(); state.isGroupChat = false; state.groupMembers = []; state.groupColorMap = {}; state.groupDisplayName = ''; state.currentGroupKey = '';


        if (!runtime.firstOpen) {
            window.__pmSwitch(defaultChar, undefined, undefined, { preservePage: true });
            await deps.restorePhoneUi?.();
            applyBidirectionalInjection(); ensureVisibility();
        } else {
            // ❄️ 冷启动：第一次打开，先占位，等外部的 IDB 把最新数据拉进内存再渲染
            runtime.firstOpen = false; // 翻转标记，此后不刷新就不会再走这里
            const list = state.phoneWindow?.querySelector('.pm-msg-list');
            if (list) { list.innerHTML = '<div style="text-align:center;color:#aaa;padding:20px;font-size:13px;">正在加载历史记录…</div>'; }

            // 冷启动：历史记录需要从 IDB 加载完才能正确渲染。
            const historyLoad = loadHistoriesOnce();
            const openingWindow = state.phoneWindow;
            Promise.all([historyLoad])
                .then(async () => {
                    if (!state.phoneActive || state.phoneWindow !== openingWindow) return;
                    window.__pmSwitch(defaultChar, undefined, undefined, { preservePage: true });
                    await deps.restorePhoneUi?.();
                    applyBidirectionalInjection(); ensureVisibility();
                })
                .catch(error => { console.error('[phone-mode] 手机页面恢复失败', error); })
                .finally(() => {
                    if (runtime.historyLoadPromise === historyLoad) runtime.historyLoadPromise = null;
                });
        }
    };



    function registerPhoneCommand() {
        const ctx = getCtx(); if (!ctx) return false;
        const cb = () => { try { window.__pmOpen(); } catch (e) { console.error('[phone-mode]', e); } return ''; };
        try {
            const SCP = window.SlashCommandParser || ctx.SlashCommandParser, SC = window.SlashCommand || ctx.SlashCommand;
            if (SCP && SC && typeof SCP.addCommandObject === 'function' && typeof SC.fromProps === 'function') { SCP.addCommandObject(SC.fromProps({ name: 'phone', callback: cb, helpString: '打开天音小笺' })); return true; }
        } catch (e) {}
        try { if (typeof ctx.registerSlashCommand === 'function') { ctx.registerSlashCommand('phone', cb, [], '打开天音小笺', true, true); return true; } } catch (e) {}
        return false;
    }
    if (!registerPhoneCommand()) { let t = 0; const i = setInterval(() => { t++; if (registerPhoneCommand() || t >= 30) clearInterval(i); }, 500); }

    document.addEventListener('keydown', e => {
        if (e.key !== 'Enter' || e.shiftKey) return;
        const ta = document.getElementById('send_textarea');
        if (!ta || document.activeElement !== ta) return;
        if (ta.value.trim() === '/phone') { e.preventDefault(); e.stopImmediatePropagation(); ta.value = ''; window.__pmOpen(); }
    }, true);
    document.addEventListener('click', e => {
        const btn = e.target.closest?.('#send_but'); if (!btn) return;
        const ta = document.getElementById('send_textarea'); if (!ta) return;
        if (ta.value.trim() === '/phone') { e.preventDefault(); e.stopImmediatePropagation(); ta.value = ''; window.__pmOpen(); }
    }, true);

    try { window.__pmHistories = window.__pmHistories || {}; } catch (e) {}
    loadBidirectional(); loadPokeConfig(); loadCharacterBehavior(); loadWordyLimit(); loadBudgetConfig();
    const initialGroupMetaLoad = loadGroupMeta();
    loadHistoriesOnce(); // 首次打开复用同一个恢复任务，避免并发读取用旧快照覆盖内存
    setTimeout(() => { initialGroupMetaLoad.then(() => { migrateOldHistory(); applyBidirectionalInjection(); hookGenerationEvent(); }); }, 1500);

    console.log('[phone-mode] v9.5.7 已加载：世界书预算改为读取ST实际上下文窗口大小');
}
