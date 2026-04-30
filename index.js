import { getContext, eventSource, event_types } from '../../../../script.js';
import { SlashCommandParser } from '../../../slash-commands/SlashCommandParser.js';
import { SlashCommand } from '../../../slash-commands/SlashCommand.js';
import { ARGUMENT_TYPE, SlashCommandArgument } from '../../../slash-commands/SlashCommandArgument.js';

// ── 状态 ──────────────────────────────────────────────
let phoneActive = false;
let phoneMesIndex = null;  // 手机楼层在 chat[] 中的下标
let lastCharName = '';

// ── 工具函数 ──────────────────────────────────────────

function getCurrentCharName() {
    const ctx = getContext();
    // 群组聊天下没有单一角色，做降级处理
    if (ctx.groupId) return ctx.groups?.find(g => g.id === ctx.groupId)?.name ?? '群组';
    return ctx.characters?.[ctx.characterId]?.name ?? '未知';
}

/** 按 / 拆分用户输入（跳过空片段） */
function splitUserParts(text) {
    return text.split('/').map(s => s.trim()).filter(Boolean);
}

/** 按句子拆分 AI 回复，最多 8 句 */
function splitAISentences(text) {
    return text
        .split(/(?<=[。！？!?\n])\s*/)
        .map(s => s.trim())
        .filter(Boolean)
        .slice(0, 8);
}

function escapeHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

/**
 * 把一段文本转成气泡内容 HTML
 * 支持：(转账+数字) / (图片+描述) / 普通文本
 * 一条文本里可以有多个特殊指令
 */
function renderBubbleContent(text) {
    // 先按"特殊指令"分片，再逐片渲染
    const parts = [];
    // 统一匹配 (转账...) 和 (图片...)，中英文括号
    const specialRE = /[（(](转账|图片)[+\s：:]*([\d.]+|[^）)]+)[）)]/g;
    let last = 0, m;
    while ((m = specialRE.exec(text)) !== null) {
        if (m.index > last) {
            parts.push({ type: 'text', value: text.slice(last, m.index) });
        }
        if (m[1] === '转账') {
            parts.push({ type: 'transfer', value: parseFloat(m[2]) || 0 });
        } else {
            parts.push({ type: 'image', value: m[2].trim() });
        }
        last = m.index + m[0].length;
    }
    if (last < text.length) {
        parts.push({ type: 'text', value: text.slice(last) });
    }

    return parts.map(p => {
        if (p.type === 'transfer') {
            return `<div class="pm-card pm-transfer">💸 转账 ¥${p.value.toFixed(2)}</div>`;
        }
        if (p.type === 'image') {
            return `<div class="pm-card pm-image">🖼️ ${escapeHtml(p.value)}</div>`;
        }
        // 普通文本：保留换行，escape
        const safe = escapeHtml(p.value).replace(/\n/g, '<br>');
        return safe ? `<span class="pm-text">${safe}</span>` : '';
    }).join('');
}

// ── DOM 操作 ──────────────────────────────────────────

/** 找到手机楼层的 .mes_text 根节点 */
function getPhoneMesText() {
    if (phoneMesIndex === null) return null;
    // SillyTavern 渲染时给每条消息加 mesid 属性（等于 chat[] 下标）
    return document.querySelector(`.mes[mesid="${phoneMesIndex}"] .mes_text`);
}

function getPhoneMessagesDiv() {
    return getPhoneMesText()?.querySelector('.pm-messages') ?? null;
}

function scrollToBottom(container) {
    if (container) container.scrollTop = container.scrollHeight;
}

/** 向手机界面添加一个气泡 */
function appendBubble(text, side) {  // side: 'left' | 'right'
    const messagesDiv = getPhoneMessagesDiv();
    if (!messagesDiv) return;
    const bubble = document.createElement('div');
    bubble.className = `pm-bubble pm-${side}`;
    bubble.innerHTML = renderBubbleContent(text);
    messagesDiv.appendChild(bubble);
    scrollToBottom(messagesDiv);
}

/** 在手机界面插入系统提示行（结束、切换角色等） */
function appendSystemNote(text) {
    const messagesDiv = getPhoneMessagesDiv();
    if (!messagesDiv) return;
    const note = document.createElement('div');
    note.className = 'pm-system-note';
    note.textContent = text;
    messagesDiv.appendChild(note);
    scrollToBottom(messagesDiv);
}

