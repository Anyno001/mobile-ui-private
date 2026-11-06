import { NO_LINKS, placeStageMap, realignStage } from './align.js';
import { splitStageKey, stageNodes } from './outline.js';
import { offNodes, setNodeChecked } from './progress.js';

// 支线钩子与世界进度钟。节点仍写在 支线事件 / 世界动态 里，下面这些键都可选，没写就按旧行为。
// 世界动态：进度钟（总格数）、前兆（过半时的风声）、后果（发生后接进状态变化）。
// 支线事件：条件（进钩子池，条件满足才激活）、时限（楼数或「本卷」）、错过（过期后的后果）、步骤（支线链）。
// 进度存在 progress.threads = { clocks: { [阶段id:节点id]: { name, filled, done, lastTickFloor } }, hooks: { [key]: { name, at, since, shownAt, step, expired, keepVol } }, ignored: [名称] }。
// 键里的节点 id 按位置编号；name 记写入时的节点名，节点挪动后位置对不上时按名称在同阶段同字段里找回（规则见 core/align.js placeRecords）。
// 名称对不上又占着节点位置的记录挂到 阶段id:前缀~序号，不算任何节点的进度，之后名称对上了再归位。
// at：条件钩子激活的楼数；since：没写条件的钩子开始计时的楼数；shownAt：第一次进入注入名额的楼数；keepVol：「本卷」钩子恢复时所在的卷。

const isObj = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const str = value => String(value ?? '').trim();
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const int = value => (Number.isFinite(Number(value)) ? Math.round(Number(value)) : 0);

export const CLOCK_MAX_TICK = 2;
export const DEFAULT_HOOK_CAP = 2;

export function clockSize(item) {
    if (!isObj(item)) return 0;
    const size = int(item.进度钟);
    return size >= 2 ? Math.min(12, size) : 0;
}

export function hookCondition(item) {
    return isObj(item) ? str(item.条件) : '';
}

export function hookSteps(item) {
    if (!isObj(item)) return [];
    const value = item.步骤;
    const list = Array.isArray(value) ? value : String(value ?? '').split('\n');
    return list
        .map(entry => (isObj(entry) ? Object.values(entry).join('：') : String(entry ?? '')))
        .map(text => text.replace(/^\s*(?:[-*•]|\d+[.、])\s*/, '').trim())
        .filter(Boolean);
}

// 时限：数字为楼数，「本卷」为卷结束时过期；其他写法不认。
export function hookLimit(item) {
    if (!isObj(item)) return null;
    const value = str(item.时限);
    if (!value) return null;
    if (/^\d+$/.test(value) && Number(value) > 0) return { floors: Number(value) };
    if (value === '本卷') return { volume: true };
    return null;
}

// 带新键的节点由本模块单独注入，不再原样留在阶段 YAML 里。
export function isThreadNode(node) {
    if (!node) return false;
    if (node.kind === 'world') return clockSize(node.item) > 0;
    if (node.kind === 'side') return Boolean(hookCondition(node.item) || hookSteps(node.item).length || hookLimit(node.item));
    return false;
}

export const threadKey = (unit, node) => `${unit.id}:${node.id}`;

// 支线、世界动态按项目开关。关闭时注入、索引、检测都看不到这一类节点；大纲和进度原样保留，重新打开接着用。
export function threadSwitches(project) {
    const raw = project && isObj(project.threads) ? project.threads : {};
    return { sideOn: raw.sideOn !== false, worldOn: raw.worldOn !== false };
}

// 两个都开时原样返回同一个数组，旧行为不变。
export function maskUnits(units, sw) {
    if (!sw || (sw.sideOn && sw.worldOn)) return units;
    const drop = [...(sw.sideOn ? [] : ['支线事件']), ...(sw.worldOn ? [] : ['世界动态'])];
    return (units || []).map(unit => {
        const data = { ...unit.stage.data };
        for (const field of drop) delete data[field];
        return { ...unit, stage: { ...unit.stage, data } };
    });
}

