import { getInteractivePresets } from './interactive-scene-ai.js';
import {
    BACK_ICON_SVG, CALENDAR_ICON_SVG, CHAT_ICON_SVG, CLOSE_ICON_SVG, COMMUNITY_ICON_SVG,
    CONTACTS_ICON_SVG, CONTROL_ICON_SVG, EDIT_ICON_SVG, HEART_ICON_SVG, HOME_ICON_SVG,
    MORE_ICON_SVG, POKE_ICON_SVG, REPLY_ICON_SVG, SEND_ICON_SVG, SETTINGS_ICON_SVG, SHARE_ICON_SVG, TRASH_ICON_SVG,
} from './icons.js';
import { escapeAttr, escapeHtml } from './ui.js';

const DEFAULT_DESKTOP_TITLE = '天音小笺';
const DANMAKU_TONES = ['blue', 'pink', 'cyan', 'gold'];

function stableDanmakuHash(item) {
    const seed = String(item?.id || `${item?.authorNameSnapshot || ''}:${item?.content || ''}`);
    let hash = 0;
    for (const character of seed) hash = ((hash * 31) + character.codePointAt(0)) >>> 0;
    return hash;
}

function stableDanmakuTone(item) {
    return DANMAKU_TONES[stableDanmakuHash(item) % DANMAKU_TONES.length];
}

function stablePostMetric(post, salt, minimum, spread) {
    const seed = `${post?.id || ''}:${post?.authorNameSnapshot || ''}:${post?.content || ''}:${salt}`;
    let hash = 0;
    for (const character of seed) hash = ((hash * 33) + character.codePointAt(0)) >>> 0;
    return minimum + (hash % spread);
}

function renderPostMetric(iconSvg, value, label, className = '') {
    return `<span class="pm-scene-post-metric ${className}" aria-label="${escapeAttr(`${label} ${value}`)}">${iconSvg}<span>${value}</span></span>`;
}

export function getDanmakuMotion(item) {
    const hash = stableDanmakuHash(item);
    return {
        lane: hash % 6,
        delay: -((hash >>> 4) % 45) / 10,
        duration: 5 + ((hash >>> 9) % 51) / 10,
        offset: ((hash >>> 15) % 17) - 8,
    };
}

export function renderPhoneDesktop(scope = { scenes: {} }, uiScope = { pinnedSceneIds: [] }) {
    const title = String(globalThis.window?.__pmTheme?.customTitle || '').trim() || DEFAULT_DESKTOP_TITLE;
    const pins = (uiScope.pinnedSceneIds || []).flatMap(sceneId => {
        const scene = scope.scenes?.[sceneId];
        if (!scene) return [];
        return [`<article class="pm-desktop-pin"><button type="button" data-action="desktop-open-scene" data-scene-id="${escapeAttr(scene.id)}"><b>${escapeHtml(scene.title)}</b></button><button type="button" data-action="unpin-scene" data-scene-id="${escapeAttr(scene.id)}" aria-label="移除 ${escapeAttr(scene.title)} 快捷方式">移除</button></article>`];
    }).join('');
    return `<div class="pm-desktop-toolbar"><span>${escapeHtml(title)}</span><button type="button" data-action="desktop-exit" aria-label="退出手机" title="退出手机">${CLOSE_ICON_SVG}</button></div>
        <div class="pm-desktop-grid" aria-label="应用">
            <button type="button" class="pm-desktop-app" data-app="chat" data-action="desktop-chat" aria-label="聊天" title="聊天"><span class="pm-desktop-app-icon">${CHAT_ICON_SVG}</span><span class="pm-desktop-app-label">聊天</span></button>
            <button type="button" class="pm-desktop-app" data-app="directory" data-action="desktop-directory" aria-label="联系人" title="联系人"><span class="pm-desktop-app-icon">${CONTACTS_ICON_SVG}</span><span class="pm-desktop-app-label">联系人</span></button>
            <button type="button" class="pm-desktop-app" data-app="settings" data-action="desktop-settings" aria-label="设置" title="设置"><span class="pm-desktop-app-icon">${SETTINGS_ICON_SVG}</span><span class="pm-desktop-app-label">设置</span></button>
            <button type="button" class="pm-desktop-app" data-app="calendar" data-action="desktop-calendar" aria-label="日历" title="日历"><span class="pm-desktop-app-icon">${CALENDAR_ICON_SVG}</span><span class="pm-desktop-app-label">日历</span></button>
        </div>
        <section class="pm-desktop-pins"><h3>固定社区</h3>${pins || '<p>在社区中固定场景后，会显示在这里。</p>'}</section>
        <div class="pm-desktop-community-dock"><button type="button" data-action="desktop-community" aria-label="发布一条">${COMMUNITY_ICON_SVG}<span>发布一条</span></button></div>`;
}

