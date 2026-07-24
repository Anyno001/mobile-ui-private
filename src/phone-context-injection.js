import { EXTENSION_PROMPT_POSITIONS, MAX_INJECTION_DEPTH } from './constants.js';
import { normalizeInjectionConfig } from './behavior-config.js';
import { resolveConversationTarget } from './conversation.js';
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

function currentPhoneInjectionFailure(result, target) {
    if (!target) return null;
    const diagnostics = result?.diagnostics;
    if (!diagnostics) return new Error('手机短信记录未能应用，请重试。');
    const phone = diagnostics.phone || {};
    const permission = diagnostics.phonePermission || {};
    if (!permission.allowed) return new Error('手机短信记录未能应用：当前会话数据不可用。');
    if (permission.sourceCount < 1) {
        return new Error(target.isGroup
            ? '手机短信记录未能应用：当前角色不在该群聊中，或群聊记录为空。'
            : '手机短信记录未能应用：当前角色没有可匹配的短信记录。');
    }
    if (phone.allocatedTokens < 1) return new Error('手机短信记录未能应用：手机会话预算为 0。');
    if (phone.promptCount < 1) return new Error('手机短信记录未能应用：最近消息没有可注入内容。');
    if ((result.writtenBySource?.phone || 0) < phone.promptCount) {
        return new Error('手机短信记录未能应用：宿主未接受短信上下文。');
    }
    return null;
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

export function installPhoneContextInjection(state, deps) {
    const { getStorageId, makeOverlay, applyBidirectionalInjection } = deps;
    let injectionToggleQueue = Promise.resolve();

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

    const toggleTargetInjection = async (target, { validateCurrent = false } = {}) => {
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
            validateResult: result => validateCurrent && isEnabled(target)
                ? currentPhoneInjectionFailure(result, target) : null,
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
        return `${injectionPositionLabel(config.position)} · 深度 ${config.depth} · 最近 ${config.historyLimit} 条`;
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
            return await enqueueToggle(() => toggleTargetInjection(target, { validateCurrent: true }));
        } catch (error) {
            alert(error.message || '当前会话注入开关保存失败');
            return false;
        }
    };

    window.__pmShowConversationInjection = (statusMessage = '') => {
        const config = normalizeInjectionConfig(window.__pmInjectionConfig || loadInjectionConfig());
        makeOverlay(`
    <div class="pm-modal pm-modal-wide pm-conversation-injection-modal">
      <div class="pm-modal-header"><button type="button" onclick="window.__pmShowConfig('home')" class="pm-modal-close" title="返回设置" aria-label="返回设置">${BACK_ICON_SVG}</button><b>正文注入规则</b><button type="button" onclick="window.__pmCloseOverlay()" class="pm-modal-close" title="关闭" aria-label="关闭">${CLOSE_ICON_SVG}</button></div>
      <div class="pm-modal-scroll pm-conversation-injection-body">
        <div class="pm-cfg-tip pm-conversation-injection-note">会话是否启用注入请在聊天标题的联系人列表中切换；这里统一设置所有私聊与群聊的位置、深度和消息范围。</div>
        <div id="pm-conversation-injection-status" class="pm-conversation-injection-status" role="status" ${statusMessage ? '' : 'hidden'}>${escapeHtml(statusMessage)}</div>
        <label class="pm-conversation-injection-field">注入位置
          <select id="pm-conversation-injection-position" class="pm-cfg-input pm-conversation-injection-config">
            <option value="0" ${config.position === 0 ? 'selected' : ''}>主提示词内</option>
            <option value="1" ${config.position === 1 ? 'selected' : ''}>聊天记录内</option>
            <option value="2" ${config.position === 2 ? 'selected' : ''}>主提示词前</option>
          </select>
        </label>
        <label class="pm-conversation-injection-field">注入深度（0-${MAX_INJECTION_DEPTH}）
          <input id="pm-conversation-injection-depth" class="pm-cfg-input pm-conversation-injection-config" type="number" min="0" max="${MAX_INJECTION_DEPTH}" value="${config.depth}">
        </label>
        <label class="pm-conversation-injection-field">最近消息范围
          <input id="pm-conversation-injection-limit" class="pm-cfg-input pm-conversation-injection-config" type="number" min="1" max="100" value="${config.historyLimit}">
        </label>
      </div>
      <div class="pm-modal-add pm-conversation-injection-actions"><button id="pm-conversation-injection-save" type="button" class="pm-action-button" onclick="window.__pmSaveConversationInjection()">保存并应用</button></div>
    </div>`);
        return true;
    };

    window.__pmSaveConversationInjection = async () => {
        const saveButton = document.getElementById('pm-conversation-injection-save');
        if (saveButton?.disabled) return false;
        if (saveButton) {
            saveButton.disabled = true;
            saveButton.textContent = '保存并应用中…';
        }
        const snapshot = clone(window.__pmInjectionConfig);
        window.__pmInjectionConfig = normalizeInjectionConfig({
            position: document.getElementById('pm-conversation-injection-position')?.value,
            depth: document.getElementById('pm-conversation-injection-depth')?.value,
            historyLimit: document.getElementById('pm-conversation-injection-limit')?.value,
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
                validateResult: result => {
                    const target = currentTarget();
                    return target && isEnabled(target) ? currentPhoneInjectionFailure(result, target) : null;
                },
            });
            const config = normalizeInjectionConfig(window.__pmInjectionConfig);
            window.__pmShowConversationInjection(`已应用到${injectionPositionLabel(config.position)}（深度 ${config.depth}）`);
            return true;
        } catch (error) {
            alert(error.message || '统一注入规则保存失败');
            return false;
        } finally {
            if (saveButton?.isConnected) {
                saveButton.disabled = false;
                saveButton.textContent = '保存并应用';
            }
        }
    };
}
