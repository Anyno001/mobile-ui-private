const clone = value => structuredClone(value);
const record = value => value && typeof value === 'object' && !Array.isArray(value);
const fail = (code, message) => { const error = new Error(message); error.code = code; throw error; };
const exact = (value, keys, label) => {
    if (!record(value) || Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) {
        fail('TT_HISTORY_SCHEMA_INVALID', `${label}字段集合无效`);
    }
};
const text = (value, label, max = 240) => {
    if (typeof value !== 'string' || !value.trim() || value.length > max) fail('TT_HISTORY_SCHEMA_INVALID', `${label}无效`);
    return value.trim();
};
const nullableText = (value, label, max = 120) => value === null ? null : text(value, label, max);
const timePattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const nullableTime = (value, label) => {
    if (value !== null && (typeof value !== 'string' || !timePattern.test(value))) fail('TT_HISTORY_SCHEMA_INVALID', `${label} 必须是 HH:mm 或 null`);
    return value;
};
const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const validDate = value => typeof value === 'string' && datePattern.test(value)
    && Number.isFinite(new Date(`${value}T12:00:00Z`).getTime())
    && new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) === value;
const projectionText = stage => ['day-summary', 'period-summary', 'span-stage'].includes(stage.kind) ? stage.summary : stage.text;
const resolveLatestStage = event => event.stages.reduce((selected, stage) => !selected
    || stage.sourceStageEnd > selected.sourceStageEnd
    || (stage.sourceStageEnd === selected.sourceStageEnd && stage.sourceStageStart > selected.sourceStageStart)
    || (stage.sourceStageEnd === selected.sourceStageEnd && stage.sourceStageStart === selected.sourceStageStart && stage.id > selected.id)
    ? stage : selected, null);
const DETAIL_CAPACITY = 80;
const canonical = value => {
    if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
    if (value && typeof value === 'object') {
        return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
    }
    return JSON.stringify(value);
};
export function todayTrendCheckpointDigest(value) {
    const serialized = canonical(value);
    let hash = 2166136261;
    for (let index = 0; index < serialized.length; index += 1) {
        hash ^= serialized.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    return `fnv1a32:${(hash >>> 0).toString(16).padStart(8, '0')}:${serialized.length}`;
}
const availableState = (entityType, entityId, eventId) => ({
    entityType, entityId, eventId, state: 'available', removalReason: null, removedAtAssistantCount: null, policyRevision: 1,
});

function normalizeIdArray(value, label, max) {
    if (!Array.isArray(value) || value.length > max || value.some(item => typeof item !== 'string' || !item)) {
        fail('TT_HISTORY_SCHEMA_INVALID', `${label}无效`);
    }
    if (new Set(value).size !== value.length) fail('TT_HISTORY_SCHEMA_INVALID', `${label}不得重复`);
    return [...value];
}

function normalizeStage(value) {
    exact(value, ['text', 'time', 'timeLabel'], 'history stage');
    // Producer admission only; persisted canonical stages retain their legacy read limit.
    if (typeof value.text === 'string' && value.text.length > 240) {
        fail('TT_HISTORY_LIMIT_EXCEEDED', 'history stage.text 新阶段最多240字（UTF-16 code units），拒绝截断');
    }
    return { text: text(value.text, 'history stage.text', 240), time: nullableTime(value.time, 'history stage.time'),
        timeLabel: nullableText(value.timeLabel, 'history stage.timeLabel', 40) };
}

function normalizeDaySummary(value) {
    exact(value, ['summaryText', 'keyStages'], 'day summary producer');
    return { summaryText: text(value.summaryText, 'day summary producer.summaryText'),
        keyStages: normalizeIdArray(value.keyStages, 'day summary producer.keyStages', 8) };
}

function normalizePeriodSummary(value) {
    exact(value, ['summaryText', 'startDate', 'endDate', 'childSummaryRefs'], 'period summary producer');
    if (!validDate(value.startDate) || !validDate(value.endDate) || value.startDate > value.endDate) {
        fail('TT_HISTORY_SCHEMA_INVALID', 'period summary producer 日期区间无效');
    }
    const days = Math.floor((new Date(`${value.endDate}T12:00:00Z`) - new Date(`${value.startDate}T12:00:00Z`)) / 86400000) + 1;
    if (days > 7) fail('TT_HISTORY_LIMIT_EXCEEDED', 'period summary producer 跨度超过 7 日');
    return { summaryText: text(value.summaryText, 'period summary producer.summaryText'), startDate: value.startDate,
        endDate: value.endDate, childSummaryRefs: normalizeIdArray(value.childSummaryRefs, 'period summary producer.childSummaryRefs', 24) };
}


export function normalizeTodayTrendHistoryProducer(value) {
    exact(value, ['events'], 'history producer');
    if (!Array.isArray(value.events) || value.events.length > 80) fail('TT_HISTORY_SCHEMA_INVALID', 'history producer.events 无效');
    const ids = new Set();
    const events = value.events.map(item => {
        exact(item, ['eventId', 'stages', 'daySummaries', 'periodSummaries'], 'history event producer');
        const eventId = text(item.eventId, 'history event producer.eventId', 120);
        if (ids.has(eventId)) fail('TT_HISTORY_SCHEMA_INVALID', 'history producer eventId 不得重复');
        ids.add(eventId);
        if (!Array.isArray(item.stages) || !Array.isArray(item.daySummaries) || !Array.isArray(item.periodSummaries)) {
            fail('TT_HISTORY_SCHEMA_INVALID', 'history event producer 数组无效');
        }
        if (item.daySummaries.length > 1) fail('TT_HISTORY_LIMIT_EXCEEDED', '单个 event 每轮最多产出一个 day summary');
        return {
            eventId,
            stages: item.stages.map(normalizeStage),
            daySummaries: item.daySummaries.map(normalizeDaySummary),
            periodSummaries: item.periodSummaries.map(normalizePeriodSummary),
        };
    });
    return { events };
}

const allEvents = dynamics => [...dynamics.active, ...dynamics.archived];
const mapEvents = dynamics => new Map(allEvents(dynamics).map(event => [event.id, event]));
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);

