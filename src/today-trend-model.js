export const TODAY_TREND_VERSION = 1;
export const TODAY_TREND_RELATION_STATUSES = Object.freeze(['hostile', 'dislike', 'neutral', 'like', 'trust']);
export const TODAY_TREND_EVENT_TYPES = Object.freeze(['normal', 'incident', 'rumor', 'underground']);
export const TODAY_TREND_EVENT_LIFECYCLES = Object.freeze(['active', 'archived']);
export const TODAY_TREND_EVENT_OUTCOMES = Object.freeze(['resolved', 'failed', 'terminated', 'inconclusive', 'confirmed', 'debunked', 'absorbed']);
export const TODAY_TREND_OPERATION_MODES = Object.freeze(['manual', 'auto']);
export const TODAY_TREND_STATUS_LABELS = Object.freeze({ hostile: '敌对', dislike: '厌恶', neutral: '中立', like: '喜欢', trust: '信任' });
export const TODAY_TREND_LIMITS = Object.freeze({ presets: 80, scopes: 80, worldItems: 24, circles: 24, factions: 80, factionDetails: 16, relatedFactions: 24, events: 80, participants: 24, stages: 40, relatedEvents: 24, generationSnapshots: 12, text: 600, name: 120, stageLabel: 8, intervalFloors: 1000 });

const plainRecord = value => value && typeof value === 'object' && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
const unsafeKey = value => value === '__proto__' || value === 'prototype' || value === 'constructor';
const cleanText = (value, max = TODAY_TREND_LIMITS.text) => typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').slice(0, max) : '';
const validId = value => typeof value === 'string' && value === value.trim() && value.length > 0 && value.length <= 120 && !unsafeKey(value);
const timestamp = (value, fallback = 0) => Number.isFinite(value) && value >= 0 ? Math.floor(value) : fallback;
const fail = (code, message) => { const error = new Error(message); error.code = code; throw error; };
const assertRecord = (value, code, message) => plainRecord(value) || fail(code, message);
const assertEnum = (value, values, code, label) => values.includes(value) ? value : fail(code, `${label}无效`);
const requiredBoolean = (value, code, label) => typeof value === 'boolean' ? value : fail(code, `${label}必须是布尔值`);

export function todayTrendStatusLabel(value) {
    return TODAY_TREND_STATUS_LABELS[value] || '';
}

export function createEmptyTodayTrendStore() {
    return { version: TODAY_TREND_VERSION, presets: {}, scopes: {} };
}

export function createDefaultTodayTrendDynamicsSettings() {
    return {
        trackingLimit: 24, appendOnlyOnActualProgress: true, autoComplete: true, archiveCompleted: true,
        incident: { enabled: true, probability: 10 }, rumor: { enabled: true }, underground: { enabled: true },
    };
}

export function createEmptyTodayTrendScope() {
    return {
        storageId: '', characterId: '', characterName: '', presetId: '',
        operation: { enabled: false, mode: 'manual', intervalFloors: 1, lastSuccessfulAssistantCount: 0, lastSuccessfulRunAt: 0 },
        injection: { enabled: false, minimalUi: false }, world: { items: [] }, reputation: { circles: [] }, factions: [],
        dynamicsSettings: createDefaultTodayTrendDynamicsSettings(), dynamics: { active: [], archived: [] }, generationSnapshots: [],
    };
}

function requiredText(value, max, code, label) {
    const text = cleanText(value, max);
    return text || fail(code, `${label}不能为空`);
}

function normalizeStringArray(value, max, itemMax, code, label, { unique = true } = {}) {
    if (!Array.isArray(value)) fail(code, `${label}必须是数组`);
    if (value.length > max) fail(code, `${label}数量超限`);
    const result = value.map(item => requiredText(item, itemMax, code, label));
    if (unique && new Set(result).size !== result.length) fail(code, `${label}不能重复`);
    return result;
}

function normalizeIdArray(value, max, code, label) {
    if (!Array.isArray(value) || value.length > max) fail(code, `${label}无效`);
    const result = value.map(item => normalizeId(item, code, label));
    if (new Set(result).size !== result.length) fail(code, `${label}不能重复`);
    return result;
}

function normalizeId(value, code, label) {
    return validId(value) ? value : fail(code, `${label}无效`);
}

