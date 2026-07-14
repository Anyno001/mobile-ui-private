export function getStorageId(getCtx) {
    const context = getCtx();
    if (!context) return 'sms_unknown__default';
    const character = context.characters?.[context.characterId];
    const avatar = character?.avatar || `idx_${context.characterId}`;
    const chatFile = context.chatId
        || (typeof context.getCurrentChatId === 'function' ? context.getCurrentChatId() : null)
        || context.chat_metadata?.chat_id_hash
        || context.chat_file
        || 'default';
    return `sms_${avatar}__${chatFile}`;
}

export function getUserPersona(getCtx) {
    const context = getCtx();
    if (!context) return { name: '用户', description: '' };
    let name = context.name1 || 'User';
    let description = '';

    try {
        const settings = context.powerUserSettings || context.power_user || window.power_user;
        if (settings) {
            description = settings.persona_description || settings.personaDescription || '';
            const avatar = context.userAvatar || settings.user_avatar || settings.default_persona;
            if (!description && avatar) {
                const descriptions = settings.persona_descriptions || settings.personaDescriptions;
                const persona = descriptions?.[avatar];
                if (typeof persona === 'string') description = persona;
                else if (persona?.description) description = persona.description;
            }
        }
    } catch (error) {}

    if (!description) {
        try {
            const metadata = context.chatMetadata || context.chat_metadata;
            if (metadata?.persona) description = String(metadata.persona);
        } catch (error) {}
    }

    try {
        if (typeof context.substituteParams === 'function') {
            const resolvedName = context.substituteParams('{{user}}');
            if (resolvedName && resolvedName !== '{{user}}' && resolvedName.trim()) name = resolvedName.trim();
        }
    } catch (error) {}

    return { name, description };
}

export async function gatherContext(getCtx) {
    const context = getCtx();
    const character = context?.characters?.[context.characterId] || {};
    const cleanMessage = value => (value || '')
        .replace(/```[\s\S]*?```/g, '')
        .replace(/<think>[\s\S]*?<\/think>/gi, '')
        .replace(/<[^>]+>/g, '')
        .trim();
    const mainChat = (context?.chat || []).slice(-8)
        .map(message => ({
            who: message.is_user ? '用户' : (message.name || '角色'),
            content: cleanMessage(message.mes || ''),
        }))
        .filter(message => message.content);
    let worldBookText = '';
    try {
        if (typeof context?.getWorldInfoPrompt === 'function') {
            const contextSize = context?.powerUserSettings?.openai_max_context
                || context?.oai_settings?.openai_max_context
                || context?.maxContext
                || 131072;
            const worldInfo = await context.getWorldInfoPrompt(
                (context.chat || []).map(message => message.mes || '').slice(-10), contextSize, false,
            );
            worldBookText = worldInfo?.worldInfoString || worldInfo?.worldInfoBefore || '';
            if (!worldBookText && worldInfo && typeof worldInfo === 'object') {
                worldBookText = [worldInfo.worldInfoBefore, worldInfo.worldInfoAfter].filter(Boolean).join('\n');
            }
        }
    } catch (error) {}
    const userPersona = getUserPersona(getCtx);
    return { cardDesc: character.description ?? '', cardPersonality: character.personality ?? '', cardScenario: character.scenario ?? '', cardFirstMes: character.first_mes ?? '', cardMesExample: character.mes_example ?? '', mainChatText: mainChat.map(message => `${message.who}：${message.content}`).join('\n'), worldBookText, userName: userPersona.name, userDesc: userPersona.description };
}
