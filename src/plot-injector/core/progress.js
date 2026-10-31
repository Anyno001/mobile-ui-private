// 进度随聊天存在 chat_metadata.plotInjector；这里只做纯计算，所有函数返回新对象，不原地改。
export const SETTING_SLOT = '@setting';
export const INDEX_SLOT = '@index';
export const STATES = ['done', 'active', 'next', 'todo'];
export const STATE_LABELS = { done: '已过', active: '进行中', next: '下一段', todo: '未到' };

export function emptyProgress(projectId) {
    return { projectId, current: null, slots: {}, lastCheckFloor: 0, muted: [], offMuted: [], pace: 'normal' };
}

export function normalizeProgress(value, projectId) {
    const base = emptyProgress(projectId);
    if (!value || typeof value !== 'object') return base;
    return {
        ...base,
        ...value,
        slots: value.slots && typeof value.slots === 'object' ? value.slots : {},
        muted: Array.isArray(value.muted) ? value.muted : [],
        offMuted: Array.isArray(value.offMuted) ? value.offMuted : [],
        lastCheckFloor: Number(value.lastCheckFloor) || 0,
        pace: ['slow', 'normal', 'fast'].includes(value.pace) ? value.pace : 'normal',
    };
}

export function currentIndex(units, progress) {
    if (!units.length) return -1;
    const found = units.findIndex(unit => unit.id === progress.current);
    return found >= 0 ? found : 0;
}

export function unitStates(units, progress) {
    const cur = currentIndex(units, progress);
    const states = {};
    units.forEach((unit, index) => {
        const derived = index < cur ? 'done' : index === cur ? 'active' : index === cur + 1 ? 'next' : 'todo';
        const manual = progress.slots[unit.id] && progress.slots[unit.id].state;
        states[unit.id] = STATES.includes(manual) ? manual : derived;
    });
    return states;
}

export function patchSlot(progress, slotId, patch) {
    const prev = progress.slots[slotId] || {};
    const next = { ...prev, ...patch };
    for (const key of Object.keys(next)) if (next[key] === undefined) delete next[key];
    return { ...progress, slots: { ...progress.slots, [slotId]: next } };
}

export function offNodes(progress, unitId) {
    const slot = progress.slots[unitId];
    return slot && Array.isArray(slot.off) ? slot.off : [];
}

export function setNodeChecked(progress, unitId, nodeId, checked) {
    const off = new Set(offNodes(progress, unitId));
    if (checked) off.delete(nodeId);
    else off.add(nodeId);
    return patchSlot(progress, unitId, { off: [...off] });
}

// 只按节点名取消勾选；未知名称忽略。
export function uncheckByNames(progress, unitId, nodes, names) {
    const wanted = new Set((names || []).map(name => String(name).trim()).filter(Boolean));
    let next = progress;
    for (const node of nodes) if (wanted.has(node.name)) next = setNodeChecked(next, unitId, node.id, false);
    return next;
}

export function goTo(progress, units, unitId) {
    const slots = { ...progress.slots };
    for (const unit of units) {
        if (slots[unit.id] && slots[unit.id].state) {
            const { state, ...rest } = slots[unit.id];
            slots[unit.id] = rest;
        }
    }
    return { ...progress, current: unitId, slots };
}

// 打开下一段：当前转已过、下一段转进行中；本卷最后一段自动进入下一卷第一段（单元表本就跨卷连续）。
export function advance(progress, units) {
    const cur = currentIndex(units, progress);
    if (cur < 0 || cur >= units.length - 1) return null;
    const from = units[cur];
    const to = units[cur + 1];
    return { progress: goTo(progress, units, to.id), from, to };
}

export function isMuted(progress, unitId) {
    return progress.muted.includes(unitId);
}

export function mute(progress, unitId) {
    return isMuted(progress, unitId) ? progress : { ...progress, muted: [...progress.muted, unitId] };
}
