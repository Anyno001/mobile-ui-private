/**
 * 删楼回退：手机消息记下发送时主线的楼层（chat.length）与该楼最后一条消息的标识（锚点）。
 * 主线删楼、重新生成、分支后，锚点已不在的消息视为「之后才发的」，去掉；
 * 最近 N 层内的编辑、删除、重新生成留有改动前的旧版本，回退时恢复。
 * 图片不进这里：图片按消息与气泡编号挂在 phone-image-store 的目录上，恢复原编号即可重新显示。
 */
export const ROLLBACK_FLOORS_KEY = 'ST_SMS_ROLLBACK_FLOORS';
export const DEFAULT_ROLLBACK_FLOORS = 30;
export const MAX_ROLLBACK_FLOORS = 200;
// 每层约 3 次改动 × 1.1KB；30 层约 100KB。
const ROLLBACK_BYTES_PER_FLOOR = 3400;

const plainRecord = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const validFloor = value => Number.isSafeInteger(value) && value >= 0;

export function normalizeRollbackFloors(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return DEFAULT_ROLLBACK_FLOORS;
    return Math.max(0, Math.min(MAX_ROLLBACK_FLOORS, Math.round(number)));
}

export function loadRollbackFloors(storage = globalThis.localStorage) {
    try {
        const raw = storage?.getItem(ROLLBACK_FLOORS_KEY);
        return raw === null || raw === undefined ? DEFAULT_ROLLBACK_FLOORS : normalizeRollbackFloors(raw);
    } catch (error) { return DEFAULT_ROLLBACK_FLOORS; }
}

export function saveRollbackFloors(value, storage = globalThis.localStorage) {
    try {
        storage?.setItem(ROLLBACK_FLOORS_KEY, String(normalizeRollbackFloors(value)));
        return true;
    } catch (error) { return false; }
}

/** 主线一条消息的标识：send_date 是毫秒级 ISO 时间，足以区分；滑动换回复会换新标识。 */
export function messageFingerprint(message) {
    if (!message || typeof message !== 'object') return '';
    return `${message.is_user ? 'u' : 'a'}|${String(message.send_date ?? '')}|${String(message.name ?? '')}`;
}

export function chatFingerprints(chat) {
    return Array.isArray(chat) ? chat.map(messageFingerprint) : [];
}

/** 新消息的楼层标记。 */
export function floorMarkFor(chat) {
    const list = Array.isArray(chat) ? chat : [];
    return { floor: list.length, floorAnchor: list.length ? messageFingerprint(list.at(-1)) : '' };
}

/**
 * 按当前主线判断一条带楼层标记的记录是否还成立：
 * - 锚点仍在原位：保留。
 * - 锚点前移（中间删了楼）：保留并改楼层。
 * - 锚点不在且楼层已超出主线长度：主线删回去了，去掉。
 * - 其余（锚点被滑动换掉等）：保留，锚点改记成现在这层，不做破坏性处理。
 */
export function resolveFloorMark(mark, fingerprints) {
    const floor = mark?.floor;
    if (!validFloor(floor)) return { keep: true };
    if (floor === 0) return { keep: true };
    const anchor = typeof mark.floorAnchor === 'string' ? mark.floorAnchor : '';
    if (anchor && fingerprints[floor - 1] === anchor) return { keep: true };
    if (anchor) {
        for (let index = Math.min(floor - 1, fingerprints.length - 1); index >= 0; index -= 1) {
            if (fingerprints[index] === anchor) return { keep: true, floor: index + 1, floorAnchor: anchor };
        }
    }
    if (floor > fingerprints.length) return { keep: false };
    return { keep: true, floor, floorAnchor: fingerprints[floor - 1] };
}

const withMark = (record, resolved) => (resolved.floor === undefined
    ? record : { ...record, floor: resolved.floor, floorAnchor: resolved.floorAnchor });

/**
 * 记一条改动前的旧版本。op：edit（替换成 entry）、remove（把 entry 插回 afterId 之后）。
 * 批量删除按从后往前的顺序记，回退时按 seq 从新到旧撤销，前一条总会先被插回。
 */
