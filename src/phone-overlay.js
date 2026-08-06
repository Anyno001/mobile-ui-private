import { POPOVER_SUPPORTED } from './constants.js';

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
        return overlay;
    }

    return { makeOverlay, closeOverlay };
}
