import { normalizeBudgetConfig } from './budget.js';
import { deleteInteractiveScene } from './interactive-scene-model.js';

export async function runDesktopPageTransition({
    scopeId, loadStore, updatePhoneUi, refreshDesktop, showPhonePage, clearOpenScene,
    isCurrent = () => true, getCurrentPage = () => 'chat',
}) {
    const validScope = !!scopeId && scopeId !== 'sms_unknown__default';
    const store = validScope ? await loadStore() : null;
    if (!isCurrent()) return false;
    if (!refreshDesktop(scopeId, store)) throw new Error('桌面内容渲染失败');
    if (!isCurrent()) return false;
    const previousPage = getCurrentPage();
    if (!showPhonePage('desktop')) throw new Error('桌面页面不可用');
    try {
        if (validScope) updatePhoneUi(scopeId, store);
    } catch (error) {
        const ownsDesktopPage = isCurrent() && getCurrentPage() === 'desktop';
        if (ownsDesktopPage && previousPage && previousPage !== 'desktop') showPhonePage(previousPage);
        throw error;
    }
    if (!isCurrent() || getCurrentPage() !== 'desktop') return false;
    clearOpenScene();
    return true;
}

export function resolvePhoneChatTarget(uiScope, histories, groups, defaultContact) {
    const historyMap = histories && typeof histories === 'object' ? histories : {};
    const groupMap = groups && typeof groups === 'object' ? groups : {};
    const key = typeof uiScope?.lastChatKey === 'string' ? uiScope.lastChatKey : '';
    if (uiScope?.lastChatType === 'group' && key && Object.hasOwn(groupMap, key)) {
        return { type: 'group', key };
    }
    if (uiScope?.lastChatType === 'contact' && key && !key.startsWith('__group_') && Object.hasOwn(historyMap, key)) {
        return { type: 'contact', key };
    }
    return { type: 'contact', key: String(defaultContact || 'AI').trim() || 'AI' };
}

export function getCommunityInjectionState(config, storageId, sceneId) {
    const normalized = normalizeBudgetConfig(config);
    return {
        communitySceneAllowed: (normalized.communitySceneIdsByStorage[storageId] || []).includes(sceneId),
        communitySelection: normalized.communitySelectionsByStorage[storageId]?.[sceneId]
            || { mode: 'all', postIds: [] },
    };
}

export async function runCommunityInjectionAction(action, {
    app, storageId, scene, lastTab, config, saveConfig, refreshInjection,
}) {
    if (action === 'context-inject') return { handled: true, view: 'context-inject' };
    if (action === 'context-select-all' || action === 'context-clear') {
        const checked = action === 'context-select-all';
        app.querySelectorAll('.pm-scene-injection-post-input').forEach(input => { input.checked = checked; });
        const modeControl = app.querySelector('#pm-scene-injection-mode');
        if (modeControl) modeControl.value = 'selected';
        return { handled: true };
    }
    if (action === 'context-cancel') return { handled: true, view: lastTab };
    if (action !== 'context-save') return { handled: false };
    if (!scene) throw new Error('当前社区不存在');
    const current = normalizeBudgetConfig(config);
    const sceneIdsByStorage = { ...current.communitySceneIdsByStorage };
    const allowed = new Set(sceneIdsByStorage[storageId] || []);
    if (app.querySelector('#pm-scene-injection-enabled')?.checked) allowed.add(scene.id);
    else allowed.delete(scene.id);
    if (allowed.size) sceneIdsByStorage[storageId] = [...allowed];
    else delete sceneIdsByStorage[storageId];
    const selectionsByStorage = { ...current.communitySelectionsByStorage };
    const storageSelections = { ...(selectionsByStorage[storageId] || {}) };
    const mode = app.querySelector('#pm-scene-injection-mode')?.value === 'selected' ? 'selected' : 'all';
    const postIds = mode === 'selected'
        ? Array.from(app.querySelectorAll('.pm-scene-injection-post-input:checked')).map(input => input.value).filter(Boolean)
        : [];
    storageSelections[scene.id] = { mode, postIds };
    selectionsByStorage[storageId] = storageSelections;
    const candidate = normalizeBudgetConfig({
        ...current,
        communitySceneIdsByStorage: sceneIdsByStorage,
        communitySelectionsByStorage: selectionsByStorage,
    });
    if (typeof saveConfig !== 'function' || saveConfig(candidate) !== true) {
        throw new Error('上下文注入设置保存失败：浏览器存储不可用');
    }
    let refreshError = null;
    try {
        const result = await refreshInjection?.();
        const failedWrites = Number.isInteger(result?.failedWrites) ? result.failedWrites : 0;
        const failedKeys = Array.isArray(result?.failedKeys) ? result.failedKeys.length : 0;
        if (failedWrites || failedKeys) {
            refreshError = new Error(`注入刷新失败：${failedWrites} 项写入失败，${failedKeys} 项清理失败`);
        }
    } catch (error) {
        refreshError = error;
    }
    if (refreshError) throw new Error(`上下文注入设置已保存，但刷新失败：${refreshError.message}`);
    return { handled: true, view: lastTab, status: '上下文注入设置已保存。' };
}

