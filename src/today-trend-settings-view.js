import { BACK_ICON_SVG, EDIT_ICON_SVG, REFRESH_ICON_SVG } from './icons.js';
import { escapeAttr, escapeHtml } from './ui.js';
import { trendActionMenu, trendModuleHead } from './today-trend-ui.js';

function batchSettingsGroup(scope, assistantCount, generationBusy, generation = {}, batchDraft = {}) {
    const count = Number.isSafeInteger(assistantCount) && assistantCount >= 0 ? assistantCount : 0;
    const disabled = generationBusy || count < 1;
    const defaultMerge = Math.min(5, Math.max(count, 1));
    const batchEnabled = batchDraft.enabled === true;
    const recentAssistantCount = Number.isSafeInteger(batchDraft.recentAssistantCount) ? batchDraft.recentAssistantCount : 1;
    const mergeAssistantCount = Number.isSafeInteger(batchDraft.mergeAssistantCount) ? batchDraft.mergeAssistantCount : defaultMerge;
    const synced = Number.isSafeInteger(scope?.operation?.lastSuccessfulAssistantCount) && scope.operation.lastSuccessfulAssistantCount >= 0
        ? Math.min(scope.operation.lastSuccessfulAssistantCount, count) : 0;
    const pending = Math.max(0, count - synced);
    const failedBatch = generation.phase === 'failed' && generation.task?.storageId === scope?.storageId
        && Number.isSafeInteger(generation.task?.batchIndex) && Number.isSafeInteger(generation.task?.batchCount)
        ? `第 ${generation.task.batchIndex + 1}/${generation.task.batchCount} 批失败：${String(generation.lastError || '未知错误')}` : '';
    const details = batchEnabled ? `
        <div class="pm-today-trend-batch-stats">
            <div class="pm-today-trend-batch-stat"><span>当前聊天 AI 回复累计层数</span><b>${count}</b></div>
            <div class="pm-today-trend-batch-stat"><span>已成功更新</span><b>${synced}</b></div>
            <div class="pm-today-trend-batch-stat"><span>当前未更新的 AI 回复累计层数</span><b>${pending}</b></div>
        </div>
        <div class="pm-today-trend-batch-fields">
            <label class="pm-today-trend-field"><span>手动处理最近AI回复层数</span><input class="pm-today-trend-input" name="recentAssistantCount" type="number" inputmode="numeric" min="1" max="${Math.max(count, 1)}" step="1" required value="${recentAssistantCount}" ${disabled ? 'disabled' : ''}></label>
            <label class="pm-today-trend-field"><span>每多少层合并为一次</span><input class="pm-today-trend-input" name="mergeAssistantCount" type="number" inputmode="numeric" min="1" max="${Math.max(count, 1)}" step="1" required value="${mergeAssistantCount}" ${disabled ? 'disabled' : ''}></label>
        </div>
        ${failedBatch ? `<p class="pm-today-trend-error" role="alert">${escapeHtml(failedBatch)}。已成功批次已保留；可按未更新累计层数重填后继续。</p>` : ''}
        <div class="pm-today-trend-form-actions pm-today-trend-batch-actions"><button type="button" data-action="today-trend-batch-generate" ${disabled ? 'disabled' : ''}>${generationBusy ? '正在批量更新' : '手动批量更新'}</button></div>` : '';
    return `<fieldset class="pm-today-trend-batch-settings"><legend>溯及既往楼层更新</legend>
        <label class="pm-today-trend-switch pm-today-trend-batch-switch"><span><b>启用</b><small>开启后可按下方参数手动批量更新历史楼层。</small></span><input name="batchEnabled" type="checkbox" role="switch" aria-checked="${batchEnabled === true}"${batchEnabled ? ' checked' : ''}${generationBusy ? ' disabled' : ''}><i aria-hidden="true"></i></label>${details}
    </fieldset>`;
}

function retentionSettingsGroup(scope, revisions, saving, generationBusy, draft) {
    const settings = scope.historyRetentionSettings || {
        archivedDetailLatestEventCount: 2, archivedDetailRetentionFloors: 20, revision: 1,
    };
    const nValue = draft?.archivedDetailLatestEventCount ?? String(settings.archivedDetailLatestEventCount);
    const lValue = draft?.archivedDetailRetentionFloors ?? String(settings.archivedDetailRetentionFloors);
    const available = Number.isSafeInteger(revisions?.scopeRevision) && revisions.scopeRevision >= 0
        && Number.isSafeInteger(revisions?.settingsRevision) && revisions.settingsRevision >= 1;
    const disabled = saving || generationBusy || !available;
    return `<fieldset class="pm-today-trend-retention-settings"><legend>事件追踪归档数据保留设置</legend>
        <p class="pm-today-trend-retention-help">默认保留最近 2 个归档事件，或最近 20 楼内归档的事件。</p>
        <div class="pm-today-trend-retention-fields"><label class="pm-today-trend-field"><span>保留归档事件数</span><input class="pm-today-trend-input" name="archivedDetailLatestEventCount" type="number" inputmode="numeric" min="0" max="80" step="1" required value="${escapeAttr(nValue)}" ${disabled ? 'disabled' : ''}></label>
        <label class="pm-today-trend-field"><span>保留楼层数</span><input class="pm-today-trend-input" name="archivedDetailRetentionFloors" type="number" inputmode="numeric" min="0" max="1000" step="1" required value="${escapeAttr(lValue)}" ${disabled ? 'disabled' : ''}></label></div>
        <input type="hidden" name="expectedScopeRevision" value="${available ? escapeAttr(String(revisions.scopeRevision)) : ''}"><input type="hidden" name="expectedSettingsRevision" value="${available ? escapeAttr(String(revisions.settingsRevision)) : ''}">
        <div class="pm-today-trend-form-actions pm-today-trend-retention-save"><button type="submit" ${disabled ? 'disabled' : ''} aria-busy="${saving}">${saving ? '正在保存' : '保存'}</button></div>
        ${available ? '' : '<p class="pm-today-trend-retention-unavailable" role="status">暂时无法保存，请重新打开本页后重试。</p>'}
    </fieldset>`;
}

