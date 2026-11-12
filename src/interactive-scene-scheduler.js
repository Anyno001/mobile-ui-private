import { generationErrorMessage } from './ai.js';

export const COMMUNITY_TASK_PHASES = Object.freeze({
    IDLE: 'IDLE', SCHEDULED: 'SCHEDULED', GENERATING: 'GENERATING', FAILED: 'FAILED',
});

const EVENT_KEYS = Object.freeze([
    'MESSAGE_RECEIVED', 'MESSAGE_SENT', 'MESSAGE_EDITED', 'MESSAGE_UPDATED',
    'MESSAGE_DELETED', 'MESSAGE_SWIPED', 'GENERATION_ENDED',
]);

const ownValue = (object, key) => {
    if (!object || (typeof object !== 'object' && typeof object !== 'function')) return undefined;
    const descriptor = Object.getOwnPropertyDescriptor(object, key);
    return descriptor && 'value' in descriptor ? descriptor.value : undefined;
};

const messageText = message => {
    for (const key of ['mes', 'message', 'content']) {
        const value = ownValue(message, key);
        if (typeof value === 'string' && value.trim()) return value.trim().slice(0, 4000);
    }
    return '';
};

const hashText = value => {
    let hash = 2166136261;
    for (let index = 0; index < value.length; index += 1) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
};

export function createCommunityTurnSnapshot(chat) {
    const source = Array.isArray(chat) ? chat.slice(-80) : [];
    const messages = source.flatMap(message => {
        const content = messageText(message);
        if (!content) return [];
        const isUser = ownValue(message, 'is_user') === true;
        const isSystem = ownValue(message, 'is_system') === true;
        return [{ role: isSystem ? 'system' : isUser ? 'user' : 'assistant', content }];
    });
    const serialized = messages.map(item => `${item.role}:${item.content}`).join('\n');
    const last = messages.at(-1) || null;
    const assistantCount = messages.filter(item => item.role === 'assistant').length;
    return Object.freeze({
        key: `turn:${messages.length}:${hashText(serialized)}`,
        messageCount: messages.length,
        assistantCount,
        lastRole: last?.role || 'none',
        lastIsAssistant: last?.role === 'assistant',
    });
}

export function resolveHostEvent(eventTypes, key) {
    const value = ownValue(eventTypes, key);
    return typeof value === 'string' && value ? value : null;
}

export function registerResolvedHostEvent(eventSource, eventTypes, key, callback) {
    const eventName = resolveHostEvent(eventTypes, key);
    if (!eventName || typeof eventSource?.on !== 'function' || typeof callback !== 'function') return false;
    eventSource.on(eventName, callback);
    return true;
}

export function resolveCommunityMessageEvents(eventTypes) {
    const values = EVENT_KEYS.flatMap(key => {
        const value = resolveHostEvent(eventTypes, key);
        return value ? [value] : [];
    });
    return [...new Set(values)];
}


// 后台热场目标：优先用最后打开的社区，没有就退回该聊天的 activeSceneId。
export function resolveBackgroundCommunityTarget(runtime, getStorageId) {
    const storageId = runtime.openSceneStorageId || getStorageId();
    const scope = runtime.store?.scopes?.[storageId];
    const scene = scope?.scenes?.[runtime.openSceneId || scope?.activeSceneId];
    return scene ? { storageId, sceneId: scene.id } : null;
}
export function isBackgroundCommunityTarget(runtime, getStorageId, target) {
    const current = resolveBackgroundCommunityTarget(runtime, getStorageId);
    return !!current && current.storageId === target?.storageId && current.sceneId === target?.sceneId;
}
// 页面切换触发的默认失效不打断正在进行的按楼自动热场；切聊天等带原因的失效照常取消。
export function keepBackgroundFeed(controller, reason, isCurrent) {
    const task = controller.state().task;
    return (reason === 'community-context-invalidated' || reason === 'phone-closed') && task?.kind === 'auto-feed' && isCurrent(task);
}

