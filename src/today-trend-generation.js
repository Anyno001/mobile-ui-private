import { generationErrorMessage, parseFirstJsonObject } from './ai.js';
import { materializeTodayTrendBatchDelta } from './today-trend-batch-delta.js';
import { gatherTodayTrendContext } from './today-trend-context.js';
import { normalizeTodayTrendHistoryProducer } from './today-trend-history-reducer.js';
import { TODAY_TREND_VERSION, normalizeTodayTrendScope, normalizeTodayTrendStore } from './today-trend-model.js';
import {
    buildTodayTrendGenerationEnvelope,
    buildTodayTrendInitializationEnvelope,
    buildTodayTrendRuleRegenerationEnvelope,
} from './today-trend-prompts.js';

const own = (value, key) => !!value && typeof value === 'object' && Object.hasOwn(value, key);
const abortError = () => Object.assign(new Error('请求已取消'), { name: 'AbortError' });
const assertActive = signal => { if (signal?.aborted) throw abortError(); };
const ruleText = value => typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').slice(0, 600) : '';
const keysOnly = (value, keys, label) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`今日风向生成${label}必须是对象`);
    if (Object.keys(value).some(key => !keys.includes(key))) throw new Error(`今日风向生成${label}包含额外字段`);
};
const arrayOf = (value, verify, label) => {
    if (!Array.isArray(value)) throw new Error(`今日风向生成${label}必须是数组`);
    value.forEach(verify);
};
const nonEmptyTextArray = (value, label) => {
    if (!Array.isArray(value) || value.length === 0 || value.some(item => typeof item !== 'string' || !item.trim())) {
        throw new Error(`今日风向生成${label}必须是非空字符串数组`);
    }
};
const verifyRelation = value => keysOnly(value, ['status', 'evaluation'], '关系');
const verifyWorld = value => {
    keysOnly(value, ['items'], '世界态势');
    arrayOf(value.items, item => keysOnly(item, ['id', 'name', 'summary'], '世界态势项目'), '世界态势项目');
};
const verifyReputation = value => {
    keysOnly(value, ['circles'], '个人风评');
    arrayOf(value.circles, item => keysOnly(item, ['id', 'name', 'scope', 'status', 'evaluation'], '风评圈层'), '风评圈层');
};
const verifyFactions = value => arrayOf(value, faction => {
    keysOnly(faction, ['id', 'name', 'summary', 'parentId', 'relatedFactionIds', 'details', 'relation'], '势力');
    arrayOf(faction.details, detail => keysOnly(detail, ['label', 'value'], '势力资料'), '势力资料');
    verifyRelation(faction.relation);
}, '势力图谱');
const verifyDynamics = value => {
    keysOnly(value, ['active', 'archived'], '事件追踪');
    for (const bucket of ['active', 'archived']) arrayOf(value[bucket], (event, index) => {
        const label = `事件追踪.${bucket}[${index}]`;
        keysOnly(event,
            ['id', 'type', 'lifecycle', 'title', 'stageLabel', 'origin', 'participants', 'stages', 'latestStage', 'outcome', 'finalResult', 'relatedEventIds', 'createdAt', 'updatedAt'], label);
        nonEmptyTextArray(event.stages, `${label}.stages`);
    }, '动态事件');
};

const sanitizeFactionRelations = factions => {
    if (!Array.isArray(factions)) return factions;
    const factionIds = new Set(factions.map(faction => faction?.id).filter(id => typeof id === 'string' && id));
    const parentById = new Map(factions.map(faction => [faction?.id, faction?.parentId]));
    return factions.map(faction => {
        if (!Array.isArray(faction?.relatedFactionIds)) return faction;
        const relatedFactionIds = faction.relatedFactionIds.filter(id => factionIds.has(id)
            && id !== faction.parentId && parentById.get(id) !== faction.id);
        return relatedFactionIds.length === faction.relatedFactionIds.length ? faction : { ...faction, relatedFactionIds };
    });
};

