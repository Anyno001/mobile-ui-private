export function createGalBubbleController({ getContext, reconcile, saveEnabled, reloadCurrentChat }) {
    let pendingToggle = null;
    const requireHostSave = async context => {
        if (typeof context?.saveSettingsDebounced !== 'function') throw new Error('当前酒馆未提供设置保存接口');
        const result = context.saveSettingsDebounced();
        if (result && typeof result.then === 'function') await result;
        if (result === false) throw new Error('当前酒馆设置保存接口调用失败');
    };
    const captureHostRegexState = context => {
        const list = context?.extensionSettings?.regex;
        if (!Array.isArray(list)) return null;
        return list.map(script => ({ script, snapshot: { ...script } }));
    };
    const restoreHostRegexState = async (context, captured) => {
        const list = context?.extensionSettings?.regex;
        if (!Array.isArray(list) || !captured) return;
        list.splice(0, list.length, ...captured.map(entry => entry.script));
        for (const { script, snapshot } of captured) {
            for (const key of Object.keys(script)) if (!Object.hasOwn(snapshot, key)) delete script[key];
            Object.assign(script, snapshot);
        }
        await requireHostSave(context);
    };
    const sync = async enabled => {
        const context = getContext?.();
        if (!context) throw new Error('当前酒馆上下文不可用，无法修改 GAL 气泡正则');
        const result = await reconcile(context, enabled);
        window.__pmGalBubbleOperational = enabled === true;
        return { context, result };
    };

    const toggle = async () => {
        if (pendingToggle) return pendingToggle;
        pendingToggle = (async () => {
            const previous = window.__pmGalBubbleEnabled === true;
            const next = !previous;
            const hostSnapshot = captureHostRegexState(getContext?.());
            let transaction;
            try {
                transaction = await sync(next);
            } catch (error) {
                alert(error.message);
                return false;
            }
            window.__pmGalBubbleEnabled = next;
            try {
                if (!saveEnabled()) throw new Error('GAL 气泡开关保存失败：浏览器存储不可用。');
            } catch (error) {
                window.__pmGalBubbleEnabled = previous;
                window.__pmGalBubbleOperational = previous;
                try {
                    await restoreHostRegexState(getContext?.(), hostSnapshot);
                } catch (rollbackError) {
                    alert(`${error.message}；正则状态回滚失败：${rollbackError.message}`);
                    return false;
                }
                alert(error.message);
                return false;
            }
            if (transaction.result?.changed && typeof reloadCurrentChat === 'function') {
                try {
                    await reloadCurrentChat(transaction.context);
                } catch (error) {
                    console.warn('[phone-mode] GAL 气泡已更新，但当前聊天刷新失败', error?.name || 'Error');
                    alert('GAL 气泡已更新，但当前聊天刷新失败，请手动刷新当前聊天。');
                }
            }
            const element = document.getElementById('pm-gal-bubble-check');
            if (element) {
                element.classList.toggle('is-checked', next);
                element.setAttribute('aria-checked', String(next));
            }
            return true;
        })();
        try { return await pendingToggle; }
        finally { pendingToggle = null; }
    };
    return { toggle, sync };
}
