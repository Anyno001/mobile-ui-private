import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// 桃宝：数据归一化、购物车、订单、上新与评价的提示词和解析、成人开关、告诉剧情的注入、备份往返、页面与 App 控制器。
let passed = 0;
const check = async (name, run) => {
    try { await run(); passed += 1; } catch (error) { console.error(`FAIL ${name}`); throw error; }
};
const clone = value => JSON.parse(JSON.stringify(value));

// App 控制器测试用的最小浏览器环境：localStorage 与 alert/confirm。必须在导入模块前就位。
const memory = new Map();
globalThis.localStorage = {
    getItem: key => (memory.has(key) ? memory.get(key) : null),
    setItem: (key, value) => { memory.set(key, String(value)); },
    removeItem: key => { memory.delete(key); },
};
globalThis.window = globalThis;
globalThis.alert = () => {};
globalThis.confirm = () => true;

const model = await import('../src/shop-model.js');
const { SHOP_FALLBACK_KEY, SHOP_STORE_KEY, loadShopStore, saveShopStore } = await import('../src/shop-storage.js');
const { buildShopRequest, parseShopResponse, shopPriceToCents } = await import('../src/shop-ai.js');
const { renderShopPage } = await import('../src/shop-views.js');
const { buildContextInjectionPrompts } = await import('../src/phone-injection.js');
const { parseBackupData } = await import('../src/settings-backup-validate.js');
const { PLUGIN_IDB_STATIC_KEYS, PLUGIN_LOCAL_STORAGE_KEYS } = await import('../src/storage.js');
const { PHONE_UI_PAGES } = await import('../src/interactive-scene-constants.js');
const { DESKTOP_ICON_IDS } = await import('../src/desktop-icon-storage.js');
const { renderPhoneDesktop } = await import('../src/interactive-scene-views.js');
const { SHOP_APP_ICON_SVG } = await import('../src/icons.js');
const { installShopApp } = await import('../src/shop-app.js');
const {
    SHOP_LIMITS, addShopItems, addShopReviews, addToShopCart, advanceShopOrder, assertShopBackupStore, checkoutShopCart, createEmptyShopScope,
    createEmptyShopStore, formatShopCount, formatShopPrice, markShopOrderTold, normalizeShopScope, normalizeShopStore, placeShopOrder,
    removeShopCartEntries, renderShopInjection, searchShopItems, setShopCartQuantity, shopMonthlySales, summarizeShopCart, toggleShopCartEntry,
    toggleShopCartGroup, toggleShopFavorite,
} = model;

let seq = 0;
const makeId = prefix => `${prefix}_t${++seq}`;
const sample = (overrides = {}) => ({
    title: '林晚同款透明防雨鞋套 加厚防滑', name: '透明雨鞋套', shop: '雨城东区防水铺', category: '家居', priceCents: 2990, originalCents: 5900,
    origin: '雨城东区', image: { desc: '透明雨鞋套，套在小白鞋上' }, services: ['包邮', '7天无理由'], badge: '热销', specs: ['透明S', '透明M'],
    reviews: [{ author: '苏小满', rating: 5, spec: '透明M', content: '鞋是真的没湿。', followup: { after: '两周后', content: '推荐给林晚了。' } }],
    ...overrides,
});
const scopeWith = (...items) => {
    const scope = createEmptyShopScope();
    addShopItems(scope, items.length ? items : [sample()], { now: 1000, makeId });
    return scope;
};
const envelope = (kind, items, extra = {}) => JSON.stringify({ version: 2, kind, items, ...extra });

