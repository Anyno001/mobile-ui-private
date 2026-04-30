(async function () {
    await new Promise(r => setTimeout(r, 2000));

    // ── 状态 ──────────────────────────────────────────
    let phoneActive = false;
    let phoneWindow = null;
    let conversationHistory = []; // 存储对话历史 {role, content}
    let isGenerating = false;

    // ── 工具函数 ──────────────────────────────────────

    function getCurrentCharName() {
        try {
            const ctx = SillyTavern.getContext();
            const char = ctx.characters?.[ctx.characterId];
            return char?.name ?? '未知';
        } catch { return '未知'; }
    }

    function getCharPersona() {
        try {
            const ctx = SillyTavern.getContext();
            const char = ctx.characters?.[ctx.characterId];
            // 读取角色描述作为系统提示
            return char?.description ?? '';
        } catch { return ''; }
    }

    function splitUserParts(text) {
        return text.split('/').map(s => s.trim()).filter(Boolean);
    }

    function splitAISentences(text) {
        const clean = text.replace(/\*+/g, '').replace(/_+/g, '').trim();
        return clean.split(/(?<=[。！？!?\n])\s*/)
            .map(s => s.trim()).filter(Boolean).slice(0, 8);
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

    // ── 直接调用 API 获取 AI 回复 ─────────────────────

    async function getAIReply(userMessage) {
        const ctx = SillyTavern.getContext();
        const charName = getCurrentCharName();
        const persona = getCharPersona();

        // 构建系统提示
        const systemPrompt = persona
            ? `你正在扮演"${charName}"，通过手机短信与用户聊天。以下是你的角色设定：\n${persona}\n\n请用符合角色性格的方式回复，语气自然，像真实发短信一样简短。`
            : `你正在扮演"${charName}"，通过手机短信与用户聊天。请用自然简短的方式回复，像真实发短信一样。`;

        // 加入对话历史
        conversationHistory.push({ role: 'user', content: userMessage });

        // 获取当前使用的 API 设置
        const connectionManager = ctx.connectionManager;
        const apiUrl = ctx.apiUrl;

        // 使用酒馆自己的生成函数
        try {
            // 方法：通过酒馆内部的 generateQuietPrompt
            const reply = await ctx.generateQuietPrompt(userMessage, false, false, systemPrompt, charName);
            conversationHistory.push({ role: 'assistant', content: reply });
            return reply;
        } catch (e) {
            console.error('[phone-mode] generateQuietPrompt 失败:', e);
            // 降级：返回错误提示
            return '（网络异常，请稍后重试）';
        }
    }

    // ── 气泡操作 ──────────────────────────────────────

    function getMessagesDiv() {
        return phoneWindow?.querySelector('.pm-messages');
    }

    function appendBubble(text, side) {
        const div = getMessagesDiv();
        if (!div) return;
        const b = document.createElement('div');
        b.className = `pm-bubble pm-${side}`;
        b.innerHTML = renderBubbleContent(text);
        div.appendChild(b);
        div.scrollTop = div.scrollHeight;
    }

    function appendNote(text) {
        const div = getMessagesDiv();
        if (!div) return;
        const n = document.createElement('div');
        n.className = 'pm-system-note';
        n.textContent = text;
        div.appendChild(n);
        div.scrollTop = div.scrollHeight;
    }

    function showTypingIndicator() {
        const div = getMessagesDiv();
        if (!div) return;
        const t = document.createElement('div');
        t.className = 'pm-bubble pm-left pm-typing';
        t.id = 'pm-typing-indicator';
        t.innerHTML = '<span></span><span></span><span></span>';
        div.appendChild(t);
        div.scrollTop = div.scrollHeight;
    }

    function removeTypingIndicator() {
        document.getElementById('pm-typing-indicator')?.remove();
    }

    // ── 发送消息流程 ──────────────────────────────────

    window.__pmSend = async function () {
        if (!phoneActive || isGenerating) return;
        const input = phoneWindow?.querySelector('.pm-input');
        const raw = input?.value?.trim();
        if (!raw) return;
        input.value = '';

        // 显示右侧气泡
        splitUserParts(raw).forEach(p => appendBubble(p, 'right'));

        // 锁定输入
        isGenerating = true;
        const sendBtn = phoneWindow?.querySelector('.pm-send-btn');
        if (sendBtn) sendBtn.disabled = true;
        if (input) input.disabled = true;

        // 显示打字指示器
        showTypingIndicator();

        // 获取 AI 回复
        const reply = await getAIReply(raw);
        removeTypingIndicator();

        // 显示左侧气泡（拆分）
        splitAISentences(reply).forEach(s => appendBubble(s, 'left'));

        // 解锁输入
        isGenerating = false;
        if (sendBtn) sendBtn.disabled = false;
        if (input) {
            input.disabled = false;
            input.focus();
        }
    };

    window.__pmEnd = function () {
        endPhoneMode(true);
    };

    // ── 拖拽逻辑 ──────────────────────────────────────

    function makeDraggable(el, handle) {
        let ox = 0, oy = 0, mx = 0, my = 0;
        handle.addEventListener('mousedown', function (e) {
            e.preventDefault();
            ox = e.clientX - el.offsetLeft;
            oy = e.clientY - el.offsetTop;
            document.addEventListener('mousemove', onDrag);
            document.addEventListener('mouseup', stopDrag);
        });
        function onDrag(e) {
            el.style.left = (e.clientX - ox) + 'px';
            el.style.top = (e.clientY - oy) + 'px';
            el.style.right = 'auto';
            el.style.bottom = 'auto';
        }
        function stopDrag() {
            document.removeEventListener('mousemove', onDrag);
            document.removeEventListener('mouseup', stopDrag);
        }
    }

    // ── 手机窗口构建 ──────────────────────────────────

    function buildPhoneWindow(charName) {
        const win = document.createElement('div');
        win.id = 'pm-phone-window';
        win.innerHTML = `
<div class="pm-titlebar">
  <div class="pm-header-left">
    <div class="pm-avatar">${escapeHtml(charName[0] ?? '?')}</div>
    <div class="pm-header-info">
      <span class="pm-char-name">${escapeHtml(charName)}</span>
      <span class="pm-status">短信对话中</span>
    </div>
  </div>
  <div class="pm-header-btns">
    <button class="pm-minimize-btn" onclick="__pmToggle()" title="最小化">─</button>
    <button class="pm-end-btn" onclick="__pmEnd()" title="结束通话">✕</button>
  </div>
</div>
<div class="pm-body">
  <div class="pm-messages"></div>
  <div class="pm-input-row">
    <textarea class="pm-input" rows="2" placeholder="输入消息…用 / 分隔多条&#10;Enter发送，Shift+Enter换行"></textarea>
    <button class="pm-send-btn" onclick="__pmSend()">发送</button>
  </div>
</div>`;

        // Enter 键绑定
        win.querySelector('.pm-input').addEventListener('keydown', e => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                e.stopPropagation();
                window.__pmSend();
            }
        });

        // 拖拽
        makeDraggable(win, win.querySelector('.pm-titlebar'));

        document.body.appendChild(win);
        return win;
    }

    // 最小化/展开
    let minimized = false;
    window.__pmToggle = function () {
        if (!phoneWindow) return;
        const body = phoneWindow.querySelector('.pm-body');
        minimized = !minimized;
        body.style.display = minimized ? 'none' : 'flex';
        phoneWindow.querySelector('.pm-minimize-btn').textContent = minimized ? '□' : '─';
    };

    // ── 核心流程 ──────────────────────────────────────

    async function startPhoneMode() {
        if (phoneActive) {
            // 如果窗口存在就显示它
            if (phoneWindow) {
                phoneWindow.style.display = 'flex';
                toastr.info('手机模式已在运行，窗口已显示');
            }
            return;
        }

        const charName = getCurrentCharName();
        conversationHistory = [];

        phoneWindow = buildPhoneWindow(charName);
        phoneActive = true;

        appendNote(`与 ${charName} 的对话开始`);
        toastr.success(`📱 手机模式已开启 | ${charName}`);
    }

    function endPhoneMode(showToast = true) {
        if (!phoneActive) return;
        appendNote('── 通话已结束 ──');
        setTimeout(() => {
            phoneWindow?.remove();
            phoneWindow = null;
        }, 1500);
        phoneActive = false;
        conversationHistory = [];
        isGenerating = false;
        if (showToast) toastr.info('📴 手机模式已结束');
    }

    // ── 拦截 /phone 命令 ──────────────────────────────

    document.addEventListener('keydown', function (e) {
        if (e.key !== 'Enter' || e.shiftKey) return;
        const ta = document.getElementById('send_textarea');
        if (!ta || document.activeElement !== ta) return;
        const val = ta.value.trim();
        if (val === '/phone') {
            e.preventDefault();
            e.stopImmediatePropagation();
            ta.value = '';
            startPhoneMode();
        }
    }, true);

    // ── 样式注入 ──────────────────────────────────────

    if (!document.getElementById('pm-styles')) {
        const s = document.createElement('style');
        s.id = 'pm-styles';
        s.textContent = `
#pm-phone-window {
    position: fixed !important;
    bottom: 80px !important;
    right: 24px !important;
    width: 360px !important;
    display: flex !important;
    flex-direction: column !important;
    background: #e5e9f0 !important;
    border-radius: 20px !important;
    overflow: hidden !important;
    font-family: -apple-system, BlinkMacSystemFont, 'PingFang SC', 'Microsoft YaHei', sans-serif !important;
    box-shadow: 0 12px 40px rgba(0,0,0,0.25) !important;
    z-index: 99999 !important;
    border: 1px solid rgba(255,255,255,0.3) !important;
}
.pm-titlebar {
    background: #f7f7f7 !important;
    padding: 12px 14px !important;
    display: flex !important;
    justify-content: space-between !important;
    align-items: center !important;
    border-bottom: 1px solid #ddd !important;
    cursor: grab !important;
    user-select: none !important;
}
.pm-titlebar:active { cursor: grabbing !important; }
.pm-header-left {
    display: flex !important;
    align-items: center !important;
    gap: 10px !important;
}
.pm-avatar {
    width: 36px !important;
    height: 36px !important;
    border-radius: 50% !important;
    background: #007aff !important;
    color: #fff !important;
    display: flex !important;
    align-items: center !important;
    justify-content: center !important;
    font-size: 15px !important;
    font-weight: 700 !important;
    flex-shrink: 0 !important;
}
.pm-header-info {
    display: flex !important;
    flex-direction: column !important;
}
.pm-char-name {
    font-size: 14px !important;
    font-weight: 600 !important;
    color: #111 !important;
    line-height: 1.2 !important;
}
.pm-status {
    font-size: 11px !important;
    color: #4cd964 !important;
}
.pm-header-btns {
    display: flex !important;
    gap: 6px !important;
}
.pm-minimize-btn, .pm-end-btn {
    border: none !important;
    border-radius: 50% !important;
    width: 26px !important;
    height: 26px !important;
    font-size: 12px !important;
    cursor: pointer !important;
    display: flex !important;
    align-items: center !important;
    justify-content: center !important;
    font-family: inherit !important;
}
.pm-minimize-btn {
    background: #ffbd2e !important;
    color: #7a5800 !important;
}
.pm-end-btn {
    background: #ff5f57 !important;
    color: #7a0000 !important;
}
.pm-minimize-btn:hover { background: #e6a800 !important; }
.pm-end-btn:hover { background: #e0322a !important; }
.pm-body {
    display: flex !important;
    flex-direction: column !important;
}
.pm-messages {
    min-height: 300px !important;
    max-height: 400px !important;
    overflow-y: auto !important;
    padding: 14px !important;
    display: flex !important;
    flex-direction: column !important;
    gap: 8px !important;
    background: #e5e9f0 !important;
}
.pm-bubble {
    max-width: 75% !important;
    padding: 9px 13px !important;
    border-radius: 18px !important;
    font-size: 14px !important;
    line-height: 1.5 !important;
    word-break: break-word !important;
    box-shadow: 0 1px 2px rgba(0,0,0,0.1) !important;
}
.pm-right {
    align-self: flex-end !important;
    background: #007aff !important;
    color: #fff !important;
    border-bottom-right-radius: 4px !important;
}
.pm-left {
    align-self: flex-start !important;
    background: #fff !important;
    color: #111 !important;
    border-bottom-left-radius: 4px !important;
}
.pm-typing {
    display: flex !important;
    gap: 4px !important;
    align-items: center !important;
    padding: 12px 16px !important;
}
.pm-typing span {
    width: 7px !important;
    height: 7px !important;
    border-radius: 50% !important;
    background: #aaa !important;
    display: inline-block !important;
    animation: pm-bounce 1.2s infinite !important;
}
.pm-typing span:nth-child(2) { animation-delay: 0.2s !important; }
.pm-typing span:nth-child(3) { animation-delay: 0.4s !important; }
@keyframes pm-bounce {
    0%,60%,100% { transform: translateY(0); }
    30% { transform: translateY(-6px); }
}
.pm-text { white-space: pre-wrap !important; }
.pm-card {
    display: inline-block !important;
    border-radius: 10px !important;
    padding: 5px 10px !important;
    font-size: 13px !important;
    font-weight: 500 !important;
}
.pm-transfer { background: #fff3e0 !important; color: #e65100 !important; }
.pm-image { background: #e3f2fd !important; color: #0277bd !important; }
.pm-system-note {
    text-align: center !important;
    font-size: 11px !important;
    color: #999 !important;
    padding: 4px !important;
}
.pm-input-row {
    background: #f7f7f7 !important;
    padding: 10px 12px !important;
    display: flex !important;
    gap: 8px !important;
    align-items: flex-end !important;
    border-top: 1px solid #ddd !important;
}
.pm-input {
    flex: 1 !important;
    border: 1px solid #ccc !important;
    border-radius: 18px !important;
    padding: 8px 14px !important;
    font-size: 14px !important;
    resize: none !important;
    outline: none !important;
    font-family: inherit !important;
    background: #fff !important;
    color: #111 !important;
    line-height: 1.4 !important;
}
.pm-input:disabled { background: #f0f0f0 !important; color: #999 !important; }
.pm-send-btn {
    background: #007aff !important;
    color: #fff !important;
    border: none !important;
    border-radius: 18px !important;
    padding: 8px 16px !important;
    font-size: 14px !important;
    cursor: pointer !important;
    font-weight: 600 !important;
    font-family: inherit !important;
    white-space: nowrap !important;
}
.pm-send-btn:disabled { background: #ccc !important; cursor: default !important; }
        `;
        document.head.appendChild(s);
    }

    console.log('[phone-mode] 加载完成，输入 /phone 然后按 Enter 召唤');
})();
