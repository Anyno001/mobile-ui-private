import { normalizeTodayTrendStore, TODAY_TREND_LIMITS } from './today-trend-model.js';
import {
    appendTodayTrendCanonicalSnapshot, applyTodayTrendHistoryProducer, rollbackTodayTrendCanonicalPayload,
    gcTodayTrendCheckpointEntityStore, materializeTodayTrendCheckpoint, storeTodayTrendCheckpoint,
} from './today-trend-history-reducer.js';

export const TODAY_TREND_V2_STORE_VERSION = 2;
const LEGACY_GLOBAL_ENVELOPE_VERSION = 1;
const LEGACY_SCOPE_ENVELOPE_VERSION = 1;
const GLOBAL_ENVELOPE_VERSION = 2;
const LEGACY_FULL_CHECKPOINT_SCOPE_VERSION = 2;
const SCOPE_ENVELOPE_VERSION = 3;
const PROJECTION_KINDS = new Set([
    'live-stage', 'undated-stage', 'legacy-stage', 'day-summary', 'period-summary', 'span-stage',
]);
const REMOVABLE_PREFIXES = { detail: 'detail', 'day-summary': 'day', manifest: 'manifest' };
const REMOVAL_REASONS = new Set(['detail-pool-capacity', 'period-compaction', 'archived-retention']);
const LEGACY_STAGE_KIND = 'legacy-stage';
const clone = value => structuredClone(value);
const plainRecord = value => value && typeof value === 'object' && !Array.isArray(value);
const same = (left, right) => {
    if (left === right) return true;
    if (Array.isArray(left) || Array.isArray(right)) {
        return Array.isArray(left) && Array.isArray(right) && left.length === right.length
            && left.every((item, index) => same(item, right[index]));
    }
    if (!plainRecord(left) || !plainRecord(right)) return false;
    const leftKeys = Object.keys(left);
    const rightKeys = Object.keys(right);
    if (leftKeys.length !== rightKeys.length) return false;
    return leftKeys.every(key => Object.hasOwn(right, key) && same(left[key], right[key]));
};

function failure(code, message) {
    const error = new Error(message);
    error.code = code;
    throw error;
}
const invalid = message => failure('TT_V2_SCHEMA_INVALID', message);

function safeInteger(value, field, minimum = 0) {
    if (!Number.isSafeInteger(value) || value < minimum) invalid(`${field} 必须是大于等于 ${minimum} 的安全整数`);
    return value;
}

function exact(value, keys, field) {
    if (!plainRecord(value)) invalid(`${field} 必须是对象`);
    if (Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) {
        invalid(`${field} 字段集合无效`);
    }
}

function nonEmptyString(value, field) {
    if (typeof value !== 'string' || !value) invalid(`${field} 必须是非空字符串`);
}

function nullableString(value, field) {
    if (value !== null && typeof value !== 'string') invalid(`${field} 必须是字符串或 null`);
}

const timePattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
function nullableTime(value, field) {
    if (value !== null && (typeof value !== 'string' || !timePattern.test(value))) invalid(`${field} 必须是 HH:mm 或 null`);
}
const datePattern = /^\d{4}-\d{2}-\d{2}$/;
function date(value, field) {
    const parsed = typeof value === 'string' && datePattern.test(value) ? new Date(`${value}T12:00:00Z`) : null;
    if (!parsed || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
        invalid(`${field} 必须是有效 YYYY-MM-DD 日期`);
    }
}

function nullableInteger(value, field) {
    if (value !== null) safeInteger(value, field);
}

function stringArray(value, field) {
    if (!Array.isArray(value) || value.some(item => typeof item !== 'string' || !item)) {
        invalid(`${field} 必须是非空字符串数组`);
    }
    if (new Set(value).size !== value.length) invalid(`${field} 不得重复`);
}

function legacyStageId(eventId, index) {
    return `legacy:${eventId}:${String(index + 1).padStart(4, '0')}`;
}

function migrateLegacyStage(eventId, text, index) {
    return {
        id: legacyStageId(eventId, index), kind: LEGACY_STAGE_KIND, text, legacyIndex: index,
        sourceStageStart: index + 1, sourceStageEnd: index + 1, revision: 1,
    };
}

function normalizeLegacyStage(value, eventId) {
    exact(value, ['id', 'kind', 'text', 'legacyIndex', 'sourceStageStart', 'sourceStageEnd', 'revision'], 'legacy-stage');
    safeInteger(value.legacyIndex, 'legacy-stage.legacyIndex');
    if (value.id !== legacyStageId(eventId, value.legacyIndex) || value.kind !== LEGACY_STAGE_KIND
        || value.sourceStageStart !== value.legacyIndex + 1 || value.sourceStageEnd !== value.legacyIndex + 1 || value.revision !== 1
        || typeof value.text !== 'string' || !value.text) invalid('legacy-stage 内容无效');
    return { ...value };
}

function normalizeFloorRange(value, field) {
    nullableInteger(value.sourceFloorStart, `${field}.sourceFloorStart`);
    nullableInteger(value.sourceFloorEnd, `${field}.sourceFloorEnd`);
    if ((value.sourceFloorStart === null) !== (value.sourceFloorEnd === null)
        || (value.sourceFloorStart !== null && value.sourceFloorStart > value.sourceFloorEnd)) {
        invalid(`${field} 楼层区间无效`);
    }
}

function normalizeSourceRange(value, field) {
    safeInteger(value.sourceStageStart, `${field}.sourceStageStart`, 1);
    safeInteger(value.sourceStageEnd, `${field}.sourceStageEnd`, 1);
    if (value.sourceStageStart > value.sourceStageEnd) invalid(`${field} source 区间无效`);
    if (value.revision !== 1) invalid(`${field}.revision 无效`);
}

function normalizeLiveStage(value, eventId) {
    exact(value, ['id', 'kind', 'storyDate', 'time', 'timeLabel', 'text', 'sourceStageStart', 'sourceStageEnd', 'sourceFloorStart', 'sourceFloorEnd', 'revision'], 'live-stage');
    normalizeSourceRange(value, 'live-stage');
    normalizeFloorRange(value, 'live-stage');
    if (!String(value.id).startsWith(`live:${eventId}:`) || value.kind !== 'live-stage') invalid('live-stage ID 或 kind 无效');
    date(value.storyDate, 'live-stage.storyDate');
    nullableTime(value.time, 'live-stage.time');
    nullableString(value.timeLabel, 'live-stage.timeLabel');
    nonEmptyString(value.text, 'live-stage.text');
    return clone(value);
}

function normalizeUndatedStage(value, eventId) {
    exact(value, ['id', 'kind', 'storyDate', 'time', 'timeLabel', 'text', 'undatedSequence', 'sourceStageStart', 'sourceStageEnd', 'sourceFloorStart', 'sourceFloorEnd', 'revision'], 'undated-stage');
    normalizeSourceRange(value, 'undated-stage');
    normalizeFloorRange(value, 'undated-stage');
    safeInteger(value.undatedSequence, 'undated-stage.undatedSequence', 1);
    if (value.id !== `undated:${eventId}:${value.undatedSequence}` || value.kind !== 'undated-stage' || value.storyDate !== null) {
        invalid('undated-stage ID、kind 或 storyDate 无效');
    }
    nullableTime(value.time, 'undated-stage.time');
    nullableString(value.timeLabel, 'undated-stage.timeLabel');
    nonEmptyString(value.text, 'undated-stage.text');
    return clone(value);
}

function normalizeTimeRange(value, field) {
    exact(value, ['start', 'end', 'label'], field);
    nullableTime(value.start, `${field}.start`);
    nullableTime(value.end, `${field}.end`);
    nullableString(value.label, `${field}.label`);
    if ((value.start === null) !== (value.end === null) || (value.start !== null && value.start > value.end)) {
        invalid(`${field} 钟点区间无效`);
    }
    if (value.start !== null && value.label !== null) invalid(`${field} 可靠钟点与自然语言标签不得并存`);
}

function normalizeDaySummary(value, eventId) {
    exact(value, ['id', 'kind', 'status', 'storyDate', 'timeRange', 'summary', 'keyStages', 'detailRefs', 'detailCount', 'sourceStageStart', 'sourceStageEnd', 'sourceFloorStart', 'sourceFloorEnd', 'revision'], 'day-summary');
    normalizeSourceRange(value, 'day-summary');
    normalizeFloorRange(value, 'day-summary');
    if (value.id !== `day:${eventId}:${value.storyDate}` || value.kind !== 'day-summary' || value.status !== 'closed') invalid('day-summary ID、kind 或 status 无效');
    date(value.storyDate, 'day-summary.storyDate');
    normalizeTimeRange(value.timeRange, 'day-summary.timeRange');
    nonEmptyString(value.summary, 'day-summary.summary');
    stringArray(value.keyStages, 'day-summary.keyStages');
    stringArray(value.detailRefs, 'day-summary.detailRefs');
    safeInteger(value.detailCount, 'day-summary.detailCount');
    return clone(value);
}

function normalizePeriodSummary(value, eventId) {
    exact(value, ['id', 'kind', 'periodSequence', 'startDate', 'startTime', 'endDate', 'endTime', 'summary', 'childSummaryRefs', 'childSummaryCount', 'historicalDetailCount', 'sourceStageStart', 'sourceStageEnd', 'revision'], 'period-summary');
    normalizeSourceRange(value, 'period-summary');
    safeInteger(value.periodSequence, 'period-summary.periodSequence', 1);
    if (value.id !== `period:${eventId}:${value.periodSequence}` || value.kind !== 'period-summary') invalid('period-summary ID 或 kind 无效');
    date(value.startDate, 'period-summary.startDate');
    nullableTime(value.startTime, 'period-summary.startTime');
    date(value.endDate, 'period-summary.endDate');
    nullableTime(value.endTime, 'period-summary.endTime');
    if ((value.startTime === null) !== (value.endTime === null)) invalid('period-summary 钟点区间必须同时存在或同时为空');
    if (value.startDate > value.endDate || (value.startDate === value.endDate && value.startTime !== null
        && value.endTime !== null && value.startTime > value.endTime)) invalid('period-summary 时间区间无效');
    nonEmptyString(value.summary, 'period-summary.summary');
    stringArray(value.childSummaryRefs, 'period-summary.childSummaryRefs');
    safeInteger(value.childSummaryCount, 'period-summary.childSummaryCount');
    safeInteger(value.historicalDetailCount, 'period-summary.historicalDetailCount');
    return clone(value);
}

function normalizeSpanStage(value, eventId) {
    exact(value, ['id', 'kind', 'startDate', 'startTime', 'endDate', 'endTime', 'summary', 'sourceStageStart', 'sourceStageEnd', 'sourceFloorStart', 'sourceFloorEnd', 'revision'], 'span-stage');
    normalizeSourceRange(value, 'span-stage');
    normalizeFloorRange(value, 'span-stage');
    if (!String(value.id).startsWith(`span:${eventId}:`) || value.kind !== 'span-stage') invalid('span-stage ID 或 kind 无效');
    date(value.startDate, 'span-stage.startDate');
    nullableTime(value.startTime, 'span-stage.startTime');
    date(value.endDate, 'span-stage.endDate');
    nullableTime(value.endTime, 'span-stage.endTime');
    if ((value.startTime === null) !== (value.endTime === null)) invalid('span-stage 钟点区间必须同时存在或同时为空');
    if (value.startDate > value.endDate || (value.startDate === value.endDate && value.startTime !== null
        && value.endTime !== null && value.startTime > value.endTime)) invalid('span-stage 时间区间无效');
    nonEmptyString(value.summary, 'span-stage.summary');
    return clone(value);
}

export function normalizeTodayTrendStageProjection(value, eventId) {
    if (!plainRecord(value) || !PROJECTION_KINDS.has(value.kind)) invalid('StageProjection kind 无效');
    if (value.kind === 'legacy-stage') return normalizeLegacyStage(value, eventId);
    if (value.kind === 'live-stage') return normalizeLiveStage(value, eventId);
    if (value.kind === 'undated-stage') return normalizeUndatedStage(value, eventId);
    if (value.kind === 'day-summary') return normalizeDaySummary(value, eventId);
    if (value.kind === 'period-summary') return normalizePeriodSummary(value, eventId);
    return normalizeSpanStage(value, eventId);
}

export function resolveTodayTrendV2LatestStage(event) {
    if (!plainRecord(event) || !Array.isArray(event.stages) || event.stages.length === 0) invalid('v2 event stages 不能为空');
    const latest = event.stages.reduce((selected, stage) => !selected
        || stage.sourceStageEnd > selected.sourceStageEnd
        || (stage.sourceStageEnd === selected.sourceStageEnd && stage.sourceStageStart > selected.sourceStageStart)
        || (stage.sourceStageEnd === selected.sourceStageEnd && stage.sourceStageStart === selected.sourceStageStart && stage.id > selected.id)
        ? stage : selected, null);
    return projectionText(latest);
}

function migrateEvent(event, archivedSequence = null) {
    const stages = event.stages.map((text, index) => migrateLegacyStage(event.id, text, index));
    return {
        ...clone(event), stages, capacityCompatibilityPending: stages.length === 40,
        ...(event.lifecycle === 'archived' ? { archivedAtAssistantCount: null, archivedSequence } : {}),
    };
}

function projectionText(stage) {
    return ['day-summary', 'period-summary', 'span-stage'].includes(stage.kind) ? stage.summary : stage.text;
}

