export const USER_GENERATION_STORE_VERSION = 1;
export const USER_GENERATION_LIMITS = Object.freeze({
    items: 100,
    idChars: 180,
    titleChars: 160,
    summaryChars: 1000,
    contentChars: 20000,
    sourceMessageIdChars: 180,
});

const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const plainObject = value => value && typeof value === 'object' && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null) ? value : null;
const cleanText = (value, max, field, { required = false } = {}) => {
    if (typeof value !== 'string') {
        if (required) throw new Error(`User 成品 ${field} 必须是文本`);
        return '';
    }
    const result = value.trim();
    if (required && !result) throw new Error(`User 成品 ${field} 不能为空`);
    if (result.length > max) throw new Error(`User 成品 ${field} 超过 ${max} 字符上限`);
    return result;
};
const validTimestamp = (value, field) => {
    if (!Number.isFinite(value) || !Number.isInteger(value) || value < 0) {
        throw new Error(`User 成品 ${field} 时间无效`);
    }
    return value;
};
const normalizeTimestamp = (value, field, fallback = 0) => hasOwn(value, field)
    ? validTimestamp(value[field], field)
    : fallback;
const normalizeOrder = (value, fallback) => hasOwn(value, 'order')
    ? (Number.isInteger(value.order) && value.order >= 0 ? value.order : (() => { throw new Error('User 成品 order 无效'); })())
    : fallback;

export function createEmptyUserGenerationStore() {
    return { version: USER_GENERATION_STORE_VERSION, items: [] };
}

export function normalizeUserGenerationItem(value, fallbackOrder = 0) {
    const source = plainObject(value);
    if (!source) throw new Error('User 成品必须是对象');
    const id = cleanText(source.id, USER_GENERATION_LIMITS.idChars, 'ID', { required: true });
    const title = cleanText(source.title, USER_GENERATION_LIMITS.titleChars, '标题', { required: true });
    const summary = cleanText(source.summary, USER_GENERATION_LIMITS.summaryChars, '摘要');
    const content = cleanText(source.content, USER_GENERATION_LIMITS.contentChars, '正文', { required: true });
    const sourceMessageId = cleanText(source.sourceMessageId, USER_GENERATION_LIMITS.sourceMessageIdChars, '来源消息 ID');
    const createdAt = normalizeTimestamp(source, 'createdAt');
    const updatedAt = normalizeTimestamp(source, 'updatedAt', createdAt);
    if (updatedAt < createdAt) throw new Error('User 成品更新时间早于创建时间');
    const order = normalizeOrder(source, fallbackOrder);
    return { id, title, summary, content, sourceMessageId, createdAt, updatedAt, order };
}

const compareInternal = (left, right) => (left.order - right.order)
    || (left.createdAt - right.createdAt)
    || left.id.localeCompare(right.id);
const compareNewest = (left, right) => (right.updatedAt - left.updatedAt)
    || (right.createdAt - left.createdAt)
    || (right.order - left.order)
    || left.id.localeCompare(right.id);

export function normalizeUserGenerationStore(value) {
    const source = plainObject(value);
    if (!source) throw new Error('User 库数据必须是对象');
    if (source.version !== USER_GENERATION_STORE_VERSION) throw new Error(`User 库版本不受支持：${source.version}`);
    if (!Array.isArray(source.items)) throw new Error('User 库 items 必须是数组');
    if (source.items.length > USER_GENERATION_LIMITS.items) throw new Error(`User 库成品数量超过 ${USER_GENERATION_LIMITS.items} 条上限`);
    const seenIds = new Set();
    const items = source.items.map((item, index) => {
        const normalized = normalizeUserGenerationItem(item, index);
        if (seenIds.has(normalized.id)) throw new Error(`User 库存在重复 ID：${normalized.id}`);
        seenIds.add(normalized.id);
        return normalized;
    }).sort(compareInternal);
    return { version: USER_GENERATION_STORE_VERSION, items };
}

export function userGenerationItems(store) {
    return normalizeUserGenerationStore(store).items.slice().sort(compareNewest);
}

export function addUserGenerationItem(store, value, { now = Date.now() } = {}) {
    const normalized = normalizeUserGenerationStore(store);
    const candidate = normalizeUserGenerationItem(value, normalized.items.length);
    if (candidate.createdAt === 0) candidate.createdAt = now;
    if (candidate.updatedAt === 0) candidate.updatedAt = candidate.createdAt;
    validTimestamp(candidate.createdAt, '创建');
    validTimestamp(candidate.updatedAt, '更新');
    if (candidate.updatedAt < candidate.createdAt) throw new Error('User 成品更新时间早于创建时间');
    const existing = normalized.items.find(item => item.id === candidate.id);
    if (existing) {
        const same = ['title', 'summary', 'content', 'sourceMessageId']
            .every(key => existing[key] === candidate[key]);
        if (same) return normalized;
        throw new Error(`User 库已存在不同内容的 ID：${candidate.id}`);
    }
    if (normalized.items.length >= USER_GENERATION_LIMITS.items) throw new Error(`User 库已达到 ${USER_GENERATION_LIMITS.items} 条上限`);
    candidate.order = normalized.items.reduce((max, item) => Math.max(max, item.order), -1) + 1;
    return normalizeUserGenerationStore({ version: USER_GENERATION_STORE_VERSION, items: [...normalized.items, candidate] });
}

export function removeUserGenerationItem(store, id) {
    const normalized = normalizeUserGenerationStore(store);
    const targetId = cleanText(id, USER_GENERATION_LIMITS.idChars, 'ID');
    if (!targetId) return normalized;
    return normalizeUserGenerationStore({
        version: USER_GENERATION_STORE_VERSION,
        items: normalized.items.filter(item => item.id !== targetId),
    });
}
