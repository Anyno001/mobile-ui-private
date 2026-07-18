import assert from 'node:assert/strict';
import { installCalendar, renderCalendarPageHtml } from '../src/calendar.js';
import {
    clearCycleScope, createEmptyCycleStore, cycleScopeFor, predictCyclePhase, predictCycleRange,
    upsertCycleScope,
} from '../src/calendar-cycle-model.js';
import {
    buildJapanNationalHolidays, buildUsFederalHolidays, holidayYearFromCache,
    normalizeHolidayCache, parseChineseDaysYear, putHolidayYear, resolveHolidayYear, selectHolidayCountry,
} from '../src/calendar-holiday.js';
import {
    fetchWeatherForecast, normalizeWeatherForecast, normalizeWeatherLocation,
    normalizeWeatherStore, searchWeatherLocations, WEATHER_ATTRIBUTION,
} from '../src/calendar-weather.js';
import {
    calendarWeekKeys, createEmptyCalendarScope,
} from '../src/calendar-model.js';
import {
    deleteOccasion, expandOccasions, findOccasion, normalizeOccasionStore,
    occasionDateForYear, upsertOccasion,
} from '../src/calendar-occasion-model.js';
import {
    loadCalendarCycles, loadCalendarHolidays, loadCalendarOccasions, loadCalendarWeather,
    saveCalendarCycles, saveCalendarHolidays, saveCalendarOccasions, saveCalendarWeather,
} from '../src/calendar-storage.js';
import {
    CALENDAR_CYCLE_STORAGE_KEY, CALENDAR_HOLIDAY_STORAGE_KEY,
    CALENDAR_OCCASION_STORAGE_KEY, CALENDAR_WEATHER_STORAGE_KEY,
} from '../src/constants.js';

const birthday = {
    type: 'birthday', month: 2, day: 29, title: '小林生日', note: '准备蛋糕', leapDayRule: 'feb28',
};
let scope = upsertOccasion({ occasions: [] }, birthday, 100);
assert.equal(scope.occasions.length, 1);
assert.equal(scope.occasions[0].createdAt, 100);
assert.deepEqual(occasionDateForYear(scope.occasions[0], 2028), { date: '2028-02-29', leapAdjusted: false });
assert.deepEqual(occasionDateForYear(scope.occasions[0], 2027), { date: '2027-02-28', leapAdjusted: true });
assert.deepEqual(occasionDateForYear({ ...birthday, leapDayRule: 'mar1' }, 2027), { date: '2027-03-01', leapAdjusted: true });
assert.equal(occasionDateForYear({ ...birthday, leapDayRule: 'skip' }, 2027), null);

scope = upsertOccasion(scope, birthday, 200);
assert.equal(scope.occasions.length, 1, '相同类型、月日和标题应更新而不是重复');
assert.equal(scope.occasions[0].updatedAt, 200);
const birthdayId = scope.occasions[0].id;
scope = upsertOccasion(scope, { type: 'anniversary', month: 1, day: 1, title: '相识纪念日' }, 300);
const expanded = expandOccasions(scope, { start: new Date(2027, 11, 29, 12), days: 7 });
assert.equal(expanded.length, 1);
assert.equal(expanded[0].date, '2028-01-01');
assert.equal(expanded[0].type, 'anniversary');
assert.equal(findOccasion(scope, birthdayId)?.title, '小林生日');
const removed = deleteOccasion(scope, birthdayId);
assert.equal(removed.removed, true);
assert.equal(removed.scope.occasions.length, 1);

assert.throws(() => upsertOccasion({ occasions: [] }, { type: 'birthday', month: 2, day: 30, title: '无效' }), /日期无效/);
assert.throws(() => upsertOccasion({ occasions: [] }, { type: 'birthday', month: 1, day: 1, title: '' }), /标题不能为空/);
const normalized = normalizeOccasionStore({ scopes: { ' bad ': { occasions: [birthday] }, good: scope } });
assert.deepEqual(Object.keys(normalized.scopes), ['good']);

