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
