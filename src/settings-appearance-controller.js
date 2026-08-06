export function createAppearanceController({ THEME_PRESETS, applyTheme, clone, saveTheme, renderLookSettings, renderSettingsModal, makeOverlay, escapeAttr, safeJS, getCurrentPersona, getStorageId, backgroundSettings }) {
    const syncControls = () => {
        const theme = window.__pmTheme;
        document.querySelectorAll('.pm-theme-chip').forEach(element => {
            const active = element.dataset.preset === theme.preset;
            element.classList.toggle('pm-theme-active', active);
            element.setAttribute('aria-pressed', String(active));
        });
        document.querySelectorAll('.pm-layout-chip').forEach(element => {
            const value = element.dataset.themeMode;
            if (!value) return;
            const active = theme.preset === 'apple' ? value === 'light' : value === theme.darkMode;
            element.classList.toggle('pm-layout-active', active);
            element.setAttribute('aria-pressed', String(active));
            element.disabled = theme.preset === 'apple';
        });
        const preset = THEME_PRESETS[theme.preset] || THEME_PRESETS.default;
        const accent = theme.preset === 'custom' && theme.customAccent ? theme.customAccent : preset.accent || preset.right;
        const interfaceMode = theme.preset === 'apple' ? 'light' : theme.darkMode || 'light';
        const title = document.getElementById('pm-custom-title'), right = document.getElementById('pm-custom-right'), left = document.getElementById('pm-custom-left'), border = document.getElementById('pm-border-color'), customAccent = document.getElementById('pm-custom-accent');
        if (title) title.value = theme.customTitle || '';
        if (right) right.value = theme.customRight || (theme.preset === 'custom' && theme.customAccent ? accent : interfaceMode === 'dark' ? preset.rightDark || preset.right : preset.right);
        if (left) left.value = theme.customLeft || (interfaceMode === 'dark' ? preset.leftDark || preset.left : preset.left);
        if (border) border.value = theme.borderColor || '#1a1a1a';
        if (customAccent) customAccent.value = accent;
    };
    const mutateTheme = mutate => {
        const previous = clone(window.__pmTheme); mutate();
        if (saveTheme()) { applyTheme(); syncControls(); return true; }
        window.__pmTheme = previous; applyTheme(); syncControls(); alert('主题保存失败：浏览器存储不可用。'); return false;
    };
    const showPage = async () => {
        await backgroundSettings.load();
        const theme = window.__pmTheme, localKey = `${getStorageId()}_${getCurrentPersona()}`;
        const presetButtons = Object.entries(THEME_PRESETS).map(([name, preset]) =>
            `<button type="button" class="pm-theme-chip ${theme.preset === name ? 'pm-theme-active' : ''}" data-preset="${name}" aria-label="使用${escapeAttr(preset.label)}界面主题" aria-pressed="${theme.preset === name}" onclick="window.__pmSetPreset('${safeJS(name)}')"><span class="pm-theme-dot" style="background:${preset.accent || preset.right}" aria-hidden="true"></span></button>`
        ).join('');
        const buttons = scope => {
            const value = scope === 'desktop' ? window.__pmDesktopBg : scope === 'global' ? window.__pmBgGlobal : window.__pmBgLocal[localKey];
            return value
                ? `<button class="pm-bg-btn pm-bg-del" onclick="window.__pmClearBg('${scope}')">清除</button>`
                : `<label class="pm-bg-btn">选择图片<input type="file" accept="image/*" onchange="window.__pmUploadBg(this,'${scope}')" hidden></label>\n               <button class="pm-bg-btn" onclick="window.__pmBgUrl('${scope}')">URL</button>`;
        };
        makeOverlay(renderSettingsModal({ title: '主题颜色', content: renderLookSettings({
            theme, presetButtons, desktopBackgroundButtons: buttons('desktop'), globalBackgroundButtons: buttons('global'), localBackgroundButtons: buttons('local'),
        }) }));
    };
    const setDarkMode = mode => {
        if (window.__pmTheme.preset === 'apple') return false;
        return mutateTheme(() => { window.__pmTheme.darkMode = mode; });
    };
    const setPreset = preset => mutateTheme(() => {
        if (!Object.hasOwn(THEME_PRESETS, preset)) return;
        window.__pmTheme.preset = preset;
        window.__pmTheme.customAccent = '';
        window.__pmTheme.customRight = '';
        window.__pmTheme.customLeft = '';
    });
    const setCustomAccent = () => mutateTheme(() => {
        const accent = document.getElementById('pm-custom-accent')?.value || '';
        if (!accent) return;
        window.__pmTheme.preset = 'custom';
        window.__pmTheme.customAccent = accent;
        window.__pmTheme.customRight = '';
        window.__pmTheme.customLeft = '';
    });
    const setCustomColor = () => mutateTheme(() => {
        window.__pmTheme.customRight = document.getElementById('pm-custom-right')?.value || '';
        window.__pmTheme.customLeft = document.getElementById('pm-custom-left')?.value || '';
    });
    const clearCustomColor = () => mutateTheme(() => { window.__pmTheme.customRight = ''; window.__pmTheme.customLeft = ''; });
    const setBorderColor = () => mutateTheme(() => { window.__pmTheme.borderColor = document.getElementById('pm-border-color')?.value || '#1a1a1a'; });
    const setCustomTitle = () => mutateTheme(() => { window.__pmTheme.customTitle = (document.getElementById('pm-custom-title')?.value || '').trim().slice(0, 20); });
    return { showPage, setDarkMode, setPreset, setCustomAccent, setCustomColor, clearCustomColor, setBorderColor, setCustomTitle, uploadBackground: (input, scope) => backgroundSettings.upload(input, scope), setBackgroundUrl: scope => backgroundSettings.setUrl(scope), clearBackground: scope => backgroundSettings.clear(scope) };
}
