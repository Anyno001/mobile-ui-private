import { COMMUNITY_PLATFORMS, platformForPreset } from '../interactive-scene-constants.js';
import {
    EDIT_ICON_SVG, HEART_ICON_SVG, MORE_ICON_SVG, POKE_ICON_SVG, REPLY_ICON_SVG, SEND_ICON_SVG, TRASH_ICON_SVG,
} from '../icons.js';
import { escapeAttr, escapeHtml } from '../ui.js';

// 各平台默认点缀色（浅色）；与 styles/community.css 里 [data-community-platform] 的值一致，只用于主题色选择器的取值。
export const COMMUNITY_PLATFORM_ACCENTS = Object.freeze({
    weibo: '#e0806a', douban: '#5f9a86', review: '#e08e55', confess: '#8f86c6', night: '#6f7fc4',
});

export const platformOf = scene => (COMMUNITY_PLATFORMS.includes(scene?.platform) ? scene.platform : platformForPreset(scene?.preset));

export function stableHash(seed, multiplier = 33) {
    let hash = 0;
    for (const character of String(seed)) hash = ((hash * multiplier) + character.codePointAt(0)) >>> 0;
    return hash;
}

export function stablePostMetric(post, salt, minimum, spread) {
    return minimum + (stableHash(`${post?.id || ''}:${post?.authorNameSnapshot || ''}:${post?.content || ''}:${salt}`) % spread);
}

// 便签色序号 1-5：按任意字符串稳定取值（树洞便签按帖子 id，书封按书名）。
export const noteIndexOf = seed => (stableHash(seed, 31) % 5) + 1;

const MIN_PLAUSIBLE_POST_TIMESTAMP = Date.UTC(2000, 0, 1);

export function formatCommunityPostTime(createdAt, now = Date.now()) {
    if (typeof createdAt !== 'number' || !Number.isFinite(createdAt) || createdAt < MIN_PLAUSIBLE_POST_TIMESTAMP) {
        return { label: '时间未知', datetime: '', title: '' };
    }
    const date = new Date(createdAt);
    if (Number.isNaN(date.getTime())) return { label: '时间未知', datetime: '', title: '' };
    const referenceNow = typeof now === 'number' && Number.isFinite(now) && now >= createdAt ? now : createdAt;
    const elapsed = referenceNow - createdAt;
    let label;
    if (elapsed < 60_000) label = '刚刚';
    else if (elapsed < 3_600_000) label = `${Math.floor(elapsed / 60_000)}分钟前`;
    else if (elapsed < 86_400_000) label = `${Math.floor(elapsed / 3_600_000)}小时前`;
    else if (elapsed < 604_800_000) label = `${Math.floor(elapsed / 86_400_000)}天前`;
    else if (date.getFullYear() === new Date(referenceNow).getFullYear()) label = `${date.getMonth() + 1}月${date.getDate()}日`;
    else label = `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
    const title = `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日 ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
    return { label, datetime: date.toISOString(), title };
}

export function renderPostTime(createdAt, now) {
    const time = formatCommunityPostTime(createdAt, now);
    if (!time.datetime) return `<time class="pm-scene-post-time">${escapeHtml(time.label)}</time>`;
    return `<time class="pm-scene-post-time" datetime="${escapeAttr(time.datetime)}" title="${escapeAttr(time.title)}">${escapeHtml(time.label)}</time>`;
}

const pad2 = value => String(value).padStart(2, '0');

// 夜间来信的时刻：createdAt 的本地时刻在 00:00-04:00 内就直接用，否则按帖子 id 稳定生成 00:00-03:59 的时刻。
export function nightClock(post) {
    const createdAt = post?.createdAt;
    const date = typeof createdAt === 'number' && Number.isFinite(createdAt) && createdAt >= MIN_PLAUSIBLE_POST_TIMESTAMP ? new Date(createdAt) : null;
    if (date && !Number.isNaN(date.getTime()) && date.getHours() < 4) return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
    const minutes = stableHash(`${post?.id || ''}:night-clock`) % 240;
    return `${pad2(Math.floor(minutes / 60))}:${pad2(minutes % 60)}`;
}

export const clockLabel = timestamp => {
    const date = new Date(timestamp);
    return Number.isFinite(timestamp) && !Number.isNaN(date.getTime()) ? `${pad2(date.getHours())}:${pad2(date.getMinutes())}` : '--:--';
};

