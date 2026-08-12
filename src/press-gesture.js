export function bindPressGesture(element, options) {
    const {
        delay = 550,
        moveThreshold = 10,
        onPress,
        onHold,
        setTimer = setTimeout,
        clearTimer = clearTimeout,
        eventTarget = globalThis.window,
        shouldStart = () => true,
        shouldCapturePointer = () => true,
        allowNativeClick = false,
        clickCapture = false,
        shouldPreventContextMenu = () => true,
    } = options;
    let timer = null;
    let activePointerId = null;
    let capturedPointerId = null;
    let suppressNextClick = false;
    let startX = 0;
    let startY = 0;

    const clearActiveTimer = () => {
        if (timer !== null) clearTimer(timer);
        timer = null;
    };
    const releaseCapturedPointer = pointerId => {
        if (capturedPointerId === null || capturedPointerId !== pointerId) return;
        capturedPointerId = null;
        try { element.releasePointerCapture?.(pointerId); } catch (error) {}
    };
    const resetPointer = () => {
        clearActiveTimer();
        const pointerId = activePointerId;
        activePointerId = null;
        releaseCapturedPointer(pointerId);
    };
    const isActivePointer = event => (
        activePointerId !== null
        && (event?.pointerId === undefined || event.pointerId === activePointerId)
    );
    const cancelPointer = event => {
        if (!isActivePointer(event)) return;
        resetPointer();
    };
    const releasePointer = event => {
        if (!isActivePointer(event)) return;
        const isShortPress = timer !== null;
        resetPointer();
        if (isShortPress) onPress?.();
    };
    const onPointerDown = event => {
        if (event.button !== 0 || element.disabled) return;
        if (activePointerId === null) suppressNextClick = false;
        if (activePointerId !== null || !shouldStart(event)) return;
        activePointerId = event.pointerId;
        startX = Number(event.clientX) || 0;
        startY = Number(event.clientY) || 0;
        if (shouldCapturePointer(event) && typeof element.setPointerCapture === 'function') {
            try {
                element.setPointerCapture(event.pointerId);
                capturedPointerId = event.pointerId;
            } catch (error) {}
        }
        timer = setTimer(() => {
            timer = null;
            const handled = onHold?.();
            if (allowNativeClick && handled !== false) suppressNextClick = true;
        }, delay);
    };
    const onPointerMove = event => {
        if (!isActivePointer(event) || timer === null) return;
        const deltaX = (Number(event.clientX) || 0) - startX;
        const deltaY = (Number(event.clientY) || 0) - startY;
        if (Math.hypot(deltaX, deltaY) > moveThreshold) cancelPointer(event);
    };
    const onClick = event => {
        if (allowNativeClick) {
            if (Number(event?.detail) === 0) return;
            if (!suppressNextClick) return;
            suppressNextClick = false;
            event.preventDefault?.();
            event.stopPropagation?.();
            return;
        }
        const isKeyboardOrProgrammatic = Number(event?.detail) === 0;
        if (!isKeyboardOrProgrammatic) {
            event.preventDefault?.();
            event.stopPropagation?.();
            return;
        }
        onPress?.();
    };
    const onContextMenu = event => { if (suppressNextClick || shouldPreventContextMenu(event)) event.preventDefault?.(); };
    const onWindowBlur = () => {
        resetPointer();
        suppressNextClick = false;
    };

    element.addEventListener('pointerdown', onPointerDown);
    element.addEventListener('pointermove', onPointerMove);
    element.addEventListener('pointerup', releasePointer);
    element.addEventListener('pointercancel', cancelPointer);
    element.addEventListener('lostpointercapture', cancelPointer);
    element.addEventListener('click', onClick, clickCapture);
    element.addEventListener('contextmenu', onContextMenu);
    eventTarget?.addEventListener('blur', onWindowBlur);

    return () => {
        resetPointer();
        element.removeEventListener('pointerdown', onPointerDown);
        element.removeEventListener('pointermove', onPointerMove);
        element.removeEventListener('pointerup', releasePointer);
        element.removeEventListener('pointercancel', cancelPointer);
        element.removeEventListener('lostpointercapture', cancelPointer);
        element.removeEventListener('click', onClick, clickCapture);
        element.removeEventListener('contextmenu', onContextMenu);
        eventTarget?.removeEventListener('blur', onWindowBlur);
    };
}
