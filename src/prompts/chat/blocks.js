import { cleanResponse } from '../../shared/text/response.js';
import {
    formatCurrentStoryDateHeading, formatQuoteContext, formatStoryDateHeading, normalizeStoryDate,
} from '../../chat-message-model.js';

export function buildUserBlock(userName, userDesc) {
    return [`用户名字：${userName}`, userDesc ? `用户人设：${userDesc}` : ''].filter(Boolean).join('\n');
}

/**
 * currentStoryDate：本轮的剧情日期。与历史最后一个日期不同时在末尾补日期行，
 * 让 AI 知道这是隔天的新对话而非接着上一句。
 */
export function buildHistoryText(history, limit, userName, personaName, excludeLast = false, currentStoryDate = '') {
    const slice = excludeLast ? history.slice(-limit, -1) : history.slice(-limit);
    let previousDate = '';
    const lines = slice.map(m => {
        const clean = cleanResponse(m.content);
        const director = m.directorNote ? `[剧情引导] ${m.directorNote}` : '';
        const quote = formatQuoteContext(m.quote);
        const quoteLine = quote ? `【${quote}】` : '';
        const userLine = clean ? `${userName}：${clean}` : '';
        const date = normalizeStoryDate(m.storyDate);
        const dateLine = date && date !== previousDate ? formatStoryDateHeading(date) : '';
        if (date) previousDate = date;
        let body;
        if (m.role === 'user') body = [quoteLine, userLine, director];
        else if (personaName) body = [quoteLine, `${personaName}：${clean}`];
        else body = [quoteLine, clean];
        return [dateLine, ...body].filter(Boolean).join('\n');
    }).filter(Boolean);
    const current = normalizeStoryDate(currentStoryDate);
    if (current && current !== previousDate) lines.push(formatCurrentStoryDateHeading(current, previousDate));
    return lines.join('\n');
}

export function buildAntiFluff() {
    return '【务必直接按格式输出短信内容，严禁在开头输出“好的”、“下面是”等任何说明性废话，严禁输出非角色的语言。】';
}
