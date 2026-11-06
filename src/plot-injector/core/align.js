import { NODE_FIELDS, flattenUnits, stageNodes } from './outline.js';

// 跨聊天对照表：大纲（所有聊天共用）里记节点改名与阶段 id 别名，各聊天读进度时先按表把记录对回当前大纲。
// project.outline.renames = [{ stageId, field, from, to }]：节点改名，最多 RENAME_MAX 条，旧的先丢。
// project.outline.idAlias = { 旧阶段id: 新阶段id }：合并、拆分、单阶段替换、历史恢复换掉的 id，可链式解析，最多 ALIAS_MAX 条。
export const RENAME_MAX = 200;
export const ALIAS_MAX = 300;

const isObj = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const FIELD_OF = Object.fromEntries(NODE_FIELDS.map(meta => [meta.prefix, meta.field]));
const FIELDS = new Set(NODE_FIELDS.map(meta => meta.field));
// 节点 id 去掉末尾序号得前缀；挂起的孤儿记录 id 形如 s~1，前缀同样是 s。
export const prefixOf = id => String(id).replace(/~?\d+$/, '');
const keyStage = key => key.slice(0, key.indexOf(':'));
const keyNode = key => key.slice(key.indexOf(':') + 1);

export function normalizeRenames(value) {
    const list = Array.isArray(value) ? value : [];
    return list
        .filter(item => isObj(item) && typeof item.stageId === 'string' && item.stageId && FIELDS.has(item.field))
        .map(item => ({ stageId: item.stageId, field: item.field, from: String(item.from ?? '').trim(), to: String(item.to ?? '').trim() }))
        .filter(item => item.from && item.to && item.from !== item.to)
        .slice(-RENAME_MAX);
}

export function normalizeAlias(value) {
    if (!isObj(value)) return {};
    const entries = Object.entries(value).filter(([from, to]) => from && typeof to === 'string' && to && to !== from);
    return Object.fromEntries(entries.slice(-ALIAS_MAX));
}

export function withRenames(outline, items) {
    const add = normalizeRenames(items);
    if (!add.length) return outline;
    return { ...outline, renames: normalizeRenames([...normalizeRenames(outline.renames), ...add]) };
}

// pairs = [[旧id, 新id]]。旧 id 重新出现在大纲里（例如恢复历史）时，指向它的反向别名删掉，免得成环。
export function withAliases(outline, pairs) {
    const list = (pairs || []).filter(([from, to]) => from && to && from !== to);
    if (!list.length) return outline;
    const alias = { ...normalizeAlias(outline.idAlias) };
    for (const [from, to] of list) {
        delete alias[from];
        if (alias[to] === from) delete alias[to];
        alias[from] = to;
    }
    return { ...outline, idAlias: normalizeAlias(alias) };
}

// 对照表的查询接口：resolve(id) 把旧阶段 id 沿别名链解析成现存的 id（解析不到原样返回），
// family(stageId, field, name) 返回这个名称沿改名链（正反两个方向）能连到的所有名称。
export function outlineLinks(outline, units = null) {
    const src = isObj(outline) ? outline : {};
    const alias = normalizeAlias(src.idAlias);
    const renames = normalizeRenames(src.renames);
    const live = new Set((units || flattenUnits(src.volumes || [])).map(unit => unit.id));
    const resolve = id => {
        if (live.has(id) || !alias[id]) return id;
        const seen = new Set([id]);
        let at = id;
        while (alias[at] && !seen.has(alias[at])) {
            at = alias[at];
            if (live.has(at)) return at;
            seen.add(at);
        }
        return id;
    };
    const cache = new Map();
    const family = (stageId, field, name) => {
        const cacheKey = `${stageId}\n${field}\n${name}`;
        if (cache.has(cacheKey)) return cache.get(cacheKey);
        const edges = renames.filter(item => item.field === field && resolve(item.stageId) === stageId);
        const names = new Set([name]);
        for (let grew = true; grew;) {
            grew = false;
            for (const item of edges) {
                if (names.has(item.from) && !names.has(item.to)) { names.add(item.to); grew = true; }
                if (names.has(item.to) && !names.has(item.from)) { names.add(item.from); grew = true; }
            }
        }
        cache.set(cacheKey, names);
        return names;
    };
    return { resolve, family, empty: !renames.length && !Object.keys(alias).length };
}