const memory = new Map();
const storage = {
    getItem: key => memory.has(key) ? memory.get(key) : null,
    setItem: (key, value) => memory.set(key, value),
};
assert.equal(saveCalendarOccasions({ scopes: { good: scope } }, storage), true);
assert.equal(memory.has(CALENDAR_OCCASION_STORAGE_KEY), true);
assert.equal(loadCalendarOccasions(storage).scopes.good.occasions.length, 2);
memory.set(CALENDAR_OCCASION_STORAGE_KEY, '{broken');
assert.deepEqual(loadCalendarOccasions(storage).scopes, {});
assert.equal(saveCalendarOccasions({}, null), false);

const cn2026 = parseChineseDaysYear({
    holidays: { '2026-01-01': "New Year's Day,元旦,1", '2026-01-02': "New Year's Day,元旦,1" },
    workdays: { '2026-01-04': "New Year's Day,元旦,1" },
    inLieuDays: { '2026-01-02': "New Year's Day,元旦,1" },
}, 2026);
assert.ok(cn2026.some(item => item.date === '2026-01-04' && item.kind === 'workday'));
assert.ok(cn2026.some(item => item.date === '2026-01-02' && item.kind === 'in_lieu'));
assert.throws(() => parseChineseDaysYear({ holidays: {} }, 2026), /缺少 holidays/);

const us2026 = buildUsFederalHolidays(2026);
assert.ok(us2026.some(item => item.date === '2026-07-03' && item.kind === 'observed'));
assert.ok(us2026.some(item => item.date === '2026-07-04' && item.name === 'Independence Day'));
assert.equal(buildUsFederalHolidays(2020).some(item => item.name.includes('Juneteenth')), false);
assert.equal(buildUsFederalHolidays(2021).some(item => item.date === '2021-06-19' && item.name.includes('Juneteenth')), true);
assert.ok(buildUsFederalHolidays(2021).some(item => item.date === '2021-12-31' && item.name.includes("New Year’s Day")));
assert.equal(buildUsFederalHolidays(2022).some(item => item.date === '2021-12-31'), false, '年度结果按实际日期归档');

const jp2026 = buildJapanNationalHolidays(2026);
assert.ok(jp2026.some(item => item.date === '2026-05-06' && item.kind === 'observed'));
assert.equal(buildJapanNationalHolidays(2019).some(item => item.name === '天皇誕生日'), false);
assert.throws(() => buildJapanNationalHolidays(2100), /仅支持/);

let holidayCache = putHolidayYear({}, 'CN', 2026, cn2026, { fetchedAt: 100, source: 'chinese-days' });
assert.equal(holidayYearFromCache(holidayCache, 'CN', 2026).entries.length, cn2026.length);
assert.deepEqual(normalizeHolidayCache({ years: { broken: { country: 'CN', year: 2026, entries: cn2026 } } }).years, {});
const cachedFallback = await resolveHolidayYear({
    country: 'CN', year: 2026, cache: holidayCache,
    fetchImpl: async () => { throw new Error('offline'); },
});
assert.equal(cachedFallback.stale, true);
assert.equal(cachedFallback.entries.length, cn2026.length);
await assert.rejects(resolveHolidayYear({
    country: 'CN', year: 2027, cache: holidayCache,
    fetchImpl: async () => { throw new Error('offline'); },
}), /加载失败/);
const fetchedHoliday = await resolveHolidayYear({
    country: 'CN', year: 2026, cache: {},
    fetchImpl: async () => ({ ok: true, json: async () => ({ holidays: { '2026-10-01': 'National Day,国庆节,3' } }) }),
});
assert.equal(fetchedHoliday.stale, false);
assert.equal(fetchedHoliday.entries[0].name, '国庆节');

