// 剧情页的大纲页签：导入导出、AI写大纲（一次1到5卷，逐卷写、可停止）、草稿、单阶段AI操作、历史版本、卷与阶段的编辑与移动、节点编辑（含玩法）。
// 参照 PlotInjector v0.1.24 src/ui/tab-outline.js 的改法；界面在 story-plot-views.js。草稿与面板状态由这里持有。
import { CHANGE_FIELD, NODE_FIELDS, changeLines, flattenUnits, makeId, moveItem, moveStageToVolume, nearestUnitId, outlineToText, parseOutlineText, replaceRest, replaceStages, restoreOutline, stageLabel, stageNodes, stageToText, volumeLabel, volumeToText } from './plot-injector/core/outline.js';
import { currentIndex, goTo } from './plot-injector/core/progress.js';
import { fixYamlMessages, outlineMessages, parseOutlineReply, stageOpMessages } from './plot-injector/core/prompts.js';
import { outlineLinks, withRenames } from './plot-injector/core/align.js';
import { hookSteps, migrateStageThreads, remapNodes, renameByPosition, renameNode } from './plot-injector/core/threads.js';
import { downloadText, openPlotDialog, pickAction, pickTextFile, promptText, showText } from './story-plot-io.js';
import { escapeAttr as rawEscapeAttr, escapeHtml as rawEscapeHtml } from './ui.js';

const escapeHtml = value => rawEscapeHtml(value == null ? '' : String(value));
const escapeAttr = value => rawEscapeAttr(value == null ? '' : String(value));