export const NO_LINKS = { resolve: id => id, family: (stageId, field, name) => new Set([name]), empty: true };

// 一个阶段的记录对到节点上。records = [{ key, stageId, nodeId, name, value }]，stageId 为记录原所在阶段（可能是别名）。
// 顺序：本键上名称相同 → 同阶段其他键上名称相同（本阶段的优先于别名阶段）→ 改名链上的曾用名 → 本键上没记名称的旧数据。
// 返回 { placed: Map(节点id → 记录), orphans: [没对上的记录] }。
export function placeRecords(nodes, records, stageId, links = NO_LINKS) {
    const placed = new Map();
    const used = new Set();
    const own = (node, rec) => rec.stageId === stageId && rec.nodeId === node.id;
    const fits = (node, rec) => prefixOf(rec.nodeId) === prefixOf(node.id);
    const take = (node, rec) => { placed.set(node.id, rec); used.add(rec); };
    for (const node of nodes) {
        const rec = records.find(item => own(node, item) && item.name === node.name);
        if (rec) take(node, rec);
    }
    const ordered = [...records].sort((a, b) => (a.stageId === stageId ? 0 : 1) - (b.stageId === stageId ? 0 : 1));
    for (const node of nodes) {
        if (placed.has(node.id)) continue;
        const rec = ordered.find(item => !used.has(item) && item.name && item.name === node.name && fits(node, item));
        if (rec) take(node, rec);
    }
    for (const node of nodes) {
        if (placed.has(node.id)) continue;
        const names = links.family(stageId, node.field, node.name);
        if (names.size < 2) continue;
        // 曾用名正好是同字段另一个节点的现名时不认，免得抢走别人的记录。
        const taken = new Set(nodes.filter(other => other !== node && other.field === node.field).map(other => other.name));
        const rec = ordered.find(item => !used.has(item) && item.name && names.has(item.name) && !taken.has(item.name) && fits(node, item));
        if (rec) take(node, rec);
    }
    for (const node of nodes) {
        if (placed.has(node.id)) continue;
        const rec = records.find(item => !used.has(item) && !item.name && own(node, item));
        if (rec) take(node, rec);
    }
    return { placed, orphans: records.filter(item => !used.has(item)) };
}

// map（钟或钩子）里属于 stageId 的记录：键上的阶段解析后为 stageId、节点前缀在 prefixes 里。
function stageRecords(map, stageId, prefixes, links) {
    const out = [];
    for (const [key, value] of Object.entries(map)) {
        if (key.indexOf(':') < 0) continue;
        const from = keyStage(key);
        const nodeId = keyNode(key);
        if (!prefixes.has(prefixOf(nodeId)) || links.resolve(from) !== stageId) continue;
        out.push({ key, stageId: from, nodeId, name: isObj(value) && value.name ? String(value.name) : '', value });
    }
    return out;
}

// 取节点对应的记录（liveThreads 用）：返回 Map(节点id → { saved, savedKey })。
export function placeStageMap(map, stageId, nodes, links = NO_LINKS) {
    const prefixes = new Set(nodes.map(node => prefixOf(node.id)));
    const { placed } = placeRecords(nodes, stageRecords(map, stageId, prefixes, links), stageId, links);
    const out = new Map();
    for (const [nodeId, rec] of placed) out.set(nodeId, { saved: isObj(rec.value) ? rec.value : {}, savedKey: rec.key });
    return out;
}

