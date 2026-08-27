import { VOICE_MAX_SEC } from './constants.js';
import { GROUP_COLORS } from './groups.js';
import { isRenderableEmojiSource } from './emoji-media.js';
import { contrastText, escapeAttr, escapeHtml, renderBoldText } from './ui.js';

const SPECIAL_KEYWORDS = {
    '转账':'转账','transfer':'转账','Transfer':'转账','TRANSFER':'转账','轉賬':'转账','轉帳':'转账',
    '收款':'收款','receive':'收款','Receive':'收款','RECEIVE':'收款','收钱':'收款','收到':'收款','收錢':'收款',
    '退还':'退还','退钱':'退还','退款':'退还','refund':'退还','Refund':'退还','REFUND':'退还','退還':'退还','退錢':'退还',
    '图片':'图片','image':'图片','Image':'图片','IMAGE':'图片','img':'图片','pic':'图片','photo':'图片','圖片':'图片',
    '语音':'语音','voice':'语音','Voice':'语音','VOICE':'语音','audio':'语音','語音':'语音',
};
const KEYWORD_PATTERN = Object.keys(SPECIAL_KEYWORDS).join('|');

export const SPECIAL_RE = new RegExp(`[\\(（][ \\t]*(${KEYWORD_PATTERN})(?:[ \\t]*(?:\\+|：|:)[ \\t]*|[ \\t]+)([^)）]+)[\\)）]`, 'gi');
export const STANDALONE_SPECIAL_RE = new RegExp(`^[ \\t]*(${KEYWORD_PATTERN})(?:[ \\t]*(?:\\+|：|:)[ \\t]*|[ \\t]+)(\\S(?:[^\\r\\n]*\\S)?)[ \\t]*$`, 'i');
export const EMO_RE = /\[emo:([^\]:]+):(\d+)\]/gi;

function isValidSpecialContent(kind, content) {
    const value = content.trim();
    if (!value || /^[+：:]+$/.test(value)) return false;
    return !['转账', '收款', '退还'].includes(kind) || /^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(value);
}

export function normalizeKeyword(keyword) {
    return SPECIAL_KEYWORDS[keyword] || SPECIAL_KEYWORDS[keyword.toLowerCase()] || keyword;
}

export function findEmojiUrl(setName, index, emojis) {
    const set = emojis.find(item => item.name === setName);
    const image = set?.images[index - 1];
    return image?.url || null;
}

export function resolveEmojiText(text, emojis) {
    return (text || '').replace(/\[emo:([^\]:]+):(\d+)\]/g, (match, setName, index) => {
        const set = emojis.find(item => item.name === setName);
        const image = set?.images[parseInt(index, 10) - 1];
        return image ? `(表情:${image.desc})` : '';
    });
}

export function getWordyPrompt(enabled) {
    if (!enabled) return '';
    return '\n\n[字数限制] 除非角色人设明确为话痨或碎嘴性格，否则每条独立消息（每个 / 分隔的片段）不得超过35个字符，超出请拆分为多条。';
}

export function getEmojiPrompt(contactKey, storageId, pokeConfig, emojis) {
    const assignedIds = pokeConfig[storageId]?.[contactKey]?.emojis || [];
    if (!assignedIds.length) return '';
    const sets = emojis.filter(set => assignedIds.includes(set.id));
    if (!sets.length) return '';
    const lines = sets.map(set => set.images.map((image, index) => `[emo:${set.name}:${index + 1}] - ${image.desc}`).join('\n')).join('\n');
    return `\n\n[表情包权限]\n你可以在合适时机使用以下表情包，使用格式 [emo:套组名:序号] 独行发送：\n${lines}\n请在自然语境下适当使用，严禁自生新格式。`;
}

export function resolveGroupColor(name, groupColorMap, groupMembers) {
    if (!name) return null;
    const normalizeColor = color => typeof color === 'string'
        ? { bg: color, text: contrastText(color) }
        : color;
    if (groupColorMap[name]) return normalizeColor(groupColorMap[name]);
    const normalizedName = name.toLowerCase();
    for (const [memberName, color] of Object.entries(groupColorMap)) {
        if (memberName.toLowerCase() === normalizedName) return normalizeColor(color);
    }
    const index = groupMembers.findIndex(memberName => memberName.toLowerCase() === normalizedName);
    return index >= 0 ? GROUP_COLORS[index % GROUP_COLORS.length] : null;
}