// ===== 数据归一化 =====
await check('归一化：合法 scope 往返不变，展示数字不落盘', () => {
    const scope = scopeWith();
    const store = { version: 1, scopes: { story: scope } };
    assert.deepEqual(normalizeShopStore(clone(store)), store);
    const item = Object.values(scope.items)[0];
    for (const key of ['sales', 'monthlySales', 'reviewTotal', 'goodRate', 'fans']) assert.equal(Object.hasOwn(item, key), false);
    assert.equal(shopMonthlySales(item), shopMonthlySales(clone(item)), '月销按内容稳定生成');
    assert.equal(item.priceCents, 2990);
});
await check('归一化：非法值丢弃，不让整份失效', () => {
    const raw = {
        items: {
            good: { ...sample(), id: 'good', specs: ['A', 'A', 'B', '', 'C', 'D', 'E'], favorite: 'yes', source: { type: 'igs', floor: 3, key: 'igs:1' }, reviews: [{ id: 'r1', content: '好', rating: 9 }, { id: 'r1', content: '重复' }, { id: 'r2', content: '  ' }] },
            badPrice: { ...sample(), id: 'badPrice', priceCents: 0 },
            floatPrice: { ...sample(), id: 'floatPrice', priceCents: 29.9 },
            noShop: { ...sample(), id: 'noShop', shop: ' ' },
            mismatch: { ...sample(), id: 'other' },
            __proto__x: { ...sample(), id: '__proto__x' },
        },
        itemOrder: ['good', 'good', 'badPrice', 'floatPrice', 'noShop', 'mismatch', 'missing', '__proto__x'],
        cart: [{ id: 'c1', itemId: 'good', spec: 'nope', quantity: 500, checked: 1 }, { id: 'c2', itemId: 'good', spec: 'A' }, { id: 'c3', itemId: 'missing' }],
        orders: [{ id: 'o1', itemId: 'good', title: 't', shop: 's', priceCents: 100, status: 'lost' }, { id: 'o2', itemId: 'good', title: 't', shop: 's', priceCents: 100, status: 'shipped', quantity: 0, createdAt: 50, updatedAt: 10 }],
        nsfw: 'true',
    };
    const scope = normalizeShopScope(raw);
    assert.deepEqual(scope.itemOrder, ['good', '__proto__x'], '重复、价格非法、缺店铺、id 不符、不存在的都丢掉');
    const good = scope.items.good;
    assert.deepEqual(good.specs, ['A', 'B', 'C', 'D'], '规格去重、去空、最多 4 个');
    assert.equal(Object.hasOwn(good, 'favorite'), false, '收藏只认 true');
    assert.deepEqual(good.source, { type: 'igs', floor: 3, key: 'igs:1' }, '保留 IGS 来源字段');
    assert.deepEqual(good.reviews.map(review => [review.id, review.rating]), [['r1', 5]], '评价 id 去重、空内容丢弃、非法星级回落 5 星');
    assert.deepEqual(scope.cart, [{ id: 'c1', itemId: 'good', spec: 'A', quantity: 99, checked: false }], '规格不存在回落第一个，数量封顶，同一规格只留一行');
    assert.deepEqual(scope.orders.map(order => [order.id, order.quantity, order.updatedAt]), [['o2', 1, 50]], '非法状态丢弃，数量至少 1，updatedAt 不早于 createdAt');
    assert.equal(Object.hasOwn(scope, 'nsfw'), false);
    assert.equal(normalizeShopScope({ ...raw, nsfw: true }).nsfw, true);
    assert.equal(model.normalizeShopSource({ type: 'igs', floor: -1, key: 'k' }), null);
    assert.equal(model.normalizeShopSource({ type: 'other', floor: 1, key: 'k' }), null);
});
await check('归一化：版本不符、scope 键非法时得到空 store', () => {
    assert.deepEqual(normalizeShopStore({ version: 2, scopes: { a: {} } }), createEmptyShopStore());
    assert.deepEqual(normalizeShopStore(null), createEmptyShopStore());
    assert.deepEqual(Object.keys(normalizeShopStore({ version: 1, scopes: { ' bad': {}, __proto__: {}, ok: {} } }).scopes), ['ok']);
});
// ===== 商品与收藏 =====
await check('上新：新商品排最前，超出上限先删最旧的未收藏、不在购物车的商品', () => {
    const scope = createEmptyShopScope();
    addShopItems(scope, [sample({ title: '最旧' })], { now: 1, makeId });
    const oldestId = scope.itemOrder[0];
    addShopItems(scope, [sample({ title: '次旧' })], { now: 2, makeId });
    const secondId = scope.itemOrder[0];
    toggleShopFavorite(scope, oldestId);
    for (let index = 0; index < SHOP_LIMITS.items - 2; index += 1) addShopItems(scope, [sample({ title: `商品${index}` })], { now: 3 + index, makeId });
    assert.equal(scope.itemOrder.length, SHOP_LIMITS.items);
    const added = addShopItems(scope, [sample({ title: '最新' })], { now: 999, makeId });
    assert.equal(scope.itemOrder[0], added[0].id);
    assert.equal(scope.itemOrder.length, SHOP_LIMITS.items);
    assert.ok(scope.items[oldestId], '收藏的商品保留');
    assert.equal(scope.items[secondId], undefined, '最旧的未收藏商品被删');
});
await check('收藏切换与搜索', () => {
    const scope = scopeWith(sample(), sample({ title: '静音耳塞 隔壁弹钢琴专用', name: '静音耳塞', shop: '失眠者联盟', category: '数码', query: '会飞的雨伞' }));
    const [boots, earplugs] = scope.itemOrder;
    assert.equal(toggleShopFavorite(scope, boots), true);
    assert.equal(toggleShopFavorite(scope, boots), false);
    assert.equal(Object.hasOwn(scope.items[boots], 'favorite'), false);
    assert.deepEqual(searchShopItems(scope, '雨鞋 防滑').map(item => item.id), [boots], '多个词都要命中');
    assert.deepEqual(searchShopItems(scope, '会飞的雨伞').map(item => item.id), [earplugs], '上新时的搜索词也能搜到');
    assert.deepEqual(searchShopItems(scope, '  '), []);
    assert.throws(() => toggleShopFavorite(scope, 'item_missing'), /商品不存在/);
});
await check('更多评价：追加到上限为止', () => {
    const scope = scopeWith();
    const id = scope.itemOrder[0];
    const many = Array.from({ length: 40 }, (_, index) => ({ author: `买家${index}`, rating: 3, content: `评价${index}` }));
    const added = addShopReviews(scope, id, many, { now: 5, makeId });
    assert.equal(scope.items[id].reviews.length, SHOP_LIMITS.reviews);
    assert.equal(added.length, SHOP_LIMITS.reviews - 1);
    assert.equal(addShopReviews(scope, id, many, { makeId }).length, 0);
});

