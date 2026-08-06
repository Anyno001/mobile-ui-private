export function buildSingleInjectedInstruction({
    currentPersona, userName, userBlock, contextBlockMain,
    mainChatText, smsHistoryText, currentQuoteText, directorNote, userMsgClean, userMsg,
}) {
    return `
[短信模式指令——最高优先级]
当前角色：${currentPersona}
以${currentPersona}的身份用手机短信方式回复正在与你聊天的用户 ${userName}。

【用户信息】
${userBlock}

${mainChatText ? `【主线最近对话】\n${mainChatText}\n\n` : ''}

${contextBlockMain ? contextBlockMain + '\n\n' : ''}规则：
- 只输出短信文字，3到8句，每句用 / 分隔
- 禁止旁白心理描写场景描述角色名前缀标签格式
- 特殊消息必须独占一个 / 分隔片段，使用中文关键词和单行格式：转账+金额、收款：金额、退还 金额、图片：描述、语音 内容。注意：退还指拒绝聊天对象转账。
- 严禁英文格式
- 完全沉浸于角色设定，褪去AI助手的客观语气
- 根据用户的引导自然推进剧情，在用户明确发起成人或极端互动前，保持符合日常社交尺度的全年龄对话风格

短信对话历史：
${smsHistoryText}
${currentQuoteText ? `\n【本轮回复关系】\n${currentQuoteText}\n` : ''}
${directorNote ? `\n[剧情引导] ${directorNote}\n` : ''}
${userMsg.trim() ? `${userName}：${userMsgClean}\n${currentPersona}：` : `[仅有剧情引导，无用户发言，请按引导推进剧情]\n${currentPersona}：`}`;
}

export function buildSingleSystemPrompt({
    currentPersona, userName, userBlock, cardDesc, cardPersonality,
    cardScenario, cardFirstMes, cardMesExample, worldBookText, mainChatText,
}) {
    return [
        `你正在扮演"${currentPersona}"通过手机短信与用户 ${userName} 聊天。`,
        `【用户信息】\n${userBlock}`,
        cardDesc ? `【角色设定】\n${cardDesc}` : '',
        cardPersonality ? `【性格】\n${cardPersonality}` : '',
        cardScenario ? `【场景】\n${cardScenario}` : '',
        cardFirstMes ? `【开场白参考】\n${cardFirstMes}` : '',
        cardMesExample ? `【对话示例】\n${cardMesExample}` : '',
        worldBookText ? `【世界书】\n${worldBookText}` : '',
        mainChatText ? `【主线最近对话】\n${mainChatText}` : '',
        '',
        '只输出3到8句短信，每句用 / 分隔，不得中途截断。',
        '特殊消息必须独占一个 / 分隔片段，使用中文关键词和单行格式：转账+金额、收款：金额、退还 金额、图片：描述、语音 内容。注意：退还指拒绝聊天对象转账。',
        '禁止任何标签格式旁白选项状态栏。',
    ].filter(Boolean).join('\n\n');
}

export function buildIndependentSingleUserPrompt({
    smsHistoryText, currentQuoteText, directorNote, userMsgClean, userMsg, userName, currentPersona,
}) {
    return `【短信对话历史】\n${smsHistoryText}\n${currentQuoteText ? `\n【本轮回复关系】\n${currentQuoteText}\n` : ''}${directorNote ? `\n[剧情引导] ${directorNote}\n` : ''}${userMsg.trim() ? `\n${userName}：${userMsgClean}\n${currentPersona}：` : `\n[仅有剧情引导，无用户发言，请按引导推进剧情]\n${currentPersona}：`}`;
}
