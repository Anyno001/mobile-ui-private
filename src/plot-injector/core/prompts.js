import { changeLines, flattenUnits, outlineToText, stageLabel, stageToText, volumeLabel, volumesFromValue } from './outline.js';
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
      - 名称: 酒馆密谈
        事件: 一位陌生人约主角深夜密谈。
        条件: 主角到过镇上的酒馆
        时限: 20
        错过: 陌生人离开了小镇，线索中断。
    世界动态:
      - 类型: 传闻
        来源: 谁传出
        内容: 外界正在发生什么。
      - 类型: 山匪逼近
        内容: 山匪袭击村庄。
        进度钟: 6
        前兆: 邻村有人被抢，夜里山上能看到火光。
        后果: 村庄被洗劫，村民对官府失去信任。
    状态变化:
      - 本阶段结束时谁知道了什么、谁对谁的看法或关系变了。
`;

const FOLD_KEEP = 16;
const FOLD_CHARS = 24000;

// persona：用户在讨论页填的说话人格，只决定怎么说话，任务和回复结构不变。
export function discussSystemPrompt({ guide, refs, persona = '' }) {
    const parts = [
        '你在帮用户构思一条同人 if 线：一起把世界观、人物处境、信息差和大纲方向想清楚。',
        '每次回复先回应用户的想法，再指出缺口或矛盾，最后给出两三个可选方向。不写小说正文。',
    ];
    if (persona.trim()) parts.push(`【说话人格】
