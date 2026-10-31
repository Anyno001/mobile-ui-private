// 金手指的底部表单：添加 / 编辑任务、物品、商品、奖品、属性、技能、权限，以及任务方向与世界名。
// 一张表单代替原插件连续弹出的 prompt()；字段定义集中在 FORMS，提交时按字段名读 FormData 拼成 dispatch 的 op。
import { escapeAttr as rawAttr, escapeHtml as rawHtml } from './ui.js';

// 状态里的 id、数量是数字，转成字符串再转义。
const escapeAttr = value => rawAttr(String(value ?? ''));
const escapeHtml = value => rawHtml(String(value ?? ''));

const TASK_TYPES = ['主线', '支线', '日常'];
const TIERS = ['N', 'R', 'SR', 'SSR', 'UR'];

export const ORIGIN_FORMS = Object.freeze({
    addTask: { title: '添加任务', submit: '添加', fields: [
        { name: 'title', label: '标题', required: true },
        { name: 'taskType', label: '类型', choice: TASK_TYPES, value: '支线' },
        { name: 'desc', label: '描述', multiline: true },
        { name: 'cond', label: '完成条件' },
        { name: 'reward', label: '奖励', placeholder: '例如：积分300 魅力+2' },
        { name: 'penalty', label: '失败惩罚', placeholder: '可留空' },
        { name: 'limit', label: '时限（回合，0为不限）', number: [0, 99], value: '0' },
        { name: 'owner', label: '对象', placeholder: '宿主或某个角色名', value: '宿主' },
    ] },
    editTask: { title: '编辑任务', submit: '保存', fields: [
        { name: 'title', label: '标题', required: true },
        { name: 'taskType', label: '类型', choice: TASK_TYPES },
        { name: 'desc', label: '描述', multiline: true },
        { name: 'cond', label: '完成条件' },
        { name: 'reward', label: '奖励' },
        { name: 'penalty', label: '失败惩罚' },
        { name: 'limit', label: '时限（回合，0为不限）', number: [0, 99] },
        { name: 'progress', label: '进度（0到100）', number: [0, 100] },
        { name: 'owner', label: '对象' },
    ] },
    addItem: { title: '添加物品', submit: '添加', fields: [
        { name: 'name', label: '物品名', required: true },
        { name: 'count', label: '数量', number: [1, 999], value: '1' },
        { name: 'desc', label: '说明', placeholder: '可留空' },
    ] },
    addShop: { title: '添加商品', submit: '添加', fields: [
        { name: 'name', label: '商品名', required: true },
        { name: 'price', label: '价格（积分）', number: [0, 99999], value: '300' },
        { name: 'desc', label: '说明' },
        { name: 'effect', label: '数值效果', placeholder: '可留空，例如：魅力+10' },
    ] },
    addGacha: { title: '添加奖品', submit: '添加', fields: [
        { name: 'name', label: '奖品名', required: true },
        { name: 'tier', label: '稀有度', choice: TIERS, value: 'R' },
        { name: 'weight', label: '权重（越大越常出）', number: [1, 9999], value: '20' },
        { name: 'desc', label: '说明' },
        { name: 'effect', label: '数值效果', placeholder: '可留空，例如：积分+200' },
    ] },
    addStat: { title: '添加属性', submit: '添加', fields: [
        { name: 'name', label: '属性名', required: true, placeholder: '例如：魅力、体魄' },
        { name: 'val', label: '初始值', number: [-9999, 9999], value: '0' },
    ] },
    addSkill: { title: '添加技能', submit: '添加', fields: [{ name: 'name', label: '技能名', required: true }, { name: 'desc', label: '说明', placeholder: '可留空' }] },
    addPerk: { title: '添加权限', submit: '添加', fields: [{ name: 'name', label: '权限或称号', required: true }, { name: 'desc', label: '说明', placeholder: '可留空' }] },
    setDirection: { title: '设定任务方向', submit: '保存', hint: '下次派发任务时采用，例如：一个复仇任务、让他吃醋。留空则清除。', fields: [{ name: 'value', label: '方向', multiline: true }] },
    setWorld: { title: '世界名', submit: '保存', hint: '商城与奖池按这个世界生成。留空则按角色卡推断。', fields: [{ name: 'value', label: '世界名或简述', multiline: true }] },
});