export function threadState(progress) {
    const raw = progress && isObj(progress.threads) ? progress.threads : {};
    return {
        clocks: isObj(raw.clocks) ? raw.clocks : {},
        hooks: isObj(raw.hooks) ? raw.hooks : {},
        ignored: Array.isArray(raw.ignored) ? raw.ignored : [],
    };
}

function withState(progress, patch) {
    return { ...progress, threads: { ...threadState(progress), ...patch } };
}

function patchMap(progress, field, key, patch) {
    const map = threadState(progress)[field];
    if (patch === null) {
        const { [key]: _drop, ...rest } = map;
        return withState(progress, { [field]: rest });
    }
    const next = { ...(map[key] || {}), ...patch };
    for (const name of Object.keys(next)) if (next[name] === undefined) delete next[name];
    return withState(progress, { [field]: { ...map, [key]: next } });
}

// patch 为 null 时删掉这一项（重置）。
export const patchClock = (progress, key, patch) => patchMap(progress, 'clocks', key, patch);
export const patchHook = (progress, key, patch) => patchMap(progress, 'hooks', key, patch);

const mapOf = node => (node.kind === 'world' ? 'clocks' : 'hooks');
const unitOfKey = key => key.slice(0, key.indexOf(':'));
const nodeOfKey = key => key.slice(key.indexOf(':') + 1);

const kindNodes = (unit, field) => stageNodes(unit.stage && unit.stage.data).filter(node => node.kind === (field === 'clocks' ? 'world' : 'side'));

// 按 liveThreads 给出的条目写进度：先把这一阶段的记录整体按名称归位（别的节点的记录占着目标键时搬回它按名称应在的位置，
// 对不上的挂起），再以解析到的记录为底写回当前键并记上节点名。patch 为 null 时重置。
export function patchLive(progress, item, patch) {
    const field = mapOf(item.node);
    const state = threadState(progress)[field];
    const map = item.unit.stage ? realignStage(state, item.unit.id, kindNodes(item.unit, field), item.links || NO_LINKS) : { ...state };
    const next = patch === null ? { name: item.node.name } : { ...item.saved, ...patch, name: item.node.name };
    for (const name of Object.keys(next)) if (next[name] === undefined) delete next[name];
    map[item.key] = next;
    return withState(progress, { [field]: map });
}

// 节点在同一字段里上移、下移、删除后，按新位置重排这一阶段的 slots.off 与钟、钩子的键。
// mapIndex(旧序号) 返回新序号，返回 null 表示这一项已删除。
export function remapNodes(progress, unitId, prefix, mapIndex) {
    const pattern = new RegExp(`^${prefix}(\\d+)$`);
    const move = id => {
        const match = pattern.exec(id);
        if (!match) return id;
        const to = mapIndex(Number(match[1]));
        return to === null || to === undefined ? null : `${prefix}${to}`;
    };
    let next = progress;
    const slot = progress.slots && progress.slots[unitId];
    if (slot && Array.isArray(slot.off)) {
        const moved = { ...slot, off: slot.off.map(move).filter(Boolean) };
        if (slot.offNames && typeof slot.offNames === 'object') {
            moved.offNames = {};
            for (const [id, name] of Object.entries(slot.offNames)) {
                const to = move(id);
                if (to) moved.offNames[to] = name;
            }
        }
        next = { ...next, slots: { ...next.slots, [unitId]: moved } };
    }
    if (!progress.threads) return next;
    const state = threadState(next);
    const remap = map => {
        const out = {};
        for (const [key, value] of Object.entries(map)) {
            if (unitOfKey(key) !== unitId) {
                out[key] = value;
                continue;
            }
            const id = move(nodeOfKey(key));
            if (id) out[`${unitId}:${id}`] = value;
        }
        return out;
    };
    return withState(next, { clocks: remap(state.clocks), hooks: remap(state.hooks) });
}

