const clone = value => JSON.parse(JSON.stringify(value));

function injectionFailure(result, phase, subject = '群聊设置') {
    const failedWrites = Number.isInteger(result?.failedWrites) && result.failedWrites > 0 ? result.failedWrites : 0;
    const failedKeys = Array.isArray(result?.failedKeys) ? result.failedKeys : [];
    if (!failedWrites && !failedKeys.length) return null;
    const details = [
        failedWrites ? `${failedWrites} 项写入失败` : '',
        failedKeys.length ? `${failedKeys.length} 项清理失败` : '',
    ].filter(Boolean).join('，');
    return new Error(`${subject}${phase}注入失败：${details}`);
}

function snapshotConversationState(state) {
    return {
        activeStorageId: state.activeStorageId,
        currentPersona: state.currentPersona,
        conversationHistory: clone(state.conversationHistory),
        isGroupChat: state.isGroupChat,
        currentGroupKey: state.currentGroupKey,
        groupMembers: state.groupMembers.slice(),
        groupExtras: state.groupExtras.slice(),
        groupDisplayName: state.groupDisplayName,
        groupRandomNpcEnabled: state.groupRandomNpcEnabled,
        groupNature: state.groupNature,
        groupColorMap: { ...state.groupColorMap },
    };
}

function restoreConversationState(state, snapshot) {
    state.activeStorageId = snapshot.activeStorageId;
    state.currentPersona = snapshot.currentPersona;
    state.conversationHistory = snapshot.conversationHistory;
    state.isGroupChat = snapshot.isGroupChat;
    state.currentGroupKey = snapshot.currentGroupKey;
    state.groupMembers = snapshot.groupMembers;
    state.groupExtras = snapshot.groupExtras;
    state.groupDisplayName = snapshot.groupDisplayName;
    state.groupRandomNpcEnabled = snapshot.groupRandomNpcEnabled;
    state.groupNature = snapshot.groupNature;
    state.groupColorMap = snapshot.groupColorMap;
}

export async function refreshEditedGroupRuntime({
    state, updated, applyInjection, switchConversation,
}) {
    const snapshot = snapshotConversationState(state);
    try {
        state.groupMembers = updated.members.slice();
        state.groupExtras = updated.extras.slice();
        state.groupDisplayName = updated.name;
        state.groupRandomNpcEnabled = updated.randomNpcEnabled;
        state.groupNature = updated.groupNature;
        state.groupColorMap = {};
        updated.members.forEach((name, index) => {
            state.groupColorMap[name] = updated.memberColors[name] || GROUP_COLORS[index % GROUP_COLORS.length].bg;
        });
        const injectionResult = await applyInjection();
        const injectionError = injectionFailure(injectionResult, '提交');
        if (injectionError) throw injectionError;
        await switchConversation();
        return true;
    } catch (error) {
        restoreConversationState(state, snapshot);
        throw error;
    }
}

export async function commitEditedGroupUpdate({
    state, updated, persistUpdated, restoreConfig, persistRestored, applyInjection, switchConversation,
}) {
    try {
        await persistUpdated();
        await refreshEditedGroupRuntime({ state, updated, applyInjection, switchConversation });
        return true;
    } catch (error) {
        let rollbackError = null;
        try {
            restoreConfig();
            await persistRestored();
            const rollbackResult = await applyInjection();
            const rollbackInjectionError = injectionFailure(rollbackResult, '补偿');
            if (rollbackInjectionError) throw rollbackInjectionError;
        } catch (rollbackFailure) {
            rollbackError = rollbackFailure;
        }
        if (rollbackError) {
            const combined = new Error(
                `${error.message || '群聊设置保存失败'}；原配置回滚也失败，请勿刷新并立即导出备份：${rollbackError.message}`,
            );
            combined.cause = error;
            combined.rollbackError = rollbackError;
            throw combined;
        }
        throw error;
    }
}

