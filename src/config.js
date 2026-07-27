// Presets define color palettes and their default bubble colors. Custom bubble
// colors deliberately override only message bubbles; UI controls use the palette accent.
export const THEME_PRESETS = {
    default: { right: '#1677d2', left: '#e9e9eb', rightText: '#fff', leftText: '#000', label: '默认蓝', accent: '#1677d2' },
    dark: { right: '#5856d6', left: '#E6EDF3', leftDark: '#2c2c2e', rightText: '#fff', leftText: '#33404C', leftTextDark: '#e0e0e0', label: '暗夜紫', accent: '#5856d6' },
    pink: {
        right: '#E7A9B9', rightDark: '#FFC4D4', left: '#E8EEF3', leftDark: '#343B43', rightText: '#2B2B2B', leftText: '#4E3840', leftTextDark: '#E6EDF3', label: '柔粉', accent: '#FFC4D4',
        uiDark: {
            '--pm-color-surface-page': '#2B2B2B', '--pm-color-surface-card': '#1F1F1F', '--pm-color-surface-elevated': '#242424', '--pm-color-surface-input': '#1F1F1F', '--pm-color-surface-inverse': '#1F1F1F',
            '--pm-color-text-primary': '#FFFFFF', '--pm-color-text-secondary': 'rgba(255, 255, 255, 0.70)', '--pm-color-text-tertiary': 'rgba(255, 255, 255, 0.50)', '--pm-color-text-placeholder': 'rgba(255, 255, 255, 0.50)',
            '--pm-color-border-subtle': 'transparent', '--pm-color-border-default': 'transparent', '--pm-color-border-strong': 'transparent', '--pm-color-control-off': '#3A3A3A', '--pm-color-focus-ring': '#FFD9E4', '--pm-color-success': '#E5A0B5', '--pm-color-warning': '#FFB38B', '--pm-color-danger': '#D96C6C', '--pm-color-on-success': '#2B2B2B', '--pm-color-on-warning': '#2B2B2B', '--pm-color-on-danger': '#FFFFFF',
        },
    },
    mint: { right: '#9FBE8C', rightDark: '#B6D39D', left: '#F3EBDD', leftDark: '#3B443B', rightText: '#243522', leftText: '#4D4034', leftTextDark: '#E8EEE5', label: '薄荷', accent: '#9FBE8C' },
    frost: { right: 'rgba(111, 172, 218, 0.62)', left: 'rgba(255,255,255,0.48)', leftDark: 'rgba(54, 68, 82, 0.72)', rightText: '#fff', leftText: '#22303A', leftTextDark: '#E7EFF7', label: '磨砂', accent: '#6FAEDA', frost: true },
    apple: {
        right: '#893619', left: '#EEE9DE', rightText: '#F8F5EE', leftText: '#0E2110', label: '苹果', accent: '#893619',
        ui: {
            '--pm-color-surface-page': '#F8F5EE', '--pm-color-surface-card': '#EEE9DE', '--pm-color-surface-input': '#EEE9DE', '--pm-color-surface-elevated': '#F4F0E6', '--pm-color-surface-inverse': '#0E2110',
            '--pm-color-text-primary': '#0E2110', '--pm-color-text-secondary': 'rgba(14, 33, 16, 0.70)', '--pm-color-text-tertiary': 'rgba(14, 33, 16, 0.52)', '--pm-color-text-placeholder': 'rgba(14, 33, 16, 0.42)',
            '--pm-color-border-default': 'rgba(137, 54, 25, 0.20)', '--pm-color-border-subtle': 'rgba(137, 54, 25, 0.15)', '--pm-color-border-strong': 'rgba(137, 54, 25, 0.34)', '--pm-color-control-off': '#D9D4C8', '--pm-color-focus-ring': '#7A9C45', '--pm-color-success': '#7A9C45', '--pm-color-warning': '#B26B5F', '--pm-color-danger': '#B64B45', '--pm-color-on-success': '#0E2110', '--pm-color-on-warning': '#0E2110', '--pm-color-on-danger': '#FFFFFF',
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
