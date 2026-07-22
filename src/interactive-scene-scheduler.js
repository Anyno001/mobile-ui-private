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


export function createCommunityTaskController({ runtime, isAllowed, isTargetActive }) {
    if (!runtime || typeof isAllowed !== 'function' || typeof isTargetActive !== 'function') {
        throw new TypeError('社区任务控制器依赖无效');
    }
    runtime.communityGeneration = Number.isInteger(runtime.communityGeneration) ? runtime.communityGeneration : 0;
    runtime.communityTask = runtime.communityTask || null;
    runtime.communityMode = ['remind', 'auto'].includes(runtime.communityMode) ? runtime.communityMode : 'remind';
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
        && isTargetActive(task);
    const setMode = mode => {
        if (!['remind', 'auto'].includes(mode)) throw new Error('社区热场模式无效');
        runtime.communityMode = mode;
        return mode;
    };
    const baseline = snapshot => {
        runtime.communityBaselineAssistantCount = snapshot?.assistantCount ?? 0;
        runtime.communityReminder = null;
    };
    const begin = ({ kind, storageId, sceneId, turnKey = '', scheduled = false }) => {
        if (!kind || !storageId || !sceneId || runtime.communityTask) return null;
        const task = Object.freeze({
            generation: ++runtime.communityGeneration, kind, storageId, sceneId, turnKey,
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
    target, isStarted, isActive, setStarted, generateFeed, render, isCurrent,
}) {
    if (!target || typeof isStarted !== 'function' || typeof isActive !== 'function'
        || typeof setStarted !== 'function' || typeof generateFeed !== 'function'
        || typeof render !== 'function' || typeof isCurrent !== 'function') {
        throw new TypeError('直播热场依赖无效');
    }
    if (isStarted() || isActive()) return false;
    const generation = generateFeed(null, {
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
    controller, getTarget, request, commitFeed,
    onRender = () => {}, onStatus = () => {},
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
            await commitFeed(target, items, () => controller.isActive(task), onComplete);
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
    return { cancel, generateFeed, observe };
}