export async function handleCommunityInjectionUiAction(action, {
    app, getCurrent, getLastTab, config, saveConfig, refreshInjection, rerender, setStatus,
}) {
    if (!action.startsWith('context-')) return false;
    const { scopeId, scene } = getCurrent();
    const lastTab = getLastTab(scopeId);
    const result = await runCommunityInjectionAction(action, {
        app, storageId: scopeId, scene, lastTab, config, saveConfig, refreshInjection,
    });
    if (!result.handled) return false;
    if (result.view) rerender(result.view);
    if (result.status) setStatus(result.status);
    return true;
}

export function persistCurrentPhoneUiSnapshot({
    runtime, storageId, page, phoneScope, updatePhoneUiScope, chatType = null, chatKey = null,
}) {
    if (!runtime?.store || !storageId || storageId === 'sms_unknown__default'
        || !['desktop', 'chat', 'community', 'calendar'].includes(page)) return false;
    const scope = phoneScope(storageId, runtime.store);
    const normalizedChatType = chatType === 'contact' || chatType === 'group' ? chatType : null;
    const normalizedChatKey = normalizedChatType && typeof chatKey === 'string' && chatKey.trim()
        ? chatKey.trim() : null;
    updatePhoneUiScope(storageId, {
        lastPage: page,
        lastSceneId: page === 'community' ? runtime.openSceneId : null,
        lastTab: scope.lastTab,
        lastChatType: normalizedChatKey ? normalizedChatType : null,
        lastChatKey: normalizedChatKey,
    }, runtime.store);
    return true;
}

export function persistSceneBudgetRemoval({ config, storageId, sceneId, saveConfig }) {
    const selected = config?.communitySceneIdsByStorage?.[storageId];
    const storedSelections = config?.communitySelectionsByStorage?.[storageId];
    const scenePermissionChanged = Array.isArray(selected) && selected.includes(sceneId);
    const postSelectionChanged = !!storedSelections && typeof storedSelections === 'object'
        && !Array.isArray(storedSelections) && Object.hasOwn(storedSelections, sceneId);
    if (!scenePermissionChanged && !postSelectionChanged) {
        return { changed: false, saved: true, candidate: config };
    }
    const sceneIdsByStorage = { ...(config?.communitySceneIdsByStorage || {}) };
    if (scenePermissionChanged) {
        const remaining = selected.filter(id => id !== sceneId);
        if (remaining.length) sceneIdsByStorage[storageId] = remaining;
        else delete sceneIdsByStorage[storageId];
    }
    const selectionsByStorage = { ...(config?.communitySelectionsByStorage || {}) };
    if (postSelectionChanged) {
        const storageSelections = { ...storedSelections };
        delete storageSelections[sceneId];
        if (Object.keys(storageSelections).length) selectionsByStorage[storageId] = storageSelections;
        else delete selectionsByStorage[storageId];
    }
    const candidate = {
        ...config,
        communitySceneIdsByStorage: sceneIdsByStorage,
        communitySelectionsByStorage: selectionsByStorage,
    };
    let saved = false;
    try {
        saved = typeof saveConfig === 'function' && saveConfig(candidate) === true;
    } catch (error) {
        saved = false;
    }
    return { changed: true, saved, candidate };
}

