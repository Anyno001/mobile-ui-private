// 金手指（Origin 系统 原作 vicliaaa，经授权移植）的全局设置：存 localStorage，规范化只读入参、返回新对象。
// 字段与核心 origin-state.js 的 SETTING_DEFAULTS + mods 一致；原插件的独立 API、日夜、主色、悬浮球不做。
export const ORIGIN_SETTINGS_KEY = 'ST_SMS_ORIGIN';
export const ORIGIN_CREDIT = 'Origin 系统 原作 vicliaaa，经授权移植';
export const ORIGIN_REPO_URL = 'https://github.com/vicliaaa/origin-sillytavern';
export const ORIGIN_DEFAULT_NAME = '随身系统';
export const ORIGIN_PERSONALITIES = Object.freeze(['冷澈', '毒舌', '傲娇', '温和']);
export const ORIGIN_MODS = Object.freeze(['stat', 'bag', 'shop', 'gacha', 'ach', 'chat']);
export const ORIGIN_MOD_LABELS = Object.freeze({ stat: '属性', bag: '背包', shop: '商城', gacha: '抽奖', ach: '成就', chat: '对话' });

export const ORIGIN_SETTINGS_DEFAULTS = Object.freeze({
    enabled: false, sysName: ORIGIN_DEFAULT_NAME, personality: '冷澈', personaText: '', bindTo: '宿主',
    freq: 3, blockWhenUnfinished: true, taskSource: 'auto', limitMin: 0, limitMax: 0,
    punishEvent: true, achieveOn: true, shopRefresh: 0, gachaRefresh: 0, rewardPref: '', penaltyPref: '',
    fourthWall: 0, drawCost: 300, autoEcon: false, chatToStory: true, rpChat: 'auto', budget: 1400, judgeMode: 'A',
    mods: Object.freeze({ stat: true, bag: true, shop: true, gacha: true, ach: true, chat: true }),
});

const TASK_SOURCES = new Set(['auto', 'direction', 'manual']);
const RP_CHAT = new Set(['auto', 'manual']);
const bool = (value, fallback) => (typeof value === 'boolean' ? value : fallback);
function int(value, min, max, fallback) {
    const n = Number.parseInt(value, 10);
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}
const text = (value, fallback, max = 400) => (typeof value === 'string' ? value.slice(0, max) : fallback);

export function normalizeOriginSettings(raw) {
    const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    const d = ORIGIN_SETTINGS_DEFAULTS;
    const mods = src.mods && typeof src.mods === 'object' ? src.mods : {};
    const limitMin = int(src.limitMin, 0, 99, d.limitMin);
    const limitMax = int(src.limitMax, 0, 99, d.limitMax);
    return {
        enabled: bool(src.enabled, d.enabled),
        sysName: text(src.sysName, d.sysName, 24).trim() || d.sysName,
        personality: ORIGIN_PERSONALITIES.includes(src.personality) ? src.personality : d.personality,
        personaText: text(src.personaText, d.personaText, 1200),
        bindTo: text(src.bindTo, d.bindTo, 24).trim() || d.bindTo,
        freq: int(src.freq, 1, 10, d.freq),
        blockWhenUnfinished: bool(src.blockWhenUnfinished, d.blockWhenUnfinished),
        taskSource: TASK_SOURCES.has(src.taskSource) ? src.taskSource : d.taskSource,
        limitMin,
        limitMax: limitMax > 0 ? Math.max(limitMin, limitMax) : 0,
        punishEvent: bool(src.punishEvent, d.punishEvent),
        achieveOn: bool(src.achieveOn, d.achieveOn),
        shopRefresh: int(src.shopRefresh, 0, 99, d.shopRefresh),
        gachaRefresh: int(src.gachaRefresh, 0, 99, d.gachaRefresh),
        rewardPref: text(src.rewardPref, d.rewardPref),
        penaltyPref: text(src.penaltyPref, d.penaltyPref),
        fourthWall: int(src.fourthWall, 0, 100, d.fourthWall),
        drawCost: int(src.drawCost, 0, 99999, d.drawCost),
        autoEcon: bool(src.autoEcon, d.autoEcon),
        chatToStory: bool(src.chatToStory, d.chatToStory),
        rpChat: RP_CHAT.has(src.rpChat) ? src.rpChat : d.rpChat,
        budget: int(src.budget, 400, 6000, d.budget),
        judgeMode: d.judgeMode,
        mods: Object.fromEntries(ORIGIN_MODS.map(id => [id, bool(mods[id], d.mods[id])])),
    };
}

// 反串：系统绑定到某个角色而不是宿主。
export function originBoundRole(settings) {
    const bind = String(settings?.bindTo || '').trim();
    return bind && bind !== '宿主' ? bind : '';
}

// 读一次、按原文缓存：核心每次取设置都会调，避免反复 JSON.parse。返回的对象冻结，调用方不得原地改。
let cachedRaw = null;
let cachedValue = null;
export function loadOriginSettings(storage = globalThis.localStorage) {
    let raw = null;
    try { raw = storage?.getItem?.(ORIGIN_SETTINGS_KEY) ?? null; } catch (error) { raw = null; }
    if (cachedValue && raw === cachedRaw) return cachedValue;
    let parsed = null;
    try { parsed = raw ? JSON.parse(raw) : null; } catch (error) { parsed = null; }
    const value = normalizeOriginSettings(parsed);
    Object.freeze(value.mods);
    cachedRaw = raw;
    cachedValue = Object.freeze(value);
    return cachedValue;
}

// 合并补丁后规范化写入；失败返回 null，内存缓存不变。
export function saveOriginSettings(patch, storage = globalThis.localStorage) {
    const current = loadOriginSettings(storage);
    const next = normalizeOriginSettings({ ...current, ...patch, mods: { ...current.mods, ...(patch?.mods || {}) } });
    try { storage.setItem(ORIGIN_SETTINGS_KEY, JSON.stringify(next)); } catch (error) { return null; }
    return loadOriginSettings(storage);
}
