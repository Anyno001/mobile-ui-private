(async function () {
    await new Promise(r => setTimeout(r, 1000));

    // ── 可调常量 ──
    const SAVE_LIMIT = 60;
    const CONTEXT_LIMIT = 20;
    const BIDIRECTIONAL_LIMIT = 20;
    const MAX_BIDIRECTIONAL = 5;
    const BIDIRECTIONAL_KEY = 'PHONE_SMS_MEMORY';
    const VOICE_MAX_SEC = 60;
    const MODEL_VISIBLE_ROWS = 4;

    window.__pmHistories = window.__pmHistories || {};
    window.__pmConfig = window.__pmConfig || { apiUrl: '', apiKey: '', model: '', useIndependent: false };
    window.__pmProfiles = window.__pmProfiles || [];
    window.__pmBidirectional = window.__pmBidirectional || {};
    let __pmModelList = [];

    let phoneActive = false;
    let phoneWindow = null;
    let currentPersona = '';
    let conversationHistory = [];
    let isGenerating = false;
    let isMinimized = false;
    let isSelectMode = false;

    const getCtx = () => typeof SillyTavern !== 'undefined' ? SillyTavern.getContext() : null;

    const SPECIAL_KEYWORDS = {
        '转账':'转账','transfer':'转账','Transfer':'转账','TRANSFER':'转账',
        '图片':'图片','image':'图片','Image':'图片','IMAGE':'图片','img':'图片','pic':'图片','photo':'图片',
        '语音':'语音','voice':'语音','Voice':'语音','VOICE':'语音','audio':'语音',
    };
    const KW_PATTERN = Object.keys(SPECIAL_KEYWORDS).join('|');
    const SPECIAL_RE = new RegExp(`[\\(（]\\s*(${KW_PATTERN})\\s*[+：:\\s]*([^)）]+)[\\)）]`, 'gi');
    function normalizeKeyword(k) {
        return SPECIAL_KEYWORDS[k] || SPECIAL_KEYWORDS[k.toLowerCase()] || k;
    }

    function getStorageId() {
        const c = getCtx();
        if (!c) return 'sms_unknown__default';
        const char = c.characters?.[c.characterId];
        const avatar = char?.avatar || `idx_${c.characterId}`;
        const chatFile = c.chatId
            || (typeof c.getCurrentChatId === 'function' ? c.getCurrentChatId() : null)
            || c.chat_metadata?.chat_id_hash
            || c.chat_file
            || 'default';
        return `sms_${avatar}__${chatFile}`;
    }

    function migrateOldHistory() {
        if (localStorage.getItem('ST_SMS_MIGRATED_V3')) return;
        const c = getCtx();
        if (!c) return;
        try {
            const oldData = window.__pmHistories || {};
            const newData = {};
            let migrated = 0;
            for (const oldKey of Object.keys(oldData)) {
                if (oldKey.startsWith('sms_')) { newData[oldKey] = oldData[oldKey]; continue; }
                const m = oldKey.match(/^(\d+)_(.+)$/);
                if (!m) { newData[oldKey] = oldData[oldKey]; continue; }
                const charId = parseInt(m[1]);
                const chatFile = m[2];
                const ch = c.characters?.[charId];
                if (ch && ch.avatar) {
                    newData[`sms_${ch.avatar}__${chatFile}`] = oldData[oldKey];
                    migrated++;
                } else {
                    newData[oldKey] = oldData[oldKey];
                }
            }
            window.__pmHistories = newData;
            localStorage.setItem('ST_SMS_DATA_V2', JSON.stringify(newData));
            localStorage.setItem('ST_SMS_MIGRATED_V3', '1');
            if (migrated) console.log(`[phone-mode] 已迁移 ${migrated} 个旧聊天索引`);
        } catch (e) { console.warn('[phone-mode] 迁移失败', e); }
    }

    function normalizeApiUrls(input) {
        let url = (input || '').trim().replace(/\/+$/, '');
        if (!url) return { chatUrl: '', modelsUrl: '' };
        if (/\/chat\/completions$/i.test(url)) return { chatUrl: url, modelsUrl: url.replace(/\/chat\/completions$/i, '/models') };
        if (/\/models$/i.test(url)) return { chatUrl: url.replace(/\/models$/i, '/chat/completions'), modelsUrl: url };
        if (/\/v\d+$/i.test(url)) return { chatUrl: url + '/chat/completions', modelsUrl: url + '/models' };
        return { chatUrl: url + '/v1/chat/completions', modelsUrl: url + '/v1/models' };
    }

    function loadProfiles() {
        try { window.__pmProfiles = JSON.parse(localStorage.getItem('ST_SMS_API_PROFILES')) || []; }
        catch { window.__pmProfiles = []; }
    }
    function saveProfiles() {
        try { localStorage.setItem('ST_SMS_API_PROFILES', JSON.stringify(window.__pmProfiles)); } catch {}
    }
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
        document.getElementById('pm-cfg-url').value = p.apiUrl || '';
        document.getElementById('pm-cfg-key').value = p.apiKey || '';
        document.getElementById('pm-cfg-model').value = p.model || '';
        const status = document.getElementById('pm-api-status');
        if (status) { status.textContent = '✅ 已载入档案'; status.style.color = '#34c759'; }
    };

    window.__pmSetMode = (useIndependent) => {
        window.__pmConfig.useIndependent = !!useIndependent;
        try { localStorage.setItem('ST_SMS_CONFIG', JSON.stringify(window.__pmConfig)); } catch {}
        const main = document.getElementById('pm-mode-main');
        const indep = document.getElementById('pm-mode-indep');
        const tip = document.getElementById('pm-mode-tip');
        if (main && indep) {
            main.classList.toggle('pm-mode-active', !useIndependent);
            indep.classList.toggle('pm-mode-active', !!useIndependent);
        }
        if (tip) tip.textContent = useIndependent ? '🔌 当前：独立API' : '🏠 当前：主API';
    };

    function loadBidirectional() {
        try { window.__pmBidirectional = JSON.parse(localStorage.getItem('ST_SMS_BIDIRECTIONAL')) || {}; }
        catch { window.__pmBidirectional = {}; }
    }
    function saveBidirectional() {
        try { localStorage.setItem('ST_SMS_BIDIRECTIONAL', JSON.stringify(window.__pmBidirectional)); } catch {}
    }

    function applyBidirectionalInjection() {
        const c = getCtx();
        if (!c || typeof c.setExtensionPrompt !== 'function') return;
        const id = getStorageId();
        const checked = window.__pmBidirectional[id] || [];
        const histories = window.__pmHistories[id] || {};

        if (!checked.length) {
            try { c.setExtensionPrompt(BIDIRECTIONAL_KEY, '', 1, 4); } catch {}
            return;
        }

        const blocks = checked.map(name => {
            const conv = (histories[name] || []).slice(-BIDIRECTIONAL_LIMIT);
            if (!conv.length) return '';
            const lines = conv.map(m => {
                const text = (m.content || '').replace(/\s*\/\s*/g, '。');
                return m.role === 'user' ? `用户：${text}` : `${name}：${text}`;
            }).join('\n');
            return `【与 ${name} 的最近短信 — 仅 ${name} 与用户本人知晓，其他任何角色都不应知情】\n${lines}`;
        }).filter(Boolean).join('\n\n');

        if (!blocks) {
            try { c.setExtensionPrompt(BIDIRECTIONAL_KEY, '', 1, 4); } catch {}
            return;
        }

        const prompt = `[手机短信记忆 — 私密信息 · 严格隔离]
以下是用户与某些角色之间的私人手机短信往来。**重要规则**：
1. 每段短信只属于该段中标明的角色与用户本人，**其他任何角色都不知道这些内容**，请勿让他们表现出知情。
2. 仅当某角色本人在场或被自然提及时，才可参考其对应的短信记忆。
3. 切勿将一个角色的短信内容透露给另一个角色，也不要让旁人偶然"看到"。

${blocks}

[短信记忆结束]`;

        try { c.setExtensionPrompt(BIDIRECTIONAL_KEY, prompt, 1, 4); }
        catch (e) { console.warn('[phone-mode] 注入失败', e); }
    }

    window.__pmToggleBidirectional = (name) => {
        const id = getStorageId();
        const arr = window.__pmBidirectional[id] || [];
        const idx = arr.indexOf(name);
        if (idx >= 0) arr.splice(idx, 1);
        else {
            if (arr.length >= MAX_BIDIRECTIONAL) {
                const status = document.querySelector('.pm-bi-tip');
                if (status) { status.textContent = `⚠️ 最多同时勾选 ${MAX_BIDIRECTIONAL} 个`; status.style.color = '#ff3b30'; }
                return;
            }
            arr.push(name);
        }
        window.__pmBidirectional[id] = arr;
        saveBidirectional();
        applyBidirectionalInjection();
        window.__pmShowList();
    };

    async function gatherContext() {
        const c = getCtx();
        const char = c?.characters?.[c.characterId] || {};
        const cleanMsg = (s) => (s || '').replace(/```[\s\S]*?```/g, '').replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/<[^>]+>/g, '').trim();
        const mainChatArr = (c?.chat || []).slice(-8).map(m => ({
            who: m.is_user ? '用户' : (m.name || '角色'),
            role: m.is_user ? 'user' : 'assistant',
            content: cleanMsg(m.mes || ''),
        })).filter(m => m.content);
        const mainChatText = mainChatArr.map(m => `${m.who}：${m.content}`).join('\n');

        let worldBookText = '';
        try {
            if (typeof c?.getWorldInfoPrompt === 'function') {
                const recentMsgs = (c.chat || []).map(m => m.mes || '').slice(-10);
                const wi = await c.getWorldInfoPrompt(recentMsgs, 4096, false);
                worldBookText = wi?.worldInfoString || wi?.worldInfoBefore || '';
                if (!worldBookText && wi && typeof wi === 'object') worldBookText = [wi.worldInfoBefore, wi.worldInfoAfter].filter(Boolean).join('\n');
            }
        } catch (e) { console.warn('[phone-mode] 世界书读取失败', e); }

        return {
            cardDesc: char.description ?? '',
            cardPersonality: char.personality ?? '',
            cardScenario: char.scenario ?? '',
            cardFirstMes: char.first_mes ?? '',
            cardMesExample: char.mes_example ?? '',
            mainChatText, worldBookText,
        };
    }

    function bindIsland(el, handle) {
        let isDragging = false, startX, startY, startL, startT, moved = false;
        const getCoord = (e) => e.touches ? { x: e.touches[0].clientX, y: e.touches[0].clientY } : { x: e.clientX, y: e.clientY };
        const onStart = (e) => {
            if (e.target.tagName === 'BUTTON') return;
            isDragging = true; moved = false;
            const coords = getCoord(e);
            startX = coords.x; startY = coords.y; startL = el.offsetLeft; startT = el.offsetTop;
            el.style.transition = 'none';
        };
        const onMove = (e) => {
            if (!isDragging) return;
            const coords = getCoord(e);
            const dx = coords.x - startX, dy = coords.y - startY;
            if (Math.abs(dx) > 5 || Math.abs(dy) > 5) { moved = true; if (e.cancelable) e.preventDefault(); }
            el.style.left = (startL + dx) + 'px';
            el.style.top = (startT + dy) + 'px';
            el.style.bottom = 'auto';
            el.style.right = 'auto';
            el.style.margin = '0';
            el.style.transform = 'none';
        };
        const onEnd = () => {
            if (!isDragging) return;
            isDragging = false;
            el.style.transition = '0.35s cubic-bezier(0.18, 0.89, 0.32, 1.2)';
            if (!moved) window.__pmToggleMin();
        };
        handle.addEventListener('mousedown', onStart);
        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onEnd);
        handle.addEventListener('touchstart', onStart, { passive: false });
        window.addEventListener('touchmove', onMove, { passive: false });
        window.addEventListener('touchend', onEnd);
    }

    function escapeHtml(s) { return (s || '').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
    function escapeAttr(s) { return (s || '').replace(/"/g,'&quot;').replace(/</g,'&lt;'); }

    function createBubbles(text, side) {
        const results = [];
        const re = new RegExp(SPECIAL_RE.source, 'gi');
        let last = 0, m;
        const pushPlain = (str) => {
            const plain = str.trim();
            if (!plain) return;
            const b = document.createElement('div');
            b.className = `pm-bubble pm-${side}`;
            b.innerHTML = escapeHtml(plain).replace(/\n/g,'<br>');
            results.push(b);
        };
        while ((m = re.exec(text)) !== null) {
            if (m.index > last) pushPlain(text.slice(last, m.index));
            const kind = normalizeKeyword(m[1]);
            const b = document.createElement('div');
            b.className = `pm-bubble pm-${side} pm-special`;
            if (kind === '转账') {
                const amount = parseFloat(m[2]) || 0;
                b.innerHTML = `<div class="pm-transfer-card"><div class="pm-t-icon">¥</div><div class="pm-t-info"><b>转账</b><span>¥${amount.toFixed(2)}</span></div></div>`;
            } else if (kind === '图片') {
                b.innerHTML = `<div class="pm-img-card">🖼️ ${escapeHtml(m[2].trim())}</div>`;
            } else {
                const txt = m[2].trim();
                const len = [...txt].length;
                const dur = Math.min(VOICE_MAX_SEC, Math.max(1, len * 2));
                const width = Math.min(240, Math.max(100, 80 + len * 5));
                b.innerHTML = `
                    <div class="pm-voice-wrap">
                        <div class="pm-voice-card pm-voice-${side}" style="width:${width}px" onclick="window.__pmToggleVoice(this)">
                            <span class="pm-voice-icon">🎤</span>
                            <span class="pm-voice-wave"><i></i><i></i><i></i></span>
                            <span class="pm-voice-dur">${dur}"</span>
                        </div>
                        <div class="pm-voice-text" style="display:none;">${escapeHtml(txt)}</div>
                    </div>`;
            }
            results.push(b);
            last = m.index + m[0].length;
        }
        if (last < text.length) pushPlain(text.slice(last));
        if (!results.length) pushPlain(text);
        return results;
    }

    window.__pmToggleVoice = (el) => {
        const wrap = el.parentElement;
        const txt = wrap?.querySelector('.pm-voice-text');
        if (txt) txt.style.display = txt.style.display === 'none' ? 'block' : 'none';
    };

    function cleanResponse(raw) {
        return (raw ?? '')
            .replace(/<think>[\s\S]*?<\/think>/gi, '')
            .replace(/<thinking>[\s\S]*?<\/thinking>/gi, '')
            .replace(/```[\s\S]*?```/g, '')
            .replace(/<[^>]+>/g, '')
            .replace(/^\s*\S{1,15}[:：]\s*/m, '')
            .trim();
    }

    function splitToSentences(str) {
        return (str || '').split(/\s*\/\s*/).map(s => s.trim()).filter(s => s.length > 0).slice(0, 8);
    }

    async function fetchSMS(userMsg) {
        const c = getCtx();
        conversationHistory.push({ role: 'user', content: userMsg });

        const ctxData = await gatherContext();
        const { cardDesc, cardPersonality, cardScenario, cardFirstMes, cardMesExample, mainChatText, worldBookText } = ctxData;

        const smsHistoryText = conversationHistory.slice(-CONTEXT_LIMIT).map(m =>
            m.role === 'user' ? `用户：${cleanResponse(m.content)}` : `${currentPersona}：${cleanResponse(m.content)}`
        ).join('\n');

        const contextBlockMain = [
            cardScenario   ? `【场景参考】\n${cardScenario}` : '',
            cardMesExample ? `【对话示例】\n${cardMesExample}` : '',
        ].filter(Boolean).join('\n\n');

        const injectedInstruction = `

[短信模式指令——最高优先级]
当前角色：${currentPersona}
以${currentPersona}的身份用手机短信方式回复，保持角色性格。

${contextBlockMain ? contextBlockMain + '\n\n' : ''}规则：
- 只输出短信文字，3到8句，每句用 / 分隔
- 禁止旁白、心理描写、场景描述、角色名前缀
- 禁止任何标签或格式符号（包括 <think>、markdown 代码块）
- 禁止输出选项、分支、ABCD选择题、走向提示
- 禁止输出任何超出短信内容本身的附加内容
- 特殊格式（必须用中文关键字）：
    转账：(转账+金额)，例 (转账+99.00)
    图片：(图片+描述)，例 (图片+一张猫的照片)
    语音：(语音+内容)，例 (语音+我刚下班路上)
- 严禁使用 (Voice+...)、(Image+...)、(Transfer+...) 等英文格式
- 偶尔可使用 (语音+内容) 让对话更自然

短信对话历史：
${smsHistoryText}

用户：${userMsg}
${currentPersona}：`;

        try {
            let raw = '';
            const cfg = window.__pmConfig;
            const useIndep = cfg.useIndependent && cfg.apiUrl && cfg.apiKey;

            if (useIndep) {
                const systemPrompt = [
                    `你正在扮演"${currentPersona}"通过手机短信与用户聊天。`,
                    cardDesc        ? `【角色设定】\n${cardDesc}` : '',
                    cardPersonality ? `【性格】\n${cardPersonality}` : '',
                    cardScenario    ? `【场景】\n${cardScenario}` : '',
                    cardFirstMes    ? `【开场白参考】\n${cardFirstMes}` : '',
                    cardMesExample  ? `【对话示例】\n${cardMesExample}` : '',
                    worldBookText   ? `【世界书】\n${worldBookText}` : '',
                    mainChatText    ? `【主线最近对话】\n${mainChatText}` : '',
                    '',
                    '只输出3到8句短信，每句用 / 分隔。',
                    '特殊格式（必须中文）：(转账+金额) (图片+描述) (语音+内容)。严禁英文格式。',
                    '禁止任何标签格式旁白选项。',
                ].filter(Boolean).join('\n\n');

                const messages = [
                    { role: 'system', content: systemPrompt },
                    ...conversationHistory.slice(-CONTEXT_LIMIT).map(m => ({ role: m.role, content: cleanResponse(m.content) }))
                ];

                const { chatUrl } = normalizeApiUrls(cfg.apiUrl);
                const resp = await fetch(chatUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${cfg.apiKey}` },
                    body: JSON.stringify({ model: cfg.model || 'gpt-4o-mini', messages, max_tokens: 300, temperature: 0.85 })
                });
                const json = await resp.json();
                raw = json.choices?.[0]?.message?.content ?? '';
            } else {
                raw = await c.generateQuietPrompt(injectedInstruction, false, false);
            }

            console.log('[phone-mode] raw response length:', (raw || '').length, '|', JSON.stringify((raw || '').slice(0, 200)));

            const clean = cleanResponse(raw);
            let sentences = splitToSentences(clean);

            if (sentences.length === 0 && raw && raw.trim()) {
                console.warn('[phone-mode] 清洗后为空，尝试用原始 raw 兜底');
                sentences = splitToSentences(raw.replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/<[^>]+>/g, ''));
            }

            if (sentences.length === 0) {
                const mode = useIndep ? '独立API' : '主API';
                if (!raw || !raw.trim()) {
                    sentences = [`（${mode} 空响应：可能超时/限流/预设过长，建议切换API或精简预设）`];
                } else {
                    sentences = [`（${mode} 返回格式无法解析，已记录到控制台 F12）`];
                }
                console.warn('[phone-mode] 最终空响应，raw=', JSON.stringify(raw));
            }

            conversationHistory.push({ role: 'assistant', content: sentences.join(' / ') });

            const id = getStorageId();
            if (!window.__pmHistories[id]) window.__pmHistories[id] = {};
            window.__pmHistories[id][currentPersona] = conversationHistory.slice(-SAVE_LIMIT);
            try { localStorage.setItem('ST_SMS_DATA_V2', JSON.stringify(window.__pmHistories)); } catch {}

            applyBidirectionalInjection();
            return sentences;
        } catch (e) {
            console.error('[phone-mode] 请求异常', e);
            return [`（错误：${e?.message || String(e) || '未知错误'}）`];
        }
    }

    function addBubble(text, side) {
        const list = phoneWindow?.querySelector('.pm-msg-list');
        if (!list) return;
        createBubbles(text, side).forEach(b => {
            b.dataset.side = side;
            b.dataset.text = text;
            list.appendChild(b);
        });
        list.scrollTop = list.scrollHeight;
    }
    function addNote(text) {
        const list = phoneWindow?.querySelector('.pm-msg-list');
        if (!list) return;
        const n = document.createElement('div');
        n.className = 'pm-note';
        n.textContent = text;
        list.appendChild(n);
        list.scrollTop = list.scrollHeight;
    }
    function showTyping() {
        const list = phoneWindow?.querySelector('.pm-msg-list');
        if (!list || document.getElementById('pm-typing')) return;
        const t = document.createElement('div');
        t.id = 'pm-typing';
        t.className = 'pm-bubble pm-left pm-typing-bubble';
        t.innerHTML = '<span></span><span></span><span></span>';
        list.appendChild(t);
        list.scrollTop = list.scrollHeight;
    }
    function hideTyping() { document.getElementById('pm-typing')?.remove(); }

    window.__pmSend = async () => {
        if (isGenerating) return;
        const input = phoneWindow.querySelector('.pm-input');
        const val = input.value.trim();
        if (!val) return;
        input.value = '';

        const protect = val.replace(/[\(（][^)）]+[\)\）]/g, m => m.replace(/\//g, '\u0001'));
        protect.split(/[/／]/).map(s => s.replace(/\u0001/g, '/').trim()).filter(Boolean)
            .forEach(chunk => addBubble(chunk, 'right'));

        isGenerating = true;
        input.disabled = true;
        const btn = phoneWindow.querySelector('.pm-up-btn');
        if (btn) btn.disabled = true;

        showTyping();
        const sentences = await fetchSMS(val);
        hideTyping();

        for (const s of sentences) {
            await new Promise(r => setTimeout(r, 150));
            addBubble(s, 'left');
        }

        isGenerating = false;
        input.disabled = false;
        if (btn) btn.disabled = false;
        input.focus();
    };

    window.__pmToggleSelect = () => {
        isSelectMode = !isSelectMode;
        const list = phoneWindow?.querySelector('.pm-msg-list');
        const trashBtn = phoneWindow?.querySelector('.pm-trash-btn');
        const confirmBar = phoneWindow?.querySelector('.pm-confirm-bar');
        if (!list) return;
        if (isSelectMode) {
            trashBtn.style.color = '#ff3b30';
            confirmBar.style.display = 'flex';
            list.querySelectorAll('.pm-bubble').forEach(b => {
                if (b.id === 'pm-typing') return;
                const wrap = document.createElement('div');
                wrap.className = 'pm-select-wrap';
                const cb = document.createElement('input');
                cb.type = 'checkbox'; cb.className = 'pm-checkbox';
                b.parentNode.insertBefore(wrap, b);
                wrap.appendChild(cb); wrap.appendChild(b);
                wrap.dataset.side = b.dataset.side;
                wrap.dataset.text = b.dataset.text;
            });
        } else {
            trashBtn.style.color = '';
            confirmBar.style.display = 'none';
            list.querySelectorAll('.pm-select-wrap').forEach(wrap => {
                const b = wrap.querySelector('.pm-bubble');
                if (b) wrap.parentNode.insertBefore(b, wrap);
                wrap.remove();
            });
        }
    };

    window.__pmDeleteSelected = () => {
        const list = phoneWindow?.querySelector('.pm-msg-list');
        if (!list) return;
        const toDelete = new Set();
        list.querySelectorAll('.pm-select-wrap').forEach(wrap => {
            const cb = wrap.querySelector('.pm-checkbox');
            if (cb?.checked) { toDelete.add(wrap.dataset.text); wrap.remove(); }
            else {
                const b = wrap.querySelector('.pm-bubble');
                if (b) wrap.parentNode.insertBefore(b, wrap);
                wrap.remove();
            }
        });
        if (toDelete.size > 0) {
            conversationHistory = conversationHistory.filter(m => {
                const parts = m.content.split(/\s*\/\s*/);
                return !parts.some(p => toDelete.has(p.trim()));
            });
            const id = getStorageId();
            if (!window.__pmHistories[id]) window.__pmHistories[id] = {};
            window.__pmHistories[id][currentPersona] = conversationHistory.slice(-SAVE_LIMIT);
            try { localStorage.setItem('ST_SMS_DATA_V2', JSON.stringify(window.__pmHistories)); } catch {}
            applyBidirectionalInjection();
        }
        isSelectMode = false;
        const trashBtn = phoneWindow?.querySelector('.pm-trash-btn');
        const confirmBar = phoneWindow?.querySelector('.pm-confirm-bar');
        if (trashBtn) trashBtn.style.color = '';
        if (confirmBar) confirmBar.style.display = 'none';
    };

    window.__pmShowModelPicker = () => {
        const existing = document.getElementById('pm-model-dropdown');
        if (existing) { existing.remove(); return; }
        if (!__pmModelList.length) {
            const status = document.getElementById('pm-api-status');
            if (status) { status.textContent = '⚠️ 请先点"连接拉取模型"获取模型列表'; status.style.color = '#ff9500'; }
            return;
        }
        const input = document.getElementById('pm-cfg-model');
        const inputRect = input.getBoundingClientRect();
        const dd = document.createElement('div');
        dd.id = 'pm-model-dropdown';
        dd.className = 'pm-model-dropdown';
        dd.innerHTML = `
            <input class="pm-model-search" placeholder="🔍 搜索模型..." />
            <div class="pm-model-options"></div>`;
        dd.style.left = inputRect.left + 'px';
        dd.style.top = (inputRect.bottom + 4) + 'px';
        dd.style.width = inputRect.width + 'px';
        document.body.appendChild(dd);
        const optsDiv = dd.querySelector('.pm-model-options');
        const renderOpts = (filter='') => {
            const f = filter.toLowerCase();
            const filtered = __pmModelList.filter(m => !f || m.toLowerCase().includes(f));
            optsDiv.innerHTML = filtered.length
                ? filtered.map(m => `<div class="pm-model-opt" data-m="${escapeAttr(m)}" title="${escapeAttr(m)}">${escapeHtml(m)}</div>`).join('')
                : '<div class="pm-model-empty">无匹配</div>';
            optsDiv.querySelectorAll('.pm-model-opt').forEach(el => {
                el.addEventListener('click', () => {
                    document.getElementById('pm-cfg-model').value = el.dataset.m;
                    dd.remove();
                });
            });
        };
        renderOpts();
        const search = dd.querySelector('.pm-model-search');
        search.addEventListener('input', () => renderOpts(search.value));
        search.focus();
        setTimeout(() => {
            const closer = (e) => {
                if (!dd.contains(e.target) && e.target.id !== 'pm-model-arrow') {
                    dd.remove();
                    document.removeEventListener('click', closer, true);
                }
            };
            document.addEventListener('click', closer, true);
        }, 0);
    };

    window.__pmShowConfig = () => {
        document.getElementById('pm-overlay')?.remove();
        loadProfiles();
        const cfg = window.__pmConfig;
        const shortUrl = (u) => (u || '').replace(/^https?:\/\//, '').replace(/\/+$/, '');
        const maskKey = (k) => !k ? '' : (k.length <= 8 ? '****' : k.slice(0, 4) + '****' + k.slice(-4));
        const profilesHtml = window.__pmProfiles.length > 0
            ? window.__pmProfiles.map((p, i) => `
                <div class="pm-prof-li">
                    <div class="pm-prof-info" onclick="window.__pmPickProfile(${i})">
                        <div class="pm-prof-url">${escapeHtml(shortUrl(p.apiUrl))}</div>
                        <div class="pm-prof-meta">${escapeHtml(maskKey(p.apiKey))}${p.model ? ' · ' + escapeHtml(p.model) : ''}</div>
                    </div>
                    <i class="pm-prof-del" onclick="window.__pmDeleteProfile(${i})">✕</i>
                </div>`).join('')
            : '<div class="pm-prof-empty">暂无已保存档案，连接成功后会自动保存</div>';
        const useIndep = !!cfg.useIndependent;
        const modeTip = useIndep ? '🔌 当前：独立API' : '🏠 当前：主API';

        const ov = document.createElement('div');
        ov.id = 'pm-overlay';
        ov.innerHTML = `
<div class="pm-modal pm-modal-wide">
  <div class="pm-modal-header">
    <b>API 配置</b>
    <span onclick="document.getElementById('pm-overlay').remove()" class="pm-modal-close">✕</span>
  </div>
  <div class="pm-modal-scroll">
    <div style="padding:12px 14px 6px;">
      <div class="pm-cfg-label" style="margin-bottom:6px;">⚡ API 模式</div>
      <div class="pm-mode-switch">
        <div id="pm-mode-main" class="pm-mode-opt ${!useIndep ? 'pm-mode-active' : ''}" onclick="window.__pmSetMode(false)">🏠 主API</div>
        <div id="pm-mode-indep" class="pm-mode-opt ${useIndep ? 'pm-mode-active' : ''}" onclick="window.__pmSetMode(true)">🔌 独立API</div>
      </div>
      <div id="pm-mode-tip" class="pm-cfg-tip" style="text-align:left;padding:6px 2px 0;">${modeTip}</div>
    </div>
    <div style="padding:6px 14px 4px;border-top:1px solid #f0f0f0;">
      <div class="pm-cfg-label" style="margin:8px 0 6px;">📚 已保存档案（点击载入）</div>
      <div class="pm-prof-list">${profilesHtml}</div>
    </div>
    <div style="padding:10px 16px;display:flex;flex-direction:column;gap:10px;border-top:1px solid #f0f0f0;">
      <div class="pm-cfg-label">API 地址</div>
      <input id="pm-cfg-url" class="pm-cfg-input" placeholder="https://api.xxx.com 或 .../v1" value="${escapeAttr(cfg.apiUrl || '')}">
      <div class="pm-cfg-label">API Key</div>
      <input id="pm-cfg-key" class="pm-cfg-input" placeholder="sk-..." type="text" value="${escapeAttr(cfg.apiKey || '')}" maxlength="999">
      <div class="pm-cfg-label">模型名称</div>
      <div class="pm-model-row">
        <input id="pm-cfg-model" class="pm-cfg-input" placeholder="可手动输入或点右侧 ▼ 选择" value="${escapeAttr(cfg.model || '')}">
        <button id="pm-model-arrow" type="button" onclick="window.__pmShowModelPicker()" title="从列表选择模型">▼</button>
      </div>
      <div id="pm-api-status" class="pm-cfg-tip" style="font-weight:bold;">连接成功后会自动保存档案</div>
    </div>
  </div>
  <div class="pm-modal-add" style="display:flex;flex-direction:column;gap:6px;">
    <div style="display:flex;gap:6px;">
      <button onclick="window.__pmTestApi()" style="flex:1;background:#ff9500;color:#fff;border:none;border-radius:10px;padding:9px;font-size:12px;cursor:pointer;font-weight:600;">🔗 连接拉取模型</button>
      <button onclick="window.__pmTestModel()" style="flex:1;background:#5856d6;color:#fff;border:none;border-radius:10px;padding:9px;font-size:12px;cursor:pointer;font-weight:600;">🧪 测试模型</button>
    </div>
    <button onclick="window.__pmSaveConfig()" style="background:#007aff;color:#fff;border:none;border-radius:10px;padding:10px;font-size:13px;cursor:pointer;font-weight:600;">保存配置</button>
  </div>
</div>`;
        ov.addEventListener('click', e => { if (e.target === ov) ov.remove(); });
        document.body.appendChild(ov);
    };

    window.__pmTestApi = async () => {
        const urlInput = document.getElementById('pm-cfg-url').value.trim();
        const keyInput = document.getElementById('pm-cfg-key').value.trim();
        const modelInput = document.getElementById('pm-cfg-model').value.trim();
        const status = document.getElementById('pm-api-status');
        if (!urlInput) { status.textContent = "❌ 请先填写 API 地址"; status.style.color = "#ff3b30"; return; }
        status.textContent = "正在测试连接并拉取模型..."; status.style.color = "#007aff";
        const { modelsUrl } = normalizeApiUrls(urlInput);
        try {
            const res = await fetch(modelsUrl, { method: 'GET', headers: { 'Authorization': `Bearer ${keyInput}` } });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            if (data && data.data && Array.isArray(data.data)) {
                __pmModelList = data.data.map(m => m.id).filter(Boolean);
                status.textContent = `✅ 连接成功！获取到 ${__pmModelList.length} 个模型，点 ▼ 选择`;
                status.style.color = "#34c759";
            } else {
                status.textContent = "✅ 连接成功！(接口不返回模型列表，请手动输入)";
                status.style.color = "#34c759";
            }
            addOrUpdateProfile({ apiUrl: urlInput, apiKey: keyInput, model: modelInput });
        } catch (err) {
            status.textContent = "❌ 连接失败：" + err.message;
            status.style.color = "#ff3b30";
        }
    };

    window.__pmTestModel = async () => {
        const urlInput = document.getElementById('pm-cfg-url').value.trim();
        const keyInput = document.getElementById('pm-cfg-key').value.trim();
        const modelInput = document.getElementById('pm-cfg-model').value.trim();
        const status = document.getElementById('pm-api-status');
        if (!urlInput || !keyInput || !modelInput) {
            status.textContent = '❌ 请填写完整配置（地址、Key、模型）';
            status.style.color = '#ff3b30'; return;
        }
        status.textContent = `正在测试模型「${modelInput}」推理...`;
        status.style.color = '#007aff';
        const { chatUrl } = normalizeApiUrls(urlInput);
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 15000);
        try {
            const resp = await fetch(chatUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${keyInput}` },
                body: JSON.stringify({ model: modelInput, messages: [{ role: 'user', content: 'hi' }], max_tokens: 16 }),
                signal: ctrl.signal,
            });
            clearTimeout(timer);
            if (!resp.ok) {
                const t = await resp.text();
                throw new Error(`HTTP ${resp.status}: ${t.slice(0, 80)}`);
            }
            const json = await resp.json();
            const reply = json.choices?.[0]?.message?.content;
            if (reply !== undefined && reply !== null) {
                status.textContent = `✅ 模型可用！返回："${String(reply).slice(0, 25)}"`;
                status.style.color = '#34c759';
            } else {
                status.textContent = '⚠️ 返回格式异常，但接口已响应';
                status.style.color = '#ff9500';
            }
        } catch (e) {
            clearTimeout(timer);
            status.textContent = '❌ 模型测试失败：' + (e.name === 'AbortError' ? '15秒超时' : e.message);
            status.style.color = '#ff3b30';
        }
    };

    window.__pmSaveConfig = () => {
        const apiUrl = document.getElementById('pm-cfg-url')?.value.trim() ?? '';
        const apiKey = document.getElementById('pm-cfg-key')?.value.trim() ?? '';
        const model  = document.getElementById('pm-cfg-model')?.value.trim() ?? '';
        window.__pmConfig = { apiUrl, apiKey, model, useIndependent: !!window.__pmConfig.useIndependent };
        try { localStorage.setItem('ST_SMS_CONFIG', JSON.stringify(window.__pmConfig)); } catch {}
        if (apiUrl && apiKey) addOrUpdateProfile({ apiUrl, apiKey, model });
        document.getElementById('pm-overlay')?.remove();
        const list = phoneWindow?.querySelector('.pm-msg-list');
        if (list) {
            const useIndep = window.__pmConfig.useIndependent && window.__pmConfig.apiUrl && window.__pmConfig.apiKey;
            const n = document.createElement('div');
            n.className = 'pm-note';
            n.textContent = `已保存，当前使用：${useIndep ? '独立API' : '主API'}`;
            list.appendChild(n);
            list.scrollTop = list.scrollHeight;
        }
    };

    window.__pmShowList = () => {
        document.getElementById('pm-overlay')?.remove();
        const id = getStorageId();
        const list = Object.keys(window.__pmHistories[id] || {});
        const checked = window.__pmBidirectional[id] || [];

        const ov = document.createElement('div');
        ov.id = 'pm-overlay';
        ov.innerHTML = `
<div class="pm-modal">
  <div class="pm-modal-header">
    <b>联系人</b>
    <span onclick="document.getElementById('pm-overlay').remove()" class="pm-modal-close">✕</span>
  </div>
  <div class="pm-bi-bar">
    <span>🧠 双向记忆：勾选的角色可被主楼读取短信内容</span>
    <span class="pm-bi-tip">已选 ${checked.length}/${MAX_BIDIRECTIONAL}</span>
  </div>
  <div class="pm-modal-list">
    ${list.length > 0
        ? list.map(n => {
            const isChk = checked.includes(n);
            return `
    <div class="pm-li">
      <input type="checkbox" class="pm-bi-check" ${isChk ? 'checked' : ''} onclick="event.stopPropagation();window.__pmToggleBidirectional('${n.replace(/'/g,"\\'")}')" title="加入主楼记忆">
      <span onclick="window.__pmSwitch('${n.replace(/'/g,"\\'")}')">${escapeHtml(n)}</span>
      <i onclick="window.__pmDel('${n.replace(/'/g,"\\'")}')">删除</i>
    </div>`;
        }).join('')
        : '<div style="text-align:center;color:#999;padding:20px;font-size:13px;">暂无联系人</div>'
    }
  </div>
  <div class="pm-modal-add">
    <input id="pm-add-input" placeholder="输入角色名...">
    <button onclick="window.__pmSwitch(document.getElementById('pm-add-input').value.trim())">开始聊天</button>
  </div>
</div>`;
        ov.addEventListener('click', e => { if (e.target === ov) ov.remove(); });
        document.body.appendChild(ov);
        setTimeout(() => {
            document.getElementById('pm-add-input')?.addEventListener('keydown', e => {
                if (e.key === 'Enter') window.__pmSwitch(document.getElementById('pm-add-input').value.trim());
            });
        }, 0);
    };

    window.__pmSwitch = (name) => {
        if (!name?.trim()) return;
        name = name.trim();
        document.getElementById('pm-overlay')?.remove();
        const id = getStorageId();
        currentPersona = name;
        conversationHistory = window.__pmHistories[id]?.[name] ?? [];
        if (phoneWindow) {
            phoneWindow.querySelector('.pm-name').textContent = name;
            const list = phoneWindow.querySelector('.pm-msg-list');
            list.innerHTML = '';
            if (conversationHistory.length > 0) {
                addNote(`与 ${name} 的历史记录`);
                conversationHistory.forEach(m => {
                    const protect = m.content.replace(/[\(（][^)）]+[\)\）]/g, mm => mm.replace(/\//g, '\u0001'));
                    protect.split(/\s*\/\s*/).map(s => s.replace(/\u0001/g, '/').trim()).filter(Boolean)
                        .forEach(s => addBubble(s, m.role === 'user' ? 'right' : 'left'));
                });
                addNote('── 以上为历史记录 ──');
            } else {
                addNote(`开始与 ${name} 的对话`);
            }
        }
        applyBidirectionalInjection();
    };

    window.__pmDel = (name) => {
        const id = getStorageId();
        if (window.__pmHistories[id]) delete window.__pmHistories[id][name];
        try { localStorage.setItem('ST_SMS_DATA_V2', JSON.stringify(window.__pmHistories)); } catch {}
        const arr = window.__pmBidirectional[id] || [];
        const idx = arr.indexOf(name);
        if (idx >= 0) { arr.splice(idx, 1); window.__pmBidirectional[id] = arr; saveBidirectional(); }
        applyBidirectionalInjection();
        window.__pmShowList();
    };

    window.__pmToggleMin = () => { isMinimized = !isMinimized; phoneWindow.classList.toggle('is-min', isMinimized); };
    window.__pmEnd = () => { phoneWindow?.remove(); phoneWindow = null; phoneActive = false; isMinimized = false; isSelectMode = false; };

    function ensureVisibility() {
        if (!phoneWindow) return;
        const cs = getComputedStyle(phoneWindow);
        if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity || '1') < 0.1) {
            phoneWindow.style.setProperty('display', 'flex', 'important');
            phoneWindow.style.setProperty('visibility', 'visible', 'important');
            phoneWindow.style.setProperty('opacity', '1', 'important');
        }
        if (parseInt(cs.zIndex) < 100000) {
            phoneWindow.style.setProperty('z-index', '2147483647', 'important');
        }
    }
    setInterval(ensureVisibility, 2000);

    if (window.visualViewport) {
        window.visualViewport.addEventListener('resize', () => {
            if (phoneWindow) ensureVisibility();
        });
    }

    window.__pmOpen = () => {
        if (phoneActive && phoneWindow) { phoneWindow.style.display = 'flex'; ensureVisibility(); return; }
        try { window.__pmHistories = JSON.parse(localStorage.getItem('ST_SMS_DATA_V2')) || {}; } catch {}
        try {
            const saved = JSON.parse(localStorage.getItem('ST_SMS_CONFIG'));
            window.__pmConfig = saved || { apiUrl: '', apiKey: '', model: '', useIndependent: false };
            if (typeof window.__pmConfig.useIndependent === 'undefined') {
                window.__pmConfig.useIndependent = !!(window.__pmConfig.apiUrl && window.__pmConfig.apiKey);
            }
        } catch { window.__pmConfig = { apiUrl: '', apiKey: '', model: '', useIndependent: false }; }
        loadProfiles();
        loadBidirectional();
        migrateOldHistory();

        const c = getCtx();
        const defaultChar = c?.characters?.[c.characterId]?.name ?? 'AI';

        phoneWindow = document.createElement('div');
        phoneWindow.id = 'pm-iphone';
        phoneWindow.innerHTML = `
<div class="pm-island"></div>
<div class="pm-main-ui">
  <div class="pm-navbar">
    <button onclick="window.__pmShowList()" class="pm-nav-btn" title="联系人" style="justify-self:start;">☰</button>
    <div class="pm-name">${escapeHtml(defaultChar)}</div>
    <div style="display:flex;gap:2px;justify-content:flex-end;">
      <button onclick="window.__pmToggleSelect()" class="pm-nav-btn pm-trash-btn" title="删除消息">🗑</button>
      <button onclick="window.__pmShowConfig()" class="pm-nav-btn" title="API设置">⚙</button>
      <button onclick="window.__pmEnd()" class="pm-nav-btn" style="color:#ff3b30" title="关闭">✕</button>
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

        // 🔧 挂到 <html> 而非 <body>，避免 body 内层 transform 容器破坏 fixed 定位
        (document.documentElement || document.body).appendChild(phoneWindow);
        phoneActive = true;
        phoneWindow.querySelector('.pm-input').addEventListener('keydown', e => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); window.__pmSend(); }
        });
        bindIsland(phoneWindow, phoneWindow.querySelector('.pm-island'));
        window.__pmSwitch(defaultChar);
        applyBidirectionalInjection();
        ensureVisibility();
    };

    if (!document.getElementById('pm-css')) {
        const s = document.createElement('style');
        s.id = 'pm-css';
        s.textContent = `
#pm-iphone {
    position: fixed !important;
    bottom: 40px !important;
    right: 40px !important;
    top: auto !important;
    left: auto !important;
    margin: 0 !important;
    width: 330px !important; height: 580px !important;
    min-width: 330px !important; max-width: 330px !important;
    min-height: 580px !important; max-height: 580px !important;
    background: #fff !important; border: 10px solid #1a1a1a !important;
    border-radius: 45px !important; z-index: 2147483647 !important;
    display: flex !important; flex-direction: column !important;
    visibility: visible !important; opacity: 1 !important;
    overflow: hidden !important;
    box-shadow: 0 20px 60px rgba(0,0,0,0.45) !important;
    transition: 0.35s cubic-bezier(0.18, 0.89, 0.32, 1.2);
    font-family: -apple-system, BlinkMacSystemFont, 'PingFang SC', 'Microsoft YaHei', sans-serif !important;
    touch-action: none; box-sizing: border-box !important;
    pointer-events: auto !important;
    transform: none !important;
    filter: none !important;
}
#pm-iphone.is-min {
    height: 50px !important; min-height: 50px !important; max-height: 50px !important;
    width: 140px !important; min-width: 140px !important; max-width: 140px !important;
    border-radius: 25px !important; border-width: 6px !important;
}
#pm-iphone.is-min .pm-main-ui { display: none !important; }
#pm-iphone *, #pm-iphone *::before, #pm-iphone *::after { box-sizing: border-box; }
.pm-island { width: 100px; height: 28px; background: #1a1a1a; margin: 8px auto 4px; border-radius: 14px; cursor: move; flex-shrink: 0; touch-action: none; }
.pm-main-ui { flex: 1 !important; display: flex !important; flex-direction: column !important; overflow: hidden; min-height: 0; }
.pm-navbar { display: grid !important; grid-template-columns: 1fr auto 1fr; align-items: center; padding: 6px 10px; border-bottom: 1px solid #f0f0f0; flex-shrink: 0; }
.pm-name { font-weight: 700 !important; color: #000 !important; font-size: 15px !important; text-align: center; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; padding: 0 4px; }
.pm-nav-btn { background: none !important; border: none !important; font-size: 18px !important; cursor: pointer; color: #007aff !important; padding: 3px !important; line-height: 1; flex-shrink: 0; }
.pm-confirm-bar { background: #fff8f0; border-bottom: 1px solid #ffe0b0; padding: 7px 12px; align-items: center; gap: 8px; flex-shrink: 0; }
.pm-confirm-tip { flex: 1; font-size: 12px; color: #888; }
.pm-confirm-btn { background: #ff3b30 !important; color: #fff !important; border: none; border-radius: 8px; padding: 5px 12px; font-size: 12px; cursor: pointer; font-weight: 600; font-family: inherit; }
.pm-cancel-btn { background: #f0f0f0 !important; color: #333 !important; border: none; border-radius: 8px; padding: 5px 12px; font-size: 12px; cursor: pointer; font-family: inherit; }
.pm-msg-list { flex: 1 !important; overflow-y: auto !important; padding: 12px !important; display: flex !important; flex-direction: column !important; gap: 7px; background: #fff !important; min-height: 0; box-sizing: border-box; }
.pm-select-wrap { display: flex !important; align-items: flex-end; gap: 6px; }
.pm-checkbox { width: 20px; height: 20px; cursor: pointer; flex-shrink: 0; margin-bottom: 4px; accent-color: #007aff; opacity: 0.4; transition: opacity 0.15s; }
.pm-checkbox:checked { opacity: 1; }
.pm-bubble { max-width: 74% !important; padding: 9px 13px; border-radius: 18px !important; font-size: 14px !important; line-height: 1.45; word-break: break-word; animation: pm-pop 0.22s ease-out; }
.pm-bubble.pm-special { background: transparent !important; box-shadow: none !important; padding: 0 !important; }
@keyframes pm-pop { from { opacity: 0; transform: scale(0.92) translateY(4px); } to { opacity: 1; transform: scale(1) translateY(0); } }
.pm-right { align-self: flex-end !important; background: #007aff !important; color: #fff !important; border-bottom-right-radius: 4px !important; }
.pm-left { align-self: flex-start !important; background: #e9e9eb !important; color: #000 !important; border-bottom-left-radius: 4px !important; }
.pm-typing-bubble { display: flex !important; gap: 5px; align-items: center; padding: 11px 15px !important; width: fit-content; }
.pm-typing-bubble span { width: 7px; height: 7px; border-radius: 50%; background: #999; display: inline-block; animation: pm-bounce 1.2s infinite; }
.pm-typing-bubble span:nth-child(2) { animation-delay: 0.2s; }
.pm-typing-bubble span:nth-child(3) { animation-delay: 0.4s; }
@keyframes pm-bounce { 0%,60%,100% { transform: translateY(0); } 30% { transform: translateY(-5px); } }
.pm-note { text-align: center; font-size: 11px; color: #bbb; padding: 3px 0; }
.pm-transfer-card { background: linear-gradient(135deg, #ff9500, #ff6b00); color: #fff; border-radius: 14px; padding: 12px 14px; display: flex; align-items: center; gap: 10px; min-width: 150px; box-shadow: 0 3px 10px rgba(255,149,0,0.35); }
.pm-t-icon { width: 34px; height: 34px; background: rgba(255,255,255,0.25); border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 17px; font-weight: 800; }
.pm-t-info { display: flex; flex-direction: column; gap: 1px; }
.pm-t-info b { font-size: 12px; opacity: 0.85; }
.pm-t-info span { font-size: 17px; font-weight: 700; }
.pm-img-card { background: #f2f2f7; border: 1px solid #e0e0e0; padding: 12px 14px; border-radius: 14px; color: #555; font-size: 13px; text-align: center; }

.pm-voice-wrap { display: flex; flex-direction: column; gap: 4px; align-items: inherit; }
.pm-special.pm-right .pm-voice-wrap { align-items: flex-end; }
.pm-special.pm-left .pm-voice-wrap { align-items: flex-start; }
.pm-voice-card { display: flex; align-items: center; gap: 10px; padding: 10px 14px; border-radius: 18px; cursor: pointer; user-select: none; transition: filter 0.15s; }
.pm-voice-card:hover { filter: brightness(0.96); }
.pm-voice-right { background: #007aff; color: #fff; border-bottom-right-radius: 4px; flex-direction: row-reverse; }
.pm-voice-left { background: #e9e9eb; color: #333; border-bottom-left-radius: 4px; }
.pm-voice-icon { font-size: 14px; flex-shrink: 0; }
.pm-voice-wave { flex: 1; display: flex; gap: 3px; align-items: center; height: 16px; min-width: 20px; }
.pm-voice-wave i { display: inline-block; width: 3px; background: currentColor; opacity: 0.7; border-radius: 2px; animation: pm-wave 1s infinite ease-in-out; }
.pm-voice-wave i:nth-child(1) { height: 8px; animation-delay: 0s; }
.pm-voice-wave i:nth-child(2) { height: 14px; animation-delay: 0.2s; }
.pm-voice-wave i:nth-child(3) { height: 10px; animation-delay: 0.4s; }
@keyframes pm-wave { 0%,100% { transform: scaleY(0.5); } 50% { transform: scaleY(1); } }
.pm-voice-dur { font-size: 12px; opacity: 0.85; min-width: 34px; text-align: right; flex-shrink: 0; font-variant-numeric: tabular-nums; }
.pm-voice-text { background: #f7f7f9; border: 1px solid #e5e5e8; color: #333; padding: 7px 10px; border-radius: 10px; font-size: 13px; line-height: 1.4; max-width: 220px; word-break: break-word; position: relative; }
.pm-voice-text::before { content: '已转文字'; position: absolute; top: -8px; left: 8px; font-size: 9px; color: #999; background: #fff; padding: 0 4px; border-radius: 4px; }

.pm-input-bar { padding: 8px 12px 30px !important; display: flex !important; gap: 8px; border-top: 1px solid #f0f0f0; align-items: center; background: #fff !important; flex-shrink: 0; box-sizing: border-box; }
.pm-input { flex: 1 !important; min-width: 0 !important; background: #f2f2f7 !important; color: #000 !important; border: none !important; border-radius: 20px !important; padding: 9px 14px !important; outline: none !important; font-size: 14px !important; font-family: inherit !important; box-sizing: border-box !important; }
.pm-input:disabled { opacity: 0.5; }
.pm-up-btn { width: 32px !important; height: 32px !important; background: #007aff !important; color: #fff !important; border: none !important; border-radius: 50% !important; cursor: pointer; font-size: 16px !important; font-weight: bold; display: flex !important; align-items: center !important; justify-content: center !important; flex-shrink: 0; }
.pm-up-btn:disabled { background: #ccc !important; cursor: default; }

#pm-overlay { position: fixed !important; inset: 0 !important; background: rgba(0,0,0,0.45) !important; z-index: 2147483647 !important; display: flex !important; align-items: center !important; justify-content: center !important; }
.pm-modal { background: #fff !important; border-radius: 20px !important; width: 290px; max-height: 85vh; display: flex !important; flex-direction: column !important; overflow: hidden; box-shadow: 0 16px 48px rgba(0,0,0,0.28); font-family: -apple-system, BlinkMacSystemFont, 'PingFang SC', sans-serif !important; }
.pm-modal-wide { width: 320px; max-height: 85vh; }
.pm-modal-scroll { flex: 1; overflow-y: auto; min-height: 0; }
.pm-modal-header { display: flex !important; justify-content: space-between !important; align-items: center !important; padding: 16px 18px 12px !important; border-bottom: 1px solid #f0f0f0; flex-shrink: 0; }
.pm-modal-header b { font-size: 16px !important; color: #000 !important; }
.pm-modal-close { font-size: 20px; color: #999; cursor: pointer; line-height: 1; }
.pm-bi-bar { padding: 8px 14px; background: #fff8e8; border-bottom: 1px solid #ffe6a8; font-size: 11px; color: #885d00; display: flex; flex-direction: column; gap: 3px; }
.pm-bi-tip { font-weight: 600; color: #b87a00; }
.pm-modal-list { overflow-y: auto; flex: 1; padding: 6px 8px; max-height: 400px; }
.pm-li { display: flex !important; align-items: center !important; gap: 10px; padding: 10px; border-radius: 12px; }
.pm-li:hover { background: #f5f5f5; }
.pm-li .pm-bi-check { width: 18px; height: 18px; cursor: pointer; flex-shrink: 0; accent-color: #ff9500; }
.pm-li span { flex: 1; font-size: 14px !important; color: #007aff !important; font-weight: 500; cursor: pointer; }
.pm-li i { font-style: normal; font-size: 11px; color: #fff !important; background: #ff3b30 !important; padding: 3px 9px; border-radius: 8px; cursor: pointer; font-weight: 600; flex-shrink: 0; }
.pm-modal-add { padding: 12px 14px 16px; border-top: 1px solid #f0f0f0; display: flex; gap: 8px; flex-shrink: 0; }
.pm-modal-add input { flex: 1; min-width: 0; border: 1px solid #ddd; border-radius: 10px; padding: 9px 12px; font-size: 13px; outline: none; font-family: inherit; color: #000 !important; background: #fff !important; box-sizing: border-box; }
.pm-modal-add button { background: #007aff !important; color: #fff !important; border: none; border-radius: 10px; padding: 9px 14px; font-size: 13px; cursor: pointer; font-weight: 600; white-space: nowrap; font-family: inherit; }
.pm-cfg-label { font-size: 12px; color: #888; margin-bottom: -4px; }
.pm-cfg-input { width: 100%; border: 1px solid #ddd !important; border-radius: 10px !important; padding: 9px 12px; font-size: 13px !important; outline: none; font-family: inherit; color: #000 !important; background: #fff !important; box-sizing: border-box; }
.pm-cfg-tip { font-size: 11px; color: #aaa; text-align: center; padding: 4px 0; }
.pm-mode-switch { display: flex !important; background: #f0f0f3; border-radius: 12px; padding: 3px; gap: 3px; }
.pm-mode-opt { flex: 1; text-align: center; padding: 9px 0; font-size: 13px; font-weight: 600; color: #888; cursor: pointer; border-radius: 9px; transition: all 0.2s; user-select: none; }
.pm-mode-opt:hover { color: #555; }
.pm-mode-active { background: #fff !important; color: #007aff !important; box-shadow: 0 2px 6px rgba(0,0,0,0.08); }
.pm-prof-list { max-height: 130px; overflow-y: auto; border: 1px solid #eee; border-radius: 10px; background: #fafafa; padding: 4px; }
.pm-prof-li { display: flex !important; align-items: center !important; gap: 8px; padding: 7px 9px; border-radius: 8px; transition: background 0.15s; }
.pm-prof-li:hover { background: #fff; }
.pm-prof-info { flex: 1; min-width: 0; cursor: pointer; display: flex; flex-direction: column; gap: 2px; }
.pm-prof-url { font-size: 12px; color: #007aff !important; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.pm-prof-meta { font-size: 10px; color: #999; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.pm-prof-del { font-style: normal; font-size: 12px; color: #ff3b30; background: #fff !important; border: 1px solid #ffd0cc; width: 22px; height: 22px; border-radius: 50%; display: flex !important; align-items: center !important; justify-content: center !important; cursor: pointer; flex-shrink: 0; font-weight: 600; }
.pm-prof-del:hover { background: #ff3b30 !important; color: #fff !important; border-color: #ff3b30; }
.pm-prof-empty { text-align: center; color: #aaa; font-size: 12px; padding: 14px 0; }

.pm-model-row { display: flex; gap: 6px; }
.pm-model-row .pm-cfg-input { flex: 1; }
#pm-model-arrow { background: #f0f0f3; border: 1px solid #ddd; border-radius: 10px; width: 38px; cursor: pointer; font-size: 12px; color: #555; flex-shrink: 0; transition: all 0.15s; }
#pm-model-arrow:hover { background: #007aff; color: #fff; border-color: #007aff; }
.pm-model-dropdown { position: fixed; z-index: 2147483647; background: #fff; border: 1px solid #ddd; border-radius: 12px; box-shadow: 0 8px 24px rgba(0,0,0,0.18); overflow: hidden; display: flex; flex-direction: column; min-width: 200px; }
.pm-model-search { border: none !important; border-bottom: 1px solid #eee !important; padding: 9px 12px !important; outline: none; font-size: 13px !important; background: #fafafa !important; color: #000 !important; box-sizing: border-box; width: 100%; font-family: inherit; }
.pm-model-options { overflow-y: auto; max-height: ${MODEL_VISIBLE_ROWS * 34}px; }
.pm-model-opt { padding: 8px 12px; font-size: 13px; color: #333; cursor: pointer; border-bottom: 1px solid #f5f5f5; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; height: 34px; box-sizing: border-box; line-height: 18px; }
.pm-model-opt:hover { background: #f0f7ff; color: #007aff; }
.pm-model-empty { padding: 14px; text-align: center; font-size: 12px; color: #999; }

/* ═══════════════════════════════════════════ */
/* 🔧 手机端响应式：用 inset:0 + margin:auto 真居中 */
/* ═══════════════════════════════════════════ */
@media (max-width: 500px), (max-height: 700px) {
    #pm-iphone {
        position: fixed !important;
        /* 关键：用 vh/vw 直接定位，不依赖包含块 */
        top: 50vh !important;
        top: 50dvh !important;
        left: 50vw !important;
        right: auto !important;
        bottom: auto !important;
        margin: 0 !important;
        /* translate 相对元素自身，永远准确 */
        transform: translate(-50%, -50%) !important;
        width: min(330px, 92vw) !important;
        height: min(560px, 82vh) !important;
        height: min(560px, 82dvh) !important;
        min-width: 0 !important;
        min-height: 0 !important;
        max-width: 92vw !important;
        max-height: 82vh !important;
        max-height: 82dvh !important;
        border-width: 8px !important;
        border-radius: 36px !important;
    }
    #pm-iphone.is-min {
        top: auto !important;
        left: auto !important;
        bottom: 20px !important;
        right: 20px !important;
        margin: 0 !important;
        transform: none !important;
        width: 120px !important;
        min-width: 120px !important;
        max-width: 120px !important;
        height: 44px !important;
        min-height: 44px !important;
        max-height: 44px !important;
        border-width: 5px !important;
        border-radius: 22px !important;
    }
    .pm-modal, .pm-modal-wide {
        width: min(320px, 94vw) !important;
        max-height: 90vh !important;
        max-height: 90dvh !important;
    }
}
        `;
        document.head.appendChild(s);
    }

    function registerPhoneCommand() {
        const ctx = getCtx();
        if (!ctx) return false;
        const callback = () => { try { window.__pmOpen(); } catch (e) { console.error('[phone-mode] 打开失败', e); } return ''; };
        try {
            const SCP = window.SlashCommandParser || ctx.SlashCommandParser || (window.SillyTavern && window.SillyTavern.libs && window.SillyTavern.libs.SlashCommandParser);
            const SC = window.SlashCommand || ctx.SlashCommand;
            if (SCP && SC && typeof SCP.addCommandObject === 'function' && typeof SC.fromProps === 'function') {
                SCP.addCommandObject(SC.fromProps({ name: 'phone', callback, helpString: '打开短信小手机界面' }));
                console.log('[phone-mode] /phone 已注册（新版）');
                return true;
            }
        } catch (e) { console.warn('[phone-mode] 新版注册失败', e); }
        try {
            if (typeof ctx.registerSlashCommand === 'function') {
                ctx.registerSlashCommand('phone', callback, [], '打开短信小手机界面', true, true);
                console.log('[phone-mode] /phone 已注册（旧版）');
                return true;
            }
        } catch (e) { console.warn('[phone-mode] 旧版注册失败', e); }
        return false;
    }
    if (!registerPhoneCommand()) {
        let tries = 0;
        const timer = setInterval(() => { tries++; if (registerPhoneCommand() || tries >= 30) clearInterval(timer); }, 500);
    }

    document.addEventListener('keydown', e => {
        if (e.key !== 'Enter' || e.shiftKey) return;
        const ta = document.getElementById('send_textarea');
        if (!ta || document.activeElement !== ta) return;
        if (ta.value.trim() === '/phone') { e.preventDefault(); e.stopImmediatePropagation(); ta.value = ''; window.__pmOpen(); }
    }, true);

    document.addEventListener('click', e => {
        const btn = e.target.closest && e.target.closest('#send_but');
        if (!btn) return;
        const ta = document.getElementById('send_textarea');
        if (!ta) return;
        if (ta.value.trim() === '/phone') { e.preventDefault(); e.stopImmediatePropagation(); ta.value = ''; window.__pmOpen(); }
    }, true);

    try { window.__pmHistories = JSON.parse(localStorage.getItem('ST_SMS_DATA_V2')) || {}; } catch {}
    loadBidirectional();
    setTimeout(() => { migrateOldHistory(); applyBidirectionalInjection(); }, 1500);

    console.log('[phone-mode] 已加载 v3.4 — /phone 召唤');
})();
