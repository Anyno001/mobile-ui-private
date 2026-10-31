// 生成图片的存放：图片本体上传到酒馆 user/images/tianyin-phone/（照 IGS media/tavern-image-files.js），
// 本机只存目录（路径、描述、提示词、来源）和缩略图。上传失败就算这张失败，不在浏览器里留 data URL。
// 当前聊天的目录另抄一份到 chatMetadata.tianyin_phone_images，随聊天文件走；缩略图不进元数据，缺了在本机重做。

import { pmIDBDel, pmIDBGet, pmIDBSet } from './storage-primitives.js';

export const IMAGE_CATALOG_KEY = 'ST_SMS_IMAGE_CATALOG_V1';
export const IMAGE_DNA_STORE_KEY = 'ST_SMS_IMAGE_DNA_V1';
export const IMAGE_THUMB_PREFIX = 'ST_SMS_IMAGE_THUMB_';
export const IMAGE_METADATA_KEY = 'tianyin_phone_images';
export const IMAGE_UPLOAD_FOLDER = 'tianyin-phone';
export const IMAGE_CATALOG_LIMIT = 2000;
export const IMAGE_THUMB_WIDTH = 360;
const SOURCE_TYPES = ['chat', 'community', 'video', 'manual'];

const text = (value, limit) => typeof value === 'string' ? value.trim().slice(0, limit) : '';
const plain = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
const isImagePath = value => /^user\/images\/[\w.-]+\/[\w.-]+\.(?:png|jpe?g|webp)$/i.test(String(value || ''));

export function bindingKey(source) {
    const s = plain(source);
    return [s.type, s.storageId, s.contact, s.messageId, s.bubbleId, s.sceneId, s.postId].map(v => String(v || '')).join('\u0001');
}