export function createPlotOutlineActions(deps, ctx) {
    const {
        api, viewed, resolveViewedId, updateVolumes, updateStage, runAi, rerender, navigate, toast, confirmAction, chooseWorldBookRefs, talkText, syncOutline,
        runtimeForViewed, liveProgress, safeFileName, moveUp, plot, setTab, setStage, getStage, setNodeKind, isBusy, setTask, clearTask,
    } = ctx;
    let outlineDraft = null;
    // 面板：''（卷与阶段）/ check / overview / history；historyAt 为正在预览的历史版本。
    let outlinePanel = '';
    let historyAt = -1;
    // 一次写多卷时的进度 { k, n, controller, projectId }。
    let multi = null;

    // ---- 大纲 ----
    function addVolumes(incoming, label = '导入') {
        const existing = new Set(viewed().outline.volumes.map(volume => volume.key));
        const fresh = incoming.map(volume => (existing.has(volume.key) ? { ...volume, key: `${volume.key}_导入${Date.now().toString(36).slice(-3)}` } : volume));
        updateVolumes(volumes => [...volumes, ...fresh], label);
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

    // 「AI写大纲」：卷数 1 到 5 + 整体要求；多卷按卷顺序逐卷请求，后一卷参考前面已写好的卷，可停止。
    const MAX_VOLUMES = 5;

    async function aiVolume() {
        const current = viewed();
        const no = current.outline.volumes.length + 1;
        const picked = await openPlotDialog(deps, {
            title: `AI写大纲（从第 ${no} 卷起）`,
            body: `<label class="pm-settings-field"><span class="pm-cfg-label">卷数</span><select class="pm-cfg-input" name="n">${Array.from({ length: MAX_VOLUMES }, (_, i) => `<option value="${i + 1}">${i + 1} 卷</option>`).join('')}</select></label>
              <label class="pm-settings-field"><span class="pm-cfg-label">整体要求（可空）</span><textarea class="pm-cfg-input" name="request" rows="4"></textarea></label>`,
            actions: [{ label: '取消', value: 'cancel' }, { label: '开始写作', value: 'ok', primary: true }],
            read: overlay => ({ n: Number(overlay.querySelector('[name="n"]').value) || 1, request: overlay.querySelector('[name="request"]').value.trim() }),
        });
        if (!picked) return;
        if (draftHere() && !confirmAction('草稿区还有未处理的AI结果，开始写作后会被新草稿替换。')) return;
        const talk = talkText(12000);
        const refs = await chooseWorldBookRefs('写大纲参考的世界书条目');
        if (refs == null) return;
        if (!current.setting.text.trim() && !talk.trim() && !refs.length) throw new Error('没有可参考的内容：先写设定，或在剧情参谋里聊一聊。');
        const ask = (k, extra, signal) => {
            const request = picked.n > 1 ? `共写 ${picked.n} 卷，这是第 ${k} 卷。${picked.request}` : picked.request;
            return outlineMessages({ setting: current.setting.text, talk, refs, volumes: [...current.outline.volumes, ...extra], volumeNo: no + k - 1, request });
        };
        if (picked.n <= 1) {
            const reply = await runAi('outline', 'outline', ask(1, []));
            if (reply) setOutlineDraft(reply, 'volume');
            rerender();
            return;
        }
        await writeVolumes({ n: picked.n, no, ask, request: picked.request, refs, talk });
    }

    // 逐卷写：草稿逐卷出现，失败或停止时保留已写好的卷。
    async function writeVolumes({ n, no, ask }) {
        if (isBusy()) { toast('info', '上一个AI任务还没结束。'); return; }
        const generate = plot()?.host?.generate;
        if (typeof generate !== 'function') throw new Error('剧情注入器尚未就绪');
        const projectId = resolveViewedId();
        const draft = { mode: 'multi', items: [], n, volumeNo: no, projectId, ask };
        outlineDraft = draft;
        setTab('outline');
        const controller = new AbortController();
        setTask('outline', controller);
        multi = { k: 1, n, controller, projectId };
        try {
            for (let k = 1; k <= n; k += 1) {
                multi.k = k;
                rerender();
                let reply;
                try {
                    reply = await generate('outline', ask(k, draft.items.flatMap(item => item.volumes || [])), { signal: controller.signal });
                } catch (error) {
                    if (!controller.signal.aborted) toast('error', `第 ${k} 卷写作失败：${error.message}。已写好的 ${draft.items.length} 卷保留在草稿里。`);
                    break;
                }
                if (controller.signal.aborted) break;
                draft.items = [...draft.items, parseOutlineReply(reply, undefined, { all: true })];
            }
            if (controller.signal.aborted) toast('info', `已停止，保留已写好的 ${draft.items.length} 卷。`);
        } finally {
            multi = null;
            clearTask(controller);
            if (!draft.items.length && outlineDraft === draft) outlineDraft = null;
            rerender();
        }
    }

    const multiDraft = () => (outlineDraft?.mode === 'multi' && draftHere() ? outlineDraft : null);
    function setMultiItem(index, parsed) {
        const draft = multiDraft();
        if (!draft) return;
        outlineDraft = { ...draft, items: draft.items.map((item, i) => (i === index ? parsed : item)) };
        rerender();
    }

    async function multiAction(kind, index) {
        const draft = multiDraft();
        const item = draft?.items[index];
        if (!item) return;
        if (kind === 'fix') {
            const reply = await runAi('outline', 'outline', fixYamlMessages(item.yaml, item.error));
            if (reply) setMultiItem(index, parseOutlineReply(reply, undefined, { all: true }));
        } else if (kind === 'edit') {
            const yaml = await promptText(deps, { title: `第 ${draft.volumeNo + index} 卷 · 手动修改YAML`, label: item.error || 'YAML', value: item.yaml, multiline: true, rows: 16 });
            if (yaml != null) setMultiItem(index, parseOutlineReply(`\`\`\`yaml\n${yaml}\n\`\`\``));
        } else if (kind === 'redo') {
            const before = draft.items.filter((other, i) => i !== index && other.ok).flatMap(other => other.volumes);
            const reply = await runAi('outline', 'outline', draft.ask(index + 1, before));
            if (reply) setMultiItem(index, parseOutlineReply(reply, undefined, { all: true }));
        } else if (kind === 'yaml') {
            await showText(deps, { title: `第 ${draft.volumeNo + index} 卷 · YAML原文`, text: item.yaml });
        }
    }

    // all：一次回了多卷、每卷一个 yaml 代码块时全部接起来（剧情参谋送来的、多卷写作用）。
    function setOutlineDraft(reply, mode = 'volume', extra = {}, { all = false } = {}) {
        outlineDraft = { mode, ...parseOutlineReply(reply, undefined, { all }), projectId: resolveViewedId(), ...extra };
        setTab('outline');
    }

    const draftExtra = draft => ({ fromUnitId: draft.fromUnitId, reason: draft.reason, stageId: draft.stageId, nextId: draft.nextId });

    async function fixDraft() {
        const draft = outlineDraft;
        const reply = await runAi('outline', 'outline', fixYamlMessages(draft.yaml, draft.error));
        if (reply) setOutlineDraft(reply, draft.mode, draftExtra(draft));
        rerender();
    }

    async function editDraft() {
        const draft = outlineDraft;
        const yaml = await promptText(deps, { title: '手动修改YAML', label: draft.error, value: draft.yaml, multiline: true, rows: 16 });
        if (yaml == null) return;
        setOutlineDraft(`\`\`\`yaml\n${yaml}\n\`\`\``, draft.mode, draftExtra(draft));
        rerender();
    }

    async function applyRest() {
        const draft = outlineDraft;
        const current = viewed();
        const unit = flattenUnits(current.outline.volumes).find(item => item.id === draft.fromUnitId);
        if (!unit) throw new Error('原来的阶段已不存在，改用「存为新卷」。');
        if (!confirmAction('当前阶段及之后的阶段会换成改写后的内容，进度跳到改写后的第一段。')) return;
        const volumes = replaceRest(current.outline.volumes, unit.stage.id, draft.volumes);
        updateVolumes(() => volumes, '改写后续阶段');
        const first = draft.volumes[0]?.stages[0];
        const runtime = runtimeForViewed();
        if (first && runtime) runtime.setProgress(goTo(runtime.progress(), flattenUnits(volumes), first.id));
        outlineDraft = null;
        rerender();
        const from = first ? flattenUnits(volumes).findIndex(item => item.id === first.id) : 0;
        await syncOutline({ from: Math.max(0, from), reason: draft.reason, auto: true });
    }

    // 单阶段AI操作（细化节点、拆成两段、与下一段合并）：结果先进草稿区，点「替换」才落盘。
    const STAGE_OPS = Object.freeze({ refine: '细化节点', split: '拆成两段', merge: '与下一段合并' });

    async function stageOp(op) {
        const found = findStage();
        if (!found) return;
        const current = viewed();
        const next = op === 'merge' ? found.volume.stages[found.volume.stages.indexOf(found.stage) + 1] : null;
        if (op === 'merge' && !next) throw new Error('本卷没有下一段可合并。');
        const unit = flattenUnits(current.outline.volumes).find(item => item.id === found.stage.id);
        const request = await promptText(deps, { title: STAGE_OPS[op], label: '给AI的额外要求（可空）', multiline: true, rows: 3 });
        if (request == null) return;
        const reply = await runAi('outline', 'outline', stageOpMessages({ setting: current.setting.text, talk: talkText(12000), refs: [], volumes: current.outline.volumes, unit, next, op, request: request.trim() }));
        if (reply) setOutlineDraft(reply, `stage-${op}`, { stageId: found.stage.id, nextId: next ? next.id : '' });
        navigate('plot');
    }

    function applyStageDraft() {
        const draft = outlineDraft;
        const current = viewed();
        const volume = current.outline.volumes.find(item => item.stages.some(stage => stage.id === draft.stageId));
        if (!volume) throw new Error('原来的阶段已不存在，改用「丢弃」。');
        const incoming = draft.volumes.flatMap(item => item.stages);
        if (!incoming.length) throw new Error('结果里没有阶段。');
        const ids = [draft.stageId, ...(draft.nextId ? [draft.nextId] : [])];
        const old = volume.stages.filter(stage => ids.includes(stage.id));
        const { volumes, stages, keepId } = replaceStages(current.outline.volumes, volume.id, ids, incoming);
        // 第一段沿用原阶段 id；钟、钩子、已演节点按名称迁到新阶段；被换掉的 id 记进别名表，其他聊天打开时跟过来。
        const progress = liveProgress();
        updateVolumes(() => volumes, STAGE_OPS[draft.mode.slice(6)], ids.filter(id => id !== keepId).map(id => [id, keepId]));
        if (progress) {
            const moved = migrateStageThreads(progress, old, stages, keepId);
            runtimeForViewed().setProgress(ids.includes(progress.current) ? goTo(moved, flattenUnits(volumes), keepId) : moved);
        }
        outlineDraft = null;
        rerender();
    }

    // 恢复历史版本：当前大纲先入历史；当前聊天按位置补一次改名，当前阶段不在了就沿别名表找，仍找不到取位置最接近的阶段。
    function restoreHistory(index) {
        const current = viewed();
        const item = current.outline.history[index];
        if (!item || !confirmAction('当前大纲会先存进历史版本，再换成这一版。')) return;
        const before = current.outline.volumes;
        const progress = liveProgress();
        const { volumes, alias } = restoreOutline(item.text, before);
        updateVolumes(() => volumes, '恢复历史版本', alias);
        if (progress) {
            const units = flattenUnits(volumes);
            const links = outlineLinks(viewed().outline, units);
            let next = renameByPosition(progress, units, links);
            const old = flattenUnits(before);
            const cur = old[currentIndex(old, progress)]?.id;
            const resolved = cur ? links.resolve(cur) : '';
            const alive = resolved && units.some(unit => unit.id === resolved);
            const to = alive ? (resolved === cur ? null : resolved) : nearestUnitId(before, volumes, cur);
            if (to) next = goTo(next, units, to);
            if (next !== progress) runtimeForViewed().setProgress(next);
        }
        historyAt = -1;
        toast('success', '已恢复这一版大纲。');
        rerender();
    }

    const draftHere = () => Boolean(outlineDraft && outlineDraft.projectId === resolveViewedId());
    const findVolume = id => viewed()?.outline.volumes.find(volume => volume.id === id) || null;
    const findStage = () => {
        for (const volume of viewed()?.outline.volumes || []) {
            const stage = volume.stages.find(item => item.id === getStage());
            if (stage) return { volume, stage };
        }
        return null;
    };

    async function editStageField(field) {
        const found = findStage();
        if (!found) return;
        if (field === CHANGE_FIELD) {
            const value = await promptText(deps, { title: field, label: '每行一条，本阶段演完后接在设定后面注入', value: changeLines(found.stage.data).join('\n'), multiline: true, rows: 5 });
            if (value == null) return;
            const lines = String(value).split('\n').map(line => line.trim()).filter(Boolean);
            updateStage(found.stage.id, stage => {
                const data = { ...stage.data, [field]: lines };
                if (!lines.length) delete data[field];
                return { ...stage, data };
            });
            rerender();
            return;
        }
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
        updateStage(found.stage.id, stage => ({ ...stage, key: next.key, data: next.data }), 'YAML原文应用');
        rerender();
    }

    const NODE_KEYS = Object.freeze({ main: ['名称', '地点', '事件', '偏转'], side: ['名称', '地点', '事件', '触发', '偏转'], world: ['类型', '来源', '内容'] });
    const LONG_KEYS = new Set(['事件', '偏转', '内容', '触发']);
    // 玩法：支线的钩子（条件、时限、错过、步骤）、世界动态的进度钟（进度钟、前兆、后果）；空值不写进YAML。
    const PLAY_KEYS = Object.freeze({ side: ['条件', '时限', '错过', '步骤'], world: ['进度钟', '前兆', '后果'] });
    const PLAY_HINTS = Object.freeze({ 条件: '满足后才激活，如主角到过酒馆', 时限: '激活后的楼数，或写「本卷」', 错过: '过期未接时的后果', 步骤: '每行一步，按顺序推进', 进度钟: '总格数，如4、6、8', 前兆: '过半时透露的风声', 后果: '发生后写进状态变化' });
    const PLAY_LONG = new Set(['错过', '步骤', '前兆', '后果']);

    // 进度钟、数字时限存成数字，步骤存成列表，空值删掉这个键。
    function playValue(key, raw) {
        const text = String(raw ?? '').trim();
        if (key === '步骤') {
            const lines = text.split('\n').map(line => line.trim()).filter(Boolean);
            return lines.length ? lines : undefined;
        }
        if (!text) return undefined;
        if (key === '进度钟' || (key === '时限' && /^\d+$/.test(text))) return Number(text);
        return text;
    }

    const fieldHtml = (key, value, long, hint = '') => `<label class="pm-settings-field"><span class="pm-cfg-label">${escapeHtml(key)}</span>${long
        ? `<textarea class="pm-cfg-input" rows="3" name="${escapeAttr(key)}" placeholder="${escapeAttr(hint)}">${escapeHtml(value)}</textarea>`
        : `<input class="pm-cfg-input" name="${escapeAttr(key)}" value="${escapeAttr(value)}" placeholder="${escapeAttr(hint)}"${key === '进度钟' ? ' type="number" min="2" max="12"' : ''}>`}</label>`;

    // 节点挪动或删除后：当前聊天按新位置重排已演标记与钟、钩子（进度在改大纲之前取）。
    function remapAfter(progress, stageIdValue, field, mapIndex) {
        const meta = NODE_FIELDS.find(item => item.field === field);
        if (!meta || !progress) return;
        const next = remapNodes(progress, stageIdValue, meta.prefix, mapIndex);
        if (next !== progress) runtimeForViewed()?.setProgress(next);
    }

    // 节点编辑弹窗：新增时 index 为 -1。支线、世界动态多一个「玩法」区。
    async function editNode(field, index) {
        const found = findStage();
        if (!found) return;
        const meta = NODE_FIELDS.find(item => item.field === field);
        const list = Array.isArray(found.stage.data?.[field]) ? found.stage.data[field] : [];
        const raw = index >= 0 ? list[index] : null;
        const value = raw && typeof raw === 'object' ? raw : raw != null ? { 内容: String(raw) } : {};
        const play = PLAY_KEYS[meta.kind] || [];
        const keys = [...new Set([...NODE_KEYS[meta.kind], ...Object.keys(value)])].filter(key => !play.includes(key));
        const shown = key => (key === '步骤' ? hookSteps(value).join('\n') : String(value[key] ?? ''));
        const used = play.some(key => shown(key).trim());
        const playHtml = play.length ? `<details class="pm-plot-play"${used ? ' open' : ''}><summary>玩法</summary>${play.map(key => fieldHtml(key, shown(key), PLAY_LONG.has(key), PLAY_HINTS[key])).join('')}</details>` : '';
        const body = `${keys.map(key => fieldHtml(key, value[key] ?? '', LONG_KEYS.has(key))).join('')}${playHtml}`;
        const actions = index >= 0
            ? [{ label: '删除', value: 'delete' }, ...(index > 0 ? [{ label: '上移', value: 'up' }] : []), ...(index < list.length - 1 ? [{ label: '下移', value: 'down' }] : []), { label: '保存', value: 'ok', primary: true }]
            : [{ label: '取消', value: 'cancel' }, { label: '添加', value: 'ok', primary: true }];
        const read = overlay => Object.fromEntries([...keys, ...play].map(key => [key, overlay.querySelector(`[name="${CSS.escape(key)}"]`)?.value ?? '']));
        const result = await openPlotDialog(deps, { title: `${meta.label}节点`, body, actions, read });
        if (!result) return;
        const before = liveProgress();
        const oldName = index >= 0 ? stageNodes(found.stage.data).find(node => node.field === field && node.index === index)?.name : '';
        if (result.action === 'delete') {
            if (!confirmAction('删除这个节点？')) return;
            updateStage(found.stage.id, stage => {
                const next = stage.data[field].filter((_, i) => i !== index);
                const data = { ...stage.data, [field]: next };
                if (!next.length && field !== '主线节点') delete data[field];
                return { ...stage, data };
            });
            remapAfter(before, found.stage.id, field, i => (i === index ? null : i > index ? i - 1 : i));
            rerender();
            return;
        }
        const form = result.action ? result.form : result;
        const merged = { ...value };
        for (const key of keys) merged[key] = form[key];
        for (const key of play) {
            const parsed = playValue(key, form[key]);
            if (parsed === undefined) delete merged[key];
            else merged[key] = parsed;
        }
        const to = result.action === 'up' ? index - 1 : result.action === 'down' ? index + 1 : index;
        updateStage(found.stage.id, stage => {
            const current = Array.isArray(stage.data[field]) ? [...stage.data[field]] : [];
            if (index >= 0) current[index] = merged;
            else current.push(merged);
            return { ...stage, data: { ...stage.data, [field]: to === index ? current : moveItem(current, index, to - index) } };
        });
        if (index >= 0 && to !== index) remapAfter(before, found.stage.id, field, i => (i === index ? to : i === to ? index : i));
        // 改了节点名：记进大纲的改名表（其他聊天按改名链找回记录），当前聊天同一位置的钟、钩子、已演标记跟着改名。
        const after = findStage();
        const node = index >= 0 && after ? stageNodes(after.stage.data).find(item => item.field === field && item.index === to) : null;
        if (node && oldName && oldName !== node.name) {
            api().data.updateProject(viewed().id, project => ({ ...project, outline: withRenames(project.outline, [{ stageId: found.stage.id, field, from: oldName, to: node.name }]) }));
            const progress = liveProgress();
            const renamed = progress && renameNode(progress, { id: found.stage.id }, node);
            if (renamed && renamed !== progress) runtimeForViewed().setProgress(renamed);
        }
        rerender();
    }
    const actions = {
        'outline-import': async () => { const file = await pickTextFile('.yaml,.yml,.txt'); if (file) importOutlineText(file.text, file.name); },
        'outline-paste': async () => { const text = await promptText(deps, { title: '粘贴剧情YAML', multiline: true, rows: 14, placeholder: '剧情_卷一_标题:\n  阶段一_标题:\n    时间范围: …' }); if (String(text || '').trim()) importOutlineText(text); },
        'outline-export': () => downloadText(`${safeFileName(viewed().name)}-大纲.yaml`, outlineToText(viewed().outline.volumes), 'text/yaml'),
        'outline-ai': aiVolume,
        'odraft-fix': fixDraft,
        'odraft-edit': editDraft,
        'odraft-drop': () => { outlineDraft = null; rerender(); },
        'odraft-new': () => { if (!draftHere()) return; addVolumes(outlineDraft.volumes, 'AI新建卷'); outlineDraft = null; rerender(); },
        'odraft-append': () => {
            if (!draftHere()) return;
            const stages = outlineDraft.volumes.flatMap(volume => volume.stages);
            updateVolumes(volumes => volumes.map((volume, i) => (i === volumes.length - 1 ? { ...volume, stages: [...volume.stages, ...stages] } : volume)), 'AI追加阶段');
            outlineDraft = null;
            rerender();
        },
        'odraft-rest': () => { if (draftHere()) applyRest(); },
        'odraft-stage': () => { if (draftHere()) applyStageDraft(); },
        'multi-stop': () => multi?.controller.abort('story-plot-stopped'),
        'multi-fix': button => multiAction('fix', Number(button.dataset.plotIndex)),
        'multi-edit': button => multiAction('edit', Number(button.dataset.plotIndex)),
        'multi-redo': button => multiAction('redo', Number(button.dataset.plotIndex)),
        'multi-yaml': button => multiAction('yaml', Number(button.dataset.plotIndex)),
        'multi-append': () => {
            const draft = multiDraft();
            if (!draft || !draft.items.length || draft.items.some(item => !item.ok) || isBusy()) return;
            addVolumes(draft.items.flatMap(item => item.volumes), 'AI追加多卷');
            outlineDraft = null;
            rerender();
        },
        'outline-panel': button => { const next = button.dataset.plotPanel || ''; outlinePanel = outlinePanel === next ? '' : next; historyAt = -1; rerender(); },
        'hist-view': button => { const i = Number(button.dataset.plotIndex); historyAt = historyAt === i ? -1 : i; rerender(); },
        'hist-restore': button => restoreHistory(Number(button.dataset.plotIndex)),
        'vol-down': button => { updateVolumes(volumes => moveItem(volumes, volumes.findIndex(volume => volume.id === button.dataset.plotVol), 1)); rerender(); },
        'vol-export': button => { const volume = findVolume(button.dataset.plotVol); if (volume) downloadText(`${safeFileName(volume.key)}.yaml`, volumeToText(volume), 'text/yaml'); },
        'stage-down': () => { const found = findStage(); if (found) updateVolumes(volumes => volumes.map(volume => (volume.id === found.volume.id ? { ...volume, stages: moveItem(volume.stages, volume.stages.indexOf(found.stage), 1) } : volume))); rerender(); },
        'stage-move': async () => {
            const found = findStage();
            const others = found ? viewed().outline.volumes.filter(item => item.id !== found.volume.id) : [];
            if (!others.length) { toast('info', '没有其他卷可移动。'); return; }
            const to = await pickAction(deps, { title: '移到…', items: others.map(item => ({ label: volumeLabel(item.key), value: item.id })) });
            if (!to) return;
            updateVolumes(volumes => moveStageToVolume(volumes, found.stage.id, to));
            rerender();
        },
        'stage-op': button => stageOp(button.dataset.plotOp),
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
            updateVolumes(volumes => volumes.filter(item => item.id !== volume.id), '删除卷');
            rerender();
        },
        'stage-add': button => {
            const volume = findVolume(button.dataset.plotVol);
            if (!volume) return;
            const stage = { id: makeId('s'), key: `阶段${volume.stages.length + 1}_新阶段`, data: { 时间范围: '', AI指令: '', 主线节点: [] } };
            updateVolumes(volumes => volumes.map(item => (item.id === volume.id ? { ...item, stages: [...item.stages, stage] } : item)));
            setStage(stage.id);
            navigate('stage');
        },
        'open-stage': button => { setStage(button.dataset.plotStage); setNodeKind('main'); navigate('stage'); },
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
            updateVolumes(volumes => volumes.map(volume => (volume.id === found.volume.id ? { ...volume, stages: volume.stages.filter(item => item.id !== found.stage.id) } : volume)), '删除阶段');
            setStage('');
            navigate('plot');
        },
        'node-kind': button => { setNodeKind(button.dataset.plotKind); rerender(); },
        'node-edit': button => editNode(button.dataset.plotField, Number(button.dataset.plotIndex)),
        'node-add': button => editNode(button.dataset.plotField, -1),
    };

    return {
        actions,
        setOutlineDraft,
        findStage,
        viewFields(shownId) {
            return {
                outlineDraft: outlineDraft && outlineDraft.projectId === shownId ? outlineDraft : null,
                outlinePanel, historyAt,
                multi: multi && multi.projectId === shownId ? { k: multi.k, n: multi.n } : null,
            };
        },
        forget(projectId) { if (outlineDraft?.projectId === projectId) outlineDraft = null; },
        reset() { outlineDraft = null; outlinePanel = ''; historyAt = -1; },
    };
}
