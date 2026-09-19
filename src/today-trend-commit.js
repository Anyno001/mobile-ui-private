import { enqueueDirectoryOperation } from './directory-save-coordinator.js';
import {
    getTodayTrendStorageStatus, loadTodayTrendStore, loadTodayTrendV2Store, saveTodayTrendStore, todayTrendJournal,
} from './today-trend-storage.js';
import { normalizeTodayTrendStore } from './today-trend-model.js';
import { todayTrendStoreDigest } from './today-trend-journal.js';
import {
    buildReadOnlyShadow, copyTodayTrendV2ScopeForBranch, normalizeTodayTrendV2Candidate,
} from './today-trend-v2-model.js';

const clone = value => structuredClone(value);

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

const scopeEntries = value => value?.version === 2
    ? value.globalEnvelope?.payload?.scopes || {}
    : value?.scopes || {};
const scopeValue = entry => entry?.payload ?? entry;
const changedScopeIds = (previous, candidate) => [...new Set([
    ...Object.keys(scopeEntries(previous)), ...Object.keys(scopeEntries(candidate)),
])].filter(id => !structurallyEqual(
    scopeValue(scopeEntries(previous)[id]), scopeValue(scopeEntries(candidate)[id]),
)).sort();

const isV2Store = value => value?.version === 2 && Object.hasOwn(value, 'globalEnvelope');
const facadeStore = value => isV2Store(value) ? buildReadOnlyShadow(value) : normalizeTodayTrendStore(value);
const canonicalStore = (value, current = null) => normalizeTodayTrendV2Candidate(value, current);

function injectionFailure(result) {
    if (!result) return null;
    const failedWrites = Number.isInteger(result.failedWrites) ? result.failedWrites : 0;
    const failedKeys = Array.isArray(result.failedKeys) ? result.failedKeys.length : 0;
    return failedWrites || failedKeys ? new Error(`今日风向注入刷新失败：${failedWrites + failedKeys} 项写入或清理失败`) : null;
}

function savedStore(result, fallback) {
    return result && typeof result === 'object' && Object.hasOwn(result, 'store')
        ? normalizeTodayTrendStore(result.store)
        : normalizeTodayTrendStore(result ?? fallback);
}