export function createRollbackRecord({ saveKey, op, entry, afterId = null, index = 0, chat, seq }) {
    return {
        seq, saveKey, op, entry,
        afterId: typeof afterId === 'string' && afterId ? afterId : null,
        index: Number.isSafeInteger(index) && index >= 0 ? index : 0,
        ...floorMarkFor(chat),
    };
}

export function normalizeRollbackList(value) {
    return (Array.isArray(value) ? value : []).filter(item => plainRecord(item)
        && Number.isSafeInteger(item.seq) && typeof item.saveKey === 'string' && item.saveKey
        && (item.op === 'edit' || item.op === 'remove') && plainRecord(item.entry) && item.entry.messageId);
}

/** 只留最近 floors 层内的旧版本，并按体积封顶；floors 为 0 时全部丢弃。 */
export function pruneRollbackList(list, currentFloor, floors) {
    const limit = normalizeRollbackFloors(floors);
    if (limit === 0) return [];
    const kept = list.filter(item => !validFloor(item.floor) || currentFloor - item.floor < limit)
        .sort((a, b) => a.seq - b.seq);
    const budget = limit * ROLLBACK_BYTES_PER_FLOOR;
    let total = kept.reduce((sum, item) => sum + JSON.stringify(item).length, 0);
    while (kept.length && total > budget) total -= JSON.stringify(kept.shift()).length;
    return kept;
}

function undoRecord(history, record) {
    const at = history.findIndex(entry => entry?.messageId === record.entry.messageId);
    if (record.op === 'edit') {
        if (at >= 0) history[at] = record.entry;
        return;
    }
    if (at >= 0) return;
    let insertAt;
    if (record.afterId === null) insertAt = 0;
    else {
        const after = history.findIndex(entry => entry?.messageId === record.afterId);
        insertAt = after >= 0 ? after + 1 : Math.min(record.index, history.length);
    }
    history.splice(insertAt, 0, record.entry);
}

/**
 * 按当前主线回退一个聊天的手机记录。返回新的 histories（只替换有变化的联系人数组）、
 * 剩余旧版本，以及变化的联系人。
 */
export function applyFloorRollback({ histories, rollback, chat }) {
    const fingerprints = chatFingerprints(chat);
    const source = plainRecord(histories) ? histories : {};
    const working = {};
    const changed = new Set();
    for (const [key, history] of Object.entries(source)) {
        if (!Array.isArray(history)) { working[key] = history; continue; }
        let dirty = false;
        const next = [];
        for (const entry of history) {
            const resolved = resolveFloorMark(entry, fingerprints);
            if (!resolved.keep) { dirty = true; continue; }
            if (resolved.floor !== undefined) dirty = true;
            next.push(withMark(entry, resolved));
        }
        working[key] = dirty ? next : history;
        if (dirty) changed.add(key);
    }
    const remaining = [];
    const expired = [];
    const records = normalizeRollbackList(rollback);
    for (const record of records) {
        const resolved = resolveFloorMark(record, fingerprints);
        if (resolved.keep) remaining.push(withMark(record, resolved));
        else expired.push(record);
    }
    expired.sort((a, b) => b.seq - a.seq);
    for (const record of expired) {
        const history = working[record.saveKey];
        if (!Array.isArray(history)) continue;
        const copy = changed.has(record.saveKey) ? history : history.slice();
        undoRecord(copy, record);
        working[record.saveKey] = copy;
        changed.add(record.saveKey);
    }
    // 撤销可能把回退点之后的消息带回来，再按楼层清一遍。
    for (const key of changed) {
        working[key] = working[key].flatMap(entry => {
            const resolved = resolveFloorMark(entry, fingerprints);
            return resolved.keep ? [withMark(entry, resolved)] : [];
        });
    }
    return {
        histories: changed.size ? working : source,
        rollback: remaining,
        changedKeys: [...changed],
        rollbackChanged: expired.length > 0 || remaining.some((item, i) => item !== records[i]),
    };
}
