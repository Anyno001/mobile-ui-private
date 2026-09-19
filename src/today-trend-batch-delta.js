import { normalizeTodayTrendHistoryProducer } from './today-trend-history-reducer.js';

const actualType = value => value === undefined ? 'missing' : value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
const invalid = (message, object, path, expected, actual) => {
    const error = new Error(message);
    error.code = 'TT_BATCH_VALIDATION';
    error.details = Object.freeze([Object.freeze({ object, path, expected, actual })]);
    throw error;
};
const exact = (value, keys, path = '$') => {
    if (!value || typeof value !== 'object' || Array.isArray(value)
        || Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) {
        const missing = keys.find(key => !value || !Object.hasOwn(value, key));
        invalid(`${path}: 历史批增量字段集合无效；要求 ${keys.join(',')}`, path,
            missing ? `${path}.${missing}` : path, 'exact-fields', missing ? 'missing' : actualType(value));
    }
};
const unique = (items, key = 'id', path = '$') => {
    if (!Array.isArray(items)) invalid(`${path}: 历史批增量必须为数组`, path, path, 'array', actualType(items));
    const ids = new Set();
    for (const [index, item] of items.entries()) {
        if (typeof item?.[key] !== 'string' || !item[key].trim() || item[key] !== item[key].trim() || ids.has(item[key])) {
            invalid(`${path}.${key}: 历史批增量 ID 无效或重复`, `${path}[${index}]`, `${path}[${index}].${key}`,
                'unique-id', ids.has(item?.[key]) ? 'duplicate' : 'invalid-id');
        }
        ids.add(item[key]);
    }
};
const upsert = (previous, delta, path) => {
    exact(delta, ['upserts'], path);
    unique(delta.upserts, 'id', `${path}.upserts`);
    const result = structuredClone(previous);
    for (const item of delta.upserts) {
        const index = result.findIndex(prior => prior.id === item.id);
        if (index < 0) result.push(item); else result[index] = item;
    }
    return result;
};

// Independent world capacity policy; never part of S4 field-error aggregation.
const guardWorldCapacity = (previous, upserts) => {
    if (!Array.isArray(upserts)) return;
    const existing = previous.length;
    const existingIds = new Set(previous.map(item => item.id));
    const newUnique = new Set(upserts.filter(item => typeof item?.id === 'string' && !existingIds.has(item.id)).map(item => item.id)).size;
    const reject = () => {
        const error = new Error(`世界态势容量限制：现有 ${existing} 项，本批新增 ${newUnique} 项，上限 24 项；只能更新已有 ID 或返回空 world.upserts=[]。`);
        error.code = 'TT_WORLD_CAPACITY';
        throw error;
    };
    if (existing + newUnique > 24) reject();
};

