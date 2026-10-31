// 与 gal 前端（IGS）联动：正文里的直播段 → 噼哩噼哩直播间。纯函数，只读 IGS.api.live.collect 的结果。
// 规则（接IGS社区计划 §6.6）：按「主播 + 标题」找直播间，找不到就新建；view === 'host' 时主播是用户本人。
// 弹幕：文字 → chat；礼物 → gift；醒目留言 → chat（前缀「[醒目留言 ¥附加]」）；上舰 → gift（「开通了舰长」）；进场不存。
// 下播：直播间保留，标 ended。去重与跟随修改照社区帖子：楼层原文没了，用户没改过的弹幕删掉，改过的保留。
import { hashText, parseIgsKey } from './igs-feed-core.js';
import { INTERACTIVE_LIMITS } from './interactive-scene-constants.js';
import { appendLiveDanmaku, createLiveRoom, ensureInteractiveActor } from './interactive-scene-model.js';

export const IGS_LIVE_MIN_VERSION = 1;
const clip = (value, max) => Array.from(String(value ?? '').trim()).slice(0, max).join('');

export function resolveIgsLive(globalObject) {
    let live = null;
    try { live = globalObject?.IGS?.api?.live || null; } catch { live = null; }
    if (!live) return null;
    return Number.isInteger(Number(live.version)) && Number(live.version) >= IGS_LIVE_MIN_VERSION && typeof live.collect === 'function' ? live : null;
}

// IGS 弹幕 → 天音弹幕 { kind, content }；不存的类型返回 null。
export function mapIgsDanmaku(item) {
    const content = clip(item?.content, 200);
    const extra = clip(item?.extra, 20);
    const type = String(item?.type || 'text');
    if (type === 'enter' || type === 'admin') return null;
    if (type === 'gift') return content || extra ? { kind: 'gift', content: content || extra } : null;
    if (type === 'guard') return { kind: 'gift', content: clip(`开通了舰长${content ? ` ${content}` : ''}`, 200) };
    if (type === 'sc') return content ? { kind: 'chat', content: clip(`[醒目留言${extra ? ` ¥${extra.replace(/^[¥￥]/, '')}` : ''}] ${content}`, 200) } : null;
    return content ? { kind: 'chat', content } : null;
}

// 直播间标识：主播 + 标题。同一主播换了标题算另一间。
export const liveIdentityOf = (host, title) => hashText(`${clip(host, 80)}\u0000${clip(title, 100)}`);

// 按楼层顺序走一遍 AI 楼（只有弹幕或只有 live-end 的段承接上一楼还没下播的直播）。
// floors：[{ floor, hash, text }]，collect(info) 返回该楼的直播段（调用方负责缓存）。adding：本轮可以追加的楼层原文哈希。
// 返回 { rooms: Map<identity, { host, title, view, ended }>, entries: [{ identity, key, floor, hash, kind, content, author }], hashes: Set }。
export function walkIgsLive(floors, collect, adding = null) {
    const rooms = new Map();
    const entries = [];
    const hashes = new Set();
    let open = null;
    for (const info of floors) {
        const segments = collect(info);
        if (!Array.isArray(segments) || !segments.length) continue;
        hashes.add(info.hash);
        let line = 0;
        for (const segment of segments) {
            if (segment?.host) {
                const identity = liveIdentityOf(segment.host, segment.title);
                const known = rooms.get(identity);
                rooms.set(identity, { host: clip(segment.host, 80), title: clip(segment.title, 100), view: segment.view === 'host' ? 'host' : 'watch', ended: false, ...(known ? { opened: known.opened } : { opened: info.hash }) });
                open = identity;
            }
            if (!open) continue;
            for (const item of Array.isArray(segment?.danmaku) ? segment.danmaku : []) {
                const mapped = mapIgsDanmaku(item);
                line += 1;
                if (!mapped || (adding && !adding.has(info.hash))) continue;
                entries.push({
                    identity: open, key: `igs:${info.hash}:${line}:${hashText(`${mapped.kind}\u0000${mapped.content}`)}`, floor: info.floor, hash: info.hash,
                    ...mapped, author: clip(item.author, 80),
                });
            }
            if (segment?.end) { rooms.get(open).ended = true; open = null; }
        }
    }
    return { rooms, entries, hashes, adding };
}

const signatureOf = (kind, content) => hashText(`${kind}\u0000${content}`);
const roomsOf = scope => (scope.liveOrder || []).map(id => scope.liveRooms?.[id]).filter(Boolean);

