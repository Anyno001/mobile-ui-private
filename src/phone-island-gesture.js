export function bindIsland(el, handle, {
    setTimer = globalThis.setTimeout,
    clearTimer = globalThis.clearTimeout,
    doubleTapDelay = 300,
} = {}) {
    let active = true;
    let isDragging = false, startX, startY, startTX = 0, startTY = 0;
    let moved = false, secondTap = false, tapTimer = null;
    const getCoord = e => e.touches
        ? { x: e.touches[0].clientX, y: e.touches[0].clientY }
        : { x: e.clientX, y: e.clientY };
    const getT = () => {
        const match = (el.style.transform || '').match(/translate\(\s*([-\d.]+)px\s*,\s*([-\d.]+)px/);
        return match ? { x: parseFloat(match[1]), y: parseFloat(match[2]) } : { x: 0, y: 0 };
    };
    const onStart = e => {
        if (e.target.tagName === 'BUTTON') return;
        secondTap = el.classList.contains('is-min') && tapTimer !== null;
        if (secondTap) {
            clearTimer(tapTimer);
            tapTimer = null;
        }
        isDragging = true;
        moved = false;
        const coords = getCoord(e);
        startX = coords.x;
        startY = coords.y;
        const translation = getT();
        startTX = translation.x;
        startTY = translation.y;
        el.style.transition = 'none';
        if (e.cancelable) e.preventDefault();
    };
    const onMove = e => {
        if (!isDragging) return;
        const coords = getCoord(e), dx = coords.x - startX, dy = coords.y - startY;
        if (!moved && Math.abs(dx) < 5 && Math.abs(dy) < 5) return;
        moved = true;
        secondTap = false;
        if (e.cancelable) e.preventDefault();
        el.style.setProperty('transform', `translate(${startTX + dx}px, ${startTY + dy}px)`, 'important');
    };
    const cancelGesture = ({ clearPendingTap = false } = {}) => {
        isDragging = false;
        moved = false;
        secondTap = false;
        el.style.transition = '.35s cubic-bezier(.18,.89,.32,1.2)';
        if (clearPendingTap && tapTimer !== null) {
            clearTimer(tapTimer);
            tapTimer = null;
        }
    };
    const cancelAll = () => cancelGesture({ clearPendingTap: true });
    const onEnd = () => {
        if (!isDragging) return;
        isDragging = false;
        el.style.transition = '.35s cubic-bezier(.18,.89,.32,1.2)';
        if (moved) return;
        if (!el.classList.contains('is-min')) return window.__pmToggleMin();
        if (secondTap) {
            secondTap = false;
            window.__pmEnd();
            return;
        }
        tapTimer = setTimer(() => {
            tapTimer = null;
            if (active && el.classList.contains('is-min')) window.__pmToggleMin();
        }, doubleTapDelay);
    };
    handle.addEventListener('mousedown', onStart);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onEnd);
    handle.addEventListener('touchstart', onStart, { passive: false });
    window.addEventListener('touchmove', onMove, { passive: false });
    window.addEventListener('touchend', onEnd);
    window.addEventListener('touchcancel', cancelAll);
    window.addEventListener('blur', cancelAll);
    return () => {
        active = false;
        cancelGesture({ clearPendingTap: true });
        handle.removeEventListener('mousedown', onStart);
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onEnd);
        handle.removeEventListener('touchstart', onStart);
        window.removeEventListener('touchmove', onMove);
        window.removeEventListener('touchend', onEnd);
        window.removeEventListener('touchcancel', cancelAll);
        window.removeEventListener('blur', cancelAll);
    };
}
