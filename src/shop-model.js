// 桃宝（原型淘宝）的数据：按会话（scope）存商品、购物车与订单，单独一个存储键，不进互动社区的 store。
// 价格以「分」为整数保存，避免小数误差。月销、评价总数、好评率、店铺粉丝等展示数字按内容稳定生成，不存。

export const SHOP_STORE_VERSION = 1;
export const SHOP_LIMITS = Object.freeze({
    items: 120, reviews: 30, specs: 4, services: 3, cart: 50, orders: 100, quantity: 99, priceCents: 9999999, toldInjection: 8,
});
export const SHOP_TEXT_MAX = Object.freeze({
    title: 60, name: 8, shop: 24, category: 8, origin: 12, image: 120, service: 8, badge: 4, spec: 12, query: 30,
    author: 24, review: 300, followupAfter: 8, followup: 200, key: 120,
});
export const SHOP_ORDER_STATUSES = Object.freeze(['pending', 'shipped', 'done']);
export const SHOP_ORDER_STATUS_LABELS = Object.freeze({ pending: '待发货', shipped: '待收货', done: '已完成' });
export const SHOP_SWATCH_COUNT = 6;
export const SHOP_DEFAULT_SPEC = '默认';

const UNSAFE_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const ID_PATTERN = /^[A-Za-z0-9_-]{1,80}$/;
const isRecord = value => !!value && typeof value === 'object' && !Array.isArray(value);
const validId = value => typeof value === 'string' && ID_PATTERN.test(value) && !UNSAFE_KEYS.has(value);
const validTime = value => Number.isSafeInteger(value) && value >= 0;
const validCents = value => Number.isSafeInteger(value) && value >= 1 && value <= SHOP_LIMITS.priceCents;
const text = (value, max) => (typeof value === 'string' ? Array.from(value.trim()).slice(0, max).join('') : '');

function uniqueTexts(value, max, limit) {
    const seen = new Set();
    const result = [];
    for (const entry of Array.isArray(value) ? value : []) {
        const item = text(entry, max);
        if (!item || seen.has(item)) continue;
        seen.add(item);
        result.push(item);
        if (result.length >= limit) break;
    }
    return result;
}

let idSequence = 0;
export function createShopId(prefix) {
    idSequence = (idSequence + 1) % 1679616;
    return `${prefix}_${Date.now().toString(36)}${idSequence.toString(36).padStart(4, '0')}${Math.floor(Math.random() * 1296).toString(36).padStart(2, '0')}`;
}

export const createEmptyShopScope = () => ({ items: {}, itemOrder: [], cart: [], orders: [] });
export const createEmptyShopStore = () => ({ version: SHOP_STORE_VERSION, scopes: {} });

// IGS 导入预留：照社区帖子的 normalizePostSource，{ type:'igs', floor, key }。
export function normalizeShopSource(value) {
    if (!isRecord(value) || value.type !== 'igs' || !Number.isSafeInteger(value.floor) || value.floor < 0) return null;
    const key = text(value.key, SHOP_TEXT_MAX.key);
    // stale：正文里的原楼层已改或已删，但用户收藏、加购或下过单，所以保留（见 igs-shop-core.js）。
    return key ? { type: 'igs', floor: value.floor, key, ...(value.stale === true ? { stale: true } : {}) } : null;
}

function normalizeReview(raw) {
    if (!isRecord(raw) || !validId(raw.id)) return null;
    const content = text(raw.content, SHOP_TEXT_MAX.review);
    if (!content) return null;
    const rating = Number.isInteger(raw.rating) && raw.rating >= 1 && raw.rating <= 5 ? raw.rating : 5;
    const spec = text(raw.spec, SHOP_TEXT_MAX.spec);
    const followupContent = isRecord(raw.followup) ? text(raw.followup.content, SHOP_TEXT_MAX.followup) : '';
    const followupAfter = followupContent ? text(raw.followup.after, SHOP_TEXT_MAX.followupAfter) : '';
    return {
        id: raw.id, author: text(raw.author, SHOP_TEXT_MAX.author) || '匿名买家', rating, ...(spec ? { spec } : {}), content,
        ...(followupContent ? { followup: { ...(followupAfter ? { after: followupAfter } : {}), content: followupContent } } : {}),
        createdAt: validTime(raw.createdAt) ? raw.createdAt : 0,
    };
}

