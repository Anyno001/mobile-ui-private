// Origin 系统核心 · 常量、默认值与状态工具。
// 来源：vicliaaa/origin-sillytavern v1.5（作者已授权移植）；IGS 与天音共用，两份逐字相同。不碰 DOM、不碰酒馆全局。
export const ORIGIN_CORE_VER = 'v1.5-core.1';
export const ORIGIN_META_KEY = 'origin_v2';
export const ORIGIN_LEGACY_KEY = 'origin';
export const ORIGIN_SAVE_VERSION = 1;

export const DEFAULT_GACHA = [
    { name: '普通物资', tier: 'N', weight: 50, desc: '一点日常用度', effect: '积分+50' },
    { name: '灵石一袋', tier: 'R', weight: 28, desc: '', effect: '积分+200' },
    { name: '属性丹', tier: 'SR', weight: 15, desc: '魅力+5', effect: '魅力+5' },
    { name: '心意符', tier: 'SSR', weight: 6, desc: '指定对象好感+30', effect: '好感+30' },
    { name: '逆天改命券', tier: 'UR', weight: 1, desc: '一次改写命运的机会', effect: '' },
];
export const DEFAULT_SHOP = [
    { name: '凝神丹', price: 200, desc: '服下立刻恢复精神、驱散疲惫', effect: '' },
    { name: '易容面具', price: 400, desc: '短时间改变容貌，不被认出', effect: '' },
    { name: '魅力之种', price: 800, desc: '使用后 魅力+10（永久）', effect: '魅力+10' },
    { name: '心意催化', price: 600, desc: '【干涉】指定对象对你好感+20', effect: '好感+20' },
    { name: '回溯券', price: 1200, desc: '【特权】回溯本回合，重来一次', effect: '' },
    { name: '问天签', price: 300, desc: '随机抽取一次（抽奖·第3期开放）', effect: '' },
];
export const PERSONA = {
    '冷澈': '冷静、克制、公事公办，偶尔一针见血。',
    '毒舌': '爱吐槽、损，但损得有分寸，刀子嘴。',
    '傲娇': '嘴上嫌弃、其实上心，会别扭地关心宿主。',
    '温和': '温和耐心，像个可靠的向导。',
};
// 与原插件同名同义；界面类字段（主色、日夜、悬浮球位置）不在核心里。总开关默认关。
export const SETTING_DEFAULTS = {
    enabled: false, judgeMode: 'A', freq: 3, blockWhenUnfinished: true, taskSource: 'auto', fourthWall: 0,
    sysName: 'Origin', personality: '冷澈', personaText: '', rewardPref: '', penaltyPref: '', bindTo: '宿主',
    autoEcon: false, budget: 1400, drawCost: 300, limitMin: 0, limitMax: 0, punishEvent: true, achieveOn: true,
    shopRefresh: 0, gachaRefresh: 0, chatToStory: true, rpChat: 'auto',
};
export const MOD_KEYS = ['stat', 'bag', 'shop', 'gacha', 'ach', 'chat'];
// 会被结算原地改写的列表字段；写时浅拷要逐条拷。
export const LIST_KEYS = ['stats', 'tasks', 'log', 'bag', 'shop', 'gachaPool', 'achievements', 'chat', 'skills', 'perks', 'rewardsLog'];

// 补全宿主设置里缺的键。宿主的 settings() 返回的是共享只读对象，这里绝不原地改，返回新对象；按入参引用做一次缓存。
const filledCache = new WeakMap();
export function fillSettings(s) {
    if (!s || typeof s !== 'object') return { ...SETTING_DEFAULTS, mods: defaultMods() };
    const hit = filledCache.get(s);
    if (hit && hit.src === JSON.stringify(s)) return hit.out;
    const out = { ...SETTING_DEFAULTS, ...s };
    for (const k of Object.keys(SETTING_DEFAULTS)) if (out[k] === undefined) out[k] = SETTING_DEFAULTS[k];
    out.mods = { ...defaultMods(), ...(s.mods && typeof s.mods === 'object' ? s.mods : {}) };
    filledCache.set(s, { src: JSON.stringify(s), out });
    return out;
}
function defaultMods() {
    const m = {};
    for (const k of MOD_KEYS) m[k] = true;
    return m;
}

export function personaOf(s) {
    const t = s && s.personaText && String(s.personaText).trim();
    return t || PERSONA[s && s.personality] || PERSONA['冷澈'];
}
export function hostOf(s) {
    return s && s.bindTo && s.bindTo !== '宿主' ? s.bindTo : '';
}

// 原插件 isAiMsg：非用户楼，且不是系统提示楼（名为 System 或带 extra.type）。
export function isAiMsg(m) {
    return !!(m && !m.is_user && !(m.is_system && (m.name === 'System' || (m.extra && m.extra.type))));
}

export function createInitialState() {
    return {
        points: 0, level: 1, exp: 0, expMax: 100,
        stats: [], tasks: [], log: [], bag: [],
        shop: DEFAULT_SHOP.map((x) => ({ ...x })),
        gachaPool: DEFAULT_GACHA.map((x) => ({ ...x })),
        achievements: [], chat: [], skills: [], perks: [], rewardsLog: [],
        lastTaskTurn: -99, lastShopTurn: -99, lastGachaTurn: -99, nextId: 1,
        paused: false, pausedAt: null,
    };
}

// 写时浅拷：顶层展开，列表字段逐条拷一层，调用方拿到的副本可随便原地改。
export function cloneForWrite(st) {
    const out = { ...st };
    for (const k of LIST_KEYS) if (Array.isArray(st[k])) out[k] = st[k].map((x) => (x && typeof x === 'object' ? { ...x } : x));
    return out;
}

// 只读保护：冻结后任何原地修改在严格模式下直接抛错，防止共享缓存被改（IGS 曾因此发热）。
export function deepFreeze(o) {
    if (!o || typeof o !== 'object' || Object.isFrozen(o)) return o;
    Object.freeze(o);
    for (const k of Object.keys(o)) deepFreeze(o[k]);
    return o;
}

// 53 位字符串哈希（cyrb53），用于回放链签名与指纹。
export function hash53(str, seed = 0) {
    let h1 = 0xdeadbeef ^ seed;
    let h2 = 0x41c6ce57 ^ seed;
    for (let i = 0; i < str.length; i += 1) {
        const ch = str.charCodeAt(i);
        h1 = Math.imul(h1 ^ ch, 2654435761);
        h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

// mulberry32：种子相同则序列相同；同一 swipe 重算抽奖结果不变。
export function seededRandom(seed) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = Math.imul(a ^ (a >>> 15), a | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
export function newSeed() {
    try {
        const c = globalThis.crypto;
        if (c && typeof c.getRandomValues === 'function') return c.getRandomValues(new Uint32Array(1))[0];
    } catch (e) { /* 退回 Math.random */ }
    return Math.floor(Math.random() * 4294967296);
}