function projectFixedCore(stage) {
    const common = {
        id: stage.id, kind: stage.kind, sourceStageStart: stage.sourceStageStart,
        sourceStageEnd: stage.sourceStageEnd, revision: stage.revision,
    };
    if (stage.kind === 'legacy-stage') return {
        ...common, text: stage.text, legacyIndex: stage.legacyIndex,
    };
    if (stage.kind === 'live-stage') return {
        ...common, storyDate: stage.storyDate, time: stage.time, timeLabel: stage.timeLabel, text: stage.text,
        sourceFloorStart: stage.sourceFloorStart, sourceFloorEnd: stage.sourceFloorEnd,
    };
    if (stage.kind === 'undated-stage') return {
        ...common, storyDate: stage.storyDate, time: stage.time, timeLabel: stage.timeLabel, text: stage.text,
        undatedSequence: stage.undatedSequence,
        sourceFloorStart: stage.sourceFloorStart, sourceFloorEnd: stage.sourceFloorEnd,
    };
    if (stage.kind === 'day-summary') return {
        ...common, status: stage.status, storyDate: stage.storyDate, timeRange: clone(stage.timeRange),
        summary: stage.summary, keyStages: clone(stage.keyStages), detailCount: stage.detailCount,
        sourceFloorStart: stage.sourceFloorStart, sourceFloorEnd: stage.sourceFloorEnd,
    };
    if (stage.kind === 'period-summary') return {
        ...common, periodSequence: stage.periodSequence, startDate: stage.startDate, startTime: stage.startTime,
        endDate: stage.endDate, endTime: stage.endTime, summary: stage.summary,
        childSummaryCount: stage.childSummaryCount, historicalDetailCount: stage.historicalDetailCount,
    };
    if (stage.kind === 'span-stage') return {
        ...common, startDate: stage.startDate, startTime: stage.startTime, endDate: stage.endDate,
        endTime: stage.endTime, summary: stage.summary,
        sourceFloorStart: stage.sourceFloorStart, sourceFloorEnd: stage.sourceFloorEnd,
    };
    invalid('fixed core StageProjection kind 无效');
}

const promptText = (value, maximum) => typeof value === 'string' ? value.trim().slice(0, maximum) : '';
const promptStageProjection = stage => {
    const common = { id: stage.id, kind: stage.kind, sourceStageStart: stage.sourceStageStart, sourceStageEnd: stage.sourceStageEnd };
    if (stage.kind === 'day-summary') return { ...common, storyDate: stage.storyDate, timeRange: clone(stage.timeRange),
        summary: promptText(stage.summary, 240), keyStages: stage.keyStages.map(item => promptText(item, 120)),
        detailCount: stage.detailCount, sourceFloorStart: stage.sourceFloorStart, sourceFloorEnd: stage.sourceFloorEnd };
    if (stage.kind === 'period-summary') return { ...common, periodSequence: stage.periodSequence, startDate: stage.startDate,
        startTime: stage.startTime, endDate: stage.endDate, endTime: stage.endTime, summary: promptText(stage.summary, 240),
        childSummaryCount: stage.childSummaryCount, historicalDetailCount: stage.historicalDetailCount };
    if (stage.kind === 'span-stage') return { ...common, startDate: stage.startDate, startTime: stage.startTime,
        endDate: stage.endDate, endTime: stage.endTime, summary: promptText(stage.summary, 240),
        sourceFloorStart: stage.sourceFloorStart, sourceFloorEnd: stage.sourceFloorEnd };
    return { ...common, storyDate: stage.storyDate, time: stage.time, timeLabel: stage.timeLabel,
        text: promptText(stage.text, 240), sourceFloorStart: stage.sourceFloorStart, sourceFloorEnd: stage.sourceFloorEnd };
};
const promptEventProjection = event => ({
    id: event.id, type: event.type, title: promptText(event.title, 120), stageLabel: promptText(event.stageLabel, 32),
    origin: promptText(event.origin, 240),
    participants: event.participants.map(item => promptText(item, 120)), stages: event.stages.map(promptStageProjection),
    latestStage: promptText(event.latestStage, 240), outcome: event.outcome, finalResult: event.finalResult === null ? null : promptText(event.finalResult, 240),
    relatedEventIds: clone(event.relatedEventIds), createdAt: event.createdAt, updatedAt: event.updatedAt,
});

function fitGenerationPromptProjection(value, maximum) {
    const result = clone(value);
    const encoded = () => JSON.stringify(result);
    while (encoded().length > maximum) {
        const eventWithHistory = [...result.dynamics.archived, ...result.dynamics.active].find(event => event.stages.length > 1);
        if (eventWithHistory) { eventWithHistory.stages.shift(); continue; }
        const eventWithLongText = [...result.dynamics.archived, ...result.dynamics.active]
            .find(event => event.stages.some(stage => typeof stage.summary === 'string' && stage.summary.length > 32));
        if (eventWithLongText) {
            const stage = eventWithLongText.stages.find(item => typeof item.summary === 'string' && item.summary.length > 32);
            stage.summary = stage.summary.slice(0, Math.max(32, Math.floor(stage.summary.length / 2)));
            continue;
        }
        if (result.dynamics.archived.length) { result.dynamics.archived.shift(); continue; }
        if (result.dynamics.active.length > 1) { result.dynamics.active.shift(); continue; }
        if (result.factions.length) { result.factions.shift(); continue; }
        if (result.reputation.circles.length) { result.reputation.circles.shift(); continue; }
        if (result.world.items.length) { result.world.items.shift(); continue; }
        return JSON.stringify({ world: { items: [] }, reputation: { circles: [] }, factions: [], dynamics: { active: [], archived: [] }, truncated: true });
    }
    return encoded();
}

/**
 * Produces the only history projection permitted in the normal generation prompt.
 * It intentionally excludes detail bodies, refs, lifecycle records and tombstones.
 */
export function serializeTodayTrendV2ScopeForGeneration(currentValue, storageId, { maxChars = 12000 } = {}) {
    const maximum = Number.isSafeInteger(maxChars) && maxChars > 0 ? maxChars : 12000;
    const store = normalizeTodayTrendV2Store(currentValue);
    const payload = store.globalEnvelope.payload.scopes[storageId]?.payload;
    if (!payload) return null;
    return fitGenerationPromptProjection({
        world: clone(payload.world), reputation: clone(payload.reputation), factions: clone(payload.factions),
        dynamics: {
            active: payload.dynamics.active.map(promptEventProjection),
            archived: payload.dynamics.archived.map(promptEventProjection),
        },
    }, maximum);
}
/**
 * UI-only canonical projection. It keeps structured stages but excludes detail pools,
 * manifests, lifecycle records and tombstones from the render input.
 */
export function resolveTodayTrendV2UiScope(currentValue, storageId) {
    if (typeof storageId !== 'string' || !storageId) return null;
    const store = normalizeTodayTrendV2Store(currentValue);
    const envelope = store.globalEnvelope.payload.scopes[storageId];
    const payload = envelope?.payload;
    if (!payload) return null;
    return clone({
        storageId: payload.storageId,
        characterId: payload.characterId,
        characterName: payload.characterName,
        presetId: payload.presetId,
        operation: payload.operation,
        injection: payload.injection,
        world: payload.world,
        reputation: payload.reputation,
        factions: payload.factions,
        dynamicsSettings: payload.dynamicsSettings,
        historyRetentionSettings: payload.historyRetentionSettings,
        dynamics: {
            active: payload.dynamics.active.map(event => uiEventProjection(event)),
            archived: payload.dynamics.archived.map(event => uiEventProjection(event)),
        },
    });
}

/**
 * CAS-only metadata for retention settings. Keep commit control fields out of the
 * general UI projection so renderers cannot accidentally persist stale state.
 */
export function resolveTodayTrendV2RetentionSettingsState(currentValue, storageId) {
    if (typeof storageId !== 'string' || !storageId) return null;
    const store = normalizeTodayTrendV2Store(currentValue);
    const envelope = store.globalEnvelope.payload.scopes[storageId];
    if (!envelope) return null;
    return clone({
        scopeRevision: envelope.revision,
        settingsRevision: envelope.payload.historyRetentionSettings.revision,
    });
}

function uiStageProjection(stage) {
    const projected = promptStageProjection(stage);
    return {
        id: projected.id, kind: projected.kind,
        displayText: projected.summary || projected.text || '',
        storyDate: projected.storyDate ?? null, time: projected.time ?? null, timeLabel: projected.timeLabel ?? null,
        startDate: projected.startDate ?? null, startTime: projected.startTime ?? null,
        endDate: projected.endDate ?? null, endTime: projected.endTime ?? null,
        timeRange: projected.timeRange ?? null, keyStages: projected.keyStages ?? [],
        detailCount: projected.detailCount ?? 0, detailRefs: stage.kind === 'day-summary' ? [...stage.detailRefs] : [],
    };
}

function uiEventProjection(event) {
    return {
        id: event.id, type: event.type, title: event.title, stageLabel: event.stageLabel,
        origin: event.origin, participants: [...event.participants], stages: event.stages.map(uiStageProjection),
        latestStage: event.latestStage, outcome: event.outcome, finalResult: event.finalResult,
        relatedEventIds: [...event.relatedEventIds], createdAt: event.createdAt, updatedAt: event.updatedAt,
    };
}


function reliableAssistantCount(value) {
    return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function parseRetentionInteger(value, field, maximum) {
    if (typeof value !== 'string' || !/^\d+$/.test(value.trim())) {
        failure('TT_RETENTION_SETTINGS_INVALID', `${field} 必须是十进制整数字符串`);
    }
    const parsed = Number(value.trim());
    if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > maximum) {
        failure('TT_RETENTION_SETTINGS_INVALID', `${field} 必须在 0..${maximum} 范围内`);
    }
    return parsed;
}

function projectEventToV1(event) {
    return {
        id: event.id, type: event.type, lifecycle: event.lifecycle, title: event.title, stageLabel: event.stageLabel,
        origin: event.origin, participants: event.participants, stages: event.stages.map(projectionText),
        latestStage: event.latestStage, outcome: event.outcome, finalResult: event.finalResult,
        relatedEventIds: event.relatedEventIds, createdAt: event.createdAt, updatedAt: event.updatedAt,
    };
}


function migrateDynamics(dynamics) {
    return {
        active: dynamics.active.map(event => migrateEvent(event)),
        archived: dynamics.archived.map((event, index) => migrateEvent(event, index + 1)),
    };
}

function projectDynamicsToV1(dynamics) {
    return {
        active: dynamics.active.map(projectEventToV1),
        archived: dynamics.archived.map(projectEventToV1),
    };
}

export function extractArchivedFixedCore(event) {
    if (event?.lifecycle !== 'archived') invalid('fixed core 只能从 archived event 提取');
    return clone({
        id: event.id, type: event.type, title: event.title, stageLabel: event.stageLabel,
        origin: event.origin, participants: event.participants, stages: event.stages.map(projectFixedCore), latestStage: event.latestStage,
        outcome: event.outcome, finalResult: event.finalResult, relatedEventIds: event.relatedEventIds,
        archivedAtAssistantCount: event.archivedAtAssistantCount, archivedSequence: event.archivedSequence,
        createdAt: event.createdAt, updatedAt: event.updatedAt,
    });
}

function scopeFacadeFields(scope) {
    return {
        storageId: scope.storageId, characterId: scope.characterId, characterName: scope.characterName, presetId: scope.presetId,
        operation: scope.operation, injection: scope.injection, world: scope.world, reputation: scope.reputation,
        factions: scope.factions, dynamicsSettings: scope.dynamicsSettings,
    };
}

function createScopePayload(scope) {
    const dynamics = migrateDynamics(scope.dynamics);
    const generationSnapshots = scope.generationSnapshots.map(snapshot => ({
        ...clone(snapshot),
        storeRevision: 0,
        detailPoolRevision: 0,
        visibleFromAssistantCount: snapshot.assistantCount,
        detailManifestRefs: [],
        retentionPolicyRevision: 1,
        restoreCapability: 'projection-only',
        checkpointRef: null,
        dynamics: migrateDynamics(snapshot.dynamics),
    }));
    const fixedCoreBaselineByEvent = {};
    for (const event of dynamics.archived) fixedCoreBaselineByEvent[event.id] = extractArchivedFixedCore(event);
    return {
        ...scopeFacadeFields(scope), dynamics, generationSnapshots,
        historyRetentionSettings: { archivedDetailLatestEventCount: 2, archivedDetailRetentionFloors: 20, revision: 1 },
        historyRetentionState: { highWaterAssistantCount: null, nextArchivedSequence: dynamics.archived.length + 1, detailPoolRevision: 0, retentionPolicyRevision: 1 },
        stageDetailsByEvent: {}, archivedRemovableDataByEvent: {}, removableEntityStateById: {}, removableEntityTombstonesById: {},
        fixedCoreBaselineByEvent, checkpointEntityStore: {}, commitJournal: null,
    };
}

function projectScopePayloadToV1(scope) {
    return {
        ...scopeFacadeFields(scope), dynamics: projectDynamicsToV1(scope.dynamics),
        generationSnapshots: scope.generationSnapshots.map(snapshot => ({
            assistantCount: snapshot.assistantCount, generatedAt: snapshot.generatedAt,
            world: clone(snapshot.world), reputation: clone(snapshot.reputation), factions: clone(snapshot.factions),
            dynamicsSettings: clone(snapshot.dynamicsSettings), dynamics: projectDynamicsToV1(snapshot.dynamics),
        })),
    };
}