function normalizeRelation(value, code = 'TT_RELATION') {
    assertRecord(value, code, '角色关系必须是对象');
    return {
        status: assertEnum(value.status, TODAY_TREND_RELATION_STATUSES, code, '关系状态'),
        evaluation: requiredText(value.evaluation, TODAY_TREND_LIMITS.text, code, '关系评价'),
    };
}

function normalizeWorldItem(value) {
    assertRecord(value, 'TT_WORLD_ITEM', '世界态势项目必须是对象');
    return { id: normalizeId(value.id, 'TT_WORLD_ITEM', '世界态势项目 ID'), name: requiredText(value.name, TODAY_TREND_LIMITS.name, 'TT_WORLD_ITEM', '世界态势项目名称'), summary: requiredText(value.summary, TODAY_TREND_LIMITS.text, 'TT_WORLD_ITEM', '世界态势项目说明') };
}

function normalizeCircle(value) {
    assertRecord(value, 'TT_CIRCLE', '风评圈层必须是对象');
    return {
        id: normalizeId(value.id, 'TT_CIRCLE', '风评圈层 ID'), name: requiredText(value.name, TODAY_TREND_LIMITS.name, 'TT_CIRCLE', '风评圈层名称'),
        scope: requiredText(value.scope, TODAY_TREND_LIMITS.text, 'TT_CIRCLE', '风评圈层范围'),
        ...normalizeRelation(value, 'TT_CIRCLE'),
    };
}

function normalizeDetails(value) {
    if (!Array.isArray(value) || value.length > TODAY_TREND_LIMITS.factionDetails) fail('TT_FACTION_DETAILS', '势力关键资料无效');
    const labels = new Set();
    return value.map(detail => {
        assertRecord(detail, 'TT_FACTION_DETAILS', '势力关键资料必须是对象');
        const label = requiredText(detail.label, TODAY_TREND_LIMITS.name, 'TT_FACTION_DETAILS', '势力资料名称');
        if (labels.has(label)) fail('TT_FACTION_DETAILS', '势力资料名称不能重复');
        labels.add(label);
        return { label, value: requiredText(detail.value, TODAY_TREND_LIMITS.text, 'TT_FACTION_DETAILS', '势力资料内容') };
    });
}

function normalizeFaction(value) {
    assertRecord(value, 'TT_FACTION', '势力必须是对象');
    const parentId = value.parentId === null || value.parentId === '' ? null : normalizeId(value.parentId, 'TT_FACTION', '父势力 ID');
    const relatedFactionIds = normalizeIdArray(value.relatedFactionIds ?? [], TODAY_TREND_LIMITS.relatedFactions, 'TT_FACTION', '外部关联势力');
    return {
        id: normalizeId(value.id, 'TT_FACTION', '势力 ID'), name: requiredText(value.name, TODAY_TREND_LIMITS.name, 'TT_FACTION', '势力名称'),
        summary: requiredText(value.summary, TODAY_TREND_LIMITS.text, 'TT_FACTION', '势力介绍'), parentId, relatedFactionIds,
        details: normalizeDetails(value.details ?? []), relation: normalizeRelation(value.relation, 'TT_FACTION'),
    };
}

