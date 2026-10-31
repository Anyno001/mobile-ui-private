import { escapeAttr, escapeHtml } from '../ui.js';
import {
    collectFilterChips, entryAttr, newestFirst, noteIndexOf, pageFeed, renderAvatar, renderCommentActions, renderCompactLike, renderEmptyState, renderFilterChips,
    renderPostMenu, renderPostTime, renderRetryRespond, renderStaleMark, stableHash, stablePostMetric, threadTitleOf,
} from './view-shared.js';

// 小红薯（原型小红书）：一排真筛选的话题胶囊，下面双列瀑布流；封面是实色块加大字，图片接入前先显示画面描述。
// 发布入口是底部正中的悬浮「+」（见 view-compose.js），笔记页底部是「说点什么…」加赞、收藏、评论。

export const xhsLikesOf = post => stablePostMetric(post, 'likes', 12, 3200) + (post.liked ? 1 : 0);
export const xhsCollectsOf = post => stablePostMetric(post, 'collects', 2, 900) + (post.shared ? 1 : 0);
export const xhsTagsOf = posts => collectFilterChips(posts.flatMap(post => post.tags));

// 封面三档高度按帖子 id 稳定取值，瀑布流才有错落。
const coverSizeOf = post => ['is-short', 'is-mid', 'is-tall'][stableHash(`${post.id}:cover`) % 3];
const coverText = post => post.image?.desc || threadTitleOf(post);

function renderCover(post, className = '') {
    return `<span class="pm-scene-xhs-cover is-note-${noteIndexOf(post.id)}${className ? ` ${className}` : ''}" aria-hidden="true"><b>${escapeHtml(coverText(post))}</b></span>`;
}

function renderCard(post, view) {
    return `<article class="pm-scene-xhs-card"${entryAttr(post.id)}><button type="button" class="pm-scene-xhs-open" data-action="open-thread" data-post-id="${escapeAttr(post.id)}">${renderCover(post, coverSizeOf(post))}<span class="pm-scene-xhs-title">${escapeHtml(threadTitleOf(post))}</span></button><div class="pm-scene-xhs-by">${renderAvatar(post.authorNameSnapshot, { small: true })}<span>${escapeHtml(post.authorNameSnapshot)}</span>${renderCompactLike(post, xhsLikesOf(post))}</div>${renderRetryRespond(view, post.id, post.id, 'post')}</article>`;
}

// 双列：按顺序左右交替放，两列各自从上往下排。
function renderColumns(posts, view) {
    const columns = [[], []];
    posts.forEach((post, index) => columns[index % 2].push(renderCard(post, view)));
    return `<div class="pm-scene-xhs-columns">${columns.map(cards => `<div class="pm-scene-xhs-column">${cards.join('')}</div>`).join('')}</div>`;
}

function renderList(scene, view) {
    const tag = typeof view?.tag === 'string' ? view.tag : '';
    const chips = xhsTagsOf(scene.posts);
    const selected = chips.includes(tag) ? tag : '';
    const posts = newestFirst(scene.posts).filter(post => !selected || post.tags.includes(selected));
    const { shown, more } = pageFeed(posts, view);
    const body = posts.length ? renderColumns(shown, view) + more : renderEmptyState('还没有笔记', '点下方的「+」发第一篇笔记，或者拍一拍让社区动起来。');
    return `${renderFilterChips(chips, selected, '话题')}${body}`;
}

function renderComment(post, comment, now, view) {
    const owner = comment.authorNameSnapshot === post.authorNameSnapshot ? '<span class="pm-scene-owner">作者</span>' : '';
    const likes = stablePostMetric(comment, 'likes', 0, 80);
    return `<div class="pm-scene-xhs-comment"${entryAttr(comment.id)}>${renderAvatar(comment.authorNameSnapshot, { small: true })}<div class="pm-scene-comment-main"><div class="pm-scene-comment-head"><b>${escapeHtml(comment.authorNameSnapshot)}</b>${owner}</div><span class="pm-scene-comment-content">${escapeHtml(comment.content)}</span><span class="pm-scene-xhs-when">${renderPostTime(comment.createdAt, now)}</span>${renderRetryRespond(view, comment.id, post.id, 'comment')}</div><span class="pm-scene-comment-like" aria-label="赞 ${likes}">${likes}</span>${renderCommentActions(post, comment)}</div>`;
}

function renderNote(post, now, view) {
    const topics = post.tags.length ? `<p class="pm-scene-xhs-topics">${post.tags.map(tag => `#${escapeHtml(tag)}`).join(' ')}</p>` : '';
    const comments = post.comments.length
        ? `<h5 class="pm-scene-floors-title">共${post.comments.length}条评论</h5><div class="pm-scene-xhs-comments">${post.comments.map(comment => renderComment(post, comment, now, view)).join('')}</div>`
        : '<p class="pm-scene-xhs-quiet">还没有评论</p>';
    return `<article class="pm-scene-post is-xhs"${entryAttr(post.id)}>${renderCover(post, 'is-hero')}
        <h4 class="pm-scene-xhs-heading">${escapeHtml(threadTitleOf(post))}</h4>
        <header>${renderAvatar(post.authorNameSnapshot)}<div class="pm-scene-post-author"><b>${escapeHtml(post.authorNameSnapshot)}</b>${renderPostTime(post.createdAt, now)}${renderStaleMark(post)}</div>${renderPostMenu(post)}</header>
        <p class="pm-scene-xhs-body">${escapeHtml(post.content).replace(/\n/g, '<br>')}</p>${topics}${renderRetryRespond(view, post.id, post.id, 'post')}
        ${comments}</article>`;
}

export function renderXhsFeed(scene, view, now) {
    const post = view?.postId ? scene.posts.find(item => item.id === view.postId) : null;
    return post ? renderNote(post, now, view) : renderList(scene, view);
}
