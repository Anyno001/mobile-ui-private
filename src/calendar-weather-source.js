export const WEATHER_SOURCE_FORECAST = 'forecast';
export const WEATHER_SOURCE_CACHED_FORECAST = 'cached_forecast';
export const WEATHER_SOURCE_CLIMATE_ESTIMATE = 'climate_estimate';

const SOURCE_LABELS = Object.freeze({
    [WEATHER_SOURCE_FORECAST]: '真实预报',
    [WEATHER_SOURCE_CACHED_FORECAST]: '缓存预报',
    [WEATHER_SOURCE_CLIMATE_ESTIMATE]: '气候推演',
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

function climateEstimate(location, date, parts) {
    const latitude = Number(location?.latitude), longitude = Number(location?.longitude);
    const name = typeof location?.name === 'string' ? location.name.trim() : '';
    if (!name || !Number.isFinite(latitude) || latitude < -90 || latitude > 90
        || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) return null;
    const key = `${latitude.toFixed(4)},${longitude.toFixed(4)}|${name}|${date}`;
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
    let weatherCode;
    if (tempMax <= 2) weatherCode = chance < 0.24 ? 0 : chance < 0.52 ? 2 : chance < 0.7 ? 3 : chance < 0.8 ? 45 : chance < 0.94 ? 71 : 73;
    else if (absoluteLatitude >= 70) weatherCode = chance < 0.22 ? 0 : chance < 0.52 ? 2 : chance < 0.72 ? 3 : chance < 0.82 ? 45 : chance < 0.94 ? 61 : 80;
    else if (absoluteLatitude <= 15) weatherCode = chance < 0.16 ? 0 : chance < 0.38 ? 1 : chance < 0.56 ? 2 : chance < 0.66 ? 3 : chance < 0.76 ? 51 : chance < 0.92 ? 61 : 80;
    else if (absoluteLatitude <= 35) weatherCode = chance < 0.26 ? 0 : chance < 0.54 ? 1 : chance < 0.72 ? 2 : chance < 0.8 ? 3 : chance < 0.86 ? 45 : chance < 0.95 ? 61 : 80;
    else weatherCode = chance < 0.18 ? 0 : chance < 0.4 ? 1 : chance < 0.6 ? 2 : chance < 0.7 ? 3 : chance < 0.78 ? 45 : chance < 0.86 ? 51 : chance < 0.95 ? 61 : 80;
    return { date, weatherCode, tempMin, tempMax };
}

export function resolveWeatherForDate(weatherStore, date) {
    const parts = dateParts(date);
    if (!parts) return { status: 'unavailable', source: null, sourceLabel: '无法推演', unavailableReason: '日期无效' };
    const persisted = weatherStore?.lastSuccess?.forecast?.days?.find(item => item.date === date);
    if (persisted) {
        const source = isStoredWeatherSource(weatherStore?.lastSuccess?.source)
            ? weatherStore.lastSuccess.source : WEATHER_SOURCE_FORECAST;
        const tempMin = Math.round(Math.min(persisted.tempMin, persisted.tempMax));
        const tempMax = Math.round(Math.max(persisted.tempMin, persisted.tempMax));
        return { status: 'available', source, sourceLabel: weatherSourceLabel(source), day: { ...persisted, tempMin, tempMax } };
    }
    const day = climateEstimate(weatherStore?.location, date, parts);
    if (!day) return { status: 'unavailable', source: null, sourceLabel: '无法推演', unavailableReason: '尚未设置有效天气位置' };
    return {
        status: 'available', source: WEATHER_SOURCE_CLIMATE_ESTIMATE,
        sourceLabel: weatherSourceLabel(WEATHER_SOURCE_CLIMATE_ESTIMATE), day,
    };
}
