import { appNameOf, appSloganOf } from './app-names.js';
import {
    BACK_ICON_SVG, EDIT_ICON_SVG, MORE_ICON_SVG, PAUSE_ICON_SVG, PLAY_ICON_SVG, POKE_ICON_SVG, SEND_ICON_SVG, STAR_ICON_SVG, TRASH_ICON_SVG,
} from './icons.js';
import { escapeAttr, escapeHtml } from './ui.js';
import {
    VIDEO_CATEGORIES, VIDEO_FLY_SECONDS, VIDEO_REPLY_PREVIEW, commentLikeCount, commentTimeLabel, formatDuration, formatVideoCount,
    isUploaderAuthor, sceneIndexAt, sortComments, videoInitial, videoStats, visibleDanmaku,
} from './video-format.js';

// 视频页渲染：复用直播的壳（.pm-live-shell）、顶栏、表单与暗色画面 class，视频专属的只有 .pm-video-*。
const svg = body => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
const THUMB_ICON = svg('<path d="M7 11v9H4v-9zM7 11l4-7c1.6 0 2.3 1.1 2 2.6L12.6 10H19c1 0 1.8.9 1.5 1.9l-1.4 6.5c-.2.9-1 1.6-2 1.6H7"/>');
const COIN_ICON = svg('<circle cx="12" cy="12" r="8.2"/><path d="M9.6 9.6h4.8v4.8H9.6z"/>');
const DESC_FOLD_LENGTH = 40;

const statusStrip = status => `<div class="pm-live-status" role="status" aria-live="polite"${status ? '' : ' hidden'}>${escapeHtml(status || '')}</div>`;
const iconButton = (action, label, icon, extra = '') => `<button type="button" class="pm-live-icon-button" data-video-action="${action}" aria-label="${escapeAttr(label)}" title="${escapeAttr(label)}"${extra}>${icon}</button>`;

// 顶栏三栏：返回在左，标题整屏正中，右侧同宽（直播页同一套网格）。
const topbar = ({ left, title, right }) => `<div class="pm-live-topbar">${left}<b class="pm-live-heading">${escapeHtml(title)}</b>${right}</div>`;
const backButton = (attr, label = '返回') => `<button type="button" class="pm-live-icon-button" ${attr} aria-label="${label}" title="${label}">${BACK_ICON_SVG}</button>`;

// 噼哩噼哩首页的「视频 / 直播」分段，两个分区都是真分区。
export function renderAppTabs(segment) {
    const tab = (id, label) => `<button type="button" class="pm-live-chip" data-live-action="segment" data-segment="${id}" aria-pressed="${segment === id}">${label}</button>`;
    return `<div class="pm-video-segments" role="group" aria-label="分区">${tab('video', '视频')}${tab('live', '直播')}</div>`;
}

export function renderVideoHome({ videos = [], status = '' } = {}) {
    const cards = videos.map(video => `<article class="pm-live-card pm-video-card"><button type="button" class="pm-live-card-open" data-video-action="open-video" data-video-id="${escapeAttr(video.id)}" aria-label="打开视频：${escapeAttr(video.title)}"><span class="pm-live-cover pm-video-cover is-cover-${video.cover}"><span class="pm-video-cover-title">${escapeHtml(video.coverTitle)}</span>${video.pending ? '<span class="pm-live-pill is-off">生成中</span>' : ''}<span class="pm-video-duration">${escapeHtml(video.duration)}</span></span><span class="pm-live-card-info pm-video-card-info"><b>${escapeHtml(video.title)}</b><span>${escapeHtml(video.uploader)} · ${escapeHtml(video.views)}播放</span></span></button></article>`).join('');
    const body = cards
        ? `<div class="pm-live-grid">${cards}</div>`
        : '<div class="pm-live-empty"><b>还没有视频</b><button type="button" class="pm-live-primary" data-video-action="compose">投稿</button></div>';
    return `<div id="pm-live-app" class="pm-live-shell" data-live-view="video-home">
        ${topbar({ left: backButton('data-live-action="desktop"', '返回桌面'), title: appNameOf('live'), right: '<button type="button" class="pm-live-pill-button" data-video-action="compose">投稿</button>' })}
        ${renderAppTabs('video')}
        ${statusStrip(status)}
        <div class="pm-live-scroll"><p class="pm-live-slogan">${escapeHtml(appSloganOf('live'))}</p>${body}</div>
    </div>`;
}

