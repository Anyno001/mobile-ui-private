import { APP_NAMES, appNameOf } from './app-names.js';
import { createCommunityTemplate } from './interactive-scene-model.js';
import { COMMUNITY_PLATFORMS, IGS_SYNC_PLATFORMS } from './interactive-scene-constants.js';
import { DESKTOP_ICON_SIZE, isValidDesktopIconRuntimeData } from './desktop-icon-storage.js';
import {
    BACK_ICON_SVG, CALENDAR_ICON_SVG, CHAT_ICON_SVG, CHECK_ICON_SVG, CLOSE_ICON_SVG, COMMUNITY_ICON_SVG,
    BOOK_ICON_SVG, CONTACTS_ICON_SVG, HOME_ICON_SVG, LIVE_APP_ICON_SVG, MORE_ICON_SVG, SHOP_APP_ICON_SVG,
    COMMUNITY_TEMPLATE_ICON_SVG, EYE_ICON_SVG, INJECTION_ICON_SVG, PHOTO_ICON_SVG, POKE_ICON_SVG, SEND_ICON_SVG, SETTINGS_ICON_SVG, SPARKLES_ICON_SVG, TRASH_ICON_SVG, TREND_ICON_SVG,
} from './icons.js';
import { escapeAttr, escapeHtml } from './ui.js';
import { renderConfessFeed } from './community-views/view-confess.js';
import { renderComposeDock, renderComposeFloat, renderComposeSheet } from './community-views/view-compose.js';
import { renderDoubanFeed } from './community-views/view-douban.js';
import { renderHupuFeed } from './community-views/view-hupu.js';
import { renderTiebaFeed } from './community-views/view-tieba.js';
import { renderNightFeed } from './community-views/view-night.js';
import { renderReviewFeed } from './community-views/view-review.js';
import { COMMUNITY_PLATFORM_ACCENTS, formatCommunityPostTime, platformOf } from './community-views/view-shared.js';
import { renderWeiboFeed } from './community-views/view-weibo.js';
import { detailBackAction, detailStateOf, renderPostDetailBar } from './community-views/view-detail.js';
import { renderMomentsFeed } from './community-views/view-moments.js';
import { renderNewsFeed } from './community-views/view-news.js';
import { renderXhsFeed } from './community-views/view-xhs.js';
import { renderZhihuFeed } from './community-views/view-zhihu.js';

export { formatCommunityPostTime };

const DEFAULT_DESKTOP_TITLE = '天音小笺';
export function resolveDesktopAppIcon(appId, fallbackSvg) {
    const dataUrl = globalThis.window?.__pmDesktopIcons?.[appId];
    if (!isValidDesktopIconRuntimeData(dataUrl)) return fallbackSvg;
    const fallbackOnError = `this.previousElementSibling.hidden=false;this.remove()`;
    const hideFallbackOnLoad = `if(this.naturalWidth!==${DESKTOP_ICON_SIZE}||this.naturalHeight!==${DESKTOP_ICON_SIZE}){${fallbackOnError}}else this.previousElementSibling.hidden=true`;
    return `<span class="pm-desktop-icon-stack">${fallbackSvg}<img src="${escapeAttr(dataUrl)}" alt="" aria-hidden="true" onload="${hideFallbackOnLoad}" onerror="${fallbackOnError}"></span>`;
}

// 社区点缀色：用户自选色优先，否则用平台默认色。桌面快捷方式沿用这个取值。
function sceneAccent(scene) {
    return scene?.themeAccent || COMMUNITY_PLATFORM_ACCENTS[platformOf(scene)];
}

// 只有用户自选了主题色才内联写入点缀色变量；否则由 data-community-platform 选中平台默认色。
const accentStyleOf = scene => (scene?.themeAccent ? ` style="--pm-community-accent:${escapeAttr(scene.themeAccent)}"` : '');

// 界面显示名取自 app-names.js 的谐音名；给 AI 的提示词里仍写真名（prompts/interactive/*）。
const platformLabel = platform => appNameOf(platform);

// 桌面小组件最多列出的固定社区数，超出的折成「还有 N 个」。
const DESKTOP_PIN_LIMIT = 3;