// 社区「按楼自动生成」开关：全局一份，存 localStorage；读写失败按默认「只提醒」处理。
export const COMMUNITY_MODE_KEY = 'ST_SMS_COMMUNITY_MODE';
const loadCommunityMode = () => {
    try { return globalThis.localStorage?.getItem(COMMUNITY_MODE_KEY) === 'auto' ? 'auto' : 'remind'; } catch { return 'remind'; }
};
const saveCommunityMode = mode => {
    try { globalThis.localStorage?.setItem(COMMUNITY_MODE_KEY, mode); } catch { /* 存不下时本次会话仍生效 */ }
};

export function createCommunityTaskController({ runtime, isAllowed, isTargetActive, isLiveTargetActive = () => false }) {
    if (!runtime || typeof isAllowed !== 'function' || typeof isTargetActive !== 'function' || typeof isLiveTargetActive !== 'function') {
        throw new TypeError('社区任务控制器依赖无效');
    }
    runtime.communityGeneration = Number.isInteger(runtime.communityGeneration) ? runtime.communityGeneration : 0;
    runtime.communityTask = runtime.communityTask || null;
    runtime.communityMode = ['remind', 'auto'].includes(runtime.communityMode) ? runtime.communityMode : loadCommunityMode();
    runtime.communityTurnThreshold = Number.isInteger(runtime.communityTurnThreshold) ? runtime.communityTurnThreshold : 3;
    runtime.communityBaselineAssistantCount = Number.isInteger(runtime.communityBaselineAssistantCount)
        ? runtime.communityBaselineAssistantCount : null;
    runtime.communityReminder = runtime.communityReminder || null;
    runtime.communityTaskPhase = runtime.communityTaskPhase || COMMUNITY_TASK_PHASES.IDLE;

    const state = () => Object.freeze({
        phase: runtime.communityTaskPhase,
        task: runtime.communityTask,
        mode: runtime.communityMode,
        reminder: runtime.communityReminder,
        threshold: runtime.communityTurnThreshold,
    });
    const cancel = (reason = 'community-task-cancelled', resetObservation = false) => {
        runtime.communityGeneration += 1;
        runtime.communityTask = null;
        if (resetObservation) {
            runtime.communityBaselineAssistantCount = null;
            runtime.communityReminder = null;
        }
        runtime.communityTaskPhase = COMMUNITY_TASK_PHASES.IDLE;
        return reason;
    };
    const isActive = task => !!task
        && runtime.communityTask === task
        && runtime.communityGeneration === task.generation
        && (task.roomId ? isLiveTargetActive(task) : isTargetActive(task));
    const setMode = mode => {
        if (!['remind', 'auto'].includes(mode)) throw new Error('社区热场模式无效');
        runtime.communityMode = mode;
        saveCommunityMode(mode);
        return mode;
    };
    const baseline = snapshot => {
        runtime.communityBaselineAssistantCount = snapshot?.assistantCount ?? 0;
        runtime.communityReminder = null;
    };
    // 任务目标是社区（sceneId）或直播间（roomId）；两者共用同一把忙碌锁，同一时间只有一个生成任务。
    const begin = ({ kind, storageId, sceneId, roomId, turnKey = '', scheduled = false }) => {
        if (!kind || !storageId || (!sceneId && !roomId) || runtime.communityTask) return null;
        const task = Object.freeze({
            generation: ++runtime.communityGeneration, kind, storageId, ...(roomId ? { roomId } : { sceneId }), turnKey,
        });
        runtime.communityTask = task;
        runtime.communityTaskPhase = scheduled ? COMMUNITY_TASK_PHASES.SCHEDULED : COMMUNITY_TASK_PHASES.GENERATING;
        return task;
    };
    const markGenerating = task => {
        if (!isActive(task)) return false;
        runtime.communityTaskPhase = COMMUNITY_TASK_PHASES.GENERATING;
        return true;
    };
    const finish = (task, error = null) => {
        if (runtime.communityTask !== task) return false;
        runtime.communityTask = null;
        runtime.communityTaskPhase = error ? COMMUNITY_TASK_PHASES.FAILED : COMMUNITY_TASK_PHASES.IDLE;
        return true;
    };
    const observe = (snapshot, target) => {
        if (!snapshot?.lastIsAssistant || !snapshot.key) return null;
        if (runtime.communityBaselineAssistantCount === null) {
            baseline(snapshot);
            return null;
        }
        const advanced = snapshot.assistantCount - runtime.communityBaselineAssistantCount;
        if (advanced < runtime.communityTurnThreshold || runtime.communityReminder?.turnKey === snapshot.key) return null;
        const reminder = target?.storageId && target?.sceneId
            ? Object.freeze({ storageId: target.storageId, sceneId: target.sceneId, turnKey: snapshot.key, advanced })
            : null;
        runtime.communityReminder = reminder;
        if (!reminder || runtime.communityMode !== 'auto' || !isAllowed(target)) return null;
        if (runtime.communityTask) return null;
        runtime.communityReminder = null;
        runtime.communityBaselineAssistantCount = snapshot.assistantCount;
        return begin({ kind: 'auto-feed', ...target, turnKey: snapshot.key, scheduled: true });
    };
    const consumeReminder = target => {
        const reminder = runtime.communityReminder;
        if (!reminder || reminder.storageId !== target?.storageId || reminder.sceneId !== target?.sceneId) return null;
        runtime.communityReminder = null;
        runtime.communityBaselineAssistantCount += reminder.advanced;
        return reminder;
    };
    return { state, cancel, isActive, setMode, baseline, begin, markGenerating, finish, observe, consumeReminder };
}

