import { pmIDBDel, pmIDBReadEntry, pmIDBSet } from './storage-primitives.js';

export const DESKTOP_ICON_STORAGE_KEY = 'ST_SMS_DESKTOP_ICONS_V1';
export const DESKTOP_ICON_RESOURCE_PREFIX = 'ST_SMS_DESKTOP_ICON_';
export const DESKTOP_ICON_SCHEMA_VERSION = 1;
export const DESKTOP_ICON_MAX_ITEM_BYTES = 256 * 1024;
export const DESKTOP_ICON_MAX_TOTAL_BYTES = 1536 * 1024;
export const DESKTOP_ICON_SIZE = 256;
export const DESKTOP_ICON_MIME = 'image/png';
export const DESKTOP_ICON_IDS = Object.freeze([
    'chat', 'directory', 'settings', 'calendar', 'todayTrend', 'storyOracle', 'community',
]);

const DESKTOP_ICON_ID_SET = new Set(DESKTOP_ICON_IDS);
let resourceSequence = 0;

function emptyManifest() {
    return { schemaVersion: DESKTOP_ICON_SCHEMA_VERSION, icons: {} };
}

function isPlainObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function base64ByteLength(value) {
    const comma = value.indexOf(',');
    const base64 = comma >= 0 ? value.slice(comma + 1) : value;
    const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
    return Math.floor(base64.length * 3 / 4) - padding;
}

function isValidPngDataUrl(value) {
    if (typeof value !== 'string' || !value.startsWith('data:image/png;base64,')) return false;
    const encoded = value.slice('data:image/png;base64,'.length);
    return encoded.length > 0 && encoded.length % 4 === 0 && /^[A-Za-z0-9+/]*={0,2}$/.test(encoded);
}

export function isValidDesktopIconRuntimeData(value) {
    if (!isValidPngDataUrl(value)) return false;
    const byteLength = base64ByteLength(value);
    if (!Number.isSafeInteger(byteLength) || byteLength <= 0 || byteLength > DESKTOP_ICON_MAX_ITEM_BYTES) return false;
    const encoded = value.slice('data:image/png;base64,'.length);
    return encoded.startsWith('iVBORw0KGgo');
}

function validateIconData(appId, dataUrl, metadata = {}) {
    if (!DESKTOP_ICON_ID_SET.has(appId)) throw new Error(`桌面图标标识不在白名单：${appId}`);
    if (!isValidPngDataUrl(dataUrl)) throw new Error(`桌面图标 ${appId} 的资源必须是 Base64 PNG Data URL`);
    const width = Number(metadata.width);
    const height = Number(metadata.height);
    const byteLength = base64ByteLength(dataUrl);
    if (width !== DESKTOP_ICON_SIZE || height !== DESKTOP_ICON_SIZE) {
        throw new Error(`桌面图标 ${appId} 必须为 ${DESKTOP_ICON_SIZE}x${DESKTOP_ICON_SIZE}`);
    }
    if (!Number.isSafeInteger(byteLength) || byteLength <= 0 || byteLength > DESKTOP_ICON_MAX_ITEM_BYTES) {
        throw new Error(`桌面图标 ${appId} 超过单项容量上限`);
    }
    return { mime: DESKTOP_ICON_MIME, width, height, byteLength };
}

export function normalizeDesktopIconBackupPayload(value) {
    if (!isPlainObject(value)) throw new Error('备份字段 desktopIcons 必须是对象');
    const unknownIds = Object.keys(value).filter(appId => !DESKTOP_ICON_ID_SET.has(appId));
    if (unknownIds.length) throw new Error(`备份字段 desktopIcons 包含未知图标：${unknownIds.join('、')}`);
    const icons = {};
    let totalBytes = 0;
    for (const appId of DESKTOP_ICON_IDS) {
        if (value[appId] === undefined || value[appId] === null) continue;
        const dataUrl = value[appId];
        const meta = validateIconData(appId, dataUrl, { width: DESKTOP_ICON_SIZE, height: DESKTOP_ICON_SIZE });
        totalBytes += meta.byteLength;
        if (totalBytes > DESKTOP_ICON_MAX_TOTAL_BYTES) throw new Error('桌面图标总容量超过 1.5MiB');
        icons[appId] = dataUrl;
    }
    return icons;
}