function normalizeEvent(value, expectedLifecycle) {
    assertRecord(value, 'TT_EVENT', '动态事件必须是对象');
    const lifecycle = assertEnum(value.lifecycle, TODAY_TREND_EVENT_LIFECYCLES, 'TT_EVENT', '事件生命周期');
    if (expectedLifecycle && lifecycle !== expectedLifecycle) fail('TT_EVENT_BUCKET', '动态事件与归档分组不一致');
    const rawStageLabel = requiredText(value.stageLabel, TODAY_TREND_LIMITS.text, 'TT_EVENT', '事件阶段');
    const stageLabel = rawStageLabel;
    if (Array.from(stageLabel).length < 2 || Array.from(stageLabel).length > TODAY_TREND_LIMITS.stageLabel) {
        fail('TT_EVENT_STAGE', '事件阶段长度无效');
    }
    const stages = normalizeStringArray(value.stages ?? [], TODAY_TREND_LIMITS.stages, TODAY_TREND_LIMITS.text, 'TT_EVENT', '事件阶段记录', { unique: false });
    const latestStage = requiredText(value.latestStage, TODAY_TREND_LIMITS.text, 'TT_EVENT', '事件最新阶段');
    if (!stages.length || stages.at(-1) !== latestStage) fail('TT_EVENT_STAGE_HISTORY', '事件最新阶段必须与阶段记录末项一致');
    const type = assertEnum(value.type, TODAY_TREND_EVENT_TYPES, 'TT_EVENT', '事件类型');
    const outcome = value.outcome === null || value.outcome === undefined || value.outcome === '' ? null : assertEnum(value.outcome, TODAY_TREND_EVENT_OUTCOMES, 'TT_EVENT', '事件完结结果');
    const finalResult = value.finalResult === null || value.finalResult === undefined || value.finalResult === '' ? null : requiredText(value.finalResult, TODAY_TREND_LIMITS.text, 'TT_EVENT', '事件最终结果');
    if (lifecycle === 'archived' && (!outcome || !finalResult)) fail('TT_EVENT_ARCHIVE', '归档事件必须有完结结果');
    if (lifecycle === 'active' && (outcome || finalResult)) fail('TT_EVENT_ACTIVE', '追踪中事件不能有完结结果');
    if (outcome && (type === 'rumor' ? !['confirmed', 'debunked'].includes(outcome) : outcome === 'confirmed' || outcome === 'debunked' || (outcome === 'absorbed' && type !== 'underground'))) {
        fail('TT_EVENT_OUTCOME', '事件类型与完结结果不匹配');
    }
    return {
        id: normalizeId(value.id, 'TT_EVENT', '事件 ID'), type, lifecycle,
        title: requiredText(value.title, TODAY_TREND_LIMITS.name, 'TT_EVENT', '事件名称'), stageLabel,
        origin: requiredText(value.origin, TODAY_TREND_LIMITS.text, 'TT_EVENT', '事件起因'),
        participants: normalizeStringArray(value.participants ?? [], TODAY_TREND_LIMITS.participants, TODAY_TREND_LIMITS.name, 'TT_EVENT', '事件涉及主体'),
        stages, latestStage, outcome, finalResult,
        relatedEventIds: normalizeIdArray(value.relatedEventIds ?? [], TODAY_TREND_LIMITS.relatedEvents, 'TT_EVENT', '关联事件'),
        createdAt: timestamp(value.createdAt), updatedAt: Math.max(timestamp(value.createdAt), timestamp(value.updatedAt, timestamp(value.createdAt))),
    };
}

function normalizeDynamicsSettings(value) {
    if (value === undefined) return createDefaultTodayTrendDynamicsSettings();
    assertRecord(value, 'TT_DYNAMICS_SETTINGS', '动态设置必须是对象');
    const defaults = createDefaultTodayTrendDynamicsSettings();
    const trackingLimit = value.trackingLimit === undefined ? defaults.trackingLimit : value.trackingLimit;
    if (!Number.isInteger(trackingLimit) || trackingLimit < 1 || trackingLimit > TODAY_TREND_LIMITS.events) fail('TT_DYNAMICS_SETTINGS', '动态追踪上限无效');
    const typeSetting = (key, probability = false) => {
        const input = value[key] === undefined ? {} : value[key];
        assertRecord(input, 'TT_DYNAMICS_SETTINGS', `${key} 设置无效`);
        const setting = { ...defaults[key], ...input };
        assertRecord(setting, 'TT_DYNAMICS_SETTINGS', `${key} 设置无效`);
        const normalized = { enabled: requiredBoolean(setting.enabled, 'TT_DYNAMICS_SETTINGS', `${key} 开关`) };
        if (probability) {
            if (!Number.isInteger(setting.probability) || setting.probability < 0 || setting.probability > 100) fail('TT_DYNAMICS_SETTINGS', '突发概率无效');
            normalized.probability = setting.probability;
        }
        return normalized;
    };
    const legacyAutoArchive = value.autoArchive;
    return {
        trackingLimit,
        appendOnlyOnActualProgress: value.appendOnlyOnActualProgress === undefined ? defaults.appendOnlyOnActualProgress : requiredBoolean(value.appendOnlyOnActualProgress, 'TT_DYNAMICS_SETTINGS', '实际进展开关'),
        autoComplete: value.autoComplete === undefined ? (legacyAutoArchive === undefined ? true : requiredBoolean(legacyAutoArchive, 'TT_DYNAMICS_SETTINGS', '旧自动归档开关')) : requiredBoolean(value.autoComplete, 'TT_DYNAMICS_SETTINGS', '自动判断完结开关'),
        archiveCompleted: value.archiveCompleted === undefined ? (legacyAutoArchive === undefined ? true : requiredBoolean(legacyAutoArchive, 'TT_DYNAMICS_SETTINGS', '旧自动归档开关')) : requiredBoolean(value.archiveCompleted, 'TT_DYNAMICS_SETTINGS', '完结归档开关'),
        incident: typeSetting('incident', true), rumor: typeSetting('rumor'), underground: typeSetting('underground'),
    };
}

