import { parseCalendarDate, formatCalendarDate } from './calendar-model.js';

export const CYCLE_STORE_VERSION = 1;

export const CYCLE_LIMITS = Object.freeze({
    scopes: 80,
    subjects: 40,
    overrides: 120,
    cycleMin: 21,
    cycleMax: 45,
    periodMin: 2,
    periodMax: 10,
});

export const CYCLE_PHASES = Object.freeze(['period', 'follicular', 'ovulatory', 'luteal']);
export const CYCLE_OVERRIDE_TYPES = Object.freeze(['period', 'non_period']);

const plainRecord = value => value && typeof value === 'object' && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
const unsafeKey = value => value === 'prototype' || Object.hasOwn(Object.prototype, value);
const SELF_SUBJECT = '__self__';
const validSubject = value => value === SELF_SUBJECT || (!!value && value === value.trim() && value.length <= 120 && !unsafeKey(value));
const integerInRange = (value, min, max) => Number.isInteger(Number(value))
    && Number(value) >= min && Number(value) <= max;

/** 创建一个空的生理周期 Store */
export function createEmptyCycleStore() {
    return { version: CYCLE_STORE_VERSION, scopes: {} };
}

/** 创建一个空的生理周期 Scope */
export function createEmptyCycleScope() {
    return { enabled: false, lastPeriodStart: null, cycleLength: 28, periodLength: 5, overrides: {}, subjects: {} };
}

/** 归一化生理周期 Scope */
export function normalizeCycleScope(value) {
    const source = plainRecord(value) ? value : {};
    const cycleLength = integerInRange(source.cycleLength, CYCLE_LIMITS.cycleMin, CYCLE_LIMITS.cycleMax)
        ? Number(source.cycleLength) : 28;
    const periodLengthRaw = integerInRange(source.periodLength, CYCLE_LIMITS.periodMin, Math.min(CYCLE_LIMITS.periodMax, cycleLength))
        ? Number(source.periodLength) : 5;
    let lastPeriodStart = null;
    if (source.lastPeriodStart) {
        const parsed = parseCalendarDate(source.lastPeriodStart);
        if (parsed) lastPeriodStart = formatCalendarDate(parsed);
    }
    const overrides = {};
    let count = 0;
    if (plainRecord(source.overrides)) {
        for (const date of Object.keys(source.overrides).sort()) {
            if (count >= CYCLE_LIMITS.overrides) break;
            if (!parseCalendarDate(date)) continue;
            if (!CYCLE_OVERRIDE_TYPES.includes(source.overrides[date])) continue;
            overrides[date] = source.overrides[date];
            count += 1;
        }
    }
    const normalized = {
        enabled: source.enabled === true,
        lastPeriodStart,
        cycleLength,
        periodLength: periodLengthRaw,
        overrides,
        subjects: {},
    };
    if (plainRecord(source.subjects)) {
        for (const [subject, rawProfile] of Object.entries(source.subjects)) {
            if (Object.keys(normalized.subjects).length >= CYCLE_LIMITS.subjects) break;
            if (!validSubject(subject) || subject === SELF_SUBJECT || !plainRecord(rawProfile)) continue;
            const profile = normalizeCycleScope({ ...rawProfile, subjects: {} });
            delete profile.subjects;
            normalized.subjects[subject] = profile;
        }
    }
    return normalized;
}

/** 归一化生理周期 Store */
export function normalizeCycleStore(value) {
    const source = plainRecord(value) ? value : {};
    const scopes = {};
    for (const [storageId, rawScope] of Object.entries(plainRecord(source.scopes) ? source.scopes : {})) {
        if (Object.keys(scopes).length >= CYCLE_LIMITS.scopes) break;
        if (!storageId || storageId !== storageId.trim() || storageId.length > 160 || unsafeKey(storageId)) continue;
        scopes[storageId] = normalizeCycleScope(rawScope);
    }
    return { version: CYCLE_STORE_VERSION, scopes };
}

/** 获取指定 storageId 的生理周期 Scope，不存在时返回空 scope */
export function cycleScopeFor(store, storageId, subject = SELF_SUBJECT) {
    const scope = normalizeCycleStore(store).scopes[storageId] || createEmptyCycleScope();
    if (subject === SELF_SUBJECT) return scope;
    return scope.subjects?.[subject] || createEmptyCycleScope();
}

export function cycleSubjectKeys(store, storageId) {
    const scope = normalizeCycleStore(store).scopes[storageId] || createEmptyCycleScope();
    return [SELF_SUBJECT, ...Object.keys(scope.subjects || {})];
}

/** 更新或创建指定 storageId 的生理周期 Scope，返回新的 Store */
export function upsertCycleScope(store, storageId, rawScope, subject = SELF_SUBJECT) {
    const next = normalizeCycleStore(store);
    const id = String(storageId ?? '');
    if (!id || id !== id.trim() || id.length > 160 || unsafeKey(id)) throw new Error('storageId 无效');
    if (!plainRecord(rawScope)) throw new Error('周期资料必须是对象');
    if (!integerInRange(rawScope.cycleLength, CYCLE_LIMITS.cycleMin, CYCLE_LIMITS.cycleMax)) {
        throw new Error(`周期长度必须是 ${CYCLE_LIMITS.cycleMin} 到 ${CYCLE_LIMITS.cycleMax} 天`);
    }
    if (!integerInRange(rawScope.periodLength, CYCLE_LIMITS.periodMin, CYCLE_LIMITS.periodMax)
        || Number(rawScope.periodLength) > Number(rawScope.cycleLength)) {
        throw new Error(`经期长度必须是 ${CYCLE_LIMITS.periodMin} 到 ${CYCLE_LIMITS.periodMax} 天，且不能超过周期长度`);
    }
    if (rawScope.enabled === true && !rawScope.lastPeriodStart) {
        throw new Error('启用周期提示时必须设置末次经期开始日期');
    }
    if (rawScope.lastPeriodStart && !parseCalendarDate(rawScope.lastPeriodStart)) throw new Error('末次经期开始日期无效');
    const normalized = normalizeCycleScope(rawScope);
    if (!validSubject(subject)) throw new Error('周期主体无效');
    if (subject === SELF_SUBJECT) {
        normalized.subjects = next.scopes[id]?.subjects || normalized.subjects;
        next.scopes[id] = normalized;
    } else {
        const container = next.scopes[id] || createEmptyCycleScope();
        const profile = { ...normalized };
        delete profile.subjects;
        container.subjects[subject] = profile;
        next.scopes[id] = container;
    }
    return next;
}