function renderPresetOptions(selected) {
    return Object.entries(getInteractivePresets()).map(([key, preset]) => `
        <button type="button" class="pm-scene-preset ${key === selected ? 'is-active' : ''}" data-action="preset" data-preset="${escapeAttr(key)}" style="--scene-accent:${preset.accent}">
            <span></span><b>${escapeHtml(preset.label)}</b>
        </button>`).join('');
}

function renderSceneAccentOptions(selectedAccent) {
    const seen = new Set();
    return Object.values(getInteractivePresets()).filter(preset => {
        if (seen.has(preset.accent)) return false;
        seen.add(preset.accent);
        return true;
    }).map(preset => `<button type="button" class="pm-scene-accent-option" data-action="scene-accent" data-accent="${escapeAttr(preset.accent)}" style="--scene-accent-option:${escapeAttr(preset.accent)}" aria-label="使用${escapeAttr(preset.label)}主题色" aria-pressed="${preset.accent === selectedAccent}"><span></span></button>`).join('');
}

export function renderCommunityLauncher(scope, uiScope = { pinnedSceneIds: [] }) {
    const sceneCards = scope.sceneOrder.slice().reverse().map(sceneId => {
        const scene = scope.scenes[sceneId];
        const pinned = uiScope.pinnedSceneIds.includes(scene.id);
        const pinLabel = pinned ? '取消固定社区' : '固定社区';
        return `<article class="pm-scene-card"><button type="button" class="pm-scene-card-open" data-action="open-scene" data-scene-id="${escapeAttr(scene.id)}"><b>${escapeHtml(scene.title)}</b><span>${escapeHtml(getInteractivePresets()[scene.preset]?.label || '自定义')} · ${scene.posts.length} 篇帖子</span></button><div class="pm-scene-card-actions"><button type="button" class="pm-scene-pin-action" data-action="toggle-scene-pin" data-scene-id="${escapeAttr(scene.id)}" aria-pressed="${pinned}" aria-label="${pinLabel}" title="${pinLabel}">${EDIT_ICON_SVG}</button><button type="button" class="pm-scene-danger" data-action="delete-scene" data-scene-id="${escapeAttr(scene.id)}" aria-label="删除社区" title="删除社区">${TRASH_ICON_SVG}</button></div></article>`;
    }).join('');
    return `<div id="pm-scene-app" class="pm-modal pm-scene-shell">
        <div class="pm-scene-header"><button type="button" data-action="desktop" aria-label="返回桌面" title="返回桌面">${HOME_ICON_SVG}</button><b>社区</b><button type="button" data-action="exit" aria-label="退出手机" title="退出手机">${CLOSE_ICON_SVG}</button></div>
        <div class="pm-scene-launcher">
            <section class="pm-scene-hero"><h2>今天想逛什么社区？</h2><p>选择预设，或写下自己的风格。</p></section>
            <div class="pm-scene-presets">${renderPresetOptions('weibo')}</div>
            <label class="pm-scene-label">自定义风格<textarea id="pm-scene-style" maxlength="2000" placeholder="例如：雨夜都市、克制疏离、像老论坛一样有楼层感……"></textarea></label>
            <button type="button" class="pm-scene-primary" data-action="create-scene">生成社区</button>
            ${sceneCards ? `<div class="pm-scene-history"><h3>我的社区</h3>${sceneCards}</div>` : ''}
            <div class="pm-scene-status" aria-live="polite" hidden></div>
        </div>
    </div>`;
}