// 把一个阶段的记录整体归位：对上的写到节点当前的键并记上节点名；没对上的有名记录留在原键，
// 原键被节点占着时挂到 阶段:前缀~序号（不占节点位置，之后按名称仍能找回）；没名称又对不上的旧数据丢掉。
export function realignStage(map, stageId, nodes, links = NO_LINKS) {
    const prefixes = new Set(nodes.map(node => prefixOf(node.id)));
    if (!prefixes.size) return map;
    const records = stageRecords(map, stageId, prefixes, links);
    if (!records.length) return map;
    const { placed, orphans } = placeRecords(nodes, records, stageId, links);
    const out = { ...map };
    for (const rec of records) delete out[rec.key];
    const nodeKeys = new Set(nodes.map(node => `${stageId}:${node.id}`));
    for (const node of nodes) {
        const rec = placed.get(node.id);
        if (rec) out[`${stageId}:${node.id}`] = { ...(isObj(rec.value) ? rec.value : {}), name: node.name };
    }
    for (const rec of orphans) {
        if (!rec.name) continue;
        const ownKey = `${stageId}:${rec.nodeId}`;
        if (rec.stageId === stageId && !nodeKeys.has(ownKey) && !(ownKey in out)) {
            out[ownKey] = rec.value;
            continue;
        }
        const prefix = prefixOf(rec.nodeId);
        let n = 0;
        while (`${stageId}:${prefix}~${n}` in out) n += 1;
        out[`${stageId}:${prefix}~${n}`] = rec.value;
    }
    return out;
}

// 取消勾选（已演）的记录：slots[阶段].off 为节点 id，offNames 记标记时的节点名（旧数据没有，按位置）。
function offRecords(slots, stageId, links) {
    const out = [];
    for (const [slotId, slot] of Object.entries(slots || {})) {
        if (!slot || !Array.isArray(slot.off) || links.resolve(slotId) !== stageId) continue;
        const names = isObj(slot.offNames) ? slot.offNames : {};
        for (const nodeId of slot.off) out.push({ key: `${slotId}:${nodeId}`, stageId: slotId, nodeId: String(nodeId), name: names[nodeId] ? String(names[nodeId]) : '', value: true });
    }
    return out;
}

// 解析后的已演节点 id（注入、索引、检测、执行页都走这里）。只有本阶段没记名称的旧数据时与旧版完全一样按位置读。
export function resolveOff(slots, unit, links = NO_LINKS) {
    const own = slots && slots[unit.id];
    const plain = own && Array.isArray(own.off) && !isObj(own.offNames) && links.empty;
    if (plain) return own.off;
    const nodes = stageNodes(unit.stage && unit.stage.data);
    const records = offRecords(slots, unit.id, links);
    if (!records.length) return [];
    const { placed } = placeRecords(nodes, records, unit.id, links);
    return nodes.filter(node => placed.has(node.id)).map(node => node.id);
}

// 一个阶段的已演标记整体归位，返回 { off, offNames }；没对上的有名记录挂到 前缀~序号，没名称又对不上的丢掉。
export function realignOff(slots, unit, links = NO_LINKS) {
    const nodes = stageNodes(unit.stage && unit.stage.data);
    const records = offRecords(slots, unit.id, links);
    const { placed, orphans } = placeRecords(nodes, records, unit.id, links);
    const off = [];
    const offNames = {};
    for (const node of nodes) {
        if (!placed.has(node.id)) continue;
        off.push(node.id);
        offNames[node.id] = node.name;
    }
    const counts = new Map();
    for (const rec of orphans) {
        if (!rec.name) continue;
        const prefix = prefixOf(rec.nodeId);
        const n = counts.get(prefix) || 0;
        counts.set(prefix, n + 1);
        off.push(`${prefix}~${n}`);
        offNames[`${prefix}~${n}`] = rec.name;
    }
    return { off, offNames };
}

// 键名排序后的序列化，用来判断归位前后有没有实际变化。
function stable(value) {
    if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
    if (isObj(value)) return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
    return JSON.stringify(value ?? null);
}