// New arrays replace the complete module; legacy upserts retain their original merge semantics.
const factionsFor = (previous, value) => {
    if (value === null) return null;
    const result = Array.isArray(value) ? structuredClone(value) : upsert(previous, value, 'factions');
    unique(result, 'id', 'factions');
    const ids = new Set(result.map(item => item.id));
    const byId = new Map(result.map(item => [item.id, item]));
    for (const prior of previous) {
        if (!ids.has(prior.id)) invalid('factions: 完整替换缺失旧 ID；拒绝删除', 'factions', 'factions', 'complete-id-set', 'missing');
    }
    result.forEach((item, index) => {
        const path = `factions[${index}]`;
        exact(item, ['id', 'name', 'summary', 'parentId', 'relatedFactionIds', 'details', 'relation'], path);
        if (!Array.isArray(item.details)) invalid(`${path}.details: expected array, actual ${item.details === undefined ? 'missing' : typeof item.details}`, path, `${path}.details`, 'array', actualType(item.details));
        item.details.forEach((detail, i) => exact(detail, ['label', 'value'], `${path}.details[${i}]`));
        exact(item.relation, ['status', 'evaluation'], `${path}.relation`);
        if (item.parentId !== null && (typeof item.parentId !== 'string' || !ids.has(item.parentId))) {
            invalid(`${path}.parentId: 父势力不存在，要求完整集合中的精确 ID 或 null`, path, `${path}.parentId`, 'internal-id-or-null', 'external');
        }
        if (item.parentId === item.id) invalid(`${path}.parentId: 势力不能关联自身`, path, `${path}.parentId`, 'non-self-id', 'self');
        if (!Array.isArray(item.relatedFactionIds)) invalid(`${path}.relatedFactionIds: expected array`, path, `${path}.relatedFactionIds`, 'array', actualType(item.relatedFactionIds));
        for (const id of item.relatedFactionIds) {
            if (!ids.has(id)) invalid(`${path}.relatedFactionIds: 外部关联势力不存在`, path, `${path}.relatedFactionIds`, 'internal-id', 'external');
            if (id === item.id || id === item.parentId || byId.get(id)?.parentId === item.id) {
                invalid(`${path}.relatedFactionIds: 禁止自指或直接父子外部关联`, path, `${path}.relatedFactionIds`, 'non-self-non-parent-child-id', id === item.id ? 'self' : 'parent-child');
            }
        }
    });
    // Cycles, limits and field values are checked by the established scope validator.
    return result;
};

