export const WEATHER_ATTRIBUTION = 'Weather data © Open-Meteo (CC BY 4.0)';
export const WEATHER_STORE_VERSION = 1;

const GEOCODING_URL = 'https://geocoding-api.open-meteo.com/v1/search';
const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';
const MAX_QUERY_LENGTH = 100;
const FORECAST_DAYS = 7;
const DEFAULT_TIMEOUT = 10000;
const DAILY_PARAMS = 'weather_code,temperature_2m_max,temperature_2m_min';

function isRecord(v) {
    return v && typeof v === 'object' && !Array.isArray(v)
        && (Object.getPrototypeOf(v) === Object.prototype
            || Object.getPrototypeOf(v) === null);
}

function isNum(v) {
    return typeof v === 'number' && Number.isFinite(v);
}

// ── Empty store ──

export function createEmptyWeatherStore() {
    return { version: WEATHER_STORE_VERSION, lastSuccess: null };
}


// ── Location normalizer ──

export function normalizeWeatherLocation(value) {
    const src = isRecord(value) ? value : {};
    const name = String(src.name ?? '').trim().slice(0, 200);
    if (!name) throw new Error('天气位置名称不能为空');
    const lat = src.latitude, lng = src.longitude;
    if (!isNum(lat) || lat < -90 || lat > 90 || !isNum(lng) || lng < -180 || lng > 180) {
        throw new Error('天气位置经纬度无效');
    }
    const out = { __proto__: null };
    out.name = name;
    out.latitude = lat;
    out.longitude = lng;
    out.country = String(src.country ?? '').trim().slice(0, 100);
    out.admin1 = String(src.admin1 ?? '').trim().slice(0, 100);
    out.timezone = String(src.timezone ?? '').trim().slice(0, 80);
    return Object.freeze(out);
}

export function weatherLocationKey(location) {
    const loc = normalizeWeatherLocation(location);
    return `${loc.latitude},${loc.longitude}|${loc.name}`;
}


// ── Forecast normalizer ──

export function normalizeWeatherForecast(value) {
    const src = isRecord(value) ? value : {};
    if (Array.isArray(src.days)) {
        const days = [];
        for (const raw of src.days.slice(0, 31)) {
            if (!isRecord(raw)) continue;
            const weatherCode = Number(raw.weatherCode), tempMax = Number(raw.tempMax), tempMin = Number(raw.tempMin);
            if (!/^\d{4}-\d{2}-\d{2}$/.test(String(raw.date || '')) || !isNum(weatherCode)
                || weatherCode < 0 || weatherCode > 99 || !isNum(tempMax) || !isNum(tempMin) || tempMin > tempMax) continue;
            days.push({ date: String(raw.date), weatherCode: Math.round(weatherCode), tempMax, tempMin });
        }
        if (!days.length) throw new Error('天气预报无有效每日数据');
        const normalized = { __proto__: null };
        normalized.days = days;
        normalized.attribution = WEATHER_ATTRIBUTION;
        return Object.freeze(normalized);
    }
    const daily = isRecord(src.daily) ? src.daily : {};
    const times = Array.isArray(daily.time) ? daily.time.map(t => String(t ?? '')) : [];
    const codes = Array.isArray(daily.weather_code)
        ? daily.weather_code.map(c => { const n = Number(c); return isNum(n) ? Math.round(n) : NaN; })
        : [];
    const tMax = Array.isArray(daily.temperature_2m_max)
        ? daily.temperature_2m_max.map(t => { const n = Number(t); return isNum(n) ? n : NaN; })
        : [];
    const tMin = Array.isArray(daily.temperature_2m_min)
        ? daily.temperature_2m_min.map(t => { const n = Number(t); return isNum(n) ? n : NaN; })
        : [];
    const len = times.length;
    if (!len || len > 31) throw new Error('天气每日数据条数无效');
    if (codes.length !== len || tMax.length !== len || tMin.length !== len) {
        throw new Error('天气每日数组长度不一致');
    }
    const days = [];
    for (let i = 0; i < len; i++) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(times[i]) || !isNum(codes[i]) || codes[i] < 0 || codes[i] > 99
            || !isNum(tMax[i]) || !isNum(tMin[i]) || tMin[i] > tMax[i]) continue;
        days.push({ date: times[i], weatherCode: codes[i], tempMax: tMax[i], tempMin: tMin[i] });
    }
    if (!days.length) throw new Error('天气预报无有效每日数据');
    const out = { __proto__: null };
    out.days = days;
    out.attribution = WEATHER_ATTRIBUTION;
    return Object.freeze(out);
}


// ── Store normalizer ──

export function normalizeWeatherStore(value) {
    const src = isRecord(value) ? value : {};
    let location = null;
    try { if (src.location) location = normalizeWeatherLocation(src.location); } catch {}
    let lastSuccess = null;
    if (isRecord(src.lastSuccess)) {
        try {
            lastSuccess = {
                locationKey: String(src.lastSuccess.locationKey ?? ''),
                forecast: normalizeWeatherForecast(src.lastSuccess.forecast),
                fetchedAt: isNum(src.lastSuccess.fetchedAt) && src.lastSuccess.fetchedAt >= 0
                    ? Math.floor(src.lastSuccess.fetchedAt) : 0,
            };
        } catch { /* 忽略损坏的缓存 */ }
    }
    if (location && lastSuccess && lastSuccess.locationKey !== weatherLocationKey(location)) {
        lastSuccess = null;
    }
    return { version: WEATHER_STORE_VERSION, location, lastSuccess };
}


