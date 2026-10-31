// 剧情页「设定」页签与设置页里剧情检测各项的动作。由 story-plot.js 传入共用的读写工具（ctx），这里不另存状态。
import { BUILTIN_GUIDE } from './plot-injector/core/guide.js';
import { rewriteBlockMessages, settingMessages } from './plot-injector/core/prompts.js';
import { diffLines, joinBlocks, mergeBlocks, parseSettingReply, splitBlocks } from './plot-injector/core/setting.js';
import { openPlotDialog, pickMany, pickOption, promptText, readWorldBookEntries, showText } from './story-plot-io.js';
import { escapeHtml as rawEscapeHtml } from './ui.js';

// 写作基准、设定可能含非字符串值：先转字符串再转义。
const escapeHtml = value => rawEscapeHtml(value == null ? '' : String(value));

// ctx.draft 是 AI 整理出的设定草稿（读写都经 ctx，story-plot.js 持有）。
export function createPlotSettingActions(deps, ctx) {
    const { api, project, activeId, viewed, settings, guideText, talkText, runAi, commitSetting, setSetting, toast, rerender, confirmAction } = ctx;
    // ---- 设定 ----
    async function aiSetting() {
        const current = viewed();
        const talk = talkText();
        const pickedBooks = await chooseWorldBookRefs('AI整理参考的世界书条目');
        if (pickedBooks == null) return;
        if (!talk.trim() && !pickedBooks.length && !current.setting.text.trim()) throw new Error('没有可参考的内容：先在剧情参谋里聊一聊，或选几条世界书条目。');
        const append = Boolean(current.setting.text.trim()) && confirmAction('只追加新内容、不改动已有分块？\n确定 = 只追加；取消 = 整篇重新整理（可逐块挑选采用）。');
        const reply = await runAi('setting', 'outline', settingMessages({ guide: guideText(), talk, current: current.setting.text, append, refs: pickedBooks }));
        if (!reply) return;
        const parsed = parseSettingReply(reply);
        if (!parsed.body) throw new Error('AI回复里没有世界观正文');
        const body = append ? `${current.setting.text.trim()}\n\n${parsed.body}` : parsed.body;
        ctx.draft = { ...parsed, body, keys: splitBlocks(body).map(block => block.key), open: false, projectId: current.id };
        rerender();
    }

    // 世界书条目多选：默认不勾数据库条目；没有可读世界书时返回空数组。
    async function chooseWorldBookRefs(title) {
        const entries = await readWorldBookEntries(deps.getCtx);
        if (!entries.length) return [];
        const picked = await pickMany(deps, {
            title,
            hint: '不选也可以，只参考剧情参谋的对话。',
            items: entries.map(entry => ({ value: entry.id, label: `${entry.book} · ${entry.title}`, hint: entry.content.slice(0, 60), checked: false })),
        });
        if (picked == null) return null;
        const chosen = new Set(picked);
        return entries.filter(entry => chosen.has(entry.id)).map(entry => ({ title: entry.title, text: entry.content }));
    }

    function applyDraft(all) {
        const draft = ctx.draft;
        if (!draft || draft.projectId !== viewed()?.id) { ctx.draft = null; rerender(); return; }
        const text = all ? draft.body : mergeBlocks(viewed().setting.text, draft.body, draft.keys);
        commitSetting(text, { check: draft.check, fixes: draft.fixes });
        ctx.draft = null;
        rerender();
    }

    async function editFix(index, drop) {
        const current = viewed();
        const fix = current.setting.fixes[index];
        const blocks = splitBlocks(current.setting.text);
        if (fix == null) return;
        if (drop && !confirmAction('让AI从正文里删掉这条补定的内容？\n确定 = 从正文删掉；取消 = 只从列表移除。')) {
            setSetting({ fixes: current.setting.fixes.filter((_, i) => i !== index) });
            rerender();
            return;
        }
        const key = blocks.length > 1 ? await pickOption(deps, { title: drop ? '写在哪个分块' : '改哪个分块', options: blocks.map(block => ({ value: block.key, label: block.title })), value: blocks[0].key }) : blocks[0]?.key;
        if (key == null) return;
        const how = drop ? '' : await promptText(deps, { title: '修改补定', label: `「${fix}」改成什么`, multiline: true, rows: 4 });
        if (!drop && !String(how || '').trim()) return;
        const block = blocks.find(item => item.key === key);
        const note = drop ? `${fix}\n改为：删除这一条，正文里不再保留它的内容，其余不变。` : `${fix}\n改为：${how}`;
        const reply = await runAi('setting', 'outline', rewriteBlockMessages({ guide: guideText(), current: current.setting.text, blockText: block.text, fixes: note }));
        if (!reply) return;
        const rewritten = splitBlocks(parseSettingReply(reply).body)[0];
        if (!rewritten) throw new Error('AI没有返回分块内容');
        commitSetting(joinBlocks(blocks.map(item => (item.key === block.key ? { ...item, text: rewritten.text } : item))), { fixes: viewed().setting.fixes.filter((_, i) => i !== index) });
        rerender();
    }

    async function editBlock(key) {
        const blocks = splitBlocks(viewed().setting.text);
        const block = blocks.find(item => item.key === key);
        if (!block) return;
        const text = await promptText(deps, { title: `编辑「${block.title}」`, label: '标题行（如「铁则:」）也在这里，删掉标题会并进上一块', value: block.text, multiline: true, rows: 12 });
        if (text == null) return;
        commitSetting(joinBlocks(blocks.map(item => (item.key === key ? { ...item, text: String(text).replace(/\s+$/, '') } : item)).filter(item => item.text.trim())));
        rerender();
    }

    async function newBlock() {
        const title = await promptText(deps, { title: '新分块', label: '分块标题', placeholder: '如：人物关系' });
        if (!String(title || '').trim()) return;
        const body = await promptText(deps, { title: `「${String(title).trim()}」的内容`, multiline: true, rows: 10 });
        if (body == null) return;
        commitSetting([viewed().setting.text.trim(), `${String(title).trim()}:\n${String(body).trim()}`].filter(Boolean).join('\n\n'));
        rerender();
    }

    async function editFullSetting() {
        const text = await promptText(deps, { title: '编辑设定全文', label: '行首以冒号结尾的行是分块标题（如「铁则:」）', value: viewed().setting.text, multiline: true, rows: 16 });
        if (text == null) return;
        commitSetting(String(text));
        rerender();
    }

    async function settingHistory() {
        const current = viewed();
        const list = current.setting.history;
        if (!list.length) { toast('info', '还没有历史版本。'); return; }
        const pick = await pickOption(deps, {
            title: '历史版本',
            value: '',
            options: list.map((item, index) => {
                const changes = diffLines(item.text, current.setting.text).filter(line => line.op).length;
                return { value: String(index), label: new Date(item.at).toLocaleString(), hint: `${item.text.length} 字 · 与当前相差 ${changes} 行` };
            }),
        });
        if (pick == null || pick === '') return;
        const item = list[Number(pick)];
        if (!item || !confirmAction('回退到这一版？当前正文会先存进历史。')) return;
        commitSetting(item.text);
        rerender();
    }

    async function importSettingFromBooks() {
        const entries = await readWorldBookEntries(deps.getCtx);
        if (!entries.length) { toast('info', '当前聊天没有可读的世界书。'); return; }
        const picked = await pickMany(deps, { title: '从世界书导入设定', okLabel: '导入', items: entries.map(entry => ({ value: entry.id, label: `${entry.book} · ${entry.title}`, hint: entry.content.slice(0, 60) })) });
        if (!picked?.length) return;
        const chosen = new Set(picked);
        commitSetting([viewed().setting.text, ...entries.filter(entry => chosen.has(entry.id)).map(entry => entry.content)].filter(text => text.trim()).join('\n\n'));
        toast('success', `已导入 ${picked.length} 条。世界书里的原条目仍会照常生效，不需要的话可以在酒馆里关掉。`);
        rerender();
    }
    // ---- 设置 ----
    async function setNumber(key, title, min, max) {
        const value = await promptText(deps, { title, label: `${min}–${max}`, value: String(settings()[key]) });
        if (value == null) return;
        const number = Math.round(Number(value));
        if (!Number.isFinite(number)) throw new Error('请填数字');
        api().data.updateSettings({ [key]: Math.max(min, Math.min(max, number)) });
        rerender();
    }

    async function setChoice(key, title, options) {
        const pick = await pickOption(deps, { title, options, value: settings()[key] });
        if (pick == null) return;
        api().data.updateSettings({ [key]: pick });
        rerender();
    }

    async function editGuide() {
        const current = String(settings().guide || '').trim();
        const result = await openPlotDialog(deps, {
            title: '写作基准',
            body: `<p class="pm-plot-dialog-hint">AI整理设定、写大纲时遵守的规则。留空使用内置版本。</p><label class="pm-settings-field"><span class="pm-cfg-label">写作基准</span><textarea class="pm-cfg-input" name="guide" rows="14">${escapeHtml(current || BUILTIN_GUIDE)}</textarea></label>`,
            actions: [{ label: '恢复内置', value: 'reset' }, { label: '取消', value: 'cancel' }, { label: '保存', value: 'ok', primary: true }],
            read: overlay => overlay.querySelector('[name="guide"]').value,
        });
        if (result == null) return;
        const text = result.action === 'reset' ? '' : String(result).trim();
        api().data.updateSettings({ guide: text === BUILTIN_GUIDE.trim() ? '' : text });
        rerender();
    }

    function diagnose() {
        const plotApi = api();
        const d = plotApi?.runtime?.diagnose?.();
        if (!d) return;
        const current = project(activeId());
        const progress = current ? plotApi.runtime.progress() : null;
        const lines = [
            `运行方：${plotApi.owner === 'standalone' ? `独立版剧情注入器${plotApi.version ? ` v${plotApi.version}` : ''}` : '天音小笺'}`,
            `角色卡：${d.cardKey || '没有打开'}`,
            `当前聊天项目：${current ? current.name : '无'}`,
            `楼数：${d.floors}（打开聊天时 ${d.chatStartFloors}）`,
            progress ? `上次检测：第 ${progress.lastCheckFloor} 楼，每 ${settings().checkEvery} 楼检测一次` : '',
            `检测中：${d.checking ? '是' : '否'}；主回复生成中：${d.generating ? '是' : '否'}；等待检测：${d.pending ? '是' : '否'}`,
            '',
            '事件：',
            ...d.events.map(item => `${item.key}：${item.bound ? '已绑定' : '未绑定'}，收到 ${item.count} 次`),
            '',
            '最近记录：',
            ...d.logs.slice(-20).map(item => `${new Date(item.at).toLocaleTimeString()} ${item.text}`),
        ].filter(line => line !== null);
        return showText(deps, { title: '剧情注入器诊断', text: lines.join('\n') });
    }

    return { aiSetting, chooseWorldBookRefs, applyDraft, editFix, editBlock, newBlock, editFullSetting, settingHistory, importSettingFromBooks, setNumber, setChoice, editGuide, diagnose };
}
