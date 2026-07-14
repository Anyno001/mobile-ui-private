import { saveGroupMeta, saveHistories } from './storage.js';

const MAX_TOTAL = 10;

function getDirectoryState(id) {
    const histories = window.__pmHistories[id] || {};
    const groups = window.__pmGroupMeta[id] || {};
    const contacts = Object.keys(histories).filter(key => !key.startsWith('__group_'));
    const groupNames = Object.values(groups).map(group => group.name).filter(Boolean);
    return { histories, groups, contacts, groupNames, total: contacts.length + groupNames.length };
}

function setSpinning(active) {
    const icon = document.getElementById('pm-autogen-icon');
    const button = document.getElementById('pm-autogen-btn');
    if (icon) icon.style.animation = active ? 'pm-spin 0.8s linear infinite' : '';
    if (button) button.style.pointerEvents = active ? 'none' : '';
}

function buildPrompts(context, existingNames, maxNew) {
    const { cardDesc, cardPersonality, cardScenario, mainChatText, worldBookText, userName, userDesc } = context;
    const minNew = Math.min(3, maxNew);
    const existingText = existingNames.length
        ? `已有联系人/群聊（跳过同名）：${existingNames.join('、')}`
        : '目前暂无联系人。';
    const amountText = minNew === maxNew ? `${maxNew}` : `${minNew} 到 ${maxNew}`;
    const systemPrompt = `你是一个角色扮演辅助工具，负责根据当前剧情背景自动生成符合世界观的联系人列表。\n输出必须严格为 JSON：{"contacts":["角色名"],"groups":[{"name":"群聊名称","members":["成员1","成员2"]}]}\n要求：\n1. contacts 是单个联系人，groups 是群聊（每个群 2~15 个成员）\n2. 生成总数为 ${amountText} 个\n3. 名称必须符合当前剧情世界观\n4. 不得与 ${existingText} 同名（忽略大小写）\n5. 不生成用户自己（${userName}），联系人名、群聊名和群聊成员均不得使用该用户名（忽略大小写）\n6. 只输出 JSON，不输出注释或 markdown`;
    const userPrompt = [
        `【用户信息】\n用户名：${userName}${userDesc ? '\n' + userDesc : ''}`,
        cardDesc ? `【角色/世界设定】\n${cardDesc}` : '',
        cardPersonality ? `【性格】\n${cardPersonality}` : '',
        cardScenario ? `【场景】\n${cardScenario}` : '',
        worldBookText ? `【世界书】\n${worldBookText}` : '',
        mainChatText ? `【主线最近对话】\n${mainChatText}` : '',
        existingText,
        `请生成 ${amountText} 个符合以上背景的联系人和/或群聊，以 JSON 输出。`,
    ].filter(Boolean).join('\n\n');
    return { systemPrompt, userPrompt };
}

function parseGeneratedDirectory(raw) {
    const text = String(raw ?? '').trim();
    const fenced = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
    const jsonText = fenced ? fenced[1].trim() : text;
    if (!jsonText) throw new Error('AI 返回了空内容');
    let parsed;
    try { parsed = JSON.parse(jsonText); }
    catch (error) { throw new Error(`AI 返回格式无法解析：${jsonText.slice(0, 100)}`); }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('AI 返回的 JSON 顶层必须是对象');
    return parsed;
}

export function installContactGenerator(state, deps) {
    const {
        getStorageId, gatherContext, callAI,
        beginGeneration, isGenerationTaskActive, finishGeneration,
    } = deps;

    window.__pmConfirmAutoGen = () => {
        const id = getStorageId();
        if (!id || id === 'sms_unknown__default') return;
        const { total } = getDirectoryState(id);
        if (total >= MAX_TOTAL) {
            alert(`已有 ${total} 个联系人/群聊，已达上限（${MAX_TOTAL}），无法继续生成。`);
            return;
        }
        const canAdd = MAX_TOTAL - total;
        if (!confirm(`AI 将根据当前剧情信息自动生成联系人和群聊（最多 ${canAdd} 个），直接写入列表，是否继续？`)) return;
        window.__pmAutoGenContacts();
    };

    window.__pmAutoGenContacts = async () => {
        const id = getStorageId();
        if (!id || id === 'sms_unknown__default') return;
        const directory = getDirectoryState(id);
        const maxNew = Math.min(MAX_TOTAL - directory.total, MAX_TOTAL);
        if (maxNew <= 0) return;
        const task = beginGeneration(id);
        if (!task) return;
        setSpinning(true);
        try {
            const context = await gatherContext(task.context);
            if (!isGenerationTaskActive(task)) return;
            const existingNames = [...directory.contacts, ...directory.groupNames];
            const { systemPrompt, userPrompt } = buildPrompts(context, existingNames, maxNew);
            const raw = await callAI(systemPrompt, userPrompt, { maxTokens: 600 });
            if (!isGenerationTaskActive(task)) return;
            const parsed = parseGeneratedDirectory(raw);

            if (!window.__pmHistories[id]) window.__pmHistories[id] = {};
            if (!window.__pmGroupMeta[id]) window.__pmGroupMeta[id] = {};
            // AI 请求期间目录可能被其他操作修改；以落盘前的实时状态重新计算容量和去重集合。
            const latestDirectory = getDirectoryState(id);
            const remaining = Math.max(0, MAX_TOTAL - latestDirectory.total);
            const knownNames = new Set([...latestDirectory.contacts, ...latestDirectory.groupNames].map(name => name.toLowerCase()));
            const userName = String(context.userName || '').trim().toLowerCase();
            let added = 0;

            for (const value of Array.isArray(parsed.contacts) ? parsed.contacts : []) {
                if (added >= remaining) break;
                if (typeof value !== 'string') continue;
                const name = value.trim();
                const normalized = name.toLowerCase();
                if (!name || normalized === userName || knownNames.has(normalized)) continue;
                window.__pmHistories[id][name] = [];
                knownNames.add(normalized);
                added++;
            }

            for (const group of Array.isArray(parsed.groups) ? parsed.groups : []) {
                if (added >= remaining) break;
                const name = typeof group?.name === 'string' ? group.name.trim() : '';
                const normalized = name.toLowerCase();
                if (!name || normalized === userName || knownNames.has(normalized) || !Array.isArray(group.members)) continue;
                const memberNames = new Set();
                const members = [];
                for (const value of group.members) {
                    if (typeof value !== 'string') continue;
                    const member = value.trim();
                    const memberKey = member.toLowerCase();
                    if (!member || memberKey === userName || memberNames.has(memberKey)) continue;
                    memberNames.add(memberKey);
                    members.push(member);
                    if (members.length >= 15) break;
                }
                if (members.length < 2) continue;
                const groupKey = `__group_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
                window.__pmGroupMeta[id][groupKey] = { name, members };
                knownNames.add(normalized);
                added++;
            }

            if (!isGenerationTaskActive(task)) return;
            saveHistories();
            saveGroupMeta();
            // 仅刷新仍然打开的联系人弹窗，避免异步完成后重新打开或污染其他界面。
            if (document.getElementById('pm-autogen-btn')) window.__pmShowList();
        } catch (error) {
            console.error('[phone-mode] __pmAutoGenContacts 异常', error);
            if (isGenerationTaskActive(task)) alert(`自动生成失败：${error?.message || error}`);
        } finally {
            const finishedOwnTask = finishGeneration(task);
            // 旧任务失效后可能已有新任务启动；旧 finally 只能在当前没有新任务时清理 spinner。
            if (finishedOwnTask || !state.generationTask) setSpinning(false);
        }
    };
}
