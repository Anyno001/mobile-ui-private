import { anchorKey } from '../points/points-policy.js';

const object = value => value && typeof value === 'object' && !Array.isArray(value);
const text = value => typeof value === 'string' && value.length > 0;
const natural = value => Number.isSafeInteger(value) && value >= 0;
const anchor = value => object(value) && text(value.floorId) && natural(value.swipeId);
const sameAnchor = (a, b) => anchor(a) && anchorKey(a) === anchorKey(b);
const sourceTypes = new Set(['origin-text', 'origin-task', 'origin-achievement', 'origin-item']);

export function validOriginEconomy(plan) {
    if (!object(plan) || plan.version !== 1 || !text(plan.id) || !anchor(plan.anchor)
        || !Array.isArray(plan.receipts) || !Array.isArray(plan.charges) || !Array.isArray(plan.tasks)) return false;
    if (!plan.receipts.every((r, index) => object(r) && r.eventId === index && text(r.sourceId)
        && sourceTypes.has(r.sourceType) && sameAnchor(r.anchor, plan.anchor)
        && natural(r.requested) && r.requested > 0 && natural(r.approved)
        && r.approved <= (r.sourceType === 'origin-text' ? 20 : 100)
        && natural(r.income) && r.income <= r.approved && natural(r.refund)
        && r.approved <= r.requested - r.refund && r.amount === r.income + r.refund
        && r.amount <= r.requested && typeof r.reason === 'string'
        && (r.consumeId === undefined || text(r.consumeId)) && (!r.refund || text(r.consumeId)))) return false;
    if (plan.receipts.reduce((sum, r) => sum + r.income, 0) > 150) return false;
    const sources = new Map();
    for (const r of plan.receipts) sources.set(r.sourceId, (sources.get(r.sourceId) || 0) + r.income);
    if ([...sources.values()].some(amount => amount > 100)) return false;
    return plan.charges.every((c, index) => object(c) && c.id === `${plan.id}:consume:${index}`
        && natural(c.amount) && sameAnchor(c.anchor, plan.anchor))
        && plan.tasks.every((t, index) => object(t) && t.sourceId === `${plan.id}:task:${index}`
            && natural(t.points) && t.points <= 100 && typeof t.reward === 'string');
}