function field(def, value) {
    const id = `pm-origin-field-${def.name}`;
    const current = value ?? def.value ?? '';
    if (def.choice) {
        const picked = def.choice.includes(current) ? current : def.choice[0];
        return `<fieldset class="pm-origin-field"><legend>${escapeHtml(def.label)}</legend><div class="pm-origin-choices">${def.choice.map(option => `<label class="pm-origin-choice"><input type="radio" name="${def.name}" value="${escapeAttr(option)}"${option === picked ? ' checked' : ''}><span>${escapeHtml(option)}</span></label>`).join('')}</div></fieldset>`;
    }
    const common = `id="${id}" name="${def.name}" class="pm-origin-input"${def.placeholder ? ` placeholder="${escapeAttr(def.placeholder)}"` : ''}${def.required ? ' required' : ''}`;
    const control = def.multiline
        ? `<textarea ${common} rows="3" maxlength="600">${escapeHtml(current)}</textarea>`
        : def.number
            ? `<input ${common} type="number" inputmode="numeric" min="${def.number[0]}" max="${def.number[1]}" value="${escapeAttr(current)}">`
            : `<input ${common} type="text" maxlength="120" autocomplete="off" value="${escapeAttr(current)}">`;
    return `<label class="pm-origin-field" for="${id}"><span>${escapeHtml(def.label)}</span>${control}</label>`;
}

// values：编辑时的初始值；target：提交时带回的对象 id。
export function renderOriginSheet(kind, values = {}, target = '') {
    const form = ORIGIN_FORMS[kind];
    if (!form) return '';
    return `<div class="pm-origin-sheet-layer"><button type="button" class="pm-origin-scrim" data-origin-action="sheet-close" aria-label="关闭" tabindex="-1"></button>
<form class="pm-origin-sheet" data-origin-form="sheet" data-kind="${kind}" data-target="${escapeAttr(target)}" role="dialog" aria-modal="true" aria-labelledby="pm-origin-sheet-title">
<h3 id="pm-origin-sheet-title">${escapeHtml(form.title)}</h3>${form.hint ? `<p class="pm-origin-sheet-hint">${escapeHtml(form.hint)}</p>` : ''}
<div class="pm-origin-sheet-fields">${form.fields.map(def => field(def, values[def.name])).join('')}</div>
<div class="pm-origin-sheet-actions"><button type="button" class="pm-origin-op" data-origin-action="sheet-close">取消</button><button type="submit" class="pm-origin-op is-main">${escapeHtml(form.submit)}</button></div></form></div>`;
}

const trim = value => String(value ?? '').trim();
const int = (value, [min, max], fallback) => {
    const n = Number.parseInt(value, 10);
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};

// 把表单读成 dispatch 的 op；必填项为空时返回 null。
export function readOriginSheet(kind, formData, target = '') {
    const form = ORIGIN_FORMS[kind];
    if (!form) return null;
    const values = {};
    for (const def of form.fields) {
        const raw = formData.get(def.name);
        values[def.name] = def.number ? int(raw, def.number, int(def.value, def.number, def.number[0])) : trim(raw);
        if (def.required && !values[def.name]) return null;
    }
    if (kind === 'addTask') return { type: 'addTask', ...values, owner: values.owner || '宿主' };
    if (kind === 'editTask') {
        const patch = { ...values };
        if (!patch.owner) delete patch.owner;
        return { type: 'editTask', id: target, patch };
    }
    if (kind === 'addItem') return { type: 'addItem', ...values, effect: '' };
    if (kind === 'setDirection' || kind === 'setWorld') return { type: kind, value: values.value };
    return { type: kind, ...values };
}
