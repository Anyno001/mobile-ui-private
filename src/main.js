import { createAiClient } from './ai.js';
import { resolveApiConfig } from './api-routes.js';
import { installCalendar } from './calendar.js';
import { installContactGenerator } from './contact-generator.js';
import { installConversation } from './conversation.js';
import { installDiagnosticApi } from './diagnostic.js';
import { installEmojiUi } from './emoji-ui.js';
import { installInteractiveScenes } from './interactive-scenes.js';
import {
    gatherContext as collectHostContext,
    getLastMessageId as resolveLastMessageId,
    getStorageId as resolveStorageId,
    getUserPersona as resolveUserPersona,
} from './host-context.js';
import { installPhoneChat } from './phone-chat.js';
import { installPhoneChatPoke } from './phone-chat-poke.js';
import { installPhoneControlCenter } from './phone-control-center.js';
import { installPhoneContextInjection } from './phone-context-injection.js';
import { installPhoneDirectory } from './phone-directory.js';
import { installPhoneFoundation } from './phone-foundation.js';
import { installPhoneLifecycle } from './phone-lifecycle.js';
import { installIgsChatSync } from './igs-chat-sync.js';
import { ensureInitialPhoneQuickReplyWithRetry } from './quick-reply.js';
import { createRuntimeState } from './runtime.js';
import { installSettingsUi } from './settings-ui.js';
import { installTodayTrend } from './today-trend.js';
import { installTodayTrendPhoneUi } from './today-trend-phone-ui.js';
import {
    loadGroupMeta, saveBudgetConfig, saveEmojis, saveGroupMeta, saveHistoriesStrict,
    setGroupMetaPersistListener, setHistoryPersistListener,
} from './storage.js';
import { awaitPendingBranchInheritance } from './branch-scope-inheritance.js';
import { createChatMetadataSync } from './chat-metadata-sync.js';
import { setFloorMarkProvider, setStoryClockProvider } from './chat-message-model.js';
import { startOriginHost, trackBackgroundCalls } from './origin-host.js';
import { startPlotInjector } from './plot-injector/plot-injector.js';
import { floorMarkFor, loadRollbackFloors } from './phone-floor-rollback.js';
import { setCommunityFloorProvider } from './community-floor-rollback.js';