// 编辑器里改了节点名、当前聊天恢复历史后：同一位置上的记录（钟、钩子、已演标记）跟着改名，免得之后按名称对不上。
export function renameNode(progress, unit, node) {
    let next = progress;
    const slot = progress.slots && progress.slots[unit.id];
    const offName = slot && slot.offNames && slot.offNames[node.id];
    if (offName && offName !== node.name) next = { ...next, slots: { ...next.slots, [unit.id]: { ...slot, offNames: { ...slot.offNames, [node.id]: node.name } } } };
    if (node.kind === 'main') return next;
    const field = mapOf(node);
    const map = threadState(next)[field];
    const key = threadKey(unit, node);
    if (!map[key] || !map[key].name || map[key].name === node.name) return next;
    return withState(next, { [field]: { ...map, [key]: { ...map[key], name: node.name } } });
}

// 当前聊天恢复历史版本后按位置补一次改名：位置上的记录名在同阶段同字段里没有同名节点、也不是其他节点的曾用名时，改成这个位置的节点名。
export function renameByPosition(progress, units, links = NO_LINKS) {
    let next = progress;
    for (const unit of units || []) {
        const nodes = stageNodes(unit.stage.data);
        for (const node of nodes) {
            const siblings = nodes.filter(other => other.field === node.field);
            const known = name => siblings.some(other => other.name === name || (other !== node && links.family(unit.id, other.field, other.name).has(name)));
            const slot = next.slots && next.slots[unit.id];
            const offName = slot && slot.offNames && slot.offNames[node.id];
            const saved = node.kind === 'main' ? null : threadState(next)[mapOf(node)][threadKey(unit, node)];
            if ([offName, saved && saved.name].some(name => name && name !== node.name && !known(name))) next = renameNode(next, unit, node);
        }
    }
    return next;
}

// 单阶段细化、拆分、合并后：被替换阶段的钟、钩子、已取消勾选的节点按「字段+节点名」迁到新阶段的同名节点，找不到的删掉。
// oldStages、newStages 为替换前后的阶段（新阶段已带最终 id，沿用的 id 可同时出现在两边）。current 指向被替换阶段时改到 keepId。
export function migrateStageThreads(progress, oldStages, newStages, keepId) {
    const oldIds = new Set(oldStages.map(stage => stage.id));
    const state = threadState(progress);
    const pool = [];
    for (const stage of oldStages) {
        const unit = { id: stage.id, stage };
        const off = new Set(offNodes(progress, unit));
        const nodes = stageNodes(stage.data);
        const placed = { clocks: placeStageMap(state.clocks, stage.id, nodes.filter(node => node.kind === 'world')), hooks: placeStageMap(state.hooks, stage.id, nodes.filter(node => node.kind === 'side')) };
        for (const node of nodes) {
            const field = mapOf(node);
            const hit = node.kind === 'main' ? null : placed[field].get(node.id);
            pool.push({ field: node.field, name: node.name, map: field, value: hit && Object.keys(hit.saved).length ? hit.saved : null, off: off.has(node.id), used: false });
        }
    }
    const strip = map => Object.fromEntries(Object.entries(map).filter(([key]) => !oldIds.has(unitOfKey(key))));
    const clocks = strip(state.clocks);
    const hooks = strip(state.hooks);
    const slots = { ...progress.slots };
    const kept = slots[keepId] ? { ...slots[keepId] } : null;
    for (const id of oldIds) delete slots[id];
    if (kept) {
        delete kept.off;
        delete kept.offNames;
        slots[keepId] = kept;
    }
    for (const stage of newStages) {
        const off = [];
        const offNames = {};
        for (const node of stageNodes(stage.data)) {
            const from = pool.find(item => !item.used && item.field === node.field && item.name === node.name);
            if (!from) continue;
            from.used = true;
            if (from.off) {
                off.push(node.id);
                offNames[node.id] = node.name;
            }
            if (from.value) (from.map === 'clocks' ? clocks : hooks)[`${stage.id}:${node.id}`] = { ...from.value, name: node.name };
        }
        if (off.length) slots[stage.id] = { ...(slots[stage.id] || {}), off, offNames };
    }
    const next = { ...progress, slots, current: oldIds.has(progress.current) ? keepId : progress.current };
    return progress.threads || Object.keys(clocks).length || Object.keys(hooks).length ? withState(next, { clocks, hooks }) : next;
}

