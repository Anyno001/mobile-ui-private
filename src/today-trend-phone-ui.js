import { createTodayTrendPhoneController } from './today-trend-phone-controller.js';
import { renderTodayTrendApp } from './today-trend-view.js';

export function installTodayTrendPhoneUi(state, deps = {}) {
    if (!state || !deps || typeof deps.getStorageId !== 'function') throw new TypeError('今日风向页面安装依赖无效');
    let controller = null;
    const render = async () => {
        const phoneWindow = state.phoneWindow;
        const container = phoneWindow?.querySelector('.pm-today-trend-page');
        if (!phoneWindow || !container) return false;
        if (!container.addEventListener) {
            const storageId = deps.getStorageId();
            const store = await deps.getTodayTrendStore?.();
            if (phoneWindow !== state.phoneWindow || !container.isConnected) return false;
            container.innerHTML = renderTodayTrendApp({ scope: store?.scopes?.[storageId] || null });
            return true;
        }
        controller?.destroy();
        controller = createTodayTrendPhoneController({ state, deps, container });
        try { return await controller.render(); }
        catch (error) { controller?.destroy(); controller = null; return false; }
    };
    const show = async () => {
        const storageId = deps.getStorageId();
        if (!storageId || storageId === 'sms_unknown__default') throw new Error('请先打开有效的角色聊天');
        if (!await render()) throw new Error('今日风向页面渲染失败');
        if (window.__pmShowPhonePage?.('today-trend') !== true) throw new Error('今日风向页面不可用');
        deps.persistPhoneUiSnapshot?.();
        return true;
    };
    const destroy = () => {
        controller?.destroy();
        controller = null;
    };
    const bind = phoneWindow => {
        if (!phoneWindow || phoneWindow.dataset.todayTrendUiBound === 'true') return false;
        phoneWindow.dataset.todayTrendUiBound = 'true';
        phoneWindow.addEventListener('click', event => {
            const trigger = event.target.closest?.('[data-today-trend-ui-action]');
            if (!trigger || !phoneWindow.contains(trigger)) return;
            if (trigger.dataset.todayTrendUiAction === 'home') {
                deps.showPhoneDesktopPage?.().catch?.(error => console.error('[phone-mode] 返回桌面失败', error));
            }
        });
        return true;
    };
    Object.assign(deps, { bindTodayTrendPhoneUi: bind, destroyTodayTrendPhoneUi: destroy, showTodayTrendPage: show, renderTodayTrendPage: render });
    return { bind, destroy, render, show };
}
