(async function () {
    await new Promise(r => setTimeout(r, 1000));

    // ── 1. 全局状态 ──
    window.__pmHistories = window.__pmHistories || {};
    let phoneActive = false;
    let phoneWindow = null;
    let currentPersona = '';
    let conversationHistory = [];
    let isGenerating = false;
    let isMinimized = false;

    const getCtx = () => typeof SillyTavern !== 'undefined' ? SillyTavern.getContext() : null;

    // ── 2. 触控与拖拽 ──
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
            let dx = coords.x - startX, dy = coords.y - startY;
            if (Math.abs(dx) > 5 || Math.abs(dy) > 5) { moved = true; if (e.cancelable) e.preventDefault(); }
            el.style.left = (startL + dx) + 'px'; el.style.top = (startT + dy) + 'px';
            el.style.bottom = 'auto'; el.style.right = 'auto';
        };

        const onEnd = () => {
            if (!isDragging) return;
            isDragging = false;
            el.style.transition = '0.35s cubic-bezier(0.18, 0.89, 0.32, 1.2)';
            if (!moved) window.__pmToggleMin();
        };

        handle.addEventListener('mousedown', onStart); window.addEventListener('mousemove', onMove); window.addEventListener('mouseup', onEnd);
        handle.addEventListener('touchstart', onStart, { passive: false }); window.addEventListener('touchmove', onMove, { passive: false }); window.addEventListener('touchend', onEnd);
    }

    // ── 3. 核心大换血：正向提取引擎 ──
    function processResponse(text) {
        if (!text) return ["..."];
        let clean = text;

        // 【最强阳谋】：只抓取 <SMS> 和 </SMS> 之间的内容，其他几千字正文直接抛弃！
        const smsMatch = clean.match(/<SMS>([\s\S]*?)<\/SMS>/i);
        if (smsMatch) {
            clean = smsMatch[1]; 
        } else {
            // 保底机制：如果它忘了写 <SMS> 标签，启动 V18.1 的暴力清理法
            clean = clean.replace(/<[^>]+>[\s\S]*?(<\/[^>]+>|$)/g, '');
            clean = clean.replace(/\[[A-Za-z0-9_]+\]/g, '');
            clean = clean.replace(/【[^】]+】[\s\S]*?(?=\/|$)/g, '');
        }

        // 基础净化，防止标签内还有动作描写
        clean = clean.replace(/&lt;/g, '<').replace(/&gt;/g, '>');
        clean = clean.replace(/\*[^*]+\*/g, '');
        clean = clean.replace(/[\(（](?!\s*(转账|图片|系统))[^\)）]+[\)\）]/g, '');
        clean = clean.replace(/^.{0,15}(:|：)\s*/, '');
        clean = clean.trim();

        // 强行丢弃乱入的标题行
        let lines = clean.split('\n').map(l => l.trim()).filter(Boolean);
        if (lines.length > 1 && !lines[0].includes('/') && lines[0].length < 15 && !lines[0].match(/(图片|转账)/)) {
            lines.shift(); 
        }
        clean = lines.join(' ').trim();

        // 气泡切分
        let chunks = clean.split(/[/／]/).map(s => s.trim()).filter(s => s.length > 0);
        if (chunks.length === 1 && clean.length > 20) {
            chunks = clean.split(/(?<=[。！？!?\n])\s*/).map(s => s.trim()).filter(s => s.length > 0);
        }
        return chunks.slice(0, 8);
    }

    // ── 4. 渲染气泡 ──
    function createBubbleElement(text, side) {
        const b = document.createElement('div');
        b.className = `pm-bubble pm-${side}`;

        const specialMatch = text.match(/^[\(（]\s*(转账|图片)\s*[+：:\s]*([^)）]+)[\)\）]$/);
        if (specialMatch) {
            const type = specialMatch[1];
            const content = specialMatch[2].trim();
            if (type === '转账') {
                const amount = parseFloat(content) || 0;
                b.style.cssText = 'background:transparent;box-shadow:none;padding:0;';
                b.innerHTML = `<div class="pm-transfer-card"><div class="pm-t-icon">¥</div><div class="pm-t-info"><b>收到转账</b><span>¥${amount.toFixed(2)}</span></div></div>`;
            } else {
                b.style.cssText = 'background:transparent;box-shadow:none;padding:0;';
                b.innerHTML = `<div class="pm-img-card">🖼️ 图片：${content.replace(/</g,'&lt;').replace(/>/g,'&gt;')}</div>`;
            }
            return b;
        }

        b.innerHTML = text.replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');
        return b;
    }

    // ── 5. API 调用 (诱导其使用 SMS 标签) ──
    async function fetchSMS(userMsg) {
        const c = getCtx();
        conversationHistory.push({ role: 'user', content: userMsg });

        const activeCharName = c.characters && c.characters[c.characterId] ? c.characters[c.characterId].name : '';
        let personaContext = "";
        if (currentPersona === activeCharName) {
            personaContext = `(Load profile: {{persona}}).`;
        } else {
            personaContext = `(You are an NPC named ${currentPersona}).`;
        }

        const systemPrompt = `[SYSTEM: SMS EXTRACTION MODE]
Role: "${currentPersona}". ${personaContext}

You are currently replying to {{user}}'s text messages.
You MUST put the actual text messages INSIDE <SMS> and </SMS> tags!
Inside the <SMS> tags, NO narration, NO headers, ONLY pure text.
Separate multiple messages with a "/".

Correct Output Example:
<novel_header>Some text</novel_header>
<thinking>I should reply fast.</thinking>
<SMS>我刚下班 / 你在干嘛呢？ / (图片: 路边的小猫)</SMS>`;

        const historyStr = conversationHistory.slice(-6).map(m => m.role === 'user' ? `{{user}}: ${m.content}` : `${currentPersona}: ${m.content}`).join('\n');
        const prompt = `${systemPrompt}\n\n[History]\n${historyStr}\n\n{{user}}: ${userMsg}\n${currentPersona} Output:`;

        try {
            let raw = await c.generateQuietPrompt(prompt, false, false);
            let sentences = processResponse(raw);
            
            if (sentences.length === 0) sentences = ['（对方没有回复）'];

            conversationHistory.push({ role: 'assistant', content: sentences.join(' / ') });

            const id = `${c.characterId}_${c.chat_file || 'default'}`;
            if (!window.__pmHistories[id]) window.__pmHistories[id] = {};
            window.__pmHistories[id][currentPersona] = conversationHistory.slice(-30);
            try { localStorage.setItem('ST_SMS_DATA_V2', JSON.stringify(window.__pmHistories)); } catch {}

            return sentences;
        } catch (e) {
            return ['（发送超时，请重试）'];
        }
    }

    // ── 6. UI 状态 (打字动画) ──
    function addBubble(text, side) {
        const list = phoneWindow?.querySelector('.pm-msg-list');
        if (!list) return;
        list.appendChild(createBubbleElement(text, side));
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

    // ── 7. 发送逻辑 ──
    window.__pmSend = async () => {
        if (isGenerating) return;
        const input = phoneWindow.querySelector('.pm-input');
        const val = input.value.trim();
        if (!val) return;
        input.value = '';

        val.split(/[/／]/).map(s => s.trim()).filter(Boolean).forEach(chunk => addBubble(chunk, 'right'));

        isGenerating = true;
        input.disabled = true;
        const btn = phoneWindow.querySelector('.pm-up-btn');
        if (btn) btn.disabled = true;

        showTyping();
        const sentences = await fetchSMS(val);
        hideTyping();

        for (const s of sentences) {
            await new Promise(r => setTimeout(r, 600));
            addBubble(s, 'left');
        }

        isGenerating = false;
        input.disabled = false;
        if (btn) btn.disabled = false;
        input.focus();
    };

    // ── 8. 联系人列表 ──
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
    <b>联系人管理</b>
    <span onclick="document.getElementById('pm-overlay').remove()" class="pm-modal-close">✕</span>
  </div>
  <div class="pm-modal-list">
    ${list.length > 0
        ? list.map(n => `
      <div class="pm-li">
        <span onclick="window.__pmSwitch('${n.replace(/'/g, "\\'")}')">${n}</span>
        <i onclick="window.__pmDel('${n.replace(/'/g, "\\'")}')">移除</i>
      </div>`).join('')
        : '<div style="text-align:center;color:#999;padding:20px;font-size:13px;">暂无联系人</div>'
    }
  </div>
  <div class="pm-modal-add">
    <input id="pm-add-input" placeholder="输入新名字..." />
    <button onclick="window.__pmSwitch(document.getElementById('pm-add-input').value.trim())">添加并切换</button>
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
        if (!name || !name.trim()) return;
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
                conversationHistory.forEach(m => {
                    m.content.split(/[/／]/).map(s => s.trim()).filter(s => s.length > 0)
                        .forEach(s => addBubble(s, m.role === 'user' ? 'right' : 'left'));
                });
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

    window.__pmToggleMin = () => { isMinimized = !isMinimized; phoneWindow.classList.toggle('is-min', isMinimized); };
    window.__pmEnd = () => { phoneWindow?.remove(); phoneWindow = null; phoneActive = false; isMinimized = false; };

    // ── 9. 初始化 UI ──
    window.__pmOpen = () => {
        if (phoneActive && phoneWindow) { phoneWindow.style.display = 'flex'; return; }
        try { window.__pmHistories = JSON.parse(localStorage.getItem('ST_SMS_DATA_V2')) || {}; } catch {}

        const c = getCtx();
        const defaultChar = c?.characters?.[c.characterId]?.name ?? 'AI';

        phoneWindow = document.createElement('div');
        phoneWindow.id = 'pm-iphone-v27';
        phoneWindow.innerHTML = `
<div class="pm-island"></div>
<div class="pm-main-ui">
  <div class="pm-navbar">
    <button onclick="window.__pmShowList()" class="pm-nav-btn" title="联系人">☰</button>
    <div class="pm-name">${defaultChar}</div>
    <button onclick="window.__pmEnd()" class="pm-nav-btn pm-end-color" title="关闭">✕</button>
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

    // ── 10. CSS 样式 ──
    if (!document.getElementById('pm-v27-css')) {
        const s = document.createElement('style');
        s.id = 'pm-v27-css';
        s.textContent = `
#pm-iphone-v27 { position: fixed; bottom: 40px; right: 40px; width: 330px; height: 580px; background: #fff; border: 10px solid #1a1a1a; border-radius: 45px; z-index: 100000; display: flex; flex-direction: column; overflow: hidden; box-shadow: 0 20px 60px rgba(0,0,0,0.45); transition: 0.35s cubic-bezier(0.18, 0.89, 0.32, 1.2); font-family: -apple-system, BlinkMacSystemFont, 'PingFang SC', sans-serif; touch-action: none; min-width: 330px !important; max-width: 330px !important; min-height: 580px !important; max-height: 580px !important; box-sizing: border-box !important; }
#pm-iphone-v27.is-min { height: 50px !important; min-height: 50px !important; max-height: 50px !important; width: 140px !important; min-width: 140px !important; max-width: 140px !important; border-radius: 25px; border-width: 6px; }
#pm-iphone-v27.is-min .pm-main-ui { display: none !important; }
.pm-island { width: 100px; height: 26px; background: #1a1a1a; margin: 8px auto 4px; border-radius: 14px; cursor: move; flex-shrink: 0; touch-action: none; z-index: 10;}
.pm-main-ui { flex: 1; display: flex; flex-direction: column; overflow: hidden; min-height: 0; }
.pm-navbar { display: flex; align-items: center; justify-content: space-between; padding: 6px 14px; border-bottom: 1px solid #f0f0f0; flex-shrink: 0; }
.pm-name { font-weight: 700; color: #000; font-size: 15px; flex: 1; text-align: center; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; padding: 0 8px; }
.pm-nav-btn { background: none; border: none; font-size: 20px; cursor: pointer; color: #007aff; padding: 4px; line-height: 1; flex-shrink: 0; }
.pm-end-color { color: #ff3b30 !important; }
.pm-msg-list { flex: 1; overflow-y: auto; padding: 12px; display: flex; flex-direction: column; gap: 7px; background: #fff; min-height: 0; box-sizing: border-box; }
.pm-bubble { max-width: 74%; padding: 9px 13px; border-radius: 18px; font-size: 14px; line-height: 1.45; word-break: break-word; animation: pm-pop 0.25s ease-out; }
@keyframes pm-pop { from { opacity: 0; transform: scale(0.92) translateY(4px); } to { opacity: 1; transform: scale(1) translateY(0); } }
.pm-right { align-self: flex-end; background: #007aff; color: #fff; border-bottom-right-radius: 4px; }
.pm-left { align-self: flex-start; background: #e9e9eb; color: #000; border-bottom-left-radius: 4px; }
.pm-typing-bubble { display: flex; gap: 5px; align-items: center; padding: 11px 15px; width: fit-content; }
.pm-typing-bubble span { width: 7px; height: 7px; border-radius: 50%; background: #999; display: inline-block; animation: pm-bounce 1.2s infinite; }
.pm-typing-bubble span:nth-child(2) { animation-delay: 0.2s; }
.pm-typing-bubble span:nth-child(3) { animation-delay: 0.4s; }
@keyframes pm-bounce { 0%,60%,100% { transform: translateY(0); } 30% { transform: translateY(-5px); } }
.pm-transfer-card { background: linear-gradient(135deg, #ff9500, #ff6b00); color: #fff; border-radius: 14px; padding: 12px 14px; display: flex; align-items: center; gap: 10px; min-width: 150px; box-shadow: 0 3px 10px rgba(255,149,0,0.35); }
.pm-t-icon { width: 34px; height: 34px; background: rgba(255,255,255,0.25); border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 17px; font-weight: 800; }
.pm-t-info { display: flex; flex-direction: column; gap: 1px; }
.pm-t-info b { font-size: 12px; opacity: 0.85; font-weight: normal; }
.pm-t-info span { font-size: 17px; font-weight: 700; }
.pm-img-card { background: #f2f2f7; border: 1px solid #e0e0e0; padding: 12px 14px; border-radius: 14px; color: #555; font-size: 13px; text-align: center; }
.pm-input-bar { padding: 8px 12px 30px; display: flex; gap: 8px; border-top: 1px solid #f0f0f0; align-items: center; background: #fff; flex-shrink: 0; box-sizing: border-box; }
.pm-input { flex: 1; min-width: 0; background: #f2f2f7 !important; color: #000 !important; border: none !important; border-radius: 20px !important; padding: 9px 14px !important; outline: none !important; font-size: 14px !important; box-sizing: border-box; }
.pm-input:disabled { opacity: 0.5; }
.pm-up-btn { width: 32px; height: 32px; background: #007aff; color: #fff; border: none; border-radius: 50%; cursor: pointer; font-size: 16px; font-weight: bold; display: flex; align-items: center; justify-content: center; flex-shrink: 0; transition: background 0.2s; }
.pm-up-btn:disabled { background: #ccc; cursor: default; }
#pm-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.45); z-index: 100001; display: flex; align-items: center; justify-content: center; }
.pm-modal { background: #fff; border-radius: 20px; width: 290px; max-height: 460px; display: flex; flex-direction: column; overflow: hidden; box-shadow: 0 16px 48px rgba(0,0,0,0.28); font-family: -apple-system, BlinkMacSystemFont, sans-serif; }
.pm-modal-header { display: flex; justify-content: space-between; align-items: center; padding: 16px 18px 12px; border-bottom: 1px solid #f0f0f0; flex-shrink: 0; }
.pm-modal-header b { font-size: 16px; color: #000; }
.pm-modal-close { font-size: 20px; color: #999; cursor: pointer; line-height: 1; }
.pm-modal-list { overflow-y: auto; flex: 1; padding: 6px 8px; }
.pm-li { display: flex; align-items: center; gap: 10px; padding: 10px; border-radius: 12px; cursor: pointer; }
.pm-li:hover { background: #f5f5f5; }
.pm-li span { flex: 1; font-size: 15px; color: #000; font-weight: 500; }
.pm-li i { font-style: normal; font-size: 12px; color: #fff; background: #ff3b30; padding: 4px 10px; border-radius: 10px; cursor: pointer; font-weight: bold; flex-shrink: 0; }
.pm-modal-add { padding: 12px 14px 16px; border-top: 1px solid #f0f0f0; display: flex; gap: 8px; flex-shrink: 0; }
.pm-modal-add input { flex: 1; min-width: 0; border: 1px solid #ddd; border-radius: 10px; padding: 9px 12px; font-size: 14px; outline: none; color: #000; background: #fff; box-sizing: border-box; }
.pm-modal-add button { background: #007aff; color: #fff; border: none; border-radius: 10px; padding: 9px 14px; font-size: 14px; cursor: pointer; font-weight: bold; white-space: nowrap; }
        `;
        document.head.appendChild(s);
    }

    // ── 11. 指令引擎 ──
    function registerSlashCommand() {
        if (window.SlashCommandParser && window.SlashCommand) {
            try {
                if (typeof window.SlashCommand.fromProps === 'function') {
                    window.SlashCommandParser.addCommandObject(window.SlashCommand.fromProps({
                        name: 'phone', callback: () => { window.__pmOpen(); return ''; }, returns: 'void', helpString: '打开手机短信模式'
                    }));
                } else {
                    window.SlashCommandParser.addCommandObject(window.SlashCommandParser.registerCommand('phone', () => { window.__pmOpen(); return ''; }, [], '打开手机', true, true));
                }
            } catch (err) {}
        } else { setTimeout(registerSlashCommand, 1000); }
    }
    registerSlashCommand();

    document.addEventListener('keydown', e => {
        if(e.key === 'Enter' && !e.shiftKey) {
            const ta = document.getElementById('send_textarea');
            if(ta && document.activeElement === ta && ta.value.trim() === '/phone') {
                e.preventDefault(); e.stopImmediatePropagation(); ta.value = ''; window.__pmOpen();
            }
        }
    }, true);

    console.log("[Phone Mode] V27.1 (Positive Extraction) Loaded.");
})();
