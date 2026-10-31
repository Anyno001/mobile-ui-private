import { parseYaml, stringifyYaml, yamlErrorLine } from './yaml.js';

// 剧情 YAML：卷（剧情_卷X_标题）→ 阶段（阶段N_标题）→ 字段。阶段原样保存字段，往返不丢键。
export const NODE_FIELDS = [
    { field: '主线节点', kind: 'main', prefix: 'm', label: '主线' },
    { field: '支线事件', kind: 'side', prefix: 's', label: '支线' },
    { field: '世界动态', kind: 'world', prefix: 'w', label: '世界动态' },
];
const STAGE_HINT_KEYS = ['时间范围', 'AI指令', '主线节点', '支线事件', '世界动态'];

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