function parseInitialization(raw) {
    const value = parseFirstJsonObject(raw, '今日风向初始化未返回可解析JSON', candidate => own(candidate, 'preset') && own(candidate, 'scope'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('今日风向初始化结果必须是对象');
    const keys = Object.keys(value);
    if (keys.length !== 2 || !own(value, 'preset') || !own(value, 'scope')) throw new Error('今日风向初始化结果包含额外字段');
    if (!value.preset || typeof value.preset !== 'object' || Array.isArray(value.preset)) throw new Error('今日风向初始化缺少有效预设');
    if (!value.scope || typeof value.scope !== 'object' || Array.isArray(value.scope)) throw new Error('今日风向初始化缺少有效角色资料');
    return value;
}

function parseGeneration(raw, { requireHistory = false } = {}) {
    const value = parseFirstJsonObject(raw, '今日风向生成未返回可解析JSON', candidate => own(candidate, 'world') && own(candidate, 'reputation') && own(candidate, 'factions') && own(candidate, 'dynamics'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('今日风向生成结果必须是对象');
    const keys = Object.keys(value);
    const expected = requireHistory ? ['world', 'reputation', 'factions', 'dynamics', 'history'] : ['world', 'reputation', 'factions', 'dynamics'];
    if (keys.length !== expected.length || !expected.every(key => own(value, key))) throw new Error('今日风向生成结果包含额外字段');
    if (value.world !== null && (typeof value.world !== 'object' || Array.isArray(value.world))) throw new Error('今日风向生成模块 world 无效');
    if (value.reputation !== null && (typeof value.reputation !== 'object' || Array.isArray(value.reputation))) throw new Error('今日风向生成模块 reputation 无效');
    if (value.factions !== null && !Array.isArray(value.factions)) throw new Error('今日风向生成模块 factions 无效');
    if (value.dynamics !== null && (typeof value.dynamics !== 'object' || Array.isArray(value.dynamics))) throw new Error('今日风向生成模块 dynamics 无效');
    if (value.world !== null) verifyWorld(value.world);
    if (value.reputation !== null) verifyReputation(value.reputation);
    if (value.factions !== null) verifyFactions(value.factions);
    if (value.dynamics !== null) verifyDynamics(value.dynamics);
    if (requireHistory) value.history = normalizeTodayTrendHistoryProducer(value.history);
    return value;
}

const targetModules = new Set(['world', 'reputation', 'faction', 'dynamics']);
const validTarget = target => {
    if (target === null || target === undefined) return true;
    if (!target || typeof target !== 'object' || Array.isArray(target) || !targetModules.has(target.module)) return false;
    if (Object.keys(target).some(key => !['module', 'itemId', 'mode'].includes(key))) return false;
    const hasItemId = target.itemId !== undefined;
    if (hasItemId && (typeof target.itemId !== 'string' || !target.itemId.trim())) return false;
    if (target.mode === undefined) return true;
    return target.mode === 'schema' && target.module === 'reputation' && hasItemId;
};

const sameJson = (left, right) => {
    if (Object.is(left, right)) return true;
    if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false;
    if (Array.isArray(left) || Array.isArray(right)) {
        return Array.isArray(left) && Array.isArray(right) && left.length === right.length
            && left.every((item, index) => sameJson(item, right[index]));
    }
    const leftKeys = Object.keys(left).sort(), rightKeys = Object.keys(right).sort();
    return leftKeys.length === rightKeys.length && leftKeys.every((key, index) => key === rightKeys[index]
        && sameJson(left[key], right[key]));
};
const targetedRecords = (previous, next, targetId, label) => {
    if (!targetId) return;
    if (!previous.some(item => item.id === targetId) || !next.some(item => item.id === targetId)) {
        throw new Error(`${label}单项刷新缺少目标项目`);
    }
    if (next.length !== previous.length || next.some((item, index) => item.id !== previous[index]?.id)) {
        throw new Error(`${label}单项刷新不得新增、删除、替换或重排项目`);
    }
    if (next.some(item => item.id !== targetId && !sameJson(item, previous.find(candidate => candidate.id === item.id)))) {
        throw new Error(`${label}单项刷新不得改写其他项目`);
    }
};

const targetedDynamics = (previous, next, targetId) => {
    const previousEvents = [...previous.active, ...previous.archived];
    const nextEvents = [...next.active, ...next.archived];
    const current = previous.active.find(event => event.id === targetId);
    const updated = nextEvents.find(event => event.id === targetId);
    if (!previous.active.some(event => event.id === targetId) || nextEvents.filter(event => event.id === targetId).length !== 1) {
        throw new Error('事件追踪单项刷新缺少目标事件');
    }
    if (previousEvents.length !== nextEvents.length
        || !sameJson(previous.active.filter(event => event.id !== targetId), next.active.filter(event => event.id !== targetId))
        || !sameJson(previous.archived.filter(event => event.id !== targetId), next.archived.filter(event => event.id !== targetId))) {
        throw new Error('事件追踪单项刷新不得新增、删除、重排或改写其他事件');
    }
    if (!['id', 'type', 'title', 'origin', 'participants', 'relatedEventIds', 'createdAt'].every(key => sameJson(current[key], updated[key]))) {
        throw new Error('事件追踪单项推进不得改写事件基础资料');
    }
};

function assertTargetedGeneration(parsed, scope, target) {
    const module = ['world', 'reputation', 'faction', 'dynamics'].includes(target?.module) ? target.module : '';
    if (!module) return;
    const key = module === 'faction' ? 'factions' : module;
    if (['world', 'reputation', 'factions', 'dynamics'].some(name => name !== key && parsed[name] !== null)) {
        throw new Error('单模块刷新返回了未请求模块的变更');
    }
    if (parsed[key] === null) throw new Error('单模块刷新未返回目标模块');
    if (!target.itemId) return;
    if (module === 'world') {
        targetedRecords(scope.world.items, parsed.world.items, target.itemId, '世界态势');
        return;
    }
    if (module === 'reputation') {
        targetedRecords(scope.reputation.circles, parsed.reputation.circles, target.itemId, '个人风评');
        if (target.mode === 'schema') {
            const previous = scope.reputation.circles.find(item => item.id === target.itemId);
            const next = parsed.reputation.circles.find(item => item.id === target.itemId);
            if (next.status !== previous.status || next.evaluation !== previous.evaluation) {
                throw new Error('圈层结构重新生成不得改写关系状态或评价');
            }
        }
        return;
    }
    if (module === 'faction') return targetedRecords(scope.factions, parsed.factions, target.itemId, '势力图谱');
    if (module === 'dynamics') targetedDynamics(scope.dynamics, parsed.dynamics, target.itemId);
}

function normalizeGeneration(parsed, { scope, preset, allowIncident, allowHistoricalIncidentRecord = false }) {
    if (!scope || !preset) throw new TypeError('今日风向生成缺少当前资料');
    const generatedFactions = parsed.factions === null ? null : sanitizeFactionRelations(parsed.factions);
    const normalizeEventLatestStage = event => {
        if (!event || !Array.isArray(event.stages) || !event.stages.length) return event;
        const latestStage = event.stages.at(-1);
        return event.latestStage === latestStage ? event : { ...event, latestStage };
    };
    const normalizeDynamicsLatestStages = dynamics => dynamics === null ? null : {
        ...dynamics,
        active: dynamics.active.map(normalizeEventLatestStage),
        archived: dynamics.archived.map(normalizeEventLatestStage),
    };
    const candidate = {
        ...scope,
        world: parsed.world ?? scope.world,
        reputation: parsed.reputation ?? scope.reputation,
        factions: generatedFactions ?? scope.factions,
        dynamics: parsed.dynamics === null ? scope.dynamics : normalizeDynamicsLatestStages(parsed.dynamics),
    };
    for (const previous of scope.dynamics.active) {
        const nextEvents = [...candidate.dynamics.active, ...candidate.dynamics.archived];
        const next = nextEvents.find(event => event?.id === previous.id);
        if (next?.lifecycle === 'archived' && next.outcome === 'absorbed' && previous.type === 'underground'
            && !candidate.dynamics.active.some(event => event?.type === 'incident' && Array.isArray(event.relatedEventIds)
                && event.relatedEventIds.includes(previous.id))) {
            throw new Error('地下线升级必须归档旧事件并新建关联突发事件');
        }
    }
    const normalized = normalizeTodayTrendScope(candidate, new Set([preset.id]));
    const previousActive = new Map(scope.dynamics.active.map(event => [event.id, event]));
    const previousArchived = new Map(scope.dynamics.archived.map(event => [event.id, event]));
    const nextEvents = [...normalized.dynamics.active, ...normalized.dynamics.archived];
    const nextById = new Map(nextEvents.map(event => [event.id, event]));
    for (const [id, previous] of previousArchived) {
        const next = nextById.get(id);
        if (!next || next.lifecycle !== 'archived' || !sameJson(next, previous)) {
            throw new Error('已归档事件不能删除、改写或重新追踪');
        }
    }
    for (const [id, previous] of previousActive) {
        const next = nextById.get(id);
        if (!next) throw new Error('正在追踪事件不能凭空删除');
        if (next.type !== previous.type) throw new Error('既有事件类型不能改写');
        const historyUnchanged = previous.stages.every((stage, index) => next.stages[index] === stage);
        if (!historyUnchanged || next.stages.length < previous.stages.length) throw new Error('事件阶段历史只能追加，不能改写');
        if (next.lifecycle === 'archived' && (!scope.dynamicsSettings.autoComplete || !scope.dynamicsSettings.archiveCompleted)) {
            throw new Error('当前设置不允许自动归档事件');
        }
        if (next.lifecycle === 'archived' && next.outcome === 'absorbed'
            && (previous.type !== 'underground' || !normalized.dynamics.active.some(event => event.type === 'incident' && event.relatedEventIds.includes(previous.id)))) {
            throw new Error('地下线升级必须归档旧事件并新建关联突发事件');
        }
        if (scope.dynamicsSettings.appendOnlyOnActualProgress && next.stages.length > previous.stages.length
            && next.latestStage === previous.latestStage) {
            throw new Error('事件阶段追加后必须反映实际进展');
        }
    }
    const knownIdsByType = new Map(['incident', 'rumor', 'underground'].map(type => [type, new Set(
        [...scope.dynamics.active, ...scope.dynamics.archived].filter(event => event.type === type).map(event => event.id),
    )]));
    const enabledByType = {
        incident: scope.dynamicsSettings.incident.enabled === true
            && (allowIncident === true || allowHistoricalIncidentRecord === true),
        rumor: scope.dynamicsSettings.rumor.enabled,
        underground: scope.dynamicsSettings.underground.enabled,
    };
    for (const [type, enabled] of Object.entries(enabledByType)) {
        if (!enabled && [...normalized.dynamics.active, ...normalized.dynamics.archived]
            .some(event => event.type === type && !knownIdsByType.get(type).has(event.id))) {
            throw new Error(`本轮未允许生成${type === 'incident' ? '突发事件' : type === 'rumor' ? '流言' : '地下线'}`);
        }
    }
    return normalized;
}

function normalizeInitialization(parsed, context, now, presetId = `${context.storageId}:preset`) {
    const timestamp = now();
    const preset = {
        ...parsed.preset, id: presetId, version: TODAY_TREND_VERSION, revision: 1,
        createdAt: timestamp, updatedAt: timestamp, source: context.source,
    };
    const scope = {
        ...parsed.scope, factions: sanitizeFactionRelations(parsed.scope?.factions), storageId: context.storageId, characterId: context.characterId,
        characterName: context.characterName, presetId,
        operation: { enabled: false, mode: 'manual', intervalFloors: 1, lastSuccessfulAssistantCount: 0, lastSuccessfulRunAt: 0 },
        injection: { enabled: false },
    };
    return normalizeTodayTrendStore({ version: TODAY_TREND_VERSION, presets: { [presetId]: preset }, scopes: { [context.storageId]: scope } });
}

export function createTodayTrendGenerationController({
    callAI, getCtx, gather = gatherTodayTrendContext, buildInitialization = buildTodayTrendInitializationEnvelope,
    buildGeneration = buildTodayTrendGenerationEnvelope, parse = parseInitialization, normalize = normalizeInitialization,
    buildRuleRegeneration = buildTodayTrendRuleRegenerationEnvelope, parseUpdate = parseGeneration,
    normalizeUpdate = normalizeGeneration, now = () => Date.now(),
} = {}) {
    if (typeof callAI !== 'function') throw new TypeError('今日风向生成控制器缺少 AI 调用器');
    if (typeof getCtx !== 'function') throw new TypeError('今日风向生成控制器缺少宿主上下文读取器');
    const initialize = async (input = {}) => {
        try {
            assertActive(input.signal);
            const context = await gather({ ...input, getCtx });
            assertActive(input.signal);
            const prompts = buildInitialization({ context });
            const raw = await callAI(prompts.systemPrompt, prompts.userPrompt, { isolated: true, signal: input.signal });
            assertActive(input.signal);
            return { context, store: normalize(parse(raw), context, now, input.presetId), raw };
        } catch (error) {
            if (error?.name === 'AbortError') throw error;
            throw new Error(`今日风向初始化失败：${generationErrorMessage(error)}`, { cause: error });
        }
    };
    const regenerateRule = async ({ scope, preset, rule, signal } = {}) => {
        try {
            if (!scope || !preset) throw new TypeError('今日风向规则重生成缺少当前预设或角色资料');
            const [group, key = ''] = String(rule || '').split('-');
            const rules = group === 'dynamics' && key ? preset.dynamicsRules : preset.moduleRules;
            const field = group === 'dynamics' && key ? key : group;
            if (!Object.hasOwn(rules || {}, field)) throw new TypeError('今日风向规则重生成目标无效');
            assertActive(signal);
            const context = await gather({ getCtx, storageId: scope.storageId, characterId: scope.characterId, characterName: scope.characterName,
                worldBookNames: preset.source.worldBookNames, includeExistingChat: preset.source.includeExistingChat, userRequirements: preset.source.userRequirements });
            assertActive(signal);
            const prompts = buildRuleRegeneration({ context, rule, currentRule: rules[field] });
            const raw = await callAI(prompts.systemPrompt, prompts.userPrompt, { isolated: true, signal });
            assertActive(signal);
            const parsed = parseFirstJsonObject(raw, '今日风向规则重生成未返回可解析 JSON');
            if (!parsed || Object.keys(parsed).length !== 1 || !own(parsed, 'rule') || !ruleText(parsed.rule)) throw new Error('今日风向规则重生成结果无效');
            return ruleText(parsed.rule);
        } catch (error) {
            if (error?.name === 'AbortError') throw error;
            throw new Error(`今日风向规则重生成失败：${generationErrorMessage(error)}`, { cause: error });
        }
    };
    const generate = async (input = {}) => {
        try {
            if (!input.scope || !input.preset) throw new TypeError('今日风向生成缺少当前预设或角色资料');
            if (!validTarget(input.target)) throw new TypeError('今日风向生成目标无效');
            if (input.summaryOnly === true && input.target) throw new TypeError('summary-only 不得与定向刷新同时使用');
            const requireHistory = Object.hasOwn(input, 'storyDate');
            assertActive(input.signal);
            const context = await gather({ ...input, getCtx, historyBatch: input.historyBatch,
                worldBookNames: input.preset.source?.worldBookNames,
                includeExistingChat: input.preset.source?.includeExistingChat, userRequirements: input.preset.source?.userRequirements });
            assertActive(input.signal);
            // Request-only permissions: historical recording never authorizes proactive generation.
            const historical = Array.isArray(input.historyBatch);
            const allowIncident = !historical && input.scope.dynamicsSettings?.incident?.enabled === true && input.allowIncident === true;
            const allowHistoricalIncidentRecord = historical && input.scope.dynamicsSettings?.incident?.enabled === true
                && input.allowHistoricalIncidentRecord === true;
            const prompts = buildGeneration({ context, preset: input.preset, scope: input.scope, promptScope: input.promptScope,
                assistantCount: input.assistantCount, allowIncident, allowHistoricalIncidentRecord, target: input.target,
                storyDate: input.storyDate ?? null, summaryOnly: input.summaryOnly === true, historyBatch: input.historyBatch });
            input.onPhase?.('generating');
            const raw = await callAI(prompts.systemPrompt, prompts.userPrompt, { isolated: true, signal: input.signal });
            assertActive(input.signal);
            input.onPhase?.('parsing');
            let delta = null;
            if (Array.isArray(input.historyBatch)) {
                delta = materializeTodayTrendBatchDelta(parseFirstJsonObject(raw, '历史批增量 JSON 无效'), input.scope, now());
                // Reuse the established module validators, without changing ordinary generation.
                delta.parsed = parseGeneration(JSON.stringify(delta.parsed), { requireHistory: true });
            }
            const parsed = delta ? delta.parsed : parseUpdate(raw, { requireHistory });
            if (delta) {
                const candidate = structuredClone(parsed);
                for (const operation of delta.archives) {
                    const index = candidate.dynamics.active.findIndex(event => event.id === operation.eventId);
                    const [event] = candidate.dynamics.active.splice(index, 1);
                    candidate.dynamics.archived.push({ ...event, lifecycle: 'archived',
                        outcome: operation.outcome, finalResult: operation.finalResult });
                }
                normalizeUpdate(candidate, { scope: input.scope, preset: input.preset,
                    allowIncident, allowHistoricalIncidentRecord, now });
                return { context, scope: normalizeUpdate(parsed, { scope: input.scope, preset: input.preset,
                    allowIncident, allowHistoricalIncidentRecord, now }), history: parsed.history,
                    archives: delta.archives, raw };
            }
            if (input.summaryOnly === true
                && ['world', 'reputation', 'factions', 'dynamics'].some(key => parsed[key] !== null)) {
                throw new Error('summary-only 不得返回结构模块变更');
            }
            assertTargetedGeneration(parsed, input.scope, input.target);
            return { context, scope: normalizeUpdate(parsed, { scope: input.scope, preset: input.preset,
                allowIncident, now }), history: parsed.history ?? null, raw };
        } catch (error) {
            if (error?.name === 'AbortError') throw error;
            if (typeof error?.code === 'string'
                && (error.code === 'TT_BATCH_VALIDATION' || error.code === 'TT_WORLD_CAPACITY' || error.code.startsWith('TT_HISTORY_') || error.code.startsWith('TT_DATE_'))) throw error;
            throw new Error(`今日风向生成失败：${generationErrorMessage(error)}`, { cause: error });
        }
    };
    return { initialize, generate, regenerateRule };
}
