import { materializeTodayTrendCheckpoint } from './today-trend-history-reducer.js';
import { TODAY_TREND_RELATION_STATUSES } from './today-trend-model.js';

// 「较上次更新」的变化：比较当前资料与上一个生成快照，只用于界面标记，不参与存储。
const list = value => Array.isArray(value) ? value : [];
const byId = items => new Map(list(items).filter(item => item && typeof item.id === 'string').map(item => [item.id, item]));
const rank = status => TODAY_TREND_RELATION_STATUSES.indexOf(status);
const relationChange = (before, after) => {
    if (!before) return { kind: 'new' };
    if (before === after || rank(before) < 0 || rank(after) < 0) return null;
    return { kind: rank(after) > rank(before) ? 'up' : 'down', from: before, to: after };
};
const factionStatus = faction => faction?.relation && typeof faction.relation === 'object' ? faction.relation.status : 'neutral';

export function diffTodayTrendScopes(previous, current) {
    const result = { world: {}, circles: {}, factions: {}, events: {}, count: 0 };
    if (!previous || !current) return result;
    const mark = (group, id, change) => { if (change) { result[group][id] = change; result.count += 1; } };
    const prevWorld = byId(previous.world?.items);
    for (const item of list(current.world?.items)) {
        const before = prevWorld.get(item.id);
        mark('world', item.id, !before ? { kind: 'new' } : before.summary !== item.summary || before.name !== item.name ? { kind: 'changed' } : null);
    }
    const prevCircles = byId(previous.reputation?.circles);
    for (const circle of list(current.reputation?.circles)) mark('circles', circle.id, relationChange(prevCircles.get(circle.id)?.status, circle.status));
    const prevFactions = byId(previous.factions);
    for (const faction of list(current.factions)) {
        const before = prevFactions.get(faction.id);
        mark('factions', faction.id, relationChange(before ? factionStatus(before) : undefined, factionStatus(faction)));
    }
    const prevEvents = new Map([...byId(previous.dynamics?.active), ...byId(previous.dynamics?.archived)]);
    const prevArchived = new Set(list(previous.dynamics?.archived).map(event => event.id));
    const currentArchived = new Set(list(current.dynamics?.archived).map(event => event.id));
    for (const event of [...list(current.dynamics?.active), ...list(current.dynamics?.archived)]) {
        const before = prevEvents.get(event.id);
        const added = list(event.stages).length - list(before?.stages).length;
        mark('events', event.id, !before ? { kind: 'new' }
            : currentArchived.has(event.id) && !prevArchived.has(event.id) ? { kind: 'changed', label: '完结' }
            : added > 0 ? { kind: 'up', label: '推进' } : null);
    }
    return result;
}

let cachedKey = '';
let cachedPrevious = null;

// 取最近一次成功同步之前的快照；没有可用快照或校验失败时返回 null，界面不显示变化标记。
export function resolveTodayTrendPreviousScope(canonicalValue, storageId) {
    try {
        const payload = canonicalValue?.globalEnvelope?.payload?.scopes?.[storageId]?.payload;
        const synced = payload?.operation?.lastSuccessfulAssistantCount;
        if (!payload || !Number.isSafeInteger(synced) || synced < 1) return null;
        const snapshot = list(payload.generationSnapshots)
            .filter(item => Number.isSafeInteger(item?.assistantCount) && item.assistantCount < synced && item.restoreCapability === 'full' && item.checkpointRef)
            .reduce((latest, item) => !latest || item.assistantCount > latest.assistantCount ? item : latest, null);
        if (!snapshot) return null;
        const key = `${storageId}\u0000${snapshot.assistantCount}\u0000${snapshot.checkpointRef.payloadDigest}`;
        if (key !== cachedKey) {
            cachedPrevious = materializeTodayTrendCheckpoint(snapshot.checkpointRef, payload.checkpointEntityStore || {});
            cachedKey = key;
        }
        return cachedPrevious;
    } catch {
        return null;
    }
}
