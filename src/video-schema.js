// 视频数据：限制与 v3 严格校验。
// 独立成文件：interactive-scene-model.js 已经超出体量，且这里不依赖它的内部断言（错误信息沿用「互动场景 v3 …」写法）。

export const VIDEO_LIMITS = Object.freeze({ videos: 20, scenes: 8, danmaku: 300, comments: 60, replies: 10 });
export const VIDEO_DURATION_MIN = 10;
export const VIDEO_DURATION_MAX = 1800;
export const VIDEO_TEXT_MAX = Object.freeze({
    title: 60, uploader: 80, category: 12, description: 500, desc: 200, scene: 200, danmaku: 60, comment: 1000, reply: 500, replyTo: 80,
});
export const VIDEO_KEYS = Object.freeze([
    'id', 'title', 'uploaderIsUser', 'uploaderActorId', 'uploaderNameSnapshot', 'category', 'description', 'duration', 'nsfw',
    'cover', 'scenes', 'danmaku', 'comments', 'pending', 'draft', 'createdAt', 'updatedAt',
]);
const TAG = 'v3';

const fail = (label, message) => { throw new Error(`互动场景 ${TAG} ${label} ${message}`); };
const unsafeKey = value => value === 'prototype' || Object.hasOwn(Object.prototype, value);

function assertRecord(value, label) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail(label, '必须是对象');
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) fail(label, '必须是纯数据对象');
    if (Object.getOwnPropertySymbols(value).length) fail(label, '不能包含 symbol 字段');
    for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
        if (!Object.hasOwn(descriptor, 'value')) fail(`${label}.${key}`, '不能是访问器属性');
        if (descriptor.enumerable !== true) fail(`${label}.${key}`, '必须是可枚举属性');
    }
}

function assertList(value, label, max) {
    if (!Array.isArray(value)) fail(label, '必须是数组');
    if (Object.getPrototypeOf(value) !== Array.prototype) fail(label, '必须是纯数据数组');
    if (Object.getOwnPropertySymbols(value).length) fail(label, '不能包含 symbol 字段');
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const extra = Object.keys(descriptors).find(key => key !== 'length' && !/^(0|[1-9]\d*)$/.test(key));
    if (extra) fail(label, `包含额外字段：${extra}`);
    for (let index = 0; index < value.length; index += 1) {
        if (!descriptors[index]) fail(label, '不能包含空位');
        if (!Object.hasOwn(descriptors[index], 'value')) fail(`${label}.${index}`, '不能是访问器属性');
    }
    if (Number.isInteger(max) && value.length > max) fail(label, `不能超过 ${max} 项`);
}

function assertKeys(raw, allowed, label) {
    assertRecord(raw, label);
    const extra = Object.keys(raw).find(key => !allowed.includes(key));
    if (extra) fail(label, `包含额外字段：${extra}`);
}

function assertText(value, max, label, { allowEmpty = false } = {}) {
    if (typeof value !== 'string') fail(label, '必须是字符串');
    if (value !== value.trim()) fail(label, '不能包含首尾空白');
    if (!allowEmpty && !value) fail(label, '不能为空');
    if (value.length > max) fail(label, `长度不能超过 ${max}`);
}

function assertKey(value, max, label) {
    assertText(value, max, label);
    if (unsafeKey(value)) fail(label, `包含危险键：${value}`);
}

function assertBool(value, label) {
    if (typeof value !== 'boolean') fail(label, '必须是布尔值');
}

function assertInt(value, min, max, label) {
    if (!Number.isInteger(value) || value < min || value > max) fail(label, `必须是 ${min}-${max} 的整数`);
}

function assertTimestamp(value, label) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) fail(label, '必须是有效时间戳');
}

function assertImage(value, label) {
    assertKeys(value, ['desc'], label);
    assertText(value.desc, VIDEO_TEXT_MAX.desc, `${label}.desc`);
}

function assertAuthor(raw, actors, label) {
    assertKey(raw.authorId, 80, `${label}.authorId`);
    assertText(raw.authorNameSnapshot, 80, `${label}.authorNameSnapshot`);
    if (!Object.hasOwn(actors, raw.authorId)) fail(label, `引用了不存在的 actor：${raw.authorId}`);
}

