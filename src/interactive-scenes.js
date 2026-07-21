import { generationErrorMessage } from './ai.js';
import { buildInteractiveRequest, buildStylePrompt, getInteractivePresets, parseInteractiveResponse } from './interactive-scene-ai.js';
import {
    INTERACTIVE_LIMITS, addSceneComment, appendScenePosts, deleteSceneComment,
    deleteScenePost, enforceInteractiveSceneLimit, ensureInteractiveActor, normalizeInteractiveStore, normalizeScene,
    createDefaultPhoneUiScope, incrementScenePostShare, normalizePhoneUiState, patchPhoneUiScope, resolveInteractiveAuthor, stripPersistedV2ContentRating, toggleScenePin, toggleScenePostLike, updateSceneComment, updateScenePost,
} from './interactive-scene-model.js';
import {
    loadInteractiveScenes, loadPhoneUiState, saveInteractiveScenes, savePhoneUiState,
} from './storage.js';
import {
    bindPhonePageActions, getCommunityInjectionState, handleCommunityInjectionUiAction, handleSceneAccentAction,
    persistCurrentPhoneUiSnapshot, resolvePhoneChatTarget, runDeleteSceneAction, runDesktopPageTransition,
    selectScenePreset, toggleSceneMenu, toggleScenePostActions, toggleSceneReplyComposer,
} from './interactive-scene-phone.js';
import {
    createCommunityGenerationRunner, createCommunityTaskController,
} from './interactive-scene-scheduler.js';
import {
    renderCommunityLauncher as renderCommunityLauncherView,
    renderCommunityWorkspace as renderCommunityWorkspaceView, renderPhoneDesktop,
} from './interactive-scene-views.js';

export { renderPhoneDesktop } from './interactive-scene-views.js';
export { resolvePhoneChatTarget, runDesktopPageTransition } from './interactive-scene-phone.js';