function normalizeItem(raw, id) {
    if (!isRecord(raw) || raw.id !== id || !validId(id)) return null;
    const title = text(raw.title, SHOP_TEXT_MAX.title);
    const shop = text(raw.shop, SHOP_TEXT_MAX.shop);
    if (!title || !shop || !validCents(raw.priceCents)) return null;
    const name = text(raw.name, SHOP_TEXT_MAX.name);
    const category = text(raw.category, SHOP_TEXT_MAX.category);
    const origin = text(raw.origin, SHOP_TEXT_MAX.origin);
    const image = isRecord(raw.image) ? text(raw.image.desc, SHOP_TEXT_MAX.image) : '';
    const badge = text(raw.badge, SHOP_TEXT_MAX.badge);
    const query = text(raw.query, SHOP_TEXT_MAX.query);
    const specs = uniqueTexts(raw.specs, SHOP_TEXT_MAX.spec, SHOP_LIMITS.specs);
    const seenReviews = new Set();
    const reviews = (Array.isArray(raw.reviews) ? raw.reviews : []).map(normalizeReview)
        .filter(review => review && !seenReviews.has(review.id) && seenReviews.add(review.id)).slice(0, SHOP_LIMITS.reviews);
    const source = normalizeShopSource(raw.source);
    return {
        id, title, ...(name ? { name } : {}), shop, ...(category ? { category } : {}), priceCents: raw.priceCents,
        ...(validCents(raw.originalCents) && raw.originalCents > raw.priceCents ? { originalCents: raw.originalCents } : {}),
        ...(origin ? { origin } : {}), ...(image ? { image: { desc: image } } : {}),
        services: uniqueTexts(raw.services, SHOP_TEXT_MAX.service, SHOP_LIMITS.services), ...(badge ? { badge } : {}),
        specs: specs.length ? specs : [SHOP_DEFAULT_SPEC], reviews,
        ...(query ? { query } : {}), ...(raw.favorite === true ? { favorite: true } : {}), ...(source ? { source } : {}),
        createdAt: validTime(raw.createdAt) ? raw.createdAt : 0,
    };
}

function normalizeOrder(raw) {
    if (!isRecord(raw) || !validId(raw.id) || !validId(raw.itemId) || !SHOP_ORDER_STATUSES.includes(raw.status)) return null;
    const title = text(raw.title, SHOP_TEXT_MAX.title);
    const shop = text(raw.shop, SHOP_TEXT_MAX.shop);
    if (!title || !shop || !validCents(raw.priceCents)) return null;
    const name = text(raw.name, SHOP_TEXT_MAX.name);
    const createdAt = validTime(raw.createdAt) ? raw.createdAt : 0;
    return {
        id: raw.id, itemId: raw.itemId, title, ...(name ? { name } : {}), shop, spec: text(raw.spec, SHOP_TEXT_MAX.spec) || SHOP_DEFAULT_SPEC,
        quantity: Number.isSafeInteger(raw.quantity) ? Math.min(SHOP_LIMITS.quantity, Math.max(1, raw.quantity)) : 1,
        priceCents: raw.priceCents, status: raw.status, ...(raw.told === true ? { told: true } : {}),
        createdAt, updatedAt: validTime(raw.updatedAt) && raw.updatedAt >= createdAt ? raw.updatedAt : createdAt,
    };
}

function normalizeCartEntry(raw, items) {
    if (!isRecord(raw) || !validId(raw.id) || !validId(raw.itemId) || !Object.hasOwn(items, raw.itemId)) return null;
    const item = items[raw.itemId];
    const spec = item.specs.includes(raw.spec) ? raw.spec : item.specs[0];
    return {
        id: raw.id, itemId: raw.itemId, spec,
        quantity: Number.isSafeInteger(raw.quantity) ? Math.min(SHOP_LIMITS.quantity, Math.max(1, raw.quantity)) : 1,
        checked: raw.checked === true,
    };
}

