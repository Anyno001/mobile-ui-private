import { bindDesktopArrange } from './desktop-layout.js';
import { generationErrorMessage } from './ai.js';
import { buildCommunityRequest, COMMUNITY_PLATFORM_PROMPTS, parseCommunityResponse } from './interactive-scene-ai.js';
import {
    INTERACTIVE_LIMITS, addSceneComment, appendScenePosts, createEmptyInteractiveScope, deleteSceneComment, deleteScenePost, enforceInteractiveSceneLimit, ensureInteractiveActor, findQuoteTargetId, normalizeScene,
    createDefaultPhoneUiScope, createSceneFromCommunityTemplate, dismissCommunityTemplate, incrementScenePostShare, normalizePhoneUiState, patchPhoneUiScope, publishCommunityTemplate, removeCommunityTemplatesForSourceScene, resolveInteractiveAuthor, setSceneHot, setSceneTonight, toggleScenePin, toggleScenePostLike, unpublishCommunityTemplate, updateSceneComment, updateScenePost,
} from './interactive-scene-model.js';
import { COMMUNITY_PLATFORMS } from './interactive-scene-constants.js';
import {
    loadInteractiveScenes, loadPhoneUiState, saveInteractiveScenes, savePhoneUiScope, savePhoneUiState,
    setInteractivePersistListener,
} from './storage.js';
import { createCommunityFileSync } from './community-file-sync.js';
import { bindPhonePageActions, dispatchCalendarAppAction, getCommunityInjectionState, handleCommunityInjectionUiAction, handleSceneAccentAction, persistCurrentPhoneUiSnapshot, resolvePhoneChatTarget, runCalendarPageTransition, runDeleteSceneAction, runDesktopPageTransition, toggleSceneMenu, toggleScenePostActions, toggleSceneReplyComposer } from './interactive-scene-phone.js';
import { createCommunityGenerationRunner, createCommunityTaskController } from './interactive-scene-scheduler.js';
import { installLiveApp } from './live-app.js';
import { VIEW_ACTIONS, applyViewAction, composePostFields, insertTopicMark, pickMood, pickPlatform, pickRating, readComposeDraft, readComposeUi, resetViewAfterPublish, toggleNsfwSwitch } from './community-views/view-actions.js';
import { COMMUNITY_PLATFORM_ACCENTS, platformOf } from './community-views/view-shared.js';
import { createRespondFlow } from './interactive-scene-respond-flow.js';
import { placePostInWindow } from './interactive-scene-respond.js';
import { createCommitWithPhoneUi } from './interactive-scene-phone-transaction.js';
import { createCommunityTemplateImportAction } from './interactive-scene-template-import.js'; import { igsRefreshers, installIgsFeedSync } from './igs-feed-sync.js';
import { renderCommunityLauncher as renderCommunityLauncherView, renderCommunityWorkspace as renderCommunityWorkspaceView, renderPhoneDesktop } from './interactive-scene-views.js';
import { createInteractiveCommitQueue, createInteractiveOperationGuard, createInteractiveStoreLoader, migrateInteractiveStore, now, parseCommunityPostInput, uid } from './interactive-scenes-utils.js';
export { renderPhoneDesktop } from './interactive-scene-views.js'; export { resolvePhoneChatTarget, runDesktopPageTransition } from './interactive-scene-phone.js';
export { createInteractiveCommitQueue, createInteractiveOperationGuard, createInteractiveStoreLoader, migrateInteractiveStore, parseCommunityPostInput } from './interactive-scenes-utils.js';
export function installInteractiveScenes(_state, deps) {
    const { getCtx, getStorageId, getUserPersona, gatherContext, callAI } = deps;
    const runtime = {
        store: null, loadPromise: null, mutationPromise: Promise.resolve(), requestId: 0, contextEpoch: 0,
        loadGeneration: 0, openSceneId: null, openSceneStorageId: null, busy: false, creating: false, phoneUiState: null, requestController: null, communityViews: {},
    };
    const storeLoader = createInteractiveStoreLoader({ runtime, load: loadInteractiveScenes,
        migrate: raw => migrateInteractiveStore(raw, saveInteractiveScenes) });
    const { loadStore } = storeLoader;
    const getScope = (store, scopeId) => store.scopes[scopeId] || (store.scopes[scopeId] = createEmptyInteractiveScope());
    const actorSeeds = scopeId => {
        const context = getCtx();
        const character = context?.characters?.[context.characterId] || {};
        const characterBinding = character.avatar || `idx_${context?.characterId ?? 'unknown'}`;
        const settings = context?.powerUserSettings || context?.power_user || window.power_user || {};
        const persona = getUserPersona();
        const userBinding = context?.userAvatar || settings.user_avatar || settings.default_persona || `${scopeId}:default-user`;
        return { story: { type: 'story', displayName: character.name || 'AI', bindingKey: `character:${characterBinding}`,
            profile: [character.description, character.personality].filter(Boolean).join('\n').slice(0, 1000) },
        user: { type: 'user', displayName: persona?.name || '我', bindingKey: `persona:${userBinding}`, profile: String(persona?.description || '').slice(0, 1000) } };
    };
    const current = () => {
        const scopeId = runtime.openSceneStorageId || getStorageId();
        const scope = runtime.store?.scopes?.[scopeId];
        return { scopeId, scope, scene: scope?.scenes?.[runtime.openSceneId || scope.activeSceneId] || null };
    };
    const clearOpenScene = () => { runtime.openSceneId = null; runtime.openSceneStorageId = null; };
    // 版式内的临时视图状态（分段、打开的帖子或书、心情筛选、展开的帖子、编辑页与草稿），只在会话内保存，不写入存储。
    const viewOf = sceneId => (runtime.communityViews[sceneId] ||= { segment: '', postId: '', work: '', mood: '', tag: '', question: '', open: [], compose: false, draft: null, feedScroll: 0, retry: [] });
    const resetView = sceneId => { delete runtime.communityViews[sceneId]; };
    const resolveTarget = target => {
        const scope = runtime.store?.scopes?.[target?.storageId];
        return { scopeId: target?.storageId, scope, scene: scope?.scenes?.[target?.sceneId] || null }; };
    const getCommunityTarget = () => {
        const scopeId = runtime.openSceneStorageId || getStorageId();
        const scene = runtime.store?.scopes?.[scopeId]?.scenes?.[runtime.openSceneId];
        return runtime.openSceneId && scene ? { storageId: scopeId, sceneId: scene.id } : null;
    };
    const isTargetActive = target => (runtime.openSceneStorageId || getStorageId()) === target?.storageId
        && runtime.openSceneId === target?.sceneId
        && !!resolveTarget(target).scene && document.querySelector('#pm-iphone .pm-main-ui')?.dataset.page === 'community';
    const operationGuard = (storageId, sceneId = () => runtime.openSceneId) => createInteractiveOperationGuard({ getEpoch: () => runtime.contextEpoch, getStorageId,
        getOpenSceneId: () => runtime.openSceneId,
        isMounted: () => !!document.getElementById('pm-scene-app'),
    }, { epoch: runtime.contextEpoch, storageId, sceneId });
    let liveApp = null;
    const communityTasks = createCommunityTaskController({
        runtime,
        isTargetActive,
        isLiveTargetActive: task => liveApp?.isTargetActive(task) === true,
        isAllowed: target => _state.phoneActive && !_state.isMinimized && document.visibilityState !== 'hidden'
            && !runtime.busy && isTargetActive(target) });
    let communityRunner = null; let igsSync = null;
    const queuedCommit = createInteractiveCommitQueue({
        getStore: () => runtime.store,
        setStore: store => { runtime.store = store; },
        saveStore: saveInteractiveScenes,
        syncStore: () => deps.applyBidirectionalInjection?.() });
    const commit = queuedCommit;
    const invalidate = (reason = 'community-context-invalidated') => {
        runtime.contextEpoch += 1;
        communityRunner?.cancel(reason, true);
        runtime.requestController?.abort(reason);
        runtime.requestController = null;
        runtime.requestId += 1;
        runtime.busy = false; setStatus('');
    };
    const setStatus = text => {
        const el = document.querySelector('.pm-scene-status'); if (el) { el.textContent = text || ''; el.hidden = !text; }
    };
    const confirmDelete = message => window.confirm(message);
    const getPhoneUiState = store => {
        if (!runtime.phoneUiState) {
            runtime.phoneUiState = loadPhoneUiState(store);
        }
        return normalizePhoneUiState(runtime.phoneUiState, store);
    };
    const persistPhoneUiState = (storageId, nextState, store = runtime.store) => {
        const merged = savePhoneUiScope(storageId, normalizePhoneUiState(nextState, store), store);
        if (!merged) throw new Error('手机页面状态保存失败：浏览器存储不可用');
        runtime.phoneUiState = merged;
        return merged;
    };
    const updatePhoneUiScope = (storageId, patch, store = runtime.store) => persistPhoneUiState(storageId, patchPhoneUiScope(getPhoneUiState(store), storageId, patch, store), store);
    const phoneScope = (storageId, store = runtime.store) => getPhoneUiState(store).scopes[storageId] || createDefaultPhoneUiScope();
    const commitWithPhoneUi = createCommitWithPhoneUi({ getPhoneUiState, persistPhoneUiState, getStore: () => runtime.store, commit });
    const communityUiScope = (storageId, store = runtime.store) => ({ ...phoneScope(storageId, store), storageId,
        sharedCommunityTemplates: getPhoneUiState(store).sharedCommunityTemplates || [] });
    const sharedTemplatesFor = (storageId, store = runtime.store) => {
        const state = getPhoneUiState(store), dismissedIds = new Set(state.scopes[storageId]?.dismissedCommunityTemplateIds || []);
        return (state.sharedCommunityTemplates || []).filter(template => template.sourceStorageId !== storageId && !dismissedIds.has(template.id));
    };
    const renderInto = (selector, html) => {
        const container = document.querySelector(selector);
        if (!container) return false;
        container.innerHTML = html;
        deps.hydrateImageCards?.(container);
        return true;
    };
    const showPhonePage = page => window.__pmShowPhonePage?.(page) === true;
    const reportPhoneUiError = error => {
        const message = error ? generationErrorMessage(error) : '手机页面操作失败';
        setStatus(message);
        if (!document.querySelector('.pm-scene-status')) alert(message); };
    function refreshDesktop(scopeId = getStorageId(), store = runtime.store) {
        const validScope = !!store && !!scopeId && scopeId !== 'sms_unknown__default';
        const scope = validScope ? getScope(store, scopeId) : { scenes: {} };
        const uiScope = validScope ? communityUiScope(scopeId, store)
            : { pinnedSceneIds: [], lastPage: 'desktop', lastSceneId: null, lastTab: 'feed' };
        return renderInto('.pm-desktop-page', renderPhoneDesktop(scope, uiScope, sharedTemplatesFor(scopeId, store), { pinsExpanded: runtime.desktopPinsExpanded === true }));
    }
    const showPhoneDesktopPage = () => { const scopeId = getStorageId(), phoneWindow = _state.phoneWindow; return runDesktopPageTransition({
        scopeId,
        loadStore,
        updatePhoneUi: (scopeId, store) => updatePhoneUiScope(scopeId, { lastPage: 'desktop', lastSceneId: null }, store),
        refreshDesktop,
        showPhonePage,
        clearOpenScene: () => { invalidate(); clearOpenScene(); },
        isCurrent: () => _state.phoneActive && _state.phoneWindow === phoneWindow && getStorageId() === scopeId,
        getCurrentPage: () => phoneWindow?.querySelector('.pm-main-ui')?.dataset.page || null,
    }); };
    const showPhoneCalendarPage = () => {
        const scopeId = getStorageId();
        const phoneWindow = _state.phoneWindow;
        return runCalendarPageTransition({
            scopeId, loadStore, renderCalendar: id => deps.renderCalendar?.(id) === true,
            updatePhoneUi: (id, store) => updatePhoneUiScope(id, { lastPage: 'calendar', lastSceneId: null }, store),
            refreshDesktop, showPhonePage,
            clearOpenScene: () => { invalidate(); clearOpenScene(); },
            isCurrent: () => _state.phoneActive && _state.phoneWindow === phoneWindow && getStorageId() === scopeId,
            getCurrentPage: () => phoneWindow?.querySelector('.pm-main-ui')?.dataset.page || 'desktop',
        });
    };
    function renderCommunityLauncher(scopeId, store = runtime.store) {
        const scope = getScope(store, scopeId);
        clearOpenScene();
        return renderInto('.pm-community-page', renderCommunityLauncherView(scope, { ...communityUiScope(scopeId, store), ...igsSync?.launcherState() }));
    }
    function renderCommunityWorkspace(scopeId, sceneId, tab, store = runtime.store) {
        const scope = getScope(store, scopeId);
        const scene = scope.scenes[sceneId];
        if (!scene) return false;
        runtime.openSceneId = sceneId;
        runtime.openSceneStorageId = scopeId;
        syncComposeDraft(sceneId);
        return renderInto('.pm-community-page', renderCommunityWorkspaceView(scene, tab, { ...phoneScope(scopeId, store), lastTab: 'feed' }, {
            autoActive: communityTasks.state().mode === 'auto',
            view: viewOf(sceneId),
            authorName: actorSeeds(scopeId).user.displayName,
            ...getCommunityInjectionState(window.__pmBudgetConfig, scopeId, sceneId), ...igsSync?.viewState(),
        }));
    }
    window.__pmReturnToCommunityDataSource = async () => {
        const scopeId = runtime.openSceneStorageId || getStorageId();
        const sceneId = runtime.openSceneId;
        const tab = 'feed';
        document.getElementById('pm-overlay')?.remove();
        if (sceneId && renderCommunityWorkspace(scopeId, sceneId, tab)) {
            showPhonePage('community');
            return true;
        }
        return window.__pmOpenForumMode?.() || false;
    };
    async function contextText(signal) {
        const ctx = await gatherContext(null, { module: 'community', signal });
        const context = [ctx.cardDesc, ctx.cardPersonality, ctx.cardScenario, ctx.mainChatText]
            .filter(Boolean).join('\n').slice(0, 9000);
        return { context, worldBookText: ctx.worldBookText };
    }
    // 返回解析后的 items；热搜 / 今夜信箱这类 meta 以不可枚举属性挂在 items 上，由 commitFeed 取用，调度器无需改动。
    async function request(kind, extra = {}, target = null) {
        if (runtime.busy) throw new Error('已有生成任务正在进行');
        const { scopeId, scene } = target ? resolveTarget(target) : current();
        if (!scene || scopeId === 'sms_unknown__default') throw new Error('当前宿主会话不可用');
        const scope = runtime.store.scopes[scopeId];
        const controller = new AbortController();
        runtime.busy = true;
        runtime.requestController = controller;
        const requestId = ++runtime.requestId;
        setStatus('AI 正在生成…');
        try {
            const currentStorySeed = actorSeeds(scopeId).story;
            const actorRoster = [...Object.values(scope.actors || {})
                .filter(actor => actor.type === 'story')
                .map(actor => actor.displayName), currentStorySeed.displayName]
                .filter((name, index, values) => name && values.indexOf(name) === index);
            const contextData = await contextText(controller.signal);
            const platform = platformOf(scene);
            const prompts = buildCommunityRequest({ kind, platform, nsfw: scene.nsfw === true, styleInput: scene.styleInput, generatedPrompt: scene.generatedPrompt, ...contextData, actorRoster, ...(kind === 'feed_batch' ? igsSync?.requestExtras(scene) : null), ...extra });
            const raw = await callAI(prompts.systemPrompt, prompts.userPrompt, {
                isolated: true, module: 'community',
                signal: controller.signal,
            });
            if (requestId !== runtime.requestId || !document.getElementById('pm-scene-app')) throw new Error('生成已取消');
            const { items, meta } = parseCommunityResponse(raw, kind, platform);
            Object.defineProperty(items, 'meta', { value: meta, enumerable: false });
            return items;
        } finally {
            if (requestId === runtime.requestId) {
                runtime.requestController = null;
                runtime.busy = false;
                setStatus('');
            }
        }
    }
    function replaceApp(html, { feedScrollTop = null } = {}) {
        const app = document.getElementById('pm-scene-app');
        if (app) { app.outerHTML = html; deps.hydrateImageCards?.(document.getElementById('pm-scene-app')); }
        else renderInto('.pm-community-page', html);
        if (Number.isFinite(feedScrollTop)) {
            const feed = document.querySelector('#pm-scene-app .pm-scene-feed'); if (feed) feed.scrollTop = feedScrollTop;
        }
    }
    // 编辑页开着时，重绘前把输入框里的内容存回 view.draft（只在内存里），避免后台重绘把正在写的字冲掉。
    function syncComposeDraft(sceneId) {
        const view = runtime.communityViews[sceneId];
        const sheet = document.querySelector('#pm-scene-app .pm-scene-sheet');
        if (view?.compose === true && sheet) view.draft = readComposeDraft(document.getElementById('pm-scene-app'));
    }
    // 编辑页重绘后把光标放回第一个输入处（data-compose-focus 标记）。
    function focusComposeField() {
        document.querySelector('#pm-scene-app .pm-scene-sheet [data-compose-focus]')?.focus?.({ preventScroll: true });
    }
    function rerender(tab = 'feed', { preserveFeedScroll = false, scrollToEnd = false, scrollTop = null } = {}) {
        const { scopeId, scene } = current();
        if (!scene) return;
        const feedScrollTop = Number.isFinite(scrollTop) ? scrollTop : preserveFeedScroll ? document.querySelector('#pm-scene-app .pm-scene-feed')?.scrollTop : null;
        syncComposeDraft(scene.id);
        replaceApp(renderCommunityWorkspaceView(scene, tab, { ...phoneScope(scopeId), lastTab: 'feed' }, {
            autoActive: communityTasks.state().mode === 'auto',
            view: viewOf(scene.id),
            authorName: actorSeeds(scopeId).user.displayName,
            ...getCommunityInjectionState(window.__pmBudgetConfig, scopeId, scene.id), ...igsSync?.viewState(),
        }), { feedScrollTop });
        if (scrollToEnd) { const feed = document.querySelector('#pm-scene-app .pm-scene-feed'); if (feed) feed.scrollTop = feed.scrollHeight; }
    }
    async function openScene(sceneId, tab = 'feed') {
        invalidate();
        const scopeId = getStorageId();
        await loadStore();
        const scope = getScope(runtime.store, scopeId);
        if (!scope.scenes?.[sceneId]) throw new Error('互动场景不存在');
        await commit(() => { getScope(runtime.store, scopeId).activeSceneId = sceneId; });
        runtime.openSceneId = sceneId;
        runtime.openSceneStorageId = scopeId;
        resetView(sceneId);
        updatePhoneUiScope(scopeId, { lastPage: 'community', lastSceneId: sceneId, lastTab: 'feed' });
        renderCommunityWorkspace(scopeId, sceneId, 'feed');
        showPhonePage('community');
    }
    async function importCommunityTemplate(templateId) {
        return createCommunityTemplateImportAction({ getStorageId, loadStore, getInteractiveStore: () => runtime.store, getPhoneUiState: () => getPhoneUiState(runtime.store), getScope: scopeId => getScope(runtime.store, scopeId), phoneScope: scopeId => phoneScope(scopeId, runtime.store), commitWithPhoneUi, patchPhoneUiScope, refreshDesktop, openScene, createSceneFromCommunityTemplate, createSceneId: () => uid('scene'), sceneLimit: INTERACTIVE_LIMITS.scenes })(templateId);
    }
    function appendPosts(scopeId, scope, scene, items, options = {}) {
        const seeds = actorSeeds(scopeId);
        return appendScenePosts(scope, scopeId, scene, items, [seeds.story, seeds.user], options);
    }
    // 随机数可由 deps.random 打桩；每次调用时才读取。
    const randomSource = () => (typeof deps.random === 'function' ? deps.random() : Math.random());
    // 热搜、今夜信箱这类随 feed 一起返回的平台数据，只写给对应平台的社区。
    function applyFeedMeta(scene, meta) {
        if (!meta) return;
        if (platformOf(scene) === 'weibo' && meta.hot) setSceneHot(scene, meta.hot);
        if (platformOf(scene) === 'night' && meta.tonight) setSceneTonight(scene, meta.tonight, now());
    }
    async function createScene(app) {
        if (runtime.creating || runtime.busy) throw new Error('已有生成任务正在进行');
        runtime.creating = true;
        let createdSceneId = null;
        try {
            const scopeId = getStorageId();
            if (!scopeId || scopeId === 'sms_unknown__default') throw new Error('请先打开有效的角色聊天');
            const picked = app.querySelector('.pm-scene-platform.is-active')?.dataset.platform;
            const platform = COMMUNITY_PLATFORMS.includes(picked) ? picked : 'weibo';
            const styleInput = app.querySelector('#pm-scene-style')?.value.trim() || '';
            const nsfw = app.querySelector('#pm-scene-nsfw')?.getAttribute('aria-checked') === 'true';
            const isValid = operationGuard(scopeId, () => createdSceneId);
            await loadStore();
            await commit(() => {
                const scope = getScope(runtime.store, scopeId);
                const scene = normalizeScene({
                    id: uid('scene'),
                    title: COMMUNITY_PLATFORM_PROMPTS[platform].label,
                    platform,
                    nsfw,
                    preset: platform,
                    styleInput,
                    generatedPrompt: COMMUNITY_PLATFORM_PROMPTS[platform].defaultStyle,
                });
                createdSceneId = scene.id;
                scope.scenes[scene.id] = scene;
                scope.sceneOrder.push(scene.id);
                scope.activeSceneId = scene.id;
                runtime.openSceneId = scene.id;
                enforceInteractiveSceneLimit(scope);
            }, isValid, '创建社区');
            if (!isValid()) throw new Error('生成已取消');
            resetView(createdSceneId);
            updatePhoneUiScope(scopeId, { lastPage: 'community', lastSceneId: runtime.openSceneId, lastTab: 'feed' });
            refreshDesktop(scopeId);
            rerender('feed');
            try {
                await communityRunner.generateFeed();
            } catch (error) {
                if (error.message !== '生成已取消') setStatus(`社区已创建；AI 热场失败：${generationErrorMessage(error)}`);
            }
        } catch (error) {
            if (runtime.openSceneId === createdSceneId) runtime.openSceneId = null;
            throw error;
        } finally {
            runtime.creating = false;
        }
    }
    communityRunner = createCommunityGenerationRunner({
        controller: communityTasks, getTarget: getCommunityTarget, request,
        commitFeed: async (target, items, isValid, onComplete) => {
            let added = [];
            await commit(async () => {
                const { scopeId, scope, scene } = resolveTarget(target);
                if (!scene) throw new Error('生成已取消'); added = appendPosts(scopeId, scope, scene, items); applyFeedMeta(scene, items.meta); await onComplete?.();
            }, isValid);
            // 落库成功后才排配图任务（开了社区自动生成才会出图）。
            deps.notePhoneImagePosts?.(added, { storageId: target?.storageId, sceneId: target?.sceneId });
        },
        onRender: rerender, onStatus: setStatus,
    });
    async function generateComments(postId) {
        const { scopeId, scene } = current();
        const post = scene?.posts.find(item => item.id === postId);
        if (!post) throw new Error('帖子不存在');
        const isValid = operationGuard(scopeId, scene.id);
        const postContext = [post.title && `标题：${post.title}`, post.work && `书名：${post.work}`, post.content].filter(Boolean).join('\n');
        const items = await request('comment_batch', { post: postContext });
        await commit(() => {
            const { scopeId, scope, scene: currentScene } = current();
            if (!currentScene) throw new Error('生成已取消');
            const seeds = actorSeeds(scopeId);
            ensureInteractiveActor(scope, scopeId, seeds.story);
            ensureInteractiveActor(scope, scopeId, seeds.user);
            const currentPost = currentScene?.posts.find(item => item.id === postId);
            if (!currentPost) throw new Error('帖子不存在');
            for (const item of items) {
                // quote 是被引用楼层的作者名：在同帖已有评论里找同名作者的最近一条，找不到就不带 quoteId。
                const quoteId = findQuoteTargetId(currentPost.comments, item.quote);
                currentPost.comments.push({
                    id: uid('comment'),
                    ...resolveInteractiveAuthor(scope, scopeId, item.author),
                    content: item.content, createdAt: now(),
                    ...(quoteId ? { quoteId } : {}), ...(item.rating ? { rating: item.rating } : {}),
                });
            }
            currentPost.comments = currentPost.comments.slice(-INTERACTIVE_LIMITS.comments);
            currentScene.updatedAt = now();
        }, isValid, '生成评论');
        if (!isValid()) throw new Error('生成已取消');
        rerender('feed');
    }
    // 发布后即时回应（流程在 interactive-scene-respond-flow.js）。
    const { respondToUser, retryRespond, revealEntry, ensureCommentsVisible } = createRespondFlow({
        runtime, communityTasks, current, resolveTarget, actorSeeds, operationGuard, request, commit, rerender, setStatus, viewOf, randomSource,
    });
    async function regeneratePrompt() {
        const { scopeId, scene } = current();
        if (!scene) throw new Error('社区不存在或已被删除');
        const isValid = operationGuard(scopeId, scene.id);
        const [style] = await request('style_prompt');
        await commit(() => {
            const { scene: currentScene } = current();
            if (!currentScene) throw new Error('生成已取消');
            currentScene.title = style.title;
            currentScene.generatedPrompt = style.prompt;
            currentScene.updatedAt = now();
        }, isValid, '重新生成社区提示词');
        if (!isValid()) throw new Error('生成已取消');
        rerender('prompt');
    }
    async function handleAction(button, app) {
        const action = button.dataset.action;
        const calendarAction = dispatchCalendarAppAction(button, app, { showPhoneDesktopPage, handleCalendarAction: deps.handleCalendarAction }); if (calendarAction) { await calendarAction; return; }
        if (action === 'more') { toggleSceneMenu(button); return; } if (action === 'post-actions') { toggleScenePostActions(button); return; }
        if (action === 'toggle-reply') { toggleSceneReplyComposer(button, app); return; }
        if (action === 'pick-platform') { pickPlatform(app, button); return; }
        if (action === 'toggle-nsfw') { toggleNsfwSwitch(button); return; }
        if (action === 'toggle-auto-respond' || action === 'toggle-igs-sync') { toggleNsfwSwitch(button); return; }
        if (action === 'igs-import') { await igsSync?.handleAction(action, { setStatus }); return; }
        if (action === 'pick-rating') { pickRating(app, button); return; }
        if (action === 'pick-mood') { pickMood(app, button); return; }
        if (action === 'insert-topic') { insertTopicMark(document.getElementById('pm-scene-post-input')); return; }
        // 各平台的发布入口都进同一个整页编辑页；草稿只在内存里（view.draft），取消即丢弃。
        if (action === 'open-compose' || action === 'close-compose') {
            const sceneId = current().scene?.id;
            if (!sceneId) return;
            const view = viewOf(sceneId);
            if (action === 'open-compose') {
                view.feedScroll = document.querySelector('#pm-scene-app .pm-scene-feed')?.scrollTop || 0;
                Object.assign(view, { compose: true, draft: {} });
                rerender('feed');
                focusComposeField();
            } else {
                Object.assign(view, { compose: false, draft: null });
                rerender('feed', { scrollTop: view.feedScroll });
            }
            return;
        }
        if (VIEW_ACTIONS.includes(action)) {
            const sceneId = current().scene?.id;
            if (!sceneId) return;
            // 切换分段、打开或返回时回到顶部；展开收起与筛选保持滚动位置（见 view-actions.js）。
            rerender('feed', { preserveFeedScroll: applyViewAction(viewOf(sceneId), action, button.dataset) });
            return;
        }
        if (action === 'community-worldbook-columns') {
            await window.__pmShowWorldBookColumns?.({
                title: '数据来源', module: 'community',
                backAction: 'window.__pmReturnToCommunityDataSource()', backLabel: '返回社区',
            });
            return;
        }
        if (action === 'desktop-chat') { deps.showPhoneChatPage?.(getStorageId()); return; }
        if (action === 'desktop-directory') { window.__pmShowList?.(); return; }
        if (action === 'desktop-settings') { window.__pmOpenSettingsTab?.('home'); return; }
        if (action === 'desktop-calendar') { await showPhoneCalendarPage(); return; }
        if (action === 'desktop-today-trend') { await deps.showTodayTrendPage?.(); return; }
        if (action === 'desktop-story-oracle') { await deps.showStoryOraclePage?.(getStorageId()); return; }
        if (action === 'desktop-gallery' || action === 'desktop-shop') { await (action === 'desktop-shop' ? window.__pmOpenShopApp?.() : deps.showPhoneGalleryPage?.()); return; }
        if (action === 'desktop-live') { await window.__pmOpenLiveApp?.(); return; }
        if (action === 'desktop-community') { await window.__pmOpenForumMode(); return; }
        if (action === 'desktop-toggle-pins') { runtime.desktopPinsExpanded = runtime.desktopPinsExpanded !== true; refreshDesktop(); return; }
        if (action === 'desktop-exit' || action === 'exit') { await window.__pmEnd?.(); return; }
        if (await handleCommunityInjectionUiAction(action, {
            app, button, getCurrent: current,
            getLastTab: () => 'feed',
                config: window.__pmBudgetConfig,
                saveConfig: deps.saveBudgetConfig,
                refreshInjection: deps.applyBidirectionalInjection,
            rerender, setStatus,
        })) return;
        if (action === 'desktop-open-scene') {
            await openScene(button.dataset.sceneId, 'feed');
            return;
        }
        if (action === 'desktop-import-community-template') {
            await importCommunityTemplate(button.dataset.templateId);
            return;
        }
        if (action === 'dismiss-community-template') {
            const scopeId = getStorageId();
            const nextState = dismissCommunityTemplate(getPhoneUiState(runtime.store), scopeId, button.dataset.templateId, runtime.store);
            persistPhoneUiState(scopeId, nextState);
            refreshDesktop(scopeId);
            return;
        }
        if (action === 'desktop') {
            await showPhoneDesktopPage();
            return;
        }
        if (handleSceneAccentAction(action, app, button)) return;
        if (action === 'create-scene') { await createScene(app); return; }
        if (action === 'open-scene') {
            await openScene(button.dataset.sceneId, 'feed');
            return;
        }
        if (action === 'toggle-scene-pin' || action === 'unpin-scene') {
            const scopeId = getStorageId();
            const nextState = toggleScenePin(getPhoneUiState(runtime.store), scopeId, button.dataset.sceneId, runtime.store);
            persistPhoneUiState(scopeId, nextState);
            refreshDesktop(scopeId);
            if (button.closest('#pm-scene-app') && !button.closest('.pm-scene-card')) {
                rerender('feed', { preserveFeedScroll: true });
            } else if (button.closest('.pm-community-page')) {
                const pinned = nextState.scopes[scopeId]?.pinnedSceneIds.includes(button.dataset.sceneId) === true, pinLabel = pinned ? '取消固定社区' : '固定社区'; button.setAttribute('aria-pressed', String(pinned)); button.setAttribute('aria-label', pinLabel); button.title = pinLabel;
            }
            return;
        }
        if (action === 'publish-community-template' || action === 'unpublish-community-template') {
            const scopeId = getStorageId();
            const nextState = action === 'publish-community-template'
                ? publishCommunityTemplate(getPhoneUiState(runtime.store), scopeId, button.dataset.sceneId, runtime.store)
                : unpublishCommunityTemplate(getPhoneUiState(runtime.store), scopeId, button.dataset.sceneId, runtime.store);
            persistPhoneUiState(scopeId, nextState);
            refreshDesktop(scopeId);
            renderCommunityLauncher(scopeId);
            return;
        }
        if (action === 'delete-scene') {
            const sceneId = button.dataset.sceneId;
            const { scopeId, scope } = current();
            await runDeleteSceneAction(scopeId, sceneId, {
                scope,
                confirm: confirmDelete,
                invalidate,
                commit,
                commitDelete: mutator => commitWithPhoneUi(scopeId, mutator, () => removeCommunityTemplatesForSourceScene(
                    getPhoneUiState(runtime.store), scopeId, sceneId, runtime.store,
                ), '删除互动场景'),
                persistPhoneUi: () => {},
                refreshDesktop,
                getBudgetConfig: () => window.__pmBudgetConfig,
                saveBudgetConfig: deps.saveBudgetConfig,
                clearOpenScene,
                renderLauncher: renderCommunityLauncher,
            });
            return;
        }
        if (action === 'tab') {
            invalidate();
            const { scopeId, scene } = current();
            const nextTab = button.dataset.tab;
            if (nextTab === 'feed') updatePhoneUiScope(scopeId, { lastPage: 'community', lastSceneId: scene?.id || null, lastTab: 'feed' });
            rerender(nextTab);
            return;
        }
        if (action === 'publish') {
            const input = document.getElementById('pm-scene-post-input');
            const rawContent = input?.value || '';
            const { scopeId, scope, scene } = current();
            if (!scope || !scene) throw new Error('互动场景不存在');
            const platform = platformOf(scene);
            const target = { storageId: scopeId, sceneId: scene.id };
            const { authorSeed, content } = parseCommunityPostInput(rawContent, scope.actors, actorSeeds(scopeId).user);
            // 附加输入（书名与星级、心情、写给）随平台带上；落款默认用用户名。
            const fields = composePostFields(platform, content, readComposeUi(app), { view: viewOf(scene.id), scene, authorName: authorSeed.displayName });
            const isValid = operationGuard(scopeId, scene.id);
            let createdPostId = '';
            await commit(() => {
                const currentTarget = resolveTarget(target);
                if (!currentTarget.scope || !currentTarget.scene) throw new Error('互动场景不存在');
                // 用户的新帖子随机插进最新 6 条里，位置只在这里决定一次。
                const [created] = appendPosts(currentTarget.scopeId, currentTarget.scope, currentTarget.scene, [{
                    author: authorSeed.displayName, authorSeed, ...fields,
                }], { place: (posts, post) => placePostInWindow(posts, post, { random: randomSource, now: now() }) });
                createdPostId = created?.id || '';
            }, isValid, '发布帖子');
            resetViewAfterPublish(viewOf(scene.id), platform);
            rerender('feed');
            if (createdPostId) {
                revealEntry(createdPostId);
                await respondToUser({ kind: 'post', postId: createdPostId });
            }
            return;
        }
        // 豆瓣详情页底部输入框：回复楼主，写进该帖评论。
        if (action === 'reply-owner') {
            const rawContent = document.getElementById('pm-scene-post-input')?.value || '';
            const postId = viewOf(current().scene?.id).postId;
            if (!postId) throw new Error('帖子不存在');
            let createdCommentId = '';
            await commit(() => {
                const { scopeId, scope, scene } = current();
                const { authorSeed, content } = parseCommunityPostInput(rawContent, scope?.actors, actorSeeds(scopeId).user, { contentLabel: '评论', maxLength: 1000 });
                createdCommentId = addSceneComment(scope, scopeId, scene, postId, authorSeed, content).id;
            });
            rerender('feed', { scrollToEnd: true });
            await respondToUser({ kind: 'comment', postId, commentId: createdCommentId, replyOwner: true });
            return;
        }
        if (action === 'retry-respond') { await retryRespond(button.dataset); return; }
        if (action === 'poke-scene') {
            await communityRunner.generateFeed(null, { renderTab: 'feed' }); return;
        }
        if (action === 'comments') { await generateComments(button.dataset.postId); return; }
        if (action === 'post-comment') {
            const composer = button.closest?.('.pm-scene-comment-composer');
            const input = composer?.querySelector?.('input');
            const rawContent = input?.value || '';
            const postId = button.dataset.postId;
            let createdCommentId = '';
            await commit(() => {
                const { scopeId, scope, scene } = current();
                const { authorSeed, content } = parseCommunityPostInput(rawContent, scope?.actors, actorSeeds(scopeId).user, { contentLabel: '评论', maxLength: 1000 });
                createdCommentId = addSceneComment(scope, scopeId, scene, postId, authorSeed, content).id;
            });
            const commented = current().scene;
            if (commented) ensureCommentsVisible(commented, postId);
            rerender('feed', { preserveFeedScroll: true });
            revealEntry(createdCommentId);
            await respondToUser({ kind: 'comment', postId, commentId: createdCommentId });
            return;
        }
        if (action === 'like') { // 朋友圈点赞把用户名写进点赞名单
            await commit(() => toggleScenePostLike(current().scene, button.dataset.postId, platformOf(current().scene) === 'moments' ? actorSeeds(current().scopeId).user.displayName : ''));
            rerender('feed', { preserveFeedScroll: true }); return;
        }
        if (action === 'share') {
            await commit(() => incrementScenePostShare(current().scene, button.dataset.postId));
            rerender('feed', { preserveFeedScroll: true }); return;
        }
        if (action === 'edit-post') {
            const post = current().scene?.posts.find(item => item.id === button.dataset.postId);
            if (!post) throw new Error('帖子不存在');
            const content = window.prompt('编辑帖子内容', post.content);
            if (content === null) return;
            await commit(() => updateScenePost(current().scene, button.dataset.postId, content));
            rerender('feed'); return;
        }
        if (action === 'delete-post') {
            if (!confirmDelete('确定删除这篇帖子及其全部评论吗？')) return;
            await commit(() => deleteScenePost(current().scene, button.dataset.postId));
            const view = viewOf(current().scene?.id);
            if (view.postId === button.dataset.postId) view.postId = '';
            rerender('feed'); return;
        }
        if (action === 'edit-comment') {
            const post = current().scene?.posts.find(item => item.id === button.dataset.postId);
            const comment = post?.comments.find(item => item.id === button.dataset.commentId);
            if (!comment) throw new Error('评论不存在');
            const content = window.prompt('编辑评论内容', comment.content);
            if (content === null) return;
            await commit(() => updateSceneComment(
                current().scene, button.dataset.postId, button.dataset.commentId, content,
            ));
            rerender('feed'); return;
        }
        if (action === 'delete-comment') {
            if (!confirmDelete('确定删除这条评论吗？')) return;
            await commit(() => deleteSceneComment(
                current().scene, button.dataset.postId, button.dataset.commentId,
            ));
            rerender('feed');
            return;
        }
        if (action === 'save-prompt') {
            const title = document.getElementById('pm-scene-title')?.value.trim() || '';
            const prompt = document.getElementById('pm-scene-prompt')?.value.trim() || '';
            const themeAccent = document.getElementById('pm-scene-accent')?.value.trim().toLowerCase() || '';
            if (!title || !prompt) throw new Error('社区名称和提示词不能为空');
            if (!/^#[0-9a-f]{6}$/.test(themeAccent)) throw new Error('社区主题色格式无效');
            const nsfwSwitch = document.getElementById('pm-scene-nsfw');
            const autoRespondSwitch = document.getElementById('pm-scene-auto-respond');
            await commit(() => {
                const { scene } = current();
                scene.title = title.slice(0, 80);
                scene.generatedPrompt = prompt.slice(0, 6000);
                // 选中的就是平台默认色且此前没有自选色时，不写入覆盖值，继续跟随平台默认色。
                scene.themeAccent = themeAccent === COMMUNITY_PLATFORM_ACCENTS[platformOf(scene)] && !scene.themeAccent ? '' : themeAccent;
                if (nsfwSwitch) scene.nsfw = nsfwSwitch.getAttribute('aria-checked') === 'true';
                // 缺省视为开：只在明确关闭时写出 false，打开时去掉该键。
                if (autoRespondSwitch) {
                    if (autoRespondSwitch.getAttribute('aria-checked') === 'true') delete scene.autoRespond;
                    else scene.autoRespond = false;
                }
                igsSync?.applyPromptForm(current().scope, scene, app); scene.updatedAt = now();
            });
            rerender('prompt'); return;
        }
        if (action === 'regenerate-prompt') { await regeneratePrompt(); return; }
    }
    const bindPhonePageUi = phoneWindow => {
        bindDesktopArrange(phoneWindow?.querySelector?.('.pm-desktop-page'), { onCommit: () => refreshDesktop() });
        return bindPhonePageActions(phoneWindow, handleAction, reportPhoneUiError);
    };
    window.__pmOpenForumMode = async () => {
        invalidate();
        const scopeId = getStorageId();
        if (!scopeId || scopeId === 'sms_unknown__default') { alert('请先打开有效的角色聊天。'); return; }
        try {
            const store = await loadStore();
            runtime.openSceneId = null;
            renderCommunityLauncher(scopeId, store);
            showPhonePage('community');
        } catch (error) {
            alert(`互动场景加载失败：${error.message}`);
        }
    };
    Object.assign(deps, {
        getInteractiveStore: loadStore,
        observeCommunityTurn: chat => communityRunner.observe(chat),
        cancelCommunityGeneration: invalidate,
        bindPhonePageUi,
        refreshPhoneDesktop: () => refreshDesktop(),
        showPhoneCalendarPage,
        showPhoneDesktopPage,
        async restorePhoneChat(defaultContact) {
            const scopeId = getStorageId();
            if (!scopeId || scopeId === 'sms_unknown__default') return false;
            const store = await loadStore();
            const uiScope = phoneScope(scopeId, store);
            const histories = window.__pmHistories?.[scopeId] || {};
            const groups = window.__pmGroupMeta?.[scopeId] || {};
            const target = resolvePhoneChatTarget(uiScope, histories, groups, defaultContact);
            if (target.type === 'group' || Object.hasOwn(histories, target.key)) {
                await window.__pmSwitchContact(target.key, { preservePage: true });
            } else window.__pmSwitch(target.key, undefined, undefined, { preservePage: true });
            return true;
        },
        async restorePhoneUi() {
            const scopeId = getStorageId();
            if (!scopeId || scopeId === 'sms_unknown__default') {
                refreshDesktop(scopeId, null);
                showPhonePage('desktop');
                return;
            }
            const store = await loadStore();
            const uiScope = phoneScope(scopeId, store);
            refreshDesktop(scopeId, store);
            if (uiScope.lastPage === 'community') {
                if (uiScope.lastSceneId && renderCommunityWorkspace(scopeId, uiScope.lastSceneId, uiScope.lastTab, store)) {
                    showPhonePage('community');
                    return;
                }
                renderCommunityLauncher(scopeId, store);
                showPhonePage('community');
                return;
            }
            if (uiScope.lastPage === 'calendar' && deps.renderCalendar?.(scopeId)) {
                runtime.openSceneId = null;
                showPhonePage('calendar');
                return;
            }
            if (uiScope.lastPage === 'today-trend' && await deps.showTodayTrendPage?.(scopeId)) { runtime.openSceneId = null; return; }
            if (uiScope.lastPage === 'story-oracle' && await deps.showStoryOraclePage?.(scopeId)) { runtime.openSceneId = null; return; }
            if (uiScope.lastPage === 'live' && await deps.showLivePage?.({ resume: true })) { runtime.openSceneId = null; return; }
            if (uiScope.lastPage === 'shop' && await deps.showShopPage?.({ resume: true })) { runtime.openSceneId = null; return; }
            runtime.openSceneId = null;
            showPhonePage(uiScope.lastPage === 'chat' ? 'chat' : 'desktop');
        },
        showPhoneChatPage(storageId = getStorageId()) {
            invalidate();
            runtime.openSceneId = null;
            showPhonePage('chat');
            loadStore().then(store => {
                updatePhoneUiScope(storageId, { lastPage: 'chat', lastSceneId: null }, store);
                refreshDesktop(storageId, store);
            }).catch(reportPhoneUiError);
        },
        persistPhoneUiSnapshot() {
            return persistCurrentPhoneUiSnapshot({
                runtime, storageId: getStorageId(),
                page: document.querySelector('#pm-iphone .pm-main-ui')?.dataset.page,
                phoneScope, updatePhoneUiScope,
                chatType: _state.isGroupChat && _state.currentGroupKey ? 'group'
                    : (_state.currentPersona ? 'contact' : null),
                chatKey: _state.isGroupChat && _state.currentGroupKey ? _state.currentGroupKey : _state.currentPersona,
            });
        },
        invalidateInteractiveStore() {
            invalidate(); storeLoader.invalidateStore(); runtime.openSceneId = null; runtime.phoneUiState = null;
        },
    });

    // 社区随酒馆文件保存（user/files/）。采用文件内容时经提交队列写入，走同样的校验与补偿。
    const communityFiles = createCommunityFileSync({
        getCtx, getStorageId,
        getStore: () => runtime.store,
        loadStore,
        commitStore: replace => commit(() => { runtime.store = replace(runtime.store); }, null, '同步酒馆社区文件'),
    });
    setInteractivePersistListener(communityFiles.noteLocalChange);
    Object.assign(deps, {
        reconcileCommunityFiles: communityFiles.reconcile,
        flushCommunityFiles: communityFiles.flush,
        markCommunityFilesLocalAuthoritative: communityFiles.markLocalAuthoritative,
    });
    // 直播是独立 App：只共用运行时、提交队列与任务控制器（同一时间一个生成任务），逻辑全在 live-app.js。
    liveApp = installLiveApp(deps, deps.sceneBridge = { // 桃宝（shop-app.js）也取用这份 bridge 的运行时、忙碌锁与上下文
        runtime, communityTasks, actorSeeds, commit, getScope, invalidate, clearOpenScene, loadStore, showPhonePage,
        updatePhoneUiScope, contextText, isPhoneIdle: () => !_state.phoneActive || _state.isMinimized,
    });
    // 与 gal 前端（IGS）联动，逻辑在 igs-feed-sync.js；设置页与宿主事件经 deps.igsLink 调用。总开关关着时不碰 IGS。
    deps.igsLink = igsSync = installIgsFeedSync({ getCtx, getStorageId, loadStore, getStore: () => runtime.store, commit, actorSeeds, contextText, callAI, uid, createEmptyScope: createEmptyInteractiveScope, syncShop: (...args) => deps.syncIgsShop?.(...args), refreshLive: () => deps.refreshLiveFromIgs?.(), isGenerationBusy: () => runtime.busy || runtime.creating || !!runtime.communityTask, ...igsRefreshers({ runtime, getStorageId, rerender, renderLauncher: renderCommunityLauncher, refreshDesktop }) });
}
