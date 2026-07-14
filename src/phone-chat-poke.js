import {
    CONTEXT_LIMIT, SAVE_LIMIT,
} from './constants.js';
import { cleanResponse, splitToSentences } from './prompts.js';
import { escapeAttr, escapeHtml, safeJS } from './ui.js';
import {
    getEmojiPrompt, getWordyPrompt, parseGroupResponse,
} from './messaging.js';
import {
    saveHistories, savePokeConfig,
} from './storage.js';
import {
    buildUserBlock, buildHistoryText, buildPokeSystemPrompt,
    buildPokeGroupPrompt, buildPokeSinglePrompt,
    buildPokeGroupActivePrompt,
} from './chat-prompts.js';

export function installPhoneChatPoke(state, deps) {
    const {
        getStorageId, gatherContext, callAI, applyBidirectionalInjection,
        addBubble, addNote, showTyping, hideTyping, makeOverlay,
        showGroupForm, beginGeneration, isGenerationTaskActive, finishGeneration,
    } = deps;
    window.__pmAutoPoke = async (contactName) => {
        if (state.isGenerating) return;
        const id = getStorageId();
        if (!id || id === 'sms_unknown__default') return;
        const task = beginGeneration(id);
        if (!task) return;
        const groupMeta = window.__pmGroupMeta[id]?.[contactName];
        const isGroup = !!groupMeta;
        const groupMembers = groupMeta?.members?.slice() || [];

        const isActiveView = state.phoneActive && state.activeStorageId === id
            && ((isGroup && state.currentGroupKey === contactName) || (!isGroup && state.currentPersona === contactName));
        const isStillActiveView = () => isGenerationTaskActive(task) && state.phoneActive
            && state.activeStorageId === id
            && ((isGroup && state.isGroupChat && state.currentGroupKey === contactName)
                || (!isGroup && !state.isGroupChat && state.currentPersona === contactName));

        if (isActiveView) {
            showTyping();
        }

        try {
        const ctxData = await gatherContext(task.context);
        if (!isGenerationTaskActive(task)) return;
        const { cardDesc, cardPersonality, cardScenario, cardMesExample, mainChatText, worldBookText, userName, userDesc } = ctxData;
        const userBlock = buildUserBlock(userName, userDesc);

        let targetHistory = (window.__pmHistories[id]?.[contactName] || []).slice();
        const smsHistoryText = buildHistoryText(targetHistory, CONTEXT_LIMIT, userName, isGroup ? null : contactName);

        const systemPrompt = buildPokeSystemPrompt(isGroup, contactName, userName);
        // 修复：注入表情包提示词（与 fetchSMS 保持一致）
        // 修复：群聊拍一拍使用 contactName（即 state.currentGroupKey），单人使用 contactName，两者相同，已正确
        const emojiPrompt = getEmojiPrompt(contactName, id, window.__pmPokeConfig, window.__pmEmojis);
        const basePrompt = isGroup
            ? buildPokeGroupPrompt({
                groupName: groupMeta.name,
                memberList: groupMembers.join('、'),
                userName, userBlock, cardDesc, cardPersonality,
                cardScenario, worldBookText, mainChatText, smsHistoryText,
              })
            : buildPokeSinglePrompt({
                contactName, userName, userBlock, cardDesc, cardPersonality,
                cardScenario, cardMesExample, worldBookText, mainChatText, smsHistoryText,
              });
        const userPrompt = basePrompt + (emojiPrompt || '') + getWordyPrompt(window.__pmWordyLimit);

            const raw = await callAI(systemPrompt, userPrompt);
            if (!isGenerationTaskActive(task)) return;
            let historyUpdated = false;
            const renderActive = isStillActiveView();

            if (renderActive) hideTyping();

            if (isGroup) {
                const parsed = parseGroupResponse(raw, groupMembers);

                const contentParts = [];
                for (const block of parsed) {
                    if (block.sentences.length > 0) {
                        contentParts.push(`${block.name}：${block.sentences.join(' / ')}`);
                        if (renderActive) {
                            const _pgHi = targetHistory.length; // push 之前的长度即为新条目下标
                            for (const s of block.sentences) {
                                await new Promise(r => setTimeout(r, 120));
                                if (!isGenerationTaskActive(task)) return;
                                if (isStillActiveView()) addBubble(s, 'left', block.name, _pgHi);
                            }
                        }
                    }
                }
                if (contentParts.length > 0) {
                    targetHistory.push({ role: 'assistant', content: contentParts.join('\n') });
                    historyUpdated = true;
                }
            } else {
                const clean = cleanResponse(raw);
                const sentences = splitToSentences(clean);
                if (sentences.length > 0) {
                    targetHistory.push({ role: 'assistant', content: sentences.join(' / ') });
                    historyUpdated = true;
                    if (renderActive) {
                        const _pokeHi = targetHistory.length - 1;
                        for (const s of sentences) {
                            await new Promise(r => setTimeout(r, 150));
                            if (!isGenerationTaskActive(task)) return;
                            if (isStillActiveView()) addBubble(s, 'left', undefined, _pokeHi);
                            // 逐句落盘：每渲染一句立即保存，防止挂起丢失
                            { if (!window.__pmHistories[id]) window.__pmHistories[id] = {};
                              window.__pmHistories[id][contactName] = targetHistory.slice(-SAVE_LIMIT);
                              saveHistories(); }
                        }
                    }
                }
            }

            if (historyUpdated) {
                if (!window.__pmHistories[id]) window.__pmHistories[id] = {};
                const newHistory = targetHistory.slice(-SAVE_LIMIT);
                window.__pmHistories[id][contactName] = newHistory;

                // 修复：如果当前正好在这个角色的界面，必须把最新的数组同步给全局的 state.conversationHistory
                if (isStillActiveView()) {
                    state.conversationHistory = newHistory;
                }

                saveHistories();
                if (isGenerationTaskActive(task)) applyBidirectionalInjection();
            }
        } catch (e) {
            if (isStillActiveView()) hideTyping();
            console.error('[phone-mode] 自动发消息失败', e);
        } finally {
            finishGeneration(task);
        }
    };

    function showContactConfig(contactName) {
        const id = getStorageId();
        const config = window.__pmPokeConfig[id]?.[contactName] || {
            autoPoke: { enabled: false, interval: 3, counter: 0 }
        };
        const assignedEmojis = config.emojis || [];

        const emojiCheckHtml = window.__pmEmojis.length ? `
        <div style="margin-bottom:8px;border-bottom:1px solid #f0f0f0;padding-bottom:14px;">
            <div class="pm-cfg-label" style="margin-bottom:8px;">🥰 允许 AI 使用的表情包套组</div>
            <div style="display:flex;flex-direction:column;gap:10px;max-height:130px;overflow-y:auto;background:#fafafa;border-radius:8px;padding:10px;border:1px solid #eee;">
                ${window.__pmEmojis.map(set => `
                    <div style="display:flex;align-items:center;gap:10px;cursor:pointer;"
                         onclick="this.querySelector('.pm-emoji-assign-check').classList.toggle('is-checked')">
                        <div class="pm-custom-check pm-bi-style pm-emoji-assign-check ${assignedEmojis.includes(set.id)?'is-checked':''}"
                             data-id="${escapeAttr(set.id)}"
                             style="width:20px;height:20px;min-width:20px;flex-shrink:0;margin-bottom:0;"></div>
                        <span style="font-size:13px;color:#333;">${escapeHtml(set.name)}</span>
                        <span style="color:#aaa;font-size:11px;margin-left:auto;">(${set.images.length}张)</span>
                    </div>
                `).join('')}
            </div>
            <div style="font-size:11px;color:#aaa;margin-top:4px;">勾选后 AI 会知道如何使用这些表情</div>
        </div>` : '';

        makeOverlay(`
    <div class="pm-modal pm-modal-wide">
    <div class="pm-modal-header">
        <b>${escapeHtml(contactName)} 设置</b>
        <span onclick="window.__pmSaveAndCloseContactConfig('${safeJS(contactName)}')" class="pm-modal-close">✕</span>
    </div>
    <div style="padding:16px;display:flex;flex-direction:column;gap:8px;">
        ${emojiCheckHtml}
        <div style="margin-top:-6px;">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
            <span style="font-size:13px;font-weight:600;">⏰ 自动发消息</span>
            <div onclick="window.__pmToggleAutoPoke('${safeJS(contactName)}')"
                class="pm-custom-check pm-bi-style ${config.autoPoke.enabled ? 'is-checked' : ''}"
                id="pm-poke-check"
                style="cursor:pointer;width:22px;height:22px;min-width:22px;min-height:22px;flex-shrink:0;border-radius:50%;">
            </div>
        </div>
        <div style="display:flex;align-items:center;gap:8px;">
            <span style="font-size:12px;color:#888;">每隔</span>
            <input id="pm-poke-interval" type="number" min="1" max="99"
                value="${config.autoPoke.interval}"
                style="width:50px;border:1px solid #ddd;border-radius:6px;padding:4px 8px;font-size:13px;text-align:center;"
                ${!config.autoPoke.enabled ? 'disabled' : ''}>
            <span style="font-size:12px;color:#888;">轮无输入主动发消息</span>
        </div>
        <div style="font-size:11px;color:#999;margin-top:4px;">
            当前计数：<span id="pm-poke-counter">${config.autoPoke.counter}</span> / ${config.autoPoke.interval}
        </div>
        </div>
        <div style="margin-top:4px;">
        <button onclick="window.__pmPoke('${safeJS(contactName)}')"
                style="width:100%;background:linear-gradient(135deg,#ff9500,#ff6b00);color:#fff;border:none;border-radius:12px;padding:14px;font-size:14px;cursor:pointer;font-weight:600;display:flex;align-items:center;justify-content:center;">
            拍一拍
        </button>
        </div>
    </div>
    </div>`);
    }

    window.__pmSaveAndCloseContactConfig = (contactName) => {
        const checkEl = document.getElementById('pm-poke-check');
        const intervalEl = document.getElementById('pm-poke-interval');
        const emojiChecks = document.querySelectorAll('.pm-emoji-assign-check.is-checked');
        const selectedEmojis = Array.from(emojiChecks).map(cb => cb.dataset.id);

        if (checkEl && intervalEl) {
            const id = getStorageId();
            if (!window.__pmPokeConfig[id]) window.__pmPokeConfig[id] = {};

            const enabled = checkEl.classList.contains('is-checked');
            const interval = parseInt(intervalEl.value) || 3;
            const oldCounter = window.__pmPokeConfig[id][contactName]?.autoPoke?.counter || 0;

            window.__pmPokeConfig[id][contactName] = {
                autoPoke: {
                    enabled,
                    interval: Math.max(1, Math.min(99, interval)),
                    counter: enabled ? Math.min(oldCounter, interval - 1) : oldCounter
                },
                emojis: selectedEmojis
            };
            savePokeConfig();
        }

        document.getElementById('pm-overlay')?.remove();
        addNote(`已保存 ${contactName} 的设置`);
    };


    window.__pmToggleAutoPoke = (contactName) => {
        const checkEl = document.getElementById('pm-poke-check');
        const intervalEl = document.getElementById('pm-poke-interval');
        if (!checkEl) return;
        const isChecked = checkEl.classList.toggle('is-checked');
        if (intervalEl) intervalEl.disabled = !isChecked;
    };

    window.__pmPoke = async (contactName) => {
        // 修复：先检查生成锁，再切换联系人，避免"界面已切换但函数直接 return"的幽灵切换问题
        if (state.isGenerating) return;

        const id = getStorageId();
        if (window.__pmPokeConfig[id]?.[contactName]) {
            window.__pmPokeConfig[id][contactName].autoPoke.counter = 0;
            savePokeConfig();
        }

        document.getElementById('pm-overlay')?.remove();

        if (state.currentPersona !== contactName) {
            window.__pmSwitchContact(contactName);
        }

        const storageId = state.activeStorageId || id;
        const saveKey = state.isGroupChat && state.currentGroupKey ? state.currentGroupKey : state.currentPersona;
        if (!storageId || storageId === 'sms_unknown__default' || saveKey !== contactName) {
            console.warn('[phone-mode] __pmPoke: 目标会话未成功切换，取消生成');
            return;
        }
        const task = beginGeneration(storageId);
        if (!task) return;

        showTyping();

        const targetHistory = state.conversationHistory.slice();
        const isGroup = state.isGroupChat;
        const groupDisplayName = state.groupDisplayName;
        const groupMembers = state.groupMembers.slice();
        const isStillTarget = () => isGenerationTaskActive(task) && state.activeStorageId === storageId
            && (state.isGroupChat && state.currentGroupKey ? state.currentGroupKey : state.currentPersona) === saveKey;

        try {
        const ctxData = await gatherContext(task.context);
        if (!isGenerationTaskActive(task)) return;
        const { cardDesc, cardPersonality, cardScenario, cardMesExample, mainChatText, worldBookText, userName, userDesc } = ctxData;

        const userBlock = buildUserBlock(userName, userDesc);
        const smsHistoryText = buildHistoryText(targetHistory, CONTEXT_LIMIT, userName, isGroup ? null : contactName);

        const systemPrompt = buildPokeSystemPrompt(isGroup, contactName, userName);

        // 修复：注入表情包提示词（与 fetchSMS 保持一致）
        const targetContactKey = saveKey;
        const emojiPrompt = getEmojiPrompt(targetContactKey, storageId, window.__pmPokeConfig, window.__pmEmojis);
        const basePrompt = isGroup
            ? buildPokeGroupPrompt({
                groupName: groupDisplayName || '群聊', memberList: groupMembers.join('、'),
                userName, userBlock, cardDesc, cardPersonality, cardScenario,
                worldBookText, mainChatText, smsHistoryText,
              })
            : buildPokeSinglePrompt({
                contactName, userName, userBlock, cardDesc, cardPersonality,
                cardScenario, cardMesExample, worldBookText, mainChatText, smsHistoryText,
              });
        const userPrompt = basePrompt
            + (emojiPrompt ? emojiPrompt : '')
            + getWordyPrompt(window.__pmWordyLimit);

            const raw = await callAI(systemPrompt, userPrompt);
            if (!isGenerationTaskActive(task)) return;
            let historyUpdated = false;

            if (isStillTarget()) hideTyping();

            if (isGroup) {
                const parsed = parseGroupResponse(raw, groupMembers);
                const contentParts = [];
                const historyIndex = targetHistory.length;
                for (const block of parsed) {
                    if (block.sentences.length > 0) {
                        contentParts.push(`${block.name}：${block.sentences.join(' / ')}`);
                        for (const s of block.sentences) {
                            await new Promise(r => setTimeout(r, 120));
                            if (!isGenerationTaskActive(task)) return;
                            if (isStillTarget()) addBubble(s, 'left', block.name, historyIndex);
                        }
                    }
                }
                if (contentParts.length > 0) {
                    targetHistory.push({ role: 'assistant', content: contentParts.join('\n') });
                    historyUpdated = true;
                }
            } else {
                const clean = cleanResponse(raw);
                const sentences = splitToSentences(clean);
                if (sentences.length > 0) {
                    const historyIndex = targetHistory.length;
                    targetHistory.push({ role: 'assistant', content: sentences.join(' / ') });
                    historyUpdated = true;
                    for (const s of sentences) {
                        await new Promise(r => setTimeout(r, 150));
                        if (!isGenerationTaskActive(task)) return;
                        if (isStillTarget()) addBubble(s, 'left', undefined, historyIndex);
                    }
                }
            }

            if (historyUpdated) {
                if (!window.__pmHistories[storageId]) window.__pmHistories[storageId] = {};
                window.__pmHistories[storageId][saveKey] = targetHistory.slice(-SAVE_LIMIT);
                if (isStillTarget()) state.conversationHistory = window.__pmHistories[storageId][saveKey];
                saveHistories();
                if (isGenerationTaskActive(task)) applyBidirectionalInjection();
            }
        } catch (e) {
            if (isStillTarget()) { hideTyping(); addNote(`（发送失败：${e?.message || e}）`); }
        } finally {
            finishGeneration(task);
        }
    };

    window.__pmEditGroup = () => {
        if (!state.isGroupChat) {
            showContactConfig(state.currentPersona);
        } else {
            showGroupForm('edit', state.groupDisplayName, state.groupMembers);
        }
    };
    window.__pmToggleAutoPokeGroup = () => {
        const checkEl = document.getElementById('pm-poke-check-group');
        const intervalEl = document.getElementById('pm-poke-interval-group');
        if (!checkEl) return;
        const isChecked = checkEl.classList.toggle('is-checked');
        if (intervalEl) intervalEl.disabled = !isChecked;
    };

    window.__pmPokeGroup = async () => {
        if (!state.isGroupChat || !state.currentGroupKey) return;
        // 修复：先检查生成锁，再移除 overlay，避免弹窗关闭但函数直接 return 的状态不一致
        if (state.isGenerating) return;

        const id = getStorageId();
        const storageId = state.activeStorageId || id;
        const saveKey = state.currentGroupKey;
        if (!storageId || storageId === 'sms_unknown__default') return;
        if (window.__pmPokeConfig[storageId]?.[saveKey]) {
            window.__pmPokeConfig[storageId][saveKey].autoPoke.counter = 0;
            savePokeConfig();
        }

        document.getElementById('pm-overlay')?.remove();
        const task = beginGeneration(storageId);
        if (!task) return;

        showTyping();

        const targetHistory = state.conversationHistory.slice();
        const groupDisplayName = state.groupDisplayName;
        const groupMembers = state.groupMembers.slice();
        const isStillTarget = () => isGenerationTaskActive(task) && state.activeStorageId === storageId
            && state.isGroupChat && state.currentGroupKey === saveKey;

        try {
        const ctxData = await gatherContext(task.context);
        if (!isGenerationTaskActive(task)) return;
        const { cardDesc, cardPersonality, cardScenario, mainChatText, worldBookText, userName, userDesc } = ctxData;

        const userBlock = buildUserBlock(userName, userDesc);
        const smsHistoryText = buildHistoryText(targetHistory, CONTEXT_LIMIT, userName, null);

        const systemPrompt = buildPokeSystemPrompt(true, saveKey, userName);
        const userPrompt = buildPokeGroupActivePrompt({
            groupDisplayName, memberList: groupMembers.join('、'),
            userName, userBlock, cardDesc, cardPersonality, cardScenario,
            worldBookText, mainChatText, smsHistoryText,
        })
            + (getEmojiPrompt(saveKey, storageId, window.__pmPokeConfig, window.__pmEmojis) || '')
            + getWordyPrompt(window.__pmWordyLimit);

            const raw = await callAI(systemPrompt, userPrompt);
            if (!isGenerationTaskActive(task)) return;
            if (isStillTarget()) hideTyping();

            const parsed = parseGroupResponse(raw, groupMembers);
            const contentParts = [];

            for (const block of parsed) {
                if (block.sentences.length > 0) {
                    contentParts.push(`${block.name}：${block.sentences.join(' / ')}`);
                    for (const s of block.sentences) {
                        await new Promise(r => setTimeout(r, 120));
                        if (!isGenerationTaskActive(task)) return;
                        if (isStillTarget()) addBubble(s, 'left', block.name, targetHistory.length);
                    }
                    // 每个成员说完话立即落盘，防止后续 block 渲染途中挂起
                    targetHistory.push({ role: 'assistant', content: contentParts[contentParts.length - 1] });
                    if (!window.__pmHistories[storageId]) window.__pmHistories[storageId] = {};
                    window.__pmHistories[storageId][saveKey] = targetHistory.slice(-SAVE_LIMIT);
                    if (isStillTarget()) state.conversationHistory = window.__pmHistories[storageId][saveKey];
                    saveHistories();
                }
            }

            if (contentParts.length > 0) {
                // 已在循环内逐条 push，此处仅做双向注入
                if (isGenerationTaskActive(task)) applyBidirectionalInjection();
            }
        } catch (e) {
            if (isStillTarget()) { hideTyping(); addNote(`（发送失败：${e?.message || e}）`); }
        } finally {
            finishGeneration(task);
        }
    };
}
