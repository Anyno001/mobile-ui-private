import { parseBatchDayLine } from './calendar-batch-model.js';
import { calendarBulkRow } from './calendar-view.js';
const REPEAT_VALUES = new Set(['none', 'daily', 'weekly', 'biweekly', 'monthly', 'custom', 'yearly']);

const normalizedIntervalDays = value => {
    const numeric = Number(value);
    return Number.isInteger(numeric) && numeric >= 1 && numeric <= 9999 ? numeric : 1;
};

export function setCalendarEntryRepeat(root, repeat) {
    const normalized = applyRepeat(root, repeat);
    const toggle = (selector, show) => { const node = root?.querySelector?.(selector); if (node) node.hidden = !show; };
    const weekly = normalized === 'weekly' || normalized === 'biweekly';
    toggle('[data-calendar-weekdays]', weekly);
    for (const node of root?.querySelectorAll?.('[data-row-weekdays]') || []) node.hidden = !weekly;
    toggle('[data-calendar-until]', normalized !== 'none' && normalized !== 'yearly');
    return normalized;
}

function applyRepeat(root, repeat) {
    const normalized = REPEAT_VALUES.has(repeat) ? repeat : 'none';
    const repeatSelect = root?.querySelector?.('[data-calendar-repeat-select]');
    if (repeatSelect) repeatSelect.value = normalized;
    const intervalDays = root?.querySelector?.('[data-calendar-interval-days]');
    if (intervalDays) {
        const unavailable = normalized !== 'custom';
        intervalDays.hidden = unavailable;
        intervalDays.setAttribute?.('aria-hidden', String(unavailable));
        const field = intervalDays.querySelector?.('input');
        if (field) field.disabled = unavailable;
    }
    const occasionFields = root?.querySelector?.('[data-calendar-occasion-fields]');
    if (occasionFields) {
        const unavailable = normalized !== 'yearly';
        occasionFields.hidden = unavailable;
        occasionFields.setAttribute?.('aria-hidden', String(unavailable));
        for (const field of occasionFields.querySelectorAll?.('select, input, textarea, button') || []) {
            field.disabled = unavailable;
        }
    }
    if (root?.dataset) root.dataset.calendarEntryRepeat = normalized;
    return normalized;
}

export function fillCalendarEntryForm(root, entry = null, kind = 'event', { focusTitle = false } = {}) {
    const form = root?.querySelector?.('[data-calendar-entry-form]');
    if (!form) return false;
    const repeat = kind === 'occasion' ? entry?.repeat || 'yearly' : 'none';
    const normalized = setCalendarEntryRepeat(root, repeat);
    if (form.elements.title) form.elements.title.value = entry?.title || '';
    if (form.elements.note) form.elements.note.value = entry?.note || '';
    form.elements.repeat.value = normalized;
    form.elements.occasionType.value = entry?.type || 'anniversary';
    form.elements.leapDayRule.value = entry?.leapDayRule || 'feb28';
    if (form.elements.intervalDays) form.elements.intervalDays.value = normalizedIntervalDays(entry?.intervalDays);
    if (focusTitle) (form.elements.title || root.querySelector?.('[data-bulk-title]'))?.focus?.({ preventScroll: true });
    return normalized;
}

// 新增日程：每条一组名称与备注，「再加一条」在末尾追加一组，各条共用同一重复规则。
export function bindCalendarEntryBulk(root) {
    root?.querySelector?.('[data-calendar-bulk-add]')?.addEventListener('click', event => {
        const rows = root.querySelector('[data-calendar-bulk-rows]');
        event.currentTarget.insertAdjacentHTML('beforebegin', calendarBulkRow(root.querySelectorAll('[data-calendar-bulk-row]').length + 1, Number(rows?.dataset?.defaultWeekday) || 0));
        setCalendarEntryRepeat(root, root.querySelector('[data-calendar-repeat-select]')?.value);
        event.currentTarget.previousElementSibling?.querySelector?.('[data-bulk-title]')?.focus?.({ preventScroll: false });
    });
}

// 批量行：名称前可写时间（20:00、20:00-21:30、晚间），空行跳过。
function readBulkRows(root) {
    return [...(root.querySelectorAll?.('[data-calendar-bulk-row]') || [])].map(row => {
        const line = parseBatchDayLine(row.querySelector('[data-bulk-title]')?.value);
        const weekdays = [...row.querySelectorAll('[data-row-weekday]')].filter(box => box.checked).map(box => Number(box.value));
        return line ? { title: line.title, time: line.time, note: row.querySelector('[data-bulk-note]')?.value || '', weekdays } : null;
    }).filter(Boolean);
}

export function readCalendarEntryForm(root) {
    const form = root?.querySelector?.('[data-calendar-entry-form]');
    if (!form) throw new Error('安排编辑器不可用');
    const repeat = REPEAT_VALUES.has(form.elements.repeat.value) ? form.elements.repeat.value : 'none';
    return {
        ...(root.querySelector?.('[data-calendar-bulk-rows]') ? { lines: readBulkRows(root) } : {}),
        ...((repeat === 'weekly' || repeat === 'biweekly') && form.querySelector('[name="weekday"]') ? { weekdays: [...form.querySelectorAll('[name="weekday"]')].filter(box => box.checked).map(box => Number(box.value)) } : {}),
        ...(repeat !== 'none' && repeat !== 'yearly' && form.elements.until?.value ? { until: form.elements.until.value } : {}),
        repeat,
        kind: repeat === 'none' ? 'event' : 'occasion',
        title: form.elements.title?.value.trim() || '',
        note: form.elements.note?.value || '',
        type: repeat === 'yearly' ? form.elements.occasionType.value : 'anniversary',
        leapDayRule: repeat === 'yearly' ? form.elements.leapDayRule.value : 'feb28',
        ...(repeat === 'custom' ? { intervalDays: normalizedIntervalDays(form.elements.intervalDays.value) } : {}),
    };
}
