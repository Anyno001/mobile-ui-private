import { HOME_ICON_SVG, MORE_ICON_SVG, PAUSE_ICON_SVG, PLAY_ICON_SVG, SPARKLES_ICON_SVG, TODAY_TREND_DYNAMICS_ICON_SVG, TODAY_TREND_FACTION_ICON_SVG, TODAY_TREND_REPUTATION_ICON_SVG, TODAY_TREND_WORLD_ICON_SVG } from './icons.js';
import { renderTodayTrendDynamicsView } from './today-trend-dynamics-view.js';
import { renderTodayTrendFactionView } from './today-trend-faction-view.js';
import { renderTodayTrendReputationView } from './today-trend-reputation-view.js';
import { renderTodayTrendSettingsView } from './today-trend-settings-view.js';
import { renderTodayTrendWorldView } from './today-trend-world-view.js';
import { trendFloorStatus, trendRuleEditor } from './today-trend-ui.js';
import { escapeAttr, escapeHtml } from './ui.js';

const moduleView = (view, props) => ({ world: renderTodayTrendWorldView, reputation: renderTodayTrendReputationView, faction: renderTodayTrendFactionView, dynamics: renderTodayTrendDynamicsView }[view.name] || renderTodayTrendWorldView)(props);

function errorFeedback(error, copyStatus = '') {
    if (!error) return '';
    const message = typeof error === 'string' ? error : String(error.message || '未知错误');
    const code = typeof error === 'object' && /^TT_[A-Z0-9_]+$/.test(String(error.code || '')) ? String(error.code) : '';
    if (!code && !copyStatus) {
        return `<p class="pm-today-trend-init-feedback pm-today-trend-error" role="alert">${escapeHtml(message)}</p>`;
    }
    const diagnostic = code
        ? `<span class="pm-today-trend-diagnostic"><code>${escapeHtml(code)}</code><button type="button" data-action="today-trend-copy-diagnostic-code" data-code="${escapeAttr(code)}">复制诊断码</button></span>`
        : '';
    const copyFeedback = copyStatus ? `<small class="pm-today-trend-diagnostic-copy-status" role="status">${escapeHtml(copyStatus)}</small>` : '';
    return `<div class="pm-today-trend-init-feedback pm-today-trend-error" role="alert" tabindex="-1"><span>${escapeHtml(message)}</span>${diagnostic}${copyFeedback}</div>`;
}

