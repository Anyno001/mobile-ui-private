import { generationErrorMessage } from './ai.js';
import { CLOSE_ICON_SVG } from './icons.js';
import { escapeHtml } from './ui.js';
import {
    appendStoryOracleTurn, clearStoryOraclePlans, clearStoryOracleScope, normalizeStoryOracleStore,
    buildStoryOraclePlanDefaultInjection, parseStoryPlans, parseUserGenerationResponse, removeStoryOraclePlan, resetStoryOraclePlanInjection,
    setStoryOraclePlanCustomInjection, setStoryOraclePlanEnabled, setStoryOraclePlanIntensity, setStoryOracleSettings, setStoryOracleWorldBookSelection,
    storyOraclePlanInjectionText, storyOraclePlanIntensityControllable, storyOraclePlanIntensityLine, storyOraclePlans, storyOracleSettings, storyOracleWorldBookSelection,
    STORY_ORACLE_INTENSITIES, DEFAULT_STORY_ORACLE_SYSTEM_PROMPT, STORY_ORACLE_MODES, storyOracleMessages,
} from './story-oracle-model.js';
import { loadStoryOracleStore, saveStoryOracleStore } from './story-oracle-storage.js';
import { MAX_QUESTION_CHARS, renderStoryOracleShell, TOP_VIEWS } from './story-oracle-views.js';
import { addUserGenerationItem, createEmptyUserGenerationStore, removeUserGenerationItem, userGenerationItems } from './user-generation-model.js';
import { loadUserGenerationStore, saveUserGenerationStore } from './user-generation-storage.js';
import { buildStoryOracleUserPrompt, copyUserGenerationContent, USER_GENERATION_SYSTEM_PROMPT } from './user-generation-support.js';
import { getReadableWorldBookNames } from './worldbook-config.js';

export { copyUserGenerationContent, USER_GENERATION_SYSTEM_PROMPT } from './user-generation-support.js';

const DEFAULT_ORACLE_SETTINGS = Object.freeze({ systemPrompt: DEFAULT_STORY_ORACLE_SYSTEM_PROMPT });
const isUsableStorageId = value => { const id = String(value || '').trim(); return id && id !== 'sms_unknown__default'; };
const ADVISOR_OUTPUT_CONTRACT = '你当前是「故事神谕」的剧情参谋。基于已有剧情讨论接下来可以怎么走，提出贴合上下文、可执行的方案；不要续写成正文，不要声称已经修改宿主数据。需要给出具体路线时，把每条可选路线分别放进独立的 <StoryPlan>...</StoryPlan> 区块；每个区块必须包含“标题：”和“目标：”，并可包含“起始迹象：”“契合点：”“剧情推进速度：”（例如快、中、慢）。不要把多条路线合并到同一个区块；区块外只能保留简短引导说明。';
const STORY_WRITE_ACTIONS = ['settings', 'clear-plans', 'clear', 'toggle-plan', 'plan-intensity', 'edit-plan-injection', 'delete-plan', 'toggle-world-book', 'select-all-world-books']
    .map(action => `[data-story-oracle-action="${action}"]`).join(', ');

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