function normalizeVideo(raw, videoId, actors, scopeId) {
    const label = `scope ${scopeId}.video ${videoId}`;
    assertKeys(raw, VIDEO_KEYS, label);
    assertText(raw.id, 80, `${label}.id`);
    if (raw.id !== videoId) fail(label, 'id 必须与视频键一致');
    assertText(raw.title, VIDEO_TEXT_MAX.title, `${label}.title`);
    assertBool(raw.uploaderIsUser, `${label}.uploaderIsUser`);
    if (Object.hasOwn(raw, 'uploaderActorId')) {
        assertKey(raw.uploaderActorId, 80, `${label}.uploaderActorId`);
        if (!Object.hasOwn(actors, raw.uploaderActorId)) fail(label, `引用了不存在的 actor：${raw.uploaderActorId}`);
    }
    assertText(raw.uploaderNameSnapshot, VIDEO_TEXT_MAX.uploader, `${label}.uploaderNameSnapshot`);
    assertText(raw.category, VIDEO_TEXT_MAX.category, `${label}.category`, { allowEmpty: true });
    assertText(raw.description, VIDEO_TEXT_MAX.description, `${label}.description`, { allowEmpty: true });
    assertInt(raw.duration, VIDEO_DURATION_MIN, VIDEO_DURATION_MAX, `${label}.duration`);
    assertBool(raw.nsfw, `${label}.nsfw`);
    if (Object.hasOwn(raw, 'cover')) assertImage(raw.cover, `${label}.cover`);
    // pending：内容还没生成成功（占位视频，可重试）；draft：投稿时的选择，重试时沿用。两者缺省视为已生成。
    if (Object.hasOwn(raw, 'pending') && raw.pending !== true) fail(`${label}.pending`, '只能是 true');
    if (Object.hasOwn(raw, 'draft')) {
        assertKeys(raw.draft, ['titleTyped', 'categoryTyped', 'aiScenes'], `${label}.draft`);
        for (const key of ['titleTyped', 'categoryTyped', 'aiScenes']) assertBool(raw.draft[key], `${label}.draft.${key}`);
    }
    assertTimestamp(raw.createdAt, `${label}.createdAt`);
    assertTimestamp(raw.updatedAt, `${label}.updatedAt`);

    assertList(raw.scenes, `${label}.scenes`, VIDEO_LIMITS.scenes);
    if (!raw.scenes.length) fail(`${label}.scenes`, '至少需要 1 段');
    let previous = -1;
    const scenes = raw.scenes.map((scene, index) => {
        const sceneLabel = `${label}.scenes.${index}`;
        assertKeys(scene, ['at', 'text', 'image'], sceneLabel);
        assertInt(scene.at, 0, raw.duration - 1, `${sceneLabel}.at`);
        if (scene.at <= previous) fail(`${sceneLabel}.at`, '必须严格递增');
        previous = scene.at;
        assertText(scene.text, VIDEO_TEXT_MAX.scene, `${sceneLabel}.text`);
        if (Object.hasOwn(scene, 'image')) assertImage(scene.image, `${sceneLabel}.image`);
        return { at: scene.at, text: scene.text, ...(scene.image ? { image: { desc: scene.image.desc } } : {}) };
    });

    const ids = new Set();
    const claim = (value, itemLabel) => {
        assertKey(value, 80, `${itemLabel}.id`);
        if (ids.has(value)) fail(itemLabel, `id 重复：${value}`);
        ids.add(value);
    };
    assertList(raw.danmaku, `${label}.danmaku`, VIDEO_LIMITS.danmaku);
    const danmaku = raw.danmaku.map((item, index) => {
        const itemLabel = `${label}.danmaku.${index}`;
        assertKeys(item, ['id', 'authorId', 'authorNameSnapshot', 'content', 'at', 'createdAt'], itemLabel);
        claim(item.id, itemLabel);
        assertAuthor(item, actors, itemLabel);
        assertText(item.content, VIDEO_TEXT_MAX.danmaku, `${itemLabel}.content`);
        assertInt(item.at, 0, raw.duration, `${itemLabel}.at`);
        assertTimestamp(item.createdAt, `${itemLabel}.createdAt`);
        return { id: item.id, authorId: item.authorId, authorNameSnapshot: item.authorNameSnapshot, content: item.content, at: item.at, createdAt: item.createdAt };
    });

    assertList(raw.comments, `${label}.comments`, VIDEO_LIMITS.comments);
    const comments = raw.comments.map((comment, index) => {
        const commentLabel = `${label}.comments.${index}`;
        assertKeys(comment, ['id', 'authorId', 'authorNameSnapshot', 'content', 'createdAt', 'liked', 'replies'], commentLabel);
        claim(comment.id, commentLabel);
        assertAuthor(comment, actors, commentLabel);
        assertText(comment.content, VIDEO_TEXT_MAX.comment, `${commentLabel}.content`);
        assertTimestamp(comment.createdAt, `${commentLabel}.createdAt`);
        assertBool(comment.liked, `${commentLabel}.liked`);
        assertList(comment.replies, `${commentLabel}.replies`, VIDEO_LIMITS.replies);
        const replies = comment.replies.map((reply, replyIndex) => {
            const replyLabel = `${commentLabel}.replies.${replyIndex}`;
            assertKeys(reply, ['id', 'authorId', 'authorNameSnapshot', 'content', 'replyTo', 'createdAt'], replyLabel);
            claim(reply.id, replyLabel);
            assertAuthor(reply, actors, replyLabel);
            assertText(reply.content, VIDEO_TEXT_MAX.reply, `${replyLabel}.content`);
            if (Object.hasOwn(reply, 'replyTo')) assertText(reply.replyTo, VIDEO_TEXT_MAX.replyTo, `${replyLabel}.replyTo`);
            assertTimestamp(reply.createdAt, `${replyLabel}.createdAt`);
            return {
                id: reply.id, authorId: reply.authorId, authorNameSnapshot: reply.authorNameSnapshot, content: reply.content,
                ...(reply.replyTo ? { replyTo: reply.replyTo } : {}), createdAt: reply.createdAt,
            };
        });
        return {
            id: comment.id, authorId: comment.authorId, authorNameSnapshot: comment.authorNameSnapshot, content: comment.content,
            createdAt: comment.createdAt, liked: comment.liked, replies,
        };
    });

    return {
        id: videoId, title: raw.title, uploaderIsUser: raw.uploaderIsUser,
        ...(Object.hasOwn(raw, 'uploaderActorId') ? { uploaderActorId: raw.uploaderActorId } : {}),
        uploaderNameSnapshot: raw.uploaderNameSnapshot, category: raw.category, description: raw.description,
        duration: raw.duration, nsfw: raw.nsfw, ...(raw.cover ? { cover: { desc: raw.cover.desc } } : {}),
        ...(raw.pending === true ? { pending: true } : {}),
        ...(raw.draft ? { draft: { titleTyped: raw.draft.titleTyped, categoryTyped: raw.draft.categoryTyped, aiScenes: raw.draft.aiScenes } } : {}),
        scenes, danmaku, comments, createdAt: raw.createdAt, updatedAt: raw.updatedAt,
    };
}

