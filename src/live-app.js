import { generationErrorMessage } from './ai.js';
import { buildCommunityRequest, parseCommunityResponse } from './interactive-scene-ai.js';
import {
    appendLiveDanmaku, createLiveRoom, deleteLiveDanmaku, deleteLiveRoom, deriveInteractiveActorId, ensureInteractiveActor,
    updateLiveDanmaku, updateLiveRoom,
} from './interactive-scene-model.js';
import { createLiveGenerationRunner, runLiveWarmup } from './interactive-scene-scheduler.js';
import { describeLiveRoom, fitLiveFly, renderLiveCompose, renderLiveList, renderLiveRoom } from './live-views.js';
import { createVideoApp } from './video-app.js';
import { renderAppTabs } from './video-views.js';

const INVALID_SCOPE = 'sms_unknown__default';
const CANCELLED = '生成已取消';
const SCROLL_STICK_DISTANCE = 24;

const blankForm = () => ({ title: '', category: '', hostKey: 'user', hostName: '', hostSetting: '', nsfw: false, prefilled: '' });

// 直播 App 控制器。bridge 来自 interactive-scenes.js，提供共用的运行时、存储提交队列、任务控制器与取消入口，
// 这里不重写社区逻辑，只在同一把忙碌锁上挂直播间目标。
export function installLiveApp(deps, bridge) {
    const { runtime, communityTasks } = bridge;
    // page 'video' 表示「视频」分区（首页、视频页、投稿页由 video-app 管）；segment 记住当前停在哪个分区，默认视频。
    const view = { page: 'video', segment: 'video', storageId: '', roomId: '', editing: false, editingDanmaku: false, form: null, status: '', welcome: '' };
    const welcomed = new Set();
    let boundPage = null;

    const scopeIdOf = () => deps.getStorageId();
    const validScope = scopeId => !!scopeId && scopeId !== INVALID_SCOPE;
    const scopeOf = () => runtime.store?.scopes?.[view.storageId] || null;
    const roomOf = () => scopeOf()?.liveRooms?.[view.roomId] || null;
    const currentPageName = () => document.querySelector('#pm-iphone .pm-main-ui')?.dataset?.page;
    const getPage = () => deps.getPhoneWindow?.()?.querySelector?.('[data-phone-page="live"]') || null;
    const video = createVideoApp(deps, bridge, { getStorageId: () => view.storageId, scopeOf: () => scopeOf(), getPage: () => getPage() });
    const isBusy = () => {
        const task = communityTasks.state().task;
        return !!task && !!task.roomId && task.roomId === view.roomId && task.storageId === view.storageId;
    };
    const isTargetActive = task => (view.page === 'video' ? video.isTargetActive(task) : !!task && !!view.roomId && task.storageId === view.storageId
        && task.roomId === view.roomId && currentPageName() === 'live');

    // ---- 选项与表单 ----
    const hostOptions = (scopeId, scope, extraActorId = '') => {
        const seeds = bridge.actorSeeds(scopeId);
        const options = [{ key: 'user', label: seeds.user.displayName || '我', name: seeds.user.displayName || '我', profile: '' }];
        const seen = new Set(['user']);
        const push = option => {
            if (seen.has(option.key)) return;
            seen.add(option.key);
            options.push(option);
        };
        const storySeed = seeds.story;
        if (storySeed?.displayName) {
            const actorId = deriveInteractiveActorId(scopeId, 'story', storySeed.bindingKey);
            push({ key: `actor:${actorId}`, label: storySeed.displayName, name: storySeed.displayName, profile: storySeed.profile || '', seed: storySeed, actorId });
        }
        for (const actor of Object.values(scope?.actors || {})) {
            if (actor.type === 'story') push({ key: `actor:${actor.actorId}`, label: actor.displayName, name: actor.displayName, profile: actor.profile || '', actorId: actor.actorId });
        }
        const extra = extraActorId ? scope?.actors?.[extraActorId] : null;
        if (extra) push({ key: `actor:${extra.actorId}`, label: extra.displayName, name: extra.displayName, profile: extra.profile || '', actorId: extra.actorId });
        return options;
    };
    const labelledHosts = options => [...options.map(({ key, label }) => ({ key, label })), { key: 'other', label: '其他' }];

    const formFromRoom = (scopeId, scope, room) => {
        const options = hostOptions(scopeId, scope, room.hostActorId);
        const known = room.hostActorId && options.some(option => option.actorId === room.hostActorId);
        return {
            title: room.title, category: room.category || '', nsfw: room.nsfw === true,
            hostKey: room.hostIsUser ? 'user' : known ? `actor:${room.hostActorId}` : 'other',
            hostName: room.hostIsUser || known ? '' : room.hostNameSnapshot || '',
            hostSetting: room.hostSetting || '', prefilled: '',
        };
    };
    const newForm = (scopeId, scope) => {
        const form = blankForm();
        const firstStory = hostOptions(scopeId, scope).find(option => option.key.startsWith('actor:'));
        if (firstStory) { form.hostKey = firstStory.key; form.hostSetting = firstStory.profile; form.prefilled = firstStory.profile; }
        return form;
    };

    const syncForm = page => {
        if (view.page !== 'compose' || !view.form || !page) return;
        const read = selector => page.querySelector(selector)?.value;
        const title = read('#pm-live-title');
        const setting = read('#pm-live-host-setting');
        const hostName = read('#pm-live-host-name');
        if (typeof title === 'string') view.form.title = title;
        if (typeof setting === 'string') view.form.hostSetting = setting;
        if (typeof hostName === 'string') view.form.hostName = hostName;
    };

    // ---- 渲染 ----
    const buildHtml = () => {
        const scope = scopeOf();
        if (!scope) return '';
        if (view.page === 'compose') {
            return renderLiveCompose({ form: view.form || blankForm(), hosts: labelledHosts(hostOptions(view.storageId, scope, roomOf()?.hostActorId)), editing: view.editing, status: view.status });
        }
        if (view.page === 'room') {
            const room = roomOf();
            if (!room) return '';
            const danmaku = room.danmaku.map(item => ({ id: item.id, kind: item.kind || 'chat', author: item.authorNameSnapshot, content: item.content }));
            return renderLiveRoom({
                room: describeLiveRoom(scope, room), danmaku,
                ui: { editing: view.editingDanmaku, busy: isBusy(), welcome: view.welcome, status: view.status },
            });
        }
        const rooms = (scope.liveOrder || []).slice().reverse().map(roomId => scope.liveRooms[roomId]).filter(Boolean).map(room => describeLiveRoom(scope, room));
        return renderLiveList({ rooms, status: view.status, segments: renderAppTabs('live') });
    };

    // skipSync：表单刚被程序改过（换主播预填设定等），不能再用尚未重绘的旧输入框覆盖。
    const render = ({ forceBottom = false, skipSync = false } = {}) => {
        if (view.page === 'video') return video.render();
        const page = getPage();
        if (!page) return false;
        if (!skipSync) syncForm(page);
        const draft = page.querySelector('#pm-live-input')?.value ?? '';
        const chatBefore = page.querySelector('.pm-live-chat');
        const stick = forceBottom || !chatBefore
            || chatBefore.scrollHeight - chatBefore.scrollTop - chatBefore.clientHeight <= SCROLL_STICK_DISTANCE;
        const html = buildHtml();
        if (!html) return false;
        page.innerHTML = html;
        const input = page.querySelector('#pm-live-input');
        if (input && draft) input.value = draft;
        const chat = page.querySelector('.pm-live-chat');
        if (chat && stick) chat.scrollTop = chat.scrollHeight;
        fitLiveFly(page);
        return true;
    };
    const setStatus = text => { view.status = text || ''; render(); };

    // ---- 请求与提交 ----
    const roster = (scopeId, scope) => {
        const story = bridge.actorSeeds(scopeId).story.displayName;
        return [...Object.values(scope?.actors || {}).filter(actor => actor.type === 'story').map(actor => actor.displayName), story]
            .filter((name, index, names) => name && names.indexOf(name) === index);
    };
    async function requestDanmaku(target) {
        if (runtime.busy) throw new Error('已有生成任务正在进行');
        const scope = runtime.store?.scopes?.[target.storageId];
        const room = scope?.liveRooms?.[target.roomId];
        if (!room || !validScope(target.storageId)) throw new Error('直播间不存在');
        const controller = new AbortController();
        runtime.busy = true;
        runtime.requestController = controller;
        const requestId = ++runtime.requestId;
        try {
            const context = await bridge.contextText(controller.signal);
            const hostName = room.hostNameSnapshot || '';
            const prompts = buildCommunityRequest({
                kind: 'danmaku_batch', nsfw: room.nsfw === true, ...context, actorRoster: roster(target.storageId, scope),
                room: { title: room.title, category: room.category, hostName, hostSetting: room.hostSetting || '' },
                recentDanmaku: room.danmaku.slice(-20).map(item => ({ author: item.authorNameSnapshot, content: item.content, kind: item.kind })),
                hostIsUser: room.hostIsUser === true,
            });
            const raw = await deps.callAI(prompts.systemPrompt, prompts.userPrompt, { isolated: true, module: 'video', signal: controller.signal });
            if (requestId !== runtime.requestId) throw new Error(CANCELLED);
            return parseCommunityResponse(raw, 'danmaku_batch', undefined, { hostIsUser: room.hostIsUser === true }).items;
        } finally {
            if (requestId === runtime.requestId) {
                runtime.requestController = null;
                runtime.busy = false;
            }
        }
    }
    const runner = createLiveGenerationRunner({
        controller: communityTasks,
        getTarget: () => (view.roomId && view.storageId ? { storageId: view.storageId, roomId: view.roomId } : null),
        request: requestDanmaku,
        commitDanmaku: (target, items, isValid, onComplete) => bridge.commit(async () => {
            const scope = runtime.store?.scopes?.[target.storageId];
            const room = scope?.liveRooms?.[target.roomId];
            if (!room) throw new Error(CANCELLED);
            const seeds = bridge.actorSeeds(target.storageId);
            appendLiveDanmaku(scope, target.storageId, room, items, [seeds.story, seeds.user]);
            await onComplete?.();
        }, isValid),
        onRender: () => { render(); },
        onStatus: text => setStatus(text),
    });
    const commitGuard = () => {
        const epoch = runtime.contextEpoch;
        const storageId = view.storageId;
        return () => runtime.contextEpoch === epoch && scopeIdOf() === storageId;
    };
    const generate = options => runner.generateDanmaku(null, options);
    // 发起请求后立刻重绘，让舞台显示忙碌状态；结束（成功、失败或取消）后再重绘一次以撤掉忙碌状态。
    const generateWithBusy = async options => {
        const pending = generate(options);
        render();
        try { return await pending; } finally { render(); }
    };
    const ignoreCancelled = error => { if (error?.message !== CANCELLED) throw error; };

    // ---- 页面切换 ----
    const bind = page => {
        if (!page || boundPage === page) return;
        boundPage = page;
        page.addEventListener('click', onClick);
        page.addEventListener('input', onInput);
        page.addEventListener('keydown', onKeyDown);
    };
    const ensurePage = () => {
        const main = deps.getPhoneWindow?.()?.querySelector?.('.pm-main-ui');
        if (!main) return null;
        let page = main.querySelector('[data-phone-page="live"]');
        if (!page) {
            page = document.createElement('section');
            page.className = 'pm-phone-page pm-live-page';
            page.dataset.phonePage = 'live';
            page.hidden = true;
            main.appendChild(page);
        }
        bind(page);
        return page;
    };
    const enterRoom = roomId => {
        view.page = 'room'; view.roomId = roomId; view.editing = false; view.editingDanmaku = false; view.form = null; view.status = '';
        const key = `${view.storageId}:${roomId}`;
        view.welcome = '';
        if (!welcomed.has(key)) {
            welcomed.add(key);
            view.welcome = bridge.actorSeeds(view.storageId).user.displayName || '我';
        }
    };
    const toList = () => {
        view.page = view.segment === 'live' ? 'list' : 'video'; view.roomId = ''; view.editing = false; view.editingDanmaku = false; view.form = null; view.welcome = '';
    };

    async function show({ resume = false } = {}) {
        const scopeId = scopeIdOf();
        if (!validScope(scopeId)) { alert('请先打开有效的角色聊天。'); return false; }
        bridge.invalidate('live-opened');
        bridge.clearOpenScene();
        const store = await bridge.loadStore();
        const scope = store.scopes?.[scopeId] || bridge.getScope(store, scopeId);
        const page = ensurePage();
        if (!page) return false;
        const sameScope = view.storageId === scopeId;
        view.storageId = scopeId;
        view.status = '';
        const keepRoom = resume && sameScope && view.roomId && scope.liveRooms?.[view.roomId];
        if (keepRoom) {
            if (view.page === 'compose') { view.page = 'room'; view.editing = false; view.form = null; }
        } else if (resume && sameScope && view.page === 'video') video.resume(true);
        else { video.resume(false); toList(); }
        if (!render()) return false;
        if (!bridge.showPhonePage('live')) return false;
        fitLiveFly(page);
        bridge.updatePhoneUiScope(scopeId, { lastPage: 'live', lastSceneId: null });
        return true;
    }

    // ---- 动作 ----
    const hostFromForm = (scopeId, scope, form) => {
        const seeds = bridge.actorSeeds(scopeId);
        if (form.hostKey === 'user') return { hostIsUser: true, hostNameSnapshot: seeds.user.displayName || '我', profile: '' };
        if (form.hostKey === 'other') {
            const name = form.hostName.trim();
            if (!name) throw new Error('请填写主播名字');
            return { hostIsUser: false, hostNameSnapshot: name.slice(0, 80) };
        }
        const option = hostOptions(scopeId, scope, view.editing ? roomOf()?.hostActorId : '').find(item => item.key === form.hostKey);
        if (!option) throw new Error('主播角色不存在');
        return { hostIsUser: false, hostNameSnapshot: option.name, option };
    };

    async function submitForm(page) {
        syncForm(page);
        const form = view.form;
        const title = form.title.trim();
        if (!title) throw new Error('请填写直播标题');
        const scopeId = view.storageId;
        const host = hostFromForm(scopeId, scopeOf(), form);
        const isValid = commitGuard();
        const wasEditing = view.editing;
        let roomId = view.roomId;
        await bridge.commit(() => {
            const scope = bridge.getScope(runtime.store, scopeId);
            let hostActorId = '';
            if (host.option?.seed) hostActorId = ensureInteractiveActor(scope, scopeId, host.option.seed).actorId;
            else if (host.option?.actorId) hostActorId = host.option.actorId;
            const patch = {
                title, category: form.category.trim(), hostIsUser: host.hostIsUser, hostActorId,
                hostNameSnapshot: host.hostNameSnapshot, hostSetting: form.hostSetting.trim(), nsfw: form.nsfw === true,
            };
            roomId = wasEditing ? updateLiveRoom(scope, view.roomId, patch).id : createLiveRoom(scope, scopeId, patch).id;
        }, isValid, wasEditing ? '保存直播间' : '开播');
        enterRoom(roomId);
        render({ forceBottom: true });
    }

    async function sendMessage(page) {
        const input = page.querySelector('#pm-live-input');
        const content = String(input?.value || '').trim().slice(0, 200);
        const room = roomOf();
        if (!content || !room) return;
        const scopeId = view.storageId;
        const hostIsUser = room.hostIsUser === true;
        const seeds = bridge.actorSeeds(scopeId);
        const roomId = view.roomId;
        await bridge.commit(() => {
            const scope = bridge.getScope(runtime.store, scopeId);
            appendLiveDanmaku(scope, scopeId, scope.liveRooms[roomId], [{
                author: seeds.user.displayName, authorSeed: seeds.user, content, kind: hostIsUser ? 'host' : 'chat',
            }], [seeds.user]);
        }, commitGuard(), '发送弹幕');
        if (input) input.value = '';
        render({ forceBottom: true });
        if (!hostIsUser) return;
        // 主播是我：发送后自动请求一批观众弹幕。
        await generateWithBusy({ taskKind: 'host-danmaku' }).catch(error => { ignoreCancelled(error); });
    }

    async function warmup() {
        const room = roomOf();
        const scope = scopeOf();
        if (!room || !scope) return;
        const target = { storageId: view.storageId, roomId: view.roomId };
        const started = () => describeLiveRoom(scopeOf() || scope, scopeOf()?.liveRooms?.[target.roomId] || room).started;
        await runLiveWarmup({
            target, isStarted: started, isActive: () => !!runtime.communityTask, setStarted: () => {},
            generateDanmaku: (_task, options) => generate({ taskKind: options.taskKind }),
            render, isCurrent: () => view.roomId === target.roomId && view.storageId === target.storageId,
        }).catch(error => { ignoreCancelled(error); });
    }

    async function handle(action, button, page) {
        if (action !== 'menu') view.status = '';
        if (action === 'desktop') { video.leave(); await deps.showPhoneDesktopPage?.(); return; }
        if (action === 'segment') {
            const next = button.dataset.segment === 'live' ? 'live' : 'video';
            bridge.invalidate('segment-changed');
            video.leave();
            view.segment = next;
            toList();
            render();
            return;
        }
        if (action === 'list' || action === 'cancel-edit') {
            if (action === 'cancel-edit' && view.roomId) { view.page = 'room'; view.editing = false; view.form = null; render(); return; }
            bridge.invalidate('live-left-room');
            toList();
            render();
            return;
        }
        if (action === 'open-room') {
            const roomId = button.dataset.roomId;
            if (!scopeOf()?.liveRooms?.[roomId]) throw new Error('直播间不存在');
            bridge.invalidate('live-room-changed');
            enterRoom(roomId);
            render({ forceBottom: true });
            return;
        }
        if (action === 'compose') {
            view.page = 'compose'; view.editing = false; view.roomId = ''; view.form = newForm(view.storageId, scopeOf());
            render();
            return;
        }
        if (action === 'edit-room') {
            const room = roomOf();
            if (!room) return;
            view.page = 'compose'; view.editing = true; view.form = formFromRoom(view.storageId, scopeOf(), room);
            render();
            return;
        }
        if (action === 'pick-category') { syncForm(page); view.form.category = button.dataset.category || ''; render(); return; }
        if (action === 'pick-host') {
            syncForm(page);
            const form = view.form;
            const option = hostOptions(view.storageId, scopeOf(), roomOf()?.hostActorId).find(item => item.key === button.dataset.host);
            form.hostKey = button.dataset.host || 'user';
            // 设定框为空或仍是上一个角色的预填内容时，换成新角色的设定；否则保留用户已写的内容。
            if (!form.hostSetting.trim() || form.hostSetting === form.prefilled) {
                form.hostSetting = option?.profile || '';
                form.prefilled = form.hostSetting;
            }
            render({ skipSync: true });
            return;
        }
        if (action === 'toggle-nsfw') {
            view.form.nsfw = view.form.nsfw !== true;
            button.classList?.toggle('is-on', view.form.nsfw);
            button.setAttribute('aria-checked', String(view.form.nsfw));
            return;
        }
        if (action === 'submit') { await submitForm(page); return; }
        if (action === 'delete-room') {
            const room = roomOf();
            if (!room || !window.confirm(`确定删除直播间“${room.title}”吗？弹幕会一并删除。`)) return;
            bridge.invalidate('live-room-deleted');
            const roomId = view.roomId;
            await bridge.commit(() => deleteLiveRoom(bridge.getScope(runtime.store, view.storageId), roomId), commitGuard(), '删除直播间');
            toList();
            render();
            return;
        }
        if (action === 'menu') {
            const menu = button.parentElement?.querySelector?.('.pm-live-menu');
            if (!menu) return;
            const opening = menu.hidden;
            menu.hidden = !opening;
            button.setAttribute('aria-expanded', String(opening));
            if (opening) menu.querySelector?.('button')?.focus?.({ preventScroll: true });
            return;
        }
        if (action === 'toggle-edit-danmaku') { view.editingDanmaku = !view.editingDanmaku; render(); return; }
        if (action === 'edit-danmaku') {
            const item = roomOf()?.danmaku.find(entry => entry.id === button.dataset.danmakuId);
            if (!item) throw new Error('弹幕不存在');
            const content = window.prompt('编辑弹幕内容', item.content);
            if (content === null) return;
            await bridge.commit(() => updateLiveDanmaku(bridge.getScope(runtime.store, view.storageId).liveRooms[view.roomId], button.dataset.danmakuId, content), commitGuard(), '编辑弹幕');
            render();
            return;
        }
        if (action === 'delete-danmaku') {
            if (!window.confirm('确定删除这条弹幕吗？')) return;
            await bridge.commit(() => deleteLiveDanmaku(bridge.getScope(runtime.store, view.storageId).liveRooms[view.roomId], button.dataset.danmakuId), commitGuard(), '删除弹幕');
            render();
            return;
        }
        if (action === 'send') { await sendMessage(page); return; }
        if (action === 'poke') {
            await generateWithBusy({ taskKind: 'manual-danmaku' }).catch(error => { ignoreCancelled(error); });
            return;
        }
        if (action === 'warmup') { await warmup(); }
    }

    const closeMenu = page => {
        const menu = page?.querySelector?.('.pm-live-menu');
        if (!menu || menu.hidden) return;
        menu.hidden = true;
        menu.parentElement?.querySelector?.('[data-live-action="menu"]')?.setAttribute('aria-expanded', 'false');
    };
    const run = (action, button, page) => Promise.resolve(handle(action, button, page)).catch(error => {
        if (error?.message === CANCELLED) return;
        setStatus(generationErrorMessage(error));
    });
    function onClick(event) {
        const page = boundPage;
        const button = event.target?.closest?.('[data-live-action]');
        if (!button) {
            if (view.page === 'video') return video.onClick(event, page);
            closeMenu(page);
            return;
        }
        const action = button.dataset.liveAction;
        if (action !== 'menu') closeMenu(page);
        return run(action, button, page);
    }
    function onInput(event) {
        if (view.page === 'video') { video.onInput(event, boundPage); return; }
        // 自定义分区：输入时取消预设胶囊的选中，分区以输入内容为准。
        if (event.target?.id !== 'pm-live-category-custom' || !view.form) return;
        view.form.category = String(event.target.value || '').trim().slice(0, 12);
        boundPage?.querySelectorAll?.('.pm-live-chip[data-category]').forEach(chipButton => chipButton.setAttribute('aria-pressed', 'false'));
    }
    function onKeyDown(event) {
        if (view.page === 'video') return video.onKeyDown(event, boundPage);
        if (event.key === 'Escape') { closeMenu(boundPage); return; }
        if (event.key !== 'Enter' || event.shiftKey || event.isComposing || event.target?.id !== 'pm-live-input') return;
        event.preventDefault();
        return run('send', event.target, boundPage);
    }

    window.__pmOpenLiveApp = () => show();
    // 与 gal 前端联动同步直播间后：直播页开着（列表或直播间，不含视频分区）就重绘，保留输入框草稿与滚动贴底。
    const refreshFromIgs = () => {
        const page = getPage();
        if (!page || page.hidden || view.page === 'video') return false;
        return render();
    };
    Object.assign(deps, { showLivePage: show, refreshLiveFromIgs: refreshFromIgs });
    return { show, isTargetActive, view };
}
