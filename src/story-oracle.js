import { generationErrorMessage } from './ai.js';
import { BOOK_ICON_SVG, CHEVRON_DOWN_ICON_SVG, CLOSE_ICON_SVG, CONTROL_ICON_SVG, HOME_ICON_SVG, MORE_ICON_SVG, PAUSE_ICON_SVG, PLAY_ICON_SVG, REMOVE_ICON_SVG, SEND_ICON_SVG, SETTINGS_ICON_SVG, TRASH_ICON_SVG } from './icons.js';
import { escapeAttr, escapeHtml, renderBoldText } from './ui.js';
import {
    appendStoryOracleTurn, clearStoryOraclePlans, clearStoryOracleScope,
    parseStoryPlans, removeStoryOraclePlan, setStoryOraclePlanEnabled, setStoryOracleSettings, setStoryOracleWorldBookSelection,
    storyOracleMessages, storyOraclePlans, storyOracleSettings, storyOracleWorldBookSelection, stripStoryPlanMarkup, DEFAULT_STORY_ORACLE_SYSTEM_PROMPT, STORY_ORACLE_MODES,
} from './story-oracle-model.js';
import { loadStoryOracleStore, saveStoryOracleStore } from './story-oracle-storage.js';
import { getReadableWorldBookNames } from './worldbook-config.js';

const MAX_QUESTION_CHARS = 12000;
const DEFAULT_ORACLE_SETTINGS = Object.freeze({ systemPrompt: DEFAULT_STORY_ORACLE_SYSTEM_PROMPT });
const isUsableStorageId = value => { const id = String(value || '').trim(); return id && id !== 'sms_unknown__default'; };
const MODE_LABELS = Object.freeze({ question: '剧情聊天', advisor: '剧情参谋' });
const ADVISOR_OUTPUT_CONTRACT = '你当前是「故事神谕」的剧情参谋。基于已有剧情讨论接下来可以怎么走，提出贴合上下文、可执行的方案；不要续写成正文，不要声称已经修改宿主数据。需要给出具体路线时，把每条可选路线分别放进独立的 <StoryPlan>...</StoryPlan> 区块；每个区块必须包含“标题：”和“目标：”，并可包含“起始迹象：”“契合点：”“剧情推进速度：”（例如快、中、慢）。不要把多条路线合并到同一个区块；区块外只能保留简短引导说明。';

export function storyOracleInjectionIssue(result) {
    const diagnostics = result?.diagnostics?.storyOracle;
    if (diagnostics?.rejected) return diagnostics.rejected;
    const expectedPrompts = Math.max(0, Number(diagnostics?.promptCount) || 0);
    if (expectedPrompts > 0) {
        if (!result) return '宿主注入接口不可用。';
        const written = Math.max(0, Number(result.writtenBySource?.storyOracle) || 0);
        const failed = Math.max(0, Number(result.failedWritesBySource?.storyOracle) || 0);
        if (written < expectedPrompts) {
            return failed > 0
                ? `宿主扩展提示写入失败（${failed} 条）。`
                : '宿主扩展提示接口不可用或未写入剧情线路。';
        }
    }
    if (Array.isArray(result?.failedKeys) && result.failedKeys.length) return '旧的扩展提示清理失败。';
    return '';
}

function renderStoryOraclePlans(plans = [], writable = true, expandedPlanIds = new Set(), focusedSourceId = '', openPlanMenuId = '') {
    const sortedPlans = [...plans].sort((a, b) => b.createdAt - a.createdAt || b.order - a.order || b.id.localeCompare(a.id));
    const remainingPlans = sortedPlans;
    if (!remainingPlans.length) return '';
    return `<section class="pm-story-oracle-plan-workbench" aria-label="路线工作台">${remainingPlans.map(plan => renderStoryOraclePlan(plan, writable, expandedPlanIds.has(plan.id), focusedSourceId === plan.sourceMessageId, openPlanMenuId === plan.id)).join('')}</section>`;
}

