import { CONTEXT_LIMIT, SAVE_LIMIT } from './constants.js';
import { cleanResponse, splitToSentences } from './prompts.js';
import { escapeAttr } from './ui.js';
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
        getStorageId, gatherContext, callAI, applyBidirectionalInjection, makeOverlay,
        addBubble, addNote, addDirector, showTyping, hideTyping, persistCurrentHistory,
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
        const hasUserMessage = !!userMsg.trim();
        const smsHistoryText = buildHistoryText(targetHistory, CONTEXT_LIMIT, userName, isGroup ? null : currentPersona, hasUserMessage);

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
        // 注入表情包提示词
        const emojiPrompt = getEmojiPrompt(saveKey, storageId, window.__pmPokeConfig, window.__pmEmojis);
        if (emojiPrompt) { systemPrompt += emojiPrompt; injectedInstruction += emojiPrompt; }
        // 注入字数限制提示词
        const wordyPrompt = getWordyPrompt(window.__pmWordyLimit);
        if (wordyPrompt) { systemPrompt += wordyPrompt; injectedInstruction += wordyPrompt; }
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
            return isGroup
                ? { type: 'group', data: [{ name: '系统', sentences: [`（错误：${e?.message || e}）`] }] }
                : { type: 'single', data: [`（错误：${e?.message || e}）`] };
        }
    }

    window.__pmSend = async () => {
        if (state.isGenerating) return;
        const input = state.phoneWindow?.querySelector('.pm-input');
        if (!input) return;
        const val = input.value.trim(); if (!val) return;

        // 解析方括号引导：先把 [emo:...] 格式临时占位保护，再匹配 【...】/[...]/［...］ 为剧情引导
        const EMO_PLACEHOLDER = '\u0002';
        const emoSlots = [];
        const valProtected = val.replace(/\[emo:[^\]]+\]/g, m => { emoSlots.push(m); return EMO_PLACEHOLDER + (emoSlots.length - 1) + EMO_PLACEHOLDER; });
        const DIRECTOR_RE = /[【\[［]([^】\]］]+)[】\]］]/g;
        const directorNotes = [];
        let m;
        DIRECTOR_RE.lastIndex = 0;
        while ((m = DIRECTOR_RE.exec(valProtected)) !== null) directorNotes.push(m[1].trim());
        const directorNote = directorNotes.join('；');
        // 去掉所有方括号引导内容后，还原 emo 占位
        const plainValProtected = valProtected.replace(/[【\[［][^】\]］]*[】\]］]/g, '').trim();
        const plainVal = plainValProtected.replace(new RegExp(EMO_PLACEHOLDER + '(\\d+)' + EMO_PLACEHOLDER, 'g'), (_, i) => emoSlots[+i] || '');

        // 渲染剧情引导条（居中，不是气泡）
        // 如果没有正常发言也没有引导，直接返回（不可能走到这，但防御一下）
        if (!directorNote && !plainVal) return;

        const storageId = state.activeStorageId || getStorageId();
        const saveKey = state.isGroupChat && state.currentGroupKey ? state.currentGroupKey : state.currentPersona;
        if (!saveKey) return;
        const task = beginGeneration(storageId);
        if (!task) return;
        const request = {
            storageId, saveKey,
            isGroup: state.isGroupChat,
            currentPersona: state.currentPersona,
            groupMembers: state.groupMembers.slice(),
            groupDisplayName: state.groupDisplayName,
            targetHistory: state.conversationHistory.slice(),
        };
        if (plainVal.trim()) {
            request.targetHistory.push({ role: 'user', content: plainVal });
            state.conversationHistory = request.targetHistory.slice(-SAVE_LIMIT);
            persistCurrentHistory(saveKey, storageId, request.targetHistory);
        }
        const isStillTarget = () => isGenerationTaskActive(task)
            && state.activeStorageId === storageId
            && (state.isGroupChat && state.currentGroupKey ? state.currentGroupKey : state.currentPersona) === saveKey;
        input.value = '';
        if (directorNote) addDirector(directorNote);

        const protect = plainVal.replace(/[\(（][^)）]+[\)\）]/g, m => m.replace(/\//g, '\u0001'));
        const rawChunks = protect.split(/[/／]/).map(s => s.replace(/\u0001/g, '/').trim()).filter(Boolean);
        // 把含 [emo:...] 的 chunk 按标记边界再拆成独立气泡
        const userBubbles = rawChunks.flatMap(chunk => {
            const parts = []; let lastIdx = 0, m;
            const emoRe = /\[emo:[^\]]+\]/g;
            while ((m = emoRe.exec(chunk)) !== null) {
                const before = chunk.slice(lastIdx, m.index).trim();
                if (before) parts.push(before);
                parts.push(m[0]);
                lastIdx = m.index + m[0].length;
            }
            const after = chunk.slice(lastIdx).trim();
            if (after) parts.push(after);
            return parts.length ? parts : [chunk];
        });
        // 先渲染用户气泡，fetchSMS push 后回填 historyIndex
        const pendingUserBubbles = [];
        userBubbles.forEach(chunk => {
            addBubble(chunk, 'right');
            const list = state.phoneWindow?.querySelector('.pm-msg-list');
            const allBubbles = list?.querySelectorAll('.pm-bubble[data-side="right"], .pm-group-bubble-wrap[data-side="right"]');
            if (allBubbles?.length) pendingUserBubbles.push(allBubbles[allBubbles.length - 1]);
        });
        showTyping();
        try {
            const result = await fetchSMS(plainVal, directorNote, task, request);
            if (!result || !isGenerationTaskActive(task)) return;
            if (isStillTarget()) hideTyping();
            // 回填用户气泡的 historyIndex
            // 若有正常用户发言，fetchSMS 里 push 了 user+assistant，AI 在 length-1，user 在 length-2
            // 若纯剧情引导无用户发言，fetchSMS 只 push 了 assistant，AI 在 length-1
            const hasUserMsg = !!plainVal.trim();
            const userHi = request.targetHistory.length - (hasUserMsg ? 2 : 1);
            if (isStillTarget()) {
                state.conversationHistory = request.targetHistory.slice(-SAVE_LIMIT);
                pendingUserBubbles.forEach(b => { b.dataset.historyIndex = userHi; const inner = b.querySelector('.pm-bubble'); if(inner) inner.dataset.historyIndex = userHi; });
            }
            const aiHi = request.targetHistory.length - 1;
            if (result.type === 'group') {
                for (const block of result.data) {
                    for (const s of block.sentences) {
                        await new Promise(r => setTimeout(r, 120));
                        if (isStillTarget()) addBubble(s, 'left', block.name, aiHi);
                    }
                }
            } else {
                for (const s of result.data) {
                    await new Promise(r => setTimeout(r, 150));
                    if (isStillTarget()) addBubble(s, 'left', undefined, aiHi);
                }
            }
        } catch(e) {
            if (isStillTarget()) { hideTyping(); addNote(`（发送失败：${e?.message || e}）`); }
            console.error('[phone-mode] __pmSend 异常', e);
        } finally {
            const shouldFocus = input.isConnected && isStillTarget();
            finishGeneration(task);
            if (shouldFocus) input.focus();
        }

        setTimeout(() => {
            if (!state.isGenerating && typeof window.__pmIncrementCounters === 'function') {
                window.__pmIncrementCounters();
            }
        }, 300);
    };