function appendStageProjections(event, stages, storyDate, floor) {
    let sequence = event.stages.reduce((maximum, stage) => Math.max(maximum, stage.sourceStageEnd), 0);
    let undatedSequence = event.stages.reduce((maximum, stage) => Math.max(maximum,
        stage.kind === 'undated-stage' ? stage.undatedSequence : 0), 0);
    for (const stage of stages) {
        sequence += 1;
        event.stages.push(storyDate === null ? {
            id: `undated:${event.id}:${++undatedSequence}`, kind: 'undated-stage', storyDate: null,
            time: stage.time, timeLabel: stage.timeLabel, text: stage.text, undatedSequence,
            sourceStageStart: sequence, sourceStageEnd: sequence, sourceFloorStart: floor, sourceFloorEnd: floor, revision: 1,
        } : {
            id: `live:${event.id}:${sequence}`, kind: 'live-stage', storyDate,
            time: stage.time, timeLabel: stage.timeLabel, text: stage.text,
            sourceStageStart: sequence, sourceStageEnd: sequence, sourceFloorStart: floor, sourceFloorEnd: floor, revision: 1,
        });
    }
}


function closeLiveDate(event, storyDate, summary, payload, knownEventIds) {
    const indexes = event.stages.map((stage, index) => stage.kind === 'live-stage' && stage.storyDate === storyDate ? index : -1)
        .filter(index => index >= 0);
    if (!indexes.length) return false;
    if (!summary) fail('TT_HISTORY_SUMMARY_REQUIRED', '日期前进时缺少旧日期摘要');
    if (indexes.length > 8) fail('TT_HISTORY_LIMIT_EXCEEDED', 'day summary stages 超过 8');
    if (summary.keyStages.some(id => !knownEventIds.has(id))) {
        fail('TT_HISTORY_UNKNOWN_KEY_STAGE', 'day summary keyStages 指向未知 event ID');
    }
    const live = indexes.map(index => event.stages[index]);
    const times = live.map(stage => stage.time).filter(Boolean).sort();
    const labels = [...new Set(live.map(stage => stage.timeLabel).filter(Boolean))];
    const details = payload.stageDetailsByEvent[event.id] ? [...payload.stageDetailsByEvent[event.id]] : [];
    const detailRefs = [];
    for (const stage of live) {
        const id = `detail:${event.id}:${stage.sourceStageStart}`;
        const detail = { id, sourceStageSequence: stage.sourceStageStart, text: stage.text, storyDate };
        const existing = details.find(item => item.id === id);
        if (existing && !same(existing, detail)) fail('TT_HISTORY_SCHEMA_INVALID', 'stage detail 稳定 ID 内容冲突');
        if (!existing) details.push(detail);
        payload.removableEntityStateById[id] = availableState('detail', id, event.id);
        detailRefs.push(id);
    }
    const dayId = `day:${event.id}:${storyDate}`;
    const day = {
        id: dayId, kind: 'day-summary', status: 'closed', storyDate,
        timeRange: { start: times[0] || null, end: times.at(-1) || null, label: times.length ? null : labels.join('、') || null },
        summary: summary.summaryText, keyStages: summary.keyStages, detailRefs, detailCount: live.length,
        sourceStageStart: live[0].sourceStageStart, sourceStageEnd: live.at(-1).sourceStageEnd,
        sourceFloorStart: live[0].sourceFloorStart, sourceFloorEnd: live.at(-1).sourceFloorEnd, revision: 1,
    };
    const first = indexes[0], indexSet = new Set(indexes);
    event.stages = event.stages.flatMap((stage, index) => index === first ? [day] : indexSet.has(index) ? [] : [stage]);
    payload.stageDetailsByEvent[event.id] = details.sort((a, b) => a.sourceStageSequence - b.sourceStageSequence || a.id.localeCompare(b.id));
    payload.removableEntityStateById[dayId] = availableState('day-summary', dayId, event.id);
    return true;
}