export function normalizeShopScope(raw) {
    const scope = createEmptyShopScope();
    if (!isRecord(raw)) return scope;
    const rawItems = isRecord(raw.items) ? raw.items : {};
    const order = [];
    for (const id of Array.isArray(raw.itemOrder) ? raw.itemOrder : []) {
        if (order.length >= SHOP_LIMITS.items || order.includes(id) || !Object.hasOwn(rawItems, id)) continue;
        const item = normalizeItem(rawItems[id], id);
        if (!item) continue;
        scope.items[id] = item;
        order.push(id);
    }
    scope.itemOrder = order;
    const cartKeys = new Set();
    const cartIds = new Set();
    for (const entry of Array.isArray(raw.cart) ? raw.cart : []) {
        if (scope.cart.length >= SHOP_LIMITS.cart) break;
        const normalized = normalizeCartEntry(entry, scope.items);
        const key = normalized && `${normalized.itemId}\u0000${normalized.spec}`;
        if (!normalized || cartKeys.has(key) || cartIds.has(normalized.id)) continue;
        cartKeys.add(key);
        cartIds.add(normalized.id);
        scope.cart.push(normalized);
    }
    const orderIds = new Set();
    for (const entry of Array.isArray(raw.orders) ? raw.orders : []) {
        if (scope.orders.length >= SHOP_LIMITS.orders) break;
        const normalized = normalizeOrder(entry);
        if (!normalized || orderIds.has(normalized.id)) continue;
        orderIds.add(normalized.id);
        scope.orders.push(normalized);
    }
    if (raw.nsfw === true) scope.nsfw = true;
    return scope;
}

const validScopeKey = key => typeof key === 'string' && key.length > 0 && key.length <= 160 && key === key.trim() && !UNSAFE_KEYS.has(key);

export function normalizeShopStore(raw) {
    const store = createEmptyShopStore();
    if (!isRecord(raw) || raw.version !== SHOP_STORE_VERSION || !isRecord(raw.scopes)) return store;
    for (const [key, scope] of Object.entries(raw.scopes)) {
        if (validScopeKey(key)) store.scopes[key] = normalizeShopScope(scope);
    }
    return store;
}

function sameStructure(left, right) {
    if (Object.is(left, right)) return true;
    if (Array.isArray(left) || Array.isArray(right)) {
        return Array.isArray(left) && Array.isArray(right) && left.length === right.length && left.every((value, index) => sameStructure(value, right[index]));
    }
    if (!isRecord(left) || !isRecord(right)) return false;
    const leftKeys = Object.keys(left).sort();
    const rightKeys = Object.keys(right).sort();
    return leftKeys.length === rightKeys.length && leftKeys.every((key, index) => key === rightKeys[index] && sameStructure(left[key], right[key]));
}

// 备份导入：照今日风向的写法，内容必须已是规范格式，否则整份拒绝，不悄悄改写用户数据。
export function assertShopBackupStore(value) {
    if (!isRecord(value)) throw new Error('备份字段 shop 必须是对象');
    if (value.version !== SHOP_STORE_VERSION) throw new Error(`备份字段 shop.version 必须为 ${SHOP_STORE_VERSION}`);
    const normalized = normalizeShopStore(value);
    if (!sameStructure(value, normalized)) throw new Error('备份字段 shop 内容无效或不是规范格式');
    return normalized;
}

export function getShopScope(store, storageId) {
    if (!validScopeKey(storageId)) throw new Error('会话无效');
    if (!Object.hasOwn(store.scopes, storageId)) store.scopes[storageId] = createEmptyShopScope();
    return store.scopes[storageId];
}

// ===== 商品 =====

