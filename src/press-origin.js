// 记录最近一次指针按下的位置，区分「点击空白处」与「从面板里拖选后在外面松开」。
// 浏览器把后者的 click 派发给按下与松开位置的公共祖先，单看 click.target 会误判为点了空白。
// 页面级监听只注册一次（捕获阶段，不拦截事件），不持有窗口 DOM 以外的资源。
const TRACKER_KEY = Symbol.for('phone-mode.press-origin');

function tracker() {
    const doc = globalThis.document;
    if (!doc || typeof doc.addEventListener !== 'function') return null;
    let state = doc[TRACKER_KEY];
    if (!state) {
        state = { target: null };
        doc.addEventListener('pointerdown', event => { state.target = event.target || null; }, true);
        doc[TRACKER_KEY] = state;
    }
    return state;
}

export function installPressOriginTracker() {
    return Boolean(tracker());
}

// 键盘触发的 click（detail 为 0）与没有记录到按下的环境不做判断，保持原行为。
function pressTarget(event) {
    if (!event || !(Number(event.detail) > 0)) return undefined;
    const state = tracker();
    return state && state.target ? state.target : undefined;
}

// 遮罩自身被点击：按下与松开都在遮罩上才算。
export function isBackdropClick(event, backdrop) {
    if (!backdrop || event?.target !== backdrop) return false;
    const start = pressTarget(event);
    return start === undefined || start === backdrop;
}

// 外部点击：按下位置在 container 内（例如拖选文字后移出）时不算外部点击。
export function pressStartedInside(event, ...containers) {
    const start = pressTarget(event);
    if (start === undefined) return false;
    return containers.some(container => container && typeof container.contains === 'function' && container.contains(start));
}
