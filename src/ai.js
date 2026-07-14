import { normalizeApiUrls } from './config.js';

export function createAiClient({
    getConfig,
    getContext,
    getDefaultMaxTokens,
    fetchImpl,
}) {
    const request = fetchImpl || ((...args) => globalThis.fetch(...args));
    return async function callAI(systemPrompt, userPrompt, options = {}) {
        const cfg = getConfig() || {};
        const useIndependent = cfg.useIndependent && cfg.apiUrl && cfg.apiKey;
        const maxTokens = options.maxTokens || getDefaultMaxTokens();

        if (useIndependent) {
            const { chatUrl } = normalizeApiUrls(cfg.apiUrl);
            const messages = [];
            if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
            messages.push({ role: 'user', content: userPrompt });
            const response = await request(chatUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${cfg.apiKey}`,
                },
                body: JSON.stringify({
                    model: cfg.model || 'gpt-4o-mini',
                    messages,
                    max_tokens: maxTokens,
                    temperature: 1.2,
                    top_p: 0.95,
                    frequency_penalty: 0.3,
                    presence_penalty: 0.3,
                }),
            });
            if (!response.ok) {
                const errorText = await response.text().catch(() => '');
                throw new Error(`HTTP ${response.status}: ${errorText.slice(0, 120)}`);
            }
            const json = await response.json();
            return json.choices?.[0]?.message?.content ?? '';
        }

        const context = getContext();
        if (!context) throw new Error('无上下文');
        const fullPrompt = systemPrompt ? `${systemPrompt}\n\n${userPrompt}` : userPrompt;
        return await context.generateQuietPrompt(fullPrompt, false, false);
    };
}
