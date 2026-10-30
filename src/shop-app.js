import { generationErrorMessage } from './ai.js';
import { buildShopRequest, parseShopResponse } from './shop-ai.js';
import {
    addShopItems, addShopReviews, addToShopCart, advanceShopOrder, checkoutShopCart, getShopScope, markShopOrderTold, placeShopOrder,
    removeShopCartEntries, searchShopItems, setShopCartQuantity, SHOP_LIMITS, SHOP_ORDER_STATUS_LABELS, shopCategories, shopItemName,
    toggleShopCartEntry, toggleShopCartGroup, toggleShopFavorite,
} from './shop-model.js';
import { loadShopStore, saveShopStore } from './shop-storage.js';
import { applyIgsShopSync, igsShopHasWork } from './igs-shop-core.js';
import { renderShopPage, SHOP_HOME_CATEGORY } from './shop-views.js';

const INVALID_SCOPE = 'sms_unknown__default';
const CANCELLED = '生成已取消';
const HISTORY_LIMIT = 12;
const freshUi = () => ({
    view: 'home', category: SHOP_HOME_CATEGORY, query: '', shop: '', itemId: '', spec: '', managing: false,
    orderTab: 'pending', freshOrderId: '', status: '',
});

// 桃宝 App 控制器。数据走自己的存储键（shop-storage.js）；生成任务与社区、直播共用一把忙碌锁
// （deps.sceneBridge.runtime.busy / requestController），所以同一时间只有一个生成任务，聊天切换与关手机时由社区的 invalidate 一并取消。
export function installShopApp(state, deps) {
    let ui = freshUi();
    let storageId = '';
    let store = null;
    let readOnly = '';
    let history = [];
    let boundPage = null;
    let task = null;

    const bridge = () => deps.sceneBridge || null;
    const getPage = () => deps.getPhoneWindow?.()?.querySelector?.('[data-phone-page="shop"]') || null;
    const scope = () => getShopScope(store, storageId);
    const busyText = () => (task && task.storageId === storageId ? task.label : '');

    async function ensureStore() {
        if (store) return store;
        const loaded = await loadShopStore();
        store = loaded.store;
        readOnly = loaded.writable ? '' : loaded.warning;
        return store;
    }

    // 改动先作用于内存，再落盘；落盘失败时从存储重新读回，界面不显示没保存上的内容。
    async function commit(mutate, targetStorageId = storageId) {
        await ensureStore();
        if (readOnly) throw new Error(readOnly);
        const result = mutate(getShopScope(store, targetStorageId));
        try { await saveShopStore(store); }
        catch (error) { store = null; await ensureStore(); throw error; }
        return result;
    }

    // ---- 渲染 ----
    function viewModel() {
        const current = scope();
        const list = ui.view === 'list' ? (ui.shop
            ? current.itemOrder.map(id => current.items[id]).filter(item => item.shop === ui.shop)
            : searchShopItems(current, ui.query)) : [];
        return { ...ui, list, busy: busyText(), status: ui.status || readOnly };
    }

    function render({ keepScroll = false } = {}) {
        const page = getPage();
        if (!page || !store || !storageId) return false;
        if ((ui.view === 'item' || ui.view === 'reviews') && !scope().items[ui.itemId]) ui.view = 'home';
        if (ui.view === 'list' && !ui.shop && !searchShopItems(scope(), ui.query).length) ui.view = 'search-empty';
        const scrollTop = keepScroll ? page.querySelector('.pm-shop-scroll')?.scrollTop || 0 : 0;
        const html = renderShopPage(scope(), viewModel());
        if (!html) return false;
        page.innerHTML = html;
        const scroller = page.querySelector('.pm-shop-scroll');
        if (scroller && scrollTop) scroller.scrollTop = scrollTop;
        return true;
    }

    const snapshot = () => ({ view: ui.view, category: ui.category, query: ui.query, shop: ui.shop, itemId: ui.itemId, spec: ui.spec, orderTab: ui.orderTab });
    const go = patch => {
        history = [...history, snapshot()].slice(-HISTORY_LIMIT);
        ui = { ...ui, managing: false, freshOrderId: '', ...patch };
    };
    const back = () => {
        const previous = history.pop();
        ui = { ...ui, managing: false, freshOrderId: '', ...(previous || { view: 'home' }) };
    };

    // ---- 生成：上新与更多评价 ----
    async function request(kind, extra, label) {
        const sceneBridge = bridge();
        const runtime = sceneBridge?.runtime;
        if (!runtime) throw new Error('桃宝尚未就绪');
        if (runtime.busy || task) throw new Error('已有生成任务正在进行');
        const controller = new AbortController();
        const requestId = ++runtime.requestId;
        const target = storageId;
        runtime.busy = true;
        runtime.requestController = controller;
        task = { storageId: target, label, controller };
        render({ keepScroll: true });
        try {
            const context = await sceneBridge.contextText(controller.signal);
            const story = sceneBridge.actorSeeds(target).story.displayName;
            const prompts = buildShopRequest({ kind, nsfw: getShopScope(store, target).nsfw === true, ...context, actorRoster: story ? [story] : [], ...extra });
            const raw = await deps.callAI(prompts.systemPrompt, prompts.userPrompt, { isolated: true, module: 'community', signal: controller.signal });
            if (requestId !== runtime.requestId || controller.signal.aborted || deps.getStorageId() !== target) throw new Error(CANCELLED);
            return { target, items: parseShopResponse(raw, kind, extra) };
        } finally {
            if (requestId === runtime.requestId) { runtime.busy = false; runtime.requestController = null; }
            task = null;
        }
    }

    async function generateItems({ query = '', category = '' }) {
        const { target, items } = await request('shop_items', { query, category }, query ? `正在按「${query}」上新…` : '正在上新…');
        const added = await commit(current => addShopItems(current, items), target);
        if (target !== storageId) return;
        if (query) { ui = { ...ui, view: 'list', query, shop: '' }; }
        else { ui = { ...ui, view: 'home', category: category && shopCategories(scope()).includes(category) ? category : SHOP_HOME_CATEGORY }; }
        ui.status = `上新了 ${added.length} 件商品`;
    }

    async function generateReviews() {
        const item = scope().items[ui.itemId];
        if (!item) throw new Error('商品不存在');
        if (item.reviews.length >= SHOP_LIMITS.reviews) return;
        const itemId = item.id;
        const { target, items } = await request('shop_reviews', { item, specs: item.specs }, '正在生成评价…');
        const added = await commit(current => addShopReviews(current, itemId, items), target);
        if (target === storageId) ui.status = `新增 ${added.length} 条评价`;
    }

    // ---- 动作 ----
    const readQuery = page => String(page?.querySelector?.('#pm-shop-query')?.value || '').trim().slice(0, 30);
    const itemOf = () => {
        const item = scope().items[ui.itemId];
        if (!item) throw new Error('商品不存在');
        return item;
    };

    async function search(query) {
        if (!query) return;
        if (ui.view === 'list' || ui.view === 'search-empty') ui = { ...ui, view: 'list', query, shop: '' };
        else go({ view: 'list', query, shop: '' });
    }

    async function handle(action, button, page) {
        const data = button?.dataset || {};
        if (action !== 'cancel') ui.status = '';
        if (action === 'desktop') { await deps.showPhoneDesktopPage?.(); return; }
        if (action === 'back') { back(); return render(); }
        if (action === 'tab') {
            const tab = data.tab;
            if (tab === 'home') { history = []; ui = { ...ui, view: 'home', managing: false, freshOrderId: '' }; return render(); }
            if (ui.view !== tab) go({ view: tab });
            return render();
        }
        if (action === 'category') {
            history = [];
            ui = { ...ui, view: 'home', category: data.category || SHOP_HOME_CATEGORY };
            return render();
        }
        if (action === 'open-item') { go({ view: 'item', itemId: data.itemId, spec: '' }); return render(); }
        if (action === 'open-shop') { go({ view: 'list', shop: data.shop || '', query: '' }); return render(); }
        if (action === 'reviews') { go({ view: 'reviews' }); return render(); }
        if (action === 'spec') { ui.spec = data.spec || ''; return render({ keepScroll: true }); }
        if (action === 'focus-search' || action === 'clear-search') {
            const input = page?.querySelector?.('#pm-shop-query');
            if (input && action === 'clear-search') input.value = '';
            input?.focus?.();
            input?.select?.();
            return;
        }
        if (action === 'cancel') { task?.controller.abort(CANCELLED); bridge()?.invalidate?.('shop-cancelled'); return render({ keepScroll: true }); }
        if (action === 'generate') {
            const pending = generateItems({ query: data.query || '', category: data.category || '' });
            await pending.finally(() => render());
            return;
        }
        if (action === 'more-reviews') { await generateReviews().finally(() => render({ keepScroll: true })); return; }
        if (action === 'favorite') {
            const on = await commit(current => toggleShopFavorite(current, ui.itemId));
            ui.status = on ? '已收藏' : '已取消收藏';
            return render({ keepScroll: true });
        }
        if (action === 'add-cart') {
            const item = itemOf();
            await commit(current => addToShopCart(current, { itemId: item.id, spec: ui.spec || item.specs[0] }));
            ui.status = `已加入购物车：${shopItemName(item)}`;
            return render({ keepScroll: true });
        }
        if (action === 'buy-now') {
            const item = itemOf();
            const order = await commit(current => placeShopOrder(current, { itemId: item.id, spec: ui.spec || item.specs[0] }));
            go({ view: 'orders', orderTab: 'pending' });
            ui = { ...ui, freshOrderId: order.id, status: '下单成功。点「告诉剧情」可以让剧情知道这次购物。' };
            return render();
        }
        if (action === 'manage') { ui.managing = !ui.managing; return render({ keepScroll: true }); }
        if (action === 'toggle-cart') { await commit(current => toggleShopCartEntry(current, data.entryId)); return render({ keepScroll: true }); }
        if (action === 'toggle-group') { await commit(current => toggleShopCartGroup(current, data.shop || '')); return render({ keepScroll: true }); }
        if (action === 'toggle-all') { await commit(current => toggleShopCartGroup(current)); return render({ keepScroll: true }); }
        if (action === 'quantity') {
            const entry = scope().cart.find(item => item.id === data.entryId);
            if (!entry) return;
            await commit(current => setShopCartQuantity(current, entry.id, entry.quantity + Number(data.delta || 0)));
            return render({ keepScroll: true });
        }
        if (action === 'remove-cart') {
            const ids = scope().cart.filter(entry => entry.checked).map(entry => entry.id);
            if (!ids.length || !window.confirm(`确定从购物车删除这 ${ids.length} 件商品吗？`)) return;
            await commit(current => removeShopCartEntries(current, ids));
            ui.managing = false;
            return render();
        }
        if (action === 'checkout') {
            const orders = await commit(current => checkoutShopCart(current));
            go({ view: 'orders', orderTab: 'pending' });
            ui = { ...ui, freshOrderId: orders[0]?.id || '', status: `已下单 ${orders.length} 件。点「告诉剧情」可以让剧情知道这次购物。` };
            return render();
        }
        if (action === 'order-tab') {
            if (ui.view !== 'orders') go({ view: 'orders' });
            ui.orderTab = data.orderTab || 'pending';
            return render();
        }
        if (action === 'advance-order') {
            const next = await commit(current => advanceShopOrder(current, data.orderId));
            ui.status = next === 'done' ? '已确认收货，订单移到「已完成」' : `商家已发货，订单移到「${SHOP_ORDER_STATUS_LABELS[next]}」`;
            return render({ keepScroll: true });
        }
        if (action === 'tell-order') {
            await commit(current => markShopOrderTold(current, data.orderId));
            await deps.applyBidirectionalInjection?.();
            ui.status = '已告诉剧情，下一轮正文会知道这次购物';
            return render({ keepScroll: true });
        }
        if (action === 'toggle-nsfw') {
            await commit(current => { if (current.nsfw) delete current.nsfw; else current.nsfw = true; });
            return render({ keepScroll: true });
        }
    }

    const run = (action, button, page) => Promise.resolve(handle(action, button, page)).catch(error => {
        if (error?.message === CANCELLED || error?.name === 'AbortError') { render({ keepScroll: true }); return; }
        ui.status = generationErrorMessage(error);
        render({ keepScroll: true });
    });
    function onClick(event) {
        const button = event.target?.closest?.('[data-shop-action]');
        if (!button || button.disabled) return;
        event.preventDefault?.();
        return run(button.dataset.shopAction, button, boundPage);
    }
    function onSubmit(event) {
        if (event.target?.dataset?.shopForm !== 'search') return;
        event.preventDefault?.();
        const query = readQuery(boundPage);
        if (!query) return;
        ui.status = '';
        return Promise.resolve(search(query)).then(() => render());
    }

    function ensurePage() {
        const main = deps.getPhoneWindow?.()?.querySelector?.('.pm-main-ui');
        if (!main) return null;
        let page = main.querySelector('[data-phone-page="shop"]');
        if (!page) {
            page = document.createElement('section');
            page.className = 'pm-phone-page pm-shop-page';
            page.dataset.phonePage = 'shop';
            page.hidden = true;
            main.appendChild(page);
        }
        if (boundPage !== page) {
            boundPage = page;
            page.addEventListener('click', onClick);
            page.addEventListener('submit', onSubmit);
        }
        return page;
    }

    // resume：重新打开手机时回到上次的页面；换了会话或首次打开都从首页开始。
    async function show({ resume = false } = {}) {
        const scopeId = deps.getStorageId();
        if (!scopeId || scopeId === INVALID_SCOPE) { alert('请先打开有效的角色聊天。'); return false; }
        if (!ensurePage()) return false;
        store = null;
        await ensureStore();
        if (!(resume && scopeId === storageId)) { ui = freshUi(); history = []; }
        storageId = scopeId;
        ui.status = '';
        if (!render()) return false;
        if (globalThis.window?.__pmShowPhonePage?.('shop') !== true) return false;
        deps.persistPhoneUiSnapshot?.();
        return true;
    }

    // 与 gal 前端联动：正文里的淘宝帖子写进指定会话的桃宝（对账逻辑在 igs-shop-core.js）。桃宝页开着同一会话时重绘。
    async function syncIgsShop(targetStorageId, { index, entries }) {
        await ensureStore();
        if (readOnly) return null;
        const current = getShopScope(store, targetStorageId);
        if (!igsShopHasWork(current, index, entries)) return null;
        const result = await commit(scopeRef => applyIgsShopSync(scopeRef, { index, entries }), targetStorageId);
        if (storageId === targetStorageId && getPage() && !getPage().hidden) render();
        return result;
    }

    // 上下文注入取用：每次从存储读，备份导入或清理数据后也拿到最新内容（只读）。
    const getStore = async () => (await loadShopStore()).store;

    window.__pmOpenShopApp = () => show();
    Object.assign(deps, { showShopPage: show, getShopStore: getStore, syncIgsShop });
    return { show, getView: () => ({ ...ui, storageId }), isBusy: () => !!task };
}
