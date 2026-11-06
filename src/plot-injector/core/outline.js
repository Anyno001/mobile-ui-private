import { pushHistory } from './setting.js';
import { parseYaml, stringifyYaml, yamlErrorLine } from './yaml.js';

// 剧情 YAML：卷（剧情_卷X_标题）→ 阶段（阶段N_标题）→ 字段。阶段原样保存字段，往返不丢键。
export const NODE_FIELDS = [
    { field: '主线节点', kind: 'main', prefix: 'm', label: '主线' },
    { field: '支线事件', kind: 'side', prefix: 's', label: '支线' },
    { field: '世界动态', kind: 'world', prefix: 'w', label: '世界动态' },
];
const STAGE_HINT_KEYS = ['时间范围', 'AI指令', '主线节点', '支线事件', '世界动态', '状态变化'];

// 状态变化：本阶段结束时人物关系、认知、信息差比之前变了什么。阶段演完后累积起来接在设定后面注入，覆盖设定里的开局状态。
export const CHANGE_FIELD = '状态变化';

export function changeLines(data) {
    const value = data && data[CHANGE_FIELD];
    const list = Array.isArray(value) ? value : String(value || '').split('\n');
    return list
        .map(item => (item && typeof item === 'object' ? Object.values(item).join('：') : String(item || '')))
        .map(text => text.replace(/^\s*(?:[-*•]|\d+[.、])\s*/, '').trim())
        .filter(Boolean);
}

