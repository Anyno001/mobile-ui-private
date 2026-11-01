/**
 * 社区与直播间的删楼回退，规则同手机聊天（phone-floor-rollback.js）：
 * - 新帖子、评论、弹幕记下发出时主线的楼层与锚点；主线删回去后，锚点已不在的视为「之后才发的」，去掉。
 * - 最近 N 层内的编辑、删除留有旧版本（记在所属社区或直播间的 floorRollback 上），回退时恢复。
 * - 从正文（IGS）同步来的内容不在这里处理，由同步对账跟随楼层。
 * 模型层的增删改函数经 provider 取当前楼层与保留层数；provider 未设置时一律不记，行为与旧版相同。
 */
import { resolveFloorMark, chatFingerprints } from './phone-floor-rollback.js';

const ROLLBACK_BYTES_PER_FLOOR = 6000;
const plainRecord = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const validFloor = value => Number.isSafeInteger(value) && value >= 0;
export const COMMUNITY_ROLLBACK_TARGETS = Object.freeze(['post', 'comment', 'danmaku']);

let provider = null;
/** provider() → { floor, floorAnchor, limit } 或 null。 */
export function setCommunityFloorProvider(fn) {
    provider = typeof fn === 'function' ? fn : null;
}

// 在别的聊天的社区里写内容（全局固定后从当前聊天打开）时暂停记楼层：当前聊天的楼层对那个聊天没有意义，
// 不打标记、不记旧版本，那个聊天回退时就会一直保留这些内容。
let suppressDepth = 0;
export async function withoutFloorMarks(fn) {
    suppressDepth += 1;
    try { return await fn(); } finally { suppressDepth -= 1; }
}

function currentMark() {
    if (suppressDepth > 0) return null;
    try {
        const mark = provider?.();
        return mark && validFloor(mark.floor) ? mark : null;
    } catch (error) { return null; }
}

/** 新内容的楼层标记；没有主线时返回空对象。 */
export function communityFloorMark() {
    const mark = currentMark();
    return mark ? { floor: mark.floor, floorAnchor: typeof mark.floorAnchor === 'string' ? mark.floorAnchor : '' } : {};
}

/**
 * 记一条改动前的旧版本。change：
 * { target: 'post'|'comment'|'danmaku', op: 'edit', id, postId?, content } 或
 * { target, op: 'remove', entry, postId?, afterId, index }。
 * 批量删除要按从后往前的顺序记，回退时按 seq 从新到旧撤销，前一条总会先被插回。
 */
export function recordCommunityChange(container, change) {
    const mark = currentMark();
    if (!mark || !plainRecord(container)) return;
    const limit = Number.isSafeInteger(mark.limit) ? mark.limit : 0;
    if (limit <= 0) { delete container.floorRollback; return; }
    const list = Array.isArray(container.floorRollback) ? container.floorRollback : [];
    const seq = list.reduce((max, item) => Math.max(max, item.seq), 0) + 1;
    const record = { seq, ...change, floor: mark.floor, floorAnchor: typeof mark.floorAnchor === 'string' ? mark.floorAnchor : '' };
    container.floorRollback = pruneCommunityRollback([...list, record], mark.floor, limit);
}

/** 只留最近 limit 层内的旧版本，并按体积封顶。 */
export function pruneCommunityRollback(list, currentFloor, limit) {
    if (!(limit > 0)) return [];
    const kept = list.filter(item => !validFloor(item.floor) || currentFloor - item.floor < limit).sort((a, b) => a.seq - b.seq);
    const budget = limit * ROLLBACK_BYTES_PER_FLOOR;
    let total = kept.reduce((sum, item) => sum + JSON.stringify(item).length, 0);
    while (kept.length && total > budget) total -= JSON.stringify(kept.shift()).length;
    return kept;
}

