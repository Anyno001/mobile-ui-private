// 无限流运行时：照 PlotInjector v0.1.18 src/app/runtime.js 的无限流段，由 plot-runtime.js 传入依赖。
// 只在「开副本」「关副本」两个时刻动作，副本进行中不管；同页有独立版时（yielded）状态块监听与生成都不跑，避免两边各开一次副本。
import { createWorld, enterWorld, leaveWorld, reenterWorld, removeWorld, undoEnter, undoLeave, withTrigger } from './core/infinite-flow.js';
import { decideTrigger, hashText, judgeTrigger, makeTrigger, parseTrainState } from './core/infinite-state.js';
import { hubWordNames, normalizeInfinite, randomFloat, resolveHub, rollWorldDice, titleKey } from './core/infinite.js';
import { buildWorldMessages, horrorTitle, parseWorldReply, worldSpecText } from './core/infinite-world.js';
import { makeId } from './core/outline.js';

// 造世界解析失败或请求失败时的重试次数。
const WORLD_RETRIES = 2;
// 档案还在生成时用户发了下一条，最多等这么久。
const WORLD_WAIT_MS = 90000;

export const isInfiniteProject = project => Boolean(project && project.mode === 'infinite');

export function createInfiniteRuntime({ host, notice, emit, log, toast, yielded, activeProject, currentProgress, setProgress }) {
    const { chatMessages } = host;
    const isInfinite = isInfiniteProject;
    let opening = false;
    let openGen = 0;
    let openPromise = Promise.resolve(null);
    let pendingTrigger = null;
    let lastRead = null;

    // ---------- 无限流 ----------
    // 照 PlotInjector v0.1.18 runtime.js。只在「开副本」「关副本」两个时刻动作，副本进行中不管。
    // 同页有独立版时由独立版负责（yielded），这里的状态块监听与生成都不跑，避免两边各开一次副本。

    function infState() {
        const project = activeProject();
        const prog = currentProgress();
        if (!isInfinite(project) || !prog || !prog.infinite) return null;
        return { project, prog, infinite: normalizeInfinite(project.infinite), inf: prog.infinite };
    }

    function setInf(inf, reason = 'progress') {
        setProgress({ ...currentProgress(), infinite: inf }, reason);
    }

    // 最新一条 AI 楼层（非用户、非系统）。
    function latestAiFloor() {
        const chat = chatMessages();
        for (let i = chat.length - 1; i >= 0; i -= 1) {
            const msg = chat[i];
            if (!msg || msg.is_user || msg.is_system) continue;
            return { floor: i, text: String(msg.mes || '') };
        }
        return null;
    }

    function hubConfig() {
        const project = activeProject();
        return project && project.infinite ? normalizeInfinite(project.infinite).config : undefined;
    }

    function refreshRead() {
        const found = latestAiFloor();
        lastRead = found ? { floor: found.floor, state: parseTrainState(found.text, hubConfig()) } : null;
        return found;
    }

    // 放弃进行中的开副本（切聊天、切项目、触发楼被撤销）：结果作废，不写进任何进度。
    function abandonOpening() {
        if (!opening) return;
        openGen += 1;
        opening = false;
        pendingTrigger = null;
        emit('opened');
    }

    // 触发楼被 swipe、编辑或删除后：不再带触发值就撤销；仍带就不重复生成，只更新哈希。
    function revalidateTrigger() {
        const state = infState();
        if (!state) return;
        const pending = opening && pendingTrigger ? pendingTrigger : null;
        const trig = pending || state.inf.trigger;
        if (!trig) return;
        const msg = chatMessages()[trig.floor];
        const text = msg && !msg.is_user && !msg.is_system ? String(msg.mes || '') : null;
        // swipe 重新生成时酒馆先把这一楼清空，等新文字写回再判断，免得白白撤销又重造。
        if (text !== null && !text.trim()) return;
        const cfg = state.infinite.config;
        const names = hubWordNames(cfg);
        const word = trig.kind === 'enter' ? names.depart : names.back;
        const verdict = judgeTrigger(trig, text, cfg);
        if (verdict === 'none' || verdict === 'same') return;
        if (verdict === 'keep') {
            const next = { ...trig, hash: hashText(text) };
            if (pending) pendingTrigger = next;
            else setInf(withTrigger(state.inf, next));
            log(`第 ${trig.floor} 楼文字变了，仍是「${word}」，不重复处理`);
            return;
        }
        if (pending) {
            log(`第 ${trig.floor} 楼不再是「${names.depart}」，取消正在生成的世界档案`);
            abandonOpening();
        } else if (trig.kind === 'enter') {
            log(`第 ${trig.floor} 楼不再是「${names.depart}」，撤销开副本，删掉刚生成的档案`);
            setInf(undoEnter(state.inf, `第 ${trig.floor} 楼不再是「${names.depart}」，撤销开副本`));
        } else {
            log(`第 ${trig.floor} 楼不再是「${names.back}」，撤销关副本`);
            setInf(undoLeave(state.inf, `第 ${trig.floor} 楼不再是「${names.back}」，撤销关副本`));
        }
        notice.show({ id: 'inf-undo', title: '触发楼已改动', body: trig.kind === 'enter' ? `这一楼不再是「${names.depart}」，已撤销开副本并删掉刚生成的档案。` : `这一楼不再是「${names.back}」，已重新打开那份档案。`, timeout: 10000 });
    }

    // AI 回复完成：只读最新一条 AI 楼层的状态块。
    function onInfiniteReceived() {
        const found = refreshRead();
        revalidateTrigger();
        const state = infState();
        if (!state || !found) {
            if (!found) log('收到回复：没有 AI 楼层可读');
            emit('floor');
            return;
        }
        const train = lastRead.state;
        log(`读状态块：第 ${found.floor} 楼 ${train ? `${resolveHub(state.infinite.config).hubName}：${train}` : '没有状态块'}`);
        const kind = decideTrigger(state.inf.phase, train, state.infinite.config);
        if (kind === 'enter') {
            openWorld({ floor: found.floor, text: found.text });
        } else if (kind === 'leave') {
            const trigger = makeTrigger({ kind: 'leave', floor: found.floor, text: found.text, worldId: state.inf.worldId });
            setInf(withTrigger(leaveWorld(state.inf, `第 ${found.floor} 楼读到「${hubWordNames(state.infinite.config).back}」，关副本`), trigger));
        }
        emit('floor');
    }

    // 档案还在生成时用户发了下一条：酒馆会等条目加载事件，最多等 WORLD_WAIT_MS。
    async function waitOpening() {
        const promise = openPromise;
        let timer = 0;
        let timedOut = false;
        const timeout = new Promise(resolve => {
            timer = setTimeout(() => { timedOut = true; resolve(); }, WORLD_WAIT_MS);
        });
        log('世界档案还在生成，先等它完成');
        await Promise.race([promise.catch(() => null), timeout]);
        clearTimeout(timer);
        if (timedOut && opening) {
            log(`等待世界档案超过 ${WORLD_WAIT_MS / 1000} 秒，本次回复先不带档案`);
            notice.show({ id: 'inf-wait', title: '世界档案还没生成完', body: `已等待 ${WORLD_WAIT_MS / 1000} 秒，本次回复先不带档案，生成完成后从下一次回复起带上。`, timeout: 12000 });
        }
    }

    // 开副本：掷四个骰子，读恐怖类型写法条目，调生成模型写档案，进入这个世界。之后档案原样不动。
    // trigger：正文状态块触发时传入（{ floor, text }），手动按钮不传。
    function openWorld(trigger = null) {
        if (opening) return openPromise;
        if (yielded()) {
            toast('info', '独立版剧情注入器正在接管本聊天，请在独立版里操作。');
            return Promise.resolve(null);
        }
        const state = infState();
        if (!state) return Promise.resolve(null);
        if (state.inf.phase !== 'train') {
            toast('info', `只有在${resolveHub(state.infinite.config).hubName}时才能进入新世界。`);
            return Promise.resolve(null);
        }
        opening = true;
        openGen += 1;
        const gen = openGen;
        pendingTrigger = trigger ? { kind: 'enter', floor: trigger.floor, hash: hashText(trigger.text), worldId: '' } : null;
        openPromise = runOpen(state, gen).finally(() => {
            if (gen !== openGen) return;
            opening = false;
            pendingTrigger = null;
            emit('opened');
        });
        return openPromise;
    }

    async function runOpen(state, gen) {
        const projectId = state.project.id;
        emit('opening');
        try {
            const dice = rollWorldDice(state.infinite, randomFloat);
            log(`开副本掷骰：${dice.horror}｜${dice.cycle}｜${dice.client}｜情欲${dice.lust}`);
            const spec = worldSpecText(state.infinite);
            const titles = state.inf.worlds.map(world => world.title);
            // 恐怖类型写法：卡里同标题条目（默认关闭也读得到），只给造世界用，不进正文注入。
            const guideTitle = horrorTitle(state.infinite.config.horrorPrefix, dice.horror);
            let horrorGuide = '';
            try {
                horrorGuide = await host.readEntryContent(guideTitle, (a, b) => titleKey(a) === titleKey(b));
            } catch (error) {
                log(`读取恐怖类型写法失败：${error.message}`);
            }
            if (!horrorGuide) log(`卡里没找到「${guideTitle}」，造世界时不带恐怖类型写法`);
            let parsed = null;
            let hint = '';
            for (let attempt = 0; ; attempt += 1) {
                try {
                    const messages = buildWorldMessages({ spec, dice, setting: state.project.setting.text, titles, hint, horrorGuide });
                    parsed = parseWorldReply(await host.generate('outline', messages, { timeoutMs: 180000 }));
                    break;
                } catch (error) {
                    if (attempt >= WORLD_RETRIES) throw error;
                    hint = error.message;
                    log(`造世界失败：${error.message}，第 ${attempt + 1} 次重试`);
                }
            }
            const now = infState();
            if (gen !== openGen || !now || now.project.id !== projectId || now.inf.phase !== 'train') {
                log('造世界结果作废：开副本期间状态已变');
                return null;
            }
            const world = createWorld({ id: makeId('w'), dice, parsed });
            const trig = pendingTrigger ? { ...pendingTrigger, worldId: world.id } : null;
            setInf(withTrigger(enterWorld(now.inf, world), trig));
            notice.show({ id: 'inf-stop', title: `进入新世界「${world.title}」`, body: `${dice.horror}｜${dice.client}`, timeout: 12000 });
            return world;
        } catch (error) {
            if (gen !== openGen) return null;
            log(`开副本失败：${error.message}`);
            notice.show({
                id: 'inf-stop',
                title: '开副本失败',
                body: error.message,
                actions: [{ label: '重试', primary: true, run: () => openWorld() }, { label: '关闭', run: () => notice.hide('inf-stop') }],
            });
            return null;
        }
    }

    // 手动「回到主空间」：关副本，档案留在世界库里。
    function returnToTrain() {
        if (yielded()) return;
        const state = infState();
        if (!state || state.inf.phase !== 'world') return;
        setInf(leaveWorld(state.inf, `手动回到${resolveHub(state.infinite.config).hubName}`));
    }

    // 世界库里手动「重新打开」某份档案，直接进入那个世界。
    function reopenWorld(worldId) {
        if (yielded()) return;
        const state = infState();
        if (!state) return;
        if (state.inf.phase !== 'train') {
            toast('info', `先回到${resolveHub(state.infinite.config).hubName}，再重新打开档案。`);
            return;
        }
        setInf(reenterWorld(state.inf, worldId));
    }

    function deleteWorld(worldId) {
        if (yielded()) return;
        const state = infState();
        if (state) setInf(removeWorld(state.inf, worldId, state.infinite.config));
    }


    return {
        infState, openWorld, returnToTrain, reopenWorld, deleteWorld, onInfiniteReceived, refreshRead, revalidateTrigger, abandonOpening, waitOpening,
        isOpening: () => opening,
        lastRead: () => lastRead,
        clearRead: () => { lastRead = null; },
    };
}