// 画面中央的分镜文字：切换分镜时换一个新节点，淡入动画随之重播。
export function renderVideoScene(video, time) {
    const index = sceneIndexAt(video.scenes, time);
    return `<p class="pm-video-scene" data-scene-index="${index}">${escapeHtml(video.scenes[index]?.text || '')}</p>`;
}

// 当前时间窗口内飘过的弹幕。轨道与延迟由时间点算出，是数据驱动值。
export function renderVideoFly(video, time) {
    return visibleDanmaku(video, time).map(({ item, lane, delay }) => `<span style="--lane:${lane};--delay:${delay}s;--duration:${VIDEO_FLY_SECONDS}s">${escapeHtml(item.content)}</span>`).join('');
}

export const videoTimeLabel = (video, time) => `${formatDuration(time)} / ${formatDuration(video.duration)}`;

function renderStage(video, ui) {
    const time = Math.min(video.duration, Math.max(0, Math.floor(ui.time || 0)));
    const playing = ui.playing === true;
    return `<section class="pm-video-stage" data-playing="${playing}" aria-label="视频画面" aria-busy="${ui.busy === true}">
        <div class="pm-live-fly pm-video-fly" aria-hidden="true">${renderVideoFly(video, time)}</div>
        ${renderVideoScene(video, time)}
        ${ui.pending ? `<p class="pm-live-note pm-video-note">${ui.busy ? '正在生成内容…' : '内容还没有生成，可以在菜单里重新生成。'}</p>` : ''}
        <div class="pm-video-controls">
            <button type="button" class="pm-live-glass pm-video-play" data-video-action="toggle-play" aria-pressed="${playing}" aria-label="${playing ? '暂停' : '播放'}" title="${playing ? '暂停' : '播放'}">${playing ? PAUSE_ICON_SVG : PLAY_ICON_SVG}</button>
            <input type="range" id="pm-video-seek" class="pm-video-seek" min="0" max="${video.duration}" step="1" value="${time}" aria-label="播放进度">
            <span class="pm-video-time" id="pm-video-time">${escapeHtml(videoTimeLabel(video, time))}</span>
        </div>
    </section>`;
}

function renderInfo(video, ui) {
    const stats = videoStats(video);
    const foldable = video.description.length > DESC_FOLD_LENGTH;
    const open = ui.descOpen === true;
    const meta = [escapeHtml(video.uploaderNameSnapshot), video.category ? escapeHtml(video.category) : '', `${formatVideoCount(stats.views)}播放`, `${video.danmaku.length}弹幕`].filter(Boolean).join(' · ');
    return `<section class="pm-video-info">
        <h2 class="pm-video-title">${escapeHtml(video.title)}</h2>
        <p class="pm-video-meta-line">${meta}</p>
        ${video.description ? `<p class="pm-video-desc${open ? ' is-open' : ''}">${escapeHtml(video.description)}</p>` : ''}
        ${foldable ? `<button type="button" class="pm-video-link" data-video-action="toggle-desc" aria-expanded="${open}">${open ? '收起' : '展开'}</button>` : ''}
        <div class="pm-video-stats" aria-label="互动数据"><span>${THUMB_ICON}<span>${formatVideoCount(stats.likes)}</span></span><span>${COIN_ICON}<span>${formatVideoCount(stats.coins)}</span></span><span>${STAR_ICON_SVG}<span>${formatVideoCount(stats.favorites)}</span></span></div>
    </section>`;
}

const rowActions = (editing, edit, remove) => (editing
    ? `<span class="pm-video-row-actions"><button type="button" ${edit} aria-label="编辑" title="编辑">${EDIT_ICON_SVG}</button><button type="button" class="is-danger" ${remove} aria-label="删除" title="删除">${TRASH_ICON_SVG}</button></span>` : '');
const upTag = (video, item) => (isUploaderAuthor(video, item) ? '<em class="pm-video-up">UP</em>' : '');

