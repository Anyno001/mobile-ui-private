import { cleanResponse, splitToSentences } from './prompts.js';
import { VOICE_MAX_SEC } from './constants.js';
import { GROUP_COLORS } from './groups.js';
import { escapeHtml } from './ui.js';

const SPECIAL_KEYWORDS = {
    '转账':'转账','transfer':'转账','Transfer':'转账','TRANSFER':'转账','轉賬':'转账','轉帳':'转账',
    '收款':'收款','receive':'收款','Receive':'收款','RECEIVE':'收款','收钱':'收款','收到':'收款','收錢':'收款',
    '退还':'退还','退钱':'退还','退款':'退还','refund':'退还','Refund':'退还','REFUND':'退还','退還':'退还','退錢':'退还',
    '图片':'图片','image':'图片','Image':'图片','IMAGE':'图片','img':'图片','pic':'图片','photo':'图片','圖片':'图片',
    '语音':'语音','voice':'语音','Voice':'语音','VOICE':'语音','audio':'语音','語音':'语音',
};
const KEYWORD_PATTERN = Object.keys(SPECIAL_KEYWORDS).join('|');

export const SPECIAL_RE = new RegExp(`[\\(（]\\s*(${KEYWORD_PATTERN})\\s*[+：:\\s]*([^)）]+)[\\)）]`, 'gi');
export const EMO_RE = /\[emo:([^\]:]+):(\d+)\]/gi;

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


