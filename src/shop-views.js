import { appNameOf, appSloganOf } from './app-names.js';
import {
    BACK_ICON_SVG, BOX_ICON_SVG, CART_ICON_SVG, CHECK_ICON_SVG, FORWARD_ICON_SVG, HOME_ICON_SVG, MINUS_ICON_SVG, ORDER_ICON_SVG,
    PLUS_ICON_SVG, SEARCH_ICON_SVG, SPARKLES_ICON_SVG, STAR_ICON_SVG, STORE_ICON_SVG, USER_ICON_SVG, CLOSE_ICON_SVG,
} from './icons.js';
import {
    SHOP_LIMITS, SHOP_ORDER_STATUSES, SHOP_ORDER_STATUS_LABELS, formatShopCount, formatShopPrice, shopCategories, shopGoodRate, shopHash,
    shopItemName, shopLogisticsLine, shopMonthlySales, shopReviewTotal, shopShippingLine, shopStoreStats, shopSwatchIndex, summarizeShopCart,
} from './shop-model.js';
import { escapeAttr, escapeHtml } from './ui.js';

// 桃宝的页面模板，方案A「分组卡片」：冷白底，商品与信息段各成白卡；顶栏左右等宽，标题在整屏正中。
// 只输出 class 与 data-*，视觉全部在 styles/shop.css。

export const SHOP_VIEWS = Object.freeze(['home', 'list', 'search-empty', 'item', 'reviews', 'cart', 'orders', 'mine']);
export const SHOP_HOME_CATEGORY = '推荐';
const PHOTO_SIZES = Object.freeze(['tall', 'mid', 'short']);
const MAIN_TABS = Object.freeze([['home', '首页', HOME_ICON_SVG], ['cart', '购物车', CART_ICON_SVG], ['orders', '订单', ORDER_ICON_SVG], ['mine', '我的', USER_ICON_SVG]]);

const act = (action, extra = '') => `data-shop-action="${action}"${extra ? ` ${extra}` : ''}`;
const iconButton = (action, label, svg, extra = '') => `<button type="button" class="pm-shop-icon-button" ${act(action, extra)} aria-label="${escapeAttr(label)}" title="${escapeAttr(label)}">${svg}</button>`;
const price = (cents, size = '') => `<span class="pm-shop-price${size ? ` is-${size}` : ''}"><small>¥</small><b>${formatShopPrice(cents)}</b></span>`;
const status = text => `<p class="pm-shop-status" role="status"${text ? '' : ' hidden'}>${escapeHtml(text || '')}</p>`;

function topbar({ left = '', title = '', sub = '', right = '' }) {
    return `<header class="pm-shop-topbar"><div class="pm-shop-topbar-side">${left}</div><h2 class="pm-shop-heading">${escapeHtml(title)}${sub ? `<small>${escapeHtml(sub)}</small>` : ''}</h2><div class="pm-shop-topbar-side is-end">${right}</div></header>`;
}
const backButton = () => iconButton('back', '返回', BACK_ICON_SVG);

function tabbar(active) {
    return `<nav class="pm-shop-tabbar" aria-label="${escapeAttr(appNameOf('shop'))}">${MAIN_TABS.map(([key, label, svg]) => `<button type="button" class="pm-shop-tab" ${act('tab', `data-tab="${key}"`)}${key === active ? ' aria-current="page"' : ''}>${svg}<span>${label}</span></button>`).join('')}</nav>`;
}

// 商品图：实色块加文字描述，以后接生图时换成图片。色块按商品 id 稳定取色。
function photo(item, { size = '', text = '' } = {}) {
    const desc = text || (item?.image?.desc ? `实拍：${item.image.desc}` : shopItemName(item));
    return `<span class="pm-shop-photo is-swatch-${shopSwatchIndex(item?.itemId || item?.id)}${size ? ` is-${size}` : ''}"><span>${escapeHtml(desc)}</span></span>`;
}
const photoSize = item => PHOTO_SIZES[shopHash(`size:${item.id}`) % PHOTO_SIZES.length];