// 社区最近一条内容的时间：帖子和评论里最大的有效时间戳，没有则为 0。
function latestSceneActivity(scene) {
    let latest = 0;
    for (const post of Array.isArray(scene?.posts) ? scene.posts : []) {
        if (Number.isFinite(post?.createdAt) && post.createdAt > latest) latest = post.createdAt;
        for (const comment of Array.isArray(post?.comments) ? post.comments : []) {
            if (Number.isFinite(comment?.createdAt) && comment.createdAt > latest) latest = comment.createdAt;
        }
    }
    return latest;
}

function sceneStatusText(scene, now) {
    if (!Array.isArray(scene?.posts) || !scene.posts.length) return '还很安静';
    const time = formatCommunityPostTime(latestSceneActivity(scene), now);
    return time.datetime ? `${time.label}更新` : '已有内容';
}

function renderDesktopPinRow(scene, now) {
    return `<article class="pm-desktop-pin" data-community-platform="${platformOf(scene)}"${accentStyleOf(scene)}><button type="button" data-action="desktop-open-scene" data-scene-id="${escapeAttr(scene.id)}"><span class="pm-desktop-pin-dot" aria-hidden="true"></span><b>${escapeHtml(scene.title)}</b><span class="pm-desktop-pin-status">${escapeHtml(sceneStatusText(scene, now))}</span></button><button type="button" data-action="unpin-scene" data-scene-id="${escapeAttr(scene.id)}" aria-label="移除 ${escapeAttr(scene.title)} 快捷方式">移除</button></article>`;
}

function renderDesktopTemplateRow(template) {
    return `<article class="pm-desktop-pin pm-desktop-template" data-community-platform="${platformOf(template)}"${accentStyleOf(template)}><span class="pm-desktop-pin-main"><span class="pm-desktop-pin-dot" aria-hidden="true"></span><b>${escapeHtml(template.title)}</b></span><button type="button" data-action="desktop-import-community-template" data-template-id="${escapeAttr(template.id)}" aria-label="导入社区模板：${escapeAttr(template.title)}">导入</button><button type="button" data-action="dismiss-community-template" data-template-id="${escapeAttr(template.id)}" aria-label="从当前桌面移除 ${escapeAttr(template.title)} 模板">移除</button></article>`;
}

// 桌面小组件：固定社区（最多 3 行）与可导入的共享模板各成一组；两组都为空时整张卡不渲染。
function renderDesktopWidget(scope, uiScope, sharedCommunityTemplates, now) {
    const pinned = (uiScope.pinnedSceneIds || []).map(sceneId => scope.scenes?.[sceneId]).filter(Boolean);
    const templates = Array.isArray(sharedCommunityTemplates) ? sharedCommunityTemplates : [];
    if (!pinned.length && !templates.length) return '';
    const hiddenCount = pinned.length - DESKTOP_PIN_LIMIT;
    const pinGroup = pinned.length ? `<div class="pm-desktop-pin-group"><h3>固定社区</h3>${pinned.slice(0, DESKTOP_PIN_LIMIT).map(scene => renderDesktopPinRow(scene, now)).join('')}${hiddenCount > 0 ? `<button type="button" class="pm-desktop-pin-more" data-action="desktop-community">还有 ${hiddenCount} 个</button>` : ''}</div>` : '';
    const templateGroup = templates.length ? `<div class="pm-desktop-pin-group"><h3>可导入的模板</h3>${templates.map(renderDesktopTemplateRow).join('')}</div>` : '';
    return `<section class="pm-desktop-pins">${pinGroup}${templateGroup}</section>`;
}

