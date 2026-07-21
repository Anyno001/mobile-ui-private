export function setCalendarEntryKind(root, kind) {
    const normalized = kind === 'occasion' ? 'occasion' : 'event';
    for (const button of root?.querySelectorAll?.('[data-calendar-entry-kind]') || []) {
        button.setAttribute('aria-pressed', String(button.dataset.calendarEntryKind === normalized));
    }
    const occasionFields = root?.querySelector?.('[data-calendar-occasion-fields]');
    if (occasionFields) occasionFields.hidden = normalized !== 'occasion';
    if (root?.dataset) root.dataset.calendarEntryKind = normalized;
    return normalized;
}

export function fillCalendarEntryForm(root, entry = null, kind = 'event') {
    const form = root?.querySelector?.('[data-calendar-entry-form]');
    if (!form) return false;
    const normalized = setCalendarEntryKind(root, kind);
    form.elements.title.value = entry?.title || '';
    form.elements.note.value = entry?.note || '';
    form.elements.occasionType.value = entry?.type || 'anniversary';
    form.elements.leapDayRule.value = entry?.leapDayRule || 'feb28';
    const remove = root.querySelector?.('[data-calendar-entry-delete]');
    if (remove) remove.disabled = !entry;
    form.elements.title.focus?.();
    return normalized;
}

export function readCalendarEntryForm(root) {
    const form = root?.querySelector?.('[data-calendar-entry-form]');
    if (!form) throw new Error('安排编辑器不可用');
    return {
        kind: root.dataset?.calendarEntryKind === 'occasion' ? 'occasion' : 'event',
        title: form.elements.title.value.trim(),
        note: form.elements.note.value,
        type: form.elements.occasionType.value,
        leapDayRule: form.elements.leapDayRule.value,
    };
}
