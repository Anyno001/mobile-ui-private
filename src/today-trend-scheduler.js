const cancelled = () => Object.assign(new Error('今日风向生成已取消'), { name: 'AbortError' });
const validCount = value => Number.isInteger(value) && value >= 0 ? value : 0;
const messageText = message => ['mes', 'message', 'content']
    .map(key => typeof message?.[key] === 'string' ? message[key].trim() : '')
    .find(Boolean) || '';
const messageRole = message => {
    const role = typeof message?.role === 'string' ? message.role.toLowerCase() : '';
    if (message?.is_system === true || role === 'system') return 'system';
    if (message?.is_user === true || role === 'user') return 'user';
    return 'assistant';
};
const createTurnSnapshot = chat => {
    const messages = Array.isArray(chat) ? chat.filter(message => message && typeof message === 'object' && messageText(message)) : [];
    const last = messages.at(-1);
    const assistantCount = messages.filter(message => messageRole(message) === 'assistant').length;
    const key = messages.map((message, index) => `${index}:${messageRole(message)}:${messageText(message)}`).join('\n');
    return Object.freeze({ key, assistantCount, lastIsAssistant: messageRole(last) === 'assistant' });
};

export function createTodayTrendScheduler({
    controller, committer, getStore, getStorageId, getChat = () => [], random = Math.random, now = () => Date.now(),
} = {}) {
    if (!controller || typeof controller.generate !== 'function') throw new TypeError('今日风向调度器缺少生成控制器');
    if (!committer || typeof committer.commitStore !== 'function' || typeof committer.invalidateCommits !== 'function') throw new TypeError('今日风向调度器缺少事务提交器');
    if (typeof getStore !== 'function' || typeof getStorageId !== 'function') throw new TypeError('今日风向调度器缺少存储或聊天读取器');
    let sequence = 0;
    let activeTask = null;
    let phase = 'idle';
    let lastError = null;
    const baselines = new Map();
    const observations = new Map();

    const isActive = task => !!task && activeTask === task && !task.abortController.signal.aborted
        && getStorageId() === task.storageId;
    const cancel = (reason = 'today-trend-cancelled', resetObservation = false) => {
        sequence += 1;
        activeTask?.abortController.abort(reason);
        activeTask = null;
        phase = 'canceled';
        lastError = null;
        committer.invalidateCommits();
        if (resetObservation) {
            baselines.clear();
            observations.clear();
        }
        return reason;
    };
    const state = () => Object.freeze({ phase, task: activeTask, lastError, baselines: Object.fromEntries(baselines) });
    const acknowledge = () => { if (!activeTask) { phase = 'idle'; lastError = null; } return state(); };
    const arm = (storageId = getStorageId(), chat = getChat()) => {
        const id = String(storageId || '').trim();
        if (!id) throw new Error('今日风向开始运作缺少有效聊天');
        if (id !== getStorageId()) throw new Error('今日风向只能为当前聊天开始运作');
        const snapshot = createTurnSnapshot(chat);
        baselines.set(id, snapshot.assistantCount);
        observations.set(id, { key: snapshot.key, assistantCount: snapshot.assistantCount, pendingTurns: 0 });
        return snapshot.assistantCount;
    };
    const rollIncident = probability => {
        const chance = Number(probability);
        if (!Number.isFinite(chance) || chance <= 0) return false;
        if (chance >= 100) return true;
        return (typeof random === 'function' ? random() : Math.random()) * 100 < chance;
    };
    const run = async ({ kind, storageId, assistantCount, incidentProbability, target = null } = {}) => {
        const id = String(storageId || getStorageId() || '').trim();
        if (!id) throw new Error('今日风向生成缺少有效聊天');
        if (activeTask) {
            if (kind !== 'manual') return false;
            cancel('today-trend-manual-replaces-active');
        }
        const currentAssistantCount = assistantCount === undefined
            ? createTurnSnapshot(getChat()).assistantCount : validCount(assistantCount);
        const pendingTurns = observations.get(id)?.pendingTurns;
        const task = Object.freeze({
            id: ++sequence, kind, storageId: id, assistantCount: currentAssistantCount,
            pendingTurns: Number.isInteger(pendingTurns) && pendingTurns >= 0 ? pendingTurns : 0,
            incidentProbability, target,
            abortController: new AbortController(),
        });
        activeTask = task;
        phase = 'queued';
        lastError = null;
        try {
            const source = await getStore();
            if (!isActive(task)) throw cancelled();
            const scope = source?.scopes?.[id];
            const preset = scope && source?.presets?.[scope.presetId];
            if (!scope || !preset) throw new Error('当前聊天尚未初始化今日风向');
            const configuredProbability = scope.dynamicsSettings?.incident?.enabled
                ? scope.dynamicsSettings.incident.probability : 0;
            const effectiveIncidentProbability = incidentProbability === undefined ? configuredProbability : incidentProbability;
            const generated = await controller.generate({
                signal: task.abortController.signal, scope, preset, storageId: id,
                characterId: scope.characterId, characterName: scope.characterName,
                assistantCount: task.assistantCount, allowIncident: rollIncident(effectiveIncidentProbability),
                target: task.target, onPhase: next => { if (isActive(task)) phase = next; },
            });
            if (!isActive(task)) throw cancelled();
            phase = 'committing';
            const committed = await committer.commitStore(store => {
                const current = store.scopes[id];
                if (!isActive(task)) return store;
                const currentPreset = store.presets?.[current?.presetId];
                if (!current || current.presetId !== preset.id || currentPreset?.revision !== preset.revision) {
                    throw new Error('今日风向资料已切换，迟到结果已丢弃');
                }
                if (JSON.stringify(current) !== JSON.stringify(scope)) {
                    throw new Error('今日风向资料在生成期间已修改，迟到结果已丢弃');
                }
                store.scopes[id] = { ...generated.scope,
                    operation: task.target ? current.operation : {
                        ...current.operation, lastSuccessfulAssistantCount: task.assistantCount, lastSuccessfulRunAt: now(),
                    }, injection: current.injection };
                return store;
            }, { active: () => isActive(task) });
            if (!committed || !isActive(task)) throw cancelled();
            if (!task.target) {
                baselines.set(id, task.assistantCount);
                const observation = observations.get(id);
                const remainingTurns = observation && Number.isInteger(observation.pendingTurns)
                    ? Math.max(0, observation.pendingTurns - task.pendingTurns) : 0;
                if (observation) observation.pendingTurns = remainingTurns;
                else {
                    const snapshot = createTurnSnapshot(getChat());
                    observations.set(id, { key: snapshot.key, assistantCount: snapshot.assistantCount, pendingTurns: 0 });
                }
            }
            phase = 'completed';
            return committed;
        } catch (error) {
            if (activeTask === task) {
                if (error?.name === 'AbortError' || !isActive(task)) {
                    phase = 'canceled';
                    lastError = null;
                } else {
                    phase = 'failed';
                    lastError = error?.message || '今日风向生成失败';
                }
            }
            throw error;
        } finally {
            if (activeTask === task) {
                activeTask = null;
                const observation = observations.get(id);
                if (phase === 'completed' && observation?.pendingTurns > 0) {
                    Promise.resolve(getStore()).then(store => {
                        const interval = store?.scopes?.[id]?.operation?.intervalFloors;
                        if (observation.pendingTurns >= interval) run({ kind: 'auto', storageId: id, incidentProbability: task.incidentProbability }).catch(() => {});
                    }).catch(() => {});
                }
            }
        }
    };
    const manual = options => run({ ...options, kind: 'manual' });
    const observe = (chat, { incidentProbability } = {}) => {
        const snapshot = createTurnSnapshot(chat);
        const id = String(getStorageId() || '').trim();
        if (!id || !snapshot.lastIsAssistant || !snapshot.key) return null;
        let observation = observations.get(id);
        if (!observation) {
            observation = { key: snapshot.key, assistantCount: snapshot.assistantCount, pendingTurns: null };
            observations.set(id, observation);
        } else {
            if (observation.key === snapshot.key) return null;
            const addedAssistantCount = snapshot.assistantCount - observation.assistantCount;
            observation.key = snapshot.key;
            observation.assistantCount = snapshot.assistantCount;
            if (addedAssistantCount <= 0) return snapshot;
            if (observation.pendingTurns !== null) observation.pendingTurns += addedAssistantCount;
        }
        Promise.resolve(getStore()).then(store => {
            if (observations.get(id) !== observation || observation.key !== snapshot.key) return;
            const scope = store?.scopes?.[id];
            if (!scope?.operation?.enabled || scope.operation.mode !== 'auto') return;
            const persisted = validCount(scope.operation.lastSuccessfulAssistantCount);
            if (observation.pendingTurns === null) {
                observation.pendingTurns = persisted ? Math.max(0, snapshot.assistantCount - persisted) : 0;
                baselines.set(id, persisted || snapshot.assistantCount);
            }
            if (!persisted && !baselines.has(id)) {
                baselines.set(id, snapshot.assistantCount);
                return;
            }
            if (observation.pendingTurns < scope.operation.intervalFloors || activeTask) return;
            run({ kind: 'auto', storageId: id, assistantCount: snapshot.assistantCount, incidentProbability }).catch(() => {});
        }).catch(() => {});
        return snapshot;
    };
    return { acknowledge, arm, cancel, isActive, manual, observe, state, run };
}