function renderPosts(scene) {
    if (!scene.posts.length) return '<div class="pm-scene-empty"><b>这里还很安静</b><span>发第一篇帖子，或者拍一拍让社区动起来。</span></div>';
    return scene.posts.slice().reverse().map(post => {
        const likes = stablePostMetric(post, 'likes', 8, 240) + (post.liked ? 1 : 0);
        const shares = stablePostMetric(post, 'shares', 1, 48) + post.shareCount;
        return `<article class="pm-scene-post">
        <header><div class="pm-scene-avatar">${escapeHtml(post.authorNameSnapshot.slice(0, 1))}</div><div class="pm-scene-post-author"><b>${escapeHtml(post.authorNameSnapshot)}</b><span class="pm-scene-post-time">刚刚</span></div><div class="pm-scene-post-actions-wrap"><button type="button" class="pm-scene-post-more" data-action="post-actions" aria-label="帖子操作" title="帖子操作" aria-expanded="false">${MORE_ICON_SVG}</button><span class="pm-scene-post-actions" hidden><button type="button" data-action="comments" data-post-id="${escapeAttr(post.id)}" aria-label="拍一拍本帖，只生成本帖评论" title="拍一拍本帖">${POKE_ICON_SVG}</button><button type="button" data-action="edit-post" data-post-id="${escapeAttr(post.id)}" aria-label="编辑帖子" title="编辑帖子">${EDIT_ICON_SVG}</button><button type="button" class="pm-scene-danger" data-action="delete-post" data-post-id="${escapeAttr(post.id)}" aria-label="删除帖子" title="删除帖子">${TRASH_ICON_SVG}</button></span></div></header>
        <p>${escapeHtml(post.content).replace(/\n/g, '<br>')}</p>
        ${post.tags.length ? `<div class="pm-scene-tags">${post.tags.map(tag => `<span>#${escapeHtml(tag)}</span>`).join('')}</div>` : ''}
        <footer><button type="button" class="pm-scene-like ${post.liked ? 'is-liked' : ''}" data-action="like" data-post-id="${escapeAttr(post.id)}" aria-pressed="${post.liked}" aria-label="${post.liked ? '取消喜欢' : '喜欢'}">${renderPostMetric(HEART_ICON_SVG, likes, '喜欢', 'is-like')}</button><button type="button" class="pm-scene-share ${post.shareCount > 0 ? 'is-shared' : ''}" data-action="share" data-post-id="${escapeAttr(post.id)}" aria-label="${post.shareCount > 0 ? '再次分享本帖' : '分享本帖'}">${renderPostMetric(SHARE_ICON_SVG, shares, '转发', 'is-share')}</button><button type="button" class="pm-scene-reply-toggle" data-action="toggle-reply" data-post-id="${escapeAttr(post.id)}" aria-label="回复本帖" aria-controls="pm-comment-composer-${escapeAttr(post.id)}" aria-expanded="false">${renderPostMetric(REPLY_ICON_SVG, post.comments.length, '回复', 'is-reply')}</button></footer>
        ${post.comments.length ? `<div class="pm-scene-comments">${post.comments.map(comment => `<div class="pm-scene-comment"><span><b>${escapeHtml(comment.authorNameSnapshot)}</b> ${escapeHtml(comment.content)}</span><span class="pm-scene-comment-actions" hidden><button type="button" data-action="edit-comment" data-post-id="${escapeAttr(post.id)}" data-comment-id="${escapeAttr(comment.id)}" aria-label="编辑评论" title="编辑评论">${EDIT_ICON_SVG}</button><button type="button" class="pm-scene-danger" data-action="delete-comment" data-post-id="${escapeAttr(post.id)}" data-comment-id="${escapeAttr(comment.id)}" aria-label="删除评论" title="删除评论">${TRASH_ICON_SVG}</button></span></div>`).join('')}</div>` : ''}
        <div id="pm-comment-composer-${escapeAttr(post.id)}" class="pm-scene-comment-composer" hidden><input id="pm-comment-input-${escapeAttr(post.id)}" maxlength="1000" placeholder="发表你的想法吧"><button type="button" data-action="post-comment" data-post-id="${escapeAttr(post.id)}" aria-label="发送回复" title="发送回复">${SEND_ICON_SVG}</button></div>
    </article>`;
    }).join('');
}

export function getDanmakuTone(item) {
    return stableDanmakuTone(item);
}

function renderDanmaku(scene) {
    return scene.live.danmaku.slice(-80).map(item => `<div class="pm-danmaku-row is-${stableDanmakuTone(item)}"><b>${escapeHtml(item.authorNameSnapshot)}</b><span>${escapeHtml(item.content)}</span></div>`).join('') || '<div class="pm-scene-empty"><span>开始直播后，弹幕会从这里滚动显示。</span></div>';
}