function renderFirstUse({ presets, worldBooks, error, initializing, draft = {}, assistantCount = 0, reinitializing = false, initializationMode = 'reuse' }) {
    const availableAssistantCount = Number.isSafeInteger(assistantCount) && assistantCount >= 0 ? assistantCount : 0;
    const defaultMergeAssistantCount = Math.min(5, Math.max(availableAssistantCount, 1));
    const recentAssistantCount = Number.isSafeInteger(draft.recentAssistantCount) && draft.recentAssistantCount >= 1 ? draft.recentAssistantCount : Math.max(availableAssistantCount, 1);
    const mergeAssistantCount = Math.min(Number.isSafeInteger(draft.mergeAssistantCount) && draft.mergeAssistantCount >= 1 ? draft.mergeAssistantCount : defaultMergeAssistantCount, recentAssistantCount);
    const presetOptions = presets.map(item => `<option value="${escapeAttr(item.id)}">${escapeHtml(item.name)}</option>`).join('');
    const canReusePreset = Boolean(presetOptions) && !reinitializing;
    const activeMode = canReusePreset && initializationMode === 'reuse' ? 'reuse' : 'create';
    const selectedBooks = new Set(Array.isArray(draft.worldBookNames) ? draft.worldBookNames : worldBooks);
    const books = worldBooks.map(name => `<label class="pm-today-trend-book-option"><input class="pm-today-trend-book-input" type="checkbox" name="worldBookNames" value="${escapeAttr(name)}" ${selectedBooks.has(name) ? 'checked' : ''}><i class="pm-today-trend-book-check" aria-hidden="true"></i><span>${escapeHtml(name)}</span></label>`).join('');
    const modeSwitch = canReusePreset ? `<div class="pm-today-trend-mode-switch" aria-label="预设使用方式"><button type="button" data-action="today-trend-use-preset" aria-pressed="${activeMode === 'reuse'}">复用预设</button><button type="button" data-action="today-trend-create-preset" aria-pressed="${activeMode === 'create'}">创建预设</button></div>` : '';
    const worldBookOptions = books || '<p class="pm-today-trend-empty-state" role="status">当前聊天没有可用世界书，无法初始化。</p>';
    const feedback = error ? errorFeedback(error)
        : initializing ? '<p class="pm-today-trend-init-feedback pm-today-trend-loading" role="status" aria-live="polite">正在初始化今日风向，请保持页面开启。</p>' : '';
    const cancelAction = reinitializing ? '<button class="pm-today-trend-secondary-action" type="button" data-action="today-trend-cancel-initialize">取消</button>' : '';
    const initializeSectionTitle = reinitializing ? '重新初始化配置' : '创建新预设';
    const bindPresetSection = activeMode === 'reuse' ? `<section class="pm-today-trend-init-section pm-today-trend-bind-section" aria-labelledby="pm-today-trend-bind-title"><header class="pm-today-trend-section-head"><h4 id="pm-today-trend-bind-title" class="pm-today-trend-section-title">复用已有预设</h4></header><form class="pm-today-trend-editor pm-today-trend-bind-form" data-today-trend-form="bind-preset"><label class="pm-today-trend-field"><span>已有预设</span><select class="pm-today-trend-input" name="presetId">${presetOptions}</select></label><button class="pm-today-trend-primary-action" type="submit">绑定并开始</button>${feedback}</form></section>` : '';
    const createPresetSection = activeMode === 'create' ? `<section class="pm-today-trend-init-section pm-today-trend-create-section" aria-labelledby="pm-today-trend-create-title">
            <header class="pm-today-trend-section-head"><h4 id="pm-today-trend-create-title" class="pm-today-trend-section-title">${initializeSectionTitle}</h4></header>
 <form class="pm-today-trend-editor pm-today-trend-init-form" data-today-trend-form="initialize"><label class="pm-today-trend-field"><span>预设名称</span><input class="pm-today-trend-input" name="presetName" maxlength="120" placeholder="自动推断" value="${escapeAttr(draft.presetName || '')}"></label><fieldset class="pm-today-trend-book-group"><legend>世界书（至少一本）</legend><div class="pm-today-trend-book-list">${worldBookOptions}</div></fieldset><label class="pm-today-trend-switch pm-today-trend-init-switch"><span><b>参考当前已有正文</b><small>关闭后，仅依据已选世界书、角色资料和当前追踪状态独立推演NPC群像。</small></span><input name="includeExistingChat" type="checkbox" role="switch" aria-checked="${draft.includeExistingChat !== false}" ${draft.includeExistingChat !== false ? 'checked' : ''}><i aria-hidden="true"></i></label><label class="pm-today-trend-switch pm-today-trend-init-switch"><span><b>初始化后溯及既往更新</b><small>按既有AI回复逐批生成历史状态，可能发起多次AI请求。</small></span><input name="backfillExistingChat" type="checkbox" role="switch" aria-checked="${draft.backfillExistingChat === true}" ${draft.backfillExistingChat === true ? 'checked' : ''}><i aria-hidden="true"></i></label>${draft.backfillExistingChat === true ? `<div class="pm-today-trend-batch-stats"><div class="pm-today-trend-batch-stat"><span>当前聊天AI回复累计层数</span><b>${availableAssistantCount}</b></div></div><div class="pm-today-trend-batch-fields"><label class="pm-today-trend-field"><span>手动处理最近AI回复层数</span><input class="pm-today-trend-input" name="recentAssistantCount" type="number" inputmode="numeric" min="1" max="${Math.max(availableAssistantCount, 1)}" step="1" required value="${recentAssistantCount}" ${availableAssistantCount < 1 ? 'disabled' : ''}></label><label class="pm-today-trend-field"><span>每多少层合并为一次</span><input class="pm-today-trend-input" name="mergeAssistantCount" type="number" inputmode="numeric" min="1" max="${Math.max(availableAssistantCount, 1)}" step="1" required value="${mergeAssistantCount}" ${availableAssistantCount < 1 ? 'disabled' : ''}></label></div>` : ''}<label class="pm-today-trend-field"><span>追加要求（可选）</span><textarea class="pm-today-trend-input" name="userRequirements" maxlength="600">${escapeHtml(draft.userRequirements || '')}</textarea></label><div class="pm-today-trend-form-actions pm-today-trend-init-actions"><button class="pm-today-trend-primary-action" type="submit" ${!books || initializing ? 'disabled' : ''} aria-busy="${initializing}">${initializing ? '正在初始化今日风向' : '生成'}</button>${draft.backfillExistingChat === true && availableAssistantCount >= 1 ? `<button class="pm-today-trend-secondary-action" type="submit" data-action="today-trend-initialize-and-batch" ${!books || initializing ? 'disabled' : ''}>手动批量更新</button>` : ''}${cancelAction}</div>${feedback}</form>
        </section>` : '';
    return `<main class="pm-today-trend-content"><section class="pm-today-trend-first-use" aria-label="${reinitializing ? '重新初始化当前今日风向' : '创建当前角色的今日风向'}">
        ${modeSwitch}
        ${bindPresetSection}
        ${createPresetSection}
    </section></main>`;
}