function renderStoryOraclePlan(plan, writable = true, expanded = false, focused = false, menuOpen = false) {
    const details = expanded ? `<div class="pm-story-oracle-plan-details"><span>起始迹象：${escapeHtml(plan.seed || '未提供')}</span><span>契合点：${escapeHtml(plan.why || '未提供')}</span></div>` : '';
    return `<article class="pm-story-oracle-plan-bubble" data-story-oracle-plan-id="${escapeAttr(plan.id)}" aria-label="剧情线路：${escapeAttr(plan.title || plan.goal || '未命名线路')}">
      <div class="pm-story-oracle-plan-head"><button type="button" class="pm-story-oracle-plan-status ${plan.enabled ? 'is-active' : ''}" data-story-oracle-action="toggle-plan" data-story-oracle-plan-id="${escapeAttr(plan.id)}" aria-pressed="${plan.enabled ? 'true' : 'false'}" aria-label="${plan.enabled ? '停止引导' : '开始引导'}" title="${plan.enabled ? '停止引导' : '开始引导'}" ${writable ? '' : 'disabled'}>${plan.enabled ? PAUSE_ICON_SVG : PLAY_ICON_SVG}</button><button type="button" class="pm-story-oracle-plan-toggle" data-story-oracle-action="toggle-plan-details" data-story-oracle-plan-id="${escapeAttr(plan.id)}" aria-expanded="${expanded ? 'true' : 'false'}"><b>${escapeHtml(plan.title || plan.goal || '未命名线路')}</b></button><button type="button" class="pm-story-oracle-plan-more" data-story-oracle-action="toggle-plan-menu" data-story-oracle-plan-id="${escapeAttr(plan.id)}" aria-haspopup="menu" aria-expanded="${menuOpen ? 'true' : 'false'}" aria-label="线路操作" title="线路操作">${MORE_ICON_SVG}</button><div class="pm-story-oracle-plan-menu pm-control-menu" role="menu" ${menuOpen ? '' : 'hidden'}>
        <button type="button" role="menuitem" data-story-oracle-action="continue-plan" data-story-oracle-plan-id="${escapeAttr(plan.id)}">继续讨论</button>
        <button type="button" class="pm-control-menu-danger" role="menuitem" data-story-oracle-action="delete-plan" data-story-oracle-plan-id="${escapeAttr(plan.id)}" ${writable ? '' : 'disabled'}>删除线路</button>
      </div></div>
      <span>目标：${escapeHtml(plan.goal || plan.title || '')}</span>
      ${plan.pace ? `<span>推进速度：${escapeHtml(plan.pace)}</span>` : ''}
      ${details}
    </article>`;
}

function renderMessages(messages, plans = [], writable = true) {
    if (!messages.length) return '';
    const messageMarkup = messages.map(message => {
        const parsed = message.role === 'assistant' ? parseStoryPlans(message.content) : null;
        const content = parsed?.plans?.length ? stripStoryPlanMarkup(message.content) : message.content;
        return `<div class="pm-story-oracle-message ${message.role === 'user' ? 'is-user' : 'is-assistant'}"><div class="pm-bubble">${renderBoldText(content)}</div></div>`;
    }).join('');
    return messageMarkup;
}

function renderStoryOracleTools(valid, writable, plans, messages, availableBookNames, settings) {
    const worldBookAvailable = Boolean(valid);
    const clearPlansAvailable = Boolean(plans.length && writable);
    const clearHistoryAvailable = Boolean(messages.length && writable);
    const worldBookLabel = '选择世界书';
    return `<div class="pm-story-oracle-menu-wrap">
      <button type="button" class="pm-expand-btn pm-story-oracle-menu-toggle" data-story-oracle-action="toggle-menu" aria-haspopup="menu" aria-expanded="false" aria-controls="pm-story-oracle-menu" aria-label="剧情助手工具" title="剧情助手工具">${CONTROL_ICON_SVG}</button>
      <div id="pm-story-oracle-menu" class="pm-control-menu pm-story-oracle-menu" role="menu" aria-label="剧情助手工具" hidden>
        <button type="button" role="menuitem" data-story-oracle-action="world-books" data-story-oracle-available="${worldBookAvailable}" ${worldBookAvailable ? '' : 'disabled'}>${BOOK_ICON_SVG}<span>${worldBookLabel}</span></button>
        <button type="button" role="menuitem" data-story-oracle-action="settings" ${writable && valid ? '' : 'disabled'}>${SETTINGS_ICON_SVG}<span>剧情助手设置</span></button>
        <button type="button" class="pm-control-menu-danger" role="menuitem" data-story-oracle-action="clear-plans" data-story-oracle-available="${clearPlansAvailable}" ${clearPlansAvailable ? '' : 'disabled'}>${TRASH_ICON_SVG}<span>清空线路</span></button>
        <button type="button" class="pm-control-menu-danger" role="menuitem" data-story-oracle-action="clear" data-story-oracle-available="${clearHistoryAvailable}" ${clearHistoryAvailable ? '' : 'disabled'}>${REMOVE_ICON_SVG}<span>清空历史</span></button>
      </div>
    </div>`;
}

function renderStoryOracleModeMenu(mode) {
    return `<div id="pm-story-oracle-mode-menu" class="pm-control-menu pm-story-oracle-mode-menu" role="menu" aria-label="剧情助手模式" hidden>${STORY_ORACLE_MODES.map(item => `<button type="button" role="menuitemradio" data-story-oracle-action="mode" data-story-oracle-mode="${item}" aria-checked="${item === mode}" ${item === mode ? 'aria-label="当前模式：' + MODE_LABELS[item] + '"' : ''}><span>${MODE_LABELS[item]}</span></button>`).join('')}</div>`;
}

