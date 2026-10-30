import { escapeAttr, escapeHtml } from '../ui.js';
import { imageCardMarkup } from '../messaging.js';
import {
    collectFilterChips, compactCount, entryAttr, newestFirst, noteIndexOf, renderAvatar, renderCommentActions, renderEmptyState, renderFilterChips,
    renderPostMenu, renderPostTime, renderRetryRespond, renderStaleMark, stablePostMetric,
} from './view-shared.js';

// 今日猴条（原型今日头条）：一排真筛选的栏目胶囊，第一条是要闻色块卡，往下是「左标题右缩略块」的列表面板。
// 作者是媒体；「突发」用红色小标签，与点缀色分开。没有发布入口，详情页底部只有评论输入条。

export const NEWS_BREAKING_COLUMN = '突发';
export const newsColumnsOf = posts => collectFilterChips(posts.map(post => post.column));
export const newsCommentCountOf = post => post.comments.length + stablePostMetric(post, 'comments', 20, 4000);

// 标题优先用 title；没有时取正文第一句（不超过 40 字），剩下的是导语与正文。
export function splitNewsText(post) {
    const content = String(post?.content || '').trim();
    if (post?.title) return { title: post.title, paragraphs: content.split(/\n+/).filter(Boolean) };
    const match = /^(.{4,40}?[。！？!?])/u.exec(content) || /^(.{1,40})\n/u.exec(content);
    const title = match ? match[1].replace(/[。]$/u, '') : Array.from(content).slice(0, 40).join('');
    const rest = content.slice(match ? match[0].length : title.length).trim();
    return { title, paragraphs: rest.split(/\n+/).filter(Boolean) };
}

const columnTag = post => (post.column === NEWS_BREAKING_COLUMN
    ? `<span class="pm-scene-news-tag is-breaking">${escapeHtml(post.column)}</span>`
    : post.column ? `<span class="pm-scene-news-tag">${escapeHtml(post.column)}</span>` : '');

const metaLine = (post, now) => `<span class="pm-scene-news-meta"><span>${escapeHtml(post.authorNameSnapshot)}</span><span>${compactCount(newsCommentCountOf(post))}评</span>${renderPostTime(post.createdAt, now)}${renderStaleMark(post)}</span>`;

function renderLead(post, now, view) {
    const { title, paragraphs } = splitNewsText(post);
    return `<article class="pm-scene-news-lead"${entryAttr(post.id)}><button type="button" class="pm-scene-news-open" data-action="open-thread" data-post-id="${escapeAttr(post.id)}">${columnTag(post)}<b>${escapeHtml(title)}</b>${paragraphs[0] ? `<span class="pm-scene-news-dek">${escapeHtml(paragraphs[0])}</span>` : ''}</button>${metaLine(post, now)}${renderRetryRespond(view, post.id, post.id, 'post')}</article>`;
}

// 缩略块：有配图描述时显示描述，否则显示栏目名；颜色按帖子 id 稳定取便签色。
function renderRow(post, now, view) {
    const { title } = splitNewsText(post);
    const thumb = `<span class="pm-scene-news-thumb is-note-${noteIndexOf(post.id)}" aria-hidden="true">${escapeHtml(post.image?.desc || post.column || post.authorNameSnapshot)}</span>`;
    return `<li${entryAttr(post.id)}><button type="button" class="pm-scene-news-row" data-action="open-thread" data-post-id="${escapeAttr(post.id)}"><span class="pm-scene-news-row-main"><b>${escapeHtml(title)}</b><span class="pm-scene-news-row-meta">${post.column === NEWS_BREAKING_COLUMN ? columnTag(post) : ''}<span>${escapeHtml(post.authorNameSnapshot)}</span><span>${compactCount(newsCommentCountOf(post))}评</span>${renderPostTime(post.createdAt, now)}</span></span>${thumb}</button>${renderRetryRespond(view, post.id, post.id, 'post')}</li>`;
}

function renderList(scene, view, now) {
    const tag = typeof view?.tag === 'string' ? view.tag : '';
    const chips = newsColumnsOf(scene.posts);
    const selected = chips.includes(tag) ? tag : '';
    const posts = newestFirst(scene.posts).filter(post => !selected || post.column === selected);
    if (!posts.length) return `${renderFilterChips(chips, selected, '栏目')}${renderEmptyState('还没有新闻', '拍一拍，看看今天发生了什么。')}`;
    const [lead, ...rest] = posts;
    return `${renderFilterChips(chips, selected, '栏目')}${renderLead(lead, now, view)}${rest.length ? `<ul class="pm-scene-news-sheet">${rest.map(post => renderRow(post, now, view)).join('')}</ul>` : ''}`;
}

function renderComment(post, comment, now, view) {
    const likes = stablePostMetric(comment, 'likes', 0, 600);
    return `<div class="pm-scene-news-comment"${entryAttr(comment.id)}>${renderAvatar(comment.authorNameSnapshot, { small: true })}<div class="pm-scene-comment-main"><div class="pm-scene-comment-head"><b>${escapeHtml(comment.authorNameSnapshot)}</b>${renderPostTime(comment.createdAt, now)}</div><span class="pm-scene-comment-content">${escapeHtml(comment.content)}</span>${renderRetryRespond(view, comment.id, post.id, 'comment')}</div><span class="pm-scene-comment-like" aria-label="赞 ${likes}">${likes}</span>${renderCommentActions(post, comment)}</div>`;
}

function renderArticle(post, now, view) {
    const { title, paragraphs } = splitNewsText(post);
    const [dek, ...body] = paragraphs;
    const comments = post.comments.length
        ? `<div class="pm-scene-news-comments">${post.comments.map(comment => renderComment(post, comment, now, view)).join('')}</div>`
        : '<p class="pm-scene-xhs-quiet">还没有评论</p>';
    return `<article class="pm-scene-post is-news"${entryAttr(post.id)}><header>${columnTag(post)}${renderPostMenu(post)}</header>
        <h4 class="pm-scene-news-headline">${escapeHtml(title)}</h4><p class="pm-scene-news-source"><b>${escapeHtml(post.authorNameSnapshot)}</b>${renderPostTime(post.createdAt, now)}${renderStaleMark(post)}</p>
        ${dek ? `<p class="pm-scene-news-dek is-detail">${escapeHtml(dek)}</p>` : ''}${body.map(text => `<p class="pm-scene-news-para">${escapeHtml(text)}</p>`).join('')}${post.image ? imageCardMarkup(post.image.desc, { postId: post.id, author: post.authorNameSnapshot }) : ''}${renderRetryRespond(view, post.id, post.id, 'post')}
        <h5 class="pm-scene-floors-title">网友评论 ${post.comments.length}</h5>${comments}</article>`;
}

export function renderNewsFeed(scene, view, now) {
    const post = view?.postId ? scene.posts.find(item => item.id === view.postId) : null;
    return post ? renderArticle(post, now, view) : renderList(scene, view, now);
}
