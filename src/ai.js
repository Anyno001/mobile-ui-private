import { normalizeApiUrls } from './config.js';

function jsonObjectEnd(source, start) {
    let depth = 0;
    let quoted = false;
    let escaped = false;
    for (let index = start; index < source.length; index += 1) {
        const char = source[index];
        if (quoted) {
            if (escaped) escaped = false;
            else if (char === '\\') escaped = true;
            else if (char === '"') quoted = false;
            continue;
        }
        if (char === '"') {
            quoted = true;
            continue;
        }
        if (char === '{') depth += 1;
        else if (char === '}') {
            depth -= 1;
            if (depth === 0) return index + 1;
        }
    }
    return -1;
}

function cleanStructuredResponse(raw) {
    const source = String(raw ?? '');
    let cleaned = '';
    let depth = 0;
    let quoted = false;
    let escaped = false;
    for (let index = 0; index < source.length; index += 1) {
        const char = source[index];
        if (depth > 0 && quoted) {
            cleaned += char;
            if (escaped) escaped = false;
            else if (char === '\\') escaped = true;
            else if (char === '"') quoted = false;
            continue;
        }
        if (depth > 0 && char === '"') {
            quoted = true;
            cleaned += char;
            continue;
        }
        if (depth === 0 && char === '<') {
            const rest = source.slice(index);
            const opening = rest.match(/^(?:<\s*(think|thinking)\b[^>]*>|<!--\s*(think|thinking)\s*-->)/i);
            if (opening) {
                const tag = opening[1] || opening[2];
                const closing = new RegExp(`(?:<\\s*\\/\\s*${tag}\\s*>|<!--\\s*\\/\\s*${tag}\\s*-->)`, 'i')
                    .exec(rest.slice(opening[0].length));
                if (closing) {
                    index += opening[0].length + closing.index + closing[0].length - 1;
                    continue;
                }
            }
        }
        if (char === '{') depth += 1;
        else if (char === '}' && depth > 0) depth -= 1;
        cleaned += char;
    }
    return cleaned.replace(/^\s*```(?:json)?\s*|\s*```\s*$/gi, '').trim();
}

export function parseFirstJsonObject(raw, errorMessage = 'AI 未返回可解析的 JSON', accepts = null) {
    const source = cleanStructuredResponse(raw);
    let firstParsed;
    for (let start = source.indexOf('{'); start >= 0; start = source.indexOf('{', start + 1)) {
        const end = jsonObjectEnd(source, start);
        if (end < 0) continue;
        try {
            const parsed = JSON.parse(source.slice(start, end));
            if (firstParsed === undefined) firstParsed = parsed;
            if (!accepts || accepts(parsed)) return parsed;
        }
        catch (error) {}
    }
    if (firstParsed !== undefined) return firstParsed;
    throw new Error(errorMessage);
}

