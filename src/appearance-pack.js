import { normalizeThemePreset, THEME_PRESETS } from './config.js';
import {
    DESKTOP_ICON_IDS, DESKTOP_ICON_MAX_TOTAL_BYTES, normalizeDesktopIconBackupPayload,
} from './desktop-icon-storage.js';
import { PHONE_MAX_SCALE, PHONE_MIN_SCALE } from './phone-scale.js';

export const APPEARANCE_PACK_FORMAT = 'tianyin-appearance';
export const APPEARANCE_PACK_SCHEMA_VERSION = 1;
export const APPEARANCE_BACKGROUND_MAX_BYTES = 4 * 1024 * 1024;
export const APPEARANCE_PACK_MAX_BYTES = 12 * 1024 * 1024;

const ROOT_KEYS = ['format', 'schemaVersion', 'meta', 'appearance'];
const META_KEYS = ['name', 'author', 'description', 'createdAt'];
const APPEARANCE_KEYS = ['theme', 'backgrounds', 'icons'];
const THEME_KEYS = [
    'preset', 'customAccent', 'customRight', 'customLeft', 'borderColor', 'darkMode',
    'ambientStatusEnabled', 'customTitle', 'layout', 'phoneScale',
];
const BACKGROUND_KEYS = ['desktop', 'global', 'currentContact'];
const DATA_URL_PATTERN = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]*={0,2})$/;

