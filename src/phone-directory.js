import {
    MAX_BIDIRECTIONAL, MAX_GROUP_MEMBERS,
    POPOVER_SUPPORTED,
} from './constants.js';
import { GROUP_COLORS } from './groups.js';
import { escapeAttr, escapeHtml, safeJS } from './ui.js';
import { REFRESH_ICON_SVG } from './icons.js';
import { clearPendingMessages } from './pending-messages.js';
import {
    loadGroupMeta, pmIDBDel, pmIDBSet, saveBgLocal, saveBidirectional,
    saveGroupMeta, savePokeConfig,
} from './storage.js';

export function installPhoneDirectory(state, deps) {
    const { runtime, getStorageId, makeOverlay, applyBidirectionalInjection } = deps;

    function showGroupForm(mode, existingName, existingMembers) {
        document.getElementById('pm-overlay')?.remove();
        const title = mode === 'create' ? '新建群聊' : '编辑群聊';
        const initName = existingName || '';
        const initMembers = (existingMembers || []).join(' / ');
        const closeAction = mode === 'create'
            ? "window.__pmShowList()"
            : "window.__pmSaveAndCloseGroupEdit()";

        let pokeConfig = { enabled: false, interval: 3, counter: 0 };
        let assignedEmojis = [];
        if (mode === 'edit' && state.currentGroupKey) {
            const id = getStorageId();
            pokeConfig = window.__pmPokeConfig[id]?.[state.currentGroupKey]?.autoPoke || pokeConfig;
            assignedEmojis = window.__pmPokeConfig[id]?.[state.currentGroupKey]?.emojis || [];
        }

        const emojiCheckHtml = window.__pmEmojis.length ? `
        <div style="padding-top:12px;border-top:1px solid #f0f0f0;">
            <div class="pm-cfg-label" style="margin-bottom:8px;">🥰 允许 AI 使用的表情包套组</div>
            <div style="display:flex;flex-direction:column;gap:10px;max-height:120px;overflow-y:auto;background:#fafafa;border-radius:8px;padding:10px;border:1px solid #eee;">
                ${window.__pmEmojis.map(set => `
                    <div style="display:flex;align-items:center;gap:10px;cursor:pointer;"
                         onclick="this.querySelector('.pm-emoji-assign-check').classList.toggle('is-checked')">
                        <div class="pm-custom-check pm-bi-style pm-emoji-assign-check ${assignedEmojis.includes(set.id) ? 'is-checked' : ''}"
                             data-id="${escapeAttr(set.id)}"
                             style="width:20px;height:20px;min-width:20px;flex-shrink:0;margin-bottom:0;"></div>
                        <span style="font-size:13px;color:#333;">${escapeHtml(set.name)}</span>
                        <span style="color:#aaa;font-size:11px;margin-left:auto;">(${set.images.length}张)</span>
                    </div>
                `).join('')}
            </div>
        </div>` : '';

        makeOverlay(`
    <div class="pm-modal pm-modal-wide">
    <div class="pm-modal-header"><b>${title}</b><span onclick="${closeAction}" class="pm-modal-close">✕</span></div>
    <div style="padding:14px 16px;display:flex;flex-direction:column;gap:10px;">
        <div class="pm-cfg-label">群聊名称</div>
        <input id="pm-group-name-input" class="pm-cfg-input" placeholder="给群聊起个名字" value="${escapeAttr(initName)}" maxlength="30">
        <div class="pm-cfg-label" style="margin-top:4px;">成员（用 / 分隔）</div>
        <input id="pm-group-input" class="pm-cfg-input" placeholder="角色A / 角色B / 角色C" oninput="window.__pmGroupInputChanged()" value="${escapeAttr(initMembers)}">
        <div id="pm-group-counter" class="pm-cfg-tip" style="text-align:left;font-weight:600;">0/${MAX_GROUP_MEMBERS - 1} 个角色</div>
        <div id="pm-group-preview" style="display:flex;flex-wrap:wrap;gap:4px;"></div>

        ${mode === 'edit' ? `
        ${emojiCheckHtml}
        <div style="margin-top:0px;padding-top:8px;border-top:1px solid #f0f0f0;">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
            <span style="font-size:13px;font-weight:600;">⏰ 自动发消息</span>
            <div onclick="window.__pmToggleAutoPokeGroup()"
                class="pm-custom-check pm-bi-style ${pokeConfig.enabled ? 'is-checked' : ''}"
                id="pm-poke-check-group"
                style="cursor:pointer;width:22px;height:22px;min-width:22px;min-height:22px;flex-shrink:0;border-radius:50%;">
            </div>
        </div>
        <div style="display:flex;align-items:center;gap:8px;">
            <span style="font-size:12px;color:#888;">每隔</span>
            <input id="pm-poke-interval-group" type="number" min="1" max="99"
                value="${pokeConfig.interval}"
                style="width:50px;border:1px solid #ddd;border-radius:6px;padding:4px 8px;font-size:13px;text-align:center;"
                ${!pokeConfig.enabled ? 'disabled' : ''}>
            <span style="font-size:12px;color:#888;">轮无输入主动发消息</span>
        </div>
        <div style="font-size:11px;color:#999;margin-top:4px;">
            当前计数：<span id="pm-poke-counter-group">${pokeConfig.counter}</span> / ${pokeConfig.interval}
        </div>
        <div style="margin-top:12px;">
            <button onclick="window.__pmPokeGroup()"
                    style="width:100%;background:linear-gradient(135deg,#ff9500,#ff6b00);color:#fff;border:none;border-radius:12px;padding:14px;font-size:14px;cursor:pointer;font-weight:600;display:flex;align-items:center;justify-content:center;">
            拍一拍
            </button>
        </div>
        </div>
        ` : ''}
    </div>
    ${mode === 'create' ? `
    <div class="pm-modal-add">
        <button onclick="window.__pmConfirmGroup('${safeJS(mode)}')" style="flex:1;background:#007aff;color:#fff;border:none;border-radius:10px;padding:10px;font-size:13px;cursor:pointer;font-weight:600;">创建</button>
    </div>` : ''}
    </div>`);
        setTimeout(() => window.__pmGroupInputChanged(), 0);
    }
    window.__pmSaveAndCloseGroupEdit = () => {
        const nameInput = document.getElementById('pm-group-name-input');
        const memInput = document.getElementById('pm-group-input');

        if (nameInput && memInput && state.currentGroupKey) {
            const groupName = nameInput.value.trim();
            const names = memInput.value.split(/[/／]/).map(s => s.trim()).filter(Boolean).slice(0, MAX_GROUP_MEMBERS - 1);

            if (groupName && names.length >= 2) {
                const id = getStorageId();
                if (!window.__pmGroupMeta[id]) window.__pmGroupMeta[id] = {};
                window.__pmGroupMeta[id][state.currentGroupKey] = { name: groupName, members: names };
                saveGroupMeta();

                state.groupMembers = names; state.groupDisplayName = groupName;
                state.groupColorMap = {};
                names.forEach((n, i) => { state.groupColorMap[n] = GROUP_COLORS[i % GROUP_COLORS.length]; });
            }

            const checkEl = document.getElementById('pm-poke-check-group');
            const intervalEl = document.getElementById('pm-poke-interval-group');
            const emojiChecks = document.querySelectorAll('.pm-emoji-assign-check.is-checked');
            const selectedEmojis = Array.from(emojiChecks).map(cb => cb.dataset.id);

            if (checkEl && intervalEl) {
                const id = getStorageId();
                if (!window.__pmPokeConfig[id]) window.__pmPokeConfig[id] = {};

                const enabled = checkEl.classList.contains('is-checked');
                const interval = parseInt(intervalEl.value) || 3;
                const oldCounter = window.__pmPokeConfig[id][state.currentGroupKey]?.autoPoke?.counter || 0;

                window.__pmPokeConfig[id][state.currentGroupKey] = {
                    autoPoke: {
                        enabled,
                        interval: Math.max(1, Math.min(99, interval)),
                        counter: enabled ? Math.min(oldCounter, interval - 1) : oldCounter
                    },
                    emojis: selectedEmojis
                };

                savePokeConfig();
            }
        }

        document.getElementById('pm-overlay')?.remove();

        if (state.phoneWindow && state.currentGroupKey) {
            window.__pmSwitch(state.currentGroupKey);
        }
    };

    window.__pmShowGroupCreate = () => showGroupForm('create');

    window.__pmGroupInputChanged = () => {
        const input = document.getElementById('pm-group-input');
        const counter = document.getElementById('pm-group-counter');
        const preview = document.getElementById('pm-group-preview');
        if (!input) return;
        const names = input.value.split(/[/／]/).map(s => s.trim()).filter(Boolean);
        const max = MAX_GROUP_MEMBERS - 1;
        const count = Math.min(names.length, max);
        const over = names.length > max;
        counter.textContent = `${count}/${max} 个角色${over ? ' ⚠️ 超出上限' : ''}`;
        counter.style.color = over ? '#ff3b30' : '#b87a00';
        preview.innerHTML = names.slice(0, max).map((n, i) => {
            const gc = GROUP_COLORS[i % GROUP_COLORS.length];
            return `<span style="background:${gc.bg};color:${gc.text};padding:3px 8px;border-radius:10px;font-size:11px;">${escapeHtml(n)}</span>`;
        }).join('');
    };

    window.__pmConfirmGroup = (mode) => {
        const nameInput = document.getElementById('pm-group-name-input');
        const memInput = document.getElementById('pm-group-input');
        if (!nameInput || !memInput) return;
        const groupName = nameInput.value.trim();
        const names = memInput.value.split(/[/／]/).map(s => s.trim()).filter(Boolean).slice(0, MAX_GROUP_MEMBERS - 1);
        if (!groupName) { alert('请输入群聊名称'); return; }
        if (names.length < 2) { alert('至少需要 2 个角色'); return; }

        document.getElementById('pm-overlay')?.remove();
        const id = getStorageId();
        if (!window.__pmGroupMeta[id]) window.__pmGroupMeta[id] = {};

        if (mode === 'create') {
            const groupKey = `__group_${Date.now()}`;
            // 修复：在修改全局状态前先快照旧的 saveKey，防止旧聊天记录被写入新群聊
            const _prevSaveKey = state.isGroupChat && state.currentGroupKey ? state.currentGroupKey : state.currentPersona;
            window.__pmGroupMeta[id][groupKey] = { name: groupName, members: names };
            saveGroupMeta();
            state.isGroupChat = true; state.groupMembers = names; state.groupDisplayName = groupName; state.currentGroupKey = groupKey;
            state.groupColorMap = {}; names.forEach((n, i) => { state.groupColorMap[n] = GROUP_COLORS[i % GROUP_COLORS.length]; });
            window.__pmSwitch(groupKey, _prevSaveKey);
        } else {
            if (!state.currentGroupKey) return;
            window.__pmGroupMeta[id][state.currentGroupKey] = { name: groupName, members: names };
            saveGroupMeta();
            state.groupMembers = names; state.groupDisplayName = groupName;
            state.groupColorMap = {}; names.forEach((n, i) => { state.groupColorMap[n] = GROUP_COLORS[i % GROUP_COLORS.length]; });
            window.__pmSwitch(state.currentGroupKey);
        }
    };




    window.__pmShowList = () => {
        const id = getStorageId();
        loadGroupMeta();
        const histories = window.__pmHistories[id] || {};
        const groups = window.__pmGroupMeta[id] || {};
        const checked = window.__pmBidirectional[id] || [];
        const singleList = Object.keys(histories).filter(k => !k.startsWith('__group_'));
        const groupList = Object.keys(groups);

        const renderSingle = singleList.map(n => {
            const isChk = checked.includes(n);
            return `<div class="pm-li">
                <div class="pm-custom-check pm-bi-style ${isChk ? 'is-checked' : ''}" onclick="event.stopPropagation();window.__pmToggleBidirectional('${safeJS(n)}')" style="width:20px;height:20px;min-width:20px;min-height:20px;flex-shrink:0;border-radius:50%;"></div>
                <span onclick="window.__pmSwitchContact('${safeJS(n)}')">${escapeHtml(n)}</span>
                <i onclick="window.__pmDel('${safeJS(n)}')">删除</i>
            </div>`;
        }).join('');

        const renderGroups = groupList.map(key => {
            const meta = groups[key];
            const isChk = checked.includes(key);
            return `<div class="pm-li">
                <div class="pm-custom-check pm-bi-style ${isChk ? 'is-checked' : ''}" onclick="event.stopPropagation();window.__pmToggleBidirectional('${safeJS(key)}')" style="width:20px;height:20px;min-width:20px;min-height:20px;flex-shrink:0;border-radius:50%;"></div>
                <span onclick="window.__pmSwitchContact('${safeJS(key)}')">${escapeHtml(meta.name)}<span class="pm-group-sub">${escapeHtml(meta.members.join('、'))}</span></span>
                <i onclick="window.__pmDelGroup('${safeJS(key)}')">删除</i>
            </div>`;
        }).join('');

        const empty = !singleList.length && !groupList.length;

        makeOverlay(`
    <div class="pm-modal">
    <div class="pm-modal-header">
      <b>联系人</b>
      <span style="display:flex;align-items:center;gap:10px;">
        <span id="pm-autogen-btn" onclick="window.__pmConfirmAutoGen()" title="AI 自动生成联系人" style="cursor:pointer;display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;border-radius:50%;transition:background .15s;" onmouseenter="this.style.background='rgba(0,122,255,0.1)'" onmouseleave="this.style.background='transparent'">
          ${REFRESH_ICON_SVG}
        </span>
        <span onclick="document.getElementById('pm-overlay').remove()" class="pm-modal-close">✕</span>
      </span>
    </div>
    <div class="pm-bi-bar"><span>🧠 勾选角色/群聊可被主楼读取短信</span><span class="pm-bi-tip">已选 ${checked.length}/${MAX_BIDIRECTIONAL}</span></div>
    <div class="pm-modal-list">
        ${empty ? '<div style="text-align:center;color:#999;padding:20px;font-size:13px;">暂无联系人</div>' : (renderGroups + renderSingle)}
    </div>
    <div class="pm-modal-add" style="display:flex;gap:8px;">
        <button onclick="window.__pmShowGroupCreate()" class="pm-btn-group">👥 新建群聊</button>
        <button onclick="window.__pmShowAddContact()" class="pm-btn-add">＋ 添加联系人</button>
    </div>
    </div>`);
    };

    window.__pmShowAddContact = () => {
        document.getElementById('pm-overlay')?.remove();
        makeOverlay(`
<div class="pm-modal">
  <div class="pm-modal-header"><b>添加联系人</b><span onclick="window.__pmShowList()" class="pm-modal-close">✕</span></div>
  <div style="padding:14px 16px;">
    <div class="pm-cfg-label" style="margin-bottom:8px;">输入角色名</div>
    <input id="pm-add-contact-input" class="pm-cfg-input" placeholder="角色名">
  </div>
  <div class="pm-modal-add">
    <button onclick="(()=>{const v=document.getElementById('pm-add-contact-input').value.trim();if(v)window.__pmSwitchContact(v);})()" style="flex:1;background:#007aff;color:#fff;border:none;border-radius:10px;padding:10px;font-size:13px;cursor:pointer;font-weight:600;">开始聊天</button>
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
        clearPendingMessages(runtime, id, key);
        if (window.__pmGroupMeta[id]) delete window.__pmGroupMeta[id][key];
        if (window.__pmHistories[id]) delete window.__pmHistories[id][key];

        const arr = window.__pmBidirectional[id] || [], idx = arr.indexOf(key);
        if (idx >= 0) { arr.splice(idx, 1); window.__pmBidirectional[id] = arr; saveBidirectional(); }

        const bgKey = `${id}_${key}`;
        if (window.__pmBgLocal[bgKey]) {
            delete window.__pmBgLocal[bgKey];
            await pmIDBDel('ST_SMS_BG_LOCAL_' + bgKey);
            await saveBgLocal();
        }

        if (window.__pmPokeConfig[id]?.[key]) {
            delete window.__pmPokeConfig[id][key];
            savePokeConfig();
        }

        // 修复：await 确保 IDB 写入完成，防止冷启动时 IDB 旧数据覆盖删除操作
        await pmIDBSet('ST_SMS_DATA_V2', window.__pmHistories).catch(() => {});
        try { localStorage.setItem('ST_SMS_DATA_V2', JSON.stringify(window.__pmHistories)); } catch (e) {};
        saveGroupMeta();
        applyBidirectionalInjection();
        // 修复：删除当前会话后清空全局状态，防止后续切换时落盘把已删记录写入新目标
        if (state.currentGroupKey === key) { state.isGroupChat = false; state.currentGroupKey = ''; state.currentPersona = ''; state.conversationHistory = []; state.groupMembers = []; state.groupDisplayName = ''; state.groupColorMap = {}; }
        window.__pmShowList();
    };


    window.__pmDel = async (name) => {
        const id = getStorageId();
        clearPendingMessages(runtime, id, name);
        if (window.__pmHistories[id]) delete window.__pmHistories[id][name];
        // 修复：await 确保 IDB 写入完成，防止冷启动时 IDB 旧数据覆盖删除操作
        await pmIDBSet('ST_SMS_DATA_V2', window.__pmHistories).catch(() => {});
        try { localStorage.setItem('ST_SMS_DATA_V2', JSON.stringify(window.__pmHistories)); } catch (e) {};

        const arr = window.__pmBidirectional[id] || [], idx = arr.indexOf(name);
        if (idx >= 0) { arr.splice(idx, 1); window.__pmBidirectional[id] = arr; saveBidirectional(); }

        const bgKey = `${id}_${name}`;
        if (window.__pmBgLocal[bgKey]) {
            delete window.__pmBgLocal[bgKey];
            await pmIDBDel('ST_SMS_BG_LOCAL_' + bgKey);
            await saveBgLocal();
        }

        if (window.__pmPokeConfig[id]?.[name]) {
            delete window.__pmPokeConfig[id][name];
            savePokeConfig();
        }

        applyBidirectionalInjection();
        // 修复：删除当前联系人后清空全局状态，防止后续切换时落盘把已删记录写入新目标
        if (!state.isGroupChat && state.currentPersona === name) { state.currentPersona = ''; state.conversationHistory = []; }
        window.__pmShowList();
    };
    Object.assign(deps, { showGroupForm });
}