function governDetailCapacity(event, payload, assistantCount) {
    const details = payload.stageDetailsByEvent[event.id] || [];
    if (details.length <= DETAIL_CAPACITY) return false;
    const detailsByDate = new Map();
    for (const detail of details) {
        if (!validDate(detail.storyDate)) continue;
        const group = detailsByDate.get(detail.storyDate) || [];
        group.push(detail);
        detailsByDate.set(detail.storyDate, group);
    }
    const openStoryDates = new Set(event.stages.filter(stage => stage.kind === 'live-stage').map(stage => stage.storyDate));
    const summariesByDate = new Map(event.stages.filter(stage => stage.kind === 'day-summary' && stage.status === 'closed')
        .map(stage => [stage.storyDate, stage]));
    const groups = [...detailsByDate.entries()].sort(([left], [right]) => left.localeCompare(right)).flatMap(([storyDate, group]) => {
        if (openStoryDates.has(storyDate)) return [];
        const summary = summariesByDate.get(storyDate);
        if (!summary) return [];
        const refs = new Set(summary.detailRefs);
        if (group.some(detail => !refs.has(detail.id))) return [];
        return [{ storyDate, details: [...group].sort((left, right) =>
            left.sourceStageSequence - right.sourceStageSequence || left.id.localeCompare(right.id)) }];
    });
    let requiredSlots = details.length - DETAIL_CAPACITY;
    const removedDetails = [];
    for (const group of groups) {
        removedDetails.push(...group.details);
        requiredSlots -= group.details.length;
        if (requiredSlots <= 0) break;
    }
    if (requiredSlots > 0) {
        fail('TT_DETAIL_CAPACITY_NO_SAFE_GROUP', `event ${event.id} 没有足够的已摘要完整日期可安全清理`);
    }
    const removedAtAssistantCount = Number.isSafeInteger(assistantCount) && assistantCount >= 0 ? assistantCount : null;
    const removedIds = new Set(removedDetails.map(detail => detail.id));
    for (const detail of removedDetails) {
        const state = payload.removableEntityStateById[detail.id];
        if (!state || state.state !== 'available' || state.entityType !== 'detail' || state.eventId !== event.id) {
            fail('TT_HISTORY_SCHEMA_INVALID', 'detail capacity lifecycle 无效');
        }
        const removed = {
            ...state, state: 'removed', removalReason: 'detail-pool-capacity', removedAtAssistantCount,
        };
        payload.removableEntityStateById[detail.id] = removed;
        payload.removableEntityTombstonesById[detail.id] = clone(removed);
    }
    const retained = details.filter(detail => !removedIds.has(detail.id));
    if (retained.length > DETAIL_CAPACITY) fail('TT_DETAIL_CAPACITY_NO_SAFE_GROUP', `event ${event.id} detail 容量治理失败`);
    if (retained.length) payload.stageDetailsByEvent[event.id] = retained;
    else delete payload.stageDetailsByEvent[event.id];
    return true;
}

function latestKnownDate(event) {
    const dates = event.stages.flatMap(stage => {
        if (stage.kind === 'live-stage' || stage.kind === 'day-summary') return [stage.storyDate];
        if (stage.kind === 'period-summary' || stage.kind === 'span-stage') return [stage.endDate];
        return [];
    });
    return dates.sort().at(-1) || null;
}

function openLiveDate(event) {
    const dates = [...new Set(event.stages.filter(stage => stage.kind === 'live-stage').map(stage => stage.storyDate))];
    if (dates.length > 1) fail('TT_DATE_CONFLICT', 'event 同时存在多个开放日期');
    return dates[0] || null;
}

function assertStageAlignment(previousEvent, candidateEvent, producerStages) {
    const previousText = previousEvent ? previousEvent.stages.map(projectionText) : [];
    const candidateText = candidateEvent.stages.map(projectionText);
    if (candidateText.length !== previousText.length + producerStages.length
        || previousText.some((value, index) => candidateText[index] !== value)
        || producerStages.some((stage, index) => candidateText[previousText.length + index] !== stage.text)) {
        fail('TT_HISTORY_STAGE_MISMATCH', 'history producer 与 dynamics stage 追加不一致');
    }
}

