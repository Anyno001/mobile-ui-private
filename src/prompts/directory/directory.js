export const AUTO_GENERATION_BATCH = 10;

export function buildDirectoryPrompts(context, existingNames) {
    const { cardDesc, cardPersonality, cardScenario, mainChatText, worldBookText, userName, userDesc } = context;
    const existingText = existingNames.length
        ? `已有联系人/群聊（跳过同名）：${existingNames.join('、')}`
        : '目前暂无联系人。';
    const amountText = `3 到 ${AUTO_GENERATION_BATCH}`;
    const systemPrompt = `你是一个角色扮演辅助工具，负责根据当前剧情背景自动生成符合世界观的联系人列表。\n输出必须严格为 JSON：{"contacts":["角色名"],"groups":[{"name":"群聊名称","members":["成员1","成员2"]}]}\n要求：\n1. contacts 是单个联系人，groups 是群聊（每个群至少 2 个成员，不设产品数量上限）\n2. 本次生成总数为 ${amountText} 个\n3. 名称必须符合当前剧情世界观\n4. 不得与 ${existingText} 同名（忽略大小写）\n5. 不生成用户自己（${userName}），联系人名、群聊名和群聊成员均不得使用该用户名（忽略大小写）\n6. 只输出 JSON，不输出注释或 markdown`;
    const userPrompt = [
        `【用户信息】\n用户名：${userName}${userDesc ? '\n' + userDesc : ''}`,
        cardDesc ? `【角色/世界设定】\n${cardDesc}` : '',
        cardPersonality ? `【性格】\n${cardPersonality}` : '',
        cardScenario ? `【场景】\n${cardScenario}` : '',
        worldBookText ? `【世界书】\n${worldBookText}` : '',
        mainChatText ? `【主线最近对话】\n${mainChatText}` : '',
        existingText,
        `请生成 ${amountText} 个符合以上背景的联系人和/或群聊，以 JSON 输出。`,
    ].filter(Boolean).join('\n\n');
    return { systemPrompt, userPrompt };
}
