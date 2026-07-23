import { cleanResponse } from './prompts.js';
import { formatQuoteContext } from './chat-message-model.js';

/**
 * 构建用户信息块
 */
export function buildUserBlock(userName, userDesc) {
    return [`用户名字：${userName}`, userDesc ? `用户人设：${userDesc}` : ''].filter(Boolean).join('\n');
}

/**
 * 格式化对话历史用于 Prompt
 * @param {Array} history - 对话历史数组
 * @param {number} limit - 最大条目数
 * @param {string} userName - 用户名
 * @param {string|null} personaName - 角色名（null 表示群聊，assistant 行没有角色名前缀）
 * @param {boolean} excludeLast - 是否排除最后一条
 */
export function buildHistoryText(history, limit, userName, personaName, excludeLast = false) {
    const slice = excludeLast ? history.slice(-limit, -1) : history.slice(-limit);
    return slice.map(m => {
        const clean = cleanResponse(m.content);
        const director = m.directorNote ? `[剧情引导] ${m.directorNote}` : '';
        const quote = formatQuoteContext(m.quote);
        const quoteLine = quote ? `【${quote}】` : '';
        const userLine = clean ? `${userName}：${clean}` : '';
        if (m.role === 'user') return [quoteLine, userLine, director].filter(Boolean).join('\n');
        if (personaName) return [quoteLine, `${personaName}：${clean}`].filter(Boolean).join('\n');
        return [quoteLine, clean].filter(Boolean).join('\n');
    }).filter(Boolean).join('\n');
}

/**
 * 防废话指令
 */
export function buildAntiFluff() {
    return '【务必直接按格式输出短信内容，严禁在开头输出“好的”、“下面是”等任何说明性废话，严禁输出非角色的语言。】';
}

/**
 * 单人聊天 — 注入指令（injectedInstruction，用于主API）
 */
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
- 特殊格式（中文单行闭合）：(转账+金额) (收款+金额) (退还+金额) (图片+描述) (语音+内容)。注意：退还指拒绝聊天对象转账。
- 严禁英文格式
- 完全沉浸于角色设定，褪去AI助手的客观语气
- 根据用户的引导自然推进剧情，在用户明确发起成人或极端互动前，保持符合日常社交尺度的全年龄对话风格

短信对话历史：
${smsHistoryText}
${currentQuoteText ? `\n【本轮回复关系】\n${currentQuoteText}\n` : ''}
${directorNote ? `\n[剧情引导] ${directorNote}\n` : ''}
${userMsg.trim() ? `${userName}：${userMsgClean}\n${currentPersona}：` : `[仅有剧情引导，无用户发言，请按引导推进剧情]\n${currentPersona}：`}`;
}

/**
 * 单人聊天 — 系统提示（systemPrompt，用于独立API）
 */
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
        '特殊格式（必须中文单行闭合）：(转账+金额) (收款+金额) (退还+金额) (图片+描述) (语音+内容)。注意：退还指拒绝聊天对象转账。',
        '禁止任何标签格式旁白选项状态栏。',
    ].filter(Boolean).join('\n\n');
}

export function buildGroupAdditionalContext({ randomNpcEnabled = false, groupNature = '' } = {}) {
    const nature = typeof groupNature === 'string' ? groupNature.trim() : '';
    const parts = [];
    if (nature) parts.push(`群聊性质：${nature}`);
    if (randomNpcEnabled) {
        parts.push('允许不在固定成员名单上的路人群友自然参与聊天；临时角色名必须使用“路人群友·名字”格式，并根据群聊性质生成身份和语气合适、名字简短明确的临时角色。');
    }
    return parts.length ? `\n\n【群聊补充信息】\n${parts.join('\n')}` : '';
}

/**
 * 群聊 — 注入指令（injectedInstruction，用于主API）
 */
export function buildGroupInjectedInstruction({
    groupName, memberList, userName, userBlock, cardScenario,
    worldBookText, mainChatText, smsHistoryText, currentQuoteText, directorNote, userMsgClean, userMsg,
    randomNpcEnabled = false, groupNature = '',
}) {
    const speakerRule = randomNpcEnabled
        ? `角色名可以来自固定成员（${memberList}），临时路人群友必须命名为“路人群友·名字”`
        : `角色名必须来自：${memberList}`;
    const groupRules = `