function card(item) {
    return `<button type="button" class="pm-shop-card" ${act('open-item', `data-item-id="${escapeAttr(item.id)}"`)}>${photo(item, { size: photoSize(item) })}<span class="pm-shop-card-info"><span class="pm-shop-card-title">${item.badge ? `<span class="pm-shop-badge">${escapeHtml(item.badge)}</span>` : ''}${escapeHtml(item.title)}</span><span class="pm-shop-card-price">${price(item.priceCents)}<span class="pm-shop-meta">月销${formatShopCount(shopMonthlySales(item))}</span></span><span class="pm-shop-meta is-ellipsis">${escapeHtml(item.shop)}</span></span></button>`;
}

// 双列瀑布流：按顺序左右交替放，阅读顺序与列表顺序一致。
function grid(items) {
    const columns = [[], []];
    items.forEach((item, index) => columns[index % 2].push(card(item)));
    return `<div class="pm-shop-grid">${columns.map(column => `<div class="pm-shop-column">${column.join('')}</div>`).join('')}</div>`;
}

function stars(rating) {
    return `<span class="pm-shop-stars" aria-label="${rating}星">${'★'.repeat(rating)}${rating < 5 ? `<span class="pm-shop-stars-off">${'★'.repeat(5 - rating)}</span>` : ''}</span>`;
}

function review(entry) {
    const followup = entry.followup ? `<p class="pm-shop-followup"><b>追评${entry.followup.after ? ` · ${escapeHtml(entry.followup.after)}` : ''}</b>${escapeHtml(entry.followup.content)}</p>` : '';
    return `<article class="pm-shop-review"><div class="pm-shop-review-head"><span class="pm-shop-avatar" aria-hidden="true">${escapeHtml(Array.from(entry.author)[0] || '买')}</span><span class="pm-shop-review-author">${escapeHtml(entry.author)}</span>${entry.spec ? `<span class="pm-shop-meta">${escapeHtml(entry.spec)}</span>` : ''}${stars(entry.rating)}</div><p class="pm-shop-review-text">${escapeHtml(entry.content)}</p>${followup}</article>`;
}

function searchForm(query, placeholder, { clear = false } = {}) {
    return `<form class="pm-shop-search" role="search" data-shop-form="search">${SEARCH_ICON_SVG}<input id="pm-shop-query" class="pm-shop-search-input" type="text" enterkeyhint="search" name="query" maxlength="30" value="${escapeAttr(query)}" placeholder="${escapeAttr(placeholder)}" aria-label="搜索商品" autocomplete="off">${clear && query ? `<button type="button" class="pm-shop-search-clear" ${act('clear-search')} aria-label="清空" title="清空">${CLOSE_ICON_SVG}</button>` : ''}<button type="submit" class="pm-shop-search-go">搜索</button></form>`;
}

function busyStrip(busy) {
    return busy ? `<div class="pm-shop-busy" role="status"><span>${escapeHtml(busy)}</span><button type="button" class="pm-shop-text-button" ${act('cancel')}>停止</button></div>` : '';
}

const genButton = (label, busy, extra = '') => `<button type="button" class="pm-shop-primary" ${act('generate', extra)}${busy ? ' disabled aria-busy="true"' : ''}>${SPARKLES_ICON_SVG}<span>${busy ? '正在上新…' : label}</span></button>`;

// ===== 首页 =====
function homeView(scope, ui) {
    const categories = shopCategories(scope);
    const category = categories.includes(ui.category) ? ui.category : SHOP_HOME_CATEGORY;
    const items = scope.itemOrder.map(id => scope.items[id]).filter(item => category === SHOP_HOME_CATEGORY || item.category === category);
    const names = scope.itemOrder.slice(0, 3).map(id => shopItemName(scope.items[id])).filter(Boolean);
    const placeholder = names.length ? `搜${names.map(name => `「${name}」`).join('')}` : '搜索商品';
    const pills = [SHOP_HOME_CATEGORY, ...categories].map(name => `<button type="button" class="pm-shop-pill" ${act('category', `data-category="${escapeAttr(name)}"`)} aria-pressed="${name === category}">${escapeHtml(name)}</button>`).join('');
    const aiPill = `<button type="button" class="pm-shop-pill is-soft" ${act('generate', `data-category="${escapeAttr(category === SHOP_HOME_CATEGORY ? '' : category)}"`)}${ui.busy ? ' disabled aria-busy="true"' : ''}>${SPARKLES_ICON_SVG}AI上新</button>`;
    const body = items.length ? grid(items) : `<div class="pm-shop-empty">${emptyArt(BOX_ICON_SVG)}<h3>桃宝还没有上架商品</h3><p>让AI按当前剧情上新几件商品，店铺和评价也一并写好。</p><div class="pm-shop-empty-actions">${genButton('让AI上新', ui.busy, 'data-category=""')}</div></div>`;
    return `${topbar({
        left: iconButton('desktop', '回到桌面', BACK_ICON_SVG), title: appNameOf('shop'), sub: appSloganOf('shop'),
        right: iconButton('tab', '我的收藏', STAR_ICON_SVG, 'data-tab="mine"'),
    })}<div class="pm-shop-search-row">${searchForm('', placeholder)}</div>
<div class="pm-shop-pills" role="group" aria-label="分类">${pills}${aiPill}</div>${busyStrip(ui.busy)}${status(ui.status)}
<div class="pm-shop-scroll">${body}</div>${tabbar('home')}`;
}

