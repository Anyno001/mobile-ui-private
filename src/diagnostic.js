import {
    beginBranchInheritance, getPendingBranchInheritanceTargets, resolveBranchInheritance,
} from './branch-scope-inheritance.js';
import { loadBranchLineage } from './storage.js';

const freeze = value => Object.freeze(value);

function safePresence(value) {
    if (!value || typeof value !== 'object') return null;
    const result = {};
    for (const [key, entry] of Object.entries(value)) {
        if (!entry || typeof entry !== 'object') continue;
        const present = entry.present === true;
        const count = Number.isSafeInteger(entry.count) && entry.count >= 0 ? entry.count : 0;
        result[key] = freeze({ present, count });
    }
    return freeze(result);
}

function safeResult(value) {
    if (!value || typeof value !== 'object') return null;
    return freeze({
        status: typeof value.status === 'string' ? value.status : 'unknown',
        reason: typeof value.reason === 'string' ? value.reason : null,
        sourceId: typeof value.sourceId === 'string' ? value.sourceId : null,
        targetId: typeof value.targetId === 'string' ? value.targetId : null,
        sourcePresence: safePresence(value.sourcePresence),
        targetPresence: safePresence(value.targetPresence),
    });
}

function recordResult(runtime, result) {
    runtime.lastBranchInheritance = safeResult(result);
    runtime.lastBranchInheritanceError = null;
    return runtime.lastBranchInheritance;
}

function recordError(runtime, branch, error) {
    runtime.lastBranchInheritance = freeze({ status: 'failed', reason: null,
        sourceId: branch?.sourceId || null, targetId: branch?.targetId || null,
        sourcePresence: null, targetPresence: null });
    runtime.lastBranchInheritanceError = freeze({
        name: typeof error?.name === 'string' && error.name ? error.name : 'Error',
        message: '',
    });
}

function safeBranch(branch) {
    if (!branch) return null;
    return freeze({ avatar: branch.avatar, parentChatId: branch.parentChatId,
        targetChatId: branch.targetChatId, sourceId: branch.sourceId, targetId: branch.targetId });
}

function safeError(error) {
    if (!error || typeof error !== 'object') return null;
    return freeze({ name: typeof error.name === 'string' && error.name ? error.name : 'Error',
        message: '' });
}

function safeTodayTrendError(error) {
    if (!error || typeof error !== 'object') return null;
    const code = typeof error.code === 'string' && /^TT_[A-Z0-9_]+$/.test(error.code) ? error.code : null;
    return freeze({ name: typeof error.name === 'string' && error.name ? error.name : 'Error',
        code, message: code ? String(error.message || '') : '' });
}

function todayTrendErrorCode(value) {
    const match = typeof value === 'string' ? value.match(/\bTT_[A-Z0-9_]+\b/) : null;
    return match ? match[0] : null;
}

function todayTrendSummary(store, storageId) {
    const scope = store?.scopes?.[storageId];
    if (!scope || typeof scope !== 'object') return null;
    const events = [...(Array.isArray(scope.dynamics?.active) ? scope.dynamics.active : []),
        ...(Array.isArray(scope.dynamics?.archived) ? scope.dynamics.archived : [])];
    return freeze({
        activeEventCount: Array.isArray(scope.dynamics?.active) ? scope.dynamics.active.length : 0,
        archivedEventCount: Array.isArray(scope.dynamics?.archived) ? scope.dynamics.archived.length : 0,
        stageCount: events.reduce((count, event) => count + (Array.isArray(event?.stages) ? event.stages.length : 0), 0),
        lastSuccessfulAssistantCount: Number.isSafeInteger(scope.operation?.lastSuccessfulAssistantCount)
            ? scope.operation.lastSuccessfulAssistantCount : null,
    });
}

export function installDiagnosticApi(deps) {
    if (globalThis.window?.__pmDiagEnabled !== true) return false;
    const { runtime, getCtx, getStorageId } = deps;
    const snapshot = () => {
        const branch = resolveBranchInheritance(getCtx());
        return freeze({
            eventHooked: runtime.eventHooked === true,
            hostRegistrationKeys: freeze(Array.from(runtime.hostEventRegistrations || [])),
            beforeUnloadRegistered: window.__pmBeforeUnloadRegistered === true,
            branch: safeBranch(branch),
            lastBranchInheritance: safeResult(runtime.lastBranchInheritance),
            lastBranchInheritanceError: safeError(runtime.lastBranchInheritanceError),
            pendingTargets: getPendingBranchInheritanceTargets(),
            currentStorageId: typeof getStorageId === 'function' ? getStorageId() : null,
        });
    };
    const readLineage = async targetId => {
        const resolvedTargetId = targetId || runtime.lastBranchInheritance?.targetId || resolveBranchInheritance(getCtx())?.targetId;
        if (typeof resolvedTargetId !== 'string' || !resolvedTargetId) return null;
        const entry = (await loadBranchLineage())[resolvedTargetId];
        if (!entry) return null;
        return freeze({ targetId: resolvedTargetId, sourceId: entry.sourceId, parentChatId: entry.parentChatId,
            targetChatId: entry.targetChatId, avatar: entry.avatar, completedAt: entry.completedAt, schemaVersion: entry.schemaVersion });
    };
    const todayTrend = freeze({
        status: async () => {
            const storageId = typeof getStorageId === 'function' ? getStorageId() : null;
            const store = typeof deps.getTodayTrendStore === 'function' ? await deps.getTodayTrendStore() : null;
            const generation = typeof deps.getTodayTrendGenerationState === 'function'
                ? deps.getTodayTrendGenerationState() : null;
            const calendar = typeof deps.getCalendarStore === 'function' ? deps.getCalendarStore() : null;
            const calendarScope = calendar?.scopes?.[storageId];
            return freeze({
                storageId: typeof storageId === 'string' && storageId ? storageId : null,
                storyDate: typeof calendarScope?.baseDate === 'string' ? calendarScope.baseDate : null,
                generation: generation ? freeze({ phase: generation.phase || 'unknown',
                    errorCode: todayTrendErrorCode(generation.lastError) }) : null,
                scope: todayTrendSummary(store, storageId),
            });
        },
        runManual: async () => {
            if (typeof deps.generateTodayTrend !== 'function') throw new Error('今日风向尚未完成安装；请在插件启动完成后重试');
            try {
                await deps.generateTodayTrend({});
                return freeze({ ok: true, error: null });
            } catch (error) {
                return freeze({ ok: false, error: safeTodayTrendError(error) });
            }
        },
    });
    window.__pmDiag = freeze({ snapshot, readLineage, todayTrend });
    window.__pmRetryBranch = async () => {
        const context = getCtx();
        const branch = resolveBranchInheritance(context);
        if (!branch) return freeze({ status: 'skipped', reason: 'not-branch' });
        try {
            return recordResult(runtime, await beginBranchInheritance(context, {
                getStorageId, invalidateInteractiveStore: deps.invalidateInteractiveStore,
                reloadCalendarStore: deps.reloadCalendarStore, reloadTodayTrendStore: deps.reloadTodayTrendStore,
                commitTodayTrendStore: deps.commitTodayTrendStore,
                commitTodayTrendScope: deps.commitTodayTrendScope, force: true,
            }));
        } catch (error) {
            recordError(runtime, branch, error);
            throw error;
        }
    };
    return true;
}