function normalizeEventProjection(event, lifecycle) {
    if (!plainRecord(event) || event.lifecycle !== lifecycle || !Array.isArray(event.stages) || event.stages.length > 40) {
        invalid('v2 event projection 无效');
    }
    const keys = ['id', 'type', 'lifecycle', 'title', 'stageLabel', 'origin', 'participants', 'stages', 'latestStage', 'outcome', 'finalResult', 'relatedEventIds', 'createdAt', 'updatedAt', 'capacityCompatibilityPending'];
    if (lifecycle === 'archived') keys.push('archivedAtAssistantCount', 'archivedSequence');
    exact(event, keys, 'v2 event');
    const normalized = clone(event);
    normalized.stages = event.stages.map(stage => normalizeTodayTrendStageProjection(stage, event.id));
    const stageIds = new Set();
    let previous = null;
    for (const stage of normalized.stages) {
        if (stageIds.has(stage.id)) invalid('StageProjection ID 重复');
        stageIds.add(stage.id);
        if (previous) {
            const order = stage.sourceStageStart - previous.sourceStageStart
                || stage.sourceStageEnd - previous.sourceStageEnd || stage.id.localeCompare(previous.id);
            if (order <= 0) invalid('StageProjection 排序不稳定');
            if (stage.sourceStageStart <= previous.sourceStageEnd) invalid('StageProjection source 区间重叠');
        }
        previous = stage;
    }
    if (normalized.latestStage !== resolveTodayTrendV2LatestStage(normalized)) invalid('v2 latestStage 与最新 source 区间不一致');
    if (event.capacityCompatibilityPending !== (event.stages.length === 40)) invalid('capacityCompatibilityPending 与 stages 数量不一致');
    if (lifecycle === 'active') {
        if (Object.hasOwn(event, 'archivedSequence') || Object.hasOwn(event, 'archivedAtAssistantCount')) invalid('active event 不得携带归档字段');
    } else {
        safeInteger(event.archivedSequence, 'archivedSequence', 1);
        nullableInteger(event.archivedAtAssistantCount, 'archivedAtAssistantCount');
    }
    return normalized;
}

function normalizeRetentionSettings(value) {
    exact(value, ['archivedDetailLatestEventCount', 'archivedDetailRetentionFloors', 'revision'], 'historyRetentionSettings');
    safeInteger(value.archivedDetailLatestEventCount, 'archivedDetailLatestEventCount');
    safeInteger(value.archivedDetailRetentionFloors, 'archivedDetailRetentionFloors');
    if (value.archivedDetailLatestEventCount > 80) invalid('archivedDetailLatestEventCount 必须在 0..80 范围内');
    if (value.archivedDetailRetentionFloors > 1000) invalid('archivedDetailRetentionFloors 必须在 0..1000 范围内');
    safeInteger(value.revision, 'historyRetentionSettings.revision', 1);
    return clone(value);
}

function normalizeRetentionState(value) {
    exact(value, ['highWaterAssistantCount', 'nextArchivedSequence', 'detailPoolRevision', 'retentionPolicyRevision'], 'historyRetentionState');
    nullableInteger(value.highWaterAssistantCount, 'highWaterAssistantCount');
    safeInteger(value.nextArchivedSequence, 'nextArchivedSequence', 1);
    safeInteger(value.detailPoolRevision, 'detailPoolRevision');
    safeInteger(value.retentionPolicyRevision, 'retentionPolicyRevision', 1);
    return clone(value);
}

function normalizeRemovableRecord(value, field) {
    exact(value, ['entityType', 'entityId', 'eventId', 'state', 'removalReason', 'removedAtAssistantCount', 'policyRevision'], field);
    const prefix = REMOVABLE_PREFIXES[value.entityType];
    if (!prefix) invalid(`${field}.entityType 无效`);
    nonEmptyString(value.entityId, `${field}.entityId`);
    nonEmptyString(value.eventId, `${field}.eventId`);
    safeInteger(value.policyRevision, `${field}.policyRevision`, 1);
    nullableInteger(value.removedAtAssistantCount, `${field}.removedAtAssistantCount`);
    if (value.state === 'available') {
        if (value.removalReason !== null || value.removedAtAssistantCount !== null) invalid(`${field} available 状态不得携带删除信息`);
    } else if (value.state === 'removed') {
        if (!REMOVAL_REASONS.has(value.removalReason)) invalid(`${field}.removalReason 无效`);
    } else invalid(`${field}.state 无效`);
    if (!value.entityId.startsWith(`${prefix}:${value.eventId}:`)) invalid(`${field} identity 无效`);
    return clone(value);
}

function normalizeRemovableContainers(payload, eventIds, archivedEventIds) {
    if (!plainRecord(payload.stageDetailsByEvent) || !plainRecord(payload.archivedRemovableDataByEvent)
        || !plainRecord(payload.removableEntityStateById) || !plainRecord(payload.removableEntityTombstonesById)) {
        invalid('removable entity 容器无效');
    }
    const bodies = new Map();
    const refs = [];
    const addRefs = (values, prefix) => refs.push(...values.map(ref => {
        if (!ref.startsWith(prefix)) invalid('soft ref 类型或 event 不一致');
        return ref;
    }));
    const registerBody = (id, body, type, eventId) => {
        nonEmptyString(id, `${type} ID`);
        if (!eventIds.has(eventId)) invalid(`${type} 指向未知 event`);
        const existing = bodies.get(id);
        const normalized = clone(body);
        if (existing && !same(existing.body, normalized)) invalid('同一 removable entity ID 内容冲突');
        bodies.set(id, { body: normalized, type, eventId });
        return normalized;
    };
    const stageDetailsByEvent = {};
    for (const [eventId, details] of Object.entries(payload.stageDetailsByEvent)) {
        if (!eventIds.has(eventId) || !Array.isArray(details)) invalid('stageDetailsByEvent 无效');
        stageDetailsByEvent[eventId] = details.map(detail => {
            exact(detail, ['id', 'sourceStageSequence', 'text', 'storyDate'], 'stage detail');
            safeInteger(detail.sourceStageSequence, 'stage detail sourceStageSequence', 1);
            nonEmptyString(detail.text, 'stage detail text');
            nullableString(detail.storyDate, 'stage detail storyDate');
            if (detail.id !== `detail:${eventId}:${detail.sourceStageSequence}`) invalid('stage detail ID 无效');
            return registerBody(detail.id, detail, 'detail', eventId);
        });
    }
    const archivedRemovableDataByEvent = {};
    for (const [eventId, container] of Object.entries(payload.archivedRemovableDataByEvent)) {
        if (!eventIds.has(eventId)) invalid('archived removable data 指向未知 event');
        exact(container, ['daySummariesById', 'manifestsById'], 'archived removable data');
        if (!plainRecord(container.daySummariesById) || !plainRecord(container.manifestsById)) invalid('archived removable data 集合无效');
        if (!archivedEventIds.has(eventId) && Object.keys(container.daySummariesById).length) {
            invalid('active event 的 removable 容器只能保存 snapshot manifest');
        }
        const daySummariesById = {};
        for (const [id, summary] of Object.entries(container.daySummariesById)) {
            if (summary.id !== id) invalid('day summary key 与 ID 不一致');
            const normalized = normalizeDaySummary(summary, eventId);
            daySummariesById[id] = registerBody(id, normalized, 'day-summary', eventId);
            addRefs(normalized.detailRefs, `detail:${eventId}:`);
        }
        const manifestsById = {};
        for (const [id, manifest] of Object.entries(container.manifestsById)) {
            exact(manifest, ['id'], 'manifest');
            const prefix = `manifest:${eventId}:`;
            const revision = +id.slice(prefix.length);
            if (manifest.id !== id || `${prefix}${revision}` !== id) invalid('manifest ID 无效');
            safeInteger(revision, 'manifest snapshotRevision', 1);
            manifestsById[id] = registerBody(id, manifest, 'manifest', eventId);
        }
        archivedRemovableDataByEvent[eventId] = { daySummariesById, manifestsById };
    }
    for (const event of [...payload.dynamics.active, ...payload.dynamics.archived]) {
        for (const stage of event.stages) {
            if (stage.kind === 'day-summary') {
                if (event.lifecycle === 'active') registerBody(stage.id, stage, 'day-summary', event.id);
                addRefs(stage.detailRefs, `detail:${event.id}:`);
            } else if (stage.kind === 'period-summary') addRefs(stage.childSummaryRefs, `day:${event.id}:`);
        }
    }
    const removableEntityStateById = {};
    for (const [id, record] of Object.entries(payload.removableEntityStateById)) {
        const normalized = normalizeRemovableRecord(record, `removableEntityStateById.${id}`);
        if (normalized.entityId !== id) invalid('removable state key 与 entityId 不一致');
        if (!eventIds.has(normalized.eventId)) invalid('removable state 指向未知 event');
        removableEntityStateById[id] = normalized;
    }
    const removableEntityTombstonesById = {};
    for (const [id, record] of Object.entries(payload.removableEntityTombstonesById)) {
        const normalized = normalizeRemovableRecord(record, `removableEntityTombstonesById.${id}`);
        if (normalized.entityId !== id || normalized.state !== 'removed') invalid('tombstone 必须是 removed 审计副本');
        if (!eventIds.has(normalized.eventId)) invalid('tombstone 指向未知 event');
        removableEntityTombstonesById[id] = normalized;
    }
    for (const [id, body] of bodies) {
        const state = removableEntityStateById[id];
        if (!state || state.state !== 'available' || state.entityType !== body.type || state.eventId !== body.eventId) {
            invalid('removable 正文与 available state 不一致');
        }
        if (removableEntityTombstonesById[id]) invalid('available 正文不得存在 tombstone');
    }
    for (const [id, state] of Object.entries(removableEntityStateById)) {
        if (state.state === 'available' && !bodies.has(id)) invalid(`available state 缺少正文：${id}`);
        if (state.state === 'removed') {
            if (bodies.has(id)) invalid('removed state 不得保留正文');
            if (!same(removableEntityTombstonesById[id], state)) invalid('removed state 与 tombstone 不一致');
        }
    }
    for (const id of Object.keys(removableEntityTombstonesById)) {
        if (removableEntityStateById[id]?.state !== 'removed') invalid('tombstone 缺少 removed state');
    }
    for (const ref of refs) {
        if (!bodies.has(ref) && !removableEntityStateById[ref] && !removableEntityTombstonesById[ref]) {
            failure('TT_DANGLING_REF_UNKNOWN', `soft ref 指向未知 removable entity：${ref}`);
        }
    }
    return { stageDetailsByEvent, archivedRemovableDataByEvent, removableEntityStateById, removableEntityTombstonesById };
}

function entityIndex(payload) {
    const result = new Map();
    const add = value => result.set(value.id, value);
    for (const details of Object.values(payload.stageDetailsByEvent)) for (const detail of details) add(detail);
    for (const container of Object.values(payload.archivedRemovableDataByEvent)) {
        for (const summary of Object.values(container.daySummariesById)) add(summary);
        for (const manifest of Object.values(container.manifestsById)) add(manifest);
    }
    for (const event of [...payload.dynamics.active, ...payload.dynamics.archived]) {
        for (const stage of event.stages) result.set(stage.id, stage);
    }
    return result;
}

export function validateTodayTrendV2Transition(previousValue, candidateValue) {
    const previous = normalizeTodayTrendV2Store(previousValue);
    const candidate = normalizeTodayTrendV2Store(candidateValue);
    for (const [storageId, previousEnvelope] of Object.entries(previous.globalEnvelope.payload.scopes)) {
        const nextPayload = candidate.globalEnvelope.payload.scopes[storageId]?.payload;
        const previousPayload = previousEnvelope.payload;
        let transitionPreviousPayload = previousPayload;
        if (!nextPayload) {
            if (Object.values(previousPayload.removableEntityStateById).some(item => item.state === 'removed')) invalid('包含 removed lifecycle 的 scope 不得直接删除');
            continue;
        }
        const initializationSnapshot = nextPayload.generationSnapshots.length === 1
            ? nextPayload.generationSnapshots[0] : null;
        const initializationReplacement = initializationSnapshot?.assistantCount === 0
            && initializationSnapshot.restoreCapability === 'full'
            && initializationSnapshot.rerollFromAssistantCount === null
            && nextPayload.operation.lastSuccessfulAssistantCount === 0
            && nextPayload.historyRetentionState.highWaterAssistantCount === null
            && nextPayload.historyRetentionState.detailPoolRevision === 0
            && nextPayload.historyRetentionState.retentionPolicyRevision === 1
            && Object.keys(nextPayload.stageDetailsByEvent).length === 0
            && Object.keys(nextPayload.archivedRemovableDataByEvent).length === 0
            && Object.keys(nextPayload.removableEntityStateById).length === 0
            && Object.keys(nextPayload.removableEntityTombstonesById).length === 0;
        if (initializationReplacement) {
            if (Object.values(previousPayload.removableEntityStateById).some(item => item.state === 'removed')
                || Object.keys(previousPayload.removableEntityTombstonesById).length) {
                failure('TT_INITIALIZATION_REBUILD_BLOCKED', '当前今日风向包含不可逆归档清理记录，不能重建覆盖；请保留现有资料或恢复到清理前的聊天分支');
            }
            continue;
        }
        const legacyBaseline = legacyProjectionBaselineForTransition(previousPayload, nextPayload);
        const restoredSnapshot = nextPayload.generationSnapshots.at(-1);
        const priorRestoreSnapshot = restoredSnapshot?.restoreCapability === 'full'
            ? previousPayload.generationSnapshots.find(snapshot => snapshot.restoreCapability === 'full'
                && same(snapshot.checkpointRef, restoredSnapshot.checkpointRef)) : null;
        if (legacyBaseline) {
            transitionPreviousPayload = legacyBaseline;
        } else if (priorRestoreSnapshot) {
            const materialized = {
                ...materializeTodayTrendCheckpoint(restoredSnapshot.checkpointRef, nextPayload.checkpointEntityStore),
                generationSnapshots: clone(nextPayload.generationSnapshots),
                checkpointEntityStore: clone(nextPayload.checkpointEntityStore),
                commitJournal: null,
            };
            if (same(gcTodayTrendCheckpointEntityStore(nextPayload), gcTodayTrendCheckpointEntityStore(materialized))) {
                // Only a checkpoint already retained by the previous authority can reverse lifecycle history.
                continue;
            }
        }
        const rerollBaseFloor = restoredSnapshot?.rerollFromAssistantCount;
        const rerollBaseSnapshot = Number.isSafeInteger(rerollBaseFloor)
            ? previousPayload.generationSnapshots.find(snapshot => snapshot.assistantCount === rerollBaseFloor
                && snapshot.restoreCapability === 'full') : null;
        const retainedRerollBase = rerollBaseSnapshot && nextPayload.generationSnapshots.find(snapshot =>
            snapshot.assistantCount === rerollBaseFloor && same(snapshot.checkpointRef, rerollBaseSnapshot.checkpointRef));
        if (retainedRerollBase) {
            // A new F checkpoint may only reverse post-baseline state when it explicitly retains a full
            // checkpoint that was already authoritative before this transaction.
            transitionPreviousPayload = materializeTodayTrendCheckpoint(
                rerollBaseSnapshot.checkpointRef, previousPayload.checkpointEntityStore,
            );
        }
        const oldEntities = entityIndex(transitionPreviousPayload);
        const newEntities = entityIndex(nextPayload);
        const nextEvents = eventMap(nextPayload.dynamics);
        const previousArchivedIds = new Set(transitionPreviousPayload.dynamics.archived.map(event => event.id));
        for (const archived of transitionPreviousPayload.dynamics.archived) {
            const next = nextEvents.get(archived.id);
            if (!next) continue;
            if (next.lifecycle !== 'archived' || !same(extractArchivedFixedCore(archived), extractArchivedFixedCore(next))) {
                invalid('archived fixed core 不可改写或重新激活');
            }
        }
        let expectedArchivedSequence = transitionPreviousPayload.historyRetentionState.nextArchivedSequence;
        for (const archived of nextPayload.dynamics.archived) {
            if (previousArchivedIds.has(archived.id)) continue;
            const previousActive = transitionPreviousPayload.dynamics.active.find(event => event.id === archived.id);
            if (!previousActive || archived.archivedSequence !== expectedArchivedSequence) {
                invalid('新归档事件必须按 nextArchivedSequence 连续分配');
            }
            expectedArchivedSequence += 1;
        }
        if (nextPayload.historyRetentionState.nextArchivedSequence !== expectedArchivedSequence) {
            invalid('nextArchivedSequence 与归档事务不一致');
        }
        if (nextPayload.historyRetentionSettings.revision < transitionPreviousPayload.historyRetentionSettings.revision
            || nextPayload.historyRetentionState.retentionPolicyRevision < transitionPreviousPayload.historyRetentionState.retentionPolicyRevision) {
            invalid('retention revision 不得降低');
        }
        const previousHighWater = transitionPreviousPayload.historyRetentionState.highWaterAssistantCount;
        const nextHighWater = nextPayload.historyRetentionState.highWaterAssistantCount;
        if (previousHighWater !== null && (nextHighWater === null || nextHighWater < previousHighWater)) invalid('highWaterAssistantCount 不得降低');
        if (nextPayload.historyRetentionState.nextArchivedSequence < transitionPreviousPayload.historyRetentionState.nextArchivedSequence) invalid('nextArchivedSequence 不得降低');
        for (const [id, state] of Object.entries(transitionPreviousPayload.removableEntityStateById)) {
            const nextState = nextPayload.removableEntityStateById[id];
            if (state.state === 'removed' && !same(nextState, state)) invalid('removed lifecycle 不可逆或删除');
        }
        for (const [id, entity] of oldEntities) {
            if (newEntities.has(id) && !same(newEntities.get(id), entity)) invalid('稳定 ID 不得改写');
        }
    }
    return candidate;
}

