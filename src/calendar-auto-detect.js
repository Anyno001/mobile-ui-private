// 开启自动跟随但尚未设定故事日期或钟点时，打开日历即从正文识别一次，无需手动点「保存并识别」。
export function createCalendarAutoDetect({ getScope, tasks, scanContext }) {
    const attempted = new Set();
    return {
        run(storageId) {
            const current = getScope(storageId);
            if (!current.autoAdjust || (current.baseDate && current.baseTime) || current.baseDateManual || attempted.has(storageId)) return false;
            const task = tasks.begin(storageId, 'scan-context', { replace: false, mode: 'auto-detect' });
            if (!task) return false;
            attempted.add(storageId);
            Promise.resolve(scanContext(storageId, { silent: true, task }))
                .catch(error => console.warn('[phone-mode] 日历自动识别失败', error))
                .finally(() => tasks.finish(task));
            return true;
        },
        reset() { attempted.clear(); },
    };
}