function normalizePreset(value) {
    assertRecord(value, 'TT_PRESET', '世界预设必须是对象');
    const source = plainRecord(value.source) ? value.source : fail('TT_PRESET', '世界预设来源无效');
    const moduleRules = plainRecord(value.moduleRules) ? value.moduleRules : fail('TT_PRESET', '世界预设模块规则无效');
    const moduleSchemas = plainRecord(value.moduleSchemas) ? value.moduleSchemas : fail('TT_PRESET', '世界预设模块结构无效');
    const dynamicsRules = plainRecord(value.dynamicsRules) ? value.dynamicsRules : fail('TT_PRESET', '世界预设动态规则无效');
    const createdAt = timestamp(value.createdAt);
    return {
        id: normalizeId(value.id, 'TT_PRESET', '世界预设 ID'), name: requiredText(value.name, TODAY_TREND_LIMITS.name, 'TT_PRESET', '世界预设名称'),
        version: Number.isInteger(value.version) && value.version >= 1 ? value.version : fail('TT_PRESET', '世界预设版本无效'),
        revision: Number.isInteger(value.revision) && value.revision >= 1 ? value.revision : fail('TT_PRESET', '世界预设修订号无效'),
        createdAt, updatedAt: Math.max(createdAt, timestamp(value.updatedAt, createdAt)),
        source: { worldBookNames: normalizeStringArray(source.worldBookNames ?? [], TODAY_TREND_LIMITS.worldItems, TODAY_TREND_LIMITS.name, 'TT_PRESET', '世界书'), includeExistingChat: requiredBoolean(source.includeExistingChat, 'TT_PRESET', '已有正文开关'), userRequirements: cleanText(source.userRequirements) },
        moduleRules: ['world', 'reputation', 'faction', 'dynamics'].reduce((result, key) => ({ ...result, [key]: requiredText(moduleRules[key], TODAY_TREND_LIMITS.text, 'TT_PRESET', '模块规则') }), {}),
        moduleSchemas: ['worldItems', 'reputationCircles', 'factionGuidance'].reduce((result, key) => ({ ...result, [key]: requiredText(moduleSchemas[key], TODAY_TREND_LIMITS.text, 'TT_PRESET', '模块结构') }), {}),
        dynamicsRules: ['general', 'incident', 'rumor', 'underground'].reduce((result, key) => ({ ...result, [key]: requiredText(dynamicsRules[key], TODAY_TREND_LIMITS.text, 'TT_PRESET', '动态规则') }), {}),
    };
}

function assertUnique(records, label) {
    const ids = records.map(record => record.id);
    if (new Set(ids).size !== ids.length) fail('TT_DUPLICATE_ID', `${label} ID 不能重复`);
}

function validateFactions(factions) {
    const byId = new Map(factions.map(faction => [faction.id, faction]));
    for (const faction of factions) {
        if (faction.parentId && !byId.has(faction.parentId)) fail('TT_FACTION_PARENT', '父势力不存在');
        if (faction.parentId === faction.id || faction.relatedFactionIds.includes(faction.id)) fail('TT_FACTION_SELF', '势力不能关联自身');
        if (faction.relatedFactionIds.some(id => !byId.has(id))) fail('TT_FACTION_RELATED', '外部关联势力不存在');
        if (faction.relatedFactionIds.some(id => faction.parentId === id || byId.get(id).parentId === faction.id)) {
            fail('TT_FACTION_RELATION_OVERLAP', '父子势力不能同时作为外部关联');
        }
    }
    const visiting = new Set(), visited = new Set();
    const visit = id => {
        if (visiting.has(id)) fail('TT_FACTION_CYCLE', '势力父子关系存在循环');
        if (visited.has(id)) return;
        visiting.add(id); const parent = byId.get(id).parentId; if (parent) visit(parent); visiting.delete(id); visited.add(id);
    };
    for (const faction of factions) visit(faction.id);
}

