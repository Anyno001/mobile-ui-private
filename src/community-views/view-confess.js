import { escapeAttr, escapeHtml } from '../ui.js';
import { imageCardMarkup } from '../messaging.js';
import {
    entryAttr, isOpenPost, noteIndexOf, renderCommentActions, renderEmptyState, renderLikeButton, renderPostMenu,
    renderReplyComposer, renderRetryRespond, renderStaleMark, stablePostMetric,
} from './view-shared.js';

export const CONFESS_MOOD_LIMIT = 6;

// 心情胶囊：按出现次数从多到少取前 6 个，次数相同按首次出现顺序。
export function collectMoods(posts) {
    const counts = new Map();
    for (const post of posts || []) {
        if (post.mood) counts.set(post.mood, (counts.get(post.mood) || 0) + 1);
    }
    return [...counts.entries()]
        .map(([mood, count], index) => ({ mood, count, index }))
        .sort((a, b) => (b.count - a.count) || (a.index - b.index))
        .slice(0, CONFESS_MOOD_LIMIT)
        .map(item => item.mood);
}

export const confessMoodOf = (view, moods) => (moods.includes(view?.mood) ? view.mood : '');

export function renderMoodFilter(moods, selected) {
    const pill = (value, label) => `<button type="button" class="pm-scene-mood ${value === selected ? 'is-active' : ''}" data-action="filter-mood" data-mood="${escapeAttr(value)}" aria-pressed="${value === selected}">${escapeHtml(label)}</button>`;
    return `<div class="pm-scene-moods" role="group" aria-label="心情筛选">${pill('', '全部')}${moods.map(mood => pill(mood, mood)).join('')}</div>`;
}

// 发布时的心情选择：可以不选，再点一次取消。
export function renderMoodPicker(moods, selected = '') {
    const choices = [...new Set([...moods, '心动', '委屈', '想念', '秘密', '释然'])].slice(0, 6);
    return `<div class="pm-scene-moods is-picker" role="group" aria-label="发布心情">${choices.map(mood => `<button type="button" class="pm-scene-mood ${mood === selected ? 'is-active' : ''}" data-action="pick-mood" data-mood="${escapeAttr(mood)}" aria-pressed="${mood === selected}">${escapeHtml(mood)}</button>`).join('')}</div>`;
}

function renderNote(post, view) {
    const open = isOpenPost(view, post);
    const hugs = stablePostMetric(post, 'likes', 4, 120) + (post.liked ? 1 : 0);
    const replies = post.comments.length;
    const replyList = post.comments.map(comment => `<div class="pm-scene-comment"${entryAttr(comment.id)}><span><b>${escapeHtml(comment.authorNameSnapshot)}</b> <span class="pm-scene-comment-content">${escapeHtml(comment.content)}</span>${renderRetryRespond(view, comment.id, post.id, 'comment')}</span>${renderCommentActions(post, comment)}</div>`).join('');
    return `<article class="pm-scene-post is-confess is-note-${noteIndexOf(post.id)} ${open ? 'is-open' : ''}"${entryAttr(post.id)}>
        <header><span class="pm-scene-note-who">${escapeHtml(post.authorNameSnapshot)}${post.mood ? ` · ${escapeHtml(post.mood)}` : ''}</span>${renderStaleMark(post)}${open ? renderPostMenu(post) : ''}</header>
        <button type="button" class="pm-scene-note-body" data-action="toggle-open" data-post-id="${escapeAttr(post.id)}" aria-expanded="${open}"><span>${escapeHtml(post.content)}</span></button>
        ${post.image ? imageCardMarkup(post.image.desc, { postId: post.id, author: post.authorNameSnapshot }) : ''}
        <footer>${renderLikeButton(post, '抱抱', hugs, { icon: false })}<span class="pm-scene-note-replies">回应 ${replies}</span>${renderRetryRespond(view, post.id, post.id, 'post')}</footer>
        ${open ? `<div class="pm-scene-note-thread">${replies ? `<div class="pm-scene-comments">${replyList}</div>` : ''}${renderReplyComposer(post, { hidden: false })}</div>` : ''}
    </article>`;
}

export function renderConfessFeed(scene, view) {
    const moods = collectMoods(scene.posts);
    const mood = confessMoodOf(view, moods);
    const posts = scene.posts.slice().reverse().filter(post => !mood || post.mood === mood);
    const body = posts.length
        ? `<div class="pm-scene-notes">${posts.map(post => renderNote(post, view)).join('')}</div>`
        : scene.posts.length ? renderEmptyState('没有这个心情的便签', '换一个心情看看。') : renderEmptyState('树洞还是空的', '写下一句悄悄话，或者拍一拍让树洞热闹起来。');
    return `${scene.posts.length ? renderMoodFilter(moods, mood) : ''}${body}`;
}
