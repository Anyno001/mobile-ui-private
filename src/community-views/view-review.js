import { escapeAttr, escapeHtml } from '../ui.js';
import { imageCardMarkup } from '../messaging.js';
import {
    entryAttr, isOpenPost, noteIndexOf, renderAvatar, renderComposePill, renderCommentMenu, renderEmptyState, renderLikeButton, renderPostMenu, renderPostTime, renderRating,
    renderRetryRespond, renderStaleMark, renderStars, splitTitle, stablePostMetric, summarizeBookRatings, validStarRating,
} from './view-shared.js';

export const REVIEW_SEGMENTS = Object.freeze([
    { id: 'reviews', label: '书评' },
    { id: 'shelf', label: '书架' },
]);

export const reviewSegmentOf = view => (REVIEW_SEGMENTS.some(item => item.id === view?.segment) ? view.segment : 'reviews');

// 书架：按 work 分组，保持首次出现的顺序反向（最新的书在前）；没有书名的帖子不进书架。
export function groupBooks(posts) {
    const books = new Map();
    for (const post of posts || []) {
        if (!post.work) continue;
        const book = books.get(post.work) || { work: post.work, workAuthor: '', posts: [] };
        if (!book.workAuthor && post.workAuthor) book.workAuthor = post.workAuthor;
        book.posts.push(post);
        books.set(post.work, book);
    }
    return [...books.values()].reverse();
}

const coverClass = work => `is-note-${noteIndexOf(work)}`;

function renderCover(work, { large = false } = {}) {
    return `<span class="pm-scene-cover ${coverClass(work)} ${large ? 'is-large' : ''}" aria-hidden="true"><b>${escapeHtml(work)}</b></span>`;
}

function renderBookTile(book) {
    const summary = summarizeBookRatings(book.posts);
    return `<button type="button" class="pm-scene-book" data-action="open-book" data-work="${escapeAttr(book.work)}" aria-label="${escapeAttr(`${book.work}${summary.average10 ? `，${summary.average10} 分` : ''}`)}">${renderCover(book.work)}<span class="pm-scene-book-name">${escapeHtml(book.work)}</span><span class="pm-scene-book-meta">${summary.average10 ? `<span class="pm-scene-book-score">★ ${summary.average10}</span>` : '暂无评分'}</span></button>`;
}

function renderShelf(books) {
    if (!books.length) return renderEmptyState('书架还是空的', '写一篇书评，书就会出现在这里。');
    return `<div class="pm-scene-shelf">${books.map(renderBookTile).join('')}</div>`;
}

function reviewExcerpt(post) {
    const { title, body } = post.title ? { title: post.title, body: post.content } : splitTitle(post.content);
    return { title, body };
}

function renderReviewCard(post, now, view) {
    const { title, body } = reviewExcerpt(post);
    // 正文默认收成四行；字数或段落多到可能被截断时才给「展开全文」。
    const long = String(body || '').length > 90 || String(body || '').split('\n').length > 4;
    const open = long && isOpenPost(view, post);
    const useful =stablePostMetric(post, 'likes', 8, 240) + (post.liked ? 1 : 0);
    const book = post.work ? `<button type="button" class="pm-scene-review-book" data-action="open-book" data-work="${escapeAttr(post.work)}"><span><b>${escapeHtml(post.work)}</b><span class="pm-scene-review-author">${escapeHtml(post.workAuthor || '佚名')}</span></span></button>` : '<span class="pm-scene-review-book is-plain"><span><b>未标注书名</b></span></span>';
    return `<article class="pm-scene-post is-review"${entryAttr(post.id)}><header>${book}${renderPostMenu(post)}</header>
        ${renderRating(post.rating, { size: 'large' })}${title ? `<h4 class="pm-scene-post-title">${escapeHtml(title)}</h4>` : ''}<p class="pm-scene-review-body${open ? ' is-open' : ''}">${escapeHtml(body).replace(/\n/g, '<br>')}</p>${long ? `<button type="button" class="pm-scene-comments-more pm-scene-review-more" data-action="toggle-open" data-post-id="${escapeAttr(post.id)}" aria-expanded="${open}">${open ? '收起' : '展开全文'}</button>` : ''}${post.image ? imageCardMarkup(post.image.desc, { postId: post.id, author: post.authorNameSnapshot }) : ''}
        <footer><span class="pm-scene-review-by">${escapeHtml(post.authorNameSnapshot)} ${renderPostTime(post.createdAt, now)}${renderStaleMark(post)}</span>${renderLikeButton(post, '有用', useful, { icon: false })}${renderRetryRespond(view, post.id, post.id, 'post')}</footer></article>`;
}

