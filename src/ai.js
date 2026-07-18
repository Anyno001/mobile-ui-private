import { normalizeApiUrls } from './config.js';

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
    if (Array.isArray(geminiParts)) candidates.push(geminiParts.map(part => part?.text).filter(text => typeof text === 'string').join(''));
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
