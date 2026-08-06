export function createPhoneGenerationController({ state, getCtx, getStorageId, hideTyping }) {
    function syncGenerationControls() {
        const disabled = !!state.isGenerating;
        for (const button of document.querySelectorAll('.pm-submit-pending-btn')) {
            button.disabled = disabled || button.dataset.empty === 'true';
        }
        for (const button of document.querySelectorAll('.pm-generation-cancel')) {
            button.hidden = !disabled;
            button.disabled = !disabled;
        }
        const status = document.querySelector('.pm-control-generation-status');
        if (status) status.textContent = disabled ? 'AI 正在回复，暂存仍可继续编辑' : '';
    }

    function beginGeneration(storageId) {
        if (state.generationTask) return null;
        const id = storageId || getStorageId();
        const context = getCtx();
        if (!context || !id || id === 'sms_unknown__default') return null;
        const controller = new AbortController();
        const task = Object.freeze({
            id: ++state.generationSequence,
            hostEpoch: state.hostEpoch,
            storageId: id,
            context,
            controller,
            signal: controller.signal,
        });
        state.generationTask = task;
        state.isGenerating = true;
        syncGenerationControls();
        return task;
    }

    function isGenerationTaskActive(task) {
        return !!task && !task.signal.aborted && state.generationTask === task
            && state.hostEpoch === task.hostEpoch && getStorageId() === task.storageId;
    }

    function finishGeneration(task) {
        if (state.generationTask !== task) return false;
        state.generationTask = null;
        state.isGenerating = false;
        syncGenerationControls();
        return true;
    }

    function cancelGeneration() {
        if (!state.generationTask) return false;
        state.generationTask.controller.abort('generation-cancelled-by-user');
        hideTyping();
        return true;
    }

    function invalidateGeneration() {
        state.generationTask?.controller?.abort('generation-invalidated');
        state.hostEpoch += 1;
        state.generationTask = null;
        state.isGenerating = false;
        hideTyping();
        syncGenerationControls();
    }

    return { beginGeneration, isGenerationTaskActive, finishGeneration, cancelGeneration, invalidateGeneration, syncGenerationControls };
}
