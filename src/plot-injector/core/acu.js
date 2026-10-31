// TavernDB-ACU 数据库插件写入的世界书条目，正文照常读取；这里只负责按字段分组。
// 中文字段类：TavernDB-ACU-CustomExport-中文字段-数字/包裹/上下；去掉末尾那一段就是字段名，其余归「英文字段」。
export const ACU = /^TavernDB-ACU/i;
const CUSTOM = /^TavernDB-ACU-CustomExport-/i;
const TAIL = /-(?:\d+|包裹|上|下)$/;
export const EN_FIELD = '英文字段';

// 数据库条目返回字段名，非数据库条目返回空串。
export function acuField(title) {
    const name = String(title || '');
    if (!ACU.test(name)) return '';
    const rest = name.replace(CUSTOM, '');
    if (rest === name || !/^[一-鿿]/.test(rest)) return EN_FIELD;
    return rest.replace(TAIL, '') || rest;
}

// 按字段分组，中文字段按出现顺序在前，英文字段放最后。返回 [[字段名, 条目[]], ...]
export function groupByField(entries) {
    const map = new Map();
    for (const entry of entries) {
        const field = acuField(entry.title);
        if (!field) continue;
        if (!map.has(field)) map.set(field, []);
        map.get(field).push(entry);
    }
    return [...map].sort(([a], [b]) => Number(a === EN_FIELD) - Number(b === EN_FIELD));
}
