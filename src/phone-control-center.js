import { escapeAttr, escapeHtml } from './ui.js';
import {
    clearPendingMessages, getPendingMessages, removePendingMessage, updatePendingMessage,
} from './pending-messages.js';

export function installPhoneControlCenter(state, deps) {
    const {
        runtime, getStorageId, makeOverlay, parsePendingInput,
        renderPendingConversation, syncGenerationControls,
    } = deps;

    const CONTROL_MENU_ID = 'pm-control-menu';
    let outsideClickHandler = null;
    let escapeKeyHandler = null;

    const getTarget = () => {
        const storageId = state.activeStorageId || getStorageId();
        const saveKey = state.isGroupChat && state.currentGroupKey ? state.currentGroupKey : state.currentPersona;
        return storageId && storageId !== 'sms_unknown__default' && saveKey ? { storageId, saveKey } : null;
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

    function showPendingManager() {
        const target = getTarget();
        if (!sameTarget(editingTarget, target)) editingTarget = null;
        const items = target ? getPendingMessages(runtime, target.storageId, target.saveKey) : [];
        const count = items.length;
        const clearDisabled = !count || items.some(item => item.status === 'submitting');
        makeOverlay(`
<div class="pm-modal pm-pending-manager">
  <div class="pm-modal-header"><b>暂存消息（${count}）</b><button type="button" onclick="window.__pmCloseOverlay()" class="pm-modal-close">关闭</button></div>
  <div id="pm-pending-list" class="pm-pending-list">${renderPendingList()}</div>
  <div class="pm-pending-manager-actions"><button onclick="window.__pmClearPending()" ${clearDisabled ? 'disabled' : ''} title="${clearDisabled && count ? '提交中的暂存不能清空' : '清空当前会话暂存'}">清空暂存</button></div>
</div>`, { onClose: () => { editingTarget = null; } });
    }

    function runControlAction(action) {
        runtime.overlayOpener = state.phoneWindow?.querySelector('.pm-expand-btn') || null;
        closeControlCenter();
        if (action === 'pending') showPendingManager();
        else if (action === 'settings') window.__pmShowConversationSettings();
        else if (action === 'api' || action === 'look' || action === 'budget' || action === 'backup') window.__pmOpenSettingsTab(action);
        else if (action === 'emoji') window.__pmShowEmojiManager();
        else if (action === 'group') window.__pmEditGroup();
        else if (action === 'delete') window.__pmStartDeleteMode();
        else if (action === 'forum') window.__pmOpenForumMode();
    }

    function bindControlMenu(menu, anchor) {
        menu.addEventListener('click', event => {
            const button = event.target.closest('button[data-action]');
            if (!button || !menu.contains(button)) return;
            runControlAction(button.dataset.action);
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
  <button type="button" role="menuitem" data-action="pending">编辑消息</button>
  <button type="button" role="menuitem" data-action="settings">角色设置</button>
  ${state.isGroupChat ? '<button type="button" role="menuitem" data-action="group">群聊设置</button>' : ''}
  <button type="button" role="menuitem" data-action="api">API 设置</button>
  <button type="button" role="menuitem" data-action="look">主题颜色</button>
  <button type="button" role="menuitem" data-action="budget">上下文预算</button>
  <button type="button" role="menuitem" data-action="emoji">表情包管理</button>
  <button type="button" role="menuitem" data-action="backup">数据备份</button>
  <button type="button" role="menuitem" data-action="delete" class="pm-control-menu-danger">删除信息</button>
  <button type="button" role="menuitem" data-action="forum">互动场景</button>`;
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