function renderContextInjectionSettings(scene, state) {
    const selection = state.communitySelection?.mode === 'selected'
        ? state.communitySelection : { mode: 'all', postIds: [] };
    const selectedPostIds = new Set(selection.postIds || []);
    const posts = scene.posts.map(post => `<label class="pm-scene-injection-post">
        <input type="checkbox" class="pm-scene-injection-post-input" value="${escapeAttr(post.id)}" ${selectedPostIds.has(post.id) ? 'checked' : ''}>
        <span>${escapeHtml(post.content || '无正文帖子')}</span>
    </label>`).join('') || '<div class="pm-scene-empty"><span>当前社区还没有帖子。</span></div>';
    return `<div class="pm-scene-injection-settings">
        <div class="pm-scene-injection-heading"><div><h2>上下文注入</h2><p>配置当前社区进入角色上下文的帖子。选中帖子会自动包含其评论。</p></div>
        <label class="pm-scene-injection-enable"><span>允许当前社区注入</span><input id="pm-scene-injection-enabled" type="checkbox" ${state.communitySceneAllowed ? 'checked' : ''}></label></div>
        <label class="pm-scene-label">帖子范围<select id="pm-scene-injection-mode">
            <option value="all" ${selection.mode === 'all' ? 'selected' : ''}>全部帖子</option>
            <option value="selected" ${selection.mode === 'selected' ? 'selected' : ''}>仅选中帖子</option>
        </select></label>
        <div class="pm-scene-injection-toolbar"><button type="button" data-action="context-select-all">全选</button><button type="button" data-action="context-clear">清空</button></div>
        <div class="pm-scene-injection-posts">${posts}</div>
        <div class="pm-scene-injection-actions"><button type="button" class="pm-scene-secondary" data-action="context-cancel">取消</button><button type="button" class="pm-scene-primary" data-action="context-save">保存注入设置</button></div>
    </div>`;
}

function renderSceneMenu(scene, uiScope, autoActive) {
    const pinned = uiScope.pinnedSceneIds.includes(scene.id);
    return `<div class="pm-scene-menu-wrap" data-auto-active="${autoActive}">
        <button type="button" class="pm-scene-more" data-action="more" aria-label="社区工具" title="社区工具" aria-haspopup="menu" aria-expanded="false">${CONTROL_ICON_SVG}</button>
        <div class="pm-control-menu pm-scene-menu" role="menu" aria-label="社区工具" hidden>
            <button type="button" role="menuitem" data-action="tab" data-tab="prompt">${EDIT_ICON_SVG}<span>风格提示词</span></button>
            <button type="button" role="menuitem" data-action="context-inject">${SETTINGS_ICON_SVG}<span>上下文注入</span></button>
            <button type="button" role="menuitem" data-action="toggle-scene-pin" data-scene-id="${escapeAttr(scene.id)}" aria-pressed="${pinned}">${COMMUNITY_ICON_SVG}<span>${pinned ? '取消固定' : '固定社区'}</span></button>
            <button type="button" role="menuitem" class="pm-scene-danger" data-action="delete-scene" data-scene-id="${escapeAttr(scene.id)}">${TRASH_ICON_SVG}<span>删除社区</span></button>
        </div>
    </div>`;
}

