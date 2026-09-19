import { appendTodayTrendGenerationSnapshot, rollbackTodayTrendScope } from './today-trend-model.js';
import { calendarReferenceDate, calendarScopeFor, formatCalendarDate } from './calendar-model.js';
import {
    applyTodayTrendGenerationToV2, applyTodayTrendRerollToV2, buildReadOnlyShadow,
    replaceTodayTrendV2ScopeWithBatchReset, rollbackTodayTrendV2Scope,
} from './today-trend-v2-model.js';

const cancelled = () => Object.assign(new Error('今日风向生成已取消'), { name: 'AbortError' });
const staleCalendar = () => Object.assign(new Error('日历日期在生成期间已变化，迟到结果已丢弃'), {
    name: 'AbortError', code: 'TT_DATE_DRIFT',
});
const validCount = value => Number.isInteger(value) && value >= 0 ? value : 0;
const OBSERVATION_LIMIT = 80;
const HASH_SEEDS = Object.freeze([0x811c9dc5, 0x9e3779b9, 0x85ebca6b, 0xc2b2ae35]);
const HASH_PRIMES = Object.freeze([0x01000193, 0x27d4eb2d, 0x165667b1, 0x9e3779b1]);
const messageText = message => {
    if (typeof message?.mes === 'string' && message.mes.trim()) return message.mes.trim();
    if (typeof message?.message === 'string' && message.message.trim()) return message.message.trim();
    if (typeof message?.content === 'string' && message.content.trim()) return message.content.trim();
    return '';
};
const messageRole = message => {
    const role = typeof message?.role === 'string' ? message.role.toLowerCase() : '';
    if (message?.is_user === true) return 'user';
    if (role === 'user') return 'user';
    if (message?.extra?.type === 'narrator') return 'system';
    return 'assistant';
};
const updateHashCode = (state, code) => {
    for (let lane = 0; lane < state.length; lane += 1) {
        state[lane] ^= code + lane * 0x9e37;
        state[lane] = Math.imul(state[lane], HASH_PRIMES[lane]);
    }
};
const updateHashNumber = (state, value) => {
    const number = value >>> 0;
    updateHashCode(state, number & 0xff);
    updateHashCode(state, (number >>> 8) & 0xff);
    updateHashCode(state, (number >>> 16) & 0xff);
    updateHashCode(state, (number >>> 24) & 0xff);
};
const hashHex = state => state.map(value => (value >>> 0).toString(16).padStart(8, '0')).join('');
const validFloor = (value, fallback = 0) => Number.isInteger(value) && value >= 0 ? value : fallback;

const historyMessageText = message => {
    for (const key of ['mes', 'message', 'content']) {
        if (typeof message?.[key] === 'string' && message[key].trim()) return message[key].trim();
    }
    return '';
};
const historyMessageRole = message => {
    const role = typeof message?.role === 'string' ? message.role.toLowerCase().trim() : '';
    if (role === 'user' || message?.is_user === true) return 'user';
    if (message?.extra?.type === 'narrator') return null;
    if (role === 'assistant' || role === 'system' || (role === '' && message?.is_user !== true)) return 'assistant';
    return null;
};
const isDatabaseAiMessage = message => Boolean(message && typeof message === 'object'
    && !message.is_user);
export const countTodayTrendAssistantMessages = messages => Array.isArray(messages)
    ? messages.filter(isDatabaseAiMessage).length
    : 0;
const invalidHistoryInput = message => Object.assign(new Error(message), { code: 'TT_HISTORY_WINDOW_INVALID' });
const historyMessageDigest = messages => {
    let hash = 2166136261;
    const update = value => {
        const text = String(value);
        for (let index = 0; index < text.length; index += 1) hash = Math.imul(hash ^ text.charCodeAt(index), 16777619);
        hash = Math.imul(hash ^ 0x1f, 16777619);
    };
    for (const message of messages) {
        const role = historyMessageRole(message);
        const content = historyMessageText(message);
        update(role);
        update(content);
    }
    return `fnv1a32:${(hash >>> 0).toString(16).padStart(8, '0')}`;
};
const structurallyEqual = (left, right) => {
    if (Object.is(left, right)) return true;
    if (Array.isArray(left) || Array.isArray(right)) {
        return Array.isArray(left) && Array.isArray(right) && left.length === right.length
            && left.every((value, index) => structurallyEqual(value, right[index]));
    }
    if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false;
    const leftKeys = Object.keys(left).sort();
    const rightKeys = Object.keys(right).sort();
    return leftKeys.length === rightKeys.length && leftKeys.every((key, index) => key === rightKeys[index]
        && structurallyEqual(left[key], right[key]));
};