function normalizeTodayTrendScopeInternal(value, presetIds, normalizeSnapshots) {
    assertRecord(value, 'TT_SCOPE', '角色资料必须是对象');
    const scope = createEmptyTodayTrendScope();
    scope.storageId = normalizeId(value.storageId, 'TT_SCOPE', '聊天 ID');
    scope.characterId = requiredText(value.characterId, TODAY_TREND_LIMITS.name, 'TT_SCOPE', '角色 ID');
    scope.characterName = requiredText(value.characterName, TODAY_TREND_LIMITS.name, 'TT_SCOPE', '角色名称');
    scope.presetId = normalizeId(value.presetId, 'TT_SCOPE', '世界预设 ID');
    if (presetIds && !presetIds.has(scope.presetId)) fail('TT_SCOPE_PRESET', '角色资料引用的世界预设不存在');
    const operation = plainRecord(value.operation) ? value.operation : fail('TT_SCOPE', '运行设置无效');
    scope.operation = { enabled: requiredBoolean(operation.enabled, 'TT_SCOPE', '运行开关'), mode: assertEnum(operation.mode, TODAY_TREND_OPERATION_MODES, 'TT_SCOPE', '运行模式'), intervalFloors: Number.isInteger(operation.intervalFloors) && operation.intervalFloors >= 1 && operation.intervalFloors <= TODAY_TREND_LIMITS.intervalFloors ? operation.intervalFloors : fail('TT_SCOPE', '自动调用楼层无效'), lastSuccessfulAssistantCount: timestamp(operation.lastSuccessfulAssistantCount), lastSuccessfulRunAt: timestamp(operation.lastSuccessfulRunAt) };
    const injection = plainRecord(value.injection) ? value.injection : fail('TT_SCOPE', '正文注入设置无效'); scope.injection = { enabled: requiredBoolean(injection.enabled, 'TT_SCOPE', '正文注入开关'), minimalUi: injection.minimalUi === true };
    const world = plainRecord(value.world) ? value.world : fail('TT_SCOPE', '世界态势无效'); if (!Array.isArray(world.items) || world.items.length > TODAY_TREND_LIMITS.worldItems) fail('TT_SCOPE', '世界态势项目无效'); scope.world.items = world.items.map(normalizeWorldItem); assertUnique(scope.world.items, '世界态势项目');
    const reputation = plainRecord(value.reputation) ? value.reputation : fail('TT_SCOPE', '个人风评无效'); if (!Array.isArray(reputation.circles) || reputation.circles.length > TODAY_TREND_LIMITS.circles) fail('TT_SCOPE', '个人风评圈层无效'); scope.reputation.circles = reputation.circles.map(normalizeCircle); assertUnique(scope.reputation.circles, '个人风评圈层');
    if (!Array.isArray(value.factions) || value.factions.length > TODAY_TREND_LIMITS.factions) fail('TT_SCOPE', '势力图谱无效'); scope.factions = value.factions.map(normalizeFaction); assertUnique(scope.factions, '势力图谱'); validateFactions(scope.factions);
    scope.dynamicsSettings = normalizeDynamicsSettings(value.dynamicsSettings);
    const dynamics = plainRecord(value.dynamics) ? value.dynamics : fail('TT_SCOPE', '事件追踪无效');
    for (const lifecycle of TODAY_TREND_EVENT_LIFECYCLES) { const events = dynamics[lifecycle]; if (!Array.isArray(events) || events.length > TODAY_TREND_LIMITS.events) fail('TT_SCOPE', '动态事件无效'); scope.dynamics[lifecycle] = events.map(event => normalizeEvent(event, lifecycle)); }
    const allEvents = [...scope.dynamics.active, ...scope.dynamics.archived]; assertUnique(allEvents, '动态事件'); const eventIds = new Set(allEvents.map(event => event.id));
    for (const event of allEvents) if (event.relatedEventIds.includes(event.id) || event.relatedEventIds.some(id => !eventIds.has(id))) fail('TT_EVENT_RELATED', '关联事件无效');
    for (const event of scope.dynamics.archived) {
        if (event.type === 'underground' && event.outcome === 'absorbed'
            && !allEvents.some(candidate => candidate.type === 'incident' && candidate.relatedEventIds.includes(event.id))) {
            fail('TT_EVENT_OUTCOME', '被承接的地下线必须关联后续突发事件');
        }
    }
    if (scope.dynamics.active.length > scope.dynamicsSettings.trackingLimit) fail('TT_DYNAMICS_SETTINGS', '正在追踪事件超过上限');
    if (!normalizeSnapshots) return scope;
    const rawSnapshots = value.generationSnapshots;
    const baselineSnapshot = {
        assistantCount: 0, generatedAt: 0,
        world: scope.world, reputation: scope.reputation, factions: scope.factions,
        dynamicsSettings: scope.dynamicsSettings, dynamics: scope.dynamics,
    };
    const sourceSnapshots = Array.isArray(rawSnapshots) && rawSnapshots.length ? rawSnapshots : [
        baselineSnapshot,
        ...(scope.operation.lastSuccessfulAssistantCount > 0 ? [{
            assistantCount: scope.operation.lastSuccessfulAssistantCount,
            generatedAt: scope.operation.lastSuccessfulRunAt,
            world: scope.world, reputation: scope.reputation, factions: scope.factions,
            dynamicsSettings: scope.dynamicsSettings, dynamics: scope.dynamics,
        }] : []),
    ];
    if (sourceSnapshots.length > TODAY_TREND_LIMITS.generationSnapshots) fail('TT_SNAPSHOT_LIMIT', '今日风向楼层快照数量超限');
    const snapshots = new Map();
    for (const raw of sourceSnapshots) {
        assertRecord(raw, 'TT_SNAPSHOT', '今日风向楼层快照必须是对象');
        const assistantCount = timestamp(raw.assistantCount);
        const snapshotScope = normalizeTodayTrendScopeInternal({
            ...scope,
            operation: { ...scope.operation, lastSuccessfulAssistantCount: assistantCount, lastSuccessfulRunAt: timestamp(raw.generatedAt) },
            world: raw.world, reputation: raw.reputation, factions: raw.factions,
            dynamicsSettings: raw.dynamicsSettings, dynamics: raw.dynamics,
            generationSnapshots: [],
        }, presetIds, false);
        snapshots.set(assistantCount, {
            assistantCount, generatedAt: timestamp(raw.generatedAt),
            world: snapshotScope.world, reputation: snapshotScope.reputation, factions: snapshotScope.factions,
            dynamicsSettings: snapshotScope.dynamicsSettings, dynamics: snapshotScope.dynamics,
        });
    }
    const normalizedSnapshots = [...snapshots.values()].sort((left, right) => left.assistantCount - right.assistantCount);
    if (!snapshots.has(0)) {
        const earliest = normalizedSnapshots[0] || baselineSnapshot;
        const baseline = {
            assistantCount: 0, generatedAt: 0,
            world: structuredClone(earliest.world), reputation: structuredClone(earliest.reputation), factions: structuredClone(earliest.factions),
            dynamicsSettings: structuredClone(earliest.dynamicsSettings), dynamics: structuredClone(earliest.dynamics),
        };
        scope.generationSnapshots = [baseline, ...normalizedSnapshots.slice(-(TODAY_TREND_LIMITS.generationSnapshots - 1))];
    } else scope.generationSnapshots = normalizedSnapshots;
    return scope;
}

