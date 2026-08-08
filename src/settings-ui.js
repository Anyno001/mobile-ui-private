import {
    DEFAULT_INDEPENDENT_API_TEMPERATURE, extractAiResponseContent, normalizeIndependentApiTemperature,
} from './ai.js';
import { normalizeInjectionConfig } from './behavior-config.js';
import { normalizeBudgetConfig } from './budget.js';
import { THEME_PRESETS, normalizeApiUrls } from './config.js';
import { openCropper } from './cropper.js';
import { createApiRequestController } from './settings-api-controller.js';
import { createApiDraftMode } from './settings-api-mode.js';
import { createAppearanceController } from './settings-appearance-controller.js';
import { createBackupController } from './settings-backup-controller.js';
import { createBackgroundSettings, runBackgroundTransaction } from './settings-background.js';
import { createBudgetController } from './settings-budget-controller.js';
import { createInjectionResultGuard } from './settings-injection-guard.js';
import { createGalBubbleController } from './settings-gal-bubble-controller.js';
import { createWordyLimitController } from './settings-wordy-controller.js';
import { showModelPicker } from './settings-model-picker.js';
import { installQuickReplySettings } from './settings-quick-reply.js';
import { installWorldBookSettings } from './settings-worldbook.js';
import {
    renderApiSettings, renderBackupSettings, renderBudgetSettings, renderLookSettings, renderSettingsHome, renderSettingsModal, resolveBudgetPercentageInput,
} from './settings-templates.js';
import { legacyBackupTheme, parseBackupData } from './settings-backup-validate.js';
import { createBackupStateHandlers, createEmptyCalendarBackupFields, runBackupTransaction } from './settings-backup.js';
import { loadBgSettings, saveBgGlobal, saveBgLocal, saveDesktopBg } from './storage-background.js';
import { escapeAttr, escapeHtml, safeJS } from './ui.js';
import {
    addOrUpdateProfile, clearPluginData, loadBudgetConfig, loadProfiles, loadTheme, loadGalBubbleEnabled,
    saveBudgetConfig, saveGalBubbleEnabled, saveProfiles, saveTheme, saveWordyLimit,
} from './storage.js';
import { reconcileGalBubble } from './gal-bubble.js';
import {
    normalizeAmbientStatus, normalizeInteractiveStore, normalizePhoneUiState,
} from './interactive-scene-model.js';
import { createEmptyTodayTrendStore } from './today-trend-model.js';

const clone = value => JSON.parse(JSON.stringify(value));
export { createBackupStateHandlers, runBackupTransaction } from './settings-backup.js';
export { parseBackupData } from './settings-backup-validate.js';
export { runBackgroundTransaction } from './settings-background.js';

