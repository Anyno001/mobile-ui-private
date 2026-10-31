// 剧情助手里的剧情注入器：项目、进度、设定、大纲的状态与动作。模板在 story-plot-views.js，弹窗与文件在 story-plot-io.js。
// 数据层与运行时从 deps.plotInjector.getPlotApi() 取：同页装了独立版时是独立版的，否则是天音自己的，改的都是同一份数据。
// AI 写设定、写大纲一律走天音的接口（剧情设定模块），可停止。
import { API_ROUTE_MODULES, loadApiRoutes, profileDisplayName } from './api-routes.js';
import { bindPressGesture } from './press-gesture.js';
import { loadProfiles } from './storage-preferences.js';
import { BUILTIN_GUIDE } from './plot-injector/core/guide.js';
import { DEFAULT_PARAMS, POSITIONS, ROLES, buildIndexText, carriedNodes } from './plot-injector/core/inject.js';
import { NODE_FIELDS, flattenUnits, makeId, outlineToText, parseOutlineText, replaceRest, stageLabel, stageNodes, stageToText, volumeLabel } from './plot-injector/core/outline.js';
import { STATES, STATE_LABELS, currentIndex, emptyProgress, goTo, patchSlot, setNodeChecked, unitStates } from './plot-injector/core/progress.js';
import { fixYamlMessages, outlineMessages, parseOutlineReply, rewriteRestMessages, transcript } from './plot-injector/core/prompts.js';
import { joinBlocks, pushHistory, splitBlocks } from './plot-injector/core/setting.js';
import { groupProjects, normalizeChat, normalizeProject } from './plot-injector/core/store.js';
import { PLOT_TABS, renderPlotHomeCard, renderPlotNotices, renderPlotPage, renderPlotPrefs, renderPlotSettings, renderPlotSheet, renderPlotStage } from './story-plot-views.js';
import { downloadText, openPlotDialog, pickOption, pickTextFile, promptText, showText } from './story-plot-io.js';
import { createPlotSettingActions } from './story-plot-setting.js';
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
    let outlineDraft = null;
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
    function stateOf(target) {
        const units = target ? flattenUnits(target.outline.volumes) : [];
        const isActive = target && target.id === activeId();
        const progress = isActive ? api().runtime.progress() : emptyProgress(target?.id || '');
        return { units, progress, states: units.length ? unitStates(units, progress) : {}, isActive };
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
        const { units, progress, states, isActive } = stateOf(shown);
        const unit = units.find(item => states[item.id] === 'active');
        const off = unit ? new Set(progress.slots[unit.id]?.off || []) : new Set();
        const mains = unit ? stageNodes(unit.stage.data).filter(node => node.kind === 'main') : [];
        const s = settings();
        const stage = stageId && shown ? shown.outline.volumes.map(volume => ({ volume, stage: volume.stages.find(item => item.id === stageId) })).find(item => item.stage) || null : null;
        return {
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
            carried: isActive && s.carryOver !== false && units.length ? carriedNodes(units, states, progress) : [],
            mainCount: { done: mains.filter(node => off.has(node.id)).length, total: mains.length },
            gap: isActive ? (s.checkEvery || 3) - (plotApi.runtime.floorCount() - progress.lastCheckFloor) : 0,
            checking: Boolean(isActive && plotApi.runtime.isChecking?.()),
            notices: plotApi?.owner === 'tianyin' ? plot()?.notice?.list?.() || [] : [],
            settings: s,
            guideCustom: Boolean(String(s.guide || '').trim()),
            routes: routeRows(),
            stage, nodeKind, sheet, busy, openMenuId,
            // 草稿只在生成它的项目里显示。
            settingDraft: settingDraft && settingDraft.projectId === shown?.id ? settingDraft : null,
            outlineDraft: outlineDraft && outlineDraft.projectId === shown?.id ? outlineDraft : null,
        };
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
    const updateVolumes = fn => updateViewed(current => ({ ...current, outline: { ...current.outline, volumes: fn(current.outline.volumes) } }));
    const updateStage = (id, fn) => updateVolumes(volumes => volumes.map(volume => (volume.stages.some(stage => stage.id === id)
        ? { ...volume, stages: volume.stages.map(stage => (stage.id === id ? fn(stage) : stage)) } : volume)));
    const moveUp = (list, index) => {
        if (index <= 0) return list;
        const out = [...list];
        [out[index - 1], out[index]] = [out[index], out[index - 1]];
        return out;
    };
    const safeFileName = name => String(name || '剧情项目').replace(/[\\/:*?"<>|]+/g, '_').slice(0, 60);
    const confirmAction = message => (typeof globalThis.confirm === 'function' ? globalThis.confirm(message) : false);
    const runtimeForViewed = () => (viewed()?.id === activeId() ? api().runtime : null);

    // 设定页签与设置页的动作在 story-plot-setting.js；草稿仍由这里持有。
    const settingCtx = {
        api, project, activeId, viewed, settings, guideText, talkText, runAi, commitSetting, setSetting, toast, rerender, confirmAction,
        get draft() { return settingDraft; },
        set draft(value) { settingDraft = value; },
    };
    const {
        aiSetting, chooseWorldBookRefs, applyDraft, editFix, editBlock, newBlock, editFullSetting, settingHistory, importSettingFromBooks,
        setNumber, setChoice, editGuide, diagnose,
    } = createPlotSettingActions(deps, settingCtx);

    // ---- 项目 ----
    async function switchTo(id, scope) {
        await api().runtime.switchProject(id, scope);
        viewedId = id;
        rerender();
    }

    async function newProject() {
        if (!hasCard()) { toast('info', '先打开一张角色卡的聊天。'); return; }
        const name = await promptText(deps, { title: '新项目', label: '项目名（一条if线）', placeholder: '如：龙宫温养' });
        if (name == null) return;
        const created = await api().data.createProject(String(name).trim() || '新项目');
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
        const result = await openPlotDialog(deps, {
            title: '改名、分组',
            body: `<label class="pm-settings-field"><span class="pm-cfg-label">名称</span><input class="pm-cfg-input" name="name" value="${escapeAttr(meta.name)}"></label><label class="pm-settings-field"><span class="pm-cfg-label">分组（留空不分组）</span><input class="pm-cfg-input" name="group" value="${escapeAttr(meta.group || '')}"></label>`,
            read: overlay => ({ name: overlay.querySelector('[name="name"]').value.trim(), group: overlay.querySelector('[name="group"]').value.trim() }),
        });
        if (!result) return;
        await ensureProject(id);
        api().data.renameProject(id, result.name, result.group);
        rerender();
    }

    async function deleteProject(id) {
        const meta = index().projects.find(item => item.id === id);
        if (!meta || !confirmAction(`删除项目「${meta.name}」？项目文件和讨论文件会被删除，聊天里记录的进度保留。`)) return;
        await api().data.deleteProject(id);
        if (viewedId === id) { viewedId = ''; stageId = ''; }
        if (settingDraft?.projectId === id) settingDraft = null;
        if (outlineDraft?.projectId === id) outlineDraft = null;
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
        if (reply) setOutlineDraft(reply, 'rewrite', { fromUnitId: units[from].id });
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
        const units = runtime.units();
        const progress = runtime.progress();
        return showText(deps, { title: '剧情索引', text: buildIndexText(units, unitStates(units, progress), progress, { carryOver: settings().carryOver !== false }) });
    }
    // ---- 大纲 ----
    function addVolumes(incoming) {
        const existing = new Set(viewed().outline.volumes.map(volume => volume.key));
        const fresh = incoming.map(volume => (existing.has(volume.key) ? { ...volume, key: `${volume.key}_导入${Date.now().toString(36).slice(-3)}` } : volume));
        updateVolumes(volumes => [...volumes, ...fresh]);
        return fresh;
    }

    function importOutlineText(text, name = '粘贴内容') {
        try {
            const added = addVolumes(parseOutlineText(text));
            toast('success', `已导入 ${added.length} 卷。`);
        } catch (error) {
            toast('error', `${name}：${error.message}`);
        }
        rerender();
    }

    async function aiVolume() {
        const current = viewed();
        const request = await promptText(deps, { title: `AI写第 ${current.outline.volumes.length + 1} 卷`, label: '给AI的额外要求（可空）', multiline: true, rows: 4 });
        if (request == null) return;
        const talk = talkText(12000);
        const refs = await chooseWorldBookRefs('写大纲参考的世界书条目');
        if (refs == null) return;
        if (!current.setting.text.trim() && !talk.trim() && !refs.length) throw new Error('没有可参考的内容：先写设定，或在剧情参谋里聊一聊。');
        const reply = await runAi('outline', 'outline', outlineMessages({ setting: current.setting.text, talk, refs, volumes: current.outline.volumes, volumeNo: current.outline.volumes.length + 1, request }));
        if (reply) setOutlineDraft(reply, 'volume');
        rerender();
    }

    function setOutlineDraft(reply, mode = 'volume', extra = {}) {
        outlineDraft = { mode, ...parseOutlineReply(reply), projectId: resolveViewedId(), ...extra };
        tab = 'outline';
    }

    async function fixDraft() {
        const draft = outlineDraft;
        const reply = await runAi('outline', 'outline', fixYamlMessages(draft.yaml, draft.error));
        if (reply) setOutlineDraft(reply, draft.mode, { fromUnitId: draft.fromUnitId });
        rerender();
    }

    async function editDraft() {
        const draft = outlineDraft;
        const yaml = await promptText(deps, { title: '手动修改YAML', label: draft.error, value: draft.yaml, multiline: true, rows: 16 });
        if (yaml == null) return;
        setOutlineDraft(`\`\`\`yaml\n${yaml}\n\`\`\``, draft.mode, { fromUnitId: draft.fromUnitId });
        rerender();
    }

    function applyRest() {
        const draft = outlineDraft;
        const current = viewed();
        const unit = flattenUnits(current.outline.volumes).find(item => item.id === draft.fromUnitId);
        if (!unit) throw new Error('原来的阶段已不存在，改用「存为新卷」。');
        if (!confirmAction('当前阶段及之后的阶段会换成改写后的内容，进度跳到改写后的第一段。')) return;
        const volumes = replaceRest(current.outline.volumes, unit.stage.id, draft.volumes);
        updateVolumes(() => volumes);
        const first = draft.volumes[0]?.stages[0];
        const runtime = runtimeForViewed();
        if (first && runtime) runtime.setProgress(goTo(runtime.progress(), flattenUnits(volumes), first.id));
        outlineDraft = null;
        rerender();
    }

    const draftHere = () => Boolean(outlineDraft && outlineDraft.projectId === resolveViewedId());
    const findVolume = id => viewed()?.outline.volumes.find(volume => volume.id === id) || null;
    const findStage = () => {
        for (const volume of viewed()?.outline.volumes || []) {
            const stage = volume.stages.find(item => item.id === stageId);
            if (stage) return { volume, stage };
        }
        return null;
    };

    async function editStageField(field) {
        const found = findStage();
        if (!found) return;
        const value = await promptText(deps, { title: field, label: field === '时间范围' ? '时间范围（用来判断何时切到下一段）' : 'AI指令', value: String(found.stage.data?.[field] ?? ''), multiline: field === 'AI指令', rows: 5 });
        if (value == null) return;
        updateStage(found.stage.id, stage => ({ ...stage, data: { ...stage.data, [field]: String(value) } }));
        rerender();
    }

    async function editStageRaw() {
        const found = findStage();
        if (!found) return;
        const text = await promptText(deps, { title: '编辑YAML原文', label: '只能有一个阶段', value: stageToText(found.stage), multiline: true, rows: 16 });
        if (text == null) return;
        const parsed = parseOutlineText(String(text));
        const next = parsed[0]?.stages[0];
        if (!next || parsed.length > 1 || parsed[0].stages.length > 1) throw new Error('原文里只能有一个阶段');
        updateStage(found.stage.id, stage => ({ ...stage, key: next.key, data: next.data }));
        rerender();
    }

    const NODE_KEYS = Object.freeze({ main: ['名称', '地点', '事件', '偏转'], side: ['名称', '地点', '事件', '触发', '偏转'], world: ['类型', '来源', '内容'] });
    const LONG_KEYS = new Set(['事件', '偏转', '内容', '触发']);

    // 节点编辑弹窗：新增时 index 为 -1。
    async function editNode(field, index) {
        const found = findStage();
        if (!found) return;
        const meta = NODE_FIELDS.find(item => item.field === field);
        const list = Array.isArray(found.stage.data?.[field]) ? found.stage.data[field] : [];
        const raw = index >= 0 ? list[index] : null;
        const value = raw && typeof raw === 'object' ? raw : raw != null ? { 内容: String(raw) } : {};
        const keys = [...new Set([...NODE_KEYS[meta.kind], ...Object.keys(value)])];
        const body = keys.map(key => `<label class="pm-settings-field"><span class="pm-cfg-label">${escapeHtml(key)}</span>${LONG_KEYS.has(key)
            ? `<textarea class="pm-cfg-input" rows="3" name="${escapeAttr(key)}">${escapeHtml(value[key] ?? '')}</textarea>`
            : `<input class="pm-cfg-input" name="${escapeAttr(key)}" value="${escapeAttr(value[key] ?? '')}">`}</label>`).join('');
        const actions = index >= 0 ? [{ label: '删除', value: 'delete' }, { label: '取消', value: 'cancel' }, { label: '保存', value: 'ok', primary: true }] : [{ label: '取消', value: 'cancel' }, { label: '添加', value: 'ok', primary: true }];
        const read = overlay => Object.fromEntries(keys.map(key => [key, overlay.querySelector(`[name="${CSS.escape(key)}"]`)?.value ?? '']));
        const result = await openPlotDialog(deps, { title: `${meta.label}节点`, body, actions, read });
        if (!result) return;
        if (result.action === 'delete') {
            if (!confirmAction('删除这个节点？')) return;
            updateStage(found.stage.id, stage => {
                const next = stage.data[field].filter((_, i) => i !== index);
                const data = { ...stage.data, [field]: next };
                if (!next.length && field !== '主线节点') delete data[field];
                return { ...stage, data };
            });
        } else {
            updateStage(found.stage.id, stage => {
                const current = Array.isArray(stage.data[field]) ? [...stage.data[field]] : [];
                if (index >= 0) current[index] = { ...value, ...result };
                else current.push(result);
                return { ...stage, data: { ...stage.data, [field]: current } };
            });
        }
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
            if (!runtime) return;
            const done = button.getAttribute('aria-pressed') === 'true';
            runtime.setProgress(setNodeChecked(runtime.progress(), button.dataset.plotUnit, button.dataset.plotNode, done));
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
        'outline-import': async () => { const file = await pickTextFile('.yaml,.yml,.txt'); if (file) importOutlineText(file.text, file.name); },
        'outline-paste': async () => { const text = await promptText(deps, { title: '粘贴剧情YAML', multiline: true, rows: 14, placeholder: '剧情_卷一_标题:\n  阶段一_标题:\n    时间范围: …' }); if (String(text || '').trim()) importOutlineText(text); },
        'outline-export': () => downloadText(`${safeFileName(viewed().name)}-大纲.yaml`, outlineToText(viewed().outline.volumes), 'text/yaml'),
        'outline-ai': aiVolume,
        'odraft-fix': fixDraft,
        'odraft-edit': editDraft,
        'odraft-drop': () => { outlineDraft = null; rerender(); },
        'odraft-new': () => { if (!draftHere()) return; addVolumes(outlineDraft.volumes); outlineDraft = null; rerender(); },
        'odraft-append': () => {
            if (!draftHere()) return;
            const stages = outlineDraft.volumes.flatMap(volume => volume.stages);
            updateVolumes(volumes => volumes.map((volume, i) => (i === volumes.length - 1 ? { ...volume, stages: [...volume.stages, ...stages] } : volume)));
            outlineDraft = null;
            rerender();
        },
        'odraft-rest': () => { if (draftHere()) applyRest(); },
        'vol-add': () => {
            const count = viewed().outline.volumes.length;
            updateVolumes(volumes => [...volumes, { id: makeId('v'), key: `剧情_卷${count + 1}_新卷`, stages: [{ id: makeId('s'), key: '阶段一_新阶段', data: { 时间范围: '', AI指令: '', 主线节点: [] } }] }]);
            rerender();
        },
        'vol-rename': async button => {
            const volume = findVolume(button.dataset.plotVol);
            const key = volume && await promptText(deps, { title: '改卷名', label: '格式：剧情_卷X_标题', value: volume.key });
            if (!String(key || '').trim() || viewed().outline.volumes.some(item => item.key === key.trim() && item.id !== volume.id)) return;
            updateVolumes(volumes => volumes.map(item => (item.id === volume.id ? { ...item, key: key.trim() } : item)));
            rerender();
        },
        'vol-up': button => { updateVolumes(volumes => moveUp(volumes, volumes.findIndex(volume => volume.id === button.dataset.plotVol))); rerender(); },
        'vol-del': button => {
            const volume = findVolume(button.dataset.plotVol);
            if (!volume || !confirmAction(`删除「${volumeLabel(volume.key)}」？连同 ${volume.stages.length} 个阶段一起删除。`)) return;
            updateVolumes(volumes => volumes.filter(item => item.id !== volume.id));
            rerender();
        },
        'stage-add': button => {
            const volume = findVolume(button.dataset.plotVol);
            if (!volume) return;
            const stage = { id: makeId('s'), key: `阶段${volume.stages.length + 1}_新阶段`, data: { 时间范围: '', AI指令: '', 主线节点: [] } };
            updateVolumes(volumes => volumes.map(item => (item.id === volume.id ? { ...item, stages: [...item.stages, stage] } : item)));
            stageId = stage.id;
            navigate('stage');
        },
        'open-stage': button => { stageId = button.dataset.plotStage; nodeKind = 'main'; navigate('stage'); },
        'stage-field': button => editStageField(button.dataset.plotField),
        'stage-rename': async () => {
            const found = findStage();
            const key = found && await promptText(deps, { title: '改阶段名', label: '格式：阶段N_标题', value: found.stage.key });
            if (!String(key || '').trim() || found.volume.stages.some(item => item.key === key.trim() && item.id !== found.stage.id)) return;
            updateStage(found.stage.id, stage => ({ ...stage, key: key.trim() }));
            rerender();
        },
        'stage-raw': editStageRaw,
        'stage-up': () => { const found = findStage(); if (found) updateVolumes(volumes => volumes.map(volume => (volume.id === found.volume.id ? { ...volume, stages: moveUp(volume.stages, volume.stages.indexOf(found.stage)) } : volume))); rerender(); },
        'stage-del': () => {
            const found = findStage();
            if (!found || !confirmAction(`删除「${stageLabel(found.stage.key)}」？`)) return;
            updateVolumes(volumes => volumes.map(volume => (volume.id === found.volume.id ? { ...volume, stages: volume.stages.filter(item => item.id !== found.stage.id) } : volume)));
            stageId = '';
            navigate('plot');
        },
        'stage-goto': () => { const runtime = runtimeForViewed(); if (runtime) runtime.setProgress(goTo(runtime.progress(), runtime.units(), stageId)); rerender(); },
        'stage-discuss': () => { const found = findStage(); if (found) openAdvisor?.(`讨论「${volumeLabel(found.volume.key)}·${stageLabel(found.stage.key)}」：`); },
        'node-kind': button => { nodeKind = button.dataset.plotKind; rerender(); },
        'node-edit': button => editNode(button.dataset.plotField, Number(button.dataset.plotIndex)),
        'node-add': button => editNode(button.dataset.plotField, -1),
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
        'set-carry': () => { api().data.updateSettings({ carryOver: settings().carryOver === false }); rerender(); },
        'open-api': () => globalThis.window?.__pmShowConfig?.('api'),
        'guide-edit': editGuide,
        diagnose,
        stop,
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
        outlineDraft = null;
        viewedId = '';
        tab = 'progress';
    }

    // 剧情参谋回复里的大纲 YAML：送进当前聊天项目的大纲草稿。
    function sendOutlineDraft(text) {
        const id = activeId() || resolveViewedId();
        if (!id) { toast('info', '先在剧情页建一个项目。'); return false; }
        viewedId = id;
        setOutlineDraft(text);
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
