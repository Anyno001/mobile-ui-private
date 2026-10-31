// 内置 NAI 出图。照抄 IGS generated-images/request-builders/nai-v4-builder.js、nai-official-client.js、
// image-response-zip.js 与 host/tavern-cors-proxy.js，去掉 IGS 的模板定稿、局部重绘和多任务队列。

export const NAI_OFFICIAL_ENDPOINT = 'https://image.novelai.net/ai/generate-image';
export const NAI_DEFAULT_NEGATIVE = 'lowres, artistic error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, dithering, halftone, screentone, multiple views, logo, too many watermarks, negative space, blank page';
export const NAI_OFFICIAL_MODELS = Object.freeze(['nai-diffusion-4-5-full', 'nai-diffusion-4-5-curated', 'nai-diffusion-5-full', 'nai-diffusion-5-curated', 'nai-diffusion-4-full', 'nai-diffusion-4-curated-preview']);
export const NAI_SAMPLERS = Object.freeze(['k_euler_ancestral', 'k_euler', 'k_dpmpp_2s_ancestral', 'k_dpmpp_2m', 'k_dpmpp_sde', 'ddim_v3']);
export const NAI_NOISE_SCHEDULES = Object.freeze(['karras', 'native', 'exponential', 'polyexponential']);
export const NAI_TRANSPORTS = Object.freeze(['direct', 'st-proxy', 'auto']);
export const NAI_DEFAULTS = Object.freeze({ endpoint: '', apiKey: '', transport: 'auto', model: 'nai-diffusion-4-5-full', steps: 28, scale: 5,
    sampler: 'k_euler_ancestral', noiseSchedule: 'karras', negativePrompt: NAI_DEFAULT_NEGATIVE });

const GRID = [0.1, 0.3, 0.5, 0.7, 0.9];
const PROXY_DISABLED = /CORS proxy is disabled/i;
const joinTags = (...parts) => parts.map(p => String(p || '').trim().replace(/^,+|,+$/g, '').trim()).filter(Boolean).join(', ');
const isV5 = model => { const m = String(model || '').toLowerCase(); return !m.includes('4-5') && !m.includes('4.5') && m.includes('diffusion-5'); };
export const snapToGrid = value => { const n = Number(value); return Number.isFinite(n) ? GRID.reduce((best, g) => Math.abs(g - n) < Math.abs(best - n) ? g : best, 0.5) : 0.5; };

// 留空用官网；根地址或 /ai 补成 /ai/generate-image；其余自定义路径原样保留（中转）。
export function resolveNaiEndpoint(endpoint) {
    const trimmed = String(endpoint || '').trim();
    if (!trimmed) return NAI_OFFICIAL_ENDPOINT;
    try {
        const url = new URL(trimmed);
        if (!['http:', 'https:'].includes(url.protocol)) return trimmed;
        const path = url.pathname.replace(/\/+$/, '');
        if (path === '' || path === '/ai') url.pathname = '/ai/generate-image';
        else return trimmed;
        return url.href;
    } catch (error) { return trimmed; }
}
const isOfficialEndpoint = endpoint => { const t = String(endpoint || '').trim(); if (!t) return true; try { return /(^|\.)novelai\.net$/i.test(new URL(t).hostname); } catch (error) { return false; } };