export function generationErrorMessage(error) {
    const message = String(error?.message || error || '未知错误');
    const identity = `${error?.name || ''} ${error?.code || ''}`;
    const errorText = `${identity} ${message}`;
    const externalGithubFailure = /github.{0,80}\b(?:api|webhook)\b|\b(?:api|webhook)\b.{0,80}github/i.test(message);
    const networkFailure = !externalGithubFailure && (
        /\b(etimedout|enotfound|econnreset|econnrefused|networkerror)\b/i.test(errorText)
        || /^(?:typeerror:\s*)?(?:failed to fetch|fetch failed|networkerror\b)/i.test(message)
        || /\b(?:request|connection|network)\b.{0,40}\btimed?\s*out\b/i.test(message));
    const extensionGitFailure = /getting extension version failed/i.test(message)
        || /username for ['"]https:\/\/github\.com/i.test(message)
        || /fatal:\s+couldn't find remote ref refs\/heads\//i.test(message)
        || (/\bgiterror\b/i.test(identity) && /github/i.test(message) && networkFailure);
    if (extensionGitFailure) {
        return 'SillyTavern 扩展版本检查或 AI 网络连接失败，请检查扩展仓库配置、GitHub 认证与网络后重试。';
    }
    if (networkFailure) {
        return 'AI 服务网络连接失败，请检查接口与网络后重试。';
    }
    return message;
}

export function extractAiResponseContent(json) {
    const candidates = [
        json?.choices?.[0]?.message?.content,
        json?.choices?.[0]?.text,
        json?.output_text,
        json?.content,
    ];
    const responseOutput = json?.output;
    if (Array.isArray(responseOutput)) candidates.push(responseOutput
        .flatMap(item => Array.isArray(item?.content) ? item.content : [])
        .map(part => part?.text)
        .filter(text => typeof text === 'string').join(''));
    const geminiParts = json?.candidates?.[0]?.content?.parts;
    if (Array.isArray(geminiParts)) candidates.push(geminiParts
        .filter(part => part?.thought !== true)
        .map(part => part?.text)
        .filter(text => typeof text === 'string').join(''));
    const content = candidates.find(value => typeof value === 'string' && value.trim());
    return content?.trim() || '';
}

export function createAiClient({
    getConfig,
    getContext,
    getDefaultMaxTokens,
    fetchImpl,
}) {
    const request = fetchImpl || ((...args) => globalThis.fetch(...args));

    async function readApiError(response, signal) {
        throwIfAborted(signal);
        let raw;
        try {
            raw = await response.text();
        } catch (error) {
            if (signal?.aborted || error?.name === 'AbortError') throw abortError();
            raw = '';
        }
        throwIfAborted(signal);
        if (!raw) return `HTTP ${response.status}`;
        try {
            const data = JSON.parse(raw);
            const message = data?.error?.message || data?.message || data?.error;
            if (typeof message === 'string' && message.trim()) return `HTTP ${response.status}: ${message.trim().slice(0, 240)}`;
        } catch (error) {}
        return `HTTP ${response.status}: ${raw.trim().slice(0, 240)}`;
    }

    function abortError() {
        const error = new Error('请求已取消');
        error.name = 'AbortError';
        return error;
    }

    const throwIfAborted = signal => { if (signal?.aborted) throw abortError(); };

    return async function callAI(systemPrompt, userPrompt, options = {}) {
        const cfg = getConfig() || {};
        const useIndependent = cfg.useIndependent === true;
        const maxTokens = options.maxTokens || getDefaultMaxTokens();
        const signal = options.signal;
        throwIfAborted(signal);

        if (useIndependent) {
            if (!String(cfg.apiUrl || '').trim()) throw new Error('独立 API 未填写地址');
            if (!String(cfg.apiKey || '').trim()) throw new Error('独立 API 未填写密钥');
            if (!String(cfg.model || '').trim()) throw new Error('独立 API 未选择模型');
            const { chatUrl } = normalizeApiUrls(cfg.apiUrl);
            const messages = [];
            if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
            messages.push({ role: 'user', content: userPrompt });
            let response;
            try {
                response = await request(chatUrl, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${cfg.apiKey}`,
                    },
                    body: JSON.stringify({
                        model: cfg.model,
                        messages,
                        max_tokens: maxTokens,
                        temperature: 1.2,
                        top_p: 0.95,
                        frequency_penalty: 0.3,
                        presence_penalty: 0.3,
                    }),
                    signal,
                });
            } catch (error) {
                if (signal?.aborted || error?.name === 'AbortError') throw abortError();
                throw new Error(`独立 API 请求失败：${error?.message || '网络错误'}`);
            }
            throwIfAborted(signal);
            if (!response.ok) {
                throw new Error(await readApiError(response, signal));
            }
            let json, raw = '';
            if (typeof response.text === 'function') {
                try {
                    raw = await response.text();
                    throwIfAborted(signal);
                    json = JSON.parse(raw);
                } catch (error) {
                    if (signal?.aborted || error?.name === 'AbortError') throw abortError();
                    const preview = raw.trim().replace(/\s+/g, ' ').slice(0, 120);
                    throw new Error(`独立 API 返回了无法解析的 JSON${preview ? `：${preview}` : ''}`);
                }
            } else {
                try { json = await response.json(); }
                catch (error) {
                    if (signal?.aborted || error?.name === 'AbortError') throw abortError();
                    throw new Error('独立 API 返回了无法解析的 JSON');
                }
            }
            const geminiFinishReason = String(json?.candidates?.[0]?.finishReason || '').toUpperCase();
            const openAiFinishReason = String(json?.choices?.[0]?.finish_reason || '').toLowerCase();
            if (geminiFinishReason === 'MAX_TOKENS' || openAiFinishReason === 'length') {
                throw new Error('AI 输出达到 token 上限并被截断（MAX_TOKENS），未使用不完整结果。请重试或检查服务商的最大输出限制。');
            }
            const content = extractAiResponseContent(json);
            if (!content) throw new Error('独立 API 响应缺少可用文本内容');
            throwIfAborted(signal);
            return content;
        }

        const context = getContext();
        if (!context) throw new Error('无上下文');
        if (options.isolated) {
            if (typeof context.generateRaw !== 'function') throw new Error('当前 SillyTavern 版本不支持隔离生成，请升级后重试');
            throwIfAborted(signal);
            const result = await context.generateRaw({
                prompt: userPrompt,
                systemPrompt,
                responseLength: maxTokens,
                trimNames: false,
            });
            throwIfAborted(signal);
            return result;
        }
        if (typeof context.generateQuietPrompt !== 'function') throw new Error('当前 SillyTavern 上下文缺少 generateQuietPrompt');
        const fullPrompt = systemPrompt ? `${systemPrompt}\n\n${userPrompt}` : userPrompt;
        throwIfAborted(signal);
        const result = await context.generateQuietPrompt({ quietPrompt: fullPrompt, responseLength: maxTokens });
        throwIfAborted(signal);
        return result;
    };
}
