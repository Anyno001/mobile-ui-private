// 金手指系统对话「撤回最后一轮」：删掉最后一组「我说的话 + 系统回复」两条手动操作，供网络失败后重发。
// 核心（src/origin/）逐字拷自 IGS，不能改；这里只在宿主层改写 chatMetadata.origin_v2 存档后让核心重新读档。
// 回放检查点里存着整份状态（含对话记录），一并清空，由核心按账本重算，存档里不留被撤回的内容。
import { ORIGIN_ENGINE_SYMBOL } from './origin/origin-engine.js';
import { ORIGIN_META_KEY } from './origin/origin-state.js';

const CHAT_OPS = new Set(['chatMe', 'chatSys', 'chatCall', 'chatRp', 'chatClear']);

const metaOf = context => {
    const meta = context && (context.chatMetadata || context.chat_metadata);
    return meta && typeof meta === 'object' ? meta : null;
};

// IGS 托管存档（数据库模式）时账本不在 chatMetadata 里，不能从这里改。
function databaseManaged(globalObject) {
    const hosts = globalObject?.[ORIGIN_ENGINE_SYMBOL]?.hosts || [];
    const enabled = host => { try { return Boolean(host.settings()?.enabled); } catch (error) { return false; } };
    const picked = hosts.find(enabled) || hosts[0];
    try { return Boolean(picked && typeof picked.database === 'function' && picked.database()); } catch (error) { return true; }
}

// 找到最后一组可撤回的对话：最后一条对话类操作是系统回复，紧挨着的上一条对话类操作是对应的提问，且都还没随正文发出。
export function findRetractableSysChat(raw) {
    const ops = Array.isArray(raw?.ops) ? raw.ops : [];
    const chatOps = ops.filter(rec => CHAT_OPS.has(rec?.op?.type));
    const reply = chatOps.at(-1);
    const ask = chatOps.at(-2);
    if (reply?.op?.type !== 'chatSys' || ask?.op?.type !== 'chatMe') return null;
    if (String(ask.op.text || '') !== String(reply.op.ask || '')) return null;
    if (reply.boundTo != null || ask.boundTo != null || reply.economy || ask.economy) return null;
    return { ids: new Set([ask.id, reply.id]), text: String(ask.op.text || '') };
}

export function retractOriginSysChat({ getCtx, engine, saveMetadata, globalObject = globalThis }) {
    if (engine.isBlocked?.()) return { ok: false, reason: 'origin-retract-blocked' };
    if (databaseManaged(globalObject)) return { ok: false, reason: 'origin-retract-unsupported' };
    const meta = metaOf(getCtx?.());
    const raw = meta?.[ORIGIN_META_KEY];
    const target = raw && typeof raw === 'object' ? findRetractableSysChat(raw) : null;
    if (!target) return { ok: false, reason: 'origin-retract-none' };
    // 存档对象与核心内存里的账本共用 ops 数组，必须整份换新，不能原地删。
    meta[ORIGIN_META_KEY] = { ...raw, ops: raw.ops.filter(rec => !target.ids.has(rec.id)), checkpoints: [] };
    engine.reload();
    if (engine.isBlocked?.()) {
        meta[ORIGIN_META_KEY] = raw;
        engine.reload();
        return { ok: false, reason: 'origin-retract-failed' };
    }
    try { saveMetadata?.(); } catch (error) { /* 落盘交给宿主防抖，下次保存时补上 */ }
    return { ok: true, text: target.text };
}