export async function runLiveWarmup({
    target, isStarted, isActive, setStarted, generateDanmaku, generateFeed, render, isCurrent,
}) {
    const generate = generateDanmaku || generateFeed;
    if (!target || typeof isStarted !== 'function' || typeof isActive !== 'function'
        || typeof setStarted !== 'function' || typeof generate !== 'function'
        || typeof render !== 'function' || typeof isCurrent !== 'function') {
        throw new TypeError('直播热场依赖无效');
    }
    if (isStarted() || isActive()) return false;
    const generation = generate(null, {
        renderTab: 'live',
        taskKind: 'live-warmup',
        onComplete: () => setStarted(true),
    });
    render();
    try {
        await generation;
        return true;
    } catch (error) {
        if (!isCurrent()) throw new Error('生成已取消');
        if (error?.message === '生成已取消' || error?.name === 'AbortError') throw new Error('生成已取消');
        render();
        throw error;
    }
}

export function createCommunityGenerationRunner({
    controller, getTarget, request, commitFeed, commitDanmaku,
    onRender = () => {}, onStatus = () => {}, onAutoFeedCommitted = null,
}) {
    if (!controller || typeof getTarget !== 'function' || typeof request !== 'function'
        || typeof commitFeed !== 'function') {
        throw new TypeError('社区生成调度器依赖无效');
    }
    const targetOf = task => ({ storageId: task.storageId, sceneId: task.sceneId });
    const begin = kind => {
        const target = getTarget();
        return target ? controller.begin({ kind, ...target }) : null;
    };
    const reportFailure = (task, error) => {
        if (controller.finish(task, error) && error?.message !== '生成已取消') {
            onStatus(error ? generationErrorMessage(error) : '社区生成失败');
        }
    };
    const cancel = (reason = 'community-generation-cancelled', resetObservation = false) => {
        return controller.cancel(reason, resetObservation);
    };
    const generateFeed = async (scheduledTask = null, { renderTab = 'feed', taskKind = 'manual-feed', onComplete = null } = {}) => {
        const task = scheduledTask || begin(taskKind);
        if (!task) throw new Error('已有社区生成任务正在进行');
        if (!controller.markGenerating(task)) return false;
        const target = targetOf(task);
        if (!scheduledTask) controller.consumeReminder(target);
        try {
            const items = await request('feed_batch', {}, target);
            if (!controller.isActive(task)) throw new Error('生成已取消');
            const committed = await commitFeed(target, items, () => controller.isActive(task), onComplete);
            if (!controller.isActive(task)) throw new Error('生成已取消');
            controller.finish(task);
            // 只有按楼自动生成才回调；手动生成与直播热场不触发。回调出错不影响生成结果。
            if (scheduledTask && task.kind === 'auto-feed') { try { onAutoFeedCommitted?.(target, committed); } catch { /* 提醒不阻断生成 */ } }
            onRender(renderTab);
            return true;
        } catch (error) {
            const cancelledWarmup = task.kind === 'live-warmup'
                && (!controller.isActive(task) || error?.message === '生成已取消' || error?.name === 'AbortError');
            if (cancelledWarmup) {
                const cancelled = new Error('生成已取消');
                controller.finish(task);
                throw cancelled;
            }
            reportFailure(task, error);
            throw error;
        }
    };
    const generateDanmaku = async (scheduledTask = null, { renderTab = 'live', taskKind = 'manual-danmaku', onComplete = null } = {}) => {
        if (typeof commitDanmaku !== 'function') throw new TypeError('直播弹幕提交依赖无效');
        const task = scheduledTask || begin(taskKind);
        if (!task) throw new Error('已有社区生成任务正在进行');
        if (!controller.markGenerating(task)) return false;
        const target = targetOf(task);
        if (!scheduledTask) controller.consumeReminder(target);
        try {
            const items = await request('danmaku_batch', {}, target);
            if (!controller.isActive(task)) throw new Error('生成已取消');
            await commitDanmaku(target, items, () => controller.isActive(task), onComplete);
            if (!controller.isActive(task)) throw new Error('生成已取消');
            controller.finish(task);
            onRender(renderTab);
            return true;
        } catch (error) {
            const cancelledWarmup = task.kind === 'live-warmup'
                && (!controller.isActive(task) || error?.message === '生成已取消' || error?.name === 'AbortError');
            if (cancelledWarmup) {
                const cancelled = new Error('生成已取消');
                controller.finish(task);
                throw cancelled;
            }
            reportFailure(task, error);
            throw error;
        }
    };
    const observe = chat => {
        const target = getTarget();
        const task = controller.observe(createCommunityTurnSnapshot(chat), target);
        if (task) generateFeed(task).catch(() => {});
        else if (controller.state().reminder && target) onStatus('正文有新进展，可以生成一批热场内容');
        return task;
    };
    return { cancel, generateFeed, generateDanmaku, observe };
}

