// Presets define color palettes and their default bubble colors. Custom bubble
// colors deliberately override only message bubbles; toggle controls use the preset auxiliary color.
export const THEME_PRESETS = {
    default: { right: '#dfe7f1', rightDark: '#34465c', left: '#ffffff', leftDark: '#262633', rightText: '#1e2a3a', rightTextDark: '#eef2f8', leftText: '#1e1e2e', leftTextDark: '#e6e6ee', label: '蓝灰', accent: '#4e6a8c', auxiliary: '#42607f', ui: { '--pm-color-wash': '#c9d6e566', '--pm-color-wash-alt': '#dcd8ea55' }, uiDark: { '--pm-color-wash': '#3a4a5e55', '--pm-color-wash-alt': '#3b3a5044' } },
    dark: { right: '#5856d6', left: '#E6EDF3', leftDark: '#2b2a3d', rightText: '#fff', leftText: '#33404C', leftTextDark: '#e0e0e0', label: '暗夜紫', accent: '#5856d6', auxiliary: '#64D2FF' },
    pink: {
        right: '#E7A9B9', rightDark: '#FFC4D4', left: '#E8EEF3', leftDark: '#343B43', rightText: '#fff', leftText: '#4E3840', leftTextDark: '#E6EDF3', label: '柔粉', accent: '#FFC4D4', auxiliary: '#E07A93',
        uiDark: {
            '--pm-color-surface-page': '#2B2B2B', '--pm-color-surface-card': '#1F1F1F', '--pm-color-surface-elevated': '#242424', '--pm-color-surface-input': '#1F1F1F', '--pm-color-surface-inverse': '#1F1F1F',
            '--pm-color-text-primary': '#FFFFFF', '--pm-color-text-secondary': 'rgba(255, 255, 255, 0.70)', '--pm-color-text-tertiary': 'rgba(255, 255, 255, 0.50)', '--pm-color-text-placeholder': 'rgba(255, 255, 255, 0.50)',
            '--pm-color-border-subtle': 'transparent', '--pm-color-border-default': 'transparent', '--pm-color-border-strong': 'transparent', '--pm-color-control-off': '#3A3A3A', '--pm-color-focus-ring': '#FFD9E4', '--pm-color-success': '#E5A0B5', '--pm-color-warning': '#FFB38B', '--pm-color-danger': '#D96C6C', '--pm-color-on-success': '#2B2B2B', '--pm-color-on-warning': '#2B2B2B', '--pm-color-on-danger': '#FFFFFF',
            '--pm-color-bg-grouped': '#1F1F1F', '--pm-color-bg-plain': '#2B2B2B', '--pm-color-surface': '#2B2B2B', '--pm-color-surface-raised': '#333333', '--pm-color-fill': '#3A3A3A', '--pm-color-fill-strong': '#474747', '--pm-color-label': '#FFFFFF', '--pm-color-label-2': 'rgba(255, 255, 255, 0.70)', '--pm-color-label-3': 'rgba(255, 255, 255, 0.55)', '--pm-color-label-4': 'rgba(255, 255, 255, 0.32)',

        },
    },
    mint: { right: '#9FBE8C', rightDark: '#B6D39D', left: '#F3EBDD', leftDark: '#3B443B', rightText: '#fff', leftText: '#4D4034', leftTextDark: '#E8EEE5', label: '薄荷', accent: '#9FBE8C', auxiliary: '#739E59' },
    frost: { right: 'rgba(111, 172, 218, 0.62)', left: 'rgba(255,255,255,0.48)', leftDark: 'rgba(54, 68, 82, 0.72)', rightText: '#fff', leftText: '#22303A', leftTextDark: '#E7EFF7', label: '磨砂', accent: '#6FAEDA', auxiliary: '#4B8EC4', frost: true },
    sakura: { right: '#fcd9e2', rightDark: '#5a2f3e', left: '#ffffff', leftDark: '#262633', rightText: '#4a1f2c', rightTextDark: '#fbe9ee', leftText: '#1e1e2e', leftTextDark: '#e6e6ee', label: '樱花粉调', accent: '#b8546f', auxiliary: '#a3486a', ui: { '--pm-color-wash': '#f7cfdb8c', '--pm-color-wash-alt': '#e8d8f27a' }, uiDark: { '--pm-color-wash': '#5a2c3d66', '--pm-color-wash-alt': '#3e2f5255' } },
    spring: { right: '#dcefcf', rightDark: '#2f4a26', left: '#ffffff', leftDark: '#262633', rightText: '#1f3a17', rightTextDark: '#eaf5e3', leftText: '#1e1e2e', leftTextDark: '#e6e6ee', label: '春日苹果', accent: '#4a8236', auxiliary: '#3f732d', ui: { '--pm-color-wash': '#d4ebbd99', '--pm-color-wash-alt': '#f9e9b080' }, uiDark: { '--pm-color-wash': '#2f4a2366', '--pm-color-wash-alt': '#4a3d1a44' } },
};

export const THEME_UI_TOKENS = [...new Set(Object.values(THEME_PRESETS).flatMap(preset => [
    ...Object.keys(preset.ui || {}),
    ...Object.keys(preset.uiDark || {}),
]))];

export function normalizeThemePreset(preset) {
    return preset === 'custom' || Object.hasOwn(THEME_PRESETS, preset) ? preset : 'default';
}

// 手机界面字体：rounded 为内置有爱圆体（core.css 默认值，不写变量）；其余走设备自带字体，缺字时逐级回落。
export const FONT_CHOICES = {
    rounded: { label: '圆体', stack: '' },
    system: { label: '系统默认', stack: "-apple-system,BlinkMacSystemFont,'PingFang SC','Microsoft YaHei',sans-serif" },
    song: { label: '宋体', stack: "'Songti SC','Noto Serif SC','Source Han Serif SC','SimSun',serif" },
    kai: { label: '楷体', stack: "'Kaiti SC','STKaiti','KaiTi','BiauKai',serif" },
};

// 背景：柔光（默认）、灿烂（底图光斑加浓，接近设计稿）、纯白。
export const WALLPAPER_CHOICES = Object.freeze(['soft', 'bright', 'plain']);
export const normalizeWallpaper = value => (WALLPAPER_CHOICES.includes(value) ? value : 'soft');

export function normalizeFontChoice(value) {
    return Object.hasOwn(FONT_CHOICES, value) ? value : 'rounded';
}

export function resolveThemeAuxiliary(preset, customAccent = '') {
    // 移除强行扭转为互补色的算法，回退到当前 Preset 原本定义的同色系辅助色
    // 或者未来可以在此处添加简单的亮度下降处理。
    return preset?.auxiliary || THEME_PRESETS.default.auxiliary;
}

export function normalizeApiUrls(input) {
    const url = (input || '').trim().replace(/\/+$/, '');
    if (!url) return { chatUrl: '', modelsUrl: '' };
    if (/\/chat\/completions$/i.test(url)) return { chatUrl: url, modelsUrl: url.replace(/\/chat\/completions$/i, '/models') };
    if (/\/models$/i.test(url)) return { chatUrl: url.replace(/\/models$/i, '/chat/completions'), modelsUrl: url };
    if (/\/v\d+$/i.test(url)) return { chatUrl: url + '/chat/completions', modelsUrl: url + '/models' };
    return { chatUrl: url + '/v1/chat/completions', modelsUrl: url + '/v1/models' };
}
