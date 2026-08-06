import { EXTENSION_PROMPT_POSITIONS } from './constants.js';
import { normalizeInjectionConfig } from './behavior-config.js';
import { resolveConversationTarget } from './conversation-state.js';
import { BACK_ICON_SVG, CLOSE_ICON_SVG } from './icons.js';
import { loadInjectionConfig, saveBidirectional, saveInjectionConfig } from './storage.js';
import { escapeHtml } from './ui.js';

const clone = value => JSON.parse(JSON.stringify(value));

function injectionFailure(result, phase) {
    const failedWrites = Number.isInteger(result?.failedWrites) && result.failedWrites > 0 ? result.failedWrites : 0;
    const failedKeys = Array.isArray(result?.failedKeys) ? result.failedKeys : [];
    if (!failedWrites && !failedKeys.length) return null;
    const details = [
        failedWrites ? `${failedWrites} 项写入失败` : '',
        failedKeys.length ? `${failedKeys.length} 项清理失败` : '',
    ].filter(Boolean).join('，');
    return new Error(`上下文注入设置${phase}失败：${details}`);
}

export async function commitConversationInjectionUpdate({
    persistCandidate, restoreSnapshot, persistSnapshot, applyInjection, validateResult,
}) {
    try {
        await persistCandidate();
        const result = await applyInjection();
        const error = injectionFailure(result, '应用');
        if (error) throw error;
        const validationError = validateResult?.(result);
        if (validationError) throw validationError;
        return true;
    } catch (error) {
        let rollbackError = null;
        try {
            restoreSnapshot();
            await persistSnapshot();
            const result = await applyInjection();
            const compensationError = injectionFailure(result, '补偿');
            if (compensationError) throw compensationError;
        } catch (failure) {
            rollbackError = failure;
        }
        if (!rollbackError) throw error;
        const combined = new Error(`${error.message || '上下文注入设置保存失败'}；原配置回滚也失败，请勿刷新并立即导出备份：${rollbackError.message}`);
        combined.cause = error;
        combined.rollbackError = rollbackError;
        throw combined;
    }
}


function injectionPositionLabel(position) {
    return ({
        [EXTENSION_PROMPT_POSITIONS.IN_PROMPT]: '主提示词内',
        [EXTENSION_PROMPT_POSITIONS.IN_CHAT]: '聊天记录内',
        [EXTENSION_PROMPT_POSITIONS.BEFORE_PROMPT]: '主提示词前',
    })[position] || '主提示词内';
}

function promptPlacementFields(prefix, label, config, { includeHistoryLimit = false } = {}) {
    const options = [
        [EXTENSION_PROMPT_POSITIONS.IN_PROMPT, '主提示词内'],
        [EXTENSION_PROMPT_POSITIONS.IN_CHAT, '聊天记录内'],
        [EXTENSION_PROMPT_POSITIONS.BEFORE_PROMPT, '主提示词前'],
    ].map(([value, text]) => `<option value="${value}" ${config.position === value ? 'selected' : ''}>${text}</option>`).join('');
    return `<fieldset class="pm-conversation-injection-group"><legend>${label}</legend><label class="pm-conversation-injection-field">注入位置
      <select id="pm-conversation-injection-${prefix}-position" class="pm-cfg-input pm-conversation-injection-config">${options}</select>
    </label><label class="pm-conversation-injection-field">注入深度
      <input id="pm-conversation-injection-${prefix}-depth" class="pm-cfg-input pm-conversation-injection-config" type="number" min="0" max="10000" step="1" value="${config.depth}">
    </label>${includeHistoryLimit ? `<label class="pm-conversation-injection-field">消息范围
      <input id="pm-conversation-injection-${prefix}-history-limit" class="pm-cfg-input pm-conversation-injection-config" type="number" min="1" max="100" step="1" value="${config.historyLimit}">
    </label>` : ''}</fieldset>`;
}

