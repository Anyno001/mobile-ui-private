// 世界书批量工具的纯计算：关键词标点修复、正则替换、顺序重排。只算出改动，写入交给 host/worldbook.js。

// 酒馆把 /…/flags 形式的关键词当正则，里面的逗号不能拆。
const isRegexKey = key => /^\/.+\/[a-z]*$/i.test(key);
const SPLIT = /[,，、;；\n]/;
const TRIM = /^[\s　。，、；：！？,.;:!?]+|[\s　。，、；：！？,.;:!?]+$/g;

export function fixKeys(keys) {
    const out = [];
    for (const raw of keys) {
        const parts = isRegexKey(String(raw).trim()) ? [String(raw).trim()] : String(raw).split(SPLIT).map(part => part.replace(TRIM, ''));
        for (const part of parts) if (part && !out.includes(part)) out.push(part);
    }
    return out;
}

const sameList = (a, b) => a.length === b.length && a.every((item, index) => item === b[index]);

// 返回 [{ key, title, patch, before, after }]，只列真正有变化的条目。
export function punctPlan(entries) {
    const out = [];
    for (const entry of entries) {
        const key = fixKeys(entry.keys);
        const second = fixKeys(entry.keysSecondary);
        const patch = {};
        if (!sameList(key, entry.keys)) patch.key = key;
        if (!sameList(second, entry.keysSecondary)) patch.keysecondary = second;
        if (!Object.keys(patch).length) continue;
        out.push({ key: entry.key, title: entry.title, patch, before: [...entry.keys, ...entry.keysSecondary].join(' | '), after: [...key, ...second].join(' | ') });
    }
    return out;
}

export function buildPattern(find, { regex = false, ignoreCase = false } = {}) {
    if (!find) throw new Error('请填写要查找的内容');
    const source = regex ? find : find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    try {
        return new RegExp(source, ignoreCase ? 'gi' : 'g');
    } catch (error) {
        throw new Error(`正则写法有误：${error.message}`);
    }
}

const countIn = (text, pattern) => (String(text).match(pattern) || []).length;

// fields: content 内容、comment 标题、keys 主次关键词。替换文字里可用 $1 引用分组（仅正则模式）。
export function regexPlan(entries, pattern, replace, fields) {
    const sub = text => String(text).replace(pattern, replace);
    const out = [];
    for (const entry of entries) {
        const patch = {};
        let hits = 0;
        if (fields.content && countIn(entry.content, pattern)) {
            hits += countIn(entry.content, pattern);
            patch.content = sub(entry.content);
        }
        if (fields.comment && entry.comment && countIn(entry.comment, pattern)) {
            hits += countIn(entry.comment, pattern);
            patch.comment = sub(entry.comment);
        }
        if (fields.keys) {
            for (const [from, field] of [[entry.keys, 'key'], [entry.keysSecondary, 'keysecondary']]) {
                const n = from.reduce((sum, key) => sum + countIn(key, pattern), 0);
                if (!n) continue;
                hits += n;
                patch[field] = from.map(sub).map(key => key.trim()).filter(Boolean);
            }
        }
        if (hits) out.push({ key: entry.key, title: entry.title, patch, hits });
    }
    return out;
}

// by: list 按列表里的先后，order 按原有顺序值（相同时保持列表先后）。
export function orderPlan(entries, { start, step, by = 'list' }) {
    const begin = Math.round(Number(start));
    const gap = Math.round(Number(step));
    if (!Number.isFinite(begin) || begin < 0) throw new Error('起始数字需为不小于 0 的整数');
    if (!Number.isFinite(gap) || gap < 1) throw new Error('间隔需为不小于 1 的整数');
    const list = by === 'order' ? entries.map((entry, index) => ({ entry, index })).sort((a, b) => a.entry.order - b.entry.order || a.index - b.index).map(item => item.entry) : entries;
    return list.map((entry, index) => ({ key: entry.key, title: entry.title, from: entry.order, to: begin + index * gap }));
}

