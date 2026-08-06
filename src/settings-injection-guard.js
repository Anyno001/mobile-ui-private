export function createInjectionResultGuard() {
    const failureFor = (result, phase) => {
        const failedWrites = Number.isInteger(result?.failedWrites) && result.failedWrites > 0 ? result.failedWrites : 0;
        const failedKeys = Array.isArray(result?.failedKeys) ? result.failedKeys : [];
        if (!failedWrites && !failedKeys.length) return null;
        const details = [failedWrites ? `${failedWrites} 项写入失败` : '', failedKeys.length ? `${failedKeys.length} 项清理失败` : '']
            .filter(Boolean).join('，');
        const error = new Error(`${phase}：${details}`);
        error.injectionResult = result;
        return error;
    };
    return async (operation, phase) => {
        const result = await operation();
        const error = failureFor(result, phase);
        if (error) throw error;
        return result;
    };
}