export function renderCommunityWorkspace(scene, tab = 'feed', uiScope = { pinnedSceneIds: [] }, state = {}) {
    const preset = getInteractivePresets()[scene.preset] || getInteractivePresets().custom;
    const liveActive = state.liveActive === true;
    const autoActive = state.autoActive === true;
    const accent = scene.themeAccent || preset.accent;
    const hasDanmaku = scene.live.danmaku.length > 0;
    const floatingDanmaku = scene.live.danmaku.slice(-8).map(item => {
        const motion = getDanmakuMotion(item);
        return `<span class="is-${stableDanmakuTone(item)}" style="--lane:${motion.lane};--delay:${motion.delay}s;--duration:${motion.duration}s;--offset:${motion.offset}px">${escapeHtml(item.content)}</span>`;
    }).join('');
    const composer = tab === 'feed' ? `<div class="pm-scene-composer"><textarea id="pm-scene-post-input" maxlength="4000" placeholder="分享此刻……"></textarea><button type="button" class="pm-scene-primary" data-action="publish" aria-label="发布" title="发布">${SEND_ICON_SVG}</button></div>` : '';
    const content = tab === 'feed' ? `<div class="pm-scene-feed"><div class="pm-scene-posts">${renderPosts(scene)}</div></div>`
        : tab === 'live' ? `<div class="pm-live-room"><div class="pm-live-stage ${hasDanmaku ? 'has-danmaku' : ''}"><div class="pm-live-badge">${hasDanmaku ? '直播中' : '未开播'}</div><h2>${escapeHtml(scene.live.title)}</h2><div class="pm-danmaku-float">${floatingDanmaku}</div></div><div class="pm-live-actions"><button type="button" data-action="toggle-live" class="${liveActive ? 'is-live' : ''}">${liveActive ? '停止直播' : '开始直播'}</button><button type="button" data-action="rhythm">带一波节奏</button></div><div class="pm-danmaku-list">${renderDanmaku(scene)}</div><div class="pm-danmaku-input"><input id="pm-danmaku-input" maxlength="200" placeholder="发条弹幕……"><button type="button" data-action="send-danmaku" aria-label="发送弹幕" title="发送弹幕">${SEND_ICON_SVG}</button></div></div>`
        : tab === 'context-inject' ? renderContextInjectionSettings(scene, state)
            : `<div class="pm-scene-prompt"><label>社区名称<input id="pm-scene-title" maxlength="80" value="${escapeAttr(scene.title)}"></label><fieldset class="pm-scene-accent-field"><legend>社区主题色</legend><div class="pm-scene-accent-options">${renderSceneAccentOptions(accent)}<label class="pm-scene-accent-custom" aria-label="自定义社区主题色"><input id="pm-scene-accent" type="color" data-action="scene-accent-custom" value="${escapeAttr(accent)}"><span>自定义</span></label></div></fieldset><label>社区风格<textarea id="pm-scene-prompt" maxlength="6000">${escapeHtml(scene.generatedPrompt)}</textarea></label><p>设置社区内容的表达风格与氛围。</p><div class="pm-scene-prompt-actions"><button type="button" class="pm-scene-secondary" data-action="regenerate-prompt">重新生成</button><button type="button" class="pm-scene-primary" data-action="save-prompt">保存风格</button></div></div>`;
    const isPrompt = tab === 'prompt';
    const returnTab = ['feed', 'live'].includes(uiScope.lastTab) ? uiScope.lastTab : 'feed';
    const leadingAction = isPrompt
        ? `data-action="tab" data-tab="${returnTab}" aria-label="返回子社区" title="返回子社区"`
        : 'data-action="desktop" aria-label="返回桌面" title="返回桌面"';
    return `<div id="pm-scene-app" class="pm-modal pm-scene-shell" style="--scene-accent:${escapeAttr(accent)}">
        <div class="pm-scene-topbar"><div class="pm-scene-nav-actions"><button type="button" class="pm-scene-home" ${leadingAction}>${isPrompt ? BACK_ICON_SVG : HOME_ICON_SVG}</button></div><nav class="pm-scene-title" aria-label="子社区视图"><button type="button" class="pm-scene-title-tab ${tab === 'feed' ? 'is-active' : ''}" data-action="tab" data-tab="feed" aria-current="${tab === 'feed' ? 'page' : 'false'}"><span>${escapeHtml(scene.title)}</span></button><button type="button" class="pm-scene-title-tab ${tab === 'live' ? 'is-active' : ''}" data-action="tab" data-tab="live" aria-current="${tab === 'live' ? 'page' : 'false'}"><span>直播</span></button></nav><div class="pm-scene-view-actions"><button type="button" class="pm-scene-title-poke" data-action="poke-scene" aria-label="拍一拍社区" title="拍一拍社区">${POKE_ICON_SVG}</button><button type="button" class="pm-scene-exit" data-action="exit" aria-label="退出手机" title="退出手机">${CLOSE_ICON_SVG}</button></div></div><div class="pm-scene-status" aria-live="polite" hidden></div>
        ${content}${isPrompt || tab === 'live' || tab === 'context-inject' ? '' : `<div class="pm-scene-bottom-bar">${renderSceneMenu(scene, uiScope, autoActive)}${composer}</div>`}
    </div>`;
}