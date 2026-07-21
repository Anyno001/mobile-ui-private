import { generationErrorMessage } from './ai.js';
import {
    buildCalendarPrompts, calendarDateFromParts, calendarDateRangeKeys, calendarGenerationCopy, calendarMonthCells, calendarMonthKeys,
    calendarReferenceDate, calendarScopeFor, calendarWeekKeys, calendarWindowDescription, contextPayload, createCalendarDate, deleteCalendarEvent,
    extractCalendarBaseDate, findCalendarEvent, formatCalendarDate, mergeCalendarEvents,
    normalizeCalendarDateTags, normalizeCalendarStore, parseCalendarAiResponse, parseCalendarDate, relativeCalendarLabel, shiftCalendarMonth,
    upsertCalendarEvent,
} from './calendar-model.js';
import {
    deleteOccasion, expandOccasions, findOccasion, normalizeOccasionStore,
    occasionScopeFor, upsertOccasion,
} from './calendar-occasion-model.js';
import {
    buildCulturalFestivals, HOLIDAY_YEAR_RANGE, holidayYearFromCache, holidayYearRange, isHolidayYearSupported,
    mergeCalendarDateFacts, normalizeHolidayCache, resolveHolidayYear, selectHolidayCountry,
} from './calendar-holiday.js';
import {
    fetchWeatherForecast, normalizeWeatherStore, searchWeatherLocations, weatherCodeLabel,
} from './calendar-weather.js';
import {
    CYCLE_SELF_SUBJECT, clearCycleScope, cycleScopeFor, cycleSubjectKeys, normalizeCycleStore, predictCyclePhase, upsertCycleScope,
} from './calendar-cycle-model.js';
import {
    CALENDAR_ICON_SVG, CLOSE_ICON_SVG, CYCLE_ICON_SVG, EDIT_ICON_SVG, HOME_ICON_SVG, REFRESH_ICON_SVG, WEATHER_ICON_SVG,
} from './icons.js';
import { createCalendarCommitters } from './calendar-commit.js';
import {
    fillCalendarEntryForm, readCalendarEntryForm, setCalendarEntryKind,
} from './calendar-dom.js';
import {
    loadCalendar, loadCalendarCycles, loadCalendarHolidays, loadCalendarOccasions, loadCalendarWeather,
} from './calendar-storage.js';
import {
    occasionTypeLabel, renderCalendarEntryDialog, renderCalendarManagement, renderSelectedDateDetail,
} from './calendar-view.js';
import { createTaskController } from './calendar-task-controller.js';
import { escapeAttr, escapeHtml } from './ui.js';

const weekday = new Intl.DateTimeFormat('zh-CN', { weekday: 'short' });
const shortDate = new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric' });
const monthTitle = new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'long' });

export const calendarGenerationErrorMessage = generationErrorMessage;
const CALENDAR_WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日'];
const CYCLE_LABELS = { period: '经期', follicular: '安全期', ovulatory: '易孕期', luteal: '安全期' };

let lunarFormatter = null;
try {
    lunarFormatter = new Intl.DateTimeFormat('zh-CN-u-ca-chinese', { month: 'short', day: 'numeric' });
} catch { /* 旧运行环境不支持中国农历时保持空副标题 */ }

function lunarDayLabel(value) {
    const day = Number(value);
    if (!Number.isInteger(day) || day < 1 || day > 30) return '';
    if (day <= 10) return `初${['一', '二', '三', '四', '五', '六', '七', '八', '九', '十'][day - 1]}`;
    if (day < 20) return `十${['一', '二', '三', '四', '五', '六', '七', '八', '九'][day - 11]}`;
    if (day === 20) return '二十';
    if (day < 30) return `廿${['一', '二', '三', '四', '五', '六', '七', '八', '九'][day - 21]}`;
    return '三十';
}

function lunarLabel(date) {
    if (!lunarFormatter) return '';
    try {
        const parts = lunarFormatter.formatToParts(date);
        const month = parts.find(part => part.type === 'month')?.value || '';
        const day = Number(parts.find(part => part.type === 'day')?.value);
        return day === 1 ? month : lunarDayLabel(day);
    } catch { return ''; }
}

