import { CAMERA_ICON_SVG, EDIT_ICON_SVG, HEART_ICON_SVG, LOCATION_ICON_SVG, MORE_H_ICON_SVG, POKE_ICON_SVG, REPLY_ICON_SVG, TRASH_ICON_SVG } from '../icons.js';
import { imageCardMarkup } from '../messaging.js';
import { escapeAttr, escapeHtml } from '../ui.js';
import {
    entryAttr, newestFirst, noteIndexOf, pageFeed, renderCommentActions, renderEmptyState, renderPostTime, renderReplyComposer, renderRetryRespond, renderStaleMark,
} from './view-shared.js';

// 盆友圈（原型朋友圈）：封面横幅压着「我」的头像和名字，相机钮发表；每条动态右下「··」弹出赞与评论；
// 点赞名单与评论收进同一块点缀色浅底实色块。没有详情页，评论在动态下方展开。
export const MOMENTS_AUDIENCE_LABELS = Object.freeze({ partial: '部分可见', private: '仅自己可见' });

const initialOf = name => escapeHtml(Array.from(String(name || '匿'))[0] || '匿');
const avatar = (name, size = '') => `<span class="pm-scene-moments-avatar is-note-${noteIndexOf(name)}${size ? ` ${size}` : ''}" aria-hidden="true">${initialOf(name)}</span>`;

// 点赞名单：AI 生成的 likers；用户点赞时名字已由 toggleScenePostLike 写进名单。
export const momentsLikersOf = post => (Array.isArray(post.likers) ? post.likers : []);

function renderCover(scene, authorName) {
    const me = String(authorName || '我');
    // 封面色与「我」的头像色错开一档，头像压在封面边上时不糊成一片。
    const banner = (noteIndexOf(me) % 5) + 1;
    return `<header class="pm-scene-moments-cover"><div class="pm-scene-moments-banner is-note-${banner}"><span>${escapeHtml(scene.title)}</span><button type="button" class="pm-scene-moments-camera" data-action="open-compose" aria-label="发表动态" title="发表动态">${CAMERA_ICON_SVG}</button></div><div class="pm-scene-moments-me"><b>${escapeHtml(me)}</b>${avatar(me, 'is-large')}</div></header>`;
}

// 评论：「A 回复 B：…」，回复对象由 quoteId 指向的那条评论决定；没有引用就是「A：…」。
function renderComment(post, comment, view) {
    const target = comment.quoteId ? post.comments.find(item => item.id === comment.quoteId) : null;
    const reply = target ? ` 回复 <b>${escapeHtml(target.authorNameSnapshot)}</b>` : '';
    return `<div class="pm-scene-moments-comment"${entryAttr(comment.id)}><span class="pm-scene-comment-content"><b>${escapeHtml(comment.authorNameSnapshot)}</b>${reply}：${escapeHtml(comment.content)}</span>${renderCommentActions(post, comment)}${renderRetryRespond(view, comment.id, post.id, 'comment')}</div>`;
}

function renderSocial(post, view) {
    const likers = momentsLikersOf(post);
    if (!likers.length && !post.comments.length) return '';
    const likes = likers.length ? `<p class="pm-scene-moments-likers">${HEART_ICON_SVG}<span>${escapeHtml(likers.join('、'))}</span></p>` : '';
    return `<div class="pm-scene-moments-social">${likes}${post.comments.map(comment => renderComment(post, comment, view)).join('')}</div>`;
}

// 「··」浮层：赞、评论，以及拍一拍、编辑、删除；展开时同条动态的评论编辑删除键一起出现。
function renderPopover(post) {
    const id = escapeAttr(post.id);
    return `<div class="pm-scene-post-actions-wrap pm-scene-moments-menu"><button type="button" class="pm-scene-post-more pm-scene-moments-dots" data-action="post-actions" aria-label="赞与评论" title="赞与评论" aria-expanded="false">${MORE_H_ICON_SVG}</button><span class="pm-scene-post-actions pm-scene-moments-pop" hidden><button type="button" class="pm-scene-like ${post.liked ? 'is-liked' : ''}" data-action="like" data-post-id="${id}" aria-pressed="${post.liked}">${HEART_ICON_SVG}<span>${post.liked ? '取消' : '赞'}</span></button><button type="button" data-action="toggle-reply" data-post-id="${id}" aria-controls="pm-comment-composer-${id}" aria-expanded="false">${REPLY_ICON_SVG}<span>评论</span></button><button type="button" data-action="comments" data-post-id="${id}" aria-label="拍一拍本条，只生成评论" title="拍一拍本条">${POKE_ICON_SVG}</button><button type="button" data-action="edit-post" data-post-id="${id}" aria-label="编辑动态" title="编辑动态">${EDIT_ICON_SVG}</button><button type="button" data-action="delete-post" data-post-id="${id}" aria-label="删除动态" title="删除动态">${TRASH_ICON_SVG}</button></span></div>`;
}

function renderMoment(post, view, now) {
    const place = post.place ? `<p class="pm-scene-moments-place">${LOCATION_ICON_SVG}<span>${escapeHtml(post.place)}</span></p>` : '';
    const audience = MOMENTS_AUDIENCE_LABELS[post.audience] ? `<span>${MOMENTS_AUDIENCE_LABELS[post.audience]}</span>` : '';
    return `<article class="pm-scene-post is-moments"${entryAttr(post.id)}>${avatar(post.authorNameSnapshot)}<div class="pm-scene-moments-body"><b class="pm-scene-moments-name">${escapeHtml(post.authorNameSnapshot)}</b><p class="pm-scene-moments-text">${escapeHtml(post.content).replace(/\n/g, '<br>')}</p>${post.image ? imageCardMarkup(post.image.desc, { postId: post.id, author: post.authorNameSnapshot }) : ''}${place}
        <div class="pm-scene-moments-foot"><span class="pm-scene-moments-meta">${renderPostTime(post.createdAt, now)}${audience}${renderStaleMark(post)}</span>${renderPopover(post)}</div>
        ${renderRetryRespond(view, post.id, post.id, 'post')}${renderSocial(post, view)}${renderReplyComposer(post)}</div></article>`;
}

export function renderMomentsFeed(scene, view, now, { authorName = '' } = {}) {
    const posts = newestFirst(scene.posts);
    const { shown, more } = pageFeed(posts, view);
    const body = posts.length ? shown.map(post => renderMoment(post, view, now)).join('') + more : renderEmptyState('还没有动态', '点封面上的相机发表第一条，或者拍一拍让朋友圈动起来。');
    return `${renderCover(scene, authorName)}<div class="pm-scene-moments-list">${body}</div>`;
}