import {
    POPOVER_SUPPORTED,
} from './constants.js';
import { normalizeGroupMeta } from './behavior-config.js';
import { getAutoPokeConfig } from './auto-poke-config.js';
import { GROUP_COLORS } from './groups.js';
import { escapeAttr, escapeHtml, safeJS } from './ui.js';
import { CLOSE_ICON_SVG, SPARKLES_ICON_SVG, UNLINK_ICON_SVG } from './icons.js';
import { clearPendingMessages } from './pending-messages.js';
import { saveBgLocal } from './storage-background.js';
import {
    loadGroupMeta, saveBidirectional, saveGroupMeta, saveHistoriesStrict, savePokeConfig,
} from './storage.js';

export function installPhoneDirectory(state, deps) {
    const { runtime, getStorageId, makeOverlay, applyBidirectionalInjection } = deps;
    let deleteTransactionActive = false;

    const setDeleteButtonsDisabled = disabled => {
        const buttons = document.querySelectorAll?.('.pm-entity-delete') || [];
        for (const button of buttons) button.disabled = disabled;
    };

    const acquireDeleteTransaction = () => {
        if (deleteTransactionActive) {
            alert('已有删除操作正在进行，请等待完成后再试。');
            return false;
        }
        deleteTransactionActive = true;
        setDeleteButtonsDisabled(true);
        return true;
    };

    const releaseDeleteTransaction = () => {
        deleteTransactionActive = false;
        setDeleteButtonsDisabled(false);
    };

    function parseGroupMembers(value) {
        const seen = new Set();
        return String(value || '').split(/[/／]/).flatMap(raw => {
            const name = raw.trim().slice(0, 80);
            const key = name.toLocaleLowerCase();
            if (!name || seen.has(key)) return [];
            seen.add(key);
            return [name];
        });
    }

    function showGroupForm(mode, existingName, existingMembers) {
        document.getElementById('pm-overlay')?.remove();
        const title = mode === 'create' ? '新建群聊' : '编辑群聊';
        const initName = existingName || '';
        const initMembers = (existingMembers || []).join(' / ');
        const closeAction = "window.__pmShowList()";

        let assignedEmojis = [];
        let groupMeta = normalizeGroupMeta({ name: initName, members: existingMembers || [] });
        if (mode === 'edit' && state.currentGroupKey) {
            const id = getStorageId();
            groupMeta = normalizeGroupMeta(window.__pmGroupMeta[id]?.[state.currentGroupKey]);
            assignedEmojis = window.__pmPokeConfig[id]?.[state.currentGroupKey]?.emojis || [];
        }

        const emojiCheckHtml = mode === 'edit' && window.__pmEmojis.length ? `
        <div style="padding-top:12px;border-top:1px solid var(--pm-color-border-subtle);">
            <div class="pm-cfg-label" style="margin-bottom:8px;">允许 AI 使用的表情包套组</div>
            <div style="display:flex;flex-direction:column;gap:10px;max-height:120px;overflow-y:auto;background:var(--pm-color-surface-elevated);border-radius:8px;padding:10px;border:1px solid var(--pm-color-border-subtle);">
                ${window.__pmEmojis.map(set => `
                    <div style="display:flex;align-items:center;gap:10px;cursor:pointer;"
                         onclick="this.querySelector('.pm-emoji-assign-check').click()">
                        <div class="pm-custom-check pm-bi-style pm-emoji-assign-check ${assignedEmojis.includes(set.id) ? 'is-checked' : ''}"
                             data-id="${escapeAttr(set.id)}"
                             role="checkbox" tabindex="0" aria-checked="${assignedEmojis.includes(set.id)}"
                             onclick="event.stopPropagation();this.classList.toggle('is-checked');this.setAttribute('aria-checked',String(this.classList.contains('is-checked')))"
                             onkeydown="if(event.key===' '||event.key==='Enter'){event.preventDefault();this.click()}"
                             style="width:20px;height:20px;min-width:20px;flex-shrink:0;margin-bottom:0;"></div>
                        <span style="font-size:13px;color:var(--pm-color-text-primary);">${escapeHtml(set.name)}</span>
                        <span style="color:var(--pm-color-text-tertiary);font-size:11px;margin-left:auto;">(${set.images.length}张)</span>
                    </div>
                `).join('')}
            </div>
        </div>` : '';
        const memberColorHtml = mode === 'edit' ? `
        <div style="padding-top:12px;border-top:1px solid var(--pm-color-border-subtle);">
          <div class="pm-cfg-label" style="margin-bottom:8px;">成员气泡颜色</div>
          <div style="display:grid;grid-template-columns:1fr auto;gap:8px 12px;align-items:center;">
            ${groupMeta.members.map((name, index) => `<label style="display:contents;"><span style="font-size:12px;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(name)}</span><input class="pm-group-member-color" data-member="${escapeAttr(name)}" type="color" value="${escapeAttr(groupMeta.memberColors[name] || GROUP_COLORS[index % GROUP_COLORS.length].bg)}"></label>`).join('')}
          </div>
        </div>` : '';
        const randomNpcHtml = mode === 'edit' ? `
        <div style="padding-top:12px;border-top:1px solid var(--pm-color-border-subtle);">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;">
            <div><div class="pm-cfg-label">允许路人群友随机出现</div><div class="pm-cfg-tip" style="text-align:left;">开启后，AI 可以生成不在固定成员名单中的临时群友。</div></div>
            <div id="pm-group-random-npc" class="pm-custom-check pm-bi-style ${groupMeta.randomNpcEnabled ? 'is-checked' : ''}"
              role="checkbox" tabindex="0" aria-checked="${groupMeta.randomNpcEnabled}"
              onclick="this.classList.toggle('is-checked');this.setAttribute('aria-checked',String(this.classList.contains('is-checked')))"
              onkeydown="if(event.key===' '||event.key==='Enter'){event.preventDefault();this.click()}"
              style="cursor:pointer;width:22px;height:22px;min-width:22px;min-height:22px;flex-shrink:0;border-radius:50%;"></div>
          </div>
          <label class="pm-cfg-label" style="display:block;margin-top:12px;">群聊性质
            <textarea id="pm-group-nature" class="pm-cfg-input" maxlength="200" rows="3" placeholder="例如：这是一个气氛很好的同学群">${escapeHtml(groupMeta.groupNature)}</textarea>
          </label>
          <div class="pm-cfg-tip" style="text-align:left;">路人群友会参考这段描述决定身份、语气和互动方式。</div>
        </div>` : '';

        makeOverlay(`
    <div class="pm-modal pm-modal-wide">
    <div class="pm-modal-header"><span></span><b>${title}</b><button type="button" onclick="${closeAction}" class="pm-modal-close" title="关闭" aria-label="关闭">${CLOSE_ICON_SVG}</button></div>
    <div class="pm-modal-scroll pm-group-settings-scroll">
        <div class="pm-cfg-label">群聊名称</div>
        <input id="pm-group-name-input" class="pm-cfg-input" placeholder="给群聊起个名字" value="${escapeAttr(initName)}" maxlength="30">
        <div class="pm-cfg-label" style="margin-top:4px;">成员（用 / 分隔）</div>
        <input id="pm-group-input" class="pm-cfg-input" placeholder="角色A / 角色B / 角色C" oninput="window.__pmGroupInputChanged()" value="${escapeAttr(initMembers)}">
        <div id="pm-group-counter" class="pm-cfg-tip" style="text-align:left;font-weight:600;">0 个角色</div>
        <div id="pm-group-preview" style="display:flex;flex-wrap:wrap;gap:4px;"></div>

        ${mode === 'edit' ? `
        ${randomNpcHtml}
        ${memberColorHtml}
        ${emojiCheckHtml}
        ` : ''}
    </div>
    ${mode === 'create' ? `
    <div class="pm-modal-add">
        <button class="pm-action-button" onclick="window.__pmConfirmGroup('${safeJS(mode)}')" style="flex:1">创建</button>
    </div>` : `<div class="pm-modal-add"><button class="pm-action-button" onclick="window.__pmSaveAndCloseGroupEdit()" style="flex:1">保存群聊设置</button></div>`}
    </div>`);
        setTimeout(() => window.__pmGroupInputChanged(), 0);
    }
    window.__pmSaveAndCloseGroupEdit = async () => {
        const nameInput = document.getElementById('pm-group-name-input');
        const memInput = document.getElementById('pm-group-input');
        if (!nameInput || !memInput || !state.currentGroupKey) return;
        const groupName = nameInput.value.trim();
        const names = parseGroupMembers(memInput.value);
        if (!groupName) return alert('请输入群聊名称');
        if (names.length < 2) return alert('至少需要 2 个角色');
        const id = getStorageId();
        const groupSnapshot = JSON.parse(JSON.stringify(window.__pmGroupMeta));
        const pokeSnapshot = JSON.parse(JSON.stringify(window.__pmPokeConfig));
        const previousConversationContext = {
            isGroupChat: state.isGroupChat,
            groupMembers: state.groupMembers.slice(),
        };
        try {
            if (!window.__pmGroupMeta[id]) window.__pmGroupMeta[id] = {};
            const previous = window.__pmGroupMeta[id][state.currentGroupKey] || {};
            const randomNpcEnabled = document.getElementById('pm-group-random-npc')?.classList.contains('is-checked') === true;
            const groupNature = document.getElementById('pm-group-nature')?.value || '';
            const memberColors = {};
            document.querySelectorAll('.pm-group-member-color').forEach(input => {
                if (names.includes(input.dataset.member) && /^#[0-9a-f]{6}$/i.test(input.value)) memberColors[input.dataset.member] = input.value;
            });
            const updated = normalizeGroupMeta({
                ...previous, name: groupName, members: names, memberColors, randomNpcEnabled, groupNature,
            });
            window.__pmGroupMeta[id][state.currentGroupKey] = updated;
            if (!window.__pmPokeConfig[id]) window.__pmPokeConfig[id] = {};
            const previousPoke = window.__pmPokeConfig[id][state.currentGroupKey] || {};
            window.__pmPokeConfig[id][state.currentGroupKey] = {
                ...previousPoke,
                autoPoke: getAutoPokeConfig(id, state.currentGroupKey),
                emojis: Array.from(document.querySelectorAll('.pm-emoji-assign-check.is-checked')).map(cb => cb.dataset.id),
            };
            await commitEditedGroupUpdate({
                state,
                updated,
                persistUpdated: async () => {
                    await saveGroupMeta();
                    if (!savePokeConfig()) throw new Error('自动消息配置保存失败：浏览器存储不可用或空间不足');
                },
                restoreConfig: () => {
                    window.__pmGroupMeta = groupSnapshot;
                    window.__pmPokeConfig = pokeSnapshot;
                },
                persistRestored: async () => {
                    await saveGroupMeta();
                    if (!savePokeConfig()) throw new Error('自动消息配置回滚失败');
                },
                applyInjection: () => applyBidirectionalInjection(),
                switchConversation: () => state.phoneWindow
                    ? window.__pmSwitch(state.currentGroupKey, undefined, state.activeStorageId, {
                        previousConversationContext,
                    })
                    : true,
            });
            document.getElementById('pm-overlay')?.remove();
        } catch (error) {
            alert(error.message || '群聊设置保存失败');
        }
    };

    window.__pmShowGroupCreate = () => showGroupForm('create');

    window.__pmGroupInputChanged = () => {
        const input = document.getElementById('pm-group-input');
        const counter = document.getElementById('pm-group-counter');
        const preview = document.getElementById('pm-group-preview');
        if (!input) return;
        const names = parseGroupMembers(input.value);
        if (counter) { counter.textContent = `${names.length} 个角色`; counter.style.color = '#b87a00'; }
        preview.innerHTML = names.map((n, i) => {
            const gc = GROUP_COLORS[i % GROUP_COLORS.length];
            return `<span style="background:${gc.bg};color:${gc.text};padding:3px 8px;border-radius:10px;font-size:11px;">${escapeHtml(n)}</span>`;
        }).join('');
    };

    window.__pmConfirmGroup = async (mode) => {
        const nameInput = document.getElementById('pm-group-name-input');
        const memInput = document.getElementById('pm-group-input');
        if (!nameInput || !memInput) return;
        const groupName = nameInput.value.trim();
        const names = parseGroupMembers(memInput.value);
        if (!groupName) { alert('请输入群聊名称'); return; }
        if (names.length < 2) { alert('至少需要 2 个角色'); return; }
        const id = getStorageId();
        if (!window.__pmGroupMeta[id]) window.__pmGroupMeta[id] = {};
        const snapshot = JSON.parse(JSON.stringify(window.__pmGroupMeta));
        try {
            if (mode === 'create') {
                const groupKey = `__group_${Date.now()}`;
                const previousSaveKey = state.isGroupChat && state.currentGroupKey ? state.currentGroupKey : state.currentPersona;
                const previousConversationContext = {
                    isGroupChat: state.isGroupChat,
                    groupMembers: state.groupMembers.slice(),
                };
                window.__pmGroupMeta[id][groupKey] = normalizeGroupMeta({ name: groupName, members: names });
                await saveGroupMeta();
                document.getElementById('pm-overlay')?.remove();
                state.isGroupChat = true; state.groupMembers = names; state.groupExtras = [];
                state.groupDisplayName = groupName; state.currentGroupKey = groupKey;
                state.groupRandomNpcEnabled = false; state.groupNature = '';
                state.groupColorMap = {}; names.forEach((n, i) => { state.groupColorMap[n] = GROUP_COLORS[i % GROUP_COLORS.length]; });
                window.__pmSwitch(groupKey, previousSaveKey, state.activeStorageId, { previousConversationContext });
            }
        } catch (error) {
            window.__pmGroupMeta = snapshot;
            alert(error.message || '群聊创建失败');
        }
    };




    window.__pmShowList = async () => {
        const id = getStorageId();
        await loadGroupMeta();
        const histories = window.__pmHistories[id] || {};
        const groups = window.__pmGroupMeta[id] || {};
        const singleList = Object.keys(histories).filter(k => !k.startsWith('__group_'));
        const groupList = Object.keys(groups);

        const renderSingle = singleList.map(n => {
            return `<div class="pm-li">
                <span onclick="window.__pmSwitchContact('${safeJS(n)}')">${escapeHtml(n)}</span>
                <button type="button" class="pm-entity-delete" onclick="window.__pmDel('${safeJS(n)}')" aria-label="永久删除联系人 ${escapeAttr(n)}" title="永久删除联系人">${UNLINK_ICON_SVG}</button>
            </div>`;
        }).join('');

        const renderGroups = groupList.map(key => {
            const meta = groups[key];
            return `<div class="pm-li">
                <span onclick="window.__pmSwitchContact('${safeJS(key)}')">${escapeHtml(meta.name)}<span class="pm-group-sub">${escapeHtml(meta.members.join('、'))}</span></span>
                <button type="button" class="pm-entity-delete" onclick="window.__pmDelGroup('${safeJS(key)}')" aria-label="永久删除群聊 ${escapeAttr(meta.name)}" title="永久删除群聊">${UNLINK_ICON_SVG}</button>
            </div>`;
        }).join('');

        const empty = !singleList.length && !groupList.length;

        makeOverlay(`
    <div class="pm-modal">
    <div class="pm-modal-header">
      <span></span>
      <b>联系人</b>
      <button type="button" onclick="window.__pmCloseOverlay()" class="pm-modal-close" title="关闭" aria-label="关闭">${CLOSE_ICON_SVG}</button>
    </div>
    <div class="pm-modal-list">
        ${empty ? '<div style="text-align:center;color:var(--pm-color-text-tertiary);padding:20px;font-size:13px;">暂无联系人</div>' : (renderGroups + renderSingle)}
    </div>
    <div class="pm-modal-add">
        <button onclick="window.__pmShowGroupCreate()" class="pm-btn-group">新建群聊</button>
        <button onclick="window.__pmShowAddContact()" class="pm-btn-add">添加联系人</button>
    </div>
    </div>`);
    };

    window.__pmShowAddContact = (resultMessage = '') => {
        document.getElementById('pm-overlay')?.remove();
        makeOverlay(`
<div class="pm-modal">
  <div class="pm-modal-header"><span></span><b>添加联系人</b><button type="button" onclick="window.__pmShowList()" class="pm-modal-close" title="关闭" aria-label="关闭">${CLOSE_ICON_SVG}</button></div>
  ${resultMessage ? `<div class="pm-bi-bar pm-contact-add-result"><span>${escapeHtml(resultMessage)}</span></div>` : ''}
  <div class="pm-contact-add-choices">
    <section class="pm-contact-add-choice">
      <b>手动添加</b><span>输入明确的角色名，立即开始聊天。</span>
      <div class="pm-contact-add-manual">
        <input id="pm-add-contact-input" class="pm-cfg-input" placeholder="角色名" aria-label="联系人角色名">
        <button type="button" class="pm-contact-add-primary" onclick="(()=>{const v=document.getElementById('pm-add-contact-input').value.trim();if(v)window.__pmSwitchContact(v);})()">开始聊天</button>
      </div>
    </section>
    <section class="pm-contact-add-choice is-ai">
      <b>AI 生成</b><span>根据当前剧情、世界书和已有联系人生成一批候选。</span>
      <button type="button" id="pm-autogen-btn" class="pm-contact-add-ai" onclick="window.__pmConfirmAutoGen()" aria-label="AI 自动生成联系人"><span class="pm-contact-add-icon">${SPARKLES_ICON_SVG}</span><span>生成联系人与群聊</span></button>
    </section>
  </div>
</div>`);
        setTimeout(() => {
            const input = document.getElementById('pm-add-contact-input');
            input?.focus();
            input?.addEventListener('keydown', e => {
                if (e.key === 'Enter') { const v = input.value.trim(); if (v) window.__pmSwitchContact(v); }
            });
        }, 0);
    };


    window.__pmDelGroup = async (key) => {
        const id = getStorageId();
        const groupName = window.__pmGroupMeta[id]?.[key]?.name || '未命名群聊';
        if (!confirm(`永久删除群聊“${groupName}”？聊天记录、注入关系、背景和自动消息配置都会一并删除，且无法恢复。`)) return false;
        if (!acquireDeleteTransaction()) return false;
        let snapshots = null;
        try {
            snapshots = {
                groupMeta: clone(window.__pmGroupMeta), histories: clone(window.__pmHistories),
                bidirectional: clone(window.__pmBidirectional), poke: clone(window.__pmPokeConfig),
                backgrounds: clone(window.__pmBgLocal),
            };
            if (window.__pmGroupMeta[id]) delete window.__pmGroupMeta[id][key];
            if (window.__pmHistories[id]) delete window.__pmHistories[id][key];
            const arr = window.__pmBidirectional[id] || [], idx = arr.indexOf(key);
            if (idx >= 0) arr.splice(idx, 1);
            const bgKey = `${id}_${key}`;
            if (window.__pmBgLocal[bgKey]) delete window.__pmBgLocal[bgKey];
            if (window.__pmPokeConfig[id]?.[key]) delete window.__pmPokeConfig[id][key];
            await saveHistoriesStrict();
            await saveGroupMeta();
            if (!savePokeConfig()) throw new Error('自动消息配置保存失败');
            if (!saveBidirectional()) throw new Error('注入配置保存失败');
            if (snapshots.backgrounds[bgKey]) await saveBgLocal();
            const injectionResult = await applyBidirectionalInjection();
            const injectionError = injectionFailure(injectionResult, '删除清理', '群聊');
            if (injectionError) throw injectionError;
            await window.__pmShowList();
            clearPendingMessages(runtime, id, key);
            if (state.currentGroupKey === key) {
                state.isGroupChat = false; state.currentGroupKey = ''; state.currentPersona = ''; state.conversationHistory = [];
                state.groupMembers = []; state.groupExtras = []; state.groupDisplayName = '';
                state.groupRandomNpcEnabled = false; state.groupNature = ''; state.groupColorMap = {};
            }
            return true;
        } catch (error) {
            if (!snapshots) {
                alert(error.message || '群聊删除失败');
                return false;
            }
            window.__pmGroupMeta = snapshots.groupMeta; window.__pmHistories = snapshots.histories;
            window.__pmBidirectional = snapshots.bidirectional; window.__pmPokeConfig = snapshots.poke; window.__pmBgLocal = snapshots.backgrounds;
            let rollbackError = null;
            try {
                await saveHistoriesStrict();
                await saveGroupMeta();
                if (!savePokeConfig() || !saveBidirectional()) throw new Error('本地配置回滚失败');
                await saveBgLocal();
                const rollbackResult = await applyBidirectionalInjection();
                const rollbackInjectionError = injectionFailure(rollbackResult, '删除补偿', '群聊');
                if (rollbackInjectionError) throw rollbackInjectionError;
            } catch (rollbackFailure) {
                rollbackError = rollbackFailure;
            }
            alert(rollbackError
                ? `${error.message || '群聊删除失败'}；原数据回滚也失败，请勿刷新并立即导出备份：${rollbackError.message}`
                : (error.message || '群聊删除失败'));
            return false;
        } finally {
            releaseDeleteTransaction();
        }
    };


    window.__pmDel = async (name) => {
        const id = getStorageId();
        if (!confirm(`永久删除联系人“${name}”？聊天记录、注入关系、背景和自动消息配置都会一并删除，且无法恢复。`)) return false;
        if (!acquireDeleteTransaction()) return false;
        let snapshots = null;
        try {
            snapshots = {
                histories: clone(window.__pmHistories),
                bidirectional: clone(window.__pmBidirectional),
                poke: clone(window.__pmPokeConfig),
                backgrounds: clone(window.__pmBgLocal),
            };
            if (window.__pmHistories[id]) delete window.__pmHistories[id][name];
            const arr = window.__pmBidirectional[id] || [], idx = arr.indexOf(name);
            if (idx >= 0) arr.splice(idx, 1);
            const bgKey = `${id}_${name}`;
            if (window.__pmBgLocal[bgKey]) delete window.__pmBgLocal[bgKey];
            if (window.__pmPokeConfig[id]?.[name]) delete window.__pmPokeConfig[id][name];
            await saveHistoriesStrict();
            if (!savePokeConfig()) throw new Error('自动消息配置保存失败');
            if (!saveBidirectional()) throw new Error('注入配置保存失败');
            if (snapshots.backgrounds[bgKey]) await saveBgLocal();
            const injectionResult = await applyBidirectionalInjection();
            const injectionError = injectionFailure(injectionResult, '删除清理', '联系人');
            if (injectionError) throw injectionError;
            await window.__pmShowList();
            clearPendingMessages(runtime, id, name);
            if (!state.isGroupChat && state.currentPersona === name) { state.currentPersona = ''; state.conversationHistory = []; }
            return true;
        } catch (error) {
            if (!snapshots) {
                alert(error.message || '联系人删除失败');
                return false;
            }
            window.__pmHistories = snapshots.histories; window.__pmBidirectional = snapshots.bidirectional;
            window.__pmPokeConfig = snapshots.poke; window.__pmBgLocal = snapshots.backgrounds;
            let rollbackError = null;
            try {
                await saveHistoriesStrict();
                if (!savePokeConfig() || !saveBidirectional()) throw new Error('本地配置回滚失败');
                await saveBgLocal();
                const rollbackResult = await applyBidirectionalInjection();
                const rollbackInjectionError = injectionFailure(rollbackResult, '删除补偿', '联系人');
                if (rollbackInjectionError) throw rollbackInjectionError;
            } catch (rollbackFailure) {
                rollbackError = rollbackFailure;
            }
            alert(rollbackError
                ? `${error.message || '联系人删除失败'}；原数据回滚也失败，请勿刷新并立即导出备份：${rollbackError.message}`
                : (error.message || '联系人删除失败'));
            return false;
        } finally {
            releaseDeleteTransaction();
        }
    };
    Object.assign(deps, { showGroupForm });
}
