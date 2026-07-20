export const THEME_PRESETS = {
    default: { right: '#007aff', left: '#e9e9eb', rightText: '#fff', leftText: '#000', label: '默认蓝' },
    pink: { right: '#ff6b8a', left: '#fce4ec', rightText: '#fff', leftText: '#4a2030', label: '樱花粉' },
    dark: { right: '#5856d6', left: '#2c2c2e', rightText: '#fff', leftText: '#e0e0e0', label: '暗夜紫' },
    frost: { right: 'rgba(0,122,255,0.55)', left: 'rgba(255,255,255,0.35)', rightText: '#fff', leftText: '#222', label: '磨砂玻璃', frost: true },
    mint: { right: '#34c759', left: '#e8f5e9', rightText: '#fff', leftText: '#1b4332', label: '薄荷绿' },
};

export function normalizeApiUrls(input) {
    const url = (input || '').trim().replace(/\/+$/, '');
    if (!url) return { chatUrl: '', modelsUrl: '', baseUrl: '' };
    if (/\/chat\/completions$/i.test(url)) {
        const baseUrl = url.replace(/\/chat\/completions$/i, '');
        return { chatUrl: url, modelsUrl: baseUrl + '/models', baseUrl };
    }
    if (/\/models$/i.test(url)) {
        const baseUrl = url.replace(/\/models$/i, '');
        return { chatUrl: baseUrl + '/chat/completions', modelsUrl: url, baseUrl };
    }
    // Already a versioned or provider-specific base (…/v1, /v1beta, /openai) — append endpoints directly.
    if (/\/(?:v\d+\w*|openai)$/i.test(url)) return { chatUrl: url + '/chat/completions', modelsUrl: url + '/models', baseUrl: url };
    const baseUrl = url + '/v1';
    return { chatUrl: baseUrl + '/chat/completions', modelsUrl: baseUrl + '/models', baseUrl };
}

// Normalize a /models response across providers into a list of model id strings.
// Handles OpenAI/Anthropic ({data:[{id}]}), Gemini ({models:[{name}]}) and bare arrays.
export function parseModelList(data) {
    const rows = Array.isArray(data) ? data
        : Array.isArray(data?.data) ? data.data
        : Array.isArray(data?.models) ? data.models
        : [];
    const ids = rows.map(row => {
        if (typeof row === 'string') return row;
        const id = row?.id ?? row?.name ?? row?.model;
        if (typeof id !== 'string') return '';
        // Gemini prefixes ids with "models/"; strip it for display/selection.
        return id.replace(/^models\//, '');
    }).filter(Boolean);
    return [...new Set(ids)];
}