function calendarDateMeta(scope, occasionsByDate, holidayCache, weatherStore, cycleScope, date, viewMode) {
    const parsed = parseCalendarDate(date);
    const events = scope.events[date] || [];
    const occasions = occasionsByDate.get(date) || [];
    const holidayYear = holidayYearFromCache(holidayCache, holidayCache?.selectedCountry, parsed.getFullYear());
    const holidays = (holidayYear?.entries || []).filter(item => item.date === date);
    const weather = weatherStore?.lastSuccess?.forecast?.days?.find(item => item.date === date) || null;
    const cycle = predictCyclePhase(cycleScope, date);
    const summary = viewMode === 'weather'
        ? (weather ? `${weatherCodeLabel(weather.weatherCode)} ${Math.round(weather.tempMax)}°` : '') || lunarLabel(parsed)
        : viewMode === 'cycle'
            ? (cycle.phase ? CYCLE_LABELS[cycle.phase] || cycle.phase : '') || lunarLabel(parsed)
            : holidays[0]?.name || occasions[0]?.title || events[0]?.title || lunarLabel(parsed);
    return {
        parsed, events, occasions, holidays, weather, cycle, summary,
        hasSchedule: events.length > 0 || occasions.length > 0,
    };
}

export function renderCalendarPageHtml(
    scope, occasionScope, status = '', holidayCache = {}, weatherStore = {}, cycleScope = {}, weatherResults = [],
    view = {},
) {
    const today = calendarReferenceDate(scope);
    const viewMode = ['schedule', 'weather', 'cycle'].includes(view.viewMode) ? view.viewMode : 'schedule';
    const viewYear = Number.isInteger(view.viewYear) ? view.viewYear : today.getFullYear();
    const viewMonth = Number.isInteger(view.viewMonth) ? view.viewMonth : today.getMonth() + 1;
    const monthCells = calendarMonthCells(viewYear, viewMonth);
    const monthKeys = monthCells.flatMap(cell => cell.date ? [cell.date] : []);
    const monthStart = parseCalendarDate(monthKeys[0]);
    const todayKey = formatCalendarDate(today);
    const monthFirst = calendarDateFromParts(viewYear, viewMonth, 1);
    const selectedDate = monthKeys.includes(view.selectedDate)
        ? view.selectedDate
        : (viewYear === today.getFullYear() && viewMonth === today.getMonth() + 1 ? todayKey : monthFirst);
    const occasionsByDate = new Map();
    for (const occasion of expandOccasions(occasionScope, { start: monthStart, days: monthKeys.length })) {
        if (!occasionsByDate.has(occasion.date)) occasionsByDate.set(occasion.date, []);
        occasionsByDate.get(occasion.date).push(occasion);
    }
    const days = monthCells.map(cell => {
        if (cell.isPlaceholder) return '<span class="pm-calendar-day is-placeholder" aria-hidden="true"></span>';
        const date = cell.date;
        const meta = calendarDateMeta(scope, occasionsByDate, holidayCache, weatherStore, cycleScope, date, viewMode);
        const classes = ['pm-calendar-day'];
        if (meta.parsed.getMonth() !== viewMonth - 1) classes.push('is-other-month');
        if (date === todayKey) classes.push('is-today');
        if (date === selectedDate) classes.push('is-selected');
        if (viewMode === 'weather') {
            if (meta.weather) classes.push('has-weather');
        } else if (viewMode === 'cycle') {
            if (meta.cycle.phase) classes.push(`has-cycle is-cycle-${meta.cycle.phase}`);
        } else {
            if (meta.hasSchedule) classes.push('has-schedule');
            if (meta.holidays.length) classes.push('has-holiday');
            if (meta.occasions.length) classes.push('has-occasion');
        }
        const labels = [shortDate.format(meta.parsed), meta.summary].filter(Boolean).join('，');
        return `<button type="button" class="${classes.join(' ')}" data-action="calendar-select-date" data-calendar-date="${date}" aria-pressed="${date === selectedDate}" aria-label="${escapeAttr(labels)}"><b>${meta.parsed.getDate()}</b><span>${escapeHtml(meta.summary)}</span><i aria-hidden="true"></i></button>`;
    }).join('');
    const relativeLabel = relativeCalendarLabel(today, selectedDate) || '';
    const selectedDetail = renderSelectedDateDetail(
        scope, occasionsByDate, holidayCache, weatherStore, cycleScope, selectedDate, viewMode, relativeLabel,
    );
    const headerAction = viewMode === 'weather' ? 'calendar-weather-refresh' : viewMode === 'schedule' ? 'calendar-generate' : '';
    const headerActionLabel = viewMode === 'weather' ? '刷新天气' : calendarGenerationCopy(today).actionLabel;
    const holidayCountry = normalizeHolidayCache(holidayCache).selectedCountry;
    const holidayRange = holidayYearRange(holidayCountry);
    const holidayAvailable = monthKeys.some(date => isHolidayYearSupported(holidayCountry, Number(date.slice(0, 4))));
    const management = renderCalendarManagement({
        scope, occasionScope, holidayCache, weatherStore, cycleScope, weatherResults, viewMode,
        holidayAvailable, holidayRange, editorKind: view.editorKind, cycleSubjects: view.cycleSubjects,
        selectedCycleSubject: view.cycleSubject,
    });
    const baseDate = scope.baseDate || '';
    const headerBusy = viewMode === 'schedule' && view.generating === true;
    const headerButton = headerAction ? `<button type="button" class="pm-calendar-header-action ${headerBusy ? 'is-loading' : ''}" data-action="${headerAction}" aria-label="${headerActionLabel}" title="${headerActionLabel}" aria-busy="${headerBusy}" ${headerBusy ? 'disabled' : ''}>${REFRESH_ICON_SVG}</button>` : '';
    const statusClass = headerBusy ? 'pm-calendar-status is-generating' : 'pm-calendar-status';
    return `<div id="pm-calendar-app" class="pm-calendar-shell" data-calendar-view-mode="${viewMode}">
        <header class="pm-calendar-header"><span class="pm-calendar-header-side is-left"><button type="button" data-action="calendar-home" aria-label="返回桌面" title="返回桌面">${HOME_ICON_SVG}</button></span><div class="pm-calendar-title-row"><b>${escapeHtml(monthTitle.format(createCalendarDate(viewYear, viewMonth, 1)))}</b></div><span class="pm-calendar-header-side is-right"><button type="button" class="pm-calendar-base-edit" data-action="calendar-base-edit" aria-label="编辑时间起点" title="编辑时间起点">${EDIT_ICON_SVG}</button>${headerButton}</span></header>
        <div class="pm-calendar-month-nav"><button type="button" class="pm-calendar-month-step" data-action="calendar-prev-month" aria-label="上个月">‹</button><div class="pm-calendar-view-switch" role="group" aria-label="日历信息分类"><button type="button" data-action="calendar-mode-schedule" aria-label="显示日程与假日" aria-pressed="${viewMode === 'schedule'}" title="日程与假日">${CALENDAR_ICON_SVG}</button><button type="button" data-action="calendar-mode-weather" aria-label="显示天气" aria-pressed="${viewMode === 'weather'}" title="天气">${WEATHER_ICON_SVG}</button><button type="button" data-action="calendar-mode-cycle" aria-label="显示生理期" aria-pressed="${viewMode === 'cycle'}" title="生理期">${CYCLE_ICON_SVG}</button></div><button type="button" class="pm-calendar-month-step" data-action="calendar-next-month" aria-label="下个月">›</button></div>
        <div class="pm-calendar-month" aria-label="${viewYear}年${viewMonth}月月历"><div class="pm-calendar-weekdays">${CALENDAR_WEEKDAYS.map(day => `<span>周${day}</span>`).join('')}</div><div class="pm-calendar-month-grid">${days}</div></div>
        ${selectedDetail}
        ${management}
        <div class="${statusClass}" aria-live="polite">${escapeHtml(status)}</div>
    </div>`;
}

