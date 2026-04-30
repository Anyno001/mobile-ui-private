(async function () {
    await new Promise(r => setTimeout(r, 2000));

    // ── 全局状态持久化 ──
    window.__pmHistories = window.__pmHistories || {}; // { chatId: { personaName: [ {role, content} ] } }
    
    let phoneActive = false;
    let phoneWindow = null;
    let conversationHistory = [];
    let currentPersona = '';
    let isGenerating = false;
    let minimized = false;

    // 监听酒馆聊天存档切换/角色切换，自动关闭手机
    if (!window.__pmEventHooked && typeof eventSource !== 'undefined') {
        eventSource.on('chat_changed', () => { if (phoneActive) window.__pmEnd(false); });
        eventSource.on('character_page_loaded', () => { if (phoneActive) window.__pmEnd(false); });
        window.__pmEventHooked = true;
    }

    // ── 工具函数 ──────────────────────────────────────

    function getCurrentChatId() {
        try {
            const ctx = SillyTavern.getContext();
            // 组合角色ID与聊天文件名作为唯一存档ID
            return `${ctx.characterId}_${ctx.chat_file || 'default'}`;
        } catch { return 'unknown_chat'; }
    }

    function getBaseCharName() {
        try {
            const ctx = SillyTavern.getContext();
            return ctx.characters?.[ctx.characterId]?.name ?? '未知角色';
        } catch { return '未知角色'; }
    }

    // 截断历史记录并保存到全局
    function saveConversation() {
        if (conversationHistory.length > 30) {
            conversationHistory = conversationHistory.slice(-30);
        }
        const chatId = getCurrentChatId();
        if (!window.__pmHistories[chatId]) window.__pmHistories[chatId] = {};
        window.__pmHistories[chatId][currentPersona] = [...conversationHistory];
    }

    function splitUserParts(text) {
        return text.split('/').map(s => s.trim()).filter(Boolean);
    }

    function splitAISentences(text) {
        const clean = cleanText(text);
        return clean.split(/(?<=[。！？!?\n])\s*/)
            .map(s => s.trim()).filter(Boolean).slice(0, 8); // 强制最多截取8句
    }

    function cleanText(text) {
        return (text ?? '')
            .replace(/<thinking>[\s\S]*?<\/thinking>/gi, '')
            .replace(/<[^>]+>/g, '')
            .replace(/\*+([^*]+)\*+/g, '$1')
            .replace(/_+([^_]+)_+/g, '$1')
            .replace(/#{1,6}\s/g, '')
            .trim();
    }

    function escapeHtml(str) {
        return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    }

    function renderBubbleContent(text) {
        const parts = [];
        const re = /[（(](转账|图片)[+\s：:]*([\d.]+|[^）)]+)[）)]/g;
        let last = 0, m;
        while ((m = re.exec(text)) !== null) {
            if (m.index > last) parts.push({ type: 'text', value: text.slice(last, m.index) });
            if (m[1] === '转账') parts.push({ type: 'transfer', value: parseFloat(m[2]) || 0 });
            else parts.push({ type: 'image', value: m[2].trim() });
            last = m.index + m[0].length;
        }
        if (last < text.length) parts.push({ type: 'text', value: text.slice(last) });
        return parts.map(p => {
            if (p.type === 'transfer') return `<div class="pm-card pm-transfer">💸 转账 ¥${p.value.toFixed(2)}</div>`;
            if (p.type === 'image') return `<div class="pm-card pm-image">🖼️ ${escapeHtml(p.value)}</div>`;
            const safe = escapeHtml(p.value).replace(/\n/g,'<br>');
            return safe ? `<span class="pm-text">${safe}</span>` : '';
        }).join('');
    }

    function refreshMessagesDOM() {
        const div = phoneWindow?.querySelector('.pm-messages');
        if (!div) return;
        div.innerHTML = ''; // 清空
        // 渲染历史
        conversationHistory.forEach(msg => {
            appendBubble(msg.content, msg.role === 'user' ? 'right' : 'left', false);
        });
        const histCount = conversationHistory.length;
        appendNote(histCount > 0 ? `与 ${currentPersona} 已加载 ${histCount} 条历史记录（上限30）` : `与 ${currentPersona} 的对话开始`);
    }

    // ── API 调用（关键修改点：支持自定义角色且读取世界书） ──

    async function getAIReply(userMessage) {
        const ctx = SillyTavern.getContext();
        
        // 记录用户消息并截断保存
        conversationHistory.push({ role: 'user', content: userMessage });
        saveConversation();

        try {
            // 将历史对话格式化为一段上下文提示词
            const historyText = conversationHistory.slice(0, -1).map(m => 
                `${m.role === 'user' ? '我' : currentPersona}: ${m.content}`
            ).join('\n');

            const systemPrompt = `【手机短信模式】此提示处于最高优先级。`;
            const fullMessage = `【系统指令：请你暂时脱离当前主控角色，扮演名为"${currentPersona}"的角色与我发短信。请你结合世界书和当前设定集中的信息来演绎该角色的性格。\n要求：\n1. 回复必须像真实手机短信一样自然。\n2. 长度严格控制在 3 到 8 句话之间。\n3. 不要输出任何心理活动、动作描写（如*动作*）或思考标签，仅输出发出的短信文本内容。】\n\n【之前的历史短信记录】\n${historyText ? historyText : '暂无历史记录'}\n\n【我发来的最新短信】\n我: ${userMessage}\n${currentPersona}:`;

            let reply = '';
            // 使用 generateQuietPrompt 会自动附加当前的酒馆世界书和设定集，实现读取上下文
            if (typeof ctx.generateQuietPrompt === 'function') {
                reply = await ctx.generateQuietPrompt(fullMessage, false, false, systemPrompt, currentPersona);
            } else {
                reply = '（API版本不支持，请更新SillyTavern）';
            }

            reply = cleanText(reply);
            conversationHistory.push({ role: 'assistant', content: reply });
            saveConversation();
            
            return reply;
        } catch (e) {
            console.error('[phone-mode] AI调用失败:', e);
            conversationHistory.pop(); // 失败回退
            return '（网络信号差，发送失败）';
        }
    }

    // ── 气泡操作 ──────────────────────────────────────

    function getMessagesDiv() { return phoneWindow?.querySelector('.pm-messages'); }

    function appendBubble(text, side, scroll = true) {
        const div = getMessagesDiv();
        if (!div) return;
        const b = document.createElement('div');
        b.className = `pm-bubble pm-${side}`;
        b.innerHTML = renderBubbleContent(text);
        div.appendChild(b);
        if (scroll) div.scrollTop = div.scrollHeight;
    }

    function appendNote(text) {
        const div = getMessagesDiv();
        if (!div) return;
        const n = document.createElement('div');
        n.className = 'pm-system-note';
        n.textContent = text;
        div.prepend(n); // 放在顶部
    }

    function showTyping() {
        const div = getMessagesDiv();
        if (!div || document.getElementById('pm-typing')) return;
        const t = document.createElement('div');
        t.className = 'pm-bubble pm-left pm-typing';
        t.id = 'pm-typing';
        t.innerHTML = '<span></span><span></span><span></span>';
        div.appendChild(t);
        div.scrollTop = div.scrollHeight;
    }

    function hideTyping() { document.getElementById('pm-typing')?.remove(); }

    // ── 角色选择弹窗（修改为手动输入自定义名字） ────────

    function showPersonaPicker() {
        document.getElementById('pm-char-picker')?.remove();

        const picker = document.createElement('div');
        picker.id = 'pm-char-picker';

        picker.innerHTML = `
<div class="pm-picker-overlay" onclick="document.getElementById('pm-char-picker').remove()"></div>
<div class="pm-picker-box" style="padding: 20px;">
  <div style="font-size:15px; font-weight:bold; margin-bottom:15px; color:#333;">输入要联系的对象名字</div>
  <div style="font-size:12px; color:#666; margin-bottom:10px;">（AI会自动搜索世界书和角色卡设定来演绎此人）</div>
  <input type="text" id="pm-persona-input" class="pm-input" placeholder="例如：某某 NPC" style="width:100%; margin-bottom:15px; border:1px solid #ccc; padding:8px; border-radius:8px;" />
  <button class="pm-send-btn" style="width:100%; padding:10px;" onclick="__pmConfirmPersona()">确认切换</button>
</div>`;
        document.body.appendChild(picker);
        document.getElementById('pm-persona-input').focus();
    }

    window.__pmConfirmPersona = function() {
        const newName = document.getElementById('pm-persona-input').value.trim();
        if (!newName) {
            toastr.warning('名字不能为空');
            return;
        }
        document.getElementById('pm-char-picker')?.remove();
        
        // 切换逻辑
        currentPersona = newName;
        const chatId = getCurrentChatId();
        conversationHistory = window.__pmHistories[chatId]?.[currentPersona] || [];
        
        // 更新UI
        if (phoneWindow) {
            const nameEl = phoneWindow.querySelector('.pm-char-name');
            const avatarEl = phoneWindow.querySelector('.pm-avatar');
            if (nameEl) nameEl.textContent = currentPersona;
            if (avatarEl) avatarEl.textContent = currentPersona[0] ?? '?';
            refreshMessagesDOM();
        }
        toastr.success(`已切换联系人：${currentPersona}`);
    };

    // ── 发送消息 ──────────────────────────────────────

    window.__pmSend = async function () {
        if (!phoneActive || isGenerating) return;
        const input = phoneWindow?.querySelector('.pm-input');
        const raw = input?.value?.trim();
        if (!raw) return;
        input.value = '';

        splitUserParts(raw).forEach(p => appendBubble(p, 'right'));

        isGenerating = true;
        const sendBtn = phoneWindow?.querySelector('.pm-send-btn');
        if (sendBtn) sendBtn.disabled = true;
        if (input) input.disabled = true;

        showTyping();
        const reply = await getAIReply(raw);
        hideTyping();

        splitAISentences(reply).forEach(s => appendBubble(s, 'left'));

        isGenerating = false;
        if (sendBtn) sendBtn.disabled = false;
        if (input) { input.disabled = false; input.focus(); }
    };

    window.__pmEnd = function (showToast = true) {
        if (!phoneActive) return;
        saveConversation(); // 退出前再保存一次策保险
        setTimeout(() => { phoneWindow?.remove(); phoneWindow = null; }, 500);
        phoneActive = false;
        isGenerating = false;
        minimized = false;
        if (showToast) toastr.info('📴 手机模式已结束并保存记录');
    };
    
    window.__pmToggle = function () {
        if (!phoneWindow) return;
        minimized = !minimized;
        if (minimized) {
            phoneWindow.classList.add('pm-minimized');
            phoneWindow.querySelector('.pm-minimize-btn').textContent = '▢';
        } else {
            phoneWindow.classList.remove('pm-minimized');
            phoneWindow.querySelector('.pm-minimize-btn').textContent = '─';
        }
    };
    window.__pmPickChar = function () { showPersonaPicker(); };

    // ── 拖拽（彻底修复坐标问题版）────────────────────────────

    function makeDraggable(el, handle) {
        let startX, startY, startLeft, startTop;
        handle.addEventListener('mousedown', function (e) {
            if (e.target.tagName === 'BUTTON') return;
            e.preventDefault();
            const rect = el.getBoundingClientRect();
            
            // 关键修复：每次拖拽前，将当前的坐标强制转化为 left / top 固定值，清除 bottom / right 导致的反向拉伸
            el.style.left = rect.left + 'px';
            el.style.top = rect.top + 'px';
            el.style.bottom = 'auto';
            el.style.right = 'auto';

            startX = e.clientX;
            startY = e.clientY;
            startLeft = rect.left;
            startTop = rect.top;
            
            document.addEventListener('mousemove', onDrag);
            document.addEventListener('mouseup', stopDrag);
        });
        function onDrag(e) {
            el.style.left = (startLeft + (e.clientX - startX)) + 'px';
            el.style.top = (startTop + (e.clientY - startY)) + 'px';
        }
        function stopDrag() {
            document.removeEventListener('mousemove', onDrag);
            document.removeEventListener('mouseup', stopDrag);
        }
    }

    // ── 构建窗口 ──────────────────────────────────────

    function buildPhoneWindow(charName) {
        const win = document.createElement('div');
        win.id = 'pm-phone-window';
        win.innerHTML = `
<div class="pm-titlebar">
  <div class="pm-header-left">
    <div class="pm-avatar">${escapeHtml(charName[0] ?? '?')}</div>
    <div class="pm-header-info">
      <span class="pm-char-name">${escapeHtml(charName)}</span>
      <span class="pm-status">● 短信对话中</span>
    </div>
  </div>
  <div class="pm-header-btns">
    <button class="pm-switch-btn" onclick="__pmPickChar()" title="手动切换对象">⇄</button>
    <button class="pm-minimize-btn" onclick="__pmToggle()" title="最小化/恢复">─</button>
    <button class="pm-end-btn" onclick="__pmEnd()" title="挂断">✕</button>
  </div>
</div>
<div class="pm-body">
  <div class="pm-messages"></div>
  <div class="pm-input-row">
    <textarea class="pm-input" rows="2" placeholder="输入消息… / 分隔多条&#10;Enter发送  Shift+Enter换行"></textarea>
    <button class="pm-send-btn" onclick="__pmSend()">发送</button>
  </div>
</div>`;

        win.querySelector('.pm-input').addEventListener('keydown', e => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                e.stopPropagation();
                window.__pmSend();
            }
        });

        makeDraggable(win, win.querySelector('.pm-titlebar'));
        document.body.appendChild(win);
        return win;
    }

    // ── 核心流程 ──────────────────────────────────────

    async function startPhoneMode() {
        if (phoneActive) {
            if (minimized) window.__pmToggle();
            toastr.info('手机模式已在运行');
            return;
        }

        const baseChar = getBaseCharName();
        // 默认初始化当前主卡角色，如果没有手动输入过的话
        currentPersona = currentPersona || baseChar; 
        
        const chatId = getCurrentChatId();
        conversationHistory = window.__pmHistories[chatId]?.[currentPersona] || [];

        phoneWindow = buildPhoneWindow(currentPersona);
        phoneActive = true;
        minimized = false;
        
        refreshMessagesDOM();

        toastr.success(`📱 手机开启 | 正在联系：${currentPersona}`);
    }

    // ── 拦截 /phone ───────────────────────────────────

    document.addEventListener('keydown', function (e) {
        if (e.key !== 'Enter' || e.shiftKey) return;
        const ta = document.getElementById('send_textarea');
        if (!ta || document.activeElement !== ta) return;
        if (ta.value.trim() === '/phone') {
            e.preventDefault();
            e.stopImmediatePropagation();
            ta.value = '';
            startPhoneMode();
        }
    }, true);

    // ── 样式（更新固定高度和折叠逻辑） ──────────────────────

    if (!document.getElementById('pm-styles')) {
        const s = document.createElement('style');
        s.id = 'pm-styles';
        s.textContent = `
#pm-phone-window {
    position: fixed !important;
    bottom: 80px; 
    right: 24px; 
    width: 340px !important;
    height: 520px !important; /* 关键修改：固定总高度，防止被内部拉伸 */
    display: flex !important;
    flex-direction: column !important;
    background: #e5e9f0 !important;
    border-radius: 20px !important;
    overflow: hidden !important;
    font-family: -apple-system, BlinkMacSystemFont, 'PingFang SC', 'Microsoft YaHei', sans-serif !important;
    box-shadow: 0 12px 40px rgba(0,0,0,0.3) !important;
    z-index: 99999 !important;
    box-sizing: border-box !important;
    transition: height 0.2s ease;
}
/* 最小化类 */
#pm-phone-window.pm-minimized {
    height: 55px !important; /* 只保留标题栏高度 */
}
#pm-phone-window.pm-minimized .pm-body {
    display: none !important;
}

.pm-titlebar {
    background: #f7f7f7 !important;
    height: 55px !important;
    padding: 0 12px !important;
    display: flex !important;
    justify-content: space-between !important;
    align-items: center !important;
    border-bottom: 1px solid #ddd !important;
    cursor: grab !important;
    user-select: none !important;
    flex-shrink: 0 !important;
    box-sizing: border-box !important;
    width: 100% !important;
}
.pm-titlebar:active { cursor: grabbing !important; }
.pm-header-left {
    display: flex !important;
    align-items: center !important;
    gap: 8px !important;
    flex: 1 !important;
}
.pm-avatar {
    width: 32px !important;
    height: 32px !important;
    border-radius: 50% !important;
    background: #007aff !important;
    color: #fff !important;
    display: flex !important;
    align-items: center !important;
    justify-content: center !important;
    font-size: 14px !important;
    font-weight: 700 !important;
}
.pm-header-info { display: flex !important; flex-direction: column !important; }
.pm-char-name { font-size: 13px !important; font-weight: 600 !important; color: #111 !important; }
.pm-status { font-size: 10px !important; color: #4cd964 !important; }
.pm-header-btns { display: flex !important; gap: 5px !important; }
.pm-switch-btn, .pm-minimize-btn, .pm-end-btn {
    border: none !important; border-radius: 50% !important; width: 24px !important; height: 24px !important;
    font-size: 11px !important; cursor: pointer !important; display: flex !important; align-items: center !important; justify-content: center !important;
}
.pm-switch-btn { background: #34c759 !important; color: #fff !important; font-size: 13px !important; }
.pm-minimize-btn { background: #ffbd2e !important; color: #7a5800 !important; }
.pm-end-btn { background: #ff5f57 !important; color: #fff !important; }

.pm-body {
    display: flex !important;
    flex-direction: column !important;
    flex: 1 !important; /* 让聊天部分自动填满剩余空间，解决拉伸 */
    overflow: hidden !important;
}
.pm-messages {
    flex: 1 !important; /* 关键修改：弹性占比 */
    overflow-y: auto !important;
    padding: 12px !important;
    display: flex !important;
    flex-direction: column !important;
    gap: 7px !important;
    background: #e5e9f0 !important;
}
.pm-bubble { max-width: 72% !important; padding: 8px 12px !important; border-radius: 16px !important; font-size: 13px !important; line-height: 1.5 !important; word-break: break-word !important; }
.pm-right { align-self: flex-end !important; background: #007aff !important; color: #fff !important; border-bottom-right-radius: 3px !important; }
.pm-left { align-self: flex-start !important; background: #fff !important; color: #111 !important; border-bottom-left-radius: 3px !important; }
.pm-system-note { text-align: center !important; font-size: 11px !important; color: #999 !important; padding: 3px !important; margin-bottom: 5px !important;}
.pm-typing { display: flex !important; gap: 4px !important; align-items: center !important; padding: 10px 14px !important; width: fit-content !important; }
.pm-typing span { width: 6px !important; height: 6px !important; border-radius: 50% !important; background: #aaa !important; display: inline-block !important; animation: pm-bounce 1.2s infinite !important; }
.pm-typing span:nth-child(2) { animation-delay: 0.2s !important; }
.pm-typing span:nth-child(3) { animation-delay: 0.4s !important; }
@keyframes pm-bounce { 0%,60%,100% { transform: translateY(0); } 30% { transform: translateY(-5px); } }
.pm-input-row { background: #f7f7f7 !important; padding: 8px 10px !important; display: flex !important; gap: 7px !important; align-items: flex-end !important; border-top: 1px solid #ddd !important; flex-shrink: 0 !important; }
.pm-input { flex: 1 !important; border: 1px solid #ccc !important; border-radius: 16px !important; padding: 7px 12px !important; font-size: 13px !important; resize: none !important; outline: none !important; }
.pm-send-btn { background: #007aff !important; color: #fff !important; border: none !important; border-radius: 16px !important; padding: 7px 14px !important; font-size: 13px !important; cursor: pointer !important; font-weight: 600 !important; }
.pm-picker-overlay { position: fixed !important; inset: 0 !important; background: rgba(0,0,0,0.4) !important; z-index: 100000 !important; }
.pm-picker-box { position: fixed !important; top: 50% !important; left: 50% !important; transform: translate(-50%,-50%) !important; background: #fff !important; border-radius: 16px !important; width: 280px !important; z-index: 100001 !important; box-shadow: 0 8px 32px rgba(0,0,0,0.2) !important; }
        `;
        document.head.appendChild(s);
    }

    console.log('[phone-mode] 升级版加载完成，输入 /phone 呼出');
})();