// 直播间的弹幕生成：目标是 { storageId, roomId }，与社区共用同一个任务控制器，所以互相排斥、可一并取消。
// 不接入社区的正文观察与提醒，正文进展不会触发直播间生成。
export function createLiveGenerationRunner({
    controller, getTarget, request, commitDanmaku, onRender = () => {}, onStatus = () => {},
}) {
    if (!controller || typeof getTarget !== 'function' || typeof request !== 'function' || typeof commitDanmaku !== 'function') {
        throw new TypeError('直播生成调度器依赖无效');
    }
    const isCancelled = (task, error) => !controller.isActive(task)
        || error?.message === '生成已取消' || error?.name === 'AbortError';
    const generateDanmaku = async (scheduledTask = null, { taskKind = 'manual-danmaku', onComplete = null } = {}) => {
        let task = scheduledTask;
        if (!task) {
            const target = getTarget();
            task = target ? controller.begin({ kind: taskKind, ...target }) : null;
        }
        if (!task) throw new Error('已有社区生成任务正在进行');
        if (!controller.markGenerating(task)) {
            // 目标已不在场：释放任务锁，按取消处理，避免一直占着忙碌锁。
            controller.finish(task);
            throw new Error('生成已取消');
        }
        const target = { storageId: task.storageId, roomId: task.roomId };
        try {
            const items = await request(target);
            if (!controller.isActive(task)) throw new Error('生成已取消');
            await commitDanmaku(target, items, () => controller.isActive(task), onComplete);
            if (!controller.isActive(task)) throw new Error('生成已取消');
            controller.finish(task);
            onRender();
            return true;
        } catch (error) {
            if (isCancelled(task, error)) {
                controller.finish(task);
                throw new Error('生成已取消');
            }
            if (controller.finish(task, error)) onStatus(generationErrorMessage(error));
            throw error;
        }
    };
    return { generateDanmaku };
}