// 首行不超过 40 字且后面还有正文时，首行当标题；否则整段是正文。
export function splitTitle(content) {
    const [first = '', ...rest] = String(content || '').split('\n');
    const body = rest.join('\n').trim();
    return first.trim() && body && first.trim().length <= 40 ? { title: first.trim(), body } : { title: '', body: String(content || '').trim() };
}

// 帖子标题：优先用 title 字段，没有就取正文首行。
export const threadTitleOf = post => (post?.title || String(post?.content || '').split('\n')[0].trim().slice(0, 40) || '无标题');

const RICH_TOKEN = /#[^#\s][^#\n]{0,28}#|@[^\s@#：:，,。！!？?]{1,20}/gu;

// 微博正文：#话题# 与 @某人 上点缀色，其余按文本转义。
export function renderRichText(value) {
    const source = String(value ?? '');
    let html = '';
    let last = 0;
    for (const match of source.matchAll(RICH_TOKEN)) {
        html += escapeHtml(source.slice(last, match.index));
        html += `<span class="${match[0].startsWith('#') ? 'pm-scene-topic' : 'pm-scene-mention'}">${escapeHtml(match[0])}</span>`;
        last = match.index + match[0].length;
    }
    return (html + escapeHtml(source.slice(last))).replace(/\n/g, '<br>');
}

export const validStarRating = rating => Number.isInteger(rating) && rating >= 1 && rating <= 5;

// size：'large' 为长评卡与评分卡的 16px 星级，'medium' 为短评的 15px 星级，默认沿用正文字号。
export function renderStars(rating, { size = '' } = {}) {
    const value = validStarRating(rating) ? rating : 0;
    return `<span class="pm-scene-stars${size ? ` is-${size}` : ''}" aria-hidden="true">${'★'.repeat(value)}<span class="pm-scene-stars-off">${'★'.repeat(5 - value)}</span></span>`;
}

export function renderRating(rating, { score = true, size = '' } = {}) {
    if (!validStarRating(rating)) return '';
    return `<span class="pm-scene-rating${size ? ` is-${size}` : ''}" role="img" aria-label="评分 ${rating} 星，满分 5 星">${renderStars(rating, { size })}${score ? `<b aria-hidden="true">${rating}.0</b>` : ''}</span>`;
}

// 墨色小胶囊：发帖、写书评这类“进入编辑页”的入口共用，点击都走 open-compose。
export const renderComposePill = (label, className = '') => `<button type="button" class="pm-scene-pill${className ? ` ${className}` : ''}" data-action="open-compose">${escapeHtml(label)}</button>`;

export const renderAvatar = (name, { small = false } = {}) => `<div class="pm-scene-avatar${small ? ' is-small' : ''}">${escapeHtml(String(name || '匿').slice(0, 1))}</div>`;

export function renderPostMetric(iconSvg, value, label, className = '') {
    return `<span class="pm-scene-post-metric ${className}" aria-label="${escapeAttr(`${label} ${value}`)}">${iconSvg}<span>${escapeHtml(label)} ${value}</span></span>`;
}

// 点赞按钮：各平台叫法不同（赞、有用、抱抱、懂你），都是同一个 like 动作。
export function renderLikeButton(post, label, likes, { icon = true } = {}) {
    return `<button type="button" class="pm-scene-like ${post.liked ? 'is-liked' : ''}" data-action="like" data-post-id="${escapeAttr(post.id)}" aria-pressed="${post.liked}" aria-label="${post.liked ? `取消${label}` : label}">${renderPostMetric(icon ? HEART_ICON_SVG : '', likes, label, 'is-like')}</button>`;
}

export function renderReplyComposer(post, { hidden = true } = {}) {
    return `<div id="pm-comment-composer-${escapeAttr(post.id)}" class="pm-scene-comment-composer"${hidden ? ' hidden' : ''}><input id="pm-comment-input-${escapeAttr(post.id)}" maxlength="1082" placeholder="发表你的想法吧"><button type="button" data-action="post-comment" data-post-id="${escapeAttr(post.id)}" aria-label="发送回复" title="发送回复">${SEND_ICON_SVG}</button></div>`;
}

export function renderReplyToggle(post, { label = '评论', count = post.comments.length, action = 'toggle-reply', expanded = false, icon = true } = {}) {
    return `<button type="button" class="pm-scene-reply-toggle" data-action="${action}" data-post-id="${escapeAttr(post.id)}" aria-label="回复本帖" aria-controls="pm-comment-composer-${escapeAttr(post.id)}" aria-expanded="${expanded}">${renderPostMetric(icon ? REPLY_ICON_SVG : '', count, label, 'is-reply')}</button>`;
}

