import { escapeAttr, escapeHtml } from './ui.js';
import {
    BACK_ICON_SVG, CALENDAR_ICON_SVG, CHAT_ICON_SVG, CLOSE_ICON_SVG, CONTACTS_ICON_SVG,
    EDIT_ICON_SVG, EMOJI_ICON_SVG, INJECTION_ICON_SVG, SETTINGS_ICON_SVG, TRASH_ICON_SVG,
} from './icons.js';
import { commitAutoPokeConfig, getAutoPokeConfig } from './auto-poke-config.js';
import {
    clearPendingMessages, getPendingMessages, removePendingMessage, updatePendingMessage,
} from './pending-messages.js';

const controlActionLabel = action => ({
    calendar: '打开日历',
    contacts: '打开联系人',
    'session-behavior': '打开会话行为',
    'auto-poke-toggle': '切换自动发消息',
    'injection-toggle': '切换当前会话注入',
    'injection-settings': '打开上下文注入规则',
})[action] || '执行快捷操作';

export async function toggleConversationInjectionControl(button, toggleInjection, isEnabled) {
    if (button?.disabled) return false;
    if (button) button.disabled = true;
    try {
        const saved = await toggleInjection();
        const enabled = isEnabled() === true;
        if (button?.isConnected) {
            button.setAttribute('aria-checked', String(enabled));
            button.querySelector('.pm-control-toggle')?.classList.toggle('is-checked', enabled);
        }
        return saved;
    } finally {
        if (button?.isConnected) {
            button.disabled = false;
            button.focus({ preventScroll: true });
        }
    }
}

export function runControlMenuAction(action, runAction, reportActionError) {
    const result = runAction(action);
    if (result && typeof result.then === 'function') {
        return result.catch(error => reportActionError(error, action));
    }
    return result;
}