// ===== 购物车 =====
await check('购物车：同规格合并、改数量封顶、勾选与合计', () => {
    const scope = scopeWith(sample(), sample({ title: '晴天娃娃 不晴包退', name: '晴天娃娃', shop: '玄学实验室', priceCents: 990, originalCents: undefined, specs: ['加急开光'] }));
    const [boots, doll] = scope.itemOrder;
    const first = addToShopCart(scope, { itemId: boots, spec: '透明M' }, { makeId });
    addToShopCart(scope, { itemId: boots, spec: '透明M', quantity: 2 }, { makeId });
    assert.equal(scope.cart.length, 1, '同一商品同一规格合并成一行');
    assert.equal(first.quantity, 3);
    addToShopCart(scope, { itemId: boots, spec: '不存在' }, { makeId });
    assert.equal(scope.cart[0].spec, '透明S', '规格不存在时用第一个规格');
    const dollEntry = addToShopCart(scope, { itemId: doll }, { makeId });
    assert.equal(setShopCartQuantity(scope, dollEntry.id, 0), 1, '数量至少 1');
    assert.equal(setShopCartQuantity(scope, dollEntry.id, 1000), SHOP_LIMITS.quantity);
    setShopCartQuantity(scope, dollEntry.id, 2);
    let summary = summarizeShopCart(scope);
    assert.deepEqual(summary.groups.map(group => group.shop), ['玄学实验室', '雨城东区防水铺'], '按店铺分组，最近加入的在前');
    assert.equal(summary.checkedCount, 3);
    assert.equal(summary.totalCents, 990 * 2 + 2990 * 3 + 2990);
    assert.equal(summary.savedCents, (5900 - 2990) * 4, '已优惠按原价差额算');
    assert.equal(formatShopPrice(summary.totalCents), '139.4');
    toggleShopCartEntry(scope, dollEntry.id);
    summary = summarizeShopCart(scope);
    assert.equal(summary.totalCents, 2990 * 4, '取消勾选不计入合计');
    assert.equal(summary.allChecked, false);
    assert.equal(toggleShopCartGroup(scope), true, '全选：有未选时全部选上');
    assert.equal(toggleShopCartGroup(scope), false, '全选：全部已选时全部取消');
    assert.equal(toggleShopCartGroup(scope, '玄学实验室'), true);
    assert.deepEqual(scope.cart.map(entry => entry.checked), [true, false, false]);
    assert.equal(removeShopCartEntries(scope, [dollEntry.id]), 1);
    assert.throws(() => setShopCartQuantity(scope, dollEntry.id, 2), /购物车里没有/);
});
await check('购物车上限', () => {
    const scope = createEmptyShopScope();
    const items = addShopItems(scope, Array.from({ length: SHOP_LIMITS.cart + 1 }, (_, index) => sample({ title: `商品${index}` })), { makeId });
    items.slice(0, SHOP_LIMITS.cart).forEach(item => addToShopCart(scope, { itemId: item.id }, { makeId }));
    assert.throws(() => addToShopCart(scope, { itemId: items.at(-1).id }, { makeId }), /最多放/);
});

// ===== 订单 =====
await check('下单与确认收货：待发货 → 待收货 → 已完成，只能手动推进', () => {
    const scope = scopeWith();
    const id = scope.itemOrder[0];
    const order = placeShopOrder(scope, { itemId: id, spec: '透明M', quantity: 2 }, { now: 100, makeId });
    assert.deepEqual([order.status, order.spec, order.quantity, order.priceCents, order.name], ['pending', '透明M', 2, 2990, '透明雨鞋套']);
    assert.equal(advanceShopOrder(scope, order.id, { now: 200 }), 'shipped');
    assert.equal(advanceShopOrder(scope, order.id, { now: 300 }), 'done');
    assert.equal(order.updatedAt, 300);
    assert.throws(() => advanceShopOrder(scope, order.id), /订单已完成/);
    delete scope.items[id];
    assert.deepEqual(normalizeShopScope(clone(scope)).orders[0].title, sample().title, '订单存商品快照，商品删了也还在');
});
await check('结算：勾选的生成订单并移出购物车，顺序与购物车一致', () => {
    const scope = scopeWith(sample(), sample({ title: '静音耳塞', shop: '失眠者联盟', priceCents: 1280 }));
    const [boots, earplugs] = scope.itemOrder;
    addToShopCart(scope, { itemId: boots }, { makeId });
    const second = addToShopCart(scope, { itemId: earplugs }, { makeId });
    toggleShopCartEntry(scope, second.id);
    addToShopCart(scope, { itemId: earplugs, spec: '透明M' }, { makeId });
    const orders = checkoutShopCart(scope, { now: 5, makeId });
    assert.equal(orders.length, 2);
    assert.deepEqual(scope.orders.map(order => order.id), orders.map(order => order.id));
    assert.deepEqual(scope.cart.map(entry => entry.id), [second.id], '没勾选的留在购物车');
    toggleShopCartEntry(scope, second.id);
    toggleShopCartEntry(scope, second.id);
    assert.throws(() => checkoutShopCart(scope), /请先勾选/);
});
await check('订单上限：先删已完成的', () => {
    const scope = scopeWith();
    const id = scope.itemOrder[0];
    const done = placeShopOrder(scope, { itemId: id }, { makeId });
    advanceShopOrder(scope, done.id);
    advanceShopOrder(scope, done.id);
    for (let index = 0; index < SHOP_LIMITS.orders; index += 1) placeShopOrder(scope, { itemId: id }, { makeId });
    assert.equal(scope.orders.length, SHOP_LIMITS.orders);
    assert.equal(scope.orders.some(order => order.id === done.id), false);
});
await check('数字格式', () => {
    assert.deepEqual([2990, 2900, 2905, 100, 0, 1].map(formatShopPrice), ['29.9', '29', '29.05', '1', '0', '0.01']);
    assert.deepEqual([23456, 8641, 120000, 999].map(formatShopCount), ['2.3万', '8,641', '12万', '999']);
});

