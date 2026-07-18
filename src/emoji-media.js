export const MAX_EMOJI_FILE_BYTES = 1024 * 1024;
export const MAX_EMOJI_INLINE_LIBRARY_BYTES = 8 * 1024 * 1024;
export const MAX_EMOJI_RENDER_BYTES = 4 * 1024 * 1024;

const DATA_URL_PATTERN = /^data:([^;,]+)?((?:;[^,]*)*),(.*)$/is;

export function emojiDataUrlBytes(value) {
    const match = String(value || '').match(DATA_URL_PATTERN);
    if (!match) return 0;
    const metadata = match[2] || '';
    const payload = match[3] || '';
    if (/;base64(?:;|$)/i.test(metadata)) {
        const compact = payload.replace(/\s/g, '');
        const padding = compact.endsWith('==') ? 2 : compact.endsWith('=') ? 1 : 0;
        return Math.max(0, Math.floor(compact.length * 3 / 4) - padding);
    }
    try { return new TextEncoder().encode(decodeURIComponent(payload)).length; }
    catch { return new TextEncoder().encode(payload).length; }
}

export function emojiInlineBytes(sets) {
    return (Array.isArray(sets) ? sets : []).reduce((total, set) => total
        + (Array.isArray(set?.images) ? set.images : []).reduce((sum, image) => sum + emojiDataUrlBytes(image?.url), 0), 0);
}

export function cloneEmojiLibrary(sets) {
    return (Array.isArray(sets) ? sets : []).map(set => ({
        ...set,
        images: (Array.isArray(set?.images) ? set.images : []).map(image => ({ ...image })),
    }));
}

export function emojiFileError(file) {
    if (!file) return '请选择图片文件。';
    if (!String(file.type || '').toLowerCase().startsWith('image/')) return '只能上传图片文件。';
    if (Number(file.size) > MAX_EMOJI_FILE_BYTES) return '图片不能超过 1 MB，请压缩后重试。';
    return '';
}

export function emojiSourceError(url, sets = []) {
    const source = String(url || '').trim();
    if (!source) return '请输入图片 URL 或上传图片。';
    if (!source.toLowerCase().startsWith('data:')) return '为防止远程动图导致界面卡死，请上传本地图片。';
    if (!source.toLowerCase().startsWith('data:image/')) return '内联内容必须是图片。';
    const bytes = emojiDataUrlBytes(source);
    if (bytes > MAX_EMOJI_FILE_BYTES) return '图片不能超过 1 MB，请压缩后重试。';
    if (emojiInlineBytes(sets) + bytes > MAX_EMOJI_INLINE_LIBRARY_BYTES) return '本地表情总容量不能超过 8 MB，请先删除不常用图片。';
    return '';
}

export function isRenderableEmojiSource(url) {
    const source = String(url || '').trim();
    if (!source) return false;
    return source.toLowerCase().startsWith('data:image/') && emojiDataUrlBytes(source) <= MAX_EMOJI_FILE_BYTES;
}

export function createEmojiRenderBudget(maxBytes = MAX_EMOJI_RENDER_BYTES) {
    let used = 0;
    return url => {
        if (!isRenderableEmojiSource(url)) return false;
        const bytes = emojiDataUrlBytes(url);
        if (used + bytes > maxBytes) return false;
        used += bytes;
        return true;
    };
}
