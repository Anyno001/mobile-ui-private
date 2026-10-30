import { parseFirstJsonObject } from './ai.js';
import { communityKindAllowsMeta, resolveCommunityPlatform } from './prompts/interactive/interactive.js';
export {
    COMMUNITY_PLATFORM_PROMPTS,
    buildCommunityRequest,
    buildInteractiveRequest,
    buildStylePrompt,
    getInteractivePresets,
} from './prompts/interactive/interactive.js';

function parseEnvelope(raw, expectedKind) {
    const value = parseFirstJsonObject(
        raw, 'AI 未返回可解析的社区 JSON',
        candidate => !!candidate && typeof candidate === 'object' && !Array.isArray(candidate)
            && candidate.version === 1 && candidate.kind === expectedKind && Array.isArray(candidate.items),
    );
    if (!value || Array.isArray(value) || value.version !== 1 || value.kind !== expectedKind || !Array.isArray(value.items)) throw new Error('AI 返回协议不匹配');
    const keys = Object.keys(value).sort();
    if (keys.length !== 3 || keys[0] !== 'items' || keys[1] !== 'kind' || keys[2] !== 'version') throw new Error('AI 返回协议包含额外字段');
    return value.items;
}

const clean = (value, max) => String(value ?? '').trim().slice(0, max);

function cleanFeedComments(value) {
    if (value === undefined) return [];
    if (!Array.isArray(value)) throw new Error('AI 返回的 comments 必须是数组');
    const comments = value.flatMap(comment => {
        if (!comment || typeof comment !== 'object' || Array.isArray(comment)) return [];
        if (Object.keys(comment).some(key => !['author', 'content'].includes(key))) return [];
        const content = clean(comment.content, 1000);
        if (!content) return [];
        return [{ author: clean(comment.author, 80) || '匿名用户', content }];
    });
    if (comments.length < 2) throw new Error('AI 返回的 comments 有效内容不足 2 条');
    return comments.slice(0, 5);
}

// 书评形态的可选字段：非法值直接丢弃，不让整条帖子失效。
function cleanReviewFields(item) {
    const work = clean(item.work, 40);
    const rating = Number(item.rating);
    return { ...(work ? { work } : {}), ...(Number.isInteger(rating) && rating >= 1 && rating <= 5 ? { rating } : {}) };
}

export function parseInteractiveResponse(raw, kind) {
    const maxItems = kind === 'style_prompt' ? 1 : kind === 'feed_batch' ? 8 : kind === 'comment_batch' ? 12 : kind === 'danmaku_batch' ? 20 : 20;
    const items = parseEnvelope(raw, kind).slice(0, maxItems).flatMap(item => {
        if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
        if (kind === 'style_prompt') {
            if (Object.keys(item).some(key => !['title', 'prompt'].includes(key))) return [];
            const prompt = clean(item.prompt, 6000);
            return prompt ? [{ title: clean(item.title, 80) || '我的社区', prompt }] : [];
        }
        const allowed = kind === 'feed_batch' ? ['author', 'content', 'tags', 'comments', 'work', 'rating'] : ['author', 'content'];
        if (Object.keys(item).some(key => !allowed.includes(key))) return [];
        const content = clean(item.content, kind === 'feed_batch' ? 4000 : kind === 'comment_batch' ? 1000 : 200);
        if (!content) return [];
        return [{
            author: clean(item.author, 80) || '匿名用户',
            content,
            tags: Array.isArray(item.tags) ? item.tags.map(tag => clean(tag, 30)).filter(Boolean).slice(0, 5) : [],
            ...(kind === 'feed_batch' ? { comments: cleanFeedComments(item.comments) } : {}),
            ...(kind === 'feed_batch' ? cleanReviewFields(item) : {}),
        }];
    });
    if (!items.length) throw new Error('AI 未返回有效内容');
    return items;
}

// ===== 版本 2 信封：按平台解析 =====

const COMMUNITY_ENVELOPE_KEYS = ['items', 'kind', 'meta', 'version'];
const FORBIDDEN_ITEM_KEYS = ['actorId', 'authorId'];
const FLAGS = ['pinned', 'featured', 'help'];
const BADGES = ['沸', '热', '新'];
const MIN_COMMENTS = { weibo: 2, review: 1, douban: 0, confess: 0, night: 0 };
const MAX_COMMENTS = { weibo: 5, douban: 8, review: 4, confess: 4, night: 3 };
const MAX_TAGS = { weibo: 3, douban: 5, review: 3, confess: 5, night: 5 };

function parseCommunityEnvelope(raw, expectedKind) {
    const value = parseFirstJsonObject(
        raw, 'AI 未返回可解析的社区 JSON',
        candidate => !!candidate && typeof candidate === 'object' && !Array.isArray(candidate)
            && candidate.version === 2 && candidate.kind === expectedKind && Array.isArray(candidate.items),
    );
    if (!value || Array.isArray(value) || value.version !== 2 || value.kind !== expectedKind || !Array.isArray(value.items)) throw new Error('AI 返回协议不匹配');
    if (Object.keys(value).some(key => !COMMUNITY_ENVELOPE_KEYS.includes(key))) throw new Error('AI 返回协议包含额外字段');
    return value;
}

