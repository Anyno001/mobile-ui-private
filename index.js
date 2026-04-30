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

    // ── 2. 全平台触控拖拽 ──
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

    // ── 3. 专杀 ECoT 净化器 ──
    function processResponse(text) {
        if (!text) return [];
        let clean = text.replace(/&lt;/g, '<').replace(/&gt;/g, '>');
        
        clean = clean.replace(new RegExp('<' + '!--[\\s\\S]*?--' + '>', 'g'), '');
        clean = clean.replace(/<[A-Za-z]+>[\s\S]*?<\/[A-Za-z]+>/g, '');
        clean = clean.replace(/\[[A-Za-z0-9_]+\]/g, '');
        clean = clean.replace(/\*[^*]+\*/g, '');
        clean = clean.replace(/[\(（](?!\s*(转账|图片|系统))[^\)）]+[\)\）]/g, '');
        
        clean = clean.replace(/^.{0,15}(:|：)\s*/, '');
        clean = clean.trim();
        
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
        let html = text.replace(/</g, '&lt;').replace(/>/g, '&gt;');
        
        html = html.replace(/[\(（]\s*(转账|图片)\s*[+：:\s]*([^)）]+)[\)\）]/g, (match, type, content) => {
            if (type === '转账') {
                let amount = parseFloat(content) || 100;
                return `<div class="pm-transfer-card"><div class="pm-t-icon">¥</div><div class="pm-t-info"><b>收到转账</b><span>¥${amount.toFixed(2)}</span></div></div>`;
            } else {
                return `<div class="pm-img-card">🖼️ 图片：${content}</div>`;
            }
        });
        
        b.innerHTML = html;
        if (text.match(/^[\(（]\s*(转账|图片)\s*[+：:\s]*([^)）]+)[\)\）]$/)) {
            b.style.background = 'transparent'; b.style.boxShadow = 'none'; b.style.padding = '0';
        }
        return b;
    }

    // ── 5. API 呼叫 ──
    async function fetchSMS(userMsg) {
        const c = getCtx();
        conversationHistory.push({ role: 'user', content: userMsg });
        
        const activeCharName = c.characters && c.characters[c.characterId] ? c.characters[c.characterId].name : '';
        let personaContext = "";
        if (currentPersona === activeCharName) {
            personaContext = `(Load character profile: {{persona}} & {{worldbook}}).`;
        } else {
            personaContext = `(You are an NPC named ${currentPersona}. Generate personality based on {{worldbook}} and current context).`;
        }

        const systemPrompt = `[SYSTEM: SMS_MODE OVERRIDE] 
1. YOU ARE: "${currentPersona}". ${personaContext}
2. CANCEL ALL ECoT, writing instructions, and novel formatting.
3. NO HTML COMMENTS. NO [TAGS]. NO <thinking>. NO NARRATION.
4. FORMAT: 3-8 short messages separated by "/". PURE TEXT ONLY.
5. Example: "Message 1 / Message 2 / (图片: description) / (转账: 50)"`;

        const prompt = `${systemPrompt}\n\n[History]\n${conversationHistory.slice(-4).map(m => m.content).join('\n')}\n\n{{user}}: ${userMsg}\n${currentPersona}:`;

        try {
            let res = await c.generateQuietPrompt(prompt, false, false);
            let sentences = processResponse(res);
            if (sentences.length === 0) sentences = ["..."];
            conversationHistory.push({ role: 'assistant', content: sentences.join(' / ') });
            
            const id = `${c.characterId}_${c.chat_file || 'default'}`;
            if (!window.__pmHistories[id]) window.__pmHistories[id] = {};
            window.__pmHistories[id][currentPersona] = [...conversationHistory.slice(-20)];
            localStorage.setItem('ST_SMS_DATA_V2', JSON.stringify(window.__pmHistories));
            
            return sentences;
        } catch (e) { return ["（发送失败）"]; }
    }

    // ── 6. UI 交互 ──
    function addBubble(text, side) {
        const list = phoneWindow?.querySelector('.pm-msg-list');
        if (!list) return;
        list.appendChild(createBubbleElement(text, side));
        list.scrollTop = list.scrollHeight;
    }

    window.__pmSend = async () => {
        if (isGenerating) return;
        const input = phoneWindow.querySelector('.pm-input');
        const val = input.value.trim();
        if (!val) return;
        input.value = '';
        
        const userChunks = val.split(/[/／]/).map(s => s.trim()).filter(s => s.length > 0);
        userChunks.forEach(c => addBubble(c, 'right'));
        
        isGenerating = true;
        const sentenceList = await fetchSMS(val);
        for (const s of sentenceList) {
            await new Promise(r => setTimeout(r, 600));
            addBubble(s, 'left');
        }
        isGenerating = false;
    };

    window.__pmShowList = () => {
        // 核心修复1：打开新列表前，先干掉旧的弹窗，防止层叠
        if (document.getElementById('pm-overlay')) document.getElementById('pm-overlay').remove();
        
        const c = getCtx();
        const id = `${c.characterId}_${c.chat_file || 'default'}`;
        const list = Object.keys(window.__pmHistories[id] || {});
        const ov = document.createElement('div');
        ov.id = 'pm-overlay';
        
        // 核心修复2：给叉号和按钮加上 cursor: pointer
        ov.innerHTML = `
            <div class="pm-modal">
                <div style="display:flex;justify-content:space-between;margin-bottom:15px;align-items:center;">
                    <b style="font-size:16px;">联系人管理</b>
                    <span onclick="this.closest('#pm-overlay').remove()" style="cursor:pointer;font-size:22px;color:#999;line-height:1;">✕</span>
                </div>
                <div style="max-height:200px;overflow-y:auto;margin-bottom:10px;">
                    ${list.map(n => `<div class="pm-li"><span onclick="window.__pmSwitch('${n}')">${n}</span><i onclick="window.__pmDel('${n}')">移除</i></div>`).join('')}
                </div>
                <input id="pm-add" placeholder="新名字..." style="width:100%;padding:10px;border-radius:8px;border:1px solid #ddd;box-sizing:border-box;outline:none;margin-bottom:12px;">
                <button onclick="window.__pmSwitch(document.getElementById('pm-add').value)" style="width:100%;padding:12px;background:#007aff;color:#fff;border:none;border-radius:10px;cursor:pointer;font-weight:bold;font-size:15px;">添加并切换</button>
            </div>`;
        document.body.appendChild(ov);
    };

    window.__pmSwitch = (name) => {
        if (!name) return;
        const c = getCtx();
        const id = `${c.characterId}_${c.chat_file || 'default'}`;
        currentPersona = name;
        conversationHistory = window.__pmHistories[id]?.[name] || [];
        if (phoneWindow) {
            phoneWindow.querySelector('.pm-name').textContent = name;
            const list = phoneWindow.querySelector('.pm-msg-list');
            list.innerHTML = '';
            conversationHistory.forEach(m => {
                const sents = m.content.split(/[/／]|(?<=[。！？!?])\s*/).filter(s=>s.trim().length>0);
                sents.forEach(s => addBubble(s, m.role === 'user' ? 'right' : 'left'));
            });
        }
        if(document.getElementById('pm-overlay')) document.getElementById('pm-overlay').remove();
    };

    window.__pmDel = (n) => { 
        const c = getCtx();
        const id = `${c.characterId}_${c.chat_file || 'default'}`;
        delete window.__pmHistories[id][n]; 
        localStorage.setItem('ST_SMS_DATA_V2', JSON.stringify(window.__pmHistories));
        window.__pmShowList(); 
    };

    window.__pmToggleMin = () => { isMinimized = !isMinimized; phoneWindow.classList.toggle('is-min', isMinimized); };
    window.__pmEnd = () => { phoneWindow?.remove(); phoneActive = false; };

    // ── 7. 初始化与唤起 ──
    window.__pmOpen = () => {
        if (phoneActive) return;
        const c = getCtx();
        const defaultChar = c?.characters?.[c.characterId]?.name ?? 'AI';
        
        try { window.__pmHistories = JSON.parse(localStorage.getItem('ST_SMS_DATA_V2')) || {}; } catch(e) {}

        phoneWindow = document.createElement('div');
        phoneWindow.id = 'pm-iphone-v18';
        phoneWindow.innerHTML = `
            <div class="pm-island"></div>
            <div class="pm-main-ui">
                <div class="pm-navbar">
                    <button onclick="window.__pmShowList()" class="pm-nav-btn">≡</button>
                    <div class="pm-name">${defaultChar}</div>
                    <button onclick="window.__pmEnd()" class="pm-nav-btn" style="color:#ff3b30">✕</button>
                </div>
                <div class="pm-msg-list"></div>
                <div class="pm-input-bar">
                    <input class="pm-input" placeholder="iMessage">
                    <button onclick="window.__pmSend()" class="pm-up-btn">↑</button>
                </div>
            </div>`;
        document.body.appendChild(phoneWindow);
        phoneActive = true;
        bindIsland(phoneWindow, phoneWindow.querySelector('.pm-island'));
        window.__pmSwitch(defaultChar);
        phoneWindow.querySelector('.pm-input').onkeydown = e => { if(e.key === 'Enter') window.__pmSend(); };
    };

    const css = `
        #pm-iphone-v18 { position: fixed; bottom: 40px; right: 40px; width: 330px; height: 580px; background: #fff; border: 10px solid #111; border-radius: 45px; z-index: 100000; display: flex; flex-direction: column; overflow: hidden; box-shadow: 0 20px 50px rgba(0,0,0,0.4); transition: 0.35s cubic-bezier(0.18, 0.89, 0.32, 1.2); font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; touch-action: none; }
        #pm-iphone-v18.is-min { height: 48px; width: 130px; border-radius: 24px; border-width: 6px; }
        #pm-iphone-v18.is-min .pm-main-ui { display: none; }
        .pm-island { width: 100px; height: 26px; background: #000; margin: 10px auto; border-radius: 15px; cursor: move; flex-shrink: 0; touch-action: none; z-index: 10; }
        .pm-main-ui { flex: 1; display: flex; flex-direction: column; overflow: hidden; }
        .pm-navbar { display: flex; align-items: center; justify-content: space-between; padding: 5px 15px; border-bottom: 1px solid #f2f2f7; }
        .pm-name { font-weight: 700; color: #000; font-size: 15px; }
        .pm-nav-btn { background: none; border: none; font-size: 22px; cursor: pointer; color:#007aff; }
        .pm-msg-list { flex: 1; overflow-y: auto; padding: 15px; display: flex; flex-direction: column; gap: 8px; background: #fff; }
        .pm-bubble { max-width: 75%; padding: 10px 15px; border-radius: 18px; font-size: 14px; line-height: 1.4; animation: pm-pop 0.3s ease-out; word-wrap: break-word; }
        .pm-right { align-self: flex-end; background: #007aff; color: #fff; border-bottom-right-radius: 4px; }
        .pm-left { align-self: flex-start; background: #e9e9eb; color: #000; border-bottom-left-radius: 4px; }
        .pm-transfer-card { background: #ff9500; color: #fff; border-radius: 18px; padding: 12px 15px; display: flex; align-items: center; gap: 12px; min-width: 160px; box-shadow: 0 4px 10px rgba(255,149,0,0.3); }
        .pm-t-icon { width: 36px; height: 36px; background: #fff; color: #ff9500; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 20px; font-weight: 800; }
        .pm-t-info { display: flex; flex-direction: column; }
        .pm-img-card { background: #f2f2f7; border: 1px solid #ddd; padding: 15px; border-radius: 18px; color: #666; font-size: 13px; text-align: center; }
        .pm-input-bar { padding: 10px 15px 35px; display: flex; gap: 10px; border-top: 1px solid #f2f2f7; align-items: center; background: #fff; }
        .pm-input { flex: 1; background: #f2f2f7 !important; color: #000 !important; border: none; border-radius: 20px; padding: 10px 15px; outline: none; font-size: 14px; }
        .pm-up-btn { width: 32px; height: 32px; background: #007aff; color: #fff; border: none; border-radius: 50%; cursor: pointer; font-weight: bold; font-size: 16px; display: flex; align-items: center; justify-content: center; }
        #pm-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.5); z-index: 100001; display: flex; align-items: center; justify-content: center; }
        .pm-modal { background: #fff; padding: 20px; border-radius: 25px; width: 280px; box-shadow: 0 20px 40px rgba(0,0,0,0.3); font-family: sans-serif; }
        .pm-li { display: flex; justify-content: space-between; padding: 10px 0; border-bottom: 1px solid #f2f2f7; font-size: 14px; align-items: center; }
        .pm-li span { color: #007aff; cursor: pointer; flex: 1; font-weight: 500; }
        .pm-li i { color: #fff; background: #ff3b30; cursor: pointer; font-style: normal; font-size: 12px; padding: 4px 10px; border-radius: 10px; font-weight: bold; }
    `;

    if (!document.getElementById('pm-v18-css')) {
        const s = document.createElement('style'); s.id = 'pm-v18-css'; s.innerHTML = css; document.head.appendChild(s);
    }

    document.addEventListener('keydown', e => {
        if(e.key === 'Enter' && !e.shiftKey) {
            const ta = document.getElementById('send_textarea');
            if(ta && document.activeElement === ta && ta.value.trim() === '/phone') {
                e.preventDefault();
                e.stopImmediatePropagation();
                ta.value = '';
                window.__pmOpen();
            }
        }
    }, true);

    if (typeof window.SlashCommandParser !== 'undefined' && window.SlashCommandParser.addCommandObject) {
        try {
            window.SlashCommandParser.addCommandObject(
                window.SlashCommandParser.registerCommand('phone', () => { window.__pmOpen(); return ''; }, [], 'Open Phone', true, true)
            );
        } catch(err) {}
    }

    console.log("iPhone SMS V18 (UI Details Polished) Loaded.");
})();
