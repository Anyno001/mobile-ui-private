import { buildAntiFluff, buildUserBlock } from './blocks.js';
import {
    buildIndependentSingleUserPrompt,
    buildSingleInjectedInstruction,
    buildSingleSystemPrompt,
} from './single.js';
import {
    buildGroupInjectedInstruction,
    buildGroupSystemPrompt,
    buildIndependentGroupUserPrompt,
} from './group.js';
import {
    buildPokeGroupActivePrompt,
    buildPokeGroupPrompt,
    buildPokeSinglePrompt,
    buildPokeSystemPrompt,
} from '../poke/poke.js';

export function buildChatRequest({
    isGroup, currentPersona, groupMembers = [], groupDisplayName = '', groupRandomNpcEnabled = false,
    groupNature = '', groupRandomNpcPrompt = '', userName, userDesc, cardDesc, cardPersonality,
    cardScenario, cardFirstMes, cardMesExample, worldBookText, mainChatText, smsHistoryText,
    currentQuoteText = '', directorNote = '', userMsgClean = '', userMsg = '', preferencePrompt = '',
    useIndependent = false, signal,
} = {}) {
    const userBlock = buildUserBlock(userName, userDesc);
    let injectedInstruction;
    let systemPrompt;
    if (isGroup) {
        const memberList = groupMembers.join('、');
        const groupName = groupDisplayName || `群聊：${memberList}`;
        injectedInstruction = buildGroupInjectedInstruction({
            groupName, memberList, userName, userBlock, cardScenario, worldBookText, mainChatText,
            smsHistoryText, currentQuoteText, directorNote, userMsgClean, userMsg,
            randomNpcEnabled: groupRandomNpcEnabled, groupNature, randomNpcPrompt: groupRandomNpcPrompt,
        });
        systemPrompt = buildGroupSystemPrompt({
            memberList, groupName, userName, userBlock, cardDesc, cardPersonality, cardScenario,
            worldBookText, mainChatText, randomNpcEnabled: groupRandomNpcEnabled, groupNature,
            randomNpcPrompt: groupRandomNpcPrompt,
        });
    } else {
        const contextBlockMain = [
            cardScenario ? `【场景参考】\n${cardScenario}` : '',
            cardMesExample ? `【对话示例】\n${cardMesExample}` : '',
        ].filter(Boolean).join('\n\n');
        injectedInstruction = buildSingleInjectedInstruction({
            currentPersona, userName, userBlock, contextBlockMain, mainChatText, smsHistoryText,
            currentQuoteText, directorNote, userMsgClean, userMsg,
        });
        systemPrompt = buildSingleSystemPrompt({
            currentPersona, userName, userBlock, cardDesc, cardPersonality, cardScenario,
            cardFirstMes, cardMesExample, worldBookText, mainChatText,
        });
    }
    const antiFluff = buildAntiFluff();
    if (preferencePrompt) { systemPrompt += preferencePrompt; injectedInstruction += preferencePrompt; }
    systemPrompt += `\n\n${antiFluff}`;
    injectedInstruction += `\n\n${antiFluff}`;
    const independentUserPrompt = isGroup
        ? buildIndependentGroupUserPrompt({ smsHistoryText, currentQuoteText, directorNote, userMsgClean, userMsg, userName })
        : buildIndependentSingleUserPrompt({ smsHistoryText, currentQuoteText, directorNote, userMsgClean, userMsg, userName, currentPersona });
    return useIndependent
        ? { systemPrompt, userPrompt: independentUserPrompt, options: { signal } }
        : { systemPrompt: '', userPrompt: injectedInstruction, options: { signal } };
}

export function buildPokeRequest({
    activeGroup = false, isGroup, contactName, groupName, groupDisplayName = '', groupMembers = [],
    groupRandomNpcEnabled = false, groupNature = '', groupRandomNpcPrompt = '', userName, userDesc,
    cardDesc, cardPersonality, cardScenario, cardMesExample, worldBookText, mainChatText, smsHistoryText,
    preferencePrompt = '', signal,
} = {}) {
    const userBlock = buildUserBlock(userName, userDesc);
    const systemPrompt = buildPokeSystemPrompt(isGroup, contactName, userName);
    const userPrompt = activeGroup
        ? buildPokeGroupActivePrompt({
            groupDisplayName, memberList: groupMembers.join('、'), userName, userBlock, cardDesc,
            cardPersonality, cardScenario, worldBookText, mainChatText, smsHistoryText,
            randomNpcEnabled: groupRandomNpcEnabled, groupNature, randomNpcPrompt: groupRandomNpcPrompt,
        })
        : isGroup
            ? buildPokeGroupPrompt({
                groupName, memberList: groupMembers.join('、'), userName, userBlock, cardDesc,
                cardPersonality, cardScenario, worldBookText, mainChatText, smsHistoryText,
                randomNpcEnabled: groupRandomNpcEnabled, groupNature, randomNpcPrompt: groupRandomNpcPrompt,
            })
            : buildPokeSinglePrompt({
                contactName, userName, userBlock, cardDesc, cardPersonality, cardScenario,
                cardMesExample, worldBookText, mainChatText, smsHistoryText,
            });
    return { systemPrompt, userPrompt: userPrompt + preferencePrompt, options: { signal } };
}
