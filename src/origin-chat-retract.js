// 金手指对话记录的撤回与勾选删除：直接删掉存档里对应的手动操作（我说的话、系统回复、喊话、私聊）。
// 核心（src/origin/）逐字拷自 IGS，不能改；这里只在宿主层改写 chatMetadata.origin_v2 存档后让核心重新读档。
// 回放检查点里存着整份状态（含对话记录），一并清空，由核心按账本重算，存档里不留被删除的内容。
import { ORIGIN_ENGINE_SYMBOL } from './origin/origin-engine.js';
import { ORIGIN_META_KEY } from './origin/origin-state.js';

const CHAT_OPS = new Set(['chatMe', 'chatSys', 'chatCall', 'chatRp', 'chatClear']);
const DELETABLE = new Set(['chatMe', 'chatSys', 'chatCall', 'chatRp']);

const metaOf = context => {
    const meta = context && (context.chatMetadata || context.chat_metadata);
    return meta && typeof meta === 'object' ? meta : null;
};
export const readOriginChatSave = context => {
    const raw = metaOf(context)?.[ORIGIN_META_KEY];
    return raw && typeof raw === 'object' && Array.isArray(raw.ops) ? raw : null;
};

// IGS 托管存档（数据库模式）时账本不在 chatMetadata 里，不能从这里改。
function databaseManaged(globalObject) {
    const hosts = globalObject?.[ORIGIN_ENGINE_SYMBOL]?.hosts || [];
    const enabled = host => { try { return Boolean(host.settings()?.enabled); } catch (error) { return false; } };
    const picked = hosts.find(enabled) || hosts[0];
    try { return Boolean(picked && typeof picked.database === 'function' && picked.database()); } catch (error) { return true; }
}

// 最后一组可撤回的提问：最后一条对话类操作是提问（生成中断、没有回复），或是提问 + 紧随的系统回复。
export function findRetractableSysChat(raw) {
    const ops = Array.isArray(raw?.ops) ? raw.ops : [];
    const chatOps = ops.filter(rec => CHAT_OPS.has(rec?.op?.type));
    const last = chatOps.at(-1);
    let group = null;
    if (last?.op?.type === 'chatMe') group = [last];
    else if (last?.op?.type === 'chatSys') {
        const ask = chatOps.at(-2);
        if (ask?.op?.type === 'chatMe' && String(ask.op.text || '') === String(last.op.ask || '')) group = [ask, last];
    }
    if (!group || group.some(rec => rec.economy)) return null;
    return { ids: new Set(group.map(rec => rec.id)), text: String(group[0].op.text || ''), replied: group.length === 2 };
}

// 可勾选删除的对话：最后一次清空之后、仍在存档里的手动对话操作，按发生顺序。私聊一次生成的多句算一组。
export function listDeletableChats(raw) {
    const ops = Array.isArray(raw?.ops) ? raw.ops : [];
    let start = 0;
    ops.forEach((rec, i) => { if (rec?.op?.type === 'chatClear') start = i + 1; });
    return ops.slice(start).filter(rec => DELETABLE.has(rec?.op?.type) && !rec.economy).map(rec => {
        const { type } = rec.op;
        if (type === 'chatRp') return { id: rec.id, who: 'char', lines: (rec.op.lines || []).map(line => ({ who: line.who, name: line.name, text: String(line.text || '') })) };
        return { id: rec.id, who: type === 'chatMe' ? 'me' : type === 'chatSys' ? 'sys' : 'call', text: String(rec.op.text || '') };
    });
}

function rewrite({ getCtx, engine, saveMetadata, globalObject = globalThis }, pickIds) {
    if (engine.isBlocked?.()) return { ok: false, reason: 'origin-retract-blocked' };
    if (databaseManaged(globalObject)) return { ok: false, reason: 'origin-retract-unsupported' };
    const context = getCtx?.();
    const meta = metaOf(context);
    const raw = readOriginChatSave(context);
    const picked = raw ? pickIds(raw) : null;
    if (!picked || !picked.ids.size) return { ok: false, reason: 'origin-retract-none' };
    // 存档对象与核心内存里的账本共用 ops 数组，必须整份换新，不能原地删。
    const removedAsks = new Set();
    let previousChat = null;
    for (const rec of raw.ops) {
        if (!CHAT_OPS.has(rec.op?.type)) continue;
        if (rec.op.type === 'chatSys' && previousChat?.op.type === 'chatMe'
            && picked.ids.has(previousChat.id) && rec.op.ask === previousChat.op.text) removedAsks.add(rec.id);
        previousChat = rec;
    }
    const ops = raw.ops.filter(rec => !picked.ids.has(rec.id))
        .map(rec => removedAsks.has(rec.id) ? { ...rec, op: { ...rec.op, ask: '' } } : rec);
    meta[ORIGIN_META_KEY] = { ...raw, ops, checkpoints: [] };
    engine.reload();
    if (engine.isBlocked?.()) {
        meta[ORIGIN_META_KEY] = raw;
        engine.reload();
        return { ok: false, reason: 'origin-retract-failed' };
    }
    try { saveMetadata?.(); } catch (error) { /* 落盘交给宿主防抖，下次保存时补上 */ }
    return { ok: true, picked };
}

export function retractOriginSysChat(options) {
    const result = rewrite(options, findRetractableSysChat);
    return result.ok ? { ok: true, text: result.picked.text } : result;
}

// 只删存档里确实存在且允许删除的 id；传入的其他 id 忽略。
export function deleteOriginChats(options, ids) {
    const wanted = new Set([...(ids || [])].map(Number).filter(Number.isInteger));
    const result = rewrite(options, raw => ({ ids: new Set(listDeletableChats(raw).map(item => item.id).filter(id => wanted.has(id))) }));
    return result.ok ? { ok: true, count: result.picked.ids.size } : result;
}
