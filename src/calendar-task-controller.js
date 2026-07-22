export function createTaskController(getStorageId) {
    let epoch = 0, sequence = 0;
    const tasks = new Map();
    const slotFor = (storageId, category) => ['generate', 'recipe-generate'].includes(category)
        ? `${category}\0${storageId}` : category;
    const begin = (storageId, category, { replace = true, mode = category, parentSignal } = {}) => {
        if (!storageId || storageId === 'sms_unknown__default' || getStorageId() !== storageId) return null;
        const slot = slotFor(storageId, category);
        const previous = tasks.get(slot);
        if (previous && !replace) return null;
        previous?.controller.abort('superseded');
        const controller = new AbortController();
        const abortFromParent = () => controller.abort(parentSignal?.reason || 'parent-cancelled');
        if (parentSignal?.aborted) abortFromParent();
        else parentSignal?.addEventListener?.('abort', abortFromParent, { once: true });
        const task = Object.freeze({
            id: ++sequence, epoch, storageId, category, mode, slot, controller, signal: controller.signal,
            detachParent: () => parentSignal?.removeEventListener?.('abort', abortFromParent),
        });
        tasks.set(slot, task);
        return task;
    };
    const active = task => !!task && !task.signal.aborted && task.epoch === epoch
        && tasks.get(task.slot) === task && getStorageId() === task.storageId;
    const finish = task => {
        if (tasks.get(task?.slot) !== task) return false;
        tasks.delete(task.slot);
        task.detachParent?.();
        return true;
    };
    const cancel = reason => {
        epoch += 1;
        for (const task of tasks.values()) {
            task.controller.abort(reason);
            task.detachParent?.();
        }
        tasks.clear();
        return reason;
    };
    return { active, begin, cancel, finish };
}