const emptyArt = svg => `<span class="pm-shop-empty-art" aria-hidden="true">${svg}</span>`;

// ===== 搜索结果与店铺 =====
function listView(scope, ui) {
    const items = ui.list || [];
    const title = ui.shop ? ui.shop : '搜索';
    const sub = ui.shop ? `${items.length}件在售` : '';
    const more = ui.shop ? '' : `<div class="pm-shop-list-foot"><span class="pm-shop-meta">没找到想要的？</span>${genButton('让AI上新', ui.busy, `data-query="${escapeAttr(ui.query)}"`)}</div>`;
    return `${topbar({ left: backButton(), title, sub })}${ui.shop ? '' : `<div class="pm-shop-search-row">${searchForm(ui.query, '搜索商品', { clear: true })}</div>`}${busyStrip(ui.busy)}${status(ui.status)}
<div class="pm-shop-scroll">${grid(items)}${more}</div>`;
}

function searchEmptyView(scope, ui) {
    const suggestions = shopCategories(scope).slice(0, 4);
    const suggest = suggestions.length ? `<div class="pm-shop-suggest"><span>也可以试试</span><div class="pm-shop-suggest-pills">${suggestions.map(name => `<button type="button" class="pm-shop-pill" ${act('category', `data-category="${escapeAttr(name)}"`)}>${escapeHtml(name)}</button>`).join('')}</div></div>` : '';
    return `${topbar({ left: backButton(), title: '搜索' })}<div class="pm-shop-search-row">${searchForm(ui.query, '搜索商品', { clear: true })}</div>${status(ui.status)}
<div class="pm-shop-scroll"><div class="pm-shop-empty">${emptyArt(BOX_ICON_SVG)}<h3>${escapeHtml(appNameOf('shop'))}里暂时没有「${escapeHtml(ui.query)}」</h3><p>可以让AI为你上新，按这个词生成几件商品，店铺和评价也一并写好。</p>
<div class="pm-shop-empty-actions">${genButton('让AI上新', ui.busy, `data-query="${escapeAttr(ui.query)}"`)}<button type="button" class="pm-shop-soft" ${act('focus-search')}>换个词搜</button></div>${busyStrip(ui.busy)}${suggest}<p class="pm-shop-tip">上新约生成4至6件，约需十几秒。</p></div></div>`;
}

