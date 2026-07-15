import { MODEL_VISIBLE_ROWS, POPOVER_SUPPORTED } from './constants.js';
import { THEME_PRESETS, normalizeApiUrls } from './config.js';
import { openCropper } from './cropper.js';
import {
    renderApiSettings, renderBackupSettings, renderLookSettings, renderSettingsModal,
} from './settings-templates.js';
import { escapeAttr, escapeHtml, safeJS } from './ui.js';
import {
    addOrUpdateProfile, loadBgSettings, loadInteractiveScenes, loadProfiles, loadTheme, saveBgGlobal,
    saveBgLocal, saveBidirectional, saveCharacterBehavior, saveEmojis,
    saveGroupMeta, saveHistoriesStrict, saveInteractiveScenes, savePokeConfig, saveProfiles,
    saveTheme, saveWordyLimit,
} from './storage.js';
import { INTERACTIVE_LIMITS, normalizeInteractiveStore } from './interactive-scene-model.js';

const clone = value => JSON.parse(JSON.stringify(value));
const objectValue = (value, field) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`备份字段 ${field} 必须是对象`);
    return clone(value);
};
const arrayValue = (value, field) => {
    if (!Array.isArray(value)) throw new Error(`备份字段 ${field} 必须是数组`);
    return clone(value);
};

const DANGEROUS_DICTIONARY_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const assertSafeDictionaryKey = (value, field) => {
    if (DANGEROUS_DICTIONARY_KEYS.has(value)) throw new Error(`备份字段 ${field} 包含危险键 ${value}`);
};
const assertAllowedKeys = (value, field, allowedKeys) => {
    const allowed = new Set(allowedKeys);
    const unsupported = Object.keys(value).find(key => !allowed.has(key));
    if (unsupported) throw new Error(`备份字段 ${field}.${unsupported} 不受支持`);
};
const assertNormalizedText = (value, field, max, { allowEmpty = false } = {}) => {
    if (typeof value !== 'string') throw new Error(`备份字段 ${field} 必须是字符串`);
    if (value !== value.trim()) throw new Error(`备份字段 ${field} 不能包含首尾空白`);
    if (!allowEmpty && !value) throw new Error(`备份字段 ${field} 必须是非空字符串`);
    if (value.length > max) throw new Error(`备份字段 ${field} 长度不能超过 ${max}`);
};
const assertOptionalNormalizedText = (item, key, field, max, options) => {
    if (Object.hasOwn(item, key)) assertNormalizedText(item[key], `${field}.${key}`, max, options);
};
const assertOptionalTimestamp = (item, key, field) => {
    if (!Object.hasOwn(item, key)) return;
    const value = item[key];
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) throw new Error(`备份字段 ${field}.${key} 必须是有效时间戳`);
};
const assertInteractiveItem = (value, field, { kind = 'post' } = {}) => {
    const item = objectValue(value, field);
    const allowedKeys = kind === 'post'
        ? ['id', 'author', 'content', 'tags', 'createdAt', 'comments', 'liked']
        : ['id', 'author', 'content', 'createdAt'];
    assertAllowedKeys(item, field, allowedKeys);
    const contentMax = kind === 'post' ? 4000 : kind === 'comment' ? 1000 : 200;
    assertNormalizedText(item.content, `${field}.content`, contentMax);
    assertOptionalNormalizedText(item, 'id', field, 80);
    assertOptionalNormalizedText(item, 'author', field, 80);
    assertOptionalTimestamp(item, 'createdAt', field);
    if (kind === 'post') {
        if (Object.hasOwn(item, 'liked') && typeof item.liked !== 'boolean') throw new Error(`备份字段 ${field}.liked 必须是布尔值`);
        if (Object.hasOwn(item, 'tags')) {
            if (!Array.isArray(item.tags) || item.tags.some(tag => typeof tag !== 'string')) throw new Error(`备份字段 ${field}.tags 必须是字符串数组`);
            if (item.tags.length > 5) throw new Error(`备份字段 ${field}.tags 不能超过 5 项`);
            item.tags.forEach((tag, index) => assertNormalizedText(tag, `${field}.tags.${index}`, 30));
        }
        if (Object.hasOwn(item, 'comments')) {
            if (!Array.isArray(item.comments)) throw new Error(`备份字段 ${field}.comments 必须是数组`);
            if (item.comments.length > INTERACTIVE_LIMITS.comments) throw new Error(`备份字段 ${field}.comments 不能超过 ${INTERACTIVE_LIMITS.comments} 项`);
            item.comments.forEach((comment, index) => assertInteractiveItem(comment, `${field}.comments.${index}`, { kind: 'comment' }));
        }
    }
};

