// 按模块分配 API：每个模块可跟随默认设置、走酒馆主 API，或指定一个已保存的 API 预设。
export const API_ROUTES_KEY = 'ST_SMS_API_ROUTES';

export const API_ROUTE_MODULES = [
    { key: 'chat', label: '聊天与戳一戳' },
    { key: 'community', label: '社区' },
    { key: 'video', label: '直播与视频' },
    { key: 'trend', label: '今日风向' },
    { key: 'calendar', label: '日历' },
    { key: 'oracle', label: '剧情助手' },
    { key: 'origin', label: '金手指' },
    { key: 'contacts', label: '生成联系人' },
    { key: 'image', label: '生图写词' },
];

const MODULE_KEYS = new Set(API_ROUTE_MODULES.map(item => item.key));

export function makeProfileId() {
    return `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export function profileDisplayName(profile) {
    const name = String(profile?.name || '').trim();
    if (name) return name;
    return String(profile?.model || '').trim() || String(profile?.apiUrl || '').replace(/^https?:\/\//, '').replace(/\/.*$/, '') || '未命名预设';
}

/** 旧档案没有 id，读入时补上，路由靠 id 引用；返回是否补过。 */
export function ensureProfileIds(profiles) {
    let changed = false;
    for (const profile of Array.isArray(profiles) ? profiles : []) {
        if (profile && typeof profile === 'object' && !profile.id) { profile.id = makeProfileId(); changed = true; }
    }
    return changed;
}

export function normalizeApiRoutes(value) {
    const routes = {};
    if (!value || typeof value !== 'object') return routes;
    for (const [key, route] of Object.entries(value)) {
        if (MODULE_KEYS.has(key) && typeof route === 'string' && route && route !== 'default') routes[key] = route;
    }
    return routes;
}

export function loadApiRoutes() {
    try { window.__pmApiRoutes = normalizeApiRoutes(JSON.parse(localStorage.getItem(API_ROUTES_KEY))); }
    catch (error) { window.__pmApiRoutes = {}; }
    return window.__pmApiRoutes;
}

export function saveApiRoutes() {
    try { localStorage.setItem(API_ROUTES_KEY, JSON.stringify(window.__pmApiRoutes || {})); return true; }
    catch (error) { return false; }
}

/**
 * 解析某模块实际使用的配置。未分配或预设已删除时回落默认配置。
 * 'main' = 酒馆主 API；其余值是预设 id，强制按独立 API 调用。
 */
export function resolveApiConfig(module, baseConfig = window.__pmConfig, routes = window.__pmApiRoutes, profiles = window.__pmProfiles) {
    const base = baseConfig || {};
    const route = module && routes ? routes[module] : '';
    if (!route) return base;
    if (route === 'main') return { ...base, useIndependent: false };
    const profile = Array.isArray(profiles) ? profiles.find(item => item?.id === route) : null;
    if (!profile || !profile.apiUrl || !profile.apiKey || !profile.model) return base;
    return { apiUrl: profile.apiUrl, apiKey: profile.apiKey, model: profile.model, temperature: profile.temperature ?? base.temperature, useIndependent: true };
}
