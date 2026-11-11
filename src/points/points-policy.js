import { hash53, isAiMsg } from '../origin/origin-state.js';

export const POINTS_POLICY_VERSION = 1;
export const POINTS_FLOOR_KEY = 'igs_points_uid';
export const POINTS_WINDOW = 10;
export const GAME_IDS = Object.freeze(['rps', 'whosaid', 'mood', 'memory', 'tiles', 'snake', 'ludo', 'mahjong']);
export const newPointsId = () => globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
export const pointsSwipe = m => Number.isSafeInteger(m?.swipe_id) && m.swipe_id >= 0 ? m.swipe_id : 0;
export function pointsFloorId(message) {
    const ids = [message?.extra?.[POINTS_FLOOR_KEY], ...(Array.isArray(message?.swipe_info)
        ? message.swipe_info.map(s => s?.extra?.[POINTS_FLOOR_KEY]) : [])].filter(v => v !== undefined);
    return ids.length && ids.every(v => typeof v === 'string' && v && v === ids[0]) ? ids[0] : '';
}
export const pointFloors = chat => (Array.isArray(chat) ? chat : []).flatMap((m, messageId) =>
    m && isAiMsg(m) && !m.is_system ? [{ messageId, floorId: pointsFloorId(m), swipeId: pointsSwipe(m) }] : []);
export const activePointsAnchor = (anchor, chat) => {
    const matches = pointFloors(chat).filter(f => f.floorId && f.floorId === anchor?.floorId);
    return matches.length === 1 && matches[0].swipeId === anchor.swipeId;
};
export const anchorKey = a => JSON.stringify([a?.floorId || '', a?.swipeId ?? 0]);
export function gameAllowance(chat, grants, anchor, game) {
    const sameFloor = grants.filter(g => anchorKey(g.anchor) === anchorKey(anchor) && g.amount > 0);
    if (sameFloor.length >= 2 || sameFloor.some(g => g.game === game)) return 0;
    return windowAllowance(pointFloors(chat), grants, anchor, 60);
}

// 检查包含迟到来源的所有连续窗口，而不只检查其之前的十楼。
export function windowAllowance(floors, grants, anchor, cap) {
    const at = floors.findIndex(f => f.floorId === anchor.floorId && f.swipeId === anchor.swipeId);
    if (at < 0) return 0;
    let left = cap;
    for (let start = Math.max(0, at - POINTS_WINDOW + 1); start <= at; start += 1) {
        const keys = new Set(floors.slice(start, start + POINTS_WINDOW).map(anchorKey));
        left = Math.min(left, cap - grants.filter(g => keys.has(anchorKey(g.anchor))).reduce((n, g) => n + g.amount, 0));
    }
    return Math.max(0, left);
}
export function gameReward(game, result = {}) {
    if (!result || typeof result !== 'object' || Array.isArray(result)) return 0;
    if (game === 'snake') return result.terminal === true && Number.isSafeInteger(result.score) && result.score >= 0
        ? result.won === true ? 20 : result.score >= 20 ? 15 : result.score >= 10 ? 10 : 0 : 0;
    if (result.win !== true) return 0;
    return ({ rps: 2, whosaid: result.first === true ? 3 : 0, mood: result.first === true ? 3 : 0, memory: result.levels === 5 ? 15 : 0,
        tiles: result.levels === 2 ? 15 : 0, ludo: result.humans === 1 ? 20 : 0 })[game] || 0;
}
export function mahjongAmount(legs) {
    if (!Array.isArray(legs) || legs.length !== 3 || legs.some(n => !Number.isSafeInteger(n))) throw new Error('points-mahjong-invalid');
    return legs.reduce((sum, n) => sum + 10 * Math.max(-20, Math.min(20, n)), 0);
}
export function mahjongHandAmount({ rules, legs, fan } = {}) {
    if (rules === 'chengdu') return mahjongAmount(legs);
    if (rules !== 'riichi' || !Number.isSafeInteger(fan)) throw new Error('points-mahjong-invalid');
    return 10 * Math.max(-20, Math.min(20, fan));
}

export const pointsHash = value => hash53(JSON.stringify(value));