/** 清除指定 storageId 的生理周期 Scope，返回新的 Store */
export function clearCycleScope(store, storageId, subject = SELF_SUBJECT) {
    const next = normalizeCycleStore(store);
    if (subject === SELF_SUBJECT) {
        const subjects = next.scopes[storageId]?.subjects || {};
        if (Object.keys(subjects).length) next.scopes[storageId] = { ...createEmptyCycleScope(), subjects };
        else delete next.scopes[storageId];
    } else if (next.scopes[storageId]?.subjects) {
        delete next.scopes[storageId].subjects[subject];
    }
    return next;
}

export const CYCLE_SELF_SUBJECT = SELF_SUBJECT;

/**
 * 计算目标日期在周期中的第几天（1-indexed）。
 * 从 lastPeriodStart 开始按 cycleLength 循环。
 * 返回 null 表示无法计算（未启用、missing lastPeriodStart 或日期在开始之前）。
 */
function cycleDayIndex(scope, dateStr) {
    if (!scope.enabled || !scope.lastPeriodStart) return null;
    const start = parseCalendarDate(scope.lastPeriodStart);
    const target = parseCalendarDate(dateStr);
    if (!start || !target) return null;
    const diff = Math.round((target - start) / 86400000);
    if (diff < 0) return null;
    return (diff % scope.cycleLength) + 1;
}

/**
 * 根据周期天数（1-indexed）推断生理阶段。
 *   - 1 ~ periodLength: period
 *   - 经期结束后至易孕窗口前: follicular（界面留空）
 *   - 预计排卵日前 5 天至后 1 天: ovulatory（易孕期）
 *   - 易孕窗口之后: luteal（安全期）
 * 易孕窗口起点不得早于经期结束后的第一天，所有边界限制在当前周期内。
 */
function phaseForDay(day, cycleLength, periodLength) {
    if (day <= periodLength) return 'period';
    const ovulationDay = Math.max(periodLength + 1, Math.min(cycleLength - 14, cycleLength - 1));
    const fertileStart = Math.max(periodLength + 1, ovulationDay - 5);
    const fertileEnd = Math.min(cycleLength, ovulationDay + 1);
    if (day < fertileStart) return 'follicular';
    if (day <= fertileEnd) return 'ovulatory';
    return 'luteal';
}

/**
 * 预测指定日期的生理周期阶段。
 * status 取值：'override'（用户手工标记）、'predicted'（基于参数推算）。
 */
export function predictCyclePhase(scope, dateStr) {
    const normalized = normalizeCycleScope(scope);
    if (!normalized.enabled) {
        return { phase: null, status: 'disabled', day: null, nextPeriodStart: null };
    }
    // 优先检查手工 override
    if (normalized.overrides[dateStr]) {
        const override = normalized.overrides[dateStr];
        return {
            phase: override === 'period' ? 'period' : null,
            status: 'override',
            day: null,
            nextPeriodStart: null,
        };
    }
    const day = cycleDayIndex(normalized, dateStr);
    if (day === null) {
        return { phase: null, status: 'insufficient_data', day: null, nextPeriodStart: null };
    }
    const phase = phaseForDay(day, normalized.cycleLength, normalized.periodLength);
    const status = 'predicted';
    // 计算下次经期开始日期
    const start = parseCalendarDate(normalized.lastPeriodStart);
    const target = parseCalendarDate(dateStr);
    const diff = Math.round((target - start) / 86400000);
    const cyclesElapsed = Math.floor(diff / normalized.cycleLength);
    const nextStart = new Date(start);
    nextStart.setDate(start.getDate() + (cyclesElapsed + 1) * normalized.cycleLength);
    return {
        phase,
        status,
        day,
        nextPeriodStart: formatCalendarDate(nextStart),
    };
}

/**
 * 预测日期范围内每天的生理周期阶段。
 * 返回数组，每项包含 date、phase、status、day（周期第几天）。
 */
export function predictCycleRange(scope, startDate, days = 7) {
    const normalized = normalizeCycleScope(scope);
    const start = parseCalendarDate(startDate);
    if (!start) throw new Error('开始日期无效');
    const count = Math.max(1, Math.min(90, Number.isFinite(days) ? Math.floor(days) : 7));
    const results = [];
    for (let i = 0; i < count; i += 1) {
        const date = new Date(start);
        date.setDate(start.getDate() + i);
        const dateStr = formatCalendarDate(date);
        const prediction = predictCyclePhase(normalized, dateStr);
        results.push({ date: dateStr, phase: prediction.phase, status: prediction.status, day: prediction.day });
    }
    return { predictions: results };
}