export function renderPhoneDesktop(scope = { scenes: {} }, uiScope = { pinnedSceneIds: [] }, sharedCommunityTemplates = [], { now = Date.now() } = {}) {
    const title = String(globalThis.window?.__pmTheme?.customTitle || '').trim() || DEFAULT_DESKTOP_TITLE;
    return `<div class="pm-desktop-toolbar"><span>${escapeHtml(title)}</span><button type="button" data-action="desktop-exit" aria-label="退出手机" title="退出手机">${CLOSE_ICON_SVG}</button></div>
        <div class="pm-desktop-grid" aria-label="应用">
            <button type="button" class="pm-desktop-app" data-app="chat" data-action="desktop-chat" aria-label="会话" title="会话"><span class="pm-desktop-app-icon">${resolveDesktopAppIcon('chat', CHAT_ICON_SVG)}</span><span class="pm-desktop-app-label">会话</span></button>
            <button type="button" class="pm-desktop-app" data-app="directory" data-action="desktop-directory" aria-label="联系人" title="联系人"><span class="pm-desktop-app-icon">${resolveDesktopAppIcon('directory', CONTACTS_ICON_SVG)}</span><span class="pm-desktop-app-label">联系人</span></button>
            <button type="button" class="pm-desktop-app" data-app="calendar" data-action="desktop-calendar" aria-label="日历" title="日历"><span class="pm-desktop-app-icon">${resolveDesktopAppIcon('calendar', CALENDAR_ICON_SVG)}</span><span class="pm-desktop-app-label">日历</span></button>
            <button type="button" class="pm-desktop-app" data-app="today-trend" data-action="desktop-today-trend" aria-label="今日风向" title="今日风向"><span class="pm-desktop-app-icon">${resolveDesktopAppIcon('todayTrend', TREND_ICON_SVG)}</span><span class="pm-desktop-app-label">今日风向</span></button>
            <button type="button" class="pm-desktop-app" data-app="community" data-action="desktop-community" aria-label="社区" title="社区"><span class="pm-desktop-app-icon">${resolveDesktopAppIcon('community', COMMUNITY_ICON_SVG)}</span><span class="pm-desktop-app-label">社区</span></button>
            <button type="button" class="pm-desktop-app" data-app="live" data-action="desktop-live" aria-label="${escapeAttr(appNameOf('live'))}" title="${escapeAttr(appNameOf('live'))}"><span class="pm-desktop-app-icon">${resolveDesktopAppIcon('live', LIVE_APP_ICON_SVG)}</span><span class="pm-desktop-app-label">${escapeHtml(appNameOf('live'))}</span></button>
            <button type="button" class="pm-desktop-app" data-app="story-oracle" data-action="desktop-story-oracle" aria-label="剧情助手" title="剧情助手"><span class="pm-desktop-app-icon">${resolveDesktopAppIcon('storyOracle', SPARKLES_ICON_SVG)}</span><span class="pm-desktop-app-label">剧情助手</span></button>
            <button type="button" class="pm-desktop-app" data-app="settings" data-action="desktop-settings" aria-label="设置" title="设置"><span class="pm-desktop-app-icon">${resolveDesktopAppIcon('settings', SETTINGS_ICON_SVG)}</span><span class="pm-desktop-app-label">设置</span></button>
            <button type="button" class="pm-desktop-app" data-app="gallery" data-action="desktop-gallery" aria-label="相册" title="相册"><span class="pm-desktop-app-icon">${resolveDesktopAppIcon('gallery', PHOTO_ICON_SVG)}</span><span class="pm-desktop-app-label">相册</span></button>
            <button type="button" class="pm-desktop-app" data-app="shop" data-action="desktop-shop" aria-label="${escapeAttr(appNameOf('shop'))}" title="${escapeAttr(appNameOf('shop'))}"><span class="pm-desktop-app-icon">${resolveDesktopAppIcon('shop', SHOP_APP_ICON_SVG)}</span><span class="pm-desktop-app-label">${escapeHtml(appNameOf('shop'))}</span></button>
        </div>
        ${renderDesktopWidget(scope, uiScope, sharedCommunityTemplates, now)}`;
}

function renderPlatformCards(selected) {
    // 每张卡：左上平台图标圆（取显示名首字，底色与字色随该平台点缀色），选中时右上出现勾。
    return COMMUNITY_PLATFORMS.map(platform => `<button type="button" class="pm-scene-platform ${platform === selected ? 'is-active' : ''}" data-action="pick-platform" data-platform="${platform}" data-community-platform="${platform}" aria-pressed="${platform === selected}"><span class="pm-scene-platform-icon" aria-hidden="true">${escapeHtml([...platformLabel(platform)][0] || '')}</span><span class="pm-scene-platform-check" aria-hidden="true">${CHECK_ICON_SVG}</span><b>${escapeHtml(platformLabel(platform))}</b><span class="pm-scene-platform-slogan">${escapeHtml(APP_NAMES[platform].slogan)}</span></button>`).join('');
}

