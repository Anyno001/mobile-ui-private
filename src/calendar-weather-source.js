export const WEATHER_SOURCE_FORECAST = 'forecast';
export const WEATHER_SOURCE_CACHED_FORECAST = 'cached_forecast';
export const WEATHER_SOURCE_CLIMATE_ESTIMATE = 'climate_estimate';
export const WEATHER_SOURCE_STORY_EVENT = 'story_weather_event';

const STORY_WEATHER_EVENT_TYPES = Object.freeze({
    clear_spell: { label: '短暂放晴', codes: [0, 1] },
    rainy_spell: { label: '阴雨过程', codes: [3, 61, 80] },
    thunderstorm: { label: '强对流', codes: [80, 95] },
    tropical_storm: { label: '热带风暴影响', codes: [80, 95] },
});

const SOURCE_LABELS = Object.freeze({
    [WEATHER_SOURCE_FORECAST]: '真实预报',
    [WEATHER_SOURCE_CACHED_FORECAST]: '缓存预报',
    [WEATHER_SOURCE_CLIMATE_ESTIMATE]: '气候推演',
    [WEATHER_SOURCE_STORY_EVENT]: '剧情天气事件覆盖',
});

export const weatherSourceLabel = source => SOURCE_LABELS[source] || '无法推演';
export const isStoredWeatherSource = source => source === WEATHER_SOURCE_FORECAST
    || source === WEATHER_SOURCE_CACHED_FORECAST;

function dateParts(value) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
    if (!match) return null;
    const year = Number(match[1]), month = Number(match[2]), day = Number(match[3]);
    if (year < 1 || year > 9999 || month < 1 || month > 12) return null;
    const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    return day >= 1 && day <= days[month - 1] ? { year, month, day, daysInMonth: days[month - 1] } : null;
}

export const isValidWeatherDate = value => dateParts(value) !== null;

export const storyWeatherEventLabel = type => STORY_WEATHER_EVENT_TYPES[type]?.label || '未知天气事件';

