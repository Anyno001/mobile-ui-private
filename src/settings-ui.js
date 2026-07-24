import {
    DEFAULT_INDEPENDENT_API_TEMPERATURE, extractAiResponseContent, normalizeIndependentApiTemperature,
} from './ai.js';
import { normalizeInjectionConfig } from './behavior-config.js';
import { normalizeBudgetConfig } from './budget.js';
import { THEME_PRESETS, normalizeApiUrls } from './config.js';
import { openCropper } from './cropper.js';
import { createApiDraftMode } from './settings-api-mode.js';
import { showModelPicker } from './settings-model-picker.js';
import { installQuickReplySettings } from './settings-quick-reply.js';
import {
    collectBudgetCommunityFields, renderApiSettings, renderBackupSettings, renderBudgetSceneOptions,
    renderBudgetSettings, renderLookSettings, renderSettingsHome, renderSettingsModal, resolveBudgetPercentageInput,
} from './settings-templates.js';
import { legacyBackupTheme, parseBackupData } from './settings-backup-validate.js';
import { createBackupStateHandlers, createEmptyCalendarBackupFields, runBackupTransaction } from './settings-backup.js';
import { loadBgSettings, saveBgGlobal, saveBgLocal, saveDesktopBg } from './storage-background.js';
import { escapeAttr, escapeHtml, safeJS } from './ui.js';
import {
    addOrUpdateProfile, clearPluginData, loadBudgetConfig, loadInteractiveScenes, loadPhoneUiState, loadProfiles, loadTheme,
    saveBidirectional, saveCharacterBehavior, saveEmojis,
    saveGroupMeta, saveHistoriesStrict, saveInteractiveScenes, savePokeConfig, saveProfiles,
    saveBudgetConfig, savePhoneUiState, saveTheme, saveWordyLimit,
} from './storage.js';
import {
    normalizeAmbientStatus, normalizeInteractiveStore, normalizePhoneUiState,
} from './interactive-scene-model.js';

const clone = value => JSON.parse(JSON.stringify(value));
export { createBackupStateHandlers, parseBackupData, runBackupTransaction };

export async function runBackgroundTransaction({ capture, mutate, restore, persist }) {
    const snapshot = capture();
    try {
        mutate();
        await persist();
    } catch (error) {
        restore(snapshot);
        try {
            await persist();
        } catch (rollbackError) {
            const combined = new Error(`${error.message}；原背景回滚失败：${rollbackError.message}`);
            combined.cause = error;
            combined.rollbackError = rollbackError;
            throw combined;
        }
        throw error;
    }
}

