import { deleteInteractiveScene } from './interactive-scene-model.js';

export function persistSceneBudgetRemoval({ config, storageId, sceneId, saveConfig }) {
    const selected = config?.communitySceneIdsByStorage?.[storageId];
    if (!Array.isArray(selected) || !selected.includes(sceneId)) {
        return { changed: false, saved: true, candidate: config };
    }
    const sceneIdsByStorage = { ...config.communitySceneIdsByStorage };
    const remaining = selected.filter(id => id !== sceneId);
    if (remaining.length) sceneIdsByStorage[storageId] = remaining;
    else delete sceneIdsByStorage[storageId];
    const candidate = { ...config, communitySceneIdsByStorage: sceneIdsByStorage };
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

export function bindPhonePageActions(phoneWindow, handleAction, reportError) {
    if (!phoneWindow || phoneWindow.dataset.sceneUiBound === 'true') return false;
    phoneWindow.dataset.sceneUiBound = 'true';
    phoneWindow.addEventListener('click', event => {
        const button = event.target.closest?.('[data-action]');
        const keepWrap = button?.dataset?.action === 'more' ? button.closest('.pm-scene-menu-wrap') : null;
        closeSceneMenus(phoneWindow, keepWrap);
        if (!button || !phoneWindow.contains(button)) return;
        const app = button.closest('#pm-scene-app') || button.closest('#pm-calendar-app') || button.closest('.pm-desktop-page');
        if (!app) return;
        Promise.resolve(handleAction(button, app)).catch(error => {
            if (error.message !== '生成已取消') reportError(error);
        });
    });
    phoneWindow.addEventListener('keydown', event => {
        if (event.key !== 'Escape') return;
        const focusTarget = closeSceneMenus(phoneWindow);
        if (!focusTarget) return;
        event.preventDefault();
        focusTarget.focus({ preventScroll: true });
    });
    return true;
}