// ── Weather code → label ──

export function weatherCodeLabel(code) {
    const n = Number(code);
    if (!isNum(n)) return '未知';
    const map = {
        0: '晴', 1: '少云', 2: '多云', 3: '阴',
        45: '雾', 48: '雾凇',
        51: '小毛毛雨', 53: '中毛毛雨', 55: '大毛毛雨',
        56: '冻毛毛雨', 57: '冻大毛毛雨',
        61: '小雨', 63: '中雨', 65: '大雨',
        66: '冻雨', 67: '大冻雨',
        71: '小雪', 73: '中雪', 75: '大雪',
        77: '雪粒',
        80: '小阵雨', 81: '中阵雨', 82: '大阵雨',
        85: '小阵雪', 86: '大阵雪',
        95: '雷暴', 96: '雷暴伴小雹', 99: '雷暴伴大雹',
    };
    return map[Math.round(n)] || '未知';
}


// ── Internal: combine timeout + external signal ──

function makeSignal(ms, external) {
    const ctrl = new AbortController();
    const onAbort = () => ctrl.abort(external?.reason);
    if (external?.aborted) onAbort();
    else external?.addEventListener?.('abort', onAbort, { once: true });
    const timer = setTimeout(() => ctrl.abort(new DOMException('请求超时', 'AbortError')), ms);
    return {
        signal: ctrl.signal,
        cleanup() { clearTimeout(timer); external?.removeEventListener?.('abort', onAbort); },
    };
}


// ── Search locations (Geocoding) ──

export async function searchWeatherLocations(query, { fetchImpl, signal, timeout } = {}) {
    const q = String(query ?? '').trim().slice(0, MAX_QUERY_LENGTH);
    if (!q) throw new Error('天气搜索查询不能为空');
    const fetch_ = fetchImpl || globalThis.fetch;
    const ms = isNum(timeout) && timeout > 0 ? timeout : DEFAULT_TIMEOUT;
    const url = GEOCODING_URL + '?name=' + encodeURIComponent(q)
        + '&count=8&language=zh&format=json';
    const requestSignal = makeSignal(ms, signal);
    let response;
    try {
        response = await fetch_(url, { signal: requestSignal.signal });
    } catch (e) {
        if (requestSignal.signal.aborted) throw new Error('天气搜索超时或已取消');
        throw e;
    } finally { requestSignal.cleanup(); }
    if (!response.ok) throw new Error('天气搜索失败：HTTP ' + response.status);
    let json;
    try { json = await response.json(); } catch { throw new Error('天气搜索结果解析失败'); }
    const results = Array.isArray(json.results) ? json.results : [];
    return results.slice(0, 8).map(r => {
        try {
            return normalizeWeatherLocation({
                name: r.name, latitude: r.latitude, longitude: r.longitude,
                country: r.country, admin1: r.admin1, timezone: r.timezone,
            });
        } catch { return null; }
    }).filter(Boolean);
}


// ── Fetch forecast ──

export async function fetchWeatherForecast(location, store, { fetchImpl, signal, timeout } = {}) {
    const loc = normalizeWeatherLocation(location);
    const key = weatherLocationKey(loc);
    const fetch_ = fetchImpl || globalThis.fetch;
    const ms = isNum(timeout) && timeout > 0 ? timeout : DEFAULT_TIMEOUT;
    const url = FORECAST_URL + '?latitude=' + loc.latitude
        + '&longitude=' + loc.longitude
        + '&daily=' + DAILY_PARAMS
        + '&timezone=' + encodeURIComponent(loc.timezone || 'auto')
        + '&forecast_days=' + FORECAST_DAYS;
    const requestSignal = makeSignal(ms, signal);
    let response;
    try {
        response = await fetch_(url, { signal: requestSignal.signal });
    } catch (e) {
        if (signal?.aborted) throw new Error('天气预报请求已取消');
        const st = normalizeWeatherStore(store);
        if (st.lastSuccess && st.lastSuccess.locationKey === key) {
            return { stale: true, data: st.lastSuccess.forecast, locationKey: key, store: st, reason: 'network' };
        }
        throw new Error(requestSignal.signal.aborted ? '天气预报获取超时' : `天气预报获取失败：${e?.message || '网络错误'}`);
    } finally { requestSignal.cleanup(); }
    if (!response.ok) {
        const st = normalizeWeatherStore(store);
        if (st.lastSuccess && st.lastSuccess.locationKey === key) {
            return { stale: true, data: st.lastSuccess.forecast, locationKey: key, store: st, reason: 'http' };
        }
        throw new Error('天气预报获取失败：HTTP ' + response.status);
    }
    let json;
    try { json = await response.json(); } catch {
        const st = normalizeWeatherStore(store);
        if (st.lastSuccess && st.lastSuccess.locationKey === key) {
            return { stale: true, data: st.lastSuccess.forecast, locationKey: key, store: st, reason: 'json' };
        }
        throw new Error('天气预报数据解析失败');
    }
    const forecast = normalizeWeatherForecast(json);
    const nextStore = normalizeWeatherStore({
        location: loc,
        lastSuccess: { locationKey: key, forecast, fetchedAt: Date.now() },
    });
    return { stale: false, data: forecast, locationKey: key, store: nextStore };
}
