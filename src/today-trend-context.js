import { gatherContext } from './host-context.js';

const text = (value, max = 600) => typeof value === 'string' ? value.trim().slice(0, max) : '';
const names = value => Array.isArray(value) ? [...new Set(value.map(item => text(item, 120)).filter(Boolean))] : [];

export async function gatherTodayTrendContext({
    getCtx, signal, storageId, characterId, characterName, worldBookNames = [],
    includeExistingChat = true, userRequirements = '', worldBookMaxChars = 6000,
    collectContext = gatherContext,
} = {}) {
    if (typeof getCtx !== 'function') throw new TypeError('今日风向上下文缺少宿主上下文读取器');
    const id = text(storageId, 120);
    const roleId = text(characterId, 120);
    const roleName = text(characterName, 120);
    const selectedBooks = names(worldBookNames);
    if (!id || !roleId || !roleName) throw new Error('今日风向初始化缺少角色或聊天标识');
    if (!selectedBooks.length) throw new Error('今日风向初始化至少需要选择一本世界书');
    if (signal?.aborted) { const error = new Error('请求已取消'); error.name = 'AbortError'; throw error; }
    const host = await collectContext(getCtx, {
        module: 'todayTrend', signal, includeWorldBook: true, worldBookMaxChars,
        worldBookNames: selectedBooks,
    });
    if (signal?.aborted) { const error = new Error('请求已取消'); error.name = 'AbortError'; throw error; }
    return {
        storageId: id, characterId: roleId, characterName: roleName,
        source: { worldBookNames: selectedBooks, includeExistingChat: includeExistingChat === true, userRequirements: text(userRequirements) },
        user: { name: text(host?.userName, 120), description: text(host?.userDesc) },
        character: {
            description: text(host?.cardDesc), personality: text(host?.cardPersonality), scenario: text(host?.cardScenario),
            firstMessage: text(host?.cardFirstMes), exampleMessages: text(host?.cardMesExample),
        },
        worldBookText: text(host?.worldBookText, worldBookMaxChars),
        mainChatText: includeExistingChat === true ? text(host?.mainChatText, 8000) : '',
        latestChatText: includeExistingChat === true ? text(host?.latestChatText, 1600) : '',
    };
}
