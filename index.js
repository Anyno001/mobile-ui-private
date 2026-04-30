(async function () {
    await new Promise(r => setTimeout(r, 2000));

    // ── 状态 ──────────────────────────────────────────
    let phoneActive = false;
    let pmElement = null;
    let lastProcessedMesCount = 0; // 记录手机模式开启时的消息数量

    // ── 工具函数 ──────────────────────────────────────

    function getCurrentCharName() {
        try {
            const ctx = SillyTavern.getContext();
            // 优先读取角色名（非文件名）
            const char = ctx.characters?.[ctx.characterId];
            return char?.name ?? '未知';
        } catch { return '未知'; }
    }

    function splitUserParts(text) {
        return text.split('/').map(s => s.trim()).filter(Boolean);
    }

    function splitAISentences(text) {
        // 清理 markdown 符号再拆分
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

    // ── 全局操作函数（供按钮 onclick 调用）────────────

    window.__pmSend = function () {
        if (!pmElement || !phoneActive) return;
        const input = pmElement.querySelector('.pm-input');
        const raw = input?.value?.trim();
        if (!raw) return;
        input.value = '';

        // 右侧气泡
        const div = pmElement.querySelector('.pm-messages');
        splitUserParts(raw).forEach(p => {
            const b = document.createElement('div');
            b.className = 'pm-bubble pm-right';
            b.innerHTML = renderBubbleContent(p);
            div.appendChild(b);
        });
        div.scrollTop = div.scrollHeight;

        // 记录发送前的消息数，用于识别下一条AI回复
        const ctx = SillyTavern.getContext();
        lastProcessedMesCount = ctx.chat?.length ?? 0;

        // 通过酒馆主输入框发送
        const ta = document.getElementById('send_textarea');
        const btn = document.getElementById('send_but');
        if (ta && btn) {
            ta.value = raw;
            // 用原生事件触发，避免被拦截
            ta.dispatchEvent(new Event('input', { bubbles: true }));
            btn.click();
        }
    };

    window.__pmEnd = function () {
        endPhoneMode(true);
    };

    // ── 手机 UI 构建 ──────────────────────────────────

    function buildPhoneElement(charName) {
        const outer = document.createElement('div');
        outer.className = 'pm-outer';
        outer.innerHTML = `
<div class="pm-wrapper">
  <div class="pm-header">
    <div class="pm-header-left">
      <div class="pm-avatar">${escapeHtml(charName[0] ?? '?')}</div>
      <span class="pm-char-name">${escapeHtml(charName)}</span>
    </div>
    <button class="pm-end-btn" onclick="__pmEnd()">结束通话</button>
  </div>
  <div class="pm-messages"></div>
  <div class="pm-input-row">
    <textarea class="pm-input" rows="2" placeholder="输入消息…用 / 分隔多条&#10;Enter发送，Shift+Enter换行"></textarea>
    <button class="pm-send-btn" onclick="__pmSend()">发送</button>
  </div>
</div>`;

        // Enter 键绑定
        outer.querySelector('.pm-input').addEventListener('keydown', e => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                e.stopPropagation();
                window.__pmSend();
            }
        });

        return outer;
    }

    // ── 核心流程 ──────────────────────────────────────

    async function startPhoneMode() {
        if (phoneActive) { toastr.warning('手机模式已在运行中'); return; }

        const charName = getCurrentCharName();

        // 找到聊天列表容器
        const chat = document.getElementById('chat');
        if (!chat) { toastr.error('找不到聊天容器 #chat'); return; }

        // 创建独立楼层容器（模拟酒馆消息行的结构）
        const mesRow = document.createElement('div');
        mesRow.style.cssText = `
            display: block;
            width: 100%;
            padding: 8px 0;
            box-sizing: border-box;
        `;

        pmElement = buildPhoneElement(charName);
        mesRow.appendChild(pmElement);
        chat.appendChild(mesRow);
        chat.scrollTop = chat.scrollHeight;

        // 记录当前消息数，之后只处理新消息
        const ctx = SillyTavern.getContext();
        lastProcessedMesCount = ctx.chat?.length ?? 0;

        phoneActive = true;
        toastr.success(`📱 手机模式已开启 | 对话：${charName}`);
    }

    function endPhoneMode(showToast = true) {
        if (!phoneActive) return;

        if (pmElement) {
            const div = pmElement.querySelector('.pm-messages');
            if (div) {
                const n = document.createElement('div');
                n.className = 'pm-system-note';
                n.textContent = '── 通话已结束 ──';
                div.appendChild(n);
                div.scrollTop = div.scrollHeight;
            }
            pmElement.querySelectorAll('.pm-input,.pm-send-btn,.pm-end-btn')
                .forEach(el => el.setAttribute('disabled', ''));
        }

        phoneActive = false;
        pmElement = null;
        lastProcessedMesCount = 0;
        if (showToast) toastr.info('📴 手机模式已结束');
    }

    // ── 监听 AI 回复（用计数而非 MutationObserver）────

    // 每隔500ms检查是否有新的AI消息
    setInterval(() => {
        if (!phoneActive || !pmElement) return;
        const ctx = SillyTavern.getContext();
        const chat = ctx.chat;
        if (!chat || chat.length <= lastProcessedMesCount) return;

        // 处理所有新消息
        for (let i = lastProcessedMesCount; i < chat.length; i++) {
            const msg = chat[i];
            // 只处理AI回复（非用户、非系统）
            if (!msg || msg.is_user || msg.is_system) continue;

            const text = msg.mes?.replace(/\*+/g,'').replace(/_+/g,'').trim();
            if (!text) continue;

            const div = pmElement.querySelector('.pm-messages');
            if (!div) continue;

            splitAISentences(text).forEach(s => {
                const b = document.createElement('div');
                b.className = 'pm-bubble pm-left';
                b.innerHTML = renderBubbleContent(s);
                div.appendChild(b);
            });
            div.scrollTop = div.scrollHeight;
        }

        lastProcessedMesCount = chat.length;
    }, 500);

    // ── 监听聊天切换，自动重置状态 ────────────────────

    let lastChatId = null;
    setInterval(() => {
        try {
            const ctx = SillyTavern.getContext();
            const currentId = ctx.chatId ?? ctx.characterId;
            if (lastChatId !== null && lastChatId !== currentId) {
                if (phoneActive) {
                    phoneActive = false;
                    pmElement = null;
                    toastr.info('已切换聊天，手机模式已重置');
                }
            }
            lastChatId = currentId;
        } catch {}
    }, 1000);

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
.pm-outer {
    display: flex !important;
    justify-content: center !important;
    width: 100% !important;
    padding: 12px 0 !important;
}
.pm-wrapper {
    display: flex !important;
    flex-direction: column !important;
    width: 420px !important;
    background: #e5e9f0 !important;
    border-radius: 20px !important;
    overflow: hidden !important;
    font-family: -apple-system, BlinkMacSystemFont, 'PingFang SC', 'Microsoft YaHei', sans-serif !important;
    box-shadow: 0 8px 32px rgba(0,0,0,0.18) !important;
}
.pm-header {
    background: #f7f7f7 !important;
    padding: 14px 16px !important;
    display: flex !important;
    justify-content: space-between !important;
    align-items: center !important;
    border-bottom: 1px solid #ddd !important;
}
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
    font-size: 16px !important;
    font-weight: 600 !important;
}
.pm-char-name {
    font-size: 15px !important;
    font-weight: 600 !important;
    color: #111 !important;
}
.pm-end-btn {
    background: #ff3b30 !important;
    color: #fff !important;
    border: none !important;
    border-radius: 14px !important;
    padding: 5px 14px !important;
    font-size: 12px !important;
    cursor: pointer !important;
    font-family: inherit !important;
}
.pm-end-btn:disabled { background: #ccc !important; cursor: default !important; }
.pm-messages {
    min-height: 320px !important;
    max-height: 420px !important;
    overflow-y: auto !important;
    padding: 16px !important;
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
    box-shadow: 0 1px 2px rgba(0,0,0,0.08) !important;
}
.pm-right {
    align-self: flex-end !important;
    background: #007aff !important;
    color: #fff !important;
    border-bottom-right-radius: 5px !important;
}
.pm-left {
    align-self: flex-start !important;
    background: #fff !important;
    color: #111 !important;
    border-bottom-left-radius: 5px !important;
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
    font-size: 12px !important;
    color: #888 !important;
    padding: 6px !important;
    font-style: italic !important;
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
    padding: 8px 18px !important;
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
