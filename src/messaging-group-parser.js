import { cleanResponse, splitToSentences } from './prompts.js';
import { parseGalBubbleMessages } from './gal-bubble.js';

export function parseGroupResponse(raw, groupMembers, { allowUnknownSpeakers = false, galBubbleEnabled = false } = {}) {
    const galMessages = galBubbleEnabled ? parseGalBubbleMessages(raw) : null;
    const result = [];
    const normalizeName = value => (value || '')
        .trim()
        .replace(/^[【\[\(（*「『"'\s]+|[】\]\)）*「』」"'\s]+$/g, '')
        .trim()
        .toLowerCase();
    const memberMap = new Map();
    groupMembers.forEach(name => memberMap.set(normalizeName(name), name));
    const speakerPattern = /^[\s\*【\[「『"'（\(]*(.{1,20}?)[\s\*】\]」』"'）\)]*\s*[：:]\s*([\s\S]+)$/;
    const randomNpcPrefix = '路人群友·';
    const reservedNpcNames = new Set([
        '系统', '用户', '旁白', '提示', '时间', '备注', '网址', '比例',
        '图片', '语音', '转账', '收款', '退还',
    ]);
    const resolveSpeaker = value => {
        const normalized = normalizeName(value);
        if (memberMap.has(normalized)) return memberMap.get(normalized);
        if (!allowUnknownSpeakers || !normalized) return '';
        const candidate = String(value || '').trim()
            .replace(/^[【\[\(（*「『"'\s]+|[】\]\)）*「』」"'\s]+$/g, '').trim();
        if (!candidate.startsWith(randomNpcPrefix)) return '';
        const name = candidate.slice(randomNpcPrefix.length).trim();
        if (!name || name.length > 12 || reservedNpcNames.has(name)) return '';
        if (/[：:\/\\\[\]【】()（）<>]/.test(name) || /^\d+(?:\.\d+)?%?$/.test(name)) return '';
        return `${randomNpcPrefix}${name}`;
    };
    const stripSpeakerPrefix = value => {
        let text = (value || '').trim();
        const outer = text.match(/^[\(（]\s*(.{1,20}?)\s*[：:]\s*([\s\S]+?)\s*[\)）]\s*$/);
        if (outer && resolveSpeaker(outer[1])) return outer[2].trim();
        for (let index = 0; index < 3; index++) {
            const match = text.match(speakerPattern);
            if (!match || !resolveSpeaker(match[1])) break;
            text = match[2].trim();
        }
        return text;
    };
    const splitGroupSentences = value => splitToSentences(
        String(value || '').replace(/https?:\/\/\S+/gi, url => url.replace(/\//g, '\u0002')),
        stripSpeakerPrefix,
    ).map(text => text.replace(/\u0002/g, '/'));

    if (galMessages) {
        for (const message of galMessages) {
            if (message.side !== 'left') continue;
            const speaker = resolveSpeaker(message.name);
            if (!speaker) continue;
            const sentences = splitGroupSentences(message.text);
            if (sentences.length) result.push({ name: speaker, sentences });
        }
        return result;
    }

    const lines = cleanResponse(raw).split('\n').map(line => line.trim()).filter(Boolean);
    for (const line of lines) {
        const match = line.match(speakerPattern);
        const speaker = match ? resolveSpeaker(match[1]) : '';
        if (match && speaker) {
            const sentences = splitGroupSentences(match[2]);
            if (sentences.length) result.push({ name: speaker, sentences });
            continue;
        }
        const sentences = splitGroupSentences(line);
        if (!sentences.length) continue;
        if (result.length > 0) result[result.length - 1].sentences.push(...sentences);
        else result.push({ name: groupMembers[0] || '???', sentences });
    }
    return result;
}
