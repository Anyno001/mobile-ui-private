import { outlineToText, stageLabel, stageToText, volumeLabel, volumesFromValue } from './outline.js';
import { parseYaml, yamlErrorLine } from './yaml.js';

export const SAMPLE_STAGE = `剧情_卷一_示例:
  阶段一_开端:
    时间范围: 故事开始至主角离开故乡
    AI指令: 推进主角得知变故并决定出发的事件。
    主线节点:
      - 名称: 主角得知变故
        地点: 故乡
        事件: 用一到三句话写清谁做了什么、结果如何。
        偏转: 若主角做出不同选择，后续如何调整。
    支线事件:
      - 名称: 旧友送行
        地点: 村口
        事件: 一句话事件。
        触发: 出现这种情况时发生。
    世界动态:
      - 类型: 传闻
        来源: 谁传出
        内容: 外界正在发生什么。
`;

const FOLD_KEEP = 16;
const FOLD_CHARS = 24000;

export function discussSystemPrompt({ guide, refs }) {
    const parts = [
        '你在帮用户构思一条同人 if 线：一起把世界观、人物处境、信息差和大纲方向想清楚。',
        '每次回复先回应用户的想法，再指出缺口或矛盾，最后给出两三个可选方向。不写小说正文。',
    ];
    if (refs.length) parts.push(...refs.map(ref => `【参考·${ref.title}】\n${ref.text}`));
    if (guide) parts.push(`【写作基准：同人世界观速成】\n${guide}`);
    return parts.join('\n\n');
}

export function needsFold(messages) {
    const live = messages.filter(msg => !msg.folded);
    const chars = live.reduce((sum, msg) => sum + String(msg.content || '').length, 0);
    return live.length > FOLD_KEEP + 4 || chars > FOLD_CHARS;
}

export function foldCandidates(messages) {
    const live = messages.filter(msg => !msg.folded);
    return live.slice(0, Math.max(0, live.length - FOLD_KEEP));
}

export function foldMessages(summary, messages) {
    const text = messages.map(msg => `${msg.role === 'user' ? '用户' : 'AI'}：${msg.content}`).join('\n\n');
    return [
        { role: 'system', content: '把下面的讨论压缩成要点摘要：保留已经敲定的设定、人物关系、剧情走向和仍未决定的问题，删掉寒暄和被否掉的方案。只输出摘要。' },
        { role: 'user', content: `${summary ? `【已有摘要】\n${summary}\n\n` : ''}【新的讨论】\n${text}` },
    ];
}

export function chatRequest(system, summary, messages) {
    const out = [{ role: 'system', content: system }];
    if (summary) out.push({ role: 'system', content: `【之前讨论的摘要】\n${summary}` });
    for (const msg of messages.filter(item => !item.folded)) out.push({ role: msg.role === 'user' ? 'user' : 'assistant', content: msg.content });
    return out;
}

export function transcript(summary, messages, limit = 30000) {
    const text = messages.filter(msg => !msg.folded).map(msg => `${msg.role === 'user' ? '用户' : 'AI'}：${msg.content}`).join('\n\n');
    const joined = `${summary ? `【摘要】\n${summary}\n\n` : ''}${text}`;
    return joined.length > limit ? joined.slice(-limit) : joined;
}

const refBlock = refs => (refs && refs.length ? `【世界书参考】\n${refs.map(ref => `〔${ref.title}〕\n${ref.text}`).join('\n\n')}` : '');

export function settingMessages({ guide, talk, current, append, refs = [] }) {
    const system = `${guide}\n\n按上面的规则产出，只回「世界观正文」「补定」「速查」三段。`;
    const user = [
        current ? `【已有世界观正文】\n${current}` : '',
        append ? '已有正文不改动，只把新增事实写成一段 [追加]。' : '',
        talk ? `【讨论记录】\n${talk}` : '',
        refBlock(refs),
    ].filter(Boolean).join('\n\n');
    return [{ role: 'system', content: system }, { role: 'user', content: user }];
}

export function rewriteBlockMessages({ guide, current, blockText, fixes }) {
    return [
        { role: 'system', content: `${guide}\n\n只重写用户指定的一个分块，保留分块标题行，只输出这个分块。` },
        { role: 'user', content: `【完整正文】\n${current}\n\n【要重写的分块】\n${blockText}\n\n【用户的修改】\n${fixes}` },
    ];
}