const KIND_MAP = { world: 'clocks', side: 'hooks' };

// 挂起的孤儿记录（键为 前缀~序号）在全书范围内找唯一同字段同名、还没有记录的节点（拆分后节点挪到了另一段）。
function adoptAcross(map, units, kind) {
    const byName = new Map();
    for (const unit of units) {
        for (const node of stageNodes(unit.stage.data)) {
            if (node.kind !== kind) continue;
            const id = `${node.field}\n${node.name}`;
            byName.set(id, byName.has(id) ? null : { unit, node });
        }
    }
    let out = map;
    for (const [key, value] of Object.entries(map)) {
        if (!keyNode(key).includes('~') || !isObj(value) || !value.name) continue;
        const field = FIELD_OF[prefixOf(keyNode(key))];
        const hit = byName.get(`${field}\n${value.name}`);
        if (!hit) continue;
        const target = `${hit.unit.id}:${hit.node.id}`;
        if (target in out) continue;
        if (out === map) out = { ...map };
        delete out[key];
        out[target] = { ...value, name: hit.node.name };
    }
    return out;
}

// 读进度时调用：按对照表把当前聊天的进度对回当前大纲。旧阶段 id 换成新 id（current、muted、offMuted、slots、钟与钩子的键），
// 已演标记、钟、钩子按节点名（含改名链）归位。没有要改的原样返回同一个对象。
export function alignProgress(progress, outline) {
    if (!progress || progress.infinite || !isObj(outline)) return progress;
    const units = flattenUnits(outline.volumes || []);
    if (!units.length) return progress;
    const links = outlineLinks(outline, units);
    const live = new Set(units.map(unit => unit.id));
    const fix = id => (typeof id === 'string' ? links.resolve(id) : id);
    const uniq = list => [...new Set(list)];
    const next = { ...progress };
    next.current = fix(progress.current);
    if (Array.isArray(progress.muted)) next.muted = uniq(progress.muted.map(fix));
    if (Array.isArray(progress.offMuted)) next.offMuted = uniq(progress.offMuted.map(fix));
    // 已演标记：先按阶段收集（含别名阶段的旧记录），归位后写回现存阶段；别名阶段上的 off 清掉。
    const oldSlots = isObj(progress.slots) ? progress.slots : {};
    // 现存阶段与解析不到的键原样保留；别名阶段的槽位并进新阶段（新阶段已有的字段优先，off 另行归位）。
    const slots = {};
    for (const [id, slot] of Object.entries(oldSlots)) if (fix(id) === id) slots[id] = slot;
    for (const [id, slot] of Object.entries(oldSlots)) {
        const to = fix(id);
        if (to === id) continue;
        const { off, offNames, ...rest } = isObj(slot) ? slot : {};
        slots[to] = { ...rest, ...(isObj(slots[to]) ? slots[to] : {}) };
    }
    for (const unit of units) {
        const orig = isObj(oldSlots[unit.id]) ? oldSlots[unit.id] : null;
        const { off, offNames } = realignOff(oldSlots, unit, links);
        if (!off.length && !(orig && Array.isArray(orig.off) && orig.off.length)) continue;
        const { off: _off, offNames: _names, ...rest } = isObj(slots[unit.id]) ? slots[unit.id] : {};
        slots[unit.id] = off.length ? { ...rest, off, offNames } : rest;
    }
    next.slots = slots;
    if (isObj(progress.threads)) {
        const threads = { ...progress.threads };
        for (const [kind, field] of Object.entries(KIND_MAP)) {
            let map = isObj(threads[field]) ? threads[field] : {};
            for (const unit of units) map = realignStage(map, unit.id, stageNodes(unit.stage.data).filter(node => node.kind === kind), links);
            threads[field] = adoptAcross(map, units, kind);
        }
        next.threads = threads;
    }
    return stable(next) === stable(progress) ? progress : next;
}
