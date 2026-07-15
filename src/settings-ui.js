import { MODEL_VISIBLE_ROWS, POPOVER_SUPPORTED } from './constants.js';
import { THEME_PRESETS, normalizeApiUrls } from './config.js';
import { openCropper } from './cropper.js';
import {
    renderApiSettings, renderLookSettings, renderOtherSettings, renderSettingsModal,
} from './settings-templates.js';
import { escapeAttr, escapeHtml, safeJS } from './ui.js';
import {
    addOrUpdateProfile, loadBgSettings, loadProfiles, loadTheme, pmIDBDel,
    saveBgGlobal, saveBgLocal, saveCharacterBehavior, saveEmojis, saveGroupMeta,
    saveHistories, saveProfiles, saveTheme, saveWordyLimit,
} from './storage.js';

export function installSettingsUi(deps) {
    const {
        makeOverlay, applyTheme, applyBackground, fitNameFont, addNote,
        getPhoneWindow, getCurrentPersona, getStorageId, runtime, closePhone,
    } = deps;

    window.__pmDeleteProfile = (idx) => {
        window.__pmProfiles.splice(idx, 1);
        saveProfiles();
        window.__pmShowConfig();
    };

    window.__pmPickProfile = (idx) => {
        const p = window.__pmProfiles[idx]; if (!p) return;
        const u = document.getElementById('pm-cfg-url'), k = document.getElementById('pm-cfg-key'), m = document.getElementById('pm-cfg-model');
        if (u) u.value = p.apiUrl || ''; if (k) k.value = p.apiKey || ''; if (m) m.value = p.model || '';
    };

    window.__pmSetMode = (v) => {
        window.__pmConfig.useIndependent = !!v;
        try { localStorage.setItem('ST_SMS_CONFIG', JSON.stringify(window.__pmConfig)); } catch (e) {}
        const a = document.getElementById('pm-mode-main'), b = document.getElementById('pm-mode-indep'), t = document.getElementById('pm-mode-tip');
        if (a && b) { a.classList.toggle('pm-mode-active', !v); b.classList.toggle('pm-mode-active', !!v); }
        if (t) t.textContent = v ? '🔌 独立API' : '🏠 主API';
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
        if (pw) {
            pw.setAttribute('data-theme', mode);
        }
        document.querySelectorAll('.pm-layout-chip').forEach(el => {
            if (el.textContent.includes('日间') || el.textContent.includes('夜间')) {
                el.classList.toggle('pm-layout-active',
                    (mode === 'light' && el.textContent.includes('日间')) ||
                    (mode === 'dark' && el.textContent.includes('夜间'))
                );
            }
        });
    };

    // ========== 导出 / 导入 数据功能 ==========
    window.__pmExportData = () => {
        const data = {
            histories: window.__pmHistories || {},
            config: window.__pmConfig || {},
            theme: window.__pmTheme || {},
            profiles: window.__pmProfiles || [],
            groupMeta: window.__pmGroupMeta || {},
            pokeConfig: window.__pmPokeConfig || {},
            bidirectional: window.__pmBidirectional || {},
            emojis: window.__pmEmojis || [],
            characterBehavior: window.__pmCharacterBehavior || {},
        };
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `TianyinXiaojian_Backup_${new Date().getTime()}.json`;
        a.click();
        URL.revokeObjectURL(url);
        alert('✅ 短信备份已成功导出！');
    };

    window.__pmImportData = (input) => {
        const file = input.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const data = JSON.parse(e.target.result);
                if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('备份根节点必须是对象');
                if (Object.hasOwn(data, 'histories')) window.__pmHistories = data.histories ?? {};
                if (Object.hasOwn(data, 'config')) window.__pmConfig = data.config ?? {};
                if (Object.hasOwn(data, 'theme')) window.__pmTheme = data.theme ?? {};
                if (Object.hasOwn(data, 'profiles')) window.__pmProfiles = data.profiles ?? [];
                if (Object.hasOwn(data, 'groupMeta')) window.__pmGroupMeta = data.groupMeta ?? {};
                if (Object.hasOwn(data, 'pokeConfig')) window.__pmPokeConfig = data.pokeConfig ?? {};
                if (Object.hasOwn(data, 'bidirectional')) window.__pmBidirectional = data.bidirectional ?? {};
                if (Object.hasOwn(data, 'characterBehavior')) window.__pmCharacterBehavior = data.characterBehavior ?? {};
                if (Object.hasOwn(data, 'emojis')) { window.__pmEmojis = data.emojis ?? []; saveEmojis(); }

                saveHistories();
                try { localStorage.setItem('ST_SMS_CONFIG', JSON.stringify(window.__pmConfig)); } catch(err) {}
                saveTheme();
                saveGroupMeta();
                saveCharacterBehavior();
                try { localStorage.setItem('ST_SMS_POKE_CONFIG', JSON.stringify(window.__pmPokeConfig)); } catch(err) {}
                try { localStorage.setItem('ST_SMS_BIDIRECTIONAL', JSON.stringify(window.__pmBidirectional)); } catch(err) {}

                alert('✅ 数据导入成功！请重新打开短信界面生效。');
                document.getElementById('pm-overlay')?.remove();
                closePhone();
            } catch (err) {
                alert('❌ 导入失败，文件格式不正确！\n' + err.message);
            }
        };
        reader.readAsText(file);
        input.value = '';
    };

    // ========== 设置界面 ==========
    window.__pmShowConfig = async () => {
        loadProfiles(); loadTheme();
        await loadBgSettings();
        const cfg = window.__pmConfig, t = window.__pmTheme;
        const shortUrl = (u) => (u || '').replace(/^https?:\/\//, '').replace(/\/+$/, '');
        const maskKey = (k) => !k ? '' : (k.length <= 8 ? '****' : k.slice(0, 4) + '****' + k.slice(-4));
        const persona = getCurrentPersona();
        const profilesHtml = window.__pmProfiles.length > 0
            ? window.__pmProfiles.map((p, i) => `<div class="pm-prof-li"><div class="pm-prof-info" onclick="window.__pmPickProfile(${i})"><div class="pm-prof-url">${escapeHtml(shortUrl(p.apiUrl))}</div><div class="pm-prof-meta">${escapeHtml(maskKey(p.apiKey))}${p.model ? ' · ' + escapeHtml(p.model) : ''}</div></div><i class="pm-prof-del" onclick="window.__pmDeleteProfile(${i})">✕</i></div>`).join('')
            : '<div class="pm-prof-empty">暂无档案</div>';
        const useIndep = !!cfg.useIndependent;
        const presetBtns = Object.entries(THEME_PRESETS).map(([k, v]) =>
            `<div class="pm-theme-chip ${t.preset === k ? 'pm-theme-active' : ''}" data-preset="${k}" onclick="window.__pmSetPreset('${safeJS(k)}')"><span class="pm-theme-dot" style="background:${v.right}"></span>${v.label}</div>`
        ).join('');
        const layoutBtns = ['standard', 'relaxed'].map(v =>
            `<div class="pm-layout-chip ${t.layout === v ? 'pm-layout-active' : ''}" onclick="window.__pmSetLayout('${safeJS(v)}')">${v === 'standard' ? '标准' : '宽松'}</div>`
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

        const apiPane = renderApiSettings({
            cfg: {
                apiUrl: escapeAttr(cfg.apiUrl || ''),
                apiKey: escapeAttr(cfg.apiKey || ''),
                model: escapeAttr(cfg.model || ''),
            },
            useIndependent: useIndep,
            profilesHtml,
        });
        const lookPane = renderLookSettings({
            theme: t,
            layoutButtons: layoutBtns,
            presetButtons: presetBtns,
            globalBackgroundButtons: globalBgBtn,
            localBackgroundButtons: localBgBtn,
        });
        makeOverlay(renderSettingsModal({
            apiPane,
            lookPane,
            otherPane: renderOtherSettings(),
        }));

    };

    window.__pmSwitchTab = (tab) => {
        document.querySelectorAll('.pm-cfg-tab').forEach(el => el.classList.toggle('pm-cfg-tab-active', el.dataset.tab === tab));
        document.querySelectorAll('.pm-tab-pane').forEach(el => el.style.display = 'none');
        const pane = document.getElementById(`pm-tab-${tab}`);
        if (pane) pane.style.display = 'block';
        if (tab === 'other') {
            window.__pmRenderEmojiSetList();
            const wc = document.getElementById('pm-wordy-check');
            if (wc) wc.classList.toggle('is-checked', !!window.__pmWordyLimit);
        }
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

    window.__pmSetLayout = (v) => {
        window.__pmTheme.layout = v; saveTheme();
        const pw = getPhoneWindow();
        if (pw) pw.dataset.layout = v;
        document.querySelectorAll('.pm-layout-chip').forEach(el => el.classList.toggle('pm-layout-active', el.textContent === (v === 'standard' ? '标准' : '宽松')));
        fitNameFont();
    };

    window.__pmUploadBg = (input, scope) => {
        const file = input.files?.[0]; if (!file) return;
        const reader = new FileReader();
        reader.onload = (e) => {
            openCropper(e.target.result, {
                onCancel: () => window.__pmShowConfig(),
                onConfirm: (croppedDataUrl) => {
                    const persona = getCurrentPersona();
                    if (scope === 'global') { window.__pmBgGlobal = croppedDataUrl; saveBgGlobal(); }
                    else { const id = getStorageId(); window.__pmBgLocal[`${id}_${persona}`] = croppedDataUrl; saveBgLocal(); }
                    applyBackground();
                    window.__pmShowConfig();
                    setTimeout(() => window.__pmSwitchTab('look'), 50);
                },
            });
        };
        reader.readAsDataURL(file);
        input.value = '';
    };

    window.__pmBgUrl = (scope) => {
        const url = prompt('输入图片 URL：');
        if (!url?.trim()) return;
        const persona = getCurrentPersona();
        if (scope === 'global') { window.__pmBgGlobal = url.trim(); saveBgGlobal(); }
        else { const id = getStorageId(); window.__pmBgLocal[`${id}_${persona}`] = url.trim(); saveBgLocal(); }
        applyBackground();
        window.__pmShowConfig();
        setTimeout(() => window.__pmSwitchTab('look'), 50);
    };

    window.__pmClearBg = async (scope) => {
        if (scope === 'global') {
            window.__pmBgGlobal = '';
            await pmIDBDel('ST_SMS_BG_GLOBAL');
            try { localStorage.removeItem('ST_SMS_BG_GLOBAL'); } catch (e) {}
        } else {
            const id = getStorageId(), persona = getCurrentPersona(), key = `${id}_${persona}`;
            delete window.__pmBgLocal[key];
            await pmIDBDel('ST_SMS_BG_LOCAL_' + key);
            await saveBgLocal();
        }
        applyBackground();
        window.__pmShowConfig();
        setTimeout(() => window.__pmSwitchTab('look'), 50);
    };

    window.__pmTestApi = async () => {
        const u = document.getElementById('pm-cfg-url').value.trim(), k = document.getElementById('pm-cfg-key').value.trim(), m = document.getElementById('pm-cfg-model').value.trim();
        const s = document.getElementById('pm-api-status');
        if (!u) { s.textContent = "❌ 填写API地址"; s.style.color = "#ff3b30"; return; }
        s.textContent = "连接中..."; s.style.color = "#007aff";
        try {
            const r = await fetch(normalizeApiUrls(u).modelsUrl, { method: 'GET', headers: { 'Authorization': `Bearer ${k}` } });
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
            const d = await r.json();
            if (d?.data && Array.isArray(d.data)) { runtime.modelList = d.data.map(x => x.id).filter(Boolean); s.textContent = `✅ ${runtime.modelList.length} 个模型`; s.style.color = "#34c759"; }
            else { s.textContent = "✅ 连接成功"; s.style.color = "#34c759"; }
            addOrUpdateProfile({ apiUrl: u, apiKey: k, model: m });
        } catch (e) { s.textContent = "❌ " + e.message; s.style.color = "#ff3b30"; }
    };

    window.__pmTestModel = async () => {
        const u = document.getElementById('pm-cfg-url').value.trim(), k = document.getElementById('pm-cfg-key').value.trim(), m = document.getElementById('pm-cfg-model').value.trim();
        const s = document.getElementById('pm-api-status');
        if (!u || !k || !m) { s.textContent = '❌ 请填完整'; s.style.color = '#ff3b30'; return; }
        s.textContent = `测试「${m}」...`; s.style.color = '#007aff';
        const ctrl = new AbortController(); const tm = setTimeout(() => ctrl.abort(), 15000);
        try {
            const r = await fetch(normalizeApiUrls(u).chatUrl, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${k}` }, body: JSON.stringify({ model: m, messages: [{ role: 'user', content: 'hi' }], max_tokens: 16 }), signal: ctrl.signal });
            clearTimeout(tm); if (!r.ok) throw new Error(`HTTP ${r.status}`);
            const j = await r.json(), reply = j.choices?.[0]?.message?.content;
            s.textContent = reply != null ? `✅ "${String(reply).slice(0, 25)}"` : '⚠️ 格式异常'; s.style.color = reply != null ? '#34c759' : '#ff9500';
        } catch (e) { clearTimeout(tm); s.textContent = '❌ ' + (e.name === 'AbortError' ? '超时' : e.message); s.style.color = '#ff3b30'; }
    };

    window.__pmSaveConfig = () => {
        const apiUrl = document.getElementById('pm-cfg-url')?.value.trim() ?? '', apiKey = document.getElementById('pm-cfg-key')?.value.trim() ?? '', model = document.getElementById('pm-cfg-model')?.value.trim() ?? '';
        window.__pmConfig = { apiUrl, apiKey, model, useIndependent: !!window.__pmConfig.useIndependent };
        try { localStorage.setItem('ST_SMS_CONFIG', JSON.stringify(window.__pmConfig)); } catch (e) {}
        if (apiUrl && apiKey) addOrUpdateProfile({ apiUrl, apiKey, model });
        document.getElementById('pm-overlay')?.remove();
        addNote(`已保存：${window.__pmConfig.useIndependent && apiUrl ? '独立API' : '主API'}`);
    };

    window.__pmShowModelPicker = () => {
        const existing = document.getElementById('pm-model-dropdown');
        if (existing) { existing.remove(); return; }
        if (!runtime.modelList.length) { const s = document.getElementById('pm-api-status'); if (s) { s.textContent = '⚠️ 先拉取模型'; s.style.color = '#ff9500'; } return; }
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