// 成人内容胶囊开关：新建页与风格页共用，状态由 aria-checked 与 is-on 一起表达。
function renderNsfwSwitch(enabled) {
    return `<div class="pm-scene-switch-row"><span class="pm-scene-switch-text"><b>成人内容</b><small>开启后可以写露骨的成人内容</small></span><button type="button" id="pm-scene-nsfw" class="pm-scene-switch ${enabled ? 'is-on' : ''}" role="switch" aria-checked="${enabled}" aria-label="成人内容" data-action="toggle-nsfw"></button></div>`;
}

// 「发布后自动回应」开关：只在风格页出现，缺省视为开。状态同样由 aria-checked 与 is-on 一起表达。
function renderAutoRespondSwitch(enabled) {
    return `<div class="pm-scene-switch-row"><span class="pm-scene-switch-text"><b>发布后自动回应</b><small>发帖或评论后，立刻生成别人的回应</small></span><button type="button" id="pm-scene-auto-respond" class="pm-scene-switch ${enabled ? 'is-on' : ''}" role="switch" aria-checked="${enabled}" aria-label="发布后自动回应" data-action="toggle-auto-respond"></button></div>`;
}

function renderSceneAccentOptions(selectedAccent) {
    const selected = String(selectedAccent || '').toLowerCase();
    return COMMUNITY_PLATFORMS.map(platform => `<button type="button" class="pm-scene-accent-option" data-action="scene-accent" data-accent="${COMMUNITY_PLATFORM_ACCENTS[platform]}" data-community-platform="${platform}" aria-label="使用${escapeAttr(platformLabel(platform))}主题色" aria-pressed="${COMMUNITY_PLATFORM_ACCENTS[platform] === selected}"><span></span></button>`).join('');
}

export function renderCommunityLauncher(scope, uiScope = { pinnedSceneIds: [] }) {
    const sceneCards = scope.sceneOrder.slice().reverse().map(sceneId => {
        const scene = scope.scenes[sceneId];
        const platform = platformOf(scene);
        const pinned = uiScope.pinnedSceneIds.includes(scene.id);
        const pinLabel = pinned ? '取消固定社区' : '固定社区';
        const templateId = createCommunityTemplate(scene, uiScope.storageId || '__invalid__', 1).id;
        const shared = (uiScope.sharedCommunityTemplates || []).some(item => item.id === templateId);
        const templateActions = shared
            ? `<button type="button" class="pm-scene-template-action pm-scene-template-unpublish" data-action="unpublish-community-template" data-scene-id="${escapeAttr(scene.id)}" aria-label="取消发布共享模板" title="取消发布共享模板">${COMMUNITY_TEMPLATE_ICON_SVG}</button>`
            : `<button type="button" class="pm-scene-template-action" data-action="publish-community-template" data-scene-id="${escapeAttr(scene.id)}" aria-label="发布共享模板" title="发布共享模板">${COMMUNITY_TEMPLATE_ICON_SVG}</button>`;
        const accentStyle = scene.themeAccent ? ` style="--pm-community-accent:${escapeAttr(scene.themeAccent)}"` : '';
        const synced = uiScope.igsEnabled === true && scene.igsSync === true ? ' · 同步正文' : '';
        return `<article class="pm-scene-card" data-community-platform="${platform}"${accentStyle}><button type="button" class="pm-scene-card-open" data-action="open-scene" data-scene-id="${escapeAttr(scene.id)}"><b>${escapeHtml(scene.title)}</b><span>${escapeHtml(platformLabel(platform))} · ${scene.posts.length} 篇帖子${synced}</span></button><div class="pm-scene-card-actions">${templateActions}<button type="button" class="pm-scene-pin-action" data-action="toggle-scene-pin" data-scene-id="${escapeAttr(scene.id)}" aria-pressed="${pinned}" aria-label="${pinLabel}" title="${pinLabel}">${COMMUNITY_ICON_SVG}</button><button type="button" class="pm-scene-danger" data-action="delete-scene" data-scene-id="${escapeAttr(scene.id)}" aria-label="删除社区" title="删除社区">${TRASH_ICON_SVG}</button></div></article>`;
    }).join('');
    return `<div id="pm-scene-app" class="pm-modal pm-scene-shell" data-community-platform="weibo">
        <div class="pm-scene-topbar"><div class="pm-scene-nav-actions"><button type="button" class="pm-scene-home" data-action="desktop" aria-label="返回桌面" title="返回桌面">${HOME_ICON_SVG}</button></div><div class="pm-scene-title"><b>社区</b></div><div class="pm-scene-view-actions"><button type="button" data-action="exit" aria-label="退出手机" title="退出手机">${CLOSE_ICON_SVG}</button></div></div>
        <div class="pm-scene-launcher">
            <section class="pm-scene-hero"><h2>今天想逛什么社区？</h2><p>选一种社区，也可以补充自己的风格。</p></section>
            <div class="pm-scene-platforms" role="group" aria-label="社区类型">${renderPlatformCards('weibo')}</div>
            <div class="pm-scene-form-card">
                <label class="pm-scene-label">风格补充<textarea id="pm-scene-style" maxlength="2000" placeholder="例如：雨夜都市、克制疏离、像老论坛一样有楼层感……"></textarea></label>
                ${renderNsfwSwitch(false)}
            </div>
            <button type="button" class="pm-scene-primary" data-action="create-scene">生成社区</button>
            ${uiScope.igsEnabled === true ? '<button type="button" class="pm-scene-secondary pm-scene-import" data-action="igs-import">从正文导入社区帖子</button>' : ''}
            ${sceneCards ? `<div class="pm-scene-history"><h3>我的社区</h3>${sceneCards}</div>` : ''}
            <div class="pm-scene-status" aria-live="polite" hidden></div>
        </div>
    </div>`;
}

