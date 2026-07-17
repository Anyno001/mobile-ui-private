import { buildInteractiveRequest, parseInteractiveResponse } from './interactive-scene-ai.js';
import {
    INTERACTIVE_LIMITS, addSceneComment, appendScenePosts, deleteSceneComment,
    deleteScenePost, enforceInteractiveSceneLimit, ensureInteractiveActor, normalizeInteractiveStore, normalizeScene,
    normalizePhoneUiState, patchPhoneUiScope, resolveInteractiveAuthor, stripPersistedV2ContentRating, toggleScenePin, updateSceneComment, updateScenePost,
} from './interactive-scene-model.js';
import {
    loadInteractiveScenes, loadPhoneUiState, saveInteractiveScenes, savePhoneUiState,
} from './storage.js';
import {
    bindPhonePageActions, runDeleteSceneAction,
} from './interactive-scene-phone.js';
import {
    createCommunityGenerationRunner, createCommunityTaskController,
} from './interactive-scene-scheduler.js';
import {
    renderCommunityLauncher as renderCommunityLauncherView,
    renderCommunityWorkspace as renderCommunityWorkspaceView, renderPhoneDesktop,
} from './interactive-scene-views.js';

export { renderPhoneDesktop } from './interactive-scene-views.js';

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

export function createInteractiveCommitQueue({ getStore, setStore, saveStore }) {
    let queue = Promise.resolve();
    const commit = (mutator, isValid = null, context = '操作') => {
        const operation = queue.catch(() => {}).then(async () => {
            const snapshot = cloneStore(getStore());
            if (isValid && !isValid()) throw new Error('文字直播已停止');
            let result;
            try {
                result = await mutator();
            } catch (error) {
                setStore(snapshot);
                throw error;
            }
            let saveCompleted = false;
            try {
                await saveStore(normalizeInteractiveStore(getStore()));
                saveCompleted = true;
            } finally {
                const needCompensation = !saveCompleted || (isValid && !isValid());
                if (needCompensation) {
                    setStore(snapshot);
                    try {
                        await saveStore(snapshot);
                    } catch (compensationError) {
                        const rootMsg = saveCompleted ? '文字直播已停止，但持久层部分数据可能已写入' : '保存失败；内存和部分持久化已恢复';
                        const combined = new Error(`${rootMsg}；补偿持久化也失败：${compensationError.message}`);
                        combined.cause = compensationError;
                        throw combined;
                    }
                }
                if (saveCompleted && isValid && !isValid()) throw new Error('文字直播已停止');
            }
            return result;
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

export async function runDesktopPageTransition({
    scopeId, loadStore, updatePhoneUi, refreshDesktop, showPhonePage, clearOpenScene,
    isCurrent = () => true, getCurrentPage = () => 'chat',
}) {
    const validScope = !!scopeId && scopeId !== 'sms_unknown__default';
    const store = validScope ? await loadStore() : null;
    if (!isCurrent()) return false;
    if (!refreshDesktop(scopeId, store)) throw new Error('桌面内容渲染失败');
    if (!isCurrent()) return false;
    const previousPage = getCurrentPage();
    if (!showPhonePage('desktop')) throw new Error('桌面页面不可用');
    try {
        if (validScope) updatePhoneUi(scopeId, store);
    } catch (error) {
        const ownsDesktopPage = isCurrent() && getCurrentPage() === 'desktop';
        if (ownsDesktopPage && previousPage && previousPage !== 'desktop') showPhonePage(previousPage);
        throw error;
    }
    if (!isCurrent() || getCurrentPage() !== 'desktop') return false;
    clearOpenScene();
    return true;
}

export function installInteractiveScenes(_state, deps) {
    const { getCtx, getStorageId, getUserPersona, gatherContext, callAI } = deps;
    const runtime = {
        store: null, loadPromise: null, mutationPromise: Promise.resolve(), requestId: 0,
        loadGeneration: 0, openSceneId: null, busy: false, creating: false, phoneUiState: null,
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
    });
    const commit = async (...args) => {
        const result = await queuedCommit(...args);
        await deps.applyBidirectionalInjection?.();
        return result;
    };
    const invalidate = (reason = 'community-context-invalidated') => { communityRunner?.cancel(reason, true); runtime.requestId += 1; runtime.busy = false; };
    const setStatus = text => { const el = document.querySelector('.pm-scene-status'); if (el) el.textContent = text || ''; };
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
    const phoneScope = (storageId, store = runtime.store) => getPhoneUiState(store).scopes[storageId]
        || { pinnedSceneIds: [], lastPage: 'desktop', lastSceneId: null, lastTab: 'feed' };
    const renderInto = (selector, html) => {
        const container = document.querySelector(selector);
        if (!container) return false;
        container.innerHTML = html;
        return true;
    };
    const showPhonePage = page => window.__pmShowPhonePage?.(page) === true;
    const reportPhoneUiError = error => {
        const message = error?.message || '手机页面操作失败';
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
        runtime.busy = true;
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
                maxTokens: kind === 'style_prompt' ? 700 : 1400,
                isolated: true,
            });
            if (requestId !== runtime.requestId || !document.getElementById('pm-scene-app')) throw new Error('生成已取消');
            return parseInteractiveResponse(raw, kind);
        } finally {
            if (requestId === runtime.requestId) {
                runtime.busy = false;
                setStatus('');
            }
        }
    }



    function replaceApp(html) {
        const app = document.getElementById('pm-scene-app');
        if (app) app.outerHTML = html;
        else renderInto('.pm-community-page', html);
    }

    function rerender(tab = document.querySelector('.pm-scene-tabs .is-active')?.dataset.tab || 'feed') {
        const { scopeId, scene } = current();
        if (scene) replaceApp(renderCommunityWorkspaceView(scene, tab, phoneScope(scopeId), {
            liveActive: communityRunner?.isLive() === true,
            autoActive: communityTasks.state().mode === 'auto',
        }));
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
        try {
            const scopeId = getStorageId();
            if (!scopeId || scopeId === 'sms_unknown__default') throw new Error('请先打开有效的角色聊天');
            const preset = app.querySelector('.pm-scene-preset.is-active')?.dataset.preset || 'weibo';
            const styleInput = app.querySelector('#pm-scene-style')?.value.trim() || '';
            if (preset === 'custom' && !styleInput) throw new Error('自定义风格不能为空');
            await loadStore();
            await commit(async () => {
                const scope = getScope(runtime.store, scopeId);
                const scene = normalizeScene({ id: uid('scene'), title: '正在生成社区…', preset, styleInput });
                scope.scenes[scene.id] = scene;
                scope.sceneOrder.push(scene.id);
                scope.activeSceneId = scene.id;
                runtime.openSceneId = scene.id;
                const [style] = await request('style_prompt');
                scene.title = style.title;
                scene.generatedPrompt = style.prompt;
                enforceInteractiveSceneLimit(scope);
            });
            updatePhoneUiScope(scopeId, { lastPage: 'community', lastSceneId: runtime.openSceneId, lastTab: 'feed' });
            refreshDesktop(scopeId);
            rerender('feed');
            try {
                await communityRunner.generateFeed();
            } catch (error) {
                if (error.message !== '生成已取消') setStatus(`社区已创建；AI 热场失败：${error.message}`);
            }
        } catch (error) {
            runtime.openSceneId = null;
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
        const { scene } = current();
        const post = scene?.posts.find(item => item.id === postId);
        if (!post) throw new Error('帖子不存在');
        const items = await request('comment_batch', { post: post.content });
        await commit(() => {
            const { scopeId, scope, scene: currentScene } = current();
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
        });
        rerender('feed');
    }

    async function regeneratePrompt() {
        const [style] = await request('style_prompt');
        await commit(() => {
            const { scene } = current();
            scene.title = style.title;
            scene.generatedPrompt = style.prompt;
            scene.updatedAt = now();
        });
        rerender('prompt');
    }

    async function handleAction(button, app) {
        const action = button.dataset.action;
        if (action === 'more') {
            const menu = button.parentElement?.querySelector('.pm-scene-menu');
            if (!menu) return;
            const opening = menu.hidden;
            menu.hidden = !opening;
            button.setAttribute('aria-expanded', String(opening));
            if (opening) menu.querySelector('button')?.focus({ preventScroll: true });
            return;
        }
        if (action === 'desktop-chat') { deps.showPhoneChatPage?.(getStorageId()); return; }
        if (action === 'desktop-directory') { window.__pmShowList?.(); return; }
        if (action === 'desktop-settings') { window.__pmOpenSettingsTab?.('home'); return; }
        if (action === 'desktop-community') { await window.__pmOpenForumMode(); return; }
        if (action === 'desktop-exit' || action === 'exit') { await window.__pmEnd?.(); return; }
        if (action === 'desktop-open-scene') {
            await openScene(button.dataset.sceneId, phoneScope(getStorageId()).lastTab);
            return;
        }
        if (action === 'desktop') {
            await showPhoneDesktopPage();
            return;
        }
        if (action === 'preset') {
            app.querySelectorAll('.pm-scene-preset').forEach(item => item.classList.toggle('is-active', item === button));
            return;
        }
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
            if (button.closest('.pm-scene-topbar')) {
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
        if (action === 'back') {
            invalidate();
            const { scopeId } = current();
            runtime.openSceneId = null;
            updatePhoneUiScope(scopeId, { lastPage: 'community', lastSceneId: null });
            renderCommunityLauncher(scopeId);
            return;
        }
        if (action === 'edit-scene') {
            const { scopeId, scene } = current();
            updatePhoneUiScope(scopeId, { lastPage: 'community', lastSceneId: scene?.id || null, lastTab: 'prompt' });
            rerender('prompt');
            return;
        }
        if (action === 'tab') {
            invalidate();
            const { scopeId, scene } = current();
            updatePhoneUiScope(scopeId, { lastPage: 'community', lastSceneId: scene?.id || null, lastTab: button.dataset.tab });
            rerender(button.dataset.tab);
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
        if (action === 'toggle-community-mode') {
            communityTasks.setMode(communityTasks.state().mode === 'auto' ? 'remind' : 'auto');
            rerender('feed');
            return;
        }
        if (action === 'ai-feed') { await communityRunner.generateFeed(); return; }
        if (action === 'comments') { await generateComments(button.dataset.postId); return; }
        if (action === 'post-comment') {
            const input = document.getElementById(`pm-comment-input-${button.dataset.postId}`);
            const content = input?.value.trim() || '';
            await commit(() => {
                const { scopeId, scope, scene } = current();
                addSceneComment(scope, scopeId, scene, button.dataset.postId, actorSeeds(scopeId).user, content);
            });
            rerender('feed'); return;
        }
        if (action === 'like') {
            await commit(() => {
                const post = current().scene?.posts.find(item => item.id === button.dataset.postId);
                if (!post) throw new Error('帖子不存在');
                post.liked = !post.liked;
                current().scene.updatedAt = now();
            });
            rerender('feed');
            return;
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
            if (!title || !prompt) throw new Error('社区名称和提示词不能为空');
            await commit(() => {
                const { scene } = current();
                scene.title = title.slice(0, 80); scene.generatedPrompt = prompt.slice(0, 6000); scene.updatedAt = now();
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
        showPhoneDesktopPage,
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
            const scopeId = getStorageId();
            const page = document.querySelector('#pm-iphone .pm-main-ui')?.dataset.page;
            if (!runtime.store || !scopeId || scopeId === 'sms_unknown__default' || !['desktop', 'chat', 'community'].includes(page)) return false;
            const scope = phoneScope(scopeId, runtime.store);
            const lastSceneId = page === 'community' ? runtime.openSceneId : null;
            const lastPage = page;
            updatePhoneUiScope(scopeId, { lastPage, lastSceneId, lastTab: scope.lastTab }, runtime.store);
            return true;
        },
        invalidateInteractiveStore() {
            invalidate();
            storeLoader.invalidateStore();
            runtime.openSceneId = null;
            runtime.phoneUiState = null;
        },
    });
}
