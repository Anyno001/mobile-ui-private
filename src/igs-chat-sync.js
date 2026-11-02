// 正文聊天块 → 手机私聊/群聊的运行时。由 igs-feed-sync 的同步轮调用（总开关与「同步聊天」都开着时）。
// 自动同步只看最近 N 层聊天楼；手动导入走全部楼层。正在生成回复时整轮推迟，下一次消息事件再补。
import { applyIgsChatSync, chatFloorHashes, indexChatFloors, normalizeChatName, resolveIgsChats } from './igs-chat-core.js';
import { chatFingerprints } from './phone-floor-rollback.js';
import { saveGroupMeta, saveHistoriesStrict } from './storage.js';

const CACHE_LIMIT = 400;

export function installIgsChatSync(state, deps, { globalObject = globalThis } = {}) {
    const hashCache = new WeakMap();
    const collectCache = new Map();
    const seen = new Map(); // storageId → Set<楼层原文哈希>：自动同步只给没处理过的楼追加
    const deferred = new Map(); // storageId → Set<楼层原文哈希>：手机正在回复时推迟的楼，下一轮补上

    // plan：{ manual }（手动导入：全部楼层都追加）、{ full }（打开开关或 IGS 刚就绪：最近 N 层都追加）、{ floors:Set }（自动）。
    async function syncIgsChats(storageId, { chat, userName, selfNames: extraNames = [], plan, config }) {
        const api = resolveIgsChats(globalObject);
        if (!api) return { status: 'outdated' };
        if (!Array.isArray(chat) || !chat.length) return { status: 'ok', added: 0, removed: 0, createdContacts: 0, createdGroups: 0 };
        // 手机记录还没从 IndexedDB 读出来（或读失败）时不写，免得把近乎空的记录整份存回去。
        if (await deps.ensureHistoriesLoaded?.() === false) return { status: 'deferred' };
        if (deps.getStorageId() !== storageId) return { status: 'deferred' };
        const floors = indexChatFloors(chat, hashCache);
        const walkFloors = plan.manual ? floors : config.chatFloors > 0 ? floors.slice(-config.chatFloors) : [];
        const seenSet = seen.get(storageId) || new Set();
        const adding = plan.manual ? null
            : new Set(walkFloors.filter(info => plan.full || (plan.floors?.has(info.floor) && !seenSet.has(info.hash))).map(info => info.hash));
        const carried = deferred.get(storageId);
        if (adding && carried) for (const info of walkFloors) if (carried.has(info.hash)) adding.add(info.hash);
        const defer = () => {
            if (adding) deferred.set(storageId, new Set([...(carried || []), ...adding]));
            return { status: 'deferred' };
        };
        if (state.isGenerating) return defer();
        const collect = info => {
            const cacheKey = `${info.hash}:${userName}`;
            if (!collectCache.has(cacheKey)) {
                if (collectCache.size >= CACHE_LIMIT) collectCache.delete(collectCache.keys().next().value);
                let blocks = [];
                try { blocks = api.collect(info.text, {}); } catch { blocks = []; }
                collectCache.set(cacheKey, Array.isArray(blocks) ? blocks : []);
            }
            return collectCache.get(cacheKey);
        };
        const selfNames = new Set(['{{user}}', '<user>', '我', userName, ...extraNames].map(normalizeChatName).filter(Boolean));
        // 只浅拷贝外层：核心只替换改到的会话与群，不原地改，未改动的会话保持原引用。
        const scope = { histories: { ...(window.__pmHistories?.[storageId] || {}) }, groups: { ...(window.__pmGroupMeta?.[storageId] || {}) } };
        const result = applyIgsChatSync(scope, {
            floors, liveHashes: chatFloorHashes(chat, hashCache), anchors: new Set(chatFingerprints(chat)), window: walkFloors, collect, adding, selfNames, autoCreate: config.autoCreateContacts,
            createGroupKey: () => {
                let key;
                do key = `__group_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`; while (scope.groups[key]);
                return key;
            },
        });
        const markSeen = () => {
            for (const info of walkFloors) if (!adding || adding.has(info.hash)) seenSet.add(info.hash);
            seen.set(storageId, seenSet);
        };
        if (!result.touched.size) { deferred.delete(storageId); markSeen(); return { status: 'ok', ...summaryOf(result) }; }
        if (state.isGenerating || deps.getStorageId() !== storageId) return defer();
        await commit(storageId, scope, result);
        deferred.delete(storageId);
        markSeen();
        return { status: 'ok', ...summaryOf(result) };
    }

    // 只替换改动过的会话与新建的群，其余会话保持原引用（别的写入方可能正拿着它们）。
    async function commit(storageId, scope, result) {
        if (!window.__pmHistories) window.__pmHistories = {};
        if (!window.__pmGroupMeta) window.__pmGroupMeta = {};
        const histories = window.__pmHistories[storageId] || (window.__pmHistories[storageId] = {});
        for (const key of result.touched) if (Array.isArray(scope.histories[key])) histories[key] = scope.histories[key];
        const groupsChanged = result.changedGroups.size > 0;
        if (groupsChanged) {
            const groups = window.__pmGroupMeta[storageId] || (window.__pmGroupMeta[storageId] = {});
            for (const key of result.changedGroups) groups[key] = scope.groups[key];
        }
        // 先换上打开着的会话再存盘：存盘期间用户发消息时，写回的是含导入消息的记录。
        refreshOpen(storageId, result.touched);
        if (groupsChanged) await saveGroupMeta();
        await saveHistoriesStrict();
    }

    // 正在看的会话被导入改动：照删楼回退的做法换上新记录并重画；群成员有新增时一并更新。
    function refreshOpen(storageId, touched) {
        const saveKey = deps.getSaveKey?.();
        if (!state.phoneActive || !saveKey || !touched.has(saveKey) || state.activeStorageId !== storageId) return;
        state.conversationHistory = (window.__pmHistories[storageId]?.[saveKey] || []).slice();
        if (state.isGroupChat) {
            const members = window.__pmGroupMeta[storageId]?.[saveKey]?.members;
            if (Array.isArray(members)) state.groupMembers = members.slice();
        }
        deps.rerenderConversation?.({ keepScroll: true });
    }

    Object.assign(deps, { syncIgsChats });
    return { syncIgsChats };
}

function summaryOf(result) {
    return {
        added: result.added, removed: result.removed,
        createdContacts: result.createdContacts.length, createdGroups: result.createdGroups.length,
    };
}
