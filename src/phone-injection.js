import {
    BIDIRECTIONAL_KEY, BIDIRECTIONAL_LIMIT, DEFAULT_GROUP_INJECTION, MAX_INJECTION_CHARS,
} from './constants.js';
import { allocateContextBudget, estimateContextTokens, normalizeBudgetConfig, trimToEstimatedTokens } from './budget.js';
import { formatQuoteContext } from './chat-message-model.js';
import { renderCommunitySource } from './community-injection.js';
import { resolveEmojiText } from './messaging.js';
import { resolveCommunitySources, resolvePhoneSources } from './permissions.js';
import {
    calendarDateRangeKeys, calendarReferenceDate, calendarScopeFor, relativeCalendarLabel,
} from './calendar-model.js';
import { occasionScopeFor, expandOccasions } from './calendar-occasion-model.js';
import { buildCulturalFestivals, HOLIDAY_YEAR_RANGE, holidayYearFromCache, mergeCalendarDateFacts, normalizeHolidayCache } from './calendar-holiday.js';
import { CYCLE_SELF_SUBJECT, cycleScopeFor, cycleSubjectKeys, predictCycleRange } from './calendar-cycle-model.js';
import { recipeScopeFor, renderRecipeInjection } from './calendar-recipe-model.js';
import { weatherCodeLabel } from './calendar-weather.js';
import { resolveWeatherForDate } from './calendar-weather-source.js';

const COMMUNITY_KEY_PREFIX = `${BIDIRECTIONAL_KEY}:community:`;
const CALENDAR_KEY_PREFIX = `${BIDIRECTIONAL_KEY}:calendar:`;
const RECIPE_KEY_PREFIX = `${BIDIRECTIONAL_KEY}:recipe:`;

function injectionKey(name) {
    return `${BIDIRECTIONAL_KEY}:${encodeURIComponent(name)}`;
}

function promptRuntimeKeys(runtime) {
    return new Set([BIDIRECTIONAL_KEY, ...(runtime.trackedExtensionPromptKeys instanceof Set ? runtime.trackedExtensionPromptKeys : [])]);
}

export function clearExtensionPrompts({ context, runtime }) {
    const previousKeys = promptRuntimeKeys(runtime);
    if (!context || typeof context.setExtensionPrompt !== 'function') {
        return { cleared: 0, failedKeys: [...previousKeys] };
    }
    const failedKeys = new Set();
    let cleared = 0;
    for (const key of previousKeys) {
        try {
            context.setExtensionPrompt(key, '', 0, 0, false, 0);
            cleared += 1;
        } catch (error) {
            failedKeys.add(key);
        }
    }
    runtime.trackedExtensionPromptKeys = failedKeys;
    return { cleared, failedKeys: [...failedKeys] };
}

export function replaceExtensionPrompts({ context, runtime, prompts }) {
    const clearResult = clearExtensionPrompts({ context, runtime });
    if (!context || typeof context.setExtensionPrompt !== 'function') {
        return { written: 0, failedWrites: 0, ...clearResult };
    }
    const activeKeys = new Set(runtime.trackedExtensionPromptKeys);
    const seen = new Set();
    let written = 0;
    let failedWrites = 0;
    for (const prompt of Array.isArray(prompts) ? prompts : []) {
        if (!prompt || typeof prompt.key !== 'string' || !prompt.key || seen.has(prompt.key)
            || typeof prompt.content !== 'string' || !prompt.content) continue;
        seen.add(prompt.key);
        try {
            context.setExtensionPrompt(prompt.key, prompt.content, prompt.position, prompt.depth, false, 0);
            activeKeys.add(prompt.key);
            written += 1;
        } catch (error) {
            failedWrites += 1;
        }
    }
    runtime.trackedExtensionPromptKeys = activeKeys;
    return { written, failedWrites, ...clearResult };
}

function renderPhoneSource(source, userName, emojis) {
    const limit = source.meta ? source.meta.injection?.historyLimit : BIDIRECTIONAL_LIMIT;
    const historyLimit = Number.isInteger(limit) && limit > 0 ? limit : BIDIRECTIONAL_LIMIT;
    return renderConversation(source.name, source.history.slice(-historyLimit), source.meta, userName, emojis);
}