function describeLegacyProjectionPayloadEligibility(payload) {
    if (!payload.generationSnapshots.length) return { eligible: false, reason: 'snapshot-missing' };
    if (!payload.generationSnapshots.every(snapshot => snapshot.restoreCapability === 'projection-only'
        && snapshot.checkpointRef === null)) return { eligible: false, reason: 'snapshot-not-projection-only' };
    if (!payload.generationSnapshots.some(snapshot => snapshot.assistantCount === 0)) {
        return { eligible: false, reason: 'floor-zero-snapshot-missing' };
    }
    if (Object.keys(payload.checkpointEntityStore).length) return { eligible: false, reason: 'checkpoint-store-not-empty' };
    if (Object.keys(payload.stageDetailsByEvent).length) return { eligible: false, reason: 'stage-details-not-empty' };
    if (Object.keys(payload.archivedRemovableDataByEvent).length) return { eligible: false, reason: 'archived-removable-data-not-empty' };
    if (Object.keys(payload.removableEntityStateById).length) return { eligible: false, reason: 'removable-entity-state-not-empty' };
    if (Object.keys(payload.removableEntityTombstonesById).length) return { eligible: false, reason: 'removable-entity-tombstones-not-empty' };
    if (payload.historyRetentionSettings.archivedDetailLatestEventCount !== 2
        || payload.historyRetentionSettings.archivedDetailRetentionFloors !== 20
        || payload.historyRetentionSettings.revision !== 1) return { eligible: false, reason: 'retention-settings-not-default' };
    if (payload.historyRetentionState.highWaterAssistantCount !== null) return { eligible: false, reason: 'history-high-water-present' };
    if (payload.historyRetentionState.detailPoolRevision !== 0) return { eligible: false, reason: 'detail-pool-revised' };
    if (payload.historyRetentionState.retentionPolicyRevision !== 1) return { eligible: false, reason: 'retention-policy-revised' };
    if (payload.historyRetentionState.nextArchivedSequence !== payload.dynamics.archived.length + 1) {
        return { eligible: false, reason: 'archived-sequence-inconsistent' };
    }
    return { eligible: true, reason: null };
}

export function describeTodayTrendLegacyBatchBaselineEligibility(currentValue, storageId) {
    const current = normalizeTodayTrendV2Store(currentValue);
    const payload = current.globalEnvelope.payload.scopes[storageId]?.payload;
    return payload ? describeLegacyProjectionPayloadEligibility(payload) : { eligible: false, reason: 'scope-missing' };
}

function legacyProjectionBaselineForTransition(previousPayload, nextPayload) {
    if (!describeLegacyProjectionPayloadEligibility(previousPayload).eligible) return null;
    const legacyBaseline = previousPayload.generationSnapshots.find(snapshot => snapshot.assistantCount === 0);
    const fullBaseline = nextPayload.generationSnapshots.find(snapshot => snapshot.assistantCount === 0
        && snapshot.restoreCapability === 'full');
    const latest = nextPayload.generationSnapshots.at(-1);
    if (!legacyBaseline || !fullBaseline || latest?.rerollFromAssistantCount !== 0
        || !same(snapshotV1Comparable(legacyBaseline), snapshotV1Comparable(fullBaseline))) return null;
    const materialized = materializeTodayTrendCheckpoint(fullBaseline.checkpointRef, nextPayload.checkpointEntityStore);
    if (materialized.operation?.lastSuccessfulAssistantCount !== 0 || materialized.operation?.lastSuccessfulRunAt !== legacyBaseline.generatedAt
        || !same(materialized.world, fullBaseline.world) || !same(materialized.reputation, fullBaseline.reputation)
        || !same(materialized.factions, fullBaseline.factions) || !same(materialized.dynamicsSettings, fullBaseline.dynamicsSettings)
        || !same(materialized.dynamics, fullBaseline.dynamics)) return null;
    return materialized;
}

function normalizeScopeEnvelope(value, presets) {
    if (!plainRecord(value)) invalid('scope envelope 必须是对象');
    if (value.schemaVersion > SCOPE_ENVELOPE_VERSION) {
        failure('TT_V2_FUTURE_VERSION', `scope envelope 版本 ${value.schemaVersion} 高于当前支持版本 ${SCOPE_ENVELOPE_VERSION}`);
    }
    exact(value, ['schemaVersion', 'revision', 'payload'], 'scope envelope');
    if (![LEGACY_FULL_CHECKPOINT_SCOPE_VERSION, SCOPE_ENVELOPE_VERSION].includes(value.schemaVersion)) {
        invalid('scope envelope 版本无效');
    }
    const migratingV2 = value.schemaVersion === LEGACY_FULL_CHECKPOINT_SCOPE_VERSION;
    safeInteger(value.revision, 'scope envelope revision');
    const payload = clone(value.payload);
    const payloadKeys = ['storageId', 'characterId', 'characterName', 'presetId', 'operation', 'injection', 'world', 'reputation', 'factions', 'dynamicsSettings', 'dynamics', 'generationSnapshots', 'historyRetentionSettings', 'historyRetentionState', 'stageDetailsByEvent', 'archivedRemovableDataByEvent', 'removableEntityStateById', 'removableEntityTombstonesById', 'fixedCoreBaselineByEvent', 'commitJournal'];
    if (Object.hasOwn(payload, 'checkpointEntityStore')) payloadKeys.push('checkpointEntityStore');
    exact(payload, payloadKeys, 'scope payload');
    if (!Object.hasOwn(payload, 'checkpointEntityStore')) payload.checkpointEntityStore = {};
    if (!plainRecord(payload.checkpointEntityStore)) invalid('checkpointEntityStore 必须是对象');
    if (!plainRecord(payload.dynamics) || !Array.isArray(payload.generationSnapshots)) invalid('scope payload 无效');
    if (payload.generationSnapshots.length > TODAY_TREND_LIMITS.generationSnapshots) {
        failure('TT_SNAPSHOT_LIMIT', 'canonical snapshot 数量超限');
    }
    payload.dynamics = {
        active: payload.dynamics.active.map(event => normalizeEventProjection(event, 'active')),
        archived: payload.dynamics.archived.map(event => normalizeEventProjection(event, 'archived')),
    };
    const eventIds = new Set();
    const archivedEventIds = new Set();
    const archivedSequences = new Set();
    for (const event of [...payload.dynamics.active, ...payload.dynamics.archived]) {
        if (eventIds.has(event.id)) invalid('v2 event ID 重复');
        eventIds.add(event.id);
        if (event.lifecycle === 'archived') {
            if (archivedSequences.has(event.archivedSequence)) invalid('archivedSequence 重复');
            archivedSequences.add(event.archivedSequence);
            archivedEventIds.add(event.id);
        }
    }
    const maximumArchivedSequence = payload.dynamics.archived.reduce((maximum, event) => Math.max(maximum, event.archivedSequence), 0);
    if (payload.historyRetentionState?.nextArchivedSequence <= maximumArchivedSequence) {
        invalid('nextArchivedSequence 必须大于既有 archivedSequence');
    }
    payload.generationSnapshots = payload.generationSnapshots.map(snapshot => {
        const normalizedSnapshot = clone(snapshot);
        const legacyCheckpoint = Object.hasOwn(normalizedSnapshot, 'checkpoint') ? normalizedSnapshot.checkpoint : null;
        if (!migratingV2 && (Object.hasOwn(normalizedSnapshot, 'checkpoint')
            || Object.hasOwn(normalizedSnapshot, 'checkpointDigest'))) {
            invalid('scope v3 snapshot 不得携带 legacy embedded checkpoint');
        }
        const assistantCount = safeInteger(normalizedSnapshot.assistantCount, 'snapshot assistantCount');
        normalizedSnapshot.restoreCapability = Object.hasOwn(normalizedSnapshot, 'restoreCapability')
            ? normalizedSnapshot.restoreCapability : 'projection-only';
        // Scope v2 did not have the v3 checkpoint contract. Never promote an old embedded payload
        // into a reroll authority merely because it resembles a complete checkpoint.
        if (migratingV2) {
            normalizedSnapshot.restoreCapability = 'projection-only';
            delete normalizedSnapshot.checkpoint;
            delete normalizedSnapshot.checkpointDigest;
            delete normalizedSnapshot.checkpointRef;
        }
        if (!['projection-only', 'full'].includes(normalizedSnapshot.restoreCapability)) invalid('snapshot restoreCapability 无效');
        normalizedSnapshot.checkpointRef = Object.hasOwn(normalizedSnapshot, 'checkpointRef') ? normalizedSnapshot.checkpointRef : null;
        normalizedSnapshot.rerollFromAssistantCount = Object.hasOwn(normalizedSnapshot, 'rerollFromAssistantCount')
            ? normalizedSnapshot.rerollFromAssistantCount : null;
        if (normalizedSnapshot.rerollFromAssistantCount !== null) {
            safeInteger(normalizedSnapshot.rerollFromAssistantCount, 'snapshot rerollFromAssistantCount');
            if (normalizedSnapshot.rerollFromAssistantCount >= assistantCount) invalid('snapshot reroll 基线必须早于自身楼层');
        }
        if (migratingV2) normalizedSnapshot.checkpointRef = null;
        else if (normalizedSnapshot.restoreCapability === 'full' && !plainRecord(normalizedSnapshot.checkpointRef)) {
            if (!plainRecord(legacyCheckpoint)) invalid('snapshot checkpointRef 与 restoreCapability 不一致');
            const stored = storeTodayTrendCheckpoint(legacyCheckpoint, payload.checkpointEntityStore);
            payload.checkpointEntityStore = stored.entityStore;
            normalizedSnapshot.checkpointRef = stored.checkpointRef;
        }
        if (normalizedSnapshot.restoreCapability === 'full') {
            materializeTodayTrendCheckpoint(normalizedSnapshot.checkpointRef, payload.checkpointEntityStore);
        } else if (normalizedSnapshot.checkpointRef !== null) invalid('projection-only snapshot 不得携带 checkpoint ref');
        delete normalizedSnapshot.checkpoint;
        delete normalizedSnapshot.checkpointDigest;
        normalizedSnapshot.storeRevision = Object.hasOwn(normalizedSnapshot, 'storeRevision')
            ? safeInteger(normalizedSnapshot.storeRevision, 'snapshot storeRevision') : 0;
        normalizedSnapshot.detailPoolRevision = Object.hasOwn(normalizedSnapshot, 'detailPoolRevision')
            ? safeInteger(normalizedSnapshot.detailPoolRevision, 'snapshot detailPoolRevision') : 0;
        normalizedSnapshot.visibleFromAssistantCount = Object.hasOwn(normalizedSnapshot, 'visibleFromAssistantCount')
            ? reliableAssistantCount(normalizedSnapshot.visibleFromAssistantCount) : assistantCount;
        if (normalizedSnapshot.visibleFromAssistantCount === null) invalid('snapshot visibleFromAssistantCount 无效');
        normalizedSnapshot.retentionPolicyRevision = Object.hasOwn(normalizedSnapshot, 'retentionPolicyRevision')
            ? safeInteger(normalizedSnapshot.retentionPolicyRevision, 'snapshot retentionPolicyRevision', 1) : 1;
        const refs = Object.hasOwn(normalizedSnapshot, 'detailManifestRefs') ? normalizedSnapshot.detailManifestRefs : [];
        if (!Array.isArray(refs)) invalid('snapshot detailManifestRefs 必须是数组');
        normalizedSnapshot.detailManifestRefs = refs.map((entry, index) => {
            exact(entry, ['eventId', 'manifestId', 'detailRefs', 'visibleFromAssistantCount'], `snapshot detailManifestRefs.${index}`);
            nonEmptyString(entry.eventId, 'snapshot manifest eventId');
            if (!entry.manifestId.startsWith(`manifest:${entry.eventId}:`)) invalid('snapshot manifest ID 与 event 不一致');
            if (!Array.isArray(entry.detailRefs) || entry.detailRefs.some(id => typeof id !== 'string'
                || !id.startsWith(`detail:${entry.eventId}:`))) invalid('snapshot detail refs 无效');
            if (new Set(entry.detailRefs).size !== entry.detailRefs.length) invalid('snapshot detail refs 不得重复');
            safeInteger(entry.visibleFromAssistantCount, 'snapshot manifest visibleFromAssistantCount');
            if (entry.visibleFromAssistantCount > normalizedSnapshot.visibleFromAssistantCount) {
                invalid('snapshot manifest 可见边界不得晚于 snapshot 边界');
            }
            return clone(entry);
        });
        normalizedSnapshot.dynamics = {
            active: normalizedSnapshot.dynamics.active.map(event => normalizeEventProjection(event, 'active')),
            archived: normalizedSnapshot.dynamics.archived.map(event => normalizeEventProjection(event, 'archived')),
        };
        exact(normalizedSnapshot, [
            'assistantCount', 'generatedAt', 'storeRevision', 'detailPoolRevision', 'visibleFromAssistantCount',
            'detailManifestRefs', 'retentionPolicyRevision', 'restoreCapability', 'checkpointRef',
            'rerollFromAssistantCount', 'world', 'reputation', 'factions', 'dynamicsSettings', 'dynamics',
        ], 'snapshot');
        return normalizedSnapshot;
    });
    const snapshotFloors = new Set();
    for (const snapshot of payload.generationSnapshots) {
        if (snapshotFloors.has(snapshot.assistantCount)) invalid('snapshot assistantCount 不得重复');
        snapshotFloors.add(snapshot.assistantCount);
    }
    payload.generationSnapshots.sort((left, right) => left.assistantCount - right.assistantCount);
    const v1Store = normalizeTodayTrendStore({ version: 1, presets, scopes: { [payload.storageId]: projectScopePayloadToV1(payload) } });
    const facade = v1Store.scopes[payload.storageId];
    payload.operation = clone(facade.operation); payload.injection = clone(facade.injection); payload.world = clone(facade.world);
    payload.reputation = clone(facade.reputation); payload.factions = clone(facade.factions); payload.dynamicsSettings = clone(facade.dynamicsSettings);
    payload.historyRetentionSettings = normalizeRetentionSettings(payload.historyRetentionSettings);
    payload.historyRetentionState = normalizeRetentionState(payload.historyRetentionState);
    const removable = normalizeRemovableContainers(payload, eventIds, archivedEventIds);
    Object.assign(payload, removable);
    if (!plainRecord(payload.fixedCoreBaselineByEvent)) invalid('fixedCoreBaselineByEvent 必须是对象');
    const fixedCoreBaselineByEvent = {};
    for (const event of payload.dynamics.archived) {
        const baseline = payload.fixedCoreBaselineByEvent[event.id];
        if (!baseline || !same(baseline, extractArchivedFixedCore(event))) invalid('archived fixed core baseline 不一致');
        fixedCoreBaselineByEvent[event.id] = clone(baseline);
    }
    if (Object.keys(payload.fixedCoreBaselineByEvent).some(id => !archivedEventIds.has(id))) invalid('fixed core baseline 存在孤儿记录');
    payload.fixedCoreBaselineByEvent = fixedCoreBaselineByEvent;
    if (payload.commitJournal !== null) invalid('scope payload commitJournal 必须为 null');
    payload.generationSnapshots = payload.generationSnapshots.map(snapshot => {
        if (snapshot.restoreCapability !== 'full') return snapshot;
        const checkpoint = materializeTodayTrendCheckpoint(snapshot.checkpointRef, payload.checkpointEntityStore);
        const normalizedCheckpoint = normalizeScopeEnvelope({
            schemaVersion: SCOPE_ENVELOPE_VERSION,
            revision: value.revision,
            payload: { ...clone(checkpoint), generationSnapshots: [], checkpointEntityStore: {}, commitJournal: null },
        }, presets).payload;
        delete normalizedCheckpoint.generationSnapshots;
        delete normalizedCheckpoint.checkpointEntityStore;
        delete normalizedCheckpoint.commitJournal;
        if (!same(normalizedCheckpoint, checkpoint)) {
            failure('TT_CANONICAL_CHECKPOINT_INTEGRITY', `canonical snapshot ${snapshot.assistantCount} 正常化后完整性校验失败`);
        }
        return snapshot;
    });
    Object.assign(payload, gcTodayTrendCheckpointEntityStore(payload));
    return { schemaVersion: SCOPE_ENVELOPE_VERSION, revision: value.revision, payload };
}

