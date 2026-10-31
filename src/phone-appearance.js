import { cssUrlEscape } from './ui.js';
import { saveHistories } from './storage.js';
import { loadLocalBackground } from './storage-background.js';

// 手机窗口外观与历史迁移：与主题变量注入无关的纯 DOM/存储副作用。
export function createPhoneAppearance(state, deps) {
    const { getCtx, getStorageId } = deps;
    let backgroundRequest = 0;

    async function applyBackground() {
        const phone = state.phoneWindow;
        const msgList = phone?.querySelector('.pm-msg-list'); if (!msgList || !phone) return;
        const request = ++backgroundRequest;
        const desktopBg = window.__pmDesktopBg || '';
        // 每次切会话都会调用；背景值是长 data URL，同值重写也会让整部手机重算样式，所以只在变化时写。
        const desktopValue = desktopBg ? `url("${cssUrlEscape(desktopBg)}")` : '';
        if (phone.style.getPropertyValue?.('--pm-desktop-bg-image') !== desktopValue) {
            if (desktopValue) phone.style.setProperty('--pm-desktop-bg-image', desktopValue);
            else phone.style.removeProperty('--pm-desktop-bg-image');
        }
        // 桌面图标的毛玻璃只在有背景图时才看得出，纯渐变底上关掉省 GPU（见 community.css）。
        if (phone.hasAttribute?.('data-desktop-image') !== !!desktopBg) phone.toggleAttribute?.('data-desktop-image', !!desktopBg);
        const id = getStorageId(), localKey = `${id}_${state.currentPersona}`;
        let localBg = '';
        try {
            localBg = await loadLocalBackground(localKey);
        } catch (error) {
            console.error('[phone-mode] 会话背景读取失败', error);
        }
        if (request !== backgroundRequest || state.phoneWindow !== phone
            || `${getStorageId()}_${state.currentPersona}` !== localKey) return;
        const bg = localBg || window.__pmBgGlobal || '';
        const listValue = bg ? `url("${cssUrlEscape(bg)}")` : '';
        if (msgList.style.getPropertyValue?.('background-image') === listValue) return;
        if (bg) {
            msgList.style.setProperty('background-image', listValue, 'important');
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
