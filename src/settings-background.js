export async function runBackgroundTransaction({ capture, mutate, restore, persist }) {
    const snapshot = capture();
    try {
        mutate();
        return await persist();
    } catch (error) {
        restore(snapshot);
        try {
            await persist();
        } catch (rollbackError) {
            const combined = new Error(`${error.message}；原背景回滚失败：${rollbackError.message}`);
            combined.cause = error;
            combined.rollbackError = rollbackError;
            throw combined;
        }
        throw error;
    }
}

export function createBackgroundSettings({
    applyBackground, getCurrentPersona, getStorageId, loadBgSettings,
    clone, openCropper, saveBgGlobal, saveBgLocal,
    saveDesktopBg, showLook,
}) {
    let backgroundMutation = Promise.resolve();

    const queueMutation = (scope, mutate) => {
        const isDesktop = scope === 'desktop';
        const isGlobal = scope === 'global';
        const operation = backgroundMutation.catch(() => {}).then(async () => {
            const persisted = await runBackgroundTransaction({
                capture: () => isDesktop ? (window.__pmDesktopBg || '')
                    : isGlobal ? (window.__pmBgGlobal || '') : clone(window.__pmBgLocal || {}),
                mutate,
                restore: snapshot => {
                    if (isDesktop) window.__pmDesktopBg = snapshot;
                    else if (isGlobal) window.__pmBgGlobal = snapshot;
                    else window.__pmBgLocal = clone(snapshot);
                },
                persist: isDesktop ? saveDesktopBg : isGlobal ? saveBgGlobal : saveBgLocal,
            });
            if (!isDesktop && !isGlobal) window.__pmBgLocal = persisted;
            applyBackground();
            showLook();
        });
        backgroundMutation = operation;
        return operation.catch(error => {
            applyBackground();
            alert(error.rollbackError
                ? `背景操作失败，原背景回滚也失败。请勿刷新，并立即导出备份。\n${error.message}`
                : `背景操作失败，原背景已恢复。\n${error.message}`);
            showLook();
            return false;
        });
    };

    return {
        async load() { await loadBgSettings(); },
        upload(input, scope) {
            const file = input.files?.[0];
            if (!file) return;
            const objectUrl = URL.createObjectURL(file);
            try {
                const key = `${getStorageId()}_${getCurrentPersona()}`;
                openCropper(objectUrl, {
                    objectUrl,
                    onCancel: showLook,
                    onConfirm: croppedDataUrl => queueMutation(scope, () => {
                        if (scope === 'desktop') window.__pmDesktopBg = croppedDataUrl;
                        else if (scope === 'global') window.__pmBgGlobal = croppedDataUrl;
                        else window.__pmBgLocal[key] = croppedDataUrl;
                    }),
                });
            } catch (error) {
                URL.revokeObjectURL(objectUrl);
                alert(`图片读取失败：${error.message}`);
            };
            input.value = '';
        },
        setUrl(scope) {
            const url = prompt('输入图片 URL：');
            if (!url?.trim()) return;
            const key = `${getStorageId()}_${getCurrentPersona()}`;
            return queueMutation(scope, () => {
                if (scope === 'desktop') window.__pmDesktopBg = url.trim();
                else if (scope === 'global') window.__pmBgGlobal = url.trim();
                else window.__pmBgLocal[key] = url.trim();
            });
        },
        clear(scope) {
            const key = `${getStorageId()}_${getCurrentPersona()}`;
            return queueMutation(scope, () => {
                if (scope === 'desktop') window.__pmDesktopBg = '';
                else if (scope === 'global') window.__pmBgGlobal = '';
                else delete window.__pmBgLocal[key];
            });
        },
    };
}