${persona.trim()}`);
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
    '顶层键是卷名，写作「剧情_卷X_标题」；卷下是阶段，写作「阶段N_标题」；阶段字段为 时间范围、AI指令、主线节点、支线事件、世界动态、状态变化。',
    '节点字段：名称、地点、事件、偏转；支线事件多一个 触发；世界动态为 类型、来源、内容。',
    '以下几个键可选，只在需要时写：支线事件可写 条件（出现条件满足后才安排）、时限（激活后的楼数，或写「本卷」）、错过（过期没接时的后果）、步骤（列表，分几步推进的支线）；世界动态可写 进度钟（总格数，常用 4、6、8，越大来得越慢）、前兆（过半时透露的风声）、后果（发生后世界的变化）。',
    '每个阶段 2 到 4 个主线节点，事件写已经发生的事实，偏转写玩家改变选择后的调整。',
    '时间范围写清本阶段从什么时候到什么时候，用来判断何时切到下一段。',
    '设定里的人物关系、认知和信息差是开局状态，会随剧情改变。状态变化逐条写本阶段结束时比之前变了什么，没有变化就省略。',
].join('\n');

// 各阶段的状态变化按顺序列出，写后续大纲时接着这些变化往下写。
function changesBlock(units, title) {
    const lines = units.flatMap(unit => changeLines(unit.stage.data).map(text => `- ${stageLabel(unit.stage.key)}：${text}`));
    return lines.length ? `【${title}】\n${lines.join('\n')}` : '';
}

function restText(units, from) {
    const byVolume = new Map();
    for (const unit of units.slice(from)) {
        if (!byVolume.has(unit.volume)) byVolume.set(unit.volume, []);
        byVolume.get(unit.volume).push(unit.stage);
    }
    return outlineToText([...byVolume.entries()].map(([volume, stages]) => ({ ...volume, stages })));
}

export function outlineMessages({ setting, talk, volumes, volumeNo, request, refs = [] }) {
    const known = (volumes || []).map(volume => `${volumeLabel(volume.key)}：${volume.stages.map(stage => stageLabel(stage.key)).join('、')}`);
    const system = `你按用户的设定写剧情大纲，格式必须与样例一致。\n${OUTLINE_RULES}\n\n【格式样例】\n${formatSample(volumes)}`;
    const user = [
        setting ? `【设定】\n${setting}` : '',
        talk ? `【讨论摘要】\n${talk}` : '',
        refBlock(refs),
        known.length ? `【已有的卷】\n${known.join('\n')}` : '',
        changesBlock(flattenUnits(volumes), '已有大纲中的状态变化'),
        `只写第 ${volumeNo} 卷。${request || ''}`,
    ].filter(Boolean).join('\n\n');
    return [{ role: 'system', content: system }, { role: 'user', content: user }];
}

export function rewriteRestMessages({ setting, volumes, fromUnitIndex, units, recent, reason }) {
    const system = `剧情在执行中偏离了大纲。按已经发生的正文改写剩余阶段，保持卷名与阶段名格式。\n${OUTLINE_RULES}\n\n【格式样例】\n${formatSample(volumes)}`;
    const user = [
        setting ? `【设定】\n${setting}` : '',
        changesBlock(units.slice(0, fromUnitIndex), '已演完阶段的状态变化'),
        `【需要改写的剩余阶段】\n${restText(units, fromUnitIndex)}`,
        reason ? `【偏转说明】\n${reason}` : '',
        `【最近正文】\n${recent}`,
    ].filter(Boolean).join('\n\n');
    return [{ role: 'system', content: system }, { role: 'user', content: user }];
}

// 大纲调整后按大纲校对设定：只改与大纲冲突、或把会变的关系与认知写死的句子。
export function syncSettingMessages({ guide, setting, units, fromUnitIndex = 0, reason = '' }) {
    const system = [
        guide,
        '剧情大纲已经调整。对照【剧情大纲】校对【已有世界观正文】：找出与大纲冲突的句子，以及把人物关系、认知、信息差、人物走向写成永远不变的句子，只改这些句子，改写成开局状态或留白；同一件事在几个分块里重复出现时，只留在最合适的一处；其余文字逐字保留，分块标题不变。',
        '只回「世界观正文」「速查」两段。世界观正文输出改好后的完整全文；没有需要改的句子时原样输出。',
    ].join('\n\n');
    const user = [
        `【已有世界观正文】\n${setting}`,
        changesBlock(units.slice(0, fromUnitIndex), '已演完阶段的状态变化'),
        `【剧情大纲】\n${restText(units, fromUnitIndex)}`,
        reason ? `【调整原因】\n${reason}` : '',
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
// all：一次回了多卷、每卷一个 yaml 代码块时，把所有块接起来（卷名不同，顶层键不会冲突）；只给多卷相关的入口用，其余只取第一个块。
export function extractYaml(text, { all = false } = {}) {
    const raw = String(text || '');
    if (all) {
        const blocks = [...raw.matchAll(/```ya?ml\s*\n([\s\S]*?)```/gi)].map(match => match[1].trim()).filter(Boolean);
        if (blocks.length) return blocks.join('\n\n');
    }
    const fenced = /```ya?ml\s*\n([\s\S]*?)```/i.exec(raw) || /```\s*\n([\s\S]*?)```/.exec(raw);
    return (fenced ? fenced[1] : raw).trim();
}

export function hasYamlBlock(text) {
    return /```ya?ml\s*\n[\s\S]*?```/i.test(String(text || ''));
}

export function parseOutlineReply(text, idOf, { all = false } = {}) {
    const yaml = extractYaml(text, { all });
    try {
        return { ok: true, yaml, volumes: volumesFromValue(parseYaml(yaml), idOf) };
    } catch (error) {
        const line = yamlErrorLine(error);
        return { ok: false, yaml, line, error: `${line ? `第 ${line} 行：` : ''}${String(error.message || error).split('\n')[0]}` };
    }
}

// outline v0.1.23：单阶段 AI 操作（细化节点 / 拆成两段 / 与下一段合并）。
const STAGE_OPS = {
    refine: '细化节点：保持阶段名不变，把现有节点写得更具体（事件写清谁做了什么、结果如何，偏转写清分支），必要时补充缺少的节点，不改变阶段的整体走向与时间范围。只输出这一个阶段。',
    split: '拆成两段：把这个阶段按剧情先后拆成两个阶段，阶段名沿用「阶段N_标题」格式，两段的时间范围首尾相接且不重叠，节点、支线事件、世界动态按发生时间分到两段，状态变化归入对应的段。输出两个阶段。',
    merge: '与下一段合并：把「当前阶段」和「下一阶段」合成一个阶段，阶段名取能概括两段的标题，时间范围覆盖两段，节点、支线事件、世界动态按时间顺序合并并去掉重复，状态变化全部保留。输出一个阶段。',
};

export function stageOpMessages({ setting, talk = '', refs = [], volumes, unit, next, op, request }) {
    const rule = STAGE_OPS[op];
    if (!rule) throw new Error('不支持的阶段操作');
    const system = [
        '你在调整剧情大纲中的单个阶段，格式必须与样例一致。',
        OUTLINE_RULES,
        '阶段里的字段（时间范围、AI指令、主线节点、支线事件、世界动态、状态变化，以及其他任何键）原样保留或合理改写，不要丢键。',
        `顶层键只写所属卷名「${unit.volume.key}」，卷下只放结果阶段。`,
        rule,
        `【格式样例】\n${formatSample(volumes)}`,
    ].join('\n');
    const units = flattenUnits(volumes);
    const before = units.slice(0, units.findIndex(item => item.id === unit.id));
    const user = [
        setting ? `【设定】\n${setting}` : '',
        talk ? `【讨论摘要】\n${talk}` : '',
        refBlock(refs),
        changesBlock(before, '此前阶段的状态变化'),
        `【当前阶段】\n${volumeStageText(unit.volume, unit.stage)}`,
        next ? `【下一阶段】\n${volumeStageText(unit.volume, next)}` : '',
        request ? `【额外要求】\n${request}` : '',
    ].filter(Boolean).join('\n\n');
    return [{ role: 'system', content: system }, { role: 'user', content: user }];
}

function volumeStageText(volume, stage) {
    return outlineToText([{ ...volume, stages: [stage] }]);
}