export function createBubbles(text, side, senderName, { groupColorMap, groupMembers, emojis, emojiBudget }) {
    const results = [];
    const specialPattern = new RegExp(SPECIAL_RE.source, 'gi');
    let lastIndex = 0;
    let match;
    const groupColor = senderName && side === 'left'
        ? resolveGroupColor(senderName, groupColorMap, groupMembers)
        : null;

    const pushPlain = value => {
        const lines = value.split('\n').map(l => l.trim()).filter(Boolean);
        if (!lines.length) return;
        const renderLineHtml = source => {
            let display = source.trim();
            if (side === 'left') {
                const stripped = display.replace(/[。．.]$/, '');
                if (stripped) display = stripped;
            }
            return renderBoldText(display);
        };
        if (senderName && side === 'left') {
            lines.forEach((line, index) => {
                const wrapper = document.createElement('div');
                wrapper.className = 'pm-group-bubble-wrap';
                if (index === 0) {
                    const nameTag = document.createElement('div');
                    nameTag.className = 'pm-group-name';
                    nameTag.textContent = senderName;
                    if (groupColor) nameTag.style.color = groupColor.bg;
                    wrapper.appendChild(nameTag);
                }
                const inner = document.createElement('div');
                inner.className = `pm-bubble pm-${side}`;
                if (groupColor) {
                    inner.style.setProperty('background', groupColor.bg, 'important');
                    inner.style.setProperty('color', groupColor.text, 'important');
                }
                inner.innerHTML = renderLineHtml(line);
                wrapper.appendChild(inner);
                results.push(wrapper);
            });
            return;
        }
        lines.forEach(line => {
            const bubble = document.createElement('div');
            bubble.className = `pm-bubble pm-${side}`;
            bubble.innerHTML = renderLineHtml(line);
            results.push(bubble);
        });
    };

    const pushSpecial = (kind, content) => {
        const isGroupLeft = senderName && side === 'left';
        let container;
        if (isGroupLeft) {
            container = document.createElement('div');
            container.className = 'pm-group-bubble-wrap';
            const nameTag = document.createElement('div');
            nameTag.className = 'pm-group-name';
            nameTag.textContent = senderName;
            if (groupColor) nameTag.style.color = groupColor.bg;
            container.appendChild(nameTag);
        }
        const bubble = document.createElement('div');
        bubble.className = `pm-bubble pm-${side} pm-special`;
        if (kind === '转账' || kind === '收款' || kind === '退还') {
            const amount = parseFloat(content) || 0;
            const className = kind === '转账' ? 'pm-transfer-card' : kind === '收款' ? 'pm-receive-card' : 'pm-refund-card';
            const title = kind === '退还' ? '已退还' : kind;
            bubble.innerHTML = `<div class="${className}"><div class="pm-t-icon">¥</div><div class="pm-t-info"><b>${title}</b><span>¥${amount.toFixed(2)}</span></div></div>`;
        } else if (kind === '图片') {
            bubble.innerHTML = `<div class="pm-img-card">🖼️ ${escapeHtml(content.trim())}</div>`;
        } else {
            const voiceText = content.trim();
            const length = [...voiceText].length;
            const duration = length <= 5 ? Math.max(1, length)
                : length <= 15 ? 5 + (length - 5)
                : length <= 40 ? 15 + Math.ceil((length - 15) * 0.8)
                : Math.min(VOICE_MAX_SEC, 35 + Math.ceil((length - 40) * 0.5));
            const width = Math.min(240, Math.max(110, 90 + Math.min(length, 30) * 4));
            let voiceStyle = `width:${width}px`;
            let voiceClass = `pm-voice-card pm-voice-${side}`;
            if (isGroupLeft && groupColor) {
                voiceStyle = `width:${width}px;background:${groupColor.bg} !important;color:${groupColor.text} !important;`;
                voiceClass = 'pm-voice-card pm-voice-left pm-voice-group';
            }
            bubble.innerHTML = `<div class="pm-voice-wrap"><div class="${voiceClass}" style="${voiceStyle}" onclick="window.__pmToggleVoice(this)"><span class="pm-voice-icon">🎤</span><span class="pm-voice-wave"><i></i><i></i><i></i></span><span class="pm-voice-dur">${duration}"</span></div><div class="pm-voice-text" hidden>${escapeHtml(voiceText)}</div></div>`;
        }
        if (container) { container.appendChild(bubble); results.push(container); }
        else results.push(bubble);
    };

    const standaloneSpecial = text.match(STANDALONE_SPECIAL_RE);
    if (standaloneSpecial) {
        const kind = normalizeKeyword(standaloneSpecial[1]);
        const content = standaloneSpecial[2];
        if (isValidSpecialContent(kind, content)) {
            pushSpecial(kind, content);
        } else {
            pushPlain(text);
        }
    } else {
        while ((match = specialPattern.exec(text)) !== null) {
            if (match.index > lastIndex) pushPlain(text.slice(lastIndex, match.index));
            const kind = normalizeKeyword(match[1]);
            if (isValidSpecialContent(kind, match[2])) {
                pushSpecial(kind, match[2]);
            } else {
                pushPlain(match[0]);
            }
            lastIndex = match.index + match[0].length;
        }
        if (lastIndex < text.length) pushPlain(text.slice(lastIndex));
    }
    if (!results.length) pushPlain(text);

    for (const bubble of results) {
        const elements = bubble.classList?.contains('pm-group-bubble-wrap')
            ? bubble.querySelectorAll('.pm-bubble')
            : (bubble.classList?.contains('pm-bubble') ? [bubble] : []);
        for (const element of elements) {
            if (!element.innerHTML.includes('[emo:')) continue;
            element.innerHTML = element.innerHTML.replace(/\[emo:([^\]:]+):(\d+)\]/g, (raw, setName, index) => {
                const url = findEmojiUrl(setName, parseInt(index, 10), emojis);
                if (!url) return '<span class="pm-emoji-placeholder">🤔[' + escapeHtml(setName) + ':' + index + ']</span>';
                if (!isRenderableEmojiSource(url)) {
                    return '<span class="pm-emoji-placeholder">表情图片暂不加载</span>';
                }
                if (typeof emojiBudget === 'function' && !emojiBudget(url)) {
                    return '<span class="pm-emoji-placeholder">表情图片暂不加载</span>';
                }
                return `<img src="${escapeAttr(url)}" loading="lazy" decoding="async" width="98" height="98" class="pm-emoji-image">`;
            });
            const imageOnly = element.querySelector('img') && element.childNodes.length === 1;
            element.classList.toggle('is-image-only', imageOnly);
        }
    }
    return results;
}
