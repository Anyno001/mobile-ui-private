// 生图设置：存 localStorage，所有聊天共用。
// 「方案」是一整套出图参数（来源、比例、模型、画师串；内置 NAI 另有地址、Key 与采样）。
// 有一个全局方案；聊天、社区、视频各自选「跟随全局」或某个预设方案，选预设时整套用预设的，不和全局混合。
import { PHONE_IMAGE_SIZES } from './phone-image-dbgen.js';
import { NAI_DEFAULTS, NAI_NOISE_SCHEDULES, NAI_SAMPLERS, NAI_TRANSPORTS } from './phone-image-nai.js';

export const IMAGE_SETTINGS_KEY = 'ST_SMS_IMAGE_SETTINGS_V1';
export const IMAGE_RATIO_LABELS = Object.freeze({ portrait: '竖图', square: '方图', landscape: '横图' });
export const IMAGE_SOURCE_LABELS = Object.freeze({ dbgen: '数据库生图插件', nai: '内置 NAI' });
export const IMAGE_MODULES = Object.freeze({ chat: '聊天', community: '社区', video: '视频' });
export const IMAGE_PRESET_LIMIT = 12;
export const GLOBAL_PROFILE_ID = 'global';

const text = (value, limit = 4000) => typeof value === 'string' ? value.trim().slice(0, limit) : '';
const plain = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
const clampInt = (value, min, max, fallback) => { const n = Math.round(Number(value)); return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback; };
const clampNum = (value, min, max, fallback) => { const n = Number(value); return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback; };

export function normalizeImageProfile(value, { id = GLOBAL_PROFILE_ID, name = '全局' } = {}) {
    const source = plain(value);
    const nai = plain(source.nai);
    return {
        id: text(source.id, 60) || id,
        name: text(source.name, 30) || name,
        source: Object.hasOwn(IMAGE_SOURCE_LABELS, source.source) ? source.source : 'dbgen',
        ratio: Object.hasOwn(PHONE_IMAGE_SIZES, source.ratio) ? source.ratio : 'portrait',
        // 数据库生图：模型留空用插件自己的；画师串两项都空时用插件默认画师。
        model: text(source.model, 120),
        artistPositive: text(source.artistPositive),
        artistNegative: text(source.artistNegative),
        nai: {
            endpoint: text(nai.endpoint, 500),
            apiKey: text(nai.apiKey, 500),
            transport: NAI_TRANSPORTS.includes(nai.transport) ? nai.transport : NAI_DEFAULTS.transport,
            model: text(nai.model, 120) || NAI_DEFAULTS.model,
            steps: clampInt(nai.steps, 1, 50, NAI_DEFAULTS.steps),
            scale: clampNum(nai.scale, 0, 10, NAI_DEFAULTS.scale),
            sampler: NAI_SAMPLERS.includes(nai.sampler) ? nai.sampler : NAI_DEFAULTS.sampler,
            noiseSchedule: NAI_NOISE_SCHEDULES.includes(nai.noiseSchedule) ? nai.noiseSchedule : NAI_DEFAULTS.noiseSchedule,
            negativePrompt: typeof nai.negativePrompt === 'string' ? nai.negativePrompt.trim().slice(0, 4000) : NAI_DEFAULTS.negativePrompt,
        },
    };
}

export function normalizeImageSettings(value) {
    const source = plain(value);
    // v1 只有一个全局比例；读入时并进全局方案。
    const global = normalizeImageProfile({ ...plain(source.global), ...(source.global ? {} : { ratio: source.ratio }) });
    const seen = new Set([GLOBAL_PROFILE_ID]);
    const presets = (Array.isArray(source.presets) ? source.presets : []).flatMap((preset, index) => {
        const normalized = normalizeImageProfile(preset, { id: `preset_${index + 1}`, name: `方案 ${index + 1}` });
        if (seen.has(normalized.id)) return [];
        seen.add(normalized.id);
        return [normalized];
    }).slice(0, IMAGE_PRESET_LIMIT);
    const modules = {};
    for (const key of Object.keys(IMAGE_MODULES)) {
        const picked = text(plain(source.modules)[key], 60);
        modules[key] = picked && seen.has(picked) ? picked : GLOBAL_PROFILE_ID;
    }
    return {
        version: 2,
        enabled: source.enabled !== false,
        chatAuto: source.chatAuto === true,
        communityAuto: source.communityAuto === true,
        videoAuto: source.videoAuto === true,
        global, presets, modules,
    };
}

export function loadImageSettings(storage = globalThis.localStorage) {
    try { return normalizeImageSettings(JSON.parse(storage?.getItem?.(IMAGE_SETTINGS_KEY) || 'null')); }
    catch (error) { return normalizeImageSettings(null); }
}

export function saveImageSettings(value, storage = globalThis.localStorage) {
    const next = normalizeImageSettings(value);
    storage?.setItem?.(IMAGE_SETTINGS_KEY, JSON.stringify(next));
    applyImageGenVisibility(next.enabled);
    return next;
}

/** 生图总开关：关闭时在手机与弹层上挂 data-image-gen="off"，由样式隐藏所有出图入口；已生成的图照常显示。 */
export function applyImageGenVisibility(enabled = loadImageSettings().enabled) {
    const doc = globalThis.document;
    if (!doc?.getElementById) return;
    for (const id of ['pm-iphone', 'pm-overlay', 'pm-overlay-sub']) {
        const element = doc.getElementById(id);
        if (!element) continue;
        if (enabled) { if (element.hasAttribute?.('data-image-gen') !== false) element.removeAttribute('data-image-gen'); }
        else if (element.getAttribute?.('data-image-gen') !== 'off') element.setAttribute('data-image-gen', 'off');
    }
}

/** 某个模块实际用的方案；选的预设被删了就回到全局。 */
export function profileForModule(settings, moduleKey) {
    const s = normalizeImageSettings(settings);
    const id = s.modules[moduleKey] || GLOBAL_PROFILE_ID;
    return s.presets.find(preset => preset.id === id) || s.global;
}

export const imageSizeFor = profile => PHONE_IMAGE_SIZES[normalizeImageProfile(profile).ratio];

/** 新建预设：从全局方案复制一份，再自己改。 */
export function createPresetFrom(settings, name) {
    const s = normalizeImageSettings(settings);
    if (s.presets.length >= IMAGE_PRESET_LIMIT) throw new Error(`方案最多 ${IMAGE_PRESET_LIMIT} 个`);
    const id = `preset_${Date.now().toString(36)}`;
    return normalizeImageProfile({ ...s.global, id, name: text(name, 30) || `方案 ${s.presets.length + 1}` });
}