export function normalizeTodayTrendScope(value, presetIds) {
    return normalizeTodayTrendScopeInternal(value, presetIds, true);
}

export function appendTodayTrendGenerationSnapshot(scope, assistantCount, generatedAt = Date.now()) {
    const normalized = normalizeTodayTrendScope(scope, new Set([scope?.presetId]));
    const floor = timestamp(assistantCount);
    const snapshot = {
        assistantCount: floor, generatedAt: timestamp(generatedAt),
        world: structuredClone(normalized.world), reputation: structuredClone(normalized.reputation), factions: structuredClone(normalized.factions),
        dynamicsSettings: structuredClone(normalized.dynamicsSettings), dynamics: structuredClone(normalized.dynamics),
    };
    const sortedSnapshots = [...normalized.generationSnapshots.filter(item => item.assistantCount !== floor), snapshot]
        .sort((left, right) => left.assistantCount - right.assistantCount);
    const baseline = sortedSnapshots.find(item => item.assistantCount === 0);
    const generationSnapshots = baseline
        ? [baseline, ...sortedSnapshots.filter(item => item.assistantCount !== 0).slice(-(TODAY_TREND_LIMITS.generationSnapshots - 1))]
        : sortedSnapshots.slice(-TODAY_TREND_LIMITS.generationSnapshots);
    return normalizeTodayTrendScope({ ...normalized, generationSnapshots }, new Set([normalized.presetId]));
}

