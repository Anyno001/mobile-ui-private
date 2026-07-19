import { EXTENSION_PROMPT_POSITIONS, MAX_INJECTION_CHARS, MAX_INJECTION_DEPTH } from './constants.js';

export const BUDGET_CONFIG_KEY = 'ST_SMS_BUDGET_CONFIG';
export const BUDGET_VERSION = 1;
export const BUDGET_SOURCES = Object.freeze(['phone', 'community', 'calendar']);
export const DEFAULT_SAFE_INPUT_TOKENS = Math.floor(MAX_INJECTION_CHARS / 4);
const MAX_TARGET_TOKENS = 12000;

export const DEFAULT_BUDGET_CONFIG = Object.freeze({
    budgetVersion: BUDGET_VERSION,
    targetTokens: DEFAULT_SAFE_INPUT_TOKENS,
    sourceWeights: Object.freeze({ phone: 1, community: 0, calendar: 0 }),
    sourcePriority: Object.freeze(['phone', 'community', 'calendar']),
    redistributeUnused: true,
    communityEnabled: false,
    communityPosition: EXTENSION_PROMPT_POSITIONS.IN_PROMPT,
    communityDepth: 0,
    communitySceneIdsByStorage: Object.freeze({}),
    communitySelectionsByStorage: Object.freeze({}),
    calendarEnabled: false,
    calendarPosition: EXTENSION_PROMPT_POSITIONS.IN_PROMPT,
    calendarDepth: 0,
});

const finiteInteger = (value, min, max) => typeof value === 'number'
    && Number.isFinite(value) && Number.isInteger(value) && value >= min && value <= max;
const plainRecord = value => value && typeof value === 'object' && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);

function normalizeWeights(value) {
    if (!plainRecord(value)) return { ...DEFAULT_BUDGET_CONFIG.sourceWeights };
    const result = {};
    for (const source of BUDGET_SOURCES) {
        if (!Object.hasOwn(value, source)) {
            result[source] = DEFAULT_BUDGET_CONFIG.sourceWeights[source];
            continue;
        }
        const weight = value[source];
        if (typeof weight !== 'number' || !Number.isFinite(weight) || weight < 0) {
            return { ...DEFAULT_BUDGET_CONFIG.sourceWeights };
        }
        result[source] = weight;
    }
    return Object.values(result).some(weight => weight > 0)
        ? result
        : { ...DEFAULT_BUDGET_CONFIG.sourceWeights };
}

function normalizePriority(value) {
    const result = [];
    if (Array.isArray(value)) {
        for (const source of value) {
            if (BUDGET_SOURCES.includes(source) && !result.includes(source)) result.push(source);
        }
    }
    for (const source of BUDGET_SOURCES) if (!result.includes(source)) result.push(source);
    return result;
}

function normalizeSceneIds(value) {
    if (!plainRecord(value)) return {};
    const result = {};
    for (const storageId of Object.keys(value)) {
        const ids = value[storageId];
        if (!storageId || !Array.isArray(ids)) continue;
        const clean = [];
        for (const id of ids) {
            if (typeof id !== 'string') continue;
            const normalized = id.trim().slice(0, 80);
            if (normalized && !clean.includes(normalized)) clean.push(normalized);
        }
        if (clean.length) result[storageId] = clean;
    }
    return result;
}

function normalizeCommunitySelections(value) {
    if (!plainRecord(value)) return {};
    const result = {};
    for (const storageId of Object.keys(value)) {
        if (!storageId || !plainRecord(value[storageId])) continue;
        const selections = {};
        for (const sceneId of Object.keys(value[storageId])) {
            const source = value[storageId][sceneId];
            if (!sceneId || sceneId.length > 80 || !plainRecord(source)) continue;
            if (source.mode === 'all') {
                selections[sceneId] = { mode: 'all', postIds: [] };
                continue;
            }
            if (source.mode !== 'selected' || !Array.isArray(source.postIds)) continue;
            const postIds = [];
            for (const postId of source.postIds) {
                if (typeof postId !== 'string') continue;
                const normalized = postId.trim().slice(0, 80);
                if (normalized && !postIds.includes(normalized)) postIds.push(normalized);
            }
            selections[sceneId] = { mode: 'selected', postIds };
        }
        if (Object.keys(selections).length) result[storageId] = selections;
    }
    return result;
}

