// 格林推演「较上次」快照的存取：天音自己的 localStorage，一个键里按聊天分开，只留最近几个聊天。
// 不进美化包与备份；清空全部数据时随 PLUGIN_LOCAL_STORAGE_KEYS 一并删除。
import { GREENLIN_SEEN_KEY } from './storage.js';

const MAX_CHATS = 24;
const readAll = () => {
    try {
        const parsed = JSON.parse(localStorage.getItem(GREENLIN_SEEN_KEY));
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch (error) { return {}; }
};

export function loadGreenlinSeen(chatId) {
    const entry = chatId ? readAll()[chatId] : null;
    const snap = entry?.snap;
    // 只认新版快照（v2）；缺字段的旧快照按首次打开处理。
    return snap && typeof snap === 'object' && snap.v === 2 && snap.ev && typeof snap.ev === 'object' && Array.isArray(snap.fc) && Array.isArray(snap.hs) ? snap : null;
}

export function saveGreenlinSeen(chatId, snap, now = Date.now()) {
    if (!chatId || !snap) return false;
    const all = readAll();
    all[chatId] = { t: now, snap };
    const keep = Object.entries(all).sort((a, b) => (Number(b[1]?.t) || 0) - (Number(a[1]?.t) || 0)).slice(0, MAX_CHATS);
    try { localStorage.setItem(GREENLIN_SEEN_KEY, JSON.stringify(Object.fromEntries(keep))); return true; }
    catch (error) { return false; }
}
