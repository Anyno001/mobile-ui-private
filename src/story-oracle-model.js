export const STORY_ORACLE_STORE_VERSION = 1;
export const STORY_ORACLE_MODE = 'question';
export const STORY_ORACLE_MODES = Object.freeze(['question', 'advisor']);
export const STORY_ORACLE_HISTORY_MODES = Object.freeze(['question', 'lorebook', 'advisor']);
export const STORY_ORACLE_LIMITS = Object.freeze({
    messages: 60,
    messageChars: 12000,
    totalChars: 120000,
    plans: 100,
    planChars: 4000,
    planSeedChars: 2400,
    planWhyChars: 2400,
    planPaceChars: 120,
    selectionBooks: 64,
    bookNameChars: 120,
});
export const STORY_ORACLE_PLAN_LIMITS = Object.freeze({ parsed: 12, enabled: 5, injectionChars: 18000 });

const plainObject = value => value && typeof value === 'object' && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null) ? value : null;
const text = (value, max) => typeof value === 'string' ? value.trim().slice(0, max) : '';
const stringArray = (value, maxItems, maxChars) => {
    const result = [], seen = new Set();
    for (const item of Array.isArray(value) ? value : []) {
        const valueText = text(item, maxChars);
        if (!valueText || seen.has(valueText)) continue;
        seen.add(valueText);
        result.push(valueText);
        if (result.length >= maxItems) break;
    }
    return result;
};
const stableHash = value => {
    let hash = 2166136261;
    for (const char of String(value || '')) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
    return (hash >>> 0).toString(36);
};
const selectionScopeKey = books => stringArray(books, STORY_ORACLE_LIMITS.selectionBooks, STORY_ORACLE_LIMITS.bookNameChars).sort().join('\u0000');

export function storyOracleMessageId(message) {
    const source = plainObject(message);
    if (!source) return '';
    const createdAt = Number.isFinite(source.createdAt) ? Math.max(1, Math.trunc(source.createdAt)) : 0;
    return `msg-${createdAt}-${stableHash(source.content)}`;
}

export function createEmptyStoryOracleStore() {
    return { version: STORY_ORACLE_STORE_VERSION, scopes: {} };
}

function normalizeSelection(value) {
    const source = plainObject(value);
    if (!source || !Array.isArray(source.books)) return null;
    const books = stringArray(source.books, STORY_ORACLE_LIMITS.selectionBooks, STORY_ORACLE_LIMITS.bookNameChars);
    return { books, scopeKey: text(source.scopeKey, 800) || selectionScopeKey(books), updatedAt: Number.isFinite(source.updatedAt) ? Math.max(0, Math.trunc(source.updatedAt)) : 0 };
}

function normalizeMessage(value) {
    const source = plainObject(value);
    if (!source || !['user', 'assistant'].includes(source.role)) return null;
    const content = text(source.content, STORY_ORACLE_LIMITS.messageChars);
    if (!content) return null;
    const createdAt = Number.isFinite(source.createdAt) ? Math.max(0, Math.trunc(source.createdAt)) : 0;
    return { role: source.role, content, createdAt };
}

function normalizePlan(value, index = 0) {
    const source = plainObject(value);
    if (!source) return null;
    const goal = text(source.goal, STORY_ORACLE_LIMITS.planChars) || text(source.title || source.name, STORY_ORACLE_LIMITS.planChars);
    if (!goal) return null;
    const title = text(source.title, STORY_ORACLE_LIMITS.planChars);
    const seed = text(source.seed || source.description || source.plan, STORY_ORACLE_LIMITS.planSeedChars);
    const why = text(source.why || source.reason, STORY_ORACLE_LIMITS.planWhyChars);
    const pace = text(source.pace || source.speed || source.progressSpeed, STORY_ORACLE_LIMITS.planPaceChars);
    const createdAt = Number.isFinite(source.createdAt) ? Math.max(0, Math.trunc(source.createdAt)) : 0;
    const sourceMessageId = text(source.sourceMessageId, 180);
    const baseId = text(source.id, 180) || `plan-${stableHash(`${goal}\u0000${seed}\u0000${why}`)}-${index}`;
    return {
        id: baseId, title, goal, seed, why, pace, sourceMessageId,
        selectionKey: text(source.selectionKey, 800),
        createdAt, order: Number.isFinite(source.order) ? Math.trunc(source.order) : index,
        enabled: source.enabled === true,
    };
}