// 触发测试：按酒馆规则模拟一段文字会命中哪些条目。不计递归、概率、分组、扫描深度。
// 照抄酒馆 public/scripts/world-info.js 的 matchKeys 与 parseRegexFromString（release 分支）：
// - /正则/flags（flags 限 gimsuy，正文里不能有未转义的 /）按正则，忽略其他选项；写法不合法时当普通文字。
// - 普通关键词：caseSensitive、matchWholeWords 为 null 时跟随酒馆全局设置（world_info_case_sensitive / world_info_match_whole_words）。
// - 全词匹配：关键词按空白拆开多于一个词时按包含匹配；单个词用 (?:^|\W)(词)(?:$|\W)，\W 只把 ASCII 字母、数字、下划线当单词字符，中文算边界。
const escapeRegex = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function parseRegexKey(text) {
    const match = text.match(/^\/([\w\W]+?)\/([gimsuy]*)$/);
    if (!match || /(^|[^\\])\//.test(match[1])) return null;
    try {
        return new RegExp(match[1].replace('\\/', '/'), match[2]);
    } catch {
        return null;
    }
}

function keyMatcher(key, { caseSensitive = null, matchWholeWords = null } = {}, globals = {}) {
    const text = String(key).trim();
    const regex = parseRegexKey(text);
    if (regex) return haystack => regex.test(haystack);
    if (text === '') return () => false;
    const sensitive = caseSensitive ?? Boolean(globals.caseSensitive);
    const whole = matchWholeWords ?? Boolean(globals.matchWholeWords);
    const fold = value => (sensitive ? value : value.toLowerCase());
    const needle = fold(text);
    if (whole && needle.split(/\s+/).length === 1) {
        const pattern = new RegExp(`(?:^|\\W)(${escapeRegex(needle)})(?:$|\\W)`);
        return haystack => pattern.test(fold(haystack));
    }
    return haystack => fold(haystack).includes(needle);
}

const matchedKeys = (keys, haystack, options, globals) => keys.filter(key => String(key).trim() && keyMatcher(key, options, globals)(haystack));

// 次要关键词逻辑：0 AND_ANY，1 NOT_ALL，2 NOT_ANY，3 AND_ALL。
function secondaryPass(logic, hit, total) {
    if (logic === 1) return hit < total;
    if (logic === 2) return hit === 0;
    if (logic === 3) return hit === total;
    return hit > 0;
}

// globals：酒馆全局的 { caseSensitive, matchWholeWords }，条目上为 null 时用；读不到时按 false。
export function triggerTest(entries, text, tokenOf = () => 0, globals = {}) {
    const haystack = String(text || '');
    const constant = [];
    const keyword = [];
    for (const entry of entries) {
        if (entry.disabled) continue;
        const options = { caseSensitive: entry.caseSensitive, matchWholeWords: entry.matchWholeWords };
        if (entry.constant) {
            constant.push({ key: entry.key, title: entry.title, tokens: tokenOf(entry) });
            continue;
        }
        const primary = matchedKeys(entry.keys, haystack, options, globals);
        if (!primary.length) continue;
        let matched = primary;
        const secondary = entry.selective === false ? [] : entry.keysSecondary.filter(key => String(key).trim());
        if (secondary.length) {
            const logic = Number(entry.selectiveLogic) || 0;
            const hit = matchedKeys(secondary, haystack, options, globals);
            if (!secondaryPass(logic, hit.length, secondary.length)) continue;
            if (logic === 0 || logic === 3) matched = [...primary, ...hit];
        }
        keyword.push({ key: entry.key, title: entry.title, matched, tokens: tokenOf(entry) });
    }
    const sum = list => list.reduce((total, item) => total + item.tokens, 0);
    return { constant, keyword, tokens: { constant: sum(constant), keyword: sum(keyword), total: sum(constant) + sum(keyword) } };
}

// 体检：只看手写条目（调用方先去掉数据库条目）。返回各类问题，空数组即无问题。
const HAN = /[\u4e00-\u9fff]/g;
const isShortKey = key => {
    const text = String(key).trim();
    if (!text || isRegexKey(text)) return false;
    return text.length <= 1 || /^[A-Za-z]{1,2}$/.test(text);
};

export function healthCheck(entries, tokenOf = () => 0) {
    const on = entries.filter(entry => !entry.disabled);
    const shortKeys = [];
    for (const entry of on) {
        if (entry.constant) continue;
        const words = entry.keys.filter(isShortKey);
        if (words.length) shortKeys.push({ key: entry.key, title: entry.title, words });
    }
    const noKeys = on.filter(entry => !entry.constant && !entry.keys.some(key => String(key).trim())).map(entry => ({ key: entry.key, title: entry.title }));
    const byWord = new Map();
    for (const entry of on) {
        if (entry.constant) continue;
        for (const word of new Set(entry.keys.map(key => String(key).trim()).filter(Boolean))) {
            const id = word.toLowerCase();
            if (!byWord.has(id)) byWord.set(id, { word, entries: [] });
            byWord.get(id).entries.push({ key: entry.key, title: entry.title });
        }
    }
    const shared = [...byWord.values()].filter(item => item.entries.length > 1);
    const byTitle = new Map();
    for (const entry of entries) {
        const id = String(entry.title).trim();
        if (!byTitle.has(id)) byTitle.set(id, { title: id, entries: [] });
        byTitle.get(id).entries.push({ key: entry.key, title: entry.title });
    }
    const dupTitles = [...byTitle.values()].filter(item => item.entries.length > 1);
    const constTokens = on.filter(entry => entry.constant).reduce((sum, entry) => sum + tokenOf(entry), 0);
    const total = on.reduce((sum, entry) => sum + tokenOf(entry), 0);
    const ratio = total ? constTokens / total : 0;
    return { shortKeys, noKeys, shared, dupTitles, constant: { count: on.filter(entry => entry.constant).length, tokens: constTokens, total, ratio, warn: ratio > 0.6 } };
}

// 条目排序：mode 为 order 顺序值、tokens 从大到小、title 标题；其他值保持原顺序。稳定排序。
export function sortEntries(entries, mode, tokenOf = () => 0) {
    const list = entries.map((entry, index) => ({ entry, index }));
    const by = {
        order: (a, b) => a.entry.order - b.entry.order,
        tokens: (a, b) => tokenOf(b.entry) - tokenOf(a.entry),
        title: (a, b) => String(a.entry.title).localeCompare(String(b.entry.title), 'zh'),
    }[mode];
    if (!by) return entries;
    return list.sort((a, b) => by(a, b) || a.index - b.index).map(item => item.entry);
}
