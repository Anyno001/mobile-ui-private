import { resolveThemeAuxiliary, THEME_PRESETS, THEME_UI_TOKENS } from './config.js';
import { contrastText } from './ui.js';

export function createPhoneThemeController(state) {
    function applyTheme() {
        const theme = window.__pmTheme || {};
        const preset = THEME_PRESETS[theme.preset] || THEME_PRESETS.default;
        const interfaceMode = theme.darkMode || 'light';
        const customAccent = theme.preset === 'custom' ? String(theme.customAccent || '').trim() : '';
        const auxiliary = resolveThemeAuxiliary(preset, customAccent);
        const defaultRight = theme.preset === 'custom' && customAccent ? customAccent : interfaceMode === 'dark' ? preset.rightDark || preset.right : preset.right;
        const defaultLeft = interfaceMode === 'dark' ? preset.leftDark || preset.left : preset.left;
        const rightBackground = theme.customRight || defaultRight;
        const leftBackground = theme.customLeft || defaultLeft;
        const rightText = theme.customRight || (theme.preset === 'custom' && customAccent) ? contrastText(rightBackground) : preset.rightText;
        const leftText = theme.customLeft ? contrastText(theme.customLeft) : interfaceMode === 'dark' ? preset.leftTextDark || preset.leftText : preset.leftText;
        const uiTokens = interfaceMode === 'dark' ? preset.uiDark || {} : preset.ui || {};
        const applyProperties = element => {
            if (!element) return;
            element.style.setProperty('--pm-r-bg', rightBackground); element.style.setProperty('--pm-l-bg', leftBackground);
            element.style.setProperty('--pm-r-txt', rightText); element.style.setProperty('--pm-l-txt', leftText);
            element.style.setProperty('--pm-border', theme.borderColor || '#1a1a1a');
            element.style.setProperty('--pm-frost', preset.frost ? '1' : '0');
            element.style.setProperty('--pm-color-accent', customAccent || preset.accent || preset.right);
            for (const token of THEME_UI_TOKENS) element.style.removeProperty(token);
            for (const [token, value] of Object.entries(uiTokens)) element.style.setProperty(token, value);
            element.style.setProperty('--pm-color-auxiliary', auxiliary);
            element.setAttribute('data-theme', interfaceMode);
            element.removeAttribute('data-skin');
        };
        applyProperties(document.getElementById('pm-overlay'));
        applyProperties(document.getElementById('pm-overlay-sub'));
        applyProperties(document.getElementById('pm-model-dropdown'));
        applyProperties(state.phoneWindow);
        const title = state.phoneWindow?.querySelector('.pm-desktop-toolbar span');
        if (title) title.textContent = String(theme.customTitle || '').trim() || '天音小笺';
    }
    return { applyTheme };
}
