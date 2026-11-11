import { activePointsAnchor, anchorKey, pointFloors, windowAllowance } from '../points/points-policy.js';
import { validOriginEconomy } from './origin-economy-schema.js';

export const ORIGIN_ECONOMY_VERSION = 1;
const CREDIT_REASONS = {
    'origin-no-anchor': '无有效AI楼', 'origin-credit-limit': '单笔上限',
    'origin-source-limit': '来源额度', 'origin-floor-limit': '本楼额度', 'origin-window-limit': '连续10楼额度',
};
export function originCreditText({ approved, amount, refund = 0, reason = '' }) {
    const limits = reason.split(',').filter(Boolean).map(key => CREDIT_REASONS[key] || key).join('、');
    return `积分核准${approved}，实发${amount}${refund ? `（本金返还${refund}）` : ''}${limits ? `（${limits}）` : ''}`;
}
const clone = value => JSON.parse(JSON.stringify(value));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
export function economyContext(plan, approval) {
    if (!plan) return null;
    if (!validOriginEconomy(plan)) throw new Error('origin-economy-invalid');
    return { plan, approval, credit: 0, charge: 0, task: 0, source: null };
}
export function economyPlan(id, anchor) {
    return { version: ORIGIN_ECONOMY_VERSION, id, anchor, receipts: [], charges: [], tasks: [] };
}
function book(st) {
    st.economy ||= { grants: [], spends: [] };
    return st.economy;
}
export function withOriginSource(cx, source, fn) {
    if (!cx.economy) return fn();
    const previous = cx.economy.source;
    cx.economy.source = source;
    try { return fn(); } finally { cx.economy.source = previous; }
}
export function originSource(cx) {
    const e = cx.economy;
    return e?.source || { sourceId: `${e?.plan.id}:text`, sourceType: 'origin-text' };
}
export function creditOrigin(st, requested, cx) {
    if (!Number.isSafeInteger(requested)) throw new Error('origin-points-invalid');
    if (!cx.economy || requested <= 0) { st.points += requested; return requested; }
    const e = cx.economy, plan = e.plan, source = originSource(cx), eventId = e.credit++;
    const state = book(st);
    const spend = source.consumeId && state.spends.find(s => s.id === source.consumeId);
    let receipt;
    if (e.approval) {
        const { chat, grants } = e.approval;
        const valid = activePointsAnchor(plan.anchor, chat);
        const refund = valid && spend && activePointsAnchor(spend.anchor, chat) ? Math.min(requested, spend.amount - spend.returned) : 0;
        const used = grants.filter(g => g.sourceId === source.sourceId).reduce((n, g) => n + g.amount, 0);
        const floorUsed = grants.filter(g => anchorKey(g.anchor) === anchorKey(plan.anchor)).reduce((n, g) => n + g.amount, 0);
        const approved = Math.min(requested - refund, source.sourceType === 'origin-text' ? 20 : 100);
        const windowLeft = windowAllowance(pointFloors(chat), grants, plan.anchor, 300);
        const income = valid ? Math.max(0, Math.min(approved, 100 - used, 150 - floorUsed, windowLeft)) : 0;
        const reasons = !valid ? ['origin-no-anchor'] : [
            approved < requested - refund && 'origin-credit-limit',
            100 - used < approved && 'origin-source-limit',
            150 - floorUsed < approved && 'origin-floor-limit',
            windowLeft < approved && 'origin-window-limit',
        ].filter(Boolean);
        receipt = { eventId, ...source, anchor: plan.anchor, requested, approved, refund, income,
            amount: refund + income, reason: reasons.join(',') };
        plan.receipts.push(receipt);
        if (income) grants.push({ ...receipt, amount: income });
    } else receipt = plan.receipts.find(r => r.eventId === eventId);

    if (receipt && (receipt.requested !== requested
        || !same(Object.fromEntries(Object.keys(source).map(k => [k, receipt[k]])), source))) {
        throw new Error('origin-economy-dependency-changed');
    }
    if (!receipt || !Number.isSafeInteger(receipt.income) || receipt.income < 0 || !Number.isSafeInteger(receipt.refund) || receipt.refund < 0
        || receipt.amount !== receipt.income + receipt.refund || receipt.amount > requested) throw new Error('origin-economy-receipt-invalid');
    const refund = spend ? Math.min(receipt.refund, Math.max(0, spend.amount - spend.returned)) : 0;
    if (spend) spend.returned += refund;
    const amount = receipt.income + refund;
    st.points += amount;
    state.grants.push({ ...clone(receipt), amount: receipt.income });
    cx.notes ||= [];
    cx.notes.push({ kind: 'points', requested, approved: receipt.approved + receipt.refund, refund, amount, reason: receipt.reason });
    cx.events.push(originCreditText({ approved: receipt.approved + receipt.refund, refund, amount, reason: receipt.reason }));
    return amount;
}
export function chargeOrigin(st, amount, cx) {
    if (!Number.isSafeInteger(amount) || amount < 0) throw new Error('origin-points-invalid');
    st.points -= amount;
    if (!cx.economy) return null;
    const e = cx.economy, index = e.charge++;
    const charge = { id: `${e.plan.id}:consume:${index}`, amount, anchor: e.plan.anchor };
    if (e.approval) e.plan.charges.push(charge);
    else if (!same(e.plan.charges[index], charge)) throw new Error('origin-economy-charge-invalid');
    book(st).spends.push({ ...charge, returned: 0 });
    return charge.id;
}
export function approveTask(task, cx) {
    if (!cx.economy) return task;
    const e = cx.economy, index = e.task++;
    let approved;
    if (e.approval) {
        const values = [...String(task.reward || '').matchAll(/积分\s*([+-]?\d+)/g)].map(m => Number(m[1])).filter(n => n > 0);
        const points = Math.min(100, values.length ? values.reduce((n, v) => n + v, 0) : ({ '日常': 20, '支线': 50, '主线': 100 })[task.type] || 50);
        const rest = String(task.reward || '').replace(/积分\s*[+-]?\d+/g, '').trim();
        approved = { sourceId: `${e.plan.id}:task:${index}`, points, reward: `积分+${points}${rest ? ' ' + rest : ''}` };
        e.plan.tasks.push(approved);
    } else approved = e.plan.tasks[index];
    if (!approved || !Number.isSafeInteger(approved.points) || approved.points < 0 || approved.points > 100) throw new Error('origin-economy-task-invalid');
    return { ...task, reward: approved.reward, pointSource: approved.sourceId, approvedPoints: approved.points };
}
export function putOriginItem(st, item, count, cx, source = originSource(cx)) {
    let row = st.bag.find(b => b.name === item.name);
    if (!row) { row = { ...item, count: 0 }; st.bag.push(row); }
    if (cx.economy) {
        if (!Array.isArray(row.lots)) row.lots = row.count > 0 ? [{ count: row.count, sourceId: `${cx.economy.plan.id}:legacy:${item.name}`, sourceType: 'origin-item', effect: row.effect || '' }] : [];
        row.lots.push({ count, ...clone(source), sourceType: source.sourceType === 'origin-text' ? 'origin-item' : source.sourceType,
            effect: item.effect || '' });
    }
    row.count = (Number(row.count) || 0) + count;
    return row;
}
export function takeOriginItem(st, item, count) {
    const n = Math.min(item.count || 1, Math.max(1, count));
    const taken = [];
    let left = n;
    for (const lot of item.lots || []) {
        const used = Math.min(lot.count, left);
        if (used > 0) { taken.push({ ...lot, count: used }); lot.count -= used; left -= used; }
    }
    item.lots = (item.lots || []).filter(lot => lot.count > 0);
    if (left > 0) taken.push({ count: left, sourceType: 'origin-item', effect: item.effect || '' });
    item.count = (item.count || 1) - n;
    if (item.count <= 0) st.bag.splice(st.bag.indexOf(item), 1);
    return taken;
}
export function collectOriginGrants(ledger, chat, excludeId) {
    const rows = [...(ledger.policy?.entries.values() || []), ...(ledger.policy?.ops || []), ...ledger.entries.values(), ...ledger.ops];
    return rows.flatMap(row => row.economy && row.economy.id !== excludeId
        && activePointsAnchor(row.economy.anchor, chat) ? row.economy.receipts.filter(r => r.income > 0).map(r => ({ ...r, amount: r.income })) : []);
}