export function installSettingsUi(deps) {
    const { makeOverlay, applyTheme, applyBackground, addNote, getCurrentPersona, getStorageId, runtime, closePhone, applyBidirectionalInjection, clearBidirectionalInjection } = deps;
    const { capture: captureBackupState, apply: applyBackupState, complete: completeBackupState, persist: persistBackupState } = createBackupStateHandlers(deps);
    const quickReplySettings = installQuickReplySettings({ makeOverlay, addNote, saveTheme });
    const worldBookSettings = installWorldBookSettings({ makeOverlay, addNote, getCtx: deps.getCtx });
    const apiDraftMode = createApiDraftMode();
    const requireInjectionSuccess = createInjectionResultGuard();
    const wordySettings = createWordyLimitController({ saveWordyLimit });
    const galBubbleSettings = createGalBubbleController({
        getContext: deps.getCtx,
        reconcile: reconcileGalBubble,
        saveEnabled: saveGalBubbleEnabled,
    });
    const apiSettings = createApiRequestController({
        runtime, normalizeApiUrls, extractAiResponseContent, normalizeIndependentApiTemperature,
        defaultTemperature: DEFAULT_INDEPENDENT_API_TEMPERATURE, apiDraftMode, clone, saveProfiles, addOrUpdateProfile,
        addNote, showApi: () => window.__pmShowConfig('api'), showModelPicker, escapeAttr, escapeHtml,
    });
    const budgetSettings = createBudgetController({
        normalizeBudgetConfig, resolveBudgetPercentageInput, saveBudgetConfig, requireInjectionSuccess,
        applyBidirectionalInjection, addNote, showBudget: () => window.__pmShowConfig('budget'),
    });
    const backgroundSettings = createBackgroundSettings({
        applyBackground, getCurrentPersona, getStorageId, loadBgSettings, clone, openCropper,
        saveBgGlobal, saveBgLocal, saveDesktopBg, showLook: () => window.__pmShowConfig('look'),
    });

    const backupSettings = createBackupController({
        capture: captureBackupState, apply: applyBackupState, persist: persistBackupState, complete: completeBackupState,
        parseBackupData, runBackupTransaction, legacyBackupTheme, clearPluginData, requireInjectionSuccess,
        clearBidirectionalInjection, applyBidirectionalInjection, cancelCommunityGeneration: deps.cancelCommunityGeneration,
        cancelCalendarTasks: deps.cancelCalendarTasks, reloadCalendarStore: deps.reloadCalendarStore,
        syncGalBubble: enabled => {
            const context = deps.getCtx?.();
            if (!Array.isArray(context?.extensionSettings?.regex) || typeof context.saveSettingsDebounced !== 'function') {
                throw new Error('当前酒馆未提供可写的全局正则列表或设置保存接口');
            }
            galBubbleSettings.sync(enabled);
            return true;
        },
        reloadTodayTrendStore: deps.reloadTodayTrendStore, invalidateInteractiveStore: deps.invalidateInteractiveStore, closePhone,
        createEmptyState: () => ({
            histories: {}, config: { apiUrl: '', apiKey: '', model: '', temperature: DEFAULT_INDEPENDENT_API_TEMPERATURE, useIndependent: false },
            theme: { preset: 'default', customRight: '', customLeft: '', borderColor: '', layout: 'standard', darkMode: 'light', ambientStatusEnabled: false, customTitle: '' },
            profiles: [], groupMeta: {}, pokeConfig: {}, bidirectional: {}, injectionConfig: normalizeInjectionConfig(null),
            emojis: [], characterBehavior: {}, worldBookConfig: null, wordyLimit: false, galBubbleEnabled: false,
            desktopBg: '', bgGlobal: '', bgLocal: {},
            interactiveScenes: normalizeInteractiveStore(null), phoneUiState: normalizePhoneUiState(null), ambientStatus: normalizeAmbientStatus(),
            ...createEmptyCalendarBackupFields(), todayTrend: createEmptyTodayTrendStore(),
        }),
        afterApplyEmpty: () => { window.__pmBudgetConfig = normalizeBudgetConfig(); },
    });
    const appearanceSettings = createAppearanceController({
        THEME_PRESETS, applyTheme, clone, saveTheme, renderLookSettings, renderSettingsModal, makeOverlay,
        escapeAttr, safeJS, getCurrentPersona, getStorageId, backgroundSettings,
    });
    window.__pmDeleteProfile = idx => apiSettings.deleteProfile(idx);
    window.__pmPickProfile = idx => apiSettings.pickProfile(idx);
    window.__pmSetMode = value => apiSettings.setMode(value);
    window.__pmToggleWordyLimit = () => wordySettings.toggle();
    window.__pmToggleGalBubble = () => galBubbleSettings.toggle();
    window.__pmSetDarkMode = mode => appearanceSettings.setDarkMode(mode);
    window.__pmSetPreset = preset => appearanceSettings.setPreset(preset);
    window.__pmSetCustomAccent = () => appearanceSettings.setCustomAccent();
    window.__pmSetCustomColor = () => appearanceSettings.setCustomColor();
    window.__pmClearCustomColor = () => appearanceSettings.clearCustomColor();
    window.__pmSetBorderColor = () => appearanceSettings.setBorderColor();
    window.__pmSetCustomTitle = () => appearanceSettings.setCustomTitle();
    window.__pmUploadBg = (input, scope) => appearanceSettings.uploadBackground(input, scope);
    window.__pmBgUrl = scope => appearanceSettings.setBackgroundUrl(scope);
    window.__pmClearBg = scope => appearanceSettings.clearBackground(scope);
    window.__pmExportData = () => backupSettings.exportData();
    window.__pmImportData = input => backupSettings.importData(input);
    window.__pmClearAllData = () => backupSettings.clearAllData();
    window.__pmTestApi = button => apiSettings.testApi(button);
    window.__pmTestModel = button => apiSettings.testModel(button);
    window.__pmSaveConfig = () => apiSettings.saveConfig();
    window.__pmShowModelPicker = () => apiSettings.showModelPicker();
    window.__pmSaveBudgetConfig = () => budgetSettings.save();
    window.__pmResetBudgetConfig = () => budgetSettings.reset();


    window.__pmShowConfig = async (page = 'home') => {
        if (page !== 'worldbook') worldBookSettings.cancelPendingPage();
        loadProfiles(); loadTheme(); loadBudgetConfig(); loadGalBubbleEnabled();
        if (page === 'home') {
            makeOverlay(renderSettingsModal({ title: '设置', content: renderSettingsHome(), showBack: false }));
            return;
        }
        if (page === 'backup') {
            makeOverlay(renderSettingsModal({ title: '数据备份', content: renderBackupSettings() }));
            return;
        }
        if (page === 'quick-reply') {
            quickReplySettings.showPage();
            return;
        }
        if (page === 'worldbook') {
            await worldBookSettings.showPage();
            return;
        }
        if (page === 'budget') {
            const content = renderBudgetSettings({ config: normalizeBudgetConfig(window.__pmBudgetConfig) });
            const footer = '<div class="pm-modal-add"><button class="pm-action-button is-secondary is-flex-1" onclick="window.__pmResetBudgetConfig()">恢复默认</button><button class="pm-action-button is-accent is-flex-2" onclick="window.__pmSaveBudgetConfig()">保存上下文预算</button></div>';
            makeOverlay(renderSettingsModal({ title: '上下文预算', content, footer }));
            return;
        }
        if (page === 'api') {
            apiDraftMode.set(window.__pmConfig.useIndependent);
            const content = renderApiSettings(apiSettings.getPageState());
            const footer = '<div class="pm-modal-add"><button class="pm-action-button is-accent is-full" onclick="window.__pmSaveConfig()">保存 API 设置</button></div>';
            makeOverlay(renderSettingsModal({ title: 'API 设置', content, footer }));
            return;
        }
        await appearanceSettings.showPage();
    };
}
