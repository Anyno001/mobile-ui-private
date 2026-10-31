// 金手指 App 控制器（Origin 系统 原作 vicliaaa，经授权移植）：页面、订阅、动作 → engine.dispatch / 生成请求。
// 核心与宿主在启动时由 main.js 装好（deps.originRuntime）；这里只做界面。getState 是深度冻结对象，排序筛选一律先复制。
// 存档只在 chatMetadata.origin_v2（核心读写），天音不另存、不进手机副本与删楼回退。
import { readOriginSheet, renderOriginSheet } from './origin-forms.js';
import { loadOriginSettings, originBoundRole, saveOriginSettings } from './origin-settings.js';
import { renderOriginSettings } from './origin-settings-view.js';
import { renderOriginPage, visibleOriginSubpages, visibleOriginTabs } from './origin-views.js';

const REASON_TEXT = Object.freeze({
    'no-points': '积分不足', 'no-item': '该物品已不存在', 'no-goods': '该商品已不存在', 'no-target': '该项已不存在',
    'no-task': '该任务已不存在', 'task-changed': '任务已变化，请重试', 'empty-pool': '奖池为空', busy: '上一项请求仍在处理',
    paused: '系统已暂停', disabled: '金手指未开启', 'no-result': '没有生成出结果，请重试或手动添加', 'no-host': '未绑定角色',
    'origin-save-newer': '本聊天的存档来自更新的版本，无法读取', 'origin-save-invalid': '本聊天的存档格式不合法，无法读取', 'no-legacy': '没有找到旧存档',
});
const reasonText = result => (typeof result?.text === 'string' && result.text.trim()) || REASON_TEXT[result?.reason] || '操作没有完成';
const freshUi = () => ({ tab: 'task', page: '', openRow: '', menuOpen: false, dropdown: '', taskFilter: 'all', gachaFilter: 'all', busy: '', status: '', lastDraw: null, sheet: null });
const DRAW_TEXT = /^抽中(?:\[([^\]]+)\])?(.+)$/;

