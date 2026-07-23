import { generationErrorMessage } from './ai.js';
import { formatCalendarDate, parseCalendarDate } from './calendar-model.js';
import {
    buildRecipePrompts, deleteRecipeMeal, mergeGeneratedRecipe, parseRecipeAiResponse, replaceRecipeInWindow,
    recipeDayFor, setRecipeRegionPreference, upsertRecipeMeal,
} from './calendar-recipe-model.js';
import { renderRecipeMealDialog } from './calendar-view.js';

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

    async function generate(storageId = getStorageId(), { replaceWindow = false, startDate = null } = {}) {
        const referenceDate = getReferenceDate(storageId);
        const selectedDate = replaceWindow ? getView(storageId).selectedDate : '';
        const start = startDate || (selectedDate ? parseCalendarDate(selectedDate) : referenceDate);
        if (!start) throw new Error('重新生成菜谱的选中日期无效');
        if (replaceWindow) {
            if (formatCalendarDate(start) < formatCalendarDate(referenceDate)) {
                status(storageId, '不能重新生成故事今天之前的菜谱。');
                rerender(storageId);
                return false;
            }
            if (typeof confirmImpl !== 'function'
                || !confirmImpl(`重新生成 ${formatCalendarDate(start)} 起未来七日菜谱？这会覆盖窗口内所有餐食。`)) return false;
        }
        const task = tasks.begin(storageId, 'recipe-generate', { replace: false, mode: 'recipe-generate' });
        if (!task) throw new Error('当前会话已有菜谱生成任务，或会话不可用');
        const view = getView(storageId);
        const previousStatus = view.recipeGenerationTask ? view.recipeGenerationPreviousStatus : getStatus(storageId);
        setRecipeBusy(storageId, task, previousStatus);
        status(storageId, replaceWindow ? '正在重新生成未来七日菜谱…' : '正在生成未来七日菜谱…', { persistent: true });
        rerender(storageId);
        let statusSettled = false;
        try {
            const context = await gatherContext();
            if (!tasks.active(task)) return false;
            const requestedScope = getRecipeScope(storageId);
            const requestedRegion = requestedScope.regionPreference;
            const requestedGenerationRule = requestedScope.generationRule;
            const prompts = buildRecipePrompts(context, requestedScope, start);
            const raw = await callAI(prompts.systemPrompt, prompts.userPrompt, {
                isolated: true, signal: task.signal,
            });
            if (!tasks.active(task)) return false;
            const generated = parseRecipeAiResponse(raw, { start, expectedRegion: requestedRegion });
            const committed = await commitRecipe(storageId, current => {
                if (current.regionPreference !== requestedRegion) {
                    throw new Error('饮食地区已在生成期间改变，请重新生成菜谱');
                }
                if (current.generationRule !== requestedGenerationRule) {
                    throw new Error('菜谱生成规则已在生成期间改变，请重新生成菜谱');
                }
                return replaceWindow
                    ? replaceRecipeInWindow(current, generated, { start, now: Date.now() })
                    : mergeGeneratedRecipe(current, generated, { start, now: Date.now() });
            }, task);
            if (!committed || !tasks.active(task)) return false;
            status(storageId, `七日菜谱已${replaceWindow ? '重新生成' : '生成'} · ${generated.appliedRegion}`);
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
        if (!selectedType) throw new Error('这一天的四个餐次都已有内容，请使用餐食右侧的编辑按钮');
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

    async function handleAction(button, app, storageId = getStorageId()) {
        const action = button?.dataset?.action;
        if (action === 'calendar-recipe-generate') {
            await generate(storageId);
            return true;
        }
        if (action === 'calendar-recipe-regenerate') {
            await generate(storageId, { replaceWindow: true });
            return true;
        }
        if (action === 'calendar-recipe-region-save') {
            const value = app?.querySelector('[data-recipe-region]')?.value || '';
            await commitRecipe(storageId, current => setRecipeRegionPreference(current, value));
            status(storageId, value.trim() ? '饮食地区已保存。' : '已改为按剧情推断饮食地区。');
            rerender(storageId);
            return true;
        }
        if (action === 'calendar-recipe-generation-rule-save') {
            const value = app?.querySelector('[data-recipe-generation-rule]')?.value || '';
            if (!value.trim()) throw new Error('菜谱生成规则不能为空');
            if (value.length > 3000) throw new Error('菜谱生成规则不能超过 3000 个字符');
            await commitRecipe(storageId, current => ({
                ...current,
                generationRule: value,
            }), null, { refreshInjection: false });
            status(storageId, '菜谱生成规则已保存。');
            rerender(storageId);
            return true;
        }
        if (action === 'calendar-recipe-edit') {
            const mealType = button.dataset.mealType || '';
            showMealEditor(storageId, mealType, true);
            return true;
        }
        if (action === 'calendar-recipe-delete') {
            const date = getView(storageId).selectedDate;
            const mealType = button.dataset.mealType || '';
            const meal = recipeDayFor(getRecipeScope(storageId), date)[mealType];
            if (!meal || !confirmImpl?.(`删除这份餐食“${meal.text}”？`)) return true;
            await commitRecipe(storageId, current => deleteRecipeMeal(current, date, mealType).scope);
            status(storageId, '餐食已删除。');
            rerender(storageId);
            return true;
        }
        if (action === 'calendar-recipe-add') {
            showMealEditor(storageId);
            return true;
        }
        return false;
    }

    return { generate, handleAction, showMealEditor };
}