// ── 手机 UI ───────────────────────────────────────────

function buildPhoneHTML(charName) {
    return `
<div class="pm-wrapper" data-pm-active="true">
  <div class="pm-header">
    <span class="pm-char-name">${escapeHtml(charName)}</span>
    <button class="pm-end-btn">结束通话</button>
  </div>
  <div class="pm-messages"></div>
  <div class="pm-input-row">
    <textarea class="pm-input" rows="2" placeholder="输入消息…用 / 分隔多条（Enter 发送，Shift+Enter 换行）"></textarea>
    <button class="pm-send-btn">发送</button>
  </div>
</div>`;
}

/** 在手机 UI 上绑定事件 */
function bindPhoneUIEvents(mesText) {
    const input = mesText.querySelector('.pm-input');
    const sendBtn = mesText.querySelector('.pm-send-btn');
    const endBtn = mesText.querySelector('.pm-end-btn');

    const doSend = () => {
        const raw = input.value.trim();
        if (!raw) return;
        input.value = '';

        // 右侧气泡（拆分展示）
        splitUserParts(raw).forEach(p => appendBubble(p, 'right'));

        // 发给 AI（使用 SillyTavern 官方方法，保留原始文本含 /）
        const ctx = getContext();
        ctx.chat;  // 确保已初始化
        // SillyTavern 发送消息的正确姿势：
        // sendTextareaMessage 是全局函数，但我们不能直接调用（会走 UI 流程）
        // 正确的 API 是：
        document.getElementById('send_textarea').value = raw;
        document.getElementById('send_but').click();
    };

    sendBtn.addEventListener('click', doSend);
    input.addEventListener('keydown', e => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            doSend();
        }
    });

    endBtn.addEventListener('click', () => endPhoneMode(true));
}

// ── 核心流程 ──────────────────────────────────────────

async function startPhoneMode() {
    if (phoneActive) {
        toastr.warning('手机模式已在运行中');
        return;
    }

    const ctx = getContext();
    const charName = getCurrentCharName();
    lastCharName = charName;

    // 1. 用官方 API 生成一条空的 system 消息，作为"手机楼层"
    //    SillyTavern 没有直接"插入自定义消息"的公开 API，
    //    但我们可以先发一条消息，立刻找到它的 DOM 再替换内容。
    //
    //    最可靠的方式：直接操作 chat 数组 + 重新渲染
    const systemMessage = {
        name: 'System',
        is_user: false,
        is_system: true,
        send_date: new Date().toISOString(),
        mes: '__phone_mode_placeholder__',
        extra: { isPhoneMode: true },
    };
    ctx.chat.push(systemMessage);
    phoneMesIndex = ctx.chat.length - 1;

    // 2. 触发 SillyTavern 重新渲染聊天（addOneMessage 是内部函数，通过全局暴露）
    //    SillyTavern 暴露的全局是 window.addOneMessage / window.reloadCurrentChat 等
    if (typeof window.addOneMessage === 'function') {
        await window.addOneMessage(systemMessage, { scroll: true });
    } else {
        // 降级：强制刷新整个聊天区（慢但可靠）
        if (typeof window.reloadCurrentChat === 'function') {
            await window.reloadCurrentChat();
        }
    }

    // 3. 等 DOM 渲染完成后替换内容
    await new Promise(r => setTimeout(r, 80));

    const mesText = getPhoneMesText();
    if (!mesText) {
        toastr.error('无法找到手机楼层的 DOM，请刷新重试');
        phoneActive = false;
        phoneMesIndex = null;
        return;
    }

    mesText.innerHTML = buildPhoneHTML(charName);
    bindPhoneUIEvents(mesText);

    phoneActive = true;
    toastr.success(`📱 手机模式已开启，正在与 ${charName} 通话`);
}