// Validate before constructing local dynamics or invoking any normalizer. Dependencies
// are tracked separately from errors: an unavailable ID set is not an external ID.
const validateBatch = (value, scope) => {
    const details = [];
    let errors = 0;
    let unchecked = 0;
    let firstMessage;
    const record = item => item !== null && typeof item === 'object' && !Array.isArray(item);
    const report = (message, object, path, expected, actual) => {
        if (actual === 'unchecked') unchecked += 1;
        else { errors += 1; firstMessage ??= message; }
        if (details.length < 20) details.push(Object.freeze({ object, path, expected, actual }));
    };
    const skip = (object, path, expected) => report(null, object, path, expected, 'unchecked');
    const fields = (item, keys, path) => {
        try { exact(item, keys, path); return true; }
        catch (error) {
            if (error.code !== 'TT_BATCH_VALIDATION') throw error;
            const detail = error.details[0];
            report(error.message, detail.object, detail.path, detail.expected, detail.actual);
            return false;
        }
    };
    const list = (items, key, path) => {
        if (!Array.isArray(items)) {
            report(`${path}: 历史批增量必须为数组`, path, path, 'array', actualType(items));
            return { items: [], valid: false };
        }
        const ids = new Set();
        let valid = true;
        for (const [i, item] of items.entries()) {
            const id = item?.[key];
            if (typeof id !== 'string' || !id.trim() || id !== id.trim() || ids.has(id)) {
                report(`${path}.${key}: 历史批增量 ID 无效或重复`, `${path}[${i}]`, `${path}[${i}].${key}`, 'unique-id', ids.has(id) ? 'duplicate' : 'invalid-id');
                valid = false;
            }
            ids.add(id);
        }
        return { items, valid };
    };
    const merge = (previous, delta, path) => {
        fields(delta, ['upserts'], path);
        if (!record(delta) || !Object.hasOwn(delta, 'upserts')) {
            skip(`${path}.upserts`, `${path}.upserts`, 'array');
            return { items: [], valid: false };
        }
        const checked = list(delta?.upserts, 'id', `${path}.upserts`);
        if (!checked.valid) return checked;
        const items = [...previous];
        for (const item of checked.items) {
            const index = items.findIndex(prior => prior.id === item.id);
            if (index < 0) items.push(item); else items[index] = item;
        }
        return { items, valid: true };
    };
    fields(value, ['world', 'reputation', 'factions', 'dynamics', 'history'], '$');
    if (!record(value)) {
        for (const path of ['world', 'reputation', 'factions', 'dynamics', 'history']) skip(path, path, 'exact-fields');
        const error = new Error(firstMessage);
        error.code = 'TT_BATCH_VALIDATION';
        error.details = Object.freeze(details);
        throw error;
    }
    merge(scope.world.items, value?.world, 'world');
    merge(scope.reputation.circles, value?.reputation, 'reputation');
    if (value?.factions !== null) {
        const checked = Array.isArray(value?.factions) ? list(value.factions, 'id', 'factions') : merge(scope.factions, value?.factions, 'factions');
        const items = checked.items;
        const shapes = items.map((item, i) => fields(item, ['id', 'name', 'summary', 'parentId', 'relatedFactionIds', 'details', 'relation'], `factions[${i}]`));
        const ids = new Set(items.map(item => item?.id));
        const relationsReady = checked.valid && shapes.every(Boolean);
        if (!checked.valid) skip('factions', 'factions', 'complete-id-set');
        else if (scope.factions.some(prior => !ids.has(prior.id))) report('factions: 完整替换缺失旧 ID；拒绝删除', 'factions', 'factions', 'complete-id-set', 'missing');
        items.forEach((item, i) => {
            const path = `factions[${i}]`;
            if (!shapes[i]) {
                skip(path, `${path}.details`, 'array');
                skip(`${path}.relation`, `${path}.relation`, 'exact-fields');
            } else {
                if (!Array.isArray(item.details)) {
                    report(`${path}.details: expected array`, path, `${path}.details`, 'array', actualType(item.details));
                    skip(`${path}.details[0]`, `${path}.details[0]`, 'exact-fields');
                } else item.details.forEach((detail, k) => fields(detail, ['label', 'value'], `${path}.details[${k}]`));
                fields(item.relation, ['status', 'evaluation'], `${path}.relation`);
            }
            if (!relationsReady) {
                skip(path, `${path}.parentId`, 'internal-id-or-null');
                skip(path, `${path}.relatedFactionIds`, 'internal-id');
                return;
            }
            if (item.parentId !== null && (typeof item.parentId !== 'string' || !ids.has(item.parentId))) report(`${path}.parentId: 父势力不存在`, path, `${path}.parentId`, 'internal-id-or-null', 'external');
            if (item.parentId === item.id) report(`${path}.parentId: 势力不能关联自身`, path, `${path}.parentId`, 'non-self-id', 'self');
            if (!Array.isArray(item.relatedFactionIds)) report(`${path}.relatedFactionIds: expected array`, path, `${path}.relatedFactionIds`, 'array', actualType(item.relatedFactionIds));
            else for (const id of item.relatedFactionIds) {
                if (!ids.has(id)) report(`${path}.relatedFactionIds: 外部关联势力不存在`, path, `${path}.relatedFactionIds`, 'internal-id', 'external');
                if (id === item.id || id === item.parentId || items.find(other => other.id === id)?.parentId === item.id) report(`${path}.relatedFactionIds: 禁止自指或直接父子外部关联`, path, `${path}.relatedFactionIds`, 'non-self-non-parent-child-id', id === item.id ? 'self' : 'parent-child');
            }
        });
    }
    fields(value?.dynamics, ['create', 'appendStages', 'archive'], 'dynamics');
    fields(value?.history, ['events'], 'history');
    const childList = (parent, field, key, path) => {
        if (!record(parent) || !Object.hasOwn(parent, field)) {
            skip(path, path, 'array');
            return { items: [], valid: false };
        }
        return list(parent[field], key, path);
    };
    const create = childList(value.dynamics, 'create', 'id', 'dynamics.create');
    const append = childList(value.dynamics, 'appendStages', 'eventId', 'dynamics.appendStages');
    const archive = childList(value.dynamics, 'archive', 'eventId', 'dynamics.archive');
    const history = childList(value.history, 'events', 'eventId', 'history.events');
    const known = new Set([...scope.dynamics.active, ...scope.dynamics.archived].map(item => item.id));
    const active = new Set(scope.dynamics.active.map(item => item.id));
    let createReady = create.valid;
    const stage = (text, object, path) => {
        if (typeof text !== 'string' || !text.trim() || text.length > 240) report(`${path}: 阶段必须为非空字符串，最多240字`, object, path, 'non-empty-string-max-240', typeof text === 'string' ? 'out-of-range-length' : actualType(text));
    };
    create.items.forEach((item, i) => {
        const path = `dynamics.create[${i}]`;
        const shape = fields(item, ['id', 'type', 'title', 'stageLabel', 'origin', 'participants', 'initialStage', 'relatedEventIds'], path);
        if (!shape) { createReady = false; skip(path, `${path}.initialStage`, 'non-empty-string-max-240'); return; }
        if (known.has(item.id)) { report(`${path}.id: 不能重建既有事件`, path, `${path}.id`, 'new-id', 'duplicate'); createReady = false; }
        else if (create.valid) active.add(item.id);
        stage(item.initialStage, path, `${path}.initialStage`);
    });
    const reference = (item, path, ready) => {
        if (!ready || (!active.has(item.eventId) && !createReady)) skip(path, `${path}.eventId`, 'active-id');
        else if (!active.has(item.eventId)) report(`${path}.eventId: 只能指向 active`, path, `${path}.eventId`, 'active-id', 'external');
    };
    append.items.forEach((item, i) => {
        const path = `dynamics.appendStages[${i}]`;
        const shape = fields(item, ['eventId', 'stages'], path);
        reference(item, path, shape && append.valid);
        if (!shape) { skip(path, `${path}.stages`, 'non-empty-array'); return; }
        if (!Array.isArray(item.stages) || !item.stages.length) report(`${path}.stages: 阶段增量必须为非空字符串数组`, path, `${path}.stages`, 'non-empty-array', Array.isArray(item.stages) ? 'out-of-range-length' : actualType(item.stages));
        else item.stages.forEach((text, k) => stage(text, path, `${path}.stages[${k}]`));
    });
    archive.items.forEach((item, i) => {
        const path = `dynamics.archive[${i}]`;
        const shape = fields(item, ['eventId', 'outcome', 'finalResult'], path);
        if (!scope.dynamicsSettings.autoComplete || !scope.dynamicsSettings.archiveCompleted) report(`${path}: dynamicsSettings.autoComplete/archiveCompleted 不允许归档`, path, path, 'archive-enabled', 'boolean');
        reference(item, path, shape && archive.valid);
    });
    history.items.forEach((item, i) => {
        const path = `history.events[${i}]`;
        const shape = fields(item, ['eventId', 'daySummaries', 'periodSummaries'], path);
        reference(item, path, shape && history.valid);
    });
    if (errors) {
        const error = new Error(errors === 1 ? firstMessage : `历史批增量校验失败：${errors}处字段错误，${unchecked}处检查未执行`);
        error.code = 'TT_BATCH_VALIDATION';
        error.details = Object.freeze(details);
        throw error;
    }
};