function phonePromptPosition(source) {
    const injection = source.meta?.injection || DEFAULT_GROUP_INJECTION;
    return {
        position: typeof injection.position === 'number' ? injection.position : DEFAULT_GROUP_INJECTION.position,
        depth: typeof injection.depth === 'number' ? injection.depth : DEFAULT_GROUP_INJECTION.depth,
    };
}

function allocateRenderedPrompts(items, tokenLimit) {
    const prompts = [];
    let remaining = tokenLimit;
    let truncatedCount = 0;
    for (const item of items) {
        if (remaining <= 0) break;
        const trimmed = trimToEstimatedTokens(item.content, remaining);
        if (!trimmed.text) continue;
        prompts.push({ ...item, content: trimmed.text });
        remaining -= trimmed.estimatedTokens;
        if (trimmed.truncated) truncatedCount += 1;
    }
    return { prompts, usedTokens: tokenLimit - remaining, truncatedCount };
}

const CYCLE_INJECTION_LABELS = Object.freeze({
    period: '经期', follicular: '安全期', ovulatory: '易孕期', luteal: '安全期',
});

export function renderCalendarContextInjection({
    currentStorageId, currentActorName, calendarStore, occasionStore, holidayStore, weatherStore, cycleStore,
    start,
} = {}) {
    if (!currentStorageId) return '';
    const calendarScope = calendarScopeFor(calendarStore, currentStorageId);
    const windowStart = calendarReferenceDate(calendarScope, start);
    const regularDates = calendarDateRangeKeys(windowStart, -3, 6);
    const occasionDates = calendarDateRangeKeys(windowStart, 0, 59);
    const linesByDate = new Map();
    const addFact = (date, fact) => {
        if (!fact) return;
        if (!linesByDate.has(date)) linesByDate.set(date, new Set());
        linesByDate.get(date).add(fact);
    };
    for (const date of regularDates) {
        if (weatherStore?.location) {
            const weather = resolveWeatherForDate(weatherStore, date);
            if (weather.status === 'available') {
                addFact(date, `天气（${weather.sourceLabel}）：${weatherCodeLabel(weather.day.weatherCode)}，${weather.day.tempMin}°/${weather.day.tempMax}°C`);
            }
        }
        for (const event of calendarScope.events[date] || []) {
            const note = event.note ? `（${event.note.replace(/\s+/g, ' ').slice(0, 180)}）` : '';
            addFact(date, `日程：${event.title}${note}`);
        }
    }
    const occasions = expandOccasions(occasionScopeFor(occasionStore, currentStorageId), { start: windowStart, days: 60 });
    for (const occasion of occasions) {
        const kind = occasion.type === 'birthday' ? '生日' : '纪念日';
        addFact(occasion.date, `${kind}：${occasion.title}${occasion.note ? `（${occasion.note.replace(/\s+/g, ' ').slice(0, 180)}）` : ''}`);
    }
    const holidays = normalizeHolidayCache(holidayStore);
    const holidayYears = [...new Set(regularDates.map(date => Number(date.slice(0, 4))))];
    for (const year of holidayYears) {
        const legal = holidayYearFromCache(holidays, holidays.selectedCountry, year)?.entries || [];
        const cultural = year >= HOLIDAY_YEAR_RANGE.min && year <= HOLIDAY_YEAR_RANGE.max
            ? buildCulturalFestivals(year) : [];
        for (const item of mergeCalendarDateFacts(legal, cultural)) {
            if (!regularDates.includes(item.date)) continue;
            const kind = item.kind === 'workday' ? '调休工作日' : item.kind === 'in_lieu' ? '调休'
                : item.kind === 'observed' ? '替代休息日' : item.kind === 'cultural' ? '文化节日' : '节假日';
            addFact(item.date, `${kind}：${item.name}`);
        }
    }
    const cycleDates = new Set(calendarDateRangeKeys(windowStart, 0, 6));
    for (const subject of cycleSubjectKeys(cycleStore, currentStorageId)) {
        const profile = cycleScopeFor(cycleStore, currentStorageId, subject);
        if (!profile.enabled) continue;
        const subjectLabel = subject === CYCLE_SELF_SUBJECT ? '我'
            : subject.startsWith('role:') ? subject.slice(5) : subject || currentActorName || '当前角色';
        for (const prediction of predictCycleRange(profile, calendarDateRangeKeys(windowStart, 0, 0)[0], 7).predictions) {
            if (!cycleDates.has(prediction.date) || !prediction.phase) continue;
            addFact(prediction.date, `生理周期（${subjectLabel}）：${CYCLE_INJECTION_LABELS[prediction.phase] || prediction.phase}`);
        }
    }
    const outputDates = [...new Set([...regularDates, ...occasionDates.filter(date => linesByDate.has(date))])].sort();
    return outputDates.flatMap(date => {
        const facts = [...(linesByDate.get(date) || [])];
        if (!facts.length) return [];
        const relative = relativeCalendarLabel(windowStart, date);
        return `${relative ? `${relative} ` : ''}${date}｜${facts.join('；')}`;
    }).join('\n').slice(0, 6000);
}

