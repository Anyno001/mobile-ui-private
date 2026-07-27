const REPEAT_VALUES = new Set(['none', 'daily', 'weekly', 'biweekly', 'monthly', 'custom', 'yearly']);

const normalizedIntervalDays = value => {
    const numeric = Number(value);
    return Number.isInteger(numeric) && numeric >= 1 && numeric <= 9999 ? numeric : 1;
};

export function setCalendarEntryRepeat(root, repeat) {
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
    form.elements.title.value = entry?.title || '';
    form.elements.note.value = entry?.note || '';
    form.elements.repeat.value = normalized;
    form.elements.occasionType.value = entry?.type || 'anniversary';
    form.elements.leapDayRule.value = entry?.leapDayRule || 'feb28';
    if (form.elements.intervalDays) form.elements.intervalDays.value = normalizedIntervalDays(entry?.intervalDays);
    if (focusTitle) form.elements.title.focus?.({ preventScroll: true });
    return normalized;
}

export function readCalendarEntryForm(root) {
    const form = root?.querySelector?.('[data-calendar-entry-form]');
    if (!form) throw new Error('安排编辑器不可用');
    const repeat = REPEAT_VALUES.has(form.elements.repeat.value) ? form.elements.repeat.value : 'none';
    return {
        repeat,
        kind: repeat === 'none' ? 'event' : 'occasion',
        title: form.elements.title.value.trim(),
        note: form.elements.note.value,
        type: repeat === 'yearly' ? form.elements.occasionType.value : 'anniversary',
        leapDayRule: repeat === 'yearly' ? form.elements.leapDayRule.value : 'feb28',
        ...(repeat === 'custom' ? { intervalDays: normalizedIntervalDays(form.elements.intervalDays.value) } : {}),
    };
}