[群聊短信模式——最高优先级]
群聊名称：${groupName}
群聊成员：${memberList}
你同时扮演以上所有角色与用户（${userName}）聊天。

⚠️ 输出必须满足以下全部条件，违反即视为无效：
1. 每一行都必须以 "角色名：" 开头（${speakerRule}）
2. 严禁输出对界面、系统、对话本身的总结或描述性文字
3. 严禁输出类似"现在应该..."、"我已经..."、"看起来..."这类叙述性句子
4. 特殊格式必须在同一行内完整写出且闭合：(转账+金额) (收款+金额) (退还+金额) (图片+描述) (语音+内容)。注意：退还指拒绝聊天对象转账。
5. 特殊格式括号内严禁换行、编号（1. 2. 3.）、列表
6. 每条消息内的 / 只用于分隔同一角色的多条短信
7. 每个角色根据自己的人设和当前剧情主动决定发言条数，0-8句，可穿插发言，不必所有人都说话
8. 严禁英文格式 (Voice+/Image+/Transfer+/Refund+)
9. 完全沉浸于角色设定，褪去AI客观语气。根据用户引导自然推进剧情，在用户明确发起成人或极端互动前，保持符合日常社交尺度的全年龄对话风格。

✅ 正确示例：
小明：我先到了 / 这家店真不错
小红：等我五分钟 / (语音+马上到别急)
小明：好 / (图片+刚拍的店门口)
小李：(退还+50) / 昨天多给的钱退你啦

❌ 错误示例（绝对禁止）：
小明：(语音+内容有换行
1. 第一点)
小红：界面现在应该正常了...`;
    return `${groupRules}

【用户信息】
${userBlock}

${cardScenario ? '【场景】\n' + cardScenario + '\n\n' : ''}${worldBookText ? '【世界书】\n' + worldBookText + '\n\n' : ''}${mainChatText ? '【主线最近对话】\n' + mainChatText + '\n\n' : ''}群聊历史：
${smsHistoryText}
${currentQuoteText ? `\n【本轮回复关系】\n${currentQuoteText}\n` : ''}
${directorNote ? `\n[剧情引导] ${directorNote}\n` : ''}
${userMsg.trim() ? `${userName}：${userMsgClean}` : '[仅有剧情引导，无用户发言，请按引导推进剧情]'}${buildGroupAdditionalContext({ randomNpcEnabled, groupNature })}`;
}

/**
 * 群聊 — 系统提示（systemPrompt，用于独立API）
 */
export function buildGroupSystemPrompt({
    memberList, groupName, userName, userBlock, cardDesc,
    cardPersonality, cardScenario, worldBookText, mainChatText,
    randomNpcEnabled = false, groupNature = '',
}) {
    return [
        `你同时扮演 ${memberList} 在群聊「${groupName}」中与用户 ${userName} 对话。${randomNpcEnabled ? '必要时也可生成符合群聊性质的临时路人群友。' : ''}`,
        `【用户信息】\n${userBlock}`,
        cardDesc ? `【角色设定】\n${cardDesc}` : '',
        cardPersonality ? `【性格】\n${cardPersonality}` : '',
        cardScenario ? `【场景】\n${cardScenario}` : '',
        worldBookText ? `【世界书】\n${worldBookText}` : '',
        mainChatText ? `【主线最近对话】\n${mainChatText}` : '',
        '',
        `输出格式：角色名：消息 / 消息（每个角色0-8句，根据人设和剧情决定是否发言及发言数量）`,
        `角色名后只跟该角色的话，严禁 "(角色名：xxx)" 这种嵌套。`,
        `角色可穿插发言，不必所有人都说话。`,
        '特殊格式（必须中文且单行闭合）：(转账+金额) (收款+金额) (退还+金额) (图片+描述) (语音+内容)。注意：退还指拒绝聊天对象转账。',
        '禁止任何标签格式旁白选项状态栏。',
        buildGroupAdditionalContext({ randomNpcEnabled, groupNature }),
    ].filter(Boolean).join('\n\n');
}

/**
 * 单人拍一拍 — Prompt
 */
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

输出格式：短信内容 / 短信内容（每句用 / 分隔，特殊格式中文单行闭合）`;
}

