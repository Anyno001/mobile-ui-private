import {
    clearPhoneQuickReply, ensurePhoneQuickReply, getConfiguredPhoneQuickReplyLabel,
    getPhoneQuickReplyStatus, normalizePhoneQuickReplyLabel,
} from './quick-reply.js';
import { renderQuickReplySettings, renderSettingsModal } from './settings-templates.js';

export function installQuickReplySettings({ makeOverlay, addNote, saveTheme }) {
    const showPage = () => {
        const label = getConfiguredPhoneQuickReplyLabel();
        const status = getPhoneQuickReplyStatus(globalThis.quickReplyApi, label);
        makeOverlay(renderSettingsModal({ title: '手机开关', content: renderQuickReplySettings(status, label) }));
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
    window.__pmEnsurePhoneQuickReply = () => {
        const input = document.getElementById('pm-quick-reply-label');
        const previousLabel = getConfiguredPhoneQuickReplyLabel();
        const nextLabel = normalizePhoneQuickReplyLabel(input?.value);
        return runAction(async api => {
            window.__pmTheme.qrLabel = nextLabel;
            if (!saveTheme()) {
                window.__pmTheme.qrLabel = previousLabel;
                throw new Error('手机开关名称保存失败：浏览器存储不可用');
            }
            try {
                const result = await ensurePhoneQuickReply(api, nextLabel);
                if (input) input.value = nextLabel;
                return result;
            } catch (error) {
                window.__pmTheme.qrLabel = previousLabel;
                if (!saveTheme()) {
                    throw new Error(`${error.message}；名称配置回滚失败，请勿刷新并立即导出备份`);
                }
                throw error;
            }
        }, `已创建手机开关入口“${nextLabel}”`);
    };
    window.__pmClearPhoneQuickReply = () => runAction(
        clearPhoneQuickReply,
        '已清除手机开关入口',
    );
    return { showPage };
}
