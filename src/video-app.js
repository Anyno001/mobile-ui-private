import { generationErrorMessage } from './ai.js';
import { buildCommunityRequest, parseCommunityResponse } from './interactive-scene-ai.js';
import { deriveInteractiveActorId } from './interactive-scene-model.js';
import { pickSlot } from './interactive-scene-respond.js';
import { VIDEO_TICK_MS, describeVideoCard, sceneIndexAt, visibleDanmaku } from './video-format.js';
import {
    addVideoComment, addVideoReply, appendVideoComments, appendVideoDanmaku, appendVideoReplies, applyVideoCreate, createVideo, deleteVideo,
    deleteVideoComment, deleteVideoDanmaku, deleteVideoReply, placeVideoComments, placeVideoReplies, toggleVideoCommentLike,
    updateVideo, updateVideoComment, updateVideoDanmaku, updateVideoReply,
} from './video-model.js';
import { renderVideoCompose, renderVideoFly, renderVideoHome, renderVideoScene, renderVideoWatch, videoTimeLabel } from './video-views.js';

const INVALID_SCOPE = 'sms_unknown__default';
const CANCELLED = '生成已取消';
const BUSY_TEXT = '上一条还在回应中';
const PLACEHOLDER_TITLE = '新视频';
const FRESH_MS = 1800;
const SEEK_HOLD_MS = 600;

const blankForm = () => ({ title: '', category: '', hostKey: 'user', hostName: '', idea: '', aiScenes: true, nsfw: false });
const isCancel = error => error?.message === CANCELLED || error?.name === 'AbortError';

