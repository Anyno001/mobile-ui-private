import { cssUrlEscape } from './ui.js';
import { saveHistories } from './storage.js';

// 手机窗口外观与历史迁移：与主题变量注入无关的纯 DOM/存储副作用。
export function createPhoneAppearance(state, deps) {
    const { getCtx, getStorageId } = deps;

    function applyBackground() {
        const phone = state.phoneWindow;
        const msgList = phone?.querySelector('.pm-msg-list'); if (!msgList || !phone) return;
        const desktopBg = window.__pmDesktopBg || '';
        if (desktopBg) phone.style.setProperty('--pm-desktop-bg-image', `url("${cssUrlEscape(desktopBg)}")`);
        else phone.style.removeProperty('--pm-desktop-bg-image');
        const id = getStorageId(), localKey = `${id}_${state.currentPersona}`;
        const bg = window.__pmBgLocal[localKey] || window.__pmBgGlobal || '';
        if (bg) {
            msgList.style.setProperty('background-image', `url("${cssUrlEscape(bg)}")`, 'important');
            msgList.style.setProperty('background-size', 'cover', 'important');
            msgList.style.setProperty('background-position', 'center', 'important');
        } else {
            msgList.style.removeProperty('background-image');
            msgList.style.removeProperty('background-size');
            msgList.style.removeProperty('background-position');
        }
    }

    function fitNameFont() {
        const nameEl = state.phoneWindow?.querySelector('.pm-name');
        if (!nameEl) return;
        nameEl.style.fontSize = '15px';
        requestAnimationFrame(() => {
            let fs = 15;
            while (nameEl.scrollWidth > nameEl.clientWidth && fs > 9) {
                fs -= 0.5; nameEl.style.fontSize = fs + 'px';
            }
        });
    }

    function migrateOldHistory() {
        if (localStorage.getItem('ST_SMS_MIGRATED_V3')) return;
        const c = getCtx(); if (!c) return;
        try {
            const oldData = window.__pmHistories || {}, newData = {}; let migrated = 0;
            for (const oldKey of Object.keys(oldData)) {
                if (oldKey.startsWith('sms_')) { newData[oldKey] = oldData[oldKey]; continue; }
                // 旧格式：数字索引_chatId，迁移为 sms_avatar__chatId
                const m = oldKey.match(/^(\d+)_(.+)$/);
                if (!m) { newData[oldKey] = oldData[oldKey]; continue; }
                const ch = c.characters?.[parseInt(m[1])];
                if (ch?.avatar) { newData[`sms_${ch.avatar}__${m[2]}`] = oldData[oldKey]; migrated++; }
                else newData[oldKey] = oldData[oldKey];
            }
            window.__pmHistories = newData;
            saveHistories();
            localStorage.setItem('ST_SMS_MIGRATED_V3', '1');
        } catch (e) {}
    }

    return { applyBackground, fitNameFont, migrateOldHistory };
}