const periodBoundary = stage => stage.kind === 'day-summary' ? {
    startDate: stage.storyDate, startTime: stage.timeRange.start,
    endDate: stage.storyDate, endTime: stage.timeRange.end,
} : {
    startDate: stage.startDate, startTime: stage.startTime,
    endDate: stage.endDate, endTime: stage.endTime,
};
const periodChildRefs = stage => stage.kind === 'day-summary' ? [stage.id] : stage.childSummaryRefs;
const periodChildCount = stage => stage.kind === 'day-summary' ? 1 : stage.childSummaryCount;
const periodDetailCount = stage => stage.kind === 'day-summary' ? stage.detailCount : stage.historicalDetailCount;
const daySpan = (startDate, endDate) => Math.floor((new Date(`${endDate}T12:00:00Z`)
    - new Date(`${startDate}T12:00:00Z`)) / 86400000) + 1;

function periodCandidate(stages, start, end) {
    const children = stages.slice(start, end + 1);
    if (children.length < 2 || children.some(stage => !['day-summary', 'period-summary'].includes(stage.kind))) return null;
    for (let index = 1; index < children.length; index += 1) {
        if (children[index].sourceStageStart !== children[index - 1].sourceStageEnd + 1) return null;
    }
    const first = periodBoundary(children[0]);
    const last = periodBoundary(children.at(-1));
    if (daySpan(first.startDate, last.endDate) > 7) return null;
    const childSummaryRefs = children.flatMap(periodChildRefs);
    if (childSummaryRefs.length > 24 || new Set(childSummaryRefs).size !== childSummaryRefs.length) return null;
    if ((first.startTime === null) !== (last.endTime === null)) return null;
    return {
        start, end, children, childSummaryRefs, startDate: first.startDate, startTime: first.startTime,
        endDate: last.endDate, endTime: last.endTime, gain: children.length - 1,
        childSummaryCount: children.reduce((count, stage) => count + periodChildCount(stage), 0),
        historicalDetailCount: children.reduce((count, stage) => count + periodDetailCount(stage), 0),
        sourceStageStart: children[0].sourceStageStart, sourceStageEnd: children.at(-1).sourceStageEnd,
        sortId: children.map(stage => stage.id).join('\u0000'),
    };
}

function periodCandidates(stages) {
    const result = [];
    // StageProjection schema caps admission at 40, so this exhaustive O(n²) enumeration is strictly bounded.
    for (let start = 0; start < stages.length - 1; start += 1) {
        for (let end = start + 1; end < stages.length; end += 1) {
            const candidate = periodCandidate(stages, start, end);
            if (candidate) result.push(candidate);
            else if (!['day-summary', 'period-summary'].includes(stages[end].kind)) break;
        }
    }
    return result;
}

function exactAiPeriod(candidate, summaries) {
    return summaries.find(summary => summary.startDate === candidate.startDate
        && summary.endDate === candidate.endDate && same(summary.childSummaryRefs, candidate.childSummaryRefs)) || null;
}

function reusableSummary(candidate) {
    const combined = candidate.children.map(stage => stage.summary).join('\n---\n');
    return combined.length <= 240 ? combined : null;
}

function choosePeriodCandidate(event, summaries, requiredGain, optional) {
    const candidates = periodCandidates(event.stages).map(candidate => ({
        ...candidate, ai: exactAiPeriod(candidate, summaries), fallback: optional ? null : reusableSummary(candidate),
    })).filter(candidate => candidate.ai || candidate.fallback);
    if (optional) {
        const matched = candidates.filter(candidate => candidate.ai);
        if (!matched.length) return null;
        candidates.length = 0;
        candidates.push(...matched);
    }
    candidates.sort((left, right) => {
        const start = left.sourceStageStart - right.sourceStageStart;
        if (start) return start;
        const leftSatisfies = left.gain >= requiredGain;
        const rightSatisfies = right.gain >= requiredGain;
        if (leftSatisfies !== rightSatisfies) return leftSatisfies ? -1 : 1;
        if (leftSatisfies) {
            const projectionChildCount = left.children.length - right.children.length;
            if (projectionChildCount) return projectionChildCount;
        }
        return left.sourceStageEnd - right.sourceStageEnd || left.sortId.localeCompare(right.sortId);
    });
    return candidates[0] || null;
}