// ===== 上新与评价：提示词 =====
const context = { context: '林晚在雨城拍戏，东区地铁停运。', worldBookText: '雨城是一座常年下雨的城市。', actorRoster: ['林晚'] };
await check('上新提示词：信封 version 2、搜索词、分类、真名「淘宝」、成人开关', () => {
    const byQuery = buildShopRequest({ kind: 'shop_items', nsfw: false, ...context, query: '会飞的雨伞' });
    assert.match(byQuery.systemPrompt, /"version":2,"kind":"shop_items"/);
    assert.match(byQuery.systemPrompt, /淘宝/);
    assert.match(byQuery.userPrompt, /买家搜索了「会飞的雨伞」/);
    assert.match(byQuery.userPrompt, /4-6 件商品/);
    assert.match(byQuery.userPrompt, /好评，有差评吐槽，也有阴阳怪气/);
    assert.match(byQuery.userPrompt, /<world_context_data encoding="json-string">/);
    assert.match(byQuery.userPrompt, /林晚/);
    assert.match(byQuery.userPrompt, /内容尺度：全年龄/);
    assert.match(buildShopRequest({ kind: 'shop_items', ...context, category: '玄学' }).userPrompt, /「玄学」分类下的商品/);
    assert.match(buildShopRequest({ kind: 'shop_items', ...context }).userPrompt, /首页推荐商品/);
    assert.throws(() => buildShopRequest({ kind: 'feed_batch', ...context }), /不支持/);
});
await check('成人开关只影响提示词：两种状态只差内容尺度一行，解析结果相同', () => {
    const off = buildShopRequest({ kind: 'shop_items', nsfw: false, ...context, query: '雨伞' });
    const on = buildShopRequest({ kind: 'shop_items', nsfw: true, ...context, query: '雨伞' });
    assert.equal(on.systemPrompt, off.systemPrompt);
    assert.match(on.userPrompt, /内容尺度：成人模式/);
    const strip = text => text.replace(/内容尺度：[^\n]*/, '');
    assert.equal(strip(on.userPrompt), strip(off.userPrompt));
    const raw = envelope('shop_items', [{ title: '成人向商品', shop: '某店', price: 9.9, specs: ['默认款'] }]);
    assert.deepEqual(parseShopResponse(raw, 'shop_items'), parseShopResponse(raw, 'shop_items'), '解析侧不看成人开关，不做内容过滤');
});
await check('评价提示词：带商品数据、已有评价、买家秀', () => {
    const scope = scopeWith();
    const item = Object.values(scope.items)[0];
    const prompts = buildShopRequest({ kind: 'shop_reviews', nsfw: false, ...context, item });
    assert.match(prompts.systemPrompt, /"kind":"shop_reviews"/);
    assert.match(prompts.userPrompt, /<item_data encoding="json-string">/);
    assert.match(prompts.userPrompt, /苏小满/);
    assert.match(prompts.userPrompt, /买家秀/);
    assert.match(prompts.userPrompt, /4-6 条新评价/);
});