// 帖子 ⋯ 菜单：拍一拍本帖、编辑、删除；展开时同帖的评论编辑删除按钮一起显示。
export function renderPostMenu(post) {
    return `<div class="pm-scene-post-actions-wrap"><button type="button" class="pm-scene-post-more" data-action="post-actions" aria-label="帖子操作" title="帖子操作" aria-expanded="false">${MORE_ICON_SVG}</button><span class="pm-scene-post-actions" hidden><button type="button" data-action="comments" data-post-id="${escapeAttr(post.id)}" aria-label="拍一拍本帖，只生成本帖评论" title="拍一拍本帖">${POKE_ICON_SVG}</button><button type="button" data-action="edit-post" data-post-id="${escapeAttr(post.id)}" aria-label="编辑帖子" title="编辑帖子">${EDIT_ICON_SVG}</button><button type="button" class="pm-scene-danger" data-action="delete-post" data-post-id="${escapeAttr(post.id)}" aria-label="删除帖子" title="删除帖子">${TRASH_ICON_SVG}</button></span></div>`;
}

// 评论 ⋯ 菜单：单条评论自成卡片时使用（书评短评），只含编辑和删除。
export function renderCommentMenu(post, comment) {
    return `<div class="pm-scene-post-actions-wrap"><button type="button" class="pm-scene-post-more" data-action="post-actions" aria-label="评论操作" title="评论操作" aria-expanded="false">${MORE_ICON_SVG}</button><span class="pm-scene-post-actions" hidden><button type="button" data-action="edit-comment" data-post-id="${escapeAttr(post.id)}" data-comment-id="${escapeAttr(comment.id)}" aria-label="编辑评论" title="编辑评论">${EDIT_ICON_SVG}</button><button type="button" class="pm-scene-danger" data-action="delete-comment" data-post-id="${escapeAttr(post.id)}" data-comment-id="${escapeAttr(comment.id)}" aria-label="删除评论" title="删除评论">${TRASH_ICON_SVG}</button></span></div>`;
}

// 评论的编辑删除按钮，默认隐藏，随帖子 ⋯ 菜单一起展开。
export function renderCommentActions(post, comment) {
    return `<span class="pm-scene-comment-actions" hidden><button type="button" data-action="edit-comment" data-post-id="${escapeAttr(post.id)}" data-comment-id="${escapeAttr(comment.id)}" aria-label="编辑评论" title="编辑评论">${EDIT_ICON_SVG}</button><button type="button" class="pm-scene-danger" data-action="delete-comment" data-post-id="${escapeAttr(post.id)}" data-comment-id="${escapeAttr(comment.id)}" aria-label="删除评论" title="删除评论">${TRASH_ICON_SVG}</button></span>`;
}

export const renderEmptyState = (title = '这里还很安静', hint = '发第一篇帖子，或者拍一拍让社区动起来。') => `<div class="pm-scene-empty"><b>${escapeHtml(title)}</b><span>${escapeHtml(hint)}</span></div>`;

// 条目定位：发布并回应后按这个属性滚到用户那条并短暂高亮（见 interactive-scenes.js 的 revealEntry）。
export const entryAttr = entryId => ` data-entry-id="${escapeAttr(entryId)}"`;

// 回应失败（或忙碌时被搁置）的条目旁显示「重新回应」；失败标记只存在会话视图状态里（view.retry），不写存储。
export function renderRetryRespond(view, entryId, postId, kind) {
    if (!Array.isArray(view?.retry) || !view.retry.includes(entryId)) return '';
    return `<button type="button" class="pm-scene-retry" data-action="retry-respond" data-post-id="${escapeAttr(postId)}" data-target-id="${escapeAttr(entryId)}" data-entry-kind="${kind}">重新回应</button>`;
}

export const isOpenPost = (view, post) => Array.isArray(view?.open) && view.open.includes(post.id);

// 书的评分汇总：帖子 rating 与评论 rating 一并计入；10 分制保留一位小数，没有评分时 average10 为空串。
export function summarizeBookRatings(posts) {
    const distribution = [0, 0, 0, 0, 0]; // 下标 0 对应 5 星
    let total = 0;
    let count = 0;
    const add = rating => {
        if (!validStarRating(rating)) return;
        distribution[5 - rating] += 1;
        total += rating;
        count += 1;
    };
    for (const post of posts || []) {
        add(post.rating);
        for (const comment of post.comments || []) add(comment.rating);
    }
    return { count, average10: count ? ((total / count) * 2).toFixed(1) : '', average5: count ? total / count : 0, distribution };
}
