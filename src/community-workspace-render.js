import { readComposeDraft } from './community-views/view-actions.js';

/**
 * 社区工作区（#pm-scene-app）的重绘：整页重绘、局部替换单条帖子/评论、编辑页草稿保留与滚动位置。
 * buildHtml(scopeId, scene, tab) 生成整页 HTML；current() 给出当前 { scopeId, scene }。
 */
export function createWorkspaceRenderer({ runtime, deps, current, viewOf, buildHtml, renderInto }) {
    const feedOf = () => document.querySelector('#pm-scene-app .pm-scene-feed');
    function replaceApp(html, { feedScrollTop = null } = {}) {
        const app = document.getElementById('pm-scene-app');
        if (app) { app.outerHTML = html; deps.hydrateImageCards?.(document.getElementById('pm-scene-app')); }
        else renderInto('.pm-community-page', html);
        if (Number.isFinite(feedScrollTop)) {
            const feed = feedOf(); if (feed) feed.scrollTop = feedScrollTop;
        }
    }
    // 编辑页开着时，重绘前把输入框里的内容存回 view.draft（只在内存里），避免后台重绘把正在写的字冲掉。
    function syncComposeDraft(sceneId) {
        const view = runtime.communityViews[sceneId];
        const sheet = document.querySelector('#pm-scene-app .pm-scene-sheet');
        if (view?.compose === true && sheet) view.draft = readComposeDraft(document.getElementById('pm-scene-app'));
    }
    // 编辑页重绘后把光标放回第一个输入处（data-compose-focus 标记）。
    function focusComposeField() {
        document.querySelector('#pm-scene-app .pm-scene-sheet [data-compose-focus]')?.focus?.({ preventScroll: true });
    }
    // 同一页面（同社区、同分段、同一详情、编辑页开关不变）重绘时默认保持滚动位置；换页才回到顶部。
    const workspaceKey = (sceneId, tab) => {
        const view = viewOf(sceneId);
        return [sceneId, tab, view.segment || '', view.postId || '', view.work || '', view.question || '', view.compose === true].join('|');
    };
    function rerender(tab = 'feed', { preserveFeedScroll = null, scrollToEnd = false, scrollTop = null } = {}) {
        const { scopeId, scene } = current();
        if (!scene) return;
        const key = workspaceKey(scene.id, tab);
        const keep = preserveFeedScroll ?? (key === runtime.workspaceKey);
        const feedScrollTop = Number.isFinite(scrollTop) ? scrollTop : keep ? feedOf()?.scrollTop : null;
        syncComposeDraft(scene.id);
        replaceApp(buildHtml(scopeId, scene, tab), { feedScrollTop });
        runtime.workspaceKey = key;
        if (scrollToEnd) { const feed = feedOf(); if (feed) feed.scrollTop = feed.scrollHeight; }
    }
    // 点赞、分享、展开、编辑只影响一条帖子或评论：只换掉带同一 data-entry-id 的节点，不重画整页。
    // 找不到对应节点、数量对不上或不在同一页面时退回整页重绘（仍保持滚动位置）。
    const entrySelector = id => `[data-entry-id="${String(id).replace(/["\\]/g, '\\$&')}"]`;
    function patchEntries(entryIds, tab = 'feed') {
        const { scopeId, scene } = current();
        const app = document.getElementById('pm-scene-app');
        const ids = entryIds.filter(Boolean);
        if (!scene || !app || !ids.length || typeof document.createElement !== 'function' || runtime.workspaceKey !== workspaceKey(scene.id, tab)) {
            rerender(tab);
            return;
        }
        const template = document.createElement('template');
        template.innerHTML = buildHtml(scopeId, scene, tab);
        const fresh = template.content?.firstElementChild;
        const pairs = [];
        for (const id of ids) {
            const before = app.querySelectorAll(entrySelector(id));
            const after = fresh?.querySelectorAll?.(entrySelector(id)) || [];
            if (!before.length || before.length !== after.length) { rerender(tab); return; }
            before.forEach((node, index) => pairs.push([node, after[index]]));
        }
        // 被换掉的节点若正好是浏览器的滚动锚点，换完会被锚定逻辑带偏几百像素；局部替换不改上方内容高度，按原值放回即可。
        const feed = app.querySelector('.pm-scene-feed');
        const feedScrollTop = feed?.scrollTop;
        for (const [node, next] of pairs) {
            node.replaceWith(next);
            deps.hydrateImageCards?.(next);
        }
        if (feed && Number.isFinite(feedScrollTop) && feed.scrollTop !== feedScrollTop) feed.scrollTop = feedScrollTop;
    }
    return { replaceApp, syncComposeDraft, focusComposeField, workspaceKey, rerender, patchEntries };
}
