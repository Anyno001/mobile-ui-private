import { cleanResponse } from '../../shared/text/response.js';
import {
    currentStoryTime, formatCurrentStoryDateHeading, formatQuoteContext, formatStoryDateHeading, normalizeStoryDate, normalizeStoryTime,
} from '../../chat-message-model.js';

export function buildUserBlock(userName, userDesc) {
    return [`用户名字：${userName}`, userDesc ? `用户人设：${userDesc}` : ''].filter(Boolean).join('\n');
}

/**
 * currentStoryDate：本轮的剧情日期。与历史最后一个日期或钟点不同时在末尾补日期行，
 * 让 AI 知道这是隔天或隔了一段时间的新对话而非接着上一句。钟点缺省取日历当前剧情时间。
 */
export function buildHistoryText(history, limit, userName, personaName, excludeLast = false, currentStoryDate = '', currentTime) {
    const slice = excludeLast ? history.slice(-limit, -1) : history.slice(-limit);
    let previousDate = '', previousTime = '';
    const lines = slice.map(m => {
        const clean = cleanResponse(m.content);
        const director = m.directorNote ? `[剧情引导] ${m.directorNote}` : '';
        const quote = formatQuoteContext(m.quote);
        const quoteLine = quote ? `【${quote}】` : '';
        const userLine = clean ? `${userName}：${clean}` : '';
        const date = normalizeStoryDate(m.storyDate), time = date ? normalizeStoryTime(m.storyTime) : '';
        const dateLine = date && (date !== previousDate || (time && time !== previousTime)) ? formatStoryDateHeading(date, time) : '';
        if (date) { if (date !== previousDate) previousTime = ''; previousDate = date; if (time) previousTime = time; }
        let body;
        if (m.role === 'user') body = [quoteLine, userLine, director];
        else if (personaName) body = [quoteLine, `${personaName}：${clean}`];
        else body = [quoteLine, clean];
        return [dateLine, ...body].filter(Boolean).join('\n');
    }).filter(Boolean);
    const current = normalizeStoryDate(currentStoryDate);
    const time = current ? normalizeStoryTime(currentTime ?? currentStoryTime(current)) : '';
    if (current && (current !== previousDate || (time && time !== previousTime))) {
        lines.push(formatCurrentStoryDateHeading(current, previousDate, time));
    }
    return lines.join('\n');
}

export function buildAntiFluff() {
    return '【务必直接按格式输出短信内容，严禁在开头输出“好的”、“下面是”等任何说明性废话，严禁输出非角色的语言。】';
}
