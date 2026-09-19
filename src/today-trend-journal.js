import { TODAY_TREND_V2_JOURNAL_PREFIX } from './constants.js';
import { pmIDBDel, pmIDBKeys, pmIDBReadEntry, pmIDBSet } from './pm-idb.js';

const VERSION = 1;
export const TODAY_TREND_JOURNAL_PHASES = Object.freeze([
    'pending', 'prepared', 'store-written', 'injection-written',
    'compensation-requested', 'compensation-store-written', 'accepted', 'rejected', 'blocked',
]);
const PHASES = new Set(TODAY_TREND_JOURNAL_PHASES);
const TERMINAL = new Set(['accepted', 'rejected']);
const TRANSITIONS = Object.freeze({
    pending: new Set(['prepared', 'rejected', 'blocked']),
    prepared: new Set(['store-written', 'rejected', 'blocked']),
    'store-written': new Set(['injection-written', 'compensation-requested', 'blocked']),
    'injection-written': new Set(['accepted', 'blocked']),
    'compensation-requested': new Set(['compensation-store-written', 'blocked']),
    'compensation-store-written': new Set(['rejected', 'blocked']),
    blocked: new Set(), accepted: new Set(), rejected: new Set(),
});
const clone = value => structuredClone(value);

function failure(code, message, cause) {
    const error = new Error(message, cause === undefined ? undefined : { cause });
    error.code = code;
    return error;
}

function safeInteger(value, field, { nullable = false } = {}) {
    if (nullable && value === null) return null;
    if (!Number.isSafeInteger(value) || value < 0) throw failure('TT_JOURNAL_INVALID', `${field} 必须是非负安全整数`);
    return value;
}

function canonical(value) {
    if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
    if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
    return JSON.stringify(value);
}

function digestValue(value) {
    if (value?.version !== 2 || !value.globalEnvelope?.payload?.scopes) return value;
    const normalized = clone(value);
    normalized.globalEnvelope.revision = 0;
    for (const envelope of Object.values(normalized.globalEnvelope.payload.scopes)) {
        if (envelope && typeof envelope === 'object') envelope.revision = 0;
    }
    return normalized;
}

