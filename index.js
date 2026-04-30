(async function () {
    await new Promise(r => setTimeout(r, 1000));

    // ── 1. 状态与存储 ──
    window.__pmHistories = window.__pmHistories || {};
    let phoneActive = false;
    let phoneWindow = null;
    let conversationHistory = [];
    let currentPersona = '';
    let isGenerating = false;
    let isMinimized = false;

    const getCtx = () => typeof SillyTavern !== 'undefined' ? SillyTavern.getContext() : null;

    // ── 2. 强效物理过滤（拦截思考和废话） ──
    function rigidFilter(text) {
        if (!text) return "";
        let clean = text
            .replace(/<thinking>[\s\S]*?<\/thinking>/gi, '') // 物理切除思考链
            .replace(/<[^>]+>/g, '') // 删掉所有标签
            .replace(/\*[^*]+\*/g, '') // 删掉动作描写
            .replace(/[\(（][^\)）]+[\)）]/g, '') // 删掉括号旁白
            .replace(/(当前风格|回复范例|System|Assistant|AI)[:：].*/gi, '') // 删掉泄露的元数据
            .trim();
        
        // 强制分句并截取 3-8 句
        const sentences = clean.split(/(?<=[。！？!?\n])\s*/).filter(s => s.length > 1);
        if (sentences.length > 8) return sentences.slice(0, 8).join(' ');
        if (sentences.length < 1) return clean; 
        return sentences.join(' ');
    }

    // ── 3. API 调用（深度人设注入） ──
    async function fetchReply(userMsg) {
        const c = getCtx();
        conversationHistory.push({ role: 'user', content: userMsg });

        // 构建包含 {{user}} 和 {{persona}} 的强制 Prompt
        const systemPrompt = `[STRICT INSTRUCTION: SMS_PROTOCOL]
1. ACT AS: ${currentPersona} ({{persona}}).
2. TARGET: {{user}}.
3. FORMAT: PURE TEXT MESSAGE ONLY.
4. LIMIT: 3-8 SENTENCES.
5. NO <thinking>, NO ACTIONS, NO BRACKETS.
6. IF YOU UNDERSTAND, REPLY AS ${currentPersona} DIRECTLY.`;

        const finalPrompt = `${systemPrompt}\n\nHistory:\n${conversationHistory.slice(-4).map(m => m.content).join('\n')}\n\n{{user}}: ${userMsg}\n${currentPersona}:`;

        try {
            let res = await c.generateQuietPrompt(finalPrompt, false, false);
            let final = rigidFilter(res);
            if (!final) final = "（信号不稳定，请重发）";
            
            conversationHistory.push({ role: 'assistant', content: final });
            saveStore();
            return final;
        } catch (e) { return "SMS Error: Service Unavailable."; }
    }

    function saveStore() {
        const id = `${getCtx().characterId}_${getCtx().chat_file || 'default'}`;
        if (!window.__pmHistories[id]) window.__pmHistories[id] = {};
        window.__pmHistories[id][currentPersona] = [...conversationHistory.slice(-20)];
    }

    // ── 4. UI 逻辑 ──
    window.__pmSwitch = (name) => {
        const id = `${getCtx().characterId}_${getCtx().chat_file || 'default'}`;
        currentPersona = name || "Unknown";
        conversationHistory = window.__pmHistories[id]?.[currentPersona] || [];
        if (phoneWindow) {
            phoneWindow.querySelector('.pm-name').textContent = currentPersona;
            const list = phoneWindow.querySelector('.pm-msg-list');
            list.innerHTML = '';
            conversationHistory.forEach(m => addBubble(m.content, m.role === 'user' ? 'right' : 'left'));
        }
        document.getElementById('pm-overlay')?.remove();
    };

    function addBubble(text, side) {
        const list = phoneWindow?.querySelector('.pm-msg-list');
        if (!list) return;
        const b = document.createElement('div');
        b.className = `pm-bubble pm-${side}`;
        b.textContent = text;
        list.appendChild(b);
        list.scrollTop = list.scrollHeight;
    }

    window.__pmSend = async () => {
        if (isGenerating) return;
        const input = phoneWindow.querySelector('.pm-input');
        const val = input.value.trim();
        if (!val) return;
        input.value = '';

        addBubble(val, 'right');
        isGenerating = true;
        const reply = await fetchReply(val);
        addBubble(reply, 'left');
        isGenerating = false;
    };

    // ── 5. 拖拽与最小化逻辑 ──
    function initDrag(el, handle) {
        let isDragging = false, startX, startY, startL, startT;
        handle.onmousedown = (e) => {
            isDragging = true;
            startX = e.clientX; startY = e.clientY;
            startL = el.offsetLeft; startT = el.offsetTop;
            el.style.transition = 'none'; // 拖拽时关闭动画
        };
        document.onmousemove = (e) => {
            if (!isDragging) return;
            el.style.left = (startL + e.clientX - startX) + 'px';
            el.style.top = (startT + e.clientY - startY) + 'px';
            el.style.bottom = 'auto'; el.style.right = 'auto';
        };
        document.onmouseup = () => { 
            isDragging = false; 
            el.style.transition = '0.3s cubic-bezier(0.18, 0.89, 0.32, 1.28)';
        };
    }

    window.__pmToggleMin = () => {
        isMinimized = !isMinimized;
        phoneWindow.classList.toggle('is-min', isMinimized);
    };

    // ── 6. 构造窗口 ──
    window.__pmOpen = () => {
        if (phoneActive) return;
        const c = getCtx();
        currentPersona = c?.characters?.[c.characterId]?.name ?? '白厄';
        
        phoneWindow = document.createElement('div');
        phoneWindow.id = 'pm-v6-phone';
        phoneWindow.innerHTML = `
            <div class="pm-island-handle"></div>
            <div class="pm-content-box">
                <div class="pm-nav">
                    <button onclick="__pmShowList()" style="background:none;border:none;font-size:18px;cursor:pointer">≡</button>
                    <div class="pm-name">${currentPersona}</div>
                    <button onclick="__pmEnd()" style="background:none;border:none;color:red;cursor:pointer">✕</button>
                </div>
                <div class="pm-msg-list"></div>
                <div class="pm-input-bar">
                    <input class="pm-input" placeholder="iMessage">
                    <button onclick="__pmSend()" class="pm-up-btn">↑</button>
                </div>
            </div>
        `;
        document.body.appendChild(phoneWindow);
        phoneActive = true;
        
        initDrag(phoneWindow, phoneWindow.querySelector('.pm-island-handle'));
        __pmSwitch(currentPersona);

        phoneWindow.querySelector('.pm-input').onkeydown = e => { if(e.key==='Enter') __pmSend(); };
        // 灵动岛单击切换最小化
        phoneWindow.querySelector('.pm-island-handle').onclick = (e) => {
            if (Math.abs(e.movementX) < 5 && Math.abs(e.movementY) < 5) __pmToggleMin();
        };
    };

    window.__pmShowList = () => {
        const id = `${getCtx().characterId}_${getCtx().chat_file || 'default'}`;
        const list = Object.keys(window.__pmHistories[id] || {});
        const ov = document.createElement('div');
        ov.id = 'pm-overlay';
        ov.innerHTML = `
            <div class="pm-modal">
                <h4 style="margin:0 0 15px">联系人管理</h4>
                <div style="max-height:150px;overflow-y:auto;margin-bottom:15px">
                    ${list.map(n => `<div class="pm-li"><span onclick="__pmSwitch('${n}')">${n}</span><i onclick="__pmDel('${n}')">×</i></div>`).join('')}
                </div>
                <input id="pm-add" placeholder="输入新联系人..." style="width:100%;padding:8px;box-sizing:border-box">
                <button onclick="__pmSwitch(document.getElementById('pm-add').value)" style="width:100%;margin-top:10px;padding:8px;background:#007aff;color:#fff;border:none;border-radius:8px">呼叫</button>
            </div>
        `;
        document.body.appendChild(ov);
    };

    window.__pmDel = (n) => { delete window.__pmHistories[`${getCtx().characterId}_${getCtx().chat_file || 'default'}`][n]; __pmShowList(); };
    window.__pmEnd = () => { phoneWindow?.remove(); phoneActive = false; };

    // ── 7. 样式 ──
    const css = `
        #pm-v6-phone {
            position: fixed; bottom: 40px; right: 40px; width: 330px; height: 570px;
            background: #fff; border: 10px solid #000; border-radius: 40px;
            z-index: 100000; display: flex; flex-direction: column; 
            box-shadow: 0 20px 50px rgba(0,0,0,0.3); transition: 0.3s cubic-bezier(0.18, 0.89, 0.32, 1.2);
        }
        #pm-v6-phone.is-min { height: 45px; width: 120px; border-radius: 25px; }
        #pm-v6-phone.is-min .pm-content-box { display: none; }
        .pm-island-handle { 
            width: 100px; height: 26px; background: #000; margin: 10px auto; 
            border-radius: 15px; cursor: move; flex-shrink: 0;
            transition: 0.3s;
        }
        .pm-island-handle:hover { width: 110px; background: #222; }
        .pm-nav { display: flex; align-items: center; justify-content: space-between; padding: 5px 20px; border-bottom: 1px solid #f0f0f0; }
        .pm-name { font-weight: 700; font-size: 15px; }
        .pm-msg-list { flex: 1; overflow-y: auto; padding: 15px; display: flex; flex-direction: column; gap: 10px; background: #fff; }
        .pm-bubble { max-width: 80%; padding: 10px 14px; border-radius: 18px; font-size: 14px; line-height: 1.4; }
        .pm-right { align-self: flex-end; background: #007aff; color: #fff; border-bottom-right-radius: 4px; }
        .pm-left { align-self: flex-start; background: #e9e9eb; color: #000; border-bottom-left-radius: 4px; }
        .pm-input-bar { padding: 10px 15px 30px; display: flex; gap: 10px; border-top: 1px solid #f0f0f0; }
        .pm-input { flex: 1; background: #fff !important; color: #000 !important; border: 1px solid #ddd; border-radius: 20px; padding: 8px 15px; outline: none; }
        .pm-up-btn { width: 30px; height: 30px; background: #007aff; color: #fff; border: none; border-radius: 50%; cursor: pointer; }
        #pm-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.5); z-index: 100001; display: flex; align-items: center; justify-content: center; }
        .pm-modal { background: #fff; padding: 20px; border-radius: 20px; width: 260px; font-family: sans-serif; }
        .pm-li { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #eee; }
        .pm-li span { color: #007aff; cursor: pointer; }
        .pm-li i { color: red; font-style: normal; cursor: pointer; }
    `;

    if (!document.getElementById('pm-v6-css')) {
        const s = document.createElement('style'); s.id = 'pm-v6-css'; s.innerHTML = css; document.head.appendChild(s);
    }

    // 监听命令行
    document.addEventListener('keydown', e => {
        if(e.key === 'Enter' && !e.shiftKey) {
            const ta = document.getElementById('send_textarea');
            if(ta && ta.value.trim() === '/phone') {
                e.preventDefault(); ta.value = ''; __pmOpen();
            }
        }
    }, true);

    console.log("iPhone SMS V6 (Fixed Drag & Prompt) Loaded.");
})();
