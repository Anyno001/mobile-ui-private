import { CONTEXT_LIMIT, SAVE_LIMIT } from './constants.js';
import { buildChatPreferencePrompt } from './behavior-config.js';
import { createHistoryWindow } from './history-window.js';
import { cleanResponse, splitToSentences } from './prompts.js';
import {
    addPendingMessage, combinePendingMessages, getPendingMessages,
    removePendingBatch, setPendingBatchStatus,
} from './pending-messages.js';
import {
    getEmojiPrompt, getWordyPrompt, parseGroupResponse,
} from './messaging.js';
import { savePokeConfig } from './storage.js';
import {
    buildUserBlock, buildHistoryText, buildAntiFluff,
    buildSingleInjectedInstruction, buildSingleSystemPrompt,
    buildGroupInjectedInstruction, buildGroupSystemPrompt,
    buildIndependentSingleUserPrompt, buildIndependentGroupUserPrompt,
} from './chat-prompts.js';

export function installPhoneChat(state, deps) {
    const {
        runtime, getStorageId, gatherContext, callAI, applyBidirectionalInjection,
        addBubble, addNote, addDirector, rebaseRenderedHistory, showTyping, hideTyping, persistCurrentHistory,
        beginGeneration, isGenerationTaskActive, finishGeneration,
    } = deps;
    async function fetchSMS(userMsg, directorNote, task, request) {
        const {
            storageId, saveKey, isGroup, currentPersona,
            groupMembers, groupDisplayName, targetHistory,
        } = request;
        // 存入历史前把表情包标记替换为可读描述，让 AI 理解表情含义但不学习格式
        const userMsgClean = userMsg.replace(/\[emo:([^\]:]+):(\d+)\]/g, (_, setName, idxStr) => {
            const set = (window.__pmEmojis || []).find(item => item.name === setName);
            const image = set?.images?.[parseInt(idxStr, 10) - 1];
            return image?.desc ? `[表情包：${image.desc}]` : '[表情包]';
        }).replace(/\s{2,}/g, ' ').trim();
        const ctxData = await gatherContext(task.context);
        if (!isGenerationTaskActive(task)) return null;
        const { cardDesc, cardPersonality, cardScenario, cardFirstMes, cardMesExample, mainChatText, worldBookText, userName, userDesc } = ctxData;

        const userBlock = buildUserBlock(userName, userDesc);
        const smsHistoryText = buildHistoryText(targetHistory, CONTEXT_LIMIT, userName, isGroup ? null : currentPersona);

        let injectedInstruction, systemPrompt;

        if (isGroup) {
            const memberList = groupMembers.join('、');
            const groupName = groupDisplayName || `群聊：${memberList}`;
            injectedInstruction = buildGroupInjectedInstruction({
                groupName, memberList, userName, userBlock,
                cardScenario, worldBookText, smsHistoryText, directorNote,
                userMsgClean, userMsg,
            });
            systemPrompt = buildGroupSystemPrompt({
                memberList, groupName, userName, userBlock,
                cardDesc, cardPersonality, cardScenario, worldBookText, mainChatText,
            });
        } else {
            const contextBlockMain = [
                cardScenario ? `【场景参考】\n${cardScenario}` : '',
                cardMesExample ? `【对话示例】\n${cardMesExample}` : '',
            ].filter(Boolean).join('\n\n');
            injectedInstruction = buildSingleInjectedInstruction({
                currentPersona, userName, userBlock,
                contextBlockMain, smsHistoryText, directorNote, userMsgClean, userMsg,
            });
            systemPrompt = buildSingleSystemPrompt({
                currentPersona, userName, userBlock,
                cardDesc, cardPersonality, cardScenario, cardFirstMes, cardMesExample,
                worldBookText, mainChatText,
            });
        }

        const antiFluff = buildAntiFluff();
        const preferencePrompt = buildChatPreferencePrompt({
            store: window.__pmCharacterBehavior,
            storageId,
            names: isGroup ? groupMembers : currentPersona,
            isGroup,
            emojiPrompt: getEmojiPrompt(saveKey, storageId, window.__pmPokeConfig, window.__pmEmojis),
            wordyPrompt: getWordyPrompt(window.__pmWordyLimit),
        });
        if (preferencePrompt) { systemPrompt += preferencePrompt; injectedInstruction += preferencePrompt; }
        systemPrompt += `\n\n${antiFluff}`;
        injectedInstruction += `\n\n${antiFluff}`;

        try {
            const cfg = window.__pmConfig;
            const useIndep = cfg.useIndependent && cfg.apiUrl && cfg.apiKey;
            let raw = '';

            if (useIndep) {
                const indepUserPrompt = isGroup
                    ? buildIndependentGroupUserPrompt({
                        smsHistoryText, directorNote, userMsgClean, userMsg, userName,
                    })
                    : buildIndependentSingleUserPrompt({
                        smsHistoryText, directorNote, userMsgClean, userMsg, userName,
                        currentPersona,
                    });
                raw = await callAI(systemPrompt, indepUserPrompt, { maxTokens: isGroup ? 600 : 300 });
            } else {
                raw = await callAI('', injectedInstruction, { maxTokens: isGroup ? 600 : 300 });
            }
            if (!isGenerationTaskActive(task)) return null;

            if (request.userHistoryEntry) {
                targetHistory.push(request.userHistoryEntry);
            }
            let resultData;
            if (isGroup) {
                const parsed = parseGroupResponse(raw, groupMembers);
                if (parsed.length) {
                    const contentParts = parsed.map(p => `${p.name}：${p.sentences.join(' / ')}`);
                    targetHistory.push({ role: 'assistant', content: contentParts.join('\n') });
                    resultData = { type: 'group', data: parsed };
                } else {
                    console.warn('[phone-mode] ⚠️ 群聊格式解析失败！AI 原始返回内容：', raw);
                    targetHistory.push({ role: 'assistant', content: '（格式无法解析或AI拒答）' });
                    const snippet = raw ? raw.substring(0, 20).replace(/\n/g, '') + '...' : '空响应或纯思考过程';
                    resultData = {
                        type: 'group',
                        data: [{
                            name: '系统',
                            sentences: [`（格式解析失败。AI原话: ${snippet}，请按F12查看控制台或检查是否触发了安全审查）`]
                        }]
                    };
                }
            } else {
                const clean = cleanResponse(raw);
                let sentences = splitToSentences(clean);
                if (!sentences.length && raw?.trim()) sentences = splitToSentences(raw.replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/<[^>]+>/g, ''));
                if (!sentences.length) sentences = !raw?.trim() ? ['（空响应）'] : ['（格式无法解析）'];
                targetHistory.push({ role: 'assistant', content: sentences.join(' / ') });
                resultData = { type: 'single', data: sentences };
            }

            persistCurrentHistory(saveKey, storageId, targetHistory);
            if (isGenerationTaskActive(task)) applyBidirectionalInjection();
            return resultData;
        } catch (e) {
            console.error('[phone-mode]', e);
            if (!isGenerationTaskActive(task)) return null;
            throw e;
        }
    }

    function parsePendingInput(value) {
        const rawText = String(value || '').trim();
        if (!rawText) return null;
        const placeholder = '\u0002';
        const emojiSlots = [];
        const protectedText = rawText.replace(/\[emo:[^\]]+\]/g, match => {
            emojiSlots.push(match);
            return `${placeholder}${emojiSlots.length - 1}${placeholder}`;
        });
        const directorPattern = /[【\[［]([^】\]］]+)[】\]］]/g;
        const directorNotes = [];
        let match;
        while ((match = directorPattern.exec(protectedText)) !== null) directorNotes.push(match[1].trim());
        const plainProtected = protectedText.replace(/[【\[［][^】\]］]*[】\]］]/g, '').trim();
        const plainText = plainProtected.replace(
            new RegExp(`${placeholder}(\\d+)${placeholder}`, 'g'),
            (_, index) => emojiSlots[Number(index)] || '',
        );
        const protectedSlashes = plainText.replace(/[\(（][^)）]+[\)）]/g, value => value.replace(/\//g, '\u0001'));
        const chunks = protectedSlashes.split(/[/／]/).map(value => value.replace(/\u0001/g, '/').trim()).filter(Boolean);
        const bubbleParts = chunks.flatMap(chunk => {
            const parts = [];
            let lastIndex = 0;
            const emojiPattern = /\[emo:[^\]]+\]/g;
            while ((match = emojiPattern.exec(chunk)) !== null) {
                const before = chunk.slice(lastIndex, match.index).trim();
                if (before) parts.push(before);
                parts.push(match[0]);
                lastIndex = match.index + match[0].length;
            }
            const after = chunk.slice(lastIndex).trim();
            if (after) parts.push(after);
            return parts.length ? parts : [chunk];
        });
        const directorNote = directorNotes.join('；');
        return plainText || directorNote ? { rawText, plainText, directorNote, bubbleParts } : null;
    }

    function getPendingTarget() {
        const storageId = state.activeStorageId || getStorageId();
        const saveKey = state.isGroupChat && state.currentGroupKey ? state.currentGroupKey : state.currentPersona;
        if (!storageId || storageId === 'sms_unknown__default' || !saveKey) return null;
        return { storageId, saveKey };
    }

    function renderPendingItem(item) {
        const metadata = { pendingId: item.id, pendingStatus: item.status };
        if (item.directorNote) addDirector(item.directorNote, metadata);
        for (const part of item.bubbleParts) addBubble(part, 'right', undefined, undefined, metadata);
    }

    function renderPendingConversation(storageId, saveKey) {
        const list = state.phoneWindow?.querySelector('.pm-msg-list');
        if (!list) return;
        for (const node of list.querySelectorAll('.pm-pending-entry')) {
            if (!node.parentElement?.closest('.pm-pending-entry')) node.remove();
        }
        for (const item of getPendingMessages(runtime, storageId, saveKey)) renderPendingItem(item);
    }

    function updatePendingDomStatus(itemIds, status) {
        const ids = new Set(itemIds.map(String));
        for (const node of state.phoneWindow?.querySelectorAll('[data-pending-id]') || []) {
            if (ids.has(node.dataset.pendingId)) node.dataset.pendingStatus = status;
        }
    }

    function queuePendingText(value) {
        const target = getPendingTarget();
        const parsed = parsePendingInput(value);
        if (!target || !parsed) return null;
        const item = addPendingMessage(runtime, target.storageId, target.saveKey, parsed);
        if (!item) return null;
        renderPendingItem(item);
        return item;
    }

    window.__pmSend = () => {
        const input = state.phoneWindow?.querySelector('.pm-input');
        if (!input || !queuePendingText(input.value)) return;
        input.value = '';
        window.__pmRefreshControlCenter?.();
        input.focus();
    };

    window.__pmSubmitPending = async () => {
        if (state.isGenerating) return;
        const target = getPendingTarget();
        if (!target) return;
        const combined = combinePendingMessages(runtime, target.storageId, target.saveKey);
        const batch = combined.items.filter(item => item.status !== 'submitting');
        if (!batch.length) return;
        const itemIds = batch.map(item => item.id);
        const task = beginGeneration(target.storageId);
        if (!task) return;
        setPendingBatchStatus(runtime, target.storageId, target.saveKey, itemIds, 'submitting');
        updatePendingDomStatus(itemIds, 'submitting');
        window.__pmRefreshControlCenter?.();
        const request = {
            storageId: target.storageId,
            saveKey: target.saveKey,
            isGroup: state.isGroupChat,
            currentPersona: state.currentPersona,
            groupMembers: state.groupMembers.slice(),
            groupDisplayName: state.groupDisplayName,
            targetHistory: state.conversationHistory.slice(),
            userHistoryEntry: {
                role: 'user',
                content: combined.plainText,
                ...(combined.directorNote ? { directorNote: combined.directorNote } : {}),
            },
        };
        const isStillTarget = () => isGenerationTaskActive(task)
            && state.activeStorageId === target.storageId
            && (state.isGroupChat && state.currentGroupKey ? state.currentGroupKey : state.currentPersona) === target.saveKey;
        if (isStillTarget()) showTyping();
        try {
            const result = await fetchSMS(combined.plainText, combined.directorNote, task, request);
            if (!result || !isGenerationTaskActive(task)) return;
            if (isStillTarget()) hideTyping();
            const historyWindow = createHistoryWindow(request.targetHistory, SAVE_LIMIT);
            const userHistoryIndex = historyWindow.toWindowIndex(request.targetHistory.length - 2);
            const aiHistoryIndex = historyWindow.toWindowIndex(request.targetHistory.length - 1);
            removePendingBatch(runtime, target.storageId, target.saveKey, itemIds);
            if (isStillTarget()) {
                rebaseRenderedHistory(historyWindow.trimmedCount);
                state.conversationHistory = historyWindow.history;
                const ids = new Set(itemIds.map(String));
                for (const node of state.phoneWindow?.querySelectorAll('[data-pending-id]') || []) {
                    if (!ids.has(node.dataset.pendingId)) continue;
                    node.classList.remove('pm-pending-entry');
                    delete node.dataset.pendingId;
                    delete node.dataset.pendingStatus;
                    if (userHistoryIndex !== null) node.dataset.historyIndex = String(userHistoryIndex);
                }
            }
            if (result.type === 'group') {
                for (const block of result.data) {
                    for (const sentence of block.sentences) {
                        await new Promise(resolve => setTimeout(resolve, 120));
                        if (isStillTarget()) addBubble(sentence, 'left', block.name, aiHistoryIndex);
                    }
                }
            } else {
                for (const sentence of result.data) {
                    await new Promise(resolve => setTimeout(resolve, 150));
                    if (isStillTarget()) addBubble(sentence, 'left', undefined, aiHistoryIndex);
                }
            }
            setTimeout(() => {
                if (!state.isGenerating && typeof window.__pmIncrementCounters === 'function') window.__pmIncrementCounters();
            }, 300);
        } catch (error) {
            setPendingBatchStatus(runtime, target.storageId, target.saveKey, itemIds, 'failed');
            updatePendingDomStatus(itemIds, 'failed');
            if (isStillTarget()) {
                hideTyping();
                addNote(`（发送失败：${error?.message || error}，暂存内容已保留）`);
            }
            console.error('[phone-mode] __pmSubmitPending 异常', error);
        } finally {
            const remaining = getPendingMessages(runtime, target.storageId, target.saveKey);
            const remainingIds = new Set(remaining.map(item => item.id));
            const interruptedIds = itemIds.filter(itemId => remainingIds.has(itemId));
            if (interruptedIds.length) {
                setPendingBatchStatus(runtime, target.storageId, target.saveKey, interruptedIds, 'failed');
                updatePendingDomStatus(interruptedIds, 'failed');
            }
            finishGeneration(task);
            window.__pmRefreshControlCenter?.();
        }
    };

    Object.assign(deps, {
        parsePendingInput, queuePendingText, renderPendingItem, renderPendingConversation,
    });



    window.__pmIncrementCounters = () => {
        const id = getStorageId();
        const configs = window.__pmPokeConfig[id];
        if (!configs) return;

        let updated = false;
        const toPoke = [];

        for (const [contact, config] of Object.entries(configs)) {
            if (config?.autoPoke?.enabled) {
                config.autoPoke.counter = (config.autoPoke.counter || 0) + 1;
                updated = true;
                if (config.autoPoke.counter >= config.autoPoke.interval) {
                    config.autoPoke.counter = 0;
                    toPoke.push(contact);
                }
            }
        }

        if (updated) {
            savePokeConfig();
            const counterEl = document.getElementById('pm-poke-counter');
            if (counterEl && configs[state.currentPersona]) counterEl.textContent = configs[state.currentPersona].autoPoke.counter;
            const groupCounterEl = document.getElementById('pm-poke-counter-group');
            if (groupCounterEl && state.currentGroupKey && configs[state.currentGroupKey]) groupCounterEl.textContent = configs[state.currentGroupKey].autoPoke.counter;
        }

        if (toPoke.length > 0) {
            (async () => {
                for (const contact of toPoke) { await window.__pmAutoPoke(contact); }
            })();
        }
    };
    Object.assign(deps, { fetchSMS });
}
