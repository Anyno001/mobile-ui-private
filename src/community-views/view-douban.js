import { escapeAttr, escapeHtml } from '../ui.js';
import {
    entryAttr, formatCommunityPostTime, renderAvatar, renderCommentActions, renderComposePill, renderEmptyState, renderLikeButton, renderPostMenu,
    renderPostTime, renderRetryRespond, stableHash, stablePostMetric, threadTitleOf,
} from './view-shared.js';

export const DOUBAN_SEGMENTS = Object.freeze([
    { id: 'latest', label: '最新' },
    { id: 'featured', label: '精华' },
    { id: 'help', label: '求助' },
]);

const FLAG_LABELS = Object.freeze({ pinned: '置顶', featured: '精华', help: '求助' });

export const doubanSegmentOf = view => (DOUBAN_SEGMENTS.some(item => item.id === view?.segment) ? view.segment : 'latest');

// 分段是真筛选：精华 = flag featured，求助 = flag help，最新 = 全部；置顶帖始终排在最前，其余按发布时间倒序。
export function filterDoubanPosts(posts, segment) {
    const wanted = { featured: 'featured', help: 'help' }[segment];
    return (posts || [])
        .map((post, index) => ({ post, index }))
        .filter(({ post }) => !wanted || post.flag === wanted)
        .sort((a, b) => (Number(b.post.flag === 'pinned') - Number(a.post.flag === 'pinned')) || (b.post.createdAt - a.post.createdAt) || (b.index - a.index))
        .map(({ post }) => post);
}

const lastActivityOf = post => post.comments.at(-1)?.createdAt || post.createdAt;

// 全页唯一的发帖入口：小组头右侧的墨色「发帖」胶囊，点开是发帖页。
function renderGroupHeader(scene, now) {
    const members = 200 + (stableHash(`${scene.id}:members`) % 4800);
    const dayStart = new Date(now);
    dayStart.setHours(0, 0, 0, 0);
    const today = scene.posts.filter(post => post.createdAt >= dayStart.getTime() && post.createdAt <= now + 60_000).length;
    return `<header class="pm-scene-group"><span class="pm-scene-group-icon" aria-hidden="true">${escapeHtml(scene.title.slice(0, 1))}</span><div class="pm-scene-group-info"><b>${escapeHtml(scene.title)}</b><span>${members} 位组员 · 今日 ${today} 帖</span></div>${renderComposePill('发帖')}</header>`;
}

function renderSegments(segment) {
    return `<div class="pm-scene-segments" role="group" aria-label="帖子筛选">${DOUBAN_SEGMENTS.map(item => `<button type="button" class="pm-scene-segment ${item.id === segment ? 'is-active' : ''}" data-action="set-segment" data-segment="${item.id}" aria-pressed="${item.id === segment}">${item.label}</button>`).join('')}</div>`;
}

function renderThreadRow(post, now, view) {
    const flag = post.flag && FLAG_LABELS[post.flag] ? `<span class="pm-scene-flag is-${post.flag}">${FLAG_LABELS[post.flag]}</span>` : '';
    const last = formatCommunityPostTime(lastActivityOf(post), now);
    const meta = post.comments.length ? `${post.authorNameSnapshot} · 最后回复 ${last.label}` : `${post.authorNameSnapshot} · ${last.label}发布`;
    return `<li${entryAttr(post.id)}><button type="button" class="pm-scene-thread-row" data-action="open-thread" data-post-id="${escapeAttr(post.id)}"><span class="pm-scene-thread-main"><span class="pm-scene-thread-title">${flag}<b>${escapeHtml(threadTitleOf(post))}</b></span><span class="pm-scene-thread-meta">${escapeHtml(meta)}</span></span><span class="pm-scene-thread-count" aria-label="${post.comments.length} 条回复">${post.comments.length}</span></button>${renderRetryRespond(view, post.id, post.id, 'post')}</li>`;
}

function renderThreadList(scene, view, now) {
    const segment = doubanSegmentOf(view);
    const posts = filterDoubanPosts(scene.posts, segment);
    const body = posts.length
        ? `<ul class="pm-scene-thread-list">${posts.map(post => renderThreadRow(post, now, view)).join('')}</ul>`
        : scene.posts.length ? renderEmptyState('没有符合的帖子', '换一个分类看看。') : renderEmptyState();
    return `${renderGroupHeader(scene, now)}${renderSegments(segment)}${body}`;
}

function renderQuote(post, comment) {
    const target = comment.quoteId ? post.comments.find(item => item.id === comment.quoteId) : null;
    if (!target) return '';
    const floor = post.comments.indexOf(target) + 2;
    return `<blockquote class="pm-scene-quote"><b>${floor}楼 ${escapeHtml(target.authorNameSnapshot)}</b>${escapeHtml(target.content.slice(0, 60))}</blockquote>`;
}

function renderFloor(post, comment, index, now, view) {
    const owner = comment.authorNameSnapshot === post.authorNameSnapshot;
    return `<div class="pm-scene-floor"${entryAttr(comment.id)}><header>${renderAvatar(comment.authorNameSnapshot)}<div class="pm-scene-post-author"><b>${escapeHtml(comment.authorNameSnapshot)}${owner ? '<span class="pm-scene-owner">楼主</span>' : ''}</b>${renderPostTime(comment.createdAt, now)}</div><span class="pm-scene-floor-no">${index + 2}楼</span></header>${renderQuote(post, comment)}<div class="pm-scene-comment"><span class="pm-scene-comment-content">${escapeHtml(comment.content).replace(/\n/g, '<br>')}</span>${renderCommentActions(post, comment)}</div>${renderRetryRespond(view, comment.id, post.id, 'comment')}</div>`;
}

function renderThread(post, now, view) {
    const flag = post.flag && FLAG_LABELS[post.flag] ? `<span class="pm-scene-flag is-${post.flag}">${FLAG_LABELS[post.flag]}</span>` : '';
    const likes = stablePostMetric(post, 'likes', 8, 240) + (post.liked ? 1 : 0);
    const floors = post.comments.map((comment, index) => renderFloor(post, comment, index, now, view)).join('');
    return `<article class="pm-scene-post is-douban"${entryAttr(post.id)}><div class="pm-scene-owner-card"><header>${renderAvatar(post.authorNameSnapshot)}<div class="pm-scene-post-author"><b>${escapeHtml(post.authorNameSnapshot)}<span class="pm-scene-owner">楼主</span></b>${renderPostTime(post.createdAt, now)}</div><span class="pm-scene-floor-no">1楼</span>${renderPostMenu(post)}</header>
        <h4 class="pm-scene-post-title">${flag}${escapeHtml(threadTitleOf(post))}</h4><p>${escapeHtml(post.content).replace(/\n/g, '<br>')}</p>
        <footer>${renderLikeButton(post, '赞', likes)}${renderRetryRespond(view, post.id, post.id, 'post')}</footer></div>
        <div class="pm-scene-floors" aria-label="楼层">${floors}</div></article>`;
}

export function renderDoubanFeed(scene, view, now) {
    const post = view?.postId ? scene.posts.find(item => item.id === view.postId) : null;
    return post ? renderThread(post, now, view) : renderThreadList(scene, view, now);
}