export function normalizeImageRecord(value) {
    const source = plain(value);
    const id = text(source.id, 80);
    const path = text(source.path, 300).replace(/\\/g, '/').replace(/^\//, '');
    if (!id || !isImagePath(path)) return null;
    const src = plain(source.source);
    const type = SOURCE_TYPES.includes(src.type) ? src.type : 'manual';
    return {
        id, path,
        description: text(source.description, 400),
        ...(source.caption && typeof source.caption === 'object' && { caption: source.caption }),
        source: {
            type,
            storageId: text(src.storageId, 160),
            ...(text(src.contact, 80) && { contact: text(src.contact, 80) }),
            ...(text(src.sender, 80) && { sender: text(src.sender, 80) }),
            ...(text(src.messageId, 120) && { messageId: text(src.messageId, 120) }),
            ...(text(src.bubbleId, 120) && { bubbleId: text(src.bubbleId, 120) }),
            ...(text(src.sceneId, 120) && { sceneId: text(src.sceneId, 120) }),
            ...(text(src.postId, 120) && { postId: text(src.postId, 120) }),
        },
        width: Number.isSafeInteger(source.width) && source.width > 0 ? source.width : 0,
        height: Number.isSafeInteger(source.height) && source.height > 0 ? source.height : 0,
        favorite: source.favorite === true,
        createdAt: Number.isSafeInteger(source.createdAt) ? source.createdAt : 0,
    };
}

export function normalizeImageCatalog(value) {
    const records = {};
    for (const record of Object.values(plain(plain(value).records))) {
        const normalized = normalizeImageRecord(record);
        if (normalized) records[normalized.id] = normalized;
    }
    return { version: 1, records };
}

/** 同一个气泡/帖子可能重画过多次，取最新一张。 */
export function latestForBinding(catalog, source) {
    const key = bindingKey(source);
    let best = null;
    for (const record of Object.values(catalog.records)) {
        if (bindingKey(record.source) === key && (!best || record.createdAt > best.createdAt)) best = record;
    }
    return best;
}

export function imageUrl(path) { return `/${String(path || '').replace(/^\//, '')}`; }

async function contentHash(dataUrl) {
    const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
    const bytes = Uint8Array.from(atob(base64), char => char.charCodeAt(0));
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return [...new Uint8Array(digest)].slice(0, 12).map(b => b.toString(16).padStart(2, '0')).join('');
}

function requestHeaders(getCtx) {
    const ctx = getCtx?.();
    return typeof ctx?.getRequestHeaders === 'function' ? ctx.getRequestHeaders() : { 'Content-Type': 'application/json' };
}

export async function uploadImage(dataUrl, { getCtx, fetchImpl = (...args) => globalThis.fetch(...args) } = {}) {
    const match = /^data:image\/([a-z0-9.+-]+);base64,/i.exec(String(dataUrl || ''));
    if (!match) throw new Error('图片格式无法识别');
    const format = /^jpe?g$/i.test(match[1]) ? 'jpg' : match[1].toLowerCase();
    const filename = await contentHash(dataUrl);
    let response;
    try {
        response = await fetchImpl('/api/images/upload', { method: 'POST', headers: requestHeaders(getCtx),
            body: JSON.stringify({ image: dataUrl.slice(match[0].length), ch_name: IMAGE_UPLOAD_FOLDER, filename, format }) });
    } catch (error) {
        throw new Error(`上传到酒馆失败：${error?.message || '网络不通'}`);
    }
    if (!response?.ok) throw new Error(`上传到酒馆失败：HTTP ${response?.status ?? '无响应'}`);
    const path = String((await response.json().catch(() => ({})))?.path || '').replace(/\\/g, '/').replace(/^\//, '');
    if (!isImagePath(path)) throw new Error('上传到酒馆失败：没有返回图片路径');
    return path;
}

export async function deleteImageFile(path, { getCtx, fetchImpl = (...args) => globalThis.fetch(...args) } = {}) {
    if (!isImagePath(path)) return true;
    const response = await fetchImpl('/api/images/delete', { method: 'POST', headers: requestHeaders(getCtx),
        body: JSON.stringify({ path }) }).catch(() => null);
    // 文件已经不在也算删掉了。
    return Boolean(response && (response.ok || response.status === 404));
}

/** 缩成固定宽度的 JPEG data URL，只给相册网格用。 */
export async function makeThumbnail(src, width = IMAGE_THUMB_WIDTH) {
    const image = new Image();
    image.decoding = 'async';
    image.src = src;
    await image.decode();
    const scale = Math.min(1, width / (image.naturalWidth || width));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round((image.naturalWidth || width) * scale));
    canvas.height = Math.max(1, Math.round((image.naturalHeight || width) * scale));
    canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
    return { thumb: canvas.toDataURL('image/jpeg', 0.82), width: image.naturalWidth || 0, height: image.naturalHeight || 0 };
}

export function createImageStore({ getCtx, fetchImpl, readCatalog = () => pmIDBGet(IMAGE_CATALOG_KEY),
    writeCatalog = value => pmIDBSet(IMAGE_CATALOG_KEY, value), readThumb = id => pmIDBGet(IMAGE_THUMB_PREFIX + id),
    writeThumb = (id, value) => pmIDBSet(IMAGE_THUMB_PREFIX + id, value), deleteThumb = id => pmIDBDel(IMAGE_THUMB_PREFIX + id) } = {}) {
    let catalog = null;
    let loading = null;
    const listeners = new Set();
    const notify = change => { for (const listener of listeners) { try { listener(change); } catch (error) { console.warn('[phone-mode] 图片目录通知失败', error); } } };

    const load = async () => {
        if (catalog) return catalog;
        loading ||= readCatalog().then(value => { catalog = normalizeImageCatalog(value); return catalog; })
            .catch(() => { catalog = normalizeImageCatalog(null); return catalog; }).finally(() => { loading = null; });
        return loading;
    };
    const persist = async next => {
        if (await writeCatalog(next) === false) throw new Error('图片目录保存失败：IndexedDB不可用');
        catalog = next;
    };

    // 当前聊天的目录抄进 chatMetadata；聊天文件里只有路径和描述，不放缩略图。
    function mirrorToMetadata(storageId) {
        const ctx = getCtx?.();
        if (!ctx?.chatMetadata || !catalog || !storageId) return;
        const records = Object.values(catalog.records).filter(record => record.source.storageId === storageId)
            .map(({ caption, ...rest }) => rest);
        ctx.chatMetadata[IMAGE_METADATA_KEY] = { version: 1, storageId, records };
        ctx.saveMetadataDebounced?.();
    }

    /** 打开手机或切换聊天时：元数据里有、本机没有的记录补进本机目录。 */
    async function importFromMetadata(storageId) {
        const payload = plain(getCtx?.()?.chatMetadata?.[IMAGE_METADATA_KEY]);
        if (!storageId || payload.storageId !== storageId || !Array.isArray(payload.records)) return 0;
        const current = await load();
        const additions = payload.records.map(normalizeImageRecord).filter(record => record && !current.records[record.id]);
        if (!additions.length) return 0;
        await persist({ ...current, records: { ...current.records, ...Object.fromEntries(additions.map(r => [r.id, r])) } });
        notify({ type: 'import', storageId });
        return additions.length;
    }

    async function add({ dataUrl, description, caption, source }) {
        const path = await uploadImage(dataUrl, { getCtx, fetchImpl });
        let thumb = '', width = 0, height = 0;
        try { ({ thumb, width, height } = await makeThumbnail(dataUrl)); } catch (error) { /* 缩略图之后在相册里补 */ }
        const record = normalizeImageRecord({ id: `img_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
            path, description, caption, source, width, height, createdAt: Date.now() });
        if (!record) throw new Error('图片记录无效');
        const current = await load();
        const records = { ...current.records, [record.id]: record };
        // 超出上限时丢最旧的非收藏记录（只删目录，不删文件）。
        const overflow = Object.values(records).filter(r => !r.favorite).sort((a, b) => a.createdAt - b.createdAt)
            .slice(0, Math.max(0, Object.keys(records).length - IMAGE_CATALOG_LIMIT));
        for (const old of overflow) delete records[old.id];
        await persist({ ...current, records });
        if (thumb) await writeThumb(record.id, thumb).catch(() => {});
        mirrorToMetadata(record.source.storageId);
        notify({ type: 'add', record });
        return record;
    }

    async function update(id, patch) {
        const current = await load();
        const record = current.records[id];
        if (!record) return null;
        const next = normalizeImageRecord({ ...record, ...patch, id, path: record.path, source: record.source });
        await persist({ ...current, records: { ...current.records, [id]: next } });
        mirrorToMetadata(next.source.storageId);
        notify({ type: 'update', record: next });
        return next;
    }

    /** 「拍一张」的图先挂在临时来源上，消息提交后改挂到真正的气泡。 */
    async function rebind(id, source) {
        const current = await load();
        const record = current.records[id];
        if (!record) return null;
        const next = normalizeImageRecord({ ...record, source });
        await persist({ ...current, records: { ...current.records, [id]: next } });
        mirrorToMetadata(next.source.storageId);
        notify({ type: 'update', record: next });
        return next;
    }

    async function remove(id) {
        const current = await load();
        const record = current.records[id];
        if (!record) return false;
        const shared = Object.values(current.records).some(other => other.id !== id && other.path === record.path);
        if (!shared && !(await deleteImageFile(record.path, { getCtx, fetchImpl }))) throw new Error('酒馆文件夹中的图片未能删除，请稍后重试');
        const records = { ...current.records };
        delete records[id];
        await persist({ ...current, records });
        await deleteThumb(id).catch(() => {});
        mirrorToMetadata(record.source.storageId);
        notify({ type: 'remove', record });
        return true;
    }

    async function thumbnail(record) {
        const saved = await readThumb(record.id).catch(() => null);
        if (typeof saved === 'string' && saved.startsWith('data:image/')) return saved;
        try {
            const { thumb } = await makeThumbnail(imageUrl(record.path));
            await writeThumb(record.id, thumb).catch(() => {});
            return thumb;
        } catch (error) { return ''; }
    }

    return {
        load, add, update, remove, thumbnail, importFromMetadata,
        list: async () => Object.values((await load()).records).sort((a, b) => b.createdAt - a.createdAt),
        latestFor: async source => latestForBinding(await load(), source),
        isLoaded: () => Boolean(catalog),
        peekLatestFor: source => catalog ? latestForBinding(catalog, source) : null,
        peekRecord: id => catalog?.records[id] || null,
        rebind,
        subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener); },
        reset: () => { catalog = null; },
    };
}
