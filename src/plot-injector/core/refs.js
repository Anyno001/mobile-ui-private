import { acuField } from './acu.js';

// 讨论页「附带参考」里世界书条目的选择规则。存规则而不是条目清单，世界书新增条目时自动套用：
// - 手写条目默认附带（世界书里关闭的除外）；
// - TavernDB-ACU 数据库条目：纪要索引默认附带；纪要按编号只取最新 memo 条（默认 10），避免条目多了撑爆；
//   其他字段默认不附带，可按字段整体勾选；
// - 单条与默认不同时记在 picks 里。手写条目按 key 记，数据库条目按条目名记（ACU 重写条目时 key 会变）。
export const DEFAULT_WB_RULE = { fields: {}, picks: {} };
export const DEFAULT_MEMO = 10;
export const MEMO_FIELD = /^纪要表?$/;
const INDEX_FIELD = /纪要/;

export function entryRefId(book, entry) {
    return acuField(entry.title) ? `${book}|t:${entry.title}` : `${book}|k:${entry.key}`;
}

export function normalizeWbRule(value) {
    const src = value && typeof value === 'object' ? value : {};
    const fields = {};
    const picks = {};
    if (src.fields && typeof src.fields === 'object') for (const [name, on] of Object.entries(src.fields)) if (name && typeof on === 'boolean') fields[name] = on;
    if (src.picks && typeof src.picks === 'object') for (const [id, on] of Object.entries(src.picks)) if (typeof on === 'boolean') picks[id] = on;
    return { fields, picks };
}

export const isMemoField = field => MEMO_FIELD.test(field);

// 纪要以外的字段：有记录用记录，否则只有纪要索引一类默认勾选。
export function fieldChecked(rule, field) {
    return Object.prototype.hasOwnProperty.call(rule.fields, field) ? rule.fields[field] : INDEX_FIELD.test(field) && !isMemoField(field);
}

const rowNo = entry => {
    const match = /-(\d+)$/.exec(entry.title);
    return match ? Number(match[1]) : -1;
};

// 按默认规则勾上的条目 id（不含单条覆盖）。books: [{ name, entries }]
export function defaultSet(rule, books, memo = DEFAULT_MEMO) {
    const out = new Set();
    for (const book of books) {
        const memos = [];
        for (const entry of book.entries) {
            const field = acuField(entry.title);
            if (!field) { if (!entry.disabled) out.add(entryRefId(book.name, entry)); continue; }
            if (isMemoField(field)) memos.push(entry);
            else if (fieldChecked(rule, field)) out.add(entryRefId(book.name, entry));
        }
        memos.sort((a, b) => rowNo(b) - rowNo(a)).slice(0, Math.max(0, memo)).forEach(entry => out.add(entryRefId(book.name, entry)));
    }
    return out;
}

export function checkedSet(rule, books, memo = DEFAULT_MEMO) {
    const out = defaultSet(rule, books, memo);
    for (const [id, on] of Object.entries(rule.picks)) {
        if (on) out.add(id);
        else out.delete(id);
    }
    return out;
}

// 弹窗确认后：fields 为 { 字段名: 是否勾选 }（纪要不在其中，按数量取），单条只记与默认不同的。checked: 勾上的 id 集合。
export function ruleFromSelection(books, fields, checked, memo = DEFAULT_MEMO) {
    const rule = { fields: {}, picks: {} };
    for (const [field, on] of Object.entries(fields)) if (!isMemoField(field) && on !== fieldChecked(rule, field)) rule.fields[field] = on;
    const base = defaultSet(rule, books, memo);
    for (const book of books) {
        for (const entry of book.entries) {
            const id = entryRefId(book.name, entry);
            const on = checked.has(id);
            if (on !== base.has(id)) rule.picks[id] = on;
        }
    }
    return rule;
}

// 旧版存的是逐条清单 refs.oc：手写条目现在默认就附带；数据库条目转成单条勾选。
export function migrateOc(oc) {
    const rule = { fields: {}, picks: {} };
    for (const item of Array.isArray(oc) ? oc : []) {
        if (item && item.book && acuField(item.title)) rule.picks[`${item.book}|t:${item.title}`] = true;
    }
    return rule;
}