(async function bootstrapPhoneMode() {
    // 扩展安装与酒馆助手自动更新脚本可能同时存在，先启动的一份生效。
    const bootKey = Symbol.for('tianyin-xiaojian.boot');
    if (globalThis[bootKey]) return;
    globalThis[bootKey] = true;
    await new Promise(resolve => setTimeout(resolve, 1000));

    const runtime = createRuntimeState();
    const state = {
        phoneActive: false,
        phoneWindow: null,
        activeStorageId: '',
        currentPersona: '',
        conversationHistory: [],
        historyRenderLimit: 0,
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
        groupRandomNpcEnabled: false,
        groupNature: '',
        groupRandomNpcPrompt: '',
        currentGroupKey: '',
        groupExtras: [],
    };

    const getCtx = () => typeof SillyTavern !== 'undefined' ? SillyTavern.getContext() : null;
    const getLastMessageId = () => resolveLastMessageId(getCtx);
    const getStorageId = () => resolveStorageId(getCtx);
    const getUserPersona = () => resolveUserPersona(getCtx);
    const gatherContext = (context, options) => collectHostContext(
        context ? () => context : getCtx,
        options,
    );
    const deps = { runtime, getCtx, getLastMessageId, getStorageId, getUserPersona, gatherContext, saveBudgetConfig, reloadCurrentChat: context => context?.reloadCurrentChat?.() };
    // 天音自己的后台请求期间金手指核心不注入（见 origin-host.js）。
    deps.callAI = trackBackgroundCalls(createAiClient({
        getConfig: module => resolveApiConfig(module),
        getContext: getCtx,
    }));
    deps.originRuntime = startOriginHost({ getCtx, callAI: deps.callAI });
    // 剧情注入器（大纲注入与进度检测）：启动即运行，不等打开手机；同页有独立版时由独立版接管。
    deps.plotInjector = startPlotInjector({ getCtx, callAI: deps.callAI });

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
    installPhoneContextInjection(state, deps);
    installPhoneControlCenter(state, deps);
    installPhoneDirectory(state, deps);
    installContactGenerator(state, deps);
    installPhoneChatPoke(state, deps);
    installPhoneLifecycle(state, deps);
    installIgsChatSync(state, deps);
    // 手机聊天记录随酒馆聊天文件保存（chatMetadata 第二副本）。
    setFloorMarkProvider(() => {
        const chat = getCtx()?.chat;
        return Array.isArray(chat) ? floorMarkFor(chat) : null;
    });
    setStoryClockProvider(() => ({ date: deps.getStoryToday?.() || '', time: deps.getStoryTime?.() || '' }));
    // 社区与直播间同一套楼层标记，保留层数共用「删楼回退保留层数」。
    setCommunityFloorProvider(() => {
        const chat = getCtx()?.chat;
        return Array.isArray(chat) ? { ...floorMarkFor(chat), limit: loadRollbackFloors() } : null;
    });
    const ensureHistoriesLoaded = async () => (runtime.historyLoadPromise
        ? runtime.historyLoadPromise.catch(() => false) : true);
    deps.ensureHistoriesLoaded = ensureHistoriesLoaded;
    const chatMetadataSync = createChatMetadataSync({
        getCtx, getStorageId, getRollbackFloors: () => loadRollbackFloors(),
        ensureHistoriesLoaded,
        awaitBranch: storageId => awaitPendingBranchInheritance(storageId).catch(() => {}),
        saveHistories: () => saveHistoriesStrict(),
        saveGroupMeta: () => saveGroupMeta(),
        loadGroupMeta: () => loadGroupMeta(),
    });
    setHistoryPersistListener(chatMetadataSync.noteLocalChange);
    setGroupMetaPersistListener(chatMetadataSync.noteLocalChange);
    Object.assign(deps, {
        reconcileChatMetadata: chatMetadataSync.reconcile,
        flushChatMetadata: chatMetadataSync.flush,
        markChatMetadataLocalAuthoritative: chatMetadataSync.markLocalAuthoritative,
        recordPhoneChange: chatMetadataSync.recordPhoneChange,
        pruneRollback: chatMetadataSync.pruneRollback,
        /** 主线删楼后回退手机记录；正在看的会话有变化就重画。 */
        applyFloorRollback: async () => {
            Promise.resolve(deps.rollbackCommunity?.()).catch(error => {
                console.warn('[phone-mode] 删楼回退社区失败', error?.name || 'Error');
            });
            const changedKeys = await chatMetadataSync.applyFloorRollback({
                onChanged: () => { if (state.isGenerating) deps.invalidateGeneration?.(); },
            });
            const saveKey = deps.getSaveKey?.();
            if (!state.phoneActive || !saveKey || !changedKeys.includes(saveKey)) return changedKeys;
            if (state.activeStorageId !== getStorageId()) return changedKeys;
            state.conversationHistory = (window.__pmHistories[state.activeStorageId]?.[saveKey] || []).slice();
            deps.rerenderConversation?.({ keepScroll: true });
            return changedKeys;
        },
    });
    // 切换聊天、打开手机时社区文件对账后，按当前主线回退社区（分支、在别处删过楼），与手机聊天的对账同时机。
    const reconcileCommunityFiles = deps.reconcileCommunityFiles;
    if (typeof reconcileCommunityFiles === 'function') {
        deps.reconcileCommunityFiles = async (...args) => {
            const action = await reconcileCommunityFiles(...args);
            try { await deps.rollbackCommunity?.(); } catch (error) { console.warn('[phone-mode] 删楼回退社区失败', error?.name || 'Error'); }
            return action;
        };
    }
    installDiagnosticApi(deps);
    installTodayTrend(state, deps);
    installTodayTrendPhoneUi(state, deps);
    ensureInitialPhoneQuickReplyWithRetry().catch(error => {
        console.warn('[phone-mode] 首次创建手机入口失败，有限重试已结束', error);
    });
})();