function legacyMigrationFailure(path, reason) {
    const error = new Error(`旧版 Today Trend v2 数据无法无损迁移：${path} ${reason}`);
    error.code = 'TT_V2_LEGACY_MIGRATION_FAILED';
    error.cause = { diagnostics: [{ path, reason }] };
    throw error;
}

function canonicalLegacyDate(value, path, { nullable = false } = {}) {
    if (nullable && value === null) return null;
    if (typeof value !== 'string') legacyMigrationFailure(path, nullable ? '必须是日期或 null' : '必须是日期');
    const match = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/.exec(value);
    if (!match) legacyMigrationFailure(path, '不是无歧义的年-月-日格式');
    const normalized = `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`;
    const parsed = new Date(`${normalized}T12:00:00Z`);
    if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== normalized) {
        legacyMigrationFailure(path, '不是有效自然日');
    }
    return normalized;
}

function canonicalLegacyTime(value, path) {
    if (value === null) return null;
    if (typeof value !== 'string') legacyMigrationFailure(path, '必须是钟点或 null');
    const match = /^(\d{1,2}):(\d{2})$/.exec(value);
    if (!match) legacyMigrationFailure(path, '不是无歧义的 24 小时制钟点');
    const hour = Number(match[1]);
    const minute = Number(match[2]);
    if (hour > 23 || minute > 59) legacyMigrationFailure(path, '超出有效钟点范围');
    return `${String(hour).padStart(2, '0')}:${match[2]}`;
}

function setLegacyIdMapping(idMap, oldId, nextId, path) {
    const existing = idMap.get(oldId);
    if (existing && existing !== nextId) legacyMigrationFailure(path, '同一旧 ID 映射到多个新 ID');
    idMap.set(oldId, nextId);
}

function migrateLegacyProjection(value, eventId, path, idMap) {
    if (!plainRecord(value)) legacyMigrationFailure(path, '必须是对象');
    const stage = clone(value);
    if (stage.kind === 'live-stage') {
        stage.storyDate = canonicalLegacyDate(stage.storyDate, `${path}.storyDate`);
        stage.time = canonicalLegacyTime(stage.time, `${path}.time`);
    } else if (stage.kind === 'undated-stage') {
        stage.time = canonicalLegacyTime(stage.time, `${path}.time`);
    } else if (stage.kind === 'day-summary') {
        const oldId = stage.id;
        stage.storyDate = canonicalLegacyDate(stage.storyDate, `${path}.storyDate`);
        stage.id = `day:${eventId}:${stage.storyDate}`;
        setLegacyIdMapping(idMap, oldId, stage.id, `${path}.id`);
        if (!plainRecord(stage.timeRange)) legacyMigrationFailure(`${path}.timeRange`, '必须是对象');
        stage.timeRange.start = canonicalLegacyTime(stage.timeRange.start, `${path}.timeRange.start`);
        stage.timeRange.end = canonicalLegacyTime(stage.timeRange.end, `${path}.timeRange.end`);
    } else if (stage.kind === 'period-summary' || stage.kind === 'span-stage') {
        stage.startDate = canonicalLegacyDate(stage.startDate, `${path}.startDate`);
        stage.startTime = canonicalLegacyTime(stage.startTime, `${path}.startTime`);
        stage.endDate = canonicalLegacyDate(stage.endDate, `${path}.endDate`);
        stage.endTime = canonicalLegacyTime(stage.endTime, `${path}.endTime`);
    } else if (stage.kind !== 'legacy-stage') legacyMigrationFailure(`${path}.kind`, '不受支持');
    return stage;
}

function migrateLegacyEvent(eventValue, path, idMap) {
    if (!plainRecord(eventValue) || !Array.isArray(eventValue.stages)) legacyMigrationFailure(path, '事件或 stages 无效');
    const event = clone(eventValue);
    event.stages = event.stages.map((stage, index) => migrateLegacyProjection(stage, event.id, `${path}.stages.${index}`, idMap));
    event.latestStage = resolveTodayTrendV2LatestStage(event);
    return event;
}

function remapLegacyRef(value, idMap, path) {
    if (typeof value !== 'string') legacyMigrationFailure(path, '引用必须是字符串');
    return idMap.get(value) || value;
}

