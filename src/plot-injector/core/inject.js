import { filterStageData, flattenUnits, splitStageKey, splitVolumeKey, stageLabel, stageNodes, volumeLabel } from './outline.js';
import { SETTING_SLOT, offNodes, unitStates } from './progress.js';
import { stringifyYaml } from './yaml.js';

// 位置编号与酒馆 world_info_position 一致。
export const POSITIONS = [
    { value: 0, label: '角色定义前', short: '↑Char' },
    { value: 1, label: '角色定义后', short: '↓Char' },
    { value: 2, label: '作者注释前', short: '↑AN' },
    { value: 3, label: '作者注释后', short: '↓AN' },
    { value: 5, label: '示例消息前', short: '↑EM' },
    { value: 6, label: '示例消息后', short: '↓EM' },
    { value: 4, label: '@D 深度', short: '@D' },
];
export const ROLES = [
    { value: 0, label: '系统' },
    { value: 1, label: '用户' },
    { value: 2, label: 'AI' },
];

export const DEFAULT_PARAMS = {
    setting: { position: 0, depth: 4, role: 0, order: 80, enabled: true },
    detail: { position: 0, depth: 4, role: 0, order: 100, enabled: true },
};

// v0.1.11 及以前新建项目时写进项目文件的默认值；读到原样未改的就换成现在的默认。
export const OLD_DEFAULT_PARAMS = {
    setting: { position: 1, depth: 4, role: 0, order: 80 },
    detail: { position: 4, depth: 4, role: 0, order: 100 },
};

export function positionLabel(entry) {
    const pos = POSITIONS.find(item => item.value === Number(entry.position));
    if (!pos) return '?';
    if (pos.value !== 4) return pos.short;
    const role = ROLES.find(item => item.value === Number(entry.role));
    return `@D${Number(entry.depth) || 0}${role && role.value ? `·${role.label}` : ''}`;
}

// 位置、深度、角色、顺序只认项目默认：每段都一样，切到下一段不用再改。单段只记是否启用。
function pickParams(base, slot) {
    const out = { ...base };
    for (const key of ['enabled']) {
        if (slot && slot[key] !== undefined && slot[key] !== null && slot[key] !== '') out[key] = slot[key];
    }
    out.position = Number(out.position);
    out.depth = Math.max(0, Number(out.depth) || 0);
    out.role = Number(out.role) || 0;
    out.order = Number(out.order) || 0;
    out.enabled = out.enabled !== false;
    return out;
}

function stagePlace(unit) {
    return `${volumeLabel(unit.volume.key)}·${stageLabel(unit.stage.key)}`;
}

function nodeNames(unit, off) {
    const hidden = new Set(off);
    return stageNodes(unit.stage.data).filter(node => node.kind === 'main' && !hidden.has(node.id)).map(node => node.name);
}

function rangeOf(unit) {
    const value = unit.stage.data && unit.stage.data.时间范围;
    return value ? String(value).trim() : '';
}

// 剧情索引：插件内部用，只给进度检测模型看，不注入正文。
// 不占正文 token，所以写全：已过各段的主线节点、当前段节点完成情况、下一段的时间范围/AI指令/主线节点、其后各段名称。
const LATER_LIMIT = 6;

function nodeLine(node, mark) {
    const event = node.item && node.item.事件 ? `：${String(node.item.事件).replace(/\s+/g, ' ').slice(0, 120)}` : '';
    return `  - ${mark ? `[${mark}] ` : ''}${node.label}｜${node.name}${event}`;
}

export function buildIndexText(units, states, progress, { carryOver = true } = {}) {
    const lines = [];
    const done = units.filter(unit => states[unit.id] === 'done');
    const active = units.filter(unit => states[unit.id] === 'active');
    const next = units.filter(unit => states[unit.id] === 'next');
    const later = units.filter(unit => states[unit.id] === 'todo');
    if (done.length) {
        lines.push('【已过】');
        for (const unit of done) {
            const names = stageNodes(unit.stage.data).filter(node => node.kind === 'main').map(node => node.name);
            lines.push(`- ${stagePlace(unit)}${names.length ? `（${names.join('／')}）` : ''}`);
        }
    }
    for (const unit of active) {
        const off = new Set(offNodes(progress, unit.id));
        const range = rangeOf(unit);
        lines.push('【当前】', `- ${stagePlace(unit)}${range ? `｜时间范围：${range}` : ''}`);
        for (const node of stageNodes(unit.stage.data).filter(item => item.kind !== 'world')) lines.push(nodeLine(node, off.has(node.id) ? '已演' : '未演'));
        if (carryOver) for (const { node } of carriedNodes(units, states, progress)) if (node.kind !== 'world') lines.push(nodeLine(node, '未演·延续'));
    }
    for (const unit of next) {
        const range = rangeOf(unit);
        const instr = unit.stage.data && unit.stage.data.AI指令;
        lines.push('【下一段】', `- ${stagePlace(unit)}${range ? `｜时间范围：${range}` : ''}`);
        if (instr) lines.push(`  AI指令：${String(instr).trim()}`);
        for (const node of stageNodes(unit.stage.data).filter(item => item.kind === 'main')) lines.push(nodeLine(node, ''));
    }
    if (later.length) {
        lines.push('【之后】');
        for (const unit of later.slice(0, LATER_LIMIT)) lines.push(`- ${stagePlace(unit)}`);
        if (later.length > LATER_LIMIT) lines.push(`- ……另有 ${later.length - LATER_LIMIT} 段`);
    }
    return lines.join('\n');
}

