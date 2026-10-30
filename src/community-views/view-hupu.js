import { escapeAttr, escapeHtml } from '../ui.js';
import {
    entryAttr, renderAvatar, renderCommentActions, renderComposePill, renderEmptyState, renderLikeButton, renderPostMenu, renderPostTime,
    renderRetryRespond, renderStaleMark, stableHash, stablePostMetric, threadTitleOf,
} from './view-shared.js';

// 「亮了」就是点赞，换了说法。数字按内容稳定生成，不存。
export const hupuLightsOf = post => stablePostMetric(post, 'lights', 0, 600) + (post.liked ? 1 : 0);
// 回帖的亮了数只用于排出「这些回帖亮了」，不可点。
export const hupuReplyLightsOf = comment => stablePostMetric(comment, 'lights', 0, 120);
// 热帖：有实际回帖（亮了数是生成的，单靠它会让没人回的帖子也标热）。
const isHot = post => post.comments.length >= 6 || (post.comments.length >= 4 && hupuLightsOf(post) >= 300);
// 这些回帖亮了：回帖不少于 4 条时，按亮了数取前 3 条。
const HOT_REPLY_MIN = 4;
const HOT_REPLY_COUNT = 3;

export function pickHupuHotReplies(comments) {
    if (comments.length < HOT_REPLY_MIN) return [];
    return comments.map((comment, index) => ({ comment, index, lights: hupuReplyLightsOf(comment) }))
        .sort((a, b) => (b.lights - a.lights) || (a.index - b.index))
        .slice(0, HOT_REPLY_COUNT).map(item => item.comment);
}

// 板块头：板块名与今日帖数；右侧墨色「发帖」胶囊是全页唯一的发帖入口。
function renderBoardHeader(scene) {
    const online = 300 + (stableHash(`${scene.id}:online`) % 9700);
    return `<header class="pm-scene-group"><span class="pm-scene-group-icon" aria-hidden="true">${escapeHtml(scene.title.slice(0, 1))}</span><div class="pm-scene-group-info"><b>${escapeHtml(scene.title)}</b><span>${online} 人在线 · ${scene.posts.length} 帖</span></div>${renderComposePill('发帖')}</header>`;
}

// 步行街式紧凑标题列表：标题一行，下面是板块、亮了数和回复数，没有正文摘要。
function renderThreadRow(post, view) {
    const hot = isHot(post) ? '<span class="pm-scene-flag is-hot">热</span>' : '';
    const tag = post.tags[0] ? `${post.tags[0]} · ` : '';
    return `<li${entryAttr(post.id)}><button type="button" class="pm-scene-thread-row" data-action="open-thread" data-post-id="${escapeAttr(post.id)}"><span class="pm-scene-thread-main"><span class="pm-scene-thread-title">${hot}<b>${escapeHtml(threadTitleOf(post))}</b></span><span class="pm-scene-thread-meta">${escapeHtml(`${tag}${hupuLightsOf(post)} 亮 · ${post.comments.length} 回复`)}</span></span></button>${renderRetryRespond(view, post.id, post.id, 'post')}</li>`;
}

function renderThreadList(scene, view) {
    const posts = scene.posts.map((post, index) => ({ post, index }))
        .sort((a, b) => (b.post.createdAt - a.post.createdAt) || (b.index - a.index)).map(item => item.post);
    const body = posts.length ? `<ul class="pm-scene-thread-list is-compact">${posts.map(post => renderThreadRow(post, view)).join('')}</ul>` : renderEmptyState();
    return `${renderBoardHeader(scene)}${body}`;
}

// 回帖：右侧是「亮了 N」。hot 区的副本不带 entryAttr 与编辑按钮，定位和编辑都以全部回帖里那一条为准。
function renderReply(post, comment, now, view, { hot = false } = {}) {
    const owner = comment.authorNameSnapshot === post.authorNameSnapshot;
    return `<div class="pm-scene-floor"${hot ? '' : entryAttr(comment.id)}><header>${renderAvatar(comment.authorNameSnapshot)}<div class="pm-scene-post-author"><b>${escapeHtml(comment.authorNameSnapshot)}${owner ? '<span class="pm-scene-owner">楼主</span>' : ''}</b>${renderPostTime(comment.createdAt, now)}</div><span class="pm-scene-lights">亮了 ${hupuReplyLightsOf(comment)}</span></header><div class="pm-scene-comment"><span class="pm-scene-comment-content">${escapeHtml(comment.content).replace(/\n/g, '<br>')}</span>${hot ? '' : renderCommentActions(post, comment)}</div>${hot ? '' : renderRetryRespond(view, comment.id, post.id, 'comment')}</div>`;
}

function renderThread(post, now, view) {
    const hotReplies = pickHupuHotReplies(post.comments);
    const hot = hotReplies.length
        ? `<h5 class="pm-scene-floors-title">这些回帖亮了</h5><div class="pm-scene-floors">${hotReplies.map(comment => renderReply(post, comment, now, view, { hot: true })).join('')}</div>` : '';
    const all = post.comments.length
        ? `<h5 class="pm-scene-floors-title">全部回帖</h5><div class="pm-scene-floors" aria-label="全部回帖">${post.comments.map(comment => renderReply(post, comment, now, view)).join('')}</div>` : '';
    return `<article class="pm-scene-post is-douban"${entryAttr(post.id)}><div class="pm-scene-owner-card"><header>${renderAvatar(post.authorNameSnapshot)}<div class="pm-scene-post-author"><b>${escapeHtml(post.authorNameSnapshot)}<span class="pm-scene-owner">楼主</span></b>${renderPostTime(post.createdAt, now)}${renderStaleMark(post)}</div>${renderPostMenu(post)}</header>
        <h4 class="pm-scene-post-title">${escapeHtml(threadTitleOf(post))}</h4><p>${escapeHtml(post.content).replace(/\n/g, '<br>')}</p>
        <footer>${renderLikeButton(post, '亮了', hupuLightsOf(post))}${renderRetryRespond(view, post.id, post.id, 'post')}</footer></div>
        ${hot}${all}</article>`;
}

export function renderHupuFeed(scene, view, now) {
    const post = view?.postId ? scene.posts.find(item => item.id === view.postId) : null;
    return post ? renderThread(post, now, view) : renderThreadList(scene, view);
}