function renderContextInjectionSettings(scene, state) {
    // 「全部注入」不含从 gal 正文导入的帖子（它们本来就在正文里），需要时单独勾选。
    const selectedPostIds = new Set(state.communitySelection?.mode === 'all'
        ? scene.posts.filter(post => post.source?.type !== 'igs').map(post => post.id) : state.communitySelection?.postIds || []);
    const posts = scene.posts.map(post => `<article class="pm-scene-injection-post">
        <span>${post.source?.type === 'igs' ? '<small class="pm-scene-injection-source">来自正文</small>' : ''}${escapeHtml(post.content || '无正文帖子')}</span>
        <button type="button" class="pm-scene-injection-post-toggle ${selectedPostIds.has(post.id) ? 'is-selected' : ''}" data-action="context-toggle-post" data-post-id="${escapeAttr(post.id)}" aria-pressed="${selectedPostIds.has(post.id)}" aria-label="${selectedPostIds.has(post.id) ? '取消注入' : '注入'}此博文" title="${selectedPostIds.has(post.id) ? '取消注入' : '注入此博文'}">${EYE_ICON_SVG}</button>
    </article>`).join('') || '<div class="pm-scene-empty"><span>当前社区还没有帖子。</span></div>';
    return `<div class="pm-scene-injection-settings">
        <div class="pm-scene-injection-heading"><h2>正文注入</h2></div>
        <div class="pm-scene-injection-toolbar pm-scene-injection-toolbar-single"><button type="button" data-action="community-worldbook-columns">数据库记忆</button></div>
        <div class="pm-scene-injection-toolbar"><button type="button" data-action="context-select-all">全选</button><button type="button" data-action="context-clear">清空</button></div>
        <div class="pm-scene-injection-posts">${posts}</div>
        <div class="pm-scene-injection-actions"><button type="button" class="pm-scene-secondary" data-action="context-cancel">取消</button><button type="button" class="pm-scene-primary" data-action="context-save">保存注入设置</button></div>
    </div>`;
}

