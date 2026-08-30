async function requireGalBubbleSync(syncGalBubble, enabled) {
    if (typeof syncGalBubble !== 'function') throw new Error('GAL 气泡正则同步接口不可用');
    const transaction = await syncGalBubble(enabled);
    if (!transaction || transaction.ok !== true) throw new Error('GAL 气泡正则同步失败');
    return transaction;
}

async function reloadGalBubbleChat(reloadCurrentChat, transaction) {
    if (transaction?.changed !== true) return true;
    if (typeof reloadCurrentChat !== 'function') return false;
    try {
        await reloadCurrentChat(transaction.context);
        return true;
    } catch (error) {
        console.warn('[phone-mode] GAL 气泡已更新，但当前聊天刷新失败', error?.message || error);
        return false;
    }
}

export function createBackupController({
    capture, apply, persist, complete, parseBackupData, runBackupTransaction,
    legacyBackupTheme, clearPluginData, requireInjectionSuccess,
    clearBidirectionalInjection, applyBidirectionalInjection,
    cancelCommunityGeneration, cancelCalendarTasks, reloadCalendarStore, syncGalBubble, reloadCurrentChat,
    reloadTodayTrendStore, invalidateInteractiveStore, closePhone, createEmptyState, afterApplyEmpty,
}) {
    const exportData = async () => {
        const snapshot = await capture();
        const data = {
            schemaVersion: 17, histories: snapshot.histories, config: snapshot.config,
            theme: legacyBackupTheme(snapshot.theme), profiles: snapshot.profiles,
            groupMeta: snapshot.groupMeta, pokeConfig: snapshot.pokeConfig,
            bidirectional: snapshot.bidirectional, injectionConfig: snapshot.injectionConfig,
            budgetConfig: snapshot.budgetConfig, emojis: snapshot.emojis,
            characterBehavior: snapshot.characterBehavior, worldBookConfig: snapshot.worldBookConfig,
            wordyLimit: snapshot.wordyLimit, galBubbleEnabled: snapshot.galBubbleEnabled, desktopBg: snapshot.desktopBg, bgGlobal: snapshot.bgGlobal,
            bgLocal: snapshot.bgLocal, interactiveScenes: snapshot.interactiveScenes,
            phoneUiState: snapshot.phoneUiState, ambientStatus: snapshot.ambientStatus,
            calendarStore: snapshot.calendarStore, calendarOccasions: snapshot.calendarOccasions,
            calendarHolidays: snapshot.calendarHolidays, calendarWeather: snapshot.calendarWeather,
            calendarCycles: snapshot.calendarCycles, calendarRecipes: snapshot.calendarRecipes,
            calendarOutfits: snapshot.calendarOutfits, todayTrend: snapshot.todayTrend,
            branchLineage: snapshot.branchLineage, userGeneration: snapshot.userGeneration, desktopIcons: snapshot.desktopIcons,
        };
        const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
        const link = document.createElement('a');
        link.href = url;
        link.download = `TianyinXiaojian_Backup_${new Date().getTime()}.json`;
        link.click();
        URL.revokeObjectURL(url);
        alert('备份已成功导出。');
    };

    const importData = input => {
        const file = input.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = async event => {
            let transactionError = null;
            let galRefreshFailed = false;
            try {
                const data = JSON.parse(event.target.result);
                if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('备份根节点必须是对象');
                await runBackupTransaction({
                    capture,
                    prepare: current => parseBackupData(data, current),
                    beforeApply: async reason => {
                        cancelCommunityGeneration?.(`backup-${reason}`);
                        cancelCalendarTasks?.(`backup-${reason}`);
                        await requireInjectionSuccess(() => clearBidirectionalInjection(), reason === 'apply' ? '导入前清理旧注入失败' : '回滚前清理注入失败');
                    },
                    apply: async (snapshot, imported) => {
                        const nextState = snapshot || imported;
                        const applied = await apply(nextState);
                        const transaction = await requireGalBubbleSync(syncGalBubble, applied.galBubbleEnabled === true);
                        if (!await reloadGalBubbleChat(reloadCurrentChat, transaction)) galRefreshFailed = true;
                        return applied;
                    },
                    persist,
                    complete,
                    afterPersist: async reason => requireInjectionSuccess(() => applyBidirectionalInjection(), reason === 'apply' ? '导入后的注入刷新失败' : '恢复原数据后的注入刷新失败'),
                });
            } catch (error) { transactionError = error; }
            if (transactionError) {
                const error = transactionError;
                if (error.backupPhase === 'rollback-failed') alert(`导入失败，原数据回滚也失败。请勿刷新，并立即导出当前内存备份。\n${error.message}`);
                else if (error.backupPhase === 'rolled-back') alert(`导入失败，原数据已恢复${galRefreshFailed ? '，但 GAL 气泡当前聊天刷新失败，请手动刷新当前聊天' : ''}。\n${error.message}`);
                else alert(`导入失败，未修改现有数据。\n${error.message}`);
                return;
            }
            alert(galRefreshFailed ? '数据导入成功，但 GAL 气泡当前聊天刷新失败，请手动刷新当前聊天。' : '数据导入成功，请重新打开界面生效。');
            document.getElementById('pm-overlay')?.remove();
            closePhone(true);
        };
        reader.readAsText(file);
        input.value = '';
    };


    const clearAllData = async () => {
        if (!confirm('将删除天音小笺的聊天、社区、设置、背景与恢复状态。此操作不会删除宿主或其他扩展数据。是否继续？')) return false;
        if (!confirm('最后确认：清理后只能通过之前导出的备份恢复。确定删除全部天音小笺数据？')) return false;
        const previous = await capture();
        cancelCommunityGeneration?.('plugin-data-clear');
        cancelCalendarTasks?.('plugin-data-clear');
        let galRefreshFailed = false;
        try {
            await requireInjectionSuccess(() => clearBidirectionalInjection(), '清理数据前移除旧注入失败');
            await clearPluginData({ afterClear: async () => {
                const emptyState = await apply(createEmptyState());
                afterApplyEmpty?.();
                const transaction = await requireGalBubbleSync(syncGalBubble, emptyState.galBubbleEnabled === true);
                if (!await reloadGalBubbleChat(reloadCurrentChat, transaction)) galRefreshFailed = true;
                reloadCalendarStore?.();
                reloadTodayTrendStore?.();
                invalidateInteractiveStore?.();
                await requireInjectionSuccess(() => clearBidirectionalInjection(), '应用空状态后清理注入失败');
            } });
            alert(galRefreshFailed ? '天音小笺数据已清理，但 GAL 气泡当前聊天刷新失败，请手动刷新当前聊天。' : '天音小笺数据已清理。');
            document.getElementById('pm-overlay')?.remove();
            closePhone(true);
            return true;
        } catch (error) {
            let rollbackError = error.rollbackError || null;
            try {
                const restored = await apply(previous);
                const transaction = await requireGalBubbleSync(syncGalBubble, restored.galBubbleEnabled === true);
                if (!await reloadGalBubbleChat(reloadCurrentChat, transaction)) galRefreshFailed = true;
                await persist(previous);
                reloadCalendarStore?.();
                reloadTodayTrendStore?.();
                await requireInjectionSuccess(() => applyBidirectionalInjection(), '恢复原数据后的注入刷新失败');
            } catch (failure) { rollbackError = failure; }
            if (rollbackError) alert(`清理失败，原数据回滚也失败。请勿刷新，并立即导出当前内存备份。\n${error.message}；${rollbackError.message}`);
            else alert(`清理失败，原数据已恢复${galRefreshFailed ? '，但 GAL 气泡当前聊天刷新失败，请手动刷新当前聊天' : ''}。\n${error.message}`);
            return false;
        }
    };

    return { exportData, importData, clearAllData };
}
