export const DEFAULT_RANDOM_NPC_PROMPT = '允许不在固定成员名单上的路人群友自然参与聊天；临时角色名必须使用“路人群友·名字”格式，并根据群聊性质生成身份和语气合适、名字简短明确的临时角色。';

export function buildGroupAdditionalContext({ randomNpcEnabled = false, groupNature = '', randomNpcPrompt = '' } = {}) {
    const nature = typeof groupNature === 'string' ? groupNature.trim() : '';
    const prompt = typeof randomNpcPrompt === 'string' ? randomNpcPrompt.trim() : '';
    const parts = [];
    if (nature) parts.push(`群聊性质：${nature}`);
    if (randomNpcEnabled) {
        parts.push(`路人群友提示词：${prompt || DEFAULT_RANDOM_NPC_PROMPT}`);
    }
    return parts.length ? `\n\n【群聊补充信息】\n${parts.join('\n')}` : '';
}