function normalizeManifest(value) {
    if (value === undefined) return emptyManifest();
    if (!isPlainObject(value) || value.schemaVersion !== DESKTOP_ICON_SCHEMA_VERSION || !isPlainObject(value.icons)) {
        throw new Error('桌面图标清单版本未知或格式损坏，已保留原始数据');
    }
    const icons = {};
    let totalBytes = 0;
    for (const appId of DESKTOP_ICON_IDS) {
        const item = value.icons[appId];
        if (item === undefined || item === null) continue;
        if (!isPlainObject(item) || typeof item.resourceKey !== 'string' || !item.resourceKey.startsWith(DESKTOP_ICON_RESOURCE_PREFIX)) continue;
        const mime = item.mime;
        const width = Number(item.width);
        const height = Number(item.height);
        const byteLength = Number(item.byteLength);
        if (mime !== DESKTOP_ICON_MIME || width !== DESKTOP_ICON_SIZE || height !== DESKTOP_ICON_SIZE
            || !Number.isSafeInteger(byteLength) || byteLength <= 0 || byteLength > DESKTOP_ICON_MAX_ITEM_BYTES
            || totalBytes + byteLength > DESKTOP_ICON_MAX_TOTAL_BYTES) continue;
        icons[appId] = { resourceKey: item.resourceKey, mime, width, height, byteLength };
        totalBytes += byteLength;
    }
    return { schemaVersion: DESKTOP_ICON_SCHEMA_VERSION, icons };
}

async function readManifest(idbRead) {
    const result = await idbRead(DESKTOP_ICON_STORAGE_KEY);
    if (!result?.ok) throw new Error('桌面图标清单读取失败');
    return normalizeManifest(result.value);
}

async function readResource(resourceKey, idbRead) {
    const result = await idbRead(resourceKey);
    if (!result?.ok || typeof result.value !== 'string') return null;
    return result.value;
}

function nextResourceKey(appId) {
    resourceSequence += 1;
    return `${DESKTOP_ICON_RESOURCE_PREFIX}${appId}_${Date.now().toString(36)}_${resourceSequence.toString(36)}`;
}

function runtimeMapFromManifest(manifest, resources) {
    const result = {};
    for (const appId of DESKTOP_ICON_IDS) {
        const item = manifest.icons[appId];
        if (item && typeof resources[item.resourceKey] === 'string') result[appId] = resources[item.resourceKey];
    }
    return result;
}