// 删楼、swipe 回退后，记下的楼数不能比现有楼数大。没有要改的原样返回。
export function clampThreads(progress, floors) {
    let changed = false;
    const fix = (map, fields) => {
        const out = {};
        for (const [key, value] of Object.entries(map)) {
            let item = value;
            for (const field of fields) {
                const top = field === 'lastTickFloor' ? floors : Math.max(1, floors);
                if (item && Number(item[field]) > top) {
                    item = { ...item, [field]: top };
                    changed = true;
                }
            }
            out[key] = item;
        }
        return out;
    };
    const state = threadState(progress);
    const clocks = fix(state.clocks, ['lastTickFloor']);
    const hooks = fix(state.hooks, ['at', 'since', 'shownAt']);
    const slots = {};
    for (const [id, slot] of Object.entries(progress.slots || {})) {
        slots[id] = slot && Number(slot.since) > floors ? { ...slot, since: floors } : slot;
        if (slots[id] !== slot) changed = true;
    }
    if (!changed) return progress;
    return progress.threads ? withState({ ...progress, slots }, { clocks, hooks }) : { ...progress, slots };
}

export function ignoreThread(progress, name) {
    const { ignored } = threadState(progress);
    return ignored.includes(name) ? progress : withState(progress, { ignored: [...ignored, name] });
}

// 进度钟显示到哪一档：hidden 不足一半、omen 过半、near 剩一格、due 满格、done 已发生。
export function clockPhase(clock) {
    if (clock.done) return 'done';
    if (clock.filled >= clock.total) return 'due';
    if (clock.total - clock.filled === 1) return 'near';
    if (clock.filled * 2 >= clock.total) return 'omen';
    return 'hidden';
}

// 当前和已过阶段里的钟与钩子。钟随世界走，已过阶段没发生的照样有效，不看 carryOver；
// 钩子在 carryOver 关闭时只保留真正激活过的：条件钩子已激活，或已经走到后面的步骤、已过期。
// 钩子 status：done / expired / wait（待触发）/ active（注入）/ queue（激活但超出上限，排队）。
// label：给检测模型看的名称，钟或钩子重名时加来源后缀「名称（阶段二）」。
// links：大纲对照表（core/align.js outlineLinks），不传时只按当前名称找回。
export function liveThreads(units, states, progress, { carryOver = true, hookCap = DEFAULT_HOOK_CAP, links = NO_LINKS } = {}) {
    const { clocks: savedClocks, hooks: savedHooks } = threadState(progress);
    const active = (units || []).find(unit => states[unit.id] === 'active');
    const clocks = [];
    const hooks = [];
    for (const unit of units || []) {
        const state = states[unit.id];
        if (state !== 'done' && state !== 'active') continue;
        const off = new Set(offNodes(progress, unit, links));
        const carried = state === 'done';
        const nodes = stageNodes(unit.stage.data);
        const placed = { world: placeStageMap(savedClocks, unit.id, nodes.filter(node => node.kind === 'world'), links), side: placeStageMap(savedHooks, unit.id, nodes.filter(node => node.kind === 'side'), links) };
        const savedFor = node => placed[node.kind].get(node.id) || { saved: {}, savedKey: threadKey(unit, node) };
        for (const node of nodes) {
            if (!isThreadNode(node)) continue;
            const key = threadKey(unit, node);
            const item = node.item;
            if (node.kind === 'world') {
                const total = clockSize(item);
                const { saved, savedKey } = savedFor(node);
                const done = Boolean(saved.done);
                clocks.push({ key, savedKey, saved, links, unit, node, carried, total, filled: done ? total : clamp(int(saved.filled), 0, total), done, lastTick: int(saved.lastTickFloor), omen: str(item.前兆), after: str(item.后果), event: str(item.内容 || item.事件) });
                continue;
            }
            const { saved, savedKey } = savedFor(node);
            const steps = hookSteps(item);
            const step = clamp(int(saved.step), 0, steps.length);
            const pooled = Boolean(hookCondition(item));
            // 旧数据里没写条件的钩子也记了 at，当作计时起点读，不算激活。
            const at = pooled ? int(saved.at) : 0;
            const since = pooled ? 0 : int(saved.since) || int(saved.at);
            const started = (pooled && at > 0) || step > 0 || Boolean(saved.expired);
            if (carried && !carryOver && !started) continue;
            const status = off.has(node.id) ? 'done' : saved.expired ? 'expired' : pooled && !at ? 'wait' : 'active';
            const keepVol = Number.isFinite(Number(saved.keepVol)) && saved.keepVol !== null && saved.keepVol !== '' ? int(saved.keepVol) : -1;
            hooks.push({ key, savedKey, saved, links, unit, node, carried, status, pooled, at, since, shownAt: int(saved.shownAt), steps, step, keepVol, cond: hookCondition(item), limit: hookLimit(item), miss: str(item.错过) });
        }
    }
    const cap = Math.max(1, int(hookCap) || DEFAULT_HOOK_CAP);
    // 已进过注入名额的排前面（按进入先后），其余按激活先后；超出上限的排队。
    hooks.filter(hook => hook.status === 'active' && hook.pooled)
        .sort((a, b) => (a.shownAt ? 0 : 1) - (b.shownAt ? 0 : 1) || (a.shownAt && b.shownAt ? a.shownAt - b.shownAt : a.at - b.at))
        .forEach((hook, index) => { if (index >= cap) hook.status = 'queue'; });
    labelDuplicates(clocks);
    labelDuplicates(hooks);
    return { clocks, hooks, activeVol: active ? active.volIndex : -1, hookCap: cap };
}

