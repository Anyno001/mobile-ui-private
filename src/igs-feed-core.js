// 与 gal 前端（IGS）联动：只读 IGS 公开接口 IGS.api.feeds 解析出的帖子，落进天音社区。
// 本文件只放纯函数（配置归一化、接口探测、楼层索引、帖子映射、对账），不碰 DOM、存储和宿主事件；
// 运行时（事件、提交、续写）在 igs-feed-sync.js。IGS 不知道天音存在，天音也不改 IGS 的任何东西。
import { COMMUNITY_PLATFORM_PROMPTS } from './prompts/interactive/interactive.js';
import { IGS_LINK_STORAGE_KEY, IGS_SYNC_PLATFORMS, INTERACTIVE_LIMITS } from './interactive-scene-constants.js';
import { appendScenePosts, normalizeScene, setSceneHot } from './interactive-scene-model.js';

export { IGS_LINK_STORAGE_KEY };
// 能用的最低接口版本；IGS 只增不破，更高版本照样能用。
export const IGS_FEEDS_MIN_VERSION = 1;
// 楼层里有这个标记才可能有社区帖子；没有的楼不交给 IGS 解析。
const IGS_MARKER = '[igs-fx:';
const KEY_PREFIX = 'igs:';

// 总开关默认关；打开时「自动同步」跟着开，「同步后自动续写」默认关（省 token）。
export const DEFAULT_IGS_LINK = Object.freeze({ enabled: false, autoSync: true, autoContinue: false });

export function normalizeIgsLinkConfig(value) {
    const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    return {
        enabled: source.enabled === true,
        autoSync: source.autoSync !== false,
        autoContinue: source.autoContinue === true,
    };
}

// 探测 IGS 接口。返回 { status: 'ready' | 'missing' | 'outdated', feeds }；读取过程中出错按 missing 处理，不抛错。
export function resolveIgsFeeds(globalObject) {
    let feeds = null;
    try { feeds = globalObject?.IGS?.api?.feeds || null; } catch { feeds = null; }
    if (!feeds) return { status: 'missing', feeds: null };
    const version = Number(feeds.version);
    if (!Number.isInteger(version) || version < IGS_FEEDS_MIN_VERSION
        || typeof feeds.collectPosts !== 'function' || typeof feeds.parseExtra !== 'function') return { status: 'outdated', feeds: null };
    return { status: 'ready', feeds };
}