function normalizePlans(value) {
    const result = [], seenIds = new Set();
    for (const [index, item] of (Array.isArray(value) ? value : []).entries()) {
        const plan = normalizePlan(item, index);
        if (!plan) continue;
        let id = plan.id, suffix = 1;
        while (seenIds.has(id)) id = `${plan.id}-${suffix++}`;
        plan.id = id;
        seenIds.add(id);
        result.push(plan);
        if (result.length >= STORY_ORACLE_LIMITS.plans) break;
    }
    return result.sort((a, b) => a.order - b.order || a.createdAt - b.createdAt || a.id.localeCompare(b.id));
}

export function normalizeStoryOracleStore(value) {
    const source = plainObject(value);
    const result = createEmptyStoryOracleStore();
    if (!source) return result;
    for (const [storageId, scope] of Object.entries(plainObject(source.scopes) || {})) {
        if (!storageId || storageId.length > 160) continue;
        const modes = {};
        for (const mode of STORY_ORACLE_HISTORY_MODES) {
            const messages = (Array.isArray(scope?.modes?.[mode]) ? scope.modes[mode] : [])
                .map(normalizeMessage).filter(Boolean).slice(-STORY_ORACLE_LIMITS.messages);
            let total = 0;
            const bounded = messages.filter(message => {
                if (total + message.content.length > STORY_ORACLE_LIMITS.totalChars) return false;
                total += message.content.length;
                return true;
            });
            if (bounded.length) modes[mode] = bounded;
        }
        const selections = normalizeSelection(scope?.selections || scope?.selection);
        const plans = normalizePlans(scope?.plans);
        if (Object.keys(modes).length || selections || plans.length) {
            result.scopes[storageId] = { modes };
            if (selections) result.scopes[storageId].selections = selections;
            if (plans.length) result.scopes[storageId].plans = plans;
        }
    }
    return result;
}

export function storyOracleMessages(store, storageId, mode = STORY_ORACLE_MODE) {
    const normalized = normalizeStoryOracleStore(store);
    const targetMode = STORY_ORACLE_HISTORY_MODES.includes(mode) ? mode : STORY_ORACLE_MODE;
    return normalized.scopes[String(storageId || '').trim()]?.modes?.[targetMode] || [];
}

export function storyOracleWorldBookSelection(store, storageId, availableNames = null) {
    const normalized = normalizeStoryOracleStore(store);
    const selection = normalized.scopes[String(storageId || '').trim()]?.selections;
    if (!selection) return null;
    const available = availableNames === null ? null : new Set(stringArray(availableNames, STORY_ORACLE_LIMITS.selectionBooks, STORY_ORACLE_LIMITS.bookNameChars));
    return { ...selection, books: selection.books.filter(name => !available || available.has(name)) };
}

export function setStoryOracleWorldBookSelection(store, storageId, books, { scopeKey = '', updatedAt = Date.now() } = {}) {
    const normalized = normalizeStoryOracleStore(store);
    const id = String(storageId || '').trim();
    if (!id) throw new Error('Story Oracle 世界书选择缺少聊天标识');
    const selected = stringArray(books, STORY_ORACLE_LIMITS.selectionBooks, STORY_ORACLE_LIMITS.bookNameChars);
    const current = normalized.scopes[id] || { modes: {} };
    normalized.scopes[id] = { ...current, selections: { books: selected, scopeKey: text(scopeKey, 800) || selectionScopeKey(selected), updatedAt: Number.isFinite(updatedAt) ? Math.max(0, Math.trunc(updatedAt)) : 0 } };
    return normalized;
}

export function storyOraclePlans(store, storageId) {
    const normalized = normalizeStoryOracleStore(store);
    return normalized.scopes[String(storageId || '').trim()]?.plans || [];
}

