// 兼容入口：调用方继续使用既有路径，唯一实现位于 prompts 功能域。
export { buildAntiFluff, buildHistoryText, buildUserBlock } from './prompts/chat/blocks.js';
export { buildChatRequest, buildPokeRequest } from './prompts/chat/requests.js';
export {
    buildIndependentSingleUserPrompt,
    buildSingleInjectedInstruction,
    buildSingleSystemPrompt,
} from './prompts/chat/single.js';
export {
    buildGroupInjectedInstruction,
    buildGroupSystemPrompt,
    buildIndependentGroupUserPrompt,
} from './prompts/chat/group.js';
export {
    buildGroupAdditionalContext,
    DEFAULT_RANDOM_NPC_PROMPT,
} from './prompts/shared/group-context.js';
export {
    buildPokeGroupActivePrompt,
    buildPokeGroupPrompt,
    buildPokeSinglePrompt,
    buildPokeSystemPrompt,
} from './prompts/poke/poke.js';