function migrateLegacyScopeEnvelope(value, storageId) {
    const root = `globalEnvelope.payload.scopes.${storageId}`;
    if (!plainRecord(value) || value.schemaVersion !== LEGACY_SCOPE_ENVELOPE_VERSION || !plainRecord(value.payload)) {
        legacyMigrationFailure(root, '旧版 scope envelope 版本或结构无效');
    }
    const scope = clone(value);
    const payload = scope.payload;
    if (!plainRecord(payload.dynamics) || !Array.isArray(payload.dynamics.active) || !Array.isArray(payload.dynamics.archived)) {
        legacyMigrationFailure(`${root}.payload.dynamics`, '必须包含 active 与 archived 数组');
    }
    const idMap = new Map();
    for (const bucket of ['active', 'archived']) {
        payload.dynamics[bucket] = payload.dynamics[bucket].map((event, index) =>
            migrateLegacyEvent(event, `${root}.payload.dynamics.${bucket}.${index}`, idMap));
    }
    if (!Array.isArray(payload.generationSnapshots)) legacyMigrationFailure(`${root}.payload.generationSnapshots`, '必须是数组');
    payload.generationSnapshots = payload.generationSnapshots.map((snapshot, snapshotIndex) => {
        const migrated = clone(snapshot);
        for (const bucket of ['active', 'archived']) {
            if (!Array.isArray(migrated.dynamics?.[bucket])) {
                legacyMigrationFailure(`${root}.payload.generationSnapshots.${snapshotIndex}.dynamics.${bucket}`, '必须是数组');
            }
            migrated.dynamics[bucket] = migrated.dynamics[bucket].map((event, eventIndex) => migrateLegacyEvent(event,
                `${root}.payload.generationSnapshots.${snapshotIndex}.dynamics.${bucket}.${eventIndex}`, idMap));
        }
        return migrated;
    });
    if (!plainRecord(payload.stageDetailsByEvent)) legacyMigrationFailure(`${root}.payload.stageDetailsByEvent`, '必须是对象');
    for (const [eventId, details] of Object.entries(payload.stageDetailsByEvent)) {
        if (!Array.isArray(details)) legacyMigrationFailure(`${root}.payload.stageDetailsByEvent.${eventId}`, '必须是数组');
        details.forEach((detail, index) => {
            detail.storyDate = canonicalLegacyDate(detail.storyDate,
                `${root}.payload.stageDetailsByEvent.${eventId}.${index}.storyDate`, { nullable: true });
        });
    }
    if (!plainRecord(payload.archivedRemovableDataByEvent)) {
        legacyMigrationFailure(`${root}.payload.archivedRemovableDataByEvent`, '必须是对象');
    }
    for (const [eventId, container] of Object.entries(payload.archivedRemovableDataByEvent)) {
        if (!plainRecord(container?.daySummariesById)) {
            legacyMigrationFailure(`${root}.payload.archivedRemovableDataByEvent.${eventId}.daySummariesById`, '必须是对象');
        }
        const migratedSummaries = {};
        for (const [oldId, summary] of Object.entries(container.daySummariesById)) {
            const migrated = migrateLegacyProjection(summary, eventId,
                `${root}.payload.archivedRemovableDataByEvent.${eventId}.daySummariesById.${oldId}`, idMap);
            if (Object.hasOwn(migratedSummaries, migrated.id)) legacyMigrationFailure(`${root}.payload.archivedRemovableDataByEvent.${eventId}.daySummariesById.${oldId}`, '规范化后 ID 冲突');
            migratedSummaries[migrated.id] = migrated;
        }
        container.daySummariesById = migratedSummaries;
    }
    const remapProjectionRefs = (event, eventPath) => event.stages.forEach((stage, index) => {
        if (stage.kind === 'period-summary') stage.childSummaryRefs = stage.childSummaryRefs.map((ref, refIndex) =>
            remapLegacyRef(ref, idMap, `${eventPath}.stages.${index}.childSummaryRefs.${refIndex}`));
    });
    for (const bucket of ['active', 'archived']) payload.dynamics[bucket].forEach((event, index) =>
        remapProjectionRefs(event, `${root}.payload.dynamics.${bucket}.${index}`));
    payload.generationSnapshots.forEach((snapshot, snapshotIndex) => {
        for (const bucket of ['active', 'archived']) snapshot.dynamics[bucket].forEach((event, eventIndex) =>
            remapProjectionRefs(event, `${root}.payload.generationSnapshots.${snapshotIndex}.dynamics.${bucket}.${eventIndex}`));
    });
    for (const [eventId, container] of Object.entries(payload.archivedRemovableDataByEvent)) {
        for (const [summaryId, summary] of Object.entries(container.daySummariesById)) {
            summary.detailRefs = summary.detailRefs.map((ref, index) => remapLegacyRef(ref, idMap,
                `${root}.payload.archivedRemovableDataByEvent.${eventId}.daySummariesById.${summaryId}.detailRefs.${index}`));
        }
    }
    for (const field of ['removableEntityStateById', 'removableEntityTombstonesById']) {
        if (!plainRecord(payload[field])) legacyMigrationFailure(`${root}.payload.${field}`, '必须是对象');
        const remapped = {};
        for (const [oldId, recordValue] of Object.entries(payload[field])) {
            const nextId = idMap.get(oldId) || oldId;
            if (Object.hasOwn(remapped, nextId)) legacyMigrationFailure(`${root}.payload.${field}.${oldId}`, '规范化后 ID 冲突');
            const record = clone(recordValue);
            record.entityId = idMap.get(record.entityId) || record.entityId;
            remapped[nextId] = record;
        }
        payload[field] = remapped;
    }
    const removableIds = new Set([
        ...Object.keys(payload.removableEntityStateById),
        ...Object.keys(payload.removableEntityTombstonesById),
    ]);
    const productionResolvableIds = new Set(removableIds);
    for (const details of Object.values(payload.stageDetailsByEvent)) {
        for (const detail of details) if (typeof detail?.id === 'string') productionResolvableIds.add(detail.id);
    }
    for (const container of Object.values(payload.archivedRemovableDataByEvent)) {
        for (const id of Object.keys(container.daySummariesById)) productionResolvableIds.add(id);
        for (const id of Object.keys(container.manifestsById || {})) productionResolvableIds.add(id);
    }
    for (const event of [...payload.dynamics.active, ...payload.dynamics.archived]) {
        for (const stage of event.stages) if (typeof stage?.id === 'string') productionResolvableIds.add(stage.id);
    }
    const assertResolvableRefs = (event, eventPath, resolvableIds) => event.stages.forEach((stage, stageIndex) => {
        if (stage.kind !== 'period-summary') return;
        stage.childSummaryRefs.forEach((ref, refIndex) => {
            const path = `${eventPath}.stages.${stageIndex}.childSummaryRefs.${refIndex}`;
            if (!ref.startsWith(`day:${event.id}:`)) legacyMigrationFailure(path, `必须引用事件 ${event.id} 的 day-summary`);
            if (!resolvableIds.has(ref)) legacyMigrationFailure(path, `指向无法无损迁移的实体 ${ref}`);
        });
    });
    for (const bucket of ['active', 'archived']) payload.dynamics[bucket].forEach((event, index) =>
        assertResolvableRefs(event, `${root}.payload.dynamics.${bucket}.${index}`, productionResolvableIds));
    payload.generationSnapshots.forEach((snapshot, snapshotIndex) => {
        const snapshotResolvableIds = new Set(removableIds);
        for (const event of [...snapshot.dynamics.active, ...snapshot.dynamics.archived]) {
            for (const stage of event.stages) {
                if (typeof stage?.id === 'string') snapshotResolvableIds.add(stage.id);
            }
        }
        for (const bucket of ['active', 'archived']) snapshot.dynamics[bucket].forEach((event, eventIndex) =>
            assertResolvableRefs(event,
                `${root}.payload.generationSnapshots.${snapshotIndex}.dynamics.${bucket}.${eventIndex}`, snapshotResolvableIds));
    });
    for (const [eventId, container] of Object.entries(payload.archivedRemovableDataByEvent)) {
        for (const [summaryId, summary] of Object.entries(container.daySummariesById)) summary.detailRefs.forEach((ref, index) => {
            const path = `${root}.payload.archivedRemovableDataByEvent.${eventId}.daySummariesById.${summaryId}.detailRefs.${index}`;
            if (!ref.startsWith(`detail:${eventId}:`)) legacyMigrationFailure(path, `必须引用事件 ${eventId} 的 detail`);
            if (!productionResolvableIds.has(ref)) legacyMigrationFailure(path, `指向无法无损迁移的实体 ${ref}`);
        });
    }
    payload.fixedCoreBaselineByEvent = Object.fromEntries(payload.dynamics.archived.map(event => [event.id, extractArchivedFixedCore(event)]));
    scope.schemaVersion = SCOPE_ENVELOPE_VERSION;
    return scope;
}

export function migrateLegacyTodayTrendV2Store(value) {
    if (!plainRecord(value) || value.version !== TODAY_TREND_V2_STORE_VERSION || !plainRecord(value.globalEnvelope)) {
        legacyMigrationFailure('v2Store', '旧版 store 结构无效');
    }
    if (value.globalEnvelope.schemaVersion !== LEGACY_GLOBAL_ENVELOPE_VERSION) {
        legacyMigrationFailure('globalEnvelope.schemaVersion', '不是受支持的旧版 envelope');
    }
    const migrated = clone(value);
    if (!plainRecord(migrated.globalEnvelope.payload?.scopes)) legacyMigrationFailure('globalEnvelope.payload.scopes', '必须是对象');
    migrated.globalEnvelope.payload.scopes = Object.fromEntries(Object.entries(migrated.globalEnvelope.payload.scopes)
        .map(([storageId, scope]) => [storageId, migrateLegacyScopeEnvelope(scope, storageId)]));
    migrated.globalEnvelope.schemaVersion = GLOBAL_ENVELOPE_VERSION;
    return normalizeTodayTrendV2Store(migrated);
}

export function migrateTodayTrendStoreToV2(value, { globalRevision = 1, scopeRevisionByStorageId = {} } = {}) {
    if (value?.version === TODAY_TREND_V2_STORE_VERSION && Object.hasOwn(value, 'globalEnvelope')) {
        return { store: normalizeTodayTrendV2Store(value), migrated: false };
    }
    const source = normalizeTodayTrendStore(value);
    const scopes = {};
    for (const [storageId, scope] of Object.entries(source.scopes)) {
        scopes[storageId] = {
            schemaVersion: SCOPE_ENVELOPE_VERSION,
            revision: safeInteger(scopeRevisionByStorageId[storageId] ?? 1, `scope revision ${storageId}`),
            payload: createScopePayload(scope),
        };
    }
    return {
        migrated: true,
        store: normalizeTodayTrendV2Store({
            version: TODAY_TREND_V2_STORE_VERSION,
            globalEnvelope: {
                schemaVersion: GLOBAL_ENVELOPE_VERSION,
                revision: safeInteger(globalRevision, 'global revision'),
                payload: { presets: clone(source.presets), scopes },
            },
        }),
    };
}

export function normalizeTodayTrendV2Store(value) {
    if (!plainRecord(value)) invalid('v2 store 必须是对象');
    if (value.version > TODAY_TREND_V2_STORE_VERSION) failure('TT_V2_FUTURE_VERSION', `v2 store 版本 ${value.version} 高于当前支持版本 ${TODAY_TREND_V2_STORE_VERSION}`);
    exact(value, ['version', 'globalEnvelope'], 'v2 store');
    if (value.version !== TODAY_TREND_V2_STORE_VERSION) invalid('v2 store 版本无效');
    const envelope = value.globalEnvelope;
    exact(envelope, ['schemaVersion', 'revision', 'payload'], 'global envelope');
    if (envelope.schemaVersion > GLOBAL_ENVELOPE_VERSION) failure('TT_V2_FUTURE_VERSION', 'global envelope 版本高于当前支持版本');
    if (envelope.schemaVersion !== GLOBAL_ENVELOPE_VERSION) invalid('global envelope 版本无效');
    safeInteger(envelope.revision, 'global envelope revision');
    exact(envelope.payload, ['presets', 'scopes'], 'global envelope payload');
    if (!plainRecord(envelope.payload.presets) || !plainRecord(envelope.payload.scopes)) invalid('global envelope 集合无效');
    const presets = clone(envelope.payload.presets);
    const scopes = {};
    for (const [storageId, scopeEnvelope] of Object.entries(envelope.payload.scopes)) {
        const normalized = normalizeScopeEnvelope(scopeEnvelope, presets);
        if (normalized.payload.storageId !== storageId) invalid('scope envelope key 与 storageId 不一致');
        scopes[storageId] = normalized;
    }
    return {
        version: TODAY_TREND_V2_STORE_VERSION,
        globalEnvelope: {
            schemaVersion: GLOBAL_ENVELOPE_VERSION,
            revision: envelope.revision,
            payload: { presets, scopes },
        },
    };
}

function eventMap(dynamics) {
    return new Map([...dynamics.active, ...dynamics.archived].map(event => [event.id, event]));
}

function preserveUnchangedEvents(previousPayload, nextPayload) {
    const previous = eventMap(previousPayload.dynamics);
    const continuous = new Set();
    for (const bucket of ['active', 'archived']) {
        nextPayload.dynamics[bucket] = nextPayload.dynamics[bucket].map(event => {
            const existing = previous.get(event.id);
            if (!existing || !same(projectEventToV1(existing), projectEventToV1(event))) return event;
            continuous.add(event.id);
            return clone(existing);
        });
    }
    return continuous;
}

function snapshotV1Comparable(snapshot) {
    return {
        assistantCount: snapshot.assistantCount, generatedAt: snapshot.generatedAt,
        world: snapshot.world, reputation: snapshot.reputation, factions: snapshot.factions,
        dynamicsSettings: snapshot.dynamicsSettings, dynamics: projectDynamicsToV1(snapshot.dynamics),
    };
}

function preserveUnchangedSnapshots(previousPayload, nextPayload) {
    const previousByFloor = new Map(previousPayload.generationSnapshots.map(snapshot => [snapshot.assistantCount, snapshot]));
    nextPayload.generationSnapshots = nextPayload.generationSnapshots.map(snapshot => {
        const existing = previousByFloor.get(snapshot.assistantCount);
        if (!existing) return snapshot;
        return same(snapshotV1Comparable(existing), snapshotV1Comparable(snapshot)) ? clone(existing) : snapshot;
    });
}

function archiveNewEvents(previousPayload, nextPayload, continuous, assistantCount = null) {
    const previousActive = new Map(previousPayload.dynamics.active.map(event => [event.id, event]));
    let sequence = previousPayload.historyRetentionState.nextArchivedSequence;
    const archivedAtAssistantCount = reliableAssistantCount(assistantCount);
    nextPayload.dynamics.archived = nextPayload.dynamics.archived.map(event => {
        if (continuous.has(event.id) || !previousActive.has(event.id)) return event;
        const prior = previousActive.get(event.id);
        event = { ...event, stages: clone(prior.stages), capacityCompatibilityPending: prior.capacityCompatibilityPending,
            archivedSequence: sequence++, archivedAtAssistantCount };
        continuous.add(event.id);
        return event;
    });
    nextPayload.historyRetentionState.nextArchivedSequence = sequence;
}

function migrateArchivedRemovable(previousPayload, nextPayload, continuous) {
    const archivedIds = new Set(nextPayload.dynamics.archived.map(event => event.id));
    for (const eventId of archivedIds) {
        if (!continuous.has(eventId)) continue;
        const details = previousPayload.stageDetailsByEvent[eventId];
        if (details) nextPayload.stageDetailsByEvent[eventId] = clone(details);
        const event = nextPayload.dynamics.archived.find(item => item.id === eventId);
        const existing = previousPayload.archivedRemovableDataByEvent[eventId];
        const daySummariesById = { ...(existing?.daySummariesById ? clone(existing.daySummariesById) : {}) };
        for (const stage of event.stages) if (stage.kind === 'day-summary') daySummariesById[stage.id] = clone(stage);
        nextPayload.archivedRemovableDataByEvent[eventId] = {
            daySummariesById, manifestsById: clone(existing?.manifestsById || {}),
        };
    }
}

function preserveScopeMetadata(previousPayload, nextPayload, continuous, assistantCount = null) {
    const previousEvents = eventMap(previousPayload.dynamics);
    const preserve = (source, accept) => Object.fromEntries(Object.entries(source).filter(accept)
        .map(([id, value]) => [id, clone(value)]));
    nextPayload.historyRetentionSettings = clone(previousPayload.historyRetentionSettings);
    nextPayload.historyRetentionState = clone(previousPayload.historyRetentionState);
    nextPayload.checkpointEntityStore = clone(previousPayload.checkpointEntityStore);
    archiveNewEvents(previousPayload, nextPayload, continuous, assistantCount);
    nextPayload.stageDetailsByEvent = preserve(previousPayload.stageDetailsByEvent, ([id]) => continuous.has(id));
    nextPayload.archivedRemovableDataByEvent = preserve(previousPayload.archivedRemovableDataByEvent, ([id]) => continuous.has(id));
    const eventRecord = ([, value]) => continuous.has(value.eventId);
    nextPayload.removableEntityStateById = preserve(previousPayload.removableEntityStateById, eventRecord);
    nextPayload.removableEntityTombstonesById = preserve(previousPayload.removableEntityTombstonesById, eventRecord);
    migrateArchivedRemovable(previousPayload, nextPayload, continuous);
    nextPayload.fixedCoreBaselineByEvent = Object.fromEntries(nextPayload.dynamics.archived.map(event => {
        const existing = previousEvents.get(event.id);
        const baseline = existing?.lifecycle === 'archived' && same(projectEventToV1(existing), projectEventToV1(event))
            ? previousPayload.fixedCoreBaselineByEvent[event.id] : extractArchivedFixedCore(event);
        return [event.id, clone(baseline)];
    }));
}

