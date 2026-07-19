import { createAiClient } from './ai.js';
import { installCalendar } from './calendar.js';
import { installContactGenerator } from './contact-generator.js';
import { installConversation } from './conversation.js';
import { installEmojiUi } from './emoji-ui.js';
import { installInteractiveScenes } from './interactive-scenes.js';
import {
    gatherContext as collectHostContext,
    getStorageId as resolveStorageId,
    getUserPersona as resolveUserPersona,
} from './host-context.js';
import { installPhoneChat } from './phone-chat.js';
import { installPhoneChatPoke } from './phone-chat-poke.js';
import { installPhoneControlCenter } from './phone-control-center.js';
import { installPhoneDirectory } from './phone-directory.js';
import { installPhoneFoundation } from './phone-foundation.js';
import { installPhoneLifecycle } from './phone-lifecycle.js';
import { ensureInitialPhoneQuickReplyWithRetry } from './quick-reply.js';
import { createRuntimeState } from './runtime.js';
import { installSettingsUi } from './settings-ui.js';
import { saveBudgetConfig, saveEmojis } from './storage.js';

(async function bootstrapPhoneMode() {
    await new Promise(resolve => setTimeout(resolve, 1000));

    const runtime = createRuntimeState();
    const state = {
        phoneActive: false,
        phoneWindow: null,
        activeStorageId: '',
        currentPersona: '',
        conversationHistory: [],
        activeQuote: null,
        isGenerating: false,
        generationTask: null,
        generationSequence: 0,
        hostEpoch: 0,
        isMinimized: false,
        isSelectMode: false,
        isGroupChat: false,
        groupMembers: [],
        groupColorMap: {},
        groupDisplayName: '',
        currentGroupKey: '',
        groupExtras: [],
    };

    const getCtx = () => typeof SillyTavern !== 'undefined' ? SillyTavern.getContext() : null;
    const getStorageId = () => resolveStorageId(getCtx);
    const getUserPersona = () => resolveUserPersona(getCtx);
    const gatherContext = context => collectHostContext(context ? () => context : getCtx);
    const deps = { runtime, getCtx, getStorageId, getUserPersona, gatherContext, saveBudgetConfig };
    deps.callAI = createAiClient({
        getConfig: () => window.__pmConfig,
        getContext: getCtx,
    });

    installPhoneFoundation(state, deps);
    installConversation(state, deps);
    installEmojiUi({ makeOverlay: deps.makeOverlay, saveEmojis });
    Object.assign(deps, {
        getPhoneWindow: () => state.phoneWindow,
        getCurrentPersona: () => state.currentPersona,
        closePhone: force => window.__pmEnd(force),
    });
    installInteractiveScenes(state, deps);
    installCalendar(state, deps);
    installSettingsUi(deps);
    installPhoneChat(state, deps);
    installPhoneControlCenter(state, deps);
    installPhoneDirectory(state, deps);
    installContactGenerator(state, deps);
    installPhoneChatPoke(state, deps);
    installPhoneLifecycle(state, deps);
    ensureInitialPhoneQuickReplyWithRetry().catch(error => {
        console.warn('[phone-mode] 首次创建手机入口失败，有限重试已结束', error);
    });
})();