function renderIntro(video, ui) {
    const index = sceneIndexAt(video.scenes, ui.time || 0);
    const scenes = video.scenes.map((scene, position) => `<li><button type="button" class="pm-video-scene-row${position === index ? ' is-active' : ''}" data-video-action="seek" data-at="${scene.at}"><time>${formatDuration(scene.at)}</time><span>${escapeHtml(scene.text)}</span></button></li>`).join('');
    const danmaku = ui.editing === true
        ? `<h3 class="pm-video-subtitle">弹幕</h3>${video.danmaku.length ? `<ul class="pm-video-list">${[...video.danmaku].sort((left, right) => left.at - right.at).map(item => `<li class="pm-video-row"><time>${formatDuration(item.at)}</time><span>${escapeHtml(item.authorNameSnapshot)}：${escapeHtml(item.content)}</span>${rowActions(true, `data-video-action="edit-danmaku" data-danmaku-id="${escapeAttr(item.id)}"`, `data-video-action="delete-danmaku" data-danmaku-id="${escapeAttr(item.id)}"`)}</li>`).join('')}</ul>` : '<p class="pm-video-empty">还没有弹幕</p>'}` : '';
    return `<div class="pm-video-panel" role="tabpanel"><ul class="pm-video-list">${scenes}</ul>${danmaku}</div>`;
}

function renderReply(video, comment, reply, ui) {
    const at = reply.replyTo ? `<span>回复 <em class="pm-video-at">@${escapeHtml(reply.replyTo)}</em>：</span>` : '';
    return `<div class="pm-video-reply" data-entry-id="${escapeAttr(reply.id)}"><span class="pm-video-avatar is-small" aria-hidden="true">${escapeHtml(videoInitial(reply.authorNameSnapshot))}</span><div class="pm-video-main"><p class="pm-video-text"><b class="pm-video-name">${escapeHtml(reply.authorNameSnapshot)}</b>${upTag(video, reply)}${at}${escapeHtml(reply.content)}</p><div class="pm-video-meta"><time>${escapeHtml(commentTimeLabel(reply.createdAt, ui.now))}</time><button type="button" class="pm-video-link" data-video-action="reply" data-comment-id="${escapeAttr(comment.id)}" data-reply-to="${escapeAttr(reply.authorNameSnapshot)}">回复</button>${rowActions(ui.editing === true, `data-video-action="edit-reply" data-comment-id="${escapeAttr(comment.id)}" data-reply-id="${escapeAttr(reply.id)}"`, `data-video-action="delete-reply" data-comment-id="${escapeAttr(comment.id)}" data-reply-id="${escapeAttr(reply.id)}"`)}</div></div></div>`;
}

function renderComment(video, comment, ui) {
    const open = (ui.openThreads || []).includes(comment.id);
    const shown = open ? comment.replies : comment.replies.slice(0, VIDEO_REPLY_PREVIEW);
    const toggle = comment.replies.length > VIDEO_REPLY_PREVIEW
        ? `<button type="button" class="pm-video-link" data-video-action="toggle-thread" data-comment-id="${escapeAttr(comment.id)}" aria-expanded="${open}">${open ? '收起回复' : `共 ${comment.replies.length} 条回复`}</button>` : '';
    const replies = comment.replies.length ? `<div class="pm-video-replies">${shown.map(reply => renderReply(video, comment, reply, ui)).join('')}${toggle}</div>` : '';
    const id = escapeAttr(comment.id);
    return `<article class="pm-video-comment" data-entry-id="${id}"><span class="pm-video-avatar" aria-hidden="true">${escapeHtml(videoInitial(comment.authorNameSnapshot))}</span><div class="pm-video-main"><p class="pm-video-name-row"><b class="pm-video-name">${escapeHtml(comment.authorNameSnapshot)}</b>${upTag(video, comment)}</p><p class="pm-video-text">${escapeHtml(comment.content)}</p><div class="pm-video-meta"><time>${escapeHtml(commentTimeLabel(comment.createdAt, ui.now))}</time><button type="button" class="pm-video-like" data-video-action="like-comment" data-comment-id="${id}" aria-pressed="${comment.liked === true}" aria-label="点赞">${THUMB_ICON}<span>${commentLikeCount(comment)}</span></button><button type="button" class="pm-video-link" data-video-action="reply" data-comment-id="${id}" data-reply-to="">回复</button>${rowActions(ui.editing === true, `data-video-action="edit-comment" data-comment-id="${id}"`, `data-video-action="delete-comment" data-comment-id="${id}"`)}<span class="pm-live-menu-wrap"><button type="button" class="pm-video-link" data-video-action="menu" aria-haspopup="menu" aria-expanded="false" aria-label="评论菜单" title="评论菜单">${MORE_ICON_SVG}</button><span class="pm-live-menu" role="menu" aria-label="评论菜单" hidden><button type="button" role="menuitem" data-video-action="poke-replies" data-comment-id="${id}"${ui.busy ? ' disabled' : ''}>请求回复</button></span></span></div>${replies}</div></article>`;
}