// items 是 AI 解析结果（价格单位为分）；新商品排在最前。超出上限时先删最旧的、未收藏且不在购物车里的商品。
export function addShopItems(scope, items, { now = Date.now(), makeId = createShopId } = {}) {
    const added = [];
    for (const raw of Array.isArray(items) ? items : []) {
        const id = makeId('item');
        const item = normalizeItem({
            ...raw, id, createdAt: now, favorite: false,
            reviews: (Array.isArray(raw?.reviews) ? raw.reviews : []).map(review => ({ ...review, id: makeId('review'), createdAt: now })),
        }, id);
        if (!item) continue;
        scope.items[id] = item;
        added.push(id);
    }
    scope.itemOrder = [...added, ...scope.itemOrder.filter(id => !added.includes(id))];
    while (scope.itemOrder.length > SHOP_LIMITS.items) {
        const inCart = new Set(scope.cart.map(entry => entry.itemId));
        const victim = [...scope.itemOrder].reverse().find(id => !scope.items[id]?.favorite && !inCart.has(id)) || scope.itemOrder.at(-1);
        scope.itemOrder = scope.itemOrder.filter(id => id !== victim);
        delete scope.items[victim];
        scope.cart = scope.cart.filter(entry => entry.itemId !== victim);
    }
    return added.map(id => scope.items[id]);
}

export function addShopReviews(scope, itemId, reviews, { now = Date.now(), makeId = createShopId } = {}) {
    const item = scope.items[itemId];
    if (!item) throw new Error('商品不存在');
    const room = SHOP_LIMITS.reviews - item.reviews.length;
    const added = (Array.isArray(reviews) ? reviews : []).slice(0, Math.max(0, room))
        .map(review => normalizeReview({ ...review, id: makeId('review'), createdAt: now })).filter(Boolean);
    item.reviews.push(...added);
    return added;
}

export function toggleShopFavorite(scope, itemId) {
    const item = scope.items[itemId];
    if (!item) throw new Error('商品不存在');
    if (item.favorite) delete item.favorite;
    else item.favorite = true;
    return item.favorite === true;
}

// ===== 购物车 =====

const clampQuantity = value => Math.min(SHOP_LIMITS.quantity, Math.max(1, Math.floor(Number(value) || 1)));

export function addToShopCart(scope, { itemId, spec, quantity = 1 }, { makeId = createShopId } = {}) {
    const item = scope.items[itemId];
    if (!item) throw new Error('商品不存在');
    const chosen = item.specs.includes(spec) ? spec : item.specs[0];
    const existing = scope.cart.find(entry => entry.itemId === itemId && entry.spec === chosen);
    if (existing) {
        existing.quantity = clampQuantity(existing.quantity + clampQuantity(quantity));
        existing.checked = true;
        return existing;
    }
    if (scope.cart.length >= SHOP_LIMITS.cart) throw new Error(`购物车最多放 ${SHOP_LIMITS.cart} 件`);
    const entry = { id: makeId('cart'), itemId, spec: chosen, quantity: clampQuantity(quantity), checked: true };
    scope.cart.unshift(entry);
    return entry;
}

const cartEntry = (scope, entryId) => {
    const entry = scope.cart.find(item => item.id === entryId);
    if (!entry) throw new Error('购物车里没有这件商品');
    return entry;
};

export function setShopCartQuantity(scope, entryId, quantity) {
    const entry = cartEntry(scope, entryId);
    entry.quantity = clampQuantity(quantity);
    return entry.quantity;
}

export function toggleShopCartEntry(scope, entryId) {
    const entry = cartEntry(scope, entryId);
    entry.checked = !entry.checked;
    return entry.checked;
}

// 店铺勾选：全部已选时取消全部，否则全部选上。shop 省略时作用于整个购物车（全选）。
export function toggleShopCartGroup(scope, shop = null) {
    const entries = scope.cart.filter(entry => shop === null || scope.items[entry.itemId]?.shop === shop);
    const next = !entries.every(entry => entry.checked);
    for (const entry of entries) entry.checked = next;
    return next;
}

