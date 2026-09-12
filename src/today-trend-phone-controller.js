import { createTodayTrendActionDispatcher } from './today-trend-actions.js';
import { generationErrorMessage } from './ai.js';
import { getReadableWorldBookNames } from './worldbook-config.js';
import { countTodayTrendAssistantMessages } from './today-trend-scheduler.js';
import { renderTodayTrendApp } from './today-trend-view.js';

const formValues = form => new FormData(form);
const optionalPositiveInteger = value => value === null || value === '' ? undefined : Number(value);
const draftFrom = data => ({ presetName: String(data.get('presetName') || ''), worldBookNames: data.getAll('worldBookNames'),
    includeExistingChat: data.get('includeExistingChat') === 'on', backfillExistingChat: data.get('backfillExistingChat') === 'on',
    recentAssistantCount: optionalPositiveInteger(data.get('recentAssistantCount')),
    mergeAssistantCount: optionalPositiveInteger(data.get('mergeAssistantCount')),
    userRequirements: String(data.get('userRequirements') || '') });

export function createTodayTrendPhoneController({ state, deps, container }) {
    if (!container?.addEventListener || typeof deps.getStorageId !== 'function') throw new TypeError('今日风向手机控制器依赖无效');
    let dispatcher = null, settings = false, initializing = false, initializationOpen = false, reinitializing = false, initializationMode = 'reuse', error = null, renderEpoch = 0;
    let initAbort = null, lastScope = null, lastPresets = [], lastView = { name: 'world', mode: 'content' };
    let unsubscribeGeneration = null, destroyed = false, lastTerminalPhase = '', completedReloadEpoch = 0, retentionSaveEpoch = 0;
    let retentionRevisions = null, retentionSaving = false, retentionDraft = null;
    let batchDraftSaveQueue = Promise.resolve();
    let diagnosticCopyStatus = '', pendingFocusSelector = '';
    let initializationDraft = { includeExistingChat: true };
    const detailById = Object.create(null);
    const loadingDetailIds = new Set();
    let detailStorageId = '';
    const store = () => deps.getTodayTrendStore?.();
    const assistantCount = () => countTodayTrendAssistantMessages(deps.getCtx?.()?.chat);
    const uiScope = async id => typeof deps.getTodayTrendUiScope === 'function'
        ? deps.getTodayTrendUiScope(id) : (await store())?.scopes?.[id] || null;
    const worldBooks = () => getReadableWorldBookNames(deps.getCtx?.());
    const restoreFocus = (selector, epoch) => {
        if (!selector || typeof container.querySelector !== 'function') return;
        queueMicrotask(() => {
            if (destroyed || epoch !== renderEpoch) return;
            const target = container.querySelector(selector);
            if (typeof target?.focus === 'function') target.focus();
        });
    };
    const loadDetail = async (eventId, detailId) => {
        const storageId = deps.getStorageId();
        const floor = deps.getTodayTrendCurrentFloor?.();
        if (!storageId || storageId !== detailStorageId || !Number.isSafeInteger(floor) || floor < 0
            || typeof deps.resolveTodayTrendDetail !== 'function') return false;
        if (detailById[detailId] || loadingDetailIds.has(detailId)) return false;
        loadingDetailIds.add(detailId);
        try {
            await render();
            const detail = await deps.resolveTodayTrendDetail(eventId, detailId, floor);
            if (destroyed || storageId !== deps.getStorageId() || floor !== deps.getTodayTrendCurrentFloor?.()) return false;
            detailById[detailId] = detail?.status === 'available'
                ? { status: 'available', text: detail.text }
                : detail?.status === 'unavailable' && detail.code === 'TT_DETAIL_REMOVED'
                    ? { status: 'unavailable', text: '', code: detail.code } : { status: 'unknown', text: '' };
            return true;
        } finally {
            loadingDetailIds.delete(detailId);
            if (!destroyed) await render();
        }
    };
    let headProgressFrame = 0;
    let lastHeadProgress = 0;
    let headProgressLockUntil = 0;
    const syncHeadProgress = () => {
        const shell = container.querySelector?.('.pm-today-trend-shell');
        if (!shell || typeof shell.style?.setProperty !== 'function') return;
        const content = container.querySelector?.('.pm-today-trend-content');
        if (!content) return;
        const now = typeof performance?.now === 'function' ? performance.now() : Date.now();
        // 折叠过渡期间不再重算：折叠会缩短滚动高度并让浏览器回夹 scrollTop，重算会在半压位置反复翻转
        if (now < headProgressLockUntil) return;
        const top = Number(content.scrollTop) || 0;
        const slack = (Number(content.scrollHeight) || 0) - (Number(content.clientHeight) || 0);
        // 可滚动余量不足时禁止折叠，避免折叠后 scrollTop 被回夹到展开区间
        const next = lastHeadProgress ? (top > 16 ? 1 : 0) : (slack >= 96 && top > 40 ? 1 : 0);
        if (next === lastHeadProgress) return;
        lastHeadProgress = next;
        headProgressLockUntil = now + 260;
        shell.style.setProperty('--pm-today-trend-head-progress', String(next));
    };
    const scheduleHeadProgress = () => {
        if (typeof requestAnimationFrame !== 'function') { syncHeadProgress(); return; }
        if (headProgressFrame) return;
        headProgressFrame = requestAnimationFrame(() => { headProgressFrame = 0; syncHeadProgress(); });
    };
    const onHeadScroll = () => scheduleHeadProgress();
    const bindHeadProgress = () => {
        const content = container.querySelector?.('.pm-today-trend-content');
        if (!content || typeof content.addEventListener !== 'function') return;
        content.addEventListener('scroll', onHeadScroll, { passive: true });
        syncHeadProgress();
    };

    const render = async view => {
        if (destroyed) return false;
        const epoch = ++renderEpoch;
        const current = await store();
        if (destroyed || epoch !== renderEpoch || state.phoneWindow?.querySelector('.pm-today-trend-page') !== container) return false;
        const id = deps.getStorageId();
        const scope = await uiScope(id);
        if (destroyed || epoch !== renderEpoch || state.phoneWindow?.querySelector('.pm-today-trend-page') !== container) return false;
        if (view?.name === 'settings') settings = true;
        const activeView = view || (settings ? lastView : dispatcher?.state() || lastView);
        lastView = settings ? { ...activeView, name: 'settings' } : activeView;
        let revisions = retentionRevisions;
        if (lastView.name === 'settings' && typeof deps.getTodayTrendRetentionSettingsState === 'function') {
            revisions = await deps.getTodayTrendRetentionSettingsState(id);
            if (destroyed || epoch !== renderEpoch || state.phoneWindow?.querySelector('.pm-today-trend-page') !== container) return false;
        }
        if (detailStorageId !== id) {
            detailStorageId = id;
            for (const key of Object.keys(detailById)) delete detailById[key];
        }
        lastScope = scope; lastPresets = Object.values(current?.presets || {}); retentionRevisions = revisions;
        const currentFloor = deps.getTodayTrendCurrentFloor?.();
        const currentAssistantCount = assistantCount();
        container.innerHTML = renderTodayTrendApp({ scope, presets: Object.values(current?.presets || {}), worldBooks: worldBooks(),
            view: lastView,
            generation: deps.getTodayTrendGenerationState?.() || {}, currentFloor, error, initializing, initializationDraft, initializationOpen, reinitializing, initializationMode,
            detailById, loadingDetailIds, retentionRevisions, retentionSaving, retentionDraft, diagnosticCopyStatus, assistantCount: currentAssistantCount, batchDraft: scope?.operation?.batchDraft });
        bindHeadProgress();

        const focusSelector = pendingFocusSelector;
        pendingFocusSelector = '';
        restoreFocus(focusSelector, epoch);
        return true;
    };
    const report = cause => {
        if (destroyed || cause?.name === 'AbortError') return;
        const code = /^TT_[A-Z0-9_]+$/.test(String(cause?.code || '')) ? String(cause.code) : '';
        error = { message: generationErrorMessage(cause), code };
        diagnosticCopyStatus = '';
        pendingFocusSelector = code === 'TT_RETENTION_SETTINGS_INVALID'
            ? 'form[data-today-trend-form="retention-settings"] input:invalid'
            : code === 'TT_SETTINGS_REVISION_CONFLICT' ? '.pm-today-trend-error' : '';
        render().catch(() => {});
    };
    const rerender = view => render(view).catch(report);
    const generationChanged = snapshot => {
        if (destroyed || !snapshot) return;
        const currentStorageId = deps.getStorageId();
        const taskIsCurrent = snapshot.task?.storageId === currentStorageId;
        const busy = ['queued', 'generating', 'parsing', 'committing'].includes(snapshot.phase);
        if (busy && taskIsCurrent) {
            lastTerminalPhase = '';
            rerender();
            return;
        }
        if (snapshot.phase === 'completed' && taskIsCurrent) {
            const completedStorageId = currentStorageId;
            const epoch = ++completedReloadEpoch;
            Promise.resolve(deps.reloadTodayTrendStore?.()).then(() => {
                if (destroyed || epoch !== completedReloadEpoch || deps.getStorageId() !== completedStorageId) return false;
                return rerender();
            }).catch(cause => {
                if (destroyed || epoch !== completedReloadEpoch || deps.getStorageId() !== completedStorageId) return;
                report(cause);
            });
            return;
        }
        if (['failed', 'canceled'].includes(snapshot.phase)) {
            if (snapshot.task && !taskIsCurrent) return;
            if (lastTerminalPhase === snapshot.phase) return;
            lastTerminalPhase = snapshot.phase;
            rerender();
            return;
        }
        if (snapshot.phase === 'idle') lastTerminalPhase = '';
    };
    const saveRule = async (rule, text) => {
        const current = await store(), id = deps.getStorageId(), scope = current?.scopes?.[id], preset = current?.presets?.[scope?.presetId];
        const [group, key = ''] = String(rule).split('-');
        const rules = group === 'dynamics' && key ? preset?.dynamicsRules : preset?.moduleRules;
        const field = group === 'dynamics' && key ? key : group;
        if (!preset || !Object.hasOwn(rules || {}, field)) throw new Error('当前模块规则不可用');
        const normalized = String(text || '').trim();
        if (!normalized) throw new Error('模块规则不能为空');
        if (typeof deps.saveTodayTrendRule !== 'function') throw new Error('模块规则保存能力不可用');
        return deps.saveTodayTrendRule(rule, normalized, preset.id, preset.revision);
    };
    const regenerateRule = async rule => {
        if (typeof deps.regenerateTodayTrendRule !== 'function') throw new Error('模块规则重新生成能力不可用');
        error = null;
        await deps.regenerateTodayTrendRule(rule);
        return rerender();
    };
    const generate = async (module, itemId, options = {}) => {
        error = null; await render();
        try {
            await (module ? deps.generateTodayTrendModule?.(module, itemId, options) : deps.generateTodayTrend?.(options));
        } catch (cause) {
            if (cause?.name === 'AbortError') { await render(); return false; }
            report(cause); return false;
        }
        await render(); return true;
    };
    const setRuleEditorState = (editing, returnName) => {
        settings = editing ? false : returnName === 'settings';
    };
    dispatcher = createTodayTrendActionDispatcher({ container, getStorageId: deps.getStorageId, getStore: store,
        committer: { commitScope: (...args) => deps.commitTodayTrendScope?.(...args) }, render: rerender,
        onGenerate: module => generate(module), onRefresh: (module, itemId, options) => generate(module, itemId, options), onLoadDetail: loadDetail,
        onSaveRule: saveRule, onRegenerateRule: regenerateRule, onRuleEditorStateChange: setRuleEditorState, onError: report });
    const openInitialization = ({ replace = false } = {}) => {
        const preset = replace ? lastPresets.find(item => item.id === lastScope?.presetId) : null;
        initializationDraft = preset ? { presetName: preset.name, ...preset.source } : { includeExistingChat: true };
        error = null; settings = false; initializationOpen = true; reinitializing = replace; initializationMode = replace || !lastPresets.length ? 'create' : 'reuse'; rerender();
    };
    const saveOperation = async enabled => {
        const current = await store(), scope = current?.scopes?.[deps.getStorageId()];
        if (!scope || typeof deps.saveTodayTrendSettings !== 'function') throw new Error('今日风向设置保存能力不可用');
        return deps.saveTodayTrendSettings({ presetId: scope.presetId, operation: { ...scope.operation, enabled }, injection: scope.injection });
    };
    const saveBatchDraft = async draft => {
        const save = async () => {
            const current = await store(), scope = current?.scopes?.[deps.getStorageId()];
            if (!scope || typeof deps.saveTodayTrendSettings !== 'function') throw new Error('今日风向设置保存能力不可用');
            const batchDraft = { ...scope.operation?.batchDraft, ...draft };
            if (Number.isSafeInteger(batchDraft.recentAssistantCount) && Number.isSafeInteger(batchDraft.mergeAssistantCount)
                && batchDraft.mergeAssistantCount > batchDraft.recentAssistantCount) {
                throw new Error('每批合并层数不能超过最近处理层数');
            }
            const committed = await deps.saveTodayTrendSettings({ presetId: scope.presetId,
                operation: { ...scope.operation, batchDraft }, injection: scope.injection });
            if (committed) await rerender();
            return committed;
        };
        const pending = batchDraftSaveQueue.then(save, save);
        batchDraftSaveQueue = pending.catch(() => {});
        return pending;
    };
    const click = event => {
        const button = event.target.closest?.('button[data-action]');
        if (!button || !container.contains(button) || button.disabled) return;
        if (button.dataset.action === 'today-trend-toggle-batch') {
            return saveBatchDraft({ enabled: !lastScope?.operation?.batchDraft?.enabled }).catch(report);
        }
        if (button.dataset.action === 'today-trend-batch-generate') {
            const form = button.closest('form[data-today-trend-form="batch-settings"]');
            const data = form ? formValues(form) : null;
            if (!form?.checkValidity?.()) { form?.reportValidity?.(); return; }
            const currentCount = assistantCount();
            const recentAssistantCount = Number(data?.get('recentAssistantCount'));
            const mergeAssistantCount = Number(data?.get('mergeAssistantCount'));
            if (!Number.isSafeInteger(currentCount) || currentCount < 1) {
                return report(new Error('当前聊天没有可处理的 AI 回复楼层'));
            }
            if (!Number.isSafeInteger(recentAssistantCount) || recentAssistantCount < 1 || recentAssistantCount > currentCount) {
                return report(new Error('最近处理层数必须在当前聊天 AI 回复累计层数范围内'));
            }
            if (!Number.isSafeInteger(mergeAssistantCount) || mergeAssistantCount < 1 || mergeAssistantCount > recentAssistantCount) {
                return report(new Error('每批合并层数必须在最近处理层数范围内'));
            }
            return saveBatchDraft({ enabled: true, recentAssistantCount, mergeAssistantCount })
                .then(() => generate(null, null, { batchEnabled: true, recentAssistantCount, mergeAssistantCount })).catch(report);
        }
        if (button.dataset.action === 'today-trend-open-settings') { settings = true; rerender(); }
        if (button.dataset.action === 'today-trend-close-settings') { settings = false; retentionDraft = null; rerender(); }
        if (button.dataset.action === 'today-trend-use-preset') { initializationMode = 'reuse'; error = null; rerender(); }
        if (button.dataset.action === 'today-trend-create-preset') { initializationMode = 'create'; error = null; rerender(); }
        if (['today-trend-open-world', 'today-trend-open-reputation', 'today-trend-open-factions', 'today-trend-open-dynamics'].includes(button.dataset.action)) settings = false;
        if (button.dataset.action === 'today-trend-toggle-operation') saveOperation(!lastScope?.operation?.enabled).then(() => rerender()).catch(report);
        if (button.dataset.action === 'today-trend-cancel-generation') {
            deps.cancelTodayTrendGeneration?.('today-trend-user-canceled');
            rerender();
        }
        if (button.dataset.action === 'today-trend-new-preset') openInitialization();
        if (button.dataset.action === 'today-trend-reinitialize') openInitialization({ replace: true });
        if (button.dataset.action === 'today-trend-rename-preset') {
            const presetId = button.closest?.('form')?.querySelector?.('[name="presetId"]')?.value;
            const preset = lastPresets.find(item => item.id === presetId);
            const name = globalThis.prompt?.('重命名世界预设', preset?.name || '');
            if (name === null || name === undefined || !String(name).trim()) return;
            Promise.resolve(deps.renameTodayTrendPreset?.(presetId, name)).then(() => rerender()).catch(report);
        }
        if (button.dataset.action === 'today-trend-cancel-initialize') { initAbort?.abort('today-trend-initialization-canceled'); deps.cancelTodayTrendInitialization?.('today-trend-initialization-canceled'); initializing = false; initializationOpen = false; reinitializing = false; error = null; rerender(); }
        if (button.dataset.action === 'today-trend-copy-diagnostic-code') {
            const code = /^TT_[A-Z0-9_]+$/.test(String(button.dataset.code || '')) ? String(button.dataset.code) : '';
            if (!code) return;
            const write = globalThis.navigator?.clipboard?.writeText;
            if (typeof write !== 'function') {
                diagnosticCopyStatus = '复制失败：当前环境不支持剪贴板。';
                rerender();
                return;
            }
            Promise.resolve(write.call(globalThis.navigator.clipboard, code)).then(() => {
                if (destroyed) return;
                diagnosticCopyStatus = '诊断码已复制。'; rerender();
            }).catch(() => {
                if (destroyed) return;
                diagnosticCopyStatus = '复制失败，请手动选择诊断码。'; rerender();
            });
        }
        if (button.dataset.action === 'today-trend-delete-preset') {
            const presetId = button.closest?.('form')?.querySelector?.('[name="presetId"]')?.value;
            if (!presetId || !globalThis.confirm?.('删除世界预设不可恢复。确定继续吗？')) return;
            Promise.resolve(deps.deleteTodayTrendPreset?.(presetId)).then(() => rerender()).catch(report);
        }
    };
    const submit = event => {
        const form = event.target;
        if (!form?.matches?.('form[data-today-trend-form]') || !container.contains(form)) return;
        const data = formValues(form);
        if (form.dataset.todayTrendForm === 'initialize') {
            event.preventDefault();
            if (initializing || typeof deps.initializeTodayTrend !== 'function') return;
            if (!form.checkValidity?.()) { form.reportValidity?.(); return; }
            const runBackfill = event.submitter?.dataset?.action === 'today-trend-initialize-and-batch';
            initializationDraft = draftFrom(data);
            if (initializationDraft.backfillExistingChat === true) {
                const currentCount = assistantCount();
                if (currentCount > 0 && (!Number.isSafeInteger(initializationDraft.recentAssistantCount)
                    || initializationDraft.recentAssistantCount < 1 || initializationDraft.recentAssistantCount > currentCount)) {
                    return report(new Error('最近处理层数必须在当前聊天 AI 回复累计层数范围内'));
                }
                if (currentCount > 0 && (!Number.isSafeInteger(initializationDraft.mergeAssistantCount)
                    || initializationDraft.mergeAssistantCount < 1 || initializationDraft.mergeAssistantCount > initializationDraft.recentAssistantCount)) {
                    return report(new Error('每批合并层数必须在最近处理层数范围内'));
                }
            }
            const taskAbort = new AbortController(); initAbort = taskAbort; initializing = true; error = null; rerender();
            deps.initializeTodayTrend({ ...initializationDraft, runBackfill,
                presetId: reinitializing ? lastScope?.presetId : '', signal: taskAbort.signal }).then(() => {
                if (taskAbort.signal.aborted || initAbort !== taskAbort) return;
                const openedWithBackfill = initializationDraft.backfillExistingChat === true;
                initializing = false; initAbort = null; initializationOpen = false; reinitializing = false; initializationMode = 'reuse'; initializationDraft = { includeExistingChat: true };
                if (openedWithBackfill) { settings = true; pendingFocusSelector = 'form[data-today-trend-form="batch-settings"] input[name="recentAssistantCount"]'; }
                rerender();
            }).catch(cause => {
                if (taskAbort.signal.aborted || initAbort !== taskAbort) return;
                initializing = false; initAbort = null;
                if (runBackfill && initializationDraft.backfillExistingChat === true) {
                    initializationOpen = false;
                    reinitializing = false;
                    initializationMode = 'reuse';
                    settings = true;
                }
                report(cause);
            });
        }
        if (form.dataset.todayTrendForm === 'bind-preset') {
            event.preventDefault();
            if (typeof deps.bindTodayTrendPreset !== 'function') return report(new Error('世界预设绑定能力不可用'));
            deps.bindTodayTrendPreset(data.get('presetId'), { start: true }).then(() => rerender()).catch(report);
        }
        if (form.dataset.todayTrendForm === 'app-settings') {
            event.preventDefault(); const id = deps.getStorageId();
            const presetId = String(data.get('presetId') || '');
            if (typeof deps.saveTodayTrendSettings !== 'function') return report(new Error('今日风向设置保存能力不可用'));
            store().then(current => {
                const currentScope = current?.scopes?.[id];
                if (presetId && presetId !== currentScope?.presetId) {
                    if (!globalThis.confirm?.('切换世界预设会清空当前角色的今日风向资料。确定继续吗？')) return false;
                }
                return deps.saveTodayTrendSettings({ presetId, operation: { ...currentScope?.operation, mode: data.get('mode'), intervalFloors: Number(data.get('intervalFloors')) }, injection: { enabled: data.get('injectionEnabled') === 'on', minimalUi: data.get('minimalUi') === 'on' } });
            }).then(committed => {
                if (!committed) return;
                retentionDraft = null;
                settings = false; return rerender();
            }).catch(report);
        }
        if (form.dataset.todayTrendForm === 'retention-settings') {
            event.preventDefault();
            if (retentionSaving) return;
            if (typeof deps.saveTodayTrendRetentionSettings !== 'function') return report(new Error('归档保留设置保存能力不可用'));
            const storageId = deps.getStorageId();
            const submittedDraft = {
                archivedDetailLatestEventCount: String(data.get('archivedDetailLatestEventCount') || ''),
                archivedDetailRetentionFloors: String(data.get('archivedDetailRetentionFloors') || ''),
            };
            const epoch = ++retentionSaveEpoch;
            retentionSaving = true;
            retentionDraft = submittedDraft;
            error = null;
            rerender();
            Promise.resolve(deps.saveTodayTrendRetentionSettings({
                storageId,
                ...submittedDraft,
                expectedScopeRevision: Number(data.get('expectedScopeRevision')),
                expectedSettingsRevision: Number(data.get('expectedSettingsRevision')),
            })).then(async committed => {
                if (!committed || destroyed || epoch !== retentionSaveEpoch || deps.getStorageId() !== storageId) return false;
                await deps.reloadTodayTrendStore?.();
                if (destroyed || epoch !== retentionSaveEpoch || deps.getStorageId() !== storageId) return false;
                retentionRevisions = committed.revisions || null;
                retentionDraft = null;
                error = null;
                return rerender();
            }).catch(async cause => {
                if (destroyed || epoch !== retentionSaveEpoch || deps.getStorageId() !== storageId || cause?.name === 'AbortError') return;
                if (cause?.code === 'TT_SETTINGS_REVISION_CONFLICT') {
                    try {
                        await deps.reloadTodayTrendStore?.();
                        if (destroyed || epoch !== retentionSaveEpoch || deps.getStorageId() !== storageId) return;
                        retentionRevisions = await deps.getTodayTrendRetentionSettingsState?.(storageId) || null;
                        lastScope = await uiScope(storageId);
                    } catch { /* Preserve the original conflict as the actionable diagnostic. */ }
                }
                report(cause);
            }).finally(() => {
                if (destroyed || epoch !== retentionSaveEpoch) return;
                retentionSaving = false;
                rerender();
            });
        }
    };
    const change = event => {
        const initializationInput = event.target.closest?.('form[data-today-trend-form="initialize"] input[name="backfillExistingChat"]');
        if (initializationInput?.name === 'backfillExistingChat' && container.contains(initializationInput) && !initializationInput.disabled) {
            const form = initializationInput.closest('form[data-today-trend-form="initialize"]');
            if (!form) return;
            initializationDraft = draftFrom(formValues(form));
            rerender();
            return;
        }
        const input = event.target.closest?.('input[name="batchEnabled"], input[name="recentAssistantCount"], input[name="mergeAssistantCount"]');
        if (!input || !container.contains(input) || input.disabled) return;
        if (input.name === 'batchEnabled') return saveBatchDraft({ enabled: input.checked === true }).catch(report);
        const value = Number(input.value);
        if (!Number.isSafeInteger(value) || value < 1) return;
        return saveBatchDraft({ [input.name]: value }).catch(report);
    };
    container.addEventListener('click', click, true); container.addEventListener('change', change);
    container.addEventListener('submit', submit);

    unsubscribeGeneration = deps.subscribeTodayTrendGeneration?.(generationChanged) || null;
    const destroy = () => {
        if (destroyed) return false;
        destroyed = true;
        completedReloadEpoch += 1;
        retentionSaveEpoch += 1;
        renderEpoch += 1;
        initAbort?.abort('today-trend-page-destroyed');
        deps.cancelTodayTrendInitialization?.('today-trend-page-destroyed');
        unsubscribeGeneration?.();
        unsubscribeGeneration = null;
        dispatcher.destroy();
        container.removeEventListener('click', click, true);
        container.removeEventListener('change', change);
        container.removeEventListener('submit', submit);
        if (headProgressFrame && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(headProgressFrame);
        headProgressFrame = 0;

        return true;
    };
    return { destroy, render };
}
