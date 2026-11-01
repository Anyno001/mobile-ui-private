import { renderCalendarMonthDialog } from './calendar-view.js';

// 跳转日期弹窗：年月与故事日期都在弹窗内暂存，点「应用」才写入。
export function showCalendarMonthDialog({ makeOverlay, closeOverlay, scope, view, saveBaseDate, clearBaseDate, setToday, goToReferenceDate, jumpToMonth }) {
    const originalBase = scope.baseDate || '';
    const overlay = makeOverlay(renderCalendarMonthDialog(scope, view.viewYear, view.viewMonth));
    const yearInput = overlay.querySelector('[data-calendar-jump-year]');
    const monthInput = overlay.querySelector('[data-calendar-jump-month]');
    const baseInput = overlay.querySelector('[data-calendar-base-date]');
    const errorNode = overlay.querySelector('[data-calendar-month-error]');
    const close = reason => closeOverlay?.(reason);
    const guard = run => async () => {
        try { await run(); close('saved'); } catch (error) { if (errorNode) errorNode.textContent = error?.message || '日期设置失败'; }
    };
    overlay.querySelectorAll('[data-calendar-month-close]').forEach(node => node.addEventListener('click', () => close('cancel')));
    overlay.querySelectorAll('[data-calendar-year-step]').forEach(node => node.addEventListener('click', () => {
        const next = Number(yearInput.value) + Number(node.dataset.calendarYearStep);
        if (Number.isInteger(next) && next >= 1 && next <= 9999) yearInput.value = String(next);
    }));
    overlay.querySelectorAll('[data-calendar-month-option]').forEach(node => node.addEventListener('click', () => {
        monthInput.value = node.dataset.calendarMonthOption;
        overlay.querySelectorAll('[data-calendar-month-option]').forEach(option => option.setAttribute('aria-pressed', String(option === node)));
    }));
    overlay.querySelector('[data-action="calendar-base-clear"]')?.addEventListener('click', guard(() => clearBaseDate()));
    overlay.querySelector('[data-action="calendar-set-today"]')?.addEventListener('click', guard(() => setToday()));
    overlay.querySelector('[data-action="calendar-today"]')?.addEventListener('click', guard(() => goToReferenceDate()));
    overlay.querySelector('[data-action="calendar-month-jump"]')?.addEventListener('click', guard(async () => {
        const base = baseInput?.value.trim() || '';
        if (base && base !== originalBase) await saveBaseDate(base);
        else jumpToMonth(yearInput.value, monthInput.value);
    }));
    overlay.addEventListener('keydown', event => { if (event.key === 'Escape') { event.preventDefault(); close('cancel'); } });
    overlay.querySelector('[aria-pressed="true"][data-calendar-month-option]')?.focus?.({ preventScroll: true });
    return overlay;
}
