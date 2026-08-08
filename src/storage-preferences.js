import { BUDGET_CONFIG_KEY } from './budget.js';
import { normalizeInjectionConfig } from './behavior-config.js';
import { THEME_PRESETS } from './config.js';
import { GAL_BUBBLE_ENABLED_KEY, INJECTION_CONFIG_KEY, WORLD_BOOK_CONFIG_KEY } from './constants.js';
import { normalizeWorldBookConfig } from './worldbook-config.js';

export function loadTheme() {
    try {
        const saved = JSON.parse(localStorage.getItem('ST_SMS_THEME'));
        if (saved && typeof saved === 'object' && !Array.isArray(saved)) window.__pmTheme = { ...window.__pmTheme, ...saved };
        const preset = window.__pmTheme.preset;
        if (preset !== 'custom' && !Object.hasOwn(THEME_PRESETS, preset)) {
            window.__pmTheme.preset = 'default';
            saveTheme();
        }
        if (window.__pmTheme.layout !== 'standard') {
            window.__pmTheme.layout = 'standard';
            saveTheme();
        }
    } catch (error) {}
    window.__pmTheme.ambientStatusEnabled = window.__pmTheme.ambientStatusEnabled === true;
}

export function saveTheme() {
    try { localStorage.setItem('ST_SMS_THEME', JSON.stringify(window.__pmTheme)); return true; }
    catch (error) { return false; }
}

export function loadWordyLimit() {
    try { window.__pmWordyLimit = !!JSON.parse(localStorage.getItem('ST_SMS_WORDY_LIMIT')); }
    catch (error) { window.__pmWordyLimit = false; }
}

export function saveWordyLimit() {
    try { localStorage.setItem('ST_SMS_WORDY_LIMIT', JSON.stringify(window.__pmWordyLimit)); return true; }
    catch (error) { return false; }
}

export function loadGalBubbleEnabled() {
    try { window.__pmGalBubbleEnabled = !!JSON.parse(localStorage.getItem(GAL_BUBBLE_ENABLED_KEY)); }
    catch (error) { window.__pmGalBubbleEnabled = false; }
}

export function saveGalBubbleEnabled() {
    try { localStorage.setItem(GAL_BUBBLE_ENABLED_KEY, JSON.stringify(window.__pmGalBubbleEnabled)); return true; }
    catch (error) { return false; }
}

export function loadProfiles() {
    try { window.__pmProfiles = JSON.parse(localStorage.getItem('ST_SMS_API_PROFILES')) || []; }
    catch (error) { window.__pmProfiles = []; }
}

export function saveProfiles() {
    try { localStorage.setItem('ST_SMS_API_PROFILES', JSON.stringify(window.__pmProfiles)); return true; }
    catch (error) { return false; }
}

export function addOrUpdateProfile(profile) {
    if (!profile.apiUrl || !profile.apiKey) return false;
    const previous = window.__pmProfiles.map(item => ({ ...item }));
    const index = window.__pmProfiles.findIndex(item => item.apiUrl === profile.apiUrl && item.apiKey === profile.apiKey);
    if (index >= 0) window.__pmProfiles[index] = { ...window.__pmProfiles[index], ...profile, savedAt: Date.now() };
    else window.__pmProfiles.push({ ...profile, savedAt: Date.now() });
    if (saveProfiles()) return true;
    window.__pmProfiles = previous;
    return false;
}

export function loadInjectionConfig() {
    try {
        let legacyCalendar = null;
        try {
            const legacyBudget = JSON.parse(localStorage.getItem(BUDGET_CONFIG_KEY));
            legacyCalendar = { position: legacyBudget?.calendarPosition, depth: legacyBudget?.calendarDepth };
        } catch (error) {}
        window.__pmInjectionConfig = normalizeInjectionConfig(JSON.parse(localStorage.getItem(INJECTION_CONFIG_KEY)), legacyCalendar);
    } catch (error) { window.__pmInjectionConfig = normalizeInjectionConfig(null); }
    return window.__pmInjectionConfig;
}

export function saveInjectionConfig() {
    const normalized = normalizeInjectionConfig(window.__pmInjectionConfig);
    window.__pmInjectionConfig = normalized;
    try { localStorage.setItem(INJECTION_CONFIG_KEY, JSON.stringify(normalized)); return true; }
    catch (error) { return false; }
}

export function loadWorldBookConfig() {
    try { window.__pmWorldBookConfig = normalizeWorldBookConfig(JSON.parse(localStorage.getItem(WORLD_BOOK_CONFIG_KEY))); }
    catch (error) { window.__pmWorldBookConfig = normalizeWorldBookConfig(null); }
    return window.__pmWorldBookConfig;
}

export function saveWorldBookConfig(candidate = window.__pmWorldBookConfig) {
    const normalized = normalizeWorldBookConfig(candidate);
    try { localStorage.setItem(WORLD_BOOK_CONFIG_KEY, JSON.stringify(normalized)); window.__pmWorldBookConfig = normalized; return true; }
    catch (error) { return false; }
}
