export function createGalBubbleController({ getContext, reconcile, saveEnabled }) {
    const sync = enabled => {
        const context = getContext?.();
        if (!context) throw new Error('当前酒馆上下文不可用，无法修改 GAL 气泡正则');
        reconcile(context, enabled);
    };

    const toggle = () => {
        const previous = window.__pmGalBubbleEnabled === true;
        const next = !previous;
        try {
            sync(next);
        } catch (error) {
            alert(error.message);
            return false;
        }
        window.__pmGalBubbleEnabled = next;
        try {
            if (!saveEnabled()) throw new Error('GAL 气泡开关保存失败：浏览器存储不可用。');
        } catch (error) {
            window.__pmGalBubbleEnabled = previous;
            try {
                sync(previous);
            } catch (rollbackError) {
                alert(`${error.message}；正则状态回滚失败：${rollbackError.message}`);
                return false;
            }
            alert(error.message);
            return false;
        }
        const element = document.getElementById('pm-gal-bubble-check');
        if (element) {
            element.classList.toggle('is-checked', next);
            element.setAttribute('aria-checked', String(next));
        }
        return true;
    };
    return { toggle, sync };
}