export function renderTodayTrendSettingsView({ scope = null, presets = [], generationBusy = false, menuOpenId = null,
    retentionRevisions = null, retentionSaving = false, retentionDraft = null, errorHtml = '', assistantCount = 0, generation = {}, batchDraft = {} } = {}) {
    if (!scope) return '<section class="pm-today-trend-settings"><h3>APP 总设置</h3><p class="pm-today-trend-empty">请先创建或绑定世界预设。</p></section>';
    const options = presets.map(preset => `<option value="${escapeAttr(preset.id)}" ${preset.id === scope.presetId ? 'selected' : ''}>${escapeHtml(preset.name)}</option>`).join('');
    const rules = [['world', '世界态势规则'], ['reputation', '个人风评规则'], ['faction', '势力图谱规则'], ['dynamics', '动态总规则'], ['incident', '突发事件规则'], ['rumor', '流言蜚语规则'], ['underground', '地下线规则']].map(([name, label]) => `<div class="pm-today-trend-rule-row"><span>${label}</span>${trendActionMenu({ id: `app-rule:${name}`, open: menuOpenId === `app-rule:${name}`, label: `${label}操作`, actions: [{ action: `today-trend-edit-${name}-rule`, icon: EDIT_ICON_SVG, label: `编辑${label}`, attrs: 'data-rule-return="settings"' }, { action: `today-trend-regenerate-${name}-rule`, icon: REFRESH_ICON_SVG, label: `重新生成${label}` }] })}</div>`).join('');
    return `<section class="pm-today-trend-settings">${trendModuleHead({ title: 'APP 总设置', menuId: 'app-settings', menuOpenId, actions: [{ action: 'today-trend-close-settings', icon: BACK_ICON_SVG, label: '返回今日风向' }] })}${errorHtml}<form class="pm-today-trend-editor" data-today-trend-form="app-settings"><label class="pm-today-trend-field">当前世界预设<select class="pm-today-trend-input" name="presetId">${options}</select></label><p class="pm-today-trend-preset-warning">切换世界预设会重建当前作用域。切换完成后请重新打开本页，再单独确认归档保留设置。</p><div class="pm-today-trend-form-actions pm-today-trend-preset-actions"><button type="button" data-action="today-trend-new-preset">新建</button><button type="button" data-action="today-trend-delete-preset">删除</button><button type="button" data-action="today-trend-reinitialize">重建</button><button type="button" data-action="today-trend-rename-preset">重命名</button></div><label class="pm-today-trend-field">调用方式<select class="pm-today-trend-input" name="mode"><option value="manual" ${scope.operation?.mode === 'manual' ? 'selected' : ''}>手动</option><option value="auto" ${scope.operation?.mode === 'auto' ? 'selected' : ''}>自动</option></select></label><label class="pm-today-trend-field">自动调用：每 N 楼执行一次<input class="pm-today-trend-input" name="intervalFloors" type="number" min="1" max="1000" required value="${escapeAttr(String(scope.operation?.intervalFloors || 1))}"></label><label class="pm-today-trend-switch pm-today-trend-injection-switch"><span><b>正文注入</b><small>开启后，角色回复时会参考当前会话中的今日风向。</small></span><input name="injectionEnabled" type="checkbox" role="switch" aria-checked="${scope.injection?.enabled === true}"${scope.injection?.enabled ? ' checked' : ''}><i aria-hidden="true"></i></label><label class="pm-today-trend-switch pm-today-trend-minimal-ui-switch"><span><b>极简 UI</b><small>开启后，通过关系图标切换状态并隐藏关系量表。</small></span><input name="minimalUi" type="checkbox" role="switch" aria-checked="${scope.injection?.minimalUi === true}"${scope.injection?.minimalUi ? ' checked' : ''}><i aria-hidden="true"></i></label><div class="pm-today-trend-form-actions pm-today-trend-settings-save"><button type="submit">保存设置</button></div></form><form class="pm-today-trend-editor" data-today-trend-form="batch-settings">${batchSettingsGroup(scope, assistantCount, generationBusy, generation, batchDraft)}</form><form class="pm-today-trend-editor" data-today-trend-form="retention-settings">${retentionSettingsGroup(scope, retentionRevisions, retentionSaving, generationBusy, retentionDraft)}</form><section class="pm-today-trend-rule"><h3>提示词总览</h3>${rules}</section></section>`;
}
