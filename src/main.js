import { createAiClient } from './ai.js';
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
import { createRuntimeState } from './runtime.js';
import { installSettingsUi } from './settings-ui.js';
import { saveEmojis } from './storage.js';

(async function bootstrapPhoneMode() {
    await new Promise(resolve => setTimeout(resolve, 1000));

    const runtime = createRuntimeState();
    const state = {
        phoneActive: false,
        phoneWindow: null,
        activeStorageId: '',
        currentPersona: '',
        conversationHistory: [],
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
    const deps = { runtime, getCtx, getStorageId, getUserPersona, gatherContext };
    deps.callAI = createAiClient({
        getConfig: () => window.__pmConfig,
        getContext: getCtx,
        getDefaultMaxTokens: () => state.isGroupChat ? 600 : 300,
    });

    installPhoneFoundation(state, deps);
    installConversation(state, deps);
    installEmojiUi({ makeOverlay: deps.makeOverlay, saveEmojis });
    Object.assign(deps, {
        getPhoneWindow: () => state.phoneWindow,
        getCurrentPersona: () => state.currentPersona,
        closePhone: () => window.__pmEnd(),
    });
    installInteractiveScenes(state, deps);
    installSettingsUi(deps);
    installPhoneChat(state, deps);
    installPhoneControlCenter(state, deps);
    installPhoneDirectory(state, deps);
    installContactGenerator(state, deps);
    installPhoneChatPoke(state, deps);
    installPhoneLifecycle(state, deps);
})();