function renderSceneMenu(scene, uiScope, autoActive) {
    const pinned = uiScope.pinnedSceneIds.includes(scene.id);
    return `<div class="pm-scene-menu-wrap" data-auto-active="${autoActive}">
        <button type="button" class="pm-scene-more" data-action="more" aria-label="社区工具" title="社区工具" aria-haspopup="menu" aria-expanded="false">${MORE_ICON_SVG}</button>
        <div class="pm-control-menu pm-scene-menu" role="menu" aria-label="社区工具" hidden>
            <button type="button" role="menuitem" data-action="tab" data-tab="prompt">${BOOK_ICON_SVG}<span>风格提示词</span></button>
            <button type="button" role="menuitem" data-action="context-inject">${INJECTION_ICON_SVG}<span>上下文注入</span></button>
            <button type="button" role="menuitem" data-action="toggle-scene-pin" data-scene-id="${escapeAttr(scene.id)}" aria-pressed="${pinned}">${COMMUNITY_ICON_SVG}<span>${pinned ? '取消固定' : '固定社区'}</span></button>
            <button type="button" role="menuitem" class="pm-scene-danger" data-action="delete-scene" data-scene-id="${escapeAttr(scene.id)}">${TRASH_ICON_SVG}<span>删除社区</span></button>
            <button type="button" role="menuitem" data-action="exit">${CLOSE_ICON_SVG}<span>退出手机</span></button>
        </div>
    </div>`;
}

// 「接收 gal 正文的帖子」开关：只在设置里开了与 gal 前端联动、且该平台能接收时出现。同平台只有一个同步社区。
function renderIgsSyncSwitch(scene, igs) {
    if (igs?.enabled !== true || !IGS_SYNC_PLATFORMS.includes(platformOf(scene))) return '';
    const enabled = scene.igsSync === true;
    return `<div class="pm-scene-switch-row"><span class="pm-scene-switch-text"><b>接收正文的${escapeHtml(platformLabel(platformOf(scene)))}帖子</b><small>gal 正文里出现的同平台帖子放进这个社区</small></span><button type="button" id="pm-scene-igs-sync" class="pm-scene-switch ${enabled ? 'is-on' : ''}" role="switch" aria-checked="${enabled}" aria-label="接收正文帖子" data-action="toggle-igs-sync"></button></div>`;
}

// 风格页：社区名称、主题色（只换点缀色）、成人内容开关、风格提示词。
function renderPromptPage(scene, accent, igs) {
    return `<div class="pm-scene-prompt"><label>社区名称<input id="pm-scene-title" maxlength="80" value="${escapeAttr(scene.title)}"></label><fieldset class="pm-scene-accent-field"><legend>社区主题色</legend><div class="pm-scene-accent-options">${renderSceneAccentOptions(accent)}<label class="pm-scene-accent-custom" aria-label="自定义社区主题色"><input id="pm-scene-accent" type="color" data-action="scene-accent-custom" value="${escapeAttr(accent)}"><span>自定义</span></label></div></fieldset>${renderNsfwSwitch(scene.nsfw === true)}${renderAutoRespondSwitch(scene.autoRespond !== false)}${renderIgsSyncSwitch(scene, igs)}<label>社区风格<textarea id="pm-scene-prompt" maxlength="6000">${escapeHtml(scene.generatedPrompt)}</textarea></label><p>设置社区内容的表达风格与氛围。</p><div class="pm-scene-prompt-actions"><button type="button" class="pm-scene-secondary" data-action="regenerate-prompt">重新生成</button><button type="button" class="pm-scene-primary" data-action="save-prompt">保存风格</button></div></div>`;
}

// 楼层式平台（小组、贴吧、虎扑）的帖子详情页底部保留输入条，回复楼主；其余平台各自用自己的发布入口（见 view-compose.js）。
function renderThreadReplyBar() {
    return `<div class="pm-scene-bottom-bar"><div class="pm-scene-compose"><div class="pm-scene-composer"><textarea id="pm-scene-post-input" maxlength="4082" placeholder="回复楼主"></textarea><button type="button" class="pm-scene-primary" data-action="reply-owner" aria-label="回复楼主" title="回复楼主">${SEND_ICON_SVG}</button></div></div></div>`;
}

const FEED_RENDERERS = Object.freeze({
    weibo: renderWeiboFeed, douban: renderDoubanFeed, review: renderReviewFeed, confess: renderConfessFeed, night: renderNightFeed,
    tieba: renderTiebaFeed, hupu: renderHupuFeed,
    moments: renderMomentsFeed, xhs: renderXhsFeed, zhihu: renderZhihuFeed, news: renderNewsFeed,
});