// ===== 上新与评价：解析 =====
await check('解析上新：信封校验、价格转分、字段清洗、条数上限', () => {
    assert.throws(() => parseShopResponse('不是 JSON', 'shop_items'), /JSON/);
    assert.throws(() => parseShopResponse(envelope('shop_reviews', []), 'shop_items'), /协议不匹配|JSON/);
    assert.throws(() => parseShopResponse(JSON.stringify({ version: 1, kind: 'shop_items', items: [] }), 'shop_items'), /协议不匹配|JSON/);
    assert.throws(() => parseShopResponse(envelope('shop_items', [], { meta: {} }), 'shop_items'), /额外字段/);
    const good = {
        title: ' 会飞的雨伞 自带螺旋桨 ', name: '会飞雨伞', shop: '东区黑科技', category: '数码', price: '¥59.9', originalPrice: 99, origin: '雨城',
        image: '一把伞飘在半空', services: ['包邮', '包邮', '运费险', '极速退款', '多余'], badge: '新品', specs: ['黑色', '黑色', '', '透明', '粉色', '蓝色', '绿色'],
        reviews: [{ author: '海盐', rating: '4', spec: '黑色', content: '飞起来了', followup: { after: '三天后', content: '飞走了' } }, { author: '路人', rating: 9, spec: '不存在', content: '还行' }, { content: '' }, { author: 'x', content: 'y', actorId: 'a' }],
    };
    const items = parseShopResponse(envelope('shop_items', [
        good, { ...good, price: 0 }, { ...good, price: 'abc' }, { ...good, shop: '' }, { ...good, authorId: 'x' }, 'not object',
        { title: '最少字段', shop: '小店', price: 1 }, ...Array.from({ length: 6 }, () => ({ title: '凑数', shop: '店', price: 2 })),
    ]), 'shop_items', { query: '会飞的雨伞' });
    assert.equal(items.length, 6, '最多 6 件');
    const [first, minimal] = items;
    assert.deepEqual([first.title, first.priceCents, first.originalCents, first.image, first.query], ['会飞的雨伞 自带螺旋桨', 5990, 9900, { desc: '一把伞飘在半空' }, '会飞的雨伞']);
    assert.deepEqual(first.services, ['包邮', '运费险', '极速退款']);
    assert.deepEqual(first.specs, ['黑色', '透明', '粉色', '蓝色']);
    assert.deepEqual(first.reviews.map(review => [review.rating, review.spec ?? null, !!review.followup]), [[4, '黑色', true], [5, null, false]], '星级非法回落 5、规格对不上不写规格、空评价与带内部 id 的丢弃');
    assert.deepEqual(minimal.specs, ['默认'], '没有规格时给一个默认规格');
    assert.equal(Object.hasOwn(minimal, 'originalCents'), false);
    assert.equal(Object.hasOwn(parseShopResponse(envelope('shop_items', [{ ...good, originalPrice: 10 }]), 'shop_items')[0], 'originalCents'), false, '原价不高于售价时丢弃');
    assert.throws(() => parseShopResponse(envelope('shop_items', [{ title: '', shop: '', price: 1 }]), 'shop_items'), /未返回有效内容/);
    assert.deepEqual([shopPriceToCents('29.9元'), shopPriceToCents(-1), shopPriceToCents(1e9), shopPriceToCents({})], [2990, 0, 0, 0]);
});
await check('解析评价：规格对不上就不写规格，最多 6 条', () => {
    const reviews = parseShopResponse(envelope('shop_reviews', [
        { author: '甲', rating: 1, spec: '透明M', content: '差评' },
        { author: '乙', rating: 3, spec: '火星款', content: '一般' },
        ...Array.from({ length: 8 }, (_, index) => ({ author: `丙${index}`, rating: 5, content: '好评' })),
    ]), 'shop_reviews', { specs: ['透明S', '透明M'] });
    assert.equal(reviews.length, 6);
    assert.equal(reviews[0].spec, '透明M');
    assert.equal(Object.hasOwn(reviews[1], 'spec'), false);
});
// ===== 告诉剧情：上下文注入 =====
await check('告诉剧情：只有点过的订单进注入，文本写明店铺、商品、规格、数量与状态', () => {
    const scope = scopeWith();
    const id = scope.itemOrder[0];
    const silent = placeShopOrder(scope, { itemId: id }, { makeId });
    const told = placeShopOrder(scope, { itemId: id, spec: '透明M', quantity: 2 }, { makeId });
    assert.equal(renderShopInjection(scope, '阿晴'), '', '没点「告诉剧情」时不注入');
    markShopOrderTold(scope, told.id);
    assert.equal(renderShopInjection(scope, '阿晴'), '阿晴在桃宝的「雨城东区防水铺」买了透明雨鞋套（透明M×2，¥59.8），还没发货。');
    advanceShopOrder(scope, told.id);
    assert.match(renderShopInjection(scope, '阿晴'), /正在路上。$/);
    assert.equal(renderShopInjection(scope, '').startsWith('我在桃宝'), true);
    assert.equal(scope.orders.find(order => order.id === silent.id).told, undefined);
    for (let index = 0; index < 12; index += 1) markShopOrderTold(scope, placeShopOrder(scope, { itemId: id }, { makeId }).id);
    assert.equal(renderShopInjection(scope, '我').split('\n').length, SHOP_LIMITS.toldInjection, '只注入最近几条');
});
await check('告诉剧情：进上下文注入计划，带标题与预算诊断', () => {
    const scope = scopeWith();
    const order = placeShopOrder(scope, { itemId: scope.itemOrder[0] }, { makeId });
    const base = { currentStorageId: 'story', currentActorName: '林晚', userName: '阿晴', selectedByStorage: {}, historiesByStorage: {}, groupsByStorage: {} };
    const shopStore = { version: 1, scopes: { story: scope } };
    const before = buildContextInjectionPrompts({ ...base, shopStore });
    assert.equal(before.prompts.some(prompt => prompt.source === 'shop'), false);
    assert.equal(Object.hasOwn(before.diagnostics, 'shop'), false, '没有可注入的购物时诊断不多出字段');
    markShopOrderTold(scope, order.id);
    const plan = buildContextInjectionPrompts({ ...base, shopStore });
    const prompt = plan.prompts.find(item => item.source === 'shop');
    assert.ok(prompt, '点过「告诉剧情」后进注入');
    assert.match(prompt.key, /:shop:story$/);
    assert.match(prompt.content, /^\[桃宝购物记录 — 当前角色可见\]\n阿晴在桃宝的「雨城东区防水铺」买了透明雨鞋套/);
    assert.match(prompt.content, /\n\[结束\]$/);
    assert.equal(plan.diagnostics.shop.promptCount, 1);
    assert.ok(plan.diagnostics.usedTokens >= plan.diagnostics.shop.usedTokens);
    const other = buildContextInjectionPrompts({ ...base, currentStorageId: 'other', shopStore });
    assert.equal(other.prompts.some(item => item.source === 'shop'), false, '只注入当前会话的购物');
    const tight = buildContextInjectionPrompts({ ...base, shopStore, safeMaxTokens: 5 });
    assert.equal(tight.prompts.some(item => item.source === 'shop'), false, '超出预算时不注入');
    assert.match(tight.diagnostics.shop.rejected, /超过本轮可用上下文预算/);
});

// ===== 备份往返 =====
await check('备份：shop 字段往返、拒绝非规范内容、旧备份保留现有数据', () => {
    const scope = scopeWith();
    placeShopOrder(scope, { itemId: scope.itemOrder[0] }, { makeId });
    const shop = { version: 1, scopes: { story: scope } };
    const exported = JSON.parse(JSON.stringify({ schemaVersion: 3, shop }));
    const current = { theme: {}, shop: createEmptyShopStore(), shopUnreadable: true };
    const imported = parseBackupData(exported, current);
    assert.deepEqual(imported.shop, shop);
    assert.equal(Object.hasOwn(imported, 'shopUnreadable'), false, '备份带了桃宝数据时按备份写入');
    assert.deepEqual(parseBackupData({ schemaVersion: 3 }, { theme: {}, shop }).shop, shop, '旧备份没有 shop 时保留现有数据');
    const bad = clone(exported);
    bad.shop.scopes.story.items[scope.itemOrder[0]].priceCents = -5;
    assert.throws(() => parseBackupData(bad, current), /shop 内容无效/);
    assert.throws(() => parseBackupData({ schemaVersion: 3, shop: { version: 9, scopes: {} } }, current), /shop\.version/);
    assert.throws(() => parseBackupData({ schemaVersion: 3, shop: [] }, current), /shop 必须是对象/);
});
await check('备份导出、清理数据与空状态都带上桃宝', async () => {
    assert.ok(PLUGIN_IDB_STATIC_KEYS.includes(SHOP_STORE_KEY));
    assert.ok(PLUGIN_LOCAL_STORAGE_KEYS.includes(SHOP_FALLBACK_KEY));
    const controller = await readFile(new URL('../src/settings-backup-controller.js', import.meta.url), 'utf8');
    assert.match(controller, /shop: snapshot\.shopUnreadable \? undefined : snapshot\.shop/);
    const backup = await readFile(new URL('../src/settings-backup.js', import.meta.url), 'utf8');
    assert.match(backup, /if \(!state\.shopUnreadable\) await saveShopStore/, '读不懂的桃宝数据不被覆盖');
    const settingsUi = await readFile(new URL('../src/settings-ui.js', import.meta.url), 'utf8');
    assert.match(settingsUi, /shop: createEmptyShopStore\(\)/, '清理数据后的空状态含桃宝');
});