function renderStoryOraclePage(page, storageId, mode, messages = [], status = '', writable = true, readOnlyReason = '', plans = [], selection = null, availableBookNames = [], settings = DEFAULT_ORACLE_SETTINGS, view = 'conversation', expandedPlanIds = new Set(), focusedSourceId = '', openPlanMenuId = '') {
    const valid = isUsableStorageId(storageId);
    const invalidHint = valid ? '' : '请先打开有效的角色聊天，再使用剧情助手。';
    const persistenceHint = writable ? '' : ` 当前为只读保护状态：${readOnlyReason || '历史数据不可安全写入'}。`;
    const statusText = [status || invalidHint, persistenceHint].filter(Boolean).join(' ').trim();
    const routeCount = plans.length;
    const enabledPlanCount = plans.filter(plan => plan.enabled).length;
    const conversationSelected = view !== 'plans';
    const tabs = `<div class="pm-story-oracle-tabs" role="tablist" aria-label="剧情助手内容"><button type="button" role="tab" class="pm-story-oracle-tab${conversationSelected ? ' is-selected' : ''}" data-story-oracle-action="view" data-story-oracle-view="conversation" aria-selected="${conversationSelected}" aria-controls="pm-story-oracle-conversation">对话</button><button type="button" role="tab" class="pm-story-oracle-tab${conversationSelected ? '' : ' is-selected'}" data-story-oracle-action="view" data-story-oracle-view="plans" aria-selected="${!conversationSelected}" aria-controls="pm-story-oracle-plans">路线 <span class="pm-story-oracle-tab-count" aria-label="${enabledPlanCount} 条正在引导，共 ${routeCount} 条路线">${enabledPlanCount}/${routeCount}</span></button></div>`;
    const statusMarkup = statusText ? `<p class="pm-story-oracle-status${plans.length && statusText.startsWith('本轮生成') ? ' is-actionable' : ''}" role="status">${escapeHtml(statusText)}${plans.length && statusText.startsWith('本轮生成') ? ' <button type="button" class="pm-story-oracle-receipt-action" data-story-oracle-action="view" data-story-oracle-view="plans">查看路线</button>' : ''}</p>` : '';
    const conversationBody = `<div id="pm-story-oracle-conversation" class="pm-msg-list pm-story-oracle-message-list" role="tabpanel" aria-live="polite">${renderMessages(messages, plans, writable)}</div>`;
    const plansBody = `<div id="pm-story-oracle-plans" class="pm-story-oracle-plan-list" role="tabpanel">${renderStoryOraclePlans(plans, writable, expandedPlanIds, focusedSourceId, openPlanMenuId) || '<div class="pm-story-oracle-empty">还没有路线。切换到剧情参谋后，生成的路线会出现在这里。</div>'}</div>`;
    const body = `<div class="pm-story-oracle-content">${conversationSelected ? conversationBody : plansBody}</div><form class="pm-input-bar pm-story-oracle-composer" data-story-oracle-form>${renderStoryOracleTools(valid, writable, plans, messages, availableBookNames, settings)}<textarea class="pm-input" name="question" rows="2" maxlength="${MAX_QUESTION_CHARS}" placeholder="${mode === 'advisor' ? '描述你希望推进的剧情目标…' : '询问当前故事…'}" ${valid && writable ? '' : 'disabled'}></textarea><button type="button" class="pm-generation-cancel" data-story-oracle-action="cancel" title="停止生成" aria-label="停止生成" hidden disabled>停止</button><button type="submit" class="pm-up-btn" title="发送问题" aria-label="发送问题" ${valid && writable ? '' : 'disabled'}>${SEND_ICON_SVG}</button></form>`;
    page.innerHTML = `<div class="pm-story-oracle-shell">
        <header class="pm-navbar pm-story-oracle-navbar"><button type="button" class="pm-nav-btn pm-nav-left-btn" data-story-oracle-action="home" aria-label="返回桌面" title="返回桌面">${HOME_ICON_SVG}</button><div class="pm-name-wrap"><button type="button" class="pm-name-trigger pm-story-oracle-mode-trigger" data-story-oracle-action="toggle-mode" aria-haspopup="menu" aria-expanded="false" aria-controls="pm-story-oracle-mode-menu" title="切换剧情助手模式"><span class="pm-name">${MODE_LABELS[mode]}</span><span class="pm-name-chevron" aria-hidden="true">${CHEVRON_DOWN_ICON_SVG}</span></button>${renderStoryOracleModeMenu(mode)}</div><div class="pm-nav-right pm-story-oracle-nav-right"><button type="button" class="pm-header-icon-button pm-nav-btn pm-close-btn" data-story-oracle-action="close" title="退出手机" aria-label="退出手机">${CLOSE_ICON_SVG}</button></div></header>
        ${tabs}
        ${statusMarkup}
        ${body}
    </div>`;
    const list = page.querySelector('.pm-msg-list');
    if (list) list.scrollTop = list.scrollHeight;
}

function buildUserPrompt(context, history, question) {
    const snapshot = [`角色设定：${context.cardDesc || ''}`, `角色性格：${context.cardPersonality || ''}`, `场景：${context.cardScenario || ''}`, `用户：${context.userName || ''}\n${context.userDesc || ''}`, `世界书：${context.worldBookText || '（无）'}`, `最近对话：${context.mainChatText || '（无）'}`].join('\n');
    const transcript = history.map(item => `${item.role === 'user' ? '提问' : '剧情助手'}：${item.content}`).join('\n') || '（无）';
    return `以下是只读上下文快照：\n${snapshot}\n\n此前的剧情助手侧聊：\n${transcript}\n\n本次问题：\n${question}`;
}