const validateHistoryPlan = (plan, messages) => {
    if (!plan || typeof plan !== 'object' || Array.isArray(plan) || !Array.isArray(plan.batches)
        || !Number.isSafeInteger(plan.assistantCount) || plan.assistantCount < 1
        || !Number.isSafeInteger(plan.recentAssistantCount) || plan.recentAssistantCount < 1
        || !Number.isSafeInteger(plan.mergeAssistantCount) || plan.mergeAssistantCount < 1
        || !Number.isSafeInteger(plan.windowStart) || !Number.isSafeInteger(plan.windowEnd)
        || !Number.isSafeInteger(plan.batchCount) || plan.batchCount < 1
        || plan.batches.length !== plan.batchCount || typeof plan.sourceDigest !== 'string') {
        throw invalidHistoryInput('历史正文窗口规划结构无效');
    }
    if (plan.windowEnd !== plan.assistantCount || plan.windowStart !== plan.assistantCount - plan.recentAssistantCount + 1
        || plan.recentAssistantCount > plan.assistantCount || plan.mergeAssistantCount > plan.recentAssistantCount
        || plan.batchCount !== Math.ceil(plan.recentAssistantCount / plan.mergeAssistantCount)) {
        throw invalidHistoryInput('历史正文窗口规划边界无效');
    }
    for (const [index, batch] of plan.batches.entries()) {
        if (!batch || typeof batch !== 'object' || Object.keys(batch).sort().join(',') !== 'assistantEnd,assistantStart,index'
            || batch.index !== index || !Number.isSafeInteger(batch.assistantStart) || !Number.isSafeInteger(batch.assistantEnd)
            || batch.assistantStart !== plan.windowStart + index * plan.mergeAssistantCount
            || batch.assistantEnd !== Math.min(plan.assistantCount, batch.assistantStart + plan.mergeAssistantCount - 1)) {
            throw invalidHistoryInput('历史正文窗口批次边界无效');
        }
    }
    if (!Array.isArray(messages) || historyMessageDigest(messages) !== plan.sourceDigest) {
        throw invalidHistoryInput('历史正文窗口消息源已变化');
    }
};

/**
 * Validate the chat and calculate only scalar batch boundaries. Message bodies are
 * deliberately materialized by buildTodayTrendHistoryBatch, one batch at a time.
 */
export function planTodayTrendHistoryBatches({ messages, recentAssistantCount, mergeAssistantCount } = {}) {
    if (!Array.isArray(messages)) throw invalidHistoryInput('历史正文窗口消息必须是数组');
    let assistantCount = 0;
    for (const message of messages) {
        if (!message || typeof message !== 'object' || !historyMessageText(message)) {
            throw invalidHistoryInput('历史正文窗口不得包含空消息');
        }
        if (!historyMessageRole(message)) throw invalidHistoryInput('历史正文窗口包含无效角色');
        if (historyMessageRole(message) === 'assistant') assistantCount += 1;
    }
    if (!Number.isInteger(recentAssistantCount) || recentAssistantCount < 1 || recentAssistantCount > assistantCount) {
        throw invalidHistoryInput('历史正文窗口 recentAssistantCount 越界');
    }
    if (!Number.isInteger(mergeAssistantCount) || mergeAssistantCount < 1 || mergeAssistantCount > recentAssistantCount) {
        throw invalidHistoryInput('历史正文窗口 mergeAssistantCount 越界');
    }
    const windowStart = assistantCount - recentAssistantCount + 1;
    const batchCount = Math.ceil(recentAssistantCount / mergeAssistantCount);
    return Object.freeze({
        assistantCount, recentAssistantCount, mergeAssistantCount, windowStart, windowEnd: assistantCount,
        sourceDigest: historyMessageDigest(messages),
        batchCount,
        batches: Object.freeze(Array.from({ length: batchCount }, (_, index) => {
            const start = windowStart + index * mergeAssistantCount;
            return Object.freeze({
                index, assistantStart: start,
                assistantEnd: Math.min(assistantCount, start + mergeAssistantCount - 1),
            });
        })),
    });
}

/** Materialize exactly one validated history batch, preserving source order and message boundaries. */
export function buildTodayTrendHistoryBatch(messages, plan, batchIndex) {
    if (!Number.isInteger(batchIndex) || batchIndex < 0) {
        throw invalidHistoryInput('历史正文窗口批次无效');
    }
    validateHistoryPlan(plan, messages);
    if (batchIndex >= plan.batchCount) throw invalidHistoryInput('历史正文窗口批次无效');
    const batch = plan.batches[batchIndex];
    const selected = [];
    let assistantOrdinal = 0;
    for (const message of messages) {
        const role = historyMessageRole(message);
        if (!role || !historyMessageText(message)) throw invalidHistoryInput('历史正文窗口消息无效');
        const ordinal = role === 'assistant' ? ++assistantOrdinal : assistantOrdinal + 1;
        if (ordinal >= batch.assistantStart && ordinal <= batch.assistantEnd) {
            selected.push(Object.freeze({ role, content: historyMessageText(message) }));
        }
    }
    if (!selected.some(message => message.role === 'assistant')) throw invalidHistoryInput('历史正文窗口批次缺少 assistant 消息');
    return Object.freeze(selected);
}
const createTurnSnapshot = (chat, hostFloor = null) => {
    const sessionHash = [...HASH_SEEDS];
    let messageCount = 0;
    let assistantCount = 0;
    let lastRole = '';
    let lastMessageFingerprint = '';
    updateHashCode(sessionHash, 0x53);
    for (let index = 0; index < (Array.isArray(chat) ? chat.length : 0); index += 1) {
        const message = chat[index];
        if (!message || typeof message !== 'object') continue;
        const text = messageText(message);
        if (!text) continue;
        const role = messageRole(message);
        const roleCode = role === 'system' ? 1 : role === 'user' ? 2 : 3;
        const messageHash = [...HASH_SEEDS];
        updateHashCode(sessionHash, 0x1e);
        updateHashNumber(sessionHash, index);
        updateHashCode(sessionHash, roleCode);
        updateHashNumber(sessionHash, text.length);
        updateHashCode(messageHash, roleCode);
        updateHashNumber(messageHash, text.length);
        for (let offset = 0; offset < text.length; offset += 1) {
            const code = text.charCodeAt(offset);
            updateHashCode(sessionHash, code);
            updateHashCode(messageHash, code);
        }
        updateHashCode(sessionHash, 0x1f);
        messageCount += 1;
        if (role === 'assistant') assistantCount += 1;
        lastRole = role;
        lastMessageFingerprint = hashHex(messageHash);
    }
    updateHashNumber(sessionHash, messageCount);
    updateHashNumber(sessionHash, assistantCount);
    return Object.freeze({
        floor: validFloor(hostFloor, assistantCount),
        key: hashHex(sessionHash), messageCount, assistantCount, lastRole, lastMessageFingerprint,
        lastIsAssistant: lastRole === 'assistant',
    });
};
const sameSnapshot = (observation, snapshot) => observation?.key === snapshot.key
    && observation.floor === snapshot.floor
    && observation.messageCount === snapshot.messageCount
    && observation.assistantCount === snapshot.assistantCount
    && observation.lastRole === snapshot.lastRole
    && observation.lastMessageFingerprint === snapshot.lastMessageFingerprint;

