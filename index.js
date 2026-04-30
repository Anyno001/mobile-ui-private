(async function () {
    await new Promise(r => setTimeout(r, 1000));

    window.__pmHistories = window.__pmHistories || {};
    let phoneActive = false;
    let phoneWindow = null;
    let currentPersona = '';
    let conversationHistory = [];
    let isGenerating = false;
    let isMinimized = false;

    const getCtx = () => typeof SillyTavern !== 'undefined' ? SillyTavern.getContext() : null;

    // ── 1. 物理粉碎器（暴力拦截所有思维链） ──
    function nuclearFilter(text) {
        if (!text) return [];
        let clean = text;

        // A. 暴力抹除所有已知的思考标签和括号内容
        clean = clean.replace(/<(thinking|thought|reasoning)>[\s\S]*?<\/\1>/gi, ''); // 标签类
        clean = clean.replace(/\[(thinking|thought|reasoning)\][\s\S]*?\[\/\1\]/gi, ''); // 中括号类
        clean = clean.replace(/^(thinking|thought|reasoning|思考|想法)[:：][\s\S]*?\n/gi, ''); // 文本头类
        clean = clean.replace(/\*[^*]+\*/g, ''); // 删掉动作描写

        // B. 特殊处理：保留转账和图片，暂存后恢复，防止被旁白过滤器误杀
        const specials = [];
        clean = clean.replace(/[\(（](转账|图片)[^\)）]+[\)\）]/g, (match) => {
            specials.push(match);
            return `__SPECIAL_TOKEN_${specials.length - 1}__`;
        });

        // C. 过滤普通旁白
        clean = clean.replace(/[\(（][^\)）]+[\)\）]/g, ''); 

        // D. 恢复特殊功能
        specials.forEach((val, i) => {
            clean = clean.replace(`__SPECIAL_TOKEN_${i}__`, val);
        });

        // E. 核心切割逻辑：优先按照 / 分隔，其次才是标点
        // 我们先把全角的 ／ 替换成半角的 /
        clean = clean.replace(/／/g, '/');
        
        // 按照 / 或 自然句号分割，但要保护特殊功能内的加号不被误切
        const rawSents = clean.split(/[/]|(?<=[。！？!?\n])\s*/);
        
        return rawSents
            .map(s => s.trim())
            .filter(s => s.length > 0 && !s.includes('Assistant:'))
            .slice(0, 8); // 限制 3-8 句
    }

    // ── 2. 气泡渲染 ──
    function createBubbleElement(text, side) {
        const b = document.createElement('div');
        b.className = `pm-bubble pm-${side}`;

        if (text.includes('转账+')) {
            const num = text.match(/\d+/)?.[0] || '0';
            b.className += ' pm-transfer-bubble';
            b.innerHTML = `<div class="transfer-icon">¥</div><div><div style="font-weight:bold">转账给您</div><div style="font-size:12px">¥${num}.00</div></div>`;
            return b;
        }
        if (text.includes('图片+')) {
            const desc = text.split('+')[1]?.replace(/[\)\）]/g, '') || '描述内容';
            b.className += ' pm-image-bubble';
            b.innerHTML = `<div class="img-placeholder">🖼️ [图片: ${desc}]</div>`;
            return b;
        }

        b.textContent = text;
        return b;
    }

    // ── 3. 深度注入与发送 ──
    async function fetchSMS(userMsg) {
        const c = getCtx();
        conversationHistory.push({ role: 'user', content: userMsg });

        const systemPrompt = `[STRICT DIRECTIVE: SMS_INTERACTION]
- ROLE: You are "${currentPersona}". Read {{persona}} and {{worldbook}} carefully.
- ACTION: Respond as if texting on iMessage.
- RULES:
  1. NO <thinking> tags. NO internal monologue.
  2. ALWAYS use "/" to split your response into multiple bubbles.
  3. Total output: 3-8 short sentences.
  4. Use "(转账+amount)" or "(图片+desc)" if context allows.
  5. NEVER roleplay for {{user}}.
- FORMAT: Sentence 1 / Sentence 2 / (Action if needed)`;

        const prompt = `${systemPrompt}\n\n[Chat History]\n${conversationHistory.slice(-4).map(m => m.content).join('\n')}\n\n{{user}}: ${userMsg}\n${currentPersona}:`;

        try {
            let res = await c.generateQuietPrompt(prompt, false, false);
            const sentences = nuclearFilter(res);
            
            if (sentences.length === 0) sentences.push("怎么了？");
            
            conversationHistory.push({ role: 'assistant', content: sentences.join(' / ') });
            saveStore();
            return sentences;
        } catch (e) { return ["[信号中断]"]; }
    }

    window.__pmSend = async () => {
        if (isGenerating) return;
        const input = phoneWindow.querySelector('.pm-input');
        const val = input.value.trim();
        if (!val) return;
        input.value = '';
        addBubble(val, 'right');
        isGenerating = true;
        const sentenceList = await fetchSMS(val);
        for (const s of sentenceList) {
            await new Promise(r => setTimeout(r, 500 + Math.random()*500));
            addBubble(s, 'left');
        }
        isGenerating = false;
    };

    function addBubble(text, side) {
        const list = phoneWindow?.querySelector('.pm-msg-list');
        if (!list) return;
        list.appendChild(createBubbleElement(text, side));
        list.scrollTop = list.scrollHeight;
    }

    // ── 4. 拖拽逻辑（阈值分离，防止误点） ──
    function bindIsland(el, handle) {
        let isDragging = false, startX, startY, startL, startT, moved = false;
        handle.onmousedown = (e) => {
            isDragging = true; moved = false;
            startX = e.clientX; startY = e.clientY;
            startL = el.offsetLeft; startT = el.offsetTop;
            el.style.transition = 'none';
        };
        document.onmousemove = (e) => {
            if (!isDragging) return;
            let dx = e.clientX - startX, dy = e.clientY - startY;
            if (Math.abs(dx) > 10 || Math.abs(dy) > 10) moved = true;
            el.style.left = (startL + dx) + 'px';
            el.style.top = (startT + dy) + 'px';
            el.style.bottom = 'auto'; el.style.right = 'auto';
        };
        document.onmouseup = () => {
            isDragging = false;
            el.style.transition = '0.3s cubic-bezier(0.18, 0.89, 0.32, 1.2)';
            if (!moved) __pmToggleMin();
        };
    }

    // ── 5. UI 布局 ──
    window.__pmOpen = () => {
        if (phoneActive) return;
        const c = getCtx();
        const defaultChar = c?.characters?.[c.characterId]?.name ?? '白厄';
        phoneWindow = document.createElement('div');
        phoneWindow.id = 'pm-v9';
        phoneWindow.innerHTML = `
            <div class="pm-island"></div>
            <div class="pm-container">
                <div class="pm-header">
                    <button onclick="__pmShowList()">≡</button>
                    <div class="pm-name">${defaultChar}</div>
                    <button onclick="__pmEnd()">✕</button>
                </div>
                <div class="pm-msg-list"></div>
                <div class="pm-footer">
                    <input class="pm-input" placeholder="iMessage">
                    <button onclick="__pmSend()">↑</button>
                </div>
            </div>`;
        document.body.appendChild(phoneWindow);
        phoneActive = true;
        bindIsland(phoneWindow, phoneWindow.querySelector('.pm-island'));
        __pmSwitch(defaultChar);
        phoneWindow.querySelector('.pm-input').onkeydown = e => { if(e.key === 'Enter') __pmSend(); };
    };

    window.__pmSwitch = (name) => {
        if (!name) return;
        currentPersona = name;
        const id = `${getCtx().characterId}_${getCtx().chat_file || 'default'}`;
        conversationHistory = window.__pmHistories[id]?.[currentPersona] || [];
        if (phoneWindow) {
            phoneWindow.querySelector('.pm-name').textContent = currentPersona;
            const list = phoneWindow.querySelector('.pm-msg-list');
            list.innerHTML = '';
            conversationHistory.forEach(m => {
                nuclearFilter(m.content).forEach(s => addBubble(s, m.role === 'user' ? 'right' : 'left'));
            });
        }
        document.getElementById('pm-overlay')?.remove();
    };

    window.__pmDel = (n) => { delete window.__pmHistories[`${getCtx().characterId}_${getCtx().chat_file || 'default'}`][n]; __pmShowList(); };
    window.__pmToggleMin = () => { isMinimized = !isMinimized; phoneWindow.classList.toggle('is-min', isMinimized); };
    window.__pmEnd = () => { phoneWindow?.remove(); phoneActive = false; };
    function saveStore() { const id = `${getCtx().characterId}_${getCtx().chat_file || 'default'}`; if (!window.__pmHistories[id]) window.__pmHistories[id] = {}; window.__pmHistories[id][currentPersona] = [...conversationHistory.slice(-20)]; }

    window.__pmShowList = () => {
        const id = `${getCtx().characterId}_${getCtx().chat_file || 'default'}`;
        const list = Object.keys(window.__pmHistories[id] || {});
        const ov = document.createElement('div'); ov.id = 'pm-overlay';
        ov.innerHTML = `<div class="pm-modal"><b>联系人</b><div style="max-height:180px;overflow-y:auto;margin:10px 0">${list.map(n=>`<div class="pm-li"><span onclick="__pmSwitch('${n}')">${n}</span><i onclick="__pmDel('${n}')">×</i></div>`).join('')}</div><input id="pm-add" placeholder="新建..."><div style="display:flex;gap:10px;margin-top:10px"><button onclick="document.getElementById('pm-overlay').remove()" style="flex:1">取消</button><button onclick="__pmSwitch(document.getElementById('pm-add').value)" style="flex:1;background:#007aff;color:#fff">呼叫</button></div></div>`;
        document.body.appendChild(ov);
    };

    // ── 6. 核心样式 ──
    const css = `
        #pm-v9 { position: fixed; bottom: 30px; right: 30px; width: 340px; height: 620px; background: #fff; border: 12px solid #000; border-radius: 50px; z-index: 100000; display: flex; flex-direction: column; box-shadow: 0 20px 50px rgba(0,0,0,0.3); transition: 0.3s cubic-bezier(0.18, 0.89, 0.32, 1.2); font-family: sans-serif; overflow: hidden; }
        #pm-v9.is-min { height: 50px; width: 140px; border-radius: 25px; border-width: 6px; }
        #pm-v9.is-min .pm-container { display: none; }
        .pm-island { width: 100px; height: 26px; background: #000; margin: 10px auto; border-radius: 15px; cursor: move; flex-shrink: 0; }
        .pm-container { flex: 1; display: flex; flex-direction: column; overflow: hidden; }
        .pm-header { display: flex; align-items: center; justify-content: space-between; padding: 10px 20px; border-bottom: 0.5px solid #eee; }
        .pm-header button { background: none; border: none; font-size: 18px; cursor: pointer; }
        .pm-name { font-weight: bold; }
        .pm-msg-list { flex: 1; overflow-y: auto; padding: 15px; display: flex; flex-direction: column; gap: 8px; }
        .pm-bubble { max-width: 75%; padding: 10px 14px; border-radius: 18px; font-size: 14px; line-height: 1.4; }
        .pm-right { align-self: flex-end; background: #007aff; color: #fff; border-bottom-right-radius: 4px; }
        .pm-left { align-self: flex-start; background: #e9e9eb; color: #000; border-bottom-left-radius: 4px; }
        .pm-transfer-bubble { background: #ff9500 !important; color: #fff; display: flex; align-items: center; gap: 10px; min-width: 160px; }
        .transfer-icon { width: 30px; height: 30px; background: #fff; color: #ff9500; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: bold; }
        .pm-footer { padding: 10px 15px 35px; display: flex; gap: 10px; border-top: 0.5px solid #eee; }
        .pm-input { flex: 1; border-radius: 20px; border: 1px solid #ddd; padding: 8px 15px; outline: none; background: #f9f9f9 !important; color: #000 !important; }
        .pm-modal { background: #fff; padding: 25px; border-radius: 30px; width: 260px; box-shadow: 0 10px 30px rgba(0,0,0,0.2); }
        .pm-li { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 0.5px solid #eee; }
        .pm-li span { color: #007aff; cursor: pointer; }
    `;

    if (!document.getElementById('pm-v9-css')) {
        const s = document.createElement('style'); s.id = 'pm-v9-css'; s.innerHTML = css; document.head.appendChild(s);
    }

    document.addEventListener('keydown', e => {
        if(e.key === 'Enter' && !e.shiftKey) {
            const ta = document.getElementById('send_textarea');
            if(ta && ta.value.trim() === '/phone') {
                e.preventDefault(); ta.value = ''; __pmOpen();
            }
        }
    }, true);
})();