function renderComments(video, ui) {
    const sort = ui.sort === 'latest' ? 'latest' : 'hot';
    const chip = (mode, label) => `<button type="button" class="pm-video-sort" data-video-action="sort" data-sort="${mode}" aria-pressed="${sort === mode}">${label}</button>`;
    const list = sortComments(video.comments, sort).map(comment => renderComment(video, comment, ui)).join('');
    return `<div class="pm-video-panel" role="tabpanel"><div class="pm-video-sorts" role="group" aria-label="排序">${chip('hot', '热门')}${chip('latest', '最新')}</div>${list || '<p class="pm-video-empty">还没有评论，来发第一条吧。</p>'}</div>`;
}

function renderComposer(ui) {
    const target = ui.replyTo;
    const placeholder = target ? `回复 @${target.name}` : '发一条友善的评论';
    return `<div class="pm-video-composer">
        ${target ? `<div class="pm-video-reply-chip"><span>${escapeHtml(placeholder)}</span><button type="button" class="pm-video-link" data-video-action="cancel-reply">取消</button></div>` : ''}
        <div class="pm-video-composer-row"><input id="pm-video-comment-input" class="pm-live-input" maxlength="1000" placeholder="${escapeAttr(placeholder)}" aria-label="${escapeAttr(placeholder)}"><button type="button" class="pm-video-send" data-video-action="send-comment" aria-label="发送" title="发送">${SEND_ICON_SVG}</button>${iconButton('poke-comments', '拍一拍，请求一批评论', POKE_ICON_SVG, ui.busy ? ' disabled' : '')}</div>
    </div>`;
}

// 视频页。video 是存储里的视频；ui: { time, playing, tab, sort, descOpen, openThreads, editing, replyTo, busy, pending, status, now, menuOpen }。
export function renderVideoWatch({ video, ui = {} }) {
    const tab = ui.tab === 'comments' ? 'comments' : 'intro';
    const tabButton = (id, label) => `<button type="button" class="pm-video-tab" role="tab" data-video-action="tab" data-tab="${id}" aria-selected="${tab === id}">${label}</button>`;
    const menu = `<div class="pm-live-menu-wrap"><button type="button" class="pm-live-icon-button" data-video-action="menu" aria-label="视频菜单" title="视频菜单" aria-haspopup="menu" aria-expanded="false">${MORE_ICON_SVG}</button>
        <div class="pm-live-menu" role="menu" aria-label="视频菜单" hidden>
            <button type="button" role="menuitem" data-video-action="edit-video">编辑视频</button>
            <button type="button" role="menuitem" data-video-action="poke-danmaku"${ui.busy ? ' disabled' : ''}>补弹幕</button>
            ${ui.pending ? `<button type="button" role="menuitem" data-video-action="regenerate"${ui.busy ? ' disabled' : ''}>重新生成内容</button>` : ''}
            <button type="button" role="menuitem" data-video-action="toggle-editing" aria-pressed="${ui.editing === true}">${ui.editing ? '停止修改' : '修改弹幕和评论'}</button>
            <button type="button" role="menuitem" class="is-danger" data-video-action="delete-video">删除视频</button>
        </div></div>`;
    return `<div id="pm-live-app" class="pm-live-shell" data-live-view="video-watch" data-video-id="${escapeAttr(video.id)}">
        ${topbar({ left: backButton('data-video-action="home"'), title: video.title, right: menu })}
        ${statusStrip(ui.status)}
        ${renderStage(video, ui)}
        <div class="pm-video-danmaku-bar"><input id="pm-video-danmaku-input" class="pm-live-input" maxlength="60" placeholder="发个弹幕" aria-label="发个弹幕"><button type="button" class="pm-video-send" data-video-action="send-danmaku" aria-label="发送弹幕" title="发送弹幕">${SEND_ICON_SVG}</button></div>
        <div class="pm-video-body">
            ${renderInfo(video, ui)}
            <div class="pm-video-tabs" role="tablist" aria-label="视频内容">${tabButton('intro', '简介')}${tabButton('comments', `评论 ${video.comments.length}`)}</div>
            ${tab === 'comments' ? renderComments(video, ui) : renderIntro(video, ui)}
        </div>
        ${tab === 'comments' ? renderComposer(ui) : ''}
    </div>`;
}