// ===== 存储 =====
await check('存储：读不懂的数据只读不覆盖，IndexedDB 失败时写本地后备', async () => {
    const storage = { data: new Map(), getItem(key) { return this.data.get(key) ?? null; }, setItem(key, value) { this.data.set(key, value); }, removeItem(key) { this.data.delete(key); } };
    const garbage = await loadShopStore({ idbRead: async () => ({ ok: true, value: { version: 7 } }), storage });
    assert.equal(garbage.writable, false);
    assert.match(garbage.warning, /原始数据未覆盖/);
    const empty = await loadShopStore({ idbRead: async () => ({ ok: true, value: undefined }), storage });
    assert.deepEqual([empty.writable, empty.store], [true, createEmptyShopStore()]);
    const store = { version: 1, scopes: { story: scopeWith() } };
    assert.equal(await saveShopStore(store, { idbSet: async () => false, storage }), true);
    assert.deepEqual(JSON.parse(storage.getItem(SHOP_FALLBACK_KEY)), store);
    const restored = await loadShopStore({ idbRead: async () => ({ ok: false }), storage });
    assert.deepEqual([restored.writable, restored.store], [true, store]);
    storage.setItem(SHOP_FALLBACK_KEY, '{broken');
    assert.equal((await loadShopStore({ idbRead: async () => ({ ok: false }), storage })).writable, false);
    await saveShopStore(store, { idbSet: async () => true, storage });
    assert.equal(storage.getItem(SHOP_FALLBACK_KEY), null, 'IndexedDB 写成功后删掉本地后备');
    await assert.rejects(saveShopStore(store, { idbSet: async () => false, storage: { setItem() { throw new Error('quota'); } } }), /均不可用/);
});

