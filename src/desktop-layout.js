import { saveTheme } from './storage-preferences.js';

// 桌面图标的默认顺序；id 与桌面图标存储一致，dataApp 是渲染时的 data-app 值。
export const DESKTOP_APPS = Object.freeze([
    { id: 'chat', dataApp: 'chat' },
    { id: 'directory', dataApp: 'directory' },
    { id: 'calendar', dataApp: 'calendar' },
    { id: 'todayTrend', dataApp: 'today-trend' },
    { id: 'community', dataApp: 'community' },
    { id: 'live', dataApp: 'live' },
    { id: 'storyOracle', dataApp: 'story-oracle' },
    { id: 'settings', dataApp: 'settings' },
    { id: 'gallery', dataApp: 'gallery' },
    { id: 'shop', dataApp: 'shop' },
]);
// 设置是唯一的配置入口，不能被隐藏。
export const DESKTOP_UNHIDEABLE = Object.freeze(new Set(['settings']));
const DEFAULT_ORDER = DESKTOP_APPS.map(app => app.id);
const KNOWN = new Set(DEFAULT_ORDER);
const BY_DATA_APP = new Map(DESKTOP_APPS.map(app => [app.dataApp, app.id]));
const HOLD_DELAY = 450;
const MOVE_TOLERANCE = 8;

// 存的顺序里没有的新图标按默认位置补在后面；未知或重复的 id 丢弃。
export function normalizeDesktopLayout(value) {
    const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    const saved = Array.isArray(source.order) ? source.order.filter(id => KNOWN.has(id)) : [];
    const order = [...new Set(saved)];
    for (const id of DEFAULT_ORDER) if (!order.includes(id)) order.push(id);
    const hidden = [...new Set(Array.isArray(source.hidden) ? source.hidden : [])]
        .filter(id => KNOWN.has(id) && !DESKTOP_UNHIDEABLE.has(id));
    return { order, hidden };
}

export const currentDesktopLayout = () => normalizeDesktopLayout(globalThis.window?.__pmTheme?.desktopLayout);

export function visibleDesktopApps(layout = currentDesktopLayout()) {
    const hidden = new Set(layout.hidden);
    return layout.order.filter(id => !hidden.has(id));
}

function writeLayout(layout) {
    const theme = globalThis.window?.__pmTheme;
    if (!theme) return false;
    const previous = theme.desktopLayout;
    theme.desktopLayout = layout;
    if (saveTheme()) return true;
    theme.desktopLayout = previous;
    return false;
}

export function setDesktopAppHidden(appId, hidden) {
    if (!KNOWN.has(appId) || DESKTOP_UNHIDEABLE.has(appId)) return false;
    const layout = currentDesktopLayout();
    const rest = layout.hidden.filter(id => id !== appId);
    return writeLayout({ order: layout.order, hidden: hidden ? [...rest, appId] : rest });
}

export const resetDesktopLayout = () => writeLayout({ order: [...DEFAULT_ORDER], hidden: [] });

// 拖动只排可见图标；隐藏的图标留在原来的槽位，重新显示时回到原处。
export function mergeVisibleOrder(layout, visibleOrder) {
    const hidden = new Set(layout.hidden);
    const queue = visibleOrder.filter(id => KNOWN.has(id) && !hidden.has(id));
    const rest = layout.order.filter(id => !hidden.has(id) && !queue.includes(id));
    queue.push(...rest);
    return layout.order.map(id => (hidden.has(id) ? id : queue.shift()));
}