export function installOriginApp(state, deps) {
    const runtime = deps.originRuntime;
    if (!runtime) return null;
    const { engine } = runtime;
    let ui = freshUi();
    let boundPage = null;
    let unsubscribe = null;
    let deferred = false;
    let badge = false;

    const getPage = () => deps.getPhoneWindow?.()?.querySelector?.('[data-phone-page="origin"]') || null;
    const isVisible = () => { const page = getPage(); return Boolean(page && !page.hidden && state.phoneActive && !state.isMinimized); };
    const settings = () => loadOriginSettings();
    const chatAvailable = () => {
        const c = deps.getCtx?.();
        let id = c?.chatId;
        if (!id && typeof c?.getCurrentChatId === 'function') { try { id = c.getCurrentChatId(); } catch (error) { id = ''; } }
        return Boolean(id && (c.chatMetadata || c.chat_metadata));
    };

    function viewState() {
        const s = settings();
        if (!s.enabled || !chatAvailable()) return null;
        return engine.isBlocked() ? null : engine.getState();
    }

    function render({ keepScroll = true } = {}) {
        const page = getPage();
        if (!page) return false;
        const s = settings();
        const st = viewState();
        const scroller = page.querySelector('.pm-origin-scroll');
        const scrollTop = keepScroll && scroller ? scroller.scrollTop : 0;
        const atBottom = scroller ? scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 24 : true;
        const active = page.contains(document.activeElement) ? document.activeElement : null;
        const focusKey = active?.id || active?.dataset?.originSetting || '';
        const focusValue = active && 'value' in active ? active.value : null;
        const view = {
            ...ui,
            legacy: st && ui.page !== 'settings' ? engine.legacyDetected() : false,
            lastFloor: st && ui.page === 'log' ? engine.lastFloorStatus() : null,
            blocked: s.enabled && chatAvailable() ? engine.isBlocked() : null,
            settingsHtml: ui.page === 'settings' ? renderOriginSettings(s, chatInfo(s)) : '',
            sheetHtml: ui.sheet ? renderOriginSheet(ui.sheet.kind, ui.sheet.values, ui.sheet.target) : '',
        };
        page.innerHTML = renderOriginPage(st, s, view);
        const next = page.querySelector('.pm-origin-scroll');
        if (next) next.scrollTop = ui.tab === 'chat' && !ui.page && (atBottom || !keepScroll) ? next.scrollHeight : scrollTop;
        if (focusKey) {
            const target = page.querySelector(`#${CSS.escape(focusKey)}`) || page.querySelector(`[data-origin-setting="${CSS.escape(focusKey)}"]`);
            if (target) { if (focusValue !== null) target.value = focusValue; target.focus?.(); }
        }
        if (ui.sheet) page.querySelector('.pm-origin-sheet .pm-origin-input, .pm-origin-sheet input')?.focus?.();
        deferred = false;
        return true;
    }

    function chatInfo(s) {
        if (!s.enabled || !chatAvailable() || engine.isBlocked()) return { available: false };
        const st = engine.getState();
        return { available: true, paused: st.paused === true, world: st.world || '', legacy: engine.legacyDetected() };
    }

    // 引擎有变化：页面开着就重画；表单开着时先不画，关表单时补画，免得冲掉正在填的内容。
    function onEngineChange() {
        if (!isVisible()) { stopWatching(); return; }
        if (ui.sheet) { deferred = true; return; }
        render();
    }
    function startWatching() { if (!unsubscribe) unsubscribe = engine.subscribe(onEngineChange); }
    function stopWatching() { unsubscribe?.(); unsubscribe = null; }

    function setBadge(on) {
        if (badge === on) return;
        badge = on;
        window.__pmDesktopBadges = { ...(window.__pmDesktopBadges || {}), origin: on };
        deps.refreshPhoneDesktop?.();
    }

    // 核心的提示：页面开着时写进顶栏下的提示行（抽奖结果改为浮起的结果卡）；没开时只在桌面图标上记红点，不弹 toastr。
    runtime.setNoticeSink(({ kind, text }) => {
        if (!isVisible()) { if (kind !== 'info') setBadge(true); return; }
        if (kind === 'gacha') {
            const match = DRAW_TEXT.exec(text);
            const name = match ? match[2].trim() : text;
            const prize = engine.getState()?.gachaPool?.find(item => item.name === name);
            ui.lastDraw = { tier: match?.[1] || prize?.tier || '', name, desc: prize?.desc || '' };
        } else ui.status = text;
        if (!ui.sheet) render();
    });

    const report = result => {
        if (result && result.ok === false && !result.cancelled) ui.status = reasonText(result);
        return result;
    };
    const dispatch = op => report(engine.dispatch(op));
    async function generate(busy, fn) {
        ui.busy = busy;
        render();
        try { return report(await fn()); } finally { ui.busy = ''; }
    }
    const openSheet = (kind, values = {}, target = '') => { ui.sheet = { kind, values, target }; ui.menuOpen = false; ui.dropdown = ''; };
    const st = () => engine.getState();
    const taskOf = id => st().tasks.find(task => String(task.id) === String(id)) || null;

    function saveSetting(key, value) {
        const patch = key.startsWith('mods.') ? { mods: { [key.slice(5)]: value } } : { [key]: value };
        const next = saveOriginSettings(patch);
        if (!next) { ui.status = '设置保存失败：浏览器存储不可用'; return false; }
        runtime.sync();
        return true;
    }

    async function handle(action, data) {
        if (action !== 'row' && action !== 'filter' && action !== 'dropdown') ui.status = '';
        if (action !== 'menu') ui.menuOpen = false;
        if (action !== 'dropdown' && action !== 'filter') ui.dropdown = '';
        switch (action) {
        case 'desktop': stopWatching(); await deps.showPhoneDesktopPage?.(); return false;
        case 'tab': ui = { ...ui, tab: data.tab || 'task', page: '', openRow: '', lastDraw: data.tab === 'gacha' ? ui.lastDraw : null }; return true;
        case 'page': ui = { ...ui, page: data.page || '', openRow: '' }; return true;
        case 'back': ui = { ...ui, page: '', openRow: '' }; return true;
        case 'menu': ui.menuOpen = !ui.menuOpen; return true;
        case 'row': ui.openRow = ui.openRow === data.key ? '' : data.key; return true;
        case 'dropdown': ui.dropdown = ui.dropdown === data.kind ? '' : data.kind; return true;
        case 'filter': ui[data.kind === 'gacha' ? 'gachaFilter' : 'taskFilter'] = data.value || 'all'; ui.dropdown = ''; ui.openRow = ''; return true;
        case 'sheet-close': ui.sheet = null; return true;
        case 'draw-close': ui.lastDraw = null; return true;
        case 'enable': if (saveSetting('enabled', true)) ui = { ...freshUi() }; return true;
        // 关闭只停注入与结算，本聊天的存档留在 chatMetadata 里，再开启时原样接上。
        case 'disable': if (saveSetting('enabled', false)) { ui = { ...freshUi() }; ui.status = '金手指已关闭，数据保留'; } return true;
        case 'pause': dispatch({ type: st().paused ? 'resume' : 'pause' }); return true;
        case 'chat-clear': if (window.confirm('清空本聊天与系统的对话记录？')) dispatch({ type: 'chatClear' }); return true;
        case 'task-gen': await generate('task', () => engine.genTask()); return true;
        case 'task-add': openSheet('addTask'); return true;
        case 'task-edit': {
            const task = taskOf(data.id);
            if (!task) { ui.status = REASON_TEXT['no-task']; return true; }
            openSheet('editTask', { ...task, taskType: task.type }, String(task.id));
            return true;
        }
        case 'task-done': {
            const task = taskOf(data.id);
            if (task && window.confirm(`把「${task.title}」标记为完成并发放奖励？`)) { if (dispatch({ type: 'completeTask', id: task.id })?.ok) ui.openRow = ''; }
            return true;
        }
        case 'task-del': {
            const task = taskOf(data.id);
            if (task && window.confirm(`删除任务「${task.title}」？`)) { if (dispatch({ type: 'deleteTask', id: task.id })?.ok) ui.openRow = ''; }
            return true;
        }
        case 'task-direction': openSheet('setDirection', { value: st().direction || '' }); return true;
        case 'world-edit': openSheet('setWorld', { value: st().world || '' }); return true;
        case 'bag-use': dispatch({ type: 'use', index: Number(data.i) }); return true;
        case 'bag-del': { const item = st().bag[Number(data.i)]; if (item && window.confirm(`丢弃「${item.name}」？`)) { dispatch({ type: 'deleteItem', index: Number(data.i) }); ui.openRow = ''; } return true; }
        case 'bag-add': openSheet('addItem'); return true;
        case 'shop-buy': if (dispatch({ type: 'buy', index: Number(data.i) })?.ok) ui.status = `已购买，放入背包`; return true;
        case 'shop-del': { const item = st().shop[Number(data.i)]; if (item && window.confirm(`下架「${item.name}」？`)) { dispatch({ type: 'deleteShop', index: Number(data.i) }); ui.openRow = ''; } return true; }
        case 'shop-add': openSheet('addShop'); return true;
        case 'shop-gen': await generate('shop', () => engine.genShop()); return true;
        case 'gacha-draw': ui.lastDraw = null; dispatch({ type: 'draw' }); return true;
        case 'gacha-del': { const item = st().gachaPool[Number(data.i)]; if (item && window.confirm(`从奖池移除「${item.name}」？`)) { dispatch({ type: 'deleteGacha', index: Number(data.i) }); ui.openRow = ''; } return true; }
        case 'gacha-add': openSheet('addGacha'); return true;
        case 'gacha-gen': await generate('gacha', () => engine.genGacha()); return true;
        case 'chat-gen': await generate('chat', () => engine.rpChatGen()); return true;
        case 'stat-add': openSheet('addStat'); return true;
        case 'skill-add': openSheet('addSkill'); return true;
        case 'perk-add': openSheet('addPerk'); return true;
        case 'stat-del': dispatch({ type: 'deleteStat', index: Number(data.i) }); ui.openRow = ''; return true;
        case 'skill-del': { const item = st().skills[Number(data.i)]; if (item && window.confirm(`删除技能「${item.name}」？`)) { dispatch({ type: 'deleteSkill', index: Number(data.i) }); ui.openRow = ''; } return true; }
        case 'perk-del': { const item = st().perks[Number(data.i)]; if (item && window.confirm(`删除「${item.name}」？`)) { dispatch({ type: 'deletePerk', index: Number(data.i) }); ui.openRow = ''; } return true; }
        case 'legacy-import': { const result = report(engine.importLegacy()); if (result?.ok) ui.status = `旧存档已导入，共${result.floors || 0}楼，原数据保留`; return true; }
        case 'legacy-dismiss': report(engine.dismissLegacy()); return true;
        case 'recalc': { const result = report(engine.recalcAll()); if (result?.ok) ui.status = `已按${result.floors || 0}楼重新结算`; return true; }
        case 'reset':
            if (window.confirm('清空本聊天的全部金手指数据？任务、背包、积分都会归零。') && window.confirm('此操作无法撤销，确定清空？')) {
                if (dispatch({ type: 'reset' })?.ok) ui.status = '本局已清空';
            }
            return true;
        case 'setting-toggle': {
            const s = settings();
            const current = data.key.startsWith('mods.') ? s.mods[data.key.slice(5)] !== false : s[data.key] === true;
            saveSetting(data.key, !current);
            return true;
        }
        case 'setting-pick': saveSetting(data.key, data.value); return true;
        case 'open-api': window.__pmShowConfig?.('api'); return false;
        default: return false;
        }
    }

    const run = (action, data) => Promise.resolve(handle(action, data)).then(changed => { if (changed) render(); }).catch(error => {
        ui.busy = '';
        ui.status = error?.message || '操作没有完成';
        render();
    });

    function onClick(event) {
        const button = event.target?.closest?.('[data-origin-action]');
        if (!button || button.disabled) {
            if (ui.menuOpen || ui.dropdown) { ui.menuOpen = false; ui.dropdown = ''; render(); }
            return;
        }
        event.preventDefault?.();
        run(button.dataset.originAction, { ...button.dataset });
    }

    function onSubmit(event) {
        const form = event.target;
        if (!form?.dataset?.originForm) return;
        event.preventDefault?.();
        if (form.dataset.originForm === 'chat') {
            const input = form.querySelector('#pm-origin-chat-input');
            const text = String(input?.value || '').trim();
            if (!text) return;
            input.value = '';
            const role = originBoundRole(settings());
            ui.status = '';
            if (role) { report(engine.rpChatCall(text)); render(); return; }
            generate('chat', () => engine.sysChat(text)).then(() => render());
            return;
        }
        const { kind, target } = form.dataset;
        const op = readOriginSheet(kind, new FormData(form), target);
        if (!op) { form.reportValidity?.(); return; }
        const result = dispatch(op);
        if (result?.ok) {
            ui.sheet = null;
            if (kind === 'setDirection') ui.status = op.value ? '方向已记下，下次派发任务时采用' : '已清除任务方向';
            if (kind === 'addTask') ui = { ...ui, tab: 'task', page: '' };
        }
        render();
    }

    function onChange(event) {
        const key = event.target?.dataset?.originSetting;
        if (!key) return;
        const input = event.target;
        const value = input.type === 'number' ? Number.parseInt(input.value, 10) : input.value;
        if (input.type === 'number' && !Number.isFinite(value)) { render(); return; }
        saveSetting(key, value);
        render();
    }

    function ensurePage() {
        const main = deps.getPhoneWindow?.()?.querySelector?.('.pm-main-ui');
        if (!main) return null;
        let page = main.querySelector('[data-phone-page="origin"]');
        if (!page) {
            page = document.createElement('section');
            page.className = 'pm-phone-page pm-origin-page';
            page.dataset.phonePage = 'origin';
            page.hidden = true;
            main.appendChild(page);
        }
        if (boundPage !== page) {
            boundPage = page;
            page.addEventListener('click', onClick);
            page.addEventListener('submit', onSubmit);
            page.addEventListener('change', onChange);
            page.addEventListener('keydown', event => { if (event.key === 'Escape' && ui.sheet) { ui.sheet = null; render(); } });
        }
        return page;
    }

    // resume：重新打开手机时回到上次的页签；其余情况从任务页开始。页签被模块开关关掉时回到任务页。
    function show({ resume = false } = {}) {
        if (!ensurePage()) return false;
        if (!resume) ui = freshUi();
        ui = { ...ui, status: '', sheet: null, menuOpen: false, dropdown: '' };
        const s = settings();
        if (!visibleOriginTabs(s).some(tab => tab.id === ui.tab)) ui.tab = 'task';
        if (ui.page && ui.page !== 'settings' && !visibleOriginSubpages(s).some(page => page.id === ui.page)) ui.page = '';
        if (globalThis.window?.__pmShowPhonePage?.('origin') !== true) return false;
        render({ keepScroll: false });
        startWatching();
        setBadge(false);
        deps.persistPhoneUiSnapshot?.();
        return true;
    }

    const destroy = () => { stopWatching(); boundPage = null; ui.sheet = null; };
    window.__pmOpenOriginApp = () => show();
    Object.assign(deps, { showOriginPage: show, destroyOriginApp: destroy });
    return { show, destroy, getView: () => ({ ...ui }), isWatching: () => Boolean(unsubscribe), hasDeferredRender: () => deferred };
}
