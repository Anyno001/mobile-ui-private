// 与 gal 前端（IGS）联动的运行时：读设置、听酒馆消息事件、把 IGS 解析出的帖子提交进社区、可选地续写一批。
// 单方面联动：总开关关着时不碰 window.IGS、不读楼层、不注册任何东西，和没有 IGS 时一样。
// 每次调用 IGS 都包在 try/catch 里；出错只记在设置页的「上次同步失败」，不弹窗、不影响 IGS。
import { generationErrorMessage } from './ai.js';
import { buildCommunityRequest, parseCommunityResponse } from './interactive-scene-ai.js';
import { appendScenePosts, setSceneHot } from './interactive-scene-model.js';
import { IGS_SYNC_PLATFORMS } from './interactive-scene-constants.js';
import {
    DEFAULT_IGS_LINK, IGS_LINK_STORAGE_KEY, applyIgsSync, entriesForFloor, igsRequestExtras, igsSyncHasWork, indexIgsFloors,
    normalizeIgsLinkConfig, resolveIgsFeeds,
} from './igs-feed-core.js';
import { shopEntriesForFloor } from './igs-shop-core.js';

const PARSE_CACHE_LIMIT = 400;
// 只有这几类事件会带来新内容；其余事件（如 MESSAGE_UPDATED）只做对账，不追加，避免把用户删掉的帖子又补回来。
const ADDING_EVENTS = Object.freeze(['MESSAGE_RECEIVED', 'MESSAGE_EDITED', 'MESSAGE_SWIPED']);

// 同步后的重绘：只在社区信息流开着这个社区时重绘（风格页、注入页、编辑页不打断）；社区列表开着时重绘列表。
export function igsRefreshers({ runtime, getStorageId, rerender, renderLauncher, refreshDesktop }) {
    return {
        refreshOpenScene(sceneId) {
            const feed = document.querySelector(`#pm-scene-app[data-scene-id] .pm-scene-feed`);
            if (!feed || runtime.openSceneId !== sceneId || (runtime.openSceneStorageId || getStorageId()) !== getStorageId()) return;
            rerender('feed', { preserveFeedScroll: true });
        },
        refreshLauncher() {
            if (document.querySelector('.pm-community-page .pm-scene-launcher')) renderLauncher(getStorageId());
        },
        refreshDesktop: () => refreshDesktop(),
    };
}

export function loadIgsLinkConfig(storage = globalThis.localStorage) {
    try { return normalizeIgsLinkConfig(JSON.parse(storage?.getItem(IGS_LINK_STORAGE_KEY) || 'null')); }
    catch { return normalizeIgsLinkConfig(null); }
}

export function saveIgsLinkConfig(config, storage = globalThis.localStorage) {
    try { storage.setItem(IGS_LINK_STORAGE_KEY, JSON.stringify(normalizeIgsLinkConfig(config))); return true; }
    catch { return false; }
}