const uid = prefix => `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
const now = () => Date.now();
const cloneStore = store => normalizeInteractiveStore(JSON.parse(JSON.stringify(store)));

export async function migrateInteractiveStore(rawStore, saveStore) {
    const persistedCompatibility = stripPersistedV2ContentRating(rawStore);
    const normalized = normalizeInteractiveStore(persistedCompatibility.store);
    const needsSave = !!rawStore && (rawStore.version !== normalized.version || persistedCompatibility.changed);
    if (!needsSave) return normalized;
    const snapshot = JSON.parse(JSON.stringify(rawStore));
    try {
        await saveStore(normalized);
    } catch (error) {
        try {
            await saveStore(snapshot);
        } catch (rollbackError) {
            const combined = new Error(`${error.message}；互动场景迁移回滚也失败：${rollbackError.message}`);
            combined.cause = error;
            combined.rollbackError = rollbackError;
            throw combined;
        }
        throw error;
    }
    return normalized;
}

export function createInteractiveOperationGuard({ getEpoch, getStorageId, getOpenSceneId, isMounted }, { epoch, storageId, sceneId }) {
    if (![getEpoch, getStorageId, getOpenSceneId, isMounted].every(value => typeof value === 'function')) {
        throw new TypeError('社区操作有效性依赖无效');
    }
    return () => {
        const expectedSceneId = typeof sceneId === 'function' ? sceneId() : sceneId;
        return getEpoch() === epoch
            && getStorageId() === storageId
            && (!expectedSceneId || getOpenSceneId() === expectedSceneId)
            && isMounted();
    };
}

export function createInteractiveCommitQueue({ getStore, setStore, saveStore, syncStore = null }) {
    if (syncStore !== null && typeof syncStore !== 'function') throw new TypeError('互动场景同步依赖无效');
    let queue = Promise.resolve();
    const commit = (mutator, isValid = null, context = '操作') => {
        const operation = queue.catch(() => {}).then(async () => {
            const snapshot = cloneStore(getStore());
            const cancelled = () => new Error(context === '操作' ? '文字直播已停止' : `${context}已取消`);
            if (isValid && !isValid()) throw cancelled();
            let result;
            try {
                result = await mutator();
            } catch (error) {
                setStore(snapshot);
                throw error;
            }
            let failure = null;
            try {
                await saveStore(normalizeInteractiveStore(getStore()));
                await syncStore?.();
                if (isValid && !isValid()) throw cancelled();
                return result;
            } catch (error) {
                failure = error;
            }
            setStore(snapshot);
            try {
                await saveStore(snapshot);
                await syncStore?.();
            } catch (compensationError) {
                const combined = new Error(`${failure.message}；补偿持久化或同步也失败：${compensationError.message}`);
                combined.cause = failure;
                combined.rollbackError = compensationError;
                throw combined;
            }
            throw failure;
        });
        queue = operation;
        return operation;
    };
    return commit;
}

export function createInteractiveStoreLoader({ runtime, load, migrate }) {
    if (!runtime || typeof load !== 'function' || typeof migrate !== 'function') {
        throw new TypeError('互动场景加载器依赖无效');
    }
    if (!Number.isInteger(runtime.loadGeneration)) runtime.loadGeneration = 0;
    const loadStore = async () => {
        if (runtime.store) return runtime.store;
        if (!runtime.loadPromise) {
            const generation = runtime.loadGeneration;
            runtime.loadPromise = {
                generation,
                promise: Promise.resolve().then(load).then(migrate),
            };
        }
        const pending = runtime.loadPromise;
        try {
            let loaded;
            try {
                loaded = await pending.promise;
            } catch (error) {
                if (pending.generation !== runtime.loadGeneration) return loadStore();
                throw error;
            }
            if (pending.generation !== runtime.loadGeneration) return loadStore();
            runtime.store = loaded;
            return loaded;
        } finally {
            if (runtime.loadPromise === pending) runtime.loadPromise = null;
        }
    };
    const invalidateStore = () => {
        runtime.loadGeneration += 1;
        runtime.store = null;
        runtime.loadPromise = null;
    };
    return { loadStore, invalidateStore };
}

export function installInteractiveScenes(_state, deps) {
    const { getCtx, getStorageId, getUserPersona, gatherContext, callAI } = deps;
    const runtime = {
        store: null, loadPromise: null, mutationPromise: Promise.resolve(), requestId: 0, contextEpoch: 0,
        loadGeneration: 0, openSceneId: null, busy: false, creating: false, phoneUiState: null, requestController: null,
    };
    const storeLoader = createInteractiveStoreLoader({
        runtime,
        load: loadInteractiveScenes,
        migrate: raw => migrateInteractiveStore(raw, saveInteractiveScenes),
    });
    const { loadStore } = storeLoader;
    const getScope = (store, scopeId) => store.scopes[scopeId]
        || (store.scopes[scopeId] = { activeSceneId: null, sceneOrder: [], scenes: {}, actors: {} });
    const actorSeeds = scopeId => {
        const context = getCtx();
        const character = context?.characters?.[context.characterId] || {};
        const characterBinding = character.avatar || `idx_${context?.characterId ?? 'unknown'}`;
        const settings = context?.powerUserSettings || context?.power_user || window.power_user || {};
        const persona = getUserPersona();
        const userBinding = context?.userAvatar || settings.user_avatar || settings.default_persona || `${scopeId}:default-user`;
        return {
            story: {
                type: 'story', displayName: character.name || 'AI',
                bindingKey: `character:${characterBinding}`,
                profile: [character.description, character.personality].filter(Boolean).join('\n').slice(0, 1000),
            },
            user: {
                type: 'user', displayName: persona?.name || '我',
                bindingKey: `persona:${userBinding}`,
                profile: String(persona?.description || '').slice(0, 1000),
            },
        };
    };
    const current = () => {
        const scopeId = getStorageId();
        const scope = runtime.store?.scopes?.[scopeId];
        return { scopeId, scope, scene: scope?.scenes?.[runtime.openSceneId || scope.activeSceneId] || null };
    };
    const resolveTarget = target => {
        const scope = runtime.store?.scopes?.[target?.storageId];
        return { scopeId: target?.storageId, scope, scene: scope?.scenes?.[target?.sceneId] || null };
    };
    const getCommunityTarget = () => {
        const scopeId = getStorageId();
        const scene = runtime.store?.scopes?.[scopeId]?.scenes?.[runtime.openSceneId];
        return runtime.openSceneId && scene ? { storageId: scopeId, sceneId: scene.id } : null;
    };
    const isTargetActive = target => getStorageId() === target?.storageId
        && runtime.openSceneId === target?.sceneId
        && !!resolveTarget(target).scene
        && document.querySelector('#pm-iphone .pm-main-ui')?.dataset.page === 'community';
    const operationGuard = (storageId, sceneId = () => runtime.openSceneId) => createInteractiveOperationGuard({
        getEpoch: () => runtime.contextEpoch,
        getStorageId,
        getOpenSceneId: () => runtime.openSceneId,
        isMounted: () => !!document.getElementById('pm-scene-app'),
    }, { epoch: runtime.contextEpoch, storageId, sceneId });
    const communityTasks = createCommunityTaskController({
        runtime,
        isTargetActive,
        isAllowed: target => _state.phoneActive && !_state.isMinimized && document.visibilityState !== 'hidden'
            && !runtime.busy && isTargetActive(target),
    });
    let communityRunner = null;
    const queuedCommit = createInteractiveCommitQueue({
        getStore: () => runtime.store,
        setStore: store => { runtime.store = store; },
        saveStore: saveInteractiveScenes,
        syncStore: () => deps.applyBidirectionalInjection?.(),
    });
    const commit = queuedCommit;
    const invalidate = (reason = 'community-context-invalidated') => {
        runtime.contextEpoch += 1;
        communityRunner?.cancel(reason, true);
        runtime.requestController?.abort(reason);
        runtime.requestController = null;
        runtime.requestId += 1;
        runtime.busy = false;
    };
    const setStatus = text => {
        const el = document.querySelector('.pm-scene-status');
        if (!el) return;
        el.textContent = text || '';
        el.hidden = !text;
    };
    const confirmDelete = message => window.confirm(message);

    const getPhoneUiState = store => {
        if (!runtime.phoneUiState) {
            runtime.phoneUiState = loadPhoneUiState(store);
        }
        return normalizePhoneUiState(runtime.phoneUiState, store);
    };
    const persistPhoneUiState = (nextState, store = runtime.store) => {
        const normalized = normalizePhoneUiState(nextState, store);
        if (!savePhoneUiState(normalized, store)) throw new Error('手机页面状态保存失败：浏览器存储不可用');
        runtime.phoneUiState = normalized;
        return normalized;
    };
    const updatePhoneUiScope = (storageId, patch, store = runtime.store) => persistPhoneUiState(
        patchPhoneUiScope(getPhoneUiState(store), storageId, patch, store), store,
    );
    const phoneScope = (storageId, store = runtime.store) => getPhoneUiState(store).scopes[storageId] || createDefaultPhoneUiScope();
    const renderInto = (selector, html) => {
        const container = document.querySelector(selector);
        if (!container) return false;
        container.innerHTML = html;
        return true;
    };
    const showPhonePage = page => window.__pmShowPhonePage?.(page) === true;
    const reportPhoneUiError = error => {
        const message = error ? generationErrorMessage(error) : '手机页面操作失败';
        setStatus(message);
        if (!document.querySelector('.pm-scene-status')) alert(message);
    };

    function refreshDesktop(scopeId = getStorageId(), store = runtime.store) {
        const validScope = !!store && !!scopeId && scopeId !== 'sms_unknown__default';
        const scope = validScope ? getScope(store, scopeId) : { scenes: {} };
        const uiScope = validScope ? phoneScope(scopeId, store)
            : { pinnedSceneIds: [], lastPage: 'desktop', lastSceneId: null, lastTab: 'feed' };
        return renderInto('.pm-desktop-page', renderPhoneDesktop(scope, uiScope));
    }

    const showPhoneDesktopPage = () => {
        const scopeId = getStorageId();
        const phoneWindow = _state.phoneWindow;
        return runDesktopPageTransition({
        scopeId,
        loadStore,
        updatePhoneUi: (scopeId, store) => updatePhoneUiScope(scopeId, { lastPage: 'desktop', lastSceneId: null }, store),
        refreshDesktop,
        showPhonePage,
        clearOpenScene: () => { invalidate(); runtime.openSceneId = null; },
        isCurrent: () => _state.phoneActive && _state.phoneWindow === phoneWindow && getStorageId() === scopeId,
        getCurrentPage: () => phoneWindow?.querySelector('.pm-main-ui')?.dataset.page || null,
    });
    };

    async function showPhoneCalendarPage() {
        invalidate();
        runtime.openSceneId = null;
        const scopeId = getStorageId();
        const phoneWindow = _state.phoneWindow;
        if (!scopeId || scopeId === 'sms_unknown__default') throw new Error('请先打开有效的角色聊天');
        const store = await loadStore();
        const isCurrent = () => _state.phoneActive && _state.phoneWindow === phoneWindow && getStorageId() === scopeId;
        if (!isCurrent()) return false;
        if (!deps.renderCalendar?.(scopeId)) throw new Error('日历页面渲染失败');
        if (!isCurrent()) return false;
        const previousPage = phoneWindow?.querySelector('.pm-main-ui')?.dataset.page || 'desktop';
        if (!showPhonePage('calendar')) throw new Error('日历页面不可用');
        try {
            updatePhoneUiScope(scopeId, { lastPage: 'calendar', lastSceneId: null }, store);
            refreshDesktop(scopeId, store);
        } catch (error) {
            if (isCurrent() && phoneWindow?.querySelector('.pm-main-ui')?.dataset.page === 'calendar') showPhonePage(previousPage);
            throw error;
        }
        return isCurrent() && phoneWindow?.querySelector('.pm-main-ui')?.dataset.page === 'calendar';
    }

    function renderCommunityLauncher(scopeId, store = runtime.store) {
        const scope = getScope(store, scopeId);
        runtime.openSceneId = null;
        return renderInto('.pm-community-page', renderCommunityLauncherView(scope, phoneScope(scopeId, store)));
    }

    function renderCommunityWorkspace(scopeId, sceneId, tab, store = runtime.store) {
        const scope = getScope(store, scopeId);
        const scene = scope.scenes[sceneId];
        if (!scene) return false;
        runtime.openSceneId = sceneId;
        return renderInto('.pm-community-page', renderCommunityWorkspaceView(scene, tab, phoneScope(scopeId, store), {
            liveActive: communityRunner?.isLive() === true,
            autoActive: communityTasks.state().mode === 'auto',
            ...getCommunityInjectionState(window.__pmBudgetConfig, scopeId, sceneId),
        }));
    }

    async function contextText() {
        const ctx = await gatherContext();
        return [ctx.cardDesc, ctx.cardPersonality, ctx.cardScenario, ctx.worldBookText, ctx.mainChatText].filter(Boolean).join('\n').slice(0, 9000);
    }

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
            if (kind === 'live_batch' && !extra.userContent) extra = { ...extra, userContent: scene.live.title };
            const prompts = buildInteractiveRequest({ kind, presetKey: scene.preset, styleInput: scene.styleInput, generatedPrompt: scene.generatedPrompt, context: await contextText(), actorRoster, ...extra });
            const raw = await callAI(prompts.systemPrompt, prompts.userPrompt, {
                isolated: true,
                signal: controller.signal,
            });
            if (requestId !== runtime.requestId || !document.getElementById('pm-scene-app')) throw new Error('生成已取消');
            return parseInteractiveResponse(raw, kind);
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
        if (app) app.outerHTML = html;
        else renderInto('.pm-community-page', html);
        if (Number.isFinite(feedScrollTop)) {
            const feed = document.querySelector('#pm-scene-app .pm-scene-feed'); if (feed) feed.scrollTop = feedScrollTop;
        }
    }
    function rerender(tab = phoneScope(getStorageId()).lastTab, { preserveFeedScroll = false } = {}) {
        const { scopeId, scene } = current();
        if (!scene) return;
        const feedScrollTop = preserveFeedScroll ? document.querySelector('#pm-scene-app .pm-scene-feed')?.scrollTop : null;
        replaceApp(renderCommunityWorkspaceView(scene, tab, phoneScope(scopeId), {
            liveActive: communityRunner?.isLive() === true,
            autoActive: communityTasks.state().mode === 'auto',
            ...getCommunityInjectionState(window.__pmBudgetConfig, scopeId, scene.id),
        }), { feedScrollTop });
    }

    async function openScene(sceneId, tab = 'feed') {
        invalidate();
        const scopeId = getStorageId();
        await loadStore();
        await commit(() => {
            const scope = getScope(runtime.store, scopeId);
            if (!scope.scenes?.[sceneId]) throw new Error('互动场景不存在');
            scope.activeSceneId = sceneId;
        });
        runtime.openSceneId = sceneId;
        updatePhoneUiScope(scopeId, { lastPage: 'community', lastSceneId: sceneId, lastTab: tab });
        renderCommunityWorkspace(scopeId, sceneId, tab);
        showPhonePage('community');
    }

    function appendPosts(scopeId, scope, scene, items) {
        const seeds = actorSeeds(scopeId);
        appendScenePosts(scope, scopeId, scene, items, [seeds.story, seeds.user]);
    }

    function appendDanmaku(scopeId, scope, scene, items) {
        const seeds = actorSeeds(scopeId);
        ensureInteractiveActor(scope, scopeId, seeds.story);
        ensureInteractiveActor(scope, scopeId, seeds.user);
        scene.live.danmaku.push(...items.map(item => ({
            id: uid('danmaku'),
            ...resolveInteractiveAuthor(scope, scopeId, item.author, item.authorSeed || null),
            content: item.content, createdAt: now(),
        })));
        scene.live.danmaku = scene.live.danmaku.slice(-INTERACTIVE_LIMITS.danmaku);
        scene.updatedAt = now();
    }
    async function createScene(app) {
        if (runtime.creating || runtime.busy) throw new Error('已有生成任务正在进行');
        runtime.creating = true;
        let createdSceneId = null;
        try {
            const scopeId = getStorageId();
            if (!scopeId || scopeId === 'sms_unknown__default') throw new Error('请先打开有效的角色聊天');
            const preset = app.querySelector('.pm-scene-preset.is-active')?.dataset.preset || 'weibo';
            const presetDefinition = getInteractivePresets()[preset] || getInteractivePresets().custom;
            const styleInput = app.querySelector('#pm-scene-style')?.value.trim() || '';
            if (preset === 'custom' && !styleInput) throw new Error('自定义风格不能为空');
            const isValid = operationGuard(scopeId, () => createdSceneId);
            await loadStore();
            await commit(async () => {
                const scope = getScope(runtime.store, scopeId);
                const scene = normalizeScene({
                    id: uid('scene'),
                    title: preset === 'custom' ? '正在生成社区…' : presetDefinition.label,
                    preset,
                    styleInput,
                    generatedPrompt: preset === 'custom' ? '' : buildStylePrompt(preset, styleInput),
                    themeAccent: presetDefinition.accent,
                });
                createdSceneId = scene.id;
                scope.scenes[scene.id] = scene;
                scope.sceneOrder.push(scene.id);
                scope.activeSceneId = scene.id;
                runtime.openSceneId = scene.id;
                if (preset === 'custom') {
                    const [style] = await request('style_prompt');
                    scene.title = style.title;
                    scene.generatedPrompt = style.prompt;
                }
                enforceInteractiveSceneLimit(scope);
            }, isValid, '创建社区');
            if (!isValid()) throw new Error('生成已取消');
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
        commitFeed: (target, items, isValid) => commit(() => {
            const { scopeId, scope, scene } = resolveTarget(target);
            if (!scene) throw new Error('生成已取消');
            appendPosts(scopeId, scope, scene, items);
        }, isValid),
        commitDanmaku: (target, items, isValid, slogan = '') => commit(() => {
            const { scopeId, scope, scene } = resolveTarget(target);
            if (!scene) throw new Error('生成已取消');
            const userSeed = actorSeeds(scopeId).user;
            appendDanmaku(scopeId, scope, scene, slogan
                ? [{ author: userSeed.displayName, authorSeed: userSeed, content: slogan }, ...items] : items);
        }, isValid),
        onRender: rerender, onStatus: setStatus,
    });

    async function generateComments(postId) {
        const { scopeId, scene } = current();
        const post = scene?.posts.find(item => item.id === postId);
        if (!post) throw new Error('帖子不存在');
        const isValid = operationGuard(scopeId, scene.id);
        const items = await request('comment_batch', { post: post.content });
        await commit(() => {
            const { scopeId, scope, scene: currentScene } = current();
            if (!currentScene) throw new Error('生成已取消');
            const seeds = actorSeeds(scopeId);
            ensureInteractiveActor(scope, scopeId, seeds.story);
            ensureInteractiveActor(scope, scopeId, seeds.user);
            const currentPost = currentScene?.posts.find(item => item.id === postId);
            if (!currentPost) throw new Error('帖子不存在');
            currentPost.comments.push(...items.map(item => ({
                id: uid('comment'),
                ...resolveInteractiveAuthor(scope, scopeId, item.author),
                content: item.content, createdAt: now(),
            })));
            currentPost.comments = currentPost.comments.slice(-INTERACTIVE_LIMITS.comments);
            currentScene.updatedAt = now();
        }, isValid, '生成评论');
        if (!isValid()) throw new Error('生成已取消');
        rerender('feed');
    }

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
        if (app?.id === 'pm-calendar-app') {
            if (action === 'calendar-home') await showPhoneDesktopPage();
            else {
                if (typeof deps.handleCalendarAction !== 'function') throw new Error('日历动作处理器尚未安装');
                await deps.handleCalendarAction(button, app);
            }
            return;
        }
        if (action === 'more') { toggleSceneMenu(button); return; }
        if (action === 'post-actions') { toggleScenePostActions(button); return; }
        if (action === 'toggle-reply') { toggleSceneReplyComposer(button, app); return; }
        if (action === 'desktop-chat') { deps.showPhoneChatPage?.(getStorageId()); return; }
        if (action === 'desktop-directory') { window.__pmShowList?.(); return; }
        if (action === 'desktop-settings') { window.__pmOpenSettingsTab?.('home'); return; }
        if (action === 'desktop-calendar') { await showPhoneCalendarPage(); return; }
        if (action === 'desktop-community') { await window.__pmOpenForumMode(); return; }
        if (action === 'desktop-exit' || action === 'exit') { await window.__pmEnd?.(); return; }
        if (await handleCommunityInjectionUiAction(action, {
            app, getCurrent: current,
            getLastTab: scopeId => phoneScope(scopeId).lastTab,
                config: window.__pmBudgetConfig,
                saveConfig: deps.saveBudgetConfig,
                refreshInjection: deps.applyBidirectionalInjection,
            rerender, setStatus,
        })) return;
        if (action === 'desktop-open-scene') {
            await openScene(button.dataset.sceneId, phoneScope(getStorageId()).lastTab);
            return;
        }
        if (action === 'desktop') {
            await showPhoneDesktopPage();
            return;
        }
        if (action === 'preset') { selectScenePreset(app, button); return; }
        if (handleSceneAccentAction(action, app, button)) return;
        if (action === 'create-scene') { await createScene(app); return; }
        if (action === 'open-scene') {
            await openScene(button.dataset.sceneId, 'feed');
            return;
        }
        if (action === 'toggle-scene-pin' || action === 'unpin-scene') {
            const scopeId = getStorageId();
            const nextState = toggleScenePin(getPhoneUiState(runtime.store), scopeId, button.dataset.sceneId, runtime.store);
            persistPhoneUiState(nextState);
            refreshDesktop(scopeId);
            if (button.closest('#pm-scene-app') && !button.closest('.pm-scene-card')) {
                rerender(phoneScope(scopeId).lastTab);
            } else if (button.closest('.pm-community-page')) {
                renderCommunityLauncher(scopeId);
            }
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
                persistPhoneUi: () => persistPhoneUiState(getPhoneUiState(runtime.store), runtime.store),
                refreshDesktop,
                getBudgetConfig: () => window.__pmBudgetConfig,
                saveBudgetConfig: deps.saveBudgetConfig,
                clearOpenScene: () => { runtime.openSceneId = null; },
                renderLauncher: renderCommunityLauncher,
            });
            return;
        }
        if (action === 'tab') {
            invalidate();
            const { scopeId, scene } = current();
            const nextTab = button.dataset.tab;
            if (['feed', 'live'].includes(nextTab)) {
                updatePhoneUiScope(scopeId, { lastPage: 'community', lastSceneId: scene?.id || null, lastTab: nextTab });
            }
            rerender(nextTab);
            return;
        }
        if (action === 'publish') {
            const input = document.getElementById('pm-scene-post-input');
            const content = input?.value.trim() || '';
            if (!content) throw new Error('帖子内容不能为空');
            await commit(() => {
                const { scopeId, scope, scene } = current();
                const userSeed = actorSeeds(scopeId).user;
                appendPosts(scopeId, scope, scene, [{ author: userSeed.displayName, authorSeed: userSeed, content, tags: [] }]);
            });
            rerender('feed'); return;
        }
        if (action === 'poke-scene') { await communityRunner.generateFeed(); return; }
        if (action === 'comments') { await generateComments(button.dataset.postId); return; }
        if (action === 'post-comment') {
            const composer = button.closest?.('.pm-scene-comment-composer');
            const input = composer?.querySelector?.('input');
            const content = input?.value.trim() || '';
            await commit(() => {
                const { scopeId, scope, scene } = current();
                addSceneComment(scope, scopeId, scene, button.dataset.postId, actorSeeds(scopeId).user, content);
            });
            rerender('feed'); return;
        }
        if (action === 'like') {
            await commit(() => toggleScenePostLike(current().scene, button.dataset.postId));
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
            await commit(() => {
                const { scene } = current();
                scene.title = title.slice(0, 80);
                scene.generatedPrompt = prompt.slice(0, 6000);
                scene.themeAccent = themeAccent;
                scene.updatedAt = now();
            });
            rerender('prompt'); return;
        }
        if (action === 'regenerate-prompt') { await regeneratePrompt(); return; }
        if (action === 'toggle-live') {
            if (communityRunner.isLive()) { communityRunner.cancel('live-stopped'); rerender('live'); }
            else await communityRunner.startLive();
            return;
        }
        if (action === 'send-danmaku') {
            const input = document.getElementById('pm-danmaku-input');
            const content = input?.value.trim() || '';
            if (!content) throw new Error('弹幕不能为空');
            await commit(() => {
                const { scopeId, scope, scene } = current();
                const userSeed = actorSeeds(scopeId).user;
                appendDanmaku(scopeId, scope, scene, [{ author: userSeed.displayName, authorSeed: userSeed, content }]);
            });
            rerender('live'); return;
        }
        if (action === 'rhythm') {
            const slogan = document.getElementById('pm-danmaku-input')?.value.trim() || '跟上这个话题';
            await communityRunner.leadRhythm(slogan);
        }
    }

    const bindPhonePageUi = phoneWindow => bindPhonePageActions(
        phoneWindow, handleAction, reportPhoneUiError,
    );

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
            invalidate();
            storeLoader.invalidateStore();
            runtime.openSceneId = null;
            runtime.phoneUiState = null;
        },
    });
}
