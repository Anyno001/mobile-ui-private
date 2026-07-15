export function createHistoryWindow(history, limit) {
    const source = Array.isArray(history) ? history : [];
    const size = Number.isInteger(limit) && limit > 0 ? limit : source.length;
    const trimmedCount = Math.max(0, source.length - size);
    return {
        history: source.slice(trimmedCount),
        trimmedCount,
        toWindowIndex(sourceIndex) {
            if (!Number.isInteger(sourceIndex)) return null;
            const index = sourceIndex - trimmedCount;
            return index >= 0 && index < Math.min(source.length, size) ? index : null;
        },
    };
}