// 推进速度：执行页选择，决定详细条目开头那段说明。三段默认文字可在设置里改。
export const PACES = [
    { value: 'slow', label: '慢速' },
    { value: 'normal', label: '正常' },
    { value: 'fast', label: '快速' },
];
const PLAN = '以下是当前正在进行、尚未演完的剧情规划，列出的事件还没有发生，不要当作已发生的事实或前情。';
export const PACE_TEXT = {
    slow: `${PLAN}节奏放慢：以眼前正在进行的场景和人物互动为主，细写当下，每次回复最多推进一小步，不急于触发下一个节点。`,
    normal: `${PLAN}按正文进展自然推进到这些事件，不必一次写完。`,
    fast: `${PLAN}节奏加快：尽快让尚未发生的节点依次发生，次要细节一笔带过，收束本阶段并过渡到下一阶段。`,
};

export function paceText(settings, pace) {
    const key = PACE_TEXT[pace] ? pace : 'normal';
    return String((settings.paceText && settings.paceText[key]) || '').trim() || PACE_TEXT[key];
}

// 延续：已过阶段里还勾着（没演）的支线事件与世界动态，带到当前阶段继续可用。返回 [{ unit, node }]
export function carriedNodes(units, states, progress) {
    const out = [];
    for (const unit of units) {
        if (states[unit.id] !== 'done') continue;
        const off = new Set(offNodes(progress, unit.id));
        for (const node of stageNodes(unit.stage.data)) if (node.kind !== 'main' && !off.has(node.id)) out.push({ unit, node });
    }
    return out;
}

function carriedText(carried) {
    if (!carried.length) return '';
    const lines = carried.map(({ unit, node }) => {
        const item = node.item && typeof node.item === 'object' ? node.item : {};
        const parts = [item.地点, item.事件 || item.内容, item.触发 ? `触发：${item.触发}` : ''].filter(Boolean).map(value => String(value).trim());
        return `- ${node.label}｜${node.name}（来自${splitStageKey(unit.stage.key).short}）${parts.length ? `：${parts.join('；')}` : ''}`;
    });
    return `\n延续自前面阶段、尚未发生的支线与世界动态（可在合适时机自然安排，不必强行发生）：\n${lines.join('\n')}`;
}

// next：下一阶段，快速时写在说明末尾，让正文知道往哪里收。
export function buildDetailText(unit, off, settings, { pace = 'normal', next = null, carried = [] } = {}) {
    const tag = String(settings.tagName || '剧情参考').trim() || '剧情参考';
    const data = filterStageData(unit.stage.data, off);
    const body = stringifyYaml({ [unit.stage.key]: data }).trimEnd();
    const vol = splitVolumeKey(unit.volume.key).short;
    let note = paceText(settings, pace);
    if (pace === 'fast' && next) {
        const range = rangeOf(next);
        note += `\n下一阶段：${stagePlace(next)}${range ? `（${range}）` : ''}`;
    }
    return `<${tag} 卷="${vol}" 阶段="${unit.stage.key}">\n${note}\n${body}${carriedText(carried)}\n</${tag}>`;
}

// 执行页与注入共用：返回本轮要注入的条目（含停用的，UI 需要显示），注入时只取 enabled。
export function buildEntries(project, progress, settings) {
    const defaults = { ...DEFAULT_PARAMS, ...(project && project.defaults) };
    const entries = [];
    if (!project) return entries;
    const settingText = String(project.setting && project.setting.text || '').trim();
    if (settingText) {
        entries.push({
            slotId: SETTING_SLOT, kind: 'setting', title: '设定',
            content: settingText, ...pickParams(defaults.setting, progress.slots[SETTING_SLOT]),
        });
    }
    const units = flattenUnits(project.outline && project.outline.volumes);
    if (units.length) {
        const states = unitStates(units, progress);
        const next = units.find(unit => states[unit.id] === 'next') || null;
        const carried = settings.carryOver === false ? [] : carriedNodes(units, states, progress);
        for (const unit of units) {
            if (states[unit.id] !== 'active') continue;
            const off = offNodes(progress, unit.id);
            entries.push({
                slotId: unit.id, kind: 'detail', title: `${volumeLabel(unit.volume.key)}·${splitStageKey(unit.stage.key).short}`,
                unit, content: buildDetailText(unit, off, settings, { pace: progress.pace, next, carried }), ...pickParams(defaults.detail, progress.slots[unit.id]),
            });
        }
    }
    return entries;
}

export function stageMainNames(unit, progress) {
    return nodeNames(unit, offNodes(progress, unit.id));
}

const VIRTUAL_BASE_UID = 990000;

// 世界书管线要求的完整字段；constant + ignoreBudget，不进定时效果、不参与关键词。
export function toWorldInfoEntry(entry, index, world) {
    return {
        uid: VIRTUAL_BASE_UID + index,
        world,
        key: [],
        keysecondary: [],
        comment: `剧情注入器·${entry.title}`,
        content: entry.content,
        constant: true,
        vectorized: false,
        selective: false,
        selectiveLogic: 0,
        addMemo: true,
        order: entry.order,
        position: entry.position,
        disable: false,
        ignoreBudget: true,
        excludeRecursion: true,
        preventRecursion: false,
        matchPersonaDescription: false,
        matchCharacterDescription: false,
        matchCharacterPersonality: false,
        matchCharacterDepthPrompt: false,
        matchScenario: false,
        matchCreatorNotes: false,
        delayUntilRecursion: 0,
        probability: 100,
        useProbability: false,
        depth: entry.depth,
        outletName: '',
        group: '',
        groupOverride: false,
        groupWeight: 100,
        scanDepth: null,
        caseSensitive: null,
        matchWholeWords: null,
        useGroupScoring: null,
        automationId: '',
        role: entry.role,
        sticky: null,
        cooldown: null,
        delay: null,
        triggers: [],
    };
}
