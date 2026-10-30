import { HEART_ICON_SVG, SHARE_ICON_SVG } from '../icons.js';
import { escapeAttr, escapeHtml } from '../ui.js';
import { imageCardMarkup } from '../messaging.js';
import {
    entryAttr, isOpenPost, renderAvatar, renderCommentActions, renderEmptyState, renderLikeButton, renderPostMenu, renderPostMetric,
    renderPostTime, renderReplyComposer, renderReplyToggle, renderRetryRespond, renderRichText, renderStaleMark, stablePostMetric, formatCommunityPostTime,
} from './view-shared.js';

const COLLAPSED_COMMENTS = 2;

function renderHotSearch(scene, now) {
    if (!Array.isArray(scene.hot) || !scene.hot.length) return '';
    const updated = formatCommunityPostTime(scene.updatedAt, now);
    const rows = scene.hot.map((item, index) => `<li class="pm-scene-hot-row"><span class="pm-scene-hot-rank ${index < 4 ? 'is-top' : ''}">${index + 1}</span><span class="pm-scene-hot-title">${escapeHtml(item.title)}</span>${item.badge ? `<span class="pm-scene-hot-badge">${escapeHtml(item.badge)}</span>` : ''}</li>`).join('');
    return `<section class="pm-scene-hot" aria-label="热搜"><header><b>热搜榜</b>${updated.datetime ? `<span>${escapeHtml(updated.label)}更新</span>` : ''}</header><ol>${rows}</ol></section>`;
}

function renderRepost(repost) {
    if (!repost) return '';
    return `<blockquote class="pm-scene-repost"><b class="pm-scene-mention">@${escapeHtml(repost.author)}</b>：${renderRichText(repost.content)}</blockquote>`;
}

// 话题只写进 tags、正文没有出现时，补在正文末尾，保证话题词仍然可见。
function bodyWithTopics(post) {
    const missing = post.tags.filter(tag => !post.content.includes(`#${tag}#`));
    return missing.length ? `${post.content}\n${missing.map(tag => `#${tag}#`).join(' ')}` : post.content;
}

// 评论行：小头像 + 名字（与博主同名的带「作者」标签）+ 时间 + 内容，右侧一个小赞数；评论没有点赞字段，数字按内容稳定生成，只做展示。
function renderCommentRow(post, comment, now, view) {
    const owner = comment.authorNameSnapshot === post.authorNameSnapshot ? '<span class="pm-scene-owner">作者</span>' : '';
    const likes = stablePostMetric(comment, 'likes', 0, 36);
    return `<div class="pm-scene-comment"${entryAttr(comment.id)}>${renderAvatar(comment.authorNameSnapshot, { small: true })}<div class="pm-scene-comment-main"><div class="pm-scene-comment-head"><b>${escapeHtml(comment.authorNameSnapshot)}</b>${owner}${renderPostTime(comment.createdAt, now)}</div><span class="pm-scene-comment-content">${escapeHtml(comment.content)}</span>${renderRetryRespond(view, comment.id, post.id, 'comment')}</div><span class="pm-scene-comment-like" aria-label="赞 ${likes}">${HEART_ICON_SVG}<span>${likes}</span></span>${renderCommentActions(post, comment)}</div>`;
}

function renderComments(post, expanded, now, view) {
    if (!post.comments.length) return '';
    const shown = expanded ? post.comments : post.comments.slice(0, COLLAPSED_COMMENTS);
    const rows = shown.map(comment => renderCommentRow(post, comment, now, view)).join('');
    const more = !expanded && post.comments.length > COLLAPSED_COMMENTS
        ? `<button type="button" class="pm-scene-comments-more" data-action="toggle-open" data-post-id="${escapeAttr(post.id)}" aria-expanded="false">查看全部 ${post.comments.length} 条评论 ›</button>` : '';
    return `<div class="pm-scene-comments">${rows}${more}</div>`;
}

function renderWeiboPost(post, view, now) {
    const likes = stablePostMetric(post, 'likes', 8, 240) + (post.liked ? 1 : 0);
    const shares = stablePostMetric(post, 'shares', 1, 48) + post.shareCount;
    return `<article class="pm-scene-post is-weibo"${entryAttr(post.id)}>
        <header>${renderAvatar(post.authorNameSnapshot)}<div class="pm-scene-post-author"><b>${escapeHtml(post.authorNameSnapshot)}</b>${renderPostTime(post.createdAt, now)}${renderStaleMark(post)}</div>${renderPostMenu(post)}</header>
        <p>${renderRichText(bodyWithTopics(post))}</p>${post.image ? imageCardMarkup(post.image.desc, { postId: post.id, author: post.authorNameSnapshot }) : ''}${renderRepost(post.repost)}
        <footer><button type="button" class="pm-scene-share ${post.shared ? 'is-shared' : ''}" data-action="share" data-post-id="${escapeAttr(post.id)}" aria-pressed="${post.shared}" aria-label="${post.shared ? '已分享本帖' : '分享本帖'}">${renderPostMetric(SHARE_ICON_SVG, shares, '转发', 'is-share')}</button>${renderReplyToggle(post, { label: '评论' })}${renderLikeButton(post, '赞', likes)}</footer>
        ${renderRetryRespond(view, post.id, post.id, 'post')}${renderComments(post, isOpenPost(view, post), now, view)}${renderReplyComposer(post)}
    </article>`;
}

export function renderWeiboFeed(scene, view, now) {
    const posts = scene.posts.slice().reverse();
    return `${renderHotSearch(scene, now)}${posts.length ? posts.map(post => renderWeiboPost(post, view, now)).join('') : renderEmptyState()}`;
}
