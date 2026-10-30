import { escapeAttr, escapeHtml } from '../ui.js';
import { filterDoubanPosts } from './view-douban.js';
import {
    entryAttr, formatCommunityPostTime, isOpenPost, renderAvatar, renderCommentActions, renderComposePill, renderEmptyState, renderLikeButton,
    renderPostMenu, renderPostTime, renderRetryRespond, renderStaleMark, splitTitle, stableHash, stablePostMetric, threadTitleOf,
} from './view-shared.js';

export const TIEBA_SEGMENTS = Object.freeze([
    { id: 'latest', label: '全部' },
    { id: 'featured', label: '精品' },
]);

const FLAG_LABELS = Object.freeze({ pinned: '置顶', featured: '精品' });
// 楼中楼默认露出的条数，其余折成「还有 N 条回复」。
const SUBFLOOR_PREVIEW = 2;

export const tiebaSegmentOf = view => (TIEBA_SEGMENTS.some(item => item.id === view?.segment) ? view.segment : 'latest');

// 吧名统一写成「XX吧」：用户起的名字已经以「吧」结尾时不再重复。
export const tiebaBarName = title => (String(title || '').endsWith('吧') ? String(title) : `${title}吧`);

const flagOf = post => (FLAG_LABELS[post.flag] ? `<span class="pm-scene-flag is-${post.flag}">${FLAG_LABELS[post.flag]}</span>` : '');

// 摘要：有 title 字段时正文就是摘要；没有时去掉首行标题。配图只存描述，列表里写「[图]」。
function digestOf(post) {
    const body = post.title ? String(post.content || '') : splitTitle(post.content).body;
    return `${post.image ? '[图] ' : ''}${body.replace(/\s+/g, ' ').trim()}`;
}

// 吧头：吧名、关注人数、帖子数；右侧墨色「发帖」胶囊是全页唯一的发帖入口（签到是假按钮，不做）。
function renderBarHeader(scene) {
    const followers = 1200 + (stableHash(`${scene.id}:followers`) % 88000);
    const name = tiebaBarName(scene.title);
    return `<header class="pm-scene-group"><span class="pm-scene-group-icon" aria-hidden="true">${escapeHtml(scene.title.slice(0, 1))}</span><div class="pm-scene-group-info"><b>${escapeHtml(name)}</b><span>关注 ${followers} · 帖子 ${scene.posts.length}</span></div>${renderComposePill('发帖')}</header>`;
}

function renderSegments(segment) {
    return `<div class="pm-scene-segments" role="group" aria-label="帖子筛选">${TIEBA_SEGMENTS.map(item => `<button type="button" class="pm-scene-segment ${item.id === segment ? 'is-active' : ''}" data-action="set-segment" data-segment="${item.id}" aria-pressed="${item.id === segment}">${item.label}</button>`).join('')}</div>`;
}

function renderThreadRow(post, now, view) {
    const last = formatCommunityPostTime(post.comments.at(-1)?.createdAt || post.createdAt, now);
    const digest = digestOf(post);
    const meta = `${post.authorNameSnapshot} · ${post.comments.length} 回复 · ${last.label}`;
    return `<li${entryAttr(post.id)}><button type="button" class="pm-scene-thread-row" data-action="open-thread" data-post-id="${escapeAttr(post.id)}"><span class="pm-scene-thread-main"><span class="pm-scene-thread-title">${flagOf(post)}<b>${escapeHtml(threadTitleOf(post))}</b></span>${digest ? `<span class="pm-scene-thread-digest">${escapeHtml(digest)}</span>` : ''}<span class="pm-scene-thread-meta">${escapeHtml(meta)}</span></span></button>${renderRetryRespond(view, post.id, post.id, 'post')}</li>`;
}

function renderThreadList(scene, view, now) {
    const segment = tiebaSegmentOf(view);
    const posts = filterDoubanPosts(scene.posts, segment);
    const body = posts.length
        ? `<ul class="pm-scene-thread-list">${posts.map(post => renderThreadRow(post, now, view)).join('')}</ul>`
        : scene.posts.length ? renderEmptyState('没有符合的帖子', '换一个分类看看。') : renderEmptyState();
    return `${renderBarHeader(scene)}${renderSegments(segment)}${body}`;
}