/** slot：{ scene, sceneUc?, chars:[{ tags, uc, x, y }] }；settings：方案里的 NAI 参数 + 画师串 + 尺寸 + seed。 */
export function buildNaiRequest(slot, settings = {}, random = Math.random) {
    const s = { ...NAI_DEFAULTS, ...settings };
    const model = String(s.model || NAI_DEFAULTS.model);
    const chars = (Array.isArray(slot?.chars) ? slot.chars : []).filter(c => String(c?.tags || '').trim());
    const base = joinTags(s.artistPositive, slot?.scene);
    const negBase = joinTags(s.artistNegative, s.negativePrompt, slot?.sceneUc);
    const posChars = chars.map(c => ({ char_caption: String(c.tags).trim(), centers: [{ x: snapToGrid(c.x), y: snapToGrid(c.y) }] }));
    const negChars = chars.map((c, i) => ({ char_caption: String(c.uc || '').trim(), centers: posChars[i].centers }));
    const useCoords = posChars.length > 0;
    const seed = Number.isInteger(s.seed) && s.seed >= 0 ? s.seed : Math.floor(random() * 4294967295);
    return {
        input: base, model, action: 'generate',
        parameters: {
            params_version: 4, width: Number(s.width) || 832, height: Number(s.height) || 1216,
            scale: Number(s.scale) || 5, sampler: NAI_SAMPLERS.includes(s.sampler) ? s.sampler : NAI_DEFAULTS.sampler,
            steps: Math.max(1, Math.min(50, Number(s.steps) || 28)), n_samples: 1, seed,
            noise_schedule: isV5(model) ? 'karras' : (NAI_NOISE_SCHEDULES.includes(s.noiseSchedule) ? s.noiseSchedule : 'karras'),
            cfg_rescale: 0, skip_cfg_above_sigma: null, image_format: 'png',
            qualityToggle: true, tag_hint_qt: 1, ucPreset: 0, tag_hint_uc_preset: 1,
            negative_prompt: negBase, use_coords: useCoords,
            v4_prompt: { caption: { base_caption: base, char_captions: posChars }, use_coords: useCoords, use_order: true },
            v4_negative_prompt: { caption: { base_caption: negBase, char_captions: negChars }, legacy_uc: false },
        },
    };
}

// 部分中转只转发场景段、丢角色段：非官网地址时把角色词并进场景段（画师串之后），角色段原样保留。
export function foldCharsForRelay(body, endpoint, artistPositive = '') {
    const p = body?.parameters;
    const pos = p?.v4_prompt?.caption, neg = p?.v4_negative_prompt?.caption;
    if (isOfficialEndpoint(endpoint) || !pos?.char_captions?.length) return body;
    // 角色词插在画师串之后、场景词之前：靠前的词权重高，超长被截掉的是末尾的场景词。
    const head = String(artistPositive || '').trim();
    const hasHead = Boolean(head) && pos.base_caption.startsWith(head);
    const base = joinTags(hasHead ? head : '', ...pos.char_captions.map(c => c.char_caption), hasHead ? pos.base_caption.slice(head.length) : pos.base_caption);
    const negBase = joinTags(neg.base_caption, ...neg.char_captions.map(c => c.char_caption));
    return { ...body, input: base, parameters: { ...p, negative_prompt: negBase,
        v4_prompt: { ...p.v4_prompt, caption: { ...pos, base_caption: base } },
        v4_negative_prompt: { ...p.v4_negative_prompt, caption: { ...neg, base_caption: negBase } } } };
}

