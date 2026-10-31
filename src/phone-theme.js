import { FONT_CHOICES, normalizeFontChoice, normalizeWallpaper, resolveThemeAuxiliary, THEME_PRESETS, THEME_UI_TOKENS } from './config.js';
import { ACCENT_TONE_TOKENS, accentToneTokens } from './theme-tones.js';
import { contrastText } from './ui.js';
import { applyImageGenVisibility } from './phone-image-settings.js';

export function createPhoneThemeController(state) {
    // 主题变量是继承属性：同值重写也会让整部手机重算样式。每个元素记住上次写入的签名，没变就不碰。
    const appliedSignatures = new WeakMap();
    const setAttributeIfChanged = (element, name, value) => { if (element && element.getAttribute?.(name) !== value) element.setAttribute(name, value); };
    function applyTheme() {
        const theme = window.__pmTheme || {};
        const preset = THEME_PRESETS[theme.preset] || THEME_PRESETS.default;
        const interfaceMode = theme.darkMode || 'light';
        const customAccent = theme.preset === 'custom' ? String(theme.customAccent || '').trim() : '';
        const auxiliary = resolveThemeAuxiliary(preset, customAccent);
        const defaultRight = theme.preset === 'custom' && customAccent ? customAccent : interfaceMode === 'dark' ? preset.rightDark || preset.right : preset.right;
        const defaultLeft = interfaceMode === 'dark' ? preset.leftDark || preset.left : preset.left;
        const rightBackground = theme.customRight || defaultRight;
        const plainWallpaper = theme.wallpaper === 'plain';
        const leftBackground = theme.customLeft || (plainWallpaper ? 'var(--pm-color-fill)' : defaultLeft);
        const rightText = theme.customRight || (theme.preset === 'custom' && customAccent) ? contrastText(rightBackground) : interfaceMode === 'dark' ? preset.rightTextDark || preset.rightText : preset.rightText;
        const leftText = theme.customLeft ? contrastText(theme.customLeft) : interfaceMode === 'dark' ? preset.leftTextDark || preset.leftText : preset.leftText;
        const uiTokens = interfaceMode === 'dark' ? preset.uiDark || {} : preset.ui || {};
        const accent = customAccent || preset.accent || preset.right;
        const accentTones = accentToneTokens(accent, interfaceMode);
        const fontStack = FONT_CHOICES[normalizeFontChoice(theme.fontFamily)].stack;
        const signature = JSON.stringify([rightBackground, leftBackground, rightText, leftText, theme.borderColor || '', preset.frost ? 1 : 0,
            accent, accentTones, uiTokens, plainWallpaper, auxiliary, fontStack || '', interfaceMode]);
        const applyProperties = element => {
            if (!element) return;
            if (appliedSignatures.get(element) === signature && element.getAttribute?.('data-theme') === interfaceMode) return;
            appliedSignatures.set(element, signature);
            element.style.setProperty('--pm-r-bg', rightBackground); element.style.setProperty('--pm-l-bg', leftBackground);
            element.style.setProperty('--pm-r-txt', rightText); element.style.setProperty('--pm-l-txt', leftText);
            element.style.setProperty('--pm-border', theme.borderColor || '#1a1a1a');
            element.style.setProperty('--pm-frost', preset.frost ? '1' : '0');
            element.style.setProperty('--pm-color-accent', accent);
            for (const token of ACCENT_TONE_TOKENS) element.style.removeProperty(token);
            for (const [token, value] of Object.entries(accentTones)) element.style.setProperty(token, value);
            for (const token of THEME_UI_TOKENS) element.style.removeProperty(token);
            for (const [token, value] of Object.entries(uiTokens)) element.style.setProperty(token, value);
            if (plainWallpaper) { element.style.setProperty('--pm-color-wash', 'transparent'); element.style.setProperty('--pm-color-wash-alt', 'transparent'); }
            element.style.setProperty('--pm-color-auxiliary', auxiliary);
            if (fontStack) element.style.setProperty('--pm-font-family-system', fontStack);
            else element.style.removeProperty('--pm-font-family-system');
            element.setAttribute('data-theme', interfaceMode);
            element.removeAttribute('data-skin');
        };
        applyProperties(document.getElementById('pm-overlay'));
        applyProperties(document.getElementById('pm-overlay-sub'));
        applyProperties(document.getElementById('pm-model-dropdown'));
        applyProperties(state.phoneWindow);
        setAttributeIfChanged(state.phoneWindow, 'data-icon-style', theme.iconStyle === 'cream' ? 'cream' : 'glass');
        setAttributeIfChanged(state.phoneWindow, 'data-wallpaper', normalizeWallpaper(theme.wallpaper));
        applyImageGenVisibility();
        const title = state.phoneWindow?.querySelector('.pm-desktop-toolbar span');
        const titleText = String(theme.customTitle || '').trim() || '天音小笺';
        if (title && title.textContent !== titleText) title.textContent = titleText;
    }
    return { applyTheme };
}
