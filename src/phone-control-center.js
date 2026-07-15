import { escapeAttr, escapeHtml } from './ui.js';
import {
    clearPendingMessages, getPendingMessages, removePendingMessage, updatePendingMessage,
} from './pending-messages.js';

export function installPhoneControlCenter(state, deps) {
    const {
        runtime, getStorageId, makeOverlay, parsePendingInput, queuePendingText,
        renderPendingConversation, syncGenerationControls,
    } = deps;

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
  <div class="pm-pending-copy">
    <span class="pm-pending-state" data-status="${item.status}">${item.status === 'failed' ? '提交失败' : item.status === 'submitting' ? '提交中' : '待提交'}</span>
    <div>${escapeHtml(item.rawText || item.plainText || `【${item.directorNote}】`)}</div>
  </div>
  <button onclick="window.__pmEditPending(${item.id})" ${item.status === 'submitting' ? 'disabled' : ''}>编辑</button>
  <button onclick="window.__pmDeletePending(${item.id})" ${item.status === 'submitting' ? 'disabled' : ''}>删除</button>
</div>`).join('');
    }

    window.__pmRefreshControlCenter = () => {
        const list = document.getElementById('pm-pending-list');
        if (list) list.innerHTML = renderPendingList();
        syncGenerationControls();
    };

    let editingTarget = null;

    function sameTarget(left, right) {
        return !!left && !!right
            && left.storageId === right.storageId
            && left.saveKey === right.saveKey;
    }

    window.__pmShowControlCenter = () => {
        const target = getTarget();
        if (!sameTarget(editingTarget, target)) editingTarget = null;
        const editingItem = editingTarget && target
            ? getPendingMessages(runtime, target.storageId, target.saveKey).find(item => item.id === editingTarget.itemId)
            : null;
        if (editingTarget && !editingItem) editingTarget = null;
        const draft = editingItem?.rawText || state.phoneWindow?.querySelector('.pm-input')?.value || '';
        makeOverlay(`
<div class="pm-modal pm-modal-wide pm-control-center">
  <div class="pm-modal-header"><b>收纳控制中心</b><span onclick="window.__pmCloseOverlay()" class="pm-modal-close">×</span></div>
  <div class="pm-control-tools">
    <button onclick="window.__pmShowConfig()">设置与 API</button>
    <button onclick="window.__pmShowEmojiPicker()">表情包</button>
  </div>
  <div class="pm-control-compose">
    <textarea id="pm-expanded-textarea" class="pm-cfg-input" rows="5" placeholder="输入一条消息，加入暂存队列">${escapeAttr(draft)}</textarea>
    <button onclick="window.__pmConfirmExpandInput()">${editingTarget ? '保存修改' : '加入暂存'}</button>
  </div>
  <div class="pm-control-heading"><b>暂存消息</b><button onclick="window.__pmClearPending()">清空</button></div>
  <div id="pm-pending-list" class="pm-pending-list">${renderPendingList()}</div>
  <div class="pm-control-generation-status"></div>
  <button class="pm-submit-pending-btn" onclick="window.__pmSubmitPending()">最终提交给 AI</button>
</div>`, { onClose: () => { editingTarget = null; } });
        syncGenerationControls();
        document.getElementById('pm-expanded-textarea')?.focus();
    };

    window.__pmShowExpandInput = window.__pmShowControlCenter;
    window.__pmConfirmExpandInput = () => {
        const textarea = document.getElementById('pm-expanded-textarea');
        if (!textarea || !queuePendingText(textarea.value)) return;
        textarea.value = '';
        const smallInput = state.phoneWindow?.querySelector('.pm-input');
        if (smallInput) smallInput.value = '';
        window.__pmRefreshControlCenter();
        textarea.focus();
    };

    function redrawPendingConversation() {
        const target = getTarget();
        if (target) renderPendingConversation(target.storageId, target.saveKey);
    }

    window.__pmEditPending = itemId => {
        const target = getTarget();
        if (!target) return;
        const item = getPendingMessages(runtime, target.storageId, target.saveKey)
            .find(candidate => candidate.id === itemId);
        const textarea = document.getElementById('pm-expanded-textarea');
        if (!item || item.status === 'submitting' || !textarea) return;
        editingTarget = { ...target, itemId };
        textarea.value = item.rawText || item.plainText || `【${item.directorNote}】`;
        const button = document.querySelector('.pm-control-compose > button');
        if (button) button.textContent = '保存修改';
        textarea.focus();
        textarea.selectionStart = textarea.selectionEnd = textarea.value.length;
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

    const originalConfirm = window.__pmConfirmExpandInput;
    window.__pmConfirmExpandInput = () => {
        const textarea = document.getElementById('pm-expanded-textarea');
        if (!textarea) return;
        const target = getTarget();
        if (!sameTarget(editingTarget, target)) {
            editingTarget = null;
            originalConfirm();
            return;
        }
        const parsed = parsePendingInput(textarea.value);
        if (!target || !parsed) return;
        const updated = updatePendingMessage(
            runtime, target.storageId, target.saveKey, editingTarget.itemId, parsed,
        );
        if (!updated) {
            editingTarget = null;
            originalConfirm();
            return;
        }
        editingTarget = null;
        textarea.value = '';
        const button = document.querySelector('.pm-control-compose > button');
        if (button) button.textContent = '加入暂存';
        redrawPendingConversation();
        window.__pmRefreshControlCenter();
        textarea.focus();
    };

    window.__pmResetPendingEditor = () => { editingTarget = null; };
}