export function buildContextInjectionPrompts({
    currentStorageId, currentActorName, selectedByStorage, historiesByStorage, groupsByStorage,
    interactiveStore, budgetConfig, userName, emojis, safeMaxTokens, calendarStore,
    calendarOccasions, calendarHolidays, calendarWeather, calendarCycles, calendarRecipes,
} = {}) {
    const config = normalizeBudgetConfig(budgetConfig);
    const phonePermission = resolvePhoneSources({
        currentStorageId, currentActorName, selectedByStorage, historiesByStorage, groupsByStorage,
    });
    const communityPermission = resolveCommunitySources({
        currentStorageId,
        enabled: config.communityEnabled,
        sceneIdsByStorage: config.communitySceneIdsByStorage,
        selectionsByStorage: config.communitySelectionsByStorage,
        store: interactiveStore,
    });
    const phoneItems = phonePermission.allowed ? phonePermission.sources.flatMap(source => {
        const placement = phonePromptPosition(source);
        if (placement.position < 0) return [];
        const body = renderPhoneSource(source, userName, emojis);
        if (!body) return [];
        return [{
            key: injectionKey(source.sourceId),
            content: `[手机短信记忆 — 私密]\n${body}\n[结束]`,
            ...placement,
        }];
    }) : [];
    const communityItems = communityPermission.allowed ? communityPermission.sources.flatMap(source => {
        const body = renderCommunitySource(source);
        if (!body) return [];
        return [{
            key: `${COMMUNITY_KEY_PREFIX}${encodeURIComponent(source.sourceId)}`,
            content: `[互动社区记忆 — 当前角色可见]\n${body}\n[结束]`,
            position: config.communityPosition,
            depth: config.communityDepth,
        }];
    }) : [];
    let calendarItems = [];
    if (config.calendarEnabled && calendarStore && currentStorageId) {
        const body = renderCalendarContextInjection({
            currentStorageId, currentActorName, calendarStore, occasionStore: calendarOccasions,
            holidayStore: calendarHolidays, weatherStore: calendarWeather, cycleStore: calendarCycles,
        });
        if (body) {
            calendarItems.push({
                key: `${CALENDAR_KEY_PREFIX}${encodeURIComponent(currentStorageId)}`,
                content: `[生活日历]\n${body}\n[结束]`,
                position: config.calendarPosition,
                depth: config.calendarDepth,
            });
        }
    }
    const recipeItems = [];
    if (config.recipeEnabled && calendarRecipes && calendarStore && currentStorageId) {
        const calendarScope = calendarScopeFor(calendarStore, currentStorageId);
        const body = renderRecipeInjection(recipeScopeFor(calendarRecipes, currentStorageId), {
            start: calendarReferenceDate(calendarScope),
        });
        if (body) {
            recipeItems.push({
                key: `${RECIPE_KEY_PREFIX}${encodeURIComponent(currentStorageId)}`,
                content: `[角色菜谱]
${body}
[结束]`,
                position: config.recipePosition,
                depth: config.recipeDepth,
            });
        }
    }
    const demandBySource = {
        phone: phoneItems.reduce((sum, item) => sum + estimateContextTokens(item.content).estimatedTokens, 0),
        community: communityItems.reduce((sum, item) => sum + estimateContextTokens(item.content).estimatedTokens, 0),
        calendar: calendarItems.reduce((sum, item) => sum + estimateContextTokens(item.content).estimatedTokens, 0),
        recipe: recipeItems.reduce((sum, item) => sum + estimateContextTokens(item.content).estimatedTokens, 0),
    };
    const budget = allocateContextBudget({ config, safeMaxTokens, demandBySource });
    const phone = allocateRenderedPrompts(phoneItems, budget.allocations.phone);
    const community = allocateRenderedPrompts(communityItems, budget.allocations.community);
    const calendar = allocateRenderedPrompts(calendarItems, budget.allocations.calendar);
    const recipe = allocateRenderedPrompts(recipeItems, budget.allocations.recipe);
    return {
        prompts: [...phone.prompts, ...community.prompts, ...calendar.prompts, ...recipe.prompts],
        diagnostics: {
            estimated: true,
            budget,
            phonePermission: { allowed: phonePermission.allowed, reason: phonePermission.reason, sourceCount: phonePermission.sources.length },
            communityPermission: { allowed: communityPermission.allowed, reason: communityPermission.reason, sourceCount: communityPermission.sources.length },
            calendarEnabled: config.calendarEnabled,
            recipeEnabled: config.recipeEnabled,
            usedTokens: phone.usedTokens + community.usedTokens + calendar.usedTokens + recipe.usedTokens,
            truncatedCount: phone.truncatedCount + community.truncatedCount + calendar.truncatedCount + recipe.truncatedCount,
        },
    };
}

