import { cleanResponse } from '../../shared/text/response.js';
import { formatQuoteContext } from '../../chat-message-model.js';

export function buildUserBlock(userName, userDesc) {
    return [`用户名字：${userName}`, userDesc ? `用户人设：${userDesc}` : ''].filter(Boolean).join('\n');
}

export function buildHistoryText(history, limit, userName, personaName, excludeLast = false) {
    const slice = excludeLast ? history.slice(-limit, -1) : history.slice(-limit);
    return slice.map(m => {
        const clean = cleanResponse(m.content);
        const director = m.directorNote ? `[剧情引导] ${m.directorNote}` : '';
        const quote = formatQuoteContext(m.quote);
        const quoteLine = quote ? `【${quote}】` : '';
        const userLine = clean ? `${userName}：${clean}` : '';
        if (m.role === 'user') return [quoteLine, userLine, director].filter(Boolean).join('\n');
        if (personaName) return [quoteLine, `${personaName}：${clean}`].filter(Boolean).join('\n');
        return [quoteLine, clean].filter(Boolean).join('\n');
    }).filter(Boolean).join('\n');
}

export function buildAntiFluff() {
    return '【务必直接按格式输出短信内容，严禁在开头输出“好的”、“下面是”等任何说明性废话，严禁输出非角色的语言。】';
}