function compactPeriod(event, payload, candidate, periodSequence, assistantCount) {
    const removedAtAssistantCount = Number.isSafeInteger(assistantCount) && assistantCount >= 0 ? assistantCount : null;
    for (const stage of candidate.children) {
        if (stage.kind !== 'day-summary') continue;
        const state = payload.removableEntityStateById[stage.id];
        if (!state || state.state !== 'available' || state.entityType !== 'day-summary' || state.eventId !== event.id) {
            fail('TT_HISTORY_SCHEMA_INVALID', 'period compaction day-summary lifecycle 无效');
        }
        const removed = {
            ...state, state: 'removed', removalReason: 'period-compaction', removedAtAssistantCount,
        };
        payload.removableEntityStateById[stage.id] = removed;
        payload.removableEntityTombstonesById[stage.id] = clone(removed);
    }
    const period = {
        id: `period:${event.id}:${periodSequence}`, kind: 'period-summary', periodSequence,
        startDate: candidate.startDate, startTime: candidate.startTime, endDate: candidate.endDate, endTime: candidate.endTime,
        summary: candidate.ai?.summaryText || candidate.fallback, childSummaryRefs: candidate.childSummaryRefs,
        childSummaryCount: candidate.childSummaryCount, historicalDetailCount: candidate.historicalDetailCount,
        sourceStageStart: candidate.sourceStageStart, sourceStageEnd: candidate.sourceStageEnd, revision: 1,
    };
    event.stages.splice(candidate.start, candidate.children.length, period);
}

function planPeriodCompaction(event, payload, summaries, assistantCount) {
    let periodSequence = event.stages.reduce((maximum, stage) => Math.max(maximum,
        stage.kind === 'period-summary' ? stage.periodSequence : 0), 0) + 1;
    if (event.stages.length >= 36 && event.stages.length <= 38) {
        const candidate = choosePeriodCandidate(event, summaries, 1, true);
        if (candidate) compactPeriod(event, payload, candidate, periodSequence++, assistantCount);
    }
    while (event.stages.length >= 40) {
        const candidate = choosePeriodCandidate(event, summaries, event.stages.length - 39, false);
        if (!candidate) fail('TT_CAPACITY_NO_COMPACTION_CANDIDATE', `event ${event.id} 无可安全折叠历史`);
        compactPeriod(event, payload, candidate, periodSequence++, assistantCount);
    }
}