function renderRuleEditorPage(preset, rule, draft) {
    const [group, key = ''] = String(rule || '').split('-');
    const rules = group === 'dynamics' && key ? preset?.dynamicsRules : preset?.moduleRules;
    const field = group === 'dynamics' && key ? key : group;
    const value = draft ?? rules?.[field] ?? '';
    return `<main class="pm-today-trend-content pm-today-trend-rule-page"><section class="pm-today-trend-view">${trendRuleEditor({ rule, value })}</section></main>`;
}

const MODULE_TITLES = Object.freeze({ world: '今日风向', reputation: '个人风评', faction: '势力图谱', dynamics: '事件追踪', settings: '今日风向' });
const NAV_ITEMS = Object.freeze([['world', '世界', 'today-trend-open-world', TODAY_TREND_WORLD_ICON_SVG], ['reputation', '风评', 'today-trend-open-reputation', TODAY_TREND_REPUTATION_ICON_SVG], null, ['faction', '势力', 'today-trend-open-factions', TODAY_TREND_FACTION_ICON_SVG], ['dynamics', '事件', 'today-trend-open-dynamics', TODAY_TREND_DYNAMICS_ICON_SVG]]);

export function renderTodayTrendApp({ scope = null, presets = [], worldBooks = [], view = { name: 'world', mode: 'content' }, generation = {}, currentFloor, assistantCount = 0, batchDraft = {},
    error = null, initializing = false, initializationDraft, initializationOpen = false, reinitializing = false, initializationMode = 'reuse',
    detailById = {}, loadingDetailIds = new Set(), retentionRevisions = null, retentionSaving = false, retentionDraft = null,
    diagnosticCopyStatus = '', changes = null } = {}) {
    const busy = ['queued', 'generating', 'parsing', 'committing'].includes(generation.phase);
    const syncedFloor = Number.isInteger(scope?.operation?.lastSuccessfulAssistantCount) && scope.operation.lastSuccessfulAssistantCount >= 0
        ? scope.operation.lastSuccessfulAssistantCount : 0;
    const taskIsCurrent = generation.task?.storageId === scope?.storageId;
    const targeted = taskIsCurrent && Boolean(generation.task?.target);
    const batchProgress = taskIsCurrent && !targeted ? generation.task : null;
    const floorStatus = trendFloorStatus({
        currentFloor,
        syncedFloor,
        phase: taskIsCurrent ? generation.phase : 'idle',
        lastError: taskIsCurrent ? generation.lastError : null,
        completedBatchFloor: batchProgress?.batchCount ? syncedFloor : null,
        busy: busy && taskIsCurrent,
        targetFloor: taskIsCurrent && !targeted ? generation.task?.floor : null,
        batchIndex: batchProgress?.batchIndex,
        batchCount: batchProgress?.batchCount,
        targeted,
    });
    const preset = presets.find(item => item.id === scope?.presetId) || null;
    const ready = scope && !initializationOpen;
    const content = view.name === 'settings' ? `<main class="pm-today-trend-content">${renderTodayTrendSettingsView({ scope, presets, generationBusy: busy, menuOpenId: view.menuOpenId, assistantCount, batchDraft,
        generation, retentionRevisions, retentionSaving, retentionDraft, errorHtml: errorFeedback(error, diagnosticCopyStatus) })}</main>` : !ready ? renderFirstUse({ presets, worldBooks, error, initializing, draft: initializationDraft, assistantCount, reinitializing, initializationMode }) : view.editingRule
        ? renderRuleEditorPage(preset, view.editingRule, view.ruleDraft)
        : `<main class="pm-today-trend-content is-${view.name}${scope.injection?.minimalUi ? ' is-minimal-ui' : ''}">${moduleView(view, { scope, mode: view.mode, detailId: view.detailId, selectedCircleId: view.selectedCircleId, changes, dynamicsTab: view.dynamicsTab, editingWorldItemId: view.editingWorldItemId, editingCircleId: view.editingCircleId, editingFactionId: view.editingFactionId, editingEventId: view.editingEventId, menuOpenId: view.menuOpenId, generationAvailable: !busy, generationBusy: busy, detailById, loadingDetailIds })}</main>`;
    const changeCount = ready && Number.isSafeInteger(changes?.count) && changes.count > 0 ? `<span class="pm-today-trend-header-changes">较上次 ${changes.count} 处变化</span>` : '';
    // 楼层与变化只在内容页显示；设置、编辑表单与提示词页不显示。
    const showFloor = ready && view.name !== 'settings' && !view.editingRule && view.mode === 'content' && !view.editingWorldItemId && !view.editingEventId && !view.editingCircleId;
    const title = !ready ? '今日风向' : MODULE_TITLES[view.name] || MODULE_TITLES.world;
    const operationOn = scope?.operation?.enabled === true;
    const toggle = ready ? `<button type="button" class="pm-today-trend-header-control" data-action="today-trend-toggle-operation" ${busy ? 'disabled' : ''} aria-pressed="${operationOn}" aria-label="${operationOn ? '暂停自动更新' : '开启自动更新'}" title="${operationOn ? '暂停自动更新' : '开启自动更新'}">${operationOn ? PAUSE_ICON_SVG : PLAY_ICON_SVG}</button>` : '';
    const settings = `<button type="button" class="pm-today-trend-header-control" data-action="today-trend-open-settings" aria-label="APP总设置" title="APP总设置" aria-pressed="${view.name === 'settings'}">${MORE_ICON_SVG}</button>`;
    const presetName = ready && preset?.name ? `<span class="pm-today-trend-header-preset">${escapeHtml(preset.name)}</span>` : '';
    const headerSub = presetName || showFloor ? `<span class="pm-today-trend-header-status">${presetName}${showFloor ? `${floorStatus}${changeCount}` : ''}</span>` : '';
    const header = `<header class="pm-today-trend-header"><span class="pm-today-trend-seal" aria-hidden="true">风</span><div class="pm-today-trend-heading"><div class="pm-today-trend-title-row"><h1>${escapeHtml(title)}</h1>${toggle}</div>${headerSub}</div><span class="pm-today-trend-header-actions">${settings}</span><button type="button" class="pm-today-trend-home" data-today-trend-ui-action="home" aria-label="返回桌面" title="返回桌面">${HOME_ICON_SVG}</button></header>`;
    const navigation = ready && !view.editingRule ? `<nav class="pm-today-trend-tabs" aria-label="今日风向模块">${NAV_ITEMS.map(item => item
        ? `<button type="button" data-action="${item[2]}" aria-pressed="${view.name === item[0]}">${item[3]}<span>${item[1]}</span></button>`
        : `<button type="button" class="pm-today-trend-fab" data-action="today-trend-generate-all" ${busy ? 'disabled' : ''} aria-busy="${busy}" aria-label="手动更新所有今日风向" title="手动更新所有今日风向">${SPARKLES_ICON_SVG}</button>`).join('')}</nav>` : '';
    return `<section id="pm-today-trend-app" class="pm-today-trend-shell${navigation ? ' has-tabs' : ''}" aria-label="今日风向">${header}${content}${navigation}</section>`;
}
