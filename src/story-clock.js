import { extractCalendarBaseDate, extractCalendarStoryTime } from './calendar-model.js';

const LOOKBACK = 30;

// 消息发送时主线的剧情时间：从发送时的楼层往前找最近一条带日期或钟点标签的角色正文。
// 旧消息没存 storyTime、或日历还没识别过时，聊天时间条靠它补上；按正文对象缓存，正文改写后自动失效。
export function createStoryClockLookup({ getChat, getDateTags, getHint }) {
    const cache = new WeakMap();
    const clockOf = message => {
        const text = String(message?.mes || '');
        const cached = cache.get(message);
        if (cached?.text === text) return cached.clock;
        const tags = getDateTags();
        const clock = { date: extractCalendarBaseDate(text, tags, getHint()) || '', time: extractCalendarStoryTime(text, tags) };
        cache.set(message, { text, clock });
        return clock;
    };
    return floor => {
        const chat = getChat();
        if (!Array.isArray(chat) || !Number.isSafeInteger(floor) || floor <= 0) return null;
        for (let index = Math.min(floor, chat.length) - 1, seen = 0; index >= 0 && seen < LOOKBACK; index -= 1, seen += 1) {
            const message = chat[index];
            if (!message || message.is_user || message.is_system) continue;
            const clock = clockOf(message);
            if (clock.date || clock.time) return clock;
        }
        return null;
    };
}