export function todayTrendStoreDigest(value) {
    const text = canonical(digestValue(value));
    let hash = 2166136261;
    for (let index = 0; index < text.length; index += 1) {
        hash ^= text.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    return `fnv1a32:${(hash >>> 0).toString(16).padStart(8, '0')}:${text.length}`;
}

export function todayTrendJournalKey(scopeId, transactionId) {
    const scope = scopeId === null ? '__global__' : String(scopeId || '').trim();
    const transaction = String(transactionId || '').trim();
    if (!scope || !transaction) throw new TypeError('Today Trend journal key 缺少 scopeId 或 transactionId');
    return `${TODAY_TREND_V2_JOURNAL_PREFIX}${encodeURIComponent(scope)}:${encodeURIComponent(transaction)}`;
}

function assertRevisionInvariant(entry) {
    const { phase, baseStoreRevision, candidateStoreRevision, compensationStoreRevision } = entry;
    const hasCandidate = candidateStoreRevision !== null;
    const hasCompensation = compensationStoreRevision !== null;
    if (candidateStoreRevision !== null && candidateStoreRevision !== baseStoreRevision + 1) {
        throw failure('TT_JOURNAL_INVALID', 'Today Trend journal candidateStoreRevision 必须等于 baseStoreRevision + 1');
    }
    if (hasCompensation && (!hasCandidate || compensationStoreRevision !== candidateStoreRevision + 1)) {
        throw failure('TT_JOURNAL_INVALID', 'Today Trend journal compensationStoreRevision 必须等于 candidateStoreRevision + 1');
    }
    if ((phase === 'pending' || phase === 'prepared') && (hasCandidate || hasCompensation)) {
        throw failure('TT_JOURNAL_INVALID', `Today Trend journal ${phase} phase 不得包含已提交 revision`);
    }
    if (new Set(['store-written', 'injection-written', 'compensation-requested', 'accepted']).has(phase)
        && (!hasCandidate || hasCompensation)) {
        throw failure('TT_JOURNAL_INVALID', `Today Trend journal ${phase} phase 只允许 candidateStoreRevision`);
    }
    if (phase === 'compensation-store-written' && (!hasCandidate || !hasCompensation)) {
        throw failure('TT_JOURNAL_INVALID', 'Today Trend journal compensation-store-written phase 缺少提交 revision');
    }
    if (phase === 'rejected' && hasCandidate !== hasCompensation) {
        throw failure('TT_JOURNAL_INVALID', 'Today Trend journal rejected phase revision 来源无效');
    }
    if (!new Set(['pending', 'prepared', 'rejected', 'blocked']).has(phase)
        && !hasCandidate) {
        throw failure('TT_JOURNAL_INVALID', `Today Trend journal ${phase} phase 缺少 candidateStoreRevision`);
    }
}

export function normalizeTodayTrendJournal(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw failure('TT_JOURNAL_INVALID', 'Today Trend journal 必须是对象');
    if (value.schemaVersion > VERSION) throw failure('TT_JOURNAL_FUTURE_VERSION', 'Today Trend journal 版本高于当前支持版本');
    if (value.schemaVersion !== VERSION || !PHASES.has(value.phase)) throw failure('TT_JOURNAL_INVALID', 'Today Trend journal 版本或 phase 无效');
    const transactionId = String(value.transactionId || '').trim();
    const scopeId = value.scopeId === null ? null : String(value.scopeId || '').trim();
    if (!transactionId || (scopeId !== null && !scopeId)) throw failure('TT_JOURNAL_INVALID', 'Today Trend journal 标识无效');
    const affectedScopeIds = [...new Set((value.affectedScopeIds || []).map(item => String(item || '').trim()))].filter(Boolean).sort();
    const normalized = {
        schemaVersion: VERSION, transactionId, scopeId, affectedScopeIds, phase: value.phase,
        baseStoreRevision: safeInteger(value.baseStoreRevision, 'baseStoreRevision'),
        candidateStoreRevision: safeInteger(value.candidateStoreRevision, 'candidateStoreRevision', { nullable: true }),
        compensationStoreRevision: safeInteger(value.compensationStoreRevision, 'compensationStoreRevision', { nullable: true }),
        previousDigest: String(value.previousDigest || ''), candidateDigest: String(value.candidateDigest || ''),
        previous: value.previous === null ? null : clone(value.previous), candidate: value.candidate === null ? null : clone(value.candidate),
        createdAt: safeInteger(value.createdAt, 'createdAt'), updatedAt: safeInteger(value.updatedAt, 'updatedAt'),
        attemptCount: safeInteger(value.attemptCount ?? 0, 'attemptCount'), lastErrorCode: value.lastErrorCode ? String(value.lastErrorCode) : null,
    };
    assertRevisionInvariant(normalized);
    return normalized;
}


const isJournalKey = key => typeof key === 'string' && key.startsWith(TODAY_TREND_V2_JOURNAL_PREFIX);

export function createTodayTrendJournal({
    listKeys = pmIDBKeys, readEntry = pmIDBReadEntry, writeEntry = pmIDBSet, deleteEntry = pmIDBDel,
    now = () => Date.now(), transactionId = () => globalThis.crypto?.randomUUID?.()
        || `tx-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`,
} = {}) {
    let readyPromise = null;
    const openEntries = new Map();
    const snapshot = () => Object.freeze([...openEntries.values()].map(clone));
    const load = async () => {
        const keys = await listKeys();
        if (!Array.isArray(keys)) throw failure('TT_JOURNAL_UNAVAILABLE', '无法枚举 Today Trend journal');
        openEntries.clear();
        for (const key of keys.filter(isJournalKey)) {
            const entry = await readEntry(key);
            if (!entry?.ok) throw failure('TT_JOURNAL_UNAVAILABLE', `无法读取 Today Trend journal：${key}`);
            if (entry.value === undefined) continue;
            const normalized = normalizeTodayTrendJournal(entry.value);
            if (TERMINAL.has(normalized.phase)) {
                try {
                    if (!await deleteEntry(key)) console.warn('[phone-mode] Today Trend terminal journal 启动清理失败', key);
                } catch (error) {
                    console.warn('[phone-mode] Today Trend terminal journal 启动清理失败', key, error);
                }
            } else openEntries.set(normalized.transactionId, normalized);
        }
        return snapshot();
    };
    const ready = () => readyPromise || (readyPromise = load().catch(error => {
        readyPromise = null;
        throw error;
    }));
    const blocked = () => [...openEntries.values()].some(entry => entry.phase === 'blocked');
    const assertWritable = allowedTransactionId => {
        const foreign = [...openEntries.values()].find(entry => entry.transactionId !== allowedTransactionId);
        if (foreign) throw failure(foreign.phase === 'blocked' ? 'TT_TRANSACTION_BLOCKED' : 'TT_RECOVERY_REQUIRED',
            `Today Trend 存在未完成事务：${foreign.transactionId}`);
    };
    const persist = async entry => {
        const normalized = normalizeTodayTrendJournal(entry);
        const key = todayTrendJournalKey(normalized.scopeId, normalized.transactionId);
        if (!await writeEntry(key, normalized)) throw failure('TT_JOURNAL_UNAVAILABLE', 'Today Trend journal 写入失败');
        if (TERMINAL.has(normalized.phase)) openEntries.delete(normalized.transactionId);
        else openEntries.set(normalized.transactionId, normalized);
        return clone(normalized);
    };
    const begin = async ({ scopeId = null, affectedScopeIds = [], baseStoreRevision, previous, candidate }) => {
        await ready();
        assertWritable(null);
        const id = String(transactionId() || '').trim();
        if (!id || openEntries.has(id)) throw failure('TT_JOURNAL_INVALID', '无法生成唯一 Today Trend transactionId');
        const timestamp = now();
        return persist({
            schemaVersion: VERSION, transactionId: id, scopeId, affectedScopeIds, phase: 'prepared',
            baseStoreRevision, candidateStoreRevision: null, compensationStoreRevision: null,
            previousDigest: todayTrendStoreDigest(previous), candidateDigest: todayTrendStoreDigest(candidate),
            previous, candidate, createdAt: timestamp, updatedAt: timestamp, attemptCount: 0, lastErrorCode: null,
        });
    };
    const assertCurrent = entry => {
        const current = openEntries.get(entry.transactionId);
        if (!current || current.phase !== entry.phase || current.updatedAt !== entry.updatedAt) {
            throw failure('TT_JOURNAL_STALE', `Today Trend journal entry 已过期：${entry.transactionId}`);
        }
        return current;
    };
    const assertTransition = (from, to) => {
        if (!PHASES.has(to)) throw failure('TT_JOURNAL_INVALID', `未知 Today Trend journal phase：${to}`);
        if (!TRANSITIONS[from]?.has(to)) {
            throw failure('TT_JOURNAL_TRANSITION_INVALID', `Today Trend journal 非法迁移：${from} -> ${to}`);
        }
    };
    const transition = async (entry, phase, changes = {}) => {
        const supplied = normalizeTodayTrendJournal(entry);
        const current = assertCurrent(supplied);
        assertTransition(current.phase, phase);
        return persist({ ...current, ...changes, phase, updatedAt: now() });
    };
    const atomicTransition = (entry, phase, changes = {}) => {
        const supplied = normalizeTodayTrendJournal(entry);
        const current = assertCurrent(supplied);
        if (phase !== 'store-written' && phase !== 'compensation-store-written') {
            throw failure('TT_JOURNAL_INVALID', '只有 store 写入 phase 可进入 authority 原子事务');
        }
        assertTransition(current.phase, phase);
        const normalized = normalizeTodayTrendJournal({ ...current, ...changes, phase, updatedAt: now() });
        return { key: todayTrendJournalKey(normalized.scopeId, normalized.transactionId), value: normalized };
    };
    const acceptAtomicTransition = entry => {
        const normalized = normalizeTodayTrendJournal(entry);
        const current = openEntries.get(normalized.transactionId);
        if (!current) throw failure('TT_JOURNAL_STALE', `Today Trend journal entry 已过期：${normalized.transactionId}`);
        assertTransition(current.phase, normalized.phase);
        openEntries.set(normalized.transactionId, normalized);
        return clone(normalized);
    };
    const complete = async (entry, phase, changes = {}) => {
        if (!TERMINAL.has(phase)) throw failure('TT_JOURNAL_INVALID', 'Today Trend complete 只接受 terminal phase');
        const terminal = await transition(entry, phase, changes);
        const key = todayTrendJournalKey(terminal.scopeId, terminal.transactionId);
        if (!await deleteEntry(key)) console.warn('[phone-mode] Today Trend terminal journal 清理失败', key);
        return terminal;
    };
    const markBlocked = (entry, error) => {
        const normalized = normalizeTodayTrendJournal(entry);
        if (normalized.phase === 'blocked') return clone(normalized);
        return transition(normalized, 'blocked', {
            attemptCount: normalized.attemptCount + 1,
            lastErrorCode: String(error?.code || error?.name || 'TT_RECOVERY_FAILED'),
        });
    };
    return { ready, reload: load, snapshot, blocked, assertWritable, begin, transition, atomicTransition, acceptAtomicTransition, complete, markBlocked };
}

export const todayTrendJournal = createTodayTrendJournal();