// state.view 是会话内的临时视图状态：{ segment, postId, work, mood, open[], compose, draft }，不写入存储。
// 发布方式按平台区分：weibo 右下悬浮「＋」、douban 顶栏「发帖」胶囊、review 书评页与单本页「写书评」胶囊、
// confess 底部居中大胶囊、night 底部整宽「投一封信」；点开后都进入同一个整页编辑页（view-compose.js）。
// 顶栏统一为：左 主页/返回，中 标题，右 拍一拍 + ⋯。社区工具与「退出手机」都收进 ⋯；小组的「发帖」胶囊在小组头右侧。
export function renderCommunityWorkspace(scene, tab = 'feed', uiScope = { pinnedSceneIds: [] }, state = {}) {
    const autoActive = state.autoActive === true;
    const renderedAt = typeof state.now === 'number' && Number.isFinite(state.now) ? state.now : Date.now();
    const platform = platformOf(scene);
    const view = state.view && typeof state.view === 'object' ? state.view : {};
    const accent = sceneAccent(scene);
    const isPrompt = tab === 'prompt';
    const isSubpage = isPrompt || tab === 'context-inject';
    // 详情：楼层帖（thread）、小红书笔记与新闻正文（post）、知乎问题页（question），见 community-views/view-detail.js。
    const detail = isSubpage ? { thread: false, post: null, question: false, detail: false } : detailStateOf(scene, platform, view);
    const inThread = detail.thread;
    const inBook = !isSubpage && platform === 'review' && !!view.work;
    const accentStyle = scene.themeAccent ? ` style="--pm-community-accent:${escapeAttr(scene.themeAccent)}"` : '';
    const shellOpen = `<div id="pm-scene-app" class="pm-modal pm-scene-shell" data-community-platform="${platform}" data-scene-id="${escapeAttr(scene.id)}"${accentStyle}>`;
    // 今日猴条没有发布入口，compose 状态即使被置位也不出编辑页。
    if (!isSubpage && !inThread && !detail.post && platform !== 'news' && view.compose === true) {
        return `${shellOpen}${renderComposeSheet(platform, { scene, view, authorName: String(state.authorName || '') })}</div>`;
    }
    const leadingAction = isSubpage
        ? 'data-action="tab" data-tab="feed" aria-label="返回子社区" title="返回子社区"'
        : detail.detail ? detailBackAction(detail)
            : inBook ? 'data-action="close-book" aria-label="返回书评" title="返回书评"'
                : 'data-action="desktop" aria-label="返回桌面" title="返回桌面"';
    const menu = isSubpage ? '' : renderSceneMenu(scene, uiScope, autoActive);
    const floats = ['weibo', 'confess'].includes(platform) || (platform === 'xhs' && !detail.post);
    const feed = isSubpage ? '' : `<div class="pm-scene-feed${floats ? ' has-float' : ''}"><div class="pm-scene-posts">${FEED_RENDERERS[platform](scene, view, renderedAt, { authorName: String(state.authorName || '') })}</div></div>`;
    const content = tab === 'context-inject' ? renderContextInjectionSettings(scene, state)
        : isPrompt ? renderPromptPage(scene, accent, state.igs)
            : `<div class="pm-scene-stage">${feed}${detail.detail || inBook ? '' : renderComposeFloat(platform)}</div>${inThread ? renderThreadReplyBar() : detail.post ? renderPostDetailBar(platform, detail.post) : inBook ? '' : renderComposeDock(platform, view)}`;
    return `${shellOpen}
        <div class="pm-scene-topbar"><div class="pm-scene-nav-actions"><button type="button" class="pm-scene-home" ${leadingAction}>${isSubpage || detail.detail || inBook ? BACK_ICON_SVG : HOME_ICON_SVG}</button></div><div class="pm-scene-title"><b>${escapeHtml(scene.title)}</b></div><div class="pm-scene-view-actions"><button type="button" class="pm-header-icon-button pm-scene-title-poke" data-action="poke-scene" aria-label="拍一拍社区" title="拍一拍社区">${POKE_ICON_SVG}</button>${menu}</div></div><div class="pm-scene-status" aria-live="polite" hidden></div>
        ${content}
    </div>`;
}
