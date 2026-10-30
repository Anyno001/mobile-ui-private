// 由主题强调色派生同色相的三档色调：浅色块、块上文字、实心小控件。
// 只保留强调色的色相与彩度，亮度按用途固定，浅色或深色强调色都能保证对比度。
const HEX_PATTERN = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

const TONE_RULES = Object.freeze({
    light: Object.freeze({ soft: [0.94, 0.04], onSoft: [0.36, 0.09], strong: [0.56, 0.16] }),
    dark: Object.freeze({ soft: [0.34, 0.06], onSoft: [0.94, 0.03], strong: [0.62, 0.14] }),
});

const toLinear = value => (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
const toGamma = value => (value <= 0.0031308 ? value * 12.92 : 1.055 * value ** (1 / 2.4) - 0.055);

function hexToOklch(hex) {
    const raw = hex.length === 4 ? hex.slice(1).split('').map(char => char + char).join('') : hex.slice(1);
    const value = parseInt(raw, 16);
    const [r, g, b] = [(value >> 16) & 255, (value >> 8) & 255, value & 255].map(channel => toLinear(channel / 255));
    const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
    const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
    const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
    const lightness = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
    const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
    const bAxis = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
    return { lightness, chroma: Math.hypot(a, bAxis), hue: Math.atan2(bAxis, a) };
}

function oklchToHex(lightness, chroma, hue) {
    const a = chroma * Math.cos(hue);
    const bAxis = chroma * Math.sin(hue);
    const l = (lightness + 0.3963377774 * a + 0.2158037573 * bAxis) ** 3;
    const m = (lightness - 0.1055613458 * a - 0.0638541728 * bAxis) ** 3;
    const s = (lightness - 0.0894841775 * a - 1.291485548 * bAxis) ** 3;
    const linear = [
        4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
        -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
        -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
    ];
    return `#${linear.map(channel => Math.round(Math.min(1, Math.max(0, toGamma(Math.min(1, Math.max(0, channel))))) * 255).toString(16).padStart(2, '0')).join('')}`;
}

// 返回 CSS 变量到色值的映射；无法解析的强调色返回空对象，由样式表中的默认值兜底。
export function accentToneTokens(accent, interfaceMode = 'light') {
    const source = String(accent || '').trim();
    if (!HEX_PATTERN.test(source)) return {};
    const { chroma, hue } = hexToOklch(source);
    const rules = TONE_RULES[interfaceMode === 'dark' ? 'dark' : 'light'];
    // 近灰的强调色不强加彩度，避免凭空染出色相。
    const tone = ([lightness, maxChroma]) => oklchToHex(lightness, Math.min(chroma, maxChroma), hue);
    return {
        '--pm-color-accent-soft': tone(rules.soft),
        '--pm-color-on-accent-soft': tone(rules.onSoft),
        '--pm-color-accent-strong': tone(rules.strong),
    };
}

export const ACCENT_TONE_TOKENS = Object.freeze(['--pm-color-accent-soft', '--pm-color-on-accent-soft', '--pm-color-accent-strong']);