const chip = (action, dataAttr, label, pressed) => `<button type="button" class="pm-live-chip" data-video-action="${action}" ${dataAttr} aria-pressed="${pressed}">${escapeHtml(label)}</button>`;

// 投稿页（新建与编辑共用）。form: { title, category, hostKey, hostName, idea, aiScenes, nsfw }，hosts: [{ key, label }]。
export function renderVideoCompose({ form = {}, hosts = [], editing = false, status = '' } = {}) {
    const category = String(form.category || '');
    const customCategory = category && !VIDEO_CATEGORIES.includes(category) ? category : '';
    const byUser = form.hostKey === 'user';
    const categoryChips = VIDEO_CATEGORIES.map(item => chip('pick-category', `data-category="${escapeAttr(item)}"`, item, item === category)).join('');
    const hostChips = hosts.map(host => chip('pick-host', `data-host="${escapeAttr(host.key)}"`, host.label, host.key === form.hostKey)).join('');
    const otherField = form.hostKey === 'other'
        ? `<input id="pm-video-host-name" class="pm-live-input" maxlength="80" placeholder="UP主名字" aria-label="UP主名字" value="${escapeAttr(form.hostName || '')}">` : '';
    const sw = (id, action, label, hint, on) => `<div class="pm-live-switch-row"><span class="pm-live-switch-text"><b>${label}</b><small>${hint}</small></span><button type="button" id="${id}" class="pm-live-switch ${on ? 'is-on' : ''}" role="switch" aria-checked="${on}" aria-label="${label}" data-video-action="${action}"></button></div>`;
    return `<div id="pm-live-app" class="pm-live-shell" data-live-view="video-compose">
        ${topbar({ left: backButton(`data-video-action="${editing ? 'cancel-edit' : 'home'}"`), title: editing ? '编辑视频' : '投稿', right: '<span class="pm-live-topbar-gap" aria-hidden="true"></span>' })}
        ${statusStrip(status)}
        <div class="pm-live-scroll"><div class="pm-live-form">
            <label class="pm-live-field"><span>标题</span><input id="pm-video-title" class="pm-live-input" maxlength="60" placeholder="${byUser || editing ? '给视频起个标题' : '留空让 AI 起标题'}" value="${escapeAttr(form.title || '')}"></label>
            <div class="pm-live-field" role="group" aria-label="分区"><span>分区</span><div class="pm-live-chips">${categoryChips}</div><input id="pm-video-category-custom" class="pm-live-input" maxlength="12" placeholder="自定义分区" aria-label="自定义分区" value="${escapeAttr(customCategory)}"></div>
            ${editing ? '' : `<div class="pm-live-field" role="group" aria-label="UP主"><span>UP主</span><div class="pm-live-chips">${hostChips}</div>${otherField}</div>`}
            <label class="pm-live-field"><span>${byUser || editing ? '简介' : '想让 TA 发一条什么视频'}</span><textarea id="pm-video-idea" class="pm-live-input pm-live-textarea" maxlength="500" placeholder="${byUser || editing ? '这条视频讲了什么，可以留空' : '一两句想法就够，可以留空'}">${escapeHtml(form.idea || '')}</textarea></label>
            ${!editing && byUser ? sw('pm-video-ai-scenes', 'toggle-ai-scenes', '让 AI 写分镜', '关闭后只保留一段简单的画面说明', form.aiScenes !== false) : ''}
            ${sw('pm-video-nsfw', 'toggle-nsfw', '成人内容', '开启后可以写露骨的成人内容', form.nsfw === true)}
            ${editing ? '<button type="button" class="pm-live-danger" data-video-action="delete-video">删除视频</button>' : ''}
        </div></div>
        <div class="pm-video-submit-bar"><button type="button" class="pm-live-primary" data-video-action="submit">${editing ? '保存' : '投稿'}</button></div>
    </div>`;
}
