import { escapeAttr, escapeHtml } from './ui.js';
import { resolveConversationTarget } from './conversation.js';
import {
    BACK_ICON_SVG, CALENDAR_ICON_SVG, CHARACTER_ICON_SVG, CHAT_ICON_SVG, CLOSE_ICON_SVG,
    EDIT_ICON_SVG, EMOJI_ICON_SVG, TRASH_ICON_SVG,
} from './icons.js';
import { commitAutoPokeConfig, getAutoPokeConfig } from './auto-poke-config.js';
import {
    clearPendingMessages, getPendingMessages, removePendingMessage, updatePendingMessage,
} from './pending-messages.js';

const controlActionLabel = action => ({
    calendar: '打开日历',
    settings: '打开角色设置',
    'auto-poke': '打开自动发消息',
    delete: '进入消息删除模式',
})[action] || '执行快捷操作';

export function runControlMenuAction(action, runAction, reportActionError) {
    const result = runAction(action);
    if (result && typeof result.then === 'function') {
        return result.catch(error => reportActionError(error, action));
    }
    return result;
}

export function installPhoneControlCenter(state, deps) {
    const {
        runtime, getStorageId, makeOverlay, closeOverlay, parsePendingInput,
        renderPendingConversation, showPhoneCalendarPage, syncGenerationControls,
    } = deps;

    const CONTROL_MENU_ID = 'pm-control-menu';
    let outsideClickHandler = null;
    let escapeKeyHandler = null;

    const getTarget = () => resolveConversationTarget(state, getStorageId);

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

    window.__pmReturnToControlCenter = () => {
        closeOverlay?.('replace');
        window.__pmShowControlCenter();
    };

    window.__pmShowAutoPokeSettings = (statusMessage = '') => {
        const target = getTarget();
        if (!target) return alert('当前没有可配置的手机会话。');
        const autoPoke = getAutoPokeConfig(target.storageId, target.saveKey);
        makeOverlay(`
<div class="pm-modal pm-modal-wide pm-session-behavior-modal">
  <div class="pm-modal-header"><button type="button" onclick="window.__pmReturnToControlCenter()" class="pm-modal-close" title="返回快捷工具" aria-label="返回快捷工具">${BACK_ICON_SVG}</button><b>自动发消息</b><button type="button" onclick="window.__pmCloseOverlay()" class="pm-modal-close" title="关闭" aria-label="关闭">${CLOSE_ICON_SVG}</button></div>
  <div class="pm-modal-scroll pm-session-behavior-body">
    <div id="pm-session-auto-poke-status" class="pm-session-behavior-status" role="status" aria-live="polite" ${statusMessage ? '' : 'hidden'}>${escapeHtml(statusMessage)}</div>
    <section class="pm-session-behavior-section">
      <button id="pm-session-auto-poke" type="button" class="pm-session-behavior-toggle" role="checkbox" aria-checked="${autoPoke.enabled}" onclick="window.__pmToggleCurrentAutoPoke(this)">
        ${CHAT_ICON_SVG}<span><b>允许当前会话主动发消息</b><small>聊天停下来时，手机有机会自己发一句。</small></span><i class="pm-control-toggle ${autoPoke.enabled ? 'is-checked' : ''}" aria-hidden="true"></i>
      </button>
      <label class="pm-session-auto-poke-probability">每次有 <input id="pm-session-auto-poke-probability" type="number" min="0" max="100" step="1" required value="${autoPoke.probability}" ${autoPoke.enabled ? '' : 'disabled'} onchange="window.__pmSaveCurrentAutoPokeProbability(this)"> % 几率自动发消息</label>
      <p id="pm-session-auto-poke-counter">${autoPoke.counter === 1 ? '这次会自动发一条。' : '这次没有自动发消息。'}</p>
    </section>
  </div>
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

    window.__pmSaveCurrentAutoPokeProbability = input => {
        const target = getTarget();
        if (!target || !input) return false;
        const current = getAutoPokeConfig(target.storageId, target.saveKey);
        const rawValue = String(input.value ?? '').trim();
        const parsedProbability = Number(rawValue);
        const valid = rawValue !== ''
            && Number.isInteger(parsedProbability)
            && parsedProbability >= 0 && parsedProbability <= 100
            && input.checkValidity?.() !== false;
        if (!valid) {
            input.value = String(current.probability);
            alert('请输入 0 到 100 之间的整数概率。');
            input.focus?.({ preventScroll: true });
            return false;
        }
        const probability = parsedProbability;
        input.disabled = true;
        input.setAttribute('aria-busy', 'true');
        if (!commitAutoPokeConfig(target.storageId, target.saveKey, { probability })) {
            alert('自动发消息概率保存失败：浏览器存储不可用或空间不足。');
            window.__pmShowAutoPokeSettings('自动发消息概率保存失败，已恢复原设置。');
            document.getElementById('pm-session-auto-poke-probability')?.focus({ preventScroll: true });
            return false;
        }
        window.__pmShowAutoPokeSettings(`已保存：每次有 ${probability}% 几率自动发消息。`);
        document.getElementById('pm-session-auto-poke-probability')?.focus({ preventScroll: true });
        return true;
    };

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
        else if (action === 'settings') return window.__pmShowConversationSettings();
        else if (action === 'auto-poke') return window.__pmShowAutoPokeSettings();
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
        deps.closeContactSwitcher?.('replace');
        const phone = state.phoneWindow;
        const anchor = phone?.querySelector('.pm-expand-btn');
        if (!phone || !anchor || state.isMinimized) return;
        const menu = document.createElement('div');
        menu.id = CONTROL_MENU_ID;
        menu.className = 'pm-control-menu';
        menu.setAttribute('role', 'menu');
        menu.setAttribute('aria-label', '快捷工具');
        const target = getTarget();
        menu.innerHTML = `
  <button type="button" role="menuitem" data-action="pending">${EDIT_ICON_SVG}编辑消息</button>
  <button type="button" role="menuitem" data-action="settings" ${target ? '' : 'disabled'}>${CHARACTER_ICON_SVG}${target?.isGroup ? '成员设置' : '角色设置'}</button>
  <button type="button" role="menuitem" data-action="auto-poke" ${target ? '' : 'disabled'}>${CHAT_ICON_SVG}自动发消息</button>
  <button type="button" role="menuitem" data-action="emoji">${EMOJI_ICON_SVG}表情包管理</button>
  <button type="button" role="menuitem" data-action="calendar">${CALENDAR_ICON_SVG}日历</button>
  <button type="button" role="menuitem" data-action="delete" class="pm-control-menu-danger" ${target ? '' : 'disabled'}>${TRASH_ICON_SVG}删除消息</button>`;
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