export function installCalendar(state, deps) {
    const { getStorageId, gatherContext, callAI, fetchImpl, makeOverlay, closeOverlay } = deps;
    const runtime = {
        store: normalizeCalendarStore(loadCalendar()),
        occasionStore: normalizeOccasionStore(loadCalendarOccasions()),
        holidayStore: normalizeHolidayCache(loadCalendarHolidays()),
        weatherStore: normalizeWeatherStore(loadCalendarWeather()),
        cycleStore: normalizeCycleStore(loadCalendarCycles()),
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
            viewMode: 'schedule', editorKind: 'event', cycleSubject: CYCLE_SELF_SUBJECT, generating: false,
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
    const { commitScope, commitOccasions, commitHolidays, commitWeather, commitCycle } = createCalendarCommitters({
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
        );
        return true;
    };
    const rerender = storageId => { if (getStorageId() === storageId) render(storageId); };

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
            status(storageId, result.stale ? '天气服务不可用，已显示该位置的缓存预报。' : '天气位置与预报已更新。',
                result.stale ? { duration: 10000 } : undefined);
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
            status(storageId, result.stale ? '天气服务不可用，已显示缓存预报。' : '天气预报已更新。',
                result.stale ? { duration: 10000 } : undefined);
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
            viewYear: parsed.getFullYear(), viewMonth: parsed.getMonth() + 1, selectedDate: formatCalendarDate(parsed),
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
            viewYear: today.getFullYear(), viewMonth: today.getMonth() + 1, selectedDate: formatCalendarDate(today),
        });
        status(storageId, '已恢复设备日期作为时间起点。');
        rerender(storageId);
    }

    function showBaseDateEditor(storageId) {
        if (typeof makeOverlay !== 'function') throw new Error('时间起点编辑器不可用');
        const baseDate = scope(storageId).baseDate || '';
        const overlay = makeOverlay(`<div class="pm-modal pm-calendar-base-dialog">
          <div class="pm-modal-header"><span></span><b>编辑时间起点</b><button type="button" class="pm-modal-close" data-calendar-base-close aria-label="关闭">${CLOSE_ICON_SVG}</button></div>
          <div class="pm-calendar-base-content"><label>时间起点<input type="date" data-calendar-base-date value="${escapeAttr(baseDate)}" aria-label="自定义时间起点"></label><p class="pm-calendar-base-error" data-calendar-base-error role="status" aria-live="polite"></p></div>
          <div class="pm-modal-add pm-calendar-base-actions"><button type="button" class="pm-action-button is-secondary" data-calendar-base-reset ${baseDate ? '' : 'disabled'}>使用设备时间</button><button type="button" class="pm-action-button" data-calendar-base-apply>应用</button></div>
        </div>`);
        const showEditorError = error => {
            const errorNode = overlay.querySelector('[data-calendar-base-error]');
            if (errorNode) errorNode.textContent = error?.message || '时间起点更新失败';
        };
        overlay.querySelector('[data-calendar-base-close]')?.addEventListener('click', () => closeOverlay?.('close'));
        overlay.querySelector('[data-calendar-base-apply]')?.addEventListener('click', async () => {
            try {
                const value = overlay.querySelector('[data-calendar-base-date]')?.value || '';
                await saveBaseDate(storageId, value);
                closeOverlay?.('saved');
            } catch (error) {
                showEditorError(error);
            }
        });
        overlay.querySelector('[data-calendar-base-reset]')?.addEventListener('click', async () => {
            try {
                await clearBaseDate(storageId);
                closeOverlay?.('cleared');
            } catch (error) {
                showEditorError(error);
            }
        });
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

    function showEntryDialog(storageId, initialKey = '') {
        if (typeof makeOverlay !== 'function') throw new Error('安排编辑器不可用');
        const entries = selectedDateEntries(storageId);
        const overlay = makeOverlay(renderCalendarEntryDialog(entries.date, entries.events, entries.occasions));
        const form = overlay.querySelector('[data-calendar-entry-form]');
        const existing = overlay.querySelector('[data-calendar-entry-existing]');
        const errorNode = overlay.querySelector('[data-calendar-entry-error]');
        const selectedEntry = () => {
            const [kind, id] = String(existing?.value || '').split(':');
            if (kind === 'event') return { kind, entry: findCalendarEvent(scope(storageId), id) };
            if (kind === 'occasion') return { kind, entry: findOccasion(occasions(storageId), id) };
            return { kind: overlay.dataset.calendarEntryKind || 'event', entry: null };
        };
        const showError = error => { if (errorNode) errorNode.textContent = error?.message || '安排更新失败'; };
        const selectExisting = value => {
            if (existing) existing.value = value || '';
            const selected = selectedEntry();
            fillCalendarEntryForm(overlay, selected.entry, selected.kind);
        };
        overlay.querySelector('[data-calendar-entry-close]')?.addEventListener('click', () => closeOverlay?.('close'));
        for (const button of overlay.querySelectorAll('[data-calendar-entry-kind]')) {
            button.addEventListener('click', () => {
                if (existing) existing.value = '';
                fillCalendarEntryForm(overlay, null, setCalendarEntryKind(overlay, button.dataset.calendarEntryKind));
            });
        }
        existing?.addEventListener('change', () => selectExisting(existing.value));
        overlay.querySelector('[data-calendar-entry-delete]')?.addEventListener('click', async () => {
            try {
                const selected = selectedEntry();
                if (!selected.entry) return;
                if (!confirm(`删除“${selected.entry.title}”？`)) return;
                if (selected.kind === 'event') {
                    await commitScope(storageId, current => deleteCalendarEvent(current, selected.entry.id).scope);
                    status(storageId, '日程已删除。');
                } else {
                    await commitOccasions(storageId, current => deleteOccasion(current, selected.entry.id).scope);
                    status(storageId, `${occasionTypeLabel(selected.entry.type)}已删除。`);
                }
                closeOverlay?.('deleted'); rerender(storageId);
            } catch (error) { showError(error); }
        });
        form?.addEventListener('submit', async event => {
            event.preventDefault();
            try {
                const selected = selectedEntry();
                const value = readCalendarEntryForm(overlay);
                if (!value.title) throw new Error('安排名称不能为空');
                if (value.kind === 'event') {
                    const previous = selected.kind === 'event' ? selected.entry : null;
                    await commitScope(storageId, current => upsertCalendarEvent(current, {
                        id: previous?.id, date: entries.date, title: value.title, note: value.note,
                        source: previous?.source || 'manual', createdAt: previous?.createdAt, updatedAt: Date.now(),
                    }));
                    status(storageId, previous ? '日程已更新。' : '日程已添加。');
                } else {
                    const previous = selected.kind === 'occasion' ? selected.entry : null;
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
        selectExisting(initialKey);
    }

    async function deleteSelectedDateEntry(storageId) {
        const entries = selectedDateEntries(storageId);
        const options = [...entries.events.map(entry => ({ kind: 'event', entry })), ...entries.occasions.map(entry => ({ kind: 'occasion', entry }))];
        if (!options.length) return;
        if (options.length > 1) { showEntryDialog(storageId, `${options[0].kind}:${options[0].entry.id}`); return; }
        const [{ kind, entry }] = options;
        if (!confirm(`删除“${entry.title}”？`)) return;
        if (kind === 'event') await commitScope(storageId, current => deleteCalendarEvent(current, entry.id).scope);
        else await commitOccasions(storageId, current => deleteOccasion(current, entry.id).scope);
        status(storageId, `${kind === 'event' ? '日程' : occasionTypeLabel(entry.type)}已删除。`); rerender(storageId);
    }

    async function handleAction(button, app) {
        const storageId = getStorageId();
        const action = button.dataset.action;
        if (action === 'calendar-generate') { await generate(storageId, 'generate'); return; }
        if (action === 'calendar-base-edit') { showBaseDateEditor(storageId); return; }
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
        if (action === 'calendar-base-save') {
            const value = app?.querySelector('[data-calendar-base-date]')?.value || '';
            await saveBaseDate(storageId, value); return;
        }
        if (action === 'calendar-base-clear') {
            await clearBaseDate(storageId); return;
        }
        if (['calendar-mode-schedule', 'calendar-mode-weather', 'calendar-mode-cycle'].includes(action)) {
            const current = viewFor(storageId);
            const viewMode = action.slice('calendar-mode-'.length);
            runtime.viewByStorage.set(storageId, { ...current, viewMode });
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
        if (action === 'calendar-manage-date') { showEntryDialog(storageId); return; }
        if (action === 'calendar-delete-date') { await deleteSelectedDateEntry(storageId); return; }
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

    Object.assign(deps, {
        cancelCalendarTasks: tasks.cancel,
        ensureCalendarWeek: ensureWeek,
        getCalendarCycleStore: () => normalizeCycleStore(runtime.cycleStore),
        getCalendarHolidayStore: () => normalizeHolidayCache(runtime.holidayStore),
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
            runtime.weatherSearchResults = [];
        },
        renderCalendar: render,
    });
}