const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const utf8Bytes = value => new TextEncoder().encode(value).byteLength;
const exactKeys = (value, allowed, label) => {
    if (!isObject(value)) throw new Error(`${label} 必须是对象`);
    const unknown = Object.keys(value).filter(key => !allowed.includes(key));
    if (unknown.length) throw new Error(`${label} 包含未知字段：${unknown.join('、')}`);
    return value;
};
const requireKeys = (value, required, label) => {
    const missing = required.filter(key => !Object.hasOwn(value, key));
    if (missing.length) throw new Error(`${label} 缺少字段：${missing.join('、')}`);
    return value;
};
const limitedText = (value, label, max) => {
    if (typeof value !== 'string') throw new Error(`${label} 必须是字符串`);
    const normalized = value.trim();
    if (normalized.length > max) throw new Error(`${label} 最多 ${max} 个字符`);
    return normalized;
};
const color = (value, label, { empty = true } = {}) => {
    if (typeof value !== 'string' || (!empty && !value)) throw new Error(`${label} 必须是颜色字符串`);
    if (!value && empty) return '';
    if (!/^#[0-9a-fA-F]{6}$/.test(value)) throw new Error(`${label} 必须是六位十六进制颜色`);
    return value.toUpperCase();
};
const base64Bytes = encoded => Math.floor(encoded.length * 3 / 4) - (encoded.endsWith('==') ? 2 : encoded.endsWith('=') ? 1 : 0);

export function normalizeAppearanceBackground(value, label) {
    if (value === '' || value === null || value === undefined) return '';
    if (typeof value !== 'string') throw new Error(`${label} 必须是图片 Data URL 或空字符串`);
    const match = DATA_URL_PATTERN.exec(value);
    if (!match || match[2].length === 0 || match[2].length % 4 !== 0) {
        throw new Error(`${label} 必须是自包含的 PNG、JPEG 或 WebP Data URL`);
    }
    const byteLength = base64Bytes(match[2]);
    if (byteLength <= 0 || byteLength > APPEARANCE_BACKGROUND_MAX_BYTES) throw new Error(`${label} 超过单项容量上限`);
    return value;
}

function normalizeMeta(value, { strict = true, now = () => new Date().toISOString() } = {}) {
    if (strict) {
        exactKeys(value, META_KEYS, '美化包 meta');
        requireKeys(value, META_KEYS, '美化包 meta');
    }
    else if (!isObject(value)) value = {};
    const createdAt = value.createdAt === undefined ? now() : value.createdAt;
    if (typeof createdAt !== 'string' || !Number.isFinite(Date.parse(createdAt))) throw new Error('美化包创建时间无效');
    return {
        name: limitedText(value.name ?? '', '美化包名称', 60),
        author: limitedText(value.author ?? '', '美化包作者', 60),
        description: limitedText(value.description ?? '', '美化包说明', 500),
        createdAt: new Date(createdAt).toISOString(),
    };
}

export function normalizeAppearanceTheme(value, { strict = true } = {}) {
    if (strict) {
        exactKeys(value, THEME_KEYS, '美化包主题');
        requireKeys(value, THEME_KEYS, '美化包主题');
    }
    else if (!isObject(value)) value = {};
    const preset = value.preset ?? 'default';
    if (normalizeThemePreset(preset) !== preset || (preset !== 'custom' && !Object.hasOwn(THEME_PRESETS, preset))) {
        throw new Error(`美化包主题 preset 无效：${preset}`);
    }
    const darkMode = value.darkMode ?? 'light';
    if (darkMode !== 'light' && darkMode !== 'dark') throw new Error('美化包主题 darkMode 必须是 light 或 dark');
    const layout = value.layout ?? 'standard';
    if (layout !== 'standard') throw new Error('美化包主题 layout 仅支持 standard');
    const phoneScale = Number(value.phoneScale ?? 1);
    if (!Number.isFinite(phoneScale) || phoneScale < PHONE_MIN_SCALE || phoneScale > PHONE_MAX_SCALE) {
        throw new Error(`美化包主题 phoneScale 必须在 ${PHONE_MIN_SCALE} 到 ${PHONE_MAX_SCALE} 之间`);
    }
    if (value.ambientStatusEnabled !== undefined && typeof value.ambientStatusEnabled !== 'boolean') {
        throw new Error('美化包主题 ambientStatusEnabled 必须是布尔值');
    }
    return {
        preset,
        customAccent: color(value.customAccent ?? '', '美化包主题 customAccent'),
        customRight: color(value.customRight ?? '', '美化包主题 customRight'),
        customLeft: color(value.customLeft ?? '', '美化包主题 customLeft'),
        borderColor: color(value.borderColor ?? '', '美化包主题 borderColor'),
        darkMode,
        ambientStatusEnabled: value.ambientStatusEnabled === true,
        customTitle: limitedText(value.customTitle ?? '', '美化包桌面标题', 20),
        layout,
        phoneScale: Math.round(phoneScale * 1000) / 1000,
    };
}

function normalizeBackgrounds(value, { strict = true } = {}) {
    if (strict) {
        exactKeys(value, BACKGROUND_KEYS, '美化包 backgrounds');
        requireKeys(value, BACKGROUND_KEYS, '美化包 backgrounds');
    }
    else if (!isObject(value)) value = {};
    return {
        desktop: normalizeAppearanceBackground(value.desktop, '桌面背景'),
        global: normalizeAppearanceBackground(value.global, '全局背景'),
        currentContact: normalizeAppearanceBackground(value.currentContact, '当前联系人背景'),
    };
}

function normalizeAppearance(value, { strict = true } = {}) {
    if (strict) {
        exactKeys(value, APPEARANCE_KEYS, '美化包 appearance');
        requireKeys(value, APPEARANCE_KEYS, '美化包 appearance');
    }
    else if (!isObject(value)) value = {};
    const icons = normalizeDesktopIconBackupPayload(value.icons ?? {});
    const iconBytes = Object.values(icons).reduce((sum, dataUrl) => {
        const encoded = dataUrl.slice(dataUrl.indexOf(',') + 1);
        return sum + base64Bytes(encoded);
    }, 0);
    if (iconBytes > DESKTOP_ICON_MAX_TOTAL_BYTES) throw new Error('美化包桌面图标总容量超限');
    return {
        theme: normalizeAppearanceTheme(value.theme ?? {}, { strict }),
        backgrounds: normalizeBackgrounds(value.backgrounds ?? {}, { strict }),
        icons,
    };
}

function normalizePackObject(value, { strict = true, now } = {}) {
    if (strict) {
        exactKeys(value, ROOT_KEYS, '美化包根节点');
        requireKeys(value, ROOT_KEYS, '美化包根节点');
    }
    else if (!isObject(value)) throw new Error('美化包根节点必须是对象');
    if (value.format !== APPEARANCE_PACK_FORMAT) throw new Error(`美化包 format 必须是 ${APPEARANCE_PACK_FORMAT}`);
    if (!Number.isInteger(value.schemaVersion) || value.schemaVersion < 1) throw new Error('美化包版本无效');
    if (value.schemaVersion > APPEARANCE_PACK_SCHEMA_VERSION) {
        throw new Error(`美化包版本 ${value.schemaVersion} 高于当前支持版本 ${APPEARANCE_PACK_SCHEMA_VERSION}`);
    }
    const normalized = {
        format: APPEARANCE_PACK_FORMAT,
        schemaVersion: APPEARANCE_PACK_SCHEMA_VERSION,
        meta: normalizeMeta(value.meta ?? {}, { strict, now }),
        appearance: normalizeAppearance(value.appearance ?? {}, { strict }),
    };
    const serialized = JSON.stringify(normalized);
    const totalBytes = utf8Bytes(serialized);
    if (totalBytes > APPEARANCE_PACK_MAX_BYTES) throw new Error('美化包总容量超过 12MiB');
    return { pack: normalized, serialized, totalBytes };
}

export function parseAppearancePack(input) {
    let value = input;
    if (typeof input === 'string') {
        if (utf8Bytes(input) > APPEARANCE_PACK_MAX_BYTES) throw new Error('美化包总容量超过 12MiB');
        try { value = JSON.parse(input); }
        catch (error) { throw new Error('美化包 JSON 无法解析'); }
    }
    if (!isObject(value)) throw new Error('美化包根节点必须是对象');
    return normalizePackObject(value, { strict: true });
}

export function createAppearancePack({ meta = {}, theme = {}, backgrounds = {}, icons = {}, now } = {}) {
    const value = {
        format: APPEARANCE_PACK_FORMAT,
        schemaVersion: APPEARANCE_PACK_SCHEMA_VERSION,
        meta,
        appearance: { theme, backgrounds, icons },
    };
    return normalizePackObject(value, { strict: false, now });
}

export const APPEARANCE_THEME_KEYS = Object.freeze([...THEME_KEYS]);
export const APPEARANCE_ICON_IDS = DESKTOP_ICON_IDS;
