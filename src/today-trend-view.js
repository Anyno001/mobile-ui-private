import { CLOSE_ICON_SVG, HOME_ICON_SVG, MORE_ICON_SVG, PAUSE_ICON_SVG, PLAY_ICON_SVG, TODAY_TREND_DYNAMICS_ICON_SVG, TODAY_TREND_FACTION_ICON_SVG, TODAY_TREND_REPUTATION_ICON_SVG, TODAY_TREND_WORLD_ICON_SVG } from './icons.js';
import { renderTodayTrendDynamicsView } from './today-trend-dynamics-view.js';
import { renderTodayTrendFactionView } from './today-trend-faction-view.js';
import { renderTodayTrendReputationView } from './today-trend-reputation-view.js';
import { renderTodayTrendSettingsView } from './today-trend-settings-view.js';
import { renderTodayTrendWorldView } from './today-trend-world-view.js';
import { escapeAttr, escapeHtml } from './ui.js';

const moduleView = (view, props) => ({ world: renderTodayTrendWorldView, reputation: renderTodayTrendReputationView, faction: renderTodayTrendFactionView, dynamics: renderTodayTrendDynamicsView }[view.name] || renderTodayTrendWorldView)(props);

function renderFirstUse({ presets, worldBooks, error, initializing, draft = {}, reinitializing = false }) {
    const presetOptions = presets.map(item => `<option value="${escapeAttr(item.id)}">${escapeHtml(item.name)}</option>`).join('');
    const selectedBooks = new Set(Array.isArray(draft.worldBookNames) ? draft.worldBookNames : worldBooks);
    const books = worldBooks.map(name => `<label class="pm-today-trend-book-option"><input type="checkbox" name="worldBookNames" value="${escapeAttr(name)}" ${selectedBooks.has(name) ? 'checked' : ''}><span>${escapeHtml(name)}</span></label>`).join('');
    const bindPresetSection = presetOptions && !reinitializing ? `<section class="pm-today-trend-init-section pm-today-trend-bind-section" aria-labelledby="pm-today-trend-bind-title"><header class="pm-today-trend-section-head"><h4 id="pm-today-trend-bind-title" class="pm-today-trend-section-title">复用已有预设</h4><p class="pm-today-trend-section-help">直接绑定已保存的世界预设，无需重新生成。</p></header><form class="pm-today-trend-editor pm-today-trend-bind-form" data-today-trend-form="bind-preset"><label class="pm-today-trend-field"><span>已有预设</span><select class="pm-today-trend-input" name="presetId">${presetOptions}</select></label><button class="pm-today-trend-primary-action" type="submit">绑定并开始</button></form></section>` : '';
    const worldBookOptions = books || '<p class="pm-today-trend-empty-state" role="status">当前聊天没有可用世界书，无法初始化。</p>';
    const feedback = error
        ? `<p class="pm-today-trend-init-feedback pm-today-trend-error" role="alert">${escapeHtml(error)}</p>`
        : initializing ? '<p class="pm-today-trend-init-feedback pm-today-trend-loading" role="status" aria-live="polite">正在初始化今日风向，请保持页面开启。</p>' : '';
    const cancelAction = reinitializing ? '<button class="pm-today-trend-secondary-action" type="button" data-action="today-trend-cancel-initialize">取消</button>' : '';
    const initializeSectionTitle = reinitializing ? '重新初始化配置' : '创建新预设';
    return `<main class="pm-today-trend-content"><section class="pm-today-trend-first-use" aria-labelledby="pm-today-trend-init-title">
        <header class="pm-today-trend-init-intro">
            <p class="pm-today-trend-init-eyebrow">WORLD SIGNAL</p>
            <h3 id="pm-today-trend-init-title" class="pm-today-trend-init-title">${reinitializing ? '重新初始化当前今日风向' : '创建当前角色的今日风向'}</h3>
            <p class="pm-today-trend-init-description">选择世界书后，一次生成四个模块的规则与初始资料。</p>
        </header>
        ${bindPresetSection}
        <section class="pm-today-trend-init-section pm-today-trend-create-section" aria-labelledby="pm-today-trend-create-title">
            <header class="pm-today-trend-section-head"><h4 id="pm-today-trend-create-title" class="pm-today-trend-section-title">${initializeSectionTitle}</h4><p class="pm-today-trend-section-help">选择资料来源，并按需补充生成要求。</p></header>
            <form class="pm-today-trend-editor pm-today-trend-init-form" data-today-trend-form="initialize"><label class="pm-today-trend-field"><span>预设名称（可选）</span><input class="pm-today-trend-input" name="presetName" maxlength="120" placeholder="自动推断" value="${escapeAttr(draft.presetName || '')}"></label><fieldset class="pm-today-trend-book-group"><legend>世界书（至少一本）</legend><p class="pm-today-trend-field-help">用于建立今日风向规则与初始资料。</p><div class="pm-today-trend-book-list">${worldBookOptions}</div></fieldset><label class="pm-today-trend-switch pm-today-trend-init-switch"><span>参考当前已有正文</span><input name="includeExistingChat" type="checkbox" role="switch" aria-checked="${draft.includeExistingChat !== false}" ${draft.includeExistingChat !== false ? 'checked' : ''}><i aria-hidden="true"></i></label><label class="pm-today-trend-field"><span>追加要求（可选）</span><textarea class="pm-today-trend-input" name="userRequirements" maxlength="600">${escapeHtml(draft.userRequirements || '')}</textarea></label><div class="pm-today-trend-form-actions pm-today-trend-init-actions"><button class="pm-today-trend-primary-action" type="submit" ${!books || initializing ? 'disabled' : ''} aria-busy="${initializing}">${initializing ? '正在初始化今日风向' : '生成'}</button>${cancelAction}</div>${feedback}</form>
        </section>
    </section></main>`;
}