export function rollbackTodayTrendScope(scope, assistantCount) {
    const normalized = normalizeTodayTrendScope(scope, new Set([scope?.presetId]));
    const floor = timestamp(assistantCount);
    const snapshot = normalized.generationSnapshots.filter(item => item.assistantCount <= floor).at(-1);
    if (!snapshot) return normalized;
    return normalizeTodayTrendScope({
        ...normalized,
        operation: { ...normalized.operation, lastSuccessfulAssistantCount: snapshot.assistantCount, lastSuccessfulRunAt: snapshot.generatedAt },
        world: snapshot.world, reputation: snapshot.reputation, factions: snapshot.factions,
        dynamicsSettings: snapshot.dynamicsSettings, dynamics: snapshot.dynamics,
        generationSnapshots: normalized.generationSnapshots.filter(item => item.assistantCount <= snapshot.assistantCount),
    }, new Set([normalized.presetId]));
}

export function normalizeTodayTrendStore(value) {
    if (value === null || value === undefined) return createEmptyTodayTrendStore();
    assertRecord(value, 'TT_STORE', '今日风向数据必须是对象');
    if (value.version !== TODAY_TREND_VERSION) fail('TT_STORE_VERSION', '今日风向数据版本不兼容');
    const rawPresets = plainRecord(value.presets) ? value.presets : fail('TT_STORE', '世界预设集合无效');
    const rawScopes = plainRecord(value.scopes) ? value.scopes : fail('TT_STORE', '角色资料集合无效');
    const presets = {};
    for (const [id, rawPreset] of Object.entries(rawPresets)) { if (Object.keys(presets).length >= TODAY_TREND_LIMITS.presets) fail('TT_PRESET_LIMIT', '世界预设数量超限'); if (!validId(id)) fail('TT_PRESET', '世界预设键无效'); const preset = normalizePreset(rawPreset); if (preset.id !== id) fail('TT_PRESET', '世界预设 ID 不匹配'); presets[id] = preset; }
    const presetIds = new Set(Object.keys(presets)), scopes = {};
    for (const [storageId, rawScope] of Object.entries(rawScopes)) { if (Object.keys(scopes).length >= TODAY_TREND_LIMITS.scopes) fail('TT_SCOPE_LIMIT', '角色资料数量限'); if (!validId(storageId)) fail('TT_SCOPE', '聊天 ID 无效'); const scope = normalizeTodayTrendScope(rawScope, presetIds); if (scope.storageId !== storageId) fail('TT_SCOPE', '聊天 ID 不匹配'); scopes[storageId] = scope; }
    return { version: TODAY_TREND_VERSION, presets, scopes };
}

export function migrateTodayTrendStore(value) {
    if (value === null || value === undefined) return { store: createEmptyTodayTrendStore(), migrated: false };
    assertRecord(value, 'TT_STORE', '今日风向数据必须是对象');
    if (value.version === undefined) {
        return { store: normalizeTodayTrendStore({ ...value, version: TODAY_TREND_VERSION }), migrated: true };
    }
    if (value.version !== TODAY_TREND_VERSION) fail('TT_STORE_VERSION', '今日风向数据版本不兼容');
    return { store: normalizeTodayTrendStore(value), migrated: false };
}

export function copyTodayTrendScope(sourceScope, targetStorageId) {
    const source = normalizeTodayTrendScope(sourceScope, new Set([sourceScope?.presetId]));
    const targetId = normalizeId(targetStorageId, 'TT_SCOPE', '目标聊天 ID');
    if (targetId === source.storageId) fail('TT_SCOPE', '目标聊天 ID 不能与来源相同');
    return normalizeTodayTrendScope({
        ...structuredClone(source), storageId: targetId,
        operation: { ...source.operation, lastSuccessfulAssistantCount: 0, lastSuccessfulRunAt: 0 },
        generationSnapshots: [],
    }, new Set([source.presetId]));
}