// ===== 商品页 =====
function itemView(scope, ui) {
    const item = scope.items[ui.itemId];
    if (!item) return '';
    const spec = item.specs.includes(ui.spec) ? ui.spec : item.specs[0];
    const services = item.services.length ? `<div class="pm-shop-services">${item.services.map(name => `<span>${escapeHtml(name)}</span>`).join('')}</div>` : '';
    const specs = item.specs.map(name => `<button type="button" class="pm-shop-spec" ${act('spec', `data-spec="${escapeAttr(name)}"`)} aria-pressed="${name === spec}">${escapeHtml(name)}</button>`).join('');
    const total = shopReviewTotal(item);
    const reviews = item.reviews.length ? item.reviews.slice(0, 2).map(review).join('')
        : `<p class="pm-shop-meta">还没有评价。</p>`;
    const stats = shopStoreStats(item.shop);
    const shopTabs = `<button type="button" class="pm-shop-bar-icon" ${act('open-shop', `data-shop="${escapeAttr(item.shop)}"`)}>${STORE_ICON_SVG}<span>店铺</span></button><button type="button" class="pm-shop-bar-icon" ${act('favorite')} aria-pressed="${item.favorite === true}">${STAR_ICON_SVG}<span>${item.favorite ? '已收藏' : '收藏'}</span></button>`;
    return `<div class="pm-shop-scroll is-item"><div class="pm-shop-hero">${photo(item, { size: 'hero' })}<div class="pm-shop-hero-bar">${iconButton('back', '返回', BACK_ICON_SVG, 'data-overlay="1"')}${iconButton('tab', '购物车', CART_ICON_SVG, 'data-tab="cart"')}</div></div>
<section class="pm-shop-block is-lifted"><div class="pm-shop-price-row">${price(item.priceCents, 'large')}${item.originalCents ? `<s class="pm-shop-original">¥${formatShopPrice(item.originalCents)}</s>` : ''}<span class="pm-shop-meta is-end">月销${formatShopCount(shopMonthlySales(item))}</span></div>${services}
<h3 class="pm-shop-item-title">${item.badge ? `<span class="pm-shop-badge is-solid">${escapeHtml(item.badge)}</span>` : ''}${escapeHtml(item.title)}</h3><p class="pm-shop-kv"><em>发货</em><span>${escapeHtml(shopShippingLine(item))}</span></p></section>
<section class="pm-shop-block"><div class="pm-shop-kv"><em>规格</em><div class="pm-shop-specs" role="group" aria-label="规格">${specs}</div></div></section>
<section class="pm-shop-block"><div class="pm-shop-block-head"><h3>评价（${formatShopCount(total)}）</h3><button type="button" class="pm-shop-text-button is-accent" ${act('reviews')}>好评率${shopGoodRate(item)}%　查看全部</button></div>${reviews}</section>
<section class="pm-shop-block"><div class="pm-shop-store"><span class="pm-shop-store-logo is-swatch-${shopSwatchIndex(item.shop)}" aria-hidden="true">${escapeHtml(Array.from(item.shop)[0] || '店')}</span><span class="pm-shop-store-name"><b>${escapeHtml(item.shop)}</b><span class="pm-shop-meta">好评率${stats.goodRate}% · 粉丝${formatShopCount(stats.fans)}</span></span><button type="button" class="pm-shop-soft is-small" ${act('open-shop', `data-shop="${escapeAttr(item.shop)}"`)}>进店</button></div></section>
</div>${status(ui.status)}<div class="pm-shop-buybar">${shopTabs}<div class="pm-shop-buy-pair"><button type="button" class="pm-shop-buy is-cart" ${act('add-cart')}>加入购物车</button><button type="button" class="pm-shop-buy is-now" ${act('buy-now')}>立即购买</button></div></div>`;
}

function reviewsView(scope, ui) {
    const item = scope.items[ui.itemId];
    if (!item) return '';
    const full = item.reviews.length >= SHOP_LIMITS.reviews;
    const more = full ? '<p class="pm-shop-tip">评价已经很多了。</p>'
        : `<button type="button" class="pm-shop-soft is-wide" ${act('more-reviews')}${ui.busy ? ' disabled aria-busy="true"' : ''}>${ui.busy ? '正在生成评价…' : '更多评价'}</button>`;
    return `${topbar({ left: backButton(), title: '评价', sub: `${formatShopCount(shopReviewTotal(item))}条 · 好评率${shopGoodRate(item)}%` })}${busyStrip(ui.busy)}${status(ui.status)}
<div class="pm-shop-scroll"><section class="pm-shop-block">${item.reviews.length ? item.reviews.map(review).join('') : '<p class="pm-shop-meta">还没有评价。</p>'}</section><div class="pm-shop-list-foot">${more}</div></div>`;
}

// ===== 购物车 =====
const checkbox = (action, checked, label, extra = '') => `<button type="button" class="pm-shop-check" ${act(action, extra)} role="checkbox" aria-checked="${checked}" aria-label="${escapeAttr(label)}">${CHECK_ICON_SVG}</button>`;