export function enabledStoryOraclePlans(store, storageId) {
    return storyOraclePlans(store, storageId).filter(plan => plan.enabled);
}

export function buildStoryOraclePlanInjection(plans, {
    maxEnabled = STORY_ORACLE_PLAN_LIMITS.enabled,
    maxChars = STORY_ORACLE_PLAN_LIMITS.injectionChars,
} = {}) {
    const active = Array.isArray(plans) ? plans : [];
    if (!active.length) return { content: '', usedChars: 0, rejected: '' };
    if (active.length > maxEnabled) return {
        content: '', usedChars: 0,
        rejected: `同时启用的剧情线路超过 ${maxEnabled} 条，未注入主聊天。`,
    };
    const blocks = active.map(plan => {
        const lines = [
            `目标：${plan.goal || plan.title}`,
        ];
        if (plan.seed) lines.push(`起始迹象：${plan.seed}`);
        if (plan.why) lines.push(`契合点：${plan.why}`);
        if (plan.pace) lines.push(`剧情推进速度：${plan.pace}`);
        return lines.join('\n');
    });
    const content = blocks.join('\n\n');
    if (content.length > maxChars) return {
        content: '', usedChars: content.length,
        rejected: `启用的剧情线路超过主聊天上下文预算（${content.length}/${maxChars} 字符），未注入主聊天。`,
    };
    return { content, usedChars: content.length, rejected: '' };
}

export function appendStoryOracleTurn(store, storageId, question, answer, mode = STORY_ORACLE_MODE, { selectionKey = '', sourceMessageId = '' } = {}) {
    const normalized = normalizeStoryOracleStore(store);
    const id = String(storageId || '').trim();
    const targetMode = STORY_ORACLE_HISTORY_MODES.includes(mode) ? mode : STORY_ORACLE_MODE;
    const user = normalizeMessage({ role: 'user', content: question, createdAt: Date.now() });
    const assistant = normalizeMessage({ role: 'assistant', content: answer, createdAt: Date.now() });
    if (!id || !user || !assistant) throw new Error('Story Oracle 问答内容无效');
    const messages = [...storyOracleMessages(normalized, id, targetMode), user, assistant].slice(-STORY_ORACLE_LIMITS.messages);
    const currentScope = normalized.scopes[id] || { modes: {} };
    normalized.scopes[id] = { ...currentScope, modes: { ...currentScope.modes, [targetMode]: messages } };
    if (targetMode === 'advisor') {
        const parsed = parseStoryPlans(answer);
        if (parsed.plans.length) {
            const sourceId = text(sourceMessageId, 180) || storyOracleMessageId(assistant);
            const sourceSelectionKey = text(selectionKey, 800);
            const existing = Array.isArray(currentScope.plans) ? currentScope.plans : [];
            const nextPlans = parsed.plans.map((plan, index) => normalizePlan({
                ...plan, id: `plan-${sourceId}-${index}`, sourceMessageId: sourceId, selectionKey: sourceSelectionKey,
                createdAt: assistant.createdAt, order: existing.length + index,
            }, existing.length + index));
            normalized.scopes[id].plans = normalizePlans([...existing, ...nextPlans]);
        }
    }
    return normalized;
}

function tagValue(segment, names) {
    const keys = names.map(name => String(name || '').trim()).filter(Boolean);
    if (!keys.length) return '';
    const match = String(segment || '').match(new RegExp(`^\\s*(?:${keys.join('|')})\\s*[:：]\\s*(.+)$`, 'mi'));
    return match ? text(match[1], STORY_ORACLE_LIMITS.planChars) : '';
}

