import { escapeAttr, escapeHtml } from '../ui.js';
import {
    clockLabel, entryAttr, isOpenPost, nightClock, renderAvatar, renderCommentActions, renderEmptyState, renderLikeButton, renderPostMenu,
    renderReplyComposer, renderRetryRespond, stablePostMetric,
} from './view-shared.js';

function renderMailbox(scene) {
    const tonight = scene.tonight;
    if (!tonight) {
        return '<section class="pm-scene-mailbox is-closed"><div><b>今夜信箱还没开</b><span>拍一拍社区，收一批深夜来信。</span></div></section>';
    }
    const letters = scene.posts.length;
    return `<section class="pm-scene-mailbox" aria-label="今夜信箱"><div><span class="pm-scene-mailbox-open">今夜信箱 · ${escapeHtml(clockLabel(tonight.openedAt))} 开箱</span><b>${escapeHtml(tonight.title)}</b><span>${letters} 封来信 · 04:00 封箱</span></div><span class="pm-scene-postmark" aria-hidden="true">信</span></section>`;
}

function renderLetter(post, view) {
    const open = isOpenPost(view, post);
    const understood = stablePostMetric(post, 'likes', 6, 140) + (post.liked ? 1 : 0);
    const first = post.comments[0];
    const shown = open ? post.comments : post.comments.slice(0, 1);
    const replies = shown.map(comment => `<div class="pm-scene-comment"${entryAttr(comment.id)}><span><b>回信 · ${escapeHtml(comment.authorNameSnapshot)}</b>：<span class="pm-scene-comment-content">${escapeHtml(comment.content)}</span>${renderRetryRespond(view, comment.id, post.id, 'comment')}</span>${renderCommentActions(post, comment)}</div>`).join('');
    return `<article class="pm-scene-post is-night ${open ? 'is-open' : ''}"${entryAttr(post.id)}>
        <header>${renderAvatar(post.to || post.authorNameSnapshot)}<div class="pm-scene-post-author"><span class="pm-scene-letter-to">写给 <b>${escapeHtml(post.to || '某个人')}</b></span></div><time class="pm-scene-post-time">${escapeHtml(nightClock(post))}</time>${renderPostMenu(post)}</header>
        <p>${escapeHtml(post.content).replace(/\n/g, '<br>')}</p>
        <div class="pm-scene-sign">—— ${escapeHtml(post.sign || post.authorNameSnapshot)}</div>
        ${first ? `<div class="pm-scene-replies${open ? '' : ' is-folded'}">${replies}</div>` : ''}
        <footer>${renderLikeButton(post, '懂你', understood, { icon: false })}<button type="button" class="pm-scene-reply-toggle" data-action="toggle-open" data-post-id="${escapeAttr(post.id)}" aria-label="展开回信" aria-controls="pm-comment-composer-${escapeAttr(post.id)}" aria-expanded="${open}"><span class="pm-scene-post-metric is-reply" aria-label="回信 ${post.comments.length}"><span>回信 ${post.comments.length}</span></span></button>${renderRetryRespond(view, post.id, post.id, 'post')}</footer>
        ${open ? renderReplyComposer(post, { hidden: false }) : ''}
    </article>`;
}

export function renderNightFeed(scene, view) {
    const letters = scene.posts.slice().reverse();
    return `${renderMailbox(scene)}${letters.length ? letters.map(post => renderLetter(post, view)).join('') : renderEmptyState('信箱里还没有信', '写一封信，或者拍一拍收一批深夜来信。')}`;
}