// 长按图标进入拖动，松手后按新顺序保存。桌面每次刷新都会重写 innerHTML，所以监听挂在页面容器上。
export function bindDesktopArrange(page, { onCommit } = {}) {
    if (!page || page.dataset.arrangeBound === 'true') return () => {};
    page.dataset.arrangeBound = 'true';
    let press = null, drag = null, suppressClick = false;
    const clearPress = () => { if (press?.timer) clearTimeout(press.timer); press = null; };
    const tileAt = (x, y) => document.elementFromPoint(x, y)?.closest?.('.pm-desktop-grid .pm-desktop-app');
    // 手机整体可能被缩放：先把指针坐标换算回网格的未缩放坐标，再减去图标自身槽位，得到位移。
    const gridPoint = (grid, x, y) => {
        const rect = grid.getBoundingClientRect();
        const scale = rect.width / grid.offsetWidth || 1;
        return { x: (x - rect.left) / scale, y: (y - rect.top) / scale };
    };
    const place = (x, y) => {
        const { tile } = drag;
        const point = gridPoint(tile.parentNode, x, y);
        tile.style.setProperty('--pm-desktop-drag-x', `${point.x - drag.grabX - tile.offsetLeft}px`);
        tile.style.setProperty('--pm-desktop-drag-y', `${point.y - drag.grabY - tile.offsetTop}px`);
    };
    const startDrag = () => {
        const { tile, pointerId, x, y } = press;
        press = null;
        const point = gridPoint(tile.parentNode, x, y);
        drag = { tile, pointerId, grabX: point.x - tile.offsetLeft, grabY: point.y - tile.offsetTop, moved: false };
        try { page.setPointerCapture(pointerId); } catch (error) {}
        page.classList.add('is-arranging');
        tile.classList.add('is-dragging');
        place(x, y);
    };
    const finishDrag = () => {
        if (!drag) return;
        const { tile, moved, pointerId } = drag;
        drag = null;
        try { page.releasePointerCapture(pointerId); } catch (error) {}
        tile.classList.remove('is-dragging');
        tile.style.removeProperty('--pm-desktop-drag-x');
        tile.style.removeProperty('--pm-desktop-drag-y');
        page.classList.remove('is-arranging');
        suppressClick = true;
        if (!moved) return;
        const ids = [...page.querySelectorAll('.pm-desktop-grid .pm-desktop-app')]
            .map(node => BY_DATA_APP.get(node.dataset.app)).filter(Boolean);
        const layout = currentDesktopLayout();
        if (writeLayout({ order: mergeVisibleOrder(layout, ids), hidden: layout.hidden })) onCommit?.();
    };
    const onDown = event => {
        suppressClick = false;
        if (event.button !== 0 || press || drag) return;
        const tile = event.target.closest?.('.pm-desktop-grid .pm-desktop-app');
        if (!tile) return;
        press = { tile, pointerId: event.pointerId, x: event.clientX, y: event.clientY, timer: setTimeout(startDrag, HOLD_DELAY) };
    };
    const onMove = event => {
        if (press && event.pointerId === press.pointerId
            && Math.hypot(event.clientX - press.x, event.clientY - press.y) > MOVE_TOLERANCE) clearPress();
        if (!drag || event.pointerId !== drag.pointerId) return;
        place(event.clientX, event.clientY);
        const target = tileAt(event.clientX, event.clientY);
        if (!target || target === drag.tile) return;
        const tiles = [...target.parentNode.children];
        target.parentNode.insertBefore(drag.tile, tiles.indexOf(drag.tile) < tiles.indexOf(target) ? target.nextSibling : target);
        drag.moved = true;
        place(event.clientX, event.clientY);
    };
    const onUp = event => {
        if (press && event.pointerId === press.pointerId) clearPress();
        if (drag && event.pointerId === drag.pointerId) finishDrag();
    };
    const onClick = event => {
        if (!suppressClick) return;
        suppressClick = false;
        event.preventDefault();
        event.stopPropagation();
    };
    const onTouchMove = event => { if (drag) event.preventDefault(); };
    const onContextMenu = event => { if (press || drag) event.preventDefault(); };
    const onBlur = () => { clearPress(); finishDrag(); };
    page.addEventListener('pointerdown', onDown);
    page.addEventListener('pointermove', onMove);
    page.addEventListener('pointerup', onUp);
    page.addEventListener('pointercancel', onUp);
    page.addEventListener('click', onClick, true);
    page.addEventListener('touchmove', onTouchMove, { passive: false });
    page.addEventListener('contextmenu', onContextMenu);
    window.addEventListener('blur', onBlur);
    return () => {
        onBlur();
        page.removeEventListener('pointerdown', onDown);
        page.removeEventListener('pointermove', onMove);
        page.removeEventListener('pointerup', onUp);
        page.removeEventListener('pointercancel', onUp);
        page.removeEventListener('click', onClick, true);
        page.removeEventListener('touchmove', onTouchMove);
        page.removeEventListener('contextmenu', onContextMenu);
        window.removeEventListener('blur', onBlur);
        delete page.dataset.arrangeBound;
    };
}
