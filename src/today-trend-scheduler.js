const cancelled = () => Object.assign(new Error('今日风向生成已取消'), { name: 'AbortError' });
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
    if (message?.is_system === true || role === 'system') return 'system';
    if (message?.is_user === true || role === 'user') return 'user';
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
const createTurnSnapshot = chat => {
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
        key: hashHex(sessionHash), messageCount, assistantCount, lastRole, lastMessageFingerprint,
        lastIsAssistant: lastRole === 'assistant',
    });
};
const sameSnapshot = (observation, snapshot) => observation?.key === snapshot.key
    && observation.messageCount === snapshot.messageCount
    && observation.assistantCount === snapshot.assistantCount
    && observation.lastRole === snapshot.lastRole
    && observation.lastMessageFingerprint === snapshot.lastMessageFingerprint;

export function createTodayTrendScheduler({
    controller, committer, getStore, getStorageId, getChat = () => [], random = Math.random, now = () => Date.now(),
} = {}) {
    if (!controller || typeof controller.generate !== 'function') throw new TypeError('今日风向调度器缺少生成控制器');
    if (!committer || typeof committer.commitStore !== 'function' || typeof committer.invalidateCommits !== 'function') throw new TypeError('今日风向调度器缺少事务提交器');
    if (typeof getStore !== 'function' || typeof getStorageId !== 'function') throw new TypeError('今日风向调度器缺少存储或聊天读取器');
    let sequence = 0;
    let accessSequence = 0;
    let activeTask = null;
    let phase = 'idle';
    let lastError = null;
    const baselines = new Map();
    const observations = new Map();
    const listeners = new Set();
    let lastPublishedSignature = '';
    const publicTask = task => task ? Object.freeze({
        kind: task.kind,
        storageId: task.storageId,
        assistantCount: task.assistantCount,
        target: task.target ? Object.freeze({ ...task.target }) : null,
    }) : null;
    const state = () => Object.freeze({
        phase,
        task: publicTask(activeTask),
        lastError,
        baselines: Object.fromEntries(baselines),
        observationCount: observations.size,
    });
    const publish = () => {
        const snapshot = state();
        const signature = JSON.stringify(snapshot);
        if (signature === lastPublishedSignature) return snapshot;
        lastPublishedSignature = signature;
        for (const listener of listeners) {
            try { listener(snapshot); } catch {}
        }
        return snapshot;
    };
    const setPhase = (nextPhase, error = lastError) => {
        phase = nextPhase;
        lastError = error;
        return publish();
    };
    const subscribe = listener => {
        if (typeof listener !== 'function') throw new TypeError('今日风向状态订阅器必须是函数');
        listeners.add(listener);
        try { listener(state()); } catch {}
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
            key: snapshot.key, messageCount: snapshot.messageCount, assistantCount: snapshot.assistantCount,
            lastRole: snapshot.lastRole, lastMessageFingerprint: snapshot.lastMessageFingerprint, pendingTurns,
        });
        observations.set(id, observation);
        pruneObservations();
        return observation;
    };

    const isActive = task => !!task && activeTask === task && !task.abortController.signal.aborted
        && getStorageId() === task.storageId;
    const cancel = (reason = 'today-trend-cancelled', resetObservation = false) => {
        sequence += 1;
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
        if (!activeTask) return setPhase('idle', null);
        return state();
    };
    const arm = (storageId = getStorageId(), chat = getChat()) => {
        const id = String(storageId || '').trim();
        if (!id) throw new Error('今日风向开始运作缺少有效聊天');
        if (id !== getStorageId()) throw new Error('今日风向只能为当前聊天开始运作');
        const snapshot = createTurnSnapshot(chat);
        baselines.set(id, snapshot.assistantCount);
        storeSnapshot(id, snapshot, 0);
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
        const observation = observations.get(id);
        if (observation) touch(observation);
        const pendingTurns = observation?.pendingTurns;
        const task = Object.freeze({
            id: ++sequence, kind, storageId: id, assistantCount: currentAssistantCount,
            pendingTurns: Number.isInteger(pendingTurns) && pendingTurns >= 0 ? pendingTurns : 0,
            incidentProbability, target,
            abortController: new AbortController(),
        });
        activeTask = task;
        setPhase('queued', null);
        try {
            const source = await getStore();
            if (!isActive(task)) throw cancelled();
            const scope = source?.scopes?.[id];
            const preset = scope && source?.presets?.[scope.presetId];
            if (!scope || !preset) {
                removeObservation(id);
                throw new Error('当前聊天尚未初始化今日风向');
            }
            const configuredProbability = scope.dynamicsSettings?.incident?.enabled
                ? scope.dynamicsSettings.incident.probability : 0;
            const effectiveIncidentProbability = incidentProbability === undefined ? configuredProbability : incidentProbability;
            const generated = await controller.generate({
                signal: task.abortController.signal, scope, preset, storageId: id,
                characterId: scope.characterId, characterName: scope.characterName,
                assistantCount: task.assistantCount, allowIncident: rollIncident(effectiveIncidentProbability),
                target: task.target, onPhase: next => { if (isActive(task)) setPhase(next, null); },
            });
            if (!isActive(task)) throw cancelled();
            setPhase('committing', null);
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
                const currentObservation = observations.get(id);
                const remainingTurns = currentObservation && Number.isInteger(currentObservation.pendingTurns)
                    ? Math.max(0, currentObservation.pendingTurns - task.pendingTurns) : 0;
                if (currentObservation) { currentObservation.pendingTurns = remainingTurns; touch(currentObservation); }
                else storeSnapshot(id, createTurnSnapshot(getChat()), 0);
            }
            setPhase('completed', null);
            return committed;
        } catch (error) {
            if (activeTask === task) {
                if (error?.name === 'AbortError' || !isActive(task)) {
                    setPhase('canceled', null);
                } else {
                    setPhase('failed', error?.message || '今日风向生成失败');
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
                        run({ kind: 'auto', storageId: id, incidentProbability: task.incidentProbability }).catch(() => {});
                    }).catch(() => {});
                }
                pruneObservations();
            }
        }
    };
    const manual = options => run({ ...options, kind: 'manual' });
    const observe = (chat, { incidentProbability } = {}) => {
        const snapshot = createTurnSnapshot(chat);
        const id = String(getStorageId() || '').trim();
        if (!id || !snapshot.lastIsAssistant || !snapshot.key) return null;
        let observation = observations.get(id);
        if (!observation) observation = storeSnapshot(id, snapshot, null);
        else {
            touch(observation);
            if (sameSnapshot(observation, snapshot)) return null;
            const addedAssistantCount = snapshot.assistantCount - observation.assistantCount;
            Object.assign(observation, {
                key: snapshot.key, messageCount: snapshot.messageCount, assistantCount: snapshot.assistantCount,
                lastRole: snapshot.lastRole, lastMessageFingerprint: snapshot.lastMessageFingerprint,
            });
            if (addedAssistantCount <= 0) return snapshot;
            if (observation.pendingTurns !== null) observation.pendingTurns += addedAssistantCount;
        }
        Promise.resolve(getStore()).then(store => {
            if (observations.get(id) !== observation || !sameSnapshot(observation, snapshot)) return;
            const scope = store?.scopes?.[id];
            if (!scope) { removeObservation(id); return; }
            if (!scope.operation?.enabled || scope.operation.mode !== 'auto') return;
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
    return { acknowledge, arm, cancel, isActive, manual, observe, state, subscribe, run };
}