assert.throws(() => normalizeWeatherLocation({ name: '坏坐标', latitude: 900, longitude: 0 }), /经纬度无效/);
const shanghai = normalizeWeatherLocation({
    name: '上海', latitude: 31.22222, longitude: 121.45806, country: '中国', timezone: 'Asia/Shanghai',
});
const weatherPayload = {
    daily: {
        time: ['2026-07-17', '2026-07-18'], weather_code: [1, 63],
        temperature_2m_max: [34, 31], temperature_2m_min: [27, 26],
    },
};
assert.equal(normalizeWeatherForecast(weatherPayload).attribution, WEATHER_ATTRIBUTION);
assert.throws(() => normalizeWeatherForecast({
    daily: { time: ['2026-01-01'], weather_code: [0], temperature_2m_max: [1], temperature_2m_min: [2] },
}), /无有效每日数据/);
const locations = await searchWeatherLocations('上海', {
    fetchImpl: async url => {
        assert.match(url, /language=zh/);
        return { ok: true, json: async () => ({ results: [shanghai] }) };
    },
});
assert.equal(locations[0].name, '上海');
const freshWeather = await fetchWeatherForecast(shanghai, {}, {
    fetchImpl: async url => {
        assert.match(url, /timezone=Asia%2FShanghai/);
        assert.match(url, /forecast_days=7/);
        return { ok: true, json: async () => weatherPayload };
    },
});
assert.equal(freshWeather.stale, false);
assert.equal(freshWeather.store.location.name, '上海');
assert.equal(freshWeather.store.lastSuccess.forecast.days.length, 2);
const staleWeather = await fetchWeatherForecast(shanghai, freshWeather.store, {
    fetchImpl: async () => { throw new Error('offline'); },
});
assert.equal(staleWeather.stale, true);
assert.equal(staleWeather.reason, 'network');
assert.equal(staleWeather.store.location.name, '上海');
assert.equal(staleWeather.locationKey, freshWeather.locationKey);
for (const [reason, response] of [
    ['http', { ok: false, status: 503 }],
    ['json', { ok: true, json: async () => { throw new Error('broken json'); } }],
]) {
    const fallback = await fetchWeatherForecast(shanghai, freshWeather.store, { fetchImpl: async () => response });
    assert.equal(fallback.stale, true);
    assert.equal(fallback.reason, reason);
    assert.equal(fallback.store.location.name, '上海');
    assert.equal(fallback.locationKey, freshWeather.locationKey);
}
await assert.rejects(fetchWeatherForecast(
    { ...shanghai, name: '东京' }, freshWeather.store,
    { fetchImpl: async () => { throw new Error('offline'); } },
), /获取失败/);
assert.equal(normalizeWeatherStore({ lastSuccess: { forecast: {} } }).lastSuccess, null);
assert.equal(normalizeWeatherStore({
    location: shanghai,
    lastSuccess: { locationKey: '35,139|东京', fetchedAt: 1, forecast: weatherPayload },
}).lastSuccess, null, '位置键不一致的缓存不得展示');

const storageA = 'sms_a__chat', storageB = 'sms_b__chat';
let cycleStore = createEmptyCycleStore();
cycleStore = upsertCycleScope(cycleStore, storageA, {
    enabled: true, lastPeriodStart: '2026-07-01', cycleLength: 28, periodLength: 5,
    overrides: { '2026-07-08': 'non_period', '2026-07-20': 'period' },
});
assert.equal(cycleScopeFor(cycleStore, storageB).enabled, false, '周期资料不得跨角色串档');
assert.equal(predictCyclePhase(cycleScopeFor(cycleStore, storageA), '2026-07-02').status, 'predicted');
assert.deepEqual(
    { phase: predictCyclePhase(cycleScopeFor(cycleStore, storageA), '2026-07-08').phase,
        status: predictCyclePhase(cycleScopeFor(cycleStore, storageA), '2026-07-08').status },
    { phase: null, status: 'override' },
);
assert.equal(predictCycleRange(cycleScopeFor(cycleStore, storageA), '2026-12-29', 7).predictions.at(-1).date, '2027-01-04');
assert.throws(() => upsertCycleScope(cycleStore, storageA, {
    enabled: true, lastPeriodStart: '2026-07-01', cycleLength: 280, periodLength: 5,
}), /周期长度必须/);
assert.throws(() => upsertCycleScope(cycleStore, storageA, {
    enabled: true, lastPeriodStart: 'bad', cycleLength: 28, periodLength: 5,
}), /日期无效/);
assert.throws(() => upsertCycleScope(cycleStore, storageA, {
    enabled: true, lastPeriodStart: null, cycleLength: 28, periodLength: 5,
}), /启用周期提示时必须设置/);
assert.doesNotThrow(() => upsertCycleScope(cycleStore, storageA, {
    enabled: false, lastPeriodStart: null, cycleLength: 28, periodLength: 5,
}));
cycleStore = clearCycleScope(cycleStore, storageA);
assert.equal(cycleScopeFor(cycleStore, storageA).enabled, false);

