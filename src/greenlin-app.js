// 格林推演 App 控制器：只读。打开时读一次数据库插件的推演账本，刷新键手动再读；不订阅、不轮询、不建计时器。
// 「较上次」以本聊天上次打开时看到的快照为基准（greenlin-store.js）：基准在一次打开内固定，刷新不清标记；每次读到的内容都会存成下次的基准。
// 切换聊天时手机会整体关闭（destroy 清空会话状态），下次打开重新读取。
import { renderGreenlinPage } from './greenlin-views.js';
import { buildGreenlinView, makeSnapshot } from './greenlin-model.js';
import { loadGreenlinSeen, saveGreenlinSeen } from './greenlin-store.js';

const freshUi = () => ({ mode: 'noapi', tab: 'overview', open: { actors: false, seeds: false }, view: null });

// 取数据库插件的推演接口：宿主页面（顶层窗口）和当前窗口都试一遍。
export function findWorldSimulationApi(candidates = [globalThis.window?.parent, globalThis.window?.top, globalThis.window]) {
    for (const target of candidates) {
        try {
            const api = target?.AutoCardUpdaterAPI?.worldSimulation;
            if (api && typeof api.getLedger === 'function') return api;
        } catch (error) { /* 跨域窗口读不到，换下一个 */ }
    }
    return null;
}

// 推演账本必须是对象，且带版本号或任一主要栏目数组；{}、数组、其他值都按「还没有推演」处理。
const LEDGER_LISTS = ['dimensions', 'seeds', 'actors', 'chronicle', 'rumors'];
export const isLedger = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value)
    && (value.schemaVersion !== undefined || LEDGER_LISTS.some(key => Array.isArray(value[key])));

export function installGreenlinApp(state, deps) {
    let ui = freshUi();
    let boundPage = null;
    // 本次打开的比对基准与它所属的聊天；null 表示还没读过。
    let session = { chat: '', base: null };
    // 本次读到、等页面显示成功后再存的快照。
    let pending = null;

    const getPage = () => deps.getPhoneWindow?.()?.querySelector?.('[data-phone-page="greenlin"]') || null;
    const chatKey = () => {
        const ctx = deps.getCtx?.();
        let id = ctx?.chatId;
        if (!id && typeof ctx?.getCurrentChatId === 'function') { try { id = ctx.getCurrentChatId(); } catch (error) { id = ''; } }
        return typeof id === 'string' ? id : '';
    };

    // 读一次账本并整理成视图。基准只在打开或换聊天后的第一次读取时定下。
    function load() {
        const api = findWorldSimulationApi();
        if (!api) { ui = { ...ui, mode: 'noapi', view: null }; return; }
        let ledger = null;
        try { ledger = api.getLedger(); } catch (error) { ledger = null; }
        if (!isLedger(ledger)) { ui = { ...ui, mode: 'noledger', view: null }; return; }
        const chat = chatKey();
        const snap = makeSnapshot(ledger);
        if (session.base === null || session.chat !== chat) session = { chat, base: loadGreenlinSeen(chat) || snap };
        ui = { ...ui, mode: 'ok', view: buildGreenlinView(ledger, session.base) };
        pending = { chat, snap };
    }

    function commitSeen() {
        if (ui.mode === 'ok' && pending) saveGreenlinSeen(pending.chat, pending.snap);
        pending = null;
    }

    function render({ keepScroll = true } = {}) {
        const page = getPage();
        if (!page) return false;
        const scroller = page.querySelector('.pm-origin-scroll');
        const top = keepScroll && scroller ? scroller.scrollTop : 0;
        page.innerHTML = renderGreenlinPage(ui);
        const next = page.querySelector('.pm-origin-scroll');
        if (next) next.scrollTop = top;
        return true;
    }

    async function onClick(event) {
        const button = event.target?.closest?.('[data-gl-action]');
        if (!button || button.disabled) return;
        const { glAction: action, tab, fold } = button.dataset;
        if (action === 'desktop') { await deps.showPhoneDesktopPage?.(); return; }
        if (action === 'tab') { ui = { ...ui, tab: tab || 'overview' }; render({ keepScroll: false }); return; }
        if (action === 'fold' && fold) { ui = { ...ui, open: { ...ui.open, [fold]: ui.open[fold] !== true } }; render(); return; }
        if (action === 'refresh' || action === 'detect') {
            const wasOk = ui.mode === 'ok';
            load();
            if (!wasOk) ui = { ...ui, tab: 'overview' };
            if (render({ keepScroll: wasOk })) commitSeen();
        }
    }

    function ensurePage() {
        const main = deps.getPhoneWindow?.()?.querySelector?.('.pm-main-ui');
        if (!main) return null;
        let page = main.querySelector('[data-phone-page="greenlin"]');
        if (!page) {
            page = document.createElement('section');
            page.className = 'pm-phone-page pm-origin-page';
            page.dataset.phonePage = 'greenlin';
            page.hidden = true;
            main.appendChild(page);
        }
        if (boundPage !== page) { boundPage = page; page.addEventListener('click', onClick); }
        return page;
    }

    // resume：重新打开手机时回到上次的页签；其余情况从总览开始。每次打开都重新读取，并以上次打开时存的快照为基准。
    function show({ resume = false } = {}) {
        if (!ensurePage()) return false;
        ui = resume ? { ...ui, open: { actors: false, seeds: false } } : freshUi();
        session = { chat: '', base: null };
        load();
        if (globalThis.window?.__pmShowPhonePage?.('greenlin') !== true) return false;
        if (render({ keepScroll: false })) commitSeen();
        deps.persistPhoneUiSnapshot?.();
        return true;
    }

    const destroy = () => { boundPage = null; pending = null; session = { chat: '', base: null }; ui = freshUi(); };
    window.__pmOpenGreenlinApp = () => show();
    Object.assign(deps, { showGreenlinPage: show, destroyGreenlinApp: destroy });
    return { show, destroy, getView: () => ({ ...ui }) };
}
