import { createTodayTrendActionDispatcher } from './today-trend-actions.js';
import { generationErrorMessage } from './ai.js';
import { getReadableWorldBookNames } from './worldbook-config.js';
import { renderTodayTrendApp } from './today-trend-view.js';

const formValues = form => new FormData(form);
const draftFrom = data => ({ presetName: String(data.get('presetName') || ''), worldBookNames: data.getAll('worldBookNames'), includeExistingChat: data.get('includeExistingChat') === 'on', userRequirements: String(data.get('userRequirements') || '') });

export function createTodayTrendPhoneController({ state, deps, container }) {
    if (!container?.addEventListener || typeof deps.getStorageId !== 'function') throw new TypeError('今日风向手机控制器依赖无效');
    let dispatcher = null, settings = false, initializing = false, initializationOpen = false, reinitializing = false, error = '', renderEpoch = 0;
    let initAbort = null, lastScope = null, lastPresets = [], lastView = { name: 'world', mode: 'content' };
    let initializationDraft = { includeExistingChat: true };
    const store = () => deps.getTodayTrendStore?.();
    const worldBooks = () => getReadableWorldBookNames(deps.getCtx?.());
    const render = async view => {
        const epoch = ++renderEpoch;
        const current = await store();
        if (epoch !== renderEpoch || state.phoneWindow?.querySelector('.pm-today-trend-page') !== container) return false;
        const id = deps.getStorageId();
        const scope = current?.scopes?.[id] || null;
        lastScope = scope; lastPresets = Object.values(current?.presets || {});
        lastView = settings ? { name: 'settings' } : view || dispatcher?.state() || lastView;
        container.innerHTML = renderTodayTrendApp({ scope, presets: Object.values(current?.presets || {}), worldBooks: worldBooks(),
            view: lastView,
            generation: deps.getTodayTrendGenerationState?.() || {}, error, initializing, initializationDraft, initializationOpen, reinitializing });
        return true;
    };
    const report = cause => {
        error = generationErrorMessage(cause);
        container.innerHTML = renderTodayTrendApp({ scope: lastScope, presets: lastPresets, worldBooks: worldBooks(), view: lastView,
            error, initializing: false, initializationDraft, initializationOpen, reinitializing });
    };
    const rerender = view => render(view).catch(report);
    const editRule = async rule => {
        const current = await store(), id = deps.getStorageId(), scope = current?.scopes?.[id], preset = current?.presets?.[scope?.presetId];
        const [group, key = ''] = String(rule).split('-');
        const rules = group === 'dynamics' && key ? preset?.dynamicsRules : preset?.moduleRules;
        const field = group === 'dynamics' && key ? key : group;
        if (!preset || !Object.hasOwn(rules || {}, field)) throw new Error('当前模块规则不可用');
        const value = globalThis.prompt?.(`编辑${rule}规则`, rules[field]);
        if (value === null || value === undefined) return false;
        const text = String(value).trim();
        if (!text) throw new Error('模块规则不能为空');
        if (typeof deps.saveTodayTrendRule !== 'function') throw new Error('模块规则保存能力不可用');
        return deps.saveTodayTrendRule(rule, text, preset.id, preset.revision);
    };
    const regenerateRule = async rule => {
        if (typeof deps.regenerateTodayTrendRule !== 'function') throw new Error('模块规则重新生成能力不可用');
        error = '';
        await deps.regenerateTodayTrendRule(rule);
        return rerender();
    };
    const generate = async (module, itemId, options = {}) => {
        error = ''; await render();
        try { await (module ? deps.generateTodayTrendModule?.(module, itemId, options) : deps.generateTodayTrend?.({})); }
        catch (cause) { report(cause); return false; }
        await render(); return true;
    };
    dispatcher = createTodayTrendActionDispatcher({ container, getStorageId: deps.getStorageId, getStore: store,
        committer: { commitScope: (...args) => deps.commitTodayTrendScope?.(...args) }, render: rerender,
        onGenerate: module => generate(module), onRefresh: (module, itemId, options) => generate(module, itemId, options),
        onEditRule: (rule, regenerate) => regenerate ? regenerateRule(rule) : editRule(rule).then(rerender), onError: report });
    const openInitialization = ({ replace = false } = {}) => {
        const preset = replace ? lastPresets.find(item => item.id === lastScope?.presetId) : null;
        initializationDraft = preset ? { presetName: preset.name, ...preset.source } : { includeExistingChat: true };
        error = ''; settings = false; initializationOpen = true; reinitializing = replace; rerender();
    };
    const saveOperation = async enabled => {
        const current = await store(), scope = current?.scopes?.[deps.getStorageId()];
        if (!scope || typeof deps.saveTodayTrendSettings !== 'function') throw new Error('今日风向设置保存能力不可用');
        return deps.saveTodayTrendSettings({ presetId: scope.presetId, operation: { ...scope.operation, enabled }, injection: scope.injection });
    };
    const click = event => {
        const button = event.target.closest?.('button[data-action]');
        if (!button || !container.contains(button) || button.disabled) return;
        if (button.dataset.action === 'today-trend-open-settings') { settings = true; rerender(); }
        if (button.dataset.action === 'today-trend-close-settings') { settings = false; rerender(); }
        if (button.dataset.action === 'today-trend-run-now') generate();
        if (button.dataset.action === 'today-trend-toggle-operation') saveOperation(!lastScope?.operation?.enabled).then(() => rerender()).catch(report);
        if (button.dataset.action === 'today-trend-new-preset') openInitialization();
        if (button.dataset.action === 'today-trend-reinitialize') openInitialization({ replace: true });
        if (button.dataset.action === 'today-trend-cancel-initialize') { initAbort?.abort('today-trend-initialization-canceled'); deps.cancelTodayTrendInitialization?.('today-trend-initialization-canceled'); initializing = false; initializationOpen = false; reinitializing = false; error = ''; rerender(); }
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
            initializationDraft = draftFrom(data); const taskAbort = new AbortController(); initAbort = taskAbort; initializing = true; error = ''; rerender();
            deps.initializeTodayTrend({ ...initializationDraft, presetId: reinitializing ? lastScope?.presetId : '', signal: taskAbort.signal }).then(() => {
                if (taskAbort.signal.aborted || initAbort !== taskAbort) return;
                initializing = false; initAbort = null; initializationOpen = false; reinitializing = false; initializationDraft = { includeExistingChat: true }; rerender();
            }).catch(cause => {
                if (taskAbort.signal.aborted || initAbort !== taskAbort) return;
                initializing = false; initAbort = null; report(cause);
            });
        }
        if (form.dataset.todayTrendForm === 'bind-preset') {
            event.preventDefault();
            if (typeof deps.bindTodayTrendPreset !== 'function') return report(new Error('世界预设绑定能力不可用'));
            deps.bindTodayTrendPreset(data.get('presetId'), { start: true }).then(() => rerender()).catch(report);
        }
        if (form.dataset.todayTrendForm === 'app-settings') {
            event.preventDefault(); const id = deps.getStorageId();
            const enabled = data.get('enabled') === 'on', presetId = String(data.get('presetId') || '');
            if (typeof deps.saveTodayTrendSettings !== 'function') return report(new Error('今日风向设置保存能力不可用'));
            store().then(current => {
                const currentScope = current?.scopes?.[id];
                if (presetId && presetId !== currentScope?.presetId) {
                    if (!globalThis.confirm?.('切换世界预设会清空当前角色的今日风向资料。确定继续吗？')) return false;
                }
                return deps.saveTodayTrendSettings({ presetId, operation: { enabled, mode: data.get('mode'), intervalFloors: Number(data.get('intervalFloors')) }, injection: { enabled: data.get('injectionEnabled') === 'on' } });
            }).then(committed => {
                if (!committed) return;
                settings = false; return rerender();
            }).catch(report);
        }
    };
    container.addEventListener('click', click); container.addEventListener('submit', submit);
    return { destroy: () => { initAbort?.abort('today-trend-page-destroyed'); deps.cancelTodayTrendInitialization?.('today-trend-page-destroyed'); dispatcher.destroy(); container.removeEventListener('click', click); container.removeEventListener('submit', submit); }, render };
}