// 楼层归属：没有 quoteId 的是一层楼；有 quoteId 的顺着引用链找到所属的那层楼，挂在它下面当楼中楼。
export function groupTiebaFloors(comments) {
    const byId = new Map(comments.map(comment => [comment.id, comment]));
    const floors = [];
    const replies = new Map();
    for (const comment of comments) {
        let root = comment.quoteId ? byId.get(comment.quoteId) : null;
        for (let guard = 0; root?.quoteId && byId.has(root.quoteId) && guard < comments.length; guard += 1) root = byId.get(root.quoteId);
        if (!root || root === comment) {
            floors.push(comment);
            replies.set(comment.id, []);
        } else {
            if (!replies.has(root.id)) replies.set(root.id, []);
            replies.get(root.id).push(comment);
        }
    }
    return { floors, replies };
}

function renderSubfloor(post, comment, byId, floorId) {
    const target = byId.get(comment.quoteId);
    const to = target && target.id !== floorId ? ` 回复 <b>${escapeHtml(target.authorNameSnapshot)}</b>` : '';
    return `<p class="pm-scene-subfloor"${entryAttr(comment.id)}><b>${escapeHtml(comment.authorNameSnapshot)}</b>${to}：${escapeHtml(comment.content)}${renderCommentActions(post, comment)}</p>`;
}

function renderSubfloors(post, floor, list, byId, view) {
    if (!list.length) return '';
    const open = isOpenPost(view, floor);
    const shown = open ? list : list.slice(0, SUBFLOOR_PREVIEW);
    const hidden = list.length - shown.length;
    const more = list.length > SUBFLOOR_PREVIEW
        ? `<button type="button" class="pm-scene-subfloors-more" data-action="toggle-open" data-post-id="${escapeAttr(floor.id)}" aria-expanded="${open}">${open ? '收起' : `还有 ${hidden} 条回复`}</button>` : '';
    return `<div class="pm-scene-subfloors">${shown.map(comment => renderSubfloor(post, comment, byId, floor.id)).join('')}${more}</div>`;
}

function renderFloor(post, comment, number, now, view, replies, byId) {
    const owner = comment.authorNameSnapshot === post.authorNameSnapshot;
    return `<div class="pm-scene-floor"${entryAttr(comment.id)}><header>${renderAvatar(comment.authorNameSnapshot)}<div class="pm-scene-post-author"><b>${escapeHtml(comment.authorNameSnapshot)}${owner ? '<span class="pm-scene-owner">楼主</span>' : ''}</b>${renderPostTime(comment.createdAt, now)}</div><span class="pm-scene-floor-no">${number}楼</span></header><div class="pm-scene-comment"><span class="pm-scene-comment-content">${escapeHtml(comment.content).replace(/\n/g, '<br>')}</span>${renderCommentActions(post, comment)}</div>${renderSubfloors(post, comment, replies.get(comment.id) || [], byId, view)}${renderRetryRespond(view, comment.id, post.id, 'comment')}</div>`;
}

function renderThread(post, now, view) {
    const likes = stablePostMetric(post, 'likes', 4, 160) + (post.liked ? 1 : 0);
    const { floors, replies } = groupTiebaFloors(post.comments);
    const byId = new Map(post.comments.map(comment => [comment.id, comment]));
    const rows = floors.map((comment, index) => renderFloor(post, comment, index + 2, now, view, replies, byId)).join('');
    return `<article class="pm-scene-post is-douban"${entryAttr(post.id)}><div class="pm-scene-owner-card"><header>${renderAvatar(post.authorNameSnapshot)}<div class="pm-scene-post-author"><b>${escapeHtml(post.authorNameSnapshot)}<span class="pm-scene-owner">楼主</span></b>${renderPostTime(post.createdAt, now)}${renderStaleMark(post)}</div><span class="pm-scene-floor-no">1楼</span>${renderPostMenu(post)}</header>
        <h4 class="pm-scene-post-title">${flagOf(post)}${escapeHtml(threadTitleOf(post))}</h4><p>${escapeHtml(post.content).replace(/\n/g, '<br>')}</p>
        <footer>${renderLikeButton(post, '赞', likes)}${renderRetryRespond(view, post.id, post.id, 'post')}</footer></div>
        <div class="pm-scene-floors" aria-label="楼层">${rows}</div></article>`;
}

export function renderTiebaFeed(scene, view, now) {
    const post = view?.postId ? scene.posts.find(item => item.id === view.postId) : null;
    return post ? renderThread(post, now, view) : renderThreadList(scene, view, now);
}