// 打开长文本输入界面
    window.__pmShowExpandInput = () => {
        const smallInput = state.phoneWindow?.querySelector('.pm-input');
        const currentText = smallInput ? smallInput.value : '';

        makeOverlay(`
<div class="pm-modal pm-modal-wide">
  <div class="pm-modal-header" style="justify-content:space-between;padding-right:14px;">
    <b>长文本输入</b>
    <span onclick="(()=>{ const ta=document.getElementById('pm-expanded-textarea'); const si=document.querySelector('.pm-input'); if(ta && si) si.value=ta.value; document.getElementById('pm-overlay').remove(); })()" class="pm-modal-close">✕</span>
  </div>
  <div style="padding:14px 16px;">
    <textarea id="pm-expanded-textarea" class="pm-cfg-input" rows="7"
        style="height:auto; resize:none; font-size:14px; padding:10px; line-height:1.5; font-family:inherit;"
        placeholder="在这里输入多行文本...">${escapeAttr(currentText)}</textarea>
  </div>
  <div class="pm-modal-add" style="display:flex;gap:8px;">
    <button onclick="(()=>{ const ta=document.getElementById('pm-expanded-textarea'); const si=document.querySelector('.pm-input'); if(ta && si) si.value=ta.value; window.__pmShowEmojiPicker(); })()" style="flex:2;background:#f0f0f3;color:#333;border:1px solid #ddd;border-radius:10px;padding:10px;font-size:14px;cursor:pointer;font-weight:600;">(^ ^)</button>
    <button onclick="window.__pmConfirmExpandInput()" style="flex:8;background:#007aff;color:#fff;border:none;border-radius:10px;padding:10px;font-size:13px;cursor:pointer;font-weight:600;">发送</button>
  </div>
</div>`);

        setTimeout(() => {
            const ta = document.getElementById('pm-expanded-textarea');
            if (ta) {
                ta.focus();
                ta.selectionStart = ta.selectionEnd = ta.value.length;
            }
        }, 10);
    };

    // 确认发送长文本
    window.__pmConfirmExpandInput = () => {
        const ta = document.getElementById('pm-expanded-textarea');
        const smallInput = state.phoneWindow?.querySelector('.pm-input');

        if (ta && smallInput) {
            smallInput.value = ta.value; // 将长文本同步回底部的原输入框
            document.getElementById('pm-overlay')?.remove();

            // 如果文本不为空，直接触发发送
            if (ta.value.trim()) {
                window.__pmSend();
            }
        }
    };

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
