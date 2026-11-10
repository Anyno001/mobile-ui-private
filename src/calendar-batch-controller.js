import { calendarDateRangeKeys, calendarReferenceDate, calendarTimeLabel, formatCalendarDate, parseCalendarAiResponse, parseCalendarDate, parseCalendarTimeInput } from './calendar-model.js';
import { deleteOccasion, expandOccasions, findOccasion, normalizeOccasionSeason, upsertOccasion } from './calendar-occasion-model.js';
import {
    applyBatchDays, batchGenerationDates, batchRuleToOccasion, buildBatchSchedulePrompts, buildOccasionImportPrompts, chunkBatchDates,
    formatBatchDayText, isDuplicateBatchRule, parseBatchDayText, parseOccasionImportResponse,
} from './calendar-batch-model.js';
import { renderCalendarBatchPage } from './calendar-batch-view.js';
import { getReadableWorldBookNames } from './worldbook-config.js';

const ruleFromOccasion = occasion => ({
    title: occasion.title, time: occasion.time || '', repeat: occasion.repeat, weekdays: occasion.weekdays || [],
    intervalDays: occasion.intervalDays || 1, start: occasion.date || '', seasonOnly: occasion.seasonOnly === true, note: occasion.note || '',
});
const isBatchRule = occasion => Boolean(occasion.repeat) && occasion.repeat !== 'yearly';
const all = (root, selector) => [...(root?.querySelectorAll?.(selector) || [])];

/**
 * 日程生成的资料：读日历设置「数据来源」中的世界书。未选世界书时保持原行为（按聊天自动触发）；
 * 选了世界书时读取所选的全部条目，勾选自动触发时再并入按聊天触发的条目。
 */
export async function gatherScheduleContext(gatherContext, scope, { signal, worldBookMaxChars = 12000 } = {}) {
    const books = Array.isArray(scope?.batchWorldBooks) ? scope.batchWorldBooks : [];
    if (!books.length) return gatherContext(null, { module: 'calendar', signal, worldBookMaxChars });
    const selected = await gatherContext(null, {
        module: 'calendar', signal, includeWorldBook: true, worldBookMaxChars, worldBookNames: books, worldBookActivationMode: 'selected',
    });
    if (scope.batchAutoWorldBooks !== true || signal?.aborted) return selected;
    const auto = await gatherContext(null, { module: 'calendar', signal, worldBookMaxChars });
    return { ...auto, worldBookText: [selected?.worldBookText, auto?.worldBookText].filter(Boolean).join('\n\n') };
}