export function createTodayTrendScheduler({
    controller, committer, getStore, getStorageId, getChat = () => [], getFloor = () => null, random = Math.random, now = () => Date.now(),
    getCalendarStore = () => null, getPromptScope = null, wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)),
    commitFeedbackMs = 240, buildHistoryPlan = planTodayTrendHistoryBatches, buildHistoryBatch = buildTodayTrendHistoryBatch,
} = {}) {
    if (!controller || typeof controller.generate !== 'function') throw new TypeError('今日风向调度器缺少生成控制器');
    if (!committer || typeof committer.commitStore !== 'function' || typeof committer.invalidateCommits !== 'function') throw new TypeError('今日风向调度器缺少事务提交器');
    if (typeof getStore !== 'function' || typeof getStorageId !== 'function') throw new TypeError('今日风向调度器缺少存储或聊天读取器');
    if (getPromptScope !== null && typeof getPromptScope !== 'function') throw new TypeError('今日风向调度器 prompt scope 读取器无效');
    let sequence = 0;
    let accessSequence = 0;
    let activeTask = null;
    let terminalTask = null;
    let phase = 'idle';
    let lastError = null;
    let lastErrorDetails = null;
    const safeBatchError = error => {
        if (error?.code !== 'TT_BATCH_VALIDATION' || !Array.isArray(error.details) || error.details.length < 1 || error.details.length > 20) return null;
        const keys = ['object', 'path', 'expected', 'actual'];
        const slot = /^(?:\$|world|reputation|factions|dynamics|history)(?:\[\d{1,10}\]|\.(?:upserts|create|appendStages|archive|events|id|eventId|details|label|value|relation|status|evaluation|parentId|relatedFactionIds|name|summary|stages|initialStage|type|title|stageLabel|origin|participants|relatedEventIds|outcome|finalResult|daySummaries|periodSummaries|world|reputation|factions|dynamics|history))*$/;
        const expected = new Set(['exact-fields', 'array', 'unique-id', 'complete-id-set', 'internal-id-or-null',
            'non-self-id', 'internal-id', 'non-self-non-parent-child-id', 'non-empty-array', 'non-empty-string-max-240', 'new-id', 'active-id', 'archive-enabled']);
        const actual = new Set(['missing', 'null', 'array', 'object', 'string', 'number', 'boolean',
            'invalid-id', 'duplicate', 'out-of-range-length', 'self', 'parent-child', 'external', 'unchecked']);
        const details = [];
        for (const detail of error.details) {
            if (!detail || typeof detail !== 'object' || Reflect.ownKeys(detail).length !== 4
                || keys.some(key => !Object.hasOwn(detail, key) || typeof detail[key] !== 'string')) return null;
            if (detail.object.length > 240 || detail.path.length > 240 || !slot.test(detail.object) || !slot.test(detail.path)
                || !expected.has(detail.expected) || !actual.has(detail.actual)) return null;
            details.push(Object.freeze({
                object: detail.object, path: detail.path, expected: detail.expected, actual: detail.actual,
            }));
        }
        return Object.freeze({ code: 'TT_BATCH_VALIDATION', details: Object.freeze(details) });
    };
    const baselines = new Map();
    const observations = new Map();
    const listeners = new Set();
    let lastPublishedSignature = '';
    const readSnapshot = chat => createTurnSnapshot(chat, getFloor());
    const trustedStoryDateFor = storageId => {
        const store = typeof getCalendarStore === 'function' ? getCalendarStore() : null;
        if (!store) return null;
        const reference = calendarReferenceDate(calendarScopeFor(store, storageId), null);
        return reference ? formatCalendarDate(reference) : null;
    };
    const publicTask = task => task ? Object.freeze({
        kind: task.kind,
        storageId: task.storageId,
        floor: task.floor,
        target: task.target ? Object.freeze({ ...task.target }) : null,
        ...(Number.isSafeInteger(task.commitSequence) && task.commitSequence > 0 ? { commitSequence: task.commitSequence } : {}),
        ...(Number.isSafeInteger(task.batchIndex) && task.batchIndex >= 0 ? { batchIndex: task.batchIndex } : {}),
        ...(Number.isSafeInteger(task.lastCommittedBatchIndex) && task.lastCommittedBatchIndex >= 0 ? { lastCommittedBatchIndex: task.lastCommittedBatchIndex } : {}),
        ...(Number.isSafeInteger(task.batchCount) && task.batchCount > 0 ? { batchCount: task.batchCount } : {}),
    }) : null;
    const state = () => Object.freeze({
        phase,
        task: publicTask(activeTask || terminalTask),
        lastError,
        lastErrorDetails,
        baselines: Object.fromEntries(baselines),
        observationCount: observations.size,
    });
    const publish = () => {
        const snapshot = state();
        const signature = JSON.stringify(snapshot);
        if (signature === lastPublishedSignature) return snapshot;
        lastPublishedSignature = signature;
        for (const listener of listeners) {
            try { listener(snapshot); } catch { /* Listener failures must not break scheduler state publication. */ }
        }
        return snapshot;
    };
    const setPhase = (nextPhase, error = lastError, details = null) => {
        phase = nextPhase;
        lastError = error;
        lastErrorDetails = nextPhase === 'failed' ? details : null;
        if (nextPhase === 'idle' || nextPhase === 'completed') terminalTask = null;
        return publish();
    };
    const subscribe = listener => {
        if (typeof listener !== 'function') throw new TypeError('今日风向状态订阅器必须是函数');
        listeners.add(listener);
        try { listener(state()); } catch { /* Subscription initialization is isolated from listener failures. */ }
        let subscribed = true;
        return () => {
            if (!subscribed) return false;
            subscribed = false;
            return listeners.delete(listener);
        };
    };
    const touch = observation => {
        observation.lastAccessedAt = now();
        observation.accessOrder = ++accessSequence;
        return observation;
    };
    const removeObservation = id => { observations.delete(id); baselines.delete(id); };
    const pruneObservations = () => {
        while (observations.size > OBSERVATION_LIMIT) {
            const currentId = String(getStorageId() || '').trim();
            const candidate = [...observations.entries()]
                .filter(([id, observation]) => id !== currentId && id !== activeTask?.storageId && validCount(observation.pendingTurns) === 0)
                .sort((left, right) => left[1].accessOrder - right[1].accessOrder)[0];
            if (!candidate) break;
            removeObservation(candidate[0]);
        }
    };
    const storeSnapshot = (id, snapshot, pendingTurns) => {
        const observation = touch({
            key: snapshot.key, floor: snapshot.floor, messageCount: snapshot.messageCount, assistantCount: snapshot.assistantCount,
            lastRole: snapshot.lastRole, lastMessageFingerprint: snapshot.lastMessageFingerprint,
            pendingTurns, rewindFloor: null,
        });
        observations.set(id, observation);
        pruneObservations();
        return observation;
    };

    const isActive = task => !!task && activeTask === task && !task.abortController.signal.aborted
        && getStorageId() === task.storageId;
    const cancel = (reason = 'today-trend-cancelled', resetObservation = false) => {
        sequence += 1;
        terminalTask = activeTask;
        activeTask?.abortController.abort(reason);
        activeTask = null;
        committer.invalidateCommits();
        if (resetObservation) {
            baselines.clear();
            observations.clear();
        } else pruneObservations();
        setPhase('canceled', null);
        return reason;
    };
    const acknowledge = () => {
        if (!activeTask) { terminalTask = null; return setPhase('idle', null); }
        return state();
    };
    const arm = (storageId = getStorageId(), chat = getChat()) => {
        const id = String(storageId || '').trim();
        if (!id) throw new Error('今日风向开始运作缺少有效聊天');
        if (id !== getStorageId()) throw new Error('今日风向只能为当前聊天开始运作');
        const snapshot = readSnapshot(chat);
        baselines.set(id, snapshot.floor);
        storeSnapshot(id, snapshot, 0);
        return snapshot.floor;
    };
    const currentFloor = (storageId = getStorageId()) => {
        const id = String(storageId || '').trim();
        return id && id === getStorageId() ? readSnapshot(getChat()).floor : validCount(observations.get(id)?.floor);
    };
    const rollIncident = probability => {
        const chance = Number(probability);
        if (!Number.isFinite(chance) || chance <= 0) return false;
        if (chance >= 100) return true;
        return (typeof random === 'function' ? random() : Math.random()) * 100 < chance;
    };
    const run = async ({ kind, storageId, floor, incidentProbability, target = null, summaryOnly = false, batchEnabled = false, recentAssistantCount, mergeAssistantCount } = {}) => {
        const id = String(storageId || getStorageId() || '').trim();
        if (!id) throw new Error('今日风向生成缺少有效聊天');
        if (activeTask) {
            if (kind !== 'manual') return false;
            cancel('today-trend-manual-replaces-active');
        }
        const currentFloor = floor === undefined
            ? readSnapshot(getChat()).floor : validCount(floor);
        const observation = observations.get(id);
        if (observation) touch(observation);
        const pendingTurns = observation?.pendingTurns;
        const task = {
            id: ++sequence, kind, storageId: id, floor: currentFloor,
            pendingTurns: Number.isInteger(pendingTurns) && pendingTurns >= 0 ? pendingTurns : 0,
            incidentProbability, target, summaryOnly: summaryOnly === true,
            abortController: new AbortController(), batchEnabled: batchEnabled === true, recentAssistantCount, mergeAssistantCount,
            commitSequence: 0, batchIndex: null, lastCommittedBatchIndex: null, batchCount: null,
        };
        terminalTask = null;
        activeTask = task;
        setPhase('queued', null);
        try {
            if (typeof committer.ready === 'function') await committer.ready();
            if (committer.isBlocked?.()) {
                const error = new Error('Today Trend 存在 blocked 恢复事务，拒绝开始生成');
                error.code = 'TT_TRANSACTION_BLOCKED';
                throw error;
            }
            if (!isActive(task)) throw cancelled();
            const chat = task.batchEnabled ? getChat() : null;
            let historyPlan = null;
            if (task.batchEnabled) {
                historyPlan = buildHistoryPlan({ messages: chat, recentAssistantCount: task.recentAssistantCount, mergeAssistantCount: task.mergeAssistantCount });
                task.batchCount = historyPlan.batchCount;
                publish();
            }
            if (!isActive(task)) throw cancelled();
            const source = await getStore();
            if (!isActive(task)) throw cancelled();
            const useCanonical = committer.supportsCanonical === true;
            if (task.batchEnabled) {
                if (!useCanonical || typeof committer.loadCanonical !== 'function') {
                    throw Object.assign(new Error('今日风向批处理需要 canonical 提交器'), { code: 'TT_V2_REQUIRED' });
                }
                const initialCanonical = await committer.loadCanonical();
                if (!isActive(task)) throw cancelled();
                const initialFacade = buildReadOnlyShadow(initialCanonical);
                const initialScope = initialFacade.scopes[id];
                const initialPreset = initialFacade.presets?.[initialScope?.presetId];
                const initialStoreRevision = initialCanonical.globalEnvelope.revision;
                const initialScopeRevision = initialCanonical.globalEnvelope.payload.scopes[id]?.revision;
                if (!initialScope || !initialPreset) throw new Error('当前聊天尚未今日风向');
                const initialSyncedAssistantCount = validCount(initialScope.operation?.lastSuccessfulAssistantCount);
                const fullRebuild = initialSyncedAssistantCount === 0 || historyPlan.windowStart === 1;
                if (!fullRebuild && historyPlan.windowStart !== initialSyncedAssistantCount + 1) {
                    const error = new Error(`批量窗口必须从已成功的第 ${initialSyncedAssistantCount + 1} 层开始；当前从第 ${historyPlan.windowStart} 层开始会破坏历史连续性`);
                    error.code = 'TT_BATCH_CONTINUITY_INVALID';
                    throw error;
                }
                if (fullRebuild) {
                    const resetCommitted = await committer.commitStore(store => {
                        if (historyMessageDigest(getChat()) !== historyPlan.sourceDigest) {
                            throw invalidHistoryInput('历史正文窗口消息源在批量更新启动期间已变化');
                        }
                        const current = buildReadOnlyShadow(store).scopes[id];
                        const currentPreset = buildReadOnlyShadow(store).presets?.[current?.presetId];
                        if (!isActive(task)) return store;
                        if (!current || current.presetId !== initialPreset.id || currentPreset?.revision !== initialPreset.revision
                            || !structurallyEqual(current, initialScope)) {
                            throw new Error('今日风向资料在批量更新启动期间已修改，拒绝清空旧内容');
                        }
                        return replaceTodayTrendV2ScopeWithBatchReset(store, id, now());
                    }, { active: () => isActive(task) }, { canonical: true, scopeId: id,
                        expectedStoreRevision: initialStoreRevision, expectedScopeRevision: initialScopeRevision });
                    if (!resetCommitted || !isActive(task)) throw cancelled();
                    task.commitSequence += 1;
                    publish();
                }
                let batchScope = null;
                let expectedBatchScope = null;
                let batchPreset = null;
                let expectedStoreRevision = null;
                let expectedScopeRevision = null;
                for (let batchIndex = 0; batchIndex < historyPlan.batchCount; batchIndex += 1) {
                    if (!isActive(task)) throw cancelled();
                    const batch = historyPlan.batches[batchIndex];
                    task.batchIndex = batchIndex;
                    publish();
                    const batchChat = getChat();
                    const batchAssistantCount = batch.assistantEnd;
                    const canonical = await committer.loadCanonical();
                    if (!isActive(task)) throw cancelled();
                    const facade = buildReadOnlyShadow(canonical);
                    expectedBatchScope = facade.scopes[id];
                    expectedStoreRevision = canonical.globalEnvelope.revision;
                    expectedScopeRevision = canonical.globalEnvelope.payload.scopes[id]?.revision;
                    batchScope = expectedBatchScope;
                    batchPreset = facade.presets?.[batchScope?.presetId];
                    if (!batchScope || !batchPreset) throw new Error('当前聊天尚未今日风向');
                    const batchPromptScope = getPromptScope ? await getPromptScope(id, canonical) : null;
                    if (getPromptScope && typeof batchPromptScope !== 'string') throw new Error('今日风向 canonical prompt scope 不可用');
                    const generated = await controller.generate({
                        signal: task.abortController.signal, scope: batchScope, preset: batchPreset, storageId: id,
                        characterId: batchScope.characterId, characterName: batchScope.characterName,
                        assistantCount: batchAssistantCount, allowIncident: false,
                        allowHistoricalIncidentRecord: batchScope.dynamicsSettings?.incident?.enabled === true,
                        target: null, summaryOnly: false, storyDate: trustedStoryDateFor(id), promptScope: batchPromptScope,
                        historyBatch: buildHistoryBatch(batchChat, historyPlan, batchIndex),
                        onPhase: next => { if (isActive(task)) setPhase(next, null); },
                    });
                    if (!isActive(task)) throw cancelled();
                    setPhase('committing', null);
                    const commitStartedAt = now();
                    const committed = await committer.commitStore(store => {
                        if (historyMessageDigest(getChat()) !== historyPlan.sourceDigest) {
                            throw invalidHistoryInput('历史正文窗口消息源在批次生成期间已变化');
                        }
                        const current = buildReadOnlyShadow(store).scopes[id];
                        const currentPreset = buildReadOnlyShadow(store).presets?.[current?.presetId];
                        if (!isActive(task)) return store;
                        if (!current || current.presetId !== batchPreset.id || currentPreset?.revision !== batchPreset.revision
                            || !structurallyEqual(current, expectedBatchScope)) {
                            throw new Error('今日风向资料在批次生成期间已修改，迟到结果已丢弃');
                        }
                        const trustedStoryDate = trustedStoryDateFor(id);
                        const generatedAt = now();
                        const nextScope = { ...generated.scope,
                            operation: { ...current.operation, lastSuccessfulAssistantCount: batchAssistantCount, lastSuccessfulRunAt: generatedAt },
                            injection: current.injection, generationSnapshots: batchScope.generationSnapshots };
                        return applyTodayTrendGenerationToV2(store, id, nextScope, generated.history ?? { events: [] }, {
                            trustedStoryDate, assistantCount: batchAssistantCount, generatedAt, snapshot: true,
                            archives: generated.archives ?? [],
                        });
                    }, { active: () => isActive(task) }, { canonical: true, scopeId: id,
                        expectedStoreRevision, expectedScopeRevision });
                    if (!committed || !isActive(task)) throw cancelled();
                    task.lastCommittedBatchIndex = batchIndex;
                    task.commitSequence += 1;
                    publish();
                    const remainingFeedback = Math.max(0, commitFeedbackMs - Math.max(0, now() - commitStartedAt));
                    if (remainingFeedback > 0) await wait(remainingFeedback);
                    if (!isActive(task)) throw cancelled();
                }
                baselines.set(id, task.floor);
                const currentObservation = observations.get(id);
                if (currentObservation) { currentObservation.pendingTurns = 0; touch(currentObservation); }
                setPhase('completed', null);
                return true;
            }
            const originalScope = source?.scopes?.[id];
            let scope = originalScope;
            let canonicalRerollSource = null;
            let rerollFromAssistantCount = null;
            let expectedCanonicalStoreRevision = null;
            let expectedCanonicalScopeRevision = null;
            if (useCanonical && kind === 'manual' && target === null && typeof committer.loadCanonical === 'function') {
                const canonical = await committer.loadCanonical();
                if (!isActive(task)) throw cancelled();
                const currentPayload = canonical?.globalEnvelope?.payload?.scopes?.[id]?.payload;
                if (!currentPayload) throw Object.assign(new Error('当前聊天尚未初始化今日风向'), { code: 'TT_V2_SCHEMA_INVALID' });
                const syncedFloor = currentPayload.operation?.lastSuccessfulAssistantCount;
                if (Number.isInteger(syncedFloor) && syncedFloor > task.floor) {
                    throw Object.assign(new Error('当前聊天楼层早于已同步 Today Trend，拒绝覆盖较新的 canonical 状态'), {
                        code: 'TT_REROLL_CHECKPOINT_INVALID',
                    });
                }
                if (syncedFloor === task.floor) {
                    const latestCheckpoint = currentPayload.generationSnapshots?.reduce((latest, item) => item.restoreCapability === 'full'
                        && item.assistantCount < task.floor && (!latest || item.assistantCount > latest.assistantCount)
                        ? item : latest, null);
                    if (latestCheckpoint) {
                        canonicalRerollSource = rollbackTodayTrendV2Scope(canonical, id, latestCheckpoint.assistantCount);
                        scope = buildReadOnlyShadow(canonicalRerollSource).scopes[id];
                        rerollFromAssistantCount = latestCheckpoint.assistantCount;
                        expectedCanonicalStoreRevision = canonical.globalEnvelope.revision;
                        expectedCanonicalScopeRevision = canonical.globalEnvelope.payload.scopes[id].revision;
                    }
                }
            }
            const preset = scope && source?.presets?.[scope.presetId];
            if (!scope || !preset) {
                removeObservation(id);
                throw new Error('当前聊天尚未初始化今日风向');
            }
            const trustedStoryDate = trustedStoryDateFor(id);
            const configuredProbability = scope.dynamicsSettings?.incident?.enabled
                ? scope.dynamicsSettings.incident.probability : 0;
            const effectiveIncidentProbability = scope.dynamicsSettings?.incident?.enabled
                ? (incidentProbability === undefined ? configuredProbability : incidentProbability) : 0;
            const promptScope = getPromptScope ? await getPromptScope(id, canonicalRerollSource) : null;
            if (getPromptScope && typeof promptScope !== 'string') throw new Error('今日风向 canonical prompt scope 不可用');
            if (!isActive(task)) throw cancelled();
            const generated = await controller.generate({
                signal: task.abortController.signal, scope, preset, storageId: id,
                characterId: scope.characterId, characterName: scope.characterName,
                assistantCount: task.floor, allowIncident: rollIncident(effectiveIncidentProbability),
                target: task.target, summaryOnly: task.summaryOnly, storyDate: trustedStoryDate, promptScope,
                ...(task.batchEnabled ? { historyBatch: buildHistoryBatch(chat, historyPlan, 0) } : {}),
                onPhase: next => { if (isActive(task)) setPhase(next, null); },
            });
            if (!isActive(task)) throw cancelled();
            setPhase('committing', null);
            const commitStartedAt = now();
            const committed = await committer.commitStore(store => {
                const facade = useCanonical ? buildReadOnlyShadow(store) : store;
                const current = facade.scopes[id];
                if (!isActive(task)) return store;
                const currentPreset = facade.presets?.[current?.presetId];
                if (!current || current.presetId !== preset.id || currentPreset?.revision !== preset.revision) {
                    throw new Error('今日风向资料已切换，迟到结果已丢弃');
                }
                if (JSON.stringify(current) !== JSON.stringify(originalScope)) {
                    throw new Error('今日风向资料在生成期间已修改，迟到结果已丢弃');
                }
                if (trustedStoryDateFor(id) !== trustedStoryDate) throw staleCalendar();
                const generatedAt = now();
                const nextScope = { ...generated.scope,
                    operation: task.target ? current.operation : {
                        ...current.operation, lastSuccessfulAssistantCount: task.floor, lastSuccessfulRunAt: generatedAt,
                    }, injection: current.injection, generationSnapshots: current.generationSnapshots };
                if (useCanonical) {
                    if (rerollFromAssistantCount !== null) {
                        return applyTodayTrendRerollToV2(store, id, rerollFromAssistantCount,
                            nextScope, generated.history ?? { events: [] }, {
                                trustedStoryDate, assistantCount: task.floor, generatedAt,
                            });
                    }
                    return applyTodayTrendGenerationToV2(store, id, nextScope, generated.history ?? { events: [] }, {
                        trustedStoryDate, assistantCount: task.floor, generatedAt, snapshot: !task.target,
                    });
                }
                if (generated.history?.events?.length) {
                    throw Object.assign(new Error('当前提交器不支持 canonical history 写入'), { code: 'TT_V2_REQUIRED' });
                }
                facade.scopes[id] = task.target ? nextScope : appendTodayTrendGenerationSnapshot(nextScope, task.floor, generatedAt);
                return store;
            }, { active: () => isActive(task) }, {
                canonical: useCanonical, scopeId: id,
                ...(rerollFromAssistantCount === null ? {} : {
                    expectedStoreRevision: expectedCanonicalStoreRevision,
                    expectedScopeRevision: expectedCanonicalScopeRevision,
                }),
            });
            if (!committed || !isActive(task)) throw cancelled();
            const remainingFeedback = Math.max(0, commitFeedbackMs - Math.max(0, now() - commitStartedAt));
            if (remainingFeedback > 0) await wait(remainingFeedback);
            if (!isActive(task)) throw cancelled();
            if (!task.target) {
                baselines.set(id, task.floor);
                const currentObservation = observations.get(id);
                const remainingTurns = currentObservation && Number.isInteger(currentObservation.pendingTurns)
                    ? Math.max(0, currentObservation.pendingTurns - task.pendingTurns) : 0;
                if (currentObservation) { currentObservation.pendingTurns = remainingTurns; touch(currentObservation); }
                else storeSnapshot(id, readSnapshot(getChat()), 0);
            }
            setPhase('completed', null);
            return committed;
        } catch (error) {
            if (activeTask === task) {
                if (error?.name === 'AbortError' || !isActive(task)) {
                    terminalTask = task;
                    setPhase('canceled', null);
                } else {
                    terminalTask = task;
                    setPhase('failed', error?.message || '今日风向生成失败', safeBatchError(error));
                }
            }
            throw error;
        } finally {
            if (activeTask === task) {
                activeTask = null;
                publish();
                const currentObservation = observations.get(id);
                if (phase === 'completed' && currentObservation?.pendingTurns > 0) {
                    Promise.resolve(getStore()).then(store => {
                        const operation = store?.scopes?.[id]?.operation;
                        if (observations.get(id) !== currentObservation
                            || getStorageId() !== id
                            || activeTask
                            || operation?.enabled !== true
                            || operation.mode !== 'auto'
                            || currentObservation.pendingTurns < operation.intervalFloors) return;
                        run({ kind: 'auto', storageId: id, floor: currentObservation.floor, incidentProbability: task.incidentProbability }).catch(() => {});
                    }).catch(() => {});
                }
                pruneObservations();
            }
        }
    };
    const manual = options => run({ ...options, kind: 'manual' });
    const rollback = async (id, snapshot) => {
        if (activeTask) cancel('today-trend-chat-rewound');
        const observationAtStart = observations.get(id);
        const task = Object.freeze({
            id: ++sequence, kind: 'rollback', storageId: id, floor: snapshot.floor,
            pendingTurns: 0, incidentProbability: 0, target: null, abortController: new AbortController(),
        });
        activeTask = task;
        setPhase('committing', null);
        const commitStartedAt = now();
        try {
            const useCanonical = committer.supportsCanonical === true;
            const committed = await committer.commitStore(store => {
                const facade = useCanonical ? buildReadOnlyShadow(store) : store;
                const current = facade.scopes[id];
                if (!current || !isActive(task)) return store;
                if (validCount(current.operation?.lastSuccessfulAssistantCount) <= snapshot.floor) return store;
                if (useCanonical) return rollbackTodayTrendV2Scope(store, id, snapshot.floor);
                facade.scopes[id] = rollbackTodayTrendScope(current, snapshot.floor);
                return store;
            }, { active: () => isActive(task) }, { canonical: useCanonical, scopeId: id });
            if (!committed || !isActive(task)) throw cancelled();
            const remainingFeedback = Math.max(0, commitFeedbackMs - Math.max(0, now() - commitStartedAt));
            if (remainingFeedback > 0) await wait(remainingFeedback);
            if (!isActive(task)) throw cancelled();
            baselines.set(id, snapshot.floor);
            const observation = observations.get(id);
            if (observation === observationAtStart && observation.rewindFloor === task.floor) {
                observation.rewindFloor = null;
            }
            setPhase('completed', null);
            return committed;
        } catch (error) {
            if (activeTask === task) {
                terminalTask = task;
                if (error?.name === 'AbortError' || !isActive(task)) setPhase('canceled', null);
                else setPhase('failed', error?.message || '今日风向回退失败', safeBatchError(error));
            }
            throw error;
        } finally {
            if (activeTask === task) {
                activeTask = null;
                publish();
                const observation = observations.get(id);
                if (phase === 'completed' && observation) {
                    Promise.resolve(getStore()).then(store => {
                        const operation = store?.scopes?.[id]?.operation;
                        if (observations.get(id) !== observation || getStorageId() !== id || activeTask) return;
                        if (Number.isInteger(observation.rewindFloor)
                            && observation.rewindFloor < validCount(operation?.lastSuccessfulAssistantCount)) {
                            rollback(id, { floor: observation.rewindFloor }).catch(() => {});
                            return;
                        }
                        if (operation?.enabled === true && operation.mode === 'auto'
                            && observation.pendingTurns >= operation.intervalFloors) {
                            run({ kind: 'auto', storageId: id, floor: observation.floor }).catch(() => {});
                        }
                    }).catch(() => {});
                }
                pruneObservations();
            }
        }
    };
    const observe = (chat, { incidentProbability } = {}) => {
        const snapshot = readSnapshot(chat);
        const id = String(getStorageId() || '').trim();
        if (!id || !snapshot.key) return null;
        let observation = observations.get(id);
        if (!observation) observation = storeSnapshot(id, snapshot, null);
        else {
            touch(observation);
            if (sameSnapshot(observation, snapshot)) return null;
            const addedFloors = snapshot.floor - observation.floor;
            Object.assign(observation, {
                key: snapshot.key, floor: snapshot.floor, messageCount: snapshot.messageCount, assistantCount: snapshot.assistantCount,
                lastRole: snapshot.lastRole, lastMessageFingerprint: snapshot.lastMessageFingerprint,
            });
            if (addedFloors < 0) {
                observation.pendingTurns = 0;
                observation.rewindFloor = Number.isInteger(observation.rewindFloor)
                    ? Math.min(observation.rewindFloor, snapshot.floor) : snapshot.floor;
            } else if (observation.pendingTurns !== null) {
                observation.pendingTurns += addedFloors;
            }
        }
        Promise.resolve(getStore()).then(store => {
            if (observations.get(id) !== observation) return;
            const scope = store?.scopes?.[id];
            if (!scope) { removeObservation(id); return; }
            const persisted = validCount(scope.operation?.lastSuccessfulAssistantCount);
            if (!Number.isInteger(observation.rewindFloor)
                && sameSnapshot(observation, snapshot)
                && snapshot.floor < persisted) {
                observation.pendingTurns = 0;
                observation.rewindFloor = snapshot.floor;
            }
            if (Number.isInteger(observation.rewindFloor) && observation.rewindFloor < persisted) {
                if (!activeTask || activeTask.kind !== 'rollback' || activeTask.storageId !== id) {
                    return rollback(id, { floor: observation.rewindFloor }).catch(() => {});
                }
                return;
            }
            if (!sameSnapshot(observation, snapshot)) return;
            if (!snapshot.lastIsAssistant) return;
            if (!scope.operation?.enabled || scope.operation.mode !== 'auto') return;
            if (observation.pendingTurns === null) {
                observation.pendingTurns = persisted ? Math.max(0, snapshot.floor - persisted) : 0;
                baselines.set(id, persisted || snapshot.floor);
            }
            if (!persisted && !baselines.has(id)) {
                baselines.set(id, snapshot.floor);
                return;
            }
            if (observation.pendingTurns < scope.operation.intervalFloors || activeTask) return;
            run({ kind: 'auto', storageId: id, floor: snapshot.floor, incidentProbability }).catch(() => {});
        }).catch(() => {});
        return snapshot;
    };
    return { acknowledge, arm, cancel, currentFloor, isActive, manual, observe, state, subscribe, run };
}