// Transport only: never persisted. Existing facade/canonical schemas stay unchanged.
export function materializeTodayTrendBatchDelta(value, scope, timestamp) {
    validateBatch(value, scope);
    guardWorldCapacity(scope.world.items, value.world.upserts);
    exact(value, ['world', 'reputation', 'factions', 'dynamics', 'history']);
    exact(value.dynamics, ['create', 'appendStages', 'archive'], 'dynamics');
    exact(value.history, ['events'], 'history');
    unique(value.dynamics.create, 'id', 'dynamics.create');
    unique(value.dynamics.appendStages, 'eventId', 'dynamics.appendStages');
    unique(value.dynamics.archive, 'eventId', 'dynamics.archive');
    unique(value.history.events, 'eventId', 'history.events');
    const dynamics = structuredClone(scope.dynamics);
    const known = new Set([...dynamics.active, ...dynamics.archived].map(event => event.id));
    const producers = new Map();
    for (const [index, item] of value.history.events.entries()) {
        exact(item, ['eventId', 'daySummaries', 'periodSummaries'], `history.events[${index}]`);
        producers.set(item.eventId, { ...item, stages: [] });
    }
    const stagesFor = (id, stages, path, object, initial = false) => {
        if (!Array.isArray(stages) || !stages.length) invalid(`${path}: 阶段增量必须为非空字符串数组`, object, path, 'non-empty-array', Array.isArray(stages) ? 'out-of-range-length' : actualType(stages));
        stages.forEach((text, index) => {
            if (typeof text !== 'string' || !text.trim() || text.length > 240) {
                invalid(`${initial ? path : `${path}[${index}]`}: 阶段必须为非空字符串，最多240字`, object, initial ? path : `${path}[${index}]`, 'non-empty-string-max-240', typeof text === 'string' ? 'out-of-range-length' : actualType(text));
            }
        });
        const producer = producers.get(id) || { eventId: id, stages: [], daySummaries: [], periodSummaries: [] };
        producer.stages.push(...stages.map(text => ({ text, time: null, timeLabel: null })));
        producers.set(id, producer);
        return stages;
    };

    for (const [index, item] of value.dynamics.create.entries()) {
        const path = `dynamics.create[${index}]`;
        exact(item, ['id', 'type', 'title', 'stageLabel', 'origin', 'participants', 'initialStage', 'relatedEventIds'], path);
        if (known.has(item.id)) invalid(`${path}.id: 不能重建既有事件`, path, `${path}.id`, 'new-id', 'duplicate');
        known.add(item.id);
        const stages = stagesFor(item.id, [item.initialStage], `${path}.initialStage`, path, true);
        const { initialStage, ...fields } = item;
        dynamics.active.push({ ...fields, stages, latestStage: stages.at(-1), lifecycle: 'active',
            outcome: null, finalResult: null, createdAt: timestamp, updatedAt: timestamp });
    }
    for (const [index, item] of value.dynamics.appendStages.entries()) {
        const path = `dynamics.appendStages[${index}]`;
        exact(item, ['eventId', 'stages'], path);
        const event = dynamics.active.find(event => event.id === item.eventId);
        if (!event) invalid(`${path}.eventId: 只能指向 active`, path, `${path}.eventId`, 'active-id', 'external');
        event.stages.push(...stagesFor(item.eventId, item.stages, `${path}.stages`, path));
        event.latestStage = event.stages.at(-1);
        event.updatedAt = timestamp;
    }
    for (const [index, item] of value.dynamics.archive.entries()) {
        const path = `dynamics.archive[${index}]`;
        exact(item, ['eventId', 'outcome', 'finalResult'], path);
        if (!scope.dynamicsSettings.autoComplete || !scope.dynamicsSettings.archiveCompleted) {
            invalid(`${path}: dynamicsSettings.autoComplete/archiveCompleted 不允许归档`, path, path, 'archive-enabled', 'boolean');
        }
        if (!dynamics.active.some(event => event.id === item.eventId)) invalid(`${path}.eventId: 只能指向 active`, path, `${path}.eventId`, 'active-id', 'external');
    }
    const history = normalizeTodayTrendHistoryProducer({ events: [...producers.values()] });
    for (const [index, producer] of history.events.entries()) {
        const event = dynamics.active.find(event => event.id === producer.eventId);
        if (!event) invalid(`history.events[${index}].eventId: 只能指向 active`, `history.events[${index}]`, `history.events[${index}].eventId`, 'active-id', 'external');
        if (producer.stages.length) {
            event.stages.splice(-producer.stages.length, producer.stages.length, ...producer.stages.map(stage => stage.text));
            event.latestStage = event.stages.at(-1);
        }
    }
    return { parsed: { world: { items: upsert(scope.world.items, value.world, 'world') },
        reputation: { circles: upsert(scope.reputation.circles, value.reputation, 'reputation') },
        factions: factionsFor(scope.factions, value.factions), dynamics, history },
        archives: structuredClone(value.dynamics.archive) };
}
