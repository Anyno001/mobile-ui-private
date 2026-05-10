(async function () {
    await new Promise(r => setTimeout(r, 1000));

    const SAVE_LIMIT = 60, CONTEXT_LIMIT = 20, BIDIRECTIONAL_LIMIT = 20, MAX_BIDIRECTIONAL = 5;
    const BIDIRECTIONAL_KEY = 'PHONE_SMS_MEMORY', VOICE_MAX_SEC = 60, MODEL_VISIBLE_ROWS = 4, MAX_GROUP_MEMBERS = 6;
    const BI_INJECT_DEPTH = 2;
    const POPOVER_SUPPORTED = typeof HTMLElement !== 'undefined' && HTMLElement.prototype.hasOwnProperty('popover');
    const GROUP_COLORS = [
        { bg: '#e9e9eb', text: '#000' }, { bg: '#b8e6c8', text: '#1b4332' },
        { bg: '#f5d0d0', text: '#4a2030' }, { bg: '#d4d0f5', text: '#2d2252' },
        { bg: '#f5e6b8', text: '#4a3a10' },
    ];

    // ========== IndexedDB 工具 ==========
    const PM_IDB_NAME = 'PhoneModeDB', PM_IDB_STORE = 'kv';
    let __pmIDB = null;
    const IDB_MARKER = '__idb__';

    function pmOpenIDB() {
        return new Promise(resolve => {
            if (__pmIDB) return resolve(__pmIDB);
            try {
                const req = indexedDB.open(PM_IDB_NAME, 1);
                req.onupgradeneeded = () => {
                    const db = req.result;
                    if (!db.objectStoreNames.contains(PM_IDB_STORE)) db.createObjectStore(PM_IDB_STORE);
                };
                req.onsuccess = () => { __pmIDB = req.result; resolve(__pmIDB); };
                req.onerror = () => resolve(null);
            } catch { resolve(null); }
        });
    }

    async function pmIDBSet(key, value) {
        const db = await pmOpenIDB(); if (!db) return false;
        return new Promise(r => {
            try {
                const tx = db.transaction(PM_IDB_STORE, 'readwrite');
                tx.objectStore(PM_IDB_STORE).put(value, key);
                tx.oncomplete = () => r(true);
                tx.onerror = () => r(false);
            } catch { r(false); }
        });
    }

    async function pmIDBGet(key) {
        const db = await pmOpenIDB(); if (!db) return null;
        return new Promise(r => {
            try {
                const tx = db.transaction(PM_IDB_STORE, 'readonly');
                const req = tx.objectStore(PM_IDB_STORE).get(key);
                req.onsuccess = () => r(req.result ?? null);
                req.onerror = () => r(null);
            } catch { r(null); }
        });
    }

    async function pmIDBDel(key) {
        const db = await pmOpenIDB(); if (!db) return;
        try {
            const tx = db.transaction(PM_IDB_STORE, 'readwrite');
            tx.objectStore(PM_IDB_STORE).delete(key);
        } catch {}
    }

    function pmIsBigData(v) {
        return typeof v === 'string' && v.length > 4096 && (v.startsWith('data:') || v.startsWith('blob:'));
    }

    // ========== 短信历史双写存储 ==========
    function saveHistories() {
        pmIDBSet('ST_SMS_DATA_V2', window.__pmHistories).catch(() => {});
        try { localStorage.setItem('ST_SMS_DATA_V2', JSON.stringify(window.__pmHistories)); } catch {}
    }

    async function loadHistoriesFromIDB() {
        try {
            const v = await pmIDBGet('ST_SMS_DATA_V2');
            if (!v) return;
            const parsed = typeof v === 'string' ? JSON.parse(v) : v;
            if (!parsed || typeof parsed !== 'object') return;
            const lsCount = Object.keys(window.__pmHistories || {}).length;
            const idbCount = Object.keys(parsed).length;
            if (idbCount >= lsCount) {
                window.__pmHistories = parsed;
                try { localStorage.setItem('ST_SMS_DATA_V2', JSON.stringify(parsed)); } catch {}
                if (idbCount > lsCount) console.log('[phone-mode] 从 IndexedDB 恢复了短信历史');
            }
        } catch (e) { console.warn('[phone-mode] IDB 恢复失败', e); }
    }

    window.__pmHistories = window.__pmHistories || {};
    window.__pmConfig = window.__pmConfig || { apiUrl: '', apiKey: '', model: '', useIndependent: false };
    window.__pmProfiles = window.__pmProfiles || [];
    window.__pmBidirectional = window.__pmBidirectional || {};
    window.__pmTheme = window.__pmTheme || { preset: 'default', customRight: '', customLeft: '', borderColor: '', layout: 'standard', darkMode: 'light' };
    window.__pmBgGlobal = window.__pmBgGlobal || '';
    window.__pmBgLocal = window.__pmBgLocal || {};
    window.__pmGroupMeta = window.__pmGroupMeta || {};
    window.__pmPokeConfig = window.__pmPokeConfig || {};
    let __pmModelList = [];
    let __pmEventHooked = false;

    let phoneActive = false, phoneWindow = null, currentPersona = '', conversationHistory = [];
    let isGenerating = false, isMinimized = false, isSelectMode = false;
    let isGroupChat = false, groupMembers = [], groupColorMap = {}, groupDisplayName = '';
    let currentGroupKey = '';

    const getCtx = () => typeof SillyTavern !== 'undefined' ? SillyTavern.getContext() : null;

    const THEME_PRESETS = {
        default: { right: '#007aff', left: '#e9e9eb', rightText: '#fff', leftText: '#000', label: '默认蓝' },
        pink:    { right: '#ff6b8a', left: '#fce4ec', rightText: '#fff', leftText: '#4a2030', label: '樱花粉' },
        dark:    { right: '#5856d6', left: '#2c2c2e', rightText: '#fff', leftText: '#e0e0e0', label: '暗夜紫' },
        frost:   { right: 'rgba(0,122,255,0.55)', left: 'rgba(255,255,255,0.35)', rightText: '#fff', leftText: '#222', label: '磨砂玻璃', frost: true },
        mint:    { right: '#34c759', left: '#e8f5e9', rightText: '#fff', leftText: '#1b4332', label: '薄荷绿' },
    };

    function contrastText(bg) {
        if (!bg || bg.startsWith('rgba')) return '#fff';
        const c = bg.replace('#', ''); if (c.length !== 6) return '#000';
        const r = parseInt(c.substr(0,2),16), g = parseInt(c.substr(2,2),16), b = parseInt(c.substr(4,2),16);
        return (r*0.299 + g*0.587 + b*0.114) > 150 ? '#000' : '#fff';
    }

    function loadTheme() { try { window.__pmTheme = { ...window.__pmTheme, ...JSON.parse(localStorage.getItem('ST_SMS_THEME')) }; } catch {} }
    function saveTheme() { try { localStorage.setItem('ST_SMS_THEME', JSON.stringify(window.__pmTheme)); } catch {} }
    function loadPokeConfig() { try { window.__pmPokeConfig = JSON.parse(localStorage.getItem('ST_SMS_POKE_CONFIG')) || {}; } catch { window.__pmPokeConfig = {}; } }
    function savePokeConfig() { try { localStorage.setItem('ST_SMS_POKE_CONFIG', JSON.stringify(window.__pmPokeConfig)); } catch {} }

    async function loadBgSettings() {
        try {
            const ls = localStorage.getItem('ST_SMS_BG_GLOBAL') || '';
            if (ls === IDB_MARKER) {
                window.__pmBgGlobal = (await pmIDBGet('ST_SMS_BG_GLOBAL')) || '';
            } else if (pmIsBigData(ls)) {
                window.__pmBgGlobal = ls;
                await pmIDBSet('ST_SMS_BG_GLOBAL', ls);
                try { localStorage.setItem('ST_SMS_BG_GLOBAL', IDB_MARKER); } catch {}
                console.log('[phone-mode] 全局背景已迁移到 IndexedDB');
            } else {
                window.__pmBgGlobal = ls;
            }
        } catch { window.__pmBgGlobal = ''; }

        try {
            const raw = JSON.parse(localStorage.getItem('ST_SMS_BG_LOCAL')) || {};
            const result = {};
            let migrated = 0;
            for (const [k, v] of Object.entries(raw)) {
                if (v === IDB_MARKER) {
                    result[k] = (await pmIDBGet('ST_SMS_BG_LOCAL_' + k)) || '';
                } else if (pmIsBigData(v)) {
                    result[k] = v;
                    await pmIDBSet('ST_SMS_BG_LOCAL_' + k, v);
                    raw[k] = IDB_MARKER;
                    migrated++;
                } else {
                    result[k] = v;
                }
            }
            if (migrated > 0) {
                try { localStorage.setItem('ST_SMS_BG_LOCAL', JSON.stringify(raw)); } catch {}
                console.log(`[phone-mode] 已迁移 ${migrated} 张联系人背景到 IndexedDB`);
            }
            window.__pmBgLocal = result;
        } catch { window.__pmBgLocal = {}; }
    }

    async function saveBgGlobal() {
        const v = window.__pmBgGlobal || '';
        if (pmIsBigData(v)) {
            await pmIDBSet('ST_SMS_BG_GLOBAL', v);
            try { localStorage.setItem('ST_SMS_BG_GLOBAL', IDB_MARKER); } catch {}
        } else {
            await pmIDBDel('ST_SMS_BG_GLOBAL');
            try { localStorage.setItem('ST_SMS_BG_GLOBAL', v); } catch {}
        }
    }

    async function saveBgLocal() {
        const ptr = {};
        for (const [k, v] of Object.entries(window.__pmBgLocal || {})) {
            if (pmIsBigData(v)) {
                await pmIDBSet('ST_SMS_BG_LOCAL_' + k, v);
                ptr[k] = IDB_MARKER;
            } else if (v) {
                await pmIDBDel('ST_SMS_BG_LOCAL_' + k);
                ptr[k] = v;
            }
        }
        try { localStorage.setItem('ST_SMS_BG_LOCAL', JSON.stringify(ptr)); } catch {}
    }

    function loadGroupMeta() { try { window.__pmGroupMeta = JSON.parse(localStorage.getItem('ST_SMS_GROUP_META')) || {}; } catch { window.__pmGroupMeta = {}; } }
    function saveGroupMeta() { try { localStorage.setItem('ST_SMS_GROUP_META', JSON.stringify(window.__pmGroupMeta)); } catch {} }

    function applyTheme() {
        const el = phoneWindow; if (!el) return;
        const t = window.__pmTheme, p = THEME_PRESETS[t.preset] || THEME_PRESETS.default;
        const rBg = t.customRight || p.right, lBg = t.customLeft || p.left;
        const rTxt = t.customRight ? contrastText(t.customRight) : p.rightText;
        const lTxt = t.customLeft ? contrastText(t.customLeft) : p.leftText;
        const border = t.borderColor || '#1a1a1a';
        el.style.setProperty('--pm-r-bg', rBg); el.style.setProperty('--pm-l-bg', lBg);
        el.style.setProperty('--pm-r-txt', rTxt); el.style.setProperty('--pm-l-txt', lTxt);
        el.style.setProperty('--pm-border', border);
        el.style.setProperty('--pm-frost', p.frost ? '1' : '0');
        const darkMode = t.darkMode || 'light';
        el.setAttribute('data-theme', darkMode);
    }

    function cssUrlEscape(url) {
        return (url || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    }

    function applyBackground() {
        const msgList = phoneWindow?.querySelector('.pm-msg-list'); if (!msgList) return;
        const id = getStorageId(), localKey = `${id}_${currentPersona}`;
        const bg = window.__pmBgLocal[localKey] || window.__pmBgGlobal || '';
        if (bg) {
            msgList.style.setProperty('background-image', `url("${cssUrlEscape(bg)}")`, 'important');
            msgList.style.setProperty('background-size', 'cover', 'important');
            msgList.style.setProperty('background-position', 'center', 'important');
        } else {
            msgList.style.removeProperty('background-image');
            msgList.style.removeProperty('background-size');
            msgList.style.removeProperty('background-position');
        }
    }

    function fitNameFont() {
        const nameEl = phoneWindow?.querySelector('.pm-name');
        if (!nameEl) return;
        nameEl.style.fontSize = '15px';
        requestAnimationFrame(() => {
            let fs = 15;
            while (nameEl.scrollWidth > nameEl.clientWidth && fs > 9) {
                fs -= 0.5; nameEl.style.fontSize = fs + 'px';
            }
        });
    }

    function openCropper(imgDataUrl, onConfirm) {
        const ratio = 330 / 450;
        document.getElementById('pm-overlay')?.remove();
        const ov = document.createElement('div'); ov.id = 'pm-overlay';
        if (POPOVER_SUPPORTED) ov.setAttribute('popover', 'manual');
        ov.innerHTML = `
<div class="pm-modal pm-modal-wide">
  <div class="pm-modal-header"><b>裁剪图片</b><span onclick="document.getElementById('pm-overlay').remove();window.__pmShowConfig();" class="pm-modal-close">✕</span></div>
  <div style="padding:12px 14px;">
    <div class="pm-crop-tip">拖动图片调整位置，滚轮/捏合缩放</div>
    <div class="pm-crop-frame" id="pm-crop-frame">
      <img id="pm-crop-img" src="${imgDataUrl}" alt="">
      <div class="pm-crop-mask"></div>
    </div>
    <div class="pm-crop-zoom">
      <span style="font-size:11px;color:#888;">缩放</span>
      <input type="range" id="pm-crop-zoom" min="100" max="400" value="100">
    </div>
  </div>
  <div class="pm-modal-add" style="display:flex;gap:8px;">
    <button onclick="document.getElementById('pm-overlay').remove();window.__pmShowConfig();" style="flex:1;background:#f0f0f0;color:#333;border:none;border-radius:10px;padding:10px;font-size:13px;cursor:pointer;">取消</button>
    <button id="pm-crop-confirm" style="flex:1;background:#007aff;color:#fff;border:none;border-radius:10px;padding:10px;font-size:13px;cursor:pointer;font-weight:600;">确认裁剪</button>
  </div>
</div>`;
        ov.addEventListener('click', e => { if (e.target === ov) { ov.remove(); window.__pmShowConfig(); } });
        document.body.appendChild(ov);
        if (ov.showPopover) try { ov.showPopover(); } catch {}
        const frame = ov.querySelector('#pm-crop-frame'), img = ov.querySelector('#pm-crop-img');
        const zoomSlider = ov.querySelector('#pm-crop-zoom');
        let tx = 0, ty = 0, scale = 1, frameW = 0, frameH = 0, baseW = 0, baseH = 0;
        img.onload = () => {
            const cw = frame.clientWidth;
            frameW = cw; frameH = cw / ratio; frame.style.height = frameH + 'px';
            const natW = img.naturalWidth, natH = img.naturalHeight, imgRatio = natW / natH;
            if (imgRatio > ratio) { baseH = frameH; baseW = baseH * imgRatio; }
            else { baseW = frameW; baseH = baseW / imgRatio; }
            updateTransform();
        };
        function updateTransform() {
            const w = baseW * scale, h = baseH * scale;
            tx = Math.max(frameW - w, Math.min(0, tx)); ty = Math.max(frameH - h, Math.min(0, ty));
            img.style.width = w + 'px'; img.style.height = h + 'px';
            img.style.transform = `translate(${tx}px, ${ty}px)`;
        }
        zoomSlider.oninput = () => { scale = parseInt(zoomSlider.value) / 100; updateTransform(); };
        let dragging = false, sx = 0, sy = 0, stx = 0, sty = 0;
        const onDragStart = (e) => { dragging = true; const c = e.touches ? e.touches[0] : e; sx = c.clientX; sy = c.clientY; stx = tx; sty = ty; if (e.cancelable) e.preventDefault(); };
        const onDragMove = (e) => { if (!dragging) return; const c = e.touches ? e.touches[0] : e; tx = stx + (c.clientX - sx); ty = sty + (c.clientY - sy); updateTransform(); if (e.cancelable) e.preventDefault(); };
        const onDragEnd = () => { dragging = false; };
        frame.addEventListener('mousedown', onDragStart);
        window.addEventListener('mousemove', onDragMove);
        window.addEventListener('mouseup', onDragEnd);
        frame.addEventListener('touchstart', onDragStart, { passive: false });
        window.addEventListener('touchmove', onDragMove, { passive: false });
        window.addEventListener('touchend', onDragEnd);
        let pinchDist = 0, pinchScale = 1;
        frame.addEventListener('touchstart', (e) => {
            if (e.touches.length === 2) { pinchDist = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY); pinchScale = scale; }
        }, { passive: false });
        frame.addEventListener('touchmove', (e) => {
            if (e.touches.length === 2) {
                const d = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
                scale = Math.max(1, Math.min(4, pinchScale * d / pinchDist));
                zoomSlider.value = Math.round(scale * 100); updateTransform(); e.preventDefault();
            }
        }, { passive: false });
        frame.addEventListener('wheel', (e) => {
            e.preventDefault();
            scale = Math.max(1, Math.min(4, scale + (e.deltaY > 0 ? -0.1 : 0.1)));
            zoomSlider.value = Math.round(scale * 100); updateTransform();
        });
        ov.querySelector('#pm-crop-confirm').onclick = () => {
            const canvas = document.createElement('canvas');
            const outW = 600, outH = Math.round(outW / ratio);
            canvas.width = outW; canvas.height = outH;
            const ctx = canvas.getContext('2d');
            const srcScale = img.naturalWidth / (baseW * scale);
            ctx.drawImage(img, (-tx) * srcScale, (-ty) * srcScale, frameW * srcScale, frameH * srcScale, 0, 0, outW, outH);
            let q = 0.7, out = canvas.toDataURL('image/jpeg', q);
            while (out.length > 200 * 1370 && q > 0.2) { q -= 0.1; out = canvas.toDataURL('image/jpeg', q); }
            ov.remove(); onConfirm(out);
        };
    }

    const SPECIAL_KEYWORDS = {
        '转账':'转账','transfer':'转账','Transfer':'转账','TRANSFER':'转账',
        '收款':'收款','receive':'收款','Receive':'收款','RECEIVE':'收款','收钱':'收款','收到':'收款',
        '图片':'图片','image':'图片','Image':'图片','IMAGE':'图片','img':'图片','pic':'图片','photo':'图片',
        '语音':'语音','voice':'语音','Voice':'语音','VOICE':'语音','audio':'语音',
    };
    const KW_PATTERN = Object.keys(SPECIAL_KEYWORDS).join('|');
    const SPECIAL_RE = new RegExp(`[\\(（]\\s*(${KW_PATTERN})\\s*[+：:\\s]*([^)）]+)[\\)）]`, 'gi');
    function normalizeKeyword(k) { return SPECIAL_KEYWORDS[k] || SPECIAL_KEYWORDS[k.toLowerCase()] || k; }

    function getStorageId() {
        const c = getCtx(); if (!c) return 'sms_unknown__default';
        const char = c.characters?.[c.characterId];
        const avatar = char?.avatar || `idx_${c.characterId}`;
        const chatFile = c.chatId || (typeof c.getCurrentChatId === 'function' ? c.getCurrentChatId() : null) || c.chat_metadata?.chat_id_hash || c.chat_file || 'default';
        return `sms_${avatar}__${chatFile}`;
    }

    function migrateOldHistory() {
        if (localStorage.getItem('ST_SMS_MIGRATED_V3')) return;
        const c = getCtx(); if (!c) return;
        try {
            const oldData = window.__pmHistories || {}, newData = {}; let migrated = 0;
            for (const oldKey of Object.keys(oldData)) {
                if (oldKey.startsWith('sms_')) { newData[oldKey] = oldData[oldKey]; continue; }
                const m = oldKey.match(/^(\d+)_(.+)$/);
                if (!m) { newData[oldKey] = oldData[oldKey]; continue; }
                const ch = c.characters?.[parseInt(m[1])];
                if (ch?.avatar) { newData[`sms_${ch.avatar}__${m[2]}`] = oldData[oldKey]; migrated++; }
                else newData[oldKey] = oldData[oldKey];
            }
            window.__pmHistories = newData;
            saveHistories();
            localStorage.setItem('ST_SMS_MIGRATED_V3', '1');
        } catch {}
    }

    function normalizeApiUrls(input) {
        let url = (input || '').trim().replace(/\/+$/, '');
        if (!url) return { chatUrl: '', modelsUrl: '' };
        if (/\/chat\/completions$/i.test(url)) return { chatUrl: url, modelsUrl: url.replace(/\/chat\/completions$/i, '/models') };
        if (/\/models$/i.test(url)) return { chatUrl: url.replace(/\/models$/i, '/chat/completions'), modelsUrl: url };
        if (/\/v\d+$/i.test(url)) return { chatUrl: url + '/chat/completions', modelsUrl: url + '/models' };
        return { chatUrl: url + '/v1/chat/completions', modelsUrl: url + '/v1/models' };
    }

    function loadProfiles() { try { window.__pmProfiles = JSON.parse(localStorage.getItem('ST_SMS_API_PROFILES')) || []; } catch { window.__pmProfiles = []; } }
    function saveProfiles() { try { localStorage.setItem('ST_SMS_API_PROFILES', JSON.stringify(window.__pmProfiles)); } catch {} }
    function addOrUpdateProfile(p) {
        if (!p.apiUrl || !p.apiKey) return;
        const idx = window.__pmProfiles.findIndex(x => x.apiUrl === p.apiUrl && x.apiKey === p.apiKey);
        if (idx >= 0) window.__pmProfiles[idx] = { ...window.__pmProfiles[idx], ...p, savedAt: Date.now() };
        else window.__pmProfiles.push({ ...p, savedAt: Date.now() });
        saveProfiles();
    }
    window.__pmDeleteProfile = (idx) => { window.__pmProfiles.splice(idx, 1); saveProfiles(); window.__pmShowConfig(); };
    window.__pmPickProfile = (idx) => {
        const p = window.__pmProfiles[idx]; if (!p) return;
        const u = document.getElementById('pm-cfg-url'), k = document.getElementById('pm-cfg-key'), m = document.getElementById('pm-cfg-model');
        if (u) u.value = p.apiUrl || ''; if (k) k.value = p.apiKey || ''; if (m) m.value = p.model || '';
    };

    window.__pmSetMode = (v) => {
        window.__pmConfig.useIndependent = !!v;
        try { localStorage.setItem('ST_SMS_CONFIG', JSON.stringify(window.__pmConfig)); } catch {}
        const a = document.getElementById('pm-mode-main'), b = document.getElementById('pm-mode-indep'), t = document.getElementById('pm-mode-tip');
        if (a && b) { a.classList.toggle('pm-mode-active', !v); b.classList.toggle('pm-mode-active', !!v); }
        if (t) t.textContent = v ? '🔌 独立API' : '🏠 主API';
    };

    function loadBidirectional() { try { window.__pmBidirectional = JSON.parse(localStorage.getItem('ST_SMS_BIDIRECTIONAL')) || {}; } catch { window.__pmBidirectional = {}; } }
    function saveBidirectional() { try { localStorage.setItem('ST_SMS_BIDIRECTIONAL', JSON.stringify(window.__pmBidirectional)); } catch {} }

    function applyBidirectionalInjection() {
        const c = getCtx(); if (!c || typeof c.setExtensionPrompt !== 'function') return;
        const id = getStorageId(), checked = window.__pmBidirectional[id] || [], histories = window.__pmHistories[id] || {};
        const groups = window.__pmGroupMeta[id] || {};
        if (!checked.length) { try { c.setExtensionPrompt(BIDIRECTIONAL_KEY, '', 0, 0, false, 0); } catch {} return; }
        const blocks = checked.map(name => {
            const conv = (histories[name] || []).slice(-BIDIRECTIONAL_LIMIT);
            if (!conv.length) return '';
            if (name.startsWith('__group_')) {
                const meta = groups[name]; if (!meta) return '';
                const lines = conv.map(m => {
                    const t = (m.content || '').replace(/\s*\/\s*/g, '。').replace(/\n/g, '；');
                    return m.role === 'user' ? `用户：${t}` : t;
                }).join('\n');
                return `【群聊"${meta.name}"（成员：${meta.members.join('、')}）的最近聊天 — 仅参与者与用户知晓，其他角色不应知情】\n${lines}`;
            }
            const lines = conv.map(m => { const t = (m.content || '').replace(/\s*\/\s*/g, '。'); return m.role === 'user' ? `用户：${t}` : `${name}：${t}`; }).join('\n');
            return `【与 ${name} 的短信 — 仅 ${name} 与用户知晓】\n${lines}`;
        }).filter(Boolean).join('\n\n');
        if (!blocks) { try { c.setExtensionPrompt(BIDIRECTIONAL_KEY, '', 0, 0, false, 0); } catch {} return; }
        try { c.setExtensionPrompt(BIDIRECTIONAL_KEY, `[手机短信记忆 — 私密]\n${blocks}\n[结束]`, 0, 0, false, 0); } catch {}
    }

    let __pmLastChatLen = 0; // 记录主楼的聊天长度防抖

    function hookGenerationEvent() {
        if (__pmEventHooked) return;
        const c = getCtx();
        if (!c?.eventSource || !c?.event_types) return;
        const et = c.event_types;

        __pmLastChatLen = (c.chat || []).length; // 初始化当前长度

        const events = [
            et.GENERATION_STARTED || 'generation_started',
            et.CHAT_CHANGED || 'chat_id_changed',
            et.SETTINGS_UPDATED || 'settings_updated',
            et.CHATCOMPLETION_SOURCE_CHANGED || 'chatcompletion_source_changed',
            et.OAI_PRESET_CHANGED_AFTER || 'oai_preset_changed_after',
        ];
        
        events.forEach(ev => {
            try {
                c.eventSource.on(ev, () => {
                    try { applyBidirectionalInjection(); } catch {}
                });
            } catch {}
        });

        // 👇 修复：带“长度比对”的主楼监听器，严防 Swipe 重复计数
        try {
            c.eventSource.on(et.MESSAGE_RECEIVED || 'message_received', () => {
                const currentLen = (c.chat || []).length;
                
                if (currentLen > __pmLastChatLen) {
                    // 只有总消息数增加了，才推进计数器
                    __pmLastChatLen = currentLen;
                    if (typeof window.__pmIncrementCounters === 'function') {
                        window.__pmIncrementCounters();
                    }
                } else if (currentLen < __pmLastChatLen) {
                    // 如果用户删除了主楼消息，只同步长度，不推进计数器
                    __pmLastChatLen = currentLen;
                }
            });

            // 切换聊天时，重置长度基准
            c.eventSource.on(et.CHAT_CHANGED || 'chat_id_changed', () => {
                __pmLastChatLen = (c.chat || []).length;
            });
        } catch {}

        __pmEventHooked = true;
        console.log('[phone-mode] hooked', events.length, 'events');
    }

    window.__pmToggleBidirectional = (name) => {
        const id = getStorageId(), arr = window.__pmBidirectional[id] || [], idx = arr.indexOf(name);
        if (idx >= 0) arr.splice(idx, 1);
        else { if (arr.length >= MAX_BIDIRECTIONAL) return; arr.push(name); }
        window.__pmBidirectional[id] = arr; saveBidirectional(); applyBidirectionalInjection(); window.__pmShowList();
    };

    function getUserPersona() {
        const c = getCtx();
        if (!c) return { name: '用户', description: '' };
        let name = c.name1 || 'User';
        let description = '';

        try {
            const pu = c.powerUserSettings || c.power_user || window.power_user;
            if (pu) {
                description = pu.persona_description || pu.personaDescription || '';
                const avatar = c.userAvatar || pu.user_avatar || pu.default_persona;
                if (!description && avatar) {
                    const pdMap = pu.persona_descriptions || pu.personaDescriptions;
                    if (pdMap?.[avatar]) {
                        const pd = pdMap[avatar];
                        if (typeof pd === 'string') description = pd;
                        else if (pd?.description) description = pd.description;
                    }
                }
            }
        } catch {}

        if (!description) {
            try {
                const meta = c.chatMetadata || c.chat_metadata;
                if (meta?.persona) description = String(meta.persona);
            } catch {}
        }

        try {
            if (typeof c.substituteParams === 'function') {
                const resolvedName = c.substituteParams('{{user}}');
                if (resolvedName && resolvedName !== '{{user}}' && resolvedName.trim()) {
                    name = resolvedName.trim();
                }
            }
        } catch {}

        return { name, description };
    }

    async function gatherContext() {
        const c = getCtx(), char = c?.characters?.[c.characterId] || {};
        const cleanMsg = (s) => (s || '').replace(/```[\s\S]*?```/g, '').replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/<[^>]+>/g, '').trim();
        const mainChatArr = (c?.chat || []).slice(-8).map(m => ({ who: m.is_user ? '用户' : (m.name || '角色'), content: cleanMsg(m.mes || '') })).filter(m => m.content);
        const mainChatText = mainChatArr.map(m => `${m.who}：${m.content}`).join('\n');
        let worldBookText = '';
        try {
            if (typeof c?.getWorldInfoPrompt === 'function') {
                const wi = await c.getWorldInfoPrompt((c.chat || []).map(m => m.mes || '').slice(-10), 4096, false);
                worldBookText = wi?.worldInfoString || wi?.worldInfoBefore || '';
                if (!worldBookText && wi && typeof wi === 'object') worldBookText = [wi.worldInfoBefore, wi.worldInfoAfter].filter(Boolean).join('\n');
            }
        } catch {}
        const userPersona = getUserPersona();
        return {
            cardDesc: char.description ?? '',
            cardPersonality: char.personality ?? '',
            cardScenario: char.scenario ?? '',
            cardFirstMes: char.first_mes ?? '',
            cardMesExample: char.mes_example ?? '',
            mainChatText, worldBookText,
            userName: userPersona.name,
            userDesc: userPersona.description,
        };
    }

    function bindIsland(el, handle) {
        let isDragging = false, startX, startY, startTX = 0, startTY = 0, moved = false;
        const getCoord = (e) => e.touches ? { x: e.touches[0].clientX, y: e.touches[0].clientY } : { x: e.clientX, y: e.clientY };
        const getT = () => { const m = (el.style.transform || '').match(/translate\(\s*([-\d.]+)px\s*,\s*([-\d.]+)px/); return m ? { x: parseFloat(m[1]), y: parseFloat(m[2]) } : { x: 0, y: 0 }; };
        const onStart = (e) => {
            if (e.target.tagName === 'BUTTON') return;
            isDragging = true; moved = false;
            const coords = getCoord(e); startX = coords.x; startY = coords.y;
            const t = getT(); startTX = t.x; startTY = t.y;
            el.style.transition = 'none'; if (e.cancelable) e.preventDefault();
        };
        const onMove = (e) => {
            if (!isDragging) return;
            const coords = getCoord(e), dx = coords.x - startX, dy = coords.y - startY;
            if (!moved && Math.abs(dx) < 5 && Math.abs(dy) < 5) return;
            moved = true; if (e.cancelable) e.preventDefault();
            el.style.setProperty('transform', `translate(${startTX + dx}px, ${startTY + dy}px)`, 'important');
        };
        const onEnd = () => { if (!isDragging) return; isDragging = false; el.style.transition = '.35s cubic-bezier(.18,.89,.32,1.2)'; if (!moved) window.__pmToggleMin(); };
        handle.addEventListener('mousedown', onStart); window.addEventListener('mousemove', onMove); window.addEventListener('mouseup', onEnd);
        handle.addEventListener('touchstart', onStart, { passive: false }); window.addEventListener('touchmove', onMove, { passive: false }); window.addEventListener('touchend', onEnd);
    }

    // ✅ HTML 实体编码（防 XSS，含单引号转义）
    function escapeHtml(s) {
        return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }
    function escapeAttr(s) {
        return (s || '')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;')
            .replace(/</g, '&lt;')
            .replace(/&/g, '&amp;');
    }

    function resolveGroupColor(name) {
        if (!name) return null;
        if (groupColorMap[name]) return groupColorMap[name];
        const lower = name.toLowerCase();
        for (const [k, v] of Object.entries(groupColorMap)) {
            if (k.toLowerCase() === lower) return v;
        }
        const idx = groupMembers.findIndex(n => n.toLowerCase() === lower);
        if (idx >= 0) return GROUP_COLORS[idx % GROUP_COLORS.length];
        return null;
    }

    function createBubbles(text, side, senderName) {
        const results = [];
        const re = new RegExp(SPECIAL_RE.source, 'gi');
        let last = 0, m;
        const gc = senderName && side === 'left' ? resolveGroupColor(senderName) : null;
        const pushPlain = (str) => {
            const plain = str.trim(); if (!plain) return;
            if (senderName && side === 'left') {
                const wrapper = document.createElement('div'); wrapper.className = 'pm-group-bubble-wrap';
                const nameTag = document.createElement('div'); nameTag.className = 'pm-group-name'; nameTag.textContent = senderName;
                if (gc) nameTag.style.color = gc.bg;
                wrapper.appendChild(nameTag);
                const inner = document.createElement('div'); inner.className = `pm-bubble pm-${side}`;
                if (gc) {
                    inner.style.setProperty('background', gc.bg, 'important');
                    inner.style.setProperty('color', gc.text, 'important');
                }
                inner.innerHTML = escapeHtml(plain).replace(/\n/g, '<br>');
                wrapper.appendChild(inner); results.push(wrapper); return;
            }
            const b = document.createElement('div'); b.className = `pm-bubble pm-${side}`;
            b.innerHTML = escapeHtml(plain).replace(/\n/g, '<br>');
            results.push(b);
        };
        while ((m = re.exec(text)) !== null) {
            if (m.index > last) pushPlain(text.slice(last, m.index));
            const kind = normalizeKeyword(m[1]);
            const isGroupLeft = senderName && side === 'left';
            let container;
            if (isGroupLeft) {
                container = document.createElement('div'); container.className = 'pm-group-bubble-wrap';
                const nameTag = document.createElement('div'); nameTag.className = 'pm-group-name'; nameTag.textContent = senderName;
                if (gc) nameTag.style.color = gc.bg;
                container.appendChild(nameTag);
            }
            const b = document.createElement('div'); b.className = `pm-bubble pm-${side} pm-special`;
            if (kind === '转账') {
                const amount = parseFloat(m[2]) || 0;
                b.innerHTML = `<div class="pm-transfer-card"><div class="pm-t-icon">¥</div><div class="pm-t-info"><b>转账</b><span>¥${amount.toFixed(2)}</span></div></div>`;
            } else if (kind === '收款') {
                const amount = parseFloat(m[2]) || 0;
                b.innerHTML = `<div class="pm-receive-card"><div class="pm-t-icon">¥</div><div class="pm-t-info"><b>收款</b><span>¥${amount.toFixed(2)}</span></div></div>`;
            } else if (kind === '图片') {
                b.innerHTML = `<div class="pm-img-card">🖼️ ${escapeHtml(m[2].trim())}</div>`;
            } else {
                const txt = m[2].trim(), len = [...txt].length;
                let dur;
                if (len <= 5) dur = Math.max(1, len);
                else if (len <= 15) dur = 5 + (len - 5);
                else if (len <= 40) dur = 15 + Math.ceil((len - 15) * 0.8);
                else dur = Math.min(VOICE_MAX_SEC, 35 + Math.ceil((len - 40) * 0.5));
                const width = Math.min(240, Math.max(110, 90 + Math.min(len, 30) * 4));
                let voiceStyle = `width:${width}px`, voiceClass = `pm-voice-card pm-voice-${side}`;
                if (isGroupLeft && gc) {
                    voiceStyle = `width:${width}px;background:${gc.bg} !important;color:${gc.text} !important;`;
                    voiceClass = 'pm-voice-card pm-voice-left pm-voice-group';
                }
                b.innerHTML = `<div class="pm-voice-wrap"><div class="${voiceClass}" style="${voiceStyle}" onclick="window.__pmToggleVoice(this)"><span class="pm-voice-icon">🎤</span><span class="pm-voice-wave"><i></i><i></i><i></i></span><span class="pm-voice-dur">${dur}"</span></div><div class="pm-voice-text" style="display:none;">${escapeHtml(txt)}</div></div>`;
            }
            if (container) { container.appendChild(b); results.push(container); }
            else results.push(b);
            last = m.index + m[0].length;
        }
        if (last < text.length) pushPlain(text.slice(last));
        if (!results.length) pushPlain(text);
        return results;
    }

    window.__pmToggleVoice = (el) => {
        const txt = el.parentElement?.querySelector('.pm-voice-text');
        if (txt) txt.style.display = txt.style.display === 'none' ? 'block' : 'none';
    };

    function cleanResponse(raw) {
        return (raw ?? '')
            .replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/<thinking>[\s\S]*?<\/thinking>/gi, '')
            .replace(/<reasoning>[\s\S]*?<\/reasoning>/gi, '').replace(/<reflection>[\s\S]*?<\/reflection>/gi, '')
            .replace(/<inner_thought>[\s\S]*?<\/inner_thought>/gi, '')
            .replace(/<scene>[\s\S]*?<\/scene>/gi, '').replace(/<narration>[\s\S]*?<\/narration>/gi, '')
            .replace(/<action>[\s\S]*?<\/action>/gi, '').replace(/```[\s\S]*?```/g, '')
            .replace(/^.*【[^】]{2,}】.*$/gm, '').replace(/---+[\s\S]*$/g, '')
            .replace(/<[^>]+>/g, '').trim();
    }

    function splitToSentences(str, stripFn = null) {
        const protect = (str || '').replace(/[\(（][^)）]*[\)\）]/g, m => m.replace(/\//g, '\u0001'));
        return protect.split(/\s*\/\s*/).map(s => {
            let t = s.replace(/\u0001/g, '/').trim();
            if (stripFn) t = stripFn(t);
            if (!t || t === ')' || t === '）' || t === '(' || t === '（') return '';
            const opens = (t.match(/[（(]/g) || []).length;
            const closes = (t.match(/[）)]/g) || []).length;
            if (opens > closes) {
                t += '）'.repeat(opens - closes);
            } else if (closes > opens && opens === 0) {
                t = t.replace(/^[)）]+\s*/, '').replace(/\s*[)）]+$/, '');
            }
            return t;
        }).filter(Boolean).slice(0, 8);
    }

    function parseGroupResponse(raw) {
        let cleaned = cleanResponse(raw);
        const lines = cleaned.split('\n').map(l => l.trim()).filter(Boolean);
        const result = [];
        const normName = (s) => (s || '').trim().replace(/^[【\[\(（*「『"'\s]+|[】\]\)）*「』」"'\s]+$/g, '').trim().toLowerCase();
        const memberMap = new Map();
        groupMembers.forEach(n => memberMap.set(normName(n), n));
        const speakerRe = /^[\s\*【\[「『"'（\(]*(.{1,20}?)[\s\*】\]」』"'）\)]*\s*[：:]\s*([\s\S]+)$/;

        const stripAllPrefix = (s) => {
            let t = (s || '').trim();
            const outer = t.match(/^[\(（]\s*(.{1,20}?)\s*[：:]\s*([\s\S]+?)\s*[\)）]\s*$/);
            if (outer && memberMap.has(normName(outer[1]))) {
                t = outer[2].trim();
            } else {
                for (let i = 0; i < 3; i++) {
                    const m = t.match(speakerRe);
                    if (m && memberMap.has(normName(m[1]))) t = m[2].trim();
                    else break;
                }
            }
            return t;
        };

        for (const line of lines) {
            const m = line.match(speakerRe);
            if (m && memberMap.has(normName(m[1]))) {
                const name = memberMap.get(normName(m[1]));
                const sentences = splitToSentences(m[2], stripAllPrefix);
                if (sentences.length) result.push({ name, sentences });
            } else {
                const sentences = splitToSentences(line, stripAllPrefix);
                if (sentences.length) {
                    if (result.length > 0) result[result.length - 1].sentences.push(...sentences);
                    else result.push({ name: groupMembers[0] || '???', sentences });
                }
            }
        }
        return result;
    }

    // ========== 统一 AI 调用（支持主API和独立API） ==========
    async function callAI(systemPrompt, userPrompt, options = {}) {
        const cfg = window.__pmConfig;
        const useIndep = cfg.useIndependent && cfg.apiUrl && cfg.apiKey;
        const maxTokens = options.maxTokens || (isGroupChat ? 600 : 300);

        if (useIndep) {
            const { chatUrl } = normalizeApiUrls(cfg.apiUrl);
            const messages = [];
            if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
            messages.push({ role: 'user', content: userPrompt });
            const resp = await fetch(chatUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${cfg.apiKey}` },
                body: JSON.stringify({
                    model: cfg.model || 'gpt-4o-mini',
                    messages,
                    max_tokens: maxTokens,
                    temperature: 1.2,
                    top_p: 0.95,
                    frequency_penalty: 0.3,
                    presence_penalty: 0.3,
                })
            });
            if (!resp.ok) {
                const errText = await resp.text().catch(() => '');
                throw new Error(`HTTP ${resp.status}: ${errText.slice(0, 120)}`);
            }
            const json = await resp.json();
            return json.choices?.[0]?.message?.content ?? '';
        } else {
            const c = getCtx();
            if (!c) throw new Error('无上下文');
            return await c.generateQuietPrompt(userPrompt, false, false);
        }
    }

    async function fetchSMS(userMsg) {
        const c = getCtx();
        conversationHistory.push({ role: 'user', content: userMsg });
        const ctxData = await gatherContext();
        const { cardDesc, cardPersonality, cardScenario, cardFirstMes, cardMesExample, mainChatText, worldBookText, userName, userDesc } = ctxData;

        const smsHistoryText = conversationHistory.slice(-CONTEXT_LIMIT).map(m => {
            const clean = cleanResponse(m.content);
            return m.role === 'user' ? `${userName}：${clean}` : (isGroupChat ? clean : `${currentPersona}：${clean}`);
        }).join('\n');

        const userBlock = [
            `用户名字：${userName}`,
            userDesc ? `用户人设：${userDesc}` : ''
        ].filter(Boolean).join('\n');

        let injectedInstruction, systemPrompt;

        if (isGroupChat) {
            const memberList = groupMembers.join('、');
            const groupName = groupDisplayName || `群聊：${memberList}`;
            const groupRules = `
[群聊短信模式——最高优先级]
群聊名称：${groupName}
群聊成员：${memberList}
你同时扮演以上所有角色与用户（${userName}）聊天。

⚠️ 输出必须满足以下全部条件，违反即视为无效：
1. 每一行都必须以 "角色名：" 开头（角色名必须来自：${memberList}）
2. 严禁输出对界面、系统、对话本身的总结或描述性文字
3. 严禁输出类似"现在应该..."、"我已经..."、"看起来..."这类叙述性句子
4. 特殊格式必须在同一行内完整写出且闭合：(转账+金额) (收款+金额) (图片+描述) (语音+内容)
5. 特殊格式括号内严禁换行、编号（1. 2. 3.）、列表
6. 每条消息内的 / 只用于分隔同一角色的多条短信
7. 每个角色根据自己的人设和当前剧情主动决定发言条数，0-8句，可穿插发言，不必所有人都说话
8. 严禁英文格式 (Voice+/Image+/Transfer+)

✅ 正确示例：
小明：我先到了 / 这家店真不错
小红：等我五分钟 / (语音+马上到别急)
小明：好 / (图片+刚拍的店门口)

❌ 错误示例（绝对禁止）：
小明：(语音+内容有换行
1. 第一点)
小红：界面现在应该正常了...`;
            injectedInstruction = `${groupRules}

【用户信息】
${userBlock}

${cardScenario ? '【场景】\n' + cardScenario + '\n\n' : ''}${worldBookText ? '【世界书】\n' + worldBookText + '\n\n' : ''}群聊历史：
${smsHistoryText}

${userName}：${userMsg}`;
            systemPrompt = [
                `你同时扮演 ${memberList} 在群聊「${groupName}」中与用户 ${userName} 对话。`,
                `【用户信息】\n${userBlock}`,
                cardDesc ? `【角色设定】\n${cardDesc}` : '',
                cardPersonality ? `【性格】\n${cardPersonality}` : '',
                cardScenario ? `【场景】\n${cardScenario}` : '',
                worldBookText ? `【世界书】\n${worldBookText}` : '',
                mainChatText ? `【主线最近对话】\n${mainChatText}` : '',
                '',
                `输出格式：角色名：消息 / 消息（每个角色0-8句，根据人设和剧情决定是否发言及发言数量）`,
                `角色名后只跟该角色的话，严禁 "(角色名：xxx)" 这种嵌套。`,
                `角色可穿插发言，不必所有人都说话。`,
                '特殊格式（必须中文且单行闭合）：(转账+金额) (收款+金额) (图片+描述) (语音+内容)。',
                '禁止任何标签格式旁白选项状态栏。',
            ].filter(Boolean).join('\n\n');
        } else {
            const contextBlockMain = [
                cardScenario ? `【场景参考】\n${cardScenario}` : '',
                cardMesExample ? `【对话示例】\n${cardMesExample}` : '',
            ].filter(Boolean).join('\n\n');
            injectedInstruction = `
[短信模式指令——最高优先级]
当前角色：${currentPersona}
以${currentPersona}的身份用手机短信方式回复正在与你聊天的用户 ${userName}。

【用户信息】
${userBlock}

${contextBlockMain ? contextBlockMain + '\n\n' : ''}规则：
- 只输出短信文字，3到8句，每句用 / 分隔
- 禁止旁白心理描写场景描述角色名前缀标签格式
- 特殊格式（中文单行闭合）：(转账+金额) (收款+金额) (图片+描述) (语音+内容)
- 严禁英文格式

短信对话历史：
${smsHistoryText}

${userName}：${userMsg}
${currentPersona}：`;
            systemPrompt = [
                `你正在扮演"${currentPersona}"通过手机短信与用户 ${userName} 聊天。`,
                `【用户信息】\n${userBlock}`,
                cardDesc ? `【角色设定】\n${cardDesc}` : '',
                cardPersonality ? `【性格】\n${cardPersonality}` : '',
                cardScenario ? `【场景】\n${cardScenario}` : '',
                cardFirstMes ? `【开场白参考】\n${cardFirstMes}` : '',
                cardMesExample ? `【对话示例】\n${cardMesExample}` : '',
                worldBookText ? `【世界书】\n${worldBookText}` : '',
                mainChatText ? `【主线最近对话】\n${mainChatText}` : '',
                '',
                '只输出3到8句短信，每句用 / 分隔，不得中途截断。',
                '特殊格式（必须中文单行闭合）：(转账+金额) (收款+金额) (图片+描述) (语音+内容)。',
                '禁止任何标签格式旁白选项状态栏。',
            ].filter(Boolean).join('\n\n');
        }

        try {
            const cfg = window.__pmConfig;
            const useIndep = cfg.useIndependent && cfg.apiUrl && cfg.apiKey;
            let raw = '';

            if (useIndep) {
                raw = await callAI(systemPrompt, injectedInstruction, { maxTokens: isGroupChat ? 600 : 300 });
            } else {
                raw = await callAI('', injectedInstruction, { maxTokens: isGroupChat ? 600 : 300 });
            }

            let resultData;
            if (isGroupChat) {
                const parsed = parseGroupResponse(raw);
                if (parsed.length) {
                    const contentParts = parsed.map(p => `${p.name}：${p.sentences.join(' / ')}`);
                    conversationHistory.push({ role: 'assistant', content: contentParts.join('\n') });
                    resultData = { type: 'group', data: parsed };
                } else {
                    conversationHistory.push({ role: 'assistant', content: raw });
                    resultData = { type: 'group', data: [{ name: groupMembers[0] || '???', sentences: ['（群聊格式解析失败）'] }] };
                }
            } else {
                const clean = cleanResponse(raw);
                let sentences = splitToSentences(clean);
                if (!sentences.length && raw?.trim()) sentences = splitToSentences(raw.replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/<[^>]+>/g, ''));
                if (!sentences.length) sentences = !raw?.trim() ? ['（空响应）'] : ['（格式无法解析）'];
                conversationHistory.push({ role: 'assistant', content: sentences.join(' / ') });
                resultData = { type: 'single', data: sentences };
            }

            const id = getStorageId();
            if (!window.__pmHistories[id]) window.__pmHistories[id] = {};
            window.__pmHistories[id][currentPersona] = conversationHistory.slice(-SAVE_LIMIT);
            saveHistories();
            applyBidirectionalInjection();
            return resultData;
        } catch (e) {
            console.error('[phone-mode]', e);
            return isGroupChat
                ? { type: 'group', data: [{ name: '系统', sentences: [`（错误：${e?.message || e}）`] }] }
                : { type: 'single', data: [`（错误：${e?.message || e}）`] };
        }
    }

    function addBubble(text, side, senderName) {
        const list = phoneWindow?.querySelector('.pm-msg-list'); if (!list) return;
        createBubbles(text, side, senderName).forEach(b => {
            if (b.classList?.contains('pm-bubble')) { b.dataset.side = side; b.dataset.text = text; }
            else if (b.classList?.contains('pm-group-bubble-wrap')) {
                b.dataset.side = side; b.dataset.text = text;
                const inner = b.querySelector('.pm-bubble'); if (inner) { inner.dataset.side = side; inner.dataset.text = text; }
            }
            list.appendChild(b);
        });
        list.scrollTop = list.scrollHeight;
    }
    function addNote(text) {
        const list = phoneWindow?.querySelector('.pm-msg-list'); if (!list) return;
        const n = document.createElement('div'); n.className = 'pm-note'; n.textContent = text;
        list.appendChild(n); list.scrollTop = list.scrollHeight;
    }
    function showTyping() {
        const list = phoneWindow?.querySelector('.pm-msg-list');
        if (!list || document.getElementById('pm-typing')) return;
        const t = document.createElement('div'); t.id = 'pm-typing'; t.className = 'pm-bubble pm-left pm-typing-bubble';
        t.innerHTML = '<span></span><span></span><span></span>';
        list.appendChild(t); list.scrollTop = list.scrollHeight;
    }
    function hideTyping() { document.getElementById('pm-typing')?.remove(); }

    window.__pmSend = async () => {
        if (isGenerating) return;
        const input = phoneWindow.querySelector('.pm-input');
        const val = input.value.trim(); if (!val) return; input.value = '';
        const protect = val.replace(/[\(（][^)）]+[\)\）]/g, m => m.replace(/\//g, '\u0001'));
        protect.split(/[/／]/).map(s => s.replace(/\u0001/g, '/').trim()).filter(Boolean)
            .forEach(chunk => addBubble(chunk, 'right'));
        isGenerating = true; input.disabled = true;
        const btn = phoneWindow.querySelector('.pm-up-btn'); if (btn) btn.disabled = true;
        showTyping();
        const result = await fetchSMS(val);
        hideTyping();
        if (result.type === 'group') {
            for (const block of result.data) {
                for (const s of block.sentences) {
                    await new Promise(r => setTimeout(r, 120));
                    addBubble(s, 'left', block.name);
                }
            }
        } else {
            for (const s of result.data) { await new Promise(r => setTimeout(r, 150)); addBubble(s, 'left'); }
        }
        isGenerating = false; input.disabled = false; if (btn) btn.disabled = false; input.focus();

        // 自动发消息：递增计数器
        setTimeout(() => {
            if (!isGenerating && typeof window.__pmIncrementCounters === 'function') {
                window.__pmIncrementCounters();
            }
        }, 300);
    };

    
    // ========== 全局计数器推进（支持主楼触发） ==========
    window.__pmIncrementCounters = () => {
        const id = getStorageId();
        const configs = window.__pmPokeConfig[id];
        if (!configs) return;

        let updated = false;
        const toPoke = [];

        for (const [contact, config] of Object.entries(configs)) {
            if (config?.autoPoke?.enabled) {
                config.autoPoke.counter = (config.autoPoke.counter || 0) + 1;
                updated = true;
                if (config.autoPoke.counter >= config.autoPoke.interval) {
                    config.autoPoke.counter = 0;
                    toPoke.push(contact);
                }
            }
        }

        if (updated) {
            savePokeConfig();
            // 实时更新当前正开着的设置面板上的数字
            const counterEl = document.getElementById('pm-poke-counter');
            if (counterEl && configs[currentPersona]) counterEl.textContent = configs[currentPersona].autoPoke.counter;
            const groupCounterEl = document.getElementById('pm-poke-counter-group');
            if (groupCounterEl && currentGroupKey && configs[currentGroupKey]) groupCounterEl.textContent = configs[currentGroupKey].autoPoke.counter;
        }

        if (toPoke.length > 0) {
            (async () => {
                for (const contact of toPoke) { await window.__pmAutoPoke(contact); }
            })();
        }
    };

    // ========== 自动发消息（支持纯后台运行，不乱弹气泡） ==========
    window.__pmAutoPoke = async (contactName) => {
        if (isGenerating) return;
        isGenerating = true;

        const id = getStorageId();
        const groupMeta = window.__pmGroupMeta[id]?.[contactName];
        const isGroup = !!groupMeta;
        
        // 判断当前用户是否正盯着这个联系人的手机界面看
        const isActiveView = phoneActive && ((isGroup && currentGroupKey === contactName) || (!isGroup && currentPersona === contactName));
        
        if (isActiveView) {
            const input = phoneWindow?.querySelector('.pm-input');
            const btn = phoneWindow?.querySelector('.pm-up-btn');
            if (input) input.disabled = true;
            if (btn) btn.disabled = true;
            showTyping();
        }

        const ctxData = await gatherContext();
        const { cardDesc, cardPersonality, cardScenario, cardMesExample, mainChatText, worldBookText, userName, userDesc } = ctxData;

        const userBlock = [`用户名字：${userName}`, userDesc ? `用户人设：${userDesc}` : ''].filter(Boolean).join('\n');

        const systemPrompt = isGroup ? `你同时扮演群聊中的所有成员。` : `你正在扮演"${contactName}"通过手机短信与用户 ${userName} 聊天。`;
        const userPrompt = isGroup
            ? `群聊名称：${groupMeta.name}\n群聊成员：${groupMeta.members.join('、')}\n\n用户有一段时间没有说话。请以所有群成员的身份，根据各自的性格、人设和当前聊天上下文，自然地发起话题或继续聊天。每个成员根据人设决定发言 0-8 句。\n\n输出格式：角色名：消息 / 消息\n\n【用户信息】\n${userBlock}\n\n【角色设定】\n${cardDesc || ''}\n\n【性格】\n${cardPersonality || ''}\n\n【场景】\n${cardScenario || ''}\n\n【世界书】\n${worldBookText || ''}\n\n【主线最近对话】\n${mainChatText || ''}`
            : `用户有一段时间没有回复。作为${contactName}，根据你的人设和当前聊天情境，自然地发送 3-8 句短信继续对话或发起新话题，不要提及用户没有回复这件事。\n\n【用户信息】\n${userBlock}\n\n【角色设定】\n${cardDesc || ''}\n\n【性格】\n${cardPersonality || ''}\n\n【场景】\n${cardScenario || ''}\n\n【对话示例】\n${cardMesExample || ''}\n\n【世界书】\n${worldBookText || ''}\n\n【主线最近对话】\n${mainChatText || ''}\n\n输出格式：短信内容 / 短信内容（每句用 / 分隔，特殊格式中文单行闭合）`;

        try {
            const raw = await callAI(systemPrompt, userPrompt);
            let historyUpdated = false;
            let targetHistory = window.__pmHistories[id]?.[contactName] || [];

            if (isActiveView) hideTyping();

            if (isGroup) {
                // 后台解析时临时覆盖成员列表，加入安全保护
                const oldMembers = groupMembers;
                let parsed = [];
                try {
                    groupMembers = groupMeta.members;
                    parsed = parseGroupResponse(raw);
                } finally {
                    // 无论解析成功还是报错，必定将成员列表恢复，防止状态污染
                    groupMembers = oldMembers;
                }

                const contentParts = [];
                for (const block of parsed) {
                    if (block.sentences.length > 0) {
                        contentParts.push(`${block.name}：${block.sentences.join(' / ')}`);
                        if (isActiveView) {
                            for (const s of block.sentences) { await new Promise(r => setTimeout(r, 120)); addBubble(s, 'left', block.name); }
                        }
                    }
                }
                if (contentParts.length > 0) {
                    targetHistory.push({ role: 'assistant', content: contentParts.join('\n') });
                    historyUpdated = true;
                }
            } else {
                const clean = cleanResponse(raw);
                const sentences = splitToSentences(clean);
                if (sentences.length > 0) {
                    targetHistory.push({ role: 'assistant', content: sentences.join(' / ') });
                    historyUpdated = true;
                    if (isActiveView) {
                        for (const s of sentences) { await new Promise(r => setTimeout(r, 150)); addBubble(s, 'left'); }
                    }
                }
            }

            if (historyUpdated) {
                if (!window.__pmHistories[id]) window.__pmHistories[id] = {};
                window.__pmHistories[id][contactName] = targetHistory.slice(-SAVE_LIMIT);
                saveHistories(); applyBidirectionalInjection();
                
                // 如果用户没在看着这个界面，给一条提示
                if (phoneActive && !isActiveView) {
                    addNote(`📩 ${isGroup ? groupMeta.name : contactName} 发来了新消息`);
                }
            }
        } catch (e) {
            if (isActiveView) hideTyping();
            console.error('[phone-mode] 自动发消息失败', e);
        }

        if (isActiveView) {
            const input = phoneWindow?.querySelector('.pm-input'); const btn = phoneWindow?.querySelector('.pm-up-btn');
            if (input) input.disabled = false; if (btn) btn.disabled = false;
        }
        isGenerating = false;
    };

    // ========== 拍一拍 & 联系人设置 ==========
    function showContactConfig(contactName) {
        const id = getStorageId();
        const config = window.__pmPokeConfig[id]?.[contactName] || {
            autoPoke: { enabled: false, interval: 3, counter: 0 }
        };

        makeOverlay(`
    <div class="pm-modal pm-modal-wide">
    <div class="pm-modal-header">
        <b>${escapeHtml(contactName)} 设置</b>
        <span onclick="window.__pmSaveAndCloseContactConfig('${escapeAttr(contactName)}')" class="pm-modal-close">✕</span>
    </div>
    <div style="padding:16px;display:flex;flex-direction:column;gap:16px;">

        <div>
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
            <span style="font-size:13px;font-weight:600;">⏰ 自动发消息</span>
            <div onclick="window.__pmToggleAutoPoke('${escapeAttr(contactName)}')"
                class="pm-custom-check pm-bi-style ${config.autoPoke.enabled ? 'is-checked' : ''}"
                id="pm-poke-check"
                style="cursor:pointer;width:22px;height:22px;min-width:22px;min-height:22px;flex-shrink:0;border-radius:50%;">
            </div>
        </div>
        <div style="display:flex;align-items:center;gap:8px;">
            <span style="font-size:12px;color:#888;">每隔</span>
            <input id="pm-poke-interval" type="number" min="1" max="99"
                value="${config.autoPoke.interval}"
                style="width:50px;border:1px solid #ddd;border-radius:6px;padding:4px 8px;font-size:13px;text-align:center;"
                ${!config.autoPoke.enabled ? 'disabled' : ''}>
            <span style="font-size:12px;color:#888;">轮无输入主动发消息</span>
        </div>
        <div style="font-size:11px;color:#999;margin-top:4px;">
            当前计数：<span id="pm-poke-counter">${config.autoPoke.counter}</span> / ${config.autoPoke.interval}
        </div>
        </div>

        <div style="margin-top:4px;">
        <button onclick="window.__pmPoke('${escapeAttr(contactName)}')"
                style="width:100%;background:linear-gradient(135deg,#ff9500,#ff6b00);color:#fff;border:none;border-radius:12px;padding:14px;font-size:14px;cursor:pointer;font-weight:600;display:flex;align-items:center;justify-content:center;">
            拍一拍
        </button>
        </div>

    </div>
    </div>`);
    }

    window.__pmSaveAndCloseContactConfig = (contactName) => {
        const checkEl = document.getElementById('pm-poke-check');
        const intervalEl = document.getElementById('pm-poke-interval');

        if (checkEl && intervalEl) {
            const id = getStorageId();
            if (!window.__pmPokeConfig[id]) window.__pmPokeConfig[id] = {};

            const enabled = checkEl.classList.contains('is-checked');
            const interval = parseInt(intervalEl.value) || 3;
            const oldCounter = window.__pmPokeConfig[id][contactName]?.autoPoke?.counter || 0;

            window.__pmPokeConfig[id][contactName] = {
                autoPoke: {
                    enabled,
                    interval: Math.max(1, Math.min(99, interval)),
                    counter: enabled ? Math.min(oldCounter, interval - 1) : oldCounter
                }
            };

            savePokeConfig();
        }

        document.getElementById('pm-overlay')?.remove();
        addNote(`已保存 ${contactName} 的设置`);
    };

    window.__pmToggleAutoPoke = (contactName) => {
        const checkEl = document.getElementById('pm-poke-check');
        const intervalEl = document.getElementById('pm-poke-interval');

        if (!checkEl) return;

        const isChecked = checkEl.classList.toggle('is-checked');
        if (intervalEl) intervalEl.disabled = !isChecked;
    };

    window.__pmPoke = async (contactName) => {
        const id = getStorageId();
        if (window.__pmPokeConfig[id]?.[contactName]) {
            window.__pmPokeConfig[id][contactName].autoPoke.counter = 0;
            savePokeConfig();
        }

        document.getElementById('pm-overlay')?.remove();

        if (currentPersona !== contactName) {
            window.__pmSwitchContact(contactName);
        }

        if (isGenerating) return;
        isGenerating = true;

        // 禁用输入框和发送按钮
        const input = phoneWindow?.querySelector('.pm-input');
        const btn = phoneWindow?.querySelector('.pm-up-btn');
        if (input) input.disabled = true;
        if (btn) btn.disabled = true;

        // 显示等待气泡
        showTyping();

        const ctxData = await gatherContext();
        const { cardDesc, cardPersonality, cardScenario, cardMesExample, mainChatText, worldBookText, userName, userDesc } = ctxData;

        const userBlock = [
            `用户名字：${userName}`,
            userDesc ? `用户人设：${userDesc}` : ''
        ].filter(Boolean).join('\n');

        const systemPrompt = isGroupChat
            ? `你同时扮演群聊中的所有成员。`
            : `你正在扮演"${contactName}"通过手机短信与用户 ${userName} 聊天。`;

        const userPrompt = isGroupChat
            ? `群聊名称：${groupDisplayName || '群聊'}\n群聊成员：${groupMembers.join('、')}\n\n请以所有群成员的身份，根据各自的性格和当前聊天上下文，自然地发起话题或继续聊天。每个成员根据人设决定发言 0-8 句。\n\n输出格式：角色名：消息内容 / 消息内容\n\n【用户信息】\n${userBlock}\n\n【角色设定】\n${cardDesc || ''}\n\n【性格】\n${cardPersonality || ''}\n\n【场景】\n${cardScenario || ''}\n\n【世界书】\n${worldBookText || ''}\n\n【主线最近对话】\n${mainChatText || ''}`
            : `作为${contactName}，根据你的人设、性格和当前聊天情境，自然地发送 3-8 句短信，不要提及任何外部触发，就像你自己突然想发消息一样。\n\n【用户信息】\n${userBlock}\n\n【角色设定】\n${cardDesc || ''}\n\n【性格】\n${cardPersonality || ''}\n\n【场景】\n${cardScenario || ''}\n\n【对话示例】\n${cardMesExample || ''}\n\n【世界书】\n${worldBookText || ''}\n\n【主线最近对话】\n${mainChatText || ''}\n\n输出格式：短信内容 / 短信内容（每句用 / 分隔，特殊格式中文单行闭合）`;

        try {
            const raw = await callAI(systemPrompt, userPrompt);
            let historyUpdated = false; // 👇 新增标记

            // 隐藏等待气泡
            hideTyping();

            if (isGroupChat) {
                const parsed = parseGroupResponse(raw);
                const contentParts = [];
                for (const block of parsed) {
                    if (block.sentences.length > 0) {
                        contentParts.push(`${block.name}：${block.sentences.join(' / ')}`);
                        for (const s of block.sentences) {
                            await new Promise(r => setTimeout(r, 120));
                            addBubble(s, 'left', block.name);
                        }
                    }
                }
                if (contentParts.length > 0) {
                    conversationHistory.push({ role: 'assistant', content: contentParts.join('\n') });
                    historyUpdated = true;
                }
            } else {
                const clean = cleanResponse(raw);
                const sentences = splitToSentences(clean);
                if (sentences.length > 0) {
                    conversationHistory.push({ role: 'assistant', content: sentences.join(' / ') });
                    historyUpdated = true;
                    for (const s of sentences) {
                        await new Promise(r => setTimeout(r, 150));
                        addBubble(s, 'left');
                    }
                }
            }

            // 👇 新增：更新本地缓存与双向注入
            if (historyUpdated) {
                const id = getStorageId();
                if (!window.__pmHistories[id]) window.__pmHistories[id] = {};
                window.__pmHistories[id][currentPersona] = conversationHistory.slice(-SAVE_LIMIT);
                saveHistories();
                applyBidirectionalInjection();
            }
        } catch (e) {
            hideTyping();
            addNote(`（发送失败：${e?.message || e}）`);
        }

        // 恢复输入框
        if (input) input.disabled = false;
        if (btn) btn.disabled = false;
        isGenerating = false;
    };

    window.__pmEditGroup = () => {
        if (!isGroupChat) {
            showContactConfig(currentPersona);
        } else {
            showGroupForm('edit', groupDisplayName, groupMembers);
        }
    };

    // ========== 群聊配置弹窗 ==========
    function showGroupForm(mode, existingName, existingMembers) {
        document.getElementById('pm-overlay')?.remove();
        const title = mode === 'create' ? '新建群聊' : '编辑群聊';
        const initName = existingName || '';
        const initMembers = (existingMembers || []).join(' / ');
        const closeAction = mode === 'create'
            ? "window.__pmShowList()"
            : "window.__pmSaveAndCloseGroupEdit()";

        let pokeConfig = { enabled: false, interval: 3, counter: 0 };
        if (mode === 'edit' && currentGroupKey) {
            const id = getStorageId();
            pokeConfig = window.__pmPokeConfig[id]?.[currentGroupKey]?.autoPoke || pokeConfig;
        }

        makeOverlay(`
    <div class="pm-modal pm-modal-wide">
    <div class="pm-modal-header"><b>${title}</b><span onclick="${closeAction}" class="pm-modal-close">✕</span></div>
    <div style="padding:14px 16px;display:flex;flex-direction:column;gap:10px;">
        <div class="pm-cfg-label">群聊名称</div>
        <input id="pm-group-name-input" class="pm-cfg-input" placeholder="给群聊起个名字" value="${escapeAttr(initName)}" maxlength="30">
        <div class="pm-cfg-label" style="margin-top:4px;">成员（用 / 分隔）</div>
        <input id="pm-group-input" class="pm-cfg-input" placeholder="角色A / 角色B / 角色C" oninput="window.__pmGroupInputChanged()" value="${escapeAttr(initMembers)}">
        <div id="pm-group-counter" class="pm-cfg-tip" style="text-align:left;font-weight:600;">0/${MAX_GROUP_MEMBERS - 1} 个角色</div>
        <div id="pm-group-preview" style="display:flex;flex-wrap:wrap;gap:4px;"></div>

        ${mode === 'edit' ? `
        <div style="margin-top:6px;padding-top:16px;border-top:1px solid #f0f0f0;">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
            <span style="font-size:13px;font-weight:600;">⏰ 自动发消息</span>
            <div onclick="window.__pmToggleAutoPokeGroup()"
                class="pm-custom-check pm-bi-style ${pokeConfig.enabled ? 'is-checked' : ''}"
                id="pm-poke-check-group"
                style="cursor:pointer;width:22px;height:22px;min-width:22px;min-height:22px;flex-shrink:0;border-radius:50%;">
            </div>
        </div>
        <div style="display:flex;align-items:center;gap:8px;">
            <span style="font-size:12px;color:#888;">每隔</span>
            <input id="pm-poke-interval-group" type="number" min="1" max="99"
                value="${pokeConfig.interval}"
                style="width:50px;border:1px solid #ddd;border-radius:6px;padding:4px 8px;font-size:13px;text-align:center;"
                ${!pokeConfig.enabled ? 'disabled' : ''}>
            <span style="font-size:12px;color:#888;">轮无输入主动发消息</span>
        </div>
        <div style="font-size:11px;color:#999;margin-top:4px;">
            当前计数：<span id="pm-poke-counter-group">${pokeConfig.counter}</span> / ${pokeConfig.interval}
        </div>
        <div style="margin-top:12px;">
            <button onclick="window.__pmPokeGroup()"
                    style="width:100%;background:linear-gradient(135deg,#ff9500,#ff6b00);color:#fff;border:none;border-radius:12px;padding:14px;font-size:14px;cursor:pointer;font-weight:600;display:flex;align-items:center;justify-content:center;">
            拍一拍
            </button>
        </div>
        </div>
        ` : ''}
    </div>
    ${mode === 'create' ? `
    <div class="pm-modal-add">
        <button onclick="window.__pmConfirmGroup('create','')" style="flex:1;background:#007aff;color:#fff;border:none;border-radius:10px;padding:10px;font-size:13px;cursor:pointer;font-weight:600;">创建</button>
    </div>
    ` : ''}
    </div>`);
        setTimeout(() => window.__pmGroupInputChanged(), 0);
    }

    window.__pmToggleAutoPokeGroup = () => {
        const checkEl = document.getElementById('pm-poke-check-group');
        const intervalEl = document.getElementById('pm-poke-interval-group');

        if (!checkEl) return;

        const isChecked = checkEl.classList.toggle('is-checked');
        if (intervalEl) intervalEl.disabled = !isChecked;
    };

    window.__pmPokeGroup = async () => {
        if (!isGroupChat || !currentGroupKey) return;

        const id = getStorageId();
        if (window.__pmPokeConfig[id]?.[currentGroupKey]) {
            window.__pmPokeConfig[id][currentGroupKey].autoPoke.counter = 0;
            savePokeConfig();
        }

        document.getElementById('pm-overlay')?.remove();

        if (isGenerating) return;
        isGenerating = true;

        // 禁用输入框和发送按钮
        const input = phoneWindow?.querySelector('.pm-input');
        const btn = phoneWindow?.querySelector('.pm-up-btn');
        if (input) input.disabled = true;
        if (btn) btn.disabled = true;

        // 显示等待气泡
        showTyping();

        const ctxData = await gatherContext();
        const { cardDesc, cardPersonality, cardScenario, mainChatText, worldBookText, userName, userDesc } = ctxData;

        const userBlock = [
            `用户名字：${userName}`,
            userDesc ? `用户人设：${userDesc}` : ''
        ].filter(Boolean).join('\n');

        const systemPrompt = `你同时扮演群聊中的所有成员。`;
        const userPrompt = `群聊名称：${groupDisplayName || '群聊'}\n群聊成员：${groupMembers.join('、')}\n\n请以每个群成员的身份，根据各自的性格、人设和当前聊天上下文，自然地发起话题或继续聊天，不要提及任何外部触发。\n每个成员根据自己的判断选择发言 0-8 条。\n\n输出格式：角色名：消息内容 / 消息内容\n\n【用户信息】\n${userBlock}\n\n【角色设定】\n${cardDesc || ''}\n\n【性格】\n${cardPersonality || ''}\n\n【场景】\n${cardScenario || ''}\n\n【世界书】\n${worldBookText || ''}\n\n【主线最近对话】\n${mainChatText || ''}`;

        try {
            const raw = await callAI(systemPrompt, userPrompt);

            // 隐藏等待气泡
            hideTyping();

            const parsed = parseGroupResponse(raw);
            const contentParts = []; // 👇 新增：用于收集要保存的群聊内容
            
            for (const block of parsed) {
                if (block.sentences.length > 0) {
                    contentParts.push(`${block.name}：${block.sentences.join(' / ')}`);
                    for (const s of block.sentences) {
                        await new Promise(r => setTimeout(r, 120));
                        addBubble(s, 'left', block.name);
                    }
                }
            }
            
            // 👇 新增：将聊天记录正式存入数据库
            if (contentParts.length > 0) {
                conversationHistory.push({ role: 'assistant', content: contentParts.join('\n') });
                const id = getStorageId();
                if (!window.__pmHistories[id]) window.__pmHistories[id] = {};
                window.__pmHistories[id][currentPersona] = conversationHistory.slice(-SAVE_LIMIT);
                saveHistories();
                applyBidirectionalInjection();
            }
        } catch (e) {
            hideTyping();
            addNote(`（发送失败：${e?.message || e}）`);
        }

        // 恢复输入框
        if (input) input.disabled = false;
        if (btn) btn.disabled = false;
        isGenerating = false;
    };

    window.__pmSaveAndCloseGroupEdit = () => {
        const nameInput = document.getElementById('pm-group-name-input');
        const memInput = document.getElementById('pm-group-input');

        if (nameInput && memInput && currentGroupKey) {
            const groupName = nameInput.value.trim();
            const names = memInput.value.split(/[/／]/).map(s => s.trim()).filter(Boolean).slice(0, MAX_GROUP_MEMBERS - 1);

            if (groupName && names.length >= 2) {
                const id = getStorageId();
                if (!window.__pmGroupMeta[id]) window.__pmGroupMeta[id] = {};
                window.__pmGroupMeta[id][currentGroupKey] = { name: groupName, members: names };
                saveGroupMeta();

                groupMembers = names; groupDisplayName = groupName;
                groupColorMap = {};
                names.forEach((n, i) => { groupColorMap[n] = GROUP_COLORS[i % GROUP_COLORS.length]; });
            }

            const checkEl = document.getElementById('pm-poke-check-group');
            const intervalEl = document.getElementById('pm-poke-interval-group');

            if (checkEl && intervalEl) {
                const id = getStorageId();
                if (!window.__pmPokeConfig[id]) window.__pmPokeConfig[id] = {};

                const enabled = checkEl.classList.contains('is-checked');
                const interval = parseInt(intervalEl.value) || 3;
                const oldCounter = window.__pmPokeConfig[id][currentGroupKey]?.autoPoke?.counter || 0;

                window.__pmPokeConfig[id][currentGroupKey] = {
                    autoPoke: {
                        enabled,
                        interval: Math.max(1, Math.min(99, interval)),
                        counter: enabled ? Math.min(oldCounter, interval - 1) : oldCounter
                    }
                };

                savePokeConfig();
            }
        }

        document.getElementById('pm-overlay')?.remove();

        if (phoneWindow && currentGroupKey) {
            window.__pmSwitch(currentGroupKey);
        }
    };

    window.__pmShowGroupCreate = () => showGroupForm('create');

    window.__pmGroupInputChanged = () => {
        const input = document.getElementById('pm-group-input');
        const counter = document.getElementById('pm-group-counter');
        const preview = document.getElementById('pm-group-preview');
        if (!input) return;
        const names = input.value.split(/[/／]/).map(s => s.trim()).filter(Boolean);
        const max = MAX_GROUP_MEMBERS - 1;
        const count = Math.min(names.length, max);
        const over = names.length > max;
        counter.textContent = `${count}/${max} 个角色${over ? ' ⚠️ 超出上限' : ''}`;
        counter.style.color = over ? '#ff3b30' : '#b87a00';
        preview.innerHTML = names.slice(0, max).map((n, i) => {
            const gc = GROUP_COLORS[i % GROUP_COLORS.length];
            return `<span style="background:${gc.bg};color:${gc.text};padding:3px 8px;border-radius:10px;font-size:11px;">${escapeHtml(n)}</span>`;
        }).join('');
    };

    window.__pmConfirmGroup = (mode, oldName) => {
        const nameInput = document.getElementById('pm-group-name-input');
        const memInput = document.getElementById('pm-group-input');
        if (!nameInput || !memInput) return;
        const groupName = nameInput.value.trim();
        const names = memInput.value.split(/[/／]/).map(s => s.trim()).filter(Boolean).slice(0, MAX_GROUP_MEMBERS - 1);
        if (!groupName) { alert('请输入群聊名称'); return; }
        if (names.length < 2) { alert('至少需要 2 个角色'); return; }

        document.getElementById('pm-overlay')?.remove();
        const id = getStorageId();
        if (!window.__pmGroupMeta[id]) window.__pmGroupMeta[id] = {};
        if (mode === 'create') {
            const groupKey = `__group_${Date.now()}`;
            window.__pmGroupMeta[id][groupKey] = { name: groupName, members: names };
            saveGroupMeta();
            isGroupChat = true; groupMembers = names; groupDisplayName = groupName; currentGroupKey = groupKey;
            groupColorMap = {}; names.forEach((n, i) => { groupColorMap[n] = GROUP_COLORS[i % GROUP_COLORS.length]; });
            window.__pmSwitch(groupKey);
        }
    };

    window.__pmSetDarkMode = (mode) => {
        window.__pmTheme.darkMode = mode;
        saveTheme();
        if (phoneWindow) {
            phoneWindow.setAttribute('data-theme', mode);
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

    // ========== 设置界面 ==========
    window.__pmShowConfig = async () => {
        loadProfiles(); loadTheme();
        await loadBgSettings();
        const cfg = window.__pmConfig, t = window.__pmTheme;
        const shortUrl = (u) => (u || '').replace(/^https?:\/\//, '').replace(/\/+$/, '');
        const maskKey = (k) => !k ? '' : (k.length <= 8 ? '****' : k.slice(0, 4) + '****' + k.slice(-4));
        const profilesHtml = window.__pmProfiles.length > 0
            ? window.__pmProfiles.map((p, i) => `<div class="pm-prof-li"><div class="pm-prof-info" onclick="window.__pmPickProfile(${i})"><div class="pm-prof-url">${escapeHtml(shortUrl(p.apiUrl))}</div><div class="pm-prof-meta">${escapeHtml(maskKey(p.apiKey))}${p.model ? ' · ' + escapeHtml(p.model) : ''}</div></div><i class="pm-prof-del" onclick="window.__pmDeleteProfile(${i})">✕</i></div>`).join('')
            : '<div class="pm-prof-empty">暂无档案</div>';
        const useIndep = !!cfg.useIndependent;
        const presetBtns = Object.entries(THEME_PRESETS).map(([k, v]) =>
            `<div class="pm-theme-chip ${t.preset === k ? 'pm-theme-active' : ''}" data-preset="${k}" onclick="window.__pmSetPreset('${k}')"><span class="pm-theme-dot" style="background:${v.right}"></span>${v.label}</div>`
        ).join('');
        const layoutBtns = ['standard', 'relaxed'].map(v =>
            `<div class="pm-layout-chip ${t.layout === v ? 'pm-layout-active' : ''}" onclick="window.__pmSetLayout('${v}')">${v === 'standard' ? '标准' : '宽松'}</div>`
        ).join('');
        const id = getStorageId(), localKey = `${id}_${currentPersona}`;
        const hasGlobalBg = !!window.__pmBgGlobal, hasLocalBg = !!window.__pmBgLocal[localKey];
        const globalBgBtn = hasGlobalBg
            ? `<button class="pm-bg-btn pm-bg-del" onclick="window.__pmClearBg('global')">清除</button>`
            : `<label class="pm-bg-btn">选择图片<input type="file" accept="image/*" onchange="window.__pmUploadBg(this,'global')" hidden></label>
               <button class="pm-bg-btn" onclick="window.__pmBgUrl('global')">URL</button>`;
        const localBgBtn = hasLocalBg
            ? `<button class="pm-bg-btn pm-bg-del" onclick="window.__pmClearBg('local')">清除</button>`
            : `<label class="pm-bg-btn">选择图片<input type="file" accept="image/*" onchange="window.__pmUploadBg(this,'local')" hidden></label>
               <button class="pm-bg-btn" onclick="window.__pmBgUrl('local')">URL</button>`;

        makeOverlay(`
<div class="pm-modal pm-modal-wide">
  <div class="pm-modal-header"><b>设置</b><span onclick="document.getElementById('pm-overlay').remove()" class="pm-modal-close">✕</span></div>
  <div class="pm-cfg-tabs">
    <div class="pm-cfg-tab pm-cfg-tab-active" data-tab="api" onclick="window.__pmSwitchTab('api')">API</div>
    <div class="pm-cfg-tab" data-tab="look" onclick="window.__pmSwitchTab('look')">外观</div>
  </div>
  <div class="pm-modal-scroll">
    <div id="pm-tab-api" class="pm-tab-pane">
      <div style="padding:12px 14px 6px;">
        <div class="pm-cfg-label" style="margin-bottom:6px;">⚡ API 模式</div>
        <div class="pm-mode-switch">
          <div id="pm-mode-main" class="pm-mode-opt ${!useIndep ? 'pm-mode-active' : ''}" onclick="window.__pmSetMode(false)">🏠 主API</div>
          <div id="pm-mode-indep" class="pm-mode-opt ${useIndep ? 'pm-mode-active' : ''}" onclick="window.__pmSetMode(true)">🔌 独立API</div>
        </div>
        <div id="pm-mode-tip" class="pm-cfg-tip" style="text-align:left;padding:6px 2px 0;">${useIndep ? '🔌 独立API' : '🏠 主API'}</div>
      </div>
      <div style="padding:6px 14px 4px;border-top:1px solid #f0f0f0;">
        <div class="pm-cfg-label" style="margin:8px 0 6px;">📚 已保存档案</div>
        <div class="pm-prof-list">${profilesHtml}</div>
      </div>
      <div style="padding:10px 16px;display:flex;flex-direction:column;gap:10px;border-top:1px solid #f0f0f0;">
        <div class="pm-cfg-label">API 地址</div>
        <input id="pm-cfg-url" class="pm-cfg-input" placeholder="https://api.xxx.com 或 .../v1" value="${escapeAttr(cfg.apiUrl || '')}">
        <div class="pm-cfg-label">API Key</div>
        <input id="pm-cfg-key" class="pm-cfg-input" placeholder="sk-..." value="${escapeAttr(cfg.apiKey || '')}" maxlength="999">
        <div class="pm-cfg-label">模型名称</div>
        <div class="pm-model-row">
          <input id="pm-cfg-model" class="pm-cfg-input" placeholder="手动输入或 ▼" value="${escapeAttr(cfg.model || '')}">
          <button id="pm-model-arrow" type="button" onclick="window.__pmShowModelPicker()">▼</button>
        </div>
        <div id="pm-api-status" class="pm-cfg-tip" style="font-weight:bold;">连接成功后自动保存</div>
      </div>
    </div>
    <div id="pm-tab-look" class="pm-tab-pane" style="display:none;">
      <div style="padding:12px 16px 0;"> <div class="pm-cfg-label" style="margin-bottom:8px;">🌓 日夜模式</div>
        <div class="pm-theme-row" style="margin-bottom:8px;"> <div class="pm-layout-chip ${t.darkMode === 'light' ? 'pm-layout-active' : ''}" onclick="window.__pmSetDarkMode('light')">☀️ 日间</div>
          <div class="pm-layout-chip ${t.darkMode === 'dark' ? 'pm-layout-active' : ''}" onclick="window.__pmSetDarkMode('dark')">🌙 夜间</div>
        </div>
      </div>
      <div style="padding:12px 16px;border-top:1px solid #f0f0f0;">
        <div class="pm-cfg-label" style="margin-bottom:8px;">📐 界面布局</div>
        <div class="pm-layout-row">${layoutBtns}</div>
      </div>
      <div style="padding:14px 16px 12px;border-top:1px solid #f0f0f0;">
        <div class="pm-cfg-label" style="margin-bottom:10px;">🎨 气泡主题</div>
        <div class="pm-theme-row">${presetBtns}</div>
        <div style="display:flex;gap:8px;margin-top:14px;align-items:center;flex-wrap:wrap;">
          <label class="pm-cfg-label" style="margin:0;">自定义右</label>
          <input id="pm-custom-right" type="color" value="${t.customRight || '#007aff'}" onchange="window.__pmSetCustomColor()" class="pm-color-pick">
          <label class="pm-cfg-label" style="margin:0;">自定义左</label>
          <input id="pm-custom-left" type="color" value="${t.customLeft || '#e9e9eb'}" onchange="window.__pmSetCustomColor()" class="pm-color-pick">
          <button onclick="window.__pmClearCustomColor()" class="pm-color-clear">重置</button>
        </div>
        <div style="display:flex;gap:8px;margin-top:12px;align-items:center;">
          <label class="pm-cfg-label" style="margin:0;">边框颜色</label>
          <input id="pm-border-color" type="color" value="${t.borderColor || '#1a1a1a'}" onchange="window.__pmSetBorderColor()" class="pm-color-pick">
          <button onclick="document.getElementById('pm-border-color').value='#1a1a1a';window.__pmSetBorderColor()" class="pm-color-clear">重置</button>
        </div>
      </div>
      <div style="padding:18px 16px 14px;border-top:1px solid #f0f0f0;">
        <div class="pm-cfg-label" style="margin-bottom:14px;">🖼 背景图</div>
        <div style="display:flex;flex-direction:column;gap:14px;padding:0 4px;">
          <div class="pm-bg-row">
            <span class="pm-bg-label">全局背景</span>
            ${globalBgBtn}
          </div>
          <div class="pm-bg-row">
            <span class="pm-bg-label">本联系人</span>
            ${localBgBtn}
          </div>
        </div>
      </div>
      <div style="height:12px;"></div>
    </div>
  </div>
  <div class="pm-modal-add" id="pm-config-bottom" style="display:flex;flex-direction:column;gap:6px;">
    <div id="pm-api-buttons" style="display:flex;gap:6px;">
      <button onclick="window.__pmTestApi()" style="flex:1;background:#ff9500;color:#fff;border:none;border-radius:10px;padding:9px;font-size:12px;cursor:pointer;font-weight:600;">🔗 拉取模型</button>
      <button onclick="window.__pmTestModel()" style="flex:1;background:#5856d6;color:#fff;border:none;border-radius:10px;padding:9px;font-size:12px;cursor:pointer;font-weight:600;">🧪 测试</button>
    </div>
    <button onclick="window.__pmSaveConfig()" style="background:#007aff;color:#fff;border:none;border-radius:10px;padding:10px;font-size:13px;cursor:pointer;font-weight:600;">保存配置</button>
  </div>
</div>`);
    };

    // ========== 其余辅助函数 ==========
    window.__pmSwitchTab = (tab) => {
        document.querySelectorAll('.pm-cfg-tab').forEach(el => el.classList.toggle('pm-cfg-tab-active', el.dataset.tab === tab));
        document.querySelectorAll('.pm-tab-pane').forEach(el => el.style.display = 'none');
        const pane = document.getElementById(`pm-tab-${tab}`);
        if (pane) pane.style.display = 'block';
        const apiButtons = document.getElementById('pm-api-buttons');
        if (apiButtons) apiButtons.style.display = tab === 'api' ? 'flex' : 'none';
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
        if (phoneWindow) phoneWindow.dataset.layout = v;
        document.querySelectorAll('.pm-layout-chip').forEach(el => el.classList.toggle('pm-layout-active', el.textContent === (v === 'standard' ? '标准' : '宽松')));
        fitNameFont();
    };

    window.__pmUploadBg = (input, scope) => {
        const file = input.files?.[0]; if (!file) return;
        const reader = new FileReader();
        reader.onload = (e) => {
            openCropper(e.target.result, (croppedDataUrl) => {
                if (scope === 'global') { window.__pmBgGlobal = croppedDataUrl; saveBgGlobal(); }
                else { const id = getStorageId(); window.__pmBgLocal[`${id}_${currentPersona}`] = croppedDataUrl; saveBgLocal(); }
                applyBackground();
                window.__pmShowConfig();
                setTimeout(() => window.__pmSwitchTab('look'), 50);
            });
        };
        reader.readAsDataURL(file);
        input.value = '';
    };

    window.__pmBgUrl = (scope) => {
        const url = prompt('输入图片 URL：');
        if (!url?.trim()) return;
        if (scope === 'global') { window.__pmBgGlobal = url.trim(); saveBgGlobal(); }
        else { const id = getStorageId(); window.__pmBgLocal[`${id}_${currentPersona}`] = url.trim(); saveBgLocal(); }
        applyBackground();
        window.__pmShowConfig();
        setTimeout(() => window.__pmSwitchTab('look'), 50);
    };

    window.__pmClearBg = async (scope) => {
        if (scope === 'global') {
            window.__pmBgGlobal = '';
            await pmIDBDel('ST_SMS_BG_GLOBAL');
            try { localStorage.removeItem('ST_SMS_BG_GLOBAL'); } catch {}
        } else {
            const id = getStorageId(), key = `${id}_${currentPersona}`;
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
            if (d?.data && Array.isArray(d.data)) { __pmModelList = d.data.map(x => x.id).filter(Boolean); s.textContent = `✅ ${__pmModelList.length} 个模型`; s.style.color = "#34c759"; }
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
        try { localStorage.setItem('ST_SMS_CONFIG', JSON.stringify(window.__pmConfig)); } catch {}
        if (apiUrl && apiKey) addOrUpdateProfile({ apiUrl, apiKey, model });
        document.getElementById('pm-overlay')?.remove();
        addNote(`已保存：${window.__pmConfig.useIndependent && apiUrl ? '独立API' : '主API'}`);
    };

    window.__pmShowModelPicker = () => {
        const existing = document.getElementById('pm-model-dropdown');
        if (existing) { existing.remove(); return; }
        if (!__pmModelList.length) { const s = document.getElementById('pm-api-status'); if (s) { s.textContent = '⚠️ 先拉取模型'; s.style.color = '#ff9500'; } return; }
        const input = document.getElementById('pm-cfg-model'), rect = input.getBoundingClientRect();
        const dd = document.createElement('div'); dd.id = 'pm-model-dropdown'; dd.className = 'pm-model-dropdown';
        if (POPOVER_SUPPORTED) dd.setAttribute('popover', 'manual');
        dd.innerHTML = `<input class="pm-model-search" placeholder="🔍 搜索..." /><div class="pm-model-options"></div>`;
        dd.style.left = rect.left + 'px'; dd.style.top = (rect.bottom + 4) + 'px'; dd.style.width = rect.width + 'px';
        document.body.appendChild(dd); if (dd.showPopover) try { dd.showPopover(); } catch {}
        const optsDiv = dd.querySelector('.pm-model-options');
        const render = (f = '') => {
            const fl = f.toLowerCase(), filtered = __pmModelList.filter(m => !fl || m.toLowerCase().includes(fl));
            optsDiv.innerHTML = filtered.length ? filtered.map(m => `<div class="pm-model-opt" data-m="${escapeAttr(m)}">${escapeHtml(m)}</div>`).join('') : '<div class="pm-model-empty">无匹配</div>';
            optsDiv.querySelectorAll('.pm-model-opt').forEach(el => el.addEventListener('click', () => { document.getElementById('pm-cfg-model').value = el.dataset.m; dd.remove(); }));
        };
        render(); dd.querySelector('.pm-model-search').addEventListener('input', function () { render(this.value); }); dd.querySelector('.pm-model-search').focus();
        setTimeout(() => { const closer = (e) => { if (!dd.contains(e.target) && e.target.id !== 'pm-model-arrow') { dd.remove(); document.removeEventListener('click', closer, true); } }; document.addEventListener('click', closer, true); }, 0);
    };

    function makeOverlay(html) {
        document.getElementById('pm-overlay')?.remove();
        const ov = document.createElement('div'); ov.id = 'pm-overlay';
        if (POPOVER_SUPPORTED) ov.setAttribute('popover', 'manual');
        ov.innerHTML = html;
        ov.addEventListener('click', e => { if (e.target === ov) ov.remove(); });
        document.body.appendChild(ov);
        if (ov.showPopover) try { ov.showPopover(); } catch {}
        return ov;
    }

    window.__pmShowList = () => {
        const id = getStorageId();
        loadGroupMeta();
        const histories = window.__pmHistories[id] || {};
        const groups = window.__pmGroupMeta[id] || {};
        const checked = window.__pmBidirectional[id] || [];
        const singleList = Object.keys(histories).filter(k => !k.startsWith('__group_'));
        const groupList = Object.keys(groups);

        const renderSingle = singleList.map(n => {
            const isChk = checked.includes(n);
            const safeName = escapeAttr(n);
            return `<div class="pm-li">
                <div class="pm-custom-check pm-bi-style ${isChk ? 'is-checked' : ''}" onclick="event.stopPropagation();window.__pmToggleBidirectional('${safeName}')" style="width:20px;height:20px;min-width:20px;min-height:20px;flex-shrink:0;border-radius:50%;"></div>
                <span onclick="window.__pmSwitchContact('${safeName}')">${escapeHtml(n)}</span>
                <i onclick="window.__pmDel('${safeName}')">删除</i>
            </div>`;
        }).join('');

        const renderGroups = groupList.map(key => {
            const meta = groups[key];
            const isChk = checked.includes(key);
            const safeKey = escapeAttr(key);
            return `<div class="pm-li">
                <div class="pm-custom-check pm-bi-style ${isChk ? 'is-checked' : ''}" onclick="event.stopPropagation();window.__pmToggleBidirectional('${safeKey}')" style="width:20px;height:20px;min-width:20px;min-height:20px;flex-shrink:0;border-radius:50%;"></div>
                <span onclick="window.__pmSwitchContact('${safeKey}')">${escapeHtml(meta.name)}<span class="pm-group-sub">${escapeHtml(meta.members.join('、'))}</span></span>
                <i onclick="window.__pmDelGroup('${safeKey}')">删除</i>
            </div>`;
        }).join('');

        const empty = !singleList.length && !groupList.length;

        makeOverlay(`
    <div class="pm-modal">
    <div class="pm-modal-header"><b>联系人</b><span onclick="document.getElementById('pm-overlay').remove()" class="pm-modal-close">✕</span></div>
    <div class="pm-bi-bar"><span>🧠 勾选角色/群聊可被主楼读取短信</span><span class="pm-bi-tip">已选 ${checked.length}/${MAX_BIDIRECTIONAL}</span></div>
    <div class="pm-modal-list">
        ${empty ? '<div style="text-align:center;color:#999;padding:20px;font-size:13px;">暂无联系人</div>' : (renderGroups + renderSingle)}
    </div>
    <div class="pm-modal-add" style="display:flex;gap:8px;">
        <button onclick="window.__pmShowGroupCreate()" class="pm-btn-group">👥 新建群聊</button>
        <button onclick="window.__pmShowAddContact()" class="pm-btn-add">＋ 添加联系人</button>
    </div>
    </div>`);
    };

    window.__pmShowAddContact = () => {
        document.getElementById('pm-overlay')?.remove();
        makeOverlay(`
<div class="pm-modal">
  <div class="pm-modal-header"><b>添加联系人</b><span onclick="window.__pmShowList()" class="pm-modal-close">✕</span></div>
  <div style="padding:14px 16px;">
    <div class="pm-cfg-label" style="margin-bottom:8px;">输入角色名</div>
    <input id="pm-add-contact-input" class="pm-cfg-input" placeholder="角色名">
  </div>
  <div class="pm-modal-add">
    <button onclick="(()=>{const v=document.getElementById('pm-add-contact-input').value.trim();if(v)window.__pmSwitchContact(v);})()" style="flex:1;background:#007aff;color:#fff;border:none;border-radius:10px;padding:10px;font-size:13px;cursor:pointer;font-weight:600;">开始聊天</button>
  </div>
</div>`);
        setTimeout(() => {
            const input = document.getElementById('pm-add-contact-input');
            input?.focus();
            input?.addEventListener('keydown', e => {
                if (e.key === 'Enter') { const v = input.value.trim(); if (v) window.__pmSwitchContact(v); }
            });
        }, 0);
    };

    window.__pmDelGroup = async (key) => {
        const id = getStorageId();
        if (window.__pmGroupMeta[id]) delete window.__pmGroupMeta[id][key];
        if (window.__pmHistories[id]) delete window.__pmHistories[id][key];

        const arr = window.__pmBidirectional[id] || [], idx = arr.indexOf(key);
        if (idx >= 0) { arr.splice(idx, 1); window.__pmBidirectional[id] = arr; saveBidirectional(); }

        const bgKey = `${id}_${key}`;
        if (window.__pmBgLocal[bgKey]) {
            delete window.__pmBgLocal[bgKey];
            await pmIDBDel('ST_SMS_BG_LOCAL_' + bgKey);
            await saveBgLocal();
        }

        if (window.__pmPokeConfig[id]?.[key]) {
            delete window.__pmPokeConfig[id][key];
            savePokeConfig();
        }

        saveGroupMeta();
        saveHistories();
        applyBidirectionalInjection();
        window.__pmShowList();
    };

    window.__pmSwitchContact = (key) => {
        if (!key?.trim()) return; key = key.trim();
        loadGroupMeta();
        const id = getStorageId();
        const groupMeta = window.__pmGroupMeta[id]?.[key];
        if (groupMeta) {
            isGroupChat = true; currentGroupKey = key;
            groupMembers = groupMeta.members.slice();
            groupDisplayName = groupMeta.name;
            groupColorMap = {};
            groupMembers.forEach((n, i) => { groupColorMap[n] = GROUP_COLORS[i % GROUP_COLORS.length]; });
        } else {
            isGroupChat = false; groupMembers = []; groupColorMap = {}; groupDisplayName = ''; currentGroupKey = '';
        }
        window.__pmSwitch(key);
    };

    window.__pmSwitch = (name) => {
        if (!name?.trim()) return; name = name.trim();
        document.getElementById('pm-overlay')?.remove();
        const id = getStorageId();
        currentPersona = name;
        conversationHistory = window.__pmHistories[id]?.[name] ?? [];
        if (phoneWindow) {
            const nameEl = phoneWindow.querySelector('.pm-name');
            const editBtn = phoneWindow.querySelector('.pm-name-edit');
            if (nameEl) {
                if (isGroupChat) {
                    const display = groupDisplayName || name;
                    const arr = [...display];
                    nameEl.textContent = arr.length > 5 ? arr.slice(0, 5).join('') + '...' : display;
                } else {
                    nameEl.textContent = name;
                }
            }
            if (editBtn) editBtn.classList.remove('is-hidden');
            fitNameFont();
            const list = phoneWindow.querySelector('.pm-msg-list'); list.innerHTML = '';
            if (conversationHistory.length > 0) {
                addNote(`历史记录`);
                conversationHistory.forEach(m => {
                    if (isGroupChat && m.role === 'assistant') {
                        const lines = m.content.split('\n');
                        for (const line of lines) {
                            const match = line.match(/^(.{1,20})[：:]\s*(.+)$/);
                            if (match && groupMembers.some(gm => gm.toLowerCase() === match[1].trim().toLowerCase())) {
                                const sender = groupMembers.find(gm => gm.toLowerCase() === match[1].trim().toLowerCase());
                                splitToSentences(match[2]).forEach(s => addBubble(s, 'left', sender));
                            } else {
                                splitToSentences(line).forEach(s => addBubble(s, 'left'));
                            }
                        }
                    } else {
                        splitToSentences(m.content).forEach(s => addBubble(s, m.role === 'user' ? 'right' : 'left'));
                    }
                });
                addNote('── 以上为历史 ──');
            } else addNote(`开始对话`);
            applyBackground();
        }
        applyBidirectionalInjection();
    };

    window.__pmDel = async (name) => {
        const id = getStorageId();
        if (window.__pmHistories[id]) delete window.__pmHistories[id][name];
        saveHistories();

        const arr = window.__pmBidirectional[id] || [], idx = arr.indexOf(name);
        if (idx >= 0) { arr.splice(idx, 1); window.__pmBidirectional[id] = arr; saveBidirectional(); }

        const bgKey = `${id}_${name}`;
        if (window.__pmBgLocal[bgKey]) {
            delete window.__pmBgLocal[bgKey];
            await pmIDBDel('ST_SMS_BG_LOCAL_' + bgKey);
            await saveBgLocal();
        }

        if (window.__pmPokeConfig[id]?.[name]) {
            delete window.__pmPokeConfig[id][name];
            savePokeConfig();
        }

        applyBidirectionalInjection();
        window.__pmShowList();
    };

    window.__pmToggleSelect = () => {
        isSelectMode = !isSelectMode;
        const list = phoneWindow?.querySelector('.pm-msg-list');
        const trashBtn = phoneWindow?.querySelector('.pm-trash-btn');
        const confirmBar = phoneWindow?.querySelector('.pm-confirm-bar');
        if (!list) return;
        if (isSelectMode) {
            trashBtn.style.color = '#ff3b30'; confirmBar.style.display = 'flex';
            list.querySelectorAll('.pm-bubble, .pm-group-bubble-wrap').forEach(b => {
                if (b.id === 'pm-typing' || b.closest('.pm-select-wrap')) return;
                const wrap = document.createElement('div'); wrap.className = 'pm-select-wrap';
                
                // 👇 新增：给外层包裹器增加 Flex 布局，让勾选框和气泡横向对齐
                wrap.style.display = 'flex';
                wrap.style.alignItems = 'center';
                wrap.style.gap = '8px';
                // 根据气泡属于左边还是右边，决定整个包裹器靠左还是靠右
                wrap.style.alignSelf = b.dataset.side === 'right' ? 'flex-end' : 'flex-start';
                
                const cb = document.createElement('div'); cb.className = 'pm-custom-check'; cb.dataset.checked = '0';
                
                // 👇 新增：给动态生成的勾选框直接赋上尺寸、圆角等必须样式
                cb.style.width = '22px';
                cb.style.height = '22px';
                cb.style.minWidth = '22px';
                cb.style.minHeight = '22px';
                cb.style.borderRadius = '50%';
                cb.style.flexShrink = '0';
                cb.style.cursor = 'pointer';
                
                cb.onclick = () => { cb.dataset.checked = cb.dataset.checked === '0' ? '1' : '0'; };
                b.parentNode.insertBefore(wrap, b);
                wrap.appendChild(cb); wrap.appendChild(b);
                wrap.dataset.side = b.dataset.side || ''; wrap.dataset.text = b.dataset.text || '';
            });
        } else {
            trashBtn.style.color = ''; confirmBar.style.display = 'none';
            list.querySelectorAll('.pm-select-wrap').forEach(wrap => {
                const b = wrap.querySelector('.pm-bubble, .pm-group-bubble-wrap');
                if (b) wrap.parentNode.insertBefore(b, wrap); wrap.remove();
            });
        }
    };

    window.__pmDeleteSelected = () => {
        const list = phoneWindow?.querySelector('.pm-msg-list'); if (!list) return;
        const toDelete = new Set();
        list.querySelectorAll('.pm-select-wrap').forEach(wrap => {
            const cb = wrap.querySelector('.pm-custom-check');
            if (cb?.dataset.checked === '1') { toDelete.add(wrap.dataset.text); wrap.remove(); }
            else { const b = wrap.querySelector('.pm-bubble, .pm-group-bubble-wrap'); if (b) wrap.parentNode.insertBefore(b, wrap); wrap.remove(); }
        });
        if (toDelete.size > 0) {
            conversationHistory = conversationHistory.filter(m => !m.content.split(/\s*\/\s*/).some(p => toDelete.has(p.trim())));
            const id = getStorageId();
            if (!window.__pmHistories[id]) window.__pmHistories[id] = {};
            window.__pmHistories[id][currentPersona] = conversationHistory.slice(-SAVE_LIMIT);
            saveHistories();
            applyBidirectionalInjection();
        }
        isSelectMode = false;
        phoneWindow?.querySelector('.pm-trash-btn')?.style.removeProperty('color');
        const bar = phoneWindow?.querySelector('.pm-confirm-bar'); if (bar) bar.style.display = 'none';
    };

    window.__pmToggleMin = () => { isMinimized = !isMinimized; phoneWindow.classList.toggle('is-min', isMinimized); phoneWindow.style.removeProperty('transform'); };
    window.__pmEnd = () => {
        if (phoneWindow) { try { phoneWindow.hidePopover?.(); } catch {} phoneWindow.remove(); }
        phoneWindow = null; phoneActive = false; isMinimized = false; isSelectMode = false;
        isGroupChat = false; groupMembers = []; groupColorMap = {}; groupDisplayName = ''; currentGroupKey = '';
    };

    function ensureVisibility() {
        if (!phoneWindow) return;
        const cs = getComputedStyle(phoneWindow);
        if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity || '1') < 0.1) {
            phoneWindow.style.setProperty('display', 'flex', 'important');
            phoneWindow.style.setProperty('visibility', 'visible', 'important');
            phoneWindow.style.setProperty('opacity', '1', 'important');
        }
    }
    setInterval(ensureVisibility, 2000);

    window.__pmOpen = () => {
        if (phoneActive && phoneWindow) { try { phoneWindow.showPopover?.(); } catch {} phoneWindow.style.display = 'flex'; ensureVisibility(); return; }
        try { window.__pmHistories = JSON.parse(localStorage.getItem('ST_SMS_DATA_V2')) || {}; } catch {}
        try {
            const saved = JSON.parse(localStorage.getItem('ST_SMS_CONFIG'));
            window.__pmConfig = saved || { apiUrl: '', apiKey: '', model: '', useIndependent: false };
            if (typeof window.__pmConfig.useIndependent === 'undefined') window.__pmConfig.useIndependent = !!(window.__pmConfig.apiUrl && window.__pmConfig.apiKey);
        } catch { window.__pmConfig = { apiUrl: '', apiKey: '', model: '', useIndependent: false }; }
        loadProfiles(); loadBidirectional(); loadTheme(); loadGroupMeta(); loadPokeConfig(); migrateOldHistory();
        loadBgSettings().then(() => { try { applyBackground(); } catch {} });
        loadHistoriesFromIDB().then(() => {
            if (phoneWindow && currentPersona) {
                const id = getStorageId();
                const fresh = window.__pmHistories[id]?.[currentPersona];
                if (fresh && fresh.length > conversationHistory.length) {
                    window.__pmSwitch(currentPersona);
                }
            }
        });
        hookGenerationEvent();
        const c = getCtx(), defaultChar = c?.characters?.[c.characterId]?.name ?? 'AI';

        phoneWindow = document.createElement('div'); phoneWindow.id = 'pm-iphone';
        phoneWindow.dataset.layout = window.__pmTheme.layout || 'standard';
        phoneWindow.setAttribute('data-theme', window.__pmTheme.darkMode || 'light');
        if (POPOVER_SUPPORTED) phoneWindow.setAttribute('popover', 'manual');

        const editSvg = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>`;

        phoneWindow.innerHTML = `
<div class="pm-island"></div>
<div class="pm-main-ui">
  <div class="pm-navbar">
    <button onclick="window.__pmShowList()" class="pm-nav-btn pm-nav-left-btn">☰</button>
    <div class="pm-name-wrap">
      <div class="pm-name">${escapeHtml(defaultChar)}</div>
      <button onclick="window.__pmEditGroup()" class="pm-name-edit is-hidden" title="编辑">${editSvg}</button>
    </div>
    <div class="pm-nav-right">
      <button onclick="window.__pmToggleSelect()" class="pm-nav-btn pm-trash-btn">🗑</button>
      <button onclick="window.__pmShowConfig()" class="pm-nav-btn">⚙</button>
      <button onclick="window.__pmEnd()" class="pm-nav-btn" style="color:#ff3b30">✕</button>
    </div>
  </div>
  <div class="pm-confirm-bar" style="display:none;">
    <span class="pm-confirm-tip">选择要删除的消息</span>
    <button onclick="window.__pmDeleteSelected()" class="pm-confirm-btn">删除所选</button>
    <button onclick="window.__pmToggleSelect()" class="pm-cancel-btn">取消</button>
  </div>
  <div class="pm-msg-list"></div>
  <div class="pm-input-bar">
    <input class="pm-input" placeholder="iMessage">
    <button onclick="window.__pmSend()" class="pm-up-btn">↑</button>
  </div>
</div>`;
        document.body.appendChild(phoneWindow);
        if (phoneWindow.showPopover) try { phoneWindow.showPopover(); } catch {}
        phoneActive = true;
        phoneWindow.querySelector('.pm-input').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); window.__pmSend(); } });
        bindIsland(phoneWindow, phoneWindow.querySelector('.pm-island'));
        applyTheme(); isGroupChat = false; groupMembers = []; groupColorMap = {}; groupDisplayName = ''; currentGroupKey = '';
        window.__pmSwitch(defaultChar);
        applyBidirectionalInjection(); ensureVisibility();
    };

    // ══════════════════════ CSS ══════════════════════
    if (!document.getElementById('pm-css')) {
        const s = document.createElement('style'); s.id = 'pm-css';
        s.textContent = `
[popover]{border:none;padding:0;background:transparent;color:inherit;margin:0;overflow:visible;}
[popover]::backdrop{display:none;background:transparent;}
#pm-iphone{
    --pm-r-bg:#007aff;--pm-l-bg:#e9e9eb;--pm-r-txt:#fff;--pm-l-txt:#000;--pm-border:#1a1a1a;--pm-frost:0;
    position:fixed !important;inset:auto 40px 40px auto !important;margin:0 !important;transform:none !important;
    width:330px !important;height:580px !important;min-width:330px !important;max-width:330px !important;min-height:580px !important;max-height:580px !important;
    background:#fff !important;border:10px solid var(--pm-border) !important;border-radius:45px !important;z-index:2147483647 !important;
    display:flex !important;flex-direction:column !important;visibility:visible !important;opacity:1 !important;overflow:hidden !important;
    box-shadow:0 20px 60px rgba(0,0,0,.45) !important;transition:.35s cubic-bezier(.18,.89,.32,1.2);
    font-family:-apple-system,BlinkMacSystemFont,'PingFang SC','Microsoft YaHei',sans-serif !important;
    touch-action:none;box-sizing:border-box !important;pointer-events:auto !important;filter:none !important;color:#000 !important;
}

#pm-iphone[data-theme="light"] {
    --pm-bg: #fff;
    --pm-navbar-bg: #fff;
    --pm-navbar-border: #f0f0f0;
    --pm-input-bg: #f2f2f7;
    --pm-list-bg: #fff;
    --pm-text: #000;
    --pm-name-color: #000;
}

#pm-iphone[data-theme="dark"] {
    --pm-bg: #1c1c1e;
    --pm-navbar-bg: #1c1c1e;
    --pm-navbar-border: #38383a;
    --pm-input-bg: #2c2c2e;
    --pm-list-bg: #1c1c1e;
    --pm-text: #e5e5e5;
    --pm-name-color: #ccc;
}

#pm-iphone{background:var(--pm-bg,#fff) !important;}
.pm-main-ui{background:var(--pm-bg,#fff) !important;}
.pm-navbar{background:var(--pm-navbar-bg,#fff) !important;border-bottom-color:var(--pm-navbar-border,#f0f0f0) !important;}
.pm-name{color:var(--pm-name-color,#000) !important;}
.pm-input{background:var(--pm-input-bg,#f2f2f7) !important;color:var(--pm-text,#000) !important;}


#pm-iphone[data-theme="dark"] .pm-li:hover{background:#2c2c2e;}
#pm-iphone[data-theme="dark"] .pm-modal{background:#1c1c1e !important;color:#e5e5e5 !important;}
#pm-iphone[data-theme="dark"] .pm-modal-header{border-bottom-color:#38383a !important;}
#pm-iphone[data-theme="dark"] .pm-modal-header b{color:#e5e5e5 !important;}
#pm-iphone[data-theme="dark"] .pm-cfg-input{background:#2c2c2e !important;color:#e5e5e5 !important;border-color:#48484a !important;}
#pm-iphone[data-theme="dark"] .pm-cfg-label{color:#aaa !important;}
#pm-iphone[data-theme="dark"] .pm-cfg-tab{color:#aaa !important;}
#pm-iphone[data-theme="dark"] .pm-cfg-tab-active{color:#0a84ff !important;}
#pm-iphone[data-theme="dark"] .pm-cfg-tabs{border-bottom-color:#38383a !important;}
#pm-iphone[data-theme="dark"] .pm-layout-chip,#pm-iphone[data-theme="dark"] .pm-theme-chip{background:#2c2c2e !important;color:#ccc !important;}
#pm-iphone[data-theme="dark"] .pm-layout-active,#pm-iphone[data-theme="dark"] .pm-theme-active{border-color:#0a84ff !important;color:#0a84ff !important;background:#1c2a3a !important;}
#pm-iphone[data-theme="dark"] .pm-bg-btn{background:#2c2c2e !important;border-color:#48484a !important;color:#ccc !important;}
#pm-iphone[data-theme="dark"] .pm-prof-list{background:#2c2c2e !important;border-color:#48484a !important;}
#pm-iphone[data-theme="dark"] .pm-prof-li:hover{background:#3a3a3c !important;}
#pm-iphone[data-theme="dark"] .pm-mode-switch{background:#2c2c2e !important;}
#pm-iphone[data-theme="dark"] .pm-mode-opt{color:#aaa !important;}
#pm-iphone[data-theme="dark"] .pm-mode-active{background:#3a3a3c !important;color:#0a84ff !important;}
#pm-iphone[data-theme="dark"] .pm-bi-bar{background:#2c2410 !important;border-bottom-color:#4a3a10 !important;color:#b8902a !important;}
#pm-iphone[data-theme="dark"] .pm-confirm-bar{background:#2c2410 !important;border-bottom-color:#4a3a10 !important;}
#pm-iphone[data-theme="dark"] .pm-note{color:#666 !important;}
#pm-iphone[data-theme="dark"] .pm-group-name{color:#aaa !important;}
#pm-iphone[data-theme="dark"] .pm-island{background:#48484a;}

#pm-iphone.is-min{inset:auto 40px 40px auto !important;height:50px !important;min-height:50px !important;max-height:50px !important;width:140px !important;min-width:140px !important;max-width:140px !important;border-radius:25px !important;border-width:6px !important;}
#pm-iphone.is-min .pm-main-ui{display:none !important;}
#pm-iphone *,#pm-iphone *::before,#pm-iphone *::after{box-sizing:border-box;}
.pm-island{width:100px;height:28px;background:#1a1a1a;margin:8px auto 4px;border-radius:14px;cursor:move;flex-shrink:0;touch-action:none;}
.pm-main-ui{flex:1 !important;display:flex !important;flex-direction:column !important;overflow:hidden;min-height:0;}
.pm-navbar{position:relative;display:flex !important;align-items:center;padding:6px 10px;border-bottom:1px solid #f0f0f0;flex-shrink:0;min-height:38px;}
.pm-nav-left-btn{margin-right:auto;}
.pm-nav-right{display:flex;gap:4px;justify-content:flex-end;margin-left:auto;}
.pm-name-wrap{position:absolute !important;left:50%;top:50%;transform:translate(-50%,-50%);display:inline-flex;align-items:center;max-width:60%;pointer-events:auto;}
.pm-name{font-weight:700 !important;font-size:15px !important;text-align:center;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%;}
.pm-name-edit{background:#f0f0f3 !important;border:none !important;color:#666 !important;cursor:pointer;padding:5px !important;line-height:1;flex-shrink:0;border-radius:50% !important;width:24px;height:24px;display:inline-flex;align-items:center;justify-content:center;transition:all .2s;position:absolute;left:100%;margin-left:8px;}
.pm-name-edit.is-hidden{display:none !important;}
.pm-name-edit:hover{background:#007aff !important;color:#fff !important;transform:scale(1.05);}
.pm-name-edit svg{display:block;}
#pm-iphone[data-layout="relaxed"] .pm-nav-right{gap:10px;}
#pm-iphone[data-layout="relaxed"] .pm-navbar{padding:8px 14px;min-height:44px;}
.pm-nav-btn{background:none !important;border:none !important;font-size:18px !important;cursor:pointer;color:#007aff !important;padding:3px !important;line-height:1;flex-shrink:0;}
.pm-confirm-bar{background:#fff8f0;border-bottom:1px solid #ffe0b0;padding:7px 12px;align-items:center;gap:8px;flex-shrink:0;}
.pm-confirm-tip{flex:1;font-size:12px;color:#888;}
.pm-confirm-btn{background:#ff3b30 !important;color:#fff !important;border:none;border-radius:8px;padding:5px 12px;font-size:12px;cursor:pointer;font-weight:600;}
.pm-cancel-btn{background:#f0f0f0 !important;color:#333 !important;border:none;border-radius:8px;padding:5px 12px;font-size:12px;cursor:pointer;}
.pm-msg-list{flex:1 !important;overflow-y:auto !important;padding:12px !important;display:flex !important;flex-direction:column !important;gap:7px;background:var(--pm-list-bg,#fff) !important;min-height:0;background-size:cover;background-position:center;}
.pm-custom-check{position:relative;border:1.5px solid #ccc;background:transparent;box-sizing:border-box;transition:all 0.2s;}
.pm-custom-check[data-checked="1"],.pm-custom-check.is-checked{border-color:#007aff;background:#007aff !important;}
.pm-custom-check[data-checked="1"]::after,.pm-custom-check.is-checked::after{content:'✓';position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#fff;font-size:12px;font-weight:bold;}
.pm-bi-style{border-color:#e0a030;}.pm-bi-style.is-checked{border-color:#ff9500;background:#ff9500 !important;}
.pm-bubble{max-width:74% !important;padding:9px 13px;border-radius:18px !important;font-size:14px !important;line-height:1.45;word-break:break-word;animation:pm-pop .22s ease-out;}
.pm-bubble.pm-special{background:transparent !important;box-shadow:none !important;padding:0 !important;}
@keyframes pm-pop{from{opacity:0;transform:scale(.92) translateY(4px)}to{opacity:1;transform:scale(1) translateY(0)}}
.pm-right{align-self:flex-end !important;background:var(--pm-r-bg) !important;color:var(--pm-r-txt) !important;border-bottom-right-radius:4px !important;}
.pm-left{align-self:flex-start !important;background:var(--pm-l-bg) !important;color:var(--pm-l-txt) !important;border-bottom-left-radius:4px !important;}
#pm-iphone[style*="--pm-frost: 1"] .pm-right,#pm-iphone[style*="--pm-frost: 1"] .pm-left{backdrop-filter:blur(12px) saturate(1.4);-webkit-backdrop-filter:blur(12px) saturate(1.4);}
.pm-group-bubble-wrap{align-self:flex-start !important;display:flex !important;flex-direction:column !important;gap:2px;max-width:78% !important;width:fit-content !important;align-items:flex-start !important;}
.pm-group-bubble-wrap .pm-bubble{max-width:none !important;width:auto !important;align-self:flex-start !important;}
.pm-group-name{font-size:11px;color:#999;padding-left:6px;font-weight:500;white-space:nowrap;}
.pm-typing-bubble{display:flex !important;gap:5px;align-items:center;padding:11px 15px !important;width:fit-content;}
.pm-typing-bubble span{width:7px;height:7px;border-radius:50%;background:#999;display:inline-block;animation:pm-bounce 1.2s infinite;}
.pm-typing-bubble span:nth-child(2){animation-delay:.2s;}.pm-typing-bubble span:nth-child(3){animation-delay:.4s;}
@keyframes pm-bounce{0%,60%,100%{transform:translateY(0)}30%{transform:translateY(-5px)}}
.pm-note{text-align:center;font-size:11px;color:#bbb;padding:3px 0;}
.pm-transfer-card{background:linear-gradient(135deg,#ff9500,#ff6b00);color:#fff;border-radius:14px;padding:12px 14px;display:flex;align-items:center;gap:10px;min-width:150px;box-shadow:0 3px 10px rgba(255,149,0,.35);}
.pm-receive-card{background:linear-gradient(135deg,#34c759,#28a745);color:#fff;border-radius:14px;padding:12px 14px;display:flex;align-items:center;gap:10px;min-width:150px;box-shadow:0 3px 10px rgba(52,199,89,.35);}
.pm-t-icon{width:34px;height:34px;background:rgba(255,255,255,.25);border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:17px;font-weight:800;}
.pm-t-info{display:flex;flex-direction:column;gap:1px;}.pm-t-info b{font-size:12px;opacity:.85;}.pm-t-info span{font-size:17px;font-weight:700;}
.pm-img-card{background:#f2f2f7;border:1px solid #e0e0e0;padding:12px 14px;border-radius:14px;color:#555;font-size:13px;text-align:center;}
.pm-voice-wrap{display:flex;flex-direction:column;gap:4px;align-items:inherit;}
.pm-special.pm-right .pm-voice-wrap{align-items:flex-end;}.pm-special.pm-left .pm-voice-wrap{align-items:flex-start;}
.pm-voice-card{display:flex !important;align-items:center !important;flex-direction:row !important;flex-wrap:nowrap !important;gap:10px;padding:10px 14px;border-radius:18px;cursor:pointer;user-select:none;transition:filter .15s;white-space:nowrap;}
.pm-voice-card:hover{filter:brightness(.96);}
.pm-voice-right{background:var(--pm-r-bg);color:var(--pm-r-txt);border-bottom-right-radius:4px;flex-direction:row-reverse !important;}
.pm-voice-left{background:var(--pm-l-bg);color:var(--pm-l-txt);border-bottom-left-radius:4px;}
.pm-voice-icon{font-size:14px;flex-shrink:0;line-height:1;}
.pm-voice-wave{flex:1 1 auto;display:flex !important;flex-direction:row !important;gap:3px;align-items:center;height:16px;min-width:30px;}
.pm-voice-wave i{display:inline-block;width:3px;background:currentColor;opacity:.7;border-radius:2px;animation:pm-wave 1s infinite ease-in-out;flex-shrink:0;}
.pm-voice-wave i:nth-child(1){height:8px;}.pm-voice-wave i:nth-child(2){height:14px;animation-delay:.2s;}.pm-voice-wave i:nth-child(3){height:10px;animation-delay:.4s;}
@keyframes pm-wave{0%,100%{transform:scaleY(.5)}50%{transform:scaleY(1)}}
.pm-voice-dur{font-size:12px;opacity:.85;min-width:34px;text-align:right;flex-shrink:0;font-variant-numeric:tabular-nums;line-height:1;}
.pm-voice-text{background:#f7f7f9;border:1px solid #e5e5e8;color:#333;padding:7px 10px;border-radius:10px;font-size:13px;line-height:1.4;max-width:220px;word-break:break-word;position:relative;}
.pm-voice-text::before{content:'已转文字';position:absolute;top:-8px;left:8px;font-size:9px;color:#999;background:#fff;padding:0 4px;border-radius:4px;}
.pm-input-bar{padding:8px 12px 30px !important;display:flex !important;gap:8px;border-top:1px solid var(--pm-navbar-border,#f0f0f0);align-items:center;background:var(--pm-navbar-bg,#fff) !important;flex-shrink:0;}
.pm-input{flex:1 !important;min-width:0 !important;background:#f2f2f7 !important;color:#000 !important;border:none !important;border-radius:20px !important;padding:9px 14px !important;outline:none !important;font-size:14px !important;font-family:inherit !important;}
.pm-input:disabled{opacity:.5;}
.pm-up-btn{width:32px !important;height:32px !important;background:#007aff !important;color:#fff !important;border:none !important;border-radius:50% !important;cursor:pointer;font-size:16px !important;font-weight:bold;display:flex !important;align-items:center !important;justify-content:center !important;flex-shrink:0;}
.pm-up-btn:disabled{background:#ccc !important;}
#pm-overlay{position:fixed !important;inset:0 !important;margin:0 !important;width:100vw !important;height:100vh !important;height:100dvh !important;max-width:none !important;max-height:none !important;background:rgba(0,0,0,.45) !important;z-index:2147483647 !important;display:flex !important;align-items:center !important;justify-content:center !important;border:none !important;padding:0 !important;}
.pm-modal{background:#fff !important;border-radius:20px !important;width:290px;max-height:85vh;max-height:85dvh;display:flex !important;flex-direction:column !important;overflow:hidden;box-shadow:0 16px 48px rgba(0,0,0,.28);font-family:-apple-system,BlinkMacSystemFont,'PingFang SC',sans-serif !important;}
.pm-modal-wide{width:320px;}
.pm-modal-scroll{flex:1;overflow-y:auto;min-height:0;}
.pm-modal-header{display:flex !important;justify-content:space-between !important;align-items:center !important;padding:16px 18px 12px !important;border-bottom:1px solid #f0f0f0;flex-shrink:0;}
.pm-modal-header b{font-size:16px !important;color:#000 !important;}.pm-modal-close{font-size:20px;color:#999;cursor:pointer;line-height:1;}
.pm-cfg-tabs{display:flex;border-bottom:1px solid #f0f0f0;flex-shrink:0;padding:0 14px;}
.pm-cfg-tab{flex:1;text-align:center;padding:10px 0;font-size:13px;font-weight:600;color:#888;cursor:pointer;border-bottom:2px solid transparent;transition:all .2s;user-select:none;}
.pm-cfg-tab:hover{color:#555;}
.pm-cfg-tab-active{color:#007aff !important;border-bottom-color:#007aff !important;}
.pm-tab-pane{animation:pm-fade-in .15s ease;}
@keyframes pm-fade-in{from{opacity:0}to{opacity:1}}
.pm-bi-bar{padding:8px 14px;background:#fff8e8;border-bottom:1px solid #ffe6a8;font-size:11px;color:#885d00;display:flex;flex-direction:column;gap:3px;}
.pm-bi-tip{font-weight:600;color:#b87a00;}
.pm-modal-list{overflow-y:auto;flex:1;padding:6px 8px;max-height:400px;}
.pm-li{display:flex !important;align-items:center !important;gap:10px;padding:10px;border-radius:12px;}.pm-li:hover{background:#f5f5f5;}
.pm-li > span{flex:1;font-size:14px !important;color:#007aff !important;font-weight:500;cursor:pointer;display:flex;flex-direction:column;gap:2px;min-width:0;}
.pm-group-sub{font-size:11px !important;color:#999 !important;font-weight:400 !important;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.pm-li i{font-style:normal;font-size:11px;color:#fff !important;background:#ff3b30 !important;padding:3px 9px;border-radius:8px;cursor:pointer;font-weight:600;flex-shrink:0;}
.pm-modal-add{padding:12px 14px 16px;border-top:1px solid #f0f0f0;display:flex;gap:8px;flex-shrink:0;}
.pm-modal-add input{flex:1;min-width:0;border:1px solid #ddd;border-radius:10px;padding:9px 12px;font-size:13px;outline:none;color:#000 !important;background:#fff !important;}
.pm-modal-add button{background:#007aff !important;color:#fff !important;border:none;border-radius:10px;padding:9px 14px;font-size:13px;cursor:pointer;font-weight:600;white-space:nowrap;}
.pm-btn-group{flex:1;background:linear-gradient(135deg,#ff9500,#ff6b00) !important;color:#fff !important;border:none !important;border-radius:10px !important;padding:11px !important;font-size:13px !important;cursor:pointer !important;font-weight:600 !important;}
.pm-btn-add{flex:1;background:linear-gradient(135deg,#007aff,#0056b3) !important;color:#fff !important;border:none !important;border-radius:10px !important;padding:11px !important;font-size:13px !important;cursor:pointer !important;font-weight:600 !important;}
.pm-btn-group:hover,.pm-btn-add:hover{filter:brightness(1.05);}
.pm-cfg-label{font-size:12px;color:#888;margin-bottom:-4px;}
.pm-cfg-input{width:100%;border:1px solid #ddd !important;border-radius:10px !important;padding:9px 12px;font-size:13px !important;outline:none;color:#000 !important;background:#fff !important;}
.pm-cfg-tip{font-size:11px;color:#aaa;text-align:center;padding:4px 0;}
.pm-mode-switch{display:flex !important;background:#f0f0f3;border-radius:12px;padding:3px;gap:3px;}
.pm-mode-opt{flex:1;text-align:center;padding:9px 0;font-size:13px;font-weight:600;color:#888;cursor:pointer;border-radius:9px;transition:all .2s;user-select:none;}
.pm-mode-opt:hover{color:#555;}.pm-mode-active{background:#fff !important;color:#007aff !important;box-shadow:0 2px 6px rgba(0,0,0,.08);}
.pm-prof-list{max-height:100px;overflow-y:auto;border:1px solid #eee;border-radius:10px;background:#fafafa;padding:4px;}
.pm-prof-li{display:flex !important;align-items:center !important;gap:8px;padding:7px 9px;border-radius:8px;}.pm-prof-li:hover{background:#fff;}
.pm-prof-info{flex:1;min-width:0;cursor:pointer;display:flex;flex-direction:column;gap:2px;}
.pm-prof-url{font-size:12px;color:#007aff !important;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.pm-prof-meta{font-size:10px;color:#999;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.pm-prof-del{font-style:normal;font-size:12px;color:#ff3b30;background:#fff !important;border:1px solid #ffd0cc;width:22px;height:22px;border-radius:50%;display:flex !important;align-items:center !important;justify-content:center !important;cursor:pointer;flex-shrink:0;font-weight:600;}
.pm-prof-del:hover{background:#ff3b30 !important;color:#fff !important;}
.pm-prof-empty{text-align:center;color:#aaa;font-size:12px;padding:10px 0;}
.pm-theme-row{display:flex;gap:6px;flex-wrap:wrap;}
.pm-theme-chip{display:flex;align-items:center;gap:4px;padding:5px 10px;border-radius:16px;font-size:12px;color:#555;background:#f5f5f5;cursor:pointer;border:2px solid transparent;transition:all .15s;user-select:none;}
.pm-theme-chip:hover{background:#eee;}.pm-theme-active{border-color:#007aff;color:#007aff;background:#f0f7ff;}
.pm-theme-dot{width:14px;height:14px;border-radius:50%;flex-shrink:0;}
.pm-color-pick{width:32px;height:28px;padding:0;border:1px solid #ddd;border-radius:6px;cursor:pointer;background:none;}
.pm-color-clear{background:none;border:1px solid #ddd;border-radius:6px;padding:3px 8px;font-size:11px;color:#888;cursor:pointer;white-space:nowrap;}.pm-color-clear:hover{background:#f0f0f0;}
.pm-layout-row{display:flex;gap:6px;}
.pm-layout-chip{padding:6px 16px;border-radius:16px;font-size:12px;color:#555;background:#f5f5f5;cursor:pointer;border:2px solid transparent;transition:all .15s;user-select:none;}
.pm-layout-chip:hover{background:#eee;}.pm-layout-active{border-color:#007aff;color:#007aff;background:#f0f7ff;}
.pm-bg-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap;}
.pm-bg-label{font-size:12px;color:#555;font-weight:500;min-width:64px;}
.pm-bg-btn{background:#f0f0f3;border:1px solid #ddd;border-radius:8px;padding:6px 12px;font-size:12px;color:#555;cursor:pointer;white-space:nowrap;font-family:inherit;}
.pm-bg-btn:hover{background:#e5e5e8;}.pm-bg-del{color:#ff3b30 !important;border-color:#ffc8c8 !important;}
.pm-model-row{display:flex;gap:6px;}.pm-model-row .pm-cfg-input{flex:1;}
#pm-model-arrow{background:#f0f0f3;border:1px solid #ddd;border-radius:10px;width:38px;cursor:pointer;font-size:12px;color:#555;flex-shrink:0;transition:all .15s;}
#pm-model-arrow:hover{background:#007aff;color:#fff;border-color:#007aff;}
.pm-model-dropdown{position:fixed;z-index:2147483647;background:#fff !important;border:1px solid #ddd !important;border-radius:12px !important;box-shadow:0 8px 24px rgba(0,0,0,.18);overflow:hidden;display:flex;flex-direction:column;min-width:200px;padding:0 !important;margin:0 !important;color:#000 !important;}
.pm-model-search{border:none !important;border-bottom:1px solid #eee !important;padding:9px 12px !important;outline:none;font-size:13px !important;background:#fafafa !important;color:#000 !important;width:100%;}
.pm-model-options{overflow-y:auto;max-height:${MODEL_VISIBLE_ROWS * 34}px;}
.pm-model-opt{padding:8px 12px;font-size:13px;color:#333;cursor:pointer;border-bottom:1px solid #f5f5f5;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;height:34px;line-height:18px;}
.pm-model-opt:hover{background:#f0f7ff;color:#007aff;}.pm-model-empty{padding:14px;text-align:center;font-size:12px;color:#999;}
.pm-crop-tip{font-size:11px;color:#888;text-align:center;margin-bottom:8px;}
.pm-crop-frame{position:relative;width:100%;background:#000;border-radius:12px;overflow:hidden;cursor:grab;user-select:none;touch-action:none;}
.pm-crop-frame:active{cursor:grabbing;}
.pm-crop-frame img{position:absolute;left:0;top:0;max-width:none;pointer-events:none;}
.pm-crop-mask{position:absolute;inset:0;border:2px solid rgba(255,255,255,0.6);box-shadow:0 0 0 2000px rgba(0,0,0,0.3) inset;pointer-events:none;border-radius:8px;}
.pm-crop-zoom{display:flex;align-items:center;gap:8px;margin-top:10px;}
.pm-crop-zoom input[type=range]{accent-color:#007aff;cursor:pointer !important;flex:1;}
.pm-crop-zoom input[type=range]::-webkit-slider-thumb{cursor:pointer !important;}
.pm-crop-zoom input[type=range]::-moz-range-thumb{cursor:pointer !important;}
@media(max-width:500px),(max-height:700px){
    #pm-iphone{inset:0 !important;margin:auto !important;transform:none !important;width:min(330px,92vw) !important;height:min(560px,82vh) !important;height:min(560px,82dvh) !important;min-width:0 !important;min-height:0 !important;max-width:92vw !important;max-height:82vh !important;max-height:82dvh !important;border-width:8px !important;border-radius:36px !important;}
    #pm-iphone.is-min{inset:auto 20px 20px auto !important;margin:0 !important;transform:none !important;width:120px !important;min-width:120px !important;max-width:120px !important;height:44px !important;min-height:44px !important;max-height:44px !important;border-width:5px !important;border-radius:22px !important;}
    .pm-modal,.pm-modal-wide{width:min(320px,94vw) !important;max-height:90vh !important;max-height:90dvh !important;}
}
        `;
        document.head.appendChild(s);
    }

    function registerPhoneCommand() {
        const ctx = getCtx(); if (!ctx) return false;
        const cb = () => { try { window.__pmOpen(); } catch (e) { console.error('[phone-mode]', e); } return ''; };
        try {
            const SCP = window.SlashCommandParser || ctx.SlashCommandParser, SC = window.SlashCommand || ctx.SlashCommand;
            if (SCP && SC && typeof SCP.addCommandObject === 'function' && typeof SC.fromProps === 'function') { SCP.addCommandObject(SC.fromProps({ name: 'phone', callback: cb, helpString: '打开短信' })); return true; }
        } catch {}
        try { if (typeof ctx.registerSlashCommand === 'function') { ctx.registerSlashCommand('phone', cb, [], '打开短信', true, true); return true; } } catch {}
        return false;
    }
    if (!registerPhoneCommand()) { let t = 0; const i = setInterval(() => { t++; if (registerPhoneCommand() || t >= 30) clearInterval(i); }, 500); }

    document.addEventListener('keydown', e => {
        if (e.key !== 'Enter' || e.shiftKey) return;
        const ta = document.getElementById('send_textarea');
        if (!ta || document.activeElement !== ta) return;
        if (ta.value.trim() === '/phone') { e.preventDefault(); e.stopImmediatePropagation(); ta.value = ''; window.__pmOpen(); }
    }, true);
    document.addEventListener('click', e => {
        const btn = e.target.closest?.('#send_but'); if (!btn) return;
        const ta = document.getElementById('send_textarea'); if (!ta) return;
        if (ta.value.trim() === '/phone') { e.preventDefault(); e.stopImmediatePropagation(); ta.value = ''; window.__pmOpen(); }
    }, true);

    try { window.__pmHistories = JSON.parse(localStorage.getItem('ST_SMS_DATA_V2')) || {}; } catch {}
    loadBidirectional(); loadGroupMeta(); loadPokeConfig();
    loadHistoriesFromIDB();
    setTimeout(() => { migrateOldHistory(); applyBidirectionalInjection(); hookGenerationEvent(); }, 1500);

    console.log('[phone-mode] v9.2 夜间模式修复 + 独立API拍一拍修复 + 角色主动发消息自然化');
})();