export function hashText(value) {
    let hash = 2166136261;
    const source = String(value ?? '');
    for (let index = 0; index < source.length; index += 1) {
        hash ^= source.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
}

const clip = (value, max) => Array.from(String(value ?? '').trim()).slice(0, max).join('');

// 只看 AI 楼，且楼里有 IGS 标签。返回 [{ floor, hash, text }] 与 hash → 楼层号列表（同一原文可能出现在多楼）。
export function indexIgsFloors(chat) {
    const floors = [];
    const byHash = new Map();
    (Array.isArray(chat) ? chat : []).forEach((message, floor) => {
        if (!message || message.is_user === true || message.is_system === true) return;
        const text = typeof message.mes === 'string' ? message.mes : '';
        if (!text.includes(IGS_MARKER)) return;
        const hash = hashText(text);
        floors.push({ floor, hash, text });
        if (!byHash.has(hash)) byHash.set(hash, []);
        byHash.get(hash).push(floor);
    });
    return { floors, byHash };
}

// 手机主人为空、{{user}}、我、玩家名时是玩家自己的手机；写了别人的名字是偷看别人的手机，不导入。
export function isOwnIgsPhone(owner, userName = '') {
    const name = String(owner || '').trim();
    if (!name) return true;
    const user = String(userName || '').trim();
    return /^(?:\{\{user\}\}|我|玩家|自己|user)$/i.test(name) || (!!user && name === user);
}

// 导入时的指纹：正文 + 评论数。之后对不上（编辑过、评论过）就算用户动过。
const signatureOf = (content, commentCount) => hashText(`${content}\u0000${commentCount}`);

// key = igs:楼层原文哈希:标签位置:指纹。同一楼同一原文得到同样的 key，可以去重；原文变了 key 也跟着变。
export function parseIgsKey(key) {
    const match = /^igs:([0-9a-z]+):(\d+):([0-9a-z]+)$/.exec(String(key || ''));
    return match ? { hash: match[1], offset: Number(match[2]), signature: match[3] } : null;
}

// 朋友圈附加是「定位」或「仅部分可见」一类可见范围：说的是可见范围就存 audience，否则当定位。
const MOMENTS_PRIVATE = /仅(?:自己|我)可见|私密/;
const MOMENTS_PARTIAL = /部分可见|分组可见|仅.{1,12}可见|不给.{1,12}看/;
// 新闻附加「栏目与媒体」：按分隔符拆开，认得出的栏目名优先，其次取 4 字以内的一段当栏目，其余一段当媒体。
const NEWS_COLUMNS = /^(?:社会|娱乐|本地|突发|财经|体育|科技|国际|时政|军事|教育|健康|汽车|房产|生活|文化|热点|要闻|推荐|民生|法治)$/;
const NEWS_SEPARATORS = /[·・|｜/／、,，\s]+/;
const shortSegment = value => Array.from(value).length <= 4;

export function splitNewsExtra(extra) {
    const parts = String(extra || '').split(NEWS_SEPARATORS).map(part => part.trim()).filter(Boolean);
    // 只有一段且不是已知栏目时（如「雨城日报」）整段当媒体。
    const column = parts.find(part => NEWS_COLUMNS.test(part)) || (parts.length > 1 ? parts.find(shortSegment) : '') || '';
    const media = parts.find(part => part !== column) || '';
    return { column: clip(column, 12), media: clip(media, 80) };
}

// 知乎答主写成「名字，身份」：拆出身份介绍；没有逗号时整段是名字。
export function splitZhihuAuthor(author) {
    const value = String(author || '').trim();
    const index = value.search(/[，,]/);
    if (index < 0) return { name: value, bio: '' };
    return { name: value.slice(0, index).trim() || value, bio: clip(value.slice(index + 1), 30) };
}

// 小红书没写标题时取正文第一句（与 IGS 前端的 titleOf 一致，最多 22 字）。
const firstSentence = (text, max) => Array.from(String(text).split(/[。！？!?\n]/)[0].trim() || String(text).trim()).slice(0, max).join('');

const B2_EXTRA_MAPPERS = Object.freeze({
    moments(post) {
        const extra = clip(post.extra, 40);
        if (!extra) return {};
        if (MOMENTS_PRIVATE.test(extra)) return { audience: 'private' };
        return MOMENTS_PARTIAL.test(extra) ? { audience: 'partial' } : { place: extra };
    },
    xhs(post, content) {
        return { title: clip(post.extra, 40) || firstSentence(content, 22) };
    },
    zhihu(post) {
        const { name, bio } = splitZhihuAuthor(post.author);
        const question = clip(post.extra, 80);
        return { ...(name ? { author: clip(name, 80) } : {}), ...(bio ? { authorBio: bio } : {}), ...(question ? { question } : {}) };
    },
    news(post) {
        const { column, media } = splitNewsExtra(post.extra);
        return { ...(media ? { author: media } : {}), ...(column ? { column } : {}) };
    },
});

// 一楼正文 → 待导入的条目。feeds 是 IGS.api.feeds；返回 [{ platform, key, floor, hash, item, nameHint, hot }]。
// item 直接交给 appendScenePosts；文字原样保存，不改写（IGS 前端也不补本地文字）。
export function entriesForFloor(feeds, floorInfo, userName = '') {
    const posts = feeds.collectPosts(floorInfo.text);
    const entries = [];
    for (const post of Array.isArray(posts) ? posts : []) {
        if (!post || typeof post !== 'object') continue;
        const isStorm = post.kind === 'storm';
        if (!isStorm && !isOwnIgsPhone(post.owner, userName)) continue;
        // 舆论风暴没写平台时默认落进微博。
        const platform = isStorm && !post.platform ? 'weibo' : String(post.platform || '');
        if (!IGS_SYNC_PLATFORMS.includes(platform)) continue;
        const content = clip(post.text, 4000);
        if (!content) continue;
        const extra = clip(post.extra, 40);
        const comments = (Array.isArray(post.replies) ? post.replies : []).flatMap(reply => {
            const text = clip(reply?.text, 1000);
            return text ? [{ author: clip(reply.author, 80) || '匿名', content: text, ...(reply.to ? { quote: clip(reply.to, 80) } : {}) }] : [];
        });
        const offset = Number.isSafeInteger(post.offset) && post.offset >= 0 ? post.offset : entries.length;
        const key = `${KEY_PREFIX}${floorInfo.hash}:${offset}:${signatureOf(content, comments.length)}`;
        const item = {
            author: clip(post.author, 80) || '匿名', content, tags: [], comments,
            source: { type: 'igs', floor: floorInfo.floor, key },
        };
        let nameHint = '';
        let hot = null;
        if (isStorm) {
            if (extra) item.tags = [extra];
            if (extra && platform === 'weibo') hot = { title: clip(extra, 30), badge: post.tone === 'black' ? '热' : '沸' };
        } else if (platform === 'weibo' || platform === 'hupu') {
            if (extra) item.tags = [extra.replace(/^#+|#+$/g, '')].filter(Boolean);
        } else if (platform === 'review') {
            const parsed = feeds.parseExtra('review', post.extra) || {};
            const work = clip(parsed.work, 40);
            if (work) item.work = work;
            if (Number.isInteger(parsed.rating) && parsed.rating >= 1 && parsed.rating <= 5) item.rating = parsed.rating;
        } else if (B2_EXTRA_MAPPERS[platform]) {
            // 朋友圈、小红书、知乎、新闻：附加栏拆进各自字段，不当社区名。
            Object.assign(item, B2_EXTRA_MAPPERS[platform](post, content));
        } else {
            // 小组名、墙名、吧名：第一次建同步社区时用作社区名。
            nameHint = extra;
        }
        entries.push({ platform, key, floor: floorInfo.floor, hash: floorInfo.hash, item, nameHint, hot });
    }
    return entries;
}

// 用户动过：点了赞、评论数变了、或正文被编辑过（指纹对不上）。动过的帖子在原文变了以后保留并标记，不删除。
export function isIgsPostTouched(post) {
    if (post.liked === true) return true;
    const parsed = parseIgsKey(post.source?.key);
    if (!parsed) return true;
    return signatureOf(post.content, post.comments.length) !== parsed.signature;
}

function importedPosts(scope) {
    const out = [];
    for (const sceneId of scope.sceneOrder || []) {
        const scene = scope.scenes?.[sceneId];
        for (const post of scene?.posts || []) {
            if (post?.source?.type === 'igs') out.push({ scene, post });
        }
    }
    return out;
}

const nearestFloor = (floors, previous) => floors.reduce((best, floor) => (Math.abs(floor - previous) < Math.abs(best - previous) ? floor : best), floors[0]);

// 只读预检：这一轮对账会不会改动任何东西。没有改动就不提交，避免每条消息都写一次存储。
export function igsSyncHasWork(scope, index, entries) {
    const existing = new Set();
    for (const { post } of importedPosts(scope)) {
        existing.add(post.source.key);
        const parsed = parseIgsKey(post.source.key);
        const floors = parsed ? index.byHash.get(parsed.hash) : null;
        if (!floors) { if (post.source.stale !== true) return true; continue; }
        if (!floors.includes(post.source.floor) || post.source.stale === true) return true;
    }
    return entries.some(entry => !existing.has(entry.key));
}

// 找到或新建某平台的同步社区；社区数已满时返回 null，不挤掉用户已有的社区。
function syncSceneFor(scope, platform, nameHint, createId, timestamp) {
    const found = (scope.sceneOrder || []).map(id => scope.scenes[id]).find(scene => scene?.platform === platform && scene.igsSync === true);
    if (found) return { scene: found, created: false };
    if ((scope.sceneOrder || []).length >= INTERACTIVE_LIMITS.scenes) return null;
    const spec = COMMUNITY_PLATFORM_PROMPTS[platform];
    const scene = normalizeScene({
        id: createId(), title: clip(nameHint, 80) || spec.label, platform, preset: platform, nsfw: false, igsSync: true,
        styleInput: '', generatedPrompt: spec.defaultStyle, createdAt: timestamp, updatedAt: timestamp,
    });
    scope.scenes[scene.id] = scene;
    scope.sceneOrder.push(scene.id);
    if (!scope.activeSceneId) scope.activeSceneId = scene.id;
    return { scene, created: true };
}

// 对账（在提交队列的 mutator 里调用，直接改 scope）：
// 1. 已导入的帖子按楼层原文哈希找回所在楼（删楼后楼层号会前移）；原文不在了：用户动过的标记「原文已变」，没动过的删掉。
// 2. entries 里 key 还不存在的条目追加进对应平台的同步社区；没有就新建一个。
// 返回 { added, removed, staled, createdScenes, skippedPlatforms, touchedSceneIds, addedByScene（sceneId → 楼层原文哈希列表） }。
export function applyIgsSync(scope, { index, entries, scopeId, seeds = [], createId, now = Date.now() }) {
    const result = { added: 0, removed: 0, staled: 0, createdScenes: [], skippedPlatforms: [], touchedSceneIds: new Set(), addedByScene: new Map() };
    const existing = new Set();
    for (const { scene, post } of importedPosts(scope)) {
        const parsed = parseIgsKey(post.source.key);
        const floors = parsed ? index.byHash.get(parsed.hash) : null;
        if (floors) {
            existing.add(post.source.key);
            const floor = floors.includes(post.source.floor) ? post.source.floor : nearestFloor(floors, post.source.floor);
            if (floor !== post.source.floor || post.source.stale === true) {
                post.source = { type: 'igs', floor, key: post.source.key };
                result.touchedSceneIds.add(scene.id);
            }
            continue;
        }
        if (post.source.stale === true) continue;
        if (isIgsPostTouched(post)) {
            post.source = { ...post.source, stale: true };
            result.staled += 1;
        } else {
            scene.posts = scene.posts.filter(item => item !== post);
            result.removed += 1;
        }
        scene.updatedAt = now;
        result.touchedSceneIds.add(scene.id);
    }
    const byPlatform = new Map();
    for (const entry of entries) {
        if (existing.has(entry.key)) continue;
        existing.add(entry.key);
        if (!byPlatform.has(entry.platform)) byPlatform.set(entry.platform, []);
        byPlatform.get(entry.platform).push(entry);
    }
    for (const [platform, list] of byPlatform) {
        const target = syncSceneFor(scope, platform, list.find(entry => entry.nameHint)?.nameHint || '', createId, now);
        if (!target) { result.skippedPlatforms.push(platform); continue; }
        if (target.created) result.createdScenes.push(target.scene.id);
        const added = appendScenePosts(scope, scopeId, target.scene, list.map(entry => entry.item), seeds);
        const hot = list.map(entry => entry.hot).filter(Boolean);
        if (hot.length && platform === 'weibo') {
            const titles = new Set(hot.map(item => item.title));
            setSceneHot(target.scene, [...hot, ...(target.scene.hot || []).filter(item => !titles.has(item.title))]);
        }
        result.added += added.length;
        result.touchedSceneIds.add(target.scene.id);
        result.addedByScene.set(target.scene.id, [...new Set([...(result.addedByScene.get(target.scene.id) || []), ...list.map(entry => entry.hash)])]);
    }
    return result;
}

// 同步社区的生成提示：标记本社区与正文衔接，并带上最近几条帖子摘要。不是同步社区时返回空对象。
export function igsRequestExtras(scene, enabled) {
    if (enabled !== true || scene?.igsSync !== true) return {};
    const recentPosts = (scene.posts || []).slice(-8)
        .map(post => `${post.authorNameSnapshot}：${String(post.title ? `${post.title}｜${post.content}` : post.content).slice(0, 160)}`).join('\n');
    return { storyLinked: true, recentPosts };
}