// 只接受字符串与有限数字，对象、数组等不转成 "[object Object]"。
function text(value, max) {
    if (typeof value === 'number' && Number.isFinite(value)) return String(value).slice(0, max);
    return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function rating(value) {
    if (typeof value !== 'number' && typeof value !== 'string') return 0;
    const number = Number(value);
    return Number.isInteger(number) && number >= 1 && number <= 5 ? number : 0;
}

const isPlainObject = value => !!value && typeof value === 'object' && !Array.isArray(value);
const hasForbiddenKey = item => FORBIDDEN_ITEM_KEYS.some(key => Object.hasOwn(item, key));

function cleanCommunityComments(value, platform, max = MAX_COMMENTS[platform]) {
    if (!Array.isArray(value)) return [];
    return value.flatMap(comment => {
        if (!isPlainObject(comment) || hasForbiddenKey(comment)) return [];
        const content = text(comment.content, 1000);
        if (!content) return [];
        const quote = platform === 'douban' ? text(comment.quote, 80) : '';
        const score = platform === 'review' ? rating(comment.rating) : 0;
        return [{
            author: text(comment.author, 80) || '匿名用户',
            content,
            ...(quote ? { quote } : {}),
            ...(score ? { rating: score } : {}),
        }];
    }).slice(0, max);
}

function cleanTags(value, platform) {
    return Array.isArray(value) ? value.map(tag => text(tag, 30).replace(/^#+|#+$/g, '')).filter(Boolean).slice(0, MAX_TAGS[platform]) : [];
}

// 配图描述：模型可能写成字符串或 {desc}。
function imageExtra(item) {
    const desc = typeof item.image === 'string' ? text(item.image, 200) : isPlainObject(item.image) ? text(item.image.desc, 200) : '';
    return desc ? { image: { desc } } : {};
}

// 各平台帖子的专属可选字段；非法值丢弃，不让整条失效。
const FEED_EXTRAS = {
    weibo(item) {
        const repostContent = isPlainObject(item.repost) ? text(item.repost.content, 1000) : '';
        return { ...(repostContent ? { repost: { author: text(item.repost.author, 80) || '匿名用户', content: repostContent } } : {}), ...imageExtra(item) };
    },
    douban(item, state) {
        const title = text(item.title, 40);
        const flag = FLAGS.includes(item.flag) && !(item.flag === 'pinned' && state.pinned) ? item.flag : '';
        if (flag === 'pinned') state.pinned = true;
        return { ...(title ? { title } : {}), ...(flag ? { flag } : {}) };
    },
    review(item) {
        const work = text(item.work, 40);
        const workAuthor = text(item.workAuthor, 40);
        const title = text(item.title, 40);
        const score = rating(item.rating);
        return { ...(work ? { work } : {}), ...(workAuthor ? { workAuthor } : {}), ...(score ? { rating: score } : {}), ...(title ? { title } : {}), ...imageExtra(item) };
    },
    confess(item) {
        const mood = text(item.mood, 12);
        return { ...(mood ? { mood } : {}), ...imageExtra(item) };
    },
    night(item) {
        const to = text(item.to, 40);
        const sign = text(item.sign, 40);
        return { ...(to ? { to } : {}), ...(sign ? { sign } : {}) };
    },
};

function cleanCommunityFeed(items, platform) {
    const state = { pinned: false };
    return items.flatMap(item => {
        if (!isPlainObject(item) || hasForbiddenKey(item)) return [];
        const content = text(item.content, 4000);
        if (!content) return [];
        const comments = cleanCommunityComments(item.comments, platform);
        if (comments.length < MIN_COMMENTS[platform]) return [];
        return [{
            author: text(item.author, 80) || '匿名用户',
            content,
            tags: cleanTags(item.tags, platform),
            comments,
            ...FEED_EXTRAS[platform](item, state),
        }];
    }).slice(0, 8);
}

function cleanCommunityMeta(meta, kind, platform) {
    if (!isPlainObject(meta) || !communityKindAllowsMeta(kind, platform)) return {};
    if (platform === 'weibo') {
        const hot = (Array.isArray(meta.hot) ? meta.hot : []).flatMap(entry => {
            const title = isPlainObject(entry) ? text(entry.title, 30) : '';
            return title ? [{ title, badge: BADGES.includes(entry?.badge) ? entry.badge : '' }] : [];
        }).slice(0, 5);
        return hot.length ? { hot } : {};
    }
    const title = isPlainObject(meta.tonight) ? text(meta.tonight.title, 60) : '';
    return title ? { tonight: { title } } : {};
}

function cleanCommunityDanmaku(items, hostIsUser) {
    return items.flatMap(item => {
        if (!isPlainObject(item) || hasForbiddenKey(item)) return [];
        const content = text(item.content, 200);
        if (!content) return [];
        const kind = ['chat', 'host', 'gift'].includes(item.kind) ? item.kind : 'chat';
        if (hostIsUser && kind === 'host') return [];
        return [{ author: text(item.author, 80) || '匿名用户', content, kind }];
    }).slice(0, 20);
}

// options.hostIsUser 为 true 时丢弃 host 条目（主播是用户本人）。
export function parseCommunityResponse(raw, kind, platform, options = {}) {
    const key = resolveCommunityPlatform(platform);
    const envelope = parseCommunityEnvelope(raw, kind);
    let items;
    if (kind === 'style_prompt') {
        items = envelope.items.slice(0, 1).flatMap(item => {
            const prompt = isPlainObject(item) ? text(item.prompt, 6000) : '';
            return prompt ? [{ title: text(item.title, 80) || '我的社区', prompt }] : [];
        });
    }
    else if (kind === 'feed_batch') items = cleanCommunityFeed(envelope.items, key);
    else if (kind === 'comment_batch') items = cleanCommunityComments(envelope.items, key, 12);
    else if (kind === 'danmaku_batch') items = cleanCommunityDanmaku(envelope.items, options?.hostIsUser === true);
    else throw new Error(`不支持的社区生成类型：${kind}`);
    if (!items.length) throw new Error('AI 未返回有效内容');
    return { items, meta: cleanCommunityMeta(envelope.meta, kind, key) };
}