export function createTodayTrendCommitter({
    runtime = {}, load = loadTodayTrendStore, save = saveTodayTrendStore, refreshInjection, prepareInjection,
    storageStatus = getTodayTrendStorageStatus, loadCanonical: loadCanonicalOption, journal: journalOption,
} = {}) {
    const journal = journalOption === undefined && load === loadTodayTrendStore && save === saveTodayTrendStore
        ? todayTrendJournal : journalOption;
    const loadCanonical = loadCanonicalOption === undefined && load === loadTodayTrendStore && save === saveTodayTrendStore
        ? loadTodayTrendV2Store : loadCanonicalOption;
    let generation = 0;
    let recoveryPromise = null;
    const active = task => !task || task.active?.() !== false;
    const invalidateCommits = () => { generation += 1; };

    const refresh = async store => {
        const result = await refreshInjection?.(store);
        const error = injectionFailure(result);
        if (error) throw error;
        return result;
    };

    const block = async (entry, error) => {
        try { await journal.markBlocked(entry, error); } catch (journalError) { error.journalError = journalError; }
        delete runtime.pendingInjectionStore;
        throw error;
    };

    const compensate = async (entry, previous, expectedStoreRevision, original) => {
        try {
            const compensation = journal.atomicTransition(entry, 'compensation-store-written', {
                compensationStoreRevision: expectedStoreRevision + 1,
            });
            const rolledBack = await save(previous, {
                scopeId: entry.scopeId,
                changedScopeIds: entry.affectedScopeIds,
                expectedStoreRevision,
                transactionId: entry.transactionId,
                journalWrite: compensation,
                returnReceipt: true,
            });
            entry = journal.acceptAtomicTransition(compensation.value);
            const previousFacade = facadeStore(previous);
            runtime.pendingInjectionStore = previousFacade;
            runtime.store = savedStore(rolledBack, previousFacade);
            await refresh(previousFacade);
            delete runtime.pendingInjectionStore;
            await journal.complete(entry, 'rejected', {
                lastErrorCode: String(original?.code || original?.name || 'TT_REJECTED'),
            });
            return false;
        } catch (rollbackError) {
            const message = original?.message || 'Today Trend 恢复要求补偿';
            const combined = new Error(`${message}；今日风向状态回滚失败：${rollbackError.message}`);
            combined.cause = original;
            combined.rollbackError = rollbackError;
            return block(entry, combined);
        }
    };

    const recoverEntry = async entry => {
        if (entry.phase === 'blocked') return false;
        const status = await storageStatus();
        const current = loadCanonical ? canonicalStore(await loadCanonical()) : normalizeTodayTrendStore(await load());
        const currentFacade = facadeStore(current);
        const revision = status.authority?.storeRevision;
        const digestFor = journalValue => todayTrendStoreDigest(isV2Store(journalValue) ? current : currentFacade);
        if (entry.phase === 'pending' || entry.phase === 'prepared') {
            if (revision === entry.baseStoreRevision && digestFor(entry.previous) === entry.previousDigest) {
                await journal.complete(entry, 'rejected');
                runtime.store = currentFacade;
                return true;
            }
            const error = Object.assign(new Error('Today Trend prepared journal 与权威 store 不一致'), { code: 'TT_RECOVERY_SPLIT_BRAIN' });
            return block(entry, error);
        }
        if (status.authority?.ownerTabId && !status.owned) {
            const error = Object.assign(new Error('Today Trend 恢复被崩溃或其他标签的 authority owner 阻断'), { code: 'TT_RECOVERY_AUTHORITY_BUSY' });
            return block(entry, error);
        }
        if (entry.phase === 'compensation-store-written') {
            if (revision !== entry.compensationStoreRevision || digestFor(entry.previous) !== entry.previousDigest) {
                const error = Object.assign(new Error('Today Trend 补偿 journal 与权威 store 不一致'), { code: 'TT_RECOVERY_SPLIT_BRAIN' });
                return block(entry, error);
            }
            const previousFacade = facadeStore(entry.previous);
            runtime.pendingInjectionStore = previousFacade;
            runtime.store = currentFacade;
            try {
                await refresh(previousFacade);
                delete runtime.pendingInjectionStore;
                await journal.complete(entry, 'rejected');
                return true;
            } catch (error) {
                return block(entry, error);
            }
        }
        if (revision !== entry.candidateStoreRevision || digestFor(entry.candidate) !== entry.candidateDigest) {
            const error = Object.assign(new Error('Today Trend candidate journal 与权威 store 不一致'), { code: 'TT_RECOVERY_SPLIT_BRAIN' });
            return block(entry, error);
        }
        runtime.store = currentFacade;
        if (entry.phase === 'compensation-requested') {
            const original = Object.assign(new Error('Today Trend 恢复未完成的补偿事务'), {
                code: entry.lastErrorCode || 'TT_COMPENSATION_REQUIRED',
            });
            return compensate(entry, entry.previous, entry.candidateStoreRevision, original);
        }
        if (entry.phase === 'injection-written') {
            await journal.complete(entry, 'accepted');
            return true;
        }
        if (entry.phase !== 'store-written') {
            const error = Object.assign(new Error(`Today Trend journal phase 无法恢复：${entry.phase}`), { code: 'TT_RECOVERY_PHASE_INVALID' });
            return block(entry, error);
        }
        const candidateFacade = facadeStore(entry.candidate);
        runtime.pendingInjectionStore = candidateFacade;
        try {
            await refresh(candidateFacade);
            delete runtime.pendingInjectionStore;
            const injected = await journal.transition(entry, 'injection-written');
            await journal.complete(injected, 'accepted');
            return true;
        } catch (error) {
            delete runtime.pendingInjectionStore;
            let compensationRequested;
            try {
                compensationRequested = await journal.transition(entry, 'compensation-requested', {
                    lastErrorCode: String(error?.code || error?.name || 'TT_INJECTION_RECOVERY_FAILED'),
                });
            } catch (transitionError) {
                transitionError.cause = error;
                return block(entry, transitionError);
            }
            return compensate(compensationRequested, entry.previous, entry.candidateStoreRevision, error);
        }
    };

    const recover = () => {
        if (!journal) return Promise.resolve([]);
        if (!recoveryPromise) recoveryPromise = journal.ready().then(async entries => {
            const results = [];
            for (const entry of entries) results.push(await recoverEntry(entry));
            delete runtime.recoveryError;
            return results;
        }).catch(error => {
            runtime.recoveryError = error;
            recoveryPromise = null;
            throw error;
        });
        return recoveryPromise;
    };

    const sagaCommit = async ({
        previous, candidate, previousFacade, candidateFacade, task, expectedGeneration, scopeId,
        expectedStoreRevision = null,
    }) => {
        const status = await storageStatus();
        if (!status.available || !status.owned || status.authority?.writeV2 !== true) return null;
        if (expectedStoreRevision !== null && status.authority.storeRevision !== expectedStoreRevision) {
            const error = new Error('今日风向 canonical store 已在生成期间变化，迟到结果已丢弃');
            error.code = 'TT_REROLL_STALE_SCOPE';
            throw error;
        }
        await prepareInjection?.(candidateFacade);
        let entry = await journal.begin({
            scopeId, affectedScopeIds: changedScopeIds(previous, candidate),
            baseStoreRevision: status.authority.storeRevision, previous, candidate,
        });
        const candidateRevision = status.authority.storeRevision + 1;
        const storeWritten = journal.atomicTransition(entry, 'store-written', { candidateStoreRevision: candidateRevision });
        let saved;
        try {
            saved = await save(candidate, {
                scopeId, changedScopeIds: entry.affectedScopeIds, expectedStoreRevision: expectedStoreRevision ?? entry.baseStoreRevision,
                transactionId: entry.transactionId, journalWrite: storeWritten, returnReceipt: true,
            });
            entry = journal.acceptAtomicTransition(storeWritten.value);
        } catch (error) {
            await journal.complete(entry, 'rejected', { lastErrorCode: String(error?.code || error?.name || 'TT_STORE_WRITE_FAILED') });
            throw error;
        }
        runtime.pendingInjectionStore = candidateFacade;
        let refreshError = null;
        try { await refresh(candidateFacade); }
        catch (error) { refreshError = error; }
        if (!refreshError && expectedGeneration === generation && active(task)) {
            runtime.store = savedStore(saved, candidateFacade);
            delete runtime.pendingInjectionStore;
            const injected = await journal.transition(entry, 'injection-written');
            await journal.complete(injected, 'accepted');
            return candidateFacade;
        }
        const original = refreshError || Object.assign(new Error('今日风向提交在任务取消后需要回滚'), { name: 'AbortError' });
        entry = await journal.transition(entry, 'compensation-requested', { lastErrorCode: String(original.code || original.name || 'TT_COMPENSATION_REQUIRED') });
        await compensate(entry, previous, saved.storeRevision, original);
        if (refreshError) throw refreshError;
        return false;
    };

    const commitStore = (mutate, task = null, options = {}) => {
        if (typeof mutate !== 'function') throw new TypeError('今日风向提交变更必须是函数');
        const scopeId = options.scopeId ?? null;
        const refreshEnabled = Object.hasOwn(options, 'refreshInjection')
            ? options.refreshInjection !== false : options.refresh !== false;
        const expectedStoreRevision = options.expectedStoreRevision;
        const expectedScopeRevision = options.expectedScopeRevision;
        if (options.canonical !== undefined && typeof options.canonical !== 'boolean') throw new TypeError('canonical 必须是布尔值');
        if (expectedStoreRevision !== undefined && (!Number.isSafeInteger(expectedStoreRevision) || expectedStoreRevision < 0)) {
            throw new TypeError('expectedStoreRevision 必须是非负安全整数');
        }
        if (expectedScopeRevision !== undefined && (!Number.isSafeInteger(expectedScopeRevision) || expectedScopeRevision < 0)) {
            throw new TypeError('expectedScopeRevision 必须是非负安全整数');
        }
        if ((expectedStoreRevision !== undefined || expectedScopeRevision !== undefined)
            && (options.canonical !== true || typeof scopeId !== 'string' || !scopeId)) {
            throw new TypeError('canonical revision fence 必须指定 canonical scopeId');
        }
        const expectedGeneration = generation;
        return enqueueDirectoryOperation('todayTrend', async () => {
            await recover();
            journal?.assertWritable(null);
            if (expectedGeneration !== generation || !active(task)) return false;
            const previous = loadCanonical ? canonicalStore(await loadCanonical()) : normalizeTodayTrendStore(await load());
            const previousFacade = facadeStore(previous);
            if (options.canonical && !loadCanonical) throw new TypeError('canonical mutation 需要 loadCanonical');
            if (expectedStoreRevision !== undefined && previous.globalEnvelope.revision !== expectedStoreRevision) {
                const error = new Error('今日风向 canonical store 已在生成期间变化，迟到结果已丢弃');
                error.code = 'TT_REROLL_STALE_SCOPE';
                throw error;
            }
            if (expectedScopeRevision !== undefined
                && previous.globalEnvelope.payload.scopes[scopeId]?.revision !== expectedScopeRevision) {
                const error = new Error('今日风向 canonical scope 已在生成期间变化，迟到结果已丢弃');
                error.code = 'TT_REROLL_STALE_SCOPE';
                throw error;
            }
            const mutated = await mutate(clone(options.canonical ? previous : previousFacade));
            const candidate = options.canonical ? canonicalStore(mutated)
                : loadCanonical ? canonicalStore(mutated, previous) : normalizeTodayTrendStore(mutated);
            const candidateFacade = facadeStore(candidate);
            if (expectedGeneration !== generation || !active(task)) return false;
            if (journal && refreshEnabled) {
                const sagaResult = await sagaCommit({
                    previous, candidate, previousFacade, candidateFacade, task, expectedGeneration, scopeId,
                    expectedStoreRevision: expectedStoreRevision ?? null,
                });
                if (sagaResult !== null) return sagaResult;
            }
            const affectedScopeIds = changedScopeIds(previous, candidate);
            const saved = await save(candidate, {
                scopeId, changedScopeIds: affectedScopeIds, allowAuthorityAcquire: true, returnReceipt: true,
                ...(expectedStoreRevision === undefined ? {} : { expectedStoreRevision }) });
            const committedCandidate = savedStore(saved, candidateFacade);
            runtime.store = committedCandidate;
            if (!refreshEnabled) return candidateFacade;
            let refreshError = null;
            try { refreshError = injectionFailure(await refreshInjection?.(candidateFacade)); }
            catch (error) { refreshError = error; }
            if (!refreshError && expectedGeneration === generation && active(task)) return candidateFacade;
            try {
                const rollbackOptions = {
                    scopeId, changedScopeIds: affectedScopeIds, allowAuthorityAcquire: true, returnReceipt: true };
                if (Number.isSafeInteger(saved?.storeRevision)) rollbackOptions.expectedStoreRevision = saved.storeRevision;
                const rolledBack = await save(previous, rollbackOptions);
                const restored = savedStore(rolledBack, previousFacade);
                runtime.store = restored;
                const rollbackError = injectionFailure(await refreshInjection?.(previousFacade));
                if (rollbackError) throw rollbackError;
            } catch (rollbackError) {
                const original = refreshError || new Error('今日风向提交在任务取消后需要回滚');
                const combined = new Error(`${original.message}；今日风向状态回滚失败：${rollbackError.message}`);
                combined.cause = original;
                combined.rollbackError = rollbackError;
                throw combined;
            }
            if (refreshError) throw refreshError;
            return false;
        });
    };

    const commitScope = (storageId, mutate, task = null, options = {}) => commitStore(async store => {
        if (typeof storageId !== 'string' || !storageId) throw new TypeError('今日风向角色资料 ID 必须是非空字符串');
        if (options.branchSourceId !== undefined && loadCanonical) {
            if (typeof options.branchSourceId !== 'string' || !options.branchSourceId) {
                throw new TypeError('今日风向分支来源 ID 必须是非空字符串');
            }
            const scopes = store.globalEnvelope.payload.scopes;
            const envelope = scopes[storageId];
            const currentScope = envelope ? facadeStore(store).scopes[storageId] : undefined;
            const scope = await mutate(clone(currentScope));
            if (scope === null) delete scopes[storageId];
            else {
                if (envelope) throw new Error('分支继承不得覆盖已存在的 canonical scope');
                if (!Number.isSafeInteger(options.targetAssistantCount) || options.targetAssistantCount < 0) {
                    throw new TypeError('今日风向分支目标楼层必须是非负安全整数');
                }
                const sourceEnvelope = scopes[options.branchSourceId];
                if (!sourceEnvelope) throw new Error('分支继承来源 canonical scope 不存在');
                scopes[storageId] = copyTodayTrendV2ScopeForBranch(
                    sourceEnvelope, storageId, options.targetAssistantCount,
                    store.globalEnvelope.payload.presets,
                );
            }
            return store;
        }
        if (options.canonical) {
            const scopes = store.globalEnvelope.payload.scopes;
            const envelope = scopes[storageId];
            const payload = await mutate(clone(envelope?.payload));
            if (payload === null) delete scopes[storageId];
            else {
                if (!envelope) throw new Error('canonical scope 不存在，必须通过整树 mutation 创建');
                scopes[storageId] = { ...envelope, payload };
            }
            return store;
        }
        const scope = await mutate(clone(store.scopes[storageId]));
        if (scope === null) delete store.scopes[storageId];
        else store.scopes[storageId] = scope;
        return store;
    }, task, {
        ...options,
        canonical: options.canonical === true || (options.branchSourceId !== undefined && !!loadCanonical),
        scopeId: storageId,
    });

    const api = { commitStore, commitScope, invalidateCommits, recover, loadCanonical,
        supportsCanonical: typeof loadCanonical === 'function' };
    if (journal) Object.assign(api, { ready: recover, isBlocked: () => journal.blocked() === true });
    return api;
}