export function makeId(prefix = 'u') {
    return `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

const isPlainObject = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

export function looksLikeStage(value) {
    return isPlainObject(value) && STAGE_HINT_KEYS.some(key => key in value);
}

function looksLikeVolume(value) {
    return isPlainObject(value) && Object.values(value).some(looksLikeStage);
}

// 接受整份大纲（卷→阶段）、单卷内容（阶段→字段）或单个阶段。
export function volumesFromValue(value, idOf = makeId) {
    if (!isPlainObject(value)) throw new Error('大纲顶层应是「卷名: 阶段」的映射');
    const entries = Object.entries(value);
    if (entries.length && entries.every(([, v]) => looksLikeStage(v))) {
        return [{ id: idOf('v'), key: '剧情_导入', stages: entries.map(([key, data]) => ({ id: idOf('s'), key, data })) }];
    }
    if (looksLikeStage(value)) {
        return [{ id: idOf('v'), key: '剧情_导入', stages: [{ id: idOf('s'), key: '阶段一_导入', data: value }] }];
    }
    const volumes = [];
    for (const [key, stages] of entries) {
        if (!looksLikeVolume(stages)) throw new Error(`「${key}」下没有可识别的阶段（需要 时间范围 / 主线节点 等字段）`);
        volumes.push({
            id: idOf('v'),
            key,
            stages: Object.entries(stages).filter(([, data]) => isPlainObject(data)).map(([stageKey, data]) => ({ id: idOf('s'), key: stageKey, data })),
        });
    }
    if (!volumes.length) throw new Error('没有读到任何卷');
    return volumes;
}

export function parseOutlineText(text, idOf = makeId) {
    let value;
    try {
        value = parseYaml(text);
    } catch (error) {
        const line = yamlErrorLine(error);
        const wrapped = new Error(`YAML 格式错误${line ? `（第 ${line} 行）` : ''}：${String(error.message || error).split('\n')[0]}`);
        wrapped.line = line;
        throw wrapped;
    }
    return volumesFromValue(value, idOf);
}

export function volumeValue(volume) {
    const out = {};
    for (const stage of volume.stages) out[stage.key] = stage.data;
    return out;
}

export function outlineToText(volumes) {
    const out = {};
    for (const volume of volumes) out[volume.key] = volumeValue(volume);
    return stringifyYaml(out);
}

export function volumeToText(volume) {
    return stringifyYaml({ [volume.key]: volumeValue(volume) });
}

export function stageToText(stage) {
    return stringifyYaml({ [stage.key]: stage.data });
}

const stripPrefix = (key, pattern) => String(key || '').replace(pattern, '');

// 剧情_卷一_杀神坠命 → { short: 卷一, title: 杀神坠命 }
export function splitVolumeKey(key) {
    const rest = stripPrefix(key, /^剧情_/);
    const at = rest.indexOf('_');
    return at < 0 ? { short: rest, title: '' } : { short: rest.slice(0, at), title: rest.slice(at + 1) };
}

export function volumeLabel(key) {
    const { short, title } = splitVolumeKey(key);
    return title ? `${short}·${title}` : short;
}

// 阶段二_腺图与封咒 → { short: 阶段二, title: 腺图与封咒 }
export function splitStageKey(key) {
    const text = String(key || '');
    const at = text.indexOf('_');
    return at < 0 ? { short: text, title: '' } : { short: text.slice(0, at), title: text.slice(at + 1) };
}

export function stageLabel(key) {
    const { short, title } = splitStageKey(key);
    return title ? `${short} ${title}` : short;
}

export function flattenUnits(volumes) {
    const units = [];
    (volumes || []).forEach((volume, volIndex) => {
        volume.stages.forEach((stage, stageIndex) => {
            units.push({ id: stage.id, index: units.length, volIndex, stageIndex, volume, stage });
        });
    });
    return units;
}

export function stageNodes(data) {
    const nodes = [];
    for (const { field, kind, prefix, label } of NODE_FIELDS) {
        const list = Array.isArray(data && data[field]) ? data[field] : [];
        list.forEach((item, index) => {
            const name = isPlainObject(item) ? String(item.名称 || item.类型 || item.内容 || '').trim() : String(item || '').trim();
            nodes.push({ id: `${prefix}${index}`, kind, field, label, index, name: name || `${label}${index + 1}`, item });
        });
    }
    return nodes;
}

// 去掉已取消勾选的节点；空列表整段省略。
export function filterStageData(data, offIds = []) {
    const off = new Set(offIds);
    const out = {};
    for (const [key, value] of Object.entries(data || {})) {
        const meta = NODE_FIELDS.find(item => item.field === key);
        if (!meta || !Array.isArray(value)) {
            out[key] = value;
            continue;
        }
        const kept = value.filter((_, index) => !off.has(`${meta.prefix}${index}`));
        if (kept.length) out[key] = kept;
    }
    return out;
}

export function mainNodeNames(data) {
    return stageNodes(data).filter(node => node.kind === 'main').map(node => node.name);
}

// 从 fromStageId 这一段起（含）换成 incoming 里的卷与阶段：同名卷接在后面，新卷追加；返回新的卷列表。
export function replaceRest(volumes, fromStageId, incoming) {
    const units = flattenUnits(volumes);
    const from = units.findIndex(unit => unit.stage.id === fromStageId);
    if (from < 0) throw new Error('原来的阶段已不存在');
    const drop = new Set(units.slice(from).map(unit => unit.stage.id));
    let next = volumes.map(volume => ({ ...volume, stages: volume.stages.filter(stage => !drop.has(stage.id)) }));
    for (const volume of incoming) {
        const same = next.find(item => item.key === volume.key);
        if (same) next = next.map(item => (item === same ? { ...item, stages: [...item.stages, ...volume.stages] } : item));
        else next.push(volume);
    }
    return next.filter(volume => volume.stages.length);
}

// outline v0.1.23：历史版本、移动、单阶段替换、大纲检查。

// 覆盖性操作前把当前大纲（YAML 文本）入栈；大纲为空时不入栈。
export function pushOutlineHistory(history, volumes, label = '', now = Date.now()) {
    if (!volumes || !volumes.length) return Array.isArray(history) ? history : [];
    return pushHistory(history, outlineToText(volumes), 10, now, label);
}

// 按名称分组排队：同名的按出现顺序依次取，取过的不再给别人。
function queueByKey(list) {
    const queues = new Map();
    for (const item of list) {
        if (!queues.has(item.key)) queues.set(item.key, []);
        queues.get(item.key).push(item);
    }
    return key => {
        const queue = queues.get(key);
        return queue && queue.length ? queue.shift() : null;
    };
}

// 历史版本的文本还原成卷列表；卷名、阶段名与当前大纲相同的沿用原 id（进度靠阶段 id）。
// 同名的卷或阶段按出现顺序配对，用过的旧 id 不再复用。卷内配不上的阶段（例如卷改过名）再在全书范围内按阶段名排队配一次；
// 卷没配上时，取它的阶段配到最多的那个旧卷的 id。仍配不上的给新 id，同卷同位置上也没配上的旧阶段记进 alias（[旧id, 新id]），
// 由调用方写进大纲的阶段 id 别名表（core/align.js）。返回 { volumes, alias }。
export function restoreOutline(text, current = [], idOf = makeId) {
    const old = current || [];
    const takeVolume = queueByKey(old);
    const used = new Set();
    const parsed = parseOutlineText(text, idOf).map(volume => {
        const match = takeVolume(volume.key);
        const takeStage = queueByKey(match ? match.stages : []);
        return {
            volume,
            match,
            stages: volume.stages.map(stage => {
                const same = takeStage(stage.key);
                if (same) used.add(same.id);
                return { stage, same };
            }),
        };
    });
    const leftovers = old.flatMap(volume => volume.stages.filter(stage => !used.has(stage.id)).map(stage => ({ key: stage.key, stage, volume })));
    const takeAny = queueByKey(leftovers);
    for (const row of parsed) {
        for (const item of row.stages) {
            if (item.same) continue;
            const hit = takeAny(item.stage.key);
            if (hit) {
                item.same = hit.stage;
                item.from = hit.volume;
                used.add(hit.stage.id);
            }
        }
    }
    const usedVolumes = new Set(parsed.filter(row => row.match).map(row => row.match.id));
    const alias = [];
    const volumes = parsed.map(row => {
        let id = row.match ? row.match.id : row.volume.id;
        if (!row.match) {
            const votes = new Map();
            for (const item of row.stages) if (item.from && !usedVolumes.has(item.from.id)) votes.set(item.from, (votes.get(item.from) || 0) + 1);
            const best = [...votes.entries()].sort((a, b) => b[1] - a[1])[0];
            if (best) {
                id = best[0].id;
                usedVolumes.add(id);
            }
        }
        const source = row.match || old.find(volume => volume.id === id) || null;
        const stages = row.stages.map((item, index) => {
            if (item.same) return { ...item.stage, id: item.same.id };
            const spot = source && source.stages[index];
            if (spot && !used.has(spot.id)) {
                used.add(spot.id);
                alias.push([spot.id, item.stage.id]);
            }
            return item.stage;
        });
        return { ...row.volume, id, stages };
    });
    return { volumes, alias };
}

export function volumesFromHistory(text, current = [], idOf = makeId) {
    return restoreOutline(text, current, idOf).volumes;
}

// 大纲换过以后当前阶段不在了：取原来位置上（按全书顺序）最接近的阶段；原阶段还在或无从判断时返回 null。
export function nearestUnitId(oldVolumes, newVolumes, currentId) {
    const before = flattenUnits(oldVolumes);
    const after = flattenUnits(newVolumes);
    if (!after.length || after.some(unit => unit.id === currentId)) return null;
    const at = before.findIndex(unit => unit.id === currentId);
    if (at < 0) return null;
    return after[Math.min(at, after.length - 1)].id;
}

export function moveItem(list, index, delta) {
    const to = index + delta;
    if (index < 0 || index >= list.length || to < 0 || to >= list.length) return list;
    const out = [...list];
    [out[index], out[to]] = [out[to], out[index]];
    return out;
}

// 阶段移到目标卷末尾，stage.id 不变。
export function moveStageToVolume(volumes, stageId, targetVolumeId) {
    const source = volumes.find(volume => volume.stages.some(stage => stage.id === stageId));
    const target = volumes.find(volume => volume.id === targetVolumeId);
    if (!source || !target || source.id === target.id) return volumes;
    const stage = source.stages.find(item => item.id === stageId);
    return volumes.map(volume => {
        if (volume.id === source.id) return { ...volume, stages: volume.stages.filter(item => item.id !== stageId) };
        if (volume.id === target.id) return { ...volume, stages: [...volume.stages, stage] };
        return volume;
    });
}

// 卷内把 stageIds 指向的阶段换成 incoming：新阶段放在第一个被换阶段的位置，其余被换阶段删除。
// incoming 第一段沿用第一个被换阶段的 id（合并时即前一段），进度靠这个 id 接上。返回 { volumes, stages, keepId }，stages 为带最终 id 的新阶段。
export function replaceStages(volumes, volumeId, stageIds, incoming) {
    const drop = new Set(stageIds);
    let placed = null;
    let keepId = '';
    const next = volumes.map(volume => {
        if (volume.id !== volumeId) return volume;
        const at = volume.stages.findIndex(stage => drop.has(stage.id));
        if (at < 0) throw new Error('原来的阶段已不存在');
        keepId = volume.stages[at].id;
        placed = incoming.map((stage, index) => (index === 0 ? { ...stage, id: keepId } : stage));
        const stages = [];
        volume.stages.forEach((stage, index) => {
            if (index === at) stages.push(...placed);
            if (!drop.has(stage.id)) stages.push(stage);
        });
        return { ...volume, stages };
    });
    if (!placed) throw new Error('原来的阶段已不存在');
    return { volumes: next, stages: placed, keepId };
}

// 大纲检查：没写时间范围、没有主线节点、同卷阶段名重复、空卷。
export function outlineIssues(volumes) {
    const issues = [];
    for (const volume of volumes || []) {
        if (!volume.stages.length) {
            issues.push({ kind: 'empty-volume', volumeId: volume.id, stageId: '', text: `「${volumeLabel(volume.key)}」没有阶段` });
            continue;
        }
        const seen = new Map();
        for (const stage of volume.stages) seen.set(stage.key, (seen.get(stage.key) || 0) + 1);
        for (const stage of volume.stages) {
            const label = stageLabel(stage.key);
            if (!String(stage.data && stage.data.时间范围 || '').trim()) issues.push({ kind: 'no-time', volumeId: volume.id, stageId: stage.id, text: `「${label}」没有写时间范围` });
            if (!mainNodeNames(stage.data).length) issues.push({ kind: 'no-main', volumeId: volume.id, stageId: stage.id, text: `「${label}」没有主线节点` });
            if (seen.get(stage.key) > 1) issues.push({ kind: 'dup-name', volumeId: volume.id, stageId: stage.id, text: `阶段名「${label}」在「${volumeLabel(volume.key)}」中重名` });
        }
    }
    return [...issues, ...threadNameIssues(volumes)];
}

// 支线、进度钟按名称跨阶段匹配进度和检测结果，全书范围内重名就提示。世界动态只查带进度钟的。
function threadNameIssues(volumes) {
    const groups = { side: new Map(), world: new Map() };
    for (const unit of flattenUnits(volumes)) {
        for (const node of stageNodes(unit.stage.data)) {
            if (node.kind === 'main') continue;
            if (node.kind === 'world' && !(Number(node.item && node.item.进度钟) >= 2)) continue;
            const map = groups[node.kind];
            if (!map.has(node.name)) map.set(node.name, []);
            map.get(node.name).push(unit);
        }
    }
    const issues = [];
    for (const [kind, map] of Object.entries(groups)) {
        const what = kind === 'side' ? '支线' : '进度钟';
        for (const [name, list] of map) {
            if (list.length < 2) continue;
            const places = [...new Set(list.map(unit => stageLabel(unit.stage.key)))].join('、');
            const where = places.includes('、') ? places : `${places}的不同节点`;
            const seen = new Set();
            for (const unit of list) {
                if (seen.has(unit.id)) continue;
                seen.add(unit.id);
                issues.push({ kind: 'dup-thread', volumeId: unit.volume.id, stageId: unit.id, text: `${what}「${name}」在 ${where} 重名` });
            }
        }
    }
    return issues;
}
