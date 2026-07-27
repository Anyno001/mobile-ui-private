// Presets define color palettes and their default bubble colors. Custom bubble
// colors deliberately override only message bubbles; UI controls use the palette accent.
export const THEME_PRESETS = {
    default: { right: '#007aff', left: '#e9e9eb', rightText: '#fff', leftText: '#000', label: '默认蓝', accent: '#007aff' },
    dark: { right: '#5856d6', left: '#2c2c2e', rightText: '#fff', leftText: '#e0e0e0', label: '暗夜紫', accent: '#5856d6' },
    pink: { right: '#FFC4D4', left: '#FFF0F5', rightText: '#2B2B2B', leftText: '#4E3840', label: '柔粉', accent: '#FFC4D4' },
    mint: { right: '#8FC9B3', left: '#EDF7F1', rightText: '#15372B', leftText: '#315A4A', label: '薄荷', accent: '#8FC9B3' },
    frost: { right: 'rgba(111, 172, 218, 0.62)', left: 'rgba(255,255,255,0.48)', rightText: '#fff', leftText: '#22303A', label: '磨砂', accent: '#6FAEDA', frost: true },
    apple: {
        right: '#D85B4F', left: '#E9DCC6', rightText: '#FFF9F1', leftText: '#3F3021', label: '苹果', accent: '#D85B4F',
        ui: {
            '--pm-color-surface-page': '#FFF7E8', '--pm-color-surface-card': '#FFF1D8', '--pm-color-surface-input': '#FFF9F0', '--pm-color-surface-elevated': '#F8EBCF',
            '--pm-color-text-primary': '#2D3A20', '--pm-color-text-secondary': '#5E6847', '--pm-color-text-tertiary': '#7C8464',
            '--pm-color-border-default': 'transparent', '--pm-color-border-subtle': 'rgba(111, 142, 70, 0.16)', '--pm-color-focus-ring': '#7AA34A', '--pm-color-success': '#7AA34A', '--pm-color-danger': '#D85B4F',
        },
    },
};

export function normalizeApiUrls(input) {
    const url = (input || '').trim().replace(/\/+$/, '');
    if (!url) return { chatUrl: '', modelsUrl: '' };
    if (/\/chat\/completions$/i.test(url)) return { chatUrl: url, modelsUrl: url.replace(/\/chat\/completions$/i, '/models') };
    if (/\/models$/i.test(url)) return { chatUrl: url.replace(/\/models$/i, '/chat/completions'), modelsUrl: url };
    if (/\/v\d+$/i.test(url)) return { chatUrl: url + '/chat/completions', modelsUrl: url + '/models' };
    return { chatUrl: url + '/v1/chat/completions', modelsUrl: url + '/v1/models' };
}