// 视频分区控制器。bridge 与直播共用（运行时、提交队列、任务控制器）；host 由 live-app 提供页面与当前 scope。
// 视频内容的生成任务把视频 id 放在 roomId 位置上，与社区、直播共用同一把忙碌锁。
export function createVideoApp(deps, bridge, host) {
    const { runtime, communityTasks } = bridge;
    const st = {
        sub: 'home', videoId: '', tab: 'intro', sort: 'hot', descOpen: false, openThreads: [], editing: false, replyTo: null,
        time: 0, playing: false, form: null, composeEditing: false, status: '', draft: { comment: '', danmaku: '' }, flyKey: '',
    };
    let timer = null;
    let lastTick = 0;
    let seekAt = 0;
    let freshTimer = null;
    let renderedKey = '';

    const scopeId = () => host.getStorageId();
    const validScope = id => !!id && id !== INVALID_SCOPE;
    const scopeOf = () => host.scopeOf();
    const videoOf = () => (st.videoId ? scopeOf()?.videos?.[st.videoId] || null : null);
    const currentPageName = () => document.querySelector('#pm-iphone .pm-main-ui')?.dataset?.page;
    // 内容是否还没生成成功：看存储里的 pending，不再靠「没有弹幕和评论」推断；旧数据没有这个字段，视为已生成。
    const isPending = video => video.pending === true;
    const isBusy = () => {
        const task = communityTasks.state().task;
        return !!task && !!task.roomId && task.roomId === st.videoId && task.storageId === scopeId();
    };
    const isTargetActive = task => !!task && !!st.videoId && st.sub === 'watch' && task.storageId === scopeId()
        && task.roomId === st.videoId && currentPageName() === 'live';
    const commitGuard = () => {
        const epoch = runtime.contextEpoch;
        const storageId = scopeId();
        return () => runtime.contextEpoch === epoch && deps.getStorageId() === storageId;
    };
    const random = () => (typeof deps.randomSource === 'function' ? deps.randomSource() : Math.random());

    // ---- 选项与表单 ----
    const hostOptions = () => {
        const id = scopeId();
        const seeds = bridge.actorSeeds(id);
        const options = [{ key: 'user', label: seeds.user.displayName || '我', seed: seeds.user, name: seeds.user.displayName || '我', isUser: true }];
        const seen = new Set(['user']);
        const push = option => { if (!seen.has(option.key)) { seen.add(option.key); options.push(option); } };
        if (seeds.story?.displayName) {
            const actorId = deriveInteractiveActorId(id, 'story', seeds.story.bindingKey);
            push({ key: `actor:${actorId}`, label: seeds.story.displayName, seed: seeds.story, name: seeds.story.displayName });
        }
        for (const actor of Object.values(scopeOf()?.actors || {})) {
            if (actor.type === 'story') push({ key: `actor:${actor.actorId}`, label: actor.displayName, seed: actor, name: actor.displayName });
        }
        return options;
    };
    const labelledHosts = () => [...hostOptions().map(({ key, label }) => ({ key, label })), { key: 'other', label: '其他' }];
    const roster = () => {
        const story = bridge.actorSeeds(scopeId()).story.displayName;
        return [...Object.values(scopeOf()?.actors || {}).filter(actor => actor.type === 'story').map(actor => actor.displayName), story]
            .filter((name, index, names) => name && names.indexOf(name) === index);
    };

    // ---- 渲染 ----
    const uiOf = video => ({
        time: st.time, playing: st.playing, tab: st.tab, sort: st.sort, descOpen: st.descOpen, openThreads: st.openThreads,
        editing: st.editing, replyTo: st.replyTo, busy: isBusy(), pending: isPending(video), status: st.status, now: Date.now(),
    });
    const buildHtml = () => {
        const scope = scopeOf();
        if (!scope) return '';
        if (st.sub === 'compose') {
            return renderVideoCompose({ form: st.form || blankForm(), hosts: labelledHosts(), editing: st.composeEditing, status: st.status });
        }
        if (st.sub === 'watch') {
            const video = videoOf();
            return video ? renderVideoWatch({ video, ui: uiOf(video) }) : '';
        }
        const videos = (scope.videoOrder || []).slice().reverse().map(id => scope.videos[id]).filter(Boolean).map(video => describeVideoCard(video, isPending(video)));
        return renderVideoHome({ videos, status: st.status });
    };
    // 重绘会换掉整页 DOM：输入框草稿与滚动位置先存进状态、再放回去；同一页（同一视频同一分段）重绘保持滚动位置。
    const syncDrafts = page => {
        if (st.sub !== 'watch' || !page) return;
        const comment = page.querySelector('#pm-video-comment-input')?.value;
        const danmaku = page.querySelector('#pm-video-danmaku-input')?.value;
        if (typeof comment === 'string') st.draft.comment = comment;
        if (typeof danmaku === 'string') st.draft.danmaku = danmaku;
    };
    const scrollerOf = page => page?.querySelector?.(st.sub === 'watch' ? '.pm-video-body' : '.pm-live-scroll');
    const render = () => {
        const page = host.getPage();
        if (!page) return false;
        syncDrafts(page);
        const key = `${st.sub}:${st.videoId}:${st.tab}`;
        const scrollTop = key === renderedKey ? scrollerOf(page)?.scrollTop : 0;
        const html = buildHtml();
        if (!html) return false;
        page.innerHTML = html;
        renderedKey = key;
        const comment = page.querySelector('#pm-video-comment-input');
        if (comment && st.draft.comment) comment.value = st.draft.comment;
        const danmaku = page.querySelector('#pm-video-danmaku-input');
        if (danmaku && st.draft.danmaku) danmaku.value = st.draft.danmaku;
        const scroller = scrollerOf(page);
        if (scroller && Number.isFinite(scrollTop)) scroller.scrollTop = scrollTop;
        st.flyKey = '';
        return true;
    };
    const setStatus = text => { st.status = text || ''; render(); };

    // ---- 播放（计时器按 docs/LIFECYCLE-RESOURCES.md 登记：离开视频页、隐藏、关闭手机都会清除） ----
    const stopTimer = () => {
        if (timer !== null) { globalThis.clearInterval(timer); timer = null; }
    };
    const stopPlayback = () => {
        stopTimer();
        st.playing = false;
    };
    // 画面上随时间变化的部分只改局部节点，不重绘整页，输入框与滚动位置因此不受影响。
    const paint = ({ force = false } = {}) => {
        const page = host.getPage();
        const video = videoOf();
        if (!page || !video || st.sub !== 'watch') return;
        const time = Math.min(video.duration, Math.max(0, Math.floor(st.time)));
        const label = page.querySelector('#pm-video-time');
        if (label) label.textContent = videoTimeLabel(video, time);
        const seek = page.querySelector('#pm-video-seek');
        if (seek && Date.now() - seekAt > SEEK_HOLD_MS) seek.value = String(time);
        const scene = page.querySelector('.pm-video-scene');
        const index = sceneIndexAt(video.scenes, time);
        if (scene && (force || Number(scene.dataset?.sceneIndex) !== index)) scene.outerHTML = renderVideoScene(video, time);
        for (const [position, row] of Array.from(page.querySelectorAll?.('.pm-video-scene-row') || []).entries()) {
            row.classList?.toggle('is-active', position === index);
        }
        const flyKey = visibleDanmaku(video, time).map(entry => entry.item.id).join(',');
        const fly = page.querySelector('.pm-video-fly');
        if (fly && (force || flyKey !== st.flyKey)) { fly.innerHTML = renderVideoFly(video, time); st.flyKey = flyKey; }
    };
    const tick = () => {
        const video = videoOf();
        const hidden = globalThis.document?.visibilityState === 'hidden' || bridge.isPhoneIdle?.() === true;
        if (!video || st.sub !== 'watch' || currentPageName() !== 'live' || hidden || !host.getPage()) {
            const wasPlaying = st.playing;
            stopPlayback();
            // 停播后按钮图标与 aria-pressed 要跟着变，否则界面还显示「暂停」。
            if (wasPlaying && video && st.sub === 'watch' && host.getPage()) render();
            return;
        }
        const now = Date.now();
        st.time = Math.min(video.duration, st.time + Math.max(0, now - lastTick) / 1000);
        lastTick = now;
        if (st.time >= video.duration) { stopPlayback(); paint({ force: true }); render(); return; }
        paint();
    };
    const startPlayback = () => {
        const video = videoOf();
        if (!video || st.sub !== 'watch') return;
        if (st.time >= video.duration) st.time = 0;
        stopTimer();
        st.playing = true;
        lastTick = Date.now();
        timer = globalThis.setInterval(tick, VIDEO_TICK_MS);
    };
    const togglePlay = () => {
        if (st.playing) stopPlayback(); else startPlayback();
        render();
    };
    const seekTo = (value, { fromInput = false } = {}) => {
        const video = videoOf();
        if (!video) return;
        st.time = Math.min(video.duration, Math.max(0, Number(value) || 0));
        if (fromInput) seekAt = Date.now();
        lastTick = Date.now();
        paint({ force: true });
    };

    // ---- 请求与提交 ----
    const videoSnapshot = video => ({
        title: video.title, category: video.category, description: video.description, duration: video.duration, scenes: video.scenes,
        uploaderIsUser: video.uploaderIsUser, uploaderNameSnapshot: video.uploaderNameSnapshot,
    });
    // 一次生成：占任务锁 → 请求 → 解析 → 在提交队列里写入 → 释放。离开视频页会让任务失效，结果不写入。
    async function generate(kind, extra, apply, label) {
        const id = scopeId();
        const video = videoOf();
        const scope = scopeOf();
        if (!video || !scope || !validScope(id)) throw new Error('视频不存在');
        if (runtime.busy || runtime.communityTask) throw new Error('已有生成任务正在进行');
        const task = communityTasks.begin({ kind, storageId: id, roomId: video.id });
        if (!task) throw new Error('已有生成任务正在进行');
        if (!communityTasks.markGenerating(task)) { communityTasks.finish(task); throw new Error(CANCELLED); }
        const controller = new AbortController();
        runtime.busy = true;
        runtime.requestController = controller;
        const requestId = ++runtime.requestId;
        const isValid = commitGuard();
        let parsed;
        try {
            const context = await bridge.contextText(controller.signal);
            const prompts = buildCommunityRequest({
                kind, nsfw: video.nsfw === true, ...context, actorRoster: roster(), video: videoSnapshot(video),
                uploaderName: video.uploaderNameSnapshot, uploaderIsUser: video.uploaderIsUser, ...extra,
            });
            const raw = await deps.callAI(prompts.systemPrompt, prompts.userPrompt, { isolated: true, module: 'video', signal: controller.signal });
            if (requestId !== runtime.requestId || !communityTasks.isActive(task)) throw new Error(CANCELLED);
            parsed = parseCommunityResponse(raw, kind);
        } catch (error) {
            communityTasks.finish(task, isCancel(error) ? null : error);
            throw error;
        } finally {
            if (requestId === runtime.requestId) { runtime.requestController = null; runtime.busy = false; }
        }
        try {
            await bridge.commit(() => {
                const target = bridge.getScope(runtime.store, id);
                const stored = target.videos?.[video.id];
                if (!stored) throw new Error(CANCELLED);
                apply(target, stored, parsed);
            }, () => isValid() && communityTasks.isActive(task), label);
        } catch (error) {
            communityTasks.finish(task, isCancel(error) ? null : error);
            throw error;
        }
        communityTasks.finish(task);
        return parsed;
    }
    const seedsFor = () => { const seeds = bridge.actorSeeds(scopeId()); return [seeds.story, seeds.user]; };
    const userName = () => bridge.actorSeeds(scopeId()).user.displayName || '我';

    // 生成的内容里不能出现的作者名：用户本人；UP主是用户时再加上视频里存的UP主名（改过显示名也不会漏）。
    const skipNamesFor = video => [...new Set([userName(), video?.uploaderIsUser ? video.uploaderNameSnapshot : ''].filter(Boolean))];

    // 投稿后补齐内容：UP主是用户时标题简介以用户为准；用户没勾「让 AI 写分镜」时保留已有分镜。
    // 投稿时的选择存在 video.draft 里，失败后重试、刷新页面后重试都沿用；旧数据没有 draft 时按已有字段推断。
    async function generateCreate(videoId) {
        const video = scopeOf()?.videos?.[videoId];
        if (!video) return false;
        const draft = video.draft || { titleTyped: video.uploaderIsUser, categoryTyped: !!video.category, aiScenes: true };
        const keepScenes = draft.aiScenes === false;
        const id = scopeId();
        await generate('video_create', { aiScenes: !keepScenes, idea: video.description }, (scope, stored, parsed) => {
            const meta = { ...parsed.meta.video };
            if (draft.titleTyped) delete meta.title;
            if (draft.categoryTyped) delete meta.category;
            applyVideoCreate(scope, id, stored.id, { video: meta, danmaku: parsed.items, comments: parsed.meta.comments }, {
                keepUserText: stored.uploaderIsUser, keepScenes, skipNames: skipNamesFor(stored), actorSeeds: seedsFor(),
            });
        }, '生成视频内容');
        return true;
    }
    const withBusy = async run => {
        const pending = run();
        render();
        try { return await pending; } finally { render(); }
    };
    const surface = error => { if (!isCancel(error)) setStatus(generationErrorMessage(error)); };

    // ---- 用户发评论 / 回复 / 弹幕 ----
    const revealEntry = entryId => {
        const page = host.getPage();
        let target = null;
        for (const node of Array.from(page?.querySelectorAll?.('[data-entry-id]') || [])) {
            if (node.dataset?.entryId === entryId) { target = node; break; }
        }
        if (!target) return false;
        const reduced = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches === true;
        target.scrollIntoView?.({ block: 'center', behavior: reduced ? 'auto' : 'smooth' });
        target.classList?.add('is-fresh');
        if (freshTimer !== null) globalThis.clearTimeout(freshTimer);
        freshTimer = globalThis.setTimeout(() => { target.classList?.remove('is-fresh'); freshTimer = null; }, FRESH_MS);
        return true;
    };
    // 用户的评论已先存下；这里请求一批回应，把用户那条随机插进去、按新顺序重排时间，再滚到它并短暂高亮。
    async function respond({ kind, commentId, entryId, content, replyTo }) {
        // 先展开所属楼层：回应失败或占线时，用户刚发的回复也看得见。
        if (kind === 'reply' && !st.openThreads.includes(commentId)) st.openThreads.push(commentId);
        if (isBusy() || runtime.busy || runtime.communityTask) { setStatus(BUSY_TEXT); return false; }
        const video = videoOf();
        if (!video) return false;
        const name = userName();
        const skipNames = skipNamesFor(video);
        const id = scopeId();
        const comment = video.comments.find(item => item.id === commentId);
        const respondTo = { author: name, content, ...(replyTo ? { replyTo } : {}) };
        const extra = kind === 'reply'
            ? { respondTo, comment: { author: comment?.authorNameSnapshot, content: comment?.content, replies: (comment?.replies || []).map(reply => ({ author: reply.authorNameSnapshot, content: reply.content })) } }
            : { respondTo };
        try {
            const result = await withBusy(() => generate(kind === 'reply' ? 'video_replies' : 'video_comments', extra, (scope, stored, parsed) => {
                const options = { skipNames, actorSeeds: seedsFor() };
                const size = parsed.items.filter(item => !skipNames.includes(item.author)).length;
                const slot = pickSlot(size, random);
                if (kind === 'reply') placeVideoReplies(scope, id, stored, commentId, parsed.items, { ...options, userReplyId: entryId, slot });
                else placeVideoComments(scope, id, stored, parsed.items, { ...options, userCommentId: entryId, slot });
            }, '视频即时回应'));
            if (!result) return false;
            st.tab = 'comments';
            render();
            revealEntry(entryId);
            return true;
        } catch (error) {
            surface(error);
            return false;
        }
    }
    async function sendComment(page) {
        const input = page.querySelector('#pm-video-comment-input');
        const content = String(input?.value || st.draft.comment || '').trim().slice(0, 1000);
        const video = videoOf();
        if (!content || !video) return;
        const id = scopeId();
        const seeds = bridge.actorSeeds(id);
        const target = st.replyTo;
        let entryId = '';
        await bridge.commit(() => {
            const scope = bridge.getScope(runtime.store, id);
            const stored = scope.videos[video.id];
            entryId = target
                ? addVideoReply(scope, id, stored, target.commentId, seeds.user, content, target.name).id
                : addVideoComment(scope, id, stored, seeds.user, content).id;
        }, commitGuard(), target ? '发送回复' : '发送评论');
        st.draft.comment = '';
        if (input) input.value = '';
        const commentId = target?.commentId || entryId;
        st.replyTo = null;
        render();
        await respond({ kind: target ? 'reply' : 'comment', commentId, entryId, content, replyTo: target?.name || '' });
    }
    async function sendDanmaku(page) {
        const input = page.querySelector('#pm-video-danmaku-input');
        const content = String(input?.value || st.draft.danmaku || '').trim().slice(0, 60);
        const video = videoOf();
        if (!content || !video) return;
        const id = scopeId();
        const seeds = bridge.actorSeeds(id);
        const at = Math.floor(st.time);
        await bridge.commit(() => {
            const scope = bridge.getScope(runtime.store, id);
            appendVideoDanmaku(scope, id, scope.videos[video.id], [{ authorSeed: seeds.user, content, at }], [seeds.user]);
        }, commitGuard(), '发送弹幕');
        st.draft.danmaku = '';
        if (input) input.value = '';
        render();
    }

    // ---- 页面切换 ----
    const resetWatch = () => {
        st.tab = 'intro'; st.sort = 'hot'; st.descOpen = false; st.openThreads = []; st.editing = false; st.replyTo = null;
        st.time = 0; st.draft = { comment: '', danmaku: '' }; st.flyKey = '';
    };
    // 回到视频首页：停播、清掉视频页的临时状态；任务失效由调用方按场景决定。
    const leave = () => {
        stopPlayback(); resetWatch();
        st.sub = 'home'; st.videoId = ''; st.form = null; st.composeEditing = false; st.status = '';
    };
    const openVideo = videoId => {
        if (!scopeOf()?.videos?.[videoId]) throw new Error('视频不存在');
        stopPlayback(); resetWatch();
        st.sub = 'watch'; st.videoId = videoId; st.form = null; st.composeEditing = false;
    };
    const resume = sameScope => {
        stopPlayback();
        if (sameScope && st.sub === 'watch' && videoOf()) return;
        if (sameScope && st.sub === 'compose') { st.form = null; st.composeEditing = false; st.sub = videoOf() ? 'watch' : 'home'; if (st.sub === 'home') leave(); return; }
        leave();
    };

    // ---- 投稿表单 ----
    const syncForm = page => {
        if (st.sub !== 'compose' || !st.form || !page) return;
        const read = selector => page.querySelector(selector)?.value;
        const title = read('#pm-video-title');
        const idea = read('#pm-video-idea');
        const hostName = read('#pm-video-host-name');
        if (typeof title === 'string') st.form.title = title;
        if (typeof idea === 'string') st.form.idea = idea;
        if (typeof hostName === 'string') st.form.hostName = hostName;
    };
    const startCompose = video => {
        stopPlayback();
        st.sub = 'compose'; st.composeEditing = !!video;
        st.form = video
            ? { ...blankForm(), title: video.title, category: video.category, idea: video.description, nsfw: video.nsfw }
            : blankForm();
    };
    async function submitForm(page) {
        syncForm(page);
        const form = st.form;
        const title = form.title.trim();
        const id = scopeId();
        const category = form.category.trim();
        if (st.composeEditing) {
            if (!title) throw new Error('请填写视频标题');
            const videoId = st.videoId;
            await mutate((scope, video) => updateVideo(scope, video.id, { title, category, description: form.idea, nsfw: form.nsfw }), '保存视频', videoId);
            st.sub = 'watch'; st.form = null; st.composeEditing = false;
            render();
            return;
        }
        const byUser = form.hostKey === 'user';
        const option = hostOptions().find(item => item.key === form.hostKey);
        const otherName = form.hostName.trim();
        if (byUser && !title) throw new Error('请填写视频标题');
        if (form.hostKey === 'other' ? !otherName : !option) throw new Error(form.hostKey === 'other' ? '请填写UP主名字' : 'UP主角色不存在');
        let videoId = '';
        await bridge.commit(() => {
            const scope = bridge.getScope(runtime.store, id);
            videoId = createVideo(scope, id, {
                title: title || PLACEHOLDER_TITLE, uploaderIsUser: byUser, uploaderSeed: option?.seed, uploaderName: option ? option.name : otherName,
                category, description: form.idea, duration: 60, nsfw: form.nsfw,
                placeholder: byUser ? form.idea.trim() || title : '正在生成视频内容…',
                pending: true, draft: { titleTyped: !!title, categoryTyped: !!category, aiScenes: !(byUser && form.aiScenes === false) },
            }).id;
        }, commitGuard(), '投稿');
        openVideo(videoId);
        bridge.invalidate('video-opened');
        await withBusy(() => generateCreate(videoId)).catch(surface);
    }
    const mutate = async (change, label, videoId = st.videoId) => {
        const id = scopeId();
        await bridge.commit(() => {
            const scope = bridge.getScope(runtime.store, id);
            change(scope, scope.videos[videoId], id);
        }, commitGuard(), label);
    };

    // ---- 动作 ----
    const closeMenus = page => {
        for (const menu of Array.from(page?.querySelectorAll?.('.pm-live-menu') || [])) {
            if (menu.hidden) continue;
            menu.hidden = true;
            menu.parentElement?.querySelector?.('[data-video-action="menu"]')?.setAttribute('aria-expanded', 'false');
        }
    };
    const toggleMenu = (button, page) => {
        const menu = button.parentElement?.querySelector?.('.pm-live-menu');
        if (!menu) return;
        const opening = menu.hidden;
        closeMenus(page);
        menu.hidden = !opening;
        button.setAttribute('aria-expanded', String(opening));
        if (opening) menu.querySelector?.('button')?.focus?.({ preventScroll: true });
    };
    const toggleSwitch = (button, key) => {
        st.form[key] = st.form[key] !== true;
        button.classList?.toggle('is-on', st.form[key]);
        button.setAttribute('aria-checked', String(st.form[key]));
    };
    const segmentRange = video => {
        const index = sceneIndexAt(video.scenes, st.time);
        return { from: video.scenes[index].at, to: (video.scenes[index + 1]?.at ?? video.duration), scenes: [video.scenes[index]] };
    };
    const promptEdit = (label, current) => globalThis.window?.prompt?.(label, current) ?? null;
    const confirmed = message => globalThis.window?.confirm?.(message) === true;

    async function handle(action, button, page) {
        if (action !== 'menu') st.status = '';
        const data = button.dataset || {};
        if (action === 'compose') { startCompose(null); render(); return; }
        if (action === 'edit-video') { const video = videoOf(); if (video) { startCompose(video); render(); } return; }
        if (action === 'cancel-edit') { st.sub = 'watch'; st.form = null; st.composeEditing = false; render(); return; }
        if (action === 'home') { bridge.invalidate('video-left'); leave(); render(); return; }
        if (action === 'open-video') { bridge.invalidate('video-opened'); openVideo(data.videoId); render(); return; }
        if (action === 'toggle-play') { togglePlay(); return; }
        if (action === 'seek') { seekTo(data.at); render(); return; }
        if (action === 'tab') {
            st.tab = data.tab === 'comments' ? 'comments' : 'intro';
            st.replyTo = null;
            render();
            // 信息区占掉大半屏时，切分段后把标签栏滚到可视区顶部，内容才看得见。
            const body = page.querySelector('.pm-video-body');
            const tabs = page.querySelector('.pm-video-tabs');
            if (body && tabs) body.scrollTop = tabs.offsetTop;
            return;
        }
        if (action === 'sort') { st.sort = data.sort === 'latest' ? 'latest' : 'hot'; render(); return; }
        if (action === 'toggle-desc') { st.descOpen = !st.descOpen; render(); return; }
        if (action === 'toggle-thread') {
            st.openThreads = st.openThreads.includes(data.commentId) ? st.openThreads.filter(item => item !== data.commentId) : [...st.openThreads, data.commentId];
            render();
            return;
        }
        if (action === 'toggle-editing') { st.editing = !st.editing; render(); return; }
        if (action === 'menu') { toggleMenu(button, page); return; }
        if (action === 'like-comment') {
            await mutate((_scope, video) => toggleVideoCommentLike(video, data.commentId), '点赞评论');
            render();
            return;
        }
        if (action === 'reply') {
            const comment = videoOf()?.comments.find(item => item.id === data.commentId);
            if (!comment) return;
            st.replyTo = { commentId: comment.id, name: data.replyTo || comment.authorNameSnapshot };
            render();
            page.querySelector('#pm-video-comment-input')?.focus?.({ preventScroll: true });
            return;
        }
        if (action === 'cancel-reply') { st.replyTo = null; render(); return; }
        if (action === 'send-comment') { await sendComment(page); return; }
        if (action === 'send-danmaku') { await sendDanmaku(page); return; }
        if (action === 'poke-comments') { await pokeComments(); return; }
        if (action === 'poke-replies') { await pokeReplies(data.commentId); return; }
        if (action === 'poke-danmaku') { await pokeDanmaku(); return; }
        if (action === 'regenerate') {
            const video = videoOf();
            if (video) await withBusy(() => generateCreate(video.id)).catch(surface);
            return;
        }
        if (action === 'edit-comment' || action === 'edit-reply' || action === 'edit-danmaku') { await editEntry(action, data); return; }
        if (action === 'delete-comment' || action === 'delete-reply' || action === 'delete-danmaku') { await deleteEntry(action, data); return; }
        if (action === 'delete-video') { await removeVideo(); return; }
        if (action === 'pick-category') { syncForm(page); st.form.category = data.category || ''; render(); return; }
        if (action === 'pick-host') { syncForm(page); st.form.hostKey = data.host || 'user'; render(); return; }
        if (action === 'toggle-nsfw') { toggleSwitch(button, 'nsfw'); return; }
        if (action === 'toggle-ai-scenes') { toggleSwitch(button, 'aiScenes'); return; }
        if (action === 'submit') { await submitForm(page); }
    }

    async function pokeComments() {
        const id = scopeId();
        await withBusy(() => generate('video_comments', {}, (scope, stored, parsed) => {
            appendVideoComments(scope, id, stored, parsed.items, { skipNames: skipNamesFor(stored), actorSeeds: seedsFor() });
        }, '请求评论')).catch(surface);
    }
    async function pokeReplies(commentId) {
        const video = videoOf();
        const comment = video?.comments.find(item => item.id === commentId);
        if (!comment) return;
        const id = scopeId();
        const extra = { comment: { author: comment.authorNameSnapshot, content: comment.content, replies: comment.replies.map(reply => ({ author: reply.authorNameSnapshot, content: reply.content })) } };
        await withBusy(() => generate('video_replies', extra, (scope, stored, parsed) => {
            appendVideoReplies(scope, id, stored, commentId, parsed.items, { skipNames: skipNamesFor(stored), actorSeeds: seedsFor() });
        }, '请求回复')).catch(surface);
        if (!st.openThreads.includes(commentId)) st.openThreads.push(commentId);
        render();
    }
    async function pokeDanmaku() {
        const video = videoOf();
        if (!video) return;
        const segment = segmentRange(video);
        const id = scopeId();
        await withBusy(() => generate('video_danmaku', { segment }, (scope, stored, parsed) => {
            const skipNames = skipNamesFor(stored);
            const items = parsed.items.filter(item => !skipNames.includes(item.author)).map(item => ({ ...item, at: Math.min(segment.to, Math.max(segment.from, item.at)) }));
            appendVideoDanmaku(scope, id, stored, items, seedsFor());
        }, '补弹幕')).catch(surface);
        st.flyKey = '';
        paint({ force: true });
    }
    async function editEntry(action, data) {
        const video = videoOf();
        if (!video) return;
        const source = action === 'edit-danmaku' ? video.danmaku.find(item => item.id === data.danmakuId)
            : action === 'edit-comment' ? video.comments.find(item => item.id === data.commentId)
                : video.comments.find(item => item.id === data.commentId)?.replies.find(item => item.id === data.replyId);
        if (!source) throw new Error('内容不存在');
        const content = promptEdit('编辑内容', source.content);
        if (content === null) return;
        await mutate((_scope, stored) => {
            if (action === 'edit-danmaku') updateVideoDanmaku(stored, data.danmakuId, content);
            else if (action === 'edit-comment') updateVideoComment(stored, data.commentId, content);
            else updateVideoReply(stored, data.commentId, data.replyId, content);
        }, '编辑内容');
        render();
    }
    async function deleteEntry(action, data) {
        if (!confirmed('确定删除吗？')) return;
        await mutate((_scope, stored) => {
            if (action === 'delete-danmaku') deleteVideoDanmaku(stored, data.danmakuId);
            else if (action === 'delete-comment') deleteVideoComment(stored, data.commentId);
            else deleteVideoReply(stored, data.commentId, data.replyId);
        }, '删除内容');
        st.flyKey = '';
        render();
    }
    async function removeVideo() {
        const video = videoOf();
        if (!video || !confirmed(`确定删除视频“${video.title}”吗？弹幕和评论会一并删除。`)) return;
        bridge.invalidate('video-deleted');
        stopPlayback();
        const id = scopeId();
        const videoId = video.id;
        await bridge.commit(() => deleteVideo(bridge.getScope(runtime.store, id), videoId), commitGuard(), '删除视频');
        leave();
        render();
    }

    // ---- 事件（由 live-app 的页面监听转交；同一页面只挂一套监听） ----
    const run = (action, button, page) => Promise.resolve(handle(action, button, page)).catch(error => {
        if (!isCancel(error)) setStatus(generationErrorMessage(error));
    });
    function onClick(event, page) {
        const button = event.target?.closest?.('[data-video-action]');
        if (!button) { closeMenus(page); return undefined; }
        const action = button.dataset.videoAction;
        if (action !== 'menu') closeMenus(page);
        return run(action, button, page);
    }
    function onInput(event, page) {
        const target = event.target;
        if (target?.id === 'pm-video-seek') { seekTo(target.value, { fromInput: true }); return; }
        if (target?.id === 'pm-video-category-custom' && st.form) {
            st.form.category = String(target.value || '').trim().slice(0, 12);
            page?.querySelectorAll?.('.pm-live-chip[data-category]').forEach(chip => chip.setAttribute('aria-pressed', 'false'));
        }
    }
    function onKeyDown(event, page) {
        if (event.key === 'Escape') { closeMenus(page); return undefined; }
        if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return undefined;
        const id = event.target?.id;
        if (id !== 'pm-video-comment-input' && id !== 'pm-video-danmaku-input') return undefined;
        event.preventDefault();
        return run(id === 'pm-video-comment-input' ? 'send-comment' : 'send-danmaku', event.target, page);
    }

    return {
        state: st, render, leave, resume, stopPlayback, isTargetActive, isBusy, onClick, onInput, onKeyDown,
        isPlaying: () => timer !== null, openVideo, startCompose,
    };
}
