import {
    clearPhoneQuickReply, ensurePhoneQuickReply, getPhoneQuickReplyStatus,
} from './quick-reply.js';
import { renderQuickReplySettings, renderSettingsModal } from './settings-templates.js';

export function installQuickReplySettings({ makeOverlay, addNote }) {
    const showPage = () => {
        const status = getPhoneQuickReplyStatus(globalThis.quickReplyApi);
        makeOverlay(renderSettingsModal({ title: '快捷回复', content: renderQuickReplySettings(status) }));
    };
    const runAction = async (operation, successMessage) => {
        const status = document.getElementById('pm-quick-reply-status');
        const buttons = [...document.querySelectorAll('.pm-quick-reply-actions button')];
        buttons.forEach(button => { button.disabled = true; });
        if (status) {
            status.textContent = '正在提交到宿主 Quick Reply…';
            status.dataset.state = 'pending';
        }
        try {
            await operation(globalThis.quickReplyApi);
            addNote(successMessage);
            await window.__pmShowConfig('quick-reply');
            return true;
        } catch (error) {
            const message = error?.message || '未知错误';
            if (status) {
                status.textContent = `操作失败：${message}`;
                status.dataset.state = 'error';
            }
            alert(`Quick Reply 操作失败：${message}`);
            return false;
        } finally {
            buttons.forEach(button => { button.disabled = false; });
        }
    };
    window.__pmEnsurePhoneQuickReply = () => runAction(
        ensurePhoneQuickReply,
        '已向宿主提交天音小笺 Quick Reply 配置',
    );
    window.__pmClearPhoneQuickReply = () => runAction(
        clearPhoneQuickReply,
        '已清除天音小笺 Quick Reply',
    );
    return { showPage };
}