function cartRow({ entry, item }) {
    return `<div class="pm-shop-row">${checkbox('toggle-cart', entry.checked, `勾选 ${item.title}`, `data-entry-id="${escapeAttr(entry.id)}"`)}<button type="button" class="pm-shop-thumb" ${act('open-item', `data-item-id="${escapeAttr(item.id)}"`)} aria-label="${escapeAttr(item.title)}">${photo(item, { text: shopItemName(item) })}</button><div class="pm-shop-row-text"><div><p class="pm-shop-row-title">${escapeHtml(item.title)}</p><span class="pm-shop-sku">${escapeHtml(entry.spec)}</span></div><div class="pm-shop-row-foot">${price(item.priceCents)}<span class="pm-shop-stepper"><button type="button" ${act('quantity', `data-entry-id="${escapeAttr(entry.id)}" data-delta="-1"`)} aria-label="减少"${entry.quantity <= 1 ? ' disabled' : ''}>${MINUS_ICON_SVG}</button><b aria-label="数量">${entry.quantity}</b><button type="button" ${act('quantity', `data-entry-id="${escapeAttr(entry.id)}" data-delta="1"`)} aria-label="增加"${entry.quantity >= SHOP_LIMITS.quantity ? ' disabled' : ''}>${PLUS_ICON_SVG}</button></span></div></div></div>`;
}

function cartView(scope, ui) {
    const summary = summarizeShopCart(scope);
    const right = summary.count ? `<button type="button" class="pm-shop-text-button" ${act('manage')} aria-pressed="${ui.managing === true}">${ui.managing ? '完成' : '管理'}</button>` : '';
    const groups = summary.groups.map(group => `<section class="pm-shop-block"><div class="pm-shop-group-head">${checkbox('toggle-group', group.allChecked, `勾选 ${group.shop} 的商品`, `data-shop="${escapeAttr(group.shop)}"`)}<button type="button" class="pm-shop-group-name" ${act('open-shop', `data-shop="${escapeAttr(group.shop)}"`)}>${STORE_ICON_SVG}<span>${escapeHtml(group.shop)}</span>${FORWARD_ICON_SVG}</button></div>${group.rows.map(cartRow).join('')}</section>`).join('');
    const body = summary.count ? groups : `<div class="pm-shop-empty">${emptyArt(CART_ICON_SVG)}<h3>购物车是空的</h3><p>看到喜欢的商品，点「加入购物车」就会出现在这里。</p><div class="pm-shop-empty-actions"><button type="button" class="pm-shop-primary" ${act('tab', 'data-tab="home"')}>去逛逛</button></div></div>`;
    const action = ui.managing
        ? `<button type="button" class="pm-shop-primary is-danger" ${act('remove-cart')}${summary.checkedCount ? '' : ' disabled'}>删除（${summary.checkedCount}）</button>`
        : `<button type="button" class="pm-shop-primary" ${act('checkout')}${summary.checkedCount ? '' : ' disabled'}>结算（${summary.checkedCount}）</button>`;
    const bar = summary.count ? `<div class="pm-shop-sumbar"><label class="pm-shop-all">${checkbox('toggle-all', summary.allChecked, '全选')}<span>全选</span></label>${ui.managing ? '<span class="pm-shop-sum"></span>' : `<span class="pm-shop-sum"><span>合计${price(summary.totalCents)}</span>${summary.savedCents ? `<span class="pm-shop-meta">已优惠¥${formatShopPrice(summary.savedCents)}</span>` : ''}</span>`}${action}</div>` : '';
    return `${topbar({ left: backButton(), title: '购物车', sub: summary.count ? `共${summary.count}件` : '', right })}${status(ui.status)}<div class="pm-shop-scroll">${body}</div>${bar}`;
}

// ===== 订单 =====
function orderCard(order, highlight) {
    const actionButton = order.status === 'pending' ? `<button type="button" class="pm-shop-primary is-small" ${act('advance-order', `data-order-id="${escapeAttr(order.id)}"`)}>提醒发货</button>`
        : order.status === 'shipped' ? `<button type="button" class="pm-shop-primary is-small" ${act('advance-order', `data-order-id="${escapeAttr(order.id)}"`)}>确认收货</button>` : '';
    const tell = order.told ? '<span class="pm-shop-meta">已告诉剧情</span>'
        : `<button type="button" class="pm-shop-soft is-small" ${act('tell-order', `data-order-id="${escapeAttr(order.id)}"`)}>告诉剧情</button>`;
    return `<article class="pm-shop-block pm-shop-order${highlight ? ' is-fresh' : ''}"><div class="pm-shop-order-head"><b>${escapeHtml(order.shop)}</b><span>${SHOP_ORDER_STATUS_LABELS[order.status]}</span></div>
<div class="pm-shop-row"><span class="pm-shop-thumb">${photo(order, { text: shopItemName(order) })}</span><div class="pm-shop-row-text"><div><p class="pm-shop-row-title">${escapeHtml(order.title)}</p><span class="pm-shop-sku">${escapeHtml(order.spec)} × ${order.quantity}</span></div><div class="pm-shop-row-foot"><span class="pm-shop-meta">实付</span>${price(order.priceCents * order.quantity)}</div></div></div>
<p class="pm-shop-logistics">${escapeHtml(shopLogisticsLine(order))}</p><div class="pm-shop-order-foot">${tell}${actionButton}</div></article>`;
}

