// 数据库生图插件（window.NaiDbGen）调用。照 IGS generated-images/image-backend.js 的 DBGen 路径：
// 插件用自己的预设与 LLM 写词（generateSinglePrompt），再用返回的完整 caption 出图（generate）。
// 手机只交「画什么」的中文描述，不接管插件的写词预设、画师与关键词替换。

export const DBGEN_LABEL = '数据库生图插件';
// 等待较久只提示仍在处理，继续接收同一次调用的结果。
export const DBGEN_TIMEOUTS = Object.freeze({ write: 5 * 60 * 1000, paint: 3 * 60 * 1000 });
export const PHONE_IMAGE_SIZES = Object.freeze({
    portrait: Object.freeze({ width: 832, height: 1216 }),
    square: Object.freeze({ width: 1024, height: 1024 }),
    landscape: Object.freeze({ width: 1216, height: 832 }),
});

export function findDbgenApi(globalObject = globalThis) {
    const candidates = [];
    const push = read => { try { candidates.push(read()); } catch (error) { /* 跨域窗口 */ } };
    push(() => globalObject?.NaiDbGen);
    push(() => globalObject?.top?.NaiDbGen);
    push(() => globalObject?.parent?.NaiDbGen);
    return candidates.find(api => api && typeof api.generate === 'function') || null;
}

export function dbgenStatus(globalObject = globalThis) {
    const api = findDbgenApi(globalObject);
    if (!api) return { ok: false, error: `未检测到${DBGEN_LABEL}，请先安装并启用` };
    if (typeof api.generateSinglePrompt !== 'function') return { ok: false, error: `${DBGEN_LABEL}版本过旧，缺少写提示词接口` };
    return { ok: true };
}

function abortError() {
    const error = new Error('已取消');
    error.name = 'AbortError';
    return error;
}

function waitForPluginResult(promise, ms, onSlow, signal) {
    let timer, abort;
    const cancelled = new Promise((_, reject) => {
        abort = () => reject(abortError());
        signal?.addEventListener('abort', abort, { once: true });
        if (signal?.aborted) abort();
    });
    if (ms > 0) timer = setTimeout(() => { try { onSlow?.(); } catch (error) { /* 状态展示不影响原请求 */ } }, ms);
    return Promise.race([promise, cancelled]).finally(() => { clearTimeout(timer); signal?.removeEventListener('abort', abort); });
}

export function captionHasPromptText(caption) {
    const positive = caption?.v4_prompt?.caption;
    if (!positive || typeof positive !== 'object') return false;
    if (String(positive.base_caption || '').trim()) return true;
    return (Array.isArray(positive.char_captions) ? positive.char_captions : [])
        .some(item => String(item?.char_caption || '').trim());
}

export async function blobToDataUrl(blob, mimeType, globalObject = globalThis) {
    if (typeof blob === 'string') {
        if (!blob.trim() || /^data:[^,]*,\s*$/.test(blob)) throw new Error('返回空图');
        return blob;
    }
    const buffer = typeof blob.arrayBuffer === 'function' ? await blob.arrayBuffer() : await new Response(blob).arrayBuffer();
    const bytes = new Uint8Array(buffer);
    if (!bytes.length) throw new Error('返回空图');
    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    const encode = typeof globalObject?.btoa === 'function' ? globalObject.btoa.bind(globalObject) : globalThis.btoa;
    return `data:${mimeType || blob.type || 'image/png'};base64,${encode(binary)}`;
}

function resultError(result, fallback) {
    const error = result?.error;
    if (!error) return fallback;
    if (typeof error === 'string') return error;
    return [error.message, error.hint].filter(Boolean).join('：') || fallback;
}

/** 写词：返回插件的完整 caption。 */
export async function writeDbgenCaption({ description, signal, onSlow, globalObject = globalThis } = {}) {
    const status = dbgenStatus(globalObject);
    if (!status.ok) return status;
    const text = String(description || '').trim();
    if (!text) return { ok: false, error: '没有画面描述' };
    let written;
    try {
        written = await waitForPluginResult(findDbgenApi(globalObject).generateSinglePrompt({ description: text, skipRecall: true, signal }),
            DBGEN_TIMEOUTS.write, () => onSlow?.('write'), signal);
    } catch (error) {
        if (error?.name === 'AbortError') throw error;
        return { ok: false, error: `${DBGEN_LABEL}写词出错：${error?.message || error}` };
    }
    const caption = written?.ok ? written.value?.caption : null;
    if (!captionHasPromptText(caption)) return { ok: false, error: `${DBGEN_LABEL}没有返回可用的提示词` };
    return { ok: true, caption };
}

/** 出图：caption 原样交给插件，返回 data URL。 */
export async function paintDbgenCaption({ caption, size, seed, model, artist, signal, onSlow, globalObject = globalThis } = {}) {
    const api = findDbgenApi(globalObject);
    if (!api) return { ok: false, error: `未检测到${DBGEN_LABEL}，请先安装并启用` };
    if (!captionHasPromptText(caption)) return { ok: false, error: '提示词为空，未出图' };
    const params = {
        ...(size && Number(size.width) > 0 && Number(size.height) > 0 && { width: Number(size.width), height: Number(size.height) }),
        ...(Number.isInteger(seed) && seed >= 0 && { seed }),
        ...(String(model || '').trim() && { model: String(model).trim() }),
    };
    // 画师串两项都空时不传，插件用自己的默认画师。
    const positivePrompt = String(artist?.positive || '').trim(), negativePrompt = String(artist?.negative || '').trim();
    let result;
    try {
        result = await waitForPluginResult(api.generate({
            caption, replaceCharacterKeywords: true, signal,
            ...((positivePrompt || negativePrompt) && { artist: { positivePrompt, negativePrompt } }),
            ...(Object.keys(params).length && { params }),
        }), DBGEN_TIMEOUTS.paint, () => onSlow?.('paint'), signal);
    } catch (error) {
        if (error?.name === 'AbortError') throw error;
        return { ok: false, error: `${DBGEN_LABEL}出图失败：${error?.message || error}` };
    }
    const image = result?.ok && Array.isArray(result.value) ? result.value[0] : null;
    if (!image?.blob) return { ok: false, error: `${DBGEN_LABEL}出图失败：${resultError(result, '未返回图片')}` };
    try {
        return { ok: true, dataUrl: await blobToDataUrl(image.blob, image.mimeType, globalObject) };
    } catch (error) {
        return { ok: false, error: `${DBGEN_LABEL}图片读取失败：${error?.message || error}` };
    }
}

/** 写词 + 出图。已有 caption（重画）时跳过写词。 */
export async function generateDbgenImage({ description, caption, size, seed, model, artist, signal, onSlow, onStage, globalObject = globalThis } = {}) {
    let finalCaption = caption;
    if (!captionHasPromptText(finalCaption)) {
        onStage?.('write');
        const written = await writeDbgenCaption({ description, signal, onSlow, globalObject });
        if (!written.ok) return written;
        finalCaption = written.caption;
    }
    onStage?.('paint');
    const painted = await paintDbgenCaption({ caption: finalCaption, size, seed, model, artist, signal, onSlow, globalObject });
    // 出图失败也带回 caption，重试时不用再写一次词。
    return { ...painted, caption: finalCaption };
}
