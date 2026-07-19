import { generationErrorMessage, parseFirstJsonObject } from './ai.js';
import { getDirectorySaveRevision } from './directory-save-coordinator.js';
import { saveGroupMeta, saveHistoriesStrict } from './storage.js';

const AUTO_GENERATION_BATCH = 10;

function getDirectoryState(id) {
    const histories = window.__pmHistories[id] || {};
    const groups = window.__pmGroupMeta[id] || {};
    const contacts = Object.keys(histories).filter(key => !key.startsWith('__group_'));
    const groupNames = Object.values(groups).map(group => group.name).filter(Boolean);
    return { histories, groups, contacts, groupNames, total: contacts.length + groupNames.length };
}

function setSpinning(active) {
    const button = document.getElementById('pm-autogen-btn');
    const icon = button?.querySelector('svg');
    if (icon) icon.style.animation = active ? 'pm-spin 0.8s linear infinite' : '';
    if (button) { button.disabled = active; button.setAttribute('aria-busy', String(active)); }
}

function buildPrompts(context, existingNames) {
    const { cardDesc, cardPersonality, cardScenario, mainChatText, worldBookText, userName, userDesc } = context;
    const existingText = existingNames.length
        ? `已有联系人/群聊（跳过同名）：${existingNames.join('、')}`
        : '目前暂无联系人。';
    const amountText = `3 到 ${AUTO_GENERATION_BATCH}`;
    const systemPrompt = `你是一个角色扮演辅助工具，负责根据当前剧情背景自动生成符合世界观的联系人列表。\n输出必须严格为 JSON：{"contacts":["角色名"],"groups":[{"name":"群聊名称","members":["成员1","成员2"]}]}\n要求：\n1. contacts 是单个联系人，groups 是群聊（每个群至少 2 个成员，不设产品数量上限）\n2. 本次生成总数为 ${amountText} 个\n3. 名称必须符合当前剧情世界观\n4. 不得与 ${existingText} 同名（忽略大小写）\n5. 不生成用户自己（${userName}），联系人名、群聊名和群聊成员均不得使用该用户名（忽略大小写）\n6. 只输出 JSON，不输出注释或 markdown`;
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

export function parseGeneratedDirectory(raw) {
    const text = String(raw ?? '').trim();
    if (!text) throw new Error('AI 返回了空内容');
    const parsed = parseFirstJsonObject(
        text, 'AI 返回格式无法解析，未找到有效的联系人 JSON',
        value => !!value && typeof value === 'object' && !Array.isArray(value)
            && Object.keys(value).some(key => key === 'contacts' || key === 'groups'),
    );
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('AI 返回的联系人 JSON 顶层必须是对象');
    const keys = Object.keys(parsed);
    if (!keys.some(key => key === 'contacts' || key === 'groups')) throw new Error('AI 返回的联系人 JSON 缺少 contacts 或 groups');
    const extra = keys.find(key => key !== 'contacts' && key !== 'groups');
    if (extra) throw new Error(`AI 返回的联系人 JSON 包含额外字段：${extra}`);
    if (parsed.contacts !== undefined && !Array.isArray(parsed.contacts)) throw new Error('AI 返回的 contacts 必须是数组');
    if (parsed.groups !== undefined && !Array.isArray(parsed.groups)) throw new Error('AI 返回的 groups 必须是数组');
    for (const contact of parsed.contacts || []) {
        if (typeof contact !== 'string') throw new Error('AI 返回的 contacts 每项必须是字符串');
    }
    for (const group of parsed.groups || []) {
        if (!group || typeof group !== 'object' || Array.isArray(group)) throw new Error('AI 返回的 groups 每项必须是对象');
        const groupKeys = Object.keys(group);
        const groupExtra = groupKeys.find(key => key !== 'name' && key !== 'members');
        if (groupExtra) throw new Error(`AI 返回的群聊包含额外字段：${groupExtra}`);
        if (typeof group.name !== 'string') throw new Error('AI 返回的群聊 name 必须是字符串');
        if (!Array.isArray(group.members)) throw new Error('AI 返回的群聊 members 必须是数组');
        for (const member of group.members) {
            if (typeof member !== 'string') throw new Error('AI 返回的群聊 members 每项必须是字符串');
        }
    }
    return { contacts: parsed.contacts || [], groups: parsed.groups || [] };
}

export function buildGeneratedDirectoryCandidates(parsed, existingNames, currentUserName) {
    const knownNames = new Set((Array.isArray(existingNames) ? existingNames : [])
        .map(name => String(name || '').trim().toLowerCase()).filter(Boolean));
    const userName = String(currentUserName || '').trim().toLowerCase();
    const contacts = [];
    const groups = [];
    for (const value of parsed.contacts) {
        if (contacts.length + groups.length >= AUTO_GENERATION_BATCH) break;
        const name = value.trim();
        const normalized = name.toLowerCase();
        if (!name || normalized === userName || knownNames.has(normalized)) continue;
        contacts.push(name);
        knownNames.add(normalized);
    }
    for (const group of parsed.groups) {
        if (contacts.length + groups.length >= AUTO_GENERATION_BATCH) break;
        const name = group.name.trim();
        const normalized = name.toLowerCase();
        if (!name || normalized === userName || knownNames.has(normalized)) continue;
        const memberNames = new Set();
        const members = group.members.flatMap(value => {
            const member = value.trim();
            const memberKey = member.toLowerCase();
            if (!member || memberKey === userName || memberNames.has(memberKey)) return [];
            memberNames.add(memberKey);
            return [member];
        });
        if (members.length < 2) continue;
        groups.push({ name, members });
        knownNames.add(normalized);
    }
    if (!contacts.length && !groups.length) throw new Error('AI 未返回可添加的联系人或群聊');
    return { contacts, groups };
}

const clone = value => JSON.parse(JSON.stringify(value));
const sameState = (left, right) => JSON.stringify(left) === JSON.stringify(right);

function directoryUnchanged(revision, histories, groupMeta, getRevision) {
    const current = getRevision();
    return current.histories === revision.histories
        && current.groupMeta === revision.groupMeta
        && sameState(window.__pmHistories || {}, histories)
        && sameState(window.__pmGroupMeta || {}, groupMeta);
}

export async function commitGeneratedDirectory({
    id, candidates, isActive,
    persistHistories = saveHistoriesStrict,
    persistGroupMeta = saveGroupMeta,
    getRevision = getDirectorySaveRevision,
}) {
    if (typeof isActive !== 'function' || !isActive()) return false;
    const previousHistories = clone(window.__pmHistories || {});
    const previousGroupMeta = clone(window.__pmGroupMeta || {});
    const initialRevision = getRevision();
    const nextHistories = clone(previousHistories);
    const nextGroupMeta = clone(previousGroupMeta);
    if (!nextHistories[id]) nextHistories[id] = {};
    if (!nextGroupMeta[id]) nextGroupMeta[id] = {};
    for (const name of candidates.contacts) nextHistories[id][name] = [];
    for (const { name, members } of candidates.groups) {
        const groupKey = `__group_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
        nextGroupMeta[id][groupKey] = { name, members };
    }

    let historiesAttempted = false;
    let groupsAttempted = false;
    try {
        historiesAttempted = true;
        await persistHistories(nextHistories);
        if (!isActive()) throw new Error('生成已取消');
        if (!directoryUnchanged(initialRevision, previousHistories, previousGroupMeta, getRevision)) {
            throw new Error('联系人目录在生成提交期间已被其他操作修改，请重试');
        }
        groupsAttempted = true;
        const normalizedGroups = await persistGroupMeta(nextGroupMeta);
        if (!isActive()) throw new Error('生成已取消');
        if (!directoryUnchanged(initialRevision, previousHistories, previousGroupMeta, getRevision)) {
            throw new Error('联系人目录在生成提交期间已被其他操作修改，请重试');
        }
        window.__pmHistories = nextHistories;
        window.__pmGroupMeta = normalizedGroups || nextGroupMeta;
        return true;
    } catch (error) {
        const rollbackFailures = [];
        if (groupsAttempted) {
            try { await persistGroupMeta(clone(window.__pmGroupMeta || {})); }
            catch (rollbackError) { rollbackFailures.push(rollbackError); }
        }
        if (historiesAttempted) {
            try { await persistHistories(clone(window.__pmHistories || {})); }
            catch (rollbackError) { rollbackFailures.push(rollbackError); }
        }
        if (rollbackFailures.length) {
            const rollbackError = new AggregateError(rollbackFailures, '联系人生成回滚失败');
            const combined = new Error(`${error.message}；联系人生成回滚失败：${rollbackFailures.map(item => item.message).join('；')}`);
            combined.cause = error;
            combined.rollbackError = rollbackError;
            throw combined;
        }
        throw error;
    }
}

export function shouldReportGeneratedDirectoryError(error, isActive) {
    if (error?.rollbackError) return true;
    const cancelled = error?.name === 'AbortError'
        || /(?:生成|请求|操作)?已取消/.test(String(error?.message || error || ''));
    return !cancelled && isActive;
}

export function installContactGenerator(state, deps) {
    const {
        getStorageId, gatherContext, callAI,
        beginGeneration, isGenerationTaskActive, finishGeneration,
        commitDirectory = commitGeneratedDirectory,
    } = deps;

    window.__pmConfirmAutoGen = () => {
        const id = getStorageId();
        if (!id || id === 'sms_unknown__default') return;
        if (!confirm(`AI 将根据当前剧情信息自动生成一批联系人和群聊（本次最多 ${AUTO_GENERATION_BATCH} 个），直接写入列表，是否继续？`)) return;
        window.__pmAutoGenContacts();
    };

    window.__pmAutoGenContacts = async () => {
        const id = getStorageId();
        if (!id || id === 'sms_unknown__default') return;
        const directory = getDirectoryState(id);
        const task = beginGeneration(id);
        if (!task) return;
        setSpinning(true);
        try {
            const context = await gatherContext(task.context);
            if (!isGenerationTaskActive(task)) return;
            const existingNames = [...directory.contacts, ...directory.groupNames];
            const { systemPrompt, userPrompt } = buildPrompts(context, existingNames);
            const raw = await callAI(systemPrompt, userPrompt, {
                isolated: true, signal: task.signal,
            });
            if (!isGenerationTaskActive(task)) return;
            const parsed = parseGeneratedDirectory(raw);

            // AI 请求期间目录可能被其他操作修改；候选必须基于落盘前的实时状态重新去重。
            const latestDirectory = getDirectoryState(id);
            const candidates = buildGeneratedDirectoryCandidates(
                parsed,
                [...latestDirectory.contacts, ...latestDirectory.groupNames],
                context.userName,
            );
            if (!isGenerationTaskActive(task)) return;
            const committed = await commitDirectory({
                id,
                candidates,
                isActive: () => isGenerationTaskActive(task),
            });
            if (!committed || !isGenerationTaskActive(task)) return;
            // 仅刷新仍然打开的联系人弹窗，避免异步完成后重新打开或污染其他界面。
            if (document.getElementById('pm-autogen-btn')) {
                const resultParts = [];
                if (candidates.contacts.length) resultParts.push(`${candidates.contacts.length} 位联系人`);
                if (candidates.groups.length) resultParts.push(`${candidates.groups.length} 个群聊`);
                await window.__pmShowAddContact(`已添加 ${resultParts.join('、')}`);
            }
        } catch (error) {
            console.error('[phone-mode] __pmAutoGenContacts 异常', error);
            if (shouldReportGeneratedDirectoryError(error, isGenerationTaskActive(task))) {
                alert(`自动生成失败：${generationErrorMessage(error)}`);
            }
        } finally {
            const finishedOwnTask = finishGeneration(task);
            // 旧任务失效后可能已有新任务启动；旧 finally 只能在当前没有新任务时清理 spinner。
            if (finishedOwnTask || !state.generationTask) setSpinning(false);
        }
    };
}