// ===== 页面 =====
const viewScope = () => {
    const scope = scopeWith(sample(), sample({ title: '<b>静音耳塞</b>', name: '静音耳塞', shop: '失眠者联盟', category: '数码' }));
    placeShopOrder(scope, { itemId: scope.itemOrder[0] }, { makeId });
    addToShopCart(scope, { itemId: scope.itemOrder[1] }, { makeId });
    return scope;
};
await check('页面：每个视图都有内容，不写内联样式，转义用户内容', () => {
    const scope = viewScope();
    const base = { itemId: scope.itemOrder[1], query: '会飞的雨伞', list: scope.itemOrder.map(id => scope.items[id]) };
    for (const view of ['home', 'list', 'search-empty', 'item', 'reviews', 'cart', 'orders', 'mine']) {
        const html = renderShopPage(scope, { ...base, view });
        assert.match(html, new RegExp(`^<div class="pm-shop-shell" data-shop-view="${view}">`));
        assert.doesNotMatch(html, /style="/, `${view} 不写内联样式`);
        assert.doesNotMatch(html, /<b>静音耳塞<\/b>/, `${view} 转义商品标题`);
    }
    assert.equal(renderShopPage(scope, { view: 'item', itemId: 'item_missing' }), '');
});
await check('页面：顶栏左右等宽三栏，标题与小标语', () => {
    const html = renderShopPage(viewScope(), { view: 'home' });
    assert.match(html, /<header class="pm-shop-topbar"><div class="pm-shop-topbar-side">[\s\S]*?<\/div><h2 class="pm-shop-heading">桃宝<small>亲，包邮哦<\/small><\/h2><div class="pm-shop-topbar-side is-end">/);
    const css = renderShopPage(viewScope(), { view: 'cart' });
    assert.match(css, /<h2 class="pm-shop-heading">购物车<small>共1件<\/small><\/h2>/);
});
await check('页面：首页四栏、分类胶囊真筛选、AI上新胶囊', () => {
    const scope = viewScope();
    const home = renderShopPage(scope, { view: 'home' });
    assert.deepEqual([...home.matchAll(/class="pm-shop-tab"[^>]*>[\s\S]*?<span>([^<]+)<\/span>/g)].map(match => match[1]), ['首页', '购物车', '订单', '我的']);
    assert.match(home, /data-category="推荐" aria-pressed="true"/);
    assert.match(home, /AI上新/);
    const filtered = renderShopPage(scope, { view: 'home', category: '数码' });
    assert.equal((filtered.match(/class="pm-shop-card"/g) || []).length, 1);
    assert.match(home, /月销[\d,.万]+/);
});
await check('页面：商品页底栏照搬淘宝——店铺、收藏两个图标加两个大按钮', () => {
    const scope = viewScope();
    const html = renderShopPage(scope, { view: 'item', itemId: scope.itemOrder[0], spec: '透明M' });
    const bar = html.slice(html.indexOf('pm-shop-buybar'));
    assert.deepEqual([...bar.matchAll(/data-shop-action="([\w-]+)"/g)].map(match => match[1]), ['open-shop', 'favorite', 'add-cart', 'buy-now']);
    assert.match(bar, /<span>店铺<\/span>[\s\S]*<span>收藏<\/span>[\s\S]*加入购物车[\s\S]*立即购买/);
    assert.match(html, /data-spec="透明M" aria-pressed="true"/);
    assert.match(html, /追评 · 两周后/);
    assert.match(html, /实拍：透明雨鞋套/);
    assert.match(html, /<s class="pm-shop-original">¥59<\/s>/);
});
await check('页面：订单三栏、告诉剧情、只能手动推进', () => {
    const scope = viewScope();
    const html = renderShopPage(scope, { view: 'orders', orderTab: 'pending' });
    assert.deepEqual([...html.matchAll(/role="tab"[^>]*>([^<]+)/g)].map(match => match[1]), ['待发货', '待收货', '已完成']);
    assert.match(html, /无真实支付/);
    assert.match(html, /data-shop-action="tell-order"/);
    assert.match(html, />提醒发货</);
    advanceShopOrder(scope, scope.orders[0].id);
    assert.match(renderShopPage(scope, { view: 'orders', orderTab: 'shipped' }), />确认收货</);
    markShopOrderTold(scope, scope.orders[0].id);
    assert.match(renderShopPage(scope, { view: 'orders', orderTab: 'shipped' }), /已告诉剧情/);
});
await check('页面：搜不到时让AI上新，带搜索词', () => {
    const html = renderShopPage(viewScope(), { view: 'search-empty', query: '会飞的雨伞' });
    assert.match(html, /桃宝里暂时没有「会飞的雨伞」/);
    assert.match(html, /data-shop-action="generate" data-query="会飞的雨伞"/);
    assert.match(html, /换个词搜/);
    assert.match(html, /data-category="家居"/, '建议词来自已有分类');
});
// ===== 桌面与挂载 =====
await check('桌面：桃宝图标纯线条、可换自定义图标、页面已登记', async () => {
    const desktop = renderPhoneDesktop({ scenes: {} }, { pinnedSceneIds: [] });
    assert.match(desktop, /data-app="shop" data-action="desktop-shop" aria-label="桃宝"/);
    assert.match(desktop, /<span class="pm-desktop-app-label">桃宝<\/span>/);
    assert.doesNotMatch(SHOP_APP_ICON_SVG, /fill="currentColor"/, '桌面图标统一纯线条');
    assert.match(SHOP_APP_ICON_SVG, /fill="none"/);
    assert.ok(DESKTOP_ICON_IDS.includes('shop'));
    assert.ok(PHONE_UI_PAGES.includes('shop'));
    const scenes = await readFile(new URL('../src/interactive-scenes.js', import.meta.url), 'utf8');
    assert.match(scenes, /action === 'desktop-shop'[^\n]*window\.__pmOpenShopApp/);
    assert.match(scenes, /uiScope\.lastPage === 'shop' && await deps\.showShopPage\?\.\(\{ resume: true \}\)/);
    assert.ok(scenes.split('\n').length <= 800, 'interactive-scenes.js 不超过 800 行');
    const lifecycle = await readFile(new URL('../src/phone-lifecycle.js', import.meta.url), 'utf8');
    assert.match(lifecycle, /installShopApp\(state, deps\);/);
});

// ===== App 控制器 =====
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
function makeApp() {
    const listeners = {};
    const page = { innerHTML: '', hidden: true, dataset: {}, addEventListener: (type, fn) => { listeners[type] = fn; }, querySelector: () => null };
    let attached = false;
    const main = { querySelector: selector => (selector === '[data-phone-page="shop"]' && attached ? page : null), appendChild: () => { attached = true; } };
    globalThis.document = { createElement: () => page };
    const phoneWindow = { querySelector: selector => (selector === '.pm-main-ui' ? main : main.querySelector(selector)) };
    const aiQueue = [];
    const calls = { ai: [], injection: 0, pages: [] };
    const runtime = { busy: false, requestId: 0, requestController: null };
    let storageId = 'story';
    const deps = {
        getPhoneWindow: () => phoneWindow, getStorageId: () => storageId,
        callAI: (system, user, options) => { calls.ai.push({ system, user, options }); const next = deferred(); aiQueue.push(next); return next.promise; },
        applyBidirectionalInjection: async () => { calls.injection += 1; },
        showPhoneDesktopPage: async () => { calls.pages.push('desktop'); },
        persistPhoneUiSnapshot: () => { calls.pages.push('snapshot'); },
        sceneBridge: {
            runtime, contextText: async () => ({ context: '雨城', worldBookText: '' }),
            actorSeeds: () => ({ story: { displayName: '林晚' }, user: { displayName: '我' } }),
            invalidate: () => { runtime.requestController?.abort('x'); runtime.requestController = null; runtime.requestId += 1; runtime.busy = false; },
        },
    };
    window.__pmShowPhonePage = name => { calls.pages.push(name); return name === 'shop'; };
    const app = installShopApp({}, deps);
    const button = (action, data = {}) => ({ dataset: { shopAction: action, ...data }, disabled: false, closest() { return this; } });
    const click = (action, data) => listeners.click({ target: button(action, data), preventDefault() {} });
    return { app, page, deps, runtime, calls, aiQueue, click, setStorage: value => { storageId = value; } };
}
const itemsReply = (count = 4) => envelope('shop_items', Array.from({ length: count }, (_, index) => ({ title: `雨伞${index} 防风加固`, name: `雨伞${index}`, shop: index % 2 ? '雨城东区防水铺' : '玄学实验室', category: '家居', price: 10 + index, specs: ['黑', '白'], reviews: [{ author: '海盐', rating: 4, content: '不错' }] })));
const savedScope = () => JSON.parse(memory.get(SHOP_FALLBACK_KEY) || '{"scopes":{}}').scopes.story;
await check('App：打开、上新时互斥、结果落盘、页面状态恢复', async () => {
    memory.clear();
    const shop = makeApp();
    assert.equal(await shop.app.show(), true);
    assert.deepEqual(shop.calls.pages.slice(-2), ['shop', 'snapshot'], '显示页面后记下上次页面');
    assert.match(shop.page.innerHTML, /桃宝还没有上架商品/);
    const pending = shop.click('generate', { category: '' });
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(shop.runtime.busy, true, '占用与社区、直播共用的忙碌锁');
    assert.match(shop.page.innerHTML, /正在上新…/);
    await shop.click('generate', { category: '' });
    assert.equal(shop.calls.ai.length, 1, '同一时间只跑一个生成任务');
    assert.match(shop.page.innerHTML, /已有生成任务正在进行/);
    assert.equal(shop.calls.ai[0].options.module, 'community');
    assert.match(shop.calls.ai[0].user, /首页推荐商品/);
    shop.aiQueue[0].resolve(itemsReply(5));
    await pending;
    assert.equal(shop.runtime.busy, false);
    assert.equal(savedScope().itemOrder.length, 5);
    assert.match(shop.page.innerHTML, /上新了 5 件商品/);
    assert.equal((shop.page.innerHTML.match(/class="pm-shop-card"/g) || []).length, 5);
    shop.runtime.busy = true;
    await shop.click('generate', { query: '雨伞' });
    assert.equal(shop.calls.ai.length, 1, '社区或直播在生成时不发请求');
    shop.runtime.busy = false;
    const firstItem = savedScope().itemOrder[0];
    await shop.click('open-item', { itemId: firstItem });
    assert.equal(shop.app.getView().view, 'item');
    assert.equal(await shop.app.show({ resume: true }), true);
    assert.equal(shop.app.getView().view, 'item', '重新打开手机回到上次的商品页');
    shop.setStorage('other');
    await shop.app.show({ resume: true });
    assert.equal(shop.app.getView().view, 'home', '换了会话从首页开始');
});
await check('App：切换聊天或停止时丢弃迟到的上新结果', async () => {
    memory.clear();
    const shop = makeApp();
    await shop.app.show();
    const pending = shop.click('generate', { query: '会飞的雨伞' });
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.match(shop.calls.ai[0].user, /买家搜索了「会飞的雨伞」/);
    shop.setStorage('other');
    shop.aiQueue[0].resolve(itemsReply());
    await pending;
    assert.equal(savedScope(), undefined, '会话已切换，结果不写入');
    shop.setStorage('story');
    await shop.app.show();
    const second = shop.click('generate', { query: '雨伞' });
    await new Promise(resolve => setTimeout(resolve, 0));
    await shop.click('cancel');
    shop.aiQueue[1].resolve(itemsReply());
    await second;
    assert.equal(savedScope(), undefined, '停止后迟到的结果不写入');
    assert.equal(shop.runtime.busy, false);
});
await check('App：搜到再买——加购、结算、告诉剧情、确认收货', async () => {
    memory.clear();
    const shop = makeApp();
    await shop.app.show();
    const pending = shop.click('generate', { query: '雨伞' });
    await new Promise(resolve => setTimeout(resolve, 0));
    shop.aiQueue[0].resolve(itemsReply(4));
    await pending;
    assert.equal(shop.app.getView().view, 'list', '按搜索词上新后显示搜索结果');
    const [first, second] = savedScope().itemOrder;
    await shop.click('open-item', { itemId: first });
    await shop.click('spec', { spec: '白' });
    await shop.click('add-cart');
    assert.match(shop.page.innerHTML, /已加入购物车/);
    assert.deepEqual(savedScope().cart.map(entry => [entry.itemId, entry.spec]), [[first, '白']]);
    await shop.click('favorite');
    assert.equal(savedScope().items[first].favorite, true);
    await shop.click('back');
    assert.equal(shop.app.getView().view, 'list', '返回上一页');
    await shop.click('open-item', { itemId: second });
    await shop.click('buy-now');
    assert.equal(shop.app.getView().view, 'orders');
    assert.equal(savedScope().orders.length, 1);
    await shop.click('tab', { tab: 'cart' });
    assert.match(shop.page.innerHTML, /合计/);
    await shop.click('quantity', { entryId: savedScope().cart[0].id, delta: '1' });
    assert.equal(savedScope().cart[0].quantity, 2);
    await shop.click('checkout');
    assert.equal(savedScope().cart.length, 0);
    assert.equal(savedScope().orders.length, 2);
    const orderId = savedScope().orders[0].id;
    await shop.click('tell-order', { orderId });
    assert.equal(shop.calls.injection, 1, '告诉剧情后刷新上下文注入');
    assert.equal(savedScope().orders[0].told, true);
    await shop.click('advance-order', { orderId });
    await shop.click('advance-order', { orderId });
    assert.equal(savedScope().orders[0].status, 'done');
    assert.match(shop.page.innerHTML, /已确认收货/);
    await shop.click('toggle-nsfw');
    assert.equal(savedScope().nsfw, true);
    await shop.click('desktop');
    assert.equal(shop.calls.pages.at(-1), 'desktop');
});

console.log(`Shop checks passed (${passed} checks).`);