export function normalizeBudgetConfig(value) {
    const source = plainRecord(value) ? value : {};
    const allowedPositions = Object.values(EXTENSION_PROMPT_POSITIONS).filter(position => position >= 0);
    return {
        budgetVersion: BUDGET_VERSION,
        targetTokens: finiteInteger(source.targetTokens, 1, MAX_TARGET_TOKENS)
            ? source.targetTokens : DEFAULT_BUDGET_CONFIG.targetTokens,
        sourceWeights: normalizeWeights(source.sourceWeights),
        sourcePriority: normalizePriority(source.sourcePriority),
        redistributeUnused: typeof source.redistributeUnused === 'boolean'
            ? source.redistributeUnused : DEFAULT_BUDGET_CONFIG.redistributeUnused,
        communityEnabled: source.communityEnabled === true,
        communityPosition: allowedPositions.includes(source.communityPosition)
            ? source.communityPosition : DEFAULT_BUDGET_CONFIG.communityPosition,
        communityDepth: finiteInteger(source.communityDepth, 0, MAX_INJECTION_DEPTH)
            ? source.communityDepth : DEFAULT_BUDGET_CONFIG.communityDepth,
        communitySceneIdsByStorage: normalizeSceneIds(source.communitySceneIdsByStorage),
        communitySelectionsByStorage: normalizeCommunitySelections(source.communitySelectionsByStorage),
        calendarEnabled: source.calendarEnabled === true,
        calendarPosition: allowedPositions.includes(source.calendarPosition)
            ? source.calendarPosition : DEFAULT_BUDGET_CONFIG.calendarPosition,
        calendarDepth: finiteInteger(source.calendarDepth, 0, MAX_INJECTION_DEPTH)
            ? source.calendarDepth : DEFAULT_BUDGET_CONFIG.calendarDepth,
    };
}


export function estimateContextTokens(value) {
    const text = typeof value === 'string' ? value : String(value ?? '');
    let asciiCharacters = 0;
    let nonAsciiCharacters = 0;
    for (const character of text) {
        if (character.codePointAt(0) <= 0x7f) asciiCharacters += 1;
        else nonAsciiCharacters += 1;
    }
    return {
        estimated: true,
        characters: text.length,
        estimatedTokens: Math.ceil(asciiCharacters / 4) + nonAsciiCharacters,
    };
}

export function trimToEstimatedTokens(value, tokenLimit, marker = '【较早内容因资源预算已省略】\n') {
    const text = typeof value === 'string' ? value : String(value ?? '');
    const limit = finiteInteger(tokenLimit, 0, MAX_TARGET_TOKENS) ? tokenLimit : 0;
    const originalTokens = estimateContextTokens(text).estimatedTokens;
    if (originalTokens <= limit) return { text, truncated: false, originalTokens, estimatedTokens: originalTokens };
    if (limit === 0) return { text: '', truncated: true, originalTokens, estimatedTokens: 0 };
    let prefix = marker;
    if (estimateContextTokens(prefix).estimatedTokens > limit) prefix = '';
    const characters = Array.from(text);
    let low = 0;
    let high = characters.length;
    while (low < high) {
        const middle = Math.ceil((low + high) / 2);
        const candidate = prefix + characters.slice(-middle).join('');
        if (estimateContextTokens(candidate).estimatedTokens <= limit) low = middle;
        else high = middle - 1;
    }
    const trimmedText = prefix + characters.slice(-low).join('');
    return {
        text: trimmedText,
        truncated: true,
        originalTokens,
        estimatedTokens: estimateContextTokens(trimmedText).estimatedTokens,
    };
}

export function allocateContextBudget({ config, safeMaxTokens = DEFAULT_SAFE_INPUT_TOKENS, demandBySource = {} } = {}) {
    const normalized = normalizeBudgetConfig(config);
    const safeLimit = finiteInteger(safeMaxTokens, 1, MAX_TARGET_TOKENS)
        ? safeMaxTokens : DEFAULT_SAFE_INPUT_TOKENS;
    const totalBudgetTokens = Math.min(normalized.targetTokens, safeLimit);
    const demand = Object.fromEntries(BUDGET_SOURCES.map(source => {
        const value = demandBySource[source];
        const normalizedDemand = typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value) && value >= 0
            ? Math.min(value, MAX_TARGET_TOKENS) : 0;
        return [source, normalizedDemand];
    }));
    const weightTotal = BUDGET_SOURCES.reduce((sum, source) => sum + normalized.sourceWeights[source], 0);
    const allocations = Object.fromEntries(BUDGET_SOURCES.map(source => [source, 0]));
    // All sources use floor allocation; no source "eats the remainder".
    // Remainder is distributed via redistributeUnused by priority order.
    for (const source of BUDGET_SOURCES) {
        const weight = normalized.sourceWeights[source];
        const share = weightTotal > 0 ? Math.floor(totalBudgetTokens * weight / weightTotal) : 0;
        allocations[source] = Math.min(share, demand[source]);
    }
    let remaining = totalBudgetTokens - Object.values(allocations).reduce((sum, value) => sum + value, 0);
    if (normalized.redistributeUnused && remaining > 0) {
        for (const source of normalized.sourcePriority) {
            if (remaining <= 0) break;
            const unusedCapacity = demand[source] - allocations[source];
            if (unusedCapacity > 0) {
                const granted = Math.min(remaining, unusedCapacity);
                allocations[source] += granted;
                remaining -= granted;
            }
        }
    }
    return {
        estimated: true,
        config: normalized,
        safeMaxTokens: safeLimit,
        totalBudgetTokens,
        allocations,
        demandBySource: demand,
        allocatedTokens: Object.values(allocations).reduce((sum, value) => sum + value, 0),
    };
}