assert.equal(saveCalendarHolidays(holidayCache, storage), true);
assert.equal(loadCalendarHolidays(storage).selectedCountry, 'CN');
assert.equal(saveCalendarWeather(freshWeather.store, storage), true);
assert.equal(loadCalendarWeather(storage).location.name, '上海');
assert.equal(saveCalendarCycles(upsertCycleScope(createEmptyCycleStore(), storageA, {
    enabled: true, lastPeriodStart: '2026-07-01', cycleLength: 28, periodLength: 5,
}), storage), true);
assert.equal(loadCalendarCycles(storage).scopes[storageA].cycleLength, 28);
for (const [key, load] of [
    [CALENDAR_HOLIDAY_STORAGE_KEY, loadCalendarHolidays],
    [CALENDAR_WEATHER_STORAGE_KEY, loadCalendarWeather],
    [CALENDAR_CYCLE_STORAGE_KEY, loadCalendarCycles],
]) {
    memory.set(key, '{broken');
    assert.doesNotThrow(() => load(storage));
}

const currentDates = calendarWeekKeys(new Date(), 7);
const currentYear = Number(currentDates[0].slice(0, 4));
const holidayForToday = putHolidayYear(
    selectHolidayCountry({}, 'US'), 'US', currentYear,
    [{ date: currentDates[0], name: '<Holiday>', kind: 'holiday', source: 'test' }],
);
const currentWeather = normalizeWeatherStore({
    location: { name: '<Shanghai>', latitude: 31.2, longitude: 121.4, country: 'CN', timezone: 'Asia/Shanghai' },
    lastSuccess: {
        locationKey: '31.2,121.4|<Shanghai>', fetchedAt: 100,
        forecast: { days: [{ date: currentDates[0], weatherCode: 1, tempMin: 20, tempMax: 30 }] },
    },
});
const currentCycle = {
    enabled: true, lastPeriodStart: currentDates[0], cycleLength: 28, periodLength: 5, overrides: {},
};
const rendered = renderCalendarPageHtml(
    createEmptyCalendarScope(), { occasions: [] }, '<status>', holidayForToday, currentWeather, currentCycle,
    [{ name: '<Location>', latitude: 1, longitude: 2, country: '<Country>', admin1: '', timezone: 'UTC' }],
);
assert.match(rendered, /&lt;Holiday&gt;/);
assert.match(rendered, /少云/);
assert.match(rendered, /20°\/30°C/);
assert.match(rendered, /周期提示/);
assert.match(rendered, /仅用于本地日历提示|仅供日历提醒/);
assert.match(rendered, /Open-Meteo \(CC BY 4\.0\)/);
assert.match(rendered, /&lt;Location&gt;/);
for (const label of [
    '日程标题', '日程备注', '标签格式日程', '生日或纪念日名称', '生日或纪念日备注',
]) {
    assert.match(rendered, new RegExp(`aria-label="${label}"`), `${label} 控件必须有可访问名称`);
}
assert.doesNotMatch(rendered, /<Holiday>|<Location>|<status>/);
assert.doesNotMatch(
    rendered.match(/<section class="pm-calendar-day">[\s\S]*?<\/section>/)?.[0] || '',
    /暂无安排/,
    '有节假日、天气或周期提示的日期不应显示暂无安排',
);