export function createCalendarBatchController({
    state, tasks, getScope, getOccasions, commitScope, commitOccasions, gatherContext, callAI, status, errorStatus, rerender,
    getCtx, confirmImpl,
}) {
    const sessions = new Map();
    const session = storageId => sessions.get(storageId) || null;
    const confirmAction = message => typeof confirmImpl === 'function' && confirmImpl(message);
    const weekDates = batch => calendarDateRangeKeys(batch.start, 0, 6);
    const savedText = (storageId, date) => formatBatchDayText(getScope(storageId).events[date] || []);
    const dayText = (storageId, batch, date) => batch.drafts[date]?.text ?? savedText(storageId, date);
    const weekDirty = (storageId, batch) => Object.keys(batch.drafts).some(date => batch.drafts[date] && batch.drafts[date].text !== savedText(storageId, date));

    // mode：ai 为底部「AI生成日程」入口，只含 AI 排程与草稿；manual 为设置页「批量安排」入口，含重复日程、阶段与按周手填。
    const open = (storageId, mode = 'ai') => {
        const reference = formatCalendarDate(calendarReferenceDate(getScope(storageId)));
        sessions.set(storageId, {
            mode: mode === 'manual' ? 'manual' : 'ai', start: reference, drafts: {}, ruleDrafts: new Map(), adding: false, importPreview: null,
            rangeMode: 'week', customStart: reference, customEnd: calendarDateRangeKeys(reference, 13, 13)[0], plan: '',
            generationTask: null, importTask: null,
        });
    };

    // 重绘前把页面上的输入收进内存，避免重绘丢掉未保存的内容。
    const capture = (storageId, app) => {
        const batch = session(storageId);
        if (!batch || !app?.querySelectorAll) return;
        for (const field of all(app, '[data-batch-day]')) {
            const date = field.dataset.batchDay;
            if (!date) continue;
            batch.drafts[date] = { ...(batch.drafts[date] || {}), text: field.value };
        }
        for (const card of all(app, '[data-batch-rule]')) {
            const id = card.dataset.batchRule;
            const read = name => card.querySelector?.(`[name="${name}"]`);
            batch.ruleDrafts.set(id, {
                title: read('title')?.value || '', timeText: read('time')?.value || '', repeat: read('repeat')?.value || 'weekly',
                weekdays: all(card, '[name="weekday"]').filter(item => item.checked).map(item => Number(item.value)),
                intervalDays: Number(read('intervalDays')?.value) || 1, start: read('start')?.value || '',
                seasonOnly: read('seasonOnly')?.checked === true, note: read('note')?.value || '',
            });
        }
        const plan = app.querySelector?.('[data-batch-plan]');
        if (plan) batch.plan = plan.value;
        const range = app.querySelector?.('[data-batch-range]');
        if (range) batch.rangeMode = ['week', 'month', 'custom'].includes(range.value) ? range.value : 'week';
        const customStart = app.querySelector?.('[data-batch-custom-start]'), customEnd = app.querySelector?.('[data-batch-custom-end]');
        if (customStart) batch.customStart = customStart.value;
        if (customEnd) batch.customEnd = customEnd.value;
        if (batch.importPreview) for (const box of all(app, '[data-batch-import-index]')) {
            const item = batch.importPreview[Number(box.dataset.batchImportIndex)];
            if (item) item.checked = box.checked === true;
        }
        const seasonStart = app.querySelector?.('[data-batch-season-start]'), seasonWeeks = app.querySelector?.('[data-batch-season-weeks]');
        const seasonName = app.querySelector?.('[data-batch-season-name]');
        if (seasonStart || seasonWeeks) batch.seasonDraft = { start: seasonStart?.value || '', weeks: Number(seasonWeeks?.value) || '', name: seasonName?.value || '' };
    };
    const currentApp = () => state.phoneWindow?.querySelector?.('#pm-calendar-app');
    const refresh = storageId => { capture(storageId, currentApp()); rerender(storageId); };

    const model = storageId => {
        const batch = session(storageId);
        const scope = getScope(storageId), occasionScope = getOccasions(storageId);
        const dates = weekDates(batch);
        const fixedByDate = new Map();
        const withoutSkips = { ...occasionScope, occasions: occasionScope.occasions.map(({ excludedDates, ...item }) => item) };
        for (const item of expandOccasions(withoutSkips, { start: parseCalendarDate(dates[0]), days: dates.length })) {
            const original = occasionScope.occasions.find(occasion => occasion.id === item.id);
            if (!fixedByDate.has(item.date)) fixedByDate.set(item.date, []);
            fixedByDate.get(item.date).push({ ...item, skipped: Boolean(original?.excludedDates?.includes(item.date)) });
        }
        const rules = occasionScope.occasions.filter(isBatchRule).map(occasion => ({ id: occasion.id, rule: batch.ruleDrafts.get(occasion.id) || ruleFromOccasion(occasion) }));
        if (batch.adding) rules.push({ id: 'new', rule: batch.ruleDrafts.get('new') || { title: '', time: '', repeat: 'weekly', weekdays: [], intervalDays: 1, start: batch.start, seasonOnly: false, note: '' } });
        return {
            mode: batch.mode, start: batch.start, dates, reference: calendarReferenceDate(scope), texts: Object.fromEntries(dates.map(date => [date, dayText(storageId, batch, date)])), drafted: new Set(Object.keys(batch.drafts)), draftDates: Object.keys(batch.drafts).sort(), draftTexts: Object.fromEntries(Object.keys(batch.drafts).map(date => [date, batch.drafts[date].text])),
            fixedByDate, rules, adding: batch.adding, season: occasionScope.season || null, seasonDraft: batch.seasonDraft || null,
            books: scope.batchWorldBooks || [], importPreview: batch.importPreview, importing: Boolean(batch.importTask),
            rangeMode: batch.rangeMode, customStart: batch.customStart, customEnd: batch.customEnd, plan: batch.plan,
            generating: Boolean(batch.generationTask), busy: Boolean(batch.generationTask || batch.importTask),
        };
    };

    const switchWeek = (storageId, nextStart) => {
        const batch = session(storageId);
        if (!parseCalendarDate(nextStart) || nextStart === batch.start) return false;
                batch.start = nextStart;
        return true;
    };

    const readRule = draft => {
        const title = String(draft.title || '').trim();
        if (!title) throw new Error('重复日程标题不能为空');
        const timeText = String(draft.timeText ?? draft.time ?? '').trim();
        const time = timeText ? parseCalendarTimeInput(timeText) : '';
        if (timeText && !time) throw new Error('时间格式无效，可填写20:00、20:00-21:30或晚间');
        if (!parseCalendarDate(draft.start)) throw new Error('起始日无效');
        return { ...draft, title, time };
    };

    async function saveDays(storageId) {
        const batch = session(storageId);
        const dates = Object.keys(batch.drafts).sort(); // 生成范围可跨多周，全部一起保存
        const drafts = { ...batch.drafts };
        await commitScope(storageId, current => applyBatchDays(current, dates, drafts));
        for (const date of dates) delete batch.drafts[date];
        status(storageId, '已保存到日历。');
    }

    async function importRules(storageId) {
        const batch = session(storageId);
        const books = getScope(storageId).batchWorldBooks || [];
        if (!books.length) throw new Error('请先在日历设置的「数据来源」中选择世界书');
        const task = tasks.begin(storageId, 'batch-import');
        if (!task) return;
        batch.importTask = task;
        status(storageId, '正在读取世界书…', { persistent: true }); refresh(storageId);
        try {
            const context = await gatherContext(null, {
                module: 'calendar', signal: task.signal, includeWorldBook: true, worldBookMaxChars: 30000,
                worldBookNames: books, worldBookActivationMode: 'selected',
            });
            if (!tasks.active(task)) return;
            if (!String(context?.worldBookText || '').trim()) throw new Error('所选世界书没有可读取的内容');
            const prompts = buildOccasionImportPrompts({ worldBookText: context.worldBookText, start: batch.start, season: getOccasions(storageId).season });
            const raw = await callAI(prompts.systemPrompt, prompts.userPrompt, { isolated: true, module: 'calendar', signal: task.signal });
            if (!tasks.active(task)) return;
            capture(storageId, currentApp());
            const occasions = getOccasions(storageId).occasions;
            batch.importPreview = parseOccasionImportResponse(raw, { defaultStart: batch.start })
                .map(rule => ({ ...rule, duplicate: isDuplicateBatchRule(occasions, rule), checked: true }));
            status(storageId, `读取到${batch.importPreview.length}条重复日程，勾选后写入。`);
        } catch (error) {
            if (tasks.active(task)) errorStatus(storageId, error);
        } finally {
            tasks.finish(task);
            if (batch.importTask === task) batch.importTask = null;
            refresh(storageId);
        }
    }

    async function applyImport(storageId) {
        const batch = session(storageId);
        const chosen = (batch.importPreview || []).filter(item => item.checked && !item.duplicate);
        if (!chosen.length) { batch.importPreview = null; return; }
        let added = 0, skipped = 0;
        await commitOccasions(storageId, current => {
            let next = current;
            for (const { duplicate, checked, ...rule } of chosen) {
                if (isDuplicateBatchRule(next.occasions, rule)) { skipped += 1; continue; }
                next = upsertOccasion(next, batchRuleToOccasion(rule));
                added += 1;
            }
            return next;
        });
        batch.importPreview = null;
        status(storageId, skipped ? `已写入${added}条，跳过${skipped}条重复。` : `已写入${added}条重复日程。`);
    }

    // 后台每 7 天一批调用 AI，结果只进草稿；单批失败不影响其他批次。
    async function generate(storageId) {
        const batch = session(storageId);
        const occasionScope = getOccasions(storageId);
        const dates = batchGenerationDates({
            mode: batch.rangeMode, start: batch.start, season: occasionScope.season,
            customStart: batch.customStart, customEnd: batch.customEnd,
        });
        const task = tasks.begin(storageId, 'batch-generate');
        if (!task) throw new Error('当前已有批量生成任务');
        batch.generationTask = task;
        const chunks = chunkBatchDates(dates);
        const previousTitles = [], failed = [];
        let filled = 0;
        status(storageId, '正在读取资料…', { persistent: true }); refresh(storageId);
        try {
            const context = await gatherScheduleContext(gatherContext, getScope(storageId), { signal: task.signal });
            if (!tasks.active(task)) return;
            for (const [index, chunk] of chunks.entries()) {
                status(storageId, `正在生成第${index + 1}批，共${chunks.length}批…`, { persistent: true });
                const occupied = expandOccasions(getOccasions(storageId), { start: parseCalendarDate(chunk[0]), days: chunk.length })
                    .map(item => ({ date: item.date, time: calendarTimeLabel(item.time), title: item.title }));
                const prompts = buildBatchSchedulePrompts({
                    dates: chunk, occupied, season: getOccasions(storageId).season, previousTitles, userPlan: batch.plan,
                    generationRule: getScope(storageId).generationRule, context,
                });
                try {
                    const raw = await callAI(prompts.systemPrompt, prompts.userPrompt, { isolated: true, module: 'calendar', signal: task.signal });
                    if (!tasks.active(task)) return;
                    capture(storageId, currentApp());
                    for (const event of parseCalendarAiResponse(raw, { start: parseCalendarDate(chunk[0]), days: chunk.length })) {
                        const draft = batch.drafts[event.date] || { text: savedText(storageId, event.date) };
                        const titles = new Set(parseBatchDayText(draft.text).map(line => line.title));
                        previousTitles.push(event.title);
                        if (titles.has(event.title)) continue;
                        const line = formatBatchDayText([event]);
                        batch.drafts[event.date] = {
                            text: draft.text.trim() ? `${draft.text.replace(/\s+$/, '')}\n${line}` : line,
                            aiTitles: [...new Set([...(draft.aiTitles || []), event.title])],
                        };
                        filled += 1;
                    }
                } catch (error) {
                    if (!tasks.active(task)) return;
                    failed.push(`${chunk[0]}至${chunk.at(-1)}`);
                    capture(storageId, currentApp());
                }
                rerender(storageId);
            }
            status(storageId, failed.length
                ? `已生成${filled}项；${failed.join('、')}生成失败，可重试。`
                : `已生成${filled}项，确认后点保存。`, { duration: 10000 });
        } catch (error) {
            if (tasks.active(task)) errorStatus(storageId, error);
        } finally {
            const cancelled = !tasks.active(task);
            tasks.finish(task);
            if (batch.generationTask === task) {
                batch.generationTask = null;
                if (cancelled && sessions.get(storageId) === batch) status(storageId, '已取消生成，已完成的部分保留。');
            }
            refresh(storageId);
        }
    }

    async function handleAction(button, app, storageId) {
        const action = button.dataset.action;
        if (action === 'calendar-batch-open') { open(storageId, button.dataset?.batchMode); rerender(storageId); return true; }
        // 日历设置「数据来源」里的世界书选择：普通生成与安排日程共用。
        if (action === 'calendar-batch-worldbook-book' || action === 'calendar-batch-worldbook-auto') {
            try {
                await commitScope(storageId, current => {
                    if (action === 'calendar-batch-worldbook-auto') return { ...current, batchAutoWorldBooks: button.checked === true };
                    const books = (current.batchWorldBooks || []).filter(name => name !== button.value);
                    return { ...current, batchWorldBooks: button.checked === true ? [...books, button.value] : books };
                }, null, { refreshInjection: false });
            } catch (error) { errorStatus(storageId, error); }
            rerender(storageId); return true;
        }
        // 日历设置「显示」里的农历开关（路由按 calendar-batch- 前缀进入本控制器，calendar.js 已到行数上限）。
        if (action === 'calendar-batch-lunar') {
            try { await commitScope(storageId, current => ({ ...current, lunarDisplay: current.lunarDisplay !== true }), null, { refreshInjection: false }); }
            catch (error) { errorStatus(storageId, error); }
            rerender(storageId); return true;
        }
        if (!action.startsWith('calendar-batch-')) return false;
        const batch = session(storageId);
        if (!batch) return true;
        capture(storageId, app);
        try {
            if (action === 'calendar-batch-close') {
                if (weekDirty(storageId, batch) && !confirmAction('生成的结果尚未保存。是否放弃并返回？')) return true;
                batch.generationTask?.controller.abort('closed'); batch.importTask?.controller.abort('closed');
                sessions.delete(storageId);
            } else if (action === 'calendar-batch-prev-week' || action === 'calendar-batch-next-week') {
                switchWeek(storageId, calendarDateRangeKeys(batch.start, action === 'calendar-batch-prev-week' ? -7 : 7, action === 'calendar-batch-prev-week' ? -7 : 7)[0]);
            } else if (action === 'calendar-batch-start') {
                switchWeek(storageId, button.value);
            } else if (action === 'calendar-batch-save') {
                await saveDays(storageId);
            } else if (action === 'calendar-batch-line-delete') {
                const date = button.dataset.date, lines = parseBatchDayText(dayText(storageId, batch, date));
                lines.splice(Number(button.dataset.index), 1);
                batch.drafts[date] = { ...batch.drafts[date], text: formatBatchDayText(lines) };
            } else if (action === 'calendar-batch-copy-next') {
                const date = button.dataset.date, next = calendarDateRangeKeys(date, 1, 1)[0];
                const source = parseBatchDayText(dayText(storageId, batch, date));
                const target = dayText(storageId, batch, next);
                const titles = new Set(parseBatchDayText(target).map(line => line.title));
                const lines = formatBatchDayText(source.filter(line => !titles.has(line.title)));
                batch.drafts[next] = { ...(batch.drafts[next] || {}), text: [target.replace(/\s+$/, ''), lines].filter(Boolean).join('\n') };
            } else if (action === 'calendar-batch-skip' || action === 'calendar-batch-unskip') {
                const id = button.dataset.occasionId, date = button.dataset.date;
                await commitOccasions(storageId, current => {
                    const occasion = findOccasion(current, id);
                    if (!occasion) throw new Error('重复日程不存在');
                    const excludedDates = action === 'calendar-batch-skip'
                        ? [...(occasion.excludedDates || []), date] : (occasion.excludedDates || []).filter(item => item !== date);
                    return upsertOccasion(current, { ...occasion, excludedDates, updatedAt: Date.now() });
                });
                status(storageId, action === 'calendar-batch-skip' ? '本次已跳过。' : '已恢复。');
            } else if (action === 'calendar-batch-rule-add') {
                batch.adding = true;
            } else if (action === 'calendar-batch-rule-cancel') {
                batch.adding = false; batch.ruleDrafts.delete('new');
            } else if (action === 'calendar-batch-rule-repeat') {
                // 频率切换只重绘表单（星期多选、间隔天数随之显示）。
            } else if (action === 'calendar-batch-rule-save') {
                const id = button.dataset.ruleId;
                const rule = readRule(batch.ruleDrafts.get(id) || {});
                await commitOccasions(storageId, current => {
                    const existing = id === 'new' ? null : findOccasion(current, id);
                    if (id !== 'new' && !existing) throw new Error('重复日程不存在');
                    return upsertOccasion(current, batchRuleToOccasion(rule, existing));
                });
                batch.ruleDrafts.delete(id);
                if (id === 'new') batch.adding = false;
                status(storageId, '重复日程已保存。');
            } else if (action === 'calendar-batch-rule-delete') {
                const id = button.dataset.ruleId, occasion = findOccasion(getOccasions(storageId), id);
                if (occasion && confirmAction(`删除重复日程“${occasion.title}”？`)) {
                    await commitOccasions(storageId, current => deleteOccasion(current, id).scope);
                    batch.ruleDrafts.delete(id);
                    status(storageId, '重复日程已删除。');
                }
            } else if (action === 'calendar-batch-season-save') {
                const season = normalizeOccasionSeason(batch.seasonDraft);
                if (!season) throw new Error('阶段无效，持续周数为1–104');
                await commitOccasions(storageId, current => ({ ...current, season }));
                batch.seasonDraft = null;
                status(storageId, '阶段已保存。');
            } else if (action === 'calendar-batch-season-clear') {
                await commitOccasions(storageId, ({ season, ...current }) => current);
                batch.seasonDraft = null;
                status(storageId, '阶段已清空。');
            } else if (action === 'calendar-batch-import') {
                await importRules(storageId); return true;
            } else if (action === 'calendar-batch-import-discard') {
                batch.importPreview = null;
            } else if (action === 'calendar-batch-import-apply') {
                await applyImport(storageId);
            } else if (action === 'calendar-batch-range') {
                // 范围切换只重绘（自选日期输入随之显示）。
            } else if (action === 'calendar-batch-generate') {
                await generate(storageId); return true;
            } else if (action === 'calendar-batch-cancel') {
                batch.generationTask?.controller.abort('cancelled');
            }
        } catch (error) {
            errorStatus(storageId, error);
        }
        rerender(storageId);
        return true;
    }

    return {
        isOpen: storageId => sessions.has(storageId),
        worldBooks: () => { try { return getReadableWorldBookNames(getCtx?.(), globalThis.window?.__pmWorldBookConfig); } catch (error) { return []; } },
        render: (storageId, statusText) => renderCalendarBatchPage(model(storageId), statusText),
        handleAction,
        reset: () => {
            for (const batch of sessions.values()) { batch.generationTask?.controller.abort('reset'); batch.importTask?.controller.abort('reset'); }
            sessions.clear();
        },
    };
}