export function installPhoneContextInjection(state, deps) {
    const {
        getStorageId, makeOverlay, applyBidirectionalInjection, clearBidirectionalInjection,
    } = deps;
    let injectionToggleQueue = Promise.resolve();
    let injectionSettingsBusy = false;

    const setInjectionSettingsBusy = (busy, action) => {
        const clearButton = document.getElementById('pm-conversation-injection-clear');
        const saveButton = document.getElementById('pm-conversation-injection-save');
        for (const button of [clearButton, saveButton]) {
            if (!button) continue;
            button.disabled = busy;
            button.setAttribute('aria-busy', String(busy));
        }
        if (clearButton) clearButton.textContent = busy && action === 'clear' ? '清除中…' : '清除注入';
        if (saveButton) saveButton.textContent = busy && action === 'save' ? '保存并应用中…' : '保存并应用';
    };

    const currentTarget = () => resolveConversationTarget(state, getStorageId);

    const isEnabled = target => Boolean(target
        && (window.__pmBidirectional[target.storageId] || []).includes(target.targetKey));

    const explicitTarget = (storageId, targetKey, isGroup = false, { requireExisting = false } = {}) => {
        const normalizedStorageId = String(storageId || '').trim();
        const normalizedTargetKey = String(targetKey || '').trim();
        if (!normalizedStorageId || normalizedStorageId === 'sms_unknown__default' || !normalizedTargetKey) return null;
        if (requireExisting) {
            const groupExists = Object.prototype.hasOwnProperty.call(
                window.__pmGroupMeta?.[normalizedStorageId] || {}, normalizedTargetKey,
            );
            const contactExists = !normalizedTargetKey.startsWith('__group_')
                && Object.prototype.hasOwnProperty.call(
                    window.__pmHistories?.[normalizedStorageId] || {}, normalizedTargetKey,
                );
            if ((isGroup === true && !groupExists) || (isGroup !== true && !contactExists)) return null;
        }
        return {
            storageId: normalizedStorageId,
            targetKey: normalizedTargetKey,
            saveKey: normalizedTargetKey,
            isGroup: isGroup === true,
        };
    };

    const toggleTargetInjection = async target => {
        if (!target) return false;
        const snapshot = clone(window.__pmBidirectional);
        const selected = new Set(window.__pmBidirectional[target.storageId] || []);
        if (selected.has(target.targetKey)) selected.delete(target.targetKey);
        else selected.add(target.targetKey);
        window.__pmBidirectional[target.storageId] = [...selected];
        await commitConversationInjectionUpdate({
            persistCandidate: async () => {
                if (!saveBidirectional()) throw new Error('会话注入开关保存失败：浏览器存储不可用或空间不足');
            },
            restoreSnapshot: () => { window.__pmBidirectional = snapshot; },
            persistSnapshot: async () => {
                if (!saveBidirectional()) throw new Error('会话注入开关回滚失败');
            },
            applyInjection: () => applyBidirectionalInjection(),
        });
        return true;
    };

    const enqueueToggle = task => {
        const pending = injectionToggleQueue.then(task, task);
        injectionToggleQueue = pending.catch(() => {});
        return pending;
    };

    Object.assign(deps, { runConversationInjectionMutation: enqueueToggle });

    window.__pmConversationInjectionSummary = () => {
        const config = normalizeInjectionConfig(window.__pmInjectionConfig);
        return injectionPositionLabel(config.phone.position);
    };

    window.__pmCurrentConversationInjectionEnabled = () => isEnabled(currentTarget());

    window.__pmConversationInjectionEnabled = (storageId, targetKey) => isEnabled(
        explicitTarget(storageId, targetKey),
    );

    window.__pmToggleConversationInjection = async (storageId, targetKey, isGroup = false) => {
        return enqueueToggle(() => {
            const target = explicitTarget(storageId, targetKey, isGroup, { requireExisting: true });
            return target ? toggleTargetInjection(target) : false;
        });
    };

    window.__pmToggleCurrentConversationInjection = async () => {
        const target = currentTarget();
        if (!target) return false;
        try {
            return await enqueueToggle(() => toggleTargetInjection(target));
        } catch (error) {
            alert(error.message || '当前会话注入开关保存失败');
            return false;
        }
    };

    window.__pmShowConversationInjection = (statusMessage = '') => {
        const config = normalizeInjectionConfig(window.__pmInjectionConfig || loadInjectionConfig());
        makeOverlay(`
    <div class="pm-modal pm-modal-wide pm-conversation-injection-modal">
      <div class="pm-modal-header"><button type="button" onclick="window.__pmShowConfig('home')" class="pm-modal-close" title="返回设置" aria-label="返回设置">${BACK_ICON_SVG}</button><b>正文注入</b><button type="button" onclick="window.__pmCloseOverlay()" class="pm-modal-close" title="关闭" aria-label="关闭">${CLOSE_ICON_SVG}</button></div>
      <div class="pm-modal-scroll pm-conversation-injection-body">
        <div id="pm-conversation-injection-status" class="pm-conversation-injection-status" role="status" ${statusMessage ? '' : 'hidden'}>${escapeHtml(statusMessage)}</div>
        ${promptPlacementFields('phone', '聊天', config.phone, { includeHistoryLimit: true })}
        ${promptPlacementFields('community', '社区', config.community)}
        ${promptPlacementFields('calendar', '日历与菜谱', config.calendar)}
        ${promptPlacementFields('today-trend', '今日风向', config.todayTrend)}
      </div>
      <div class="pm-modal-add pm-conversation-injection-actions"><button id="pm-conversation-injection-clear" type="button" class="pm-action-button is-secondary" onclick="window.__pmClearConversationInjection()">清除注入</button><button id="pm-conversation-injection-save" type="button" class="pm-action-button is-accent" onclick="window.__pmSaveConversationInjection()">保存并应用</button></div>
    </div>`);
        return true;
    };

    window.__pmClearConversationInjection = async () => {
        if (injectionSettingsBusy) return false;
        injectionSettingsBusy = true;
        setInjectionSettingsBusy(true, 'clear');
        try {
            const error = injectionFailure(await clearBidirectionalInjection(), '清除');
            if (error) throw error;
            window.__pmShowConversationInjection('已清除当前正文注入；保存并应用可恢复。');
            return true;
        } catch (error) {
            alert(error.message || '当前正文注入清除失败');
            return false;
        } finally {
            injectionSettingsBusy = false;
            setInjectionSettingsBusy(false);
        }
    };

    window.__pmSaveConversationInjection = async () => {
        if (injectionSettingsBusy) return false;
        injectionSettingsBusy = true;
        setInjectionSettingsBusy(true, 'save');
        const snapshot = clone(window.__pmInjectionConfig);
        window.__pmInjectionConfig = normalizeInjectionConfig({
            ...snapshot,
            phone: {
                position: document.getElementById('pm-conversation-injection-phone-position')?.value,
                depth: document.getElementById('pm-conversation-injection-phone-depth')?.value,
                historyLimit: document.getElementById('pm-conversation-injection-phone-history-limit')?.value,
            },
            community: {
                position: document.getElementById('pm-conversation-injection-community-position')?.value,
                depth: document.getElementById('pm-conversation-injection-community-depth')?.value,
            },
            calendar: {
                position: document.getElementById('pm-conversation-injection-calendar-position')?.value,
                depth: document.getElementById('pm-conversation-injection-calendar-depth')?.value,
            },
            todayTrend: {
                position: document.getElementById('pm-conversation-injection-today-trend-position')?.value,
                depth: document.getElementById('pm-conversation-injection-today-trend-depth')?.value,
            },
        });
        try {
            await commitConversationInjectionUpdate({
                persistCandidate: async () => {
                    if (!saveInjectionConfig()) throw new Error('统一注入规则保存失败：浏览器存储不可用或空间不足');
                },
                restoreSnapshot: () => { window.__pmInjectionConfig = snapshot; },
                persistSnapshot: async () => {
                    if (!saveInjectionConfig()) throw new Error('统一注入规则回滚失败');
                },
                applyInjection: () => applyBidirectionalInjection(),
            });
            const config = normalizeInjectionConfig(window.__pmInjectionConfig);
            window.__pmShowConversationInjection(`已应用：聊天 ${injectionPositionLabel(config.phone.position)}（深度 ${config.phone.depth}），社区 ${injectionPositionLabel(config.community.position)}（深度 ${config.community.depth}），日历 ${injectionPositionLabel(config.calendar.position)}（深度 ${config.calendar.depth}），今日风向 ${injectionPositionLabel(config.todayTrend.position)}（深度 ${config.todayTrend.depth}）`);
            return true;
        } catch (error) {
            alert(error.message || '统一注入规则保存失败');
            return false;
        } finally {
            injectionSettingsBusy = false;
            setInjectionSettingsBusy(false);
        }
    };
}