function ordersView(scope, ui) {
    const tab = SHOP_ORDER_STATUSES.includes(ui.orderTab) ? ui.orderTab : 'pending';
    const tabs = SHOP_ORDER_STATUSES.map(key => {
        const count = scope.orders.filter(order => order.status === key).length;
        return `<button type="button" role="tab" class="pm-shop-order-tab" ${act('order-tab', `data-order-tab="${key}"`)} aria-selected="${key === tab}">${SHOP_ORDER_STATUS_LABELS[key]}${count && key !== 'done' ? `<em>${count}</em>` : ''}</button>`;
    }).join('');
    const orders = scope.orders.filter(order => order.status === tab);
    const body = orders.length ? orders.map(order => orderCard(order, order.id === ui.freshOrderId)).join('')
        : `<div class="pm-shop-empty">${emptyArt(ORDER_ICON_SVG)}<h3>暂无${SHOP_ORDER_STATUS_LABELS[tab]}的订单</h3></div>`;
    return `${topbar({ left: backButton(), title: '我的订单' })}<div class="pm-shop-order-tabs" role="tablist" aria-label="订单状态">${tabs}</div>
<p class="pm-shop-note">无真实支付，订单状态由你手动推进</p>${status(ui.status)}<div class="pm-shop-scroll">${body}</div>${tabbar('orders')}`;
}

// ===== 我的 =====
function mineView(scope, ui) {
    const favorites = scope.itemOrder.map(id => scope.items[id]).filter(item => item.favorite);
    const counts = SHOP_ORDER_STATUSES.map(key => `<button type="button" class="pm-shop-stat" ${act('order-tab', `data-order-tab="${key}"`)}><b>${scope.orders.filter(order => order.status === key).length}</b><span>${SHOP_ORDER_STATUS_LABELS[key]}</span></button>`).join('');
    const nsfw = scope.nsfw === true;
    return `${topbar({ left: backButton(), title: '我的' })}${status(ui.status)}<div class="pm-shop-scroll">
<section class="pm-shop-block"><div class="pm-shop-block-head"><h3>我的订单</h3></div><div class="pm-shop-stats">${counts}</div></section>
<section class="pm-shop-block"><div class="pm-shop-switch-row"><span class="pm-shop-switch-text"><b>成人内容</b><small>开启后上新与评价可以写成人向内容</small></span><button type="button" class="pm-shop-switch${nsfw ? ' is-on' : ''}" role="switch" aria-checked="${nsfw}" aria-label="成人内容" ${act('toggle-nsfw')}></button></div></section>
<h3 class="pm-shop-section-title">我的收藏</h3>${favorites.length ? grid(favorites) : '<p class="pm-shop-tip">还没有收藏的商品。在商品页点「收藏」即可加入。</p>'}</div>${tabbar('mine')}`;
}

const VIEW_RENDERERS = { home: homeView, list: listView, 'search-empty': searchEmptyView, item: itemView, reviews: reviewsView, cart: cartView, orders: ordersView, mine: mineView };

// scope：shop-model 的 scope；ui：{ view, category, query, list, shop, itemId, spec, managing, orderTab, freshOrderId, busy, status }
export function renderShopPage(scope, ui) {
    const view = SHOP_VIEWS.includes(ui?.view) ? ui.view : 'home';
    const inner = VIEW_RENDERERS[view](scope, ui || {});
    if (!inner) return '';
    return `<div class="pm-shop-shell" data-shop-view="${view}">${inner}</div>`;
}