export function applyTodayTrendHistoryProducer(payloadValue, producerValue, {
    trustedStoryDate = null, assistantCount = null, previousPayload = null,
} = {}) {
    if (trustedStoryDate !== null && !validDate(trustedStoryDate)) fail('TT_DATE_CONFLICT', '可信 storyDate 格式无效');
    const payload = clone(payloadValue);
    let detailPoolChanged = false;
    const producer = normalizeTodayTrendHistoryProducer(producerValue);
    const candidates = mapEvents(payload.dynamics);
    const previous = previousPayload ? mapEvents(previousPayload.dynamics) : new Map();
    const producedIds = new Set(producer.events.map(item => item.eventId));
    const knownEventIds = new Set(candidates.keys());
    for (const event of candidates.values()) {
        const prior = previous.get(event.id);
        const priorText = prior ? prior.stages.map(projectionText) : [];
        const candidateText = event.stages.map(projectionText);
        const historyChanged = candidateText.length !== priorText.length
            || priorText.some((value, index) => candidateText[index] !== value);
        if (historyChanged && !producedIds.has(event.id)) {
            fail('TT_HISTORY_STAGE_MISMATCH', 'dynamics stage 变化缺少对应 history producer');
        }
    }
    for (const item of producer.events) {
        const event = candidates.get(item.eventId);
        if (!event || event.lifecycle !== 'active') fail('TT_HISTORY_UNKNOWN_EVENT', 'history producer 只能指向当前 active event');
        assertStageAlignment(previous.get(item.eventId) || null, event, item.stages);
    }
    const effectiveDaySummariesByEventId = new Map();
    let effectiveDaySummaryCount = 0;
    const periodSummaryCount = producer.events.reduce((count, item) => count + item.periodSummaries.length, 0);
    for (const item of producer.events) {
        const event = candidates.get(item.eventId);
        if (!event || event.lifecycle !== 'active') fail('TT_HISTORY_UNKNOWN_EVENT', 'history producer 只能指向当前 active event');
        const prior = previous.get(item.eventId) || null;
        const historicalEvent = prior ? clone(prior) : clone(event);
        historicalEvent.stages = prior ? clone(prior.stages) : [];
        const knownDate = latestKnownDate(historicalEvent);
        const openDate = openLiveDate(historicalEvent);
        if (trustedStoryDate !== null && knownDate !== null && trustedStoryDate < knownDate) {
            fail('TT_DATE_REGRESSION', '可信 storyDate 早于 event 历史日期');
        }
        const requiresSummary = trustedStoryDate !== null && openDate !== null && trustedStoryDate > openDate;
        if (requiresSummary && item.daySummaries.length !== 1) {
            fail('TT_DATE_CONFLICT', '日期前进必须恰好提供一个 day summary');
        }
        const effectiveDaySummaries = requiresSummary ? item.daySummaries : [];
        effectiveDaySummariesByEventId.set(item.eventId, effectiveDaySummaries);
        effectiveDaySummaryCount += effectiveDaySummaries.length;
    }
    if (periodSummaryCount > Math.floor(effectiveDaySummaryCount / 3)) {
        fail('TT_HISTORY_LIMIT_EXCEEDED', 'period summaries 超过有效 day summaries / 3');
    }
    for (const item of producer.events) {
        const event = candidates.get(item.eventId);
        if (!event || event.lifecycle !== 'active') fail('TT_HISTORY_UNKNOWN_EVENT', 'history producer 只能指向当前 active event');
        const prior = previous.get(item.eventId) || null;
        if (prior && previousPayload) {
            const oldDetails = previousPayload.stageDetailsByEvent?.[item.eventId];
            if (oldDetails) payload.stageDetailsByEvent[item.eventId] = clone(oldDetails);
            for (const field of ['removableEntityStateById', 'removableEntityTombstonesById']) {
                const source = previousPayload[field] || {};
                const target = payload[field];
                for (const [id, state] of Object.entries(source)) {
                    if (state.eventId === item.eventId) target[id] = clone(state);
                }
            }
        }
        event.stages = prior ? clone(prior.stages) : [];
        const openDate = openLiveDate(event);
        const requiresSummary = trustedStoryDate !== null && openDate !== null && trustedStoryDate > openDate;
        // A day summary cannot close a same-day or absent live-stage.  It is transient
        // model output, not persisted history, so discard it rather than rejecting an
        // otherwise append-only update that can be applied safely.
        const effectiveDaySummaries = effectiveDaySummariesByEventId.get(item.eventId);
        if (requiresSummary) detailPoolChanged = closeLiveDate(event, openDate, effectiveDaySummaries[0], payload, knownEventIds) || detailPoolChanged;
        appendStageProjections(event, item.stages, trustedStoryDate, Number.isSafeInteger(assistantCount) ? assistantCount : null);
        if (!event.stages.length) fail('TT_HISTORY_SCHEMA_INVALID', 'history producer 不得产生空 event 历史');
        planPeriodCompaction(event, payload, item.periodSummaries, assistantCount);
        event.latestStage = projectionText(resolveLatestStage(event));
        event.capacityCompatibilityPending = event.stages.length === 40;
    }
    for (const event of payload.dynamics.active) {
        detailPoolChanged = governDetailCapacity(event, payload, assistantCount) || detailPoolChanged;
    }
    if (detailPoolChanged) {
        payload.historyRetentionState.detailPoolRevision += 1;
    }
    return payload;
}

function snapshotDetailManifestRefs(payload, visibleFromAssistantCount, storeRevision) {
    const result = [];
    const manifestRevision = Math.max(1, storeRevision);
    for (const event of allEvents(payload.dynamics)) {
        const availableDetailIds = new Set((payload.stageDetailsByEvent[event.id] || [])
            .filter(detail => payload.removableEntityStateById[detail.id]?.state === 'available')
            .map(detail => detail.id));
        const summaries = event.lifecycle === 'archived'
            ? Object.values(payload.archivedRemovableDataByEvent[event.id]?.daySummariesById || {})
            : event.stages.filter(stage => stage.kind === 'day-summary');
        const detailRefs = [...new Set(summaries
            .flatMap(summary => summary.detailRefs || []).filter(id => availableDetailIds.has(id)))].sort();
        if (!detailRefs.length) continue;
        const container = payload.archivedRemovableDataByEvent[event.id] || {
            daySummariesById: {}, manifestsById: {},
        };
        payload.archivedRemovableDataByEvent[event.id] = container;
        const existingManifestId = Object.keys(container.manifestsById).sort().find(id => {
            const state = payload.removableEntityStateById[id];
            return state?.state === 'available' && state.entityType === 'manifest' && state.eventId === event.id;
        });
        const manifestId = existingManifestId || `manifest:${event.id}:${manifestRevision}`;
        if (!existingManifestId) {
            container.manifestsById[manifestId] = { id: manifestId };
            payload.removableEntityStateById[manifestId] = {
                entityType: 'manifest', entityId: manifestId, eventId: event.id, state: 'available',
                removalReason: null, removedAtAssistantCount: null,
                policyRevision: payload.historyRetentionState.retentionPolicyRevision,
            };
        }
        result.push({ eventId: event.id, manifestId, detailRefs, visibleFromAssistantCount });
    }
    return result;
}