const previousLocalStorage = globalThis.localStorage;
globalThis.localStorage = storage;
try {
    memory.clear();
    const container = { innerHTML: '' };
    const statusNode = { textContent: '' };
    const phoneWindow = {
        querySelector(selector) {
            if (selector === '.pm-calendar-page') return container;
            if (selector === '.pm-calendar-status') return statusNode;
            return null;
        },
    };
    const deps = {
        getStorageId: () => storageA,
        gatherContext: async () => ({}),
        callAI: async () => '{"version":1,"kind":"calendar_events","events":[]}',
        fetchImpl: async url => {
            if (String(url).includes('geocoding-api')) return { ok: true, json: async () => ({ results: [shanghai] }) };
            if (String(url).includes('api.open-meteo.com')) return { ok: true, json: async () => weatherPayload };
            throw new Error(`unexpected URL: ${url}`);
        },
    };
    installCalendar({ phoneWindow }, deps);
    assert.equal(deps.renderCalendar(storageA), true);
    assert.match(container.innerHTML, /生理周期（仅本地显示）/);

    const countryControl = { value: 'US' };
    const weatherQuery = { value: '上海' };
    const cycleForm = { elements: {
        enabled: { checked: true }, lastPeriodStart: { value: currentDates[0] },
        cycleLength: { value: '28' }, periodLength: { value: '5' },
    } };
    const app = { querySelector(selector) {
        if (selector === '[data-calendar-country]') return countryControl;
        if (selector === '[data-weather-query]') return weatherQuery;
        if (selector === '[data-calendar-cycle-editor]') return cycleForm;
        return null;
    } };
    await deps.handleCalendarAction({ dataset: { action: 'calendar-holiday-refresh' } }, app);
    assert.equal(deps.getCalendarHolidayStore().selectedCountry, 'US');
    await deps.handleCalendarAction({ dataset: { action: 'calendar-weather-search' } }, app);
    assert.match(container.innerHTML, /上海/);
    await deps.handleCalendarAction({ dataset: { action: 'calendar-weather-select', locationIndex: '0' } }, app);
    assert.equal(deps.getCalendarWeatherStore().location.name, '上海');
    await deps.handleCalendarAction({ dataset: { action: 'calendar-cycle-save' } }, app);
    assert.equal(deps.getCalendarCycleStore().scopes[storageA].enabled, true);
    assert.equal(deps.getCalendarCycleStore().scopes[storageB], undefined, '周期写入不得污染其他 storageId');

    memory.set(CALENDAR_HOLIDAY_STORAGE_KEY, JSON.stringify(selectHolidayCountry({}, 'JP')));
    memory.set(CALENDAR_CYCLE_STORAGE_KEY, JSON.stringify(upsertCycleScope(createEmptyCycleStore(), storageB, {
        enabled: true, lastPeriodStart: currentDates[0], cycleLength: 30, periodLength: 6,
    })));
    deps.reloadCalendarStore();
    assert.equal(deps.getCalendarHolidayStore().selectedCountry, 'JP');
    assert.equal(deps.getCalendarCycleStore().scopes[storageB].cycleLength, 30);
} finally {
    globalThis.localStorage = previousLocalStorage;
}

const deferred = () => {
    let resolve, reject;
    const promise = new Promise((resolve_, reject_) => { resolve = resolve_; reject = reject_; });
    return { promise, reject, resolve };
};

