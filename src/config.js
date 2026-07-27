// Presets define the UI skin and its default bubble palette. Custom bubble colors
// deliberately override only message bubbles; UI controls use the skin accent.
export const THEME_PRESETS = {
    default: { right: '#007aff', left: '#e9e9eb', rightText: '#fff', leftText: '#000', label: '日间', accent: '#007aff' },
    dark: { right: '#5856d6', left: '#2c2c2e', rightText: '#fff', leftText: '#e0e0e0', label: '夜间', accent: '#5856d6' },
    apple: {
        right: '#893619', left: '#F8F5EE', rightText: '#F8F5EE', leftText: '#0E2110', label: '苹果', accent: '#893619',
        ui: {
            '--pm-color-surface-page': '#F8F5EE', '--pm-color-surface-card': '#EEE9DE', '--pm-color-surface-input': '#F8F5EE', '--pm-color-surface-elevated': '#EEE9DE',
            '--pm-color-text-primary': '#0E2110', '--pm-color-text-secondary': '#4A503A', '--pm-color-text-tertiary': '#6C705A',
            '--pm-color-border-default': '#B26B5F', '--pm-color-border-subtle': '#DED5C3', '--pm-color-focus-ring': '#7A9C45',
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
