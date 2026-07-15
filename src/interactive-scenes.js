import { buildInteractiveRequest, getInteractivePresets, parseInteractiveResponse } from './interactive-scene-ai.js';
import {
    INTERACTIVE_LIMITS, addSceneComment, deleteInteractiveScene, deleteSceneComment, deleteScenePost,
    enforceInteractiveSceneLimit, normalizeInteractiveStore, normalizeScene, updateSceneComment, updateScenePost,
} from './interactive-scene-model.js';
import { loadInteractiveScenes, saveInteractiveScenes } from './storage.js';
import { escapeAttr, escapeHtml } from './ui.js';

const uid = prefix => `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
const now = () => Date.now();
const cloneStore = store => normalizeInteractiveStore(JSON.parse(JSON.stringify(store)));

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

export function installInteractiveScenes(_state, deps) {
    const { getStorageId, gatherContext, callAI, makeOverlay } = deps;
    const runtime = {
        store: null, loadPromise: null, mutationPromise: Promise.resolve(), requestId: 0,
        timer: null, openSceneId: null, busy: false, creating: false,
    };

    const loadStore = async () => {
        if (runtime.store) return runtime.store;
        if (!runtime.loadPromise) runtime.loadPromise = loadInteractiveScenes().then(normalizeInteractiveStore);
        try {
            runtime.store = await runtime.loadPromise;
            return runtime.store;
        } finally {
            runtime.loadPromise = null;
        }
    };
    const getScope = (store, scopeId) => store.scopes[scopeId] || (store.scopes[scopeId] = { activeSceneId: null, sceneOrder: [], scenes: {} });
    const current = () => {
        const scopeId = getStorageId();
        const scope = runtime.store?.scopes?.[scopeId];
        return { scopeId, scope, scene: scope?.scenes?.[runtime.openSceneId || scope.activeSceneId] || null };
    };
    const commit = createInteractiveCommitQueue({
        getStore: () => runtime.store,
        setStore: store => { runtime.store = store; },
        saveStore: saveInteractiveScenes,
    });
    const stopLive = () => { if (runtime.timer) clearInterval(runtime.timer); runtime.timer = null; };
    const invalidate = () => { runtime.requestId += 1; runtime.busy = false; stopLive(); };
    const setStatus = text => { const el = document.querySelector('.pm-scene-status'); if (el) el.textContent = text || ''; };
    const confirmDelete = message => window.confirm(message);

    async function contextText() {
        const ctx = await gatherContext();
        return [ctx.cardDesc, ctx.cardPersonality, ctx.cardScenario, ctx.worldBookText, ctx.mainChatText].filter(Boolean).join('\n').slice(0, 9000);
    }

    async function request(kind, extra = {}) {
        if (runtime.busy) throw new Error('已有生成任务正在进行');
        const { scopeId, scene } = current();
        if (!scene || scopeId === 'sms_unknown__default') throw new Error('当前宿主会话不可用');
        runtime.busy = true;
        const requestId = ++runtime.requestId;
        setStatus('AI 正在生成…');
        try {
            const prompts = buildInteractiveRequest({ kind, presetKey: scene.preset, styleInput: scene.styleInput, generatedPrompt: scene.generatedPrompt, context: await contextText(), ...extra });
            const raw = await callAI(prompts.systemPrompt, prompts.userPrompt, { maxTokens: kind === 'style_prompt' ? 700 : 1400 });
            if (requestId !== runtime.requestId || !document.getElementById('pm-scene-app')) throw new Error('生成已取消');
            return parseInteractiveResponse(raw, kind);
        } finally {
            if (requestId === runtime.requestId) {
                runtime.busy = false;
                setStatus('');
            }
        }
    }


    function renderPresetOptions(selected) {
        return Object.entries(getInteractivePresets()).map(([key, preset]) => `
            <button type="button" class="pm-scene-preset ${key === selected ? 'is-active' : ''}" data-action="preset" data-preset="${escapeAttr(key)}" style="--scene-accent:${preset.accent}">
                <span></span><b>${escapeHtml(preset.label)}</b>
            </button>`).join('');
    }

    function renderLauncher(scope) {
        const sceneCards = scope.sceneOrder.slice().reverse().map(sceneId => {
            const scene = scope.scenes[sceneId];
            return `<div class="pm-scene-card">
                <button type="button" class="pm-scene-card-open" data-action="open-scene" data-scene-id="${escapeAttr(scene.id)}">
                    <b>${escapeHtml(scene.title)}</b><span>${escapeHtml(getInteractivePresets()[scene.preset]?.label || '自定义')} · ${scene.posts.length} 篇帖子</span>
                </button>
                <button type="button" class="pm-scene-danger" data-action="delete-scene" data-scene-id="${escapeAttr(scene.id)}" aria-label="删除 ${escapeAttr(scene.title)}">删除</button>
            </div>`;
        }).join('');
        return `<div id="pm-scene-app" class="pm-modal pm-scene-shell">
            <div class="pm-modal-header"><b>互动场景</b><span class="pm-modal-close" data-action="close">✕</span></div>
            <div class="pm-scene-launcher">
                <section class="pm-scene-hero"><small>AI 社交宇宙</small><h2>今天想逛什么社区？</h2><p>选预设，或写下你自己的风格。AI 会先生成可编辑提示词，再把社区演起来。</p></section>
                <div class="pm-scene-presets">${renderPresetOptions('weibo')}</div>
                <label class="pm-scene-label">自定义风格<textarea id="pm-scene-style" maxlength="2000" placeholder="例如：雨夜都市、克制疏离、像老论坛一样有楼层感……"></textarea></label>
                <button type="button" class="pm-scene-primary" data-action="create-scene">生成我的社区</button>
                ${sceneCards ? `<div class="pm-scene-history"><h3>继续游玩</h3>${sceneCards}</div>` : ''}
                <div class="pm-scene-status" aria-live="polite"></div>
            </div>
        </div>`;
    }

    function renderPosts(scene) {
        if (!scene.posts.length) return '<div class="pm-scene-empty"><b>这里还很安静</b><span>发第一篇帖子，或者让 AI 把社区热起来。</span></div>';
        return scene.posts.slice().reverse().map(post => `<article class="pm-scene-post">
            <header><div class="pm-scene-avatar">${escapeHtml(post.author.slice(0, 1))}</div><div><b>${escapeHtml(post.author)}</b><span>刚刚 · ${escapeHtml(scene.title)}</span></div></header>
            <p>${escapeHtml(post.content).replace(/\n/g, '<br>')}</p>
            ${post.tags.length ? `<div class="pm-scene-tags">${post.tags.map(tag => `<span>#${escapeHtml(tag)}</span>`).join('')}</div>` : ''}
            <footer>
                <button type="button" data-action="like" data-post-id="${escapeAttr(post.id)}">${post.liked ? '♥ 已喜欢' : '♡ 喜欢'}</button>
                <button type="button" data-action="comments" data-post-id="${escapeAttr(post.id)}">AI 生成评论 ${post.comments.length}</button>
                <button type="button" data-action="edit-post" data-post-id="${escapeAttr(post.id)}">编辑</button>
                <button type="button" class="pm-scene-danger" data-action="delete-post" data-post-id="${escapeAttr(post.id)}">删除</button>
            </footer>
            ${post.comments.length ? `<div class="pm-scene-comments">${post.comments.map(comment => `<div class="pm-scene-comment">
                <span><b>${escapeHtml(comment.author)}</b> ${escapeHtml(comment.content)}</span>
                <span class="pm-scene-comment-actions"><button type="button" data-action="edit-comment" data-post-id="${escapeAttr(post.id)}" data-comment-id="${escapeAttr(comment.id)}">编辑</button><button type="button" class="pm-scene-danger" data-action="delete-comment" data-post-id="${escapeAttr(post.id)}" data-comment-id="${escapeAttr(comment.id)}">删除</button></span>
            </div>`).join('')}</div>` : ''}
            <div class="pm-scene-comment-composer">
                <input id="pm-comment-input-${escapeAttr(post.id)}" maxlength="1000" placeholder="写下你的评论……">
                <button type="button" data-action="post-comment" data-post-id="${escapeAttr(post.id)}">发表</button>
            </div>
        </article>`).join('');
    }

    function renderDanmaku(scene) {
        return scene.live.danmaku.slice(-80).map(item => `<div class="pm-danmaku-row"><b>${escapeHtml(item.author)}</b><span>${escapeHtml(item.content)}</span></div>`).join('') || '<div class="pm-scene-empty"><span>开始 AI 文字直播后，模拟弹幕会从这里滚起来。</span></div>';
    }


    function renderWorkspace(scene, tab = 'feed') {
        const preset = getInteractivePresets()[scene.preset] || getInteractivePresets().custom;
        const liveActive = !!runtime.timer;
        return `<div id="pm-scene-app" class="pm-modal pm-scene-shell" style="--scene-accent:${preset.accent}">
            <div class="pm-scene-topbar"><button type="button" data-action="back">‹</button><div><b>${escapeHtml(scene.title)}</b><span>${escapeHtml(preset.label)}</span></div><button type="button" data-action="delete-scene" data-scene-id="${escapeAttr(scene.id)}" aria-label="删除当前场景">⌫</button></div>
            <div class="pm-scene-tabs"><button type="button" data-action="tab" data-tab="feed" class="${tab === 'feed' ? 'is-active' : ''}">社区</button><button type="button" data-action="tab" data-tab="live" class="${tab === 'live' ? 'is-active' : ''}">AI 文字直播</button><button type="button" data-action="tab" data-tab="prompt" class="${tab === 'prompt' ? 'is-active' : ''}">风格提示词</button></div>
            ${tab === 'feed' ? `<div class="pm-scene-feed">
                <div class="pm-scene-composer"><textarea id="pm-scene-post-input" maxlength="4000" placeholder="发一条微博、帖子或书评……"></textarea><div><button type="button" data-action="ai-feed">AI 热场</button><button type="button" class="pm-scene-primary" data-action="publish">发布</button></div></div>
                <div class="pm-scene-posts">${renderPosts(scene)}</div>
            </div>` : tab === 'live' ? `<div class="pm-live-room">
                <div class="pm-live-stage"><div class="pm-live-badge">${liveActive ? 'AI ON AIR' : 'AI PREVIEW'}</div><h2>${escapeHtml(scene.live.title)}</h2><p>这是 AI 生成的文字弹幕模拟，不包含摄像头、语音或真实推流。</p><div class="pm-danmaku-float">${scene.live.danmaku.slice(-8).map((item, index) => `<span style="--lane:${index % 4};--delay:${(index % 5) * -.7}s">${escapeHtml(item.content)}</span>`).join('')}</div></div>
                <div class="pm-live-actions"><button type="button" data-action="toggle-live" class="${liveActive ? 'is-live' : ''}">${liveActive ? '停止文字直播' : '开始文字直播'}</button><button type="button" data-action="rhythm">带一波节奏</button></div>
                <div class="pm-danmaku-list">${renderDanmaku(scene)}</div>
                <div class="pm-danmaku-input"><input id="pm-danmaku-input" maxlength="200" placeholder="发条弹幕……"><button type="button" data-action="send-danmaku">发送</button></div>
            </div>` : `<div class="pm-scene-prompt"><label>社区名称<input id="pm-scene-title" maxlength="80" value="${escapeAttr(scene.title)}"></label><label>AI 生成的风格提示词<textarea id="pm-scene-prompt" maxlength="6000">${escapeHtml(scene.generatedPrompt)}</textarea></label><p>你可以直接修改。后续帖子、评论和弹幕都会遵循这里的语感。</p><div><button type="button" data-action="regenerate-prompt">重新生成</button><button type="button" class="pm-scene-primary" data-action="save-prompt">保存提示词</button></div></div>`}
            <div class="pm-scene-status" aria-live="polite"></div>
        </div>`;
    }

    function replaceApp(html) {
        const app = document.getElementById('pm-scene-app');
        if (app) app.outerHTML = html;
    }

    function rerender(tab = document.querySelector('.pm-scene-tabs .is-active')?.dataset.tab || 'feed') {
        const { scene } = current();
        if (scene) replaceApp(renderWorkspace(scene, tab));
    }

    function appendPosts(scene, items) {
        scene.posts.push(...items.map(item => ({ id: uid('post'), author: item.author, content: item.content, tags: item.tags || [], comments: [], liked: false, createdAt: now() })));
        scene.posts = scene.posts.slice(-INTERACTIVE_LIMITS.posts);
        scene.updatedAt = now();
    }

    function appendDanmaku(scene, items) {
        scene.live.danmaku.push(...items.map(item => ({ id: uid('danmaku'), author: item.author, content: item.content, createdAt: now() })));
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
                const scene = normalizeScene({ id: uid('scene'), title: '正在生成社区…', preset, styleInput, contentRating: preset === 'mature' ? 'mature' : 'general' });
                scope.scenes[scene.id] = scene;
                scope.sceneOrder.push(scene.id);
                scope.activeSceneId = scene.id;
                runtime.openSceneId = scene.id;
                const [style] = await request('style_prompt');
                scene.title = style.title;
                scene.generatedPrompt = style.prompt;
                enforceInteractiveSceneLimit(scope);
            });
            rerender('feed');
            try {
                const items = await request('feed_batch');
                await commit(() => appendPosts(current().scene, items));
                rerender('feed');
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

    async function generateFeed() {
        const items = await request('feed_batch');
        await commit(() => appendPosts(current().scene, items));
        rerender('feed');
    }

    async function generateComments(postId) {
        const { scene } = current();
        const post = scene?.posts.find(item => item.id === postId);
        if (!post) throw new Error('帖子不存在');
        const items = await request('comment_batch', { post: post.content });
        await commit(() => {
            const currentPost = current().scene?.posts.find(item => item.id === postId);
            if (!currentPost) throw new Error('帖子不存在');
            currentPost.comments.push(...items.map(item => ({ id: uid('comment'), author: item.author, content: item.content, createdAt: now() })));
            currentPost.comments = currentPost.comments.slice(-INTERACTIVE_LIMITS.comments);
            current().scene.updatedAt = now();
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

    async function startLive() {
        const { scene } = current();
        if (!scene || runtime.timer) return;
        const queue = await request('live_batch', { userContent: scene.live.title });
        const liveSessionId = runtime.requestId;
        let cursor = 0;
        const pushNext = async () => {
            if (!runtime.timer || liveSessionId !== runtime.requestId || cursor >= queue.length) {
                stopLive();
                if (document.getElementById('pm-scene-app')) rerender('live');
                return;
            }
            const item = queue[cursor++];
            try {
                await commit(() => {
                    appendDanmaku(current().scene, [item]);
                }, () => !!runtime.timer && liveSessionId === runtime.requestId);
                if (runtime.timer && document.getElementById('pm-scene-app')) rerender('live');
            } catch (error) {
                stopLive();
                if (error.message !== '文字直播已停止') setStatus(error.message);
            }
        };
        runtime.timer = setInterval(() => { pushNext(); }, 2200);
        await pushNext();
    }

    async function leadRhythm() {
        const input = document.getElementById('pm-danmaku-input');
        const slogan = input?.value.trim() || '跟上这个话题';
        const items = [{ author: '我', content: slogan }, ...await request('rhythm_batch', { userContent: slogan })];
        await commit(() => appendDanmaku(current().scene, items));
        rerender('live');
    }

    async function handleAction(button, app) {
        const action = button.dataset.action;
        if (action === 'close') { window.__pmCloseOverlay(); return; }
        if (action === 'preset') {
            app.querySelectorAll('.pm-scene-preset').forEach(item => item.classList.toggle('is-active', item === button));
            return;
        }
        if (action === 'create-scene') { await createScene(app); return; }
        if (action === 'open-scene') {
            invalidate();
            const sceneId = button.dataset.sceneId;
            await commit(() => {
                const { scope } = current();
                if (!scope?.scenes?.[sceneId]) throw new Error('互动场景不存在');
                scope.activeSceneId = sceneId;
            });
            runtime.openSceneId = sceneId;
            rerender('feed');
            return;
        }
        if (action === 'delete-scene') {
            const sceneId = button.dataset.sceneId;
            const { scope } = current();
            const scene = scope?.scenes?.[sceneId];
            if (!scene) throw new Error('互动场景不存在');
            if (!confirmDelete(`确定删除互动场景“${scene.title}”吗？帖子、评论和弹幕都会一并删除。`)) return;
            invalidate();
            await commit(() => deleteInteractiveScene(current().scope, sceneId));
            runtime.openSceneId = null;
            replaceApp(renderLauncher(current().scope));
            return;
        }
        if (action === 'back') {
            invalidate();
            const { scope } = current();
            runtime.openSceneId = null;
            replaceApp(renderLauncher(scope));
            return;
        }
        if (action === 'tab') { invalidate(); rerender(button.dataset.tab); return; }
        if (action === 'publish') {
            const input = document.getElementById('pm-scene-post-input');
            const content = input?.value.trim() || '';
            if (!content) throw new Error('帖子内容不能为空');
            await commit(() => appendPosts(current().scene, [{ author: deps.getUserPersona()?.name || '我', content, tags: [] }]));
            rerender('feed'); return;
        }
        if (action === 'ai-feed') { await generateFeed(); return; }
        if (action === 'comments') { await generateComments(button.dataset.postId); return; }
        if (action === 'post-comment') {
            const input = document.getElementById(`pm-comment-input-${button.dataset.postId}`);
            const content = input?.value.trim() || '';
            await commit(() => addSceneComment(
                current().scene, button.dataset.postId, deps.getUserPersona()?.name || '我', content,
            ));
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
            if (runtime.timer) { stopLive(); rerender('live'); } else await startLive();
            return;
        }
        if (action === 'send-danmaku') {
            const input = document.getElementById('pm-danmaku-input');
            const content = input?.value.trim() || '';
            if (!content) throw new Error('弹幕不能为空');
            await commit(() => appendDanmaku(current().scene, [{ author: '我', content }]));
            rerender('live'); return;
        }
        if (action === 'rhythm') await leadRhythm();
    }

    function bindOverlay(overlay) {
        overlay.addEventListener('click', event => {
            const button = event.target.closest('[data-action]');
            const app = document.getElementById('pm-scene-app');
            if (!button || !app || !app.contains(button)) return;
            handleAction(button, app).catch(error => {
                if (error.message !== '生成已取消') setStatus(error.message || '操作失败');
            });
        });
    }

    window.__pmOpenForumMode = async () => {
        invalidate();
        const scopeId = getStorageId();
        if (!scopeId || scopeId === 'sms_unknown__default') { alert('请先打开有效的角色聊天。'); return; }
        try {
            const store = await loadStore();
            const scope = getScope(store, scopeId);
            runtime.openSceneId = null;
            const overlay = makeOverlay(renderLauncher(scope), { onClose: invalidate });
            bindOverlay(overlay);
        } catch (error) {
            alert(`互动场景加载失败：${error.message}`);
        }
    };
    Object.assign(deps, {
        invalidateInteractiveStore() {
            invalidate();
            runtime.store = null;
            runtime.loadPromise = null;
            runtime.openSceneId = null;
        },
    });
}
