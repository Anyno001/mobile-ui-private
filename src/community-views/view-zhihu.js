import { escapeAttr, escapeHtml } from '../ui.js';
import {
    compactCount, entryAttr, isOpenPost, renderAvatar, renderCommentActions, renderComposePill, renderEmptyState, renderPostMenu, renderReplyComposer,
    renderReplyToggle, renderRetryRespond, renderStaleMark, stablePostMetric,
} from './view-shared.js';

// 吱乎（原型知乎）：通栏阅读。首页是问题列表（问题、高赞回答前两行、赞同与评论数），问题页列出全部回答，
// 回答默认折叠 6 行。帖子按 question 分组，做法同书评按 work 分组：每条 post 是一个回答；
// ask=true 的那条是用户自己提的问题，正文是补充说明，不算回答。

export const ZHIHU_OTHER_QUESTION = '其他回答';
export const zhihuAgreesOf = post => stablePostMetric(post, 'agrees', 3, 4200) + (post.liked ? 1 : 0);
const commentCountOf = post => post.comments.length + stablePostMetric(post, 'comments', 0, 60);

// 分组：保持首次出现的顺序，最近有动静的问题排在前面。
export function groupZhihuQuestions(posts) {
    const groups = new Map();
    (posts || []).forEach((post, index) => {
        const question = post.question || ZHIHU_OTHER_QUESTION;
        const group = groups.get(question) || { question, ask: null, answers: [], latest: 0, order: index };
        if (post.ask === true && !group.ask) group.ask = post;
        else group.answers.push(post);
        group.latest = Math.max(group.latest, Number(post.createdAt) || 0);
        groups.set(question, group);
    });
    return [...groups.values()].sort((a, b) => (b.latest - a.latest) || (b.order - a.order));
}

const byAgrees = answers => answers.map((post, index) => ({ post, index }))
    .sort((a, b) => (zhihuAgreesOf(b.post) - zhihuAgreesOf(a.post)) || (a.index - b.index)).map(item => item.post);
// 补充说明与问题相同（提问时没写补充）就不重复显示。
const supplementOf = group => (group.ask && group.ask.content !== group.question ? group.ask.content : '');

function renderQuestionRow(group, view) {
    const top = byAgrees(group.answers)[0] || null;
    const anchor = top || group.ask;
    const excerpt = top
        ? `<span class="pm-scene-zhihu-excerpt"><b>${escapeHtml(top.authorNameSnapshot)}：</b>${escapeHtml(top.content)}</span>`
        : `<span class="pm-scene-zhihu-excerpt">${escapeHtml(supplementOf(group) || '还没有回答')}</span>`;
    const meta = top ? `赞同 ${compactCount(zhihuAgreesOf(top))} · 评论 ${commentCountOf(top)}` : `${group.answers.length}个回答`;
    return `<li${entryAttr(anchor.id)}><button type="button" class="pm-scene-zhihu-row" data-action="open-question" data-question="${escapeAttr(group.question)}"><b class="pm-scene-zhihu-question">${escapeHtml(group.question)}</b>${excerpt}<span class="pm-scene-zhihu-meta">${escapeHtml(meta)}</span></button>${renderRetryRespond(view, anchor.id, anchor.id, 'post')}</li>`;
}

// 首页：一行「N 个问题」加「提问」胶囊（顶栏右侧只放拍一拍与 ⋯，提问入口放在这里）。
function renderHome(scene, view) {
    const groups = groupZhihuQuestions(scene.posts);
    const head = `<div class="pm-scene-zhihu-head"><span>${groups.length}个问题</span>${renderComposePill('提问')}</div>`;
    return groups.length
        ? `${head}<ul class="pm-scene-zhihu-list">${groups.map(group => renderQuestionRow(group, view)).join('')}</ul>`
        : `${head}${renderEmptyState('还没有问题', '提一个问题，或者拍一拍让社区动起来。')}`;
}

