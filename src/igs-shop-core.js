// 与 gal 前端（IGS）联动：正文里的淘宝帖子 → 桃宝商品。纯函数，规则与社区帖子一致（见 igs-feed-core.js）：
// 帖子 = 一件商品，作者 = 店铺，附加 = 价格与销量（用 IGS 的 parseExtra 拆），reply = 评价。
// 楼层原文变了或删了：用户动过（收藏、加购、下单）的商品保留并标 stale，没动过的删掉。
import { addShopItems, SHOP_TEXT_MAX } from './shop-model.js';
import { hashText, isOwnIgsPhone, parseIgsKey } from './igs-feed-core.js';

const clip = (value, max) => Array.from(String(value ?? '').trim()).slice(0, max).join('');
const signatureOf = (title, reviewCount) => hashText(`${title}\u0000${reviewCount}`);

// 「¥9.9」「￥1,299」「12.5元」→ 分；认不出返回 0。
export function igsPriceCents(price) {
    const match = /(\d[\d,]*(?:\.\d{1,2})?)/.exec(String(price || '').replace(/[¥￥\s]/g, ''));
    if (!match) return 0;
    const cents = Math.round(Number(match[1].replace(/,/g, '')) * 100);
    return Number.isSafeInteger(cents) && cents >= 1 && cents <= 9999999 ? cents : 0;
}

// 一楼正文 → 待导入的商品条目 [{ key, floor, hash, item }]。价格认不出的帖子跳过（商品必须有价格）。
export function shopEntriesForFloor(feeds, floorInfo, userName = '') {
    const posts = feeds.collectPosts(floorInfo.text);
    const entries = [];
    for (const post of Array.isArray(posts) ? posts : []) {
        if (!post || post.platform !== 'shop' || post.kind === 'storm' || !isOwnIgsPhone(post.owner, userName)) continue;
        const title = clip(post.text, SHOP_TEXT_MAX.title);
        const priceCents = igsPriceCents(feeds.parseExtra('shop', post.extra)?.price);
        if (!title || !priceCents) continue;
        const reviews = (Array.isArray(post.replies) ? post.replies : []).flatMap(reply => {
            const content = clip(reply?.text, SHOP_TEXT_MAX.review);
            return content ? [{ author: clip(reply.author, SHOP_TEXT_MAX.author) || '匿名买家', rating: 5, content }] : [];
        });
        const offset = Number.isSafeInteger(post.offset) && post.offset >= 0 ? post.offset : entries.length;
        const key = `igs:${floorInfo.hash}:${offset}:${signatureOf(title, reviews.length)}`;
        entries.push({
            key, floor: floorInfo.floor, hash: floorInfo.hash,
            item: { title, shop: clip(post.author, SHOP_TEXT_MAX.shop) || '桃宝小店', priceCents, specs: [], services: [], reviews, source: { type: 'igs', floor: floorInfo.floor, key } },
        });
    }
    return entries;
}

// 用户动过：收藏了、在购物车里、下过单、或评价数变了（「更多评价」生成过）。
export function isIgsShopItemTouched(scope, item) {
    if (item.favorite === true) return true;
    if (scope.cart.some(entry => entry.itemId === item.id) || scope.orders.some(order => order.itemId === item.id)) return true;
    const parsed = parseIgsKey(item.source?.key);
    return !parsed || signatureOf(item.title, item.reviews.length) !== parsed.signature;
}

const importedItems = scope => scope.itemOrder.map(id => scope.items[id]).filter(item => item?.source?.type === 'igs');
const nearestFloor = (floors, previous) => floors.reduce((best, floor) => (Math.abs(floor - previous) < Math.abs(best - previous) ? floor : best), floors[0]);

// 只读预检：没有改动就不写存储。
export function igsShopHasWork(scope, index, entries) {
    const existing = new Set();
    for (const item of importedItems(scope)) {
        existing.add(item.source.key);
        const floors = index.byHash.get(parseIgsKey(item.source.key)?.hash);
        if (!floors) { if (item.source.stale !== true) return true; continue; }
        if (!floors.includes(item.source.floor) || item.source.stale === true) return true;
    }
    return entries.some(entry => !existing.has(entry.key));
}

// 对账（直接改 scope）。返回 { added, removed, staled }。
export function applyIgsShopSync(scope, { index, entries, now = Date.now(), makeId } = {}) {
    const result = { added: 0, removed: 0, staled: 0 };
    const existing = new Set();
    for (const item of importedItems(scope)) {
        const floors = index.byHash.get(parseIgsKey(item.source.key)?.hash);
        if (floors) {
            existing.add(item.source.key);
            const floor = floors.includes(item.source.floor) ? item.source.floor : nearestFloor(floors, item.source.floor);
            if (floor !== item.source.floor || item.source.stale === true) item.source = { type: 'igs', floor, key: item.source.key };
            continue;
        }
        if (item.source.stale === true) continue;
        if (isIgsShopItemTouched(scope, item)) {
            item.source = { ...item.source, stale: true };
            result.staled += 1;
        } else {
            delete scope.items[item.id];
            scope.itemOrder = scope.itemOrder.filter(id => id !== item.id);
            result.removed += 1;
        }
    }
    const fresh = entries.filter(entry => !existing.has(entry.key) && existing.add(entry.key));
    if (fresh.length) result.added = addShopItems(scope, fresh.map(entry => entry.item), { now, ...(makeId ? { makeId } : {}) }).length;
    return result;
}
