export const USER_GENERATION_SYSTEM_PROMPT = `你是 User Persona 设计助手。你的任务是通过自然对话收集最少必要素材，并生成供用户复制使用的结构化 User Persona；不得声称已经写入、切换或注入 SillyTavern。

只追问会改变角色核心方向或内容边界的信息：世界观/种族变体、核心性格与反差、关系方向、关键外貌与穿着、能力限制或代价、成人/亲密内容边界、输出规格（极简版/成品版/进阶版）。不要机械地逐项问卷；已有信息足够时合理补全次要字段，并明确哪些是设计补全。

成品可包含：角色名；履历（年龄、显著特征、日常穿着、嗜好习惯、必要出身关系）；核心性格与反差；与目标互动对象、自己、外人及必要具体角色的关系；他者评价；可选亲密场景；作者笔记/使用提示。极简版保留身份、外貌、性格、关系和关键行为边界；成品版使用完整结构；进阶版增加条件化关系或状态校准信息。

成人内容规则：允许合法的成人向角色、关系和亲密设定；一旦涉及性行为或露骨性设定，相关角色必须明确为成年人，并在成品正文中逐字包含“所有参与露骨成人内容的角色均已年满18岁”。年龄缺失且成人内容是核心需求时，必须继续追问，不能输出 complete/revision 成品。用户要求未成年人参与成人内容时，拒绝该部分，并可继续提供不含该部分的安全角色设计。

每轮只能输出一种状态，且必须严格使用以下控制格式。控制区块外可写一段简短自然语言说明，不得输出 StoryPlan。

仍需素材：
<UserGenerationState>
status: collecting
missing: 尚缺的关键素材
question: 一条自然语言追问
</UserGenerationState>

素材充分、首次成品：
<UserGenerationState>
status: complete
missing:
question:
</UserGenerationState>
<UserGenerationResult>
title: 成品标题
summary: 一段摘要
content: 完整 User Persona 正文，可多行
</UserGenerationResult>

基于既有成品修订时把 status 改为 revision，并仍输出完整的新 title、summary、content。字段不得重复，title/content 不得为空。`;

export async function copyUserGenerationContent(content, { clipboard = globalThis.navigator?.clipboard, documentRef = globalThis.document } = {}) {
    const text = typeof content === 'string' ? content : '';
    if (!text) throw new Error('没有可复制的 User 正文');
    try {
        if (typeof clipboard?.writeText === 'function') {
            await clipboard.writeText(text);
            return true;
        }
    } catch (error) {}
    if (!documentRef?.body || typeof documentRef.createElement !== 'function') throw new Error('复制失败，请展开后手动选择');
    const textarea = documentRef.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.setAttribute('aria-hidden', 'true');
    try {
        documentRef.body.appendChild(textarea);
        textarea.select();
        if (typeof textarea.setSelectionRange === 'function') textarea.setSelectionRange(0, text.length);
        if (typeof documentRef.execCommand !== 'function' || documentRef.execCommand('copy') !== true) throw new Error('copy rejected');
        return true;
    } catch (error) {
        throw new Error('复制失败，请展开后手动选择');
    } finally {
        textarea.remove?.();
        try { documentRef.getSelection?.()?.removeAllRanges?.(); } catch (error) {}
    }
}

export function buildStoryOracleUserPrompt(context, history, question, revisionTarget = null) {
    const snapshot = [`角色设定：${context.cardDesc || ''}`, `角色性格：${context.cardPersonality || ''}`, `场景：${context.cardScenario || ''}`, `用户：${context.userName || ''}\n${context.userDesc || ''}`, `世界书：${context.worldBookText || '（无）'}`, `最近对话：${context.mainChatText || '（无）'}`].join('\n');
    const transcript = history.map(item => `${item.role === 'user' ? '提问' : '剧情助手'}：${item.content}`).join('\n') || '（无）';
    const revision = revisionTarget
        ? `\n\n当前待修订 User 成品（只读，不得原地覆盖）：\n标题：${revisionTarget.title}\n摘要：${revisionTarget.summary}\n正文：\n${revisionTarget.content}`
        : '';
    return `以下是只读上下文快照：\n${snapshot}\n\n此前的剧情助手侧聊：\n${transcript}${revision}\n\n本次问题：\n${question}`;
}
