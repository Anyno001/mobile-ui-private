import { generationErrorMessage } from './ai.js';
import {
    buildCalendarPrompts, calendarDateFromParts, calendarDateRangeKeys, calendarGenerationCopy, calendarMonthKeys,
    calendarReferenceDate, calendarScopeFor, calendarWeekKeys, calendarWindowDescription, contextPayload, createCalendarDate, deleteCalendarEvent,
    extractCalendarBaseDate, findCalendarEvent, formatCalendarDate, mergeCalendarEvents,
    normalizeCalendarDateTags, normalizeCalendarStore, parseCalendarAiResponse, parseCalendarDate, shiftCalendarMonth,
    upsertCalendarEvent,
} from './calendar-model.js';
import { deleteOccasion, expandOccasions, findOccasion, normalizeOccasionStore, occasionScopeFor, upsertOccasion } from './calendar-occasion-model.js';
import {
    buildCulturalFestivals, HOLIDAY_YEAR_RANGE, holidayYearFromCache, holidayYearRange, isHolidayYearSupported,
    mergeCalendarDateFacts, normalizeHolidayCache, resolveHolidayYear, selectHolidayCountry,
} from './calendar-holiday.js';
import { fetchWeatherForecast, normalizeWeatherStore, searchWeatherLocations } from './calendar-weather.js';
import { CYCLE_SELF_SUBJECT, clearCycleScope, cycleScopeFor, cycleSubjectKeys, normalizeCycleStore, upsertCycleScope } from './calendar-cycle-model.js';
import { normalizeRecipeStore, recipeScopeFor } from './calendar-recipe-model.js';
import { createCalendarCommitters } from './calendar-commit.js';
import { fillCalendarEntryForm, readCalendarEntryForm, setCalendarEntryKind } from './calendar-dom.js';
import { loadCalendar, loadCalendarCycles, loadCalendarHolidays, loadCalendarOccasions, loadCalendarRecipes, loadCalendarWeather } from './calendar-storage.js';
import {
    occasionTypeLabel, renderCalendarEntryDialog, renderCalendarEntryManager,
} from './calendar-view.js';
import { renderCalendarPageHtml } from './calendar-page-view.js';
import { createCalendarRecipeController } from './calendar-recipe-controller.js';
import { createTaskController } from './calendar-task-controller.js';

export const calendarGenerationErrorMessage = generationErrorMessage;
export { renderCalendarPageHtml };

