import { ensureInteractiveActor, resolveInteractiveAuthor } from './interactive-scene-model.js';
import { assignBatchTimes, mergeRespondComments } from './interactive-scene-respond.js';
import {
    VIDEO_LIMITS, VIDEO_TEXT_MAX, clampDuration, sanitizeVideoImage, sanitizeVideoScenes,
} from './video-schema.js';

export { VIDEO_LIMITS } from './video-schema.js';

// 视频的增删改与生成结果写入。作者一律经 actor 注册表解析，与社区、直播间一致；不依赖任何 DOM。

const text = (value, max) => String(value ?? '').trim().slice(0, max);
const newId = prefix => `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
const REPLY_STEP = 15_000;

// 解析作者时可能新建 actor；写入中途失败就恢复注册表，避免留下没人引用的 actor。
function withActorRollback(scope, run) {
    const snapshot = { ...(scope.actors || {}) };
    try { return run(); } catch (error) { scope.actors = snapshot; throw error; }
}

function videoStore(scope) {
    if (!scope) throw new Error('互动场景不存在');
    if (!scope.videos || typeof scope.videos !== 'object') scope.videos = {};
    if (!Array.isArray(scope.videoOrder)) scope.videoOrder = [];
    return scope;
}

export function getVideo(scope, videoId) {
    if (!scope?.videos || !Object.hasOwn(scope.videos, videoId)) throw new Error('视频不存在');
    return scope.videos[videoId];
}

function getComment(video, commentId) {
    const comment = video?.comments?.find(item => item.id === commentId);
    if (!comment) throw new Error('评论不存在');
    return comment;
}

const touch = video => { video.updatedAt = Date.now(); };

function resolveUploader(scope, scopeId, seed) {
    if (seed.uploaderSeed) {
        const actor = ensureInteractiveActor(scope, scopeId, seed.uploaderSeed);
        return { actorId: actor.actorId, name: text(seed.uploaderName, VIDEO_TEXT_MAX.uploader) || actor.displayName };
    }
    if (seed.uploaderIsUser === true) throw new Error('UP主是用户时必须提供用户身份');
    const reference = resolveInteractiveAuthor(scope, scopeId, text(seed.uploaderName, VIDEO_TEXT_MAX.uploader) || '匿名用户');
    return { actorId: reference.authorId, name: reference.authorNameSnapshot };
}

// seed: { title, uploaderIsUser, uploaderSeed?, uploaderName?, category, description, duration, nsfw, cover?, scenes?, placeholder? }
// 投稿时先存一条占位视频（没有可用分镜就放一段占位分镜），生成内容再由 applyVideoCreate 补齐。
export function createVideo(scope, scopeId, seed = {}) {
    videoStore(scope);
    const title = text(seed.title, VIDEO_TEXT_MAX.title);
    if (!title) throw new Error('视频标题不能为空');
    const uploader = withActorRollback(scope, () => resolveUploader(scope, scopeId, seed));
    const duration = clampDuration(seed.duration ?? 60);
    const scenes = sanitizeVideoScenes(seed.scenes, duration);
    const cover = sanitizeVideoImage(seed.cover);
    const timestamp = Date.now();
    const video = {
        id: newId('video'), title, uploaderIsUser: seed.uploaderIsUser === true, uploaderActorId: uploader.actorId,
        uploaderNameSnapshot: uploader.name, category: text(seed.category, VIDEO_TEXT_MAX.category),
        description: text(seed.description, VIDEO_TEXT_MAX.description), duration, nsfw: seed.nsfw === true,
        ...(cover ? { cover } : {}),
        scenes: scenes.length ? scenes : [{ at: 0, text: text(seed.placeholder, VIDEO_TEXT_MAX.scene) || title }],
        danmaku: [], comments: [], createdAt: timestamp, updatedAt: timestamp,
    };
    // 占位视频：pending 在内容生成成功前一直保留，draft 记下投稿时的选择，重试沿用。
    if (seed.pending === true) {
        video.pending = true;
        video.draft = { titleTyped: seed.draft?.titleTyped === true, categoryTyped: seed.draft?.categoryTyped === true, aiScenes: seed.draft?.aiScenes !== false };
    }
    scope.videos[video.id] = video;
    scope.videoOrder.push(video.id);
    while (scope.videoOrder.length > VIDEO_LIMITS.videos) delete scope.videos[scope.videoOrder.shift()];
    return video;
}

// 编辑：只改标题、分区、简介与成人内容；UP主、分镜、弹幕和评论保持不变。
export function updateVideo(scope, videoId, patch = {}) {
    const video = getVideo(scope, videoId);
    const title = text(patch.title, VIDEO_TEXT_MAX.title);
    if (!title) throw new Error('视频标题不能为空');
    video.title = title;
    video.category = text(patch.category, VIDEO_TEXT_MAX.category);
    video.description = text(patch.description, VIDEO_TEXT_MAX.description);
    video.nsfw = patch.nsfw === true;
    touch(video);
    return video;
}

export function deleteVideo(scope, videoId) {
    getVideo(scope, videoId);
    delete scope.videos[videoId];
    scope.videoOrder = scope.videoOrder.filter(item => item !== videoId);
}

// ===== 条目构造 =====

const authorRef = (scope, scopeId, name) => resolveInteractiveAuthor(scope, scopeId, name);
const isSkipped = (name, skipNames) => skipNames.includes(text(name, 80));

function buildDanmaku(scope, scopeId, items, duration, now, skipNames) {
    return (Array.isArray(items) ? items : []).flatMap(item => {
        const content = text(item?.content, VIDEO_TEXT_MAX.danmaku);
        if (!content || isSkipped(item?.author, skipNames)) return [];
        const at = Math.min(duration, Math.max(0, Math.floor(Number(item?.at)) || 0));
        return [{ id: newId('vdm'), ...authorRef(scope, scopeId, item?.author), content, at, createdAt: now }];
    }).slice(0, VIDEO_LIMITS.danmaku);
}

function buildReplies(scope, scopeId, items, parentCreatedAt, now, skipNames) {
    const kept = (Array.isArray(items) ? items : []).flatMap(item => {
        const content = text(item?.content, VIDEO_TEXT_MAX.reply);
        if (!content || isSkipped(item?.author, skipNames)) return [];
        const replyTo = text(item?.replyTo, VIDEO_TEXT_MAX.replyTo);
        return [{ id: newId('vrp'), ...authorRef(scope, scopeId, item?.author), content, ...(replyTo ? { replyTo } : {}) }];
    }).slice(0, VIDEO_LIMITS.replies);
    const times = assignBatchTimes(kept.length, { now, after: parentCreatedAt, step: REPLY_STEP });
    return kept.map((reply, index) => ({ ...reply, createdAt: times[index] }));
}

// 评论批：createdAt 先留占位，由合并函数按最终顺序重排；楼中楼在拿到评论时间后再生成。
function buildCommentDrafts(scope, scopeId, items, skipNames) {
    const sources = new Map();
    const drafts = (Array.isArray(items) ? items : []).flatMap(item => {
        const content = text(item?.content, VIDEO_TEXT_MAX.comment);
        if (!content || isSkipped(item?.author, skipNames)) return [];
        const comment = { id: newId('vcm'), ...authorRef(scope, scopeId, item?.author), content, createdAt: 1, liked: false, replies: [] };
        sources.set(comment.id, item?.replies);
        return [comment];
    }).slice(0, VIDEO_LIMITS.comments);
    return { drafts, sources };
}

// ===== 生成结果写入 =====

// parsed: { video: { title, category, description, duration, scenes, cover }, danmaku: [...], comments: [...] }
// options: { keepUserText（UP主是用户：标题简介以用户为准）, keepScenes（用户没勾让 AI 写分镜）, skipNames, actorSeeds }
export function applyVideoCreate(scope, scopeId, videoId, parsed, options = {}) {
    const video = getVideo(scope, videoId);
    const skipNames = (options.skipNames || []).map(name => text(name, 80)).filter(Boolean);
    return withActorRollback(scope, () => {
        for (const seed of options.actorSeeds || []) ensureInteractiveActor(scope, scopeId, seed);
        const meta = parsed?.video || {};
        const now = Date.now();
        let duration = video.duration;
        let scenes = video.scenes;
        if (!options.keepScenes) {
            const nextDuration = clampDuration(meta.duration ?? video.duration);
            const nextScenes = sanitizeVideoScenes(meta.scenes, nextDuration);
            if (nextScenes.length) { duration = nextDuration; scenes = nextScenes; }
        }
        const generatedDanmaku = buildDanmaku(scope, scopeId, parsed?.danmaku, duration, now, skipNames);
        const { drafts, sources } = buildCommentDrafts(scope, scopeId, parsed?.comments, skipNames);
        const times = assignBatchTimes(drafts.length, { now });
        const generatedComments = drafts.map((comment, index) => {
            const createdAt = times[index];
            return { ...comment, createdAt, replies: buildReplies(scope, scopeId, sources.get(comment.id), createdAt, now, skipNames) };
        });
        // 生成期间用户发的弹幕、评论已经在视频里：把生成结果并进去，用户内容全部保留；超过上限时先丢生成的、最早的。
        const danmaku = mergeKeepingExisting(video.danmaku, generatedDanmaku, VIDEO_LIMITS.danmaku, (left, right) => left.at - right.at || left.createdAt - right.createdAt);
        const comments = mergeKeepingExisting(video.comments, generatedComments, VIDEO_LIMITS.comments, (left, right) => left.createdAt - right.createdAt);
        const cover = sanitizeVideoImage(meta.cover);
        if (!options.keepUserText) {
            video.title = text(meta.title, VIDEO_TEXT_MAX.title) || video.title;
            video.category = text(meta.category, VIDEO_TEXT_MAX.category) || video.category;
            video.description = text(meta.description, VIDEO_TEXT_MAX.description) || video.description;
        }
        video.duration = duration;
        video.scenes = scenes;
        if (cover) video.cover = cover;
        video.danmaku = danmaku;
        video.comments = comments;
        delete video.pending;
        delete video.draft;
        touch(video);
        return video;
    });
}

// 已有内容全部保留，再并入生成的；按 compare 排序，总数超过 limit 时从生成的里按排序靠前的先丢。
function mergeKeepingExisting(existing, generated, limit, compare) {
    const room = Math.max(0, limit - existing.length);
    const trimmed = [...generated].sort(compare).slice(Math.max(0, generated.length - room));
    return [...existing, ...trimmed].sort(compare);
}

// items: [{ author, authorSeed?, content, at }]；at 夹在 0 到视频时长之间。
export function appendVideoDanmaku(scope, scopeId, video, items, actorSeeds = []) {
    if (!scope || !video) throw new Error('视频不存在');
    return withActorRollback(scope, () => {
        for (const seed of actorSeeds) ensureInteractiveActor(scope, scopeId, seed);
        const now = Date.now();
        const entries = (Array.isArray(items) ? items : []).flatMap(item => {
            const content = text(item?.content, VIDEO_TEXT_MAX.danmaku);
            if (!content) return [];
            const reference = item?.authorSeed
                ? { authorId: ensureInteractiveActor(scope, scopeId, item.authorSeed).actorId, authorNameSnapshot: text(item.authorSeed.displayName, 80) || '匿名用户' }
                : authorRef(scope, scopeId, item?.author);
            const at = Math.min(video.duration, Math.max(0, Math.floor(Number(item?.at)) || 0));
            return [{ id: newId('vdm'), ...reference, content, at, createdAt: now }];
        });
        if (!entries.length) return [];
        video.danmaku = [...video.danmaku, ...entries].slice(-VIDEO_LIMITS.danmaku);
        touch(video);
        return entries;
    });
}

export function updateVideoDanmaku(video, danmakuId, content) {
    const item = video?.danmaku?.find(entry => entry.id === danmakuId);
    const next = text(content, VIDEO_TEXT_MAX.danmaku);
    if (!item) throw new Error('弹幕不存在');
    if (!next) throw new Error('弹幕内容不能为空');
    item.content = next;
    touch(video);
}

export function deleteVideoDanmaku(video, danmakuId) {
    if (!video?.danmaku?.some(entry => entry.id === danmakuId)) throw new Error('弹幕不存在');
    video.danmaku = video.danmaku.filter(entry => entry.id !== danmakuId);
    touch(video);
}

// 用户发评论：先把用户的内容原样存下（liked 为 false，没有回复），随后的回应请求再决定它在这一批里的位置。
export function addVideoComment(scope, scopeId, video, authorSeed, content) {
    const body = text(content, VIDEO_TEXT_MAX.comment);
    if (!body) throw new Error('评论内容不能为空');
    return withActorRollback(scope, () => {
        const actor = ensureInteractiveActor(scope, scopeId, authorSeed);
        const comment = {
            id: newId('vcm'), authorId: actor.actorId, authorNameSnapshot: text(authorSeed.displayName, 80) || actor.displayName,
            content: body, createdAt: Date.now(), liked: false, replies: [],
        };
        video.comments = [...video.comments, comment].slice(-VIDEO_LIMITS.comments);
        touch(video);
        return comment;
    });
}

// 回复满 10 条时丢弃最早的一条，不拒绝用户这次的发言。
export function addVideoReply(scope, scopeId, video, commentId, authorSeed, content, replyTo = '') {
    const body = text(content, VIDEO_TEXT_MAX.reply);
    if (!body) throw new Error('回复内容不能为空');
    const comment = getComment(video, commentId);
    return withActorRollback(scope, () => {
        const actor = ensureInteractiveActor(scope, scopeId, authorSeed);
        const target = text(replyTo, VIDEO_TEXT_MAX.replyTo);
        const reply = {
            id: newId('vrp'), authorId: actor.actorId, authorNameSnapshot: text(authorSeed.displayName, 80) || actor.displayName,
            content: body, ...(target ? { replyTo: target } : {}), createdAt: Date.now(),
        };
        comment.replies = [...comment.replies, reply].slice(-VIDEO_LIMITS.replies);
        touch(video);
        return reply;
    });
}

// 把一批生成的评论并进视频；userCommentId 指向用户刚发的评论时，它随机插在这一批的 slot 位置，整批 createdAt 按最终顺序重排。
// options: { userCommentId, slot, now, skipNames, actorSeeds }
export function placeVideoComments(scope, scopeId, video, items, options = {}) {
    if (!scope || !video) throw new Error('视频不存在');
    const skipNames = (options.skipNames || []).map(name => text(name, 80)).filter(Boolean);
    return withActorRollback(scope, () => {
        for (const seed of options.actorSeeds || []) ensureInteractiveActor(scope, scopeId, seed);
        const now = options.now ?? Date.now();
        const mine = options.userCommentId ? video.comments.find(item => item.id === options.userCommentId) || null : null;
        const { drafts, sources } = buildCommentDrafts(scope, scopeId, items, skipNames);
        if (!drafts.length && !mine) return { comments: [], userIndex: -1 };
        const merged = mergeRespondComments({
            existing: video.comments.filter(item => item !== mine), userComment: mine, generated: drafts,
            slot: options.slot ?? 0, now, after: 0, limit: VIDEO_LIMITS.comments,
        });
        const comments = merged.comments.map(comment => (sources.has(comment.id)
            ? { ...comment, replies: buildReplies(scope, scopeId, sources.get(comment.id), comment.createdAt, now, skipNames) }
            : comment));
        video.comments = comments;
        touch(video);
        return { comments, userIndex: merged.userIndex };
    });
}

export const appendVideoComments = (scope, scopeId, video, items, options = {}) => placeVideoComments(scope, scopeId, video, items, { ...options, userCommentId: '' });

// 针对某条评论的一批回复；userReplyId 指向用户刚发的回复时同样随机插位并重排时间。
export function placeVideoReplies(scope, scopeId, video, commentId, items, options = {}) {
    const comment = getComment(video, commentId);
    const skipNames = (options.skipNames || []).map(name => text(name, 80)).filter(Boolean);
    return withActorRollback(scope, () => {
        for (const seed of options.actorSeeds || []) ensureInteractiveActor(scope, scopeId, seed);
        const now = options.now ?? Date.now();
        const mine = options.userReplyId ? comment.replies.find(item => item.id === options.userReplyId) || null : null;
        const generated = (Array.isArray(items) ? items : []).flatMap(item => {
            const content = text(item?.content, VIDEO_TEXT_MAX.reply);
            if (!content || isSkipped(item?.author, skipNames)) return [];
            const replyTo = text(item?.replyTo, VIDEO_TEXT_MAX.replyTo);
            return [{ id: newId('vrp'), ...authorRef(scope, scopeId, item?.author), content, ...(replyTo ? { replyTo } : {}), createdAt: 1 }];
        }).slice(0, VIDEO_LIMITS.replies);
        if (!generated.length && !mine) return { replies: [], userIndex: -1 };
        const merged = mergeRespondComments({
            existing: comment.replies.filter(item => item !== mine), userComment: mine, generated,
            slot: options.slot ?? 0, now, after: comment.createdAt, limit: VIDEO_LIMITS.replies,
        });
        comment.replies = merged.comments;
        touch(video);
        return { replies: merged.comments, userIndex: merged.userIndex };
    });
}

export const appendVideoReplies = (scope, scopeId, video, commentId, items, options = {}) => placeVideoReplies(scope, scopeId, video, commentId, items, { ...options, userReplyId: '' });

export function toggleVideoCommentLike(video, commentId) {
    const comment = getComment(video, commentId);
    comment.liked = comment.liked !== true;
    touch(video);
    return comment.liked;
}

export function updateVideoComment(video, commentId, content) {
    const comment = getComment(video, commentId);
    const next = text(content, VIDEO_TEXT_MAX.comment);
    if (!next) throw new Error('评论内容不能为空');
    comment.content = next;
    touch(video);
}

export function deleteVideoComment(video, commentId) {
    getComment(video, commentId);
    video.comments = video.comments.filter(item => item.id !== commentId);
    touch(video);
}

function getReply(video, commentId, replyId) {
    const reply = getComment(video, commentId).replies.find(item => item.id === replyId);
    if (!reply) throw new Error('回复不存在');
    return reply;
}

export function updateVideoReply(video, commentId, replyId, content) {
    const reply = getReply(video, commentId, replyId);
    const next = text(content, VIDEO_TEXT_MAX.reply);
    if (!next) throw new Error('回复内容不能为空');
    reply.content = next;
    touch(video);
}

export function deleteVideoReply(video, commentId, replyId) {
    getReply(video, commentId, replyId);
    const comment = getComment(video, commentId);
    comment.replies = comment.replies.filter(item => item.id !== replyId);
    touch(video);
}

// 分支继承：目标聊天的 actor id 由 scopeId 重新派生，视频里引用到的作者 id 一并映射。
export function remapVideoAuthors(scope, actorIdMap) {
    const remap = item => { if (item && actorIdMap.has(item.authorId)) item.authorId = actorIdMap.get(item.authorId); };
    for (const video of Object.values(scope?.videos || {})) {
        if (actorIdMap.has(video.uploaderActorId)) video.uploaderActorId = actorIdMap.get(video.uploaderActorId);
        for (const danmaku of video.danmaku || []) remap(danmaku);
        for (const comment of video.comments || []) {
            remap(comment);
            for (const reply of comment.replies || []) remap(reply);
        }
    }
}