// —— 响应解析：NAI 返回 ZIP（内含 PNG），中转可能直接返回图片 ——
const zipFail = (reason, message) => { throw Object.assign(new Error(message), { reason }); };
async function inflateRaw(bytes, expected) {
    let stream;
    try { stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw')); }
    catch (error) { zipFail('zip-deflate-unavailable', '当前浏览器不支持ZIP解压'); }
    const out = new Uint8Array(await new Response(stream).arrayBuffer());
    if (expected && out.length !== expected) zipFail('zip-truncated', 'ZIP响应不完整');
    return out;
}
export async function readZipFirstImage(buffer) {
    const view = new DataView(buffer);
    let end = -1;
    for (let p = view.byteLength - 22; p >= Math.max(0, view.byteLength - 65557); p--) {
        if (view.getUint32(p, true) === 0x06054b50) { end = p; break; }
    }
    const entries = [];
    if (end >= 0) {
        const count = view.getUint16(end + 10, true);
        let p = view.getUint32(end + 16, true);
        for (let i = 0; i < count; i++) {
            if (view.getUint32(p, true) !== 0x02014b50) zipFail('zip-truncated', 'ZIP响应不完整');
            entries.push({ method: view.getUint16(p + 10, true), size: view.getUint32(p + 20, true), unpacked: view.getUint32(p + 24, true), offset: view.getUint32(p + 42, true) });
            p += 46 + view.getUint16(p + 28, true) + view.getUint16(p + 30, true) + view.getUint16(p + 32, true);
        }
    } else if (view.byteLength >= 30 && view.getUint32(0, true) === 0x04034b50) {
        entries.push({ method: view.getUint16(8, true), size: view.getUint32(18, true), unpacked: view.getUint32(22, true), offset: 0 });
    }
    for (const entry of entries) {
        const o = entry.offset;
        if (view.getUint32(o, true) !== 0x04034b50) zipFail('zip-truncated', 'ZIP响应不完整');
        const nameLength = view.getUint16(o + 26, true);
        const name = new TextDecoder().decode(new Uint8Array(buffer, o + 30, nameLength));
        if (name && !/\.(png|jpe?g|webp)$/i.test(name)) continue;
        const start = o + 30 + nameLength + view.getUint16(o + 28, true);
        if (start + entry.size > view.byteLength) zipFail('zip-truncated', 'ZIP响应不完整');
        const raw = new Uint8Array(buffer, start, entry.size);
        const bytes = entry.method === 8 ? await inflateRaw(raw, entry.unpacked) : entry.method === 0 ? raw : zipFail('zip-method', 'ZIP压缩方式不受支持');
        const ext = (name.match(/\.(png|jpe?g|webp)$/i) || [])[1]?.toLowerCase() || 'png';
        return { bytes, type: ext.startsWith('jp') ? 'image/jpeg' : `image/${ext}` };
    }
    zipFail('zip-no-image', 'ZIP响应中没有图片');
}
const toBase64 = bytes => { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); return btoa(s); };
export async function imageFromResponse(response) {
    const buffer = await response.arrayBuffer();
    const b = new Uint8Array(buffer);
    if (b[0] === 0x50 && b[1] === 0x4b) { const img = await readZipFirstImage(buffer); return `data:${img.type};base64,${toBase64(img.bytes)}`; }
    if (b[0] === 0x89 && b[1] === 0x50) return `data:image/png;base64,${toBase64(b)}`;
    if (b[0] === 0xff && b[1] === 0xd8) return `data:image/jpeg;base64,${toBase64(b)}`;
    // 少数中转返回 JSON：取第一个图片字段。
    try {
        const data = JSON.parse(new TextDecoder().decode(b));
        const found = JSON.stringify(data).match(/"(data:image\/[^"]+|[A-Za-z0-9+/]{200,}={0,2})"/);
        if (found) return found[1].startsWith('data:') ? found[1] : `data:image/png;base64,${found[1]}`;
    } catch (error) { /* 不是 JSON */ }
    zipFail('response-unrecognized', '响应不是可识别的图片');
}

// —— 传输：酒馆 CORS 代理 /proxy/；auto 先探测代理是否开启 ——
let proxyProbe = null;
export function resetNaiProxyProbe() { proxyProbe = null; }
async function resolveTransport(transport, fetchImpl) {
    if (transport === 'st-proxy' || transport === 'direct') return transport;
    if (!proxyProbe || Date.now() - proxyProbe.at > 5 * 60 * 1000) {
        const origin = globalThis.location?.origin;
        proxyProbe = { at: Date.now(), value: (async () => {
            if (!origin) return 'direct';
            try {
                const r = await fetchImpl(`/proxy/${origin}/tianyin-proxy-probe`, { method: 'GET', credentials: 'same-origin', cache: 'no-store' });
                const text = String(await r.text().catch(() => ''));
                return !PROXY_DISABLED.test(text) && ![401, 403].includes(r.status) ? 'st-proxy' : 'direct';
            } catch (error) { return 'direct'; }
        })() };
    }
    return proxyProbe.value;
}