function buildStoryOracleSystemPrompt(mode, settings = DEFAULT_ORACLE_SETTINGS) {
    if (mode === 'user-generation') return USER_GENERATION_SYSTEM_PROMPT;
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
    let storyOracleView = 'home';
    let returnView = 'home';
    let detailId = '';
    let planFilter = 'active';
    let openMenuId = '';
    let modeSheetOpen = false;
    let draft = '';
    let pendingUserResult = null;
    let revisionTarget = null;

    let writable = false;
    let readOnlyReason = '';
    let writeHandle = null;
    let userStore = createEmptyUserGenerationStore();
    let userWritable = false;
    let userReadOnlyReason = '';
    let userWriteHandle = null;
    let userMutationBusy = false;
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
    const isTopView = view => TOP_VIEWS.includes(view);
    const currentPlans = () => (activeStorageId && store ? storyOraclePlans(store, activeStorageId) : []);
    const readContext = () => {
        try { return deps.getCtx?.() || {}; } catch (error) { return {}; }
    };
    // 详情页的对象被删除或失效时退回所属列表页
    const resolveView = plans => {
        if (storyOracleView === 'plan' && !plans.some(plan => plan.id === detailId)) storyOracleView = 'plans';
        if (storyOracleView === 'user' && !(detailId === 'pending' ? pendingUserResult : userGenerationItems(userStore).some(item => item.id === detailId))) storyOracleView = 'users';
    };
    const buildViewModel = () => {
        const valid = isUsableStorageId(activeStorageId);
        const scope = (activeStorageId && store ? normalizeStoryOracleStore(store).scopes[activeStorageId] : null) || {};
        const plans = scope.plans || [];
        resolveView(plans);
        const { availableNames, selectedNames } = getSelectedWorldBookNames();
        const ctx = readContext();
        const character = String(ctx.name2 || '').trim();
        const floors = Array.isArray(ctx.chat) ? ctx.chat.length : 0;
        const userItems = userGenerationItems(userStore);
        const detailUserPending = storyOracleView === 'user' && detailId === 'pending';
        const persistenceHint = valid && !writable ? `当前为只读保护状态：${readOnlyReason || '历史数据不可安全写入'}。` : '';
        return {
            view: storyOracleView, mode: activeMode, valid, writable, plans,
            messages: scope.modes?.[activeMode] || [],
            counts: Object.fromEntries(STORY_ORACLE_MODES.map(mode => [mode, (scope.modes?.[mode] || []).length])),
            availableBookNames: availableNames, selectedBookNames: selectedNames,
            systemPrompt: scope.settings?.systemPrompt || DEFAULT_STORY_ORACLE_SYSTEM_PROMPT,
            userItems, userWritable, userReadOnlyReason, pendingUser: pendingUserResult,
            detailPlan: storyOracleView === 'plan' ? plans.find(plan => plan.id === detailId) : null,
            detailUser: storyOracleView === 'user' ? (detailUserPending ? pendingUserResult : userItems.find(item => item.id === detailId)) : null,
            detailUserPending, planFilter, openMenuId, modeSheetOpen, draft,
            seal: Array.from(character)[0] || '剧',
            subtitle: [character, floors ? `第 ${floors} 楼` : '', availableNames.length ? `读 ${selectedNames.length} 本世界书` : ''].filter(Boolean).join(' · '),
            statusText: [status || (valid ? '' : '请先打开有效的角色聊天，再使用剧情助手。'), persistenceHint].filter(Boolean).join(' '),
        };
    };
    const render = (nextStatus = status) => {
        page = getPage();
        if (!page) return;
        const previousView = page.querySelector('[data-story-oracle-page]')?.dataset.storyOraclePage;
        const bodyScrollTop = page.querySelector('[data-story-oracle-scroll]')?.scrollTop;
        const textarea = page.querySelector('[data-story-oracle-form] textarea');
        const typing = Boolean(textarea) && document.activeElement === textarea;
        const caret = typing ? [textarea.selectionStart, textarea.selectionEnd] : null;
        if (textarea) draft = textarea.value;
        if (statusTimer) { clearTimeout(statusTimer); statusTimer = null; }
        status = nextStatus;
        const vm = buildViewModel();
        page.innerHTML = renderStoryOracleShell(vm);
        const scroller = page.querySelector('[data-story-oracle-scroll]');
        if (scroller && vm.view === 'conversation') scroller.scrollTop = scroller.scrollHeight;
        else if (scroller && previousView === vm.view && Number.isFinite(bodyScrollTop)) scroller.scrollTop = bodyScrollTop;
        setBusy(Boolean(controller));
        const nextTextarea = typing ? page.querySelector('[data-story-oracle-form] textarea') : null;
        if (nextTextarea && !nextTextarea.disabled) { nextTextarea.focus({ preventScroll: true }); nextTextarea.setSelectionRange?.(...caret); }
        if (nextStatus && activeStorageId) statusTimer = setTimeout(() => render(''), 3000);
    };
    // 顶层页（首页/路线/User 库/设置）记为返回目标；对话与详情页的返回键回到最近的顶层页
    const navigate = (view, id = '', nextStatus = status) => {
        if (isTopView(view)) returnView = view;
        else if (isTopView(storyOracleView)) returnView = storyOracleView;
        if (view === 'plans' && storyOracleView !== 'plans') {
            const plans = currentPlans();
            planFilter = plans.length && !plans.some(plan => plan.enabled) ? 'idle' : 'active';
        }
        storyOracleView = view;
        detailId = id;
        openMenuId = '';
        modeSheetOpen = false;
        render(nextStatus);
    };
    const syncModeSheet = () => {
        const currentPage = getPage();
        const layer = currentPage?.querySelector('.pm-story-oracle-sheet-layer');
        const toggle = currentPage?.querySelector('[data-story-oracle-action="toggle-mode"]');
        layer?.toggleAttribute('hidden', !modeSheetOpen);
        toggle?.setAttribute('aria-expanded', String(modeSheetOpen));
        if (modeSheetOpen) layer?.querySelector('[aria-checked="true"]')?.focus({ preventScroll: true });
        else if (layer?.contains(document.activeElement)) toggle?.focus({ preventScroll: true });
    };
    const setModeSheetOpen = open => { modeSheetOpen = Boolean(open); syncModeSheet(); };
    const syncMoreMenu = () => {
        getPage()?.querySelectorAll('[data-story-oracle-action="toggle-more"]').forEach(toggle => {
            const open = toggle.dataset.storyOracleMenuId === openMenuId;
            const menu = toggle.nextElementSibling;
            toggle.setAttribute('aria-expanded', String(open));
            menu?.toggleAttribute('hidden', !open);
            if (open) menu?.querySelector('button:not(:disabled)')?.focus({ preventScroll: true });
            else if (menu?.contains(document.activeElement)) toggle.focus({ preventScroll: true });
        });
    };
    const closeStoryOracleMenus = () => {
        if (openMenuId) { openMenuId = ''; syncMoreMenu(); }
        if (modeSheetOpen) setModeSheetOpen(false);
    };
    const setBusy = busy => {
        if (!page) return;
        const valid = isUsableStorageId(activeStorageId);
        const form = page.querySelector('[data-story-oracle-form]');
        if (form) {
            form.querySelector('textarea')?.toggleAttribute('disabled', busy || !writable || !valid);
            const submit = form.querySelector('[type="submit"]');
            if (submit) submit.disabled = busy || !writable || !valid;
            const cancel = form.querySelector('[data-story-oracle-action="cancel"]');
            if (cancel) { cancel.hidden = !busy; cancel.disabled = !busy; }
        }
        page.querySelector('[data-story-oracle-action="toggle-mode"]')?.toggleAttribute('disabled', busy);
        page.querySelectorAll('[data-story-oracle-action="mode"]').forEach(button => { button.disabled = busy; });
        page.querySelectorAll(STORY_WRITE_ACTIONS).forEach(button => {
            button.disabled = busy || !writable || !valid || button.dataset.storyOracleAvailable === 'false';
        });
    };
    const mutationRequest = () => Object.freeze({ serial: ++requestSerial, storageId: activeStorageId, mode: activeMode, page, controller: null, signal: { aborted: false }, readOnlyReason, writeHandle });
    const updateWorldBooks = async books => {
        if (!writable || controller || !isUsableStorageId(activeStorageId)) return;
        const request = mutationRequest();
        try {
            const nextStore = setStoryOracleWorldBookSelection(store, request.storageId, books);
            if (!await persistIfCurrent(nextStore, request)) return;
            store = nextStore;
            render();
        } catch (error) {
            if (requestIsCurrent(request)) render(`世界书选择保存失败：${generationErrorMessage(error)}`);
        }
    };
    const toggleWorldBook = name => {
        const { availableNames, selectedNames } = getSelectedWorldBookNames();
        const selected = new Set(selectedNames);
        if (selected.has(name)) selected.delete(name); else selected.add(name);
        return updateWorldBooks(availableNames.filter(item => selected.has(item)));
    };
    const showStoryOracleSettings = () => {
        if (!isUsableStorageId(activeStorageId) || !writable || typeof deps.makeOverlay !== 'function') return false;
        const current = storyOracleSettings(store, activeStorageId);
        const opener = page?.querySelector('[data-story-oracle-action="settings"]');
        closeStoryOracleMenus();
        const overlay = deps.makeOverlay(`<div class="pm-modal pm-modal-wide pm-story-oracle-settings-modal" role="dialog" aria-modal="true" aria-labelledby="pm-story-oracle-settings-title"><div class="pm-modal-header"><span></span><b id="pm-story-oracle-settings-title">系统提示词</b><button type="button" class="pm-modal-close" data-story-oracle-settings-action="close" aria-label="关闭" title="关闭">${CLOSE_ICON_SVG}</button></div><div class="pm-modal-scroll pm-settings-list"><label class="pm-settings-field" for="pm-story-oracle-system-prompt"><span class="pm-cfg-label">系统提示词</span><textarea id="pm-story-oracle-system-prompt" class="pm-cfg-input" name="systemPrompt" rows="12" maxlength="6000">${escapeHtml(current.systemPrompt)}</textarea></label></div><div class="pm-modal-add"><button type="button" class="pm-action-button is-secondary" data-story-oracle-settings-action="reset">恢复默认</button><button type="button" class="pm-action-button is-accent" data-story-oracle-settings-action="save">保存</button></div></div>`, { opener });
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
                render('系统提示词已保存。');
            } catch (error) {
                render(`系统提示词保存失败：${generationErrorMessage(error)}`);
            }
        });
        return true;
    };
    const showStoryOraclePlanInjectionEditor = planId => {
        if (!isUsableStorageId(activeStorageId) || !writable || typeof deps.makeOverlay !== 'function') return false;
        const plan = storyOraclePlans(store, activeStorageId).find(item => item.id === planId);
        if (!plan) return false;
        const opener = page?.querySelector(`[data-story-oracle-plan-id="${CSS.escape(planId)}"] [data-story-oracle-action="edit-plan-injection"]`);
        let selectedIntensity = plan.intensity;
        let intensityControllable = storyOraclePlanIntensityControllable(plan);
        const syncIntensityControls = () => overlay.querySelectorAll('[data-story-oracle-plan-intensity]').forEach(button => {
            const selected = button.dataset.storyOraclePlanIntensity === selectedIntensity;
            button.disabled = !intensityControllable;
            button.classList.toggle('is-accent', selected);
            button.classList.toggle('is-secondary', !selected);
            button.setAttribute('aria-pressed', String(selected));
        });
        const intensityButtons = Object.entries(STORY_ORACLE_INTENSITIES).map(([key, item]) => `<button type="button" class="pm-action-button ${plan.intensity === key ? 'is-accent' : 'is-secondary'}" data-story-oracle-plan-intensity="${key}" aria-pressed="${plan.intensity === key}" ${intensityControllable ? '' : 'disabled'}>${item.label}</button>`).join('');
        const overlay = deps.makeOverlay(`<div class="pm-modal pm-modal-wide pm-story-oracle-settings-modal" role="dialog" aria-modal="true" aria-labelledby="pm-story-oracle-plan-injection-title"><div class="pm-modal-header"><span></span><b id="pm-story-oracle-plan-injection-title">编辑主聊天引导</b><button type="button" class="pm-modal-close" data-story-oracle-plan-editor-action="close" aria-label="关闭" title="关闭">${CLOSE_ICON_SVG}</button></div><div class="pm-modal-scroll pm-settings-list"><div class="pm-settings-field"><span class="pm-cfg-label">推进强度</span><div class="pm-story-oracle-intensity-controls">${intensityButtons}</div></div><label class="pm-settings-field" for="pm-story-oracle-plan-injection"><span class="pm-cfg-label">实际写入主聊天的引导文本</span><textarea id="pm-story-oracle-plan-injection" class="pm-cfg-input" name="planInjection" rows="12" maxlength="${18000}">${escapeHtml(storyOraclePlanInjectionText(plan))}</textarea></label></div><div class="pm-modal-add"><button type="button" class="pm-action-button is-secondary" data-story-oracle-plan-editor-action="reset">恢复默认</button><button type="button" class="pm-action-button is-accent" data-story-oracle-plan-editor-action="save">保存</button></div></div>`, { opener });
        overlay?.querySelector('[data-story-oracle-plan-editor-action="close"]')?.focus({ preventScroll: true });
        overlay?.querySelector('[data-story-oracle-plan-editor-action="close"]')?.addEventListener('click', () => deps.closeOverlay?.('close'));
        overlay?.querySelectorAll('[data-story-oracle-plan-intensity]').forEach(button => button.addEventListener('click', () => {
            const nextIntensity = button.dataset.storyOraclePlanIntensity;
            if (!STORY_ORACLE_INTENSITIES[nextIntensity] || !intensityControllable) return;
            const textarea = overlay.querySelector('[name="planInjection"]');
            if (textarea) textarea.value = textarea.value.replace(storyOraclePlanIntensityLine(selectedIntensity), storyOraclePlanIntensityLine(nextIntensity));
            selectedIntensity = nextIntensity;
            syncIntensityControls();
        }));
        overlay?.querySelector('[name="planInjection"]')?.addEventListener('input', event => {
            const currentLine = storyOraclePlanIntensityLine(selectedIntensity);
            intensityControllable = String(event.currentTarget?.value || '').includes(currentLine);
            syncIntensityControls();
        });
        overlay?.querySelector('[data-story-oracle-plan-editor-action="reset"]')?.addEventListener('click', () => {
            const current = storyOraclePlans(store, activeStorageId).find(item => item.id === planId);
            const textarea = overlay.querySelector('[name="planInjection"]');
            if (current && textarea) {
                selectedIntensity = current.intensity;
                intensityControllable = true;
                textarea.value = buildStoryOraclePlanDefaultInjection(current);
                syncIntensityControls();
            }
        });
        overlay?.querySelector('[data-story-oracle-plan-editor-action="save"]')?.addEventListener('click', async () => {
            const request = mutationRequest();
            try {
                const currentPlan = storyOraclePlans(store, request.storageId).find(item => item.id === planId);
                let nextStore = storyOraclePlanIntensityControllable(currentPlan)
                    ? setStoryOraclePlanIntensity(store, request.storageId, planId, selectedIntensity)
                    : store;
                const savedPlan = storyOraclePlans(nextStore, request.storageId).find(item => item.id === planId);
                const content = overlay.querySelector('[name="planInjection"]')?.value;
                nextStore = content === buildStoryOraclePlanDefaultInjection(savedPlan) ? resetStoryOraclePlanInjection(nextStore, request.storageId, planId)
                    : setStoryOraclePlanCustomInjection(nextStore, request.storageId, planId, content);
                if (!await persistIfCurrent(nextStore, request)) return;
                store = nextStore;
                const injectionResult = typeof deps.applyBidirectionalInjection === 'function' ? await deps.applyBidirectionalInjection() : null;
                const injectionIssue = storyOracleInjectionIssue(injectionResult);
                deps.closeOverlay?.('close');
                render(injectionIssue ? `主聊天引导已保存，但注入未完全生效：${injectionIssue}` : '主聊天引导已保存。');
            } catch (error) {
                if (requestIsCurrent(request)) render(`主聊天引导保存失败：${generationErrorMessage(error)}`);
            }
        });
        return true;
    };
    const confirmAction = message => (typeof globalThis.confirm === 'function' ? globalThis.confirm(message) : false);
    const focusComposer = () => page?.querySelector('[data-story-oracle-form] textarea:not(:disabled)')?.focus();
    const openConversation = (mode, seed = '', nextStatus = status) => {
        if (mode && mode !== activeMode) {
            if (controller) { render('请等待当前回复完成后再切换模式。'); return false; }
            activeMode = mode;
        }
        if (seed) draft = seed;
        navigate('conversation', '', nextStatus);
        if (seed) focusComposer();
        return true;
    };
    const handlePlanAction = async button => {
        const action = button.dataset.storyOracleAction;
        const planId = button.dataset.storyOraclePlanId;
        if (action === 'continue-plan') {
            const plan = currentPlans().find(item => item.id === planId);
            if (plan) openConversation('advisor', `继续讨论线路“${plan.title || plan.goal}”：`);
            return;
        }
        if (!writable || controller || !activeStorageId) return;
        if (action === 'delete-plan' && !confirmAction('删除这条剧情线路？正在引导的内容会同时从主聊天撤下。')) return;
        if (action === 'clear-plans' && !confirmAction('清空当前聊天的全部剧情线路？正在引导的内容会同时从主聊天撤下。')) return;
        const request = mutationRequest();
        try {
            let nextStore;
            if (action === 'toggle-plan') {
                const plan = currentPlans().find(item => item.id === planId);
                nextStore = setStoryOraclePlanEnabled(store, activeStorageId, planId, !plan?.enabled);
            } else if (action === 'plan-intensity') {
                const plan = currentPlans().find(item => item.id === planId);
                const intensity = button.dataset.storyOracleIntensity;
                if (!plan || plan.intensity === intensity || !STORY_ORACLE_INTENSITIES[intensity]) return;
                nextStore = setStoryOraclePlanIntensity(store, activeStorageId, planId, intensity);
            } else if (action === 'delete-plan') {
                nextStore = removeStoryOraclePlan(store, activeStorageId, planId);
            } else if (action === 'clear-plans') {
                nextStore = clearStoryOraclePlans(store, activeStorageId);
            } else return;
            if (!await persistIfCurrent(nextStore, request)) return;
            store = nextStore;
            const injectionResult = typeof deps.applyBidirectionalInjection === 'function' ? await deps.applyBidirectionalInjection() : null;
            const injectionIssue = storyOracleInjectionIssue(injectionResult);
            const message = action === 'clear-plans' ? '剧情线路已清空。'
                : action === 'delete-plan' ? '剧情线路已删除。'
                    : action === 'plan-intensity' ? '推进强度已更新。' : '剧情线路状态已更新。';
            render(injectionIssue ? `${message} 但主聊天注入未完全生效：${injectionIssue}` : message);
        } catch (error) {
            if (requestIsCurrent(request)) render(`剧情线路操作失败：${generationErrorMessage(error)}`);
        }
    };
    const CLEAR_CONFIRMS = Object.freeze({ question: '清空当前聊天的剧情聊天记录？', advisor: '清空当前聊天的剧情参谋记录？已整理出的路线会保留。', 'user-generation': '清空当前聊天的 User 生成记录？User 库里已保存的成品不受影响。' });
    const clearHistory = mode => {
        if (!activeStorageId || !writable || controller || !STORY_ORACLE_MODES.includes(mode)) return;
        if (!confirmAction(CLEAR_CONFIRMS[mode])) return;
        const clearRequest = mutationRequest();
        const nextStore = clearStoryOracleScope(store, clearRequest.storageId, mode);
        saveStoryOracleStore(nextStore, {
            readOnlyReason: clearRequest.readOnlyReason,
            writeHandle: clearRequest.writeHandle,
            shouldWrite: () => requestIsCurrent(clearRequest),
        }).then(saved => {
            if (saved && requestIsCurrent(clearRequest)) { store = nextStore; render('记录已清空。'); }
        }).catch(error => {
            if (requestIsCurrent(clearRequest)) render(`清空失败：${generationErrorMessage(error)}`);
        });
    };
    const userItemForButton = button => button.dataset.storyOracleUserId === 'pending'
        ? pendingUserResult
        : userGenerationItems(userStore).find(item => item.id === button.dataset.storyOracleUserId);
    const handleUserAction = async button => {
        const action = button.dataset.storyOracleAction;
        const item = userItemForButton(button);
        if (!item) { render('User 成品不存在或已被删除。'); return; }
        if (action === 'copy-user') {
            try {
                await copyUserGenerationContent(item.content);
                render('已复制 User 正文。');
            } catch (error) { render(generationErrorMessage(error)); }
            return;
        }
        if (action === 'revise-user') {
            if (controller) { render('请等待当前回复完成后再继续修改。'); return; }
            revisionTarget = { ...item };
            openConversation('user-generation', `请基于“${item.title}”继续修改：`, `正在修改“${item.title}”。请描述需要调整的内容。`);
            return;
        }
        if (!userWritable || !userWriteHandle || controller || userMutationBusy) return;
        if (action === 'delete-user' && !confirmAction(`删除 User 成品“${item.title}”？此操作不会影响访谈历史。`)) return;
        const mutationPage = page;
        userMutationBusy = true;
        try {
            let nextUserStore;
            if (action === 'save-user') {
                nextUserStore = addUserGenerationItem(userStore, {
                    ...item,
                }, { now: item.createdAt });
            } else if (action === 'delete-user') {
                nextUserStore = removeUserGenerationItem(userStore, item.id);
            } else return;
            const saved = await saveUserGenerationStore(nextUserStore, {
                readOnlyReason: userReadOnlyReason, writeHandle: userWriteHandle,
                shouldWrite: () => page === mutationPage && mutationPage?.hidden !== true,
            });
            if (!saved || page !== mutationPage) return;
            userStore = nextUserStore;
            openMenuId = '';
            if (action === 'save-user') {
                pendingUserResult = null;
                if (storyOracleView === 'user' && detailId === 'pending') detailId = item.id;
            }
            render(action === 'save-user' ? 'User 成品已保存到全局共享库。' : 'User 成品已删除。');
        } catch (error) { render(`User 库操作失败：${generationErrorMessage(error)}`); }
        finally {
            userMutationBusy = false;
            if (page === mutationPage) setBusy(Boolean(controller));
        }
    };
    const onDocumentClick = event => {
        if (!openMenuId) return;
        if (event.target?.closest?.('.pm-story-oracle-more-wrap')) return;
        closeStoryOracleMenus();
    };
    const onDocumentKeyDown = event => {
        if (event.key !== 'Escape' || (!openMenuId && !modeSheetOpen)) return;
        event.preventDefault();
        closeStoryOracleMenus();
    };
    const onClick = event => {
        const button = event.target.closest?.('[data-story-oracle-action]');
        if (!button || !boundWindow?.contains(button)) return;
        const action = button.dataset.storyOracleAction;
        if (action === 'toggle-mode') { event.preventDefault(); setModeSheetOpen(!modeSheetOpen); return; }
        if (action === 'close-mode-sheet') { setModeSheetOpen(false); return; }
        if (action === 'mode') {
            const nextMode = button.dataset.storyOracleMode;
            modeSheetOpen = false;
            if (!STORY_ORACLE_MODES.includes(nextMode) || nextMode === activeMode || controller) { syncModeSheet(); return; }
            activeMode = nextMode;
            render();
            page?.querySelector('[data-story-oracle-action="toggle-mode"]')?.focus({ preventScroll: true });
            return;
        }
        if (action === 'toggle-more') {
            const menuId = button.dataset.storyOracleMenuId || '';
            openMenuId = openMenuId === menuId ? '' : menuId;
            syncMoreMenu();
            return;
        }
        if (action === 'open-conversation') { openConversation(button.dataset.storyOracleMode || activeMode); return; }
        if (action === 'view') {
            const nextView = button.dataset.storyOracleView;
            if (TOP_VIEWS.includes(nextView)) navigate(nextView);
            return;
        }
        if (action === 'back') { navigate(returnView); return; }
        if (action === 'plan-filter') {
            planFilter = button.dataset.storyOracleFilter === 'idle' ? 'idle' : 'active';
            render();
            return;
        }
        if (action === 'open-plan') { navigate('plan', button.dataset.storyOraclePlanId || ''); return; }
        if (action === 'open-user') { navigate('user', button.dataset.storyOracleUserId || ''); return; }
        if (['copy-user', 'save-user', 'revise-user', 'delete-user'].includes(action)) {
            closeStoryOracleMenus();
            void handleUserAction(button);
            return;
        }
        if (action === 'toggle-world-book') { void toggleWorldBook(button.dataset.storyOracleBook || ''); return; }
        if (action === 'select-all-world-books') { void updateWorldBooks(getSelectedWorldBookNames().availableNames); return; }
        if (action === 'settings') { showStoryOracleSettings(); return; }
        if (action === 'edit-plan-injection') {
            closeStoryOracleMenus();
            showStoryOraclePlanInjectionEditor(button.dataset.storyOraclePlanId);
            return;
        }
        if (['continue-plan', 'toggle-plan', 'plan-intensity', 'delete-plan', 'clear-plans'].includes(action)) {
            closeStoryOracleMenus();
            void handlePlanAction(button);
            return;
        }
        if (action === 'home') {
            closeStoryOracleMenus();
            invalidate('story-oracle-home');
            deps.showPhoneDesktopPage?.();
            return;
        }
        if (action === 'cancel') { controller?.abort('story-oracle-cancelled'); return; }
        if (action === 'clear') clearHistory(button.dataset.storyOracleMode);
    };
    const onSubmit = async event => {
        const form = event.target.closest?.('[data-story-oracle-form]');
        if (!form || !boundWindow?.contains(form)) return;
        event.preventDefault();
        if (controller || !writable || !isUsableStorageId(activeStorageId)) return;
        const question = String(new FormData(form).get('question') || '').trim();
        if (!question || question.length > MAX_QUESTION_CHARS) { render('问题不能为空，且不能超过 12000 字。'); return; }
        const questionInput = form.querySelector('textarea');
        if (questionInput) questionInput.value = '';
        draft = '';
        const serial = ++requestSerial;
        controller = new AbortController();
        const request = Object.freeze({ serial, storageId: activeStorageId, mode: activeMode, page, controller, signal: controller.signal, readOnlyReason, writeHandle });
        setBusy(true);
        const history = storyOracleMessages(store, request.storageId, request.mode);
        let parsedResult = { plans: [], hadBlocks: false, invalid: false };
        let parsedUserResult = null;
        render('正在读取当前聊天上下文…');
        try {
            const worldBookState = getSelectedWorldBookNames();
            const context = await deps.gatherContext?.(null, { module: 'chat', signal: request.signal, includeWorldBook: true, worldBookMaxChars: 30000, worldBookNames: worldBookState.selectedNames });
            if (!requestIsCurrent(request)) return;
            render('正在请求剧情助手…');
            const systemPrompt = buildStoryOracleSystemPrompt(request.mode, storyOracleSettings(store, request.storageId));
            const answer = await deps.callAI?.(systemPrompt, buildStoryOracleUserPrompt(context || {}, history, question, request.mode === 'user-generation' ? revisionTarget : null), { isolated: true, signal: request.signal });
            if (!requestIsCurrent(request)) return;
            const answerText = String(answer || '').trim();
            if (!answerText) throw new Error('AI 未返回可用文本');
            parsedResult = request.mode === 'advisor' ? parseStoryPlans(answerText) : parsedResult;
            parsedUserResult = request.mode === 'user-generation' ? parseUserGenerationResponse(answerText) : null;
            const nextStore = appendStoryOracleTurn(store, request.storageId, question, answerText, request.mode, {
                selectionKey: worldBookState.selection?.scopeKey || worldBookState.selectedNames.join('｜'),
            });
            if (!await persistIfCurrent(nextStore, request)) return;
            store = nextStore;
            if (parsedUserResult?.result && !parsedUserResult.invalid) {
                if (revisionTarget && parsedUserResult.status !== 'revision') {
                    parsedUserResult = { ...parsedUserResult, invalid: true, reason: '修订结果格式无效', result: null };
                } else {
                    const createdAt = Date.now();
                    pendingUserResult = {
                        ...parsedUserResult.result, status: parsedUserResult.status,
                        id: `user-${createdAt}-${serial}`, sourceMessageId: `message-${serial}`, createdAt, updatedAt: createdAt,
                    };
                    if (parsedUserResult.status === 'revision') revisionTarget = null;
                }
            }
            const receipt = request.mode === 'user-generation'
                ? parsedUserResult?.invalid
                    ? `本轮回复已保存，但未识别到可保存的 User 成品：${parsedUserResult.reason}`
                    : parsedUserResult?.result
                        ? 'User 成品已生成，等待你确认保存或复制。'
                        : parsedUserResult?.status === 'collecting'
                            ? '本轮追问已保存，请继续补充关键素材。'
                            : '本轮回复已保存，但没有识别到 User 生成状态。'
                : parsedResult.plans.length
                ? `本轮生成 ${parsedResult.plans.length} 条路线，已加入路线页。`
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
        pendingUserResult = null;
        revisionTarget = null;
        userStore = createEmptyUserGenerationStore();
        userWritable = false;
        userReadOnlyReason = '';
        userWriteHandle = null;
        userMutationBusy = false;
        openMenuId = '';
        modeSheetOpen = false;
        draft = '';
    };
    const show = async (storageId = deps.getStorageId?.()) => {
        const nextId = String(storageId || '').trim();
        const showSerial = requestSerial + 1;
        invalidate('story-oracle-scope-changed');
        page = deps.getPhoneWindow?.()?.querySelector?.('[data-phone-page="story-oracle"]');
        if (!page) return false;
        activeStorageId = nextId;
        activeMode = 'question';
        storyOracleView = 'home';
        returnView = 'home';
        detailId = '';
        planFilter = 'active';
        openMenuId = '';
        modeSheetOpen = false;
        draft = '';
        pendingUserResult = null;
        revisionTarget = null;
        warning = '';
        try {
            const loadedUserStore = await loadUserGenerationStore();
            if (showSerial !== requestSerial) return false;
            userStore = loadedUserStore.store;
            userWritable = loadedUserStore.writable === true;
            userReadOnlyReason = loadedUserStore.readOnlyReason || '';
            userWriteHandle = loadedUserStore.writeHandle || null;
            if (loadedUserStore.warning) warning = loadedUserStore.warning;
        } catch (error) {
            if (showSerial !== requestSerial) return false;
            userStore = createEmptyUserGenerationStore(); userWritable = false; userWriteHandle = null;
            userReadOnlyReason = 'User 库读取失败'; warning = `User 库读取失败：${generationErrorMessage(error)}`;
        }
        if (isUsableStorageId(nextId)) {
            try {
                const loaded = await loadStoryOracleStore();
                if (showSerial !== requestSerial) return false;
                store = loaded.store; writable = loaded.writable === true; writeHandle = loaded.writeHandle || null; readOnlyReason = loaded.readOnlyReason || '';
                warning = [warning, loaded.warning || ''].filter(Boolean).join(' ');
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