// v3 scope 的 videos / videoOrder：两者都缺省视为空（已迁到 v3 的旧数据不用再迁一次）；出现其一就必须成对，规则与 liveRooms / liveOrder 一致。
export function normalizeScopeVideos(value, scope, scopeId) {
    const hasVideos = Object.hasOwn(value, 'videos');
    const hasOrder = Object.hasOwn(value, 'videoOrder');
    scope.videos = {};
    scope.videoOrder = [];
    if (!hasVideos && !hasOrder) return;
    if (hasVideos !== hasOrder) fail(`scope ${scopeId}`, 'videos 与 videoOrder 必须同时存在');
    assertRecord(value.videos, `scope ${scopeId}.videos`);
    assertList(value.videoOrder, `scope ${scopeId}.videoOrder`, VIDEO_LIMITS.videos);
    const ordered = new Set();
    for (const videoId of value.videoOrder) {
        assertKey(videoId, 80, `scope ${scopeId}.videoOrder item`);
        if (ordered.has(videoId)) fail(`scope ${scopeId}.videoOrder`, `包含重复视频：${videoId}`);
        ordered.add(videoId);
        if (!Object.hasOwn(value.videos, videoId)) fail(`scope ${scopeId}.videoOrder`, `引用了不存在的视频：${videoId}`);
    }
    const orphan = Object.keys(value.videos).find(videoId => !ordered.has(videoId));
    if (orphan) fail(`scope ${scopeId}.videos`, `包含未列入 videoOrder 的视频：${orphan}`);
    for (const videoId of value.videoOrder) scope.videos[videoId] = normalizeVideo(value.videos[videoId], videoId, scope.actors, scopeId);
    scope.videoOrder = [...value.videoOrder];
}

// ===== 生成结果的宽松清洗（解析侧和写入侧共用） =====

export const clampDuration = value => {
    const number = Math.round(Number(value));
    return Number.isFinite(number) ? Math.min(VIDEO_DURATION_MAX, Math.max(VIDEO_DURATION_MIN, number)) : 60;
};

const cleanText = (value, max) => (typeof value === 'string' ? value.trim().slice(0, max) : typeof value === 'number' && Number.isFinite(value) ? String(value).slice(0, max) : '');

// 分镜：保留 1-8 段，at 取整并要求严格递增且小于 duration，文字非空；不合格的段直接丢弃，不让整条视频失效。
export function sanitizeVideoScenes(raw, duration) {
    const limit = clampDuration(duration);
    const scenes = [];
    let previous = -1;
    for (const item of Array.isArray(raw) ? raw : []) {
        if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
        const at = Math.floor(Number(item.at));
        const text = cleanText(item.text, VIDEO_TEXT_MAX.scene);
        if (!Number.isFinite(at) || at < 0 || at >= limit || at <= previous || !text) continue;
        const desc = typeof item.image === 'string' ? cleanText(item.image, VIDEO_TEXT_MAX.desc) : cleanText(item.image?.desc, VIDEO_TEXT_MAX.desc);
        scenes.push({ at, text, ...(desc ? { image: { desc } } : {}) });
        previous = at;
        if (scenes.length >= VIDEO_LIMITS.scenes) break;
    }
    return scenes;
}

export const sanitizeVideoImage = value => {
    const desc = typeof value === 'string' ? cleanText(value, VIDEO_TEXT_MAX.desc) : cleanText(value?.desc, VIDEO_TEXT_MAX.desc);
    return desc ? { desc } : null;
};