export function installPhoneControlCenter(state, deps) {
    const {
        runtime, getStorageId, makeOverlay, parsePendingInput,
        renderPendingConversation, showPhoneCalendarPage, syncGenerationControls,
    } = deps;

    const CONTROL_MENU_ID = 'pm-control-menu';
    let outsideClickHandler = null;
    let escapeKeyHandler = null;

    const getTarget = () => {
        const storageId = state.activeStorageId || getStorageId();
        const saveKey = state.isGroupChat && state.currentGroupKey ? state.currentGroupKey : state.currentPersona;
        return storageId && storageId !== 'sms_unknown__default' && saveKey ? {
            storageId,
            saveKey,
            isGroup: state.isGroupChat,
        } : null;
    };

    function renderPendingList() {
        const target = getTarget();
        const items = target ? getPendingMessages(runtime, target.storageId, target.saveKey) : [];
        if (!items.length) return '<div class="pm-pending-empty">还没有暂存消息</div>';
        return items.map(item => `
<div class="pm-pending-row" data-item-id="${item.id}">
  ${editingTarget?.itemId === item.id ? `
    <input id="pm-pending-edit-input" class="pm-cfg-input" value="${escapeAttr(item.rawText || item.plainText || `【${item.directorNote}】`)}">
    <button onclick="window.__pmSavePendingEdit(${item.id})">保存</button>
    <button onclick="window.__pmCancelPendingEdit()">取消</button>
  ` : `
    <div class="pm-pending-copy">
      <span class="pm-pending-state" data-status="${item.status}">${item.status === 'failed' ? '提交失败' : item.status === 'submitting' ? '提交中' : '待提交'}</span>
      <div>${escapeHtml(item.rawText || item.plainText || `【${item.directorNote}】`)}</div>
    </div>
    <button onclick="window.__pmEditPending(${item.id})" ${item.status === 'submitting' ? 'disabled' : ''}>编辑</button>
    <button onclick="window.__pmDeletePending(${item.id})" ${item.status === 'submitting' ? 'disabled' : ''}>删除</button>
  `}
</div>`).join('');
    }

    window.__pmRefreshControlCenter = () => {
        const list = document.getElementById('pm-pending-list');
        if (list) list.innerHTML = renderPendingList();
        const target = getTarget();
        const items = target ? getPendingMessages(runtime, target.storageId, target.saveKey) : [];
        const count = items.length;
        const hasSubmitting = items.some(item => item.status === 'submitting');
        const heading = document.querySelector('.pm-pending-manager .pm-modal-header b');
        if (heading) heading.textContent = `暂存消息（${count}）`;
        const clear = document.querySelector('.pm-pending-manager-actions button');
        if (clear) {
            clear.disabled = count === 0 || hasSubmitting;
            clear.title = hasSubmitting ? '提交中的暂存不能清空' : '清空当前会话暂存';
        }
        syncGenerationControls();
    };

    let editingTarget = null;

    function closeControlCenter(restoreFocus = false) {
        document.getElementById(CONTROL_MENU_ID)?.remove();
        if (outsideClickHandler) {
            document.removeEventListener('click', outsideClickHandler, true);
            outsideClickHandler = null;
        }
        if (escapeKeyHandler) {
            document.removeEventListener('keydown', escapeKeyHandler, true);
            escapeKeyHandler = null;
        }
        const anchor = state.phoneWindow?.querySelector('.pm-expand-btn');
        if (anchor) {
            anchor.setAttribute('aria-expanded', 'false');
            if (!restoreFocus) anchor.blur();
        }
        if (restoreFocus) anchor?.focus({ preventScroll: true });
    }

    function showSessionBehaviorPanel() {
        const target = getTarget();
        if (!target) return alert('当前没有可配置的手机会话。');
        makeOverlay(`
<div class="pm-modal pm-modal-wide pm-session-behavior-modal">
  <div class="pm-modal-header"><button type="button" onclick="window.__pmCloseOverlay()" class="pm-modal-close" title="返回" aria-label="返回">${BACK_ICON_SVG}</button><b>会话行为</b><button type="button" onclick="window.__pmCloseOverlay()" class="pm-modal-close" title="关闭" aria-label="关闭">${CLOSE_ICON_SVG}</button></div>
  <div class="pm-modal-scroll pm-session-behavior-body">
    <div class="pm-session-behavior-links">
      <button type="button" onclick="window.__pmShowAutoPokeSettings()">${CHAT_ICON_SVG}<span>自动发消息</span></button>
      <button type="button" onclick="window.__pmShowSessionInjectionSettings()">${INJECTION_ICON_SVG}<span>${target.isGroup ? '注入当前群聊' : '注入当前角色'}</span></button>
      <button type="button" onclick="window.__pmShowConversationInjection()">${INJECTION_ICON_SVG}<span>上下文注入规则</span></button>
      <button type="button" onclick="window.__pmShowConversationSettings()">${SETTINGS_ICON_SVG}<span>${target.isGroup ? '成员聊天行为' : '角色设置'}</span></button>
      ${target.isGroup ? `<button type="button" onclick="window.__pmEditGroup()">${CONTACTS_ICON_SVG}<span>群聊设置</span></button>` : ''}
    </div>
  </div>
</div>`);
    }

    window.__pmShowSessionBehavior = showSessionBehaviorPanel;

    window.__pmShowAutoPokeSettings = (statusMessage = '') => {
        const target = getTarget();
        if (!target) return alert('当前没有可配置的手机会话。');
        const autoPoke = getAutoPokeConfig(target.storageId, target.saveKey);
        makeOverlay(`
<div class="pm-modal pm-modal-wide pm-session-behavior-modal">
  <div class="pm-modal-header"><button type="button" onclick="window.__pmShowSessionBehavior()" class="pm-modal-close" title="返回会话行为" aria-label="返回会话行为">${BACK_ICON_SVG}</button><b>自动发消息</b><button type="button" onclick="window.__pmCloseOverlay()" class="pm-modal-close" title="关闭" aria-label="关闭">${CLOSE_ICON_SVG}</button></div>
  <div class="pm-modal-scroll pm-session-behavior-body">
    <div id="pm-session-auto-poke-status" class="pm-session-behavior-status" role="status" aria-live="polite" ${statusMessage ? '' : 'hidden'}>${escapeHtml(statusMessage)}</div>
    <section class="pm-session-behavior-section">
      <button id="pm-session-auto-poke" type="button" class="pm-session-behavior-toggle" role="checkbox" aria-checked="${autoPoke.enabled}" onclick="window.__pmToggleCurrentAutoPoke(this)">
        ${CHAT_ICON_SVG}<span><b>允许当前会话主动发消息</b><small>连续多轮没有输入时触发。</small></span><i class="pm-control-toggle ${autoPoke.enabled ? 'is-checked' : ''}" aria-hidden="true"></i>
      </button>
      <label class="pm-session-auto-poke-interval">每隔 <input id="pm-session-auto-poke-interval" type="number" min="1" max="99" value="${autoPoke.interval}" ${autoPoke.enabled ? '' : 'disabled'} onchange="window.__pmSaveCurrentAutoPokeInterval(this)"> 轮无输入触发</label>
      <p id="pm-session-auto-poke-counter">当前计数：${autoPoke.counter} / ${autoPoke.interval}</p>
    </section>
  </div>
</div>`);
    };

    window.__pmShowSessionInjectionSettings = () => {
        const target = getTarget();
        if (!target) return alert('当前没有可配置的手机会话。');
        const enabled = window.__pmCurrentConversationInjectionEnabled?.() === true;
        const label = target.isGroup ? '注入当前群聊' : '注入当前角色';
        makeOverlay(`
<div class="pm-modal pm-modal-wide pm-session-behavior-modal">
  <div class="pm-modal-header"><button type="button" onclick="window.__pmShowSessionBehavior()" class="pm-modal-close" title="返回会话行为" aria-label="返回会话行为">${BACK_ICON_SVG}</button><b>${label}</b><button type="button" onclick="window.__pmCloseOverlay()" class="pm-modal-close" title="关闭" aria-label="关闭">${CLOSE_ICON_SVG}</button></div>
  <div class="pm-modal-scroll pm-session-behavior-body"><section class="pm-session-behavior-section"><button id="pm-session-injection-toggle" type="button" class="pm-session-behavior-toggle" role="checkbox" aria-checked="${enabled}" onclick="window.__pmToggleSessionInjection(this)">${INJECTION_ICON_SVG}<span><b>把当前手机短信记录写入角色上下文</b><small>只有当前角色可读取这段私密短信记忆。</small></span><i class="pm-control-toggle ${enabled ? 'is-checked' : ''}" aria-hidden="true"></i></button></section></div>
</div>`);
    };

    window.__pmToggleCurrentAutoPoke = button => {
        if (button?.disabled) return false;
        const target = getTarget();
        if (!target) return false;
        const current = getAutoPokeConfig(target.storageId, target.saveKey);
        button.disabled = true;
        button.setAttribute('aria-busy', 'true');
        const saved = commitAutoPokeConfig(target.storageId, target.saveKey, { enabled: !current.enabled });
        if (!saved) {
            button.disabled = false;
            button.removeAttribute('aria-busy');
            alert('自动发消息设置保存失败：浏览器存储不可用或空间不足。');
            button.focus({ preventScroll: true });
            return false;
        }
        window.__pmShowAutoPokeSettings(current.enabled ? '已关闭自动发消息。' : '已开启自动发消息。');
        document.getElementById('pm-session-auto-poke')?.focus({ preventScroll: true });
        return true;
    };

    window.__pmSaveCurrentAutoPokeInterval = input => {
        const target = getTarget();
        if (!target || !input) return false;
        const interval = Math.max(1, Math.min(99, Number.parseInt(input.value, 10) || 3));
        input.disabled = true;
        input.setAttribute('aria-busy', 'true');
        if (!commitAutoPokeConfig(target.storageId, target.saveKey, { interval })) {
            alert('自动发消息间隔保存失败：浏览器存储不可用或空间不足。');
            window.__pmShowAutoPokeSettings('自动发消息间隔保存失败，已恢复原设置。');
            document.getElementById('pm-session-auto-poke-interval')?.focus({ preventScroll: true });
            return false;
        }
        window.__pmShowAutoPokeSettings(`已保存：每隔 ${interval} 轮无输入触发。`);
        document.getElementById('pm-session-auto-poke-interval')?.focus({ preventScroll: true });
        return true;
    };

    window.__pmToggleSessionInjection = button => toggleConversationInjectionControl(
        button, window.__pmToggleCurrentConversationInjection,
        () => window.__pmCurrentConversationInjectionEnabled?.() === true,
    );

    function showPendingManager() {
        const target = getTarget();
        if (!sameTarget(editingTarget, target)) editingTarget = null;
        const items = target ? getPendingMessages(runtime, target.storageId, target.saveKey) : [];
        const count = items.length;
        const clearDisabled = !count || items.some(item => item.status === 'submitting');
        makeOverlay(`
<div class="pm-modal pm-pending-manager">
  <div class="pm-modal-header"><span></span><b>暂存消息（${count}）</b><button type="button" onclick="window.__pmCloseOverlay()" class="pm-modal-close" title="关闭" aria-label="关闭">${CLOSE_ICON_SVG}</button></div>
  <div id="pm-pending-list" class="pm-pending-list">${renderPendingList()}</div>
  <div class="pm-pending-manager-actions"><button onclick="window.__pmClearPending()" ${clearDisabled ? 'disabled' : ''} title="${clearDisabled && count ? '提交中的暂存不能清空' : '清空当前会话暂存'}">清空暂存</button></div>
</div>`, { onClose: () => { editingTarget = null; } });
    }

    function runControlAction(action, button = null) {
        runtime.overlayOpener = state.phoneWindow?.querySelector('.pm-expand-btn') || null;
        closeControlCenter();
        if (action === 'pending') showPendingManager();
        else if (action === 'session-behavior') showSessionBehaviorPanel();
        else if (action === 'injection-settings') return window.__pmShowConversationInjection();
        else if (action === 'contacts') return window.__pmShowList();
        else if (action === 'emoji') window.__pmShowEmojiManager();
        else if (action === 'delete') window.__pmStartDeleteMode();
        else if (action === 'calendar') return showPhoneCalendarPage();
    }

    function bindControlMenu(menu, anchor) {
        menu.addEventListener('click', event => {
            const button = event.target.closest('button[data-action]');
            if (!button || !menu.contains(button) || button.disabled) return;
            runControlMenuAction(button.dataset.action, action => runControlAction(action, button), (error, action) => {
                alert(`${controlActionLabel(action)}失败：${error?.message || '未知错误'}`);
            });
        });
        outsideClickHandler = event => {
            if (menu.contains(event.target) || anchor.contains(event.target)) return;
            closeControlCenter();
        };
        escapeKeyHandler = event => {
            if (event.key === 'Escape') closeControlCenter(true);
        };
        document.addEventListener('click', outsideClickHandler, true);
        document.addEventListener('keydown', escapeKeyHandler, true);
    }

    function sameTarget(left, right) {
        return !!left && !!right
            && left.storageId === right.storageId
            && left.saveKey === right.saveKey;
    }

    window.__pmShowControlCenter = () => {
        const existing = document.getElementById(CONTROL_MENU_ID);
        if (existing) { closeControlCenter(); return; }
        const phone = state.phoneWindow;
        const anchor = phone?.querySelector('.pm-expand-btn');
        if (!phone || !anchor || state.isMinimized) return;
        const menu = document.createElement('div');
        menu.id = CONTROL_MENU_ID;
        menu.className = 'pm-control-menu';
        menu.setAttribute('role', 'menu');
        menu.setAttribute('aria-label', '快捷工具');
        menu.innerHTML = `
  <button type="button" role="menuitem" data-action="pending">${EDIT_ICON_SVG}编辑消息</button>
  <button type="button" role="menuitem" data-action="contacts">${CONTACTS_ICON_SVG}联系人</button>
  <button type="button" role="menuitem" data-action="session-behavior">${SETTINGS_ICON_SVG}会话行为</button>
  <button type="button" role="menuitem" data-action="emoji">${EMOJI_ICON_SVG}表情包管理</button>
  <button type="button" role="menuitem" data-action="calendar">${CALENDAR_ICON_SVG}日历</button>
  <button type="button" role="menuitem" data-action="delete" class="pm-control-menu-danger">${TRASH_ICON_SVG}删除信息</button>`;
        phone.appendChild(menu);
        const phoneRect = phone.getBoundingClientRect();
        const anchorRect = anchor.getBoundingClientRect();
        const desiredLeft = anchorRect.left - phoneRect.left;
        const maxLeft = Math.max(8, phone.clientWidth - menu.offsetWidth - 8);
        menu.style.left = `${Math.min(Math.max(8, desiredLeft), maxLeft)}px`;
        menu.style.bottom = `${Math.max(8, phoneRect.bottom - anchorRect.top + 8)}px`;
        const availableHeight = Math.max(72, anchorRect.top - phoneRect.top - 16);
        menu.style.maxHeight = `${availableHeight}px`;
        anchor.setAttribute('aria-expanded', 'true');
        bindControlMenu(menu, anchor);
        menu.querySelector('button')?.focus({ preventScroll: true });
    };

    window.__pmOpenSettingsTab = tab => window.__pmShowConfig(tab);
    window.__pmStartDeleteMode = () => { window.__pmCloseOverlay(); window.__pmToggleSelect(); };

    function redrawPendingConversation() {
        const target = getTarget();
        if (target) renderPendingConversation(target.storageId, target.saveKey);
    }

    window.__pmEditPending = itemId => {
        const target = getTarget();
        if (!target) return;
        const item = getPendingMessages(runtime, target.storageId, target.saveKey)
            .find(candidate => candidate.id === itemId);
        if (!item || item.status === 'submitting') return;
        editingTarget = { ...target, itemId };
        window.__pmRefreshControlCenter();
        const input = document.getElementById('pm-pending-edit-input');
        input?.focus();
        if (input) input.selectionStart = input.selectionEnd = input.value.length;
    };

    window.__pmSavePendingEdit = itemId => {
        const target = getTarget();
        const input = document.getElementById('pm-pending-edit-input');
        if (!sameTarget(editingTarget, target) || editingTarget.itemId !== itemId || !input) return;
        const parsed = parsePendingInput(input.value);
        if (!parsed || !updatePendingMessage(runtime, target.storageId, target.saveKey, itemId, parsed)) return;
        editingTarget = null;
        redrawPendingConversation();
        window.__pmRefreshControlCenter();
    };

    window.__pmCancelPendingEdit = () => {
        editingTarget = null;
        window.__pmRefreshControlCenter();
    };

    window.__pmDeletePending = itemId => {
        const target = getTarget();
        if (!target) return;
        if (!removePendingMessage(runtime, target.storageId, target.saveKey, itemId)) return;
        if (sameTarget(editingTarget, target) && editingTarget.itemId === itemId) editingTarget = null;
        redrawPendingConversation();
        window.__pmRefreshControlCenter();
    };

    window.__pmClearPending = () => {
        const target = getTarget();
        if (!target) return;
        const items = getPendingMessages(runtime, target.storageId, target.saveKey);
        if (items.some(item => item.status === 'submitting')) return;
        clearPendingMessages(runtime, target.storageId, target.saveKey);
        if (sameTarget(editingTarget, target)) editingTarget = null;
        redrawPendingConversation();
        window.__pmRefreshControlCenter();
    };
    window.__pmResetPendingEditor = () => { editingTarget = null; };

    Object.assign(deps, { closeControlCenter });
}