export function evaluateTodayTrendArchivedRetention(payloadValue) {
    const payload = clone(payloadValue);
    const { archivedDetailLatestEventCount: n, archivedDetailRetentionFloors: l } = normalizeRetentionSettings(payload.historyRetentionSettings);
    const highWater = payload.historyRetentionState.highWaterAssistantCount;
    const ranked = [...payload.dynamics.archived].sort((left, right) =>
        right.archivedSequence - left.archivedSequence || left.id.localeCompare(right.id));
    return ranked.map((event, index) => {
        const rankProtected = n > 0 && index < n;
        const floorProtected = l > 0 && (highWater === null || event.archivedAtAssistantCount === null
            || highWater - event.archivedAtAssistantCount <= l);
        return { eventId: event.id, rank: index + 1, rankProtected, floorProtected,
            protected: rankProtected || floorProtected, deletable: !rankProtected && !floorProtected };
    });
}

function applyArchivedRetention(payloadValue, assistantCount) {
    const payload = clone(payloadValue);
    const before = Object.fromEntries(payload.dynamics.archived.map(event => [event.id, extractArchivedFixedCore(event)]));
    const decisions = evaluateTodayTrendArchivedRetention(payload);
    const policyRevision = payload.historyRetentionState.retentionPolicyRevision;
    let changed = false;
    for (const decision of decisions) {
        if (!decision.deletable) continue;
        const eventId = decision.eventId;
        const entries = [
            ...(payload.stageDetailsByEvent[eventId] || []).map(item => [item.id, 'detail']),
            ...Object.keys(payload.archivedRemovableDataByEvent[eventId]?.daySummariesById || {})
                .map(id => [id, 'day-summary']),
            ...Object.keys(payload.archivedRemovableDataByEvent[eventId]?.manifestsById || {})
                .map(id => [id, 'manifest']),
        ];
        const uniqueEntries = [...new Map(entries.map(entry => [entry[0], entry])).values()];
        for (const [id, entityType] of uniqueEntries) {
            const state = payload.removableEntityStateById[id];
            if (!state || state.state !== 'available' || state.entityType !== entityType
                || state.eventId !== eventId || payload.removableEntityTombstonesById[id]) {
                failure('TT_ARCHIVED_RETENTION_LIFECYCLE_INVALID', `archived retention lifecycle 无效：${id}`);
            }
        }
        delete payload.stageDetailsByEvent[eventId];
        delete payload.archivedRemovableDataByEvent[eventId];
        for (const [id] of uniqueEntries) {
            const state = payload.removableEntityStateById[id];
            const removed = { ...state, state: 'removed', removalReason: 'archived-retention',
                removedAtAssistantCount: reliableAssistantCount(assistantCount), policyRevision };
            payload.removableEntityStateById[id] = removed;
            payload.removableEntityTombstonesById[id] = clone(removed);
            changed = true;
        }
    }
    const after = Object.fromEntries(payload.dynamics.archived.map(event => [event.id, extractArchivedFixedCore(event)]));
    if (!same(before, after)) failure('TT_ARCHIVED_FIXED_CORE_CHANGED', 'archived retention 改写了 fixed core');
    if (changed) payload.historyRetentionState.detailPoolRevision += 1;
    return payload;
}

export function saveTodayTrendRetentionSettingsToV2(currentValue, storageId, values, {
    expectedScopeRevision, expectedSettingsRevision,
} = {}) {
    const current = normalizeTodayTrendV2Store(currentValue);
    const envelope = current.globalEnvelope.payload.scopes[storageId];
    if (!envelope) failure('TT_V2_SCHEMA_INVALID', 'canonical scope 不存在');
    if (!Number.isSafeInteger(expectedScopeRevision) || expectedScopeRevision < 0
        || !Number.isSafeInteger(expectedSettingsRevision) || expectedSettingsRevision < 1) {
        failure('TT_RETENTION_SETTINGS_INVALID', '设置保存缺少有效 base revision');
    }
    if (envelope.revision !== expectedScopeRevision
        || envelope.payload.historyRetentionSettings.revision !== expectedSettingsRevision) {
        failure('TT_SETTINGS_REVISION_CONFLICT', '归档保留设置已被其他事务修改，请重新加载');
    }
    const n = parseRetentionInteger(values?.archivedDetailLatestEventCount, 'N', 80);
    const l = parseRetentionInteger(values?.archivedDetailRetentionFloors, 'L', 1000);
    envelope.payload.historyRetentionSettings = { archivedDetailLatestEventCount: n,
        archivedDetailRetentionFloors: l, revision: envelope.payload.historyRetentionSettings.revision + 1 };
    envelope.payload.historyRetentionState.retentionPolicyRevision += 1;
    return normalizeTodayTrendV2Store(current);
}

export function mergeTodayTrendV1StoreIntoV2(currentValue, facadeValue, { assistantCount = null } = {}) {
    const current = normalizeTodayTrendV2Store(currentValue);
    const facade = normalizeTodayTrendStore(facadeValue);
    const revisions = Object.fromEntries(Object.entries(current.globalEnvelope.payload.scopes)
        .map(([storageId, envelope]) => [storageId, envelope.revision]));
    const migrated = migrateTodayTrendStoreToV2(facade, {
        globalRevision: current.globalEnvelope.revision, scopeRevisionByStorageId: revisions,
    }).store;
    for (const [storageId, nextEnvelope] of Object.entries(migrated.globalEnvelope.payload.scopes)) {
        const previousEnvelope = current.globalEnvelope.payload.scopes[storageId];
        if (!previousEnvelope) continue;
        const continuousEventIds = preserveUnchangedEvents(previousEnvelope.payload, nextEnvelope.payload);
        preserveUnchangedSnapshots(previousEnvelope.payload, nextEnvelope.payload);
        preserveScopeMetadata(previousEnvelope.payload, nextEnvelope.payload, continuousEventIds, assistantCount);
    }
    return normalizeTodayTrendV2Store(migrated);
}

export function applyTodayTrendGenerationToV2(currentValue, storageId, generatedScope, history, {
    trustedStoryDate = null, assistantCount = null, generatedAt = 0, snapshot = true,
    rerollFromAssistantCount = null, archives = [],
} = {}) {
    const current = normalizeTodayTrendV2Store(currentValue);
    const previousEnvelope = current.globalEnvelope.payload.scopes[storageId];
    if (!previousEnvelope) failure('TT_V2_SCHEMA_INVALID', 'canonical scope 不存在');
    const facade = buildReadOnlyShadow(current);
    facade.scopes[storageId] = clone(generatedScope);
    const merged = mergeTodayTrendV1StoreIntoV2(current, facade, { assistantCount });
    // Generation is a single-scope mutation.  The v1 facade round-trip is only
    // needed to adapt the generated scope; letting it re-materialize every
    // other canonical scope can change hidden history/checkpoint state and
    // makes the authority correctly reject the falsely declared scope range.
    merged.globalEnvelope.payload.presets = clone(current.globalEnvelope.payload.presets);
    for (const [id, envelope] of Object.entries(current.globalEnvelope.payload.scopes)) {
        if (id !== storageId) merged.globalEnvelope.payload.scopes[id] = clone(envelope);
    }
    const envelope = merged.globalEnvelope.payload.scopes[storageId];
    let payload = applyTodayTrendHistoryProducer(envelope.payload, history, {
        trustedStoryDate, assistantCount, previousPayload: previousEnvelope.payload,
    });
    // Batch transport defers lifecycle changes until the active-only producer has
    // materialized canonical stages/details. No intermediate state is committed.
    const archiveIds = new Set();
    for (const operation of archives) {
        const index = payload.dynamics.active.findIndex(event => event.id === operation.eventId);
        if (index < 0 || archiveIds.has(operation.eventId)) failure('TT_HISTORY_UNKNOWN_EVENT', 'archive 只能指向 active');
        if (!generatedScope.dynamicsSettings.autoComplete || !generatedScope.dynamicsSettings.archiveCompleted) {
            failure('TT_HISTORY_SCHEMA_INVALID', '当前设置不允许自动归档事件');
        }
        archiveIds.add(operation.eventId);
        const [event] = payload.dynamics.active.splice(index, 1);
        if (operation.outcome === 'absorbed' && (event.type !== 'underground'
            || !payload.dynamics.active.some(next => next.type === 'incident' && next.relatedEventIds.includes(event.id)))) {
            failure('TT_HISTORY_SCHEMA_INVALID', '地下线升级必须新建关联突发事件');
        }
        payload.dynamics.archived.push({ ...event, lifecycle: 'archived', outcome: operation.outcome,
            finalResult: operation.finalResult, archivedSequence: payload.historyRetentionState.nextArchivedSequence++,
            archivedAtAssistantCount: reliableAssistantCount(assistantCount) });
    }
    if (archiveIds.size) migrateArchivedRemovable(payload, payload, archiveIds);
    const reliableCount = reliableAssistantCount(assistantCount);
    if (reliableCount !== null && (payload.historyRetentionState.highWaterAssistantCount === null
        || reliableCount > payload.historyRetentionState.highWaterAssistantCount)) {
        payload.historyRetentionState.highWaterAssistantCount = reliableCount;
    }
    payload = applyArchivedRetention(payload, reliableCount);
    payload.fixedCoreBaselineByEvent = Object.fromEntries(payload.dynamics.archived
        .map(event => [event.id, extractArchivedFixedCore(event)]));
    if (snapshot) payload = appendTodayTrendCanonicalSnapshot(payload, assistantCount, generatedAt,
        current.globalEnvelope.revision + 1, { rerollFromAssistantCount });
    envelope.payload = payload;
    return normalizeTodayTrendV2Store(merged);
}

export function replaceTodayTrendV2ScopeWithInitialization(currentValue, initializedStoreValue, storageId, generatedAt = 0) {
    const current = normalizeTodayTrendV2Store(currentValue);
    const initializedStore = normalizeTodayTrendStore(initializedStoreValue);
    const scope = initializedStore.scopes[storageId];
    const preset = initializedStore.presets[scope?.presetId];
    if (!scope || !preset) failure('TT_INITIALIZATION_INVALID', '初始化结果缺少当前聊天 scope 或世界预设');
    const previousEnvelope = current.globalEnvelope.payload.scopes[storageId];
    if (previousEnvelope && (Object.values(previousEnvelope.payload.removableEntityStateById).some(item => item.state === 'removed')
        || Object.keys(previousEnvelope.payload.removableEntityTombstonesById).length)) {
        failure('TT_INITIALIZATION_REBUILD_BLOCKED', '当前今日风向包含不可逆归档清理记录，不能重建覆盖；请保留现有资料或恢复到清理前的聊天分支');
    }
    const candidate = clone(current);
    let payload = createScopePayload(scope);
    payload.generationSnapshots = [];
    payload.checkpointEntityStore = {};
    payload.operation = { ...payload.operation, lastSuccessfulAssistantCount: 0, lastSuccessfulRunAt: 0 };
    payload.historyRetentionState.highWaterAssistantCount = null;
    payload = appendTodayTrendCanonicalSnapshot(payload, 0, generatedAt, current.globalEnvelope.revision + 1);
    candidate.globalEnvelope.payload.presets[scope.presetId] = clone(preset);
    candidate.globalEnvelope.payload.scopes[storageId] = {
        schemaVersion: SCOPE_ENVELOPE_VERSION,
        revision: previousEnvelope?.revision ?? 1,
        payload,
    };
    return normalizeTodayTrendV2Store(candidate);
}

export function replaceTodayTrendV2ScopeWithBatchReset(currentValue, storageId, generatedAt = 0) {
    const current = normalizeTodayTrendV2Store(currentValue);
    const previousEnvelope = current.globalEnvelope.payload.scopes[storageId];
    if (!previousEnvelope) failure('TT_V2_SCHEMA_INVALID', 'canonical scope 不存在');
    if (Object.values(previousEnvelope.payload.removableEntityStateById).some(item => item.state === 'removed')
        || Object.keys(previousEnvelope.payload.removableEntityTombstonesById).length) {
        failure('TT_INITIALIZATION_REBUILD_BLOCKED', '当前今日风向包含不可逆归档清理记录，不能清空重建；请保留现有资料或恢复到清理前的聊天分支');
    }
    const previousScope = projectScopePayloadToV1(previousEnvelope.payload);
    const emptyScope = {
        ...previousScope,
        operation: { ...previousScope.operation, lastSuccessfulAssistantCount: 0, lastSuccessfulRunAt: 0 },
        world: { items: [] }, reputation: { circles: [] }, factions: [],
        dynamics: { active: [], archived: [] }, generationSnapshots: [],
    };
    const candidate = clone(current);
    let payload = createScopePayload(emptyScope);
    payload.generationSnapshots = [];
    payload.checkpointEntityStore = {};
    payload = appendTodayTrendCanonicalSnapshot(payload, 0, generatedAt, current.globalEnvelope.revision + 1);
    candidate.globalEnvelope.payload.scopes[storageId] = {
        ...previousEnvelope,
        payload,
    };
    return normalizeTodayTrendV2Store(candidate);
}

export function prepareTodayTrendLegacyBatchBaseline(currentValue, storageId) {
    const current = normalizeTodayTrendV2Store(currentValue);
    const payload = current.globalEnvelope.payload.scopes[storageId]?.payload;
    const eligibility = describeTodayTrendLegacyBatchBaselineEligibility(current, storageId);
    if (!eligibility.eligible || !payload) return null;
    const snapshot = payload.generationSnapshots.find(item => item.assistantCount === 0);
    if (!snapshot) return null;
    const facade = buildReadOnlyShadow(current);
    const scope = facade.scopes[storageId];
    if (!scope) return null;
    const baselineScope = {
        ...scope,
        operation: {
            ...scope.operation,
            lastSuccessfulAssistantCount: 0,
            lastSuccessfulRunAt: snapshot.generatedAt,
        },
        world: clone(snapshot.world),
        reputation: clone(snapshot.reputation),
        factions: clone(snapshot.factions),
        dynamicsSettings: clone(snapshot.dynamicsSettings),
        dynamics: projectDynamicsToV1(snapshot.dynamics),
        generationSnapshots: [snapshotV1Comparable(snapshot)],
    };
    return applyTodayTrendGenerationToV2(current, storageId, baselineScope, { events: [] }, {
        assistantCount: 0, generatedAt: snapshot.generatedAt, snapshot: true,
    });
}