export function renderTodayTrendApp({ scope = null, presets = [], worldBooks = [], view = { name: 'world', mode: 'content' }, generation = {}, error = null, initializing = false, initializationDraft, initializationOpen = false, reinitializing = false } = {}) {
    const busy = ['queued', 'generating', 'parsing', 'committing'].includes(generation.phase);
    const preset = presets.find(item => item.id === scope?.presetId) || null;
    const content = !scope || initializationOpen ? renderFirstUse({ presets, worldBooks, error, initializing, draft: initializationDraft, reinitializing }) : view.name === 'settings'
        ? `<main class="pm-today-trend-content">${renderTodayTrendSettingsView({ scope, presets, generationBusy: busy, menuOpenId: view.menuOpenId })}</main>`
        : `<main class="pm-today-trend-content${view.mode === 'content' ? ` is-${view.name}` : ''}">${moduleView(view, { scope, preset, mode: view.mode, editingWorldItemId: view.editingWorldItemId, editingCircleId: view.editingCircleId, editingFactionId: view.editingFactionId, editingEventId: view.editingEventId, editingRule: view.editingRule, ruleDraft: view.ruleDraft, menuOpenId: view.menuOpenId, generationAvailable: !busy, generationBusy: busy })}</main>`;
    const navigation = scope && !initializationOpen ? `<nav class="pm-today-trend-tabs${view.name === 'world' ? ' is-world' : ''}" aria-label="今日风向模块">${[['world','世界态势',TODAY_TREND_WORLD_ICON_SVG],['reputation','个人风评',TODAY_TREND_REPUTATION_ICON_SVG],['faction','势力图谱',TODAY_TREND_FACTION_ICON_SVG],['dynamics','事件追踪',TODAY_TREND_DYNAMICS_ICON_SVG]].map(([name,label,icon]) => `<button type="button" data-action="today-trend-open-${name === 'faction' ? 'factions' : name}" aria-label="${label}" aria-pressed="${view.name === name}">${icon}</button>`).join('')}<button type="button" data-action="today-trend-open-settings" aria-label="APP 总设置" aria-pressed="${view.name === 'settings'}">${MORE_ICON_SVG}</button></nav>` : '';
    return `<section id="pm-today-trend-app" class="pm-today-trend-shell" aria-labelledby="pm-today-trend-title"><header class="pm-today-trend-header"><button type="button" class="pm-today-trend-home" data-today-trend-ui-action="home" aria-label="返回桌面" title="返回桌面">${HOME_ICON_SVG}</button><h2 id="pm-today-trend-title">今日风向</h2><span class="pm-today-trend-header-actions"><button type="button" class="pm-today-trend-header-control" data-action="today-trend-toggle-operation" ${!scope || busy ? 'disabled' : ''} aria-pressed="${scope?.operation?.enabled === true}" aria-label="${scope?.operation?.enabled ? '暂停运作' : '开始运作'}">${scope?.operation?.enabled ? PAUSE_ICON_SVG : PLAY_ICON_SVG}</button><button type="button" class="pm-today-trend-close" data-today-trend-ui-action="close" aria-label="关闭手机" title="关闭手机">${CLOSE_ICON_SVG}</button></span></header>${content}${navigation}</section>`;
}
