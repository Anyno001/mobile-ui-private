import { SAVE_LIMIT } from './constants.js';
import { splitToSentences } from './prompts.js';
import { GROUP_COLORS } from './groups.js';
import {
    saveHistories, loadGroupMeta,
} from './storage.js';

/**
 * 获取当前会话的 saveKey（群聊/单聊）
 */
function getSaveKey(state) {
    return state.isGroupChat && state.currentGroupKey ? state.currentGroupKey : state.currentPersona;
}

/**
 * 保存当前对话历史到 window.__pmHistories
 */
function persistCurrentHistory(state, getStorageId, saveKeyOverride, storageIdOverride, historyOverride) {
    const id = storageIdOverride || state.activeStorageId || getStorageId();
    if (!id || id === 'sms_unknown__default') {
        console.warn('[phone-mode] persistCurrentHistory: storageId 尚未就绪，跳过保存');
        return false;
    }
    const saveKey = saveKeyOverride ?? getSaveKey(state);
    if (typeof saveKey !== 'string' || !saveKey.trim()) return false;
    if (!window.__pmHistories[id]) window.__pmHistories[id] = {};
    const history = Array.isArray(historyOverride) ? historyOverride : state.conversationHistory;
    window.__pmHistories[id][saveKey.trim()] = history.slice(-SAVE_LIMIT);
    saveHistories();
    return true;
}

function getStoredHistory(id, saveKey) {
    const history = window.__pmHistories[id]?.[saveKey];
    return Array.isArray(history) ? history.slice(-SAVE_LIMIT) : [];
}

/**
 * 安装会话管理功能
 * 集中管理：__pmSwitchContact（切换联系人/群聊）、__pmSwitch（切换并重绘历史）
 * 保留旧 _prevSaveKey 语义和 window 全局契约
 */
export function installConversation(state, deps) {
    const {
        getStorageId, addNote, addBubble, fitNameFont, applyBackground,
        applyBidirectionalInjection,
    } = deps;

    window.__pmSwitchContact = (key) => {
        if (!key?.trim()) return; key = key.trim();
        loadGroupMeta();
        const id = getStorageId();
        // 修复：如果上下文尚未就绪导致 ID 为 unknown，给出警告，避免存入错误 key
        if (!id || id === 'sms_unknown__default') {
            console.warn('[phone-mode] __pmSwitchContact: SillyTavern 上下文尚未就绪，storageId 无效，跳过切换');
            return;
        }
        const groupMeta = window.__pmGroupMeta[id]?.[key];
        // 修复：在修改全局状态前快照旧 saveKey，防止落盘时把当前会话记录写入目标会话
        const _prevSaveKey = state.isGroupChat && state.currentGroupKey ? state.currentGroupKey : state.currentPersona;
        const _prevStorageId = state.activeStorageId;
        state.activeStorageId = id;
        if (groupMeta) {
            state.isGroupChat = true; state.currentGroupKey = key;
            state.groupMembers = groupMeta.members.slice();
            state.groupDisplayName = groupMeta.name;
            state.groupColorMap = {};
            state.groupMembers.forEach((n, i) => { state.groupColorMap[n] = GROUP_COLORS[i % GROUP_COLORS.length]; });
        } else {
            state.isGroupChat = false; state.groupMembers = []; state.groupColorMap = {}; state.groupDisplayName = ''; state.currentGroupKey = '';
        }
        window.__pmSwitch(key, _prevSaveKey, _prevStorageId);
    };

    window.__pmSwitch = (name, _prevSaveKey, _prevStorageId) => {
        if (!name?.trim()) return; name = name.trim();
        document.getElementById('pm-overlay')?.remove();
        const id = getStorageId();
        if (!id || id === 'sms_unknown__default') {
            console.warn('[phone-mode] __pmSwitch: storageId 尚未就绪，跳过切换');
            return;
        }
        // 切换前先把当前联系人的最新 state.conversationHistory 落盘，
        // 修复：调用方（__pmConfirmGroup）可能在调用本函数前已修改了 state.isGroupChat/state.currentGroupKey，
        // 导致落盘时 saveKey 错误地指向新目标，把旧聊天记录写入新会话。优先使用调用方传入的 _prevSaveKey。
        if (_prevSaveKey || state.currentPersona) {
            persistCurrentHistory(state, getStorageId, _prevSaveKey ?? getSaveKey(state), _prevStorageId);
        }
        state.activeStorageId = id;
        state.currentPersona = name;
        state.conversationHistory = getStoredHistory(id, name);
        if (state.phoneWindow) {
            const nameEl = state.phoneWindow.querySelector('.pm-name');
            const editBtn = state.phoneWindow.querySelector('.pm-name-edit');
            if (nameEl) {
                if (state.isGroupChat) {
                    const display = state.groupDisplayName || name;
                    const arr = [...display];
                    nameEl.textContent = arr.length > 5 ? arr.slice(0, 5).join('') + '...' : display;
                } else {
                    nameEl.textContent = name;
                }
            }
            if (editBtn) {
                editBtn.classList.remove('is-hidden');
            }
            fitNameFont();
            const list = state.phoneWindow.querySelector('.pm-msg-list'); list.innerHTML = '';
            if (state.conversationHistory.length > 0) {
                addNote('历史记录');
                state.conversationHistory.forEach((m, hi) => {
                    if (state.isGroupChat && m.role === 'assistant') {
                        const lines = m.content.split('\n');
                        for (const line of lines) {
                            const match = line.match(/^(.{1,20})[：:]\s*(.+)$/);
                            if (match && state.groupMembers.some(gm => gm.toLowerCase() === match[1].trim().toLowerCase())) {
                                const sender = state.groupMembers.find(gm => gm.toLowerCase() === match[1].trim().toLowerCase());
                                splitToSentences(match[2]).forEach(s => addBubble(s, 'left', sender, hi));
                            } else {
                                splitToSentences(line).forEach(s => addBubble(s, 'left', undefined, hi));
                            }
                        }
                    } else {
                        splitToSentences(m.content).forEach(s => addBubble(s, m.role === 'user' ? 'right' : 'left', undefined, hi));
                    }
                });
                addNote('── 以上为历史 ──');
            } else addNote('开始对话');
            applyBackground();
        }
        applyBidirectionalInjection();
    };

    // 导出内部函数供其他模块使用
    Object.assign(deps, {
        persistCurrentHistory: (saveKey, storageId, history) => persistCurrentHistory(state, getStorageId, saveKey, storageId, history),
        getSaveKey: () => getSaveKey(state),
    });
}