const assertInteractiveBackupStore = value => {
    const store = objectValue(value, 'interactiveScenes');
    assertAllowedKeys(store, 'interactiveScenes', ['version', 'scopes']);
    if (!Number.isInteger(store.version) || store.version !== 1) throw new Error('备份字段 interactiveScenes.version 必须是数字 1');
    const scopes = objectValue(store.scopes, 'interactiveScenes.scopes');
    for (const [scopeId, scopeValue] of Object.entries(scopes)) {
        assertSafeDictionaryKey(scopeId, 'interactiveScenes.scopes');
        const field = `interactiveScenes.scopes.${scopeId}`;
        const scope = objectValue(scopeValue, field);
        assertAllowedKeys(scope, field, ['activeSceneId', 'sceneOrder', 'scenes']);
        if (!Array.isArray(scope.sceneOrder)) throw new Error(`备份字段 ${field}.sceneOrder 必须是数组`);
        if (scope.sceneOrder.length > INTERACTIVE_LIMITS.scenes) throw new Error(`备份字段 ${field}.sceneOrder 不能超过 ${INTERACTIVE_LIMITS.scenes} 项`);
        const scenes = objectValue(scope.scenes, `${field}.scenes`);
        Object.keys(scenes).forEach(sceneId => assertSafeDictionaryKey(sceneId, `${field}.scenes`));
        if (Object.hasOwn(scope, 'activeSceneId') && scope.activeSceneId !== null && typeof scope.activeSceneId !== 'string') throw new Error(`备份字段 ${field}.activeSceneId 必须是字符串或 null`);
        const orderedIds = new Set();
        for (const sceneId of scope.sceneOrder) {
            assertNormalizedText(sceneId, `${field}.sceneOrder`, 80);
            assertSafeDictionaryKey(sceneId, `${field}.sceneOrder`);
            if (orderedIds.has(sceneId)) throw new Error(`备份字段 ${field}.sceneOrder 包含重复场景 ${sceneId}`);
            orderedIds.add(sceneId);
            const scene = objectValue(scenes[sceneId], `${field}.scenes.${sceneId}`);
            assertAllowedKeys(scene, `${field}.scenes.${sceneId}`, ['id', 'title', 'preset', 'styleInput', 'generatedPrompt', 'contentRating', 'createdAt', 'updatedAt', 'posts', 'live']);
            if (Object.hasOwn(scene, 'id') && scene.id !== sceneId) throw new Error(`备份字段 ${field}.scenes.${sceneId}.id 必须与场景键一致`);
            assertOptionalNormalizedText(scene, 'id', `${field}.scenes.${sceneId}`, 80);
            assertOptionalNormalizedText(scene, 'title', `${field}.scenes.${sceneId}`, 80);
            assertOptionalNormalizedText(scene, 'preset', `${field}.scenes.${sceneId}`, 30);
            assertOptionalNormalizedText(scene, 'styleInput', `${field}.scenes.${sceneId}`, 2000, { allowEmpty: true });
            assertOptionalNormalizedText(scene, 'generatedPrompt', `${field}.scenes.${sceneId}`, 6000, { allowEmpty: true });
            if (Object.hasOwn(scene, 'contentRating') && !['general', 'mature'].includes(scene.contentRating)) throw new Error(`备份字段 ${field}.scenes.${sceneId}.contentRating 必须是 general 或 mature`);
            assertOptionalTimestamp(scene, 'createdAt', `${field}.scenes.${sceneId}`);
            assertOptionalTimestamp(scene, 'updatedAt', `${field}.scenes.${sceneId}`);
            if (Object.hasOwn(scene, 'posts')) {
                if (!Array.isArray(scene.posts)) throw new Error(`备份字段 ${field}.scenes.${sceneId}.posts 必须是数组`);
                if (scene.posts.length > INTERACTIVE_LIMITS.posts) throw new Error(`备份字段 ${field}.scenes.${sceneId}.posts 不能超过 ${INTERACTIVE_LIMITS.posts} 项`);
                scene.posts.forEach((post, index) => assertInteractiveItem(post, `${field}.scenes.${sceneId}.posts.${index}`));
            }
            if (Object.hasOwn(scene, 'live')) {
                const live = objectValue(scene.live, `${field}.scenes.${sceneId}.live`);
                assertAllowedKeys(live, `${field}.scenes.${sceneId}.live`, ['title', 'status', 'danmaku']);
                assertOptionalNormalizedText(live, 'title', `${field}.scenes.${sceneId}.live`, 100);
                if (Object.hasOwn(live, 'status') && live.status !== 'idle') throw new Error(`备份字段 ${field}.scenes.${sceneId}.live.status 必须是 idle`);
                if (Object.hasOwn(live, 'danmaku')) {
                    if (!Array.isArray(live.danmaku)) throw new Error(`备份字段 ${field}.scenes.${sceneId}.live.danmaku 必须是数组`);
                    if (live.danmaku.length > INTERACTIVE_LIMITS.danmaku) throw new Error(`备份字段 ${field}.scenes.${sceneId}.live.danmaku 不能超过 ${INTERACTIVE_LIMITS.danmaku} 项`);
                    live.danmaku.forEach((item, index) => assertInteractiveItem(item, `${field}.scenes.${sceneId}.live.danmaku.${index}`, { kind: 'danmaku' }));
                }
            }
        }
        const extraSceneIds = Object.keys(scenes).filter(sceneId => !orderedIds.has(sceneId));
        if (extraSceneIds.length) throw new Error(`备份字段 ${field}.scenes 包含未列入 sceneOrder 的场景 ${extraSceneIds[0]}`);
        if (scope.activeSceneId === null && orderedIds.size) throw new Error(`备份字段 ${field}.activeSceneId 不能在存在场景时为 null`);
        if (typeof scope.activeSceneId === 'string' && !orderedIds.has(scope.activeSceneId)) throw new Error(`备份字段 ${field}.activeSceneId 未指向有效场景`);
    }
    return store;
};