/** 读入时的形状校验：不合格的记录丢掉，不让整个社区失效。entry 由调用方再按帖子/评论/弹幕规则归一化。 */
export function normalizeCommunityRollbackRecord(raw) {
    if (!plainRecord(raw) || !Number.isSafeInteger(raw.seq) || raw.seq < 1) return null;
    if (!COMMUNITY_ROLLBACK_TARGETS.includes(raw.target) || (raw.op !== 'edit' && raw.op !== 'remove')) return null;
    if (!validFloor(raw.floor)) return null;
    const base = {
        seq: raw.seq, target: raw.target, op: raw.op, floor: raw.floor,
        floorAnchor: typeof raw.floorAnchor === 'string' ? raw.floorAnchor.slice(0, 200) : '',
        ...(raw.target === 'comment' && typeof raw.postId === 'string' && raw.postId ? { postId: raw.postId.slice(0, 80) } : {}),
    };
    if (raw.target === 'comment' && !base.postId) return null;
    if (raw.op === 'edit') {
        if (typeof raw.id !== 'string' || !raw.id || typeof raw.content !== 'string' || !raw.content) return null;
        return { ...base, id: raw.id.slice(0, 80), content: raw.content };
    }
    if (!plainRecord(raw.entry) || typeof raw.entry.id !== 'string' || !raw.entry.id) return null;
    return {
        ...base, entry: raw.entry,
        afterId: typeof raw.afterId === 'string' && raw.afterId ? raw.afterId.slice(0, 80) : null,
        index: Number.isSafeInteger(raw.index) && raw.index >= 0 ? raw.index : 0,
    };
}

const fromStory = item => item?.source?.type === 'igs';
const withMark = (item, resolved) => (resolved.floor === undefined ? item : { ...item, floor: resolved.floor, floorAnchor: resolved.floorAnchor });

// 按主线留下还成立的项；正文同步来的、没有楼层标记的照旧。返回 { items, changed }。
function keepByFloor(items, fingerprints) {
    let changed = false;
    const kept = [];
    for (const item of Array.isArray(items) ? items : []) {
        if (fromStory(item)) { kept.push(item); continue; }
        const resolved = resolveFloorMark(item, fingerprints);
        if (!resolved.keep) { changed = true; continue; }
        if (resolved.floor !== undefined) changed = true;
        kept.push(withMark(item, resolved));
    }
    return { items: changed ? kept : items, changed };
}

function keepPosts(posts, fingerprints) {
    const outer = keepByFloor(posts, fingerprints);
    let changed = outer.changed;
    const next = outer.items.map(post => {
        const inner = keepByFloor(post.comments, fingerprints);
        if (!inner.changed) return post;
        changed = true;
        return { ...post, comments: inner.items };
    });
    return { items: changed ? next : posts, changed };
}

function insertBack(items, record) {
    if (items.some(item => item?.id === record.entry.id)) return items;
    const next = items.slice();
    let at;
    if (record.afterId === null) at = 0;
    else {
        const after = next.findIndex(item => item?.id === record.afterId);
        at = after >= 0 ? after + 1 : Math.min(record.index, next.length);
    }
    next.splice(at, 0, record.entry);
    return next;
}

function undoInList(items, record) {
    if (record.op === 'remove') return insertBack(items, record);
    const at = items.findIndex(item => item?.id === record.id);
    if (at < 0) return items;
    const next = items.slice();
    next[at] = { ...next[at], content: record.content };
    return next;
}

function undoPosts(posts, record) {
    if (record.target === 'post') return undoInList(posts, record);
    const at = posts.findIndex(post => post?.id === record.postId);
    if (at < 0) return posts;
    const next = posts.slice();
    next[at] = { ...next[at], comments: undoInList(next[at].comments || [], record) };
    return next;
}

// 一个社区或直播间：先去掉之后才发的，再撤销已过期的旧版本（从新到旧），撤销可能带回之后的项，再按楼层清一遍。
// dryRun：只算不写（各步都返回新数组、不原地改，试跑不用先深拷贝）。返回 { touched, contentChanged }。
function rollbackContainer(container, field, fingerprints, { keep, undo, cap, dryRun }) {
    const first = keep(container[field], fingerprints);
    let items = first.items;
    let changed = first.changed;
    const records = Array.isArray(container.floorRollback) ? container.floorRollback : [];
    const remaining = [];
    const expired = [];
    for (const record of records) {
        const resolved = resolveFloorMark(record, fingerprints);
        if (resolved.keep) remaining.push(withMark(record, resolved));
        else expired.push(record);
    }
    expired.sort((a, b) => b.seq - a.seq);
    for (const record of expired) items = undo(items, record);
    if (expired.length) { items = cap(keep(items, fingerprints).items); changed = true; }
    const rollbackChanged = expired.length > 0 || remaining.some((item, index) => item !== records[index]);
    if (!dryRun) {
        if (changed) container[field] = items;
        if (rollbackChanged) {
            if (remaining.length) container.floorRollback = remaining;
            else delete container.floorRollback;
        }
    }
    return { touched: changed || rollbackChanged, contentChanged: changed };
}

