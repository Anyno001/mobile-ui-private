// 剧情助手里的剧情注入器：项目、进度、设定、大纲的状态与动作。模板在 story-plot-views.js，弹窗与文件在 story-plot-io.js。
// 数据层与运行时从 deps.plotInjector.getPlotApi() 取：同页装了独立版时是独立版的，否则是天音自己的，改的都是同一份数据。
// AI 写设定、写大纲一律走天音的接口（剧情设定模块），可停止。
import { API_ROUTE_MODULES, loadApiRoutes, profileDisplayName } from './api-routes.js';
import { bindPressGesture } from './press-gesture.js';
import { loadProfiles } from './storage-preferences.js';
import { BUILTIN_GUIDE } from './plot-injector/core/guide.js';
import { DEFAULT_PARAMS, POSITIONS, ROLES, buildIndexText, carriedNodes } from './plot-injector/core/inject.js';
import { flattenUnits, outlineToText, pushOutlineHistory, stageLabel, stageNodes, volumeLabel } from './plot-injector/core/outline.js';
import { STATES, STATE_LABELS, checkBase, currentIndex, emptyProgress, goTo, offNodes, patchSlot, setNodeChecked, unitStates } from './plot-injector/core/progress.js';
import { rewriteRestMessages, transcript } from './plot-injector/core/prompts.js';
import { joinBlocks, pushHistory, splitBlocks } from './plot-injector/core/setting.js';
import { groupProjects, normalizeChat, normalizeProject } from './plot-injector/core/store.js';
import { outlineLinks, withAliases } from './plot-injector/core/align.js';
import { liveThreads, maskUnits, patchLive, threadSwitches } from './plot-injector/core/threads.js';
import { PLOT_TABS, renderPlotHomeCard, renderPlotNotices, renderPlotPage, renderPlotPrefs, renderPlotSettings, renderPlotSheet, renderPlotStage } from './story-plot-views.js';
import { downloadText, openPlotDialog, pickAction, pickOption, pickTextFile, promptText, showText } from './story-plot-io.js';
import { createPlotSettingActions } from './story-plot-setting.js';
import { createInfiniteActions } from './story-plot-infinite.js';
import { createPlotOutlineActions } from './story-plot-outline.js';
import { normalizeInfinite } from './plot-injector/core/infinite.js';
import { escapeAttr as rawEscapeAttr, escapeHtml as rawEscapeHtml } from './ui.js';

// 剧情数据来自 YAML，值可能是数字或布尔：先转字符串再转义。
const escapeHtml = value => rawEscapeHtml(value == null ? '' : String(value));
const escapeAttr = value => rawEscapeAttr(value == null ? '' : String(value));

const PLOT_ROUTE_KEYS = Object.freeze([['oracle', '剧情聊天'], ['plotSetting', '剧情设定'], ['plotCheck', '剧情检测']]);
const BACKUP_FORMAT = 'plot-injector-project';
const ADVISOR_CONTEXT_LIMIT = 12000;
const HOLD_CLICK_GUARD_MS = 400;

