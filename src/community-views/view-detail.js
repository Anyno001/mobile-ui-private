// 社区工作区的详情状态与底栏：哪些平台此刻在单帖详情页或知乎问题页，返回键该走哪个动作，底部放什么。
// 由 interactive-scene-views.js 调用；楼层式平台的「回复楼主」仍由那边的 renderThreadReplyBar 输出。
import { THREAD_PLATFORMS } from '../interactive-scene-constants.js';
import { HEART_ICON_SVG, REPLY_ICON_SVG, SEND_ICON_SVG, STAR_ICON_SVG } from '../icons.js';
import { escapeAttr } from '../ui.js';
import { newsCommentCountOf } from './view-news.js';
import { xhsCollectsOf, xhsLikesOf } from './view-xhs.js';
import { findZhihuQuestion } from './view-zhihu.js';

// 小红书笔记页、新闻正文页：帖子还在时才算详情页（被删后自动回到列表）。
const POST_DETAIL_PLATFORMS = Object.freeze(['xhs', 'news']);

export function detailStateOf(scene, platform, view) {
    const thread = THREAD_PLATFORMS.includes(platform) && !!view.postId;
    const post = POST_DETAIL_PLATFORMS.includes(platform) && view.postId ? scene.posts.find(item => item.id === view.postId) || null : null;
    const question = platform === 'zhihu' && !!findZhihuQuestion(scene, view.question);
    return { thread, post, question, detail: thread || !!post || question };
}

export const detailBackAction = state => (state.question
    ? 'data-action="close-question" aria-label="返回问题列表" title="返回问题列表"'
    : 'data-action="close-thread" aria-label="返回列表" title="返回列表"');

// 小红书笔记页、新闻正文页的底部输入条：小红书「说点什么…」加赞、收藏、评论数；新闻「说说你的看法…」加评论数。
// 楼层式平台的「回复楼主」仍是 interactive-scene-views.js 的 renderThreadReplyBar。
const DETAIL_HINTS = Object.freeze({ xhs: '说点什么…', news: '说说你的看法…' });

function renderDetailStats(platform, post, counts) {
    if (platform === 'xhs') {
        return `<div class="pm-scene-detail-stats"><button type="button" class="pm-scene-like ${post.liked ? 'is-liked' : ''}" data-action="like" data-post-id="${escapeAttr(post.id)}" aria-pressed="${post.liked}" aria-label="${post.liked ? '取消赞' : '赞'} ${counts.likes}">${HEART_ICON_SVG}<span>${counts.likes}</span></button><button type="button" class="pm-scene-share ${post.shared ? 'is-shared' : ''}" data-action="share" data-post-id="${escapeAttr(post.id)}" aria-pressed="${post.shared}" aria-label="${post.shared ? '已收藏' : '收藏'} ${counts.collects}">${STAR_ICON_SVG}<span>${counts.collects}</span></button><span class="pm-scene-detail-stat" aria-label="评论 ${post.comments.length}">${REPLY_ICON_SVG}<span>${post.comments.length}</span></span></div>`;
    }
    if (platform === 'news') {
        return `<div class="pm-scene-detail-stats"><span class="pm-scene-detail-stat" aria-label="评论 ${counts.comments}">${REPLY_ICON_SVG}<span>${counts.comments}</span></span></div>`;
    }
    return '';
}

function renderDetailBar(platform, post, counts = {}) {
    const stats = post ? renderDetailStats(platform, post, counts) : '';
    return `<div class="pm-scene-bottom-bar${stats ? ' has-stats' : ''}"><div class="pm-scene-compose"><div class="pm-scene-composer"><textarea id="pm-scene-post-input" maxlength="1000" placeholder="${DETAIL_HINTS[platform] || '说点什么…'}"></textarea><button type="button" class="pm-scene-primary" data-action="reply-owner" aria-label="发送评论" title="发送评论">${SEND_ICON_SVG}</button></div></div>${stats}</div>`;
}

export function renderPostDetailBar(platform, post) {
    const counts = platform === 'xhs' ? { likes: xhsLikesOf(post), collects: xhsCollectsOf(post) } : { comments: newsCommentCountOf(post) };
    return renderDetailBar(platform, post, counts);
}