function buildStoryOracleSystemPrompt(mode, settings = DEFAULT_ORACLE_SETTINGS) {
    const systemPrompt = String(settings?.systemPrompt || DEFAULT_STORY_ORACLE_SYSTEM_PROMPT).trim() || DEFAULT_STORY_ORACLE_SYSTEM_PROMPT;
    return mode === 'advisor' ? `${systemPrompt}\n\n${ADVISOR_OUTPUT_CONTRACT}` : systemPrompt;
}

export function installStoryOracle(_state, deps = {}) {
    let boundWindow = null;
    let page = null;
    let activeStorageId = '';
    let store = null;
    let controller = null;
    let requestSerial = 0;
    let status = '';
    let statusTimer = null;
    let warning = '';
    const getPage = () => deps.getPhoneWindow?.()?.querySelector?.('[data-phone-page="story-oracle"]') || page;
    let activeMode = 'question';
    let storyOracleView = 'conversation';
    let expandedPlanIds = new Set();
    let focusedSourceId = '';
    let openPlanMenuId = '';
    let storyOracleMenuOpen = false;
    let storyOracleModeMenuOpen = false;

    let writable = false;
    let readOnlyReason = '';
    let writeHandle = null;
    const requestIsCurrent = request => request.serial === requestSerial
        && request.storageId === activeStorageId
        && request.mode === activeMode
        && request.page === page
        && request.controller === controller
        && request.page?.hidden !== true
        && !request.signal.aborted;
    const getWorldBookState = () => {
        let availableNames = [];
        try { availableNames = getReadableWorldBookNames(deps.getCtx?.(), globalThis.window?.__pmWorldBookConfig); } catch (error) {}
        const selection = activeStorageId && store
            ? storyOracleWorldBookSelection(store, activeStorageId, availableNames) : null;
        return { availableNames, selection };
    };
    const getSelectedWorldBookNames = () => {
        const { availableNames, selection } = getWorldBookState();
        return { availableNames, selection, selectedNames: selection ? selection.books : availableNames };
    };
    const persistIfCurrent = async (nextStore, request) => {
        if (!requestIsCurrent(request)) return false;
        const saved = await saveStoryOracleStore(nextStore, {
            readOnlyReason: request.readOnlyReason,
            writeHandle: request.writeHandle,
            shouldWrite: () => requestIsCurrent(request),
        });
        return saved && requestIsCurrent(request);
    };
    const invalidate = reason => {
        requestSerial += 1;
        controller?.abort(reason);
        controller = null;
    };
    const render = (nextStatus = status) => {
        page = getPage();
        if (!page) return;
        const planScrollTop = page.querySelector('#pm-story-oracle-plans')?.scrollTop;
        if (statusTimer) { clearTimeout(statusTimer); statusTimer = null; }
        status = nextStatus;
        storyOracleMenuOpen = false;
        storyOracleModeMenuOpen = false;
        const worldBookState = getWorldBookState();
        renderStoryOraclePage(page, activeStorageId, activeMode, activeStorageId && store ? storyOracleMessages(store, activeStorageId, activeMode) : [], status, writable, readOnlyReason, activeStorageId && store ? storyOraclePlans(store, activeStorageId) : [], worldBookState.selection, worldBookState.availableNames, activeStorageId && store ? storyOracleSettings(store, activeStorageId) : DEFAULT_ORACLE_SETTINGS, storyOracleView, expandedPlanIds, focusedSourceId, openPlanMenuId);
        const planList = page.querySelector('#pm-story-oracle-plans');
        if (Number.isFinite(planScrollTop) && planList) planList.scrollTop = planScrollTop;
        setBusy(Boolean(controller));
        if (nextStatus && activeStorageId) statusTimer = setTimeout(() => render(''), 3000);
    };
    const setStoryOracleMenuOpen = open => {
        storyOracleMenuOpen = Boolean(open);
        const currentPage = getPage();
        const menu = currentPage?.querySelector('#pm-story-oracle-menu');
        const toggle = currentPage?.querySelector('[data-story-oracle-action="toggle-menu"]');
        menu?.toggleAttribute('hidden', !storyOracleMenuOpen);
        toggle?.setAttribute('aria-expanded', String(storyOracleMenuOpen));
        if (storyOracleMenuOpen) {
            menu?.querySelector('button:not(:disabled)')?.focus({ preventScroll: true });
        } else if (document.activeElement && menu?.contains(document.activeElement)) {
            toggle?.focus({ preventScroll: true });
        }
    };
    const closeStoryOracleMenu = () => setStoryOracleMenuOpen(false);
    const setStoryOracleModeMenuOpen = open => {
        storyOracleModeMenuOpen = Boolean(open);
        const currentPage = getPage();
        const menu = currentPage?.querySelector('#pm-story-oracle-mode-menu');
        const toggle = currentPage?.querySelector('[data-story-oracle-action="toggle-mode"]');
        menu?.toggleAttribute('hidden', !storyOracleModeMenuOpen);
        toggle?.setAttribute('aria-expanded', String(storyOracleModeMenuOpen));
        if (storyOracleModeMenuOpen) {
            menu?.querySelector('button:not(:disabled)')?.focus({ preventScroll: true });
        } else if (document.activeElement && menu?.contains(document.activeElement)) {
            toggle?.focus({ preventScroll: true });
        }
    };
    const closeStoryOracleModeMenu = () => setStoryOracleModeMenuOpen(false);
    const closeStoryOracleMenus = () => {
        closeStoryOracleMenu();
        closeStoryOracleModeMenu();
    };
    const setBusy = busy => {
        const form = page?.querySelector('[data-story-oracle-form]');
        if (!form) return;
        form.querySelector('textarea')?.toggleAttribute('disabled', busy || !writable || !isUsableStorageId(activeStorageId));
        const submit = form.querySelector('[type="submit"]');
        if (submit) submit.disabled = busy;
        const cancel = form.querySelector('[data-story-oracle-action="cancel"]');
        if (cancel) { cancel.hidden = !busy; cancel.disabled = !busy; }
        page.querySelector('[data-story-oracle-action="toggle-mode"]')?.toggleAttribute('disabled', busy);
        page.querySelectorAll('[data-story-oracle-action="mode"]').forEach(button => { button.disabled = busy; });
        page.querySelectorAll('[data-story-oracle-action="world-books"], [data-story-oracle-action="settings"], [data-story-oracle-action="clear-plans"], [data-story-oracle-action="clear"], [data-story-oracle-action="toggle-plan"], [data-story-oracle-action="delete-plan"]').forEach(button => {
            button.disabled = busy || !writable || button.dataset.storyOracleAvailable === 'false';
        });
    };
    const mutationRequest = () => Object.freeze({ serial: ++requestSerial, storageId: activeStorageId, mode: activeMode, page, controller: null, signal: { aborted: false }, readOnlyReason, writeHandle });
    const showWorldBookSelector = () => {
        if (!isUsableStorageId(activeStorageId) || typeof deps.makeOverlay !== 'function') return false;
        const { availableNames, selection } = getWorldBookState();
        const checkedNames = new Set(selection ? selection.books : availableNames);
        const opener = page?.querySelector('[data-story-oracle-action="toggle-menu"]');
        closeStoryOracleMenus();
        const overlay = deps.makeOverlay(`<div class="pm-modal pm-modal-wide pm-story-oracle-world-book-modal" role="dialog" aria-modal="true" aria-labelledby="pm-story-world-book-title"><div class="pm-modal-header"><span></span><b id="pm-story-world-book-title">选择世界书</b><button type="button" class="pm-modal-close" data-story-world-book-action="close" aria-label="关闭" title="关闭">${CLOSE_ICON_SVG}</button></div><div class="pm-modal-scroll pm-settings-list"><p class="pm-cfg-tip">剧情助手可阅读的范围</p>${availableNames.length ? availableNames.map(name => `<label class="pm-li"><span><input type="checkbox" name="story-world-book" value="${escapeAttr(name)}" ${checkedNames.has(name) ? 'checked' : ''}> ${escapeHtml(name)}</span></label>`).join('') : '<div class="pm-msg-list-empty">当前没有可读世界书。</div>'}</div><div class="pm-modal-add"><button type="button" class="pm-action-button is-secondary" data-story-world-book-action="close">取消</button><button type="button" class="pm-action-button is-accent" data-story-world-book-action="save" ${writable ? '' : 'disabled'}>保存</button></div></div>`, { opener });
        overlay?.querySelector('[data-story-world-book-action="close"]')?.focus({ preventScroll: true });
        overlay.querySelectorAll('[data-story-world-book-action="close"]').forEach(button => button.addEventListener('click', () => deps.closeOverlay?.('close')));
        overlay.querySelector('[data-story-world-book-action="save"]')?.addEventListener('click', async () => {
            if (!writable) return;
            const request = mutationRequest();
            const selected = [...overlay.querySelectorAll('input[name="story-world-book"]:checked')].map(input => input.value);
            try {
                const nextStore = setStoryOracleWorldBookSelection(store, request.storageId, selected);
                if (!await persistIfCurrent(nextStore, request)) return;
                store = nextStore;
                deps.closeOverlay?.('close');
                render('世界书选择已保存，后续请求将使用新选择。');
            } catch (error) {
                render(`世界书选择保存失败：${generationErrorMessage(error)}`);
            }
        });
        return true;
    };
    const showStoryOracleSettings = () => {
        if (!isUsableStorageId(activeStorageId) || !writable || typeof deps.makeOverlay !== 'function') return false;
        const current = storyOracleSettings(store, activeStorageId);
        const opener = page?.querySelector('[data-story-oracle-action="toggle-menu"]');
        closeStoryOracleMenus();
        const overlay = deps.makeOverlay(`<div class="pm-modal pm-modal-wide pm-story-oracle-settings-modal" role="dialog" aria-modal="true" aria-labelledby="pm-story-oracle-settings-title"><div class="pm-modal-header"><span></span><b id="pm-story-oracle-settings-title">剧情助手设置</b><button type="button" class="pm-modal-close" data-story-oracle-settings-action="close" aria-label="关闭" title="关闭">${CLOSE_ICON_SVG}</button></div><div class="pm-modal-scroll pm-settings-list"><label class="pm-settings-field" for="pm-story-oracle-system-prompt"><span class="pm-cfg-label">系统提示词</span><textarea id="pm-story-oracle-system-prompt" class="pm-cfg-input" name="systemPrompt" rows="12" maxlength="6000">${escapeHtml(current.systemPrompt)}</textarea></label></div><div class="pm-modal-add"><button type="button" class="pm-action-button is-secondary" data-story-oracle-settings-action="reset">恢复默认</button><button type="button" class="pm-action-button is-accent" data-story-oracle-settings-action="save">保存</button></div></div>`, { opener });
        overlay?.querySelector('[data-story-oracle-settings-action="close"]')?.focus({ preventScroll: true });
        overlay?.querySelector('[data-story-oracle-settings-action="close"]')?.addEventListener('click', () => deps.closeOverlay?.('close'));
        overlay?.querySelector('[data-story-oracle-settings-action="reset"]')?.addEventListener('click', () => {
            const systemPrompt = overlay.querySelector('[name="systemPrompt"]');
            if (systemPrompt) systemPrompt.value = DEFAULT_ORACLE_SETTINGS.systemPrompt;
        });
        overlay?.querySelector('[data-story-oracle-settings-action="save"]')?.addEventListener('click', async () => {
            const request = mutationRequest();
            try {
                const nextStore = setStoryOracleSettings(store, request.storageId, {
                    systemPrompt: overlay.querySelector('[name="systemPrompt"]')?.value,
                });
                if (!await persistIfCurrent(nextStore, request)) return;
                store = nextStore;
                deps.closeOverlay?.('close');
                render('剧情助手设置已保存。');
            } catch (error) {
                render(`剧情助手设置保存失败：${generationErrorMessage(error)}`);
            }
        });
        return true;
    };
    const handlePlanAction = async button => {
        const action = button.dataset.storyOracleAction;
        if (action === 'continue-plan') {
            const plan = storyOraclePlans(store, activeStorageId).find(item => item.id === button.dataset.storyOraclePlanId);
            const textarea = page?.querySelector('[data-story-oracle-form] textarea');
            if (plan && textarea) { textarea.value = `继续讨论线路“${plan.title || plan.goal}”：`; textarea.focus(); }
            return;
        }
        if (!writable || controller || !activeStorageId) return;
        const request = mutationRequest();
        try {
            let nextStore;
            if (action === 'toggle-plan') {
                const plan = storyOraclePlans(store, activeStorageId).find(item => item.id === button.dataset.storyOraclePlanId);
                nextStore = setStoryOraclePlanEnabled(store, activeStorageId, button.dataset.storyOraclePlanId, !plan?.enabled);
            } else if (action === 'delete-plan') {
                nextStore = removeStoryOraclePlan(store, activeStorageId, button.dataset.storyOraclePlanId);
            } else if (action === 'clear-plans') {
                nextStore = clearStoryOraclePlans(store, activeStorageId);
            } else return;
            if (!await persistIfCurrent(nextStore, request)) return;
            store = nextStore;
            const injectionResult = typeof deps.applyBidirectionalInjection === 'function' ? await deps.applyBidirectionalInjection() : null;
            const injectionIssue = storyOracleInjectionIssue(injectionResult);
            const message = action === 'clear-plans' ? '剧情线路已清空。'
                : action === 'delete-plan' ? '剧情线路已删除。' : '剧情线路状态已更新。';
            render(injectionIssue ? `${message} 但主聊天注入未完全生效：${injectionIssue}` : message);
        } catch (error) {
            if (requestIsCurrent(request)) render(`剧情线路操作失败：${generationErrorMessage(error)}`);
        }
    };
    const onDocumentClick = event => {
        if (!storyOracleMenuOpen && !storyOracleModeMenuOpen && !openPlanMenuId) return;
        const currentPage = getPage();
        const menu = currentPage?.querySelector('#pm-story-oracle-menu');
        const toggle = currentPage?.querySelector('[data-story-oracle-action="toggle-menu"]');
        const modeMenu = currentPage?.querySelector('#pm-story-oracle-mode-menu');
        const modeToggle = currentPage?.querySelector('[data-story-oracle-action="toggle-mode"]');
        const planMenu = currentPage?.querySelector(`[data-story-oracle-plan-id="${CSS.escape(openPlanMenuId)}"] .pm-story-oracle-plan-menu`);
        const planToggle = currentPage?.querySelector(`[data-story-oracle-plan-id="${CSS.escape(openPlanMenuId)}"] .pm-story-oracle-plan-more`);
        if (!menu?.contains(event.target) && !toggle?.contains(event.target) && !modeMenu?.contains(event.target) && !modeToggle?.contains(event.target) && !planMenu?.contains(event.target) && !planToggle?.contains(event.target)) closeStoryOracleMenus();
    };
    const onDocumentKeyDown = event => {
        if (event.key !== 'Escape') return;
        if (openPlanMenuId) {
            event.preventDefault();
            openPlanMenuId = '';
            render();
            return;
        }
        if (storyOracleModeMenuOpen) {
            event.preventDefault();
            closeStoryOracleModeMenu();
            page?.querySelector('[data-story-oracle-action="toggle-mode"]')?.focus({ preventScroll: true });
        } else if (storyOracleMenuOpen) {
            event.preventDefault();
            closeStoryOracleMenu();
            page?.querySelector('[data-story-oracle-action="toggle-menu"]')?.focus({ preventScroll: true });
        }
    };
    const onClick = event => {
        const button = event.target.closest?.('[data-story-oracle-action]');
        if (!button || !boundWindow?.contains(button)) return;
        if (button.closest('.pm-story-oracle-plan-menu')) event.stopPropagation();
        if (button.dataset.storyOracleAction === 'toggle-menu') {
            event.preventDefault();
            closeStoryOracleModeMenu();
            setStoryOracleMenuOpen(!storyOracleMenuOpen);
            return;
        }
        if (button.dataset.storyOracleAction === 'toggle-mode') {
            event.preventDefault();
            closeStoryOracleMenu();
            setStoryOracleModeMenuOpen(!storyOracleModeMenuOpen);
            return;
        }
        if (button.dataset.storyOracleAction === 'mode') {
            const nextMode = button.dataset.storyOracleMode;
            closeStoryOracleModeMenu();
            if (!STORY_ORACLE_MODES.includes(nextMode) || nextMode === activeMode || controller) return;
            activeMode = nextMode;
            render();
            return;
        }
        if (button.closest('#pm-story-oracle-menu')) closeStoryOracleMenu();
        if (button.dataset.storyOracleAction === 'view') {
            const nextView = button.dataset.storyOracleView;
            if (nextView === 'conversation' || nextView === 'plans') {
                storyOracleView = nextView;
                openPlanMenuId = '';
                render();
                if (nextView === 'plans') page?.querySelector('.pm-story-oracle-plan-bubble.is-new')?.scrollIntoView?.({ block: 'nearest' });
            }
            return;
        }
        if (button.dataset.storyOracleAction === 'toggle-plan-details') {
            const planId = button.dataset.storyOraclePlanId;
            if (expandedPlanIds.has(planId)) expandedPlanIds.delete(planId);
            else expandedPlanIds.add(planId);
            openPlanMenuId = '';
            render();
            return;
        }
        if (button.dataset.storyOracleAction === 'toggle-plan-menu') {
            openPlanMenuId = openPlanMenuId === button.dataset.storyOraclePlanId ? '' : button.dataset.storyOraclePlanId;
            render();
            return;
        }
        if (button.dataset.storyOracleAction === 'world-books') {
            showWorldBookSelector();
            return;
        }
        if (button.dataset.storyOracleAction === 'settings') {
            showStoryOracleSettings();
            return;
        }
        if (['continue-plan', 'toggle-plan', 'delete-plan', 'clear-plans'].includes(button.dataset.storyOracleAction)) {
            openPlanMenuId = '';
            handlePlanAction(button);
            return;
        }
        if (button.dataset.storyOracleAction === 'home') {
            closeStoryOracleMenus();
            invalidate('story-oracle-home');
            deps.showPhoneDesktopPage?.();
        }
        if (button.dataset.storyOracleAction === 'close') {
            closeStoryOracleMenus();
            invalidate('story-oracle-close');
            if (typeof deps.closePhone === 'function') deps.closePhone();
            else globalThis.window?.__pmEnd?.();
            return;
        }
        if (button.dataset.storyOracleAction === 'cancel') controller?.abort('story-oracle-cancelled');
        if (button.dataset.storyOracleAction === 'clear' && activeStorageId && writable && !controller) {
            const clearRequest = Object.freeze({
                serial: ++requestSerial, storageId: activeStorageId, mode: activeMode, page, controller: null,
                signal: { aborted: false }, readOnlyReason, writeHandle,
            });
            const nextStore = clearStoryOracleScope(store, clearRequest.storageId, clearRequest.mode);
            saveStoryOracleStore(nextStore, {
                readOnlyReason: clearRequest.readOnlyReason,
                writeHandle: clearRequest.writeHandle,
                shouldWrite: () => requestIsCurrent(clearRequest),
            }).then(saved => {
                if (saved && requestIsCurrent(clearRequest)) { store = nextStore; render('当前聊天的 Story Oracle 历史已清空。'); }
            }).catch(error => {
                if (requestIsCurrent(clearRequest)) render(`清空失败：${generationErrorMessage(error)}`);
            });
        }
    };
    const onSubmit = async event => {
        const form = event.target.closest?.('[data-story-oracle-form]');
        if (!form || !boundWindow?.contains(form)) return;
        event.preventDefault();
        if (controller || !writable || !isUsableStorageId(activeStorageId)) return;
        const question = String(new FormData(form).get('question') || '').trim();
        if (!question || question.length > MAX_QUESTION_CHARS) { render('问题不能为空，且不能超过 12000 字。'); return; }
        const serial = ++requestSerial;
        controller = new AbortController();
        const request = Object.freeze({ serial, storageId: activeStorageId, mode: activeMode, page, controller, signal: controller.signal, readOnlyReason, writeHandle });
        setBusy(true);
        const history = storyOracleMessages(store, request.storageId, request.mode);
        let parsedResult = { plans: [], hadBlocks: false, invalid: false };
        render('正在读取当前聊天上下文…');
        try {
            const worldBookState = getSelectedWorldBookNames();
            const context = await deps.gatherContext?.(null, { module: 'chat', signal: request.signal, includeWorldBook: true, worldBookMaxChars: 30000, worldBookNames: worldBookState.selectedNames });
            if (!requestIsCurrent(request)) return;
            render('正在请求 Story Oracle…');
            const systemPrompt = buildStoryOracleSystemPrompt(request.mode, storyOracleSettings(store, request.storageId));
            const answer = await deps.callAI?.(systemPrompt, buildUserPrompt(context || {}, history, question), { isolated: true, signal: request.signal });
            if (!requestIsCurrent(request)) return;
            const answerText = String(answer || '').trim();
            if (!answerText) throw new Error('AI 未返回可用文本');
            parsedResult = request.mode === 'advisor' ? parseStoryPlans(answerText) : parsedResult;
            const nextStore = appendStoryOracleTurn(store, request.storageId, question, answerText, request.mode, {
                selectionKey: worldBookState.selection?.scopeKey || worldBookState.selectedNames.join('｜'),
            });
            if (!await persistIfCurrent(nextStore, request)) return;
            store = nextStore;
            if (parsedResult.plans.length) {
                const latestPlans = storyOraclePlans(store, request.storageId);
                focusedSourceId = latestPlans[latestPlans.length - 1]?.sourceMessageId || '';
            }
            const receipt = parsedResult.plans.length
                ? `本轮生成 ${parsedResult.plans.length} 条路线，已加入路线工作台。`
                : parsedResult.invalid
                    ? '本轮文本已保存，路线格式未识别。'
                    : '本轮已保存，但没有识别到可操作路线。';
            render(receipt);
        } catch (error) {
            if (error?.name !== 'AbortError' && error?.message !== 'story-oracle-cancelled') render(`请求失败：${generationErrorMessage(error)}`);
            else render('请求已取消，未写入未完成结果。');
        } finally {
            if (serial === requestSerial) { controller = null; setBusy(false); }
        }
    };
    const bind = phoneWindow => {
        if (!phoneWindow || typeof phoneWindow.addEventListener !== 'function' || boundWindow === phoneWindow) return false;
        if (boundWindow) {
            boundWindow.removeEventListener?.('click', onClick);
            boundWindow.removeEventListener?.('submit', onSubmit);
        }
        document.removeEventListener('click', onDocumentClick, true);
        document.removeEventListener('keydown', onDocumentKeyDown, true);
        boundWindow = phoneWindow;
        boundWindow.addEventListener('click', onClick);
        boundWindow.addEventListener('submit', onSubmit);
        document.addEventListener('click', onDocumentClick, true);
        document.addEventListener('keydown', onDocumentKeyDown, true);
        return true;
    };
    const destroy = () => {
        invalidate('story-oracle-closed');
        boundWindow?.removeEventListener?.('click', onClick);
        boundWindow?.removeEventListener?.('submit', onSubmit);
        document.removeEventListener('click', onDocumentClick, true);
        document.removeEventListener('keydown', onDocumentKeyDown, true);
        boundWindow = null;
        page = null;
        store = null;
        activeStorageId = '';
        writeHandle = null;
        storyOracleMenuOpen = false;
        storyOracleModeMenuOpen = false;
    };
    const show = async (storageId = deps.getStorageId?.()) => {
        const nextId = String(storageId || '').trim();
        const showSerial = requestSerial + 1;
        invalidate('story-oracle-scope-changed');
        page = deps.getPhoneWindow?.()?.querySelector?.('[data-phone-page="story-oracle"]');
        if (!page) return false;
        activeStorageId = nextId;
        activeMode = 'question';
        warning = '';
        if (isUsableStorageId(nextId)) {
            try {
                const loaded = await loadStoryOracleStore();
                if (showSerial !== requestSerial) return false;
                store = loaded.store; writable = loaded.writable === true; writeHandle = loaded.writeHandle || null; readOnlyReason = loaded.readOnlyReason || '';
                warning = loaded.warning || '';
            }
            catch (error) {
                if (showSerial !== requestSerial) return false;
                store = null; writable = false; writeHandle = null; readOnlyReason = '历史读取失败';
                warning = `历史读取失败：${generationErrorMessage(error)}`;
            }
        } else { store = null; writable = false; writeHandle = null; readOnlyReason = '请先打开有效聊天'; }
        if (showSerial !== requestSerial) return false;
        render(warning);
        if (globalThis.window?.__pmShowPhonePage?.('story-oracle') !== true) return false;
        deps.persistPhoneUiSnapshot?.();
        return true;
    };
    const getStoryOracleStore = async () => {
        if (store) return store;
        try {
            return (await loadStoryOracleStore()).store;
        } catch (error) {
            return null;
        }
    };
    Object.assign(deps, { bindStoryOraclePhoneUi: bind, destroyStoryOraclePhoneUi: destroy, showStoryOraclePage: show, getStoryOracleStore });
    return { bind, destroy, show };
}