export function installCalendar(state, deps) {
    const { getStorageId, gatherContext, callAI, fetchImpl, makeOverlay, closeOverlay } = deps;
    const runtime = {
        store: normalizeCalendarStore(loadCalendar()),
        occasionStore: normalizeOccasionStore(loadCalendarOccasions()),
        holidayStore: normalizeHolidayCache(loadCalendarHolidays()),
        weatherStore: normalizeWeatherStore(loadCalendarWeather()),
        cycleStore: normalizeCycleStore(loadCalendarCycles()),
        recipeStore: normalizeRecipeStore(loadCalendarRecipes()),
        weatherSearchResults: [],
        viewByStorage: new Map(),
        statusByStorage: new Map(),
        statusTimerByStorage: new Map(),
    };
    const tasks = createTaskController(getStorageId);
    const scheduleTimeout = deps.setTimeoutImpl || globalThis.setTimeout;
    const cancelTimeout = deps.clearTimeoutImpl || globalThis.clearTimeout;
    const status = (storageId, text, { duration = 4000, persistent = false } = {}) => {
        const previousToken = runtime.statusTimerByStorage.get(storageId);
        if (previousToken) cancelTimeout(previousToken.timer);
        runtime.statusTimerByStorage.delete(storageId);
        const nextText = text || '';
        runtime.statusByStorage.set(storageId, nextText);
        const element = state.phoneWindow?.querySelector('.pm-calendar-status');
        if (element && getStorageId() === storageId) element.textContent = nextText;
        if (!nextText || persistent) return;
        const token = { timer: undefined };
        const timer = scheduleTimeout(() => {
            if (runtime.statusTimerByStorage.get(storageId) !== token) return;
            runtime.statusTimerByStorage.delete(storageId);
            if (runtime.statusByStorage.get(storageId) !== nextText) return;
            runtime.statusByStorage.set(storageId, '');
            const currentElement = state.phoneWindow?.querySelector('.pm-calendar-status');
            if (currentElement && getStorageId() === storageId) currentElement.textContent = '';
        }, duration);
        timer?.unref?.();
        token.timer = timer;
        runtime.statusTimerByStorage.set(storageId, token);
    };
    const errorStatus = (storageId, error) => status(storageId, error?.message || '日历操作失败', { duration: 10000 });
    const scope = storageId => calendarScopeFor(runtime.store, storageId);
    const occasions = storageId => occasionScopeFor(runtime.occasionStore, storageId);
    const cycleSubjectOptions = storageId => {
        const names = state.isGroupChat ? state.groupMembers : [state.currentPersona];
        const known = cycleSubjectKeys(runtime.cycleStore, storageId);
        const ids = [CYCLE_SELF_SUBJECT, ...names.filter(Boolean).map(name => `role:${name}`), ...known];
        const seen = new Set();
        return ids.flatMap(value => {
            if (!value || seen.has(value)) return [];
            seen.add(value);
            return [{ value, label: value === CYCLE_SELF_SUBJECT ? '<user>' : value.startsWith('role:') ? value.slice(5) : value }];
        });
    };
    const cycles = (storageId, subject = CYCLE_SELF_SUBJECT) => cycleScopeFor(runtime.cycleStore, storageId, subject);
    const viewFor = storageId => {
        const existing = runtime.viewByStorage.get(storageId);
        if (existing) return existing;
        const reference = calendarReferenceDate(scope(storageId));
        const view = {
            viewYear: reference.getFullYear(), viewMonth: reference.getMonth() + 1,
            selectedDate: formatCalendarDate(reference),
            viewMode: 'schedule', editorKind: 'event', cycleSubject: CYCLE_SELF_SUBJECT,
            generating: false, recipeGenerating: false,
        };
        runtime.viewByStorage.set(storageId, view);
        return view;
    };
    const shiftView = (storageId, delta) => {
        const current = viewFor(storageId);
        const next = shiftCalendarMonth(current.viewYear, current.viewMonth, delta);
        if (!next) return false;
        runtime.viewByStorage.set(storageId, {
            ...current,
            viewYear: next.year, viewMonth: next.month,
            selectedDate: calendarDateFromParts(next.year, next.month, 1),
        });
        return true;
    };
    const { commitScope, commitRecipe, commitOccasions, commitHolidays, commitWeather, commitCycle, invalidateCommits } = createCalendarCommitters({
        runtime,
        tasks,
        applyBidirectionalInjection: deps.applyBidirectionalInjection,
        getCycles: cycles,
        getCycleSubject: storageId => viewFor(storageId).cycleSubject,
    });

    const render = (storageId = getStorageId()) => {
        const container = state.phoneWindow?.querySelector('.pm-calendar-page');
        if (!container) return false;
        container.innerHTML = renderCalendarPageHtml(
            scope(storageId), occasions(storageId), runtime.statusByStorage.get(storageId) || '',
            runtime.holidayStore, runtime.weatherStore,
            cycles(storageId, viewFor(storageId).cycleSubject), runtime.weatherSearchResults,
            {
                ...viewFor(storageId),
                cycleSubjects: cycleSubjectOptions(storageId),
            },
            recipeScopeFor(runtime.recipeStore, storageId),
        );
        return true;
    };
    const rerender = storageId => { if (getStorageId() === storageId) render(storageId); };
    const recipeController = createCalendarRecipeController({
        tasks, getStorageId, gatherContext, callAI, makeOverlay, closeOverlay, commitRecipe,
        getRecipeScope: storageId => recipeScopeFor(runtime.recipeStore, storageId),
        getReferenceDate: storageId => calendarReferenceDate(scope(storageId)),
        getView: viewFor,
        setView: (storageId, view) => runtime.viewByStorage.set(storageId, view),
        getStatus: storageId => runtime.statusByStorage.get(storageId) || '',
        status,
        rerender,
        confirmImpl: deps.confirmImpl || globalThis.confirm,
    });

    async function refreshHolidays(storageId, country) {
        const task = tasks.begin(storageId, 'holiday-refresh');
        if (!task) return false;
        let nextCache = selectHolidayCountry(runtime.holidayStore, country);
        let usedStaleCache = false;
        try {
            const view = viewFor(storageId);
            const range = holidayYearRange(country);
            const years = [...new Set(calendarMonthKeys(view.viewYear, view.viewMonth)
                .map(date => Number(date.slice(0, 4))).filter(year => isHolidayYearSupported(country, year)))];
            if (!years.length) throw new Error(
                `该国家在当前年代无外部节假日数据源（仅支持 ${range?.min ?? '未知'}–${range?.max ?? '未知'} 年）`,
            );
            for (const year of years) {
                const result = await resolveHolidayYear({
                    country, year, cache: nextCache, fetchImpl: fetchImpl || globalThis.fetch, signal: task.signal,
                });
                if (!tasks.active(task)) return false;
                nextCache = result.cache;
                usedStaleCache ||= result.stale;
            }
            if (!tasks.active(task)) return false;
            commitHolidays(nextCache);
            await deps.applyBidirectionalInjection?.();
            status(storageId, usedStaleCache ? '节假日服务不可用，已显示缓存数据。' : '节假日数据已更新。',
                usedStaleCache ? { duration: 10000 } : undefined);
            rerender(storageId);
            return true;
        } catch (error) {
            if (!tasks.active(task)) return false;
            errorStatus(storageId, error);
            throw error;
        } finally {
            tasks.finish(task);
        }
    }

    async function findWeatherLocations(storageId, query) {
        const task = tasks.begin(storageId, 'weather-search');
        if (!task) return false;
        try {
            const results = await searchWeatherLocations(query, { fetchImpl: fetchImpl || globalThis.fetch, signal: task.signal });
            if (!tasks.active(task)) return false;
            runtime.weatherSearchResults = results;
            status(storageId, results.length ? `找到 ${results.length} 个位置，请选择。` : '没有找到匹配的天气位置。');
            rerender(storageId);
            return true;
        } catch (error) {
            if (!tasks.active(task)) return false;
            errorStatus(storageId, error);
            throw error;
        } finally {
            tasks.finish(task);
        }
    }

    async function selectWeatherLocation(storageId, index) {
        const location = runtime.weatherSearchResults[index];
        if (!location) {
            const error = new Error('天气位置不存在，请重新搜索');
            errorStatus(storageId, error);
            throw error;
        }
        const task = tasks.begin(storageId, 'weather-forecast');
        if (!task) return false;
        try {
            const result = await fetchWeatherForecast(location, runtime.weatherStore, {
                fetchImpl: fetchImpl || globalThis.fetch, signal: task.signal,
            });
            if (!tasks.active(task)) return false;
            commitWeather(result.store);
            await deps.applyBidirectionalInjection?.();
            runtime.weatherSearchResults = [];
            const degraded = result.source !== 'forecast';
            status(storageId, result.source === 'cached_forecast' ? '天气服务不可用，已显示该位置的缓存预报。'
                : result.source === 'climate_estimate' ? '天气服务不可用，已保存位置并使用气候推演。' : '天气位置与预报已更新。',
            degraded ? { duration: 10000 } : undefined);
            rerender(storageId);
            return true;
        } catch (error) {
            if (!tasks.active(task)) return false;
            errorStatus(storageId, error);
            throw error;
        } finally {
            tasks.finish(task);
        }
    }

    async function refreshWeather(storageId) {
        if (!runtime.weatherStore.location) {
            const error = new Error('请先搜索并选择天气位置');
            errorStatus(storageId, error);
            throw error;
        }
        const task = tasks.begin(storageId, 'weather-forecast');
        if (!task) return false;
        try {
            const result = await fetchWeatherForecast(runtime.weatherStore.location, runtime.weatherStore, {
                fetchImpl: fetchImpl || globalThis.fetch, signal: task.signal,
            });
            if (!tasks.active(task)) return false;
            commitWeather(result.store);
            await deps.applyBidirectionalInjection?.();
            const degraded = result.source !== 'forecast';
            status(storageId, result.source === 'cached_forecast' ? '天气服务不可用，已显示缓存预报。'
                : result.source === 'climate_estimate' ? '天气服务不可用，继续使用气候推演。' : '天气预报已更新。',
            degraded ? { duration: 10000 } : undefined);
            rerender(storageId);
            return true;
        } catch (error) {
            if (!tasks.active(task)) return false;
            errorStatus(storageId, error);
            throw error;
        } finally {
            tasks.finish(task);
        }
    }

    async function scanContext(storageId = getStorageId(), { silent = false, assistantOnly = false, task: parentTask = null } = {}) {
        const task = parentTask || tasks.begin(storageId, 'scan-context');
        if (!task || !tasks.active(task)) return false;
        try {
            const context = await gatherContext();
            if (!tasks.active(task)) return false;
            if (assistantOnly && context.latestChatIsUser) return false;
            const currentScope = scope(storageId);
            const baseDate = extractCalendarBaseDate(context.latestChatText, currentScope.dateTags);
            if (!baseDate) {
                if (!silent) status(storageId, '最后一条正文中没有带年份的明确日期，今天日期未调整。');
                return false;
            }
            if (currentScope.baseDate === baseDate) {
                if (!silent) status(storageId, `今天日期已经是 ${baseDate}。`);
                return true;
            }
            if (!tasks.active(task)) return false;
            const committed = await commitScope(storageId, current => ({ ...current, baseDate, lastAdjustedAt: Date.now() }), task);
            if (!committed) return false;
            if (!tasks.active(task)) return false;
            const parsed = parseCalendarDate(baseDate), currentView = viewFor(storageId);
            runtime.viewByStorage.set(storageId, {
                ...currentView, viewYear: parsed.getFullYear(), viewMonth: parsed.getMonth() + 1, selectedDate: baseDate,
            });
            if (!silent) status(storageId, `已从最后一条正文将今天调整为 ${baseDate}。`);
            rerender(storageId);
            return true;
        } finally {
            if (!parentTask) tasks.finish(task);
        }
    }

    async function generate(storageId = getStorageId(), mode = 'generate', { parentSignal } = {}) {
        const task = tasks.begin(storageId, 'generate', { replace: false, mode, parentSignal });
        if (!task) throw new Error('当前会话已有日历生成任务，或会话不可用');
        const currentView = viewFor(storageId);
        const previousStatus = currentView.generationTask ? currentView.generationPreviousStatus : runtime.statusByStorage.get(storageId) || '';
        runtime.viewByStorage.set(storageId, { ...currentView, generating: true, generationTask: task, generationPreviousStatus: previousStatus }); let statusSettled = false;
        const now = calendarReferenceDate(scope(storageId)), generationCopy = calendarGenerationCopy(now, mode);
        status(storageId, generationCopy.pending, { persistent: true }); rerender(storageId);
        try {
            const context = await gatherContext();
            if (!tasks.active(task)) return false;
            const current = scope(storageId);
            const historicalDates = calendarDateRangeKeys(now, -3, -1);
            const currentDates = calendarDateRangeKeys(now, 0, 6);
            const historicalEvents = historicalDates.flatMap(date => current.events[date] || [])
                .map(({ date, title, note, source }) => ({ date, title, note, source }));
            const existing = currentDates.flatMap(date => current.events[date] || [])
                .map(({ date, title, note, source }) => ({ date, title, note, source }));
            const holidayStore = normalizeHolidayCache(runtime.holidayStore);
            const years = [...new Set(currentDates.map(date => Number(date.slice(0, 4))))];
            const dateFacts = years.flatMap(year => {
                const legal = holidayYearFromCache(holidayStore, holidayStore.selectedCountry, year)?.entries || [];
                const cultural = year >= HOLIDAY_YEAR_RANGE.min && year <= HOLIDAY_YEAR_RANGE.max
                    ? buildCulturalFestivals(year) : [];
                return mergeCalendarDateFacts(legal, cultural);
            }).filter(item => currentDates.includes(item.date))
                .map(({ date, name, kind }) => ({ date, name, kind }));
            const payload = contextPayload(context, now, {
                dateTags: current.dateTags,
                historicalEvents,
                currentEvents: existing,
                dateFacts,
            });
            const prompts = buildCalendarPrompts(payload, existing, mode);
            const raw = await callAI(prompts.systemPrompt, prompts.userPrompt, { isolated: true, signal: task.signal });
            if (!tasks.active(task)) return false;
            const events = parseCalendarAiResponse(raw, { start: now, days: 7 });
            const committed = await commitScope(storageId, value => {
                const next = mergeCalendarEvents(value, events, {
                    replaceAiInWindow: mode === 'adjust', windowStart: now, days: 7,
                });
                if (mode === 'adjust') next.lastAdjustedAt = Date.now(); else next.lastGeneratedAt = Date.now();
                return next;
            }, task);
            if (!committed) return false;
            if (!tasks.active(task)) return false;
            status(storageId, generationCopy.success); statusSettled = true;
            rerender(storageId); return true;
        } catch (error) {
            if (error?.calendarRollbackError) throw error;
            if (!tasks.active(task)) return false;
            status(storageId, `日历生成失败：${calendarGenerationErrorMessage(error)}`, { duration: 10000 }); statusSettled = true;
            throw error;
        } finally {
            tasks.finish(task); const latestView = viewFor(storageId);
            if (latestView.generationTask === task) {
                if (!statusSettled) status(storageId, previousStatus);
                runtime.viewByStorage.set(storageId, { ...latestView, generating: false, generationTask: null, generationPreviousStatus: '' }); rerender(storageId);
            }
        }
    }

    async function ensureWeek(storageId = getStorageId()) {
        const task = tasks.begin(storageId, 'scan-context', { mode: 'ensure-week' });
        if (!task) return false;
        try {
            await scanContext(storageId, { silent: true, task });
            if (!tasks.active(task)) return false;
            const reference = calendarReferenceDate(scope(storageId));
            const hasFutureEvents = calendarWeekKeys(reference, 7).some(date => (scope(storageId).events[date] || []).length);
            rerender(storageId);
            return hasFutureEvents;
        } finally {
            tasks.finish(task);
        }
    }

    async function saveBaseDate(storageId, value) {
        const parsed = parseCalendarDate(value);
        if (!parsed) throw new Error('时间起点无效，请选择有效日期');
        await commitScope(storageId, current => ({ ...current, baseDate: formatCalendarDate(parsed) }));
        const current = viewFor(storageId);
        runtime.viewByStorage.set(storageId, {
            ...current,
            viewYear: parsed.getFullYear(), viewMonth: parsed.getMonth() + 1, selectedDate: formatCalendarDate(parsed), monthPanelOpen: false,
        });
        const generationWindow = calendarWindowDescription(parsed, 7);
        status(storageId, `时间起点已设为 ${formatCalendarDate(parsed)}，相对日期与${generationWindow.label}生成将以此为准。`);
        rerender(storageId);
    }

    async function clearBaseDate(storageId) {
        await commitScope(storageId, current => { const next = { ...current }; delete next.baseDate; return next; });
        const today = calendarReferenceDate(scope(storageId));
        const current = viewFor(storageId);
        runtime.viewByStorage.set(storageId, {
            ...current,
            viewYear: today.getFullYear(), viewMonth: today.getMonth() + 1, selectedDate: formatCalendarDate(today), monthPanelOpen: false,
        });
        status(storageId, '已恢复设备日期作为时间起点。');
        rerender(storageId);
    }

    function goToReferenceDate(storageId) {
        const reference = calendarReferenceDate(scope(storageId));
        const current = viewFor(storageId);
        runtime.viewByStorage.set(storageId, {
            ...current, viewYear: reference.getFullYear(), viewMonth: reference.getMonth() + 1,
            selectedDate: formatCalendarDate(reference), monthPanelOpen: false,
        });
        rerender(storageId);
    }
    function jumpToMonth(storageId, yearValue, monthValue) {
        const year = Number(yearValue), month = Number(monthValue);
        const target = createCalendarDate(year, month, 1);
        if (!target || !Number.isInteger(year) || !Number.isInteger(month)) throw new Error('跳转年月无效，请输入 1–9999 年和 1–12 月');
        const current = viewFor(storageId);
        runtime.viewByStorage.set(storageId, {
            ...current, viewYear: year, viewMonth: month, selectedDate: formatCalendarDate(target), monthPanelOpen: false,
        });
        rerender(storageId);
    }

    function selectedDateEntries(storageId) {
        const date = viewFor(storageId).selectedDate;
        const parsed = parseCalendarDate(date);
        return {
            date,
            events: scope(storageId).events[date] || [],
            occasions: parsed ? expandOccasions(occasions(storageId), { start: parsed, days: 1 }) : [],
        };
    }

    function resolveEntry(storageId, kind, id) {
        if (kind === 'event') return findCalendarEvent(scope(storageId), id);
        if (kind === 'occasion') return findOccasion(occasions(storageId), id);
        return null;
    }

    function showEntryEditor(storageId, kind = 'event', id = '') {
        if (typeof makeOverlay !== 'function') throw new Error('安排编辑器不可用');
        const entries = selectedDateEntries(storageId);
        const normalizedKind = kind === 'occasion' ? 'occasion' : 'event';
        const existingEntry = id ? resolveEntry(storageId, normalizedKind, id) : null;
        if (id && !existingEntry) throw new Error('要编辑的安排不存在或已被移除');
        const overlay = makeOverlay(renderCalendarEntryDialog(entries.date, existingEntry, normalizedKind));
        const form = overlay.querySelector('[data-calendar-entry-form]');
        const errorNode = overlay.querySelector('[data-calendar-entry-error]');
        const showError = error => { if (errorNode) errorNode.textContent = error?.message || '安排更新失败'; };
        overlay.querySelector('[data-calendar-entry-close]')?.addEventListener('click', () => closeOverlay?.('close'));
        for (const button of overlay.querySelectorAll('[data-calendar-entry-kind]')) {
            button.addEventListener('click', () => {
                if (existingEntry) return;
                fillCalendarEntryForm(overlay, null, setCalendarEntryKind(overlay, button.dataset.calendarEntryKind));
            });
        }
        form?.addEventListener('submit', async event => {
            event.preventDefault();
            try {
                const value = readCalendarEntryForm(overlay);
                if (!value.title) throw new Error('安排名称不能为空');
                if (value.kind === 'event') {
                    const previous = normalizedKind === 'event' ? existingEntry : null;
                    await commitScope(storageId, current => upsertCalendarEvent(current, {
                        id: previous?.id, date: entries.date, title: value.title, note: value.note,
                        source: previous?.source || 'manual', createdAt: previous?.createdAt, updatedAt: Date.now(),
                    }));
                    status(storageId, previous ? '日程已更新。' : '日程已添加。');
                } else {
                    const previous = normalizedKind === 'occasion' ? existingEntry : null;
                    const parsed = parseCalendarDate(entries.date);
                    await commitOccasions(storageId, current => upsertOccasion(current, {
                        id: previous?.id, type: value.type,
                        month: previous?.month || parsed.getMonth() + 1, day: previous?.day || parsed.getDate(),
                        title: value.title, note: value.note, leapDayRule: value.leapDayRule,
                        createdAt: previous?.createdAt, updatedAt: Date.now(),
                    }));
                    status(storageId, previous ? `${occasionTypeLabel(previous.type)}已更新。` : `${occasionTypeLabel(value.type)}已添加。`);
                }
                closeOverlay?.('saved'); rerender(storageId);
            } catch (error) { showError(error); }
        });
        fillCalendarEntryForm(overlay, existingEntry, normalizedKind, { focusTitle: true });
    }

    function showEntryManager(storageId) {
        if (typeof makeOverlay !== 'function') throw new Error('安排管理器不可用');
        const entries = selectedDateEntries(storageId);
        const overlay = makeOverlay(renderCalendarEntryManager(entries.date, entries.events, entries.occasions));
        overlay.querySelector('[data-calendar-entry-close]')?.addEventListener('click', () => closeOverlay?.('close'));
        overlay.querySelector('[data-calendar-entry-add]')?.addEventListener('click', () => {
            closeOverlay?.('add');
            showEntryEditor(storageId);
        });
        for (const button of overlay.querySelectorAll('[data-calendar-entry-edit]')) {
            button.addEventListener('click', () => {
                closeOverlay?.('edit');
                showEntryEditor(storageId, button.dataset.entryKind, button.dataset.entryId);
            });
        }
        for (const button of overlay.querySelectorAll('[data-calendar-entry-remove]')) {
            button.addEventListener('click', async () => {
                const entry = resolveEntry(storageId, button.dataset.entryKind, button.dataset.entryId);
                if (!entry || !confirm(`移除“${entry.title}”？`)) return;
                if (button.dataset.entryKind ==='event') {
                    await commitScope(storageId, current => deleteCalendarEvent(current, entry.id).scope);
                    status(storageId, '日程已移除。');
                } else {
                    await commitOccasions(storageId, current => deleteOccasion(current, entry.id).scope);
                    status(storageId, `${occasionTypeLabel(entry.type)}已移除。`);
                }
                closeOverlay?.('removed');
                rerender(storageId);
            });
        }
    }

    async function handleAction(button, app) {
        const storageId = getStorageId();
        const action = button.dataset.action;
        if (action.startsWith('calendar-recipe-')) {
            if (!await recipeController.handleAction(button, app, storageId)) throw new Error(`未知菜谱操作：${action}`);
            return;
        }
        if (action === 'calendar-generate') { await generate(storageId, 'generate'); return; }
        if (action === 'calendar-month-panel') {
            const current = viewFor(storageId);
            runtime.viewByStorage.set(storageId, { ...current, monthPanelOpen: current.monthPanelOpen !== true });
            rerender(storageId);
            return;
        }
        if (action === 'calendar-prev-month') {
            shiftView(storageId, -1);
            rerender(storageId);
            return;
        }
        if (action === 'calendar-next-month') {
            shiftView(storageId, 1);
            rerender(storageId);
            return;
        }
        if (action === 'calendar-month-jump') {
            const year = app?.querySelector('[data-calendar-jump-year]')?.value;
            const month = app?.querySelector('[data-calendar-jump-month]')?.value;
            jumpToMonth(storageId, year, month);
            return;
        }
        if (action === 'calendar-base-save') {
            const value = app?.querySelector('[data-calendar-base-date]')?.value || '';
            await saveBaseDate(storageId, value); return;
        }
        if (action === 'calendar-base-clear') {
            await clearBaseDate(storageId); return;
        }
        if (action === 'calendar-date-rescan') {
            await scanContext(storageId);
            return;
        }
        if (action === 'calendar-today') {
            goToReferenceDate(storageId);
            return;
        }
        if (['calendar-mode-schedule', 'calendar-mode-weather', 'calendar-mode-cycle', 'calendar-mode-recipe'].includes(action)) {
            const current = viewFor(storageId);
            const viewMode = action.slice('calendar-mode-'.length);
            runtime.viewByStorage.set(storageId, { ...current, viewMode, monthPanelOpen: false });
            rerender(storageId);
            return;
        }
        if (action === 'calendar-select-date') {
            const date = button.dataset.calendarDate;
            const current = viewFor(storageId);
            if (!calendarMonthKeys(current.viewYear, current.viewMonth).includes(date)) {
                throw new Error('选择的日历日期无效');
            }
            runtime.viewByStorage.set(storageId, { ...current, selectedDate: date });
            rerender(storageId);
            return;
        }
        if (action === 'calendar-detail-menu') {
            const menu = app?.querySelector('#pm-calendar-detail-menu');
            if (!menu) return;
            menu.hidden = !menu.hidden;
            button.setAttribute('aria-expanded', String(!menu.hidden));
            return;
        }
        if (action === 'calendar-add-date') { showEntryEditor(storageId); return; }
        if (action === 'calendar-manage-date') { showEntryManager(storageId); return; }
        if (action === 'calendar-date-sync') {
            const input = app?.querySelector('[data-calendar-date-tags]');
            if (!input) return;
            const dateTags = normalizeCalendarDateTags(input.value);
            await commitScope(storageId, current => ({ ...current, dateTags }));
            await scanContext(storageId);
            return;
        }
        if (action === 'calendar-holiday-country') {
            const country = button.value;
            commitHolidays(selectHolidayCountry(runtime.holidayStore, country));
            rerender(storageId);
            await deps.applyBidirectionalInjection?.();
            return;
        }
        if (action === 'calendar-holiday-refresh') {
            const country = app?.querySelector('[data-calendar-country]')?.value;
            await refreshHolidays(storageId, country);
            return;
        }
        if (action === 'calendar-weather-search') {
            const query = app?.querySelector('[data-weather-query]')?.value;
            await findWeatherLocations(storageId, query);
            return;
        }
        if (action === 'calendar-weather-select') {
            await selectWeatherLocation(storageId, Number(button.dataset.locationIndex));
            return;
        }
        if (action === 'calendar-weather-refresh') {
            await refreshWeather(storageId);
            return;
        }
        if (action === 'calendar-cycle-save') {
            const form = app?.querySelector('[data-calendar-cycle-editor]');
            if (!form) return;
            const currentView = viewFor(storageId);
            const subject = form.elements.subject?.value || currentView.cycleSubject || CYCLE_SELF_SUBJECT;
            const reference = calendarReferenceDate(scope(storageId));
            const requestedDay = Number(form.elements.periodStartDay.value);
            let anchor = createCalendarDate(reference.getFullYear(), reference.getMonth() + 1, requestedDay);
            if (!anchor || anchor > reference) {
                const previousMonth = shiftCalendarMonth(reference.getFullYear(), reference.getMonth() + 1, -1);
                anchor = createCalendarDate(previousMonth.year, previousMonth.month, requestedDay);
            }
            if (!anchor) throw new Error('经期开始日不适用于当前月份，请选择 1 到 28 日');
            const nextStore = upsertCycleScope(runtime.cycleStore, storageId, {
                enabled: form.elements.enabled.checked,
                lastPeriodStart: form.elements.enabled.checked ? formatCalendarDate(anchor) : null,
                cycleLength: Number(form.elements.cycleLength.value),
                periodLength: Number(form.elements.periodLength.value),
                overrides: cycles(storageId, subject).overrides,
            }, subject);
            runtime.viewByStorage.set(storageId, { ...currentView, cycleSubject: subject });
            commitCycle(storageId, nextStore);
            await deps.applyBidirectionalInjection?.();
            status(storageId, '生理期提示已保存。');
            rerender(storageId);
            return;
        }
        if (action === 'calendar-cycle-clear') {
            const subject = app?.querySelector('[data-calendar-cycle-editor]')?.elements.subject?.value || viewFor(storageId).cycleSubject || CYCLE_SELF_SUBJECT;
            if (!confirm('清除当前所选角色的生理期资料？')) return;
            commitCycle(storageId, clearCycleScope(runtime.cycleStore, storageId, subject));
            await deps.applyBidirectionalInjection?.();
            status(storageId, '所选角色的生理期资料已清除。');
            rerender(storageId);
            return;
        }
        if (action === 'calendar-cycle-subject') {
            const current = viewFor(storageId);
            runtime.viewByStorage.set(storageId, { ...current, cycleSubject: button.value || CYCLE_SELF_SUBJECT });
            rerender(storageId); return;
        }
        if (action === 'calendar-toggle-auto') {
            await commitScope(storageId, current => ({ ...current, autoAdjust: !current.autoAdjust }));
            status(storageId, scope(storageId).autoAdjust ? '自动识别已开启。角色回复后会从最后一条正文校准今天日期。' : '自动识别已关闭。');
            rerender(storageId); return;
        }
    }

    async function observeTurn() {
        const storageId = getStorageId();
        if (!scope(storageId).autoAdjust) return false;
        try { return await scanContext(storageId, { silent: true, assistantOnly: true }); }
        catch (error) { console.warn('[phone-mode] 日历自动识别失败', error); return false; }
    }

    const transfersCalendarStateOwnership = reason => reason === 'plugin-data-clear'
        || reason === 'backup-apply' || reason === 'backup-rollback';
    const cancelCalendarTasks = reason => {
        if (transfersCalendarStateOwnership(reason)) invalidateCommits();
        return tasks.cancel(reason);
    };
    Object.assign(deps, {
        cancelCalendarTasks,
        ensureCalendarWeek: ensureWeek,
        getCalendarCycleStore: () => normalizeCycleStore(runtime.cycleStore),
        getCalendarHolidayStore: () => normalizeHolidayCache(runtime.holidayStore),
        getCalendarRecipeStore: () => normalizeRecipeStore(runtime.recipeStore),
        getCalendarStore: () => normalizeCalendarStore(runtime.store),
        getCalendarOccasionStore: () => normalizeOccasionStore(runtime.occasionStore),
        getCalendarWeatherStore: () => normalizeWeatherStore(runtime.weatherStore),
        handleCalendarAction: handleAction,
        observeCalendarTurn: observeTurn,
        reloadCalendarStore() {
            runtime.store = normalizeCalendarStore(loadCalendar());
            runtime.viewByStorage.clear();
            runtime.occasionStore = normalizeOccasionStore(loadCalendarOccasions());
            runtime.holidayStore = normalizeHolidayCache(loadCalendarHolidays());
            runtime.weatherStore = normalizeWeatherStore(loadCalendarWeather());
            runtime.cycleStore = normalizeCycleStore(loadCalendarCycles());
            runtime.recipeStore = normalizeRecipeStore(loadCalendarRecipes());
            runtime.weatherSearchResults = [];
        },
        renderCalendar: render,
    });
}