// rerender(status)：重画剧情助手当前页；navigate(view)：切到剧情助手的某一页；getAdvisorMessages()：剧情参谋的对话记录。
export function createStoryPlot(deps, { rerender, navigate, getAdvisorMessages, openAdvisor }) {
    const plot = () => deps.plotInjector || null;
    const api = () => plot()?.getPlotApi?.() || null;
    let tab = 'progress';
    let viewedId = '';
    let stageId = '';
    let nodeKind = 'main';
    let sheet = null;
    let settingDraft = null;
    let expiredOpen = false;
    let busy = '';
    let task = null;
    let unsubscribe = [];
    let sheetUnbinds = [];
    let clickGuardUntil = 0;
    let renderQueued = false;
    let currentPage = null;
    let currentView = '';

    const toast = (kind, message) => plot()?.host?.toast?.(kind, message);
    const hasCard = () => Boolean(plot()?.host?.cardKey?.());
    const index = () => api()?.data?.index?.() || { projects: [], active: {}, settings: {} };
    const settings = () => api()?.data?.settings?.() || {};
    const guideText = () => String(settings().guide || '').trim() || BUILTIN_GUIDE;
    const project = id => (id ? api()?.data?.project?.(id) || null : null);
    const ensureProject = async id => (id ? (project(id) || await api()?.data?.loadProject?.(id)) : null);
    const activeId = () => api()?.runtime?.activeId?.() || '';

    function resolveViewedId() {
        const ids = index().projects.map(item => item.id);
        if (viewedId && ids.includes(viewedId)) return viewedId;
        viewedId = activeId() || ids[0] || '';
        return viewedId;
    }

    // 合并同一轮里的多次刷新。
    function scheduleRender() {
        if (renderQueued) return;
        renderQueued = true;
        Promise.resolve().then(() => { renderQueued = false; rerender(); });
    }

    // 某个项目的阶段与状态：当前聊天用的项目按聊天进度算，其余按空进度显示。
    // units 按项目的支线、世界动态开关遮罩（执行页只显示开着的一类）；遮罩只删字段，阶段 id 与状态不变。
    function stateOf(target) {
        const all = target ? flattenUnits(target.outline.volumes) : [];
        const sw = threadSwitches(target);
        const units = maskUnits(all, sw);
        const isActive = target && target.id === activeId();
        const progress = isActive ? api().runtime.progress() : emptyProgress(target?.id || '');
        return { units, sw, progress, states: units.length ? unitStates(units, progress) : {}, isActive };
    }

    // 当前聊天项目的支线钩子与进度钟（执行页显示、菜单操作都按它）。
    function liveOf(units, states, progress) {
        const s = settings();
        return liveThreads(units, states, progress, { carryOver: s.carryOver !== false, hookCap: s.hookCap });
    }

    function routeRows() {
        const routes = globalThis.window?.__pmApiRoutes || loadApiRoutes();
        if (Object.values(routes || {}).some(route => route && route !== 'main') && !globalThis.window?.__pmProfiles?.length) loadProfiles();
        const profiles = globalThis.window?.__pmProfiles || [];
        const known = new Set(API_ROUTE_MODULES.map(item => item.key));
        return PLOT_ROUTE_KEYS.filter(([key]) => known.has(key)).map(([key, label]) => {
            const route = routes?.[key] || '';
            const profile = route && route !== 'main' ? profiles.find(item => item?.id === route) : null;
            return { key, label, value: !route ? '跟随默认' : route === 'main' ? '酒馆主API' : profile ? profileDisplayName(profile) : '跟随默认（预设已删除）' };
        });
    }
    // 剧情页、首页项目卡、设置共用的视图模型。target='home' 时看当前聊天用的项目，否则看剧情页正在看的项目。
    function buildVm({ target = 'page', openMenuId = '' } = {}) {
        const plotApi = api();
        const ready = Boolean(plotApi?.data?.isReady?.());
        const idx = index();
        const active = activeId();
        const id = target === 'home' ? active : resolveViewedId();
        const shown = project(id);
        if (id && !shown && ready) ensureProject(id).then(found => { if (found) scheduleRender(); }).catch(() => {});
        if (active && !project(active) && ready) ensureProject(active).then(found => { if (found) scheduleRender(); }).catch(() => {});
        const { units, sw, progress, states, isActive } = stateOf(shown);
        const unit = units.find(item => states[item.id] === 'active');
        const off = unit ? new Set(offNodes(progress, unit)) : new Set();
        const mains = unit ? stageNodes(unit.stage.data).filter(node => node.kind === 'main') : [];
        const s = settings();
        const stage = stageId && shown ? shown.outline.volumes.map(volume => ({ volume, stage: volume.stages.find(item => item.id === stageId) })).find(item => item.stage) || null : null;
        const vm = {
            ready,
            owner: plotApi?.owner || 'tianyin',
            yielded: plotApi?.owner === 'standalone',
            hasCard: hasCard(),
            projects: idx.projects,
            groups: groupProjects(idx.projects),
            projectCount: idx.projects.length,
            activeId: active,
            active: project(active),
            cardDefaultId: plotApi?.data?.activeIdFor?.() || '',
            viewed: target === 'home' ? project(active) : shown,
            tab, units, progress, states,
            carried: isActive && s.carryOver !== false && units.length ? carriedNodes(units, states, progress, { withOff: true }) : [],
            live: isActive && units.length ? liveOf(units, states, progress) : { clocks: [], hooks: [] },
            switches: sw, expiredOpen,
            mainCount: { done: mains.filter(node => off.has(node.id)).length, total: mains.length },
            gap: isActive ? (s.checkEvery || 3) - (plotApi.runtime.floorCount() - checkBase(progress)) : 0,
            checking: Boolean(isActive && plotApi.runtime.isChecking?.()),
            notices: plotApi?.owner === 'tianyin' ? plot()?.notice?.list?.() || [] : [],
            settings: s,
            guideCustom: Boolean(String(s.guide || '').trim()),
            routes: routeRows(),
            stage, nodeKind, sheet, busy, openMenuId,
            // 草稿只在生成它的项目里显示。
            settingDraft: settingDraft && settingDraft.projectId === shown?.id ? settingDraft : null,
            ...outline.viewFields(shown?.id),
        };
        return { ...vm, ...infinite.viewFields(vm) };
    }

    // ---- 提供给剧情助手各页的片段 ----
    const homeCard = opts => {
        const vm = buildVm({ ...opts, target: 'home' });
        return `${renderPlotHomeCard(vm)}${vm.active ? renderPlotNotices(vm.notices) : ''}`;
    };
    const page = opts => renderPlotPage(buildVm(opts));
    const stagePage = opts => renderPlotStage(buildVm(opts));
    const sheetHtml = opts => renderPlotSheet(buildVm(opts));
    const settingsHtml = opts => renderPlotSettings(buildVm(opts));
    const prefsHtml = opts => renderPlotPrefs(buildVm(opts));

    // 剧情参谋讨论时附带当前聊天项目的设定与大纲。
    function advisorContext() {
        const current = project(activeId());
        if (!current) return '';
        const parts = [`【剧情项目】${current.name}`];
        if (current.setting.text.trim()) parts.push(`【设定】\n${current.setting.text.trim()}`);
        if (current.outline.volumes.length) parts.push(`【大纲】\n${outlineToText(current.outline.volumes)}`);
        const text = parts.join('\n\n');
        return text.length > ADVISOR_CONTEXT_LIMIT ? `${text.slice(0, ADVISOR_CONTEXT_LIMIT)}\n…（后面省略）` : text;
    }
    const advisorProjectName = () => project(activeId())?.name || '';

    const talkText = (limit = 30000) => transcript('', (getAdvisorMessages?.() || []).map(msg => ({ role: msg.role, content: msg.content })), limit);

    // ---- AI 任务：同一时刻只跑一个，可停止 ----
    // 结果按发起时的项目落地：生成期间切到别的项目，结果丢弃并提示，不会写进另一个项目。
    async function runAi(kind, role, messages) {
        if (busy) { toast('info', '上一个AI任务还没结束。'); return null; }
        const generate = plot()?.host?.generate;
        if (typeof generate !== 'function') throw new Error('剧情注入器尚未就绪');
        const startedOn = resolveViewedId();
        busy = kind;
        task = new AbortController();
        const mine = task;
        rerender();
        try {
            const reply = await generate(role, messages, { signal: mine.signal });
            if (resolveViewedId() !== startedOn) {
                toast('warning', '生成期间切换了项目，这次的结果没有采用。');
                return null;
            }
            return reply;
        } catch (error) {
            if (error?.name === 'AbortError') { toast('info', '已停止，未保存未完成的结果。'); return null; }
            throw error;
        } finally {
            if (task === mine) { task = null; busy = ''; }
            rerender();
        }
    }

    const stop = () => task?.abort('story-plot-stopped');
    // ---- 改数据的小工具：读出的对象只读，改动整体替换 ----
    const viewed = () => project(resolveViewedId());
    function updateViewed(fn) {
        const current = viewed();
        if (!current) throw new Error('项目还没读完');
        api().data.updateProject(current.id, fn);
        api().runtime.refresh?.();
    }
    const setSetting = patch => updateViewed(current => ({ ...current, setting: { ...current.setting, ...patch } }));
    function commitSetting(text, extra = {}) {
        const current = viewed();
        let history = pushHistory(current.setting.history, current.setting.text);
        history = pushHistory(history, text);
        setSetting({ text, history, ...extra });
    }
    // label 非空时改动前的大纲先入历史版本；alias 为附带写进对照表的阶段 id 别名 [[旧id, 新id]]，其他聊天读进度时按它对回。
    const updateVolumes = (fn, label = '', alias = []) => updateViewed(current => ({
        ...current,
        outline: withAliases({
            ...current.outline,
            volumes: fn(current.outline.volumes),
            ...(label ? { history: pushOutlineHistory(current.outline.history, current.outline.volumes, label) } : {}),
        }, alias),
    }));
    const updateStage = (id, fn, label = '') => updateVolumes(volumes => volumes.map(volume => (volume.stages.some(stage => stage.id === id)
        ? { ...volume, stages: volume.stages.map(stage => (stage.id === id ? fn(stage) : stage)) } : volume)), label);
    const moveUp = (list, index) => {
        if (index <= 0) return list;
        const out = [...list];
        [out[index - 1], out[index]] = [out[index], out[index - 1]];
        return out;
    };
    const safeFileName = name => String(name || '剧情项目').replace(/[\\/:*?"<>|]+/g, '_').slice(0, 60);
    const confirmAction = message => (typeof globalThis.confirm === 'function' ? globalThis.confirm(message) : false);
    const runtimeForViewed = () => (viewed()?.id === activeId() ? api().runtime : null);
    // 改大纲之前取的进度（之后再取会先按对照表归位，再按位置重排会排反）；不是当前聊天的项目返回 null。
    const liveProgress = () => runtimeForViewed()?.progress() || null;

    // 无限流项目的世界库、骰池、主空间参数在 story-plot-infinite.js。
    const infinite = createInfiniteActions(deps, { api, viewed, updateViewed, runtimeForViewed, toast, rerender, confirmAction });

    // 大纲页签的动作与草稿在 story-plot-outline.js。
    const outline = createPlotOutlineActions(deps, {
        api, viewed, resolveViewedId, updateVolumes, updateStage, runAi, rerender, navigate, toast, confirmAction, talkText, runtimeForViewed, liveProgress, safeFileName, moveUp, plot,
        chooseWorldBookRefs: (...args) => chooseWorldBookRefs(...args),
        syncOutline: (...args) => syncOutline(...args),
        setTab: value => { tab = value; },
        setStage: value => { stageId = value; },
        getStage: () => stageId,
        setNodeKind: value => { nodeKind = value; },
        isBusy: () => Boolean(busy),
        setTask: (kind, controller) => { busy = kind; task = controller; },
        clearTask: controller => { if (task === controller) { task = null; busy = ''; } },
    });

    // 设定页签与设置页的动作在 story-plot-setting.js；草稿仍由这里持有。
    const settingCtx = {
        api, project, activeId, viewed, settings, guideText, talkText, runAi, commitSetting, setSetting, toast, rerender, confirmAction,
        get draft() { return settingDraft; },
        set draft(value) { settingDraft = value; },
    };
    const {
        aiSetting, chooseWorldBookRefs, applyDraft, syncOutline, toggleMute, editFix, editBlock, newBlock, editFullSetting, settingHistory, importSettingFromBooks,
        setNumber, setChoice, editGuide, diagnose,
    } = createPlotSettingActions(deps, settingCtx);

    // ---- 项目 ----
    async function switchTo(id, scope) {
        await api().runtime.switchProject(id, scope);
        viewedId = id;
        rerender();
    }

    const modeToggle = checked => `<label class="pm-plot-choice-item"><input type="checkbox" name="infinite" ${checked ? 'checked' : ''}><span><b>无限流</b><small>主空间出发、世界库，由正文状态块触发，不使用检测</small></span></label>`;

    async function newProject() {
        if (!hasCard()) { toast('info', '先打开一张角色卡的聊天。'); return; }
        const result = await openPlotDialog(deps, {
            title: '新项目',
            body: `<label class="pm-settings-field"><span class="pm-cfg-label">项目名（一条if线）</span><input class="pm-cfg-input" name="name" placeholder="如：龙宫温养"></label>${modeToggle(false)}`,
            read: overlay => ({ name: overlay.querySelector('[name="name"]').value.trim(), mode: overlay.querySelector('[name="infinite"]').checked ? 'infinite' : 'normal' }),
        });
        if (!result) return;
        const created = await api().data.createProject(result.name || '新项目', '', result.mode);
        if (!activeId()) await api().runtime.switchProject(created.id, 'chat');
        viewedId = created.id;
        tab = 'setting';
        sheet = null;
        navigate('plot');
    }

    async function exportProject(id) {
        const target = await ensureProject(id);
        if (!target) return;
        const chat = await api().data.loadChat(id).catch(() => null);
        const meta = index().projects.find(item => item.id === id) || {};
        downloadText(`${safeFileName(target.name)}-剧情项目-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify({ format: BACKUP_FORMAT, version: 1, group: meta.group || '', project: target, chat }, null, 2));
    }

    // 导入一律新建项目（新 id），不覆盖已有的；独立版导出的单个项目文件也能导入。
    async function importProject() {
        const file = await pickTextFile('.json');
        if (!file) return;
        let parsed;
        try { parsed = JSON.parse(file.text); } catch (error) { throw new Error('不是有效的JSON文件'); }
        const source = parsed?.format === BACKUP_FORMAT ? parsed.project : parsed?.outline && parsed?.setting ? parsed : null;
        if (!source) throw new Error('文件里没有剧情项目');
        // 先规范化再建项目：内容有问题时不留下空项目。
        const normalized = normalizeProject(source, 'import');
        const created = await api().data.createProject(String(source.name || '导入的项目'), String(parsed.group || ''));
        api().data.saveProject({ ...normalized, id: created.id, name: created.name });
        if (parsed.chat) api().data.saveChat(created.id, normalizeChat(parsed.chat));
        viewedId = created.id;
        sheet = null;
        toast('success', `已导入「${created.name}」。`);
        navigate('plot');
    }

    async function renameProject(id) {
        const meta = index().projects.find(item => item.id === id);
        if (!meta) return;
        await ensureProject(id);
        const mode = project(id)?.mode === 'infinite' ? 'infinite' : 'normal';
        const result = await openPlotDialog(deps, {
            title: '改名、分组',
            body: `<label class="pm-settings-field"><span class="pm-cfg-label">名称</span><input class="pm-cfg-input" name="name" value="${escapeAttr(meta.name)}"></label><label class="pm-settings-field"><span class="pm-cfg-label">分组（留空不分组）</span><input class="pm-cfg-input" name="group" value="${escapeAttr(meta.group || '')}"></label>${modeToggle(mode === 'infinite')}`,
            read: overlay => ({ name: overlay.querySelector('[name="name"]').value.trim(), group: overlay.querySelector('[name="group"]').value.trim(), mode: overlay.querySelector('[name="infinite"]').checked ? 'infinite' : 'normal' }),
        });
        if (!result) return;
        api().data.renameProject(id, result.name, result.group);
        if (result.mode !== mode) api().data.updateProject(id, item => ({ ...item, mode: result.mode, infinite: normalizeInfinite(item.infinite) }));
        api().runtime.refresh?.();
        rerender();
    }

    async function deleteProject(id) {
        const meta = index().projects.find(item => item.id === id);
        if (!meta || !confirmAction(`删除项目「${meta.name}」？项目文件和讨论文件会被删除，聊天里记录的进度保留。`)) return;
        await api().data.deleteProject(id);
        if (viewedId === id) { viewedId = ''; stageId = ''; }
        if (settingDraft?.projectId === id) settingDraft = null;
        outline.forget(id);
        sheet = null;
        api().runtime.refresh?.();
        rerender();
    }

    // 面板里每一行：短按打开项目（走普通点击），长按进这一项的菜单。长按后紧跟的点击吞掉，免得点中刚换出来的菜单项。
    function bindSheetGestures(pageElement) {
        for (const unbind of sheetUnbinds.splice(0)) unbind();
        if (!sheet || sheet.menuId) return;
        for (const row of pageElement?.querySelectorAll?.('.pm-plot-sheet-item') || []) {
            sheetUnbinds.push(bindPressGesture(row, {
                allowNativeClick: true,
                clickCapture: true,
                shouldPreventContextMenu: event => ['touch', 'pen'].includes(event.pointerType),
                onHold: () => { openRowMenu(row.dataset.plotId); return true; },
            }));
        }
    }

    function openRowMenu(id) {
        if (!id) return;
        clickGuardUntil = Date.now() + HOLD_CLICK_GUARD_MS;
        sheet = { menuId: id };
        rerender();
    }

    function onContextMenu(event) {
        const row = event.target.closest?.('.pm-plot-sheet-item');
        if (!row) return false;
        event.preventDefault();
        openRowMenu(row.dataset.plotId);
        return true;
    }
    // ---- 进度 ----
    function runNotice(button) {
        const item = plot()?.notice?.list?.().find(entry => entry.id === button.dataset.plotNoticeId);
        const action = item?.actions?.[Number(button.dataset.plotIndex)];
        if (!item || !action) return;
        plot().notice.hide(item.id);
        try { action.run(); } catch (error) { toast('error', error.message || String(error)); }
        rerender();
    }

    async function startRewrite() {
        const current = viewed();
        const runtime = runtimeForViewed();
        if (!current || !runtime) return;
        const units = flattenUnits(current.outline.volumes);
        if (!units.length) return;
        const from = Math.max(0, currentIndex(units, runtime.progress()));
        const reason = await promptText(deps, { title: '让AI改写后续阶段', label: '偏离说明（可空）：剧情哪里和大纲不一样了', multiline: true, rows: 4 });
        if (reason == null) return;
        tab = 'outline';
        const recent = runtime.recentFloors(6).map(floor => floor.text).join('\n\n');
        const reply = await runAi('outline', 'outline', rewriteRestMessages({ setting: current.setting.text, volumes: current.outline.volumes, fromUnitIndex: from, units, recent, reason }));
        if (reply) outline.setOutlineDraft(reply, 'rewrite', { fromUnitId: units[from].id, reason });
        rerender();
    }

    async function editUnitState(unitId) {
        const runtime = runtimeForViewed();
        if (!runtime) return;
        const manual = runtime.progress().slots[unitId]?.state || '';
        const pick = await pickOption(deps, {
            title: '手动改状态',
            value: manual,
            options: [{ value: '', label: '自动', hint: '按当前段推算' }, ...STATES.map(state => ({ value: state, label: STATE_LABELS[state] }))],
        });
        if (pick == null) return;
        runtime.setProgress(patchSlot(runtime.progress(), unitId, { state: pick || undefined }));
        rerender();
    }

    async function editParams() {
        const current = viewed();
        if (!current) return;
        const defaults = { ...DEFAULT_PARAMS, ...current.defaults };
        const field = (kind, title) => {
            const value = { ...DEFAULT_PARAMS[kind], ...defaults[kind] };
            const options = (list, selected) => list.map(item => `<option value="${item.value}" ${Number(item.value) === Number(selected) ? 'selected' : ''}>${escapeHtml(item.label)}</option>`).join('');
            return `<fieldset class="pm-plot-fieldset"><legend>${title}</legend>
              <label class="pm-settings-field"><span class="pm-cfg-label">位置</span><select class="pm-cfg-input" name="${kind}.position">${options(POSITIONS, value.position)}</select></label>
              <label class="pm-settings-field"><span class="pm-cfg-label">深度（位置为「@D 深度」时生效）</span><input class="pm-cfg-input" type="number" min="0" name="${kind}.depth" value="${value.depth}"></label>
              <label class="pm-settings-field"><span class="pm-cfg-label">角色（位置为「@D 深度」时生效）</span><select class="pm-cfg-input" name="${kind}.role">${options(ROLES, value.role)}</select></label>
              <label class="pm-settings-field"><span class="pm-cfg-label">顺序</span><input class="pm-cfg-input" type="number" name="${kind}.order" value="${value.order}"></label></fieldset>`;
        };
        const result = await openPlotDialog(deps, {
            title: '注入位置',
            body: `${field('setting', '设定')}${field('detail', '当前阶段详细')}`,
            actions: [{ label: '取消', value: 'cancel' }, { label: '保存', value: 'ok', primary: true }],
            read: overlay => Object.fromEntries(['setting', 'detail'].map(kind => [kind, {
                position: Number(overlay.querySelector(`[name="${kind}.position"]`).value),
                depth: Math.max(0, Number(overlay.querySelector(`[name="${kind}.depth"]`).value) || 0),
                role: Number(overlay.querySelector(`[name="${kind}.role"]`).value),
                order: Math.max(0, Number(overlay.querySelector(`[name="${kind}.order"]`).value) || 0),
            }])),
        });
        if (!result) return;
        updateViewed(item => ({ ...item, defaults: Object.fromEntries(['setting', 'detail'].map(kind => [kind, { ...DEFAULT_PARAMS[kind], ...item.defaults?.[kind], ...result[kind] }])) }));
        rerender();
    }

    function previewEntries() {
        const runtime = runtimeForViewed();
        if (!runtime) return;
        const entries = runtime.entries().filter(entry => entry.enabled && entry.content);
        const text = entries.map(entry => `〔${entry.title}〕\n${entry.content}`).join('\n\n') || '设定和大纲都为空，没有可注入的内容。';
        return showText(deps, { title: '注入内容预览', text });
    }

    function showIndex() {
        const runtime = runtimeForViewed();
        if (!runtime) return;
        const units = maskUnits(runtime.units(), threadSwitches(viewed()));
        const progress = runtime.progress();
        const opts = { carryOver: settings().carryOver !== false, hookCap: settings().hookCap, links: outlineLinks(viewed().outline) };
        return showText(deps, { title: '剧情索引', text: buildIndexText(units, unitStates(units, progress), progress, opts) });
    }

    // ---- 执行页：节点、支线钩子、进度钟 ----
    function viewLive() {
        const runtime = runtimeForViewed();
        if (!runtime) return null;
        const units = maskUnits(runtime.units(), threadSwitches(viewed()));
        const progress = runtime.progress();
        return liveOf(units, unitStates(units, progress), progress);
    }

    // checked=true 为恢复未演；勾回走完的支线链时停在最后一步，免得显示空步骤。
    function toggleNode(unitId, nodeId, checked) {
        const runtime = runtimeForViewed();
        if (!runtime) return;
        const unit = runtime.units().find(item => item.id === unitId);
        const node = unit && stageNodes(unit.stage.data).find(item => item.id === nodeId);
        let next = setNodeChecked(runtime.progress(), unitId, nodeId, checked, node ? node.name : '');
        const hook = checked && viewLive()?.hooks.find(item => item.key === `${unitId}:${nodeId}`);
        if (hook && hook.steps.length && hook.step >= hook.steps.length) next = patchLive(next, hook, { step: hook.steps.length - 1 });
        runtime.setProgress(next);
    }

    // 支线钩子：手动激活或退回待触发、支线链换步、恢复过期、标为过期、标记已演。
    async function hookMenu(key) {
        const runtime = runtimeForViewed();
        const live = viewLive();
        const hook = live?.hooks.find(item => item.key === key);
        if (!hook) return;
        const open = hook.status === 'active' || hook.status === 'queue';
        const items = [
            ...(hook.status === 'wait' ? [{ label: '标为已激活', value: 'on' }] : []),
            ...(open && hook.pooled ? [{ label: '退回待触发', value: 'off' }] : []),
            ...(open && hook.step + 1 < hook.steps.length ? [{ label: '进入下一步', value: 'next' }] : []),
            ...(open && hook.step > 0 ? [{ label: '回到上一步', value: 'prev' }] : []),
            ...(hook.status === 'expired' ? [{ label: '恢复', value: 'restore' }] : []),
            ...(open && hook.limit ? [{ label: '标为过期', value: 'expire' }] : []),
            { label: hook.status === 'done' ? '恢复未演' : '标记已演', value: hook.status === 'done' ? 'unplay' : 'played' },
        ];
        const pick = await pickAction(deps, { title: hook.carried ? `${hook.node.name}（来自${stageLabel(hook.unit.stage.key)}）` : hook.node.name, items });
        if (!pick) return;
        if (pick === 'played' || pick === 'unplay') { toggleNode(hook.unit.id, hook.node.id, pick === 'unplay'); rerender(); return; }
        const floor = Math.max(1, runtime.floorCount());
        // 恢复：重新计时；条件钩子重新排进注入名额。「本卷」时限从恢复时所在的卷算到卷末。
        const restore = hook.pooled ? { at: floor, shownAt: undefined } : { since: floor };
        const patch = {
            on: { at: floor },
            off: { at: undefined, shownAt: undefined },
            next: { step: hook.step + 1 },
            prev: { step: hook.step - 1 },
            restore: { expired: undefined, ...restore, keepVol: hook.limit && hook.limit.volume ? live.activeVol : undefined },
            expire: { expired: true },
        }[pick];
        runtime.setProgress(patchLive(runtime.progress(), hook, patch));
        rerender();
    }

    // 世界进度钟：手动推进、倒退、标记已发生、重置。
    async function clockMenu(key) {
        const runtime = runtimeForViewed();
        const clock = viewLive()?.clocks.find(item => item.key === key);
        if (!clock) return;
        const items = clock.done ? [{ label: '重置', value: 'reset' }] : [
            ...(clock.filled < clock.total ? [{ label: '推进一格', value: 'up' }] : []),
            ...(clock.filled > 0 ? [{ label: '倒退一格', value: 'down' }] : []),
            { label: '标记已发生', value: 'done' },
            { label: '重置', value: 'reset' },
        ];
        const pick = await pickAction(deps, { title: `${clock.node.name} ${clock.filled}/${clock.total}`, items });
        if (!pick) return;
        const patch = pick === 'reset' ? null : pick === 'done' ? { filled: clock.total, done: true } : { filled: Math.max(0, Math.min(clock.total, clock.filled + (pick === 'up' ? 1 : -1))) };
        runtime.setProgress(patchLive(runtime.progress(), clock, patch));
        rerender();
    }
    // ---- 点击分发 ----
    const ACTIONS = {
        tab: button => { tab = PLOT_TABS.some(([key]) => key === button.dataset.plotTab) ? button.dataset.plotTab : 'progress'; rerender(); },
        'tab-outline': () => { tab = 'outline'; viewedId = activeId() || viewedId; navigate('plot'); },
        'open-plot': () => { viewedId = activeId() || viewedId; tab = 'progress'; navigate('plot'); },
        // 面板只画在剧情页：从首页点「选择项目」先进剧情页。
        'open-sheet': () => { sheet = {}; if (currentView === 'plot' || currentView === 'stage') rerender(); else navigate('plot'); },
        'sheet-close': () => { sheet = null; rerender(); },
        'sheet-back': () => { sheet = {}; rerender(); },
        'sheet-pick': button => { viewedId = button.dataset.plotId; sheet = null; stageId = ''; navigate('plot'); },
        'project-use-chat': async button => { sheet = null; await switchTo(button.dataset.plotId, 'chat'); toast('success', '当前聊天已改用这个项目。'); },
        'project-use-card': async button => { sheet = null; await switchTo(button.dataset.plotId, 'card'); toast('success', '已设为本卡默认，当前聊天也已换用。'); },
        'project-rename': button => renameProject(button.dataset.plotId),
        'project-export': button => exportProject(button.dataset.plotId),
        'project-delete': button => deleteProject(button.dataset.plotId),
        'new-project': newProject,
        'import-project': importProject,
        'use-chat': () => switchTo(viewed().id, 'chat'),
        'use-card': () => switchTo(viewed().id, 'card'),
        notice: runNotice,
        check: () => { const runtime = runtimeForViewed() || api().runtime; const job = runtime.checkNow({ manual: true }); rerender(); return job.finally(rerender); },
        next: () => { (runtimeForViewed() || api().runtime).openNext(); rerender(); },
        rewrite: startRewrite,
        pace: button => { const runtime = runtimeForViewed(); runtime?.setProgress({ ...runtime.progress(), pace: button.dataset.plotPace }); rerender(); },
        node: button => {
            const runtime = runtimeForViewed();
            const unit = runtime?.units().find(item => item.id === button.dataset.plotUnit);
            if (!unit) return;
            toggleNode(unit.id, button.dataset.plotNode, offNodes(runtime.progress(), unit).includes(button.dataset.plotNode));
            rerender();
        },
        'hook-menu': button => hookMenu(button.dataset.plotKey),
        'clock-menu': button => clockMenu(button.dataset.plotKey),
        'expired-toggle': () => { expiredOpen = !expiredOpen; rerender(); },
        'thread-switch': button => {
            const key = button.dataset.plotKey;
            updateViewed(current => { const sw = threadSwitches(current); return { ...current, threads: { ...sw, [key]: !sw[key] } }; });
            rerender();
        },
        'unit-goto': button => { const runtime = runtimeForViewed(); runtime?.setProgress(goTo(runtime.progress(), runtime.units(), button.dataset.plotUnit)); rerender(); },
        'unit-state': button => editUnitState(button.dataset.plotUnit),
        'unit-unmute': button => { const runtime = runtimeForViewed(); const p = runtime?.progress(); if (p) runtime.setProgress({ ...p, muted: p.muted.filter(id => id !== button.dataset.plotUnit) }); rerender(); },
        preview: previewEntries,
        index: showIndex,
        params: editParams,
        'reset-base': () => { runtimeForViewed()?.resetBase?.(); toast('info', '已从当前楼重新计检测。'); rerender(); },
        'setting-ai': aiSetting,
        'setting-sync': () => { const runtime = runtimeForViewed(); return syncOutline({ from: runtime ? Math.max(0, currentIndex(flattenUnits(viewed().outline.volumes), runtime.progress())) : 0 }); },
        'block-mute': button => toggleMute(button.dataset.plotKey),
        'draft-apply-all': () => applyDraft(true),
        'draft-apply-picked': () => applyDraft(false),
        'draft-toggle': () => { if (settingDraft) settingDraft = { ...settingDraft, open: !settingDraft.open }; rerender(); },
        'draft-pick': button => {
            const keys = new Set(settingDraft?.keys || []);
            if (keys.has(button.dataset.plotKey)) keys.delete(button.dataset.plotKey); else keys.add(button.dataset.plotKey);
            settingDraft = { ...settingDraft, keys: [...keys] };
            rerender();
        },
        'draft-drop': () => { settingDraft = null; rerender(); },
        'fix-ok': button => { const index = Number(button.dataset.plotIndex); setSetting({ fixes: viewed().setting.fixes.filter((_, i) => i !== index) }); rerender(); },
        'fix-edit': button => editFix(Number(button.dataset.plotIndex), false),
        'fix-drop': button => editFix(Number(button.dataset.plotIndex), true),
        'block-edit': button => editBlock(button.dataset.plotKey),
        'block-del': button => {
            const blocks = splitBlocks(viewed().setting.text);
            const block = blocks.find(item => item.key === button.dataset.plotKey);
            if (!block || !confirmAction(`删除分块「${block.title}」？删除前的版本保存在历史版本里，可以回退。`)) return;
            commitSetting(joinBlocks(blocks.filter(item => item.key !== block.key)));
            rerender();
        },
        'block-new': newBlock,
        'setting-full': editFullSetting,
        'setting-history': settingHistory,
        'setting-import': importSettingFromBooks,
        'stage-goto': () => { const runtime = runtimeForViewed(); if (runtime) runtime.setProgress(goTo(runtime.progress(), runtime.units(), stageId)); rerender(); },
        'stage-discuss': () => { const found = outline.findStage(); if (found) openAdvisor?.(`讨论「${volumeLabel(found.volume.key)}·${stageLabel(found.stage.key)}」：`); },
        ...outline.actions,
        'set-every': () => setNumber('checkEvery', '每几楼检测一次', 1, 50),
        'set-floors': () => setNumber('checkFloors', '每次读最近几楼', 1, 20),
        'set-handle': () => setChoice('handleMode', '阶段演完后', [
            { value: 'ask', label: '询问', hint: '弹提示，由你决定是否打开下一段' },
            { value: 'auto', label: '自动切到下一段', hint: '提示里可以撤销' },
            { value: 'nodes', label: '只勾节点', hint: '不提示切段，自己手动切' },
        ]),
        'set-off': () => setChoice('offTrackMode', '偏离大纲时', [
            { value: 'ask', label: '询问', hint: '弹提示，可填说明后改写后续阶段' },
            { value: 'auto', label: '自动改写后续', hint: '提示里可以撤销' },
            { value: 'off', label: '不检查' },
        ]),
        'set-hookcap': () => setNumber('hookCap', '同时注入的激活支线', 1, 6),
        'set-newthread': () => setChoice('newThreadMode', '正文出现大纲外的新线时', [
            { value: 'ask', label: '询问', hint: '弹提示，可收录为支线或忽略' },
            { value: 'auto', label: '自动收录为支线' },
            { value: 'off', label: '不识别' },
        ]),
        'set-carry': () => { api().data.updateSettings({ carryOver: settings().carryOver === false }); rerender(); },
        'open-api': () => globalThis.window?.__pmShowConfig?.('api'),
        'guide-edit': editGuide,
        diagnose,
        stop,
        ...infinite.actions,
    };
    // 剧情助手的点击总入口先交给这里；返回 true 表示已处理。
    function handleClick(button, onError) {
        const action = button?.dataset?.plotAction;
        const handler = action && ACTIONS[action];
        if (!handler) return false;
        // 长按刚弹出菜单时，抬手那一下的点击不算，免得点中新换出来的菜单项。
        if (Date.now() < clickGuardUntil) return true;
        if (!api()) { onError?.('剧情注入器尚未就绪'); return true; }
        Promise.resolve().then(() => handler(button)).catch(error => {
            onError?.(error?.message || String(error));
            rerender();
        });
        return true;
    }

    // 剧情助手每次重画后调用：绑面板长按，并按需订阅剧情注入器的刷新与提示。
    // 提示卡只画在首页（有项目时）和当前聊天项目的进度页；别的页上来了提示，告诉剧情注入器没显示出来，由它退回 toast。
    function showsNotices() {
        if (!currentPage || currentPage.hidden) return false;
        if (currentView === 'home') return Boolean(project(activeId()));
        return currentView === 'plot' && tab === 'progress' && resolveViewedId() === activeId();
    }

    function afterRender(pageElement, view) {
        currentPage = pageElement;
        currentView = view;
        bindSheetGestures(pageElement);
        const wants = Boolean(pageElement) && ['home', 'plot', 'stage', 'settings'].includes(view);
        if (wants && !unsubscribe.length) {
            const owner = plot();
            if (owner?.subscribe) unsubscribe.push(owner.subscribe(reason => { if (reason !== 'saved' && !currentPage?.hidden) scheduleRender(); }));
            if (owner?.notice?.subscribe) unsubscribe.push(owner.notice.subscribe(() => { scheduleRender(); return showsNotices(); }));
        } else if (!wants) release();
    }

    function release() {
        for (const off of unsubscribe.splice(0)) { try { off(); } catch (error) { /* 已退订 */ } }
    }

    function reset() {
        release();
        for (const unbind of sheetUnbinds.splice(0)) unbind();
        stop();
        sheet = null;
        stageId = '';
        settingDraft = null;
        outline.reset();
        expiredOpen = false;
        infinite.reset();
        viewedId = '';
        tab = 'progress';
    }

    // 剧情参谋回复里的大纲 YAML：送进当前聊天项目的大纲草稿。
    function sendOutlineDraft(text) {
        const id = activeId() || resolveViewedId();
        if (!id) { toast('info', '先在剧情页建一个项目。'); return false; }
        viewedId = id;
        outline.setOutlineDraft(text, 'volume', {}, { all: true });
        navigate('plot');
        return true;
    }

    return {
        homeCard, page, stagePage, sheetHtml, settingsHtml, prefsHtml,
        hasSheet: () => Boolean(sheet),
        handleClick, onContextMenu, afterRender, reset,
        advisorContext, advisorProjectName, sendOutlineDraft,
        isBusy: () => Boolean(busy),
    };
}
