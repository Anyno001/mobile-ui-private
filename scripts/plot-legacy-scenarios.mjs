// 旧大纲（不带进度钟、钩子等新键）与旧进度在剧情注入器核心上的输出：注入条目、剧情索引、状态变化、检测提示。
// 思路照 PlotInjector tests/fixtures/legacy-scenarios.js；check-plot-core.mjs 用它比对 plot-legacy-snapshot.json，
// 快照在 v0.1.20 核心上生成（YAML 用 JSON 代替，与 check-plot-host 一致），新核心必须逐字一致。
import { pathToFileURL } from 'node:url';
import path from 'node:path';

export const LEGACY_OUTLINE = {
    剧情_卷一_测试: {
        阶段一_开端: {
            时间范围: '开始时',
            AI指令: '推进开端。',
            主线节点: [{ 名称: '甲事件', 地点: '甲地', 事件: '甲发生。', 偏转: '若不发生则改。' }, '乙事件'],
            支线事件: [{ 名称: '丙支线', 地点: '村口', 事件: '丙发生。', 触发: '有人提起时。' }, '字符串支线'],
            世界动态: [{ 类型: '丁传闻', 来源: '商人', 内容: '丁流传。' }],
            状态变化: ['她察觉到甲。'],
        },
        阶段二_发展: {
            时间范围: '开端之后',
            AI指令: '推进发展。',
            主线节点: [{ 名称: '戊事件', 事件: '戊发生。' }],
            支线事件: [{ 名称: '己支线', 事件: '己发生。' }],
            世界动态: [{ 类型: '庚动态', 内容: '庚在变化。' }],
        },
    },
    剧情_卷二_续: {
        阶段一_转折: { 时间范围: '发展之后', 主线节点: [{ 名称: '辛事件', 事件: '辛发生。' }] },
    },
};

// 旧版存下的项目文件与聊天进度（没有 outline.history/renames/idAlias、threads、offNames、lastFailFloor 等新字段）。
export function legacyFiles(volumes) {
    return {
        project: { id: 'p1', name: '快照', createdAt: 1, setting: { text: '铁则:\n- 甲', history: [], check: '', fixes: [], mute: [] }, outline: { volumes }, defaults: {}, genRefs: {}, mode: 'normal' },
        progress: { projectId: 'p1', current: volumes[0].stages[1].id, slots: { [volumes[0].stages[0].id]: { off: ['m0', 's1'] } }, muted: [], offMuted: [], lastCheckFloor: 4, pace: 'normal' },
    };
}

export async function legacyOutputs(coreDir) {
    const load = name => import(pathToFileURL(path.join(coreDir, name)).href);
    const { setYamlLib } = await load('yaml.js');
    setYamlLib({ parse: text => JSON.parse(text), stringify: value => JSON.stringify(value, null, 2) });
    const { flattenUnits, volumesFromValue } = await load('outline.js');
    const { advance, emptyProgress, normalizeProgress, setNodeChecked, unitStates } = await load('progress.js');
    const { buildEntries, buildIndexText, changesText } = await load('inject.js');
    const { buildCheckMessages } = await load('check.js');
    const { newProject, normalizeProject, normalizeSettings } = await load('store.js');

    let seq = 0;
    const project = newProject('快照');
    project.id = 'p1';
    project.outline.volumes = volumesFromValue(LEGACY_OUTLINE, prefix => `${prefix}${++seq}`);
    project.setting.text = '铁则:\n- 甲';
    const units = flattenUnits(project.outline.volumes);

    const outputs = (target, progress, settings) => {
        const list = flattenUnits(target.outline.volumes);
        const states = unitStates(list, progress);
        const index = buildIndexText(list, states, progress, { carryOver: settings.carryOver });
        const active = list.find(unit => states[unit.id] === 'active');
        return {
            entries: buildEntries(target, progress, settings).map(entry => `${entry.slotId}|${entry.title}|${entry.content}`),
            index,
            indexNoCarry: buildIndexText(list, states, progress, { carryOver: false }),
            changes: changesText(list, states),
            check: active ? buildCheckMessages(active, index, [{ index: 5, text: '正文' }]).map(msg => msg.content) : [],
        };
    };

    const base = emptyProgress(project.id);
    const one = advance(base, units).progress;
    const progresses = {
        fresh: base,
        offs: setNodeChecked(setNodeChecked(base, units[0].id, 'm0', false), units[0].id, 's1', false),
        one,
        oneOff: setNodeChecked(one, units[0].id, 's0', false),
        two: advance(one, units).progress,
        fast: { ...base, pace: 'fast' },
    };
    const out = {};
    for (const [key, progress] of Object.entries(progresses)) {
        out[key] = outputs(project, progress, normalizeSettings({}));
        out[`${key}/noCarry`] = outputs(project, progress, normalizeSettings({ carryOver: false }));
    }
    // 旧文件原样读入：规范化后再出注入内容。
    const files = legacyFiles(project.outline.volumes);
    out.legacyFiles = outputs(normalizeProject(files.project, 'p1'), normalizeProgress(files.progress, 'p1'), normalizeSettings({}));
    return out;
}