globalThis.localStorage = storage;
try {
    memory.clear();
    const container = { innerHTML: '' };
    const statusNode = { textContent: '' };
    const phoneWindow = {
        querySelector(selector) {
            if (selector === '.pm-calendar-page') return container;
            if (selector === '.pm-calendar-status') return statusNode;
            return null;
        },
    };
    let activeStorageId = storageA;
    let gatherImpl = async () => ({});
    let aiImpl = async () => '{"version":1,"kind":"calendar_events","events":[]}';
    let fetchImpl = async () => { throw new Error('unexpected fetch'); };
    let injectionCount = 0;
    let injectionImpl = async () => { injectionCount += 1; };
    const deps = {
        getStorageId: () => activeStorageId,
        gatherContext: () => gatherImpl(),
        callAI: (...args) => aiImpl(...args),
        fetchImpl: (...args) => fetchImpl(...args),
        applyBidirectionalInjection: () => injectionImpl(),
    };
    installCalendar({ phoneWindow }, deps);
    deps.renderCalendar(storageA);
    const app = { querySelector: () => null };
    const scanButton = { dataset: { action: 'calendar-scan' } };
    const dateTag = currentDates[0].replaceAll('-', ' ');

    const firstScan = deferred(), secondScan = deferred();
    let gatherCalls = 0;
    gatherImpl = () => (++gatherCalls === 1 ? firstScan.promise : secondScan.promise);
    const oldScanPromise = deps.handleCalendarAction(scanButton, app);
    const newScanPromise = deps.handleCalendarAction(scanButton, app);
    secondScan.resolve({ mainChatText: `<${dateTag}> 新意图`, worldBookText: '' });
    await newScanPromise;
    firstScan.resolve({ mainChatText: `<${dateTag}> 旧意图`, worldBookText: '' });
    await oldScanPromise;
    const racedEvents = deps.getCalendarStore().scopes[storageA].events[currentDates[0]] || [];
    assert.deepEqual(racedEvents.map(event => event.title), ['新意图'], '旧 scan 不得覆盖最后一次识别意图');

    const cancelledScan = deferred();
    gatherImpl = () => cancelledScan.promise;
    const beforeCancelledScan = structuredClone(deps.getCalendarStore());
    const cancelledScanPromise = deps.handleCalendarAction(scanButton, app);
    deps.cancelCalendarTasks('test-scan-cancel');
    cancelledScan.resolve({ mainChatText: `<${dateTag}> 取消后不得写入`, worldBookText: '' });
    await cancelledScanPromise;
    assert.deepEqual(deps.getCalendarStore(), beforeCancelledScan, '取消后的 scan 不得持久化');

    const ensureGather = deferred();
    let ensureAiCalls = 0;
    gatherImpl = () => ensureGather.promise;
    aiImpl = async () => { ensureAiCalls += 1; return '{"version":1,"kind":"calendar_events","events":[]}'; };
    const ensurePromise = deps.ensureCalendarWeek(storageA);
    deps.cancelCalendarTasks('test-ensure-cancel');
    ensureGather.resolve({ mainChatText: '', worldBookText: '' });
    assert.equal(await ensurePromise, false);
    assert.equal(ensureAiCalls, 0, '取消 ensureWeek 后不得继续请求 AI');

    gatherImpl = async () => ({ mainChatText: '', worldBookText: '' });
    const aiResponse = deferred(), aiStarted = deferred();
    let generatedSignal;
    aiImpl = async (systemPrompt, userPrompt, options) => {
        generatedSignal = options.signal;
        aiStarted.resolve();
        return aiResponse.promise;
    };
    const beforeCancelledGenerate = structuredClone(deps.getCalendarStore());
    const generatePromise = deps.handleCalendarAction({ dataset: { action: 'calendar-generate' } }, app);
    await aiStarted.promise;
    assert.ok(generatedSignal instanceof AbortSignal, '日历生成必须把 task signal 传给 AI 客户端');
    deps.cancelCalendarTasks('test-generate-cancel');
    assert.equal(generatedSignal.aborted, true);
    aiResponse.resolve('{"version":1,"kind":"calendar_events","events":[]}');
    await generatePromise;
    assert.deepEqual(deps.getCalendarStore(), beforeCancelledGenerate, '取消后的 AI 响应不得提交');

    const scanCommitEntered = deferred(), scanCommitRelease = deferred();
    let scanInjectionCalls = 0;
    injectionImpl = async () => {
        injectionCount += 1;
        scanInjectionCalls += 1;
        if (scanInjectionCalls === 1) {
            scanCommitEntered.resolve();
            await scanCommitRelease.promise;
        }
    };
    gatherImpl = async () => ({ mainChatText: `<${dateTag}> 提交窗口扫描`, worldBookText: '' });
    const beforeScanCommitCancel = structuredClone(deps.getCalendarStore());
    const beforeScanPersisted = memory.get('ST_SMS_CALENDAR_V1') || null;
    const beforeScanStatus = statusNode.textContent;
    const beforeScanHtml = container.innerHTML;
    const scanCommitPromise = deps.handleCalendarAction(scanButton, app);
    await scanCommitEntered.promise;
    assert.notDeepEqual(deps.getCalendarStore(), beforeScanCommitCancel, '测试必须进入保存后的注入窗口');
    deps.cancelCalendarTasks('test-scan-commit-cancel');
    scanCommitRelease.resolve();
    await scanCommitPromise;
    assert.deepEqual(deps.getCalendarStore(), beforeScanCommitCancel, 'scan 提交窗口取消后必须恢复内存状态');
    assert.equal(memory.get('ST_SMS_CALENDAR_V1') || null, beforeScanPersisted, 'scan 提交窗口取消后必须恢复持久化状态');
    assert.equal(scanInjectionCalls, 2, 'scan 取消补偿必须重新注入恢复后的状态');
    assert.equal(statusNode.textContent, beforeScanStatus);
    assert.equal(container.innerHTML, beforeScanHtml);

    const generateCommitEntered = deferred(), generateCommitRelease = deferred();
    let generateInjectionCalls = 0;
    injectionImpl = async () => {
        injectionCount += 1;
        generateInjectionCalls += 1;
        if (generateInjectionCalls === 1) {
            generateCommitEntered.resolve();
            await generateCommitRelease.promise;
        }
    };
    gatherImpl = async () => ({ mainChatText: '', worldBookText: '' });
    aiImpl = async () => JSON.stringify({
        version: 1, kind: 'calendar_events',
        events: [{ date: currentDates[0], title: '提交窗口生成', note: '' }],
    });
    const beforeGenerateCommitCancel = structuredClone(deps.getCalendarStore());
    const beforeGeneratePersisted = memory.get('ST_SMS_CALENDAR_V1') || null;
    const beforeGenerateStatus = statusNode.textContent;
    const beforeGenerateHtml = container.innerHTML;
    const generateCommitPromise = deps.handleCalendarAction({ dataset: { action: 'calendar-generate' } }, app);
    await generateCommitEntered.promise;
    assert.notDeepEqual(deps.getCalendarStore(), beforeGenerateCommitCancel, '测试必须进入 AI 保存后的注入窗口');
    deps.cancelCalendarTasks('test-generate-commit-cancel');
    generateCommitRelease.resolve();
    await generateCommitPromise;
    assert.deepEqual(deps.getCalendarStore(), beforeGenerateCommitCancel, 'AI 提交窗口取消后必须恢复内存状态');
    assert.equal(memory.get('ST_SMS_CALENDAR_V1') || null, beforeGeneratePersisted, 'AI 提交窗口取消后必须恢复持久化状态');
    assert.equal(generateInjectionCalls, 2, 'AI 取消补偿必须重新注入恢复后的状态');
    assert.equal(statusNode.textContent, beforeGenerateStatus, '取消后的生成状态不得停留在进行中');
    assert.equal(container.innerHTML, beforeGenerateHtml, '取消后的生成不得重渲染页面');

    let diagnosticFailureCalls = 0;
    injectionImpl = async () => {
        injectionCount += 1;
        diagnosticFailureCalls += 1;
        if (diagnosticFailureCalls === 1) {
            return { written: 1, failedWrites: 1, cleared: 1, failedKeys: ['PHONE_SMS_MEMORY:stale'] };
        }
        return { written: 1, failedWrites: 0, cleared: 1, failedKeys: [] };
    };
    gatherImpl = async () => ({ mainChatText: `<${dateTag}> 注入诊断失败`, worldBookText: '' });
    const beforeDiagnosticFailure = structuredClone(deps.getCalendarStore());
    const beforeDiagnosticPersisted = memory.get('ST_SMS_CALENDAR_V1') || null;
    const beforeDiagnosticStatus = statusNode.textContent;
    const beforeDiagnosticHtml = container.innerHTML;
    await assert.rejects(
        deps.handleCalendarAction(scanButton, app),
        error => error?.message === '日历提交注入失败：1 项写入失败，1 项清理失败'
            && error.injectionResult?.failedWrites === 1,
        '注入返回失败诊断时必须把提交视为失败',
    );
    assert.deepEqual(deps.getCalendarStore(), beforeDiagnosticFailure, '注入失败诊断必须回滚日历内存状态');
    assert.equal(memory.get('ST_SMS_CALENDAR_V1') || null, beforeDiagnosticPersisted, '注入失败诊断必须回滚日历持久化状态');
    assert.equal(diagnosticFailureCalls, 2, '注入失败诊断必须执行一次补偿注入');
    assert.equal(statusNode.textContent, beforeDiagnosticStatus);
    assert.equal(container.innerHTML, beforeDiagnosticHtml);

    let compensationFailureCalls = 0;
    injectionImpl = async () => {
        injectionCount += 1;
        compensationFailureCalls += 1;
        if (compensationFailureCalls === 1) return { written: 0, failedWrites: 2, cleared: 1, failedKeys: [] };
        return { written: 1, failedWrites: 0, cleared: 0, failedKeys: ['PHONE_SMS_MEMORY:calendar:story-a'] };
    };
    gatherImpl = async () => ({ mainChatText: `<${dateTag}> 补偿诊断失败`, worldBookText: '' });
    const beforeCompensationFailure = structuredClone(deps.getCalendarStore());
    const beforeCompensationPersisted = memory.get('ST_SMS_CALENDAR_V1') || null;
    await assert.rejects(deps.handleCalendarAction(scanButton, app), error => {
        assert.equal(error?.calendarRollbackError, true);
        assert.equal(error?.cause?.injectionResult?.failedWrites, 2);
        assert.deepEqual(error?.rollbackError?.injectionResult?.failedKeys, ['PHONE_SMS_MEMORY:calendar:story-a']);
        assert.match(error.message, /日历提交注入失败：2 项写入失败；日历状态回滚失败：日历补偿注入失败：1 项清理失败/);
        return true;
    });
    assert.deepEqual(deps.getCalendarStore(), beforeCompensationFailure, '补偿注入失败时内存 store 仍必须恢复为旧快照');
    assert.equal(memory.get('ST_SMS_CALENDAR_V1') || null, beforeCompensationPersisted, '补偿注入失败时持久化 store 仍必须恢复为旧快照');
    assert.equal(compensationFailureCalls, 2);

    injectionImpl = async () => { injectionCount += 1; };
    const searchResponses = [deferred(), deferred()];
    let searchRequest = 0;
    const searchSignals = [];
    fetchImpl = async (url, options) => {
        searchSignals.push(options.signal);
        return searchResponses[searchRequest++].promise;
    };
    const weatherQuery = { value: '上海' };
    const weatherApp = { querySelector(selector) { return selector === '[data-weather-query]' ? weatherQuery : null; } };
    const oldSearchPromise = deps.handleCalendarAction({ dataset: { action: 'calendar-weather-search' } }, weatherApp);
    weatherQuery.value = '东京';
    const newSearchPromise = deps.handleCalendarAction({ dataset: { action: 'calendar-weather-search' } }, weatherApp);
    assert.equal(searchSignals[0].aborted, true, '新天气搜索必须取消旧搜索');
    const tokyo = { name: '东京', latitude: 35.68, longitude: 139.76, country: '日本', admin1: '东京', timezone: 'Asia/Tokyo' };
    searchResponses[1].resolve({ ok: true, json: async () => ({ results: [tokyo] }) });
    await newSearchPromise;
    searchResponses[0].resolve({ ok: true, json: async () => ({ results: [shanghai] }) });
    await oldSearchPromise;
    assert.match(container.innerHTML, /东京/);
    assert.doesNotMatch(container.innerHTML, /data-location-index="0"[^>]*>[^<]*上海/);

    const holidayResponse = deferred();
    let holidaySignal;
    fetchImpl = async (url, options) => { holidaySignal = options.signal; return holidayResponse.promise; };
    const countryControl = { value: 'CN' };
    const holidayApp = { querySelector(selector) { return selector === '[data-calendar-country]' ? countryControl : null; } };
    const cnPromise = deps.handleCalendarAction({ dataset: { action: 'calendar-holiday-refresh' } }, holidayApp);
    countryControl.value = 'US';
    await deps.handleCalendarAction({ dataset: { action: 'calendar-holiday-refresh' } }, holidayApp);
    assert.equal(holidaySignal.aborted, true, '后续节假日刷新必须取消旧网络请求');
    holidayResponse.resolve({ ok: true, json: async () => ({ holidays: { [`${currentYear}-10-01`]: 'National Day,国庆节,1' } }) });
    await cnPromise;
    assert.equal(deps.getCalendarHolidayStore().selectedCountry, 'US', '过期 CN 响应不得覆盖最后选择的国家');
    assert.ok(injectionCount >= 1, '有效 scan 应刷新双向注入');
} finally {
    globalThis.localStorage = previousLocalStorage;
}

console.log('Calendar checks passed.');
