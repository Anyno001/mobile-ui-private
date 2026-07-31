import { buildWorldBookContext } from './worldbook-context.js';
import { normalizeWorldBookConfig } from './worldbook-config.js';
import { OUTFIT_SELF_SUBJECT, outfitRoleName } from './calendar-outfit-model.js';

const warnedHostContextFailures = new Set();

function warnHostContextFailureOnce(stage, message, error) {
    if (warnedHostContextFailures.has(stage)) return;
    warnedHostContextFailures.add(stage);
    const errorType = typeof error?.name === 'string' && error.name ? error.name : 'Error';
    console.warn(`[phone-mode] ${message}，已使用降级值。`, errorType);
}

export function getCurrentChatId(context) {
    if (!context) return null;
    return context.chatId
        || (typeof context.getCurrentChatId === 'function' ? context.getCurrentChatId() : null)
        || context.chat_metadata?.chat_id_hash
        || context.chat_file;
}

export function getStorageIdFor(avatar, chatId) {
    const characterAvatar = typeof avatar === 'string' && avatar.trim() ? avatar : '';
    if (chatId === null || chatId === undefined || String(chatId).trim() === '' || !characterAvatar) {
        return 'sms_unknown__default';
    }
    return `sms_${characterAvatar}__${chatId}`;
}

export function getStorageId(getCtx) {
    const context = getCtx();
    if (!context) return 'sms_unknown__default';
    const character = context.characters?.[context.characterId];
    const avatar = character?.avatar || `idx_${context.characterId}`;
    return getStorageIdFor(avatar, getCurrentChatId(context));
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

const normalizedName = value => typeof value === 'string' ? value.trim().toLocaleLowerCase() : '';

export function resolveOutfitTarget(context, subject, userPersona = { name: '用户', description: '' }) {
    if (subject === OUTFIT_SELF_SUBJECT) {
        return {
            kind: 'user', name: userPersona.name || '用户', description: userPersona.description || '',
            personality: '', scenario: '', stableId: '', character: null,
        };
    }
    const roleName = outfitRoleName(subject);
    if (!roleName) throw new Error('穿搭记录对象无效');
    const matches = (Array.isArray(context?.characters) ? context.characters : []).map((character, index) => ({ character, index }))
        .filter(({ character }) => normalizedName(character?.name) === normalizedName(roleName));
    if (!matches.length) throw new Error(`无法定位“${roleName}”的角色资料，请切换到对应角色会话后重试`);
    if (matches.length > 1) throw new Error(`“${roleName}”存在重名角色，无法唯一定位资料`);
    const currentMatch = matches.find(({ index }) => index === context?.characterId);
    const { character, index } = currentMatch || matches[0];
    return {
        kind: 'role', name: character.name.trim(), description: character.description ?? '', personality: character.personality ?? '',
        scenario: character.scenario ?? '', stableId: character.avatar || `idx_${index}`, character,
    };
}

export async function gatherContext(getCtx, {
    module = 'chat', signal, includeWorldBook = true, worldBookMaxChars, worldBookScope = null, worldBookMemberNames = [], outfitSubject = null,
} = {}) {
    const context = getCtx();
    const userPersona = getUserPersona(getCtx);
    const outfitTarget = outfitSubject === null ? null : resolveOutfitTarget(context, outfitSubject, userPersona);
    const character = outfitTarget?.kind === 'user' ? null : outfitTarget?.character || context?.characters?.[context.characterId] || {};
    const effectiveWorldBookScope = outfitTarget?.kind === 'user'
        ? { kind: 'public' }
        : outfitTarget?.kind === 'role'
            ? { kind: 'character', id: outfitTarget.stableId }
            : worldBookScope;
    const worldBookOptions = outfitTarget?.kind === 'user'
        ? { includeCharacterBindings: false }
        : outfitTarget?.kind === 'role' && outfitTarget.character !== context?.characters?.[context?.characterId]
            ? { character: outfitTarget.character, allowHostBindings: false }
            : {};
    const worldBookConfig = normalizeWorldBookConfig(globalThis.window?.__pmWorldBookConfig);
    const removeProtectedBlocks = value => (value || '')
        .replace(/```[\s\S]*?(?:```|$)/g, '')
        .replace(/<think\b[^>]*>[\s\S]*?(?:<\/think\s*>|$)/gi, '')
        .trim();
    const cleanMessage = value => removeProtectedBlocks(value)
        .replace(/<[^>]+>/g, '')
        .trim();
    const recentChat = (context?.chat || []).slice(-worldBookConfig.mainChatMessages);
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
    if (includeWorldBook) {
        try {
            const memberIds = effectiveWorldBookScope?.kind === 'group'
                ? [...new Set(worldBookMemberNames.filter(name => typeof name === 'string').map(name => name.trim()).filter(Boolean))]
                : [];
            worldBookText = await buildWorldBookContext(context, {
                module, config: worldBookConfig, signal, scope: effectiveWorldBookScope, memberIds, maxChars: worldBookMaxChars, worldBookOptions,
            });
        } catch (error) {
            if (error?.name === 'AbortError') throw error;
            warnHostContextFailureOnce('world-book', '读取世界书上下文失败', error);
        }
    }
    return { cardDesc: outfitTarget?.kind === 'user' ? outfitTarget.description : character.description ?? '', cardPersonality: outfitTarget?.kind === 'user' ? '' : character.personality ?? '', cardScenario: outfitTarget?.kind === 'user' ? '' : character.scenario ?? '', cardFirstMes: character?.first_mes ?? '', cardMesExample: character?.mes_example ?? '', mainChatText: mainChat.map(message => `${message.who}：${message.content}`).join('\n'), latestChatText, rawLatestChatText, latestChatIsUser, worldBookText, userName: userPersona.name, userDesc: userPersona.description, outfitTarget };
}