function normalizeMutationScope(scope) {
    return normalizeTodayTrendScope(scope, new Set([scope?.presetId]));
}

function findActiveEvent(scope, eventId) {
    const id = normalizeId(eventId, 'TT_EVENT', '事件 ID');
    const index = scope.dynamics.active.findIndex(event => event.id === id);
    if (index < 0) fail('TT_EVENT_NOT_ACTIVE', '正在追踪事件不存在');
    return { id, index, event: scope.dynamics.active[index] };
}

export function advanceTodayTrendEvent(scope, eventId, { stageLabel, latestStage, now = Date.now() } = {}) {
    const candidate = structuredClone(normalizeMutationScope(scope));
    const found = findActiveEvent(candidate, eventId);
    const nextStage = requiredText(latestStage, TODAY_TREND_LIMITS.text, 'TT_EVENT', '事件最新阶段');
    if (candidate.dynamicsSettings.appendOnlyOnActualProgress && nextStage === found.event.latestStage) fail('TT_EVENT_NO_PROGRESS', '事件没有实际进展');
    candidate.dynamics.active[found.index] = { ...found.event, stageLabel: requiredText(stageLabel, TODAY_TREND_LIMITS.stageLabel, 'TT_EVENT', '事件阶段'), stages: [...found.event.stages, nextStage], latestStage: nextStage, updatedAt: timestamp(now, found.event.updatedAt) };
    return normalizeMutationScope(candidate);
}

export function archiveTodayTrendEvent(scope, eventId, { outcome, finalResult, now = Date.now(), allowRumor = false } = {}) {
    const candidate = structuredClone(normalizeMutationScope(scope));
    const found = findActiveEvent(candidate, eventId);
    if (found.event.type === 'rumor' && !allowRumor) fail('TT_EVENT_RUMOR', '流言必须通过证实或证伪归档');
    if (outcome === 'absorbed') fail('TT_EVENT_OUTCOME', '只有地下线升级可以标记为已承接');
    const archived = { ...found.event, lifecycle: 'archived', outcome, finalResult, updatedAt: timestamp(now, found.event.updatedAt) };
    candidate.dynamics.active.splice(found.index, 1);
    candidate.dynamics.archived.push(archived);
    return normalizeMutationScope(candidate);
}

export function settleTodayTrendRumor(scope, eventId, result) {
    const normalized = normalizeMutationScope(scope);
    const { event } = findActiveEvent(normalized, eventId);
    if (event.type !== 'rumor' || !['confirmed', 'debunked'].includes(result?.outcome)) fail('TT_EVENT_RUMOR', '流言只能证实或证伪');
    return archiveTodayTrendEvent(normalized, eventId, { ...result, allowRumor: true });
}

export function promoteTodayTrendUnderground(scope, eventId, incident, { now = Date.now() } = {}) {
    const normalized = normalizeMutationScope(scope);
    const { event } = findActiveEvent(normalized, eventId);
    if (event.type !== 'underground') fail('TT_EVENT_UNDERGROUND', '只有地下线可以升级为突发事件');
    const source = incident && typeof incident === 'object' ? incident : fail('TT_EVENT', '突发事件无效');
    const next = structuredClone(normalized);
    const title = requiredText(source.title, TODAY_TREND_LIMITS.name, 'TT_EVENT', '突发事件名称');
    const index = next.dynamics.active.findIndex(item => item.id === event.id);
    next.dynamics.active.splice(index, 1);
    next.dynamics.archived.push({ ...event, lifecycle: 'archived', outcome: 'absorbed', finalResult: `已由公开事故“${title}”承接`, updatedAt: timestamp(now, event.updatedAt) });
    next.dynamics.active.push({ ...source, title, type: 'incident', lifecycle: 'active', outcome: null, finalResult: null, relatedEventIds: [...new Set([...(source.relatedEventIds || []), event.id])], createdAt: timestamp(source.createdAt, timestamp(now)), updatedAt: timestamp(source.updatedAt, timestamp(now)) });
    return normalizeMutationScope(next);
}
