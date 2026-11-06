// 参照 PlotInjector v0.1.24 src/app/runtime.js。与独立版的差别：
// 1. 模型请求、文件、通知、世界书都经宿主层（plot-host.js），走天音的 callAI 与 API 按模块分配；
// 2. 同一页面有独立版剧情注入器时（host.standalone()），所有事件处理直接返回，由独立版注入和检测，避免一轮注入两次；
// 3. 天音自己的后台请求期间（host.isBackground()）不注入，与金手指一致。
import { buildCheckMessages, cleanFloorText, parseCheckReply } from './core/check.js';
import { buildEntries, buildIndexText, carriedNodes, toWorldInfoEntry } from './core/inject.js';
import { parseOutlineReply, rewriteRestMessages, syncSettingMessages } from './core/prompts.js';
import { changedBlockKeys, mergeBlocks, parseSettingReply, pushHistory, splitBlocks } from './core/setting.js';
import { BUILTIN_GUIDE } from './core/guide.js';
import { flattenUnits, pushOutlineHistory, replaceRest, stageLabel, stageNodes, volumeLabel } from './core/outline.js';
import { advance, checkBase, currentIndex, emptyProgress, goTo, isMuted, mute, patchSlot, uncheckByNames, unitStates } from './core/progress.js';
import { alignProgress, outlineLinks } from './core/align.js';
import { addPlayerThread, applyCheck, checkThreads, clampThreads, hasNodeNamed, ignoreThread, isThreadNode, liveThreads, maskUnits, threadState, threadSwitches } from './core/threads.js';
import { emptyInfinite } from './core/infinite-flow.js';
import { createInfiniteRuntime, isInfiniteProject } from './plot-infinite-runtime.js';
import { createProgressStore } from './plot-progress-store.js';

export const VIRTUAL_WORLD = '剧情注入器';

const LOG_MAX = 40;
// 主回复没结束时先挂起检测，最多等这么久。
const PENDING_MAX_MS = 30000;
// 检测请求失败后自动重试的次数与间隔，全部失败才弹提示。
const CHECK_RETRIES = 3;
const RETRY_GAP_MS = 2000;
const FALLBACK_DELAY_MS = 1000;

const placeOf = unit => `${volumeLabel(unit.volume.key)}·${stageLabel(unit.stage.key)}`;

