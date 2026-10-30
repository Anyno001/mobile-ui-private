import { formatCommunityPostTime, stableHash, stablePostMetric } from './community-views/view-shared.js';

// 视频界面的纯函数：格式化、稳定数字、排序与弹幕窗口。不碰 DOM，便于直接用数据测试。

export const VIDEO_CATEGORIES = Object.freeze(['生活', '游戏', '音乐', '知识', '美食', '影视', 'Vlog']);
export const VIDEO_COVER_COUNT = 5;
export const VIDEO_REPLY_PREVIEW = 2;
// 弹幕从右飞到左用时；轨道数与 styles/video.css 里飞行区的高度（轨道数 × 轨道间距）保持一致。
export const VIDEO_FLY_SECONDS = 6;
export const VIDEO_FLY_LANES = 3;
export const VIDEO_FLY_LIMIT = 10;
export const VIDEO_TICK_MS = 250;

export function formatDuration(totalSeconds) {
    const value = Math.max(0, Math.floor(Number(totalSeconds) || 0));
    return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}`;
}

export function formatVideoCount(count) {
    const value = Math.max(0, Math.floor(Number(count) || 0));
    if (value >= 10000) return `${(Math.floor(value / 1000) / 10).toFixed(1).replace(/\.0$/, '')}万`;
    return String(value);
}

// 播放、点赞、投币、收藏数按视频内容稳定生成，不存储。
export function videoStats(video) {
    const views = 800 + (stableHash(`views:${video?.id}`) % 90_000) + (video?.danmaku?.length || 0) * 13 + (video?.comments?.length || 0) * 29;
    const likes = Math.floor(views * (0.04 + (stableHash(`likes:${video?.id}`) % 5) / 100));
    return { views, likes, coins: Math.floor(likes * 0.4), favorites: Math.floor(likes * 0.6) };
}

export const videoCoverIndex = videoId => (stableHash(`cover:${videoId}`, 31) % VIDEO_COVER_COUNT) + 1;
export const videoCoverTitle = title => Array.from(String(title || '')).slice(0, 8).join('');
export const videoInitial = name => Array.from(String(name || '').trim())[0] || '?';

// 当前时间点所在的分镜下标：最后一个 at 不晚于当前时间的分镜。
export function sceneIndexAt(scenes, time) {
    const at = Number(time) || 0;
    let index = 0;
    (scenes || []).forEach((scene, position) => { if (scene.at <= at) index = position; });
    return index;
}

// 当前时间窗口内正在飞的弹幕。轨道按弹幕在整条时间线上的次序取模，保证同一条弹幕的轨道不随窗口变化。
export function visibleDanmaku(video, time) {
    const at = Number(time) || 0;
    const ordered = [...(video?.danmaku || [])].sort((left, right) => left.at - right.at || left.createdAt - right.createdAt);
    return ordered.flatMap((item, index) => (item.at <= at && at - item.at < VIDEO_FLY_SECONDS
        ? [{ item, lane: index % VIDEO_FLY_LANES, delay: -(at - item.at) }] : [])).slice(-VIDEO_FLY_LIMIT);
}

export const commentLikeCount = comment => stablePostMetric(comment, 'likes', 0, 240) + (comment?.liked ? 1 : 0);

// 热门按稳定生成的点赞数（加上回复数的分量）排；最新按时间倒序。返回新数组，不改存储里的顺序。
export function sortComments(comments, mode) {
    const list = [...(comments || [])];
    if (mode === 'latest') return list.sort((left, right) => right.createdAt - left.createdAt);
    const score = comment => commentLikeCount(comment) + (comment.replies?.length || 0) * 3;
    return list.sort((left, right) => score(right) - score(left) || right.createdAt - left.createdAt);
}

export const isUploaderAuthor = (video, item) => (video?.uploaderActorId
    ? item?.authorId === video.uploaderActorId
    : video?.uploaderIsUser !== true && item?.authorNameSnapshot === video?.uploaderNameSnapshot);

export const commentTimeLabel = (createdAt, now) => formatCommunityPostTime(createdAt, now).label;

export function describeVideoCard(video, pending = false) {
    return {
        id: video.id, title: video.title, uploader: video.uploaderNameSnapshot, cover: videoCoverIndex(video.id),
        coverTitle: videoCoverTitle(video.title), duration: formatDuration(video.duration),
        views: formatVideoCount(videoStats(video).views), pending,
    };
}