/**
 * 群聊拍一拍 — 主Prompt
 */
export function buildPokeGroupPrompt({
    groupName, memberList, userName, userBlock, cardDesc,
    cardPersonality, cardScenario, worldBookText, mainChatText, smsHistoryText,
    randomNpcEnabled = false, groupNature = '',
}) {
    return `群聊名称：${groupName}\n群聊成员：${memberList}\n\n用户有一段时间没有说话。请以所有群成员的身份，根据各自的性格、人设和当前聊天上下文，自然地发起话题或继续聊天。每个成员根据人设决定发言 0-8 句。\n\n输出格式：角色名：消息 / 消息\n\n【用户信息】\n${userBlock}\n\n【角色设定】\n${cardDesc || ''}\n\n【性格】\n${cardPersonality || ''}\n\n【场景】\n${cardScenario || ''}\n\n【世界书】\n${worldBookText || ''}\n\n【主线最近对话】\n${mainChatText || ''}\n\n【群聊历史】\n${smsHistoryText}${buildGroupAdditionalContext({ randomNpcEnabled, groupNature })}`;
}

/**
 * 主动发起群聊 — Prompt（用于 __pmPokeGroup，非 auto）
 */
export function buildPokeGroupActivePrompt({
    groupDisplayName, memberList, userName, userBlock, cardDesc,
    cardPersonality, cardScenario, worldBookText, mainChatText, smsHistoryText,
    randomNpcEnabled = false, groupNature = '',
}) {
    return `群聊名称：${groupDisplayName || '群聊'}\n群聊成员：${memberList}\n\n请以每个群成员的身份，根据各自的性格、人设和当前聊天上下文，自然地发起话题或继续聊天，不要提及任何外部触发。\n每个成员根据自己的判断选择发言 0-8 条。\n\n输出格式：角色名：消息内容 / 消息内容\n\n【用户信息】\n${userBlock}\n\n【角色设定】\n${cardDesc || ''}\n\n【性格】\n${cardPersonality || ''}\n\n【场景】\n${cardScenario || ''}\n\n【世界书】\n${worldBookText || ''}\n\n【主线最近对话】\n${mainChatText || ''}\n\n【群聊历史】\n${smsHistoryText}${buildGroupAdditionalContext({ randomNpcEnabled, groupNature })}`;
}

/**
 * 独立API 单人聊天 — userPrompt
 */
export function buildIndependentSingleUserPrompt({
    smsHistoryText, currentQuoteText, directorNote, userMsgClean, userMsg, userName, currentPersona,
}) {
    return `【短信对话历史】\n${smsHistoryText}\n${currentQuoteText ? `\n【本轮回复关系】\n${currentQuoteText}\n` : ''}${directorNote ? `\n[剧情引导] ${directorNote}\n` : ''}${userMsg.trim() ? `\n${userName}：${userMsgClean}\n${currentPersona}：` : `\n[仅有剧情引导，无用户发言，请按引导推进剧情]\n${currentPersona}：`}`;
}

/**
 * 独立API 群聊聊天 — userPrompt
 */
export function buildIndependentGroupUserPrompt({
    smsHistoryText, currentQuoteText, directorNote, userMsgClean, userMsg, userName,
}) {
    return `【群聊历史】\n${smsHistoryText}\n${currentQuoteText ? `\n【本轮回复关系】\n${currentQuoteText}\n` : ''}${directorNote ? `\n[剧情引导] ${directorNote}\n` : ''}${userMsg.trim() ? `\n${userName}：${userMsgClean}` : '\n[仅有剧情引导，无用户发言，请按引导推进剧情]'}`;
}

/**
 * 拍一拍 — 独立API systemPrompt
 */
export function buildPokeSystemPrompt(isGroup, contactName, userName) {
    if (isGroup) {
        return `你同时扮演群聊中的所有成员。\n【务必直接按格式输出短信内容，严禁在开头输出“好的”等废话。】`;
    }
    return `你正在扮演"${contactName}"通过手机短信与用户 ${userName} 聊天。\n【务必直接按格式输出短信内容，严禁在开头输出“好的”等废话。】`;
}