function formatSample(volumes) {
    for (const volume of volumes || []) {
        const stage = volume.stages[0];
        if (stage) return `${volume.key}:\n${stageToText(stage).replace(/^/gm, '  ').trimEnd()}\n`;
    }
    return SAMPLE_STAGE;
}

const OUTLINE_RULES = [
    '只输出一个 ```yaml 代码块，不加说明。',
    '顶层键是卷名，写作「剧情_卷X_标题」；卷下是阶段，写作「阶段N_标题」；阶段字段为 时间范围、AI指令、主线节点、支线事件、世界动态。',
    '节点字段：名称、地点、事件、偏转；支线事件多一个 触发；世界动态为 类型、来源、内容。',
    '每个阶段 2 到 4 个主线节点，事件写已经发生的事实，偏转写玩家改变选择后的调整。',
    '时间范围写清本阶段从什么时候到什么时候，用来判断何时切到下一段。',
].join('\n');

export function outlineMessages({ setting, talk, volumes, volumeNo, request, refs = [] }) {
    const known = (volumes || []).map(volume => `${volumeLabel(volume.key)}：${volume.stages.map(stage => stageLabel(stage.key)).join('、')}`);
    const system = `你按用户的设定写剧情大纲，格式必须与样例一致。\n${OUTLINE_RULES}\n\n【格式样例】\n${formatSample(volumes)}`;
    const user = [
        setting ? `【设定】\n${setting}` : '',
        talk ? `【讨论摘要】\n${talk}` : '',
        refBlock(refs),
        known.length ? `【已有的卷】\n${known.join('\n')}` : '',
        `只写第 ${volumeNo} 卷。${request || ''}`,
    ].filter(Boolean).join('\n\n');
    return [{ role: 'system', content: system }, { role: 'user', content: user }];
}

export function rewriteRestMessages({ setting, volumes, fromUnitIndex, units, recent, reason }) {
    const rest = units.slice(fromUnitIndex);
    const byVolume = new Map();
    for (const unit of rest) {
        if (!byVolume.has(unit.volume)) byVolume.set(unit.volume, []);
        byVolume.get(unit.volume).push(unit.stage);
    }
    const restText = outlineToText([...byVolume.entries()].map(([volume, stages]) => ({ ...volume, stages })));
    const system = `剧情在执行中偏离了大纲。按已经发生的正文改写剩余阶段，保持卷名与阶段名格式。\n${OUTLINE_RULES}\n\n【格式样例】\n${formatSample(volumes)}`;
    const user = [
        setting ? `【设定】\n${setting}` : '',
        `【需要改写的剩余阶段】\n${restText}`,
        reason ? `【偏转说明】\n${reason}` : '',
        `【最近正文】\n${recent}`,
    ].filter(Boolean).join('\n\n');
    return [{ role: 'system', content: system }, { role: 'user', content: user }];
}

export function fixYamlMessages(text, error) {
    return [
        { role: 'system', content: `修正下面 YAML 的格式错误，内容不变。\n${OUTLINE_RULES}` },
        { role: 'user', content: `【错误】${error}\n\n${text}` },
    ];
}

// 从回复里取 YAML：优先 ```yaml 代码块，其次任意代码块，最后整篇。
export function extractYaml(text) {
    const raw = String(text || '');
    const fenced = /```ya?ml\s*\n([\s\S]*?)```/i.exec(raw) || /```\s*\n([\s\S]*?)```/.exec(raw);
    return (fenced ? fenced[1] : raw).trim();
}

export function hasYamlBlock(text) {
    return /```ya?ml\s*\n[\s\S]*?```/i.test(String(text || ''));
}

export function parseOutlineReply(text, idOf) {
    const yaml = extractYaml(text);
    try {
        return { ok: true, yaml, volumes: volumesFromValue(parseYaml(yaml), idOf) };
    } catch (error) {
        const line = yamlErrorLine(error);
        return { ok: false, yaml, line, error: `${line ? `第 ${line} 行：` : ''}${String(error.message || error).split('\n')[0]}` };
    }
}