export function applyTodayTrendRerollToV2(currentValue, storageId, baselineAssistantCount, generatedScope, history, options = {}) {
    const current = normalizeTodayTrendV2Store(currentValue);
    const baseline = reliableAssistantCount(baselineAssistantCount);
    const floor = reliableAssistantCount(options.assistantCount);
    if (baseline === null || floor === null || baseline >= floor) {
        failure('TT_REROLL_CHECKPOINT_INVALID', 'reroll 必须指定当前楼层之前的完整 checkpoint');
    }
    const restored = rollbackTodayTrendV2Scope(current, storageId, baseline);
    return applyTodayTrendGenerationToV2(restored, storageId, generatedScope, history, {
        ...options, snapshot: true, rerollFromAssistantCount: baseline,
    });
}

export function rollbackTodayTrendV2Scope(currentValue, storageId, assistantCount) {
    const current = normalizeTodayTrendV2Store(currentValue);
    const envelope = current.globalEnvelope.payload.scopes[storageId];
    if (!envelope) return current;
    envelope.payload = rollbackTodayTrendCanonicalPayload(envelope.payload, assistantCount);
    envelope.payload.fixedCoreBaselineByEvent = Object.fromEntries(envelope.payload.dynamics.archived
        .map(event => [event.id, extractArchivedFixedCore(event)]));
    return normalizeTodayTrendV2Store(current);
}

function checkpointPayloadForDetailTarget(payload, target) {
    const snapshot = payload.generationSnapshots.reduce((latest, item) => item.restoreCapability === 'full'
        && item.assistantCount <= target && (!latest || item.assistantCount > latest.assistantCount) ? item : latest, null);
    if (!snapshot) return null;
    return {
        payload: materializeTodayTrendCheckpoint(snapshot.checkpointRef, payload.checkpointEntityStore),
        snapshots: payload.generationSnapshots.filter(item => item.assistantCount <= snapshot.assistantCount),
    };
}

export function resolveTodayTrendV2DetailForTarget(currentValue, storageId, eventId, detailId, targetAssistantCount) {
    const target = reliableAssistantCount(targetAssistantCount);
    if (target === null || typeof storageId !== 'string' || typeof eventId !== 'string' || typeof detailId !== 'string') return null;
    const store = normalizeTodayTrendV2Store(currentValue);
    const currentPayload = store.globalEnvelope.payload.scopes[storageId]?.payload;
    if (!currentPayload) return null;
    const currentFloor = reliableAssistantCount(currentPayload.operation.lastSuccessfulAssistantCount);
    const checkpoint = currentFloor !== null && currentFloor <= target
        ? { payload: currentPayload, snapshots: currentPayload.generationSnapshots }
        : checkpointPayloadForDetailTarget(currentPayload, target);
    if (!checkpoint) return null;
    const { payload, snapshots } = checkpoint;
    const detailState = payload.removableEntityStateById[detailId];
    if (detailState?.state === 'removed' && detailState.entityType === 'detail' && detailState.eventId === eventId) {
        const tombstone = payload.removableEntityTombstonesById[detailId];
        if (!same(tombstone, detailState)) {
            failure('TT_DETAIL_REMOVED_DIAGNOSTIC_INVALID', 'removed detail 缺少一致的 tombstone 诊断');
        }
        return {
            status: 'unavailable', code: 'TT_DETAIL_REMOVED', detailId, eventId,
            removalReason: detailState.removalReason,
            removedAtAssistantCount: detailState.removedAtAssistantCount,
        };
    }
    const detail = (payload.stageDetailsByEvent[eventId] || []).find(item => item.id === detailId);
    if (!detail) return null;
    if (detailState?.state !== 'available' || detailState.entityType !== 'detail' || detailState.eventId !== eventId) return null;
    const event = [...payload.dynamics.active, ...payload.dynamics.archived].find(item => item.id === eventId);
    if (!event) return null;
    const sourceSummary = [
        ...event.stages.filter(stage => stage.kind === 'day-summary'),
        ...Object.values(payload.archivedRemovableDataByEvent[eventId]?.daySummariesById || {}),
    ].find(summary => summary.detailRefs.includes(detailId)
        && summary.sourceFloorEnd !== null && summary.sourceFloorEnd <= target);
    if (!sourceSummary) return null;
    const manifestContainer = payload.archivedRemovableDataByEvent[eventId]?.manifestsById || {};
    const manifestVisible = snapshots.some(snapshot => {
        if (snapshot.visibleFromAssistantCount > target) return false;
        return snapshot.detailManifestRefs.some(entry => {
            if (entry.eventId !== eventId || entry.visibleFromAssistantCount > target || !entry.detailRefs.includes(detailId)) return false;
            const manifest = manifestContainer[entry.manifestId];
            const state = payload.removableEntityStateById[entry.manifestId];
            return manifest?.id === entry.manifestId && state?.state === 'available'
                && state.entityType === 'manifest' && state.eventId === eventId;
        });
    });
    return manifestVisible ? { ...clone(detail), status: 'available' } : null;
}

export function normalizeTodayTrendV2Candidate(value, currentValue = null) {
    if (value?.version === TODAY_TREND_V2_STORE_VERSION && Object.hasOwn(value, 'globalEnvelope')) {
        return normalizeTodayTrendV2Store(value);
    }
    if (currentValue) return mergeTodayTrendV1StoreIntoV2(currentValue, value);
    return migrateTodayTrendStoreToV2(value).store;
}

function translateBranchFloor(value, offset) {
    return value === null ? null : Math.max(0, value + offset);
}

function translateBranchProjection(stage, offset) {
    const translated = clone(stage);
    if (Object.hasOwn(translated, 'sourceFloorStart')) {
        translated.sourceFloorStart = translateBranchFloor(translated.sourceFloorStart, offset);
        translated.sourceFloorEnd = translateBranchFloor(translated.sourceFloorEnd, offset);
    }
    return translated;
}

function translateBranchEvent(event, offset) {
    const translated = clone(event);
    translated.stages = translated.stages.map(stage => translateBranchProjection(stage, offset));
    if (translated.lifecycle === 'archived') {
        translated.archivedAtAssistantCount = translateBranchFloor(translated.archivedAtAssistantCount, offset);
    }
    return translated;
}

export function copyTodayTrendV2ScopeForBranch(sourceEnvelopeValue, targetStorageId, targetAssistantCount = 0, presetsValue) {
    if (typeof targetStorageId !== 'string' || !targetStorageId) throw new TypeError('目标 storageId 必须是非空字符串');
    if (!plainRecord(presetsValue)) throw new TypeError('分支复制必须提供 canonical 世界预设集合');
    const targetFloor = safeInteger(targetAssistantCount, '分支目标 assistantCount');
    const presets = clone(presetsValue);
    const sourceEnvelope = normalizeScopeEnvelope(sourceEnvelopeValue, presets);
    if (sourceEnvelope.payload.storageId === targetStorageId) invalid('分支目标不得与来源 scope 相同');
    const sourceFloor = reliableAssistantCount(sourceEnvelope.payload.operation.lastSuccessfulAssistantCount) ?? 0;
    const offset = targetFloor - sourceFloor;
    const payload = clone(sourceEnvelope.payload);
    const sourceCheckpointEntityStore = clone(sourceEnvelope.payload.checkpointEntityStore);
    payload.storageId = targetStorageId;
    payload.commitJournal = null;
    payload.operation = {
        ...payload.operation, lastSuccessfulAssistantCount: targetFloor, lastSuccessfulRunAt: 0,
    };
    payload.dynamics = {
        active: payload.dynamics.active.map(event => translateBranchEvent(event, offset)),
        archived: payload.dynamics.archived.map(event => translateBranchEvent(event, offset)),
    };
    for (const container of Object.values(payload.archivedRemovableDataByEvent)) {
        container.daySummariesById = Object.fromEntries(Object.entries(container.daySummariesById)
            .map(([id, summary]) => [id, translateBranchProjection(summary, offset)]));
    }
    for (const field of ['removableEntityStateById', 'removableEntityTombstonesById']) {
        payload[field] = Object.fromEntries(Object.entries(payload[field]).map(([id, state]) => [id, {
            ...state, removedAtAssistantCount: translateBranchFloor(state.removedAtAssistantCount, offset),
        }]));
    }
    payload.historyRetentionState.highWaterAssistantCount = translateBranchFloor(
        payload.historyRetentionState.highWaterAssistantCount, offset,
    );
    const translatedSnapshots = [];
    payload.checkpointEntityStore = {};
    let baselineSnapshot = null;
    for (const snapshot of payload.generationSnapshots) {
        const assistantCount = translateBranchFloor(snapshot.assistantCount, offset);
        const translated = {
            ...clone(snapshot), assistantCount,
            visibleFromAssistantCount: translateBranchFloor(snapshot.visibleFromAssistantCount, offset),
            rerollFromAssistantCount: translateBranchFloor(snapshot.rerollFromAssistantCount, offset),
            detailManifestRefs: snapshot.detailManifestRefs.map(entry => ({
                ...clone(entry), visibleFromAssistantCount: translateBranchFloor(entry.visibleFromAssistantCount, offset),
            })),
            dynamics: {
                active: snapshot.dynamics.active.map(event => translateBranchEvent(event, offset)),
                archived: snapshot.dynamics.archived.map(event => translateBranchEvent(event, offset)),
            },
        };
        if (snapshot.restoreCapability === 'full') {
            const checkpoint = materializeTodayTrendCheckpoint(snapshot.checkpointRef, sourceCheckpointEntityStore);
            checkpoint.storageId = targetStorageId;
            checkpoint.operation = {
                ...checkpoint.operation,
                lastSuccessfulAssistantCount: translateBranchFloor(checkpoint.operation.lastSuccessfulAssistantCount, offset),
            };
            checkpoint.dynamics = {
                active: checkpoint.dynamics.active.map(event => translateBranchEvent(event, offset)),
                archived: checkpoint.dynamics.archived.map(event => translateBranchEvent(event, offset)),
            };
            for (const container of Object.values(checkpoint.archivedRemovableDataByEvent)) {
                container.daySummariesById = Object.fromEntries(Object.entries(container.daySummariesById)
                    .map(([id, summary]) => [id, translateBranchProjection(summary, offset)]));
            }
            for (const field of ['removableEntityStateById', 'removableEntityTombstonesById']) {
                checkpoint[field] = Object.fromEntries(Object.entries(checkpoint[field]).map(([id, state]) => [id, {
                    ...state, removedAtAssistantCount: translateBranchFloor(state.removedAtAssistantCount, offset),
                }]));
 }
            checkpoint.historyRetentionState.highWaterAssistantCount = translateBranchFloor(
                checkpoint.historyRetentionState.highWaterAssistantCount, offset,
            );
            checkpoint.fixedCoreBaselineByEvent = Object.fromEntries(checkpoint.dynamics.archived
                .map(event => [event.id, extractArchivedFixedCore(event)]));
            const stored = storeTodayTrendCheckpoint(checkpoint, payload.checkpointEntityStore);
            payload.checkpointEntityStore = stored.entityStore;
            translated.checkpointRef = stored.checkpointRef;
        }
        if (assistantCount === 0) {
            if (baselineSnapshot === null || snapshot.assistantCount > baselineSnapshot.sourceAssistantCount) {
                baselineSnapshot = { sourceAssistantCount: snapshot.assistantCount, value: translated };
            }
        } else translatedSnapshots.push(translated);
    }
    // Source history before the target chat's floor 0 cannot be represented. Collapse it deterministically
    // to the latest source checkpoint at or before that boundary instead of overwriting Map keys silently.
    if (baselineSnapshot) translatedSnapshots.push(baselineSnapshot.value);
    payload.generationSnapshots = translatedSnapshots.sort((left, right) => left.assistantCount - right.assistantCount)
        .slice(-TODAY_TREND_LIMITS.generationSnapshots);
    Object.assign(payload, gcTodayTrendCheckpointEntityStore(payload));
    payload.fixedCoreBaselineByEvent = Object.fromEntries(payload.dynamics.archived
        .map(event => [event.id, extractArchivedFixedCore(event)]));
    return normalizeScopeEnvelope({ ...sourceEnvelope, revision: 0, payload }, presets);
}

export function rebaseTodayTrendV2Store(value, globalRevision, scopeRevisionByStorageId = null) {
    const store = normalizeTodayTrendV2Store(value);
    const revision = safeInteger(globalRevision, 'global revision');
    const scopes = {};
    for (const [storageId, envelope] of Object.entries(store.globalEnvelope.payload.scopes)) {
        const scopeRevision = scopeRevisionByStorageId === null ? revision
            : safeInteger(scopeRevisionByStorageId[storageId] ?? 0, `scope revision ${storageId}`);
        scopes[storageId] = { ...envelope, revision: scopeRevision };
    }
    return normalizeTodayTrendV2Store({
        ...store,
        globalEnvelope: { ...store.globalEnvelope, revision, payload: { ...store.globalEnvelope.payload, scopes } },
    });
}

export function buildReadOnlyShadow(value) {
    const store = normalizeTodayTrendV2Store(value);
    const scopes = {};
    for (const [storageId, envelope] of Object.entries(store.globalEnvelope.payload.scopes)) {
        scopes[storageId] = projectScopePayloadToV1(envelope.payload);
    }
    return normalizeTodayTrendStore({ version: 1, presets: clone(store.globalEnvelope.payload.presets), scopes });
}

export function diffReadOnlyShadow(v1Value, v2Value) {
    const expected = JSON.stringify(normalizeTodayTrendStore(v1Value));
    const actual = JSON.stringify(buildReadOnlyShadow(v2Value));
    if (expected === actual) return { equal: true, byteDifference: 0, expectedBytes: expected.length, actualBytes: actual.length };
    return { equal: false, byteDifference: Math.abs(expected.length - actual.length) || 1, expectedBytes: expected.length, actualBytes: actual.length };
}