export async function runDeleteSceneAction(scopeId, sceneId, {
    scope, confirm, invalidate, commit, persistPhoneUi, refreshDesktop,
    getBudgetConfig, saveBudgetConfig, clearOpenScene, renderLauncher,
}) {
    return deleteSceneAndFinalize(scopeId, sceneId, {
        scope, confirm, invalidate, commit, deleteScene: deleteInteractiveScene, persistPhoneUi, refreshDesktop,
        persistBudget: (storageId, removedSceneId) => {
            const result = persistSceneBudgetRemoval({
                config: getBudgetConfig(), storageId, sceneId: removedSceneId, saveConfig: saveBudgetConfig,
            });
            if (!result.saved) throw new Error('浏览器存储不可用');
        },
        clearOpenScene,
        renderLauncher,
    });
}

export async function deleteSceneAndFinalize(scopeId, sceneId, {
    scope, confirm, invalidate, commit, deleteScene, finalize = finalizeDeletedScene,
    persistPhoneUi, refreshDesktop, persistBudget, clearOpenScene, renderLauncher,
}) {
    const scene = scope?.scenes?.[sceneId];
    if (!scene) throw new Error('互动场景不存在');
    if (!confirm(`确定删除互动场景“${scene.title}”吗？帖子、评论和弹幕都会一并删除。`)) return false;
    invalidate();
    await commit(() => deleteScene(scope, sceneId));
    finalize({
        persistPhoneUi,
        refreshDesktop: () => refreshDesktop(scopeId),
        persistBudget: () => persistBudget(scopeId, sceneId),
        clearOpenScene,
        renderLauncher: () => renderLauncher(scopeId),
    });
    return true;
}

export function finalizeDeletedScene({ persistPhoneUi, refreshDesktop, persistBudget, clearOpenScene, renderLauncher }) {
    const failures = [];
    for (const [label, operation] of [
        ['手机页面状态保存失败', persistPhoneUi],
        ['桌面刷新失败', refreshDesktop],
        ['上下文预算清理保存失败', persistBudget],
        ['运行时场景清理失败', clearOpenScene],
        ['社区页面刷新失败', renderLauncher],
    ]) {
        try {
            operation();
        } catch (error) {
            failures.push(`${label}：${error.message || error}`);
        }
    }
    if (failures.length) throw new Error(`互动场景已删除；${failures.join('；')}`);
}

function closeSceneMenus(phoneWindow, keepWrap = null) {
    let focusTarget = null;
    phoneWindow.querySelectorAll?.('.pm-scene-menu:not([hidden])').forEach(menu => {
        const wrap = menu.closest('.pm-scene-menu-wrap');
        if (wrap === keepWrap) return;
        menu.hidden = true;
        const trigger = wrap?.querySelector('[data-action="more"]');
        trigger?.setAttribute('aria-expanded', 'false');
        focusTarget ||= trigger;
    });
    return focusTarget;
}

function closePostActions(phoneWindow, keepWrap = null) {
    let focusTarget = null;
    phoneWindow.querySelectorAll?.('.pm-scene-post-actions:not([hidden])').forEach(actions => {
        const wrap = actions.closest('.pm-scene-post-actions-wrap');
        if (wrap === keepWrap) return;
        actions.hidden = true;
        wrap?.closest?.('.pm-scene-post')?.querySelectorAll?.('.pm-scene-comment-actions').forEach(commentActions => {
            commentActions.hidden = true;
        });
        const trigger = wrap?.querySelector('[data-action="post-actions"]');
        trigger?.setAttribute('aria-expanded', 'false');
        focusTarget ||= trigger;
    });
    return focusTarget;
}

export function toggleSceneMenu(button) {
    const menu = button?.parentElement?.querySelector?.('.pm-scene-menu');
    if (!menu) return false;
    const opening = menu.hidden;
    menu.hidden = !opening;
    button.setAttribute?.('aria-expanded', String(opening));
    if (opening) menu.querySelector?.('button')?.focus?.({ preventScroll: true });
    return opening;
}