export function removeShopCartEntries(scope, entryIds) {
    const remove = new Set(entryIds);
    const before = scope.cart.length;
    scope.cart = scope.cart.filter(entry => !remove.has(entry.id));
    return before - scope.cart.length;
}

export function summarizeShopCart(scope) {
    const groups = [];
    const byShop = new Map();
    let totalCents = 0;
    let savedCents = 0;
    let checkedCount = 0;
    for (const entry of scope.cart) {
        const item = scope.items[entry.itemId];
        if (!item) continue;
        if (!byShop.has(item.shop)) {
            const group = { shop: item.shop, rows: [], allChecked: true };
            byShop.set(item.shop, group);
            groups.push(group);
        }
        const group = byShop.get(item.shop);
        group.rows.push({ entry, item });
        if (!entry.checked) group.allChecked = false;
        if (entry.checked) {
            checkedCount += 1;
            totalCents += item.priceCents * entry.quantity;
            if (item.originalCents) savedCents += (item.originalCents - item.priceCents) * entry.quantity;
        }
    }
    const count = groups.reduce((sum, group) => sum + group.rows.length, 0);
    return { groups, count, checkedCount, totalCents, savedCents, allChecked: count > 0 && checkedCount === count };
}

// ===== 订单 =====

function pushOrder(scope, order) {
    scope.orders.unshift(order);
    while (scope.orders.length > SHOP_LIMITS.orders) {
        const index = scope.orders.findLastIndex(entry => entry.status === 'done');
        scope.orders.splice(index >= 0 ? index : scope.orders.length - 1, 1);
    }
}

// 不做真支付：下单直接生成「待发货」订单，订单里存商品快照，商品以后被删也不影响订单。
export function placeShopOrder(scope, { itemId, spec, quantity = 1 }, { now = Date.now(), makeId = createShopId } = {}) {
    const item = scope.items[itemId];
    if (!item) throw new Error('商品不存在');
    const order = {
        id: makeId('order'), itemId, title: item.title, ...(item.name ? { name: item.name } : {}), shop: item.shop,
        spec: item.specs.includes(spec) ? spec : item.specs[0], quantity: clampQuantity(quantity),
        priceCents: item.priceCents, status: 'pending', createdAt: now, updatedAt: now,
    };
    pushOrder(scope, order);
    return order;
}

export function checkoutShopCart(scope, options = {}) {
    const checked = scope.cart.filter(entry => entry.checked && scope.items[entry.itemId]);
    if (!checked.length) throw new Error('请先勾选要结算的商品');
    const orders = checked.reverse().map(entry => placeShopOrder(scope, entry, options)).reverse();
    removeShopCartEntries(scope, checked.map(entry => entry.id));
    return orders;
}

const shopOrder = (scope, orderId) => {
    const order = scope.orders.find(entry => entry.id === orderId);
    if (!order) throw new Error('订单不存在');
    return order;
};

// 状态只由用户手动推进：待发货 → 待收货（提醒发货）→ 已完成（确认收货）。
export function advanceShopOrder(scope, orderId, { now = Date.now() } = {}) {
    const order = shopOrder(scope, orderId);
    const next = SHOP_ORDER_STATUSES[SHOP_ORDER_STATUSES.indexOf(order.status) + 1];
    if (!next) throw new Error('订单已完成');
    order.status = next;
    order.updatedAt = Math.max(now, order.createdAt);
    return next;
}

export function markShopOrderTold(scope, orderId) {
    shopOrder(scope, orderId).told = true;
}

// ===== 告诉剧情：进上下文注入 =====

const STATUS_PHRASES = Object.freeze({ pending: '还没发货', shipped: '正在路上', done: '已经收到' });
export const shopItemName = item => item?.name || Array.from(String(item?.title || '')).slice(0, SHOP_TEXT_MAX.name).join('');

