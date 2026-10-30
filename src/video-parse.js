import { VIDEO_DURATION_MAX, VIDEO_LIMITS, VIDEO_TEXT_MAX, clampDuration, sanitizeVideoImage, sanitizeVideoScenes } from './video-schema.js';

// 视频生成结果的解析：信封（version 2）由 interactive-scene-ai.js 校验后交进来。
// 解析侧只做长度、条数与类型清洗，不做内容过滤；非法条目丢弃，不让整批失效。

const FORBIDDEN_KEYS = ['actorId', 'authorId'];
const isRecord = value => !!value && typeof value === 'object' && !Array.isArray(value);
const text = (value, max) => {
    if (typeof value === 'number' && Number.isFinite(value)) return String(value).slice(0, max);
    return typeof value === 'string' ? value.trim().slice(0, max) : '';
};
const forbidden = item => FORBIDDEN_KEYS.some(key => Object.hasOwn(item, key));
const seconds = value => {
    const number = Math.floor(Number(value));
    return Number.isFinite(number) ? Math.min(VIDEO_DURATION_MAX, Math.max(0, number)) : 0;
};

function cleanReplies(value) {
    return (Array.isArray(value) ? value : []).flatMap(reply => {
        if (!isRecord(reply) || forbidden(reply)) return [];
        const content = text(reply.content, VIDEO_TEXT_MAX.reply);
        if (!content) return [];
        const replyTo = text(reply.replyTo, VIDEO_TEXT_MAX.replyTo);
        return [{ author: text(reply.author, 80) || '匿名用户', content, ...(replyTo ? { replyTo } : {}) }];
    }).slice(0, VIDEO_LIMITS.replies);
}

function cleanComments(value, max) {
    return (Array.isArray(value) ? value : []).flatMap(comment => {
        if (!isRecord(comment) || forbidden(comment)) return [];
        const content = text(comment.content, VIDEO_TEXT_MAX.comment);
        if (!content) return [];
        const replies = cleanReplies(comment.replies);
        return [{ author: text(comment.author, 80) || '匿名用户', content, ...(replies.length ? { replies } : {}) }];
    }).slice(0, max);
}

function cleanDanmaku(value, max) {
    return (Array.isArray(value) ? value : []).flatMap(item => {
        if (!isRecord(item) || forbidden(item)) return [];
        const content = text(item.content, VIDEO_TEXT_MAX.danmaku);
        return content ? [{ author: text(item.author, 80) || '匿名用户', content, at: seconds(item.at) }] : [];
    }).slice(0, max);
}

function cleanVideoMeta(meta) {
    if (!isRecord(meta)) return {};
    const duration = clampDuration(meta.duration ?? 60);
    const scenes = sanitizeVideoScenes(meta.scenes, duration);
    const cover = sanitizeVideoImage(meta.cover);
    const title = text(meta.title, VIDEO_TEXT_MAX.title);
    const category = text(meta.category, VIDEO_TEXT_MAX.category);
    const description = text(meta.description, VIDEO_TEXT_MAX.description);
    return {
        ...(title ? { title } : {}), ...(category ? { category } : {}), ...(description ? { description } : {}),
        ...(meta.duration !== undefined ? { duration } : {}), ...(scenes.length ? { scenes } : {}), ...(cover ? { cover } : {}),
    };
}

// envelope：已校验的 { version, kind, items, meta? }。返回 { items, meta }；meta 只对 video_create 开放。
export function parseVideoEnvelope(envelope, kind) {
    const source = Array.isArray(envelope?.items) ? envelope.items : [];
    if (kind === 'video_create') {
        const meta = isRecord(envelope.meta) ? envelope.meta : {};
        const items = cleanDanmaku(source, VIDEO_LIMITS.danmaku);
        const comments = cleanComments(meta.comments, VIDEO_LIMITS.comments);
        if (!items.length && !comments.length) throw new Error('AI 未返回有效内容');
        return { items, meta: { video: cleanVideoMeta(meta.video), comments } };
    }
    const items = kind === 'video_comments' ? cleanComments(source, 12)
        : kind === 'video_replies' ? cleanReplies(source).slice(0, 8)
            : kind === 'video_danmaku' ? cleanDanmaku(source, 20) : null;
    if (!items) throw new Error(`不支持的视频生成类型：${kind}`);
    if (!items.length) throw new Error('AI 未返回有效内容');
    return { items, meta: {} };
}