function renderDistribution(summary) {
    const rows = summary.distribution.map((count, index) => `<div class="pm-scene-dist-row"><span>${5 - index}星</span><progress max="${Math.max(summary.count, 1)}" value="${count}" aria-label="${5 - index} 星 ${count} 人"></progress></div>`).join('');
    return `<section class="pm-scene-dist" aria-label="评分分布"><div class="pm-scene-dist-score"><b>${summary.average10 || '--'}</b>${renderStars(Math.round(summary.average5), { size: 'large' })}<span>${summary.count} 人评分</span></div><div class="pm-scene-dist-bars">${rows}</div></section>`;
}

function renderShortComment(post, comment, now) {
    return `<div class="pm-scene-short"${entryAttr(comment.id)}><header>${renderAvatar(comment.authorNameSnapshot)}<div class="pm-scene-post-author"><b>${escapeHtml(comment.authorNameSnapshot)}</b><span class="pm-scene-short-meta">${renderRating(comment.rating, { score: false, size: 'medium' })}<span class="pm-scene-short-tag">短评</span>${renderPostTime(comment.createdAt, now)}</span></div>${renderCommentMenu(post, comment)}</header><p class="pm-scene-comment-content">${escapeHtml(comment.content).replace(/\n/g, '<br>')}</p></div>`;
}

function renderBookPage(book, now, view) {
    const summary = summarizeBookRatings(book.posts);
    const shorts = book.posts.flatMap(post => post.comments.map(comment => ({ post, comment })));
    return `<section class="pm-scene-book-hero">${renderCover(book.work, { large: true })}<div class="pm-scene-book-info"><b>${escapeHtml(book.work)}</b><span>${escapeHtml(book.workAuthor || '佚名')}</span>${renderComposePill('写书评')}</div></section>
        ${renderDistribution(summary)}
        ${book.posts.slice().reverse().map(post => renderReviewCard(post, now, view)).join('')}
        ${shorts.length ? `<section class="pm-scene-shorts" aria-label="短评">${shorts.map(({ post, comment }) => renderShortComment(post, comment, now)).join('')}</section>` : ''}`;
}

// 分段与“写书评”胶囊同一行：分段靠左，胶囊靠右。
function renderSegments(segment) {
    return `<div class="pm-scene-segment-row"><div class="pm-scene-segments" role="group" aria-label="书评视图">${REVIEW_SEGMENTS.map(item => `<button type="button" class="pm-scene-segment ${item.id === segment ? 'is-active' : ''}" data-action="set-segment" data-segment="${item.id}" aria-pressed="${item.id === segment}">${item.label}</button>`).join('')}</div>${renderComposePill('写书评')}</div>`;
}

export function renderReviewFeed(scene, view, now) {
    const books = groupBooks(scene.posts);
    const current = view?.work ? books.find(book => book.work === view.work) : null;
    if (current) return renderBookPage(current, now, view);
    const segment = reviewSegmentOf(view);
    const reviews = scene.posts.slice().reverse();
    const body = segment === 'shelf'
        ? renderShelf(books)
        : reviews.length ? reviews.map(post => renderReviewCard(post, now, view)).join('') : renderEmptyState('还没有书评', '写一篇书评，或者拍一拍让社区动起来。');
    return `${renderSegments(segment)}${body}`;
}

// 发布书评时底栏的星级选择；选中的星数由 data-rating 与 aria-pressed 表达，发布时从 DOM 读取。
export function renderRatingPicker(selected = 0) {
    const value = validStarRating(selected) ? selected : 0;
    return `<div class="pm-scene-rating-picker" role="group" aria-label="书评星级">${[1, 2, 3, 4, 5].map(star => `<button type="button" class="pm-scene-star ${star <= value ? 'is-on' : ''}" data-action="pick-rating" data-rating="${star}" aria-pressed="${star === value}" aria-label="${star} 星">★</button>`).join('')}</div>`;
}
