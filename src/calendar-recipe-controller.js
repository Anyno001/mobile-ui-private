import { generationErrorMessage } from './ai.js';
import {
    buildRecipePrompts, deleteRecipeMeal, mergeGeneratedRecipe, parseRecipeAiResponse,
    recipeDayFor, setRecipeRegionPreference, upsertRecipeMeal,
} from './calendar-recipe-model.js';
import { renderRecipeMealDialog, renderRecipeMealManager } from './calendar-view.js';

export function createCalendarRecipeController({
    tasks, getStorageId, gatherContext, callAI, makeOverlay, closeOverlay, commitRecipe,
    getRecipeScope, getReferenceDate, getView, setView, getStatus, status, rerender,
    confirmImpl = globalThis.confirm,
}) {
    const setRecipeBusy = (storageId, task, previousStatus) => {
        const view = getView(storageId);
        setView(storageId, {
            ...view, recipeGenerating: true, recipeGenerationTask: task,
            recipeGenerationPreviousStatus: previousStatus,
        });
    };

    async function generate(storageId = getStorageId()) {
        const task = tasks.begin(storageId, 'recipe-generate', { replace: false, mode: 'recipe-generate' });
        if (!task) throw new Error('当前会话已有菜谱生成任务，或会话不可用');
        const view = getView(storageId);
        const previousStatus = view.recipeGenerationTask ? view.recipeGenerationPreviousStatus : getStatus(storageId);
        setRecipeBusy(storageId, task, previousStatus);
        status(storageId, '正在生成未来七日菜谱…', { persistent: true });
        rerender(storageId);
        let statusSettled = false;
        try {
            const context = await gatherContext();
            if (!tasks.active(task)) return false;
            const start = getReferenceDate(storageId);
            const requestedRegion = getRecipeScope(storageId).regionPreference;
            const prompts = buildRecipePrompts(context, getRecipeScope(storageId), start);
            const raw = await callAI(prompts.systemPrompt, prompts.userPrompt, {
                isolated: true, signal: task.signal,
            });
            if (!tasks.active(task)) return false;
            const generated = parseRecipeAiResponse(raw, { start, expectedRegion: requestedRegion });
            const committed = await commitRecipe(storageId, current => {
                if (current.regionPreference !== requestedRegion) {
                    throw new Error('饮食地区已在生成期间改变，请重新生成菜谱');
                }
                return mergeGeneratedRecipe(current, generated, { start, now: Date.now() });
            }, task);
            if (!committed || !tasks.active(task)) return false;
            status(storageId, `七日菜谱已生成 · ${generated.appliedRegion}`);
            statusSettled = true;
            rerender(storageId);
            return true;
        } catch (error) {
            if (error?.recipeRollbackError) throw error;
            if (!tasks.active(task)) return false;
            status(storageId, `菜谱生成失败：${generationErrorMessage(error)}`, { duration: 10000 });
            statusSettled = true;
            throw error;
        } finally {
            tasks.finish(task);
            const latest = getView(storageId);
            if (latest.recipeGenerationTask === task) {
                if (!statusSettled) status(storageId, previousStatus);
                setView(storageId, {
                    ...latest, recipeGenerating: false, recipeGenerationTask: null,
                    recipeGenerationPreviousStatus: '',
                });
                rerender(storageId);
            }
        }
    }


    function showMealEditor(storageId, mealType = '', editing = false) {
        if (typeof makeOverlay !== 'function') throw new Error('菜谱编辑器不可用');
        const date = getView(storageId).selectedDate;
        const day = recipeDayFor(getRecipeScope(storageId), date);
        const selectedType = mealType || ['breakfast', 'lunch', 'dinner', 'snack'].find(type => !day[type]);
        if (!selectedType) throw new Error('这一天的四个餐次都已有内容，请从管理列表中编辑');
        const existing = editing ? day[selectedType] || null : null;
        if (editing && !existing) throw new Error('要编辑的餐食不存在或已被移除');
        const overlay = makeOverlay(renderRecipeMealDialog(date, selectedType, existing));
        const form = overlay.querySelector('[data-recipe-entry-form]');
        const errorNode = overlay.querySelector('[data-recipe-entry-error]');
        overlay.querySelector('[data-recipe-entry-close]')?.addEventListener('click', () => closeOverlay?.('close'));
        form?.addEventListener('submit', async event => {
            event.preventDefault();
            try {
                const nextType = form.elements.mealType?.value || 'breakfast';
                const text = form.elements.text?.value || '';
                await commitRecipe(storageId, current => {
                    let next = current;
                    const currentDay = recipeDayFor(current, date);
                    if (nextType !== selectedType && currentDay[nextType]) {
                        throw new Error('目标餐次已有内容，请先编辑或移除原餐食');
                    }
                    if (existing && nextType !== selectedType) next = deleteRecipeMeal(next, date, selectedType).scope;
                    return upsertRecipeMeal(next, { date, mealType: nextType, text, source: 'manual' });
                });
                status(storageId, existing ? '餐食已更新。' : '餐食已添加。');
                closeOverlay?.('saved');
                rerender(storageId);
            } catch (error) {
                if (errorNode) errorNode.textContent = error?.message || '餐食更新失败';
            }
        });
        form?.elements.text?.focus?.({ preventScroll: true });
    }

    function showMealManager(storageId) {
        if (typeof makeOverlay !== 'function') throw new Error('菜谱管理器不可用');
        const date = getView(storageId).selectedDate;
        const overlay = makeOverlay(renderRecipeMealManager(date, getRecipeScope(storageId)));
        overlay.querySelector('[data-recipe-entry-close]')?.addEventListener('click', () => closeOverlay?.('close'));
        overlay.querySelector('[data-recipe-entry-add]')?.addEventListener('click', () => {
            closeOverlay?.('add');
            showMealEditor(storageId);
        });
        for (const button of overlay.querySelectorAll('[data-recipe-entry-edit]')) {
            button.addEventListener('click', () => {
                closeOverlay?.('edit');
                showMealEditor(storageId, button.dataset.mealType, true);
            });
        }
        for (const button of overlay.querySelectorAll('[data-recipe-entry-remove]')) {
            button.addEventListener('click', async () => {
                const mealType = button.dataset.mealType;
                const meal = recipeDayFor(getRecipeScope(storageId), date)[mealType];
                if (!meal || !confirmImpl?.(`移除这份餐食“${meal.text}”？`)) return;
                await commitRecipe(storageId, current => deleteRecipeMeal(current, date, mealType).scope);
                status(storageId, '餐食已移除。');
                closeOverlay?.('removed');
                rerender(storageId);
            });
        }
    }

    async function handleAction(button, app, storageId = getStorageId()) {
        const action = button?.dataset?.action;
        if (action === 'calendar-recipe-generate') {
            await generate(storageId);
            return true;
        }
        if (action === 'calendar-recipe-region-save') {
            const value = app?.querySelector('[data-recipe-region]')?.value || '';
            await commitRecipe(storageId, current => setRecipeRegionPreference(current, value));
            status(storageId, value.trim() ? '饮食地区已保存。' : '已改为按剧情推断饮食地区。');
            rerender(storageId);
            return true;
        }
        if (action === 'calendar-recipe-add') {
            showMealEditor(storageId);
            return true;
        }
        if (action === 'calendar-recipe-manage') {
            showMealManager(storageId);
            return true;
        }
        return false;
    }

    return { generate, handleAction, showMealEditor, showMealManager };
}
