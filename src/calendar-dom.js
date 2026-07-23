export function setCalendarEntryKind(root, kind) {
    const normalized = kind === 'occasion' ? 'occasion' : 'event';
    for (const button of root?.querySelectorAll?.('[data-calendar-entry-kind]') || []) {
        button.setAttribute('aria-pressed', String(button.dataset.calendarEntryKind === normalized));
    }
    const occasionFields = root?.querySelector?.('[data-calendar-occasion-fields]');
    if (occasionFields) {
        const unavailable = normalized !== 'occasion';
        occasionFields.hidden = unavailable;
        occasionFields.setAttribute?.('aria-hidden', String(unavailable));
        for (const field of occasionFields.querySelectorAll?.('select, input, textarea, button') || []) {
            field.disabled = unavailable;
        }
    }
    if (root?.dataset) root.dataset.calendarEntryKind = normalized;
    return normalized;
}

export function fillCalendarEntryForm(root, entry = null, kind = 'event', { focusTitle = false } = {}) {
    const form = root?.querySelector?.('[data-calendar-entry-form]');
    if (!form) return false;
    const normalized = setCalendarEntryKind(root, kind);
    form.elements.title.value = entry?.title || '';
    form.elements.note.value = entry?.note || '';
    if (normalized === 'occasion') {
        form.elements.occasionType.value = entry?.type || 'anniversary';
        form.elements.leapDayRule.value = entry?.leapDayRule || 'feb28';
    }
    if (focusTitle) form.elements.title.focus?.({ preventScroll: true });
    return normalized;
}

export function readCalendarEntryForm(root) {
    const form = root?.querySelector?.('[data-calendar-entry-form]');
    if (!form) throw new Error('安排编辑器不可用');
    const kind = root.dataset?.calendarEntryKind === 'occasion' ? 'occasion' : 'event';
    return {
        kind,
        title: form.elements.title.value.trim(),
        note: form.elements.note.value,
        type: kind === 'occasion' ? form.elements.occasionType.value : '',
        leapDayRule: kind === 'occasion' ? form.elements.leapDayRule.value : '',
    };
}
