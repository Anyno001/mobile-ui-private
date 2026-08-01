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
    window.__pmDiag = freeze({ snapshot, readLineage });
    window.__pmRetryBranch = async () => {
        const context = getCtx();
        const branch = resolveBranchInheritance(context);
        if (!branch) return freeze({ status: 'skipped', reason: 'not-branch' });
        try {
            return recordResult(runtime, await beginBranchInheritance(context, {
                getStorageId, invalidateInteractiveStore: deps.invalidateInteractiveStore,
                reloadCalendarStore: deps.reloadCalendarStore, reloadTodayTrendStore: deps.reloadTodayTrendStore, force: true,
            }));
        } catch (error) {
            recordError(runtime, branch, error);
            throw error;
        }
    };
    return true;
}
