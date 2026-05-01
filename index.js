(async function () {
    await new Promise(r => setTimeout(r, 1000));

    window.__pmHistories = window.__pmHistories || {};
    window.__pmConfig = window.__pmConfig || { apiUrl: '', apiKey: '', model: '' };

    let phoneActive = false;
    let phoneWindow = null;
    let currentPersona = '';
    let conversationHistory = [];
    let isGenerating = false;
    let isMinimized = false;
    let isSelectMode = false;

    const getCtx = () => typeof SillyTavern !== 'undefined' ? SillyTavern.getContext() : null;

    // ── 拖拽 ──
    function bindIsland(el, handle) {
        let isDragging = false, startX, startY, startL, startT, moved = false;
        const getCoord = (e) => e.touches ? { x: e.touches[0].clientX, y: e.touches[0].clientY } : { x: e.clientX, y: e.clientY };
        const onStart = (e) => {
            if (e.target.tagName === 'BUTTON') return;
            isDragging = true; moved = false;
            const coords = getCoord(e);
            startX = coords.x; startY = coords.y;
            startL = el.offsetLeft; startT = el.offsetTop;
            el.style.transition = 'none';
        };
        const onMove = (e) => {
            if (!isDragging) return;
            const coords = getCoord(e);
            const dx = coords.x - startX, dy = coords.y - startY;
            if (Math.abs(dx) > 5 || Math.abs(dy) > 5) { moved = true; if (e.cancelable) e.preventDefault(); }
            el.style.left = (startL + dx) + 'px';
            el.style.top = (startT + dy) + 'px';
            el.style.bottom = 'auto'; el.style.right = 'auto';
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

    // ── 气泡渲染 ──
    function createBubbles(text, side) {
        const results = [];
        const re = /[\(（]\s*(转账|图片)\s*[+：:\s]*([^)）]+)[\)\）]/g;
        let last = 0, m;
        while ((m = re.exec(text)) !== null) {
            if (m.index > last) {
                const plain = text.slice(last, m.index).trim();
                if (plain) {
                    const b = document.createElement('div');
                    b.className = `pm-bubble pm-${side}`;
                    b.innerHTML = plain.replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>');
                    results.push(b);
                }
            }
            const b = document.createElement('div');
            b.className = `pm-bubble pm-${side}`;
            b.style.cssText = 'background:transparent;box-shadow:none;padding:0;';
            if (m[1] === '转账') {
                const amount = parseFloat(m[2]) || 0;
                b.innerHTML = `<div class="pm-transfer-card"><div class="pm-t-icon">¥</div><div class="pm-t-info"><b>转账</b><span>¥${amount.toFixed(2)}</span></div></div>`;
            } else {
                b.innerHTML = `<div class="pm-img-card">🖼️ ${m[2].trim().replace(/</g,'&lt;')}</div>`;
            }
            results.push(b);
            last = m.index + m[0].length;
        }
        if (last < text.length) {
            const plain = text.slice(last).trim();
            if (plain) {
                const b = document.createElement('div');
                b.className = `pm-bubble pm-${side}`;
                b.innerHTML = plain.replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>');
                results.push(b);
            }
        }
        if (results.length === 0) {
            const b = document.createElement('div');
            b.className = `pm-bubble pm-${side}`;
            b.innerHTML = text.replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>');
            results.push(b);
        }
        return results;
    }

    // ── API 调用（支持独立API） ──
    async function fetchSMS(userMsg) {
        const c = getCtx();
        conversationHistory.push({ role: 'user', content: userMsg });

        const cleanMsg = (s) => s
            .replace(/```[\s\S]*?```/g, '')
            .replace(/<[^>]+>[\s\S]*?<\/[^>]+>/g, '')
            .replace(/<[^>]+>/g, '')
            .trim();

        const historyText = conversationHistory.slice(-8).map(m =>
            m.role === 'user' ? `用户：${cleanMsg(m.content)}` : `${currentPersona}：${cleanMsg(m.content)}`
        ).join('\n');

        const injectedInstruction = `

[短信模式指令——最高优先级]
当前角色：${currentPersona}
以${currentPersona}的身份用手机短信方式回复，保持角色性格。

规则：
- 只输出短信文字，3到8句，每句用 / 分隔
- 禁止旁白、心理描写、场景描述、角色名前缀
- 禁止任何标签或格式符号
- 禁止输出选项、分支、ABCD选择题、走向提示
- 禁止输出任何超出短信内容本身的附加内容
- 特殊格式仅限：(转账+金额) 或 (图片+描述)
- 示例：你来了啊 / 我刚吃完饭 / 等你好久了

最近对话：
${historyText}

用户：${userMsg}
${currentPersona}：`;

        try {
            let raw = '';
            const cfg = window.__pmConfig;

            // 如果配置了独立API，直接调用
            if (cfg.apiUrl && cfg.apiKey) {
                const char = c?.characters?.[c.characterId];
                const cardDesc = char?.description ?? '';
                const cardPersonality = char?.personality ?? '';

                let worldBookText = '';
                try {
                    const wi = c?.worldInfo;
                    if (wi) {
                        worldBookText = Object.values(wi)
                            .filter(e => e?.content)
                            .map(e => e.content)
                            .slice(0, 10)
                            .join('\n');
                    }
                } catch {}

                const systemPrompt = [
                    `你正在扮演"${currentPersona}"通过手机短信与用户聊天。`,
                    cardDesc ? `角色设定：${cardDesc}` : '',
                    cardPersonality ? `性格：${cardPersonality}` : '',
                    worldBookText ? `世界观：${worldBookText}` : '',
                    '',
                    '只输出3到8句短信，每句用/分隔，禁止任何标签格式旁白选项。',
                ].filter(Boolean).join('\n');

                const messages = [
                    { role: 'system', content: systemPrompt },
                    ...conversationHistory.slice(-8).map(m => ({
                        role: m.role,
                        content: cleanMsg(m.content)
                    }))
                ];

                const resp = await fetch(cfg.apiUrl, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${cfg.apiKey}`,
                    },
                    body: JSON.stringify({
                        model: cfg.model || 'gpt-4o-mini',
                        messages,
                        max_tokens: 300,
                        temperature: 0.85,
                    })
                });
                const json = await resp.json();
                raw = json.choices?.[0]?.message?.content ?? '';

            } else {
                // 使用主API（走酒馆预设）
                raw = await c.generateQuietPrompt(injectedInstruction, false, false);
            }

            let clean = (raw ?? '')
                .replace(/<[^>]+>[\s\S]*?<\/[^>]+>/g, '')
                .replace(/<[^>]+>/g, '')
                .replace(/^\s*\S{1,15}[:：]\s*/m, '')
                .trim();

            let sentences = clean
                .split(/\s*\/\s*/)
                .map(s => s.trim())
                .filter(s => s.length > 0)
                .slice(0, 8);

            if (sentences.length === 0) sentences = ['...'];

            conversationHistory.push({ role: 'assistant', content: sentences.join(' / ') });

            const id = `${c.characterId}_${c.chat_file || 'default'}`;
            if (!window.__pmHistories[id]) window.__pmHistories[id] = {};
            window.__pmHistories[id][currentPersona] = conversationHistory.slice(-30);
            try { localStorage.setItem('ST_SMS_DATA_V2', JSON.stringify(window.__pmHistories)); } catch {}

            return sentences;
        } catch (e) {
            const msg = e?.message || String(e) || '未知错误';
            return [`（错误：${msg}）`];
        }
    }

    // ── 气泡操作 ──
    function addBubble(text, side, save = true) {
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

    // ── 发送 ──
    window.__pmSend = async () => {
        if (isGenerating) return;
        const input = phoneWindow.querySelector('.pm-input');
        const val = input.value.trim();
        if (!val) return;
        input.value = '';

        val.split(/[/／]/).map(s => s.trim()).filter(Boolean)
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

    // ── 删除模式 ──
    window.__pmToggleSelect = () => {
        isSelectMode = !isSelectMode;
        const list = phoneWindow?.querySelector('.pm-msg-list');
        const trashBtn = phoneWindow?.querySelector('.pm-trash-btn');
        const confirmBar = phoneWindow?.querySelector('.pm-confirm-bar');
        if (!list) return;

        if (isSelectMode) {
            trashBtn.style.color = '#ff3b30';
            confirmBar.style.display = 'flex';
            // 给所有气泡加勾选框
            list.querySelectorAll('.pm-bubble').forEach(b => {
                if (b.id === 'pm-typing') return;
                const wrap = document.createElement('div');
                wrap.className = 'pm-select-wrap';
                const cb = document.createElement('input');
                cb.type = 'checkbox';
                cb.className = 'pm-checkbox';
                b.parentNode.insertBefore(wrap, b);
                wrap.appendChild(cb);
                wrap.appendChild(b);
                wrap.dataset.side = b.dataset.side;
                wrap.dataset.text = b.dataset.text;
            });
        } else {
            trashBtn.style.color = '';
            confirmBar.style.display = 'none';
            // 移除勾选框，还原气泡
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

        // 收集要删除的文本
        const toDelete = new Set();
        list.querySelectorAll('.pm-select-wrap').forEach(wrap => {
            const cb = wrap.querySelector('.pm-checkbox');
            if (cb?.checked) {
                toDelete.add(wrap.dataset.text);
                wrap.remove();
            } else {
                // 还原未选中的气泡
                const b = wrap.querySelector('.pm-bubble');
                if (b) wrap.parentNode.insertBefore(b, wrap);
                wrap.remove();
            }
        });

        // 从 conversationHistory 里删除对应条目
        if (toDelete.size > 0) {
            conversationHistory = conversationHistory.filter(m => {
                const parts = m.content.split(/\s*\/\s*/);
                return !parts.some(p => toDelete.has(p.trim()));
            });
            // 更新存储
            const c = getCtx();
            const id = `${c.characterId}_${c.chat_file || 'default'}`;
            if (!window.__pmHistories[id]) window.__pmHistories[id] = {};
            window.__pmHistories[id][currentPersona] = conversationHistory.slice(-30);
            try { localStorage.setItem('ST_SMS_DATA_V2', JSON.stringify(window.__pmHistories)); } catch {}
        }

        isSelectMode = false;
        const trashBtn = phoneWindow?.querySelector('.pm-trash-btn');
        const confirmBar = phoneWindow?.querySelector('.pm-confirm-bar');
        if (trashBtn) trashBtn.style.color = '';
        if (confirmBar) confirmBar.style.display = 'none';
    };

    // ── API 配置弹窗 ──
    window.__pmShowConfig = () => {
        document.getElementById('pm-overlay')?.remove();
        const cfg = window.__pmConfig;
        const ov = document.createElement('div');
        ov.id = 'pm-overlay';
        ov.innerHTML = `
<div class="pm-modal">
  <div class="pm-modal-header">
    <b>API 配置</b>
    <span onclick="document.getElementById('pm-overlay').remove()" class="pm-modal-close">✕</span>
  </div>
  <div style="padding:14px 16px;display:flex;flex-direction:column;gap:10px;">
    <div class="pm-cfg-label">API 地址（留空则使用主API）</div>
    <input id="pm-cfg-url" class="pm-cfg-input" placeholder="https://api.openai.com/v1/chat/completions" value="${cfg.apiUrl}">
    <div class="pm-cfg-label">API Key</div>
    <input id="pm-cfg-key" class="pm-cfg-input" placeholder="sk-..." type="password" value="${cfg.apiKey}">
    <div class="pm-cfg-label">模型名称</div>
    <input id="pm-cfg-model" class="pm-cfg-input" placeholder="gpt-4o-mini" value="${cfg.model}">
    <div class="pm-cfg-tip">配置独立API后，手机聊天与主聊天互不干扰</div>
  </div>
  <div class="pm-modal-add">
    <button onclick="window.__pmSaveConfig()" style="width:100%;background:#007aff;color:#fff;border:none;border-radius:10px;padding:11px;font-size:14px;cursor:pointer;font-weight:600;font-family:inherit;">保存</button>
  </div>
</div>`;
        ov.addEventListener('click', e => { if (e.target === ov) ov.remove(); });
        document.body.appendChild(ov);
    };

    window.__pmSaveConfig = () => {
        window.__pmConfig = {
            apiUrl: document.getElementById('pm-cfg-url')?.value.trim() ?? '',
            apiKey: document.getElementById('pm-cfg-key')?.value.trim() ?? '',
            model: document.getElementById('pm-cfg-model')?.value.trim() ?? '',
        };
        try { localStorage.setItem('ST_SMS_CONFIG', JSON.stringify(window.__pmConfig)); } catch {}
        document.getElementById('pm-overlay')?.remove();
        const using = window.__pmConfig.apiUrl ? '独立API' : '主API';
        addNote(`已保存，当前使用：${using}`);
    };

    // ── 联系人弹窗 ──
    window.__pmShowList = () => {
        document.getElementById('pm-overlay')?.remove();
        const c = getCtx();
        const id = `${c.characterId}_${c.chat_file || 'default'}`;
        const list = Object.keys(window.__pmHistories[id] || {});
        const ov = document.createElement('div');
        ov.id = 'pm-overlay';
        ov.innerHTML = `
<div class="pm-modal">
  <div class="pm-modal-header">
    <b>联系人</b>
    <span onclick="document.getElementById('pm-overlay').remove()" class="pm-modal-close">✕</span>
  </div>
  <div class="pm-modal-list">
    ${list.length > 0
        ? list.map(n => `
    <div class="pm-li">
      <span onclick="window.__pmSwitch('${n.replace(/'/g,"\\'")}')">${n}</span>
      <i onclick="window.__pmDel('${n.replace(/'/g,"\\'")}')">删除</i>
    </div>`).join('')
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

    // ── 切换角色 ──
    window.__pmSwitch = (name) => {
        if (!name?.trim()) return;
        name = name.trim();
        document.getElementById('pm-overlay')?.remove();
        const c = getCtx();
        const id = `${c.characterId}_${c.chat_file || 'default'}`;
        currentPersona = name;
        conversationHistory = window.__pmHistories[id]?.[name] ?? [];
        if (phoneWindow) {
            phoneWindow.querySelector('.pm-name').textContent = name;
            const list = phoneWindow.querySelector('.pm-msg-list');
            list.innerHTML = '';
            if (conversationHistory.length > 0) {
                addNote(`与 ${name} 的历史记录`);
                conversationHistory.forEach(m => {
                    m.content.split(/\s*\/\s*/).map(s => s.trim()).filter(Boolean)
                        .forEach(s => addBubble(s, m.role === 'user' ? 'right' : 'left'));
                });
                addNote('── 以上为历史记录 ──');
            } else {
                addNote(`开始与 ${name} 的对话`);
            }
        }
    };

    window.__pmDel = (name) => {
        const c = getCtx();
        const id = `${c.characterId}_${c.chat_file || 'default'}`;
        delete window.__pmHistories[id][name];
        try { localStorage.setItem('ST_SMS_DATA_V2', JSON.stringify(window.__pmHistories)); } catch {}
        window.__pmShowList();
    };

    window.__pmToggleMin = () => {
        isMinimized = !isMinimized;
        phoneWindow.classList.toggle('is-min', isMinimized);
    };

    window.__pmEnd = () => {
        phoneWindow?.remove();
        phoneWindow = null;
        phoneActive = false;
        isMinimized = false;
        isSelectMode = false;
    };

    // ── 构建窗口 ──
    window.__pmOpen = () => {
        if (phoneActive && phoneWindow) {
            phoneWindow.style.display = 'flex';
            return;
        }
        try { window.__pmHistories = JSON.parse(localStorage.getItem('ST_SMS_DATA_V2')) || {}; } catch {}
        try { window.__pmConfig = JSON.parse(localStorage.getItem('ST_SMS_CONFIG')) || { apiUrl: '', apiKey: '', model: '' }; } catch {}

        const c = getCtx();
        const defaultChar = c?.characters?.[c.characterId]?.name ?? 'AI';

        phoneWindow = document.createElement('div');
        phoneWindow.id = 'pm-iphone';
        phoneWindow.innerHTML = `
<div class="pm-island"></div>
<div class="pm-main-ui">
  <div class="pm-navbar">
    <button onclick="window.__pmShowList()" class="pm-nav-btn" title="联系人" style="justify-self:start;">☰</button>
    <div class="pm-name">${defaultChar}</div>
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

        document.body.appendChild(phoneWindow);
        phoneActive = true;
        phoneWindow.querySelector('.pm-input').addEventListener('keydown', e => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); window.__pmSend(); }
        });
        bindIsland(phoneWindow, phoneWindow.querySelector('.pm-island'));
        window.__pmSwitch(defaultChar);
    };

    // ── 样式 ──
    if (!document.getElementById('pm-css')) {
        const s = document.createElement('style');
        s.id = 'pm-css';
        s.textContent = `
#pm-iphone {
    position: fixed; bottom: 40px; right: 40px;
    width: 330px; height: 580px;
    min-width: 330px; max-width: 330px;
    min-height: 580px; max-height: 580px;
    background: #fff; border: 10px solid #1a1a1a;
    border-radius: 45px; z-index: 100000;
    display: flex; flex-direction: column;
    overflow: hidden;
    box-shadow: 0 20px 60px rgba(0,0,0,0.45);
    transition: 0.35s cubic-bezier(0.18, 0.89, 0.32, 1.2);
    font-family: -apple-system, BlinkMacSystemFont, 'PingFang SC', 'Microsoft YaHei', sans-serif;
    touch-action: none; box-sizing: border-box;
}
#pm-iphone.is-min {
    height: 50px !important; min-height: 50px !important; max-height: 50px !important;
    width: 140px !important; min-width: 140px !important; max-width: 140px !important;
    border-radius: 25px; border-width: 6px;
}
#pm-iphone.is-min .pm-main-ui { display: none !important; }
.pm-island {
    width: 100px; height: 28px; background: #1a1a1a;
    margin: 8px auto 4px; border-radius: 14px;
    cursor: move; flex-shrink: 0; touch-action: none;
}
.pm-main-ui { flex: 1; display: flex; flex-direction: column; overflow: hidden; min-height: 0; }
.pm-navbar {
    display: grid; grid-template-columns: 1fr auto 1fr;
    align-items: center;
    padding: 6px 10px; border-bottom: 1px solid #f0f0f0; flex-shrink: 0;
}
.pm-name {
    font-weight: 700; color: #000; font-size: 15px;
    text-align: center; white-space: nowrap; overflow: hidden;
    text-overflow: ellipsis; padding: 0 4px;
}
.pm-nav-btn {
    background: none; border: none; font-size: 18px;
    cursor: pointer; color: #007aff; padding: 3px; line-height: 1; flex-shrink: 0;
}
.pm-confirm-bar {
    background: #fff8f0; border-bottom: 1px solid #ffe0b0;
    padding: 7px 12px; align-items: center; gap: 8px; flex-shrink: 0;
}
.pm-confirm-tip { flex: 1; font-size: 12px; color: #888; }
.pm-confirm-btn {
    background: #ff3b30; color: #fff; border: none;
    border-radius: 8px; padding: 5px 12px; font-size: 12px;
    cursor: pointer; font-weight: 600; font-family: inherit;
}
.pm-cancel-btn {
    background: #f0f0f0; color: #333; border: none;
    border-radius: 8px; padding: 5px 12px; font-size: 12px;
    cursor: pointer; font-family: inherit;
}
.pm-msg-list {
    flex: 1; overflow-y: auto; padding: 12px;
    display: flex; flex-direction: column; gap: 7px;
    background: #fff; min-height: 0; box-sizing: border-box;
}
.pm-select-wrap {
    display: flex; align-items: flex-end; gap: 6px;
}
.pm-checkbox {
    width: 20px; height: 20px; cursor: pointer;
    flex-shrink: 0; margin-bottom: 4px;
    accent-color: #007aff;
    border-radius: 50%;
    opacity: 0.4;
    transition: opacity 0.15s;
}
.pm-checkbox:checked {
    opacity: 1;
}
.pm-bubble {
    max-width: 74%; padding: 9px 13px; border-radius: 18px;
    font-size: 14px; line-height: 1.45; word-break: break-word;
    animation: pm-pop 0.22s ease-out;
}
@keyframes pm-pop {
    from { opacity: 0; transform: scale(0.92) translateY(4px); }
    to   { opacity: 1; transform: scale(1) translateY(0); }
}
.pm-right { align-self: flex-end; background: #007aff; color: #fff; border-bottom-right-radius: 4px; }
.pm-left  { align-self: flex-start; background: #e9e9eb; color: #000; border-bottom-left-radius: 4px; }
.pm-typing-bubble { display: flex; gap: 5px; align-items: center; padding: 11px 15px; width: fit-content; }
.pm-typing-bubble span {
    width: 7px; height: 7px; border-radius: 50%; background: #999;
    display: inline-block; animation: pm-bounce 1.2s infinite;
}
.pm-typing-bubble span:nth-child(2) { animation-delay: 0.2s; }
.pm-typing-bubble span:nth-child(3) { animation-delay: 0.4s; }
@keyframes pm-bounce {
    0%,60%,100% { transform: translateY(0); }
    30% { transform: translateY(-5px); }
}
.pm-note { text-align: center; font-size: 11px; color: #bbb; padding: 3px 0; }
.pm-transfer-card {
    background: linear-gradient(135deg, #ff9500, #ff6b00);
    color: #fff; border-radius: 14px; padding: 12px 14px;
    display: flex; align-items: center; gap: 10px; min-width: 150px;
    box-shadow: 0 3px 10px rgba(255,149,0,0.35);
}
.pm-t-icon {
    width: 34px; height: 34px; background: rgba(255,255,255,0.25);
    border-radius: 50%; display: flex; align-items: center;
    justify-content: center; font-size: 17px; font-weight: 800;
}
.pm-t-info { display: flex; flex-direction: column; gap: 1px; }
.pm-t-info b { font-size: 12px; opacity: 0.85; }
.pm-t-info span { font-size: 17px; font-weight: 700; }
.pm-img-card {
    background: #f2f2f7; border: 1px solid #e0e0e0;
    padding: 12px 14px; border-radius: 14px; color: #555; font-size: 13px; text-align: center;
}
.pm-input-bar {
    padding: 8px 12px 30px; display: flex; gap: 8px;
    border-top: 1px solid #f0f0f0; align-items: center;
    background: #fff; flex-shrink: 0; box-sizing: border-box;
}
.pm-input {
    flex: 1; min-width: 0;
    background: #f2f2f7 !important; color: #000 !important;
    border: none !important; border-radius: 20px !important;
    padding: 9px 14px !important; outline: none !important;
    font-size: 14px !important; font-family: inherit !important;
    box-sizing: border-box;
}
.pm-input:disabled { opacity: 0.5; }
.pm-up-btn {
    width: 32px; height: 32px; background: #007aff; color: #fff;
    border: none; border-radius: 50%; cursor: pointer;
    font-size: 16px; font-weight: bold;
    display: flex; align-items: center; justify-content: center;
    flex-shrink: 0;
}
.pm-up-btn:disabled { background: #ccc; cursor: default; }
#pm-overlay {
    position: fixed; inset: 0; background: rgba(0,0,0,0.45);
    z-index: 100001; display: flex; align-items: center; justify-content: center;
}
.pm-modal {
    background: #fff; border-radius: 20px; width: 290px;
    max-height: 480px; display: flex; flex-direction: column;
    overflow: hidden; box-shadow: 0 16px 48px rgba(0,0,0,0.28);
    font-family: -apple-system, BlinkMacSystemFont, 'PingFang SC', sans-serif;
}
.pm-modal-header {
    display: flex; justify-content: space-between; align-items: center;
    padding: 16px 18px 12px; border-bottom: 1px solid #f0f0f0; flex-shrink: 0;
}
.pm-modal-header b { font-size: 16px; color: #000; }
.pm-modal-close { font-size: 20px; color: #999; cursor: pointer; line-height: 1; }
.pm-modal-list { overflow-y: auto; flex: 1; padding: 6px 8px; }
.pm-li {
    display: flex; align-items: center; gap: 10px;
    padding: 10px; border-radius: 12px;
}
.pm-li:hover { background: #f5f5f5; }
.pm-li span { flex: 1; font-size: 14px; color: #007aff; font-weight: 500; cursor: pointer; }
.pm-li i {
    font-style: normal; font-size: 11px; color: #fff;
    background: #ff3b30; padding: 3px 9px; border-radius: 8px;
    cursor: pointer; font-weight: 600; flex-shrink: 0;
}
.pm-modal-add {
    padding: 12px 14px 16px; border-top: 1px solid #f0f0f0;
    display: flex; gap: 8px; flex-shrink: 0;
}
.pm-modal-add input {
    flex: 1; min-width: 0; border: 1px solid #ddd; border-radius: 10px;
    padding: 9px 12px; font-size: 13px; outline: none;
    font-family: inherit; color: #000; background: #fff; box-sizing: border-box;
}
.pm-modal-add button {
    background: #007aff; color: #fff; border: none; border-radius: 10px;
    padding: 9px 14px; font-size: 13px; cursor: pointer;
    font-weight: 600; white-space: nowrap; font-family: inherit;
}
.pm-cfg-label { font-size: 12px; color: #888; margin-bottom: -4px; }
.pm-cfg-input {
    width: 100%; border: 1px solid #ddd; border-radius: 10px;
    padding: 9px 12px; font-size: 13px; outline: none;
    font-family: inherit; color: #000; background: #fff;
    box-sizing: border-box;
}
.pm-cfg-tip { font-size: 11px; color: #aaa; text-align: center; padding: 4px 0; }
        `;
        document.head.appendChild(s);
    }

    // ── 拦截 /phone ──
    document.addEventListener('keydown', e => {
        if (e.key !== 'Enter' || e.shiftKey) return;
        const ta = document.getElementById('send_textarea');
        if (!ta || document.activeElement !== ta) return;
        if (ta.value.trim() === '/phone') {
            e.preventDefault();
            e.stopImmediatePropagation();
            ta.value = '';
            window.__pmOpen();
        }
    }, true);

    console.log('[phone-mode] 已加载，输入 /phone 回车召唤');
})();