export function applyContextInjections({ context, runtime, ...input }) {
    const plan = buildContextInjectionPrompts(input);
    return { ...replaceExtensionPrompts({ context, runtime, prompts: plan.prompts }), diagnostics: plan.diagnostics };
}

function renderConversation(name, history, meta, userName, emojis) {
    const lines = history.map(message => {
        const text = resolveEmojiText((message.content || '').replace(/\s*\/\s*/g, '。').replace(/\n/g, '；'), emojis);
        const quote = formatQuoteContext(message.quote);
        const body = [quote ? `【${quote}】` : '', text].filter(Boolean).join(' ');
        const director = message.directorNote ? `【剧情引导：${message.directorNote}】` : '';
        if (message.role === 'user') return [body ? `${userName}：${body}` : '', director].filter(Boolean).join(' ');
        return meta ? body : `${name}：${body}`;
    }).filter(Boolean).join('\n');
    if (!lines) return '';
    return meta
        ? `【群聊"${meta.name}"（成员：${meta.members.join('、')}）的最近聊天 — 仅参与者与 ${userName} 知晓，其他角色不应知情】\n${lines}`
        : `【与 ${name} 的短信 — 仅 ${name} 与 ${userName} 知晓】\n${lines}`;
}

export function applyConversationInjections({ context, runtime, checked, histories, groups, userName, emojis }) {
    const prompts = [];
    let remaining = MAX_INJECTION_CHARS;
    for (const name of Array.isArray(checked) ? checked : []) {
        const meta = name.startsWith('__group_') ? groups?.[name] : null;
        const injection = meta?.injection || DEFAULT_GROUP_INJECTION;
        if (injection.position < 0 || remaining <= 0) continue;
        const historyLimit = meta ? injection.historyLimit : BIDIRECTIONAL_LIMIT;
        const history = (histories?.[name] || []).slice(-historyLimit);
        let content = renderConversation(name, history, meta, userName, emojis);
        if (!content) continue;
        if (content.length > remaining) {
            const marker = '【较早内容因资源预算已省略】\n';
            content = marker + content.slice(-(Math.max(0, remaining - marker.length)));
        }
        if (!content || content.length > remaining) continue;
        prompts.push({
            key: injectionKey(name),
            content: `[手机短信记忆 — 私密]\n${content}\n[结束]`,
            position: injection.position,
            depth: injection.depth,
        });
        remaining -= content.length;
    }
    return replaceExtensionPrompts({ context, runtime, prompts });
}
