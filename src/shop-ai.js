import { parseFirstJsonObject } from './ai.js';
import { SHOP_KINDS } from './prompts/shop/shop.js';
import { SHOP_DEFAULT_SPEC, SHOP_LIMITS, SHOP_TEXT_MAX } from './shop-model.js';

export { buildShopRequest, SHOP_KINDS } from './prompts/shop/shop.js';

// 桃宝生成结果的解析，信封照社区 version 2：顶层只有 version、kind、items。
// 只做长度、条数与类型清洗，不做内容过滤（成人开关只作用于提示词）；非法条目丢弃，不让整批失效。

const ENVELOPE_KEYS = ['items', 'kind', 'version'];
const FORBIDDEN_KEYS = ['actorId', 'authorId'];
const ITEM_RANGE = Object.freeze({ shop_items: [1, 6], shop_reviews: [1, 6] });
const isRecord = value => !!value && typeof value === 'object' && !Array.isArray(value);
const forbidden = item => FORBIDDEN_KEYS.some(key => Object.hasOwn(item, key));
const text = (value, max) => {
    if (typeof value === 'number' && Number.isFinite(value)) return String(value).slice(0, max);
    return typeof value === 'string' ? Array.from(value.trim()).slice(0, max).join('') : '';
};

function parseEnvelope(raw, kind) {
    const value = parseFirstJsonObject(
        raw, 'AI未返回可解析的桃宝JSON',
        candidate => isRecord(candidate) && candidate.version === 2 && candidate.kind === kind && Array.isArray(candidate.items),
    );
    if (!isRecord(value) || value.version !== 2 || value.kind !== kind || !Array.isArray(value.items)) throw new Error('AI返回协议不匹配');
    if (Object.keys(value).some(key => !ENVELOPE_KEYS.includes(key))) throw new Error('AI返回协议包含额外字段');
    return value.items;
}

// 元转分：接受数字或「¥29.9」「29.9元」这类字符串；超出范围或不是正数时返回 0。
export function shopPriceToCents(value) {
    const source = typeof value === 'string' ? value.replace(/[¥￥元,\s]/g, '') : value;
    if (typeof source !== 'number' && typeof source !== 'string') return 0;
    const number = Number(source);
    if (!Number.isFinite(number) || number <= 0) return 0;
    const cents = Math.round(number * 100);
    return cents >= 1 && cents <= SHOP_LIMITS.priceCents ? cents : 0;
}

const list = (value, max, limit) => [...new Set((Array.isArray(value) ? value : []).map(entry => text(entry, max)).filter(Boolean))].slice(0, limit);

function cleanReview(raw, specs) {
    if (!isRecord(raw) || forbidden(raw)) return null;
    const content = text(raw.content, SHOP_TEXT_MAX.review);
    if (!content) return null;
    const rating = Number(raw.rating);
    const spec = text(raw.spec, SHOP_TEXT_MAX.spec);
    const followupContent = isRecord(raw.followup) ? text(raw.followup.content, SHOP_TEXT_MAX.followup) : '';
    const after = followupContent ? text(raw.followup.after, SHOP_TEXT_MAX.followupAfter) : '';
    return {
        author: text(raw.author, SHOP_TEXT_MAX.author) || '匿名买家',
        rating: Number.isInteger(rating) && rating >= 1 && rating <= 5 ? rating : 5,
        ...(spec && (!specs || specs.includes(spec)) ? { spec } : {}),
        content,
        ...(followupContent ? { followup: { ...(after ? { after } : {}), content: followupContent } } : {}),
    };
}

function cleanItem(raw, query) {
    if (!isRecord(raw) || forbidden(raw)) return null;
    const title = text(raw.title, SHOP_TEXT_MAX.title);
    const shop = text(raw.shop, SHOP_TEXT_MAX.shop);
    const priceCents = shopPriceToCents(raw.price);
    if (!title || !shop || !priceCents) return null;
    const originalCents = shopPriceToCents(raw.originalPrice);
    const specs = list(raw.specs, SHOP_TEXT_MAX.spec, SHOP_LIMITS.specs);
    const finalSpecs = specs.length ? specs : [SHOP_DEFAULT_SPEC];
    const image = typeof raw.image === 'string' ? text(raw.image, SHOP_TEXT_MAX.image) : isRecord(raw.image) ? text(raw.image.desc, SHOP_TEXT_MAX.image) : '';
    const fields = {
        name: text(raw.name, SHOP_TEXT_MAX.name), category: text(raw.category, SHOP_TEXT_MAX.category),
        origin: text(raw.origin, SHOP_TEXT_MAX.origin), badge: text(raw.badge, SHOP_TEXT_MAX.badge),
    };
    return {
        title, shop, priceCents,
        ...(originalCents > priceCents ? { originalCents } : {}),
        ...Object.fromEntries(Object.entries(fields).filter(([, value]) => value)),
        ...(image ? { image: { desc: image } } : {}),
        services: list(raw.services, SHOP_TEXT_MAX.service, SHOP_LIMITS.services),
        specs: finalSpecs,
        reviews: (Array.isArray(raw.reviews) ? raw.reviews : []).map(review => cleanReview(review, finalSpecs)).filter(Boolean).slice(0, 3),
        ...(query ? { query } : {}),
    };
}

// options.query：上新时的搜索词，存进商品，搜同一个词时能找到这批商品。options.specs：评价要对上的规格表。
export function parseShopResponse(raw, kind, options = {}) {
    if (!SHOP_KINDS.includes(kind)) throw new Error(`不支持的桃宝生成类型：${kind}`);
    const [, max] = ITEM_RANGE[kind];
    const query = text(options.query, SHOP_TEXT_MAX.query);
    const entries = parseEnvelope(raw, kind);
    const items = kind === 'shop_items'
        ? entries.map(item => cleanItem(item, query)).filter(Boolean).slice(0, max)
        : entries.map(review => cleanReview(review, Array.isArray(options.specs) ? options.specs : null)).filter(Boolean).slice(0, max);
    if (!items.length) throw new Error('AI未返回有效内容');
    return items;
}
