import { generationErrorMessage } from './ai.js';
import { calendarWindowDescription, formatCalendarDate, parseCalendarDate } from './calendar-model.js';
import { buildOutfitPrompts, deleteOutfit, outfitForDate, outfitScopeFor, parseOutfitAiResponse, replaceOutfitsInWindow, updateOutfitProfile, upsertOutfit } from './calendar-outfit-model.js';
import { renderOutfitDialog } from './calendar-view.js';

export function createCalendarOutfitController({ tasks, getStorageId, gatherContext, callAI, makeOverlay, closeOverlay, commitOutfits, getOutfitStore, getProfile, getReferenceDate, getView, setView, getStatus, status, rerender, confirmImpl = globalThis.confirm }) {
    const setBusy = (storageId, task, previousStatus) => setView(storageId, { ...getView(storageId), outfitGenerating: true, outfitGenerationTask: task, outfitGenerationPreviousStatus: previousStatus });
    async function generate(storageId = getStorageId(), { replaceWindow = false } = {}) {
        const reference = getReferenceDate(storageId), selected = replaceWindow ? getView(storageId).selectedDate : '';
        const start = selected ? parseCalendarDate(selected) : reference;
        if (!start) throw new Error('重新生成穿搭的选中日期无效');
        const days = replaceWindow ? 1 : 7, window = calendarWindowDescription(start, days), subject = getView(storageId).outfitSubject;
        if (replaceWindow && formatCalendarDate(start) < formatCalendarDate(reference)) { status(storageId, '不能重新生成故事今天之前的穿搭。'); rerender(storageId); return false; }
        const profile = getProfile(storageId, subject);
        const existing = window.dates.map(date => profile.days[date]).filter(Boolean);
        const hasExistingAi = existing.some(outfit => outfit.source === 'ai');
        if (hasExistingAi && (typeof confirmImpl !== 'function'
            || !confirmImpl(`${window.label}已有 AI 生成的穿搭，重新生成将覆盖这些内容；手动记录会保留。是否继续？`))) return false;
        const snapshot = JSON.stringify(window.dates.map(date => [date, profile.days[date] || null]));
        const task = tasks.begin(storageId, 'outfit-generate', { replace: false, mode: replaceWindow ? 'outfit-regenerate' : 'outfit-generate' });
        if (!task) throw new Error('当前会话已有穿搭生成任务，或会话不可用');
        const previousStatus = getView(storageId).outfitGenerationTask ? getView(storageId).outfitGenerationPreviousStatus : getStatus(storageId);
        setBusy(storageId, task, previousStatus); status(storageId, `正在${replaceWindow ? '重新' : ''}生成${window.label} OOTD…`, { persistent: true }); rerender(storageId);
        let settled = false;
        try {
            const context = await gatherContext(null, { module: 'outfit', signal: task.signal, worldBookMaxChars: 3500 });
            if (!tasks.active(task)) return false;
            const requested = getProfile(storageId, subject), prompts = buildOutfitPrompts(context, requested, start, { days, subject });
            const generated = parseOutfitAiResponse(await callAI(prompts.systemPrompt, prompts.userPrompt, { isolated: true, signal: task.signal }), { start, days });
            const committed = await commitOutfits(storageId, store => {
                const current = outfitScopeFor(store, storageId, subject);
                if (JSON.stringify(window.dates.map(date => [date, current.days[date] || null])) !== snapshot) throw new Error('待覆盖穿搭已在生成期间改变，请重新确认后生成');
                return updateOutfitProfile(store, storageId, subject, value => replaceOutfitsInWindow(value, generated, { start, now: Date.now(), days }));
            }, task);
            if (!committed || !tasks.active(task)) return false;
            status(storageId, `${window.label} OOTD 已${replaceWindow ? '重新生成' : '生成'}。`); settled = true; rerender(storageId); return true;
        } catch (error) { if (error?.outfitRollbackError) throw error; if (!tasks.active(task)) return false; status(storageId, `穿搭生成失败：${generationErrorMessage(error)}`, { duration: 10000 }); settled = true; throw error; }
        finally { tasks.finish(task); const view = getView(storageId); if (view.outfitGenerationTask === task) { if (!settled) status(storageId, previousStatus); setView(storageId, { ...view, outfitGenerating: false, outfitGenerationTask: null, outfitGenerationPreviousStatus: '' }); rerender(storageId); } }
    }
    function showEditor(storageId) {
        if (typeof makeOverlay !== 'function') throw new Error('穿搭编辑器不可用');
        const subject = getView(storageId).outfitSubject, date = getView(storageId).selectedDate, existing = outfitForDate(getProfile(storageId, subject), date);
        const overlay = makeOverlay(renderOutfitDialog(date, existing)), form = overlay.querySelector('[data-outfit-entry-form]'), errorNode = overlay.querySelector('[data-outfit-entry-error]');
        overlay.querySelector('[data-outfit-entry-close]')?.addEventListener('click', () => closeOverlay?.('close'));
        form?.addEventListener('submit', async event => { event.preventDefault(); try { await commitOutfits(storageId, store => updateOutfitProfile(store, storageId, subject, value => upsertOutfit(value, { date, text: form.elements.text.value, source: 'manual' }))); status(storageId, 'OOTD 已保存。'); closeOverlay?.('saved'); rerender(storageId); } catch (error) { if (errorNode) errorNode.textContent = error.message || 'OOTD 保存失败'; } });
        form?.elements.text?.focus?.({ preventScroll: true });
    }
    async function handleAction(button, app, storageId = getStorageId()) {
        const action = button?.dataset?.action;
        if (action === 'calendar-outfit-generate') return generate(storageId);
        if (action === 'calendar-outfit-regenerate') return generate(storageId, { replaceWindow: true });
        if (action === 'calendar-outfit-edit') { showEditor(storageId); return true; }
        if (action === 'calendar-outfit-delete') { const subject = getView(storageId).outfitSubject, date = getView(storageId).selectedDate; if (!outfitForDate(getProfile(storageId, subject), date) || !confirmImpl?.('删除当天 OOTD？')) return true; await commitOutfits(storageId, store => updateOutfitProfile(store, storageId, subject, value => deleteOutfit(value, date).profile)); status(storageId, 'OOTD 已删除。'); rerender(storageId); return true; }
        if (action === 'calendar-outfit-preferences-save') { const colorPreference = app?.querySelector('[data-outfit-color-preference]')?.value || '', preference = app?.querySelector('[data-outfit-preference]')?.value || ''; const subject = getView(storageId).outfitSubject; await commitOutfits(storageId, store => updateOutfitProfile(store, storageId, subject, value => ({ ...value, colorPreference, preference })), null, { refreshInjection: false }); status(storageId, '穿搭偏好已保存。'); rerender(storageId); return true; }
        if (action === 'calendar-outfit-generation-rule-save') { const generationRule = app?.querySelector('[data-outfit-generation-rule]')?.value || ''; if (!generationRule.trim()) throw new Error('穿搭生成规则不能为空'); const subject = getView(storageId).outfitSubject; await commitOutfits(storageId, store => updateOutfitProfile(store, storageId, subject, value => ({ ...value, generationRule })), null, { refreshInjection: false }); status(storageId, '穿搭生成规则已保存。'); rerender(storageId); return true; }
        return false;
    }
    return { generate, handleAction, showEditor };
}