const checkpointValueRef = (value, entityStore) => {
    if (value === null || typeof value !== 'object') return { value };
    const entity = Array.isArray(value)
        ? { kind: 'array', items: value.map(item => checkpointValueRef(item, entityStore)) }
        : { kind: 'object', entries: Object.keys(value).sort().map(key => [key, checkpointValueRef(value[key], entityStore)]) };
    const entityId = todayTrendCheckpointDigest(entity);
    const existing = entityStore[entityId];
    if (existing && canonical(existing) !== canonical(entity)) {
        fail('TT_CANONICAL_CHECKPOINT_INTEGRITY', `checkpoint entity ${entityId} 内容冲突`);
    }
    entityStore[entityId] = entity;
    return { entityId };
};

export function storeTodayTrendCheckpoint(checkpointValue, entityStoreValue = {}) {
    const checkpoint = clone(checkpointValue);
    const entityStore = clone(entityStoreValue);
    if (!record(entityStore)) fail('TT_CANONICAL_CHECKPOINT_INTEGRITY', 'checkpoint entity store 无效');
    const root = checkpointValueRef(checkpoint, entityStore);
    return {
        entityStore,
        checkpointRef: { rootEntityId: root.entityId, payloadDigest: todayTrendCheckpointDigest(checkpoint) },
    };
}

const checkpointEntityRefs = entity => entity.kind === 'array'
    ? entity.items : entity.kind === 'object' ? entity.entries.map(([, ref]) => ref) : [];

export function materializeTodayTrendCheckpoint(checkpointRef, entityStoreValue) {
    if (!record(checkpointRef) || Object.keys(checkpointRef).length !== 2
        || typeof checkpointRef.rootEntityId !== 'string' || typeof checkpointRef.payloadDigest !== 'string'
        || !record(entityStoreValue)) {
        fail('TT_CANONICAL_CHECKPOINT_INCOMPLETE', 'checkpoint restore manifest/ref 无效');
    }
    const visiting = new Set();
    const materializeRef = ref => {
        if (!record(ref) || Object.keys(ref).length !== 1) fail('TT_CANONICAL_CHECKPOINT_INTEGRITY', 'checkpoint entity ref 无效');
        if (Object.hasOwn(ref, 'value')) return clone(ref.value);
        if (typeof ref.entityId !== 'string') fail('TT_CANONICAL_CHECKPOINT_INTEGRITY', 'checkpoint entity ID 无效');
        const entity = entityStoreValue[ref.entityId];
        if (!record(entity) || todayTrendCheckpointDigest(entity) !== ref.entityId || visiting.has(ref.entityId)) {
            fail('TT_CANONICAL_CHECKPOINT_INTEGRITY', `checkpoint entity ${ref.entityId} 完整性校验失败`);
        }
        visiting.add(ref.entityId);
        let value;
        if (entity.kind === 'array' && Array.isArray(entity.items)) value = entity.items.map(materializeRef);
        else if (entity.kind === 'object' && Array.isArray(entity.entries)) {
            value = {};
            for (const entry of entity.entries) {
                if (!Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== 'string' || Object.hasOwn(value, entry[0])) {
                    fail('TT_CANONICAL_CHECKPOINT_INTEGRITY', `checkpoint entity ${ref.entityId} object manifest 无效`);
                }
                value[entry[0]] = materializeRef(entry[1]);
            }
        } else fail('TT_CANONICAL_CHECKPOINT_INTEGRITY', `checkpoint entity ${ref.entityId} 类型无效`);
        visiting.delete(ref.entityId);
        return value;
    };
    const payload = materializeRef({ entityId: checkpointRef.rootEntityId });
    if (todayTrendCheckpointDigest(payload) !== checkpointRef.payloadDigest) {
        fail('TT_CANONICAL_CHECKPOINT_INTEGRITY', 'checkpoint materialized payload 摘要不一致');
    }
    return payload;
}

export function gcTodayTrendCheckpointEntityStore(payloadValue) {
    const payload = clone(payloadValue);
    const store = record(payload.checkpointEntityStore) ? payload.checkpointEntityStore : {};
    const reachable = new Set();
    const visit = entityId => {
        if (reachable.has(entityId)) return;
        const entity = store[entityId];
        if (!record(entity) || todayTrendCheckpointDigest(entity) !== entityId) {
            fail('TT_CANONICAL_CHECKPOINT_INTEGRITY', `checkpoint entity ${entityId} 完整性校验失败`);
        }
        reachable.add(entityId);
        for (const ref of checkpointEntityRefs(entity)) if (record(ref) && typeof ref.entityId === 'string') visit(ref.entityId);
    };
    for (const snapshot of payload.generationSnapshots || []) {
        if (snapshot.restoreCapability === 'full' && record(snapshot.checkpointRef)) visit(snapshot.checkpointRef.rootEntityId);
    }
    payload.checkpointEntityStore = Object.fromEntries([...reachable].sort().map(id => [id, store[id]]));
    return payload;
}

