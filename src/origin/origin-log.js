// Origin 操作日志与数据库记录的纯转换；积分只由已确认的操作重放派生。
import { fillSettings, hash53, isAiMsg } from './origin-state.js';
import { buildPath, deserializeLedger, replay } from './origin-ledger.js';

export const ORIGIN_RECORD_TYPE = 'origin';
export const isOriginRecord = (row) => row?.type === ORIGIN_RECORD_TYPE || String(row?.id || '').startsWith('or|');
const copy = (value) => JSON.parse(JSON.stringify(value));
const object = (value) => value && typeof value === 'object' && !Array.isArray(value);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function fields(raw) {
    if (!raw) return new Map();
    const { entries, ops, ...header } = raw;
    return new Map([['header', header],
        ...entries.map((entry) => [`entry:${entry.messageId}:${entry.swipeId}`, entry]),
        ...ops.map((op) => [`op:${op.id}`, op])]);
}
function rawOf(values) {
    if (!values.has('header')) return null;
    return { ...values.get('header'),
        entries: [...values].filter(([key]) => key.startsWith('entry:')).map(([, value]) => value),
        ops: [...values].filter(([key]) => key.startsWith('op:')).map(([, value]) => value) };
}
const validRaw = (raw) => object(raw) && Number.isInteger(raw.version) && typeof raw.chatId === 'string'
    && Array.isArray(raw.entries) && Array.isArray(raw.ops);
const validKey = (key) => key === 'header' || /^entry:\d+:\d+$/.test(key) || /^op:\d+$/.test(key);

export function prepareOriginWrite(before, raw, now = Date.now()) {
    if (!before?.ok || !validRaw(raw)) return { ok: false, reason: 'origin-database-invalid' };
    const previous = fields(before.raw);
    const next = fields(raw);
    const set = [...next].filter(([key, value]) => !same(value, previous.get(key))).map(([key, value]) => ({ key, value }));
    const drop = [...previous.keys()].filter((key) => !next.has(key));
    if (!set.length && !drop.length) return { ok: true, unchanged: true, raw, revision: before.revision };
    const payload = copy({ parent: before.revision, set, drop });
    const record = { id: `or|${hash53(JSON.stringify(payload))}`, type: ORIGIN_RECORD_TYPE, character: 'Origin', anchor: null, createdAt: now, payload };
    return { ok: true, record, raw: copy(raw), revision: record.id };
}

export function mergeOriginRecords(rows) {
    const values = new Map();
    const seen = new Map();
    let revision = null;
    for (const row of (rows || []).filter(isOriginRecord)) {
        const p = row.payload;
        if (!object(p) || row.type !== ORIGIN_RECORD_TYPE || !Array.isArray(p.set) || !Array.isArray(p.drop)
            || row.id !== `or|${hash53(JSON.stringify(p))}`) return { ok: false, reason: 'origin-database-invalid' };
        if (seen.has(row.id)) {
            if (!same(seen.get(row.id), p)) return { ok: false, reason: 'origin-database-conflict' };
            continue;
        }
        if (p.parent !== revision) return { ok: false, reason: 'origin-database-conflict' };
        if (p.drop.some((key) => !validKey(key)) || p.set.some((item) => !object(item) || !validKey(item.key) || !object(item.value))) {
            return { ok: false, reason: 'origin-database-invalid' };
        }
        for (const key of p.drop) values.delete(key);
        for (const { key, value } of p.set) values.set(key, value);
        const raw = rawOf(values);
        if (!validRaw(raw)) return { ok: false, reason: 'origin-database-invalid' };
        revision = row.id;
        seen.set(row.id, p);
    }
    return { ok: true, raw: copy(rawOf(values)), revision };
}

// 两个消费者共用同一份已确认操作；纯回放不产生数据库写入。
export function originPointsOf(stored, chat) {
    if (!stored?.ok) return stored || { ok: false, reason: 'origin-database-read-failed' };
    if (!stored.raw) return { ok: true, balance: 0 };
    const restored = deserializeLedger(stored.raw, stored.raw.chatId);
    if (!restored.ok || restored.dropped.length) return { ok: false, reason: restored.reason || 'origin-database-invalid' };
    const rep = replay(restored.ledger, buildPath(chat, isAiMsg), fillSettings(stored.raw.rules));
    return Number.isSafeInteger(rep.state.points)
        ? { ok: true, balance: rep.state.points }
        : { ok: false, reason: 'origin-points-invalid' };
}