export function parseBackupData(data, current) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('备份根节点必须是对象');
    const version = data.schemaVersion === undefined ? 1 : data.schemaVersion;
    if (!Number.isInteger(version) || version < 1) throw new Error('备份版本无效');
    if (version > 3) throw new Error(`备份版本 ${version} 高于当前支持版本 3`);
    const result = clone(current);
    if (Object.hasOwn(data, 'histories')) result.histories = objectValue(data.histories, 'histories');
    if (Object.hasOwn(data, 'config')) result.config = objectValue(data.config, 'config');
    if (Object.hasOwn(data, 'theme')) result.theme = objectValue(data.theme, 'theme');
    if (Object.hasOwn(data, 'profiles')) result.profiles = arrayValue(data.profiles, 'profiles');
    if (Object.hasOwn(data, 'groupMeta')) result.groupMeta = objectValue(data.groupMeta, 'groupMeta');
    if (Object.hasOwn(data, 'pokeConfig')) result.pokeConfig = objectValue(data.pokeConfig, 'pokeConfig');
    if (Object.hasOwn(data, 'bidirectional')) result.bidirectional = objectValue(data.bidirectional, 'bidirectional');
    if (Object.hasOwn(data, 'emojis')) result.emojis = arrayValue(data.emojis, 'emojis');
    if (Object.hasOwn(data, 'characterBehavior')) result.characterBehavior = objectValue(data.characterBehavior, 'characterBehavior');
    if (Object.hasOwn(data, 'wordyLimit')) {
        if (typeof data.wordyLimit !== 'boolean') throw new Error('备份字段 wordyLimit 必须是布尔值');
        result.wordyLimit = data.wordyLimit;
    }
    if (Object.hasOwn(data, 'bgGlobal')) {
        if (typeof data.bgGlobal !== 'string') throw new Error('备份字段 bgGlobal 必须是字符串');
        result.bgGlobal = data.bgGlobal;
    }
    if (Object.hasOwn(data, 'bgLocal')) result.bgLocal = objectValue(data.bgLocal, 'bgLocal');
    if (Object.hasOwn(data, 'interactiveScenes')) result.interactiveScenes = normalizeInteractiveStore(assertInteractiveBackupStore(data.interactiveScenes));
    return result;
}