export function createDesktopIconStorage({
    idbRead = pmIDBReadEntry,
    idbWrite = pmIDBSet,
    idbDelete = pmIDBDel,
    windowRef = globalThis.window,
    logger = console,
} = {}) {
    const setRuntime = value => {
        if (windowRef) windowRef.__pmDesktopIcons = value;
        return value;
    };

    async function load() {
        const manifest = await readManifest(idbRead);
        const resources = {};
        for (const appId of DESKTOP_ICON_IDS) {
            const item = manifest.icons[appId];
            if (!item) continue;
            const resource = await readResource(item.resourceKey, idbRead);
            if (!resource) continue;
            try { validateIconData(appId, resource, item); resources[item.resourceKey] = resource; }
            catch (error) { logger.warn?.(`[phone-mode] 桌面图标 ${appId} 已隔离：${error.message}`); }
        }
        return setRuntime(runtimeMapFromManifest(manifest, resources));
    }

    async function getSnapshot() {
        const manifest = await readManifest(idbRead);
        const resources = {};
        for (const item of Object.values(manifest.icons)) {
            const resource = await readResource(item.resourceKey, idbRead);
            if (resource !== null) resources[item.resourceKey] = resource;
        }
        return { manifest, resources };
    }

    async function writeManifest(manifest) {
        if (!await idbWrite(DESKTOP_ICON_STORAGE_KEY, manifest)) throw new Error('桌面图标清单提交失败');
    }

    async function cleanupKeys(keys) {
        for (const key of keys) {
            if (!await idbDelete(key)) throw new Error(`桌面图标资源清理失败：${key}`);
        }
    }

    async function save(appId, dataUrl, metadata = { width: DESKTOP_ICON_SIZE, height: DESKTOP_ICON_SIZE }) {
        const meta = validateIconData(appId, dataUrl, metadata);
        const old = await getSnapshot();
        const resourceKey = nextResourceKey(appId);
        const next = { schemaVersion: DESKTOP_ICON_SCHEMA_VERSION, icons: { ...old.manifest.icons,
            [appId]: { resourceKey, ...meta } } };
        const totalBytes = Object.values(next.icons).reduce((sum, item) => sum + item.byteLength, 0);
        if (totalBytes > DESKTOP_ICON_MAX_TOTAL_BYTES) throw new Error('桌面图标总容量超过 1.5MiB');
        if (!await idbWrite(resourceKey, dataUrl)) throw new Error(`桌面图标资源写入失败：${appId}`);
        try {
            await writeManifest(next);
            const oldKey = old.manifest.icons[appId]?.resourceKey;
            if (oldKey && oldKey !== resourceKey) await cleanupKeys([oldKey]);
        } catch (error) {
            const rollbackFailures = [];
            try { if (!await idbDelete(resourceKey)) throw new Error(`桌面图标资源补偿删除失败：${resourceKey}`); }
            catch (cleanupError) { rollbackFailures.push(cleanupError); }
            try { await writeManifest(old.manifest); }
            catch (rollbackError) { rollbackFailures.push(rollbackError); }
            if (rollbackFailures.length) error.rollbackError = new AggregateError(rollbackFailures, '桌面图标单项保存回滚失败');
            throw error;
        }
        setRuntime(await load());
        return next.icons[appId];
    }

    async function remove(appId) {
        if (!DESKTOP_ICON_ID_SET.has(appId)) throw new Error(`桌面图标标识不在白名单：${appId}`);
        const old = await getSnapshot();
        const oldItem = old.manifest.icons[appId];
        if (!oldItem) return setRuntime(await load());
        const nextIcons = { ...old.manifest.icons };
        delete nextIcons[appId];
        try {
            await writeManifest({ schemaVersion: DESKTOP_ICON_SCHEMA_VERSION, icons: nextIcons });
            await cleanupKeys([oldItem.resourceKey]);
        } catch (error) {
            try { await idbWrite(oldItem.resourceKey, old.resources[oldItem.resourceKey]); await writeManifest(old.manifest); }
            catch (rollbackError) { error.rollbackError = rollbackError; }
            throw error;
        }
        setRuntime(await load());
        return true;
    }

    async function replace(icons = {}) {
        if (!isPlainObject(icons)) throw new Error('桌面图标整体替换输入必须是对象');
        const old = await getSnapshot();
        const nextIcons = {};
        const newResources = [];
        let totalBytes = 0;
        try {
            for (const appId of DESKTOP_ICON_IDS) {
                if (icons[appId] === undefined || icons[appId] === null) continue;
                const input = isPlainObject(icons[appId]) ? icons[appId] : { dataUrl: icons[appId] };
                const dataUrl = input.dataUrl || input.url;
                const meta = validateIconData(appId, dataUrl, input);
                totalBytes += meta.byteLength;
                if (totalBytes > DESKTOP_ICON_MAX_TOTAL_BYTES) throw new Error('桌面图标总容量超过 1.5MiB');
                const resourceKey = nextResourceKey(appId);
                nextIcons[appId] = { resourceKey, ...meta };
                newResources.push([resourceKey, dataUrl]);
            }
            for (const [key, value] of newResources) {
                if (!await idbWrite(key, value)) throw new Error(`桌面图标资源写入失败：${key}`);
            }
            const next = { schemaVersion: DESKTOP_ICON_SCHEMA_VERSION, icons: nextIcons };
            await writeManifest(next);
            await cleanupKeys(Object.values(old.manifest.icons).map(item => item.resourceKey));
            setRuntime(await load());
            return next;
        } catch (error) {
            const rollbackFailures = [];
            for (const key of newResources.map(([resourceKey]) => resourceKey)) {
                try {
                    if (!await idbDelete(key)) throw new Error(`新桌面图标资源补偿删除失败：${key}`);
                } catch (rollbackError) {
                    rollbackFailures.push(rollbackError);
                }
            }
            try {
                for (const [key, value] of Object.entries(old.resources)) {
                    if (!await idbWrite(key, value)) throw new Error(`旧桌面图标资源恢复失败：${key}`);
                }
                await writeManifest(old.manifest);
            } catch (rollbackError) { rollbackFailures.push(rollbackError); }
            if (rollbackFailures.length) error.rollbackError = new AggregateError(rollbackFailures, '桌面图标整体替换回滚失败');
            throw error;
        }
    }

    return Object.freeze({ load, save, remove, replace, normalizeManifest, validateIconData });
}

const defaultStorage = createDesktopIconStorage();
let defaultMutationQueue = Promise.resolve();
const enqueueDefaultOperation = operation => {
    const result = defaultMutationQueue.then(operation, operation);
    defaultMutationQueue = result.catch(() => undefined);
    return result;
};

export const loadDesktopIcons = (...args) => enqueueDefaultOperation(() => defaultStorage.load(...args));
export const saveDesktopIcon = (...args) => enqueueDefaultOperation(() => defaultStorage.save(...args));
export const removeDesktopIcon = (...args) => enqueueDefaultOperation(() => defaultStorage.remove(...args));
export const replaceDesktopIcons = (...args) => enqueueDefaultOperation(() => defaultStorage.replace(...args));
export const normalizeDesktopIconManifest = normalizeManifest;