function labelDuplicates(list) {
    const count = new Map();
    for (const item of list) count.set(item.node.name, (count.get(item.node.name) || 0) + 1);
    const used = new Set();
    for (const item of list) {
        let label = item.node.name;
        if (count.get(label) > 1) {
            const base = `${label}（${splitStageKey(item.unit.stage.key).short}）`;
            label = base;
            for (let n = 2; used.has(label); n += 1) label = `${base}${n}`;
        }
        used.add(label);
        item.label = label;
    }
}

const fromText = item => (item.carried ? `（来自${splitStageKey(item.unit.stage.key).short}）` : '');
// 索引里名称已带来源后缀时不再重复写「来自」。
const indexName = item => (item.label === item.node.name ? `${item.node.name}${fromText(item)}` : item.label);

function stepText(hook) {
    return hook.steps.length ? `第 ${Math.min(hook.step + 1, hook.steps.length)}/${hook.steps.length} 步` : '';
}

function hookLine(hook) {
    const item = isObj(hook.node.item) ? hook.node.item : {};
    const parts = hook.steps.length
        ? [item.地点, `${stepText(hook)}：${hook.steps[hook.step] || ''}`]
        : [item.地点, item.事件 || item.内容, item.触发 ? `触发：${item.触发}` : ''];
    const body = parts.map(str).filter(Boolean);
    return `- 支线｜${hook.node.name}${fromText(hook)}${body.length ? `：${body.join('；')}` : ''}`;
}

function clockLine(clock) {
    const phase = clockPhase(clock);
    const name = `- 世界动态｜${clock.node.name}`;
    if (phase === 'omen') return `${name}：已有风声，可在正文里略微透露。${clock.omen ? `风声：${clock.omen}` : ''}`;
    if (phase === 'near') return `${name}：迫在眉睫，很快就会发生。${clock.omen ? `征兆：${clock.omen}` : ''}`;
    return `${name}：本段必须发生。${clock.event}`;
}

// 接在详细条目末尾：激活的支线（不超过上限）与过半的进度钟。
export function threadsText(live) {
    const parts = [];
    const hooks = live.hooks.filter(hook => hook.status === 'active');
    if (hooks.length) parts.push(`\n可在合适时机自然安排的支线（不必强行发生；支线链只写当前一步）：\n${hooks.map(hookLine).join('\n')}`);
    const clocks = live.clocks.filter(clock => !['hidden', 'done'].includes(clockPhase(clock)));
    if (clocks.length) parts.push(`\n正在酝酿的世界事件（还没有发生，按各条标明的程度写进正文）：\n${clocks.map(clockLine).join('\n')}`);
    return parts.join('');
}

