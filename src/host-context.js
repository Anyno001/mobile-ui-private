const warnedHostContextFailures = new Set();

function warnHostContextFailureOnce(stage, message, error) {
    if (warnedHostContextFailures.has(stage)) return;
    warnedHostContextFailures.add(stage);
    const errorType = typeof error?.name === 'string' && error.name ? error.name : 'Error';
    console.warn(`[phone-mode] ${message}，已使用降级值。`, errorType);
}

export function getStorageId(getCtx) {
    const context = getCtx();
    if (!context) return 'sms_unknown__default';
    const character = context.characters?.[context.characterId];
    const avatar = character?.avatar || `idx_${context.characterId}`;
    const chatFile = context.chatId
        || (typeof context.getCurrentChatId === 'function' ? context.getCurrentChatId() : null)
        || context.chat_metadata?.chat_id_hash
        || context.chat_file;
    if (chatFile === null || chatFile === undefined || String(chatFile).trim() === '') return 'sms_unknown__default';
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
    } catch (error) {
        warnHostContextFailureOnce('persona-settings', '读取用户人设设置失败', error);
    }

    if (!description) {
        try {
            const metadata = context.chatMetadata || context.chat_metadata;
            if (metadata?.persona) description = String(metadata.persona);
        } catch (error) {
            warnHostContextFailureOnce('persona-metadata', '读取聊天人设元数据失败', error);
        }
    }

    try {
        if (typeof context.substituteParams === 'function') {
            const resolvedName = context.substituteParams('{{user}}');
            if (resolvedName && resolvedName !== '{{user}}' && resolvedName.trim()) name = resolvedName.trim();
        }
    } catch (error) {
        warnHostContextFailureOnce('persona-name', '解析用户名称失败', error);
    }

    return { name, description };
}

export async function gatherContext(getCtx) {
    const context = getCtx();
    const character = context?.characters?.[context.characterId] || {};
    const removeProtectedBlocks = value => (value || '')
        .replace(/```[\s\S]*?```/g, '')
        .replace(/<think>[\s\S]*?<\/think>/gi, '')
        .trim();
    const cleanMessage = value => removeProtectedBlocks(value)
        .replace(/<[^>]+>/g, '')
        .trim();
    const recentChat = (context?.chat || []).slice(-8);
    const normalizedChat = recentChat
        .map(message => ({
            who: message.is_user ? '用户' : (message.name || '角色'),
            content: cleanMessage(message.mes || ''),
            rawContent: removeProtectedBlocks(message.mes || ''),
            isUser: message.is_user === true,
        }));
    const latestMessage = [...normalizedChat].reverse().find(message => message.content);
    const latestChatText = latestMessage?.content || '';
    const rawLatestChatText = latestMessage?.rawContent || '';
    const latestChatIsUser = latestMessage?.isUser === true;
    const mainChat = normalizedChat.filter(message => message.content);
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
    } catch (error) {
        warnHostContextFailureOnce('world-book', '读取世界书上下文失败', error);
    }
    const userPersona = getUserPersona(getCtx);
    return { cardDesc: character.description ?? '', cardPersonality: character.personality ?? '', cardScenario: character.scenario ?? '', cardFirstMes: character.first_mes ?? '', cardMesExample: character.mes_example ?? '', mainChatText: mainChat.map(message => `${message.who}：${message.content}`).join('\n'), latestChatText, rawLatestChatText, latestChatIsUser, worldBookText, userName: userPersona.name, userDesc: userPersona.description };
}