export function parseGroupResponse(raw, groupMembers) {
    const cleaned = cleanResponse(raw);
    const lines = cleaned.split('\n').map(line => line.trim()).filter(Boolean);
    const result = [];
    const normalizeName = value => (value || '')
        .trim()
        .replace(/^[【\[\(（*「『"'\s]+|[】\]\)）*「』」"'\s]+$/g, '')
        .trim()
        .toLowerCase();
    const memberMap = new Map();
    groupMembers.forEach(name => memberMap.set(normalizeName(name), name));
    const speakerPattern = /^[\s\*【\[「『"'（\(]*(.{1,20}?)[\s\*】\]」』"'）\)]*\s*[：:]\s*([\s\S]+)$/;

    const stripSpeakerPrefix = value => {
        let text = (value || '').trim();
        const outer = text.match(/^[\(（]\s*(.{1,20}?)\s*[：:]\s*([\s\S]+?)\s*[\)）]\s*$/);
        if (outer && memberMap.has(normalizeName(outer[1]))) {
            return outer[2].trim();
        }
        for (let index = 0; index < 3; index++) {
            const match = text.match(speakerPattern);
            if (!match || !memberMap.has(normalizeName(match[1]))) break;
            text = match[2].trim();
        }
        return text;
    };

    for (const line of lines) {
        const match = line.match(speakerPattern);
        if (match && memberMap.has(normalizeName(match[1]))) {
            const name = memberMap.get(normalizeName(match[1]));
            const sentences = splitToSentences(match[2], stripSpeakerPrefix);
            if (sentences.length) result.push({ name, sentences });
            continue;
        }
        const sentences = splitToSentences(line, stripSpeakerPrefix);
        if (!sentences.length) continue;
        if (result.length > 0) result[result.length - 1].sentences.push(...sentences);
        else result.push({ name: groupMembers[0] || '???', sentences });
    }
    return result;
}

export function resolveGroupColor(name, groupColorMap, groupMembers) {
    if (!name) return null;
    if (groupColorMap[name]) return groupColorMap[name];
    const normalizedName = name.toLowerCase();
    for (const [memberName, color] of Object.entries(groupColorMap)) {
        if (memberName.toLowerCase() === normalizedName) return color;
    }
    const index = groupMembers.findIndex(memberName => memberName.toLowerCase() === normalizedName);
    return index >= 0 ? GROUP_COLORS[index % GROUP_COLORS.length] : null;
}

export function createBubbles(text, side, senderName, { groupColorMap, groupMembers, emojis }) {
    const results = [];
    const specialPattern = new RegExp(SPECIAL_RE.source, 'gi');
    let lastIndex = 0;
    let match;
    const groupColor = senderName && side === 'left'
        ? resolveGroupColor(senderName, groupColorMap, groupMembers)
        : null;

    const pushPlain = value => {
        const plain = value.trim();
        if (!plain) return;
        if (senderName && side === 'left') {
            const wrapper = document.createElement('div');
            wrapper.className = 'pm-group-bubble-wrap';
            const nameTag = document.createElement('div');
            nameTag.className = 'pm-group-name';
            nameTag.textContent = senderName;
            if (groupColor) nameTag.style.color = groupColor.bg;
            wrapper.appendChild(nameTag);
            const inner = document.createElement('div');
            inner.className = `pm-bubble pm-${side}`;
            if (groupColor) {
                inner.style.setProperty('background', groupColor.bg, 'important');
                inner.style.setProperty('color', groupColor.text, 'important');
            }
            inner.innerHTML = escapeHtml(plain).replace(/\n/g, '<br>');
            wrapper.appendChild(inner);
            results.push(wrapper);
            return;
        }
        const bubble = document.createElement('div');
        bubble.className = `pm-bubble pm-${side}`;
        bubble.innerHTML = escapeHtml(plain).replace(/\n/g, '<br>');
        results.push(bubble);
    };

    while ((match = specialPattern.exec(text)) !== null) {
        if (match.index > lastIndex) pushPlain(text.slice(lastIndex, match.index));
        const kind = normalizeKeyword(match[1]);
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
            const amount = parseFloat(match[2]) || 0;
            const className = kind === '转账' ? 'pm-transfer-card' : kind === '收款' ? 'pm-receive-card' : 'pm-refund-card';
            const title = kind === '退还' ? '已退还' : kind;
            bubble.innerHTML = `<div class="${className}"><div class="pm-t-icon">¥</div><div class="pm-t-info"><b>${title}</b><span>¥${amount.toFixed(2)}</span></div></div>`;
        } else if (kind === '图片') {
            bubble.innerHTML = `<div class="pm-img-card">🖼️ ${escapeHtml(match[2].trim())}</div>`;
        } else {
            const voiceText = match[2].trim();
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
            bubble.innerHTML = `<div class="pm-voice-wrap"><div class="${voiceClass}" style="${voiceStyle}" onclick="window.__pmToggleVoice(this)"><span class="pm-voice-icon">🎤</span><span class="pm-voice-wave"><i></i><i></i><i></i></span><span class="pm-voice-dur">${duration}"</span></div><div class="pm-voice-text" style="display:none;">${escapeHtml(voiceText)}</div></div>`;
        }
        if (container) { container.appendChild(bubble); results.push(container); }
        else results.push(bubble);
        lastIndex = match.index + match[0].length;
    }
    if (lastIndex < text.length) pushPlain(text.slice(lastIndex));
    if (!results.length) pushPlain(text);

    for (const bubble of results) {
        const elements = bubble.classList?.contains('pm-group-bubble-wrap')
            ? bubble.querySelectorAll('.pm-bubble')
            : (bubble.classList?.contains('pm-bubble') ? [bubble] : []);
        for (const element of elements) {
            if (!element.innerHTML.includes('[emo:')) continue;
            element.innerHTML = element.innerHTML.replace(/\[emo:([^\]:]+):(\d+)\]/g, (raw, setName, index) => {
                const url = findEmojiUrl(setName, parseInt(index, 10), emojis);
                return url
                    ? `<img src="${url.replace(/"/g, '&quot;')}" style="max-width:98px;border-radius:8px;display:block;box-shadow:0 2px 8px rgba(0,0,0,0.15);vertical-align:middle;">`
                    : `<span style="font-size:12px;color:#999;">🤔[${setName}:${index}]</span>`;
            });
            const imageOnly = element.querySelector('img') && element.childNodes.length === 1;
            element.style.background = imageOnly ? 'transparent' : '';
            element.style.boxShadow = imageOnly ? 'none' : '';
            element.style.padding = imageOnly ? '0' : '';
        }
    }
    return results;
}