/**
 * 按当前主线回退一个会话的社区与直播间（在提交里调用时直接改 scope；dryRun 为真时只返回会改什么，不改 scope）。
 * 主线为空时不处理（切换聊天途中会误判为全部删光）。返回 { scenes, rooms, contentChanged }。
 */
export function applyCommunityFloorRollback(scope, chat, { limits, dryRun = false }) {
    const result = { scenes: [], rooms: [], contentChanged: false };
    if (!plainRecord(scope) || !Array.isArray(chat) || !chat.length) return result;
    const fingerprints = chatFingerprints(chat);
    for (const scene of Object.values(scope.scenes || {})) {
        if (!plainRecord(scene)) continue;
        const outcome = rollbackContainer(scene, 'posts', fingerprints, {
            keep: keepPosts, undo: undoPosts, dryRun,
            cap: posts => posts.slice(-limits.posts).map(post => (post.comments?.length > limits.comments ? { ...post, comments: post.comments.slice(-limits.comments) } : post)),
        });
        if (!outcome.touched) continue;
        result.scenes.push(scene.id);
        if (outcome.contentChanged) { result.contentChanged = true; if (!dryRun) scene.updatedAt = Date.now(); }
    }
    for (const room of Object.values(scope.liveRooms || {})) {
        if (!plainRecord(room)) continue;
        const outcome = rollbackContainer(room, 'danmaku', fingerprints, {
            keep: keepByFloor, undo: undoInList, cap: items => items.slice(-limits.danmaku), dryRun,
        });
        if (!outcome.touched) continue;
        result.rooms.push(room.id);
        if (outcome.contentChanged) { result.contentChanged = true; if (!dryRun) room.updatedAt = Date.now(); }
    }
    return result;
}

/**
 * 宿主事件里调用的回退：先试跑（只算不写），没有改动就不提交；有改动时作废进行中的社区生成，
 * 免得它稍后把回退掉的内容写回来。deps：getStorageId、getCtx、loadStore、getStore、commit、invalidate、limits、
 * getOpenSceneId、refreshOpenScene、refreshLive。
 */
export function createCommunityRollbackRunner(deps) {
    return async () => {
        const storageId = deps.getStorageId();
        const chat = deps.getCtx()?.chat;
        if (!storageId || storageId === 'sms_unknown__default' || !Array.isArray(chat) || !chat.length) return null;
        const store = await deps.loadStore();
        const scope = store?.scopes?.[storageId];
        if (!scope) return null;
        const probe = applyCommunityFloorRollback(scope, chat, { limits: deps.limits, dryRun: true });
        if (!probe.scenes.length && !probe.rooms.length) return null;
        if (probe.contentChanged) deps.invalidate('community-floor-rollback');
        let result = null;
        await deps.commit(() => {
            const target = deps.getStore()?.scopes?.[storageId];
            if (target) result = applyCommunityFloorRollback(target, chat, { limits: deps.limits });
        }, () => deps.getStorageId() === storageId, '删楼回退社区');
        if (!result) return null;
        const openSceneId = deps.getOpenSceneId();
        if (openSceneId && result.scenes.includes(openSceneId)) deps.refreshOpenScene(openSceneId);
        if (result.rooms.length) deps.refreshLive();
        return result;
    };
}

/** 被删掉的一项在数组里的位置：前一项的 id 与下标。 */
export function removalPlace(items, itemId) {
    const index = items.findIndex(item => item?.id === itemId);
    return { afterId: index > 0 ? items[index - 1].id : null, index: Math.max(0, index) };
}