function snapshotFromPayload(payload, assistantCount, generatedAt, storeRevision, rerollFromAssistantCount = null) {
    const detailManifestRefs = snapshotDetailManifestRefs(payload, assistantCount, storeRevision);
    const checkpoint = clone(payload);
    delete checkpoint.generationSnapshots;
    delete checkpoint.commitJournal;
    delete checkpoint.checkpointEntityStore;
    const stored = storeTodayTrendCheckpoint(checkpoint, payload.checkpointEntityStore);
    payload.checkpointEntityStore = stored.entityStore;
    return {
        assistantCount, generatedAt, storeRevision,
        detailPoolRevision: payload.historyRetentionState.detailPoolRevision,
        visibleFromAssistantCount: assistantCount,
        detailManifestRefs,
        retentionPolicyRevision: payload.historyRetentionState.retentionPolicyRevision,
        restoreCapability: 'full',
        rerollFromAssistantCount,
        checkpointRef: stored.checkpointRef,
        world: clone(payload.world), reputation: clone(payload.reputation), factions: clone(payload.factions),
        dynamicsSettings: clone(payload.dynamicsSettings), dynamics: clone(payload.dynamics),
    };
}

export function appendTodayTrendCanonicalSnapshot(payloadValue, assistantCount, generatedAt, storeRevision = 0, {
    rerollFromAssistantCount = null,
} = {}) {
    const payload = clone(payloadValue);
    if (!record(payload.checkpointEntityStore)) payload.checkpointEntityStore = {};
    const floor = Number.isSafeInteger(assistantCount) && assistantCount >= 0 ? assistantCount : 0;
    const timestamp = Number.isFinite(generatedAt) && generatedAt >= 0 ? Math.floor(generatedAt) : 0;
    const revision = Number.isSafeInteger(storeRevision) && storeRevision >= 0 ? storeRevision : 0;
    if (rerollFromAssistantCount !== null && (!Number.isSafeInteger(rerollFromAssistantCount)
        || rerollFromAssistantCount < 0 || rerollFromAssistantCount >= floor)) {
        fail('TT_REROLL_CHECKPOINT_INVALID', 'reroll 基线必须是当前楼层之前的有效 checkpoint');
    }
    const snapshots = [...payload.generationSnapshots.filter(item => item.assistantCount !== floor),
        snapshotFromPayload(payload, floor, timestamp, revision, rerollFromAssistantCount)]
        .sort((left, right) => left.assistantCount - right.assistantCount);
    const baseline = snapshots.find(item => item.assistantCount === 0);
    payload.generationSnapshots = baseline
        ? [baseline, ...snapshots.filter(item => item.assistantCount !== 0).slice(-11)]
        : snapshots.slice(-12);
    return gcTodayTrendCheckpointEntityStore(payload);
}

export function rollbackTodayTrendCanonicalPayload(payloadValue, assistantCount) {
    const payload = clone(payloadValue);
    const floor = Number.isSafeInteger(assistantCount) && assistantCount >= 0 ? assistantCount : 0;
    const snapshot = payload.generationSnapshots.reduce((latest, item) => item.assistantCount <= floor
        && (!latest || item.assistantCount > latest.assistantCount) ? item : latest, null);
    if (!snapshot) {
        fail('TT_ROLLBACK_CHECKPOINT_MISSING', `canonical scope 缺少不晚于楼层 ${floor} 的 checkpoint`);
    }
    if (snapshot.restoreCapability !== 'full' || !record(snapshot.checkpointRef)) {
        fail('TT_CANONICAL_CHECKPOINT_INCOMPLETE',
            `canonical snapshot ${snapshot.assistantCount} 缺少完整 checkpoint，拒绝伪造历史状态`);
    }
    const checkpoint = materializeTodayTrendCheckpoint(snapshot.checkpointRef, payload.checkpointEntityStore);
    return gcTodayTrendCheckpointEntityStore({
        ...checkpoint,
        generationSnapshots: payload.generationSnapshots.filter(item => item.assistantCount <= snapshot.assistantCount),
        checkpointEntityStore: clone(payload.checkpointEntityStore),
        commitJournal: null,
    });
}
