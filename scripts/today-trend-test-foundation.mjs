const REPLAY_SCHEMA = 'today-trend-deterministic-sequence';
const REPLAY_VERSION = 1;

export function normalizeDeterministicSeed(seed) {
    if (typeof seed === 'string') {
        const value = seed.trim();
        if (!value) throw new TypeError('seed must be a non-empty string or finite number');
        return `string:${value}`;
    }
    if (typeof seed === 'number' && Number.isFinite(seed)) return `number:${Object.is(seed, -0) ? 0 : seed}`;
    throw new TypeError('seed must be a non-empty string or finite number');
}

const hashSeed = value => {
    const text = String(value);
    let hash = 2166136261;
    for (const character of text) {
        hash ^= character.codePointAt(0);
        hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
};

const createRandomFromNormalizedSeed = normalizedSeed => {
    let state = hashSeed(normalizedSeed) || 0x6d2b79f5;
    const random = () => {
        state = (state + 0x6d2b79f5) >>> 0;
        let value = state;
        value = Math.imul(value ^ value >>> 15, value | 1);
        value ^= value + Math.imul(value ^ value >>> 7, value | 61);
        return ((value ^ value >>> 14) >>> 0) / 4294967296;
    };
    Object.defineProperty(random, 'normalizedSeed', { value: normalizedSeed, enumerable: true });
    return random;
};

export function createSeededRandom(seed) {
    return createRandomFromNormalizedSeed(normalizeDeterministicSeed(seed));
}

const normalizeFaultEntries = (entries, steps) => {
    if (!Array.isArray(entries)) throw new TypeError('faults must be an array');
    const seen = new Set();
    return entries.map((entry, index) => {
        if (!entry || !Number.isSafeInteger(entry.step) || entry.step < 0) throw new TypeError(`faults[${index}].step must be a non-negative safe integer`);
        if (steps !== undefined && entry.step >= steps) throw new RangeError(`faults[${index}].step must be lower than steps`);
        if (typeof entry.code !== 'string' || !entry.code.trim()) throw new TypeError(`faults[${index}].code must be a non-empty string`);
        if (seen.has(entry.step)) throw new RangeError(`duplicate fault step: ${entry.step}`);
        seen.add(entry.step);
        return Object.freeze({ step: entry.step, code: entry.code.trim() });
    });
};

export function createFaultSchedule(entries = [], { steps } = {}) {
    const normalized = normalizeFaultEntries(entries, steps);
    const pending = new Map(normalized.map(entry => [entry.step, entry.code]));
    return {
        hit(step) {
            if (!Number.isSafeInteger(step) || step < 0) throw new TypeError('fault lookup step must be a non-negative safe integer');
            const code = pending.get(step);
            if (code === undefined) return null;
            pending.delete(step);
            const error = new Error(`Injected fault: ${code}`);
            Object.defineProperty(error, 'faultScheduleEntry', { value: true });
            error.code = code;
            error.step = step;
            return error;
        },
        remaining() {
            return [...pending.entries()].map(([step, code]) => ({ step, code }));
        },
    };
}

const freezeFaults = faults => Object.freeze(faults.map(entry => Object.freeze({ ...entry })));

const createReplayDescriptor = ({ scenarioId, seed, steps, faults, fixtureVersion, firstFailureStep = null }) => Object.freeze({
    schema: REPLAY_SCHEMA,
    version: REPLAY_VERSION,
    scenarioId,
    seed,
    seedFormat: 'normalized-v1',
    steps,
    faults: freezeFaults(faults),
    fixtureVersion,
    firstFailureStep,
});

const infrastructureFailure = (message, cause, descriptor, trace, step) => {
    const error = new Error(message, cause === undefined ? undefined : { cause });
    error.code = 'TT_TEST_INFRASTRUCTURE';
    error.firstFailureStep = step;
    error.replayDescriptor = createReplayDescriptor({ ...descriptor, firstFailureStep: step });
    error.trace = trace.map(entry => ({ ...entry }));
    return error;
};

export async function runDeterministicSequence({
    schema = REPLAY_SCHEMA, version = REPLAY_VERSION, scenarioId = 'today-trend-sequence', seed, seedFormat = 'raw',
    steps = 20, faults = [], fixtureVersion = 'today-trend-v1', transition,
}) {
    if (schema !== REPLAY_SCHEMA || version !== REPLAY_VERSION) throw new RangeError('replay descriptor schema or version is unsupported');
    if (!Number.isInteger(steps) || steps < 1 || steps > 10000) throw new RangeError('steps must be an integer between 1 and 10000');
    if (typeof scenarioId !== 'string' || !scenarioId.trim()) throw new TypeError('scenarioId must be a non-empty string');
    if (typeof fixtureVersion !== 'string' || !fixtureVersion.trim()) throw new TypeError('fixtureVersion must be a non-empty string');
    if (typeof transition !== 'function') throw new TypeError('transition must be a function');
    if (seedFormat !== 'raw' && seedFormat !== 'normalized-v1') throw new TypeError('seedFormat must be raw or normalized-v1');
    const normalizedSeed = seedFormat === 'normalized-v1' ? String(seed || '').trim() : normalizeDeterministicSeed(seed);
    if (seedFormat === 'normalized-v1') {
        const stringSeed = normalizedSeed.match(/^string:(.+)$/s)?.[1];
        const numberSeed = normalizedSeed.match(/^number:(.+)$/)?.[1];
        if ((!stringSeed || !stringSeed.trim()) && (numberSeed === undefined || !Number.isFinite(Number(numberSeed)))) {
            throw new TypeError('normalized seed is invalid');
        }
    }
    const random = createRandomFromNormalizedSeed(normalizedSeed);
    const normalizedFaults = normalizeFaultEntries(faults, steps);
    const schedule = createFaultSchedule(normalizedFaults, { steps });
    const descriptor = createReplayDescriptor({
        scenarioId: scenarioId.trim(), seed: random.normalizedSeed, steps, faults: normalizedFaults, fixtureVersion: fixtureVersion.trim(),
    });
    const trace = [];
    let state = null;
    for (let step = 0; step < steps; step += 1) {
        const fault = schedule.hit(step);
        const sample = random();
        try {
            let candidateState;
            try {
                candidateState = state === null ? null : structuredClone(state);
            } catch (error) {
                throw infrastructureFailure(`state must be structured-cloneable before step ${step}`, error, descriptor, trace, step);
            }
            const result = await transition({ state: candidateState, step, sample, fault });
            if (fault) throw infrastructureFailure(`expected fault ${fault.code} was not thrown at step ${step}`, undefined, descriptor, trace, step);
            if (!result || typeof result !== 'object' || !Object.hasOwn(result, 'state')) {
                throw infrastructureFailure(`transition must return an object containing state at step ${step}`, undefined, descriptor, trace, step);
            }
            try {
                state = structuredClone(result.state);
            } catch (error) {
                throw infrastructureFailure(`transition state must be structured-cloneable at step ${step}`, error, descriptor, trace, step);
            }
            trace.push({ step, sample, fault: null, status: 'accepted', outcome: result.outcome ?? null });
        } catch (error) {
            if (error?.code === 'TT_TEST_INFRASTRUCTURE') throw error;
            if (!fault || error !== fault || error.faultScheduleEntry !== true || error.step !== step || error.code !== fault.code) {
                throw infrastructureFailure(`unexpected transition failure at step ${step}`, error, descriptor, trace, step);
            }
            trace.push({ step, sample, fault: fault.code, status: 'rejected', error: { code: fault.code, message: String(error?.message || error) } });
        }
    }
    const remainingFaults = schedule.remaining();
    if (remainingFaults.length) throw infrastructureFailure('fault schedule was not fully consumed', undefined, descriptor, trace, trace.length);
    const firstFailureStep = trace.find(entry => entry.status === 'rejected')?.step ?? null;
    return { replayDescriptor: createReplayDescriptor({ ...descriptor, firstFailureStep }), state, trace, remainingFaults };
}

export function createTodayTrendV1Fixture(createDynamicsSettings) {
    return {
        version: 1,
        presets: {
            preset: {
                id: 'preset', name: '综艺世界', version: 1, revision: 1, createdAt: 1, updatedAt: 2,
                source: { worldBookNames: ['厨房'], includeExistingChat: true, userRequirements: '保持节目规则' },
                moduleRules: { world: '世界', reputation: '风评', faction: '势力', dynamics: '动态' },
                moduleSchemas: { worldItems: '项目', reputationCircles: '圈层', factionGuidance: '指引' },
                dynamicsRules: { general: '总规则', incident: '突发', rumor: '流言', underground: '地下' },
            },
        },
        scopes: {
            chat: {
                storageId: 'chat', characterId: 'character', characterName: '小明', presetId: 'preset',
                operation: { enabled: true, mode: 'auto', intervalFloors: 3, lastSuccessfulAssistantCount: 7, lastSuccessfulRunAt: 9 },
                injection: { enabled: false, minimalUi: false },
                world: { items: [{ id: 'world', name: '节目风向', summary: '晚餐服务临近' }] },
                dynamicsSettings: createDynamicsSettings(),
                reputation: { circles: [{ id: 'judge', name: '主厨评审', scope: '节目评审', status: 'neutral', evaluation: '仍在观察' }] },
                factions: [
                    { id: 'red', name: '红队', summary: '参赛队伍', parentId: null, relatedFactionIds: [], details: [{ label: '队长', value: '阿红' }], relation: { status: 'like', evaluation: '认可配合能力' } },
                    { id: 'station', name: '节目组', summary: '制作单位', parentId: 'red', relatedFactionIds: [], details: [], relation: { status: 'neutral', evaluation: '正在观察' } },
                ],
                dynamics: {
                    active: [{ id: 'service', type: 'normal', lifecycle: 'active', title: '晚餐服务', stageLabel: '准备中', origin: '开餐临近', participants: ['小明', '红队'], stages: ['分配岗位', '检查食材'], latestStage: '检查食材', outcome: null, finalResult: null, relatedEventIds: [], createdAt: 1, updatedAt: 2 }],
                    archived: [{ id: 'rumor', type: 'rumor', lifecycle: 'archived', title: '换队传闻', stageLabel: '已证实', origin: '后台流言', participants: ['小明'], stages: ['开始流传'], latestStage: '开始流传', outcome: 'confirmed', finalResult: '传闻属实', relatedEventIds: ['service'], createdAt: 1, updatedAt: 3 }],
                },
            },
        },
    };
}