// 回答正文超过这个长度（或段落较多）才可能被 6 行截断，此时给「阅读全文」。
const isLongAnswer = content => String(content || '').length > 120 || String(content || '').split('\n').length > 6;

function renderComment(post, comment, view) {
    return `<div class="pm-scene-zhihu-comment"${entryAttr(comment.id)}>${renderAvatar(comment.authorNameSnapshot, { small: true })}<span class="pm-scene-comment-content"><b>${escapeHtml(comment.authorNameSnapshot)}</b>${escapeHtml(comment.content)}</span>${renderCommentActions(post, comment)}${renderRetryRespond(view, comment.id, post.id, 'comment')}</div>`;
}

// 展开 = 看全文并看评论；评论按钮打开输入框。
function renderAnswer(post, view) {
    const open = isOpenPost(view, post);
    const long = isLongAnswer(post.content);
    const agrees = zhihuAgreesOf(post);
    const toggle = long || post.comments.length
        ? `<button type="button" class="pm-scene-zhihu-more" data-action="toggle-open" data-post-id="${escapeAttr(post.id)}" aria-expanded="${open}">${open ? '收起' : long ? '阅读全文' : `查看${post.comments.length}条评论`}</button>` : '';
    const comments = open && post.comments.length ? `<div class="pm-scene-zhihu-comments">${post.comments.map(comment => renderComment(post, comment, view)).join('')}</div>` : '';
    return `<article class="pm-scene-post is-zhihu"${entryAttr(post.id)}><header>${renderAvatar(post.authorNameSnapshot)}<div class="pm-scene-post-author"><b>${escapeHtml(post.authorNameSnapshot)}</b>${post.authorBio ? `<span class="pm-scene-zhihu-bio">${escapeHtml(post.authorBio)}</span>` : ''}${renderStaleMark(post)}</div>${renderPostMenu(post)}</header>
        <p class="pm-scene-zhihu-body${open ? ' is-open' : ''}">${escapeHtml(post.content).replace(/\n/g, '<br>')}</p>${toggle}
        <footer><button type="button" class="pm-scene-like pm-scene-zhihu-agree ${post.liked ? 'is-liked' : ''}" data-action="like" data-post-id="${escapeAttr(post.id)}" aria-pressed="${post.liked}" aria-label="${post.liked ? '取消赞同' : '赞同'}">赞同 ${compactCount(agrees)}</button>${renderReplyToggle(post, { label: '评论', count: commentCountOf(post) })}</footer>
        ${renderRetryRespond(view, post.id, post.id, 'post')}${comments}${renderReplyComposer(post)}</article>`;
}

function renderQuestionPage(group, view) {
    const supplement = supplementOf(group);
    const answers = byAgrees(group.answers);
    const asked = group.ask ? `<span>${escapeHtml(group.ask.authorNameSnapshot)} 提问</span>` : '';
    const askMenu = group.ask ? renderPostMenu(group.ask) : '';
    return `<section class="pm-scene-zhihu-hero"${group.ask ? entryAttr(group.ask.id) : ''}><div class="pm-scene-zhihu-hero-head"><h4>${escapeHtml(group.question)}</h4>${askMenu}</div>${supplement ? `<p>${escapeHtml(supplement).replace(/\n/g, '<br>')}</p>` : ''}<div class="pm-scene-zhihu-meta"><span>${answers.length}个回答</span>${asked}</div>${group.ask ? renderRetryRespond(view, group.ask.id, group.ask.id, 'post') : ''}</section>
        ${answers.length ? answers.map(post => renderAnswer(post, view)).join('') : renderEmptyState('还没有回答', '写下第一个回答。')}`;
}

export const findZhihuQuestion = (scene, question) => (question ? groupZhihuQuestions(scene.posts).find(group => group.question === question) || null : null);

export function renderZhihuFeed(scene, view) {
    const group = findZhihuQuestion(scene, view?.question);
    return group ? renderQuestionPage(group, view) : renderHome(scene, view);
}