function describeStatus(status, detail) {
    const suffix = detail ? `：${detail}` : '';
    if (status === 401) return 'NAI鉴权失败（401），请检查Key';
    if (status === 402) return 'NAI余额或订阅不足（402）';
    if (status === 429) return `NAI请求过于频繁（429），重试后仍失败${suffix}`;
    if (status >= 500) return `NAI服务端错误（HTTP ${status}）${suffix}`;
    return `NAI返回HTTP ${status}${suffix}`;
}
function safeDetail(text, apiKey) {
    let value = String(text || '');
    try { const d = JSON.parse(value); const m = d?.message ?? d?.error?.message ?? d?.error ?? d?.detail; if (typeof m === 'string') value = m; } catch (error) { /* 纯文本 */ }
    if (apiKey) value = value.split(apiKey).join('[已隐藏]');
    return value.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120);
}
const wait = (ms, signal) => new Promise(resolve => { const t = setTimeout(resolve, ms); signal?.addEventListener('abort', () => { clearTimeout(t); resolve(); }, { once: true }); });

/** 发请求出图。429 最多重试 2 次；其余失败不补发（发送状态未知时补发可能重复扣点）。 */
export async function paintNai(slot, settings = {}, { signal, fetchImpl = (...a) => globalThis.fetch(...a), random = Math.random } = {}) {
    const apiKey = String(settings.apiKey || '').trim();
    if (!apiKey) return { ok: false, error: '请先在生图方案里填写NAI Key' };
    if (!String(slot?.scene || '').trim() && !(slot?.chars || []).length) return { ok: false, error: '提示词为空，未出图' };
    const body = foldCharsForRelay(buildNaiRequest(slot, settings, random), settings.endpoint, settings.artistPositive);
    const wire = { ...body, parameters: { ...body.parameters } };
    const transport = await resolveTransport(settings.transport || 'auto', fetchImpl);
    const target = resolveNaiEndpoint(settings.endpoint);
    const url = transport === 'st-proxy' ? `/proxy/${target}` : target;
    for (let attempt = 0; attempt < 3; attempt++) {
        if (signal?.aborted) throw Object.assign(new Error('已取消'), { name: 'AbortError' });
        let response;
        try {
            response = await fetchImpl(url, { method: 'POST', signal, mode: transport === 'st-proxy' ? 'same-origin' : 'cors',
                credentials: transport === 'st-proxy' ? 'same-origin' : 'omit',
                headers: { 'Content-Type': 'application/json', Accept: 'application/zip, application/octet-stream, image/png, application/json', Authorization: `Bearer ${apiKey}` },
                body: JSON.stringify(wire) });
        } catch (error) {
            if (error?.name === 'AbortError') throw error;
            return { ok: false, error: transport === 'st-proxy' ? '经酒馆代理请求NAI失败：无法连接酒馆'
                : '浏览器直连NAI失败（可能是跨域或网络不通）。可在酒馆config.yaml开启enableCorsProxy，并把传输方式改为「酒馆代理」或「自动」' };
        }
        if (response.ok) {
            try { return { ok: true, dataUrl: await imageFromResponse(response), seed: body.parameters.seed }; }
            catch (error) { return { ok: false, error: `NAI图片解析失败：${error.message}` }; }
        }
        if (response.status === 429 && attempt < 2) { await wait(5000 * 2 ** attempt, signal); continue; }
        const text = await response.text().catch(() => '');
        if (transport === 'st-proxy' && response.status === 404 && PROXY_DISABLED.test(text)) {
            resetNaiProxyProbe();
            return { ok: false, error: '酒馆CORS代理未开启：在酒馆config.yaml设置enableCorsProxy: true并重启酒馆' };
        }
        return { ok: false, error: describeStatus(response.status, safeDetail(text, apiKey)), status: response.status };
    }
    return { ok: false, error: 'NAI请求失败' };
}
