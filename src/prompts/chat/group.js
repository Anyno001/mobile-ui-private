import { buildGroupAdditionalContext } from '../shared/group-context.js';

export function buildGroupInjectedInstruction({
    groupName, memberList, userName, userBlock, cardScenario,
    worldBookText, mainChatText, smsHistoryText, currentQuoteText, directorNote, userMsgClean, userMsg,
    randomNpcEnabled = false, groupNature = '', randomNpcPrompt = '',
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
4. 特殊消息必须独占一个 / 分隔片段，使用中文关键词和单行格式：转账+金额、收款：金额、退还 金额、图片：描述、语音 内容。注意：退还指拒绝聊天对象转账。
5. 特殊消息内容严禁换行、编号（1. 2. 3.）、列表
6. 每条消息内的 / 只用于分隔同一角色的多条短信
7. 每个角色根据自己的人设和当前剧情主动决定发言条数，0-8句，可穿插发言，不必所有人都说话
8. 严禁英文格式 (Voice+/Image+/Transfer+/Refund+)
9. 完全沉浸于角色设定，褪去AI客观语气。根据用户引导自然推进剧情，在用户明确发起成人或极端互动前，保持符合日常社交尺度的全年龄对话风格。

✅ 正确示例：
小明：我先到了 / 这家店真不错
小红：等我五分钟 / 语音 马上到别急
小明：好 / 图片：刚拍的店门口
小李：退还+50 / 昨天多给的钱退你啦

❌ 错误示例（绝对禁止）：
小明：语音 内容有换行
小红：界面现在应该正常了...`;
    return `${groupRules}

【用户信息】
${userBlock}

${cardScenario ? '【场景】\n' + cardScenario + '\n\n' : ''}${worldBookText ? '【世界书】\n' + worldBookText + '\n\n' : ''}${mainChatText ? '【主线最近对话】\n' + mainChatText + '\n\n' : ''}群聊历史：
${smsHistoryText}
${currentQuoteText ? `\n【本轮回复关系】\n${currentQuoteText}\n` : ''}
${directorNote ? `\n[剧情引导] ${directorNote}\n` : ''}
${userMsg.trim() ? `${userName}：${userMsgClean}` : '[仅有剧情引导，无用户发言，请按引导推进剧情]'}${buildGroupAdditionalContext({ randomNpcEnabled, groupNature, randomNpcPrompt })}`;
}

export function buildGroupSystemPrompt({
    memberList, groupName, userName, userBlock, cardDesc,
    cardPersonality, cardScenario, worldBookText, mainChatText,
    randomNpcEnabled = false, groupNature = '', randomNpcPrompt = '',
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
        '特殊消息必须独占一个 / 分隔片段，使用中文关键词和单行格式：转账+金额、收款：金额、退还 金额、图片：描述、语音 内容。注意：退还指拒绝聊天对象转账。',
        '禁止任何标签格式旁白选项状态栏。',
        buildGroupAdditionalContext({ randomNpcEnabled, groupNature, randomNpcPrompt }),
    ].filter(Boolean).join('\n\n');
}

export function buildIndependentGroupUserPrompt({
    smsHistoryText, currentQuoteText, directorNote, userMsgClean, userMsg, userName,
}) {
    return `【群聊历史】\n${smsHistoryText}\n${currentQuoteText ? `\n【本轮回复关系】\n${currentQuoteText}\n` : ''}${directorNote ? `\n[剧情引导] ${directorNote}\n` : ''}${userMsg.trim() ? `\n${userName}：${userMsgClean}` : '\n[仅有剧情引导，无用户发言，请按引导推进剧情]'}`;
}