export function parseStoryPlans(value) {
    const source = typeof value === 'string' ? value : '';
    const blocks = [];
    const pattern = /<Story[_-]?Plan>([\s\S]*?)<\/Story[_-]?Plan>/gi;
    for (const match of source.matchAll(pattern)) blocks.push(match[1] ?? '');
    const hasOpening = /<Story[_-]?Plan\s*>/i.test(source);
    if (!blocks.length) return { plans: [], hadBlocks: hasOpening, invalid: hasOpening, reason: hasOpening ? '方案区块未闭合' : '' };
    const remainder = source.replace(pattern, '');
    if (/<Story[_-]?Plan\s*>/i.test(remainder)) return { plans: [], hadBlocks: true, invalid: true, reason: '方案区块未闭合' };
    if (blocks.length > STORY_ORACLE_PLAN_LIMITS.parsed) return { plans: [], hadBlocks: true, invalid: true, reason: '方案数量超过上限' };
    const plans = [], seen = new Set();
    for (const [index, block] of blocks.entries()) {
        const goal = tagValue(block, ['goal', '目标']);
        if (!goal) return { plans: [], hadBlocks: true, invalid: true, reason: `第 ${index + 1} 个方案缺少 goal` };
        const title = tagValue(block, ['title', '标题', '方案']);
        const seed = tagValue(block, ['seed', '起始迹象', '种子']);
        const why = tagValue(block, ['why', '契合点', '理由']);
        const pace = tagValue(block, ['pace', 'speed', 'progressSpeed', '剧情推进速度', '推进速度', '速度']);
        const duplicateKey = `${goal}\u0000${seed}\u0000${why}`.toLocaleLowerCase();
        if (seen.has(duplicateKey)) return { plans: [], hadBlocks: true, invalid: true, reason: '方案重复' };
        seen.add(duplicateKey);
        plans.push({ title, goal, seed, why, pace, order: index, enabled: false });
    }
    return { plans, hadBlocks: true, invalid: false };
}

export function stripStoryPlanMarkup(value) {
    return typeof value === 'string'
        ? value.replace(/<Story[_-]?Plan>[\s\S]*?(?:<\/Story[_-]?Plan>|$)/gi, '').trim()
        : '';
}

export function setStoryOraclePlanEnabled(store, storageId, planId, enabled, maxEnabled = STORY_ORACLE_PLAN_LIMITS.enabled) {
    const normalized = normalizeStoryOracleStore(store);
    const id = String(storageId || '').trim();
    const target = normalized.scopes[id]?.plans?.find(plan => plan.id === String(planId || ''));
    if (!target) throw new Error('剧情线路不存在或已被删除');
    if (enabled === true && !target.enabled && normalized.scopes[id].plans.filter(plan => plan.enabled).length >= maxEnabled) throw new Error(`同时启用的剧情线路不能超过 ${maxEnabled} 条`);
    target.enabled = enabled === true;
    return normalized;
}

export function removeStoryOraclePlan(store, storageId, planId) {
    const normalized = normalizeStoryOracleStore(store);
    const id = String(storageId || '').trim();
    if (!normalized.scopes[id]) return normalized;
    normalized.scopes[id].plans = (normalized.scopes[id].plans || []).filter(plan => plan.id !== String(planId || ''));
    if (!normalized.scopes[id].plans.length) delete normalized.scopes[id].plans;
    if (!Object.keys(normalized.scopes[id].modes || {}).length && !normalized.scopes[id].selections && !normalized.scopes[id].plans) delete normalized.scopes[id];
    return normalized;
}

export function clearStoryOraclePlans(store, storageId) {
    const normalized = normalizeStoryOracleStore(store);
    const id = String(storageId || '').trim();
    if (normalized.scopes[id]) {
        delete normalized.scopes[id].plans;
        if (!Object.keys(normalized.scopes[id].modes || {}).length && !normalized.scopes[id].selections) delete normalized.scopes[id];
    }
    return normalized;
}

export function clearStoryOracleScope(store, storageId, mode = STORY_ORACLE_MODE) {
    const normalized = normalizeStoryOracleStore(store);
    const id = String(storageId || '').trim();
    const targetMode = STORY_ORACLE_HISTORY_MODES.includes(mode) ? mode : STORY_ORACLE_MODE;
    if (normalized.scopes[id]?.modes) {
        delete normalized.scopes[id].modes[targetMode];
        if (!Object.keys(normalized.scopes[id].modes).length && !normalized.scopes[id].selections && !normalized.scopes[id].plans) delete normalized.scopes[id];
    }
    return normalized;
}