// deps：getCtx、getStorageId、loadStore、getStore、commit、actorSeeds、contextText、callAI、uid、createEmptyScope、isGenerationBusy，
// 以及 igsRefreshers 给出的 refreshOpenScene / refreshLauncher / refreshDesktop。
export function installIgsFeedSync(deps, { globalObject = globalThis, storage = globalThis.localStorage } = {}) {
    let config = loadIgsLinkConfig(storage);
    const status = { api: '', lastSyncAt: 0, lastResult: '', lastError: '' };
    const parseCache = new Map();
    const seenFloors = new Map(); // storageId → Set<楼层原文哈希>：自动同步只给没处理过的楼追加，手动导入不受限
    const continuedFloors = new Set(); // 「同步后自动续写」：同一楼原文只续写一次
    let queue = Promise.resolve();
    let pending = null;
    let waitingForIgs = false;
    let continuing = null;

    const resolveFeeds = () => {
        const resolved = resolveIgsFeeds(globalObject);
        status.api = resolved.status;
        return resolved.feeds;
    };
    // IGS 还没启动：往 IGS_DLC 队列推一次回调，启动后补一次全量同步。只推一次。
    const waitForIgs = () => {
        if (waitingForIgs) return;
        waitingForIgs = true;
        try {
            const queueRef = globalObject.IGS_DLC || (globalObject.IGS_DLC = []);
            if (typeof queueRef?.push === 'function') queueRef.push(() => { if (config.enabled) schedule({ full: true }); });
        } catch { /* 拿不到队列就等下一次消息事件 */ }
    };
    const entriesOf = (feeds, floorInfo, userName) => {
        const cacheKey = `${floorInfo.hash}:${floorInfo.floor}:${userName}`;
        if (parseCache.has(cacheKey)) return parseCache.get(cacheKey);
        const entries = entriesForFloor(feeds, floorInfo, userName);
        if (parseCache.size >= PARSE_CACHE_LIMIT) parseCache.delete(parseCache.keys().next().value);
        parseCache.set(cacheKey, entries);
        return entries;
    };

    const shopCache = new Map();
    const shopEntriesOf = (feeds, floorInfo, userName) => {
        const cacheKey = `${floorInfo.hash}:${floorInfo.floor}:${userName}`;
        if (!shopCache.has(cacheKey)) {
            if (shopCache.size >= PARSE_CACHE_LIMIT) shopCache.delete(shopCache.keys().next().value);
            shopCache.set(cacheKey, shopEntriesForFloor(feeds, floorInfo, userName));
        }
        return shopCache.get(cacheKey);
    };
    const summarizeShop = result => [result.added && `桃宝上架 ${result.added} 件`, result.removed && `桃宝下架 ${result.removed} 件`, result.staled && `${result.staled} 件原文已变`].filter(Boolean).join('，');

    const summarize = result => {
        const parts = [];
        if (result.added) parts.push(`导入 ${result.added} 条`);
        if (result.removed) parts.push(`移除 ${result.removed} 条`);
        if (result.staled) parts.push(`${result.staled} 条原文已变`);
        if (result.skippedPlatforms.length) parts.push('社区已满，部分平台未建同步社区');
        return parts.join('，') || '没有新帖子';
    };

    // 一轮同步。plan：{ full }（手动导入或刚打开开关：全部楼层都追加）或 { floors:Set, adding }（自动：只给这些楼追加）。
    async function runPass(plan) {
        const storageId = deps.getStorageId();
        if (!storageId || storageId === 'sms_unknown__default') return null;
        const feeds = resolveFeeds();
        if (!feeds) { waitForIgs(); return null; }
        const chat = deps.getCtx()?.chat || [];
        const index = indexIgsFloors(chat);
        // IGS 按酒馆的用户名（name1）判断是不是玩家自己的手机。
        const userName = String(deps.getCtx()?.name1 || deps.actorSeeds(storageId).user.displayName || '');
        const seen = seenFloors.get(storageId) || new Set();
        const adding = plan.full ? index.floors
            : plan.adding ? index.floors.filter(info => plan.floors.has(info.floor) && !seen.has(info.hash)) : [];
        const entries = adding.flatMap(info => entriesOf(feeds, info, userName));
        // 淘宝帖子进桃宝（单独的存储），先于社区对账；桃宝写失败只记一条，不挡社区同步。
        let shopResult = null;
        if (typeof deps.syncShop === 'function') {
            try { shopResult = await deps.syncShop(storageId, { index, entries: adding.flatMap(info => shopEntriesOf(feeds, info, userName)) }); }
            catch (error) { status.lastError = `桃宝同步失败：${generationErrorMessage(error)}`; }
        }
        if (shopResult) { status.lastSyncAt = Date.now(); status.lastResult = summarizeShop(shopResult) || '没有新帖子'; }
        await deps.loadStore();
        const scope = deps.getStore()?.scopes?.[storageId];
        if (!(scope ? igsSyncHasWork(scope, index, entries) : entries.length)) {
            adding.forEach(info => seen.add(info.hash));
            seenFloors.set(storageId, seen);
            if (plan.full && !shopResult) { status.lastSyncAt = Date.now(); status.lastResult = '没有新帖子'; if (!status.lastError.startsWith('桃宝')) status.lastError = ''; }
            return null;
        }
        const seeds = deps.actorSeeds(storageId);
        let result = null;
        await deps.commit(() => {
            const store = deps.getStore();
            const target = store.scopes[storageId] || (store.scopes[storageId] = deps.createEmptyScope());
            result = applyIgsSync(target, { index, entries, scopeId: storageId, seeds: [seeds.story, seeds.user], createId: () => deps.uid('scene') });
        }, () => deps.getStorageId() === storageId, '同步正文社区帖子');
        adding.forEach(info => seen.add(info.hash));
        seenFloors.set(storageId, seen);
        status.lastSyncAt = Date.now();
        status.lastResult = [summarize(result), shopResult ? summarizeShop(shopResult) : ''].filter(Boolean).join('；');
        if (!status.lastError.startsWith('桃宝')) status.lastError = '';
        for (const sceneId of result.touchedSceneIds) deps.refreshOpenScene?.(sceneId);
        if (result.createdScenes.length || result.added) { deps.refreshLauncher?.(); deps.refreshDesktop?.(); }
        if (!plan.full && config.autoContinue) {
            for (const [sceneId, hashes] of result.addedByScene) {
                const fresh = hashes.map(hash => `${storageId}:${sceneId}:${hash}`).filter(key => !continuedFloors.has(key));
                if (!fresh.length) continue;
                fresh.forEach(key => continuedFloors.add(key));
                continueScene(storageId, sceneId);
            }
        }
        return result;
    }

    // 「同步后自动续写一批」：后台对该社区请求一次 feed_batch。和手动生成互斥：有生成任务在跑就跳过这一次。
    async function continueScene(storageId, sceneId) {
        if (continuing || deps.isGenerationBusy()) return;
        const controller = new AbortController();
        continuing = { storageId, controller };
        try {
            const scope = deps.getStore()?.scopes?.[storageId];
            const scene = scope?.scenes?.[sceneId];
            if (!scene) return;
            const roster = Object.values(scope.actors || {}).filter(actor => actor.type === 'story').map(actor => actor.displayName);
            const contextData = await deps.contextText(controller.signal);
            const prompts = buildCommunityRequest({
                kind: 'feed_batch', platform: scene.platform, nsfw: scene.nsfw === true, styleInput: scene.styleInput,
                generatedPrompt: scene.generatedPrompt, ...contextData, actorRoster: roster, ...igsRequestExtras(scene, true),
            });
            const raw = await deps.callAI(prompts.systemPrompt, prompts.userPrompt, { isolated: true, module: 'community', signal: controller.signal });
            const { items, meta } = parseCommunityResponse(raw, 'feed_batch', scene.platform);
            if (controller.signal.aborted || deps.getStorageId() !== storageId) return;
            await deps.commit(() => {
                const currentScope = deps.getStore().scopes[storageId];
                const current = currentScope?.scenes?.[sceneId];
                if (!current) throw new Error('生成已取消');
                const seeds = deps.actorSeeds(storageId);
                appendScenePosts(currentScope, storageId, current, items, [seeds.story, seeds.user]);
                if (current.platform === 'weibo' && meta?.hot) setSceneHot(current, meta.hot);
            }, () => deps.getStorageId() === storageId, '续写同步社区');
            deps.refreshOpenScene?.(sceneId);
        } catch (error) {
            if (!controller.signal.aborted && error?.message !== '生成已取消') status.lastError = `续写失败：${generationErrorMessage(error)}`;
        } finally {
            if (continuing?.controller === controller) continuing = null;
        }
    }

    // 同一批事件合并成一轮：在微任务里执行，读的是最终的 chat。返回这一轮跑完的 Promise（不会 reject）。
    function schedule(plan) {
        if (!pending) {
            let finish;
            const done = new Promise(resolve => { finish = resolve; });
            pending = { full: false, adding: false, floors: new Set(), done };
            Promise.resolve().then(() => {
                const next = pending;
                pending = null;
                queue = queue.then(() => runPass(next)).catch(error => {
                    status.lastError = `上次同步失败：${generationErrorMessage(error)}`;
                    return null;
                });
                queue.then(finish);
            });
        }
        if (plan.full) pending.full = true;
        if (plan.adding) pending.adding = true;
        for (const floor of plan.floors || []) pending.floors.add(floor);
        return pending.done;
    }

    // 宿主消息事件入口。eventKey 是 SillyTavern 的事件名键（如 MESSAGE_RECEIVED），messageId 是事件参数里的楼层号。
    function observe(eventKey, messageId) {
        if (!config.enabled || !config.autoSync) return;
        if (continuing && continuing.storageId !== deps.getStorageId()) continuing.controller.abort();
        const floor = Number(messageId);
        const adding = ADDING_EVENTS.includes(eventKey) && Number.isSafeInteger(floor) && floor >= 0;
        schedule(adding ? { adding: true, floors: [floor] } : {});
    }

    function setConfig(patch) {
        const previous = config;
        const next = normalizeIgsLinkConfig({ ...config, ...patch });
        // 总开关从关到开：「自动同步」跟着开，并把当前聊天已有的帖子导入一次。
        if (next.enabled && !previous.enabled) next.autoSync = true;
        if (!saveIgsLinkConfig(next, storage)) return false;
        config = next;
        if (!next.enabled) { continuing?.controller.abort(); status.api = ''; }
        if (next.enabled && !previous.enabled) schedule({ full: true });
        // 联动入口（社区列表的导入按钮）随总开关出现或消失。
        if (next.enabled !== previous.enabled) deps.refreshLauncher?.();
        return true;
    }

    // 手动「从正文导入」：扫描当前聊天全部楼层，包括已经处理过的楼。返回本轮结果（没有改动时为 null）。
    async function importNow() {
        if (!config.enabled) throw new Error('「与gal前端联动」未开启');
        if (!resolveFeeds()) throw new Error(status.api === 'outdated' ? 'IGS版本过旧，需要更新gal前端' : '未检测到IGS');
        status.lastError = '';
        await schedule({ full: true });
        if (status.lastError) throw new Error(status.lastError);
        return status.lastResult;
    }

    const getStatus = () => {
        if (config.enabled) resolveFeeds();
        return { config: { ...config }, ...status };
    };

    // 风格页「接收正文的 XX 帖子」开关：保存风格时写入；同平台只保留一个同步社区。
    function applyPromptForm(scope, scene, app) {
        const control = app?.querySelector?.('#pm-scene-igs-sync');
        if (!control || !IGS_SYNC_PLATFORMS.includes(scene?.platform)) return;
        if (control.getAttribute('aria-checked') !== 'true') { delete scene.igsSync; return; }
        for (const other of Object.values(scope.scenes || {})) {
            if (other !== scene && other.platform === scene.platform) delete other.igsSync;
        }
        scene.igsSync = true;
    }

    // 社区里与联动有关的按钮。处理了返回 true。
    async function handleAction(action, { setStatus }) {
        if (action !== 'igs-import') return false;
        setStatus('正在读取正文中的社区帖子…');
        try { setStatus(await importNow() || '没有新帖子'); }
        catch (error) { setStatus(generationErrorMessage(error)); }
        return true;
    }

    const viewState = () => ({ igs: { enabled: config.enabled } });
    const launcherState = () => ({ igsEnabled: config.enabled });
    const requestExtras = scene => igsRequestExtras(scene, config.enabled);

    return { observe, setConfig, getConfig: () => ({ ...config }), getStatus, importNow, applyPromptForm, handleAction, viewState, launcherState, requestExtras, defaults: DEFAULT_IGS_LINK };
}