// 运行时：注入、每 N 楼检测、偏离大纲时提醒或自动改写。手机关着也在跑。
// askReason 由界面传入（弹输入框）；没有界面时直接用检测给的偏离原因。
export function createPlotRuntime({ host, data, notice, emit = () => {}, askReason = async reason => reason }) {
    const { ctx, cardKey, cardName, chatMessages, toast } = host;
    const store = createProgressStore(ctx);
    let progress = null;
    let progressFor = '';
    // 最近一次按大纲对照表归位时的输入（进度对象、大纲对象），两者都没变就不再算。
    let alignedFrom = null;
    let alignedOutline = null;
    let checking = false;
    let fallbackTimer = 0;
    let generating = false;
    let chatStartFloors = 0;
    let pendingCheck = false;
    let pendingTimer = 0;
    const listeners = [];
    const stats = {};
    const logs = [];

    function log(text) {
        logs.push({ at: Date.now(), text });
        if (logs.length > LOG_MAX) logs.shift();
    }

    const yielded = () => Boolean(host.standalone());
    const infinite = createInfiniteRuntime({ host, notice, emit, log, toast, yielded, activeProject, currentProgress, setProgress });

    // 聊天自己记的项目优先，没有（或项目已删）再用本卡默认。
    function chatBoundId() {
        const id = store.readChatState().projectId;
        return id && data.index().projects.some(item => item.id === id) ? id : '';
    }

    function activeId() {
        return chatBoundId() || data.activeIdFor(cardKey());
    }

    function activeProject() {
        const id = activeId();
        return id ? data.project(id) : null;
    }

    function currentProgress() {
        const id = activeId();
        if (!id) return null;
        if (!progress || progressFor !== id) {
            progress = store.readProgress(id);
            progressFor = id;
        }
        const project = data.project(id);
        if (project && project.mode === 'infinite' && !progress.infinite) {
            progress = { ...progress, infinite: emptyInfinite() };
            store.writeProgress(progress);
        }
        // 大纲在别的聊天里改过（改名、挪动、合并、恢复历史）：按项目里的对照表把本聊天的进度对回当前大纲，有变化就写回。
        if (project && !isInfinite(project) && (progress !== alignedFrom || project.outline !== alignedOutline)) {
            const aligned = alignProgress(progress, project.outline);
            if (aligned !== progress) {
                progress = aligned;
                store.writeProgress(progress);
                log('按大纲对照表归位了本聊天的进度');
            }
            alignedFrom = progress;
            alignedOutline = project.outline;
        }
        return progress;
    }

    function links() {
        const project = activeProject();
        return project ? outlineLinks(project.outline) : undefined;
    }

    const isInfinite = isInfiniteProject;

    function units() {
        const project = activeProject();
        return project ? flattenUnits(project.outline.volumes) : [];
    }

    // 进行中阶段换了：在新阶段的槽位记下楼数，没写条件的支线钩子从这里开始计时。
    function stampActive(prev, next) {
        if (!next || next.infinite) return next;
        const list = units();
        if (!list.length) return next;
        const activeOf = prog => {
            const states = unitStates(list, prog);
            const found = list.find(unit => states[unit.id] === 'active');
            return found ? found.id : '';
        };
        const now = activeOf(next);
        if (!now) return next;
        const changed = !prev || prev.projectId !== next.projectId || activeOf(prev) !== now;
        const slot = next.slots[now] || {};
        if (!changed && slot.since) return next;
        if (!prev && slot.since) return next;
        return patchSlot(next, now, { since: floorCount() });
    }

    function setProgress(next, reason = 'progress') {
        next = stampActive(progress && progressFor === next.projectId ? progress : null, next);
        progress = next;
        progressFor = next.projectId;
        store.writeProgress(next);
        scheduleFallback();
        emit(reason);
    }

    function entries() {
        const project = activeProject();
        const prog = currentProgress();
        return project && prog ? buildEntries(project, prog, data.settings()) : [];
    }

    function virtualEntries() {
        return entries().filter(entry => entry.enabled && entry.content).map((entry, index) => toWorldInfoEntry(entry, index, VIRTUAL_WORLD));
    }

    function eventTypes() {
        const c = ctx();
        return (c && c.eventTypes) || {};
    }

    function hasEntriesEvent() {
        return Boolean(eventTypes().WORLDINFO_ENTRIES_LOADED);
    }

    async function onEntriesLoaded(payload) {
        if (yielded() || !payload || !Array.isArray(payload.chatLore)) return;
        // 先等档案再看后台标记：造世界的请求本身在后台计数里，用户此时发下一条，不先等就会跳过注入。
        if (infinite.isOpening()) await infinite.waitOpening();
        if (host.isBackground()) return;
        try {
            payload.chatLore.push(...virtualEntries());
        } catch (error) {
            console.error('[剧情注入器] 注入失败', error);
        }
    }

    // 回退方案：没有条目加载事件的旧酒馆，把同样的条目写进专用世界书。
    function scheduleFallback() {
        if (hasEntriesEvent() || yielded()) return;
        clearTimeout(fallbackTimer);
        fallbackTimer = setTimeout(async () => {
            fallbackTimer = 0;
            const name = `剧情注入器·${cardName() || '未命名'}`;
            try {
                const result = await host.writeFallbackBook(name, virtualEntries());
                if (result.conflict) toast('warning', `聊天已绑定世界书「${result.conflict}」，剧情注入器的条目写在「${name}」，需要手动启用。`);
            } catch (error) {
                toast('error', `写入专用世界书失败：${error.message}`);
            }
        }, FALLBACK_DELAY_MS);
    }

    // 隐藏楼（/hide、记忆类插件）也是 is_system，楼数直接取聊天长度。
    const isNote = msg => !msg || (msg.is_system && msg.extra && msg.extra.type);

    function floorCount() {
        return chatMessages().length;
    }

    function activeUnit() {
        const list = units();
        const prog = currentProgress();
        if (!list.length || !prog) return null;
        const states = unitStates(list, prog);
        return list.find(unit => states[unit.id] === 'active') || list[currentIndex(list, prog)];
    }

    function openNext({ silent = false } = {}) {
        const prog = currentProgress();
        const step = prog && advance(prog, units());
        if (!step) {
            if (!silent) toast('info', '已经是最后一段。');
            return null;
        }
        setProgress(step.progress);
        notice.hide('advance');
        return step;
    }

    function backTo(unitId) {
        const prog = currentProgress();
        if (!prog) return;
        setProgress(goTo(prog, units(), unitId));
    }

    function proposeAdvance({ unit, reason = '' }) {
        const settings = data.settings();
        const prog = currentProgress();
        if (!prog || isMuted(prog, unit.id)) return;
        if (settings.handleMode === 'nodes') return;
        const step = advance(prog, units());
        if (!step) return;
        if (settings.handleMode === 'auto') {
            setProgress(step.progress);
            notice.show({
                id: 'advance',
                title: `已切到 ${placeOf(step.to)}`,
                body: reason || '检测判断本阶段已演完。',
                actions: [{ label: '撤销', run: () => backTo(unit.id) }],
                timeout: 12000,
            });
            return;
        }
        notice.show({
            id: 'advance',
            title: `${placeOf(unit)} 已演完`,
            body: reason || '检测判断本阶段已演完。',
            actions: [
                { label: '打开下一段', primary: true, run: () => openNext() },
                { label: '暂不', run: () => notice.hide('advance') },
                { label: '本阶段不再提醒', run: () => setProgress(mute(currentProgress(), unit.id)) },
            ],
        });
    }

    // 大纲改了以后按大纲校对设定：只替换有改动的分块，旧版进历史版本。返回改动的分块标题，没改返回空数组。
    async function syncSetting(projectId, { from = 0, reason = '' } = {}) {
        const project = data.project(projectId);
        const text = project && project.setting.text.trim();
        if (!text) return [];
        const list = flattenUnits(project.outline.volumes);
        const guide = String(data.settings().guide || '').trim() || BUILTIN_GUIDE;
        const reply = await host.generate('outline', syncSettingMessages({ guide, setting: text, units: list, fromUnitIndex: from, reason }));
        const body = parseSettingReply(reply).body;
        const keys = body ? changedBlockKeys(text, body) : [];
        if (!keys.length) return [];
        const next = mergeBlocks(text, body, keys);
        data.updateProject(projectId, current => ({ ...current, setting: { ...current.setting, text: next, history: pushHistory(pushHistory(current.setting.history, current.setting.text), next) } }));
        const titles = new Map(splitBlocks(text).map(block => [block.key, block.title]));
        return keys.map(key => titles.get(key) || key);
    }

    // 按最近正文改写当前段及之后的阶段，直接替换并把进度移到改写后的第一段；返回撤销用的快照。
    async function rewriteRest(reason) {
        const project = activeProject();
        const prog = currentProgress();
        const unit = activeUnit();
        if (!project || !prog || !unit) throw new Error('当前聊天没有启用的项目');
        const list = units();
        const from = list.findIndex(item => item.id === unit.id);
        const recent = recentFloors(6).map(floor => floor.text).join('\n\n');
        const reply = await host.generate('outline', rewriteRestMessages({ setting: project.setting.text, volumes: project.outline.volumes, fromUnitIndex: from, units: list, recent, reason }));
        const parsed = parseOutlineReply(reply);
        if (!parsed.ok) throw new Error(`改写结果格式有误：${parsed.error}`);
        const before = { volumes: project.outline.volumes, progress: prog, setting: project.setting.text };
        const volumes = replaceRest(project.outline.volumes, unit.stage.id, parsed.volumes);
        data.updateProject(project.id, current => ({ ...current, outline: { ...current.outline, volumes, history: pushOutlineHistory(current.outline.history, current.outline.volumes, '偏离改写') } }));
        const first = parsed.volumes[0] && parsed.volumes[0].stages[0];
        if (first) setProgress(goTo(currentProgress(), flattenUnits(volumes), first.id));
        return before;
    }

    function undoRewrite(projectId, before) {
        data.updateProject(projectId, current => ({
            ...current,
            outline: { ...current.outline, volumes: before.volumes },
            setting: { ...current.setting, text: before.setting, history: pushHistory(current.setting.history, before.setting) },
        }));
        setProgress(before.progress);
        toast('info', '已撤销改写，恢复原来的大纲、设定和进度。');
    }

    async function runRewrite(reason, { auto = false } = {}) {
        const projectId = activeId();
        notice.show({ id: 'offtrack', title: '正在改写后续阶段…', body: reason });
        try {
            const before = await rewriteRest(reason);
            let synced = '';
            try {
                notice.show({ id: 'offtrack', title: '正在按新大纲校对设定…', body: reason });
                const titles = await syncSetting(projectId, { from: currentIndex(units(), currentProgress()), reason });
                synced = titles.length ? `\n设定已同步修改：${titles.join('、')}。` : '';
            } catch (error) {
                synced = `\n设定校对失败：${error.message}`;
            }
            notice.show({
                id: 'offtrack',
                title: auto ? '剧情偏离大纲，已自动改写后续阶段' : '已改写后续阶段',
                body: `${reason}${synced}`,
                actions: [{ label: '撤销', run: () => undoRewrite(projectId, before) }],
                timeout: 20000,
            });
        } catch (error) {
            notice.hide('offtrack');
            toast('error', `改写失败：${error.message}`);
        }
    }

    function handleOffTrack(unit, reason) {
        notice.hide('advance');
        if (data.settings().offTrackMode === 'auto') {
            runRewrite(reason, { auto: true });
            return;
        }
        notice.show({
            id: 'offtrack',
            title: `${placeOf(unit)} 偏离大纲`,
            body: `${reason || '正文走向与后续阶段冲突。'}后续阶段可能接不上，建议改写。`,
            actions: [
                { label: '改写后续阶段', primary: true, run: async () => {
                    const note = await askReason(reason);
                    if (note != null) runRewrite(String(note).trim() || reason);
                } },
                { label: '暂不', run: () => notice.hide('offtrack') },
                { label: '本阶段不再提醒', run: () => {
                    const prog = currentProgress();
                    if (prog && !prog.offMuted.includes(unit.id)) setProgress({ ...prog, offMuted: [...prog.offMuted, unit.id] });
                } },
            ],
        });
    }

    function threadEventText(event) {
        const map = {
            'clock-tick': `进度钟「${event.name}」推进到 ${event.filled}/${event.total}`,
            'clock-due': `进度钟「${event.name}」已满格，本段必须发生`,
            'clock-done': `世界动态「${event.name}」已发生`,
            'hook-on': `支线「${event.name}」条件满足，已激活`,
            'chain-step': `支线链「${event.name}」进入第 ${event.step + 1}/${event.total} 步`,
            'hook-done': `支线「${event.name}」已演完`,
            'hook-expired': `支线「${event.name}」超过时限，已过期`,
        };
        return map[event.type] || event.type;
    }

    // 玩家自开的线收录为当前阶段的支线；有大纲历史时先入栈。
    function adoptThread(projectId, stageId, thread) {
        data.updateProject(projectId, current => ({
            ...current,
            outline: {
                ...current.outline,
                volumes: addPlayerThread(current.outline.volumes, stageId, thread),
                history: pushOutlineHistory(current.outline.history, current.outline.volumes, '收录支线'),
            },
        }));
        log(`收录玩家自开的线「${thread.name}」为支线`);
        scheduleFallback();
        emit('progress');
    }

    // 检测发现正文开了大纲外的新线：按设置弹提示卡询问、自动收录或不处理。
    function offerThread(unit, thread) {
        const settings = data.settings();
        const project = activeProject();
        const prog = currentProgress();
        if (settings.newThreadMode === 'off' || !project || !prog || !threadSwitches(project).sideOn) return;
        if (threadState(prog).ignored.includes(thread.name) || hasNodeNamed(units(), thread.name)) return;
        if (settings.newThreadMode === 'auto') {
            adoptThread(project.id, unit.stage.id, thread);
            notice.show({ id: 'thread', title: `已收录支线「${thread.name}」`, body: thread.summary, timeout: 10000 });
            return;
        }
        notice.show({
            id: 'thread',
            title: `正文开了一条新线「${thread.name}」`,
            body: thread.summary || '大纲里没有这条线。',
            actions: [
                { label: '收录为支线', primary: true, run: () => adoptThread(project.id, unit.stage.id, thread) },
                { label: '忽略', run: () => setProgress(ignoreThread(currentProgress(), thread.name)) },
            ],
        });
    }

    function recentFloors(count) {
        const out = [];
        const chat = chatMessages();
        for (let i = chat.length - 1; i >= 0 && out.length < count; i -= 1) {
            const msg = chat[i];
            if (isNote(msg)) continue;
            const text = cleanFloorText(msg.mes);
            if (text) out.unshift({ index: i, text: `${msg.is_user ? '（用户）' : ''}${text}` });
        }
        return out;
    }

    async function checkNow({ manual = false } = {}) {
        if (yielded()) {
            if (manual) toast('info', '独立版剧情注入器正在接管本聊天，请在独立版里检测。');
            return null;
        }
        if (isInfinite(activeProject())) {
            log('无限流项目不使用检测模型');
            if (manual) toast('info', '无限流项目由正文状态块触发，不使用检测。');
            return null;
        }
        if (checking) {
            log('跳过检测：上一次检测还没结束');
            return null;
        }
        const project = activeProject();
        const prog = currentProgress();
        const settings = data.settings();
        if (!project || !prog) {
            log('跳过检测：当前聊天没有启用的项目');
            if (manual) toast('info', '当前聊天没有启用的项目。');
            return null;
        }
        const sw = threadSwitches(project);
        const unit = activeUnit() && maskUnits([activeUnit()], sw)[0];
        if (!unit) {
            log('跳过检测：大纲为空');
            return null;
        }
        const floors = recentFloors(settings.checkFloors);
        if (!floors.length) {
            log('跳过检测：没有可检测的正文');
            if (manual) toast('info', '还没有可检测的正文。');
            return null;
        }
        checking = true;
        log(`开始检测：${placeOf(unit)}，读最近 ${floors.length} 楼${manual ? '（手动）' : ''}`);
        emit('checking');
        try {
            const list = maskUnits(units(), sw);
            const states = unitStates(list, prog);
            const opts = { carryOver: settings.carryOver, hookCap: settings.hookCap, links: links() };
            const index = buildIndexText(list, states, prog, opts);
            // readTo 只用成功检测时的楼数：检测失败的那批楼并没有读过。
            const threadInfo = checkThreads(liveThreads(list, states, prog, opts), {
                newThreadMode: sw.sideOn ? settings.newThreadMode : 'off', ignored: threadState(prog).ignored, readTo: prog.lastCheckFloor,
            });
            const messages = buildCheckMessages(unit, index, floors, threadInfo);
            let result = null;
            for (let attempt = 0; ; attempt += 1) {
                try {
                    result = parseCheckReply(await host.generate('check', messages, { timeoutMs: 120000 }));
                    break;
                } catch (error) {
                    if (attempt >= CHECK_RETRIES) throw error;
                    log(`检测请求失败：${error.message}，${RETRY_GAP_MS / 1000} 秒后第 ${attempt + 1} 次重试`);
                    await new Promise(resolve => setTimeout(resolve, RETRY_GAP_MS));
                }
            }
            notice.hide('checkfail');
            let next = currentProgress();
            // 钩子与支线链由 applyCheck 处理（链要走完最后一步才算演完）。
            next = uncheckByNames(next, unit.id, stageNodes(unit.stage.data).filter(node => !isThreadNode(node)), result.done);
            if (settings.carryOver) for (const item of carriedNodes(list, states, prog, { links: opts.links })) next = uncheckByNames(next, item.unit.id, [item.node], result.done);
            const merged = applyCheck(next, liveThreads(list, unitStates(list, next), next, opts), result, { floor: floorCount() });
            next = { ...merged.progress, lastCheckFloor: floorCount() };
            delete next.lastFailFloor;
            setProgress(next);
            for (const event of merged.events) log(threadEventText(event));
            log(`检测完成：已演 ${result.done.length} 个节点${result.stageDone ? '，本阶段已演完' : ''}${result.offTrack ? '，偏离大纲' : ''}`);
            if (result.offTrack && settings.offTrackMode !== 'off' && !next.offMuted.includes(unit.id)) {
                handleOffTrack(unit, result.offReason || result.reason);
            } else if (result.stageDone) {
                proposeAdvance({ unit, reason: result.reason });
            } else if (manual) {
                toast('info', result.reason || '本阶段尚未演完。');
            }
            if (result.newThread && sw.sideOn) offerThread(unit, result.newThread);
            return result;
        } catch (error) {
            // 失败只记 lastFailFloor 控制重试间隔，lastCheckFloor（readTo、「·已读」）不动。
            setProgress({ ...currentProgress(), lastFailFloor: floorCount() });
            log(`检测失败：${error.message}`);
            notice.show({
                id: 'checkfail',
                title: '进度检测失败',
                body: `已自动重试 ${CHECK_RETRIES} 次：${error.message}`,
                actions: [
                    { label: '重试', primary: true, run: () => checkNow({ manual }) },
                    { label: '关闭', run: () => notice.hide('checkfail') },
                ],
            });
            return null;
        } finally {
            checking = false;
            emit('checked');
        }
    }

    // 上次检测楼层比现有楼数还大（删楼、开分支、换了存档），以现有楼数重新起算。
    function clampBase() {
        const prog = currentProgress();
        if (!prog) return null;
        const floors = floorCount();
        // 支线钩子、进度钟记下的楼数也一并夹到现有楼数。
        const threads = clampThreads(prog, floors);
        const failOver = Number(prog.lastFailFloor) > floors;
        if (prog.lastCheckFloor <= floors && !failOver && threads === prog) return prog;
        if (prog.lastCheckFloor > floors) log(`上次检测楼层 ${prog.lastCheckFloor} 大于当前楼数 ${floors}，已改为 ${floors}`);
        if (failOver) log(`上次检测失败时的楼层 ${prog.lastFailFloor} 大于当前楼数 ${floors}，已改为 ${floors}`);
        if (threads !== prog) log(`支线与进度钟记下的楼数大于当前楼数 ${floors}，已改为 ${floors}`);
        const next = { ...threads, lastCheckFloor: Math.min(prog.lastCheckFloor, floors) };
        if (failOver) next.lastFailFloor = floors;
        setProgress(next, 'floor');
        return next;
    }

    function resetBase() {
        const prog = currentProgress();
        if (!prog) return;
        log(`手动重设检测起点为第 ${floorCount()} 楼`);
        const next = { ...prog, lastCheckFloor: floorCount() };
        delete next.lastFailFloor;
        setProgress(next, 'floor');
    }

    function runPending() {
        clearTimeout(pendingTimer);
        pendingTimer = 0;
        if (!pendingCheck) return;
        pendingCheck = false;
        checkNow();
    }

    // 主回复还在生成时先不发检测请求，等生成结束再发，避免和主回复抢接口。
    function queueCheck() {
        if (!generating) {
            setTimeout(() => checkNow(), 0);
            return;
        }
        if (pendingCheck) return;
        pendingCheck = true;
        log('主回复仍在生成，生成结束后检测');
        clearTimeout(pendingTimer);
        pendingTimer = setTimeout(() => {
            pendingTimer = 0;
            if (!pendingCheck) return;
            log('等待生成结束超时，直接检测');
            generating = false;
            runPending();
        }, PENDING_MAX_MS);
    }

    function onGenerationStarted(type, options, dryRun) {
        if (dryRun || host.isBackground()) return;
        generating = true;
    }

    // 让出给独立版时不注入、不检测，但仍通知界面刷新（独立版的进度和楼数可能已变）。
    function onGenerationEnded() {
        generating = false;
        if (yielded()) { emit('floor'); return; }
        runPending();
    }

    function onMessageReceived(messageId) {
        if (yielded()) { emit('floor'); return; }
        const floors = floorCount();
        const project = activeProject();
        if (!project) {
            log(`收到第 ${messageId} 楼：当前聊天没有启用的项目，不检测`);
            emit('floor');
            return;
        }
        if (isInfinite(project)) {
            infinite.onInfiniteReceived();
            return;
        }
        const settings = data.settings();
        const prog = clampBase() || currentProgress();
        const gap = floors - checkBase(prog);
        if (gap >= settings.checkEvery) {
            log(`收到第 ${messageId} 楼：距上次检测 ${gap} 楼，触发检测`);
            queueCheck();
        } else {
            log(`收到第 ${messageId} 楼：距上次检测 ${gap} 楼，还差 ${settings.checkEvery - gap} 楼`);
        }
        emit('floor');
    }

    function onMessageChanged() {
        if (yielded()) { emit('floor'); return; }
        if (isInfinite(activeProject())) {
            infinite.refreshRead();
            infinite.revalidateTrigger();
            emit('floor');
            return;
        }
        if (!clampBase()) return;
        emit('floor');
    }

    async function onChatChanged() {
        progress = null;
        progressFor = '';
        infinite.abandonOpening();
        infinite.clearRead();
        pendingCheck = false;
        clearTimeout(pendingTimer);
        pendingTimer = 0;
        chatStartFloors = floorCount();
        notice.hide('advance');
        notice.hide('offtrack');
        notice.hide('thread');
        if (yielded()) {
            emit('chat');
            return;
        }
        const id = activeId();
        if (id) {
            try {
                await data.loadProject(id);
            } catch (error) {
                toast('error', `读取项目失败：${error.message}`);
            }
        }
        log(`切换聊天：${floorCount()} 楼，${id ? `启用项目「${(data.index().projects.find(item => item.id === id) || {}).name || id}」` : '本卡没有启用项目'}`);
        if (id && !isInfinite(activeProject())) clampBase();
        infinite.refreshRead();
        scheduleFallback();
        emit('chat');
    }

    // scope='chat'：只改当前聊天，本卡还没有默认时顺带设为默认；没打开聊天时改本卡默认。
    // scope='card'：改本卡默认（之后没记过项目的聊天都用它），当前聊天也跟着换。
    async function switchProject(id, scope = 'chat') {
        if (id) await data.loadProject(id);
        infinite.abandonOpening();
        const bound = store.bindChat(id);
        if (scope === 'card' || !bound || !data.activeIdFor(cardKey())) data.setActive(id);
        progress = null;
        progressFor = '';
        scheduleFallback();
        emit('switch');
    }

    // key 是事件在 eventTypes 里的名字，诊断页按它显示是否绑上、收到过几次。
    const BINDINGS = [
        ['WORLDINFO_ENTRIES_LOADED', onEntriesLoaded],
        ['CHAT_CHANGED', onChatChanged],
        ['MESSAGE_RECEIVED', onMessageReceived],
        ['MESSAGE_UPDATED', onMessageChanged],
        ['MESSAGE_DELETED', onMessageChanged],
        ['MESSAGE_SWIPED', onMessageChanged],
        ['GENERATION_STARTED', onGenerationStarted],
        ['GENERATION_ENDED', onGenerationEnded],
        ['GENERATION_STOPPED', onGenerationEnded],
    ];

    function bind() {
        const c = ctx();
        const types = eventTypes();
        if (!c || !c.eventSource) return;
        for (const [key, handler] of BINDINGS) {
            const name = types[key];
            if (!name) continue;
            const wrapped = (...args) => {
                const stat = stats[key] || (stats[key] = { count: 0, at: 0 });
                stat.count += 1;
                stat.at = Date.now();
                return handler(...args);
            };
            c.eventSource.on(name, wrapped);
            listeners.push([c.eventSource, name, wrapped]);
        }
    }

    function unbind() {
        for (const [source, name, handler] of listeners.splice(0)) {
            try { (source.removeListener || source.off)?.call(source, name, handler); } catch (error) { /* 酒馆已卸载 */ }
        }
    }

    function start() {
        unbind();
        bind();
        log(`已绑定 ${listeners.length} 个酒馆事件`);
        onChatChanged();
    }

    function stop() {
        unbind();
        infinite.abandonOpening();
        clearTimeout(fallbackTimer);
        clearTimeout(pendingTimer);
        fallbackTimer = 0;
        pendingTimer = 0;
    }

    function diagnose() {
        const types = eventTypes();
        const bound = new Set(listeners.map(item => item[1]));
        return {
            owner: yielded() ? 'standalone' : 'tianyin',
            hasContext: Boolean(ctx()),
            hasEventSource: Boolean(ctx() && ctx().eventSource),
            events: BINDINGS.map(([key]) => ({ key, name: types[key] || '', bound: bound.has(types[key]), count: (stats[key] || {}).count || 0, at: (stats[key] || {}).at || 0 })),
            cardKey: cardKey(),
            floors: floorCount(),
            chatStartFloors,
            generating,
            pending: pendingCheck,
            checking,
            logs: logs.slice(),
        };
    }

    return {
        start,
        stop,
        activeId,
        activeProject,
        progress: () => currentProgress() || emptyProgress(''),
        setProgress,
        units,
        entries,
        openNext,
        backTo,
        checkNow,
        isChecking: () => checking,
        switchProject,
        floorCount,
        recentFloors,
        rewriteRest,
        syncSetting,
        diagnose,
        isInfinite: () => isInfinite(activeProject()),
        infState: infinite.infState,
        openWorld: infinite.openWorld,
        isOpening: infinite.isOpening,
        lastRead: infinite.lastRead,
        returnToTrain: infinite.returnToTrain,
        reopenWorld: infinite.reopenWorld,
        deleteWorld: infinite.deleteWorld,
        note: log,
        resetBase,
        injectMode: () => (hasEntriesEvent() ? 'virtual' : 'book'),
        links,
        refresh: () => { scheduleFallback(); emit('progress'); },
    };
}