export async function runBackupTransaction({ capture, apply, persist }) {
    const snapshot = await capture();
    try {
        const nextState = await apply();
        await persist(nextState);
    } catch (error) {
        let rollbackState;
        try {
            rollbackState = await apply(snapshot);
            await persist(snapshot);
        } catch (rollbackError) {
            const combined = new Error(`${error.message}；原数据回滚失败：${rollbackError.message}`);
            combined.cause = error;
            combined.rollbackError = rollbackError;
            combined.rollbackState = rollbackState;
            throw combined;
        }
        throw error;
    }
}

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
        getPhoneWindow, getCurrentPersona, getStorageId, runtime, closePhone,
    } = deps;
    let apiDraftUseIndependent = false;
    let backgroundMutation = Promise.resolve();

    const queueBackgroundMutation = (scope, mutate) => {
        const isGlobal = scope === 'global';
        const operation = backgroundMutation.catch(() => {}).then(async () => {
            await runBackgroundTransaction({
                capture: () => isGlobal ? (window.__pmBgGlobal || '') : clone(window.__pmBgLocal || {}),
                mutate,
                restore: snapshot => {
                    if (isGlobal) window.__pmBgGlobal = snapshot;
                    else window.__pmBgLocal = clone(snapshot);
                },
                persist: isGlobal ? saveBgGlobal : saveBgLocal,
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
        window.__pmProfiles.splice(idx, 1);
        saveProfiles();
        window.__pmShowConfig('api');
    };

    window.__pmPickProfile = (idx) => {
        const p = window.__pmProfiles[idx]; if (!p) return;
        const u = document.getElementById('pm-cfg-url'), k = document.getElementById('pm-cfg-key'), m = document.getElementById('pm-cfg-model');
        if (u) u.value = p.apiUrl || ''; if (k) k.value = p.apiKey || ''; if (m) m.value = p.model || '';
    };

    window.__pmSetMode = (v) => {
        apiDraftUseIndependent = !!v;
        const a = document.getElementById('pm-mode-main'), b = document.getElementById('pm-mode-indep'), t = document.getElementById('pm-mode-tip');
        if (a && b) { a.classList.toggle('pm-mode-active', !v); b.classList.toggle('pm-mode-active', !!v); }
        if (t) t.textContent = v ? '独立 API' : '主 API';
    };

    window.__pmToggleWordyLimit = () => {
        window.__pmWordyLimit = !window.__pmWordyLimit;
        saveWordyLimit();
        const el = document.getElementById('pm-wordy-check');
        if (el) el.classList.toggle('is-checked', window.__pmWordyLimit);
    };

    window.__pmSetDarkMode = (mode) => {
        window.__pmTheme.darkMode = mode;
        saveTheme();
        const pw = getPhoneWindow();
        if (pw) pw.setAttribute('data-theme', mode);
        document.getElementById('pm-overlay')?.setAttribute('data-theme', mode);
        document.querySelectorAll('.pm-layout-chip').forEach(el => {
            if (el.textContent.includes('日间') || el.textContent.includes('夜间')) {
                el.classList.toggle('pm-layout-active',
                    (mode === 'light' && el.textContent.includes('日间')) ||
                    (mode === 'dark' && el.textContent.includes('夜间'))
                );
            }
        });
    };

    const captureBackupState = async () => ({
        histories: clone(window.__pmHistories || {}),
        config: clone(window.__pmConfig || {}),
        theme: clone(window.__pmTheme || {}),
        profiles: clone(window.__pmProfiles || []),
        groupMeta: clone(window.__pmGroupMeta || {}),
        pokeConfig: clone(window.__pmPokeConfig || {}),
        bidirectional: clone(window.__pmBidirectional || {}),
        emojis: clone(window.__pmEmojis || []),
        characterBehavior: clone(window.__pmCharacterBehavior || {}),
        wordyLimit: !!window.__pmWordyLimit,
        bgGlobal: window.__pmBgGlobal || '',
        bgLocal: clone(window.__pmBgLocal || {}),
        interactiveScenes: normalizeInteractiveStore(await loadInteractiveScenes()),
    });

    const applyBackupState = async state => {
        window.__pmHistories = clone(state.histories || {});
        window.__pmConfig = clone(state.config || {});
        window.__pmTheme = clone(state.theme || {});
        window.__pmProfiles = clone(state.profiles || []);
        window.__pmGroupMeta = clone(state.groupMeta || {});
        window.__pmPokeConfig = clone(state.pokeConfig || {});
        window.__pmBidirectional = clone(state.bidirectional || {});
        window.__pmEmojis = clone(state.emojis || []);
        window.__pmCharacterBehavior = clone(state.characterBehavior || {});
        window.__pmWordyLimit = !!state.wordyLimit;
        window.__pmBgGlobal = typeof state.bgGlobal === 'string' ? state.bgGlobal : '';
        window.__pmBgLocal = clone(state.bgLocal || {});
        return { ...state, interactiveScenes: normalizeInteractiveStore(state.interactiveScenes) };
    };

    const persistBackupState = async state => {
        await saveHistoriesStrict();
        try { localStorage.setItem('ST_SMS_CONFIG', JSON.stringify(window.__pmConfig)); }
        catch (error) { throw new Error('API 配置保存失败：浏览器存储不可用'); }
        if (!saveTheme()) throw new Error('主题配置保存失败：浏览器存储不可用');
        if (!saveProfiles()) throw new Error('API 档案保存失败：浏览器存储不可用');
        await saveGroupMeta();
        if (!saveCharacterBehavior()) throw new Error('角色行为配置保存失败：浏览器存储不可用');
        if (!savePokeConfig()) throw new Error('自动消息配置保存失败：浏览器存储不可用');
        if (!saveBidirectional()) throw new Error('注入配置保存失败：浏览器存储不可用');
        if (!saveWordyLimit()) throw new Error('字数偏好保存失败：浏览器存储不可用');
        await saveEmojis();
        await saveBgGlobal();
        await saveBgLocal();
        await saveInteractiveScenes(normalizeInteractiveStore(state.interactiveScenes));
        deps.invalidateInteractiveStore?.();
    };


    // ========== 导出 / 导入 数据功能 ==========
    window.__pmExportData = async () => {
        const snapshot = await captureBackupState();
        const data = {
            schemaVersion: 3,
            histories: snapshot.histories,
            config: snapshot.config,
            theme: snapshot.theme,
            profiles: snapshot.profiles,
            groupMeta: snapshot.groupMeta,
            pokeConfig: snapshot.pokeConfig,
            bidirectional: snapshot.bidirectional,
            emojis: snapshot.emojis,
            characterBehavior: snapshot.characterBehavior,
            wordyLimit: snapshot.wordyLimit,
            bgGlobal: snapshot.bgGlobal,
            bgLocal: snapshot.bgLocal,
            interactiveScenes: snapshot.interactiveScenes,
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
            try {
                const data = JSON.parse(e.target.result);
                if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('备份根节点必须是对象');
                await runBackupTransaction({
                    capture: captureBackupState,
                    apply: async snapshot => {
                        if (snapshot) return applyBackupState(snapshot);
                        const current = await captureBackupState();
                        const imported = parseBackupData(data, current);
                        return applyBackupState(imported);
                    },
                    persist: persistBackupState,
                });

                alert('数据导入成功，请重新打开界面生效。');
                document.getElementById('pm-overlay')?.remove();
                closePhone();
            } catch (err) {
                alert(err.rollbackError
                    ? `导入失败，原数据回滚也失败。请勿刷新，并立即导出当前内存备份。\n${err.message}`
                    : `导入失败，原数据已恢复。\n${err.message}`);
            }
        };
        reader.readAsText(file);
        input.value = '';
    };

    // ========== 独立设置页面 ==========
    window.__pmShowConfig = async (page = 'api') => {
        loadProfiles(); loadTheme();
        const cfg = window.__pmConfig, t = window.__pmTheme;
        if (page === 'backup') {
            makeOverlay(renderSettingsModal({ title: '数据备份', content: renderBackupSettings() }));
            return;
        }
        const shortUrl = (u) => (u || '').replace(/^https?:\/\//, '').replace(/\/+$/, '');
        const maskKey = (k) => !k ? '' : (k.length <= 8 ? '****' : k.slice(0, 4) + '****' + k.slice(-4));
        const profilesHtml = window.__pmProfiles.length > 0
            ? window.__pmProfiles.map((p, i) => `<div class="pm-prof-li"><div class="pm-prof-info" onclick="window.__pmPickProfile(${i})"><div class="pm-prof-url">${escapeHtml(shortUrl(p.apiUrl))}</div><div class="pm-prof-meta">${escapeHtml(maskKey(p.apiKey))}${p.model ? ' · ' + escapeHtml(p.model) : ''}</div></div><i class="pm-prof-del" onclick="window.__pmDeleteProfile(${i})">✕</i></div>`).join('')
            : '<div class="pm-prof-empty">暂无档案</div>';
        if (page === 'api') {
            apiDraftUseIndependent = !!cfg.useIndependent;
            const content = renderApiSettings({
                cfg: {
                    apiUrl: escapeAttr(cfg.apiUrl || ''),
                    apiKey: escapeAttr(cfg.apiKey || ''),
                    model: escapeAttr(cfg.model || ''),
                },
                useIndependent: apiDraftUseIndependent,
                profilesHtml,
            });
            const footer = '<div class="pm-modal-add"><button onclick="window.__pmSaveConfig()" style="width:100%;background:#007aff;color:#fff;border:none;border-radius:10px;padding:10px;font-size:13px;cursor:pointer;font-weight:600;">保存 API 设置</button></div>';
            makeOverlay(renderSettingsModal({ title: 'API 设置', content, footer }));
            return;
        }
        await loadBgSettings();
        const persona = getCurrentPersona();
        const presetBtns = Object.entries(THEME_PRESETS).map(([k, v]) =>
            `<div class="pm-theme-chip ${t.preset === k ? 'pm-theme-active' : ''}" data-preset="${k}" onclick="window.__pmSetPreset('${safeJS(k)}')"><span class="pm-theme-dot" style="background:${v.right}"></span>${v.label}</div>`
        ).join('');
        const id = getStorageId(), localKey = `${id}_${persona}`;
        const hasGlobalBg = !!window.__pmBgGlobal, hasLocalBg = !!window.__pmBgLocal[localKey];
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
            globalBackgroundButtons: globalBgBtn,
            localBackgroundButtons: localBgBtn,
        });
        makeOverlay(renderSettingsModal({ title: '主题颜色', content }));
    };

    window.__pmSetPreset = (p) => {
        window.__pmTheme.preset = p; window.__pmTheme.customRight = ''; window.__pmTheme.customLeft = '';
        saveTheme(); applyTheme();
        document.querySelectorAll('.pm-theme-chip').forEach(el => el.classList.toggle('pm-theme-active', el.dataset.preset === p));
    };

    window.__pmSetCustomColor = () => {
        window.__pmTheme.customRight = document.getElementById('pm-custom-right')?.value || '';
        window.__pmTheme.customLeft = document.getElementById('pm-custom-left')?.value || '';
        window.__pmTheme.preset = 'custom'; saveTheme(); applyTheme();
        document.querySelectorAll('.pm-theme-chip').forEach(el => el.classList.remove('pm-theme-active'));
    };

    window.__pmClearCustomColor = () => {
        window.__pmTheme.customRight = ''; window.__pmTheme.customLeft = '';
        window.__pmTheme.preset = 'default'; saveTheme(); applyTheme();
        const r = document.getElementById('pm-custom-right'), l = document.getElementById('pm-custom-left');
        if (r) r.value = '#007aff'; if (l) l.value = '#e9e9eb';
        document.querySelectorAll('.pm-theme-chip').forEach(el => el.classList.toggle('pm-theme-active', el.dataset.preset === 'default'));
    };

    window.__pmSetBorderColor = () => {
        window.__pmTheme.borderColor = document.getElementById('pm-border-color')?.value || '#1a1a1a';
        saveTheme(); applyTheme();
    };

    window.__pmUploadBg = (input, scope) => {
        const file = input.files?.[0]; if (!file) return;
        const reader = new FileReader();
        reader.onload = (e) => {
            const persona = getCurrentPersona();
            const key = `${getStorageId()}_${persona}`;
            openCropper(e.target.result, {
                onCancel: () => window.__pmShowConfig('look'),
                onConfirm: croppedDataUrl => queueBackgroundMutation(scope, () => {
                    if (scope === 'global') window.__pmBgGlobal = croppedDataUrl;
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
            if (scope === 'global') window.__pmBgGlobal = url.trim();
            else window.__pmBgLocal[key] = url.trim();
        });
    };

    window.__pmClearBg = (scope) => {
        const key = `${getStorageId()}_${getCurrentPersona()}`;
        return queueBackgroundMutation(scope, () => {
            if (scope === 'global') window.__pmBgGlobal = '';
            else delete window.__pmBgLocal[key];
        });
    };

    window.__pmTestApi = async () => {
        const u = document.getElementById('pm-cfg-url').value.trim(), k = document.getElementById('pm-cfg-key').value.trim(), m = document.getElementById('pm-cfg-model').value.trim();
        const s = document.getElementById('pm-api-status');
        if (!u) { s.textContent = "请填写 API 地址"; s.style.color = "#ff3b30"; return; }
        s.textContent = "连接中..."; s.style.color = "#007aff";
        try {
            const r = await fetch(normalizeApiUrls(u).modelsUrl, { method: 'GET', headers: { 'Authorization': `Bearer ${k}` } });
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
            const d = await r.json();
            if (d?.data && Array.isArray(d.data)) { runtime.modelList = d.data.map(x => x.id).filter(Boolean); s.textContent = `已拉取 ${runtime.modelList.length} 个模型`; s.style.color = "#34c759"; }
            else { s.textContent = "连接成功"; s.style.color = "#34c759"; }
        } catch (e) { s.textContent = "连接失败：" + e.message; s.style.color = "#ff3b30"; }
    };

    window.__pmTestModel = async () => {
        const u = document.getElementById('pm-cfg-url').value.trim(), k = document.getElementById('pm-cfg-key').value.trim(), m = document.getElementById('pm-cfg-model').value.trim();
        const s = document.getElementById('pm-api-status');
        if (!u || !k || !m) { s.textContent = '请填写完整的 API、密钥与模型'; s.style.color = '#ff3b30'; return; }
        s.textContent = `测试「${m}」...`; s.style.color = '#007aff';
        const ctrl = new AbortController(); const tm = setTimeout(() => ctrl.abort(), 15000);
        try {
            const r = await fetch(normalizeApiUrls(u).chatUrl, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${k}` }, body: JSON.stringify({ model: m, messages: [{ role: 'user', content: 'hi' }], max_tokens: 16 }), signal: ctrl.signal });
            clearTimeout(tm); if (!r.ok) throw new Error(`HTTP ${r.status}`);
            const j = await r.json(), reply = j.choices?.[0]?.message?.content;
            s.textContent = reply != null ? `测试成功："${String(reply).slice(0, 25)}"` : '响应格式异常'; s.style.color = reply != null ? '#34c759' : '#ff9500';
        } catch (e) { clearTimeout(tm); s.textContent = '测试失败：' + (e.name === 'AbortError' ? '超时' : e.message); s.style.color = '#ff3b30'; }
    };

    window.__pmSaveConfig = () => {
        const apiUrl = document.getElementById('pm-cfg-url')?.value.trim() ?? '', apiKey = document.getElementById('pm-cfg-key')?.value.trim() ?? '', model = document.getElementById('pm-cfg-model')?.value.trim() ?? '';
        window.__pmConfig = { apiUrl, apiKey, model, useIndependent: apiDraftUseIndependent };
        try { localStorage.setItem('ST_SMS_CONFIG', JSON.stringify(window.__pmConfig)); } catch (e) {}
        if (apiUrl && apiKey) addOrUpdateProfile({ apiUrl, apiKey, model });
        document.getElementById('pm-overlay')?.remove();
        addNote(`已保存：${window.__pmConfig.useIndependent && apiUrl ? '独立API' : '主API'}`);
    };

    window.__pmShowModelPicker = () => {
        const existing = document.getElementById('pm-model-dropdown');
        if (existing) { existing.remove(); return; }
        if (!runtime.modelList.length) { const s = document.getElementById('pm-api-status'); if (s) { s.textContent = '请先拉取模型'; s.style.color = '#ff9500'; } return; }
        const input = document.getElementById('pm-cfg-model'), rect = input.getBoundingClientRect();
        const dd = document.createElement('div'); dd.id = 'pm-model-dropdown'; dd.className = 'pm-model-dropdown';
        dd.style.setProperty('--pm-model-visible-rows', String(MODEL_VISIBLE_ROWS));
        if (POPOVER_SUPPORTED) dd.setAttribute('popover', 'manual');
        dd.innerHTML = `<input class="pm-model-search" placeholder="🔍 搜索..." /><div class="pm-model-options"></div>`;
        dd.style.left = rect.left + 'px'; dd.style.top = (rect.bottom + 4) + 'px'; dd.style.width = rect.width + 'px';
        document.body.appendChild(dd); if (dd.showPopover) try { dd.showPopover(); } catch (e) {}
        const optsDiv = dd.querySelector('.pm-model-options');
        const render = (f = '') => {
            const fl = f.toLowerCase(), filtered = runtime.modelList.filter(m => !fl || m.toLowerCase().includes(fl));
            optsDiv.innerHTML = filtered.length ? filtered.map(m => `<div class="pm-model-opt" data-m="${escapeAttr(m)}">${escapeHtml(m)}</div>`).join('') : '<div class="pm-model-empty">无匹配</div>';
            optsDiv.querySelectorAll('.pm-model-opt').forEach(el => el.addEventListener('click', () => { document.getElementById('pm-cfg-model').value = el.dataset.m; dd.remove(); }));
        };
        render(); dd.querySelector('.pm-model-search').addEventListener('input', function () { render(this.value); }); dd.querySelector('.pm-model-search').focus();
        setTimeout(() => { const closer = (e) => { if (!dd.contains(e.target) && e.target.id !== 'pm-model-arrow') { dd.remove(); document.removeEventListener('click', closer, true); } }; document.addEventListener('click', closer, true); }, 0);
    };
}
