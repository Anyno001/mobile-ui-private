import { escapeAttr, escapeHtml } from './ui.js';
import {
    clearPendingMessages, getPendingMessages, removePendingMessage, updatePendingMessage,
} from './pending-messages.js';

export function installPhoneControlCenter(state, deps) {
    const {
        runtime, getStorageId, makeOverlay, parsePendingInput,
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
        const count = target ? getPendingMessages(runtime, target.storageId, target.saveKey).length : 0;
        const heading = document.querySelector('.pm-control-heading b');
        if (heading) heading.textContent = `暂存消息（${count}）`;
        const submit = document.querySelector('.pm-submit-pending-btn');
        if (submit) submit.dataset.empty = String(count === 0);
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
        const pendingCount = target ? getPendingMessages(runtime, target.storageId, target.saveKey).length : 0;
        makeOverlay(`
<div class="pm-modal pm-modal-wide pm-control-center">
  <div class="pm-modal-header"><b>快捷工具</b><span onclick="window.__pmCloseOverlay()" class="pm-modal-close">×</span></div>
  <div class="pm-control-scroll">
  <div class="pm-tool-grid">
    <button onclick="window.__pmShowConversationSettings()"><b>设置</b><span>当前聊天行为</span></button>
    <button onclick="window.__pmOpenSettingsTab('api')"><b>API</b><span>模型与接口</span></button>
    <button onclick="window.__pmOpenSettingsTab('look')"><b>外观</b><span>主题与背景</span></button>
    <button onclick="window.__pmOpenSettingsTab('other')"><b>其他</b><span>备份与偏好</span></button>
    <button onclick="window.__pmShowEmojiPicker()"><b>表情包</b><span>选择聊天表情</span></button>
    <button onclick="window.__pmStartDeleteMode()" class="pm-tool-danger"><b>删除信息</b><span>选择聊天记录</span></button>
    <button onclick="window.__pmOpenForumMode()"><b>论坛模式</b><span>开发中，入口已预留</span></button>
  </div>
  <div class="pm-control-heading"><b>暂存消息（${pendingCount}）</b><button onclick="window.__pmClearPending()">清空</button></div>
  <div id="pm-pending-list" class="pm-pending-list">${renderPendingList()}</div>
  <div class="pm-control-generation-status"></div>
  </div>
  <button class="pm-submit-pending-btn" data-empty="${pendingCount === 0}" onclick="window.__pmSubmitPending()">最终提交给 AI</button>
</div>`, { onClose: () => { editingTarget = null; } });
        syncGenerationControls();
    };

    window.__pmOpenSettingsTab = tab => window.__pmShowConfig(tab);
    window.__pmStartDeleteMode = () => { window.__pmCloseOverlay(); window.__pmToggleSelect(); };
    window.__pmOpenForumMode = () => alert('论坛模式入口已保留，功能将在后续版本接入。');

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
}
