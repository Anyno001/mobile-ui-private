import { POPOVER_SUPPORTED } from './constants.js';
import { captureScroll, restoreScroll } from './scroll-keeper.js';

const OVERLAY_SCROLLERS = ['.pm-modal-scroll'];

export function createPhoneOverlayController({ runtime, applyTheme }) {
    function closeOverlay(reason = 'close') {
        const current = document.getElementById('pm-overlay');
        if (!current) return false;
        const onClose = current.__pmOnClose;
        const opener = current.__pmOpener;
        current.remove();
        if (typeof onClose === 'function') onClose(reason);
        if (!['replace', 'phone-close', 'conversation-switch'].includes(reason)
            && opener?.isConnected && typeof opener.focus === 'function') {
            opener.focus({ preventScroll: true });
        }
        return true;
    }

    function makeOverlay(html, options = {}) {
        const previous = document.getElementById('pm-overlay');
        const active = document.activeElement;
        const opener = options.opener || runtime.overlayOpener || previous?.__pmOpener
            || (active && active !== document.body ? active : null);
        runtime.overlayOpener = null;
        // 设置页的开关多是整个弹窗重建：同一页（标题相同）重建时保留滚动位置，换页才回到顶部。
        const previousTitle = previous?.querySelector?.('.pm-modal-header b')?.textContent ?? null;
        const previousScroll = previousTitle !== null ? captureScroll(previous, OVERLAY_SCROLLERS) : null;
        closeOverlay('replace');
        const overlay = document.createElement('div');
        overlay.id = 'pm-overlay';
        overlay.dataset.theme = window.__pmTheme?.darkMode || 'light';
        if (POPOVER_SUPPORTED) overlay.setAttribute('popover', 'manual');
        overlay.__pmOnClose = typeof options.onClose === 'function' ? options.onClose : null;
        overlay.__pmOpener = opener;
        overlay.innerHTML = html;
        overlay.addEventListener('click', event => { if (event.target === overlay) closeOverlay('backdrop'); });
        document.body.appendChild(overlay);
        applyTheme();
        if (overlay.showPopover) try { overlay.showPopover(); } catch (error) {}
        if (previousScroll && overlay.querySelector?.('.pm-modal-header b')?.textContent === previousTitle) {
            restoreScroll(overlay, OVERLAY_SCROLLERS, previousScroll);
        }
        return overlay;
    }

    return { makeOverlay, closeOverlay };
}
