import { BUDGET_CONFIG_KEY } from './budget.js';
import { createEmptyCalendarStore, migrateLegacyCalendarInjectionConfig, normalizeCalendarStore } from './calendar-model.js';
import { createEmptyOccasionStore, normalizeOccasionStore } from './calendar-occasion-model.js';
import { createEmptyCycleStore, normalizeCycleStore } from './calendar-cycle-model.js';
import { createEmptyHolidayCache, normalizeHolidayCache } from './calendar-holiday.js';
import { createEmptyRecipeStore, normalizeRecipeStore } from './calendar-recipe-model.js';
import { createEmptyWeatherStore, normalizeWeatherStore } from './calendar-weather.js';
import {
    CALENDAR_CYCLE_STORAGE_KEY, CALENDAR_HOLIDAY_STORAGE_KEY, CALENDAR_OCCASION_STORAGE_KEY,
    CALENDAR_RECIPE_STORAGE_KEY, CALENDAR_STORAGE_KEY, CALENDAR_WEATHER_STORAGE_KEY,
} from './constants.js';

function loadStore(key, normalize, empty, label, storage = globalThis.localStorage) {
    try {
        const raw = storage?.getItem(key);
        return raw ? normalize(JSON.parse(raw)) : empty();
    } catch (error) {
        console.warn(`[phone-mode] ${label}读取失败`, error);
        return empty();
    }
}

function saveStore(key, value, normalize, label, storage = globalThis.localStorage) {
    try {
        if (!storage || typeof storage.setItem !== 'function') throw new Error('localStorage 不可用');
        storage.setItem(key, JSON.stringify(normalize(value)));
        return true;
    } catch (error) {
        console.error(`[phone-mode] ${label}保存失败`, error);
        return false;
    }
}

export const loadCalendar = storage => loadStore(
    CALENDAR_STORAGE_KEY, normalizeCalendarStore, createEmptyCalendarStore, '日历数据', storage,
);
export const saveCalendar = (store, storage) => saveStore(
    CALENDAR_STORAGE_KEY, store, normalizeCalendarStore, '日历数据', storage,
);
export function loadCalendarWithLegacyInjectionMigration(storage = globalThis.localStorage) {
    const current = loadCalendar(storage);
    try {
        const rawBudget = storage?.getItem(BUDGET_CONFIG_KEY);
        if (!rawBudget) return current;
        const legacyConfig = JSON.parse(rawBudget);
        const rawCalendar = storage?.getItem(CALENDAR_STORAGE_KEY);
        const sourceStore = rawCalendar ? JSON.parse(rawCalendar) : current;
        const migration = migrateLegacyCalendarInjectionConfig(sourceStore, legacyConfig);
        if (!migration.migrated) return migration.store;
        if (!saveCalendar(migration.store, storage)) {
            console.warn('[phone-mode] 旧日历注入配置迁移未能持久化');
            return current;
        }
        return migration.store;
    } catch (error) {
        console.warn('[phone-mode] 旧日历注入配置迁移失败', error);
        return current;
    }
}
export const loadCalendarOccasions = storage => loadStore(
    CALENDAR_OCCASION_STORAGE_KEY, normalizeOccasionStore, createEmptyOccasionStore, '生日与纪念日数据', storage,
);
export const saveCalendarOccasions = (store, storage) => saveStore(
    CALENDAR_OCCASION_STORAGE_KEY, store, normalizeOccasionStore, '生日与纪念日数据', storage,
);
export const loadCalendarHolidays = storage => loadStore(
    CALENDAR_HOLIDAY_STORAGE_KEY, normalizeHolidayCache, createEmptyHolidayCache, '节假日缓存', storage,
);
export const saveCalendarHolidays = (store, storage) => saveStore(
    CALENDAR_HOLIDAY_STORAGE_KEY, store, normalizeHolidayCache, '节假日缓存', storage,
);
export const loadCalendarWeather = storage => loadStore(
    CALENDAR_WEATHER_STORAGE_KEY, normalizeWeatherStore, createEmptyWeatherStore, '天气数据', storage,
);
export const saveCalendarWeather = (store, storage) => saveStore(
    CALENDAR_WEATHER_STORAGE_KEY, store, normalizeWeatherStore, '天气数据', storage,
);
export const loadCalendarCycles = storage => loadStore(
    CALENDAR_CYCLE_STORAGE_KEY, normalizeCycleStore, createEmptyCycleStore, '生理周期数据', storage,
);
export const saveCalendarCycles = (store, storage) => saveStore(
    CALENDAR_CYCLE_STORAGE_KEY, store, normalizeCycleStore, '生理周期数据', storage,
);
export const loadCalendarRecipes = storage => loadStore(
    CALENDAR_RECIPE_STORAGE_KEY, normalizeRecipeStore, createEmptyRecipeStore, '菜谱数据', storage,
);
export const saveCalendarRecipes = (store, storage) => saveStore(
    CALENDAR_RECIPE_STORAGE_KEY, store, normalizeRecipeStore, '菜谱数据', storage,
);