function endPhoneMode(showToast = true) {
    if (!phoneActive) return;
    appendSystemNote('── 通话已结束 ──');
    // 冻结输入区
    const mesText = getPhoneMesText();
    if (mesText) {
        const wrapper = mesText.querySelector('.pm-wrapper');
        if (wrapper) {
            wrapper.dataset.pmActive = 'false';
            mesText.querySelector('.pm-input')?.setAttribute('disabled', '');
            mesText.querySelector('.pm-send-btn')?.setAttribute('disabled', '');
            mesText.querySelector('.pm-end-btn')?.setAttribute('disabled', '');
        }
    }
    phoneActive = false;
    phoneMesIndex = null;
    if (showToast) toastr.info('手机模式已结束');
}

// ── 事件监听 ──────────────────────────────────────────

// AI 回复：拆成多个左侧气泡
eventSource.on(event_types.MESSAGE_RECEIVED, (mesIndex) => {
    if (!phoneActive) return;
    const ctx = getContext();
    const msg = ctx.chat[mesIndex];
    if (!msg || msg.is_user || msg.is_system) return;

    const sentences = splitAISentences(msg.mes || '');
    sentences.forEach(s => appendBubble(s, 'left'));
});

// 角色切换：自动结束
eventSource.on(event_types.CHAT_CHANGED, () => {
    if (phoneActive) {
        endPhoneMode(false);
        toastr.info('已切换角色，手机模式自动结束。重新输入 /phone 召唤');
    }
});

// ── 注册 /phone 命令 ───────────────────────────────────

SlashCommandParser.addCommandObject(SlashCommand.fromProps({
    name: 'phone',
    helpString: '召唤手机聊天界面（独占楼层模式）',
    callback: async () => {
        await startPhoneMode();
        return '';
    },
}));

// ── 样式注入 ──────────────────────────────────────────

(function injectStyles() {
    const id = 'phone-mode-styles';
    if (document.getElementById(id)) return;
    const style = document.createElement('style');
    style.id = id;
    style.textContent = `
.pm-wrapper { display:flex; flex-direction:column; width:100%; max-width:420px; margin:8px auto;
    background:#f0f2f5; border-radius:20px; overflow:hidden; font-family:system-ui,sans-serif;
    box-shadow:0 4px 16px rgba(0,0,0,.12); }
.pm-header { background:#fff; padding:12px 16px; display:flex; justify-content:space-between;
    align-items:center; border-bottom:1px solid #e5e5e5; }
.pm-char-name { font-size:15px; font-weight:600; color:#111; }
.pm-end-btn { background:#ff3b30; color:#fff; border:none; border-radius:14px;
    padding:4px 14px; font-size:12px; cursor:pointer; }
.pm-end-btn:disabled { background:#ccc; cursor:default; }
.pm-messages { height:380px; overflow-y:auto; padding:16px; display:flex;
    flex-direction:column; gap:10px; }
.pm-bubble { max-width:78%; padding:8px 12px; border-radius:18px; font-size:14px;
    line-height:1.45; word-break:break-word; }
.pm-right { align-self:flex-end; background:#007aff; color:#fff; border-bottom-right-radius:5px; }
.pm-left  { align-self:flex-start; background:#fff; color:#111; border-bottom-left-radius:5px; }
.pm-text  { white-space:pre-wrap; }
.pm-card  { display:inline-block; border-radius:10px; padding:5px 10px;
    font-size:13px; font-weight:500; margin:2px 0; }
.pm-transfer { background:#fff3e0; color:#e65100; }
.pm-image    { background:#e3f2fd; color:#0277bd; }
.pm-system-note { text-align:center; font-size:12px; color:#888; padding:4px; }
.pm-input-row { background:#fff; padding:10px 12px; display:flex; gap:8px;
    align-items:flex-end; border-top:1px solid #e5e5e5; }
.pm-input { flex:1; border:1px solid #ddd; border-radius:18px; padding:7px 12px;
    font-size:13px; resize:none; outline:none; font-family:inherit; }
.pm-input:disabled { background:#f5f5f5; }
.pm-send-btn { background:#007aff; color:#fff; border:none; border-radius:18px;
    padding:8px 16px; font-size:13px; cursor:pointer; font-weight:600; white-space:nowrap; }
.pm-send-btn:disabled { background:#ccc; cursor:default; }
    `;
    document.head.appendChild(style);
})();

console.log('[phone-mode] 扩展加载完成，输入 /phone 召唤');