export function selectScenePreset(app, button) {
    if (!app || !button) return false;
    const accent = String(button.dataset?.accent || '').trim().toLowerCase();
    if (!/^#[0-9a-f]{6}$/.test(accent)) throw new Error('社区预设主题色格式无效');
    app.querySelectorAll?.('.pm-scene-preset').forEach(item => {
        item.classList.toggle('is-active', item === button);
    });
    app.style?.setProperty?.('--scene-accent', accent);
    return true;
}

export function syncSceneAccentControls(app, accent) {
    const normalized = String(accent || '').trim().toLowerCase();
    if (!/^#[0-9a-f]{6}$/.test(normalized)) throw new Error('社区主题色格式无效');
    const input = app?.querySelector?.('#pm-scene-accent') || document.getElementById('pm-scene-accent');
    if (input) input.value = normalized;
    app?.querySelectorAll?.('.pm-scene-accent-option').forEach(option => {
        option.setAttribute('aria-pressed', String(option.dataset.accent === normalized));
    });
    return normalized;
}

export function handleSceneAccentAction(action, app, control) {
    if (action === 'scene-accent') syncSceneAccentControls(app, control?.dataset?.accent);
    else if (action === 'scene-accent-custom') syncSceneAccentControls(app, control?.value);
    else return false;
    return true;
}

export function toggleScenePostActions(button) {
    const wrap = button?.parentElement;
    const actions = wrap?.querySelector?.('.pm-scene-post-actions');
    if (!actions) return false;
    const opening = actions.hidden;
    actions.hidden = !opening;
    wrap?.closest?.('.pm-scene-post')?.querySelectorAll?.('.pm-scene-comment-actions').forEach(commentActions => {
        commentActions.hidden = !opening;
    });
    button.setAttribute?.('aria-expanded', String(opening));
    if (opening) actions.querySelector?.('button')?.focus?.({ preventScroll: true });
    return opening;
}

export function toggleSceneReplyComposer(button, app) {
    const postId = String(button?.dataset?.postId || '').trim();
    if (!postId || !app) return false;
    const targetId = button.getAttribute?.('aria-controls') || '';
    const composers = [...(app.querySelectorAll?.('.pm-scene-comment-composer') || [])];
    const target = composers.find(composer => composer.id === targetId);
    if (!target) return false;
    const opening = target.hidden;
    composers.filter(composer => !composer.hidden).forEach(composer => {
        composer.hidden = true;
    });
    app.querySelectorAll?.('[data-action="toggle-reply"]').forEach(trigger => {
        trigger.setAttribute?.('aria-expanded', 'false');
    });
    target.hidden = !opening;
    button.setAttribute?.('aria-expanded', String(opening));
    if (opening) target.querySelector?.('input')?.focus?.({ preventScroll: true });
    return opening;
}

export function bindPhonePageActions(phoneWindow, handleAction, reportError) {
    if (!phoneWindow || phoneWindow.dataset.sceneUiBound === 'true') return false;
    phoneWindow.dataset.sceneUiBound = 'true';
    phoneWindow.addEventListener('click', event => {
        const button = event.target.closest?.('[data-action]');
        const keepMenuWrap = button?.dataset?.action === 'more' ? button.closest('.pm-scene-menu-wrap') : null;
        const keepPostWrap = button?.dataset?.action === 'post-actions' ? button.closest('.pm-scene-post-actions-wrap') : null;
        closeSceneMenus(phoneWindow, keepMenuWrap);
        closePostActions(phoneWindow, keepPostWrap);
        if (!button || !phoneWindow.contains(button)) return;
        if (button.tagName === 'SELECT' || button.tagName === 'INPUT') return;
        const app = button.closest('#pm-scene-app') || button.closest('#pm-calendar-app') || button.closest('.pm-desktop-page');
        if (!app) return;
        Promise.resolve(handleAction(button, app)).catch(error => {
            if (error.message !== '生成已取消') reportError(error);
        });
    });
    phoneWindow.addEventListener('change', event => {
        const control = event.target.closest?.('input[data-action],select[data-action]');
        if (!control || !phoneWindow.contains(control)) return;
        const app = control.closest('#pm-scene-app') || control.closest('#pm-calendar-app');
        if (!app) return;
        Promise.resolve(handleAction(control, app)).catch(error => {
            if (error.message !== '生成已取消') reportError(error);
        });
    });
    phoneWindow.addEventListener('keydown', event => {
        if (event.key !== 'Escape') return;
        const postFocusTarget = closePostActions(phoneWindow);
        const menuFocusTarget = closeSceneMenus(phoneWindow);
        const focusTarget = postFocusTarget || menuFocusTarget;
        if (!focusTarget) return;
        event.preventDefault();
        focusTarget.focus({ preventScroll: true });
    });
    return true;
}