export function installSettingsUi(deps) {
    const {
        makeOverlay, applyTheme, applyBackground, fitNameFont, addNote,
        getCurrentPersona, getStorageId, runtime, closePhone,
        applyBidirectionalInjection, clearBidirectionalInjection, getInteractiveStore,
    } = deps;
    const {
        capture: captureBackupState,
        apply: applyBackupState,
        persist: persistBackupState,
    } = createBackupStateHandlers(deps);
    const quickReplySettings = installQuickReplySettings({ makeOverlay, addNote, saveTheme });
    const apiDraftMode = createApiDraftMode();
    let backgroundMutation = Promise.resolve();
    const injectionFailure = (result, phase) => {
        const failedWrites = Number.isInteger(result?.failedWrites) && result.failedWrites > 0 ? result.failedWrites : 0;
        const failedKeys = Array.isArray(result?.failedKeys) ? result.failedKeys : [];
        if (!failedWrites && !failedKeys.length) return null;
        const details = [failedWrites ? `${failedWrites} 项写入失败` : '', failedKeys.length ? `${failedKeys.length} 项清理失败` : '']
            .filter(Boolean).join('，');
        const error = new Error(`${phase}：${details}`);
        error.injectionResult = result;
        return error;
    };
    const requireInjectionSuccess = async (operation, phase) => {
        const result = await operation();
        const error = injectionFailure(result, phase);
        if (error) throw error;
        return result;
    };
    const syncLookControls = () => {
        const theme = window.__pmTheme;
        document.querySelectorAll('.pm-theme-chip').forEach(el => {
            const active = el.dataset.preset === theme.preset;
            el.classList.toggle('pm-theme-active', active);
            el.setAttribute('aria-pressed', String(active));
        });
        document.querySelectorAll('.pm-layout-chip').forEach(el => {
            const value = el.textContent.includes('夜间') ? 'dark' : el.textContent.includes('日间') ? 'light' : '';
            if (value) el.classList.toggle('pm-layout-active', value === theme.darkMode);
        });
        const title = document.getElementById('pm-custom-title'), right = document.getElementById('pm-custom-right'), left = document.getElementById('pm-custom-left'), border = document.getElementById('pm-border-color');
        if (title) title.value = theme.customTitle || '';
        if (right) right.value = theme.customRight || '#007aff'; if (left) left.value = theme.customLeft || '#e9e9eb'; if (border) border.value = theme.borderColor || '#1a1a1a';
    };
    const persistThemeMutation = mutate => {
        const previous = clone(window.__pmTheme); mutate();
        if (saveTheme()) { applyTheme(); syncLookControls(); return true; }
        window.__pmTheme = previous; applyTheme(); syncLookControls(); alert('主题保存失败：浏览器存储不可用。'); return false;
    };
    const queueBackgroundMutation = (scope, mutate) => {
        const isDesktop = scope === 'desktop';
        const isGlobal = scope === 'global';
        const operation = backgroundMutation.catch(() => {}).then(async () => {
            await runBackgroundTransaction({
                capture: () => isDesktop ? (window.__pmDesktopBg || '')
                    : isGlobal ? (window.__pmBgGlobal || '') : clone(window.__pmBgLocal || {}),
                mutate,
                restore: snapshot => {
                    if (isDesktop) window.__pmDesktopBg = snapshot;
                    else if (isGlobal) window.__pmBgGlobal = snapshot;
                    else window.__pmBgLocal = clone(snapshot);
                },
                persist: isDesktop ? saveDesktopBg : isGlobal ? saveBgGlobal : saveBgLocal,
            });
            applyBackground();
            window.__pmShowConfig('look');
        });
        backgroundMutation = operation;
        return operation.catch(error => {
            applyBackground();
            alert(error.rollbackError
                ? `背景操作失败，原背景回滚也失败。请勿刷新，并立即导出备份。\n${error.message}`
                : `背景操作失败，原背景已恢复。\n${error.message}`);
            window.__pmShowConfig('look');
            return false;
        });
    };
    window.__pmDeleteProfile = (idx) => {
        const previous = clone(window.__pmProfiles);
        window.__pmProfiles.splice(idx, 1);
        if (!saveProfiles()) { window.__pmProfiles = previous; alert('API 档案删除失败：浏览器存储不可用。'); return false; }
        window.__pmShowConfig('api');
        return true;
    };
    window.__pmPickProfile = (idx) => {
        const p = window.__pmProfiles[idx]; if (!p) return;
        const u = document.getElementById('pm-cfg-url'), k = document.getElementById('pm-cfg-key'), m = document.getElementById('pm-cfg-model'),
            temperature = document.getElementById('pm-cfg-temperature');
        if (u) u.value = p.apiUrl || ''; if (k) k.value = p.apiKey || ''; if (m) m.value = p.model || '';
        if (temperature) temperature.value = String(normalizeIndependentApiTemperature(p.temperature));
        apiDraftMode.set(true);
    };
    window.__pmSetMode = value => apiDraftMode.set(value);
    window.__pmToggleWordyLimit = () => {
        const previous = window.__pmWordyLimit === true;
        window.__pmWordyLimit = !previous;
        if (!saveWordyLimit()) { window.__pmWordyLimit = previous; alert('短消息限制保存失败：浏览器存储不可用。'); }
        const el = document.getElementById('pm-wordy-check');
        if (el) { el.classList.toggle('is-checked', window.__pmWordyLimit); el.setAttribute('aria-checked', String(window.__pmWordyLimit)); }
        return window.__pmWordyLimit !== previous;
    };
    window.__pmSetDarkMode = mode => persistThemeMutation(() => { window.__pmTheme.darkMode = mode; });
    // ========== 导出 / 导入 数据功能 ==========
    window.__pmExportData = async () => {
        const snapshot = await captureBackupState();
        const data = {
            schemaVersion: 8,
            histories: snapshot.histories,
            config: snapshot.config,
            theme: legacyBackupTheme(snapshot.theme),
            profiles: snapshot.profiles,
            groupMeta: snapshot.groupMeta,
            pokeConfig: snapshot.pokeConfig,
            bidirectional: snapshot.bidirectional,
            injectionConfig: snapshot.injectionConfig,
            emojis: snapshot.emojis,
            characterBehavior: snapshot.characterBehavior,
            wordyLimit: snapshot.wordyLimit,
            desktopBg: snapshot.desktopBg,
            bgGlobal: snapshot.bgGlobal,
            bgLocal: snapshot.bgLocal,
            interactiveScenes: snapshot.interactiveScenes,
            phoneUiState: snapshot.phoneUiState,
            ambientStatus: snapshot.ambientStatus,
            calendarStore: snapshot.calendarStore,
            calendarOccasions: snapshot.calendarOccasions,
            calendarHolidays: snapshot.calendarHolidays,
            calendarWeather: snapshot.calendarWeather,
            calendarCycles: snapshot.calendarCycles,
            calendarRecipes: snapshot.calendarRecipes,
        };
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `TianyinXiaojian_Backup_${new Date().getTime()}.json`;
        a.click();
        URL.revokeObjectURL(url);
        alert('备份已成功导出。');
    };

    window.__pmImportData = (input) => {
        const file = input.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = async (e) => {
            let transactionError = null;
            try {
                const data = JSON.parse(e.target.result);
                if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('备份根节点必须是对象');
                await runBackupTransaction({
                    capture: captureBackupState,
                    prepare: current => parseBackupData(data, current),
                    beforeApply: async reason => {
                        deps.cancelCommunityGeneration?.(`backup-${reason}`);
                        deps.cancelCalendarTasks?.(`backup-${reason}`);
                        await requireInjectionSuccess(
                            () => clearBidirectionalInjection(),
                            reason === 'apply' ? '导入前清理旧注入失败' : '回滚前清理注入失败',
                        );
                    },
                    apply: async (snapshot, imported) => {
                        if (snapshot) return applyBackupState(snapshot);
                        return applyBackupState(imported);
                    },
                    persist: persistBackupState,
                    afterPersist: async reason => requireInjectionSuccess(
                        () => applyBidirectionalInjection(),
                        reason === 'apply' ? '导入后的注入刷新失败' : '恢复原数据后的注入刷新失败',
                    ),
                });
            } catch (err) {
                transactionError = err;
            }
            if (transactionError) {
                const err = transactionError;
                if (err.backupPhase === 'rollback-failed') {
                    alert(`导入失败，原数据回滚也失败。请勿刷新，并立即导出当前内存备份。\n${err.message}`);
                } else if (err.backupPhase === 'rolled-back') {
                    alert(`导入失败，原数据已恢复。\n${err.message}`);
                } else {
                    alert(`导入失败，未修改现有数据。\n${err.message}`);
                }
                return;
            }
            alert('数据导入成功，请重新打开界面生效。');
            document.getElementById('pm-overlay')?.remove();
            closePhone(true);
        };
        reader.readAsText(file);
        input.value = '';
    };

    window.__pmClearAllData = async () => {
        if (!confirm('将删除天音小笺的聊天、社区、设置、背景与恢复状态。此操作不会删除宿主或其他扩展数据。是否继续？')) return false;
        if (!confirm('最后确认：清理后只能通过之前导出的备份恢复。确定删除全部天音小笺数据？')) return false;
        const previous = await captureBackupState();
        deps.cancelCommunityGeneration?.('plugin-data-clear');
        deps.cancelCalendarTasks?.('plugin-data-clear');
        try {
            await requireInjectionSuccess(
                () => clearBidirectionalInjection(), '清理数据前移除旧注入失败',
            );
            await clearPluginData({ afterClear: async () => {
                await applyBackupState({
                    histories: {}, config: { apiUrl: '', apiKey: '', model: '', temperature: DEFAULT_INDEPENDENT_API_TEMPERATURE, useIndependent: false },
                    theme: { preset: 'default', customRight: '', customLeft: '', borderColor: '', layout: 'standard', darkMode: 'light', ambientStatusEnabled: false, customTitle: '' },
                    profiles: [], groupMeta: {}, pokeConfig: {}, bidirectional: {}, injectionConfig: normalizeInjectionConfig(null),
                    emojis: [], characterBehavior: {},
                    wordyLimit: false, desktopBg: '', bgGlobal: '', bgLocal: {}, interactiveScenes: normalizeInteractiveStore(null),
                    phoneUiState: normalizePhoneUiState(null), ambientStatus: normalizeAmbientStatus(),
                    ...createEmptyCalendarBackupFields(),
                });
                deps.reloadCalendarStore?.();
                window.__pmBudgetConfig = normalizeBudgetConfig();
                deps.invalidateInteractiveStore?.();
                await requireInjectionSuccess(
                    () => clearBidirectionalInjection(), '应用空状态后清理注入失败',
                );
            } });
            alert('天音小笺数据已清理。');
            document.getElementById('pm-overlay')?.remove();
            closePhone(true);
            return true;
        } catch (error) {
            let rollbackError = error.rollbackError || null;
            try {
                await applyBackupState(previous);
                await persistBackupState(previous);
                deps.reloadCalendarStore?.();
                await requireInjectionSuccess(
                    () => applyBidirectionalInjection(), '恢复原数据后的注入刷新失败',
                );
            } catch (failure) {
                rollbackError = failure;
            }
            if (rollbackError) {
                alert(`清理失败，原数据回滚也失败。请勿刷新，并立即导出当前内存备份。\n${error.message}；${rollbackError.message}`);
            } else {
                alert(`清理失败，原数据已恢复。\n${error.message}`);
            }
            return false;
        }
    };

    // ========== 独立设置页面 ==========
    window.__pmShowConfig = async (page = 'home') => {
        loadProfiles(); loadTheme(); loadBudgetConfig();
        const cfg = window.__pmConfig, t = window.__pmTheme;
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
        if (page === 'budget') {
            const config = normalizeBudgetConfig(window.__pmBudgetConfig);
            const storageId = getStorageId();
            let scope = null;
            try {
                const store = await getInteractiveStore?.();
                scope = store?.scopes?.[storageId] || null;
            } catch (error) {}
            const sceneOptions = renderBudgetSceneOptions({ config, scope, storageId });
            const content = renderBudgetSettings({ config, sceneOptions });
            const footer = '<div class="pm-modal-add"><button class="pm-action-button is-secondary" onclick="window.__pmResetBudgetConfig()" style="flex:1">恢复默认</button><button class="pm-action-button" onclick="window.__pmSaveBudgetConfig()" style="flex:2">保存上下文预算</button></div>';
            makeOverlay(renderSettingsModal({ title: '上下文预算', content, footer }));
            return;
        }
        const shortUrl = (u) => (u || '').replace(/^https?:\/\//, '').replace(/\/+$/, '');
        const maskKey = (k) => !k ? '' : (k.length <= 8 ? '****' : k.slice(0, 4) + '****' + k.slice(-4));
        const profilesHtml = window.__pmProfiles.length > 0
            ? window.__pmProfiles.map((p, i) => `<div class="pm-prof-li"><div class="pm-prof-info" onclick="window.__pmPickProfile(${i})"><div class="pm-prof-url">${escapeHtml(shortUrl(p.apiUrl))}</div><div class="pm-prof-meta">${escapeHtml(maskKey(p.apiKey))}${p.model ? ' · ' + escapeHtml(p.model) : ''}</div></div><button type="button" class="pm-prof-del" onclick="window.__pmDeleteProfile(${i})">删除</button></div>`).join('')
            : '<div class="pm-prof-empty">暂无档案</div>';
        if (page === 'api') {
            apiDraftMode.set(cfg.useIndependent);
            const content = renderApiSettings({
                cfg: {
                    apiUrl: escapeAttr(cfg.apiUrl || ''),
                    apiKey: escapeAttr(cfg.apiKey || ''),
                    model: escapeAttr(cfg.model || ''),
                    temperature: escapeAttr(String(normalizeIndependentApiTemperature(cfg.temperature))),
                },
                useIndependent: apiDraftMode.current(),
                profilesHtml,
            });
            const footer = '<div class="pm-modal-add"><button class="pm-action-button" onclick="window.__pmSaveConfig()" style="width:100%">保存 API 设置</button></div>';
            makeOverlay(renderSettingsModal({ title: 'API 设置', content, footer }));
            return;
        }
        await loadBgSettings();
        const persona = getCurrentPersona();
        const presetBtns = Object.entries(THEME_PRESETS).map(([k, v]) =>
            `<button type="button" class="pm-theme-chip ${t.preset === k ? 'pm-theme-active' : ''}" data-preset="${k}" aria-label="使用${escapeAttr(v.label)}气泡主题" aria-pressed="${t.preset === k}" onclick="window.__pmSetPreset('${safeJS(k)}')"><span class="pm-theme-dot" style="background:${v.right}" aria-hidden="true"></span>${escapeHtml(v.label)}</button>`
        ).join('');
        const id = getStorageId(), localKey = `${id}_${persona}`;
        const hasDesktopBg = !!window.__pmDesktopBg, hasGlobalBg = !!window.__pmBgGlobal, hasLocalBg = !!window.__pmBgLocal[localKey];
        const desktopBgBtn = hasDesktopBg
            ? `<button class="pm-bg-btn pm-bg-del" onclick="window.__pmClearBg('desktop')">清除</button>`
            : `<label class="pm-bg-btn">选择图片<input type="file" accept="image/*" onchange="window.__pmUploadBg(this,'desktop')" hidden></label>
               <button class="pm-bg-btn" onclick="window.__pmBgUrl('desktop')">URL</button>`;
        const globalBgBtn = hasGlobalBg
            ? `<button class="pm-bg-btn pm-bg-del" onclick="window.__pmClearBg('global')">清除</button>`
            : `<label class="pm-bg-btn">选择图片<input type="file" accept="image/*" onchange="window.__pmUploadBg(this,'global')" hidden></label>
               <button class="pm-bg-btn" onclick="window.__pmBgUrl('global')">URL</button>`;
        const localBgBtn = hasLocalBg
            ? `<button class="pm-bg-btn pm-bg-del" onclick="window.__pmClearBg('local')">清除</button>`
            : `<label class="pm-bg-btn">选择图片<input type="file" accept="image/*" onchange="window.__pmUploadBg(this,'local')" hidden></label>
               <button class="pm-bg-btn" onclick="window.__pmBgUrl('local')">URL</button>`;
        const content = renderLookSettings({
            theme: t,
            presetButtons: presetBtns,
            desktopBackgroundButtons: desktopBgBtn,
            globalBackgroundButtons: globalBgBtn,
            localBackgroundButtons: localBgBtn,
        });
        makeOverlay(renderSettingsModal({ title: '主题颜色', content }));
    };
    window.__pmSetPreset = p => persistThemeMutation(() => {
        window.__pmTheme.preset = p; window.__pmTheme.customRight = ''; window.__pmTheme.customLeft = '';
    });
    window.__pmSetCustomColor = () => persistThemeMutation(() => {
        window.__pmTheme.customRight = document.getElementById('pm-custom-right')?.value || '';
        window.__pmTheme.customLeft = document.getElementById('pm-custom-left')?.value || '';
        window.__pmTheme.preset = 'custom';
    });
    window.__pmClearCustomColor = () => persistThemeMutation(() => {
        window.__pmTheme.customRight = ''; window.__pmTheme.customLeft = '';
        window.__pmTheme.preset = 'default';
    });
    window.__pmSetBorderColor = () => persistThemeMutation(() => { window.__pmTheme.borderColor = document.getElementById('pm-border-color')?.value || '#1a1a1a'; });
    window.__pmSetCustomTitle = () => persistThemeMutation(() => { window.__pmTheme.customTitle = (document.getElementById('pm-custom-title')?.value || '').trim().slice(0, 20); });
    window.__pmUploadBg = (input, scope) => {
        const file = input.files?.[0]; if (!file) return;
        const reader = new FileReader();
        reader.onload = (e) => {
            const persona = getCurrentPersona();
            const key = `${getStorageId()}_${persona}`;
            openCropper(e.target.result, {
                onCancel: () => window.__pmShowConfig('look'),
                onConfirm: croppedDataUrl => queueBackgroundMutation(scope, () => {
                    if (scope === 'desktop') window.__pmDesktopBg = croppedDataUrl;
                    else if (scope === 'global') window.__pmBgGlobal = croppedDataUrl;
                    else window.__pmBgLocal[key] = croppedDataUrl;
                }),
            });
        };
        reader.readAsDataURL(file);
        input.value = '';
    };
    window.__pmBgUrl = (scope) => {
        const url = prompt('输入图片 URL：');
        if (!url?.trim()) return;
        const persona = getCurrentPersona();
        const key = `${getStorageId()}_${persona}`;
        return queueBackgroundMutation(scope, () => {
            if (scope === 'desktop') window.__pmDesktopBg = url.trim();
            else if (scope === 'global') window.__pmBgGlobal = url.trim();
            else window.__pmBgLocal[key] = url.trim();
        });
    };
    window.__pmClearBg = (scope) => {
        const key = `${getStorageId()}_${getCurrentPersona()}`;
        return queueBackgroundMutation(scope, () => {
            if (scope === 'desktop') window.__pmDesktopBg = '';
            else if (scope === 'global') window.__pmBgGlobal = '';
            else delete window.__pmBgLocal[key];
        });
    };
    const setApiStatus = (message, color) => {
        const s = document.getElementById('pm-api-status');
        if (s) { s.textContent = message; s.style.color = color; }
    };
    const readApiFailure = async response => {
        let detail = '';
        try {
            const raw = await response.text();
            if (raw) {
                try {
                    const data = JSON.parse(raw);
                    detail = data?.error?.message || data?.message || data?.error || '';
                } catch (error) { detail = raw; }
            }
        } catch (error) {}
        return `HTTP ${response.status}${detail ? `：${String(detail).trim().slice(0, 160)}` : ''}`;
    };
    const runApiAction = async (button, pendingLabel, operation) => {
        const controls = ['pm-api-fetch-models', 'pm-api-test-model']
            .map(id => document.getElementById(id)).filter(Boolean);
        if (controls.some(control => control.disabled)) return false;
        const originalLabel = button?.textContent || '';
        controls.forEach(control => { control.disabled = true; control.setAttribute?.('aria-busy', 'true'); });
        if (button) button.textContent = pendingLabel;
        try { return await operation(); }
        finally {
            controls.forEach(control => { control.disabled = false; control.removeAttribute?.('aria-busy'); });
            if (button?.isConnected !== false && originalLabel) button.textContent = originalLabel;
        }
    };
    window.__pmTestApi = async button => {
        const u = document.getElementById('pm-cfg-url')?.value.trim() || '';
        const k = document.getElementById('pm-cfg-key')?.value.trim() || '';
        if (!u || !k) { setApiStatus('请填写 API 地址和密钥', '#ff3b30'); return false; }
        return runApiAction(button, '拉取中…', async () => {
            setApiStatus('正在拉取模型…', '#007aff');
            const ctrl = new AbortController(); const timer = setTimeout(() => ctrl.abort(), 15000);
            try {
                const r = await fetch(normalizeApiUrls(u).modelsUrl, { method: 'GET', headers: { Authorization: `Bearer ${k}` }, signal: ctrl.signal });
                if (!r.ok) throw new Error(await readApiFailure(r));
                const d = await r.json();
                const models = Array.isArray(d?.data)
                    ? [...new Set(d.data.map(item => typeof item?.id === 'string' ? item.id.trim() : '').filter(Boolean))] : [];
                if (!models.length) throw new Error('接口未返回可用模型');
                runtime.modelList = models;
                const modelInput = document.getElementById('pm-cfg-model');
                if (modelInput && !modelInput.value.trim()) modelInput.value = models[0];
                setApiStatus(`已拉取 ${models.length} 个模型`, '#34c759');
                return true;
            } catch (error) {
                setApiStatus(`拉取失败：${error.name === 'AbortError' ? '请求超时' : error.message}`, '#ff3b30');
                return false;
            } finally { clearTimeout(timer); }
        });
    };
    window.__pmTestModel = async button => {
        const u = document.getElementById('pm-cfg-url')?.value.trim() || '', k = document.getElementById('pm-cfg-key')?.value.trim() || '', m = document.getElementById('pm-cfg-model')?.value.trim() || '';
        if (!u || !k || !m) { setApiStatus('请填写完整的 API 地址、密钥与模型', '#ff3b30'); return false; }
        return runApiAction(button, '测试中…', async () => {
            setApiStatus(`正在测试「${m}」…`, '#007aff');
            const ctrl = new AbortController(); const timer = setTimeout(() => ctrl.abort(), 15000);
            try {
                const r = await fetch(normalizeApiUrls(u).chatUrl, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${k}` }, body: JSON.stringify({ model: m, messages: [{ role: 'user', content: '只回复：OK' }] }), signal: ctrl.signal });
                if (!r.ok) throw new Error(await readApiFailure(r));
                const j = await r.json(), reply = extractAiResponseContent(j);
                if (!reply) throw new Error('响应中没有可读取的文本');
                setApiStatus(`测试成功：“${reply.slice(0, 25)}”`, '#34c759');
                return true;
            } catch (error) {
                setApiStatus(`测试失败：${error.name === 'AbortError' ? '请求超时' : error.message}`, '#ff3b30');
                return false;
            } finally { clearTimeout(timer); }
        });
    };
    window.__pmSaveBudgetConfig = async () => {
        const storageId = getStorageId();
        const phoneWeightInput = document.getElementById('pm-budget-phone-weight');
        const communityWeightInput = document.getElementById('pm-budget-community-weight');
        const calendarWeightInput = document.getElementById('pm-budget-calendar-weight');
        const recipeWeightInput = document.getElementById('pm-budget-recipe-weight');
        let sourceWeights;
        try {
            sourceWeights = resolveBudgetPercentageInput({
                sourceWeights: normalizeBudgetConfig(window.__pmBudgetConfig).sourceWeights,
                phone: phoneWeightInput?.value,
                community: communityWeightInput?.value,
                calendar: calendarWeightInput?.value,
                recipe: recipeWeightInput?.value,
                initialPhone: phoneWeightInput?.dataset.initialValue,
                initialCommunity: communityWeightInput?.dataset.initialValue,
                initialCalendar: calendarWeightInput?.dataset.initialValue,
                initialRecipe: recipeWeightInput?.dataset.initialValue,
            });
        } catch (error) { alert(error.message); return; }
        const prioritySource = document.getElementById('pm-budget-priority')?.value;
        const priority = [prioritySource, 'phone', 'community', 'calendar', 'recipe'].filter((value, index, values) => value && values.indexOf(value) === index);
        const current = normalizeBudgetConfig(window.__pmBudgetConfig);
        const communityFields = collectBudgetCommunityFields(document, current, storageId);
        const candidate = normalizeBudgetConfig({
            ...current,
            targetTokens: Number(document.getElementById('pm-budget-target')?.value),
            sourceWeights,
            sourcePriority: priority,
            redistributeUnused: document.getElementById('pm-budget-redistribute')?.classList.contains('is-checked') === true,
            communityEnabled: document.getElementById('pm-budget-community-enabled')?.classList.contains('is-checked') === true,
            communityPosition: Number(document.getElementById('pm-budget-community-position')?.value),
            communityDepth: Number(document.getElementById('pm-budget-community-depth')?.value),
            ...communityFields,
            calendarPosition: Number(document.getElementById('pm-budget-calendar-position')?.value),
            calendarDepth: Number(document.getElementById('pm-budget-calendar-depth')?.value),
        });
        if (!saveBudgetConfig(candidate)) {
            alert('上下文预算保存失败：浏览器存储不可用');
            return;
        }
        await applyBidirectionalInjection();
        document.getElementById('pm-overlay')?.remove();
        addNote('上下文预算已保存（token 为估算值）');
    };
    window.__pmResetBudgetConfig = async () => {
        const candidate = normalizeBudgetConfig();
        if (!saveBudgetConfig(candidate)) { alert('上下文预算重置失败：浏览器存储不可用'); return; }
        await applyBidirectionalInjection();
        window.__pmShowConfig('budget');
    };
    window.__pmSaveConfig = () => {
        const apiUrl = document.getElementById('pm-cfg-url')?.value.trim() ?? '', apiKey = document.getElementById('pm-cfg-key')?.value.trim() ?? '', model = document.getElementById('pm-cfg-model')?.value.trim() ?? '';
        const temperatureText = document.getElementById('pm-cfg-temperature')?.value.trim() ?? String(DEFAULT_INDEPENDENT_API_TEMPERATURE);
        const parsedTemperature = Number(temperatureText);
        const useIndependent = apiDraftMode.current();
        const status = document.getElementById('pm-api-status');
        if (useIndependent && (!apiUrl || !apiKey || !model)) {
            if (status) { status.textContent = '独立 API 必须填写地址、密钥和模型'; status.style.color = '#ff3b30'; }
            return false;
        }
        if (useIndependent && (!temperatureText || !Number.isFinite(parsedTemperature) || parsedTemperature < 0 || parsedTemperature > 2)) {
            if (status) { status.textContent = '温度必须是 0 到 2 之间的数字'; status.style.color = '#ff3b30'; }
            return false;
        }
        const temperature = useIndependent ? parsedTemperature : normalizeIndependentApiTemperature(temperatureText);
        const previous = clone(window.__pmConfig), candidate = { apiUrl, apiKey, model, temperature, useIndependent };
        window.__pmConfig = candidate;
        try { localStorage.setItem('ST_SMS_CONFIG', JSON.stringify(candidate)); }
        catch (error) { window.__pmConfig = previous; alert('API 配置保存失败：浏览器存储不可用。'); return false; }
        const profileSaved = !apiUrl || !apiKey || addOrUpdateProfile({ apiUrl, apiKey, model, temperature });
        document.getElementById('pm-overlay')?.remove();
        addNote(profileSaved
            ? `已保存：${window.__pmConfig.useIndependent && apiUrl ? '独立API' : '主API'}`
            : 'API 设置已保存；档案列表保存失败，不影响当前配置。');
        return true;
    };
    window.__pmShowModelPicker = () => showModelPicker(runtime);
}
