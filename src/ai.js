import { normalizeApiUrls } from './config.js';

export function createAiClient({
    getConfig,
    getContext,
    getDefaultMaxTokens,
    fetchImpl,
}) {
    const request = fetchImpl || ((...args) => globalThis.fetch(...args));

    async function readApiError(response) {
        const raw = await response.text().catch(() => '');
        if (!raw) return `HTTP ${response.status}`;
        try {
            const data = JSON.parse(raw);
            const message = data?.error?.message || data?.message || data?.error;
            if (typeof message === 'string' && message.trim()) return `HTTP ${response.status}: ${message.trim().slice(0, 240)}`;
        } catch (error) {}
        return `HTTP ${response.status}: ${raw.trim().slice(0, 240)}`;
    }

    return async function callAI(systemPrompt, userPrompt, options = {}) {
        const cfg = getConfig() || {};
        const useIndependent = cfg.useIndependent === true;
        const maxTokens = options.maxTokens || getDefaultMaxTokens();

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
                });
            } catch (error) {
                throw new Error(`独立 API 请求失败：${error?.message || '网络错误'}`);
            }
            if (!response.ok) {
                throw new Error(await readApiError(response));
            }
            let json;
            try {
                json = await response.json();
            } catch (error) {
                throw new Error('独立 API 返回了无法解析的 JSON');
            }
            const content = json?.choices?.[0]?.message?.content;
            if (typeof content !== 'string' || !content.trim()) throw new Error('独立 API 响应缺少 choices[0].message.content');
            return content;
        }

        const context = getContext();
        if (!context) throw new Error('无上下文');
        if (options.isolated) {
            if (typeof context.generateRaw !== 'function') throw new Error('当前 SillyTavern 版本不支持隔离生成，请升级后重试');
            return await context.generateRaw({
                prompt: userPrompt,
                systemPrompt,
                responseLength: maxTokens,
                trimNames: false,
            });
        }
        if (typeof context.generateQuietPrompt !== 'function') throw new Error('当前 SillyTavern 上下文缺少 generateQuietPrompt');
        const fullPrompt = systemPrompt ? `${systemPrompt}\n\n${userPrompt}` : userPrompt;
        return await context.generateQuietPrompt({ quietPrompt: fullPrompt, responseLength: maxTokens });
    };
}
