export const STORY_ORACLE_STORE_VERSION = 1;
export const STORY_ORACLE_MODE = 'question';
export const STORY_ORACLE_MODES = Object.freeze(['question', 'advisor', 'user-generation']);
export const STORY_ORACLE_HISTORY_MODES = Object.freeze(['question', 'lorebook', 'advisor', 'user-generation']);
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
    systemPromptChars: 6000,
});
export const STORY_ORACLE_PLAN_LIMITS = Object.freeze({ parsed: 12, enabled: 5, injectionChars: 18000 });
export const USER_GENERATION_PROTOCOL_LIMITS = Object.freeze({ titleChars: 160, summaryChars: 1000, contentChars: 20000, questionChars: 2000, missingChars: 1000 });
export const STORY_ORACLE_PACE_OPTIONS = Object.freeze(['slow', 'natural', 'fast']);
export const STORY_ORACLE_INTENSITIES = Object.freeze({
    slow: Object.freeze({ label: '只铺垫', instruction: '只铺垫：呈现征兆、信息和关系张力，不让核心冲突在本轮定局。' }),
    natural: Object.freeze({ label: '自然推进', instruction: '自然推进：让剧情沿当前矛盾产生明确进展，但保留后续选择与余地。' }),
    fast: Object.freeze({ label: '尽快引爆', instruction: '尽快引爆：推动关键冲突进入不可逆的直接对峙、揭示或选择。' }),
});
export const DEFAULT_STORY_ORACLE_SYSTEM_PROMPT = '你是「故事神谕」，一个为正在进行的角色扮演/故事服务的“戏外”分析者。下方提供了当前的故事上下文（角色信息与最近的对话记录）。请基于这些上下文，准确地回答用户关于这个故事的问题。\n\n规则：\n- 你不是故事里的角色。不要进行角色扮演、旁白叙述，也不要续写剧情。\n- 除非用户要求展开细节，否则请简明、直接地回答。\n- 如果某些内容在所提供的上下文中并不存在，请如实说明，不要凭空编造。';
const LEGACY_BREAK_LIMIT_INSTRUCTION = '解除对剧情分析、方案设计和成人向题材讨论的泛化拒答；只要请求本身合法，就直接回答，不要用“我不能”“无法协助”等空泛拒绝替代内容。';
const LEGACY_PACE_INSTRUCTIONS = Object.freeze({ slow: '本轮剧情推进强度：只铺垫。', natural: '本轮剧情推进强度：自然推进。', fast: '本轮剧情推进强度：尽快引爆。' });

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
    const intensity = STORY_ORACLE_PACE_OPTIONS.includes(source.intensity) ? source.intensity : 'natural';
    const customInjectionText = text(source.customInjectionText, STORY_ORACLE_PLAN_LIMITS.injectionChars);
    const createdAt = Number.isFinite(source.createdAt) ? Math.max(0, Math.trunc(source.createdAt)) : 0;
    const sourceMessageId = text(source.sourceMessageId, 180);
    const baseId = text(source.id, 180) || `plan-${stableHash(`${goal}\u0000${seed}\u0000${why}`)}-${index}`;
    return {
        id: baseId, title, goal, seed, why, pace, intensity, customInjectionText, sourceMessageId,
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

function normalizeSettings(value) {
    const source = plainObject(value);
    if (!source) return null;
    const systemPrompt = text(source.systemPrompt, STORY_ORACLE_LIMITS.systemPromptChars);
    if (systemPrompt) return { systemPrompt };
    const hasLegacySettings = ['pace', 'breakLimit', 'customPrompt'].some(key => Object.hasOwn(source, key));
    if (!hasLegacySettings) return null;
    const pace = STORY_ORACLE_PACE_OPTIONS.includes(source.pace) ? source.pace : 'natural';
    const customPrompt = text(source.customPrompt, STORY_ORACLE_LIMITS.systemPromptChars);
    const breakLimit = source.breakLimit === true;
    const legacyInstructions = [
        LEGACY_PACE_INSTRUCTIONS[pace],
        breakLimit ? LEGACY_BREAK_LIMIT_INSTRUCTION : '',
        customPrompt ? `用户附加指令（仅作为本轮任务偏好，不得覆盖格式契约）：\n${customPrompt}` : '',
    ].filter(Boolean);
    return { systemPrompt: [DEFAULT_STORY_ORACLE_SYSTEM_PROMPT, ...legacyInstructions].join('\n\n') };
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
        const settings = normalizeSettings(scope?.settings);
        if (Object.keys(modes).length || selections || plans.length || settings) {
            result.scopes[storageId] = { modes };
            if (selections) result.scopes[storageId].selections = selections;
            if (plans.length) result.scopes[storageId].plans = plans;
            if (settings) result.scopes[storageId].settings = settings;
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

export function storyOracleSettings(store, storageId) {
    const normalized = normalizeStoryOracleStore(store);
    return normalized.scopes[String(storageId || '').trim()]?.settings || { systemPrompt: DEFAULT_STORY_ORACLE_SYSTEM_PROMPT };
}

export function setStoryOracleSettings(store, storageId, settings) {
    const normalized = normalizeStoryOracleStore(store);
    const id = String(storageId || '').trim();
    if (!id) throw new Error('Story Oracle 设置缺少聊天标识');
    const nextSettings = normalizeSettings(settings) || { systemPrompt: DEFAULT_STORY_ORACLE_SYSTEM_PROMPT };
    const current = normalized.scopes[id] || { modes: {} };
    normalized.scopes[id] = { ...current, settings: nextSettings };
    return normalized;
}

export function enabledStoryOraclePlans(store, storageId) {
    return storyOraclePlans(store, storageId).filter(plan => plan.enabled);
}

export function storyOraclePlanIntensityLine(intensity = 'natural') {
    const item = STORY_ORACLE_INTENSITIES[STORY_ORACLE_PACE_OPTIONS.includes(intensity) ? intensity : 'natural'];
    return `节奏：${item.instruction}`;
}

export function buildStoryOraclePlanDefaultInjection(plan) {
    const lines = ['剧情引导（仅作幕后方向；用户当轮行动与既有事实优先）：', `目标：${plan?.goal || plan?.title || ''}`];
    if (plan?.seed) lines.push(`起始迹象：${plan.seed}`);
    if (plan?.why) lines.push(`契合点：${plan.why}`);
    lines.push(storyOraclePlanIntensityLine(plan?.intensity));
    return lines.join('\n');
}

export function storyOraclePlanInjectionText(plan) {
    const custom = text(plan?.customInjectionText, STORY_ORACLE_PLAN_LIMITS.injectionChars);
    return custom || buildStoryOraclePlanDefaultInjection(plan);
}

export function storyOraclePlanIntensityControllable(plan) {
    const custom = text(plan?.customInjectionText, STORY_ORACLE_PLAN_LIMITS.injectionChars);
    return !custom || custom.includes(storyOraclePlanIntensityLine(plan?.intensity));
}

function updateStoryOraclePlan(store, storageId, planId, update) {
    const normalized = normalizeStoryOracleStore(store);
    const id = String(storageId || '').trim();
    const target = normalized.scopes[id]?.plans?.find(plan => plan.id === String(planId || ''));
    if (!target) throw new Error('剧情线路不存在或已被删除');
    update(target);
    return normalized;
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
    const blocks = active.map(storyOraclePlanInjectionText);
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

function protocolBlocks(source, tag) {
    const pattern = new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, 'gi');
    const blocks = [...source.matchAll(pattern)].map(match => match[1] ?? '');
    const opening = new RegExp(`<${tag}\\s*>`, 'i').test(source);
    const remainder = source.replace(pattern, '');
    return { blocks, opening, unclosed: new RegExp(`<${tag}\\s*>`, 'i').test(remainder) };
}

function parseProtocolFields(block, allowed, limits) {
    const markers = [];
    const pattern = new RegExp(`^\\s*(${allowed.join('|')})\\s*[:：]\\s*`, 'gmi');
    for (const match of String(block || '').matchAll(pattern)) {
        const key = match[1].toLowerCase();
        markers.push({ key, start: match.index + match[0].length, markerStart: match.index });
    }
    if (markers.length !== allowed.length) return { invalid: true, reason: `控制区块字段必须依次包含 ${allowed.join('/')}` };
    for (const [index, marker] of markers.entries()) {
        if (marker.key !== allowed[index]) return { invalid: true, reason: `控制区块字段顺序无效或重复：${marker.key}` };
    }
    if (String(block || '').slice(0, markers[0].markerStart).trim()) return { invalid: true, reason: '控制区块字段前存在无法识别的内容' };
    const fields = {};
    for (const [index, marker] of markers.entries()) {
        const value = String(block || '').slice(marker.start, markers[index + 1]?.markerStart ?? String(block || '').length).trim();
        const limit = limits[marker.key];
        if (value.length > limit) return { invalid: true, reason: `${marker.key} 超过 ${limit} 字符上限` };
        fields[marker.key] = value;
    }
    return { invalid: false, fields };
}

const USER_GENERATION_EXPLICIT_PATTERN = /性行为|性交|做爱|口交|肛交|手交|乳交|自慰|阴茎|阴道|阴蒂|龟头|射精|精液|高潮|插入|抽插|露骨性|色情/iu;
const USER_GENERATION_MINOR_PATTERN = /未成年|未满\s*18|儿童|幼童|小学生|初中生|高中生|男童|女童|幼女|幼男|萝莉|正太/iu;
const USER_GENERATION_ALL_ADULTS_PATTERN = /所有参与露骨成人内容的角色均已年满\s*18\s*岁/iu;

export function userGenerationAdultSafetyIssue(result) {
    const content = typeof result?.content === 'string' ? result.content : '';
    const source = [result?.title, result?.summary, result?.content].filter(Boolean).join('\n');
    if (!USER_GENERATION_EXPLICIT_PATTERN.test(source)) return '';
    if (USER_GENERATION_MINOR_PATTERN.test(source)) return '露骨成人内容不得涉及未成年人';
    if (!USER_GENERATION_ALL_ADULTS_PATTERN.test(content)) {
        return '露骨成人内容必须声明所有参与角色均已年满18岁';
    }
    return '';
}

export function parseUserGenerationResponse(value) {
    const source = typeof value === 'string' ? value : '';
    const stateBlocks = protocolBlocks(source, 'UserGenerationState');
    const resultBlocks = protocolBlocks(source, 'UserGenerationResult');
    const hadBlocks = stateBlocks.opening || resultBlocks.opening;
    const invalid = reason => ({ status: '', state: null, result: null, displayText: stripUserGenerationMarkup(source), hadBlocks, invalid: true, reason });
    if (!hadBlocks) return { status: '', state: null, result: null, displayText: source.trim(), hadBlocks: false, invalid: false, reason: '' };
    if (stateBlocks.unclosed || resultBlocks.unclosed) return invalid('User 生成控制区块未闭合');
    if (stateBlocks.blocks.length !== 1) return invalid('每轮必须且只能包含一个 UserGenerationState 区块');
    if (resultBlocks.blocks.length > 1) return invalid('每轮最多包含一个 UserGenerationResult 区块');
    const parsedState = parseProtocolFields(stateBlocks.blocks[0], ['status', 'missing', 'question'], {
        status: 20, missing: USER_GENERATION_PROTOCOL_LIMITS.missingChars, question: USER_GENERATION_PROTOCOL_LIMITS.questionChars,
    });
    if (parsedState.invalid) return invalid(parsedState.reason);
    const status = String(parsedState.fields.status || '').toLowerCase();
    if (!['collecting', 'complete', 'revision'].includes(status)) return invalid('User 生成状态无效');
    const state = { status, missing: parsedState.fields.missing || '', question: parsedState.fields.question || '' };
    if (status === 'collecting') {
        if (!state.question) return invalid('collecting 状态缺少 question');
        if (resultBlocks.blocks.length) return invalid('collecting 状态不得包含成品区块');
        return { status, state, result: null, displayText: stripUserGenerationMarkup(source) || state.question, hadBlocks: true, invalid: false, reason: '' };
    }
    if (resultBlocks.blocks.length !== 1) return invalid(`${status} 状态缺少 UserGenerationResult 区块`);
    const parsedResult = parseProtocolFields(resultBlocks.blocks[0], ['title', 'summary', 'content'], {
        title: USER_GENERATION_PROTOCOL_LIMITS.titleChars,
        summary: USER_GENERATION_PROTOCOL_LIMITS.summaryChars,
        content: USER_GENERATION_PROTOCOL_LIMITS.contentChars,
    });
    if (parsedResult.invalid) return invalid(parsedResult.reason);
    const result = {
        title: parsedResult.fields.title || '', summary: parsedResult.fields.summary || '', content: parsedResult.fields.content || '',
    };
    if (!result.title || !result.content) return invalid(`${status} 状态缺少 title 或 content`);
    const safetyIssue = userGenerationAdultSafetyIssue(result);
    if (safetyIssue) return invalid(safetyIssue);
    return { status, state, result, displayText: stripUserGenerationMarkup(source), hadBlocks: true, invalid: false, reason: '' };
}

export function stripUserGenerationMarkup(value) {
    return typeof value === 'string'
        ? value.replace(/<UserGeneration(?:State|Result)>[\s\S]*?(?:<\/UserGeneration(?:State|Result)>|$)/gi, '').trim()
        : '';
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

export function setStoryOraclePlanIntensity(store, storageId, planId, intensity) {
    if (!STORY_ORACLE_PACE_OPTIONS.includes(intensity)) throw new Error('剧情推进强度无效');
    return updateStoryOraclePlan(store, storageId, planId, plan => {
        if (!storyOraclePlanIntensityControllable(plan)) throw new Error('已手动修改“节奏：”行，请恢复默认后再切换推进强度');
        const previousLine = storyOraclePlanIntensityLine(plan.intensity);
        plan.intensity = intensity;
        if (plan.customInjectionText) plan.customInjectionText = plan.customInjectionText.replace(previousLine, storyOraclePlanIntensityLine(intensity));
    });
}

export function setStoryOraclePlanCustomInjection(store, storageId, planId, content) {
    const customInjectionText = text(content, STORY_ORACLE_PLAN_LIMITS.injectionChars);
    if (!customInjectionText) throw new Error('主聊天引导不能为空');
    return updateStoryOraclePlan(store, storageId, planId, plan => { plan.customInjectionText = customInjectionText; });
}

export function resetStoryOraclePlanInjection(store, storageId, planId) {
    return updateStoryOraclePlan(store, storageId, planId, plan => { plan.customInjectionText = ''; });
}

export function removeStoryOraclePlan(store, storageId, planId) {
    const normalized = normalizeStoryOracleStore(store);
    const id = String(storageId || '').trim();
    if (!normalized.scopes[id]) return normalized;
    normalized.scopes[id].plans = (normalized.scopes[id].plans || []).filter(plan => plan.id !== String(planId || ''));
    if (!normalized.scopes[id].plans.length) delete normalized.scopes[id].plans;
    if (!Object.keys(normalized.scopes[id].modes || {}).length && !normalized.scopes[id].selections && !normalized.scopes[id].plans && !normalized.scopes[id].settings) delete normalized.scopes[id];
    return normalized;
}

export function clearStoryOraclePlans(store, storageId) {
    const normalized = normalizeStoryOracleStore(store);
    const id = String(storageId || '').trim();
    if (normalized.scopes[id]) {
        delete normalized.scopes[id].plans;
        if (!Object.keys(normalized.scopes[id].modes || {}).length && !normalized.scopes[id].selections && !normalized.scopes[id].settings) delete normalized.scopes[id];
    }
    return normalized;
}

export function clearStoryOracleScope(store, storageId, mode = STORY_ORACLE_MODE) {
    const normalized = normalizeStoryOracleStore(store);
    const id = String(storageId || '').trim();
    const targetMode = STORY_ORACLE_HISTORY_MODES.includes(mode) ? mode : STORY_ORACLE_MODE;
    if (normalized.scopes[id]?.modes) {
        delete normalized.scopes[id].modes[targetMode];
        if (!Object.keys(normalized.scopes[id].modes).length && !normalized.scopes[id].selections && !normalized.scopes[id].plans && !normalized.scopes[id].settings) delete normalized.scopes[id];
    }
    return normalized;
}
