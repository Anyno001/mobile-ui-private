import { getInteractivePresets } from './interactive-scene-ai.js';
import {
    BACK_ICON_SVG, CHAT_ICON_SVG, CLOSE_ICON_SVG, COMMUNITY_ICON_SVG,
    CONTACTS_ICON_SVG, HOME_ICON_SVG, MORE_ICON_SVG, SETTINGS_ICON_SVG,
} from './icons.js';
import { escapeAttr, escapeHtml } from './ui.js';

const DEFAULT_DESKTOP_TITLE = '天音小笺';
const DANMAKU_TONES = ['blue', 'pink', 'cyan', 'gold'];

function stableDanmakuTone(item) {
    const seed = String(item?.id || `${item?.authorNameSnapshot || ''}:${item?.content || ''}`);
    let hash = 0;
    for (const character of seed) hash = ((hash * 31) + character.codePointAt(0)) >>> 0;
    return DANMAKU_TONES[hash % DANMAKU_TONES.length];
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
            <button type="button" class="pm-desktop-app" data-action="desktop-chat" aria-label="聊天" title="聊天">${CHAT_ICON_SVG}</button>
            <button type="button" class="pm-desktop-app" data-action="desktop-directory" aria-label="联系人" title="联系人">${CONTACTS_ICON_SVG}</button>
            <button type="button" class="pm-desktop-app" data-action="desktop-settings" aria-label="设置" title="设置">${SETTINGS_ICON_SVG}</button>
            <button type="button" class="pm-desktop-app" data-action="desktop-community" aria-label="社区" title="社区">${COMMUNITY_ICON_SVG}</button>
        </div>
        <section class="pm-desktop-pins"><h3>固定社区</h3>${pins || '<p>在社区中固定场景后，会显示在这里。</p>'}</section>`;
}

function renderPresetOptions(selected) {
    return Object.entries(getInteractivePresets()).map(([key, preset]) => `
        <button type="button" class="pm-scene-preset ${key === selected ? 'is-active' : ''}" data-action="preset" data-preset="${escapeAttr(key)}" style="--scene-accent:${preset.accent}">
            <span></span><b>${escapeHtml(preset.label)}</b>
        </button>`).join('');
}

export function renderCommunityLauncher(scope, uiScope = { pinnedSceneIds: [] }) {
    const sceneCards = scope.sceneOrder.slice().reverse().map(sceneId => {
        const scene = scope.scenes[sceneId];
        const pinned = uiScope.pinnedSceneIds.includes(scene.id);
        return `<article class="pm-scene-card"><button type="button" class="pm-scene-card-open" data-action="open-scene" data-scene-id="${escapeAttr(scene.id)}"><b>${escapeHtml(scene.title)}</b><span>${escapeHtml(getInteractivePresets()[scene.preset]?.label || '自定义')} · ${scene.posts.length} 篇帖子</span></button><div class="pm-scene-card-actions"><button type="button" class="pm-scene-pin-action" data-action="toggle-scene-pin" data-scene-id="${escapeAttr(scene.id)}" aria-pressed="${pinned}">${pinned ? '取消固定' : '固定'}</button><button type="button" class="pm-scene-danger" data-action="delete-scene" data-scene-id="${escapeAttr(scene.id)}">删除</button></div></article>`;
    }).join('');
    return `<div id="pm-scene-app" class="pm-modal pm-scene-shell">
        <div class="pm-scene-header"><button type="button" data-action="desktop" aria-label="返回桌面" title="返回桌面">${HOME_ICON_SVG}</button><b>社区</b><button type="button" data-action="exit" aria-label="退出手机" title="退出手机">${CLOSE_ICON_SVG}</button></div>
        <div class="pm-scene-launcher">
            <section class="pm-scene-hero"><h2>今天想逛什么社区？</h2><p>选择预设，或写下自己的风格。</p></section>
            <div class="pm-scene-presets">${renderPresetOptions('weibo')}</div>
            <label class="pm-scene-label">自定义风格<textarea id="pm-scene-style" maxlength="2000" placeholder="例如：雨夜都市、克制疏离、像老论坛一样有楼层感……"></textarea></label>
            <button type="button" class="pm-scene-primary" data-action="create-scene">生成社区</button>
            ${sceneCards ? `<div class="pm-scene-history"><h3>我的社区</h3>${sceneCards}</div>` : ''}
            <div class="pm-scene-status" aria-live="polite"></div>
        </div>
    </div>`;
}

function renderPosts(scene) {
    if (!scene.posts.length) return '<div class="pm-scene-empty"><b>这里还很安静</b><span>发第一篇帖子，或者从更多菜单生成内容。</span></div>';
    return scene.posts.slice().reverse().map(post => `<article class="pm-scene-post">
        <header><div class="pm-scene-avatar">${escapeHtml(post.authorNameSnapshot.slice(0, 1))}</div><div><b>${escapeHtml(post.authorNameSnapshot)}</b><span>刚刚 · ${escapeHtml(scene.title)}</span></div></header>
        <p>${escapeHtml(post.content).replace(/\n/g, '<br>')}</p>
        ${post.tags.length ? `<div class="pm-scene-tags">${post.tags.map(tag => `<span>#${escapeHtml(tag)}</span>`).join('')}</div>` : ''}
        <footer><button type="button" data-action="like" data-post-id="${escapeAttr(post.id)}">${post.liked ? '已喜欢' : '喜欢'}</button><button type="button" data-action="comments" data-post-id="${escapeAttr(post.id)}">生成更多评论 ${post.comments.length}</button><button type="button" data-action="edit-post" data-post-id="${escapeAttr(post.id)}">编辑</button><button type="button" class="pm-scene-danger" data-action="delete-post" data-post-id="${escapeAttr(post.id)}">删除</button></footer>
        ${post.comments.length ? `<div class="pm-scene-comments">${post.comments.map(comment => `<div class="pm-scene-comment"><span><b>${escapeHtml(comment.authorNameSnapshot)}</b> ${escapeHtml(comment.content)}</span><span class="pm-scene-comment-actions"><button type="button" data-action="edit-comment" data-post-id="${escapeAttr(post.id)}" data-comment-id="${escapeAttr(comment.id)}">编辑</button><button type="button" class="pm-scene-danger" data-action="delete-comment" data-post-id="${escapeAttr(post.id)}" data-comment-id="${escapeAttr(comment.id)}">删除</button></span></div>`).join('')}</div>` : ''}
        <div class="pm-scene-comment-composer"><input id="pm-comment-input-${escapeAttr(post.id)}" maxlength="1000" placeholder="写下你的评论……"><button type="button" data-action="post-comment" data-post-id="${escapeAttr(post.id)}">发表</button></div>
    </article>`).join('');
}

export function getDanmakuTone(item) {
    return stableDanmakuTone(item);
}

function renderDanmaku(scene) {
    return scene.live.danmaku.slice(-80).map(item => `<div class="pm-danmaku-row is-${stableDanmakuTone(item)}"><b>${escapeHtml(item.authorNameSnapshot)}</b><span>${escapeHtml(item.content)}</span></div>`).join('') || '<div class="pm-scene-empty"><span>开始直播后，弹幕会从这里滚动显示。</span></div>';
}

function renderSceneMenu(scene, uiScope, autoActive) {
    const pinned = uiScope.pinnedSceneIds.includes(scene.id);
    return `<div class="pm-scene-menu-wrap">
        <button type="button" class="pm-scene-more" data-action="more" aria-label="更多社区操作" title="更多" aria-haspopup="menu" aria-expanded="false">${MORE_ICON_SVG}</button>
        <div class="pm-scene-menu" role="menu" hidden>
            <button type="button" role="menuitem" data-action="toggle-scene-pin" data-scene-id="${escapeAttr(scene.id)}" aria-pressed="${pinned}">${pinned ? '取消固定' : '固定社区'}</button>
            <button type="button" role="menuitem" data-action="toggle-community-mode">${autoActive ? '关闭自动热场' : '开启自动热场'}</button>
            <button type="button" role="menuitem" data-action="ai-feed">生成热场内容</button>
            <button type="button" role="menuitem" data-action="edit-scene">编辑社区风格</button>
            <button type="button" role="menuitem" data-action="desktop">返回桌面</button>
            <button type="button" role="menuitem" class="pm-scene-danger" data-action="delete-scene" data-scene-id="${escapeAttr(scene.id)}">删除社区</button>
            <button type="button" role="menuitem" data-action="exit">退出手机</button>
        </div>
    </div>`;
}

export function renderCommunityWorkspace(scene, tab = 'feed', uiScope = { pinnedSceneIds: [] }, state = {}) {
    const preset = getInteractivePresets()[scene.preset] || getInteractivePresets().custom;
    const liveActive = state.liveActive === true;
    const autoActive = state.autoActive === true;
    const floatingDanmaku = scene.live.danmaku.slice(-8).map((item, index) => `<span class="is-${stableDanmakuTone(item)}" style="--lane:${index % 4};--delay:${(index % 5) * -.7}s">${escapeHtml(item.content)}</span>`).join('');
    const content = tab === 'feed' ? `<div class="pm-scene-feed"><div class="pm-scene-posts">${renderPosts(scene)}</div></div>
        <div class="pm-scene-composer"><textarea id="pm-scene-post-input" maxlength="4000" placeholder="发一条微博、帖子或书评……"></textarea><button type="button" class="pm-scene-primary" data-action="publish">发布</button></div>`
        : tab === 'live' ? `<div class="pm-live-room"><div class="pm-live-stage"><div class="pm-live-badge">${liveActive ? '直播中' : '预览'}</div><h2>${escapeHtml(scene.live.title)}</h2><div class="pm-danmaku-float">${floatingDanmaku}</div></div><div class="pm-live-actions"><button type="button" data-action="toggle-live" class="${liveActive ? 'is-live' : ''}">${liveActive ? '停止直播' : '开始直播'}</button><button type="button" data-action="rhythm">带一波节奏</button></div><div class="pm-danmaku-list">${renderDanmaku(scene)}</div><div class="pm-danmaku-input"><input id="pm-danmaku-input" maxlength="200" placeholder="发条弹幕……"><button type="button" data-action="send-danmaku">发送</button></div></div>`
        : `<div class="pm-scene-prompt"><label>社区名称<input id="pm-scene-title" maxlength="80" value="${escapeAttr(scene.title)}"></label><label>社区风格<textarea id="pm-scene-prompt" maxlength="6000">${escapeHtml(scene.generatedPrompt)}</textarea></label><p>可直接修改，后续社区内容遵循此语感。</p><div><button type="button" data-action="regenerate-prompt">重新生成</button><button type="button" class="pm-scene-primary" data-action="save-prompt">保存风格</button></div></div>`;
    return `<div id="pm-scene-app" class="pm-modal pm-scene-shell" style="--scene-accent:${preset.accent}">
        <div class="pm-scene-topbar"><button type="button" class="pm-scene-back" data-action="back" aria-label="返回社区首页" title="返回社区首页">${BACK_ICON_SVG}</button><div class="pm-scene-title"><b>${escapeHtml(scene.title)}</b></div>${renderSceneMenu(scene, uiScope, autoActive)}</div>
        <div class="pm-scene-tabs"><button type="button" data-action="tab" data-tab="feed" class="${tab === 'feed' ? 'is-active' : ''}">社区</button><button type="button" data-action="tab" data-tab="live" class="${tab === 'live' ? 'is-active' : ''}">直播</button><button type="button" data-action="tab" data-tab="prompt" class="${tab === 'prompt' ? 'is-active' : ''}">风格</button></div>
        ${content}<div class="pm-scene-status" aria-live="polite"></div>
    </div>`;
}