// 剧情索引里的钩子与钟，检测模型按这里判断。
export function threadIndexLines(live) {
    const lines = [];
    const marks = { wait: '待触发', active: '已激活', queue: '已激活·排队', expired: '已过期' };
    const hooks = live.hooks.filter(hook => hook.status !== 'done');
    if (hooks.length) {
        lines.push('【支线钩子】');
        for (const hook of hooks) {
            const chain = hook.steps.length && hook.status !== 'wait' && hook.status !== 'expired';
            const mark = chain ? `${stepText(hook)}${hook.status === 'queue' ? '·排队' : ''}` : marks[hook.status];
            const item = isObj(hook.node.item) ? hook.node.item : {};
            const detail = hook.status === 'wait' ? `条件：${hook.cond}` : chain ? hook.steps[hook.step] : str(item.事件 || item.内容);
            lines.push(`  - [${mark}] 支线｜${indexName(hook)}${detail ? `：${detail.replace(/\s+/g, ' ').slice(0, 120)}` : ''}`);
        }
    }
    const clocks = live.clocks.filter(clock => !clock.done);
    if (clocks.length) {
        lines.push('【世界进度钟】');
        for (const clock of clocks) {
            const name = clock.label === clock.node.name ? `${clock.node.name} ${clock.filled}/${clock.total}${fromText(clock)}` : `${clock.label} ${clock.filled}/${clock.total}`;
            lines.push(`  - ${name}${clock.event ? `：${clock.event.replace(/\s+/g, ' ').slice(0, 120)}` : ''}`);
        }
    }
    return lines;
}

// 已发生的钟的后果、过期支线的错过后果，接在状态变化后面。
export function threadChangeLines(live) {
    if (!live) return [];
    return [
        ...live.clocks.filter(clock => clock.done && clock.after).map(clock => `- ${clock.after}（世界动态「${clock.node.name}」）`),
        ...live.hooks.filter(hook => hook.status === 'expired' && hook.miss).map(hook => `- ${hook.miss}（错过支线「${hook.node.name}」）`),
    ];
}

// 检测提示要的附加信息。ignored：玩家已忽略的自开线名；readTo：上次检测时的楼数，之前的楼已经读过。
export function checkThreads(live, { newThreadMode = 'ask', ignored = [], readTo = 0 } = {}) {
    const newThread = newThreadMode !== 'off';
    return {
        clocks: live.clocks.filter(clock => !clock.done).map(clock => ({ name: clock.label || clock.node.name, filled: clock.filled, total: clock.total })),
        hooks: live.hooks.some(hook => hook.status !== 'done' && hook.status !== 'expired'),
        newThread,
        ignored: newThread ? (ignored || []).map(str).filter(Boolean).slice(-10) : [],
        readTo: int(readTo),
    };
}

// 合并检测结果：钟推进与发生、待触发钩子激活、支线链推进、计时与过期、排队的钩子补进名额。返回新进度和事件列表（写日志、弹提示用）。
// done 里的钩子名：普通钩子标为已演，支线链推进一步，走完最后一步才算已演。名称按 label 匹配（重名时带来源后缀）。
// floor 为本次检测时的楼数；钟在同一批楼（楼数没有增加）里不重复推进。
export function applyCheck(progress, live, result, { floor = 0 } = {}) {
    let next = progress;
    const events = [];
    const writes = new Map();
    const write = (item, patch) => writes.set(item, { ...(writes.get(item) || {}), ...patch });
    const label = item => item.label || item.node.name;
    const done = new Set((result.done || []).map(str));
    for (const tick of result.clocks || []) {
        const clock = live.clocks.find(item => !item.done && label(item) === tick.name);
        if (!clock || writes.has(clock)) continue;
        if (tick.happened) {
            write(clock, { filled: clock.total, done: true, lastTickFloor: floor || undefined });
            events.push({ type: 'clock-done', name: clock.node.name });
            continue;
        }
        if (floor > 0 && clock.lastTick >= floor) continue;
        const step = Math.min(CLOCK_MAX_TICK, int(tick.tick));
        if (!step) continue;
        const filled = clamp(clock.filled + step, 0, clock.total);
        if (filled === clock.filled) continue;
        write(clock, { filled, done: false, lastTickFloor: floor || undefined });
        events.push({ type: filled >= clock.total ? 'clock-due' : 'clock-tick', name: clock.node.name, filled, total: clock.total });
    }
    const triggered = new Set((result.hooks || []).map(str));
    // 本次已演完、已过期的钩子腾出注入名额。
    const freed = new Set();
    for (const hook of live.hooks) {
        if (hook.status === 'done') continue;
        const name = label(hook);
        let at = hook.at;
        let step = hook.step;
        let expired = hook.status === 'expired';
        let fresh = false;
        if (hook.pooled && !at && (triggered.has(name) || done.has(name))) {
            at = floor;
            fresh = true;
            write(hook, { at });
            events.push({ type: 'hook-on', name: hook.node.name });
        }
        // 没写条件的钩子：从所在阶段成为当前阶段时起算，没记过就从这次检测起算。
        let since = hook.since;
        if (!hook.pooled && !since) {
            const slot = next.slots && next.slots[hook.unit.id];
            since = int(slot && slot.since) || floor;
            if (since) write(hook, { since });
        }
        if (done.has(name)) {
            if (hook.steps.length && step + 1 < hook.steps.length) {
                step += 1;
                write(hook, { step, expired: undefined });
                events.push({ type: 'chain-step', name: hook.node.name, step, total: hook.steps.length });
                expired = false;
            } else {
                if (hook.steps.length) write(hook, { step: hook.steps.length });
                next = setNodeChecked(next, hook.unit.id, hook.node.id, false, hook.node.name);
                events.push({ type: 'hook-done', name: hook.node.name });
                freed.add(hook);
                continue;
            }
        }
        if (expired || step > 0 || !hook.limit) continue;
        // 条件钩子的时限从第一次进入注入名额算起，排队中、刚激活还没注入过的不过期。
        let start = since;
        if (hook.pooled) {
            if (fresh || hook.status !== 'active') continue;
            start = hook.shownAt || hook.at;
        }
        const over = start > 0 && (hook.limit.floors
            ? floor - start > hook.limit.floors
            : live.activeVol >= 0 && live.activeVol > Math.max(hook.unit.volIndex, hook.keepVol));
        if (over) {
            write(hook, { expired: true });
            events.push({ type: 'hook-expired', name: hook.node.name });
            freed.add(hook);
        }
    }
    // 注入名额：已在名额里的照旧，没记过进入楼数的旧数据补记；空出的名额按激活先后补上排队和刚激活的。
    const cap = live.hookCap || DEFAULT_HOOK_CAP;
    const shown = live.hooks.filter(hook => hook.pooled && hook.status === 'active' && !freed.has(hook));
    for (const hook of shown) if (!hook.shownAt) write(hook, { shownAt: floor || hook.at });
    let room = cap - shown.length;
    const waiting = live.hooks
        .filter(hook => hook.pooled && !freed.has(hook) && (hook.status === 'queue' || (hook.status === 'wait' && writes.has(hook) && writes.get(hook).at !== undefined)))
        .map(hook => ({ hook, at: hook.status === 'queue' ? hook.at : writes.get(hook).at }))
        .sort((a, b) => a.at - b.at);
    for (const { hook } of waiting) {
        if (room <= 0) break;
        write(hook, { shownAt: floor || 1 });
        room -= 1;
    }
    for (const [item, patch] of writes) next = patchLive(next, item, patch);
    return { progress: next, events };
}

// 玩家自开的线收录为当前阶段的支线。
export function addPlayerThread(volumes, stageId, thread) {
    const node = { 名称: str(thread.name), 事件: str(thread.summary), 来源: '玩家' };
    if (!node.事件) delete node.事件;
    return volumes.map(volume => (volume.stages.some(stage => stage.id === stageId) ? {
        ...volume,
        stages: volume.stages.map(stage => (stage.id === stageId ? { ...stage, data: { ...stage.data, 支线事件: [...(Array.isArray(stage.data.支线事件) ? stage.data.支线事件 : []), node] } } : stage)),
    } : volume));
}

export function hasNodeNamed(units, name) {
    return (units || []).some(unit => stageNodes(unit.stage.data).some(node => node.name === name));
}
