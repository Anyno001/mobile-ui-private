import {
    CONTEXT_LIMIT, SAVE_LIMIT,
} from './constants.js';
import {
    buildChatPreferencePrompt, getCharacterBehavior, normalizeCharacterBehavior,
} from './behavior-config.js';
import {
    createMessageEntry, describeMessageEntry,
} from './chat-message-model.js';
import { createHistoryWindow } from './history-window.js';
import { cleanResponse, splitToSentences } from './prompts.js';
import { escapeAttr, escapeHtml, safeJS } from './ui.js';
import { CLOSE_ICON_SVG } from './icons.js';
import {
    getEmojiPrompt, getWordyPrompt, parseGroupResponse,
} from './messaging.js';
import {
    saveCharacterBehavior, saveHistories, saveHistoriesStrict, savePokeConfig,
} from './storage.js';
import { commitAutomaticResult } from './runtime.js';
import {
    buildUserBlock, buildHistoryText, buildPokeSystemPrompt,
    buildPokeGroupPrompt, buildPokeSinglePrompt,
    buildPokeGroupActivePrompt,
} from './chat-prompts.js';

export function installPhoneChatPoke(state, deps) {
    const {
        getStorageId, gatherContext, callAI, applyBidirectionalInjection,
        addBubble, addNote, rebaseRenderedHistory, showTyping, hideTyping, makeOverlay,
        showGroupForm, beginGeneration, isGenerationTaskActive, finishGeneration,
        isAutoPokeAllowed, armAutoPoke,
        beginAutomaticTask, isAutomaticTaskActive, finishAutomaticTask,
    } = deps;
    window.__pmAutoPoke = async (contactName) => {
        if (state.isGenerating || !isAutoPokeAllowed()) return false;
        const id = getStorageId();
        if (!id || id === 'sms_unknown__default') return false;
        const automaticTask = beginAutomaticTask(id, contactName);
        if (!automaticTask) return false;
        const task = beginGeneration(id);
        if (!task) {
            finishAutomaticTask(automaticTask);
            return false;
        }
        const groupMeta = window.__pmGroupMeta[id]?.[contactName];
        const isGroup = !!groupMeta;
        const groupMembers = groupMeta?.members?.slice() || [];

        const isActiveView = state.phoneActive && state.activeStorageId === id
            && ((isGroup && state.currentGroupKey === contactName) || (!isGroup && state.currentPersona === contactName));
        const isAutomaticRequestActive = () => isGenerationTaskActive(task)
            && isAutomaticTaskActive(automaticTask);
        const isStillActiveView = () => isAutomaticRequestActive()
            && state.activeStorageId === id
            && ((isGroup && state.isGroupChat && state.currentGroupKey === contactName)
                || (!isGroup && !state.isGroupChat && state.currentPersona === contactName));

        if (isActiveView) {
            showTyping();
        }

        try {
        const ctxData = await gatherContext(task.context);
        if (!isAutomaticRequestActive()) return false;
        const { cardDesc, cardPersonality, cardScenario, cardMesExample, mainChatText, worldBookText, userName, userDesc } = ctxData;
        const userBlock = buildUserBlock(userName, userDesc);

        let targetHistory = (window.__pmHistories[id]?.[contactName] || []).slice();
        const smsHistoryText = buildHistoryText(targetHistory, CONTEXT_LIMIT, userName, isGroup ? null : contactName);

        const systemPrompt = buildPokeSystemPrompt(isGroup, contactName, userName);
        const basePrompt = isGroup
            ? buildPokeGroupPrompt({
                groupName: groupMeta.name,
                memberList: groupMembers.join('、'),
                userName, userBlock, cardDesc, cardPersonality,
                cardScenario, worldBookText, mainChatText, smsHistoryText,
                randomNpcEnabled: groupMeta.randomNpcEnabled, groupNature: groupMeta.groupNature,
              })
            : buildPokeSinglePrompt({
                contactName, userName, userBlock, cardDesc, cardPersonality,
                cardScenario, cardMesExample, worldBookText, mainChatText, smsHistoryText,
              });
        const userPrompt = basePrompt + buildChatPreferencePrompt({
            store: window.__pmCharacterBehavior,
            storageId: id,
            names: isGroup ? groupMembers : contactName,
            isGroup,
            emojiPrompt: getEmojiPrompt(contactName, id, window.__pmPokeConfig, window.__pmEmojis),
            wordyPrompt: getWordyPrompt(window.__pmWordyLimit),
        });

            const raw = await callAI(systemPrompt, userPrompt);
            if (!isAutomaticRequestActive()) return false;
            let renderBlocks = [];
            let renderSentences = [];
            if (isGroup) {
                const parsed = parseGroupResponse(raw, groupMembers, {
                    allowUnknownSpeakers: groupMeta.randomNpcEnabled === true,
                });
                renderBlocks = parsed.filter(block => block.sentences.length > 0);
                const contentParts = renderBlocks.map(block => `${block.name}：${block.sentences.join(' / ')}`);
                if (!contentParts.length) return false;
                targetHistory.push(createMessageEntry({
                    role: 'assistant',
                    content: contentParts.join('\n'),
                    descriptors: renderBlocks.flatMap(block => block.sentences.map(text => ({ text, sender: block.name }))),
                }));
            } else {
                const clean = cleanResponse(raw);
                renderSentences = splitToSentences(clean);
                if (!renderSentences.length) return false;
                targetHistory.push(createMessageEntry({
                    role: 'assistant', content: renderSentences.join(' / '), descriptors: renderSentences,
                }));
            }

            if (!isAutomaticRequestActive()) return false;
            const autoPoke = window.__pmPokeConfig[id]?.[contactName]?.autoPoke;
            if (!autoPoke) return false;
            const interval = Math.max(1, Number(autoPoke.interval) || 1);
            const previousCounter = Math.max(0, Number(autoPoke.counter) || 0);
            const previousHistory = window.__pmHistories[id]?.[contactName];
            const historyWindow = createHistoryWindow(targetHistory, SAVE_LIMIT);
            const historyIndex = historyWindow.toWindowIndex(targetHistory.length - 1);
            const committed = await commitAutomaticResult({
                isActive: isAutomaticRequestActive,
                applyHistory: () => {
                    if (!window.__pmHistories[id]) window.__pmHistories[id] = {};
                    window.__pmHistories[id][contactName] = historyWindow.history;
                },
                restoreHistory: () => {
                    if (previousHistory === undefined) delete window.__pmHistories[id][contactName];
                    else window.__pmHistories[id][contactName] = previousHistory;
                },
                persistHistory: () => saveHistoriesStrict(),
                applyCounter: () => { autoPoke.counter = Math.max(0, previousCounter - interval); },
                restoreCounter: () => { autoPoke.counter = previousCounter; },
                persistCounter: savePokeConfig,
            });
            if (!committed) return false;
            applyBidirectionalInjection();
            if (isStillActiveView()) {
                hideTyping();
                state.conversationHistory = historyWindow.history;
                rebaseRenderedHistory(historyWindow.trimmedCount);
                const assistantEntry = targetHistory.at(-1);
                const bubbles = describeMessageEntry(assistantEntry);
                let bubbleIndex = 0;
                if (historyIndex !== null && isGroup) {
                    for (const block of renderBlocks) {
                        for (const sentence of block.sentences) {
                            await new Promise(resolve => setTimeout(resolve, 120));
                            if (!isStillActiveView()) return true;
                            const bubble = bubbles[bubbleIndex++];
                            addBubble(sentence, 'left', block.name, historyIndex, {
                                historyIndex, messageId: assistantEntry.messageId,
                                bubbleId: bubble?.bubbleId, sender: block.name,
                            });
                        }
                    }
                } else if (historyIndex !== null) {
                    for (const sentence of renderSentences) {
                        await new Promise(resolve => setTimeout(resolve, 150));
                        if (!isStillActiveView()) return true;
                        const bubble = bubbles[bubbleIndex++];
                        addBubble(sentence, 'left', undefined, historyIndex, {
                            historyIndex, messageId: assistantEntry.messageId,
                            bubbleId: bubble?.bubbleId, sender: contactName,
                        });
                    }
                }
            }
            return true;
        } catch (e) {
            if (isStillActiveView()) hideTyping();
            console.error('[phone-mode] 自动发消息失败', e);
            return false;
        } finally {
            hideTyping();
            finishGeneration(task);
            finishAutomaticTask(automaticTask);
        }
    };

    window.__pmArmAutoPoke = () => {
        if (!armAutoPoke()) return alert('请先打开手机并保持页面在前台。');
        addNote('已重新启用本次手机会话的自动消息');
        return true;
    };

    function showContactConfig(contactName) {
        const id = getStorageId();
        const config = window.__pmPokeConfig[id]?.[contactName] || {
            autoPoke: { enabled: false, interval: 3, counter: 0 }
        };
        const behavior = getCharacterBehavior(window.__pmCharacterBehavior, id, contactName);
        const assignedEmojis = config.emojis || [];

        const emojiCheckHtml = window.__pmEmojis.length ? `
        <div style="margin-bottom:8px;border-bottom:1px solid var(--pm-color-border-subtle);padding-bottom:14px;">
            <div class="pm-cfg-label" style="margin-bottom:8px;">允许 AI 使用的表情包套组</div>
            <div style="display:flex;flex-direction:column;gap:10px;max-height:130px;overflow-y:auto;background:var(--pm-color-surface-elevated);border-radius:8px;padding:10px;border:1px solid var(--pm-color-border-subtle);">
                ${window.__pmEmojis.map(set => `
                    <div style="display:flex;align-items:center;gap:10px;cursor:pointer;"
                         onclick="this.querySelector('.pm-emoji-assign-check').click()">
                        <div class="pm-custom-check pm-bi-style pm-emoji-assign-check ${assignedEmojis.includes(set.id)?'is-checked':''}"
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
            <div style="font-size:11px;color:var(--pm-color-text-tertiary);margin-top:4px;">勾选后 AI 会知道如何使用这些表情</div>
        </div>` : '';

        makeOverlay(`
    <div class="pm-modal pm-modal-wide">
    <div class="pm-modal-header">
        <span></span>
        <b class="pm-contact-settings-title" title="${escapeAttr(contactName)}">${escapeHtml(contactName)}</b>
        <button type="button" onclick="window.__pmCloseOverlay()" class="pm-modal-close" title="关闭" aria-label="关闭">${CLOSE_ICON_SVG}</button>
    </div>
    <div class="pm-contact-settings-scroll">
        <div class="pm-cfg-label">私聊线上风格</div>
        <textarea id="pm-behavior-private" class="pm-cfg-input" rows="2" maxlength="2000" placeholder="例如：回复克制、少用语气词">${escapeHtml(behavior.privateStylePrompt)}</textarea>
        <div class="pm-cfg-label">群聊发言风格</div>
        <textarea id="pm-behavior-group" class="pm-cfg-input" rows="2" maxlength="2000" placeholder="例如：群里更简短，偶尔接话">${escapeHtml(behavior.groupStylePrompt)}</textarea>
        <div class="pm-behavior-grid">
          <label>消息长短
            <select id="pm-behavior-length" class="pm-cfg-input">
              <option value="persona" ${behavior.messageLength === 'persona' ? 'selected' : ''}>跟随人设</option>
              <option value="short" ${behavior.messageLength === 'short' ? 'selected' : ''}>偏短</option>
              <option value="medium" ${behavior.messageLength === 'medium' ? 'selected' : ''}>中等</option>
              <option value="long" ${behavior.messageLength === 'long' ? 'selected' : ''}>偏长</option>
            </select>
          </label>
          ${[
              ['transfer', '转账频率', behavior.transferFrequency],
              ['image', '图片频率', behavior.imageFrequency],
              ['emoji', '表情包频率', behavior.emojiFrequency],
          ].map(([key, label, value]) => `<label>${label}
            <select id="pm-behavior-${key}" class="pm-cfg-input">
              <option value="never" ${value === 'never' ? 'selected' : ''}>禁用</option>
              <option value="rare" ${value === 'rare' ? 'selected' : ''}>很少</option>
              <option value="occasional" ${value === 'occasional' ? 'selected' : ''}>偶尔</option>
              <option value="frequent" ${value === 'frequent' ? 'selected' : ''}>经常</option>
            </select>
          </label>`).join('')}
        </div>
        ${emojiCheckHtml}
        <div style="margin-top:-6px;">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
            <span style="font-size:13px;font-weight:600;">⏰ 自动发消息</span>
            <div onclick="window.__pmToggleAutoPoke('${safeJS(contactName)}')"
                class="pm-custom-check pm-bi-style ${config.autoPoke.enabled ? 'is-checked' : ''}"
                id="pm-poke-check"
                role="checkbox" tabindex="0" aria-checked="${config.autoPoke.enabled}"
                onkeydown="if(event.key===' '||event.key==='Enter'){event.preventDefault();this.click()}"
                style="cursor:pointer;width:22px;height:22px;min-width:22px;min-height:22px;flex-shrink:0;border-radius:50%;">
            </div>
        </div>
        <div style="display:flex;align-items:center;gap:8px;">
            <span style="font-size:12px;color:var(--pm-color-text-tertiary);">每隔</span>
            <input id="pm-poke-interval" type="number" min="1" max="99"
                value="${config.autoPoke.interval}"
                style="width:50px;border:1px solid var(--pm-color-border-default);border-radius:6px;padding:4px 8px;font-size:13px;text-align:center;"
                ${!config.autoPoke.enabled ? 'disabled' : ''}>
            <span style="font-size:12px;color:var(--pm-color-text-tertiary);">轮无输入主动发消息</span>
        </div>
        <div style="font-size:11px;color:var(--pm-color-text-tertiary);margin-top:4px;">
            当前计数：<span id="pm-poke-counter">${config.autoPoke.counter}</span> / ${config.autoPoke.interval}
        </div>
        </div>
    <div class="pm-modal-add pm-contact-settings-actions">
        <button type="button" class="pm-contact-settings-save" onclick="window.__pmSaveContactConfig('${safeJS(contactName)}')">保存角色设置</button>
    </div>
    </div>
    </div>`);
    }

    window.__pmShowCharacterBehavior = contactName => showContactConfig(contactName);
    window.__pmShowConversationSettings = () => {
        if (!state.isGroupChat) {
            showContactConfig(state.currentPersona);
            return;
        }
        const members = state.groupMembers.slice();
        makeOverlay(`
    <div class="pm-modal pm-modal-wide">
      <div class="pm-modal-header"><span></span><b>成员聊天行为</b><button type="button" onclick="window.__pmCloseOverlay()" class="pm-modal-close" title="关闭" aria-label="关闭">${CLOSE_ICON_SVG}</button></div>
      <div class="pm-member-behavior-list">
        ${members.map(name => `<button onclick="window.__pmShowCharacterBehavior('${safeJS(name)}')">
          <b>${escapeHtml(name)}</b><span>私聊风格、群聊风格与消息频率</span>
        </button>`).join('')}
      </div>
    </div>`);
    };

    window.__pmSaveContactConfig = (contactName) => {
        const checkEl = document.getElementById('pm-poke-check');
        const intervalEl = document.getElementById('pm-poke-interval');
        const behaviorSnapshot = JSON.parse(JSON.stringify(window.__pmCharacterBehavior));
        const pokeSnapshot = JSON.parse(JSON.stringify(window.__pmPokeConfig));
        const emojiChecks = document.querySelectorAll('.pm-emoji-assign-check.is-checked');
        const selectedEmojis = Array.from(emojiChecks).map(cb => cb.dataset.id);
        const id = getStorageId();
        if (!window.__pmCharacterBehavior[id]) window.__pmCharacterBehavior[id] = {};
        const behavior = normalizeCharacterBehavior({
            privateStylePrompt: document.getElementById('pm-behavior-private')?.value || '',
            groupStylePrompt: document.getElementById('pm-behavior-group')?.value || '',
            messageLength: document.getElementById('pm-behavior-length')?.value,
            transferFrequency: document.getElementById('pm-behavior-transfer')?.value,
            imageFrequency: document.getElementById('pm-behavior-image')?.value,
            emojiFrequency: document.getElementById('pm-behavior-emoji')?.value,
        });
        Object.defineProperty(window.__pmCharacterBehavior[id], contactName, {
            value: behavior, enumerable: true, configurable: true, writable: true,
        });
        if (!saveCharacterBehavior()) {
            window.__pmCharacterBehavior = behaviorSnapshot;
            alert('角色设置保存失败：浏览器存储不可用。');
            return false;
        }

        if (checkEl && intervalEl) {
            if (!window.__pmPokeConfig[id]) window.__pmPokeConfig[id] = {};

            const enabled = checkEl.classList.contains('is-checked');
            const interval = parseInt(intervalEl.value) || 3;
            const oldCounter = window.__pmPokeConfig[id][contactName]?.autoPoke?.counter || 0;

            window.__pmPokeConfig[id][contactName] = {
                autoPoke: {
                    enabled,
                    interval: Math.max(1, Math.min(99, interval)),
                    counter: enabled ? Math.min(oldCounter, interval) : oldCounter
                },
                emojis: selectedEmojis
            };
            if (!savePokeConfig()) {
                window.__pmCharacterBehavior = behaviorSnapshot;
                window.__pmPokeConfig = pokeSnapshot;
                const rollbackOk = saveCharacterBehavior();
                alert(rollbackOk
                    ? '自动消息设置保存失败：浏览器存储不可用。'
                    : '自动消息设置保存失败，且角色设置回滚未能写入存储。请立即导出备份。');
                return false;
            }
        }

        addNote(`已保存 ${contactName} 的设置`);
        return true;
    };
    window.__pmSaveAndCloseContactConfig = contactName => window.__pmSaveContactConfig(contactName);


    window.__pmToggleAutoPoke = (contactName) => {
        const checkEl = document.getElementById('pm-poke-check');
        const intervalEl = document.getElementById('pm-poke-interval');
        if (!checkEl) return;
        const isChecked = checkEl.classList.toggle('is-checked');
        checkEl.setAttribute('aria-checked', String(isChecked));
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
        const groupRandomNpcEnabled = state.groupRandomNpcEnabled;
        const groupNature = state.groupNature;
        const isStillTarget = () => isGenerationTaskActive(task) && state.activeStorageId === storageId
            && (state.isGroupChat && state.currentGroupKey ? state.currentGroupKey : state.currentPersona) === saveKey;

        try {
        const ctxData = await gatherContext(task.context);
        if (!isGenerationTaskActive(task)) return;
        const { cardDesc, cardPersonality, cardScenario, cardMesExample, mainChatText, worldBookText, userName, userDesc } = ctxData;

        const userBlock = buildUserBlock(userName, userDesc);
        const smsHistoryText = buildHistoryText(targetHistory, CONTEXT_LIMIT, userName, isGroup ? null : contactName);

        const systemPrompt = buildPokeSystemPrompt(isGroup, contactName, userName);

        const targetContactKey = saveKey;
        const basePrompt = isGroup
            ? buildPokeGroupPrompt({
                groupName: groupDisplayName || '群聊', memberList: groupMembers.join('、'),
                userName, userBlock, cardDesc, cardPersonality, cardScenario,
                worldBookText, mainChatText, smsHistoryText,
                randomNpcEnabled: groupRandomNpcEnabled, groupNature,
              })
            : buildPokeSinglePrompt({
                contactName, userName, userBlock, cardDesc, cardPersonality,
                cardScenario, cardMesExample, worldBookText, mainChatText, smsHistoryText,
              });
        const userPrompt = basePrompt + buildChatPreferencePrompt({
            store: window.__pmCharacterBehavior,
            storageId,
            names: isGroup ? groupMembers : contactName,
            isGroup,
            emojiPrompt: getEmojiPrompt(targetContactKey, storageId, window.__pmPokeConfig, window.__pmEmojis),
            wordyPrompt: getWordyPrompt(window.__pmWordyLimit),
        });

            const raw = await callAI(systemPrompt, userPrompt);
            if (!isGenerationTaskActive(task)) return;
            let historyUpdated = false;

            if (isStillTarget()) hideTyping();

            if (isGroup) {
                const parsed = parseGroupResponse(raw, groupMembers, {
                    allowUnknownSpeakers: groupRandomNpcEnabled === true,
                });
                const blocks = parsed.filter(block => block.sentences.length > 0);
                const contentParts = blocks.map(block => `${block.name}：${block.sentences.join(' / ')}`);
                if (contentParts.length > 0) {
                    const assistantEntry = createMessageEntry({
                        role: 'assistant', content: contentParts.join('\n'),
                        descriptors: blocks.flatMap(block => block.sentences.map(text => ({ text, sender: block.name }))),
                    });
                    targetHistory.push(assistantEntry);
                    historyUpdated = true;
                    const historyWindow = createHistoryWindow(targetHistory, SAVE_LIMIT);
                    const historyIndex = historyWindow.toWindowIndex(targetHistory.length - 1);
                    if (isStillTarget()) rebaseRenderedHistory(historyWindow.trimmedCount);
                    const bubbles = describeMessageEntry(assistantEntry);
                    let bubbleIndex = 0;
                    if (historyIndex !== null) {
                        for (const block of blocks) {
                            for (const s of block.sentences) {
                                await new Promise(r => setTimeout(r, 120));
                                if (!isGenerationTaskActive(task)) return;
                                const bubble = bubbles[bubbleIndex++];
                                if (isStillTarget()) addBubble(s, 'left', block.name, historyIndex, {
                                    historyIndex, messageId: assistantEntry.messageId,
                                    bubbleId: bubble?.bubbleId, sender: block.name,
                                });
                            }
                        }
                    }
                }
            } else {
                const clean = cleanResponse(raw);
                const sentences = splitToSentences(clean);
                if (sentences.length > 0) {
                    const assistantEntry = createMessageEntry({
                        role: 'assistant', content: sentences.join(' / '), descriptors: sentences,
                    });
                    targetHistory.push(assistantEntry);
                    historyUpdated = true;
                    const historyWindow = createHistoryWindow(targetHistory, SAVE_LIMIT);
                    const historyIndex = historyWindow.toWindowIndex(targetHistory.length - 1);
                    if (isStillTarget()) rebaseRenderedHistory(historyWindow.trimmedCount);
                    const bubbles = describeMessageEntry(assistantEntry);
                    if (historyIndex !== null) {
                        for (let index = 0; index < sentences.length; index += 1) {
                            const s = sentences[index];
                            await new Promise(r => setTimeout(r, 150));
                            if (!isGenerationTaskActive(task)) return;
                            if (isStillTarget()) addBubble(s, 'left', undefined, historyIndex, {
                                historyIndex, messageId: assistantEntry.messageId,
                                bubbleId: bubbles[index]?.bubbleId, sender: contactName,
                            });
                        }
                    }
                }
            }

            if (historyUpdated) {
                if (!window.__pmHistories[storageId]) window.__pmHistories[storageId] = {};
                window.__pmHistories[storageId][saveKey] = createHistoryWindow(targetHistory, SAVE_LIMIT).history;
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
    window.__pmPokeCurrent = () => {
        if (state.isGenerating) return;
        if (state.isGroupChat) {
            window.__pmPokeGroup();
            return;
        }
        if (state.currentPersona) window.__pmPoke(state.currentPersona);
    };
    window.__pmToggleAutoPokeGroup = () => {
        const checkEl = document.getElementById('pm-poke-check-group');
        const intervalEl = document.getElementById('pm-poke-interval-group');
        if (!checkEl) return;
        const isChecked = checkEl.classList.toggle('is-checked');
        checkEl.setAttribute('aria-checked', String(isChecked));
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
        const groupRandomNpcEnabled = state.groupRandomNpcEnabled;
        const groupNature = state.groupNature;
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
            randomNpcEnabled: groupRandomNpcEnabled, groupNature,
        })
            + buildChatPreferencePrompt({
                store: window.__pmCharacterBehavior,
                storageId,
                names: groupMembers,
                isGroup: true,
                emojiPrompt: getEmojiPrompt(saveKey, storageId, window.__pmPokeConfig, window.__pmEmojis),
                wordyPrompt: getWordyPrompt(window.__pmWordyLimit),
            });

            const raw = await callAI(systemPrompt, userPrompt);
            if (!isGenerationTaskActive(task)) return;
            if (isStillTarget()) hideTyping();

            const parsed = parseGroupResponse(raw, groupMembers, {
                allowUnknownSpeakers: groupRandomNpcEnabled === true,
            });
            let renderedTrimmedCount = 0;
            for (const block of parsed) {
                if (block.sentences.length > 0) {
                    // 每个成员说完话立即落盘，防止后续 block 渲染途中挂起
                    const assistantEntry = createMessageEntry({
                        role: 'assistant',
                        content: `${block.name}：${block.sentences.join(' / ')}`,
                        descriptors: block.sentences.map(text => ({ text, sender: block.name })),
                    });
                    targetHistory.push(assistantEntry);
                    const historyWindow = createHistoryWindow(targetHistory, SAVE_LIMIT);
                    const historyIndex = historyWindow.toWindowIndex(targetHistory.length - 1);
                    const newlyTrimmed = historyWindow.trimmedCount - renderedTrimmedCount;
                    if (isStillTarget()) rebaseRenderedHistory(newlyTrimmed);
                    renderedTrimmedCount = historyWindow.trimmedCount;
                    if (!window.__pmHistories[storageId]) window.__pmHistories[storageId] = {};
                    window.__pmHistories[storageId][saveKey] = historyWindow.history;
                    if (isStillTarget()) state.conversationHistory = historyWindow.history;
                    saveHistories();
                    const bubbles = describeMessageEntry(assistantEntry);
                    if (historyIndex !== null) {
                        for (let index = 0; index < block.sentences.length; index += 1) {
                            const s = block.sentences[index];
                            await new Promise(r => setTimeout(r, 120));
                            if (!isGenerationTaskActive(task)) return;
                            if (isStillTarget()) addBubble(s, 'left', block.name, historyIndex, {
                                historyIndex, messageId: assistantEntry.messageId,
                                bubbleId: bubbles[index]?.bubbleId, sender: block.name,
                            });
                        }
                    }
                }
            }

            if (parsed.some(block => block.sentences.length > 0)) {
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
