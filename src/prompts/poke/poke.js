import { buildGroupAdditionalContext } from '../shared/group-context.js';

export function buildPokeSinglePrompt({
    contactName, userName, userBlock, cardDesc, cardPersonality,
    cardScenario, cardMesExample, worldBookText, mainChatText, smsHistoryText,
}) {
    return `用户有一段时间没有回复。作为${contactName}，根据你的人设和当前聊天情境，自然地发送 3-8 句短信继续对话或发起新话题，不要提及用户没有回复这件事。

【用户信息】
${userBlock}

【角色设定】
${cardDesc || ''}

【性格】
${cardPersonality || ''}

【场景】
${cardScenario || ''}

【对话示例】
${cardMesExample || ''}

【世界书】
${worldBookText || ''}

【主线最近对话】
${mainChatText || ''}

【短信对话历史】
${smsHistoryText}

输出格式：短信内容 / 短信内容（每句用 / 分隔；特殊消息必须独占一个片段，使用中文单行格式：转账+金额、收款：金额、退还 金额、图片：描述、语音 内容；退还指拒绝聊天对象转账）`;
}

export function buildPokeGroupPrompt({
    groupName, memberList, userName, userBlock, cardDesc,
    cardPersonality, cardScenario, worldBookText, mainChatText, smsHistoryText,
    randomNpcEnabled = false, groupNature = '', randomNpcPrompt = '',
}) {
    return `群聊名称：${groupName}\n群聊成员：${memberList}\n\n用户有一段时间没有说话。请以所有群成员的身份，根据各自的性格、人设和当前聊天上下文，自然地发起话题或继续聊天。每个成员根据人设决定发言 0-8 句。\n\n输出格式：角色名：消息 / 消息。特殊消息必须独占一个 / 分隔片段，使用中文单行格式：转账+金额、收款：金额、退还 金额、图片：描述、语音 内容；退还指拒绝聊天对象转账。\n\n【用户信息】\n${userBlock}\n\n【角色设定】\n${cardDesc || ''}\n\n【性格】\n${cardPersonality || ''}\n\n【场景】\n${cardScenario || ''}\n\n【世界书】\n${worldBookText || ''}\n\n【主线最近对话】\n${mainChatText || ''}\n\n【群聊历史】\n${smsHistoryText}${buildGroupAdditionalContext({ randomNpcEnabled, groupNature, randomNpcPrompt })}`;
}

export function buildPokeGroupActivePrompt({
    groupDisplayName, memberList, userName, userBlock, cardDesc,
    cardPersonality, cardScenario, worldBookText, mainChatText, smsHistoryText,
    randomNpcEnabled = false, groupNature = '', randomNpcPrompt = '',
}) {
    return `群聊名称：${groupDisplayName || '群聊'}\n群聊成员：${memberList}\n\n请以每个群成员的身份，根据各自的性格、人设和当前聊天上下文，自然地发起话题或继续聊天，不要提及任何外部触发。\n每个成员根据自己的判断选择发言 0-8 条。\n\n输出格式：角色名：消息内容 / 消息内容。特殊消息必须独占一个 / 分隔片段，使用中文单行格式：转账+金额、收款：金额、退还 金额、图片：描述、语音 内容；退还指拒绝聊天对象转账。\n\n【用户信息】\n${userBlock}\n\n【角色设定】\n${cardDesc || ''}\n\n【性格】\n${cardPersonality || ''}\n\n【场景】\n${cardScenario || ''}\n\n【世界书】\n${worldBookText || ''}\n\n【主线最近对话】\n${mainChatText || ''}\n\n【群聊历史】\n${smsHistoryText}${buildGroupAdditionalContext({ randomNpcEnabled, groupNature, randomNpcPrompt })}`;
}

export function buildPokeSystemPrompt(isGroup, contactName, userName) {
    if (isGroup) {
        return `你同时扮演群聊中的所有成员。\n【务必直接按格式输出短信内容，严禁在开头输出“好的”等废话。】`;
    }
    return `你正在扮演"${contactName}"通过手机短信与用户 ${userName} 聊天。\n【务必直接按格式输出短信内容，严禁在开头输出“好的”等废话。】`;
}
