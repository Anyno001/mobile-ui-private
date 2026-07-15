import {
    BIDIRECTIONAL_KEY, BIDIRECTIONAL_LIMIT, DEFAULT_GROUP_INJECTION, MAX_INJECTION_CHARS,
} from './constants.js';
import { resolveEmojiText } from './messaging.js';

function injectionKey(name) {
    return `${BIDIRECTIONAL_KEY}:${encodeURIComponent(name)}`;
}

function renderConversation(name, history, meta, userName, emojis) {
    const lines = history.map(message => {
        const text = resolveEmojiText((message.content || '').replace(/\s*\/\s*/g, '。').replace(/\n/g, '；'), emojis);
        const director = message.directorNote ? `【剧情引导：${message.directorNote}】` : '';
        if (message.role === 'user') return [text ? `${userName}：${text}` : '', director].filter(Boolean).join(' ');
        return meta ? text : `${name}：${text}`;
    }).filter(Boolean).join('\n');
    if (!lines) return '';
    return meta
        ? `【群聊"${meta.name}"（成员：${meta.members.join('、')}）的最近聊天 — 仅参与者与 ${userName} 知晓，其他角色不应知情】\n${lines}`
        : `【与 ${name} 的短信 — 仅 ${name} 与 ${userName} 知晓】\n${lines}`;
}

export function applyConversationInjections({ context, runtime, checked, histories, groups, userName, emojis }) {
    if (!context || typeof context.setExtensionPrompt !== 'function') return;
    const previousKeys = runtime.injectionKeys || new Set();
    const nextKeys = new Set();
    let remaining = MAX_INJECTION_CHARS;

    try { context.setExtensionPrompt(BIDIRECTIONAL_KEY, '', 0, 0, false, 0); } catch (error) {}

    for (const name of checked) {
        const meta = name.startsWith('__group_') ? groups[name] : null;
        const injection = meta?.injection || DEFAULT_GROUP_INJECTION;
        if (injection.position < 0 || remaining <= 0) continue;
        const historyLimit = meta ? injection.historyLimit : BIDIRECTIONAL_LIMIT;
        const history = (histories[name] || []).slice(-historyLimit);
        let content = renderConversation(name, history, meta, userName, emojis);
        if (!content) continue;
        if (content.length > remaining) {
            const marker = '【较早内容因资源预算已省略】\n';
            content = marker + content.slice(-(Math.max(0, remaining - marker.length)));
        }
        if (!content || content.length > remaining) continue;
        const key = injectionKey(name);
        try {
            context.setExtensionPrompt(key, `[手机短信记忆 — 私密]\n${content}\n[结束]`, injection.position, injection.depth, false, 0);
            nextKeys.add(key);
            remaining -= content.length;
        } catch (error) {}
    }

    for (const key of previousKeys) {
        if (nextKeys.has(key)) continue;
        try { context.setExtensionPrompt(key, '', 0, 0, false, 0); } catch (error) {}
    }
    runtime.injectionKeys = nextKeys;
}