function shiftWeatherDate(date, offset) {
    const parts = dateParts(date);
    if (!parts || !Number.isInteger(offset)) return null;
    const value = new Date(2000, parts.month - 1, parts.day, 12);
    value.setFullYear(parts.year);
    value.setDate(value.getDate() + offset);
    const year = value.getFullYear();
    if (year < 1 || year > 9999) return null;
    return `${String(year).padStart(4, '0')}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
}

export function weatherLocationKey(location) {
    const latitude = Number(location?.latitude), longitude = Number(location?.longitude);
    const name = typeof location?.name === 'string' ? location.name.trim() : '';
    if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90
        || !Number.isFinite(longitude) || longitude < -180 || longitude > 180 || !name) return '';
    return `${latitude},${longitude}|${name}`;
}

export function normalizeStoryWeatherEvent(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const type = typeof value.type === 'string' && Object.hasOwn(STORY_WEATHER_EVENT_TYPES, value.type) ? value.type : '';
    const startDate = isValidWeatherDate(value.startDate) ? String(value.startDate) : '';
    const locationKey = typeof value.locationKey === 'string' ? value.locationKey.trim().slice(0, 500) : '';
    const rawDays = Array.isArray(value.days) ? value.days : [];
    if (!type || !startDate || !locationKey || rawDays.length < 1 || rawDays.length > 3) return null;
    const days = rawDays.map(item => {
        if (!item || typeof item !== 'object' || Array.isArray(item) || !isValidWeatherDate(item.date)) return null;
        const weatherCode = Number(item.weatherCode), tempMin = Number(item.tempMin), tempMax = Number(item.tempMax);
        if (!Number.isInteger(weatherCode) || weatherCode < 0 || weatherCode > 99
            || !STORY_WEATHER_EVENT_TYPES[type].codes.includes(weatherCode)
            || !Number.isFinite(tempMin) || !Number.isFinite(tempMax) || tempMin > tempMax) return null;
        return { date: String(item.date), weatherCode, tempMin: Math.round(tempMin), tempMax: Math.round(tempMax) };
    });
    if (days.includes(null) || days[0].date !== startDate) return null;
    for (let index = 1; index < days.length; index++) {
        if (days[index].date !== shiftWeatherDate(startDate, index)) return null;
    }
    return Object.freeze({
        id: typeof value.id === 'string' && value.id.trim() ? value.id.trim().slice(0, 80) : `weather_${startDate}`,
        type, startDate, endDate: days.at(-1).date, locationKey, days: Object.freeze(days),
    });
}

export function storyWeatherEventForDate(event, date) {
    const normalized = normalizeStoryWeatherEvent(event);
    if (!normalized || !isValidWeatherDate(date)) return null;
    const day = normalized.days.find(item => item.date === date);
    return day ? { event: normalized, day } : null;
}

export function createStoryWeatherEvent(weatherStore, referenceDate, storageId = '') {
    const startDate = shiftWeatherDate(referenceDate, 1);
    const location = weatherStore?.location;
    if (!startDate || !location || !String(storageId).trim()) return null;
    const locationKey = weatherLocationKey(location);
    if (!locationKey) return null;
    const seed = `${String(storageId).trim()}|${location.latitude},${location.longitude}|${location.name}|${startDate}`;
    const typeKeys = Object.keys(STORY_WEATHER_EVENT_TYPES);
    const type = typeKeys[stableHash(`${seed}|type`) % typeKeys.length];
    const length = 1 + stableHash(`${seed}|length`) % 3;
    const days = [];
    for (let index = 0; index < length; index++) {
        const date = shiftWeatherDate(startDate, index);
        if (!date) break;
        const base = resolveWeatherForDate(weatherStore, date);
        if (base.status !== 'available') return null;
        const codes = STORY_WEATHER_EVENT_TYPES[type].codes;
        const weatherCode = codes[stableHash(`${seed}|code|${index}`) % codes.length];
        const cooling = type === 'clear_spell' ? 0 : type === 'tropical_storm' ? 4 : 2;
        const tempMin = Math.max(-80, base.day.tempMin - cooling);
        const tempMax = Math.max(tempMin + 1, Math.min(55, base.day.tempMax - cooling));
        days.push({ date, weatherCode, tempMin, tempMax });
    }
    return normalizeStoryWeatherEvent({ id: `weather_${stableHash(seed).toString(36)}`, type, startDate, locationKey, days });
}

function stableHash(value) {
    let hash = 2166136261;
    for (const char of String(value)) {
        hash ^= char.codePointAt(0);
        hash = Math.imul(hash, 16777619);
    }
    hash ^= hash >>> 16;
    hash = Math.imul(hash, 0x7feb352d);
    hash ^= hash >>> 15;
    hash = Math.imul(hash, 0x846ca68b);
    hash ^= hash >>> 16;
    return hash >>> 0;
}

function subtropicalRainCode(locationKey, revision, parts, chance) {
    const monthKey = `${locationKey}|${parts.year}-${String(parts.month).padStart(2, '0')}|${revision}`;
    const rainyDayCount = 2 + stableHash(`${monthKey}|rainy-day-count`) % 4;
    for (let slot = 0; slot < rainyDayCount; slot++) {
        const start = Math.floor(slot * parts.daysInMonth / rainyDayCount) + 1;
        const end = Math.floor((slot + 1) * parts.daysInMonth / rainyDayCount);
        const selectedDay = start + stableHash(`${monthKey}|rainy-day-${slot}`) % (end - start + 1);
        if (parts.day === selectedDay) {
            return chance < 0.55 ? 51 : chance < 0.9 ? 61 : 80;
        }
    }
    return null;
}

function climateEstimate(location, date, parts) {
    const latitude = Number(location?.latitude), longitude = Number(location?.longitude);
    const name = typeof location?.name === 'string' ? location.name.trim() : '';
    if (!name || !Number.isFinite(latitude) || latitude < -90 || latitude > 90
        || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) return null;
    const revision = Number.isSafeInteger(location?.climateRevision) && location.climateRevision >= 0 ? location.climateRevision : 0;
    const baseKey = `${latitude.toFixed(4)},${longitude.toFixed(4)}|${name}|${date}`;
    const key = revision ? `${baseKey}|${revision}` : baseKey;
    const hash = stableHash(key);
    const random = offset => ((hash >>> offset) & 0xff) / 255;
    const absoluteLatitude = Math.abs(latitude);
    const monthPosition = parts.month - 1 + (parts.day - 1) / parts.daysInMonth;
    const summerPeak = latitude < 0 ? 0 : 6;
    const seasonal = Math.cos(((monthPosition - summerPeak) / 12) * Math.PI * 2);
    let annualMean, amplitude;
    if (absoluteLatitude <= 23.5) {
        annualMean = 27 - absoluteLatitude * 0.15;
        amplitude = 2 + absoluteLatitude * 0.04;
    } else if (absoluteLatitude <= 45) {
        annualMean = 23.5 - (absoluteLatitude - 23.5) * 0.35;
        amplitude = 3 + (absoluteLatitude - 23.5) * 0.16;
    } else if (absoluteLatitude <= 66.5) {
        annualMean = 16 - (absoluteLatitude - 45) * 0.45;
        amplitude = 6.5 + (absoluteLatitude - 45) * 0.24;
    } else {
        annualMean = 6.3 - (absoluteLatitude - 66.5) * 0.62;
        amplitude = 11.7 + (absoluteLatitude - 66.5) * 0.12;
    }
    if (latitude < -60) annualMean -= (absoluteLatitude - 60) * 0.4;
    const mean = annualMean + seasonal * amplitude + (random(0) - 0.5) * 6;
    const span = 5 + Math.min(absoluteLatitude, 75) / 25 + random(8) * 3;
    let tempMin = Math.round(mean - span / 2);
    let tempMax = Math.round(mean + span / 2);
    if (absoluteLatitude >= 85) tempMax = Math.min(tempMax, latitude < 0 ? 0 : 5);
    else if (absoluteLatitude >= 75) tempMax = Math.min(tempMax, latitude < 0 ? 5 : 12);
    tempMin = Math.max(-80, tempMin);
    tempMax = Math.min(55, tempMax);
    if (tempMax <= tempMin) tempMax = tempMin + 1;
    const chance = random(16);
    const locationKey = `${latitude.toFixed(4)},${longitude.toFixed(4)}|${name}`;
    let weatherCode;
    if (tempMax <= 2) weatherCode = chance < 0.24 ? 0 : chance < 0.52 ? 2 : chance < 0.7 ? 3 : chance < 0.8 ? 45 : chance < 0.94 ? 71 : 73;
    else if (absoluteLatitude >= 70) weatherCode = chance < 0.18 ? 0 : chance < 0.38 ? 2 : chance < 0.62 ? 3 : chance < 0.74 ? 45 : chance < 0.92 ? 71 : chance < 0.97 ? 61 : 80;
    else if (absoluteLatitude <= 15) weatherCode = chance < 0.3 ? 0 : chance < 0.52 ? 1 : chance < 0.7 ? 2 : chance < 0.82 ? 3 : chance < 0.87 ? 45 : chance < 0.92 ? 51 : chance < 0.97 ? 61 : 80;
    else if (absoluteLatitude <= 35) {
        const rainCode = subtropicalRainCode(locationKey, revision, parts, chance);
        weatherCode = rainCode ?? (chance < 0.35 ? 0 : chance < 0.58 ? 1 : chance < 0.78 ? 2 : chance < 0.9 ? 3 : 45);
    }
    else weatherCode = chance < 0.26 ? 0 : chance < 0.46 ? 1 : chance < 0.68 ? 2 : chance < 0.84 ? 3 : chance < 0.92 ? 45 : chance < 0.97 ? 61 : 80;
    return { date, weatherCode, tempMin, tempMax };
}

export function resolveWeatherForDate(weatherStore, date, { storyWeatherEvent, storyWeatherEventEnabled = false } = {}) {
    const parts = dateParts(date);
    if (!parts) return { status: 'unavailable', source: null, sourceLabel: '无法推演', unavailableReason: '日期无效' };
    if (storyWeatherEventEnabled === true) {
        const override = storyWeatherEventForDate(storyWeatherEvent, date);
        const locationKey = weatherLocationKey(weatherStore?.location);
        if (override && override.event.locationKey === locationKey) {
            return { status: 'available', source: WEATHER_SOURCE_STORY_EVENT, sourceLabel: weatherSourceLabel(WEATHER_SOURCE_STORY_EVENT),
                event: override.event, day: override.day };
        }
    }
    const persisted = weatherStore?.lastSuccess?.forecast?.days?.find(item => item.date === date);
    if (persisted) {
        const source = isStoredWeatherSource(weatherStore?.lastSuccess?.source)
            ? weatherStore.lastSuccess.source : WEATHER_SOURCE_FORECAST;
        const tempMin = Math.round(Math.min(persisted.tempMin, persisted.tempMax));
        const tempMax = Math.round(Math.max(persisted.tempMin, persisted.tempMax));
        return { status: 'available', source, sourceLabel: weatherSourceLabel(source), day: { ...persisted, tempMin, tempMax } };
    }
    const day = climateEstimate(weatherStore?.location
        ? { ...weatherStore.location, climateRevision: weatherStore.climateRevision } : null, date, parts);
    if (!day) return { status: 'unavailable', source: null, sourceLabel: '无法推演', unavailableReason: '尚未设置有效天气位置' };
    return {
        status: 'available', source: WEATHER_SOURCE_CLIMATE_ESTIMATE,
        sourceLabel: weatherSourceLabel(WEATHER_SOURCE_CLIMATE_ESTIMATE), day,
    };
}