// 对账（直接改 scope）：先清掉原文已不在的、用户没改过的弹幕，再按标识找房间、补新弹幕、更新下播状态。
// 社区满额规则同直播间上限：满了不新建，记进 skipped，不挤掉用户自己的直播间。
export function applyIgsLiveSync(scope, { walk, scopeId, seeds = [], now = Date.now() }) {
    const result = { added: 0, removed: 0, createdRooms: [], skipped: 0, touchedRoomIds: new Set(), addedByRoom: new Map() };
    const existing = new Set();
    for (const room of roomsOf(scope)) {
        const before = room.danmaku.length;
        room.danmaku = room.danmaku.filter(item => {
            const parsed = item.source?.type === 'igs' ? parseIgsKey(item.source.key) : null;
            if (!parsed) return true;
            if (walk.hashes.has(parsed.hash)) { existing.add(item.source.key); return true; }
            return signatureOf(item.kind, item.content) !== parsed.signature;
        });
        if (room.danmaku.length !== before) { result.removed += before - room.danmaku.length; room.updatedAt = now; result.touchedRoomIds.add(room.id); }
    }
    const byIdentity = new Map(roomsOf(scope).filter(room => room.source?.type === 'igs').map(room => [room.source.key, room]));
    const needed = new Set(walk.entries.filter(entry => !existing.has(entry.key)).map(entry => entry.identity));
    for (const [identity, info] of walk.rooms) {
        let room = byIdentity.get(identity);
        // adding 为 null 是手动导入（全部楼层都可追加）；自动同步只为本轮的新楼开新直播间。
        if (!room && (needed.has(identity) || !walk.adding || walk.adding.has(info.opened))) {
            // 用户手动建过同名同主播的直播间时直接认领，不重复建。
            room = roomsOf(scope).find(item => !item.source && item.title === info.title && item.hostNameSnapshot === info.host) || null;
            if (room) room.source = { type: 'igs', key: identity };
            else if ((scope.liveOrder || []).length >= INTERACTIVE_LIMITS.liveRooms) { result.skipped += 1; continue; }
            else {
                const hostIsUser = info.view === 'host';
                // 新聊天里剧情角色的 actor 可能还没登记：先登记种子，主播才能绑到剧情角色。
                for (const seed of seeds) ensureInteractiveActor(scope, scopeId, seed);
                const actor = hostIsUser ? null : Object.values(scope.actors || {}).find(item => item.type === 'story' && item.displayName === info.host);
                const userName = seeds.find(seed => seed?.type === 'user')?.displayName || '我';
                room = createLiveRoom(scope, scopeId, { title: info.title || `${info.host || userName}的直播间`, hostIsUser, hostNameSnapshot: hostIsUser ? userName : info.host, ...(actor ? { hostActorId: actor.actorId } : {}) });
                room.source = { type: 'igs', key: identity };
                result.createdRooms.push(room.id);
            }
            byIdentity.set(identity, room);
            result.touchedRoomIds.add(room.id);
        }
        if (!room) continue;
        if (info.ended && room.ended !== true) { room.ended = true; result.touchedRoomIds.add(room.id); }
        else if (!info.ended && room.ended === true) { delete room.ended; result.touchedRoomIds.add(room.id); }
    }
    const fresh = new Map();
    for (const entry of walk.entries) {
        if (existing.has(entry.key) || !byIdentity.has(entry.identity)) continue;
        existing.add(entry.key);
        if (!fresh.has(entry.identity)) fresh.set(entry.identity, []);
        fresh.get(entry.identity).push(entry);
    }
    for (const [identity, list] of fresh) {
        const room = byIdentity.get(identity);
        const appended = appendLiveDanmaku(scope, scopeId, room, list.map(entry => ({ author: entry.author || '路人', content: entry.content, kind: entry.kind })), seeds);
        appended.forEach((item, index) => { item.source = { type: 'igs', floor: list[index].floor, key: list[index].key }; });
        result.added += appended.length;
        result.touchedRoomIds.add(room.id);
        result.addedByRoom.set(room.id, [...new Set(list.map(entry => entry.hash))]);
    }
    return result;
}

// 只读预检：在直播间与 actors 的副本上试跑一遍，看有没有改动。没有直播段也没有导入过的弹幕时直接返回 false。
export function igsLiveHasWork(scope, options) {
    const imported = roomsOf(scope).some(room => room.source?.type === 'igs' || room.danmaku.some(item => item.source?.type === 'igs'));
    if (!options.walk.rooms.size && !imported) return false;
    const copy = JSON.parse(JSON.stringify({ liveRooms: scope.liveRooms || {}, liveOrder: scope.liveOrder || [], actors: scope.actors || {} }));
    const result = applyIgsLiveSync(copy, options);
    return result.touchedRoomIds.size > 0;
}
