export const NIGHT_PROMPT = Object.freeze({
    label: '夜间来信',
    defaultStyle: '成熟、克制又有张力，深夜匿名来信，可以触及禁忌关系与欲望，文字私密而不粗俗。',
    feedGuide: '每晚开一次信箱，有一个收信人题目，大家往里投匿名信。每封信写明写给谁，有落款。成熟、有情感张力，可以写禁忌关系与欲望。时间感在零点到四点之间。',
    feedFields: 'meta.tonight 为 {"title":今夜题目}，形如「写给一个……的人」，与正文情绪呼应。items 为 4-6 封信，字段为 author、to（写给谁，不超过 20 字）、content、sign（落款，不超过 20 字）、comments（回信 0-3 条，每项为 author、content）。',
    commentGuide: '回信：有共鸣，也有劝告和不同立场，语气私密、低声。',
    commentFields: 'items 为 3-6 条，字段为 author、content。',
    liveTone: '低声、私密、深夜，像在耳边说话。',
});