export function renderShopInjection(scope, userName = '我') {
    const who = text(userName, 40) || '我';
    return (Array.isArray(scope?.orders) ? scope.orders : []).filter(order => order.told).slice(0, SHOP_LIMITS.toldInjection)
        .map(order => `${who}在桃宝的「${order.shop}」买了${shopItemName(order)}（${order.spec}×${order.quantity}，¥${formatShopPrice(order.priceCents * order.quantity)}），${STATUS_PHRASES[order.status]}。`)
        .join('\n');
}

// ===== 展示用的派生数字：按内容稳定生成 =====

export function shopHash(value) {
    let hash = 2166136261;
    for (const character of String(value ?? '')) {
        hash ^= character.codePointAt(0);
        hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
}

export function formatShopPrice(cents) {
    const value = Math.max(0, Math.round(Number(cents) || 0));
    const yuan = Math.floor(value / 100);
    const rest = value % 100;
    if (!rest) return String(yuan);
    return `${yuan}.${String(rest).padStart(2, '0').replace(/0$/, '')}`;
}

export function formatShopCount(count) {
    const value = Math.max(0, Math.floor(Number(count) || 0));
    if (value >= 10000) return `${(Math.floor(value / 1000) / 10).toFixed(1).replace(/\.0$/, '')}万`;
    return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

const itemKey = item => `${item?.shop || ''}\u0000${item?.title || ''}`;
export const shopMonthlySales = item => 300 + (shopHash(`sales:${itemKey(item)}`) % 59701);
// 评价总数至少是已写出来的条数。
export const shopReviewTotal = item => Math.max(item?.reviews?.length || 0, 40 + (shopHash(`reviews:${itemKey(item)}`) % 29961));
export const shopGoodRate = item => 90 + (shopHash(`rate:${itemKey(item)}`) % 10);
export function shopStoreStats(shop) {
    const hash = shopHash(`shop:${shop}`);
    return { goodRate: 95 + (hash % 5), fans: 1200 + ((hash >>> 5) % 248801) };
}
export const shopSwatchIndex = key => (shopHash(`swatch:${key}`) % SHOP_SWATCH_COUNT) + 1;

const ARRIVAL = Object.freeze(['预计明天到', '预计后天到', '预计三天内到']);
export function shopShippingLine(item) {
    const hash = shopHash(`ship:${itemKey(item)}`);
    return `${item?.origin || '本地'} · ${hash % 2 ? '24小时内发货' : '48小时内发货'} · ${ARRIVAL[(hash >>> 3) % ARRIVAL.length]}`;
}

const LOGISTICS = Object.freeze({
    pending: Object.freeze(['商家正在打包，请耐心等待。', '订单已提交，等待商家发货。', '仓库排队中，前面还有几单。']),
    shipped: Object.freeze(['快递已出发，正在路上。', '包裹已到转运中心，正在分拣。', '快递员正在派送，请保持电话畅通。']),
    done: Object.freeze(['已签收，期待你的评价。', '包裹已签收。']),
});
export function shopLogisticsLine(order) {
    const lines = LOGISTICS[order?.status] || LOGISTICS.pending;
    return lines[shopHash(`logistics:${order?.id}:${order?.status}`) % lines.length];
}

// ===== 首页与搜索 =====

// 分类胶囊：按商品数从多到少，同数按首次出现顺序。
export function shopCategories(scope) {
    const counts = new Map();
    for (const id of scope.itemOrder) {
        const category = scope.items[id]?.category;
        if (category) counts.set(category, (counts.get(category) || 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([category]) => category);
}

export function shopSearchTerms(query) {
    return text(query, SHOP_TEXT_MAX.query).split(/\s+/).filter(Boolean);
}

// 关键词全部命中标题、短名、店铺、分类或上新时的搜索词才算匹配。
export function searchShopItems(scope, query) {
    const terms = shopSearchTerms(query).map(term => term.toLowerCase());
    if (!terms.length) return [];
    return scope.itemOrder.map(id => scope.items[id]).filter(item => {
        const haystack = [item.title, item.name, item.shop, item.category, item.query].filter(Boolean).join('\n').toLowerCase();
        return terms.every(term => haystack.includes(term));
    });
}
