export const calendarEditor = app => app?.querySelector('[data-calendar-editor]');
export const calendarOccasionEditor = app => app?.querySelector('[data-calendar-occasion-editor]');

export function revealCalendarEditor(form) {
    const management = form?.closest?.('[data-calendar-management="schedule"]');
    if (management) management.open = true;
    form?.scrollIntoView?.({ block: 'nearest' });
}

export function clearCalendarEditor(app) {
    const form = calendarEditor(app);
    if (!form) return;
    form.reset();
    form.elements.eventId.value = '';
    form.querySelector('h3').textContent = '添加日程';
}

export function fillCalendarEditor(app, event) {
    const form = calendarEditor(app);
    if (!form || !event) return;
    const [year, month, day] = event.date.split('-');
    form.elements.year.value = year;
    form.elements.month.value = month;
    form.elements.day.value = day;
    form.elements.title.value = event.title;
    form.elements.note.value = event.note;
    form.elements.tagged.value = '';
    form.elements.eventId.value = event.id;
    form.querySelector('h3').textContent = '编辑日程';
    revealCalendarEditor(form);
    form.elements.title.focus();
}

export function activateCalendarEditorKind(app, editorKind) {
    const eventForm = calendarEditor(app);
    const occasionForm = calendarOccasionEditor(app);
    if (eventForm) eventForm.hidden = editorKind === 'occasion';
    if (occasionForm) occasionForm.hidden = editorKind !== 'occasion';
    for (const control of app?.querySelectorAll?.('[data-action="calendar-editor-kind"]') || []) {
        control.setAttribute('aria-pressed', String(control.dataset.editorKind === editorKind));
    }
}

export function clearCalendarOccasionEditor(app) {
    const form = calendarOccasionEditor(app);
    if (!form) return;
    form.reset();
    form.elements.occasionId.value = '';
    form.querySelector('h3').textContent = '添加生日或纪念日';
}

export function fillCalendarOccasionEditor(app, occasion, typeLabel) {
    const form = calendarOccasionEditor(app);
    if (!form || !occasion) return;
    form.elements.type.value = occasion.type;
    form.elements.month.value = String(occasion.month).padStart(2, '0');
    form.elements.day.value = String(occasion.day).padStart(2, '0');
    form.elements.title.value = occasion.title;
    form.elements.note.value = occasion.note;
    form.elements.leapDayRule.value = occasion.leapDayRule;
    form.elements.occasionId.value = occasion.id;
    form.querySelector('h3').textContent = `编辑${typeLabel}`;
    revealCalendarEditor(form);
    form.elements.title.focus();
}
