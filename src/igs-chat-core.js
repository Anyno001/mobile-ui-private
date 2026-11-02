// 与 gal 前端（IGS）联动：正文里的聊天块 → 手机私聊/群聊。纯函数，只读 IGS.api.chats.collect 的结果。
// 规则见 手机UI预览/接IGS聊天计划.md §4：按标题、上一楼延续、发送者人数决定落到哪个会话；
// 去重键带楼层原文哈希与消息内容哈希；楼层原文没了，用户没改过的导入消息删掉，改过的保留（同直播弹幕）。
import { createMessageEntry, describeMessageEntry } from './chat-message-model.js';
import { DEFAULT_CHAT_FLOORS, MAX_CHAT_FLOORS, hashText, normalizeChatFloors, parseIgsKey } from './igs-feed-core.js';
import { messageFingerprint } from './phone-floor-rollback.js';

export { DEFAULT_CHAT_FLOORS, MAX_CHAT_FLOORS, normalizeChatFloors };

export const IGS_CHAT_MIN_VERSION = 1;
const CHAT_MARKER = '[igs-msg:';
const SKIP_TYPES = new Set(['typing', '输入中', '正在输入', 'recall', 'revoke', '撤回']);
const SPECIAL_TYPES = Object.freeze([
    [['image', 'img', 'photo', '图片', '照片'], '图片'],
    [['voice', 'audio', '语音'], '语音'],
    [['transfer', '转账', '红包', 'redpacket', 'hongbao'], '转账'],
]);
// 会话按名字作键：这几个名字作键会碰到对象原型，跳过。
const RESERVED_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const BRACKETS_RE = /^[\s【\[(（《<「『]+|[\s】\])）》>」』]+$/g;

export const normalizeChatName = value => String(value ?? '').trim().replace(BRACKETS_RE, '').trim().toLowerCase();
const clip = (value, max) => Array.from(String(value ?? '').trim()).slice(0, max).join('');

export function resolveIgsChats(globalObject) {
    let chats = null;
    try { chats = globalObject?.IGS?.api?.chats || null; } catch { chats = null; }
    if (!chats) return null;
    return Number.isInteger(Number(chats.version)) && Number(chats.version) >= IGS_CHAT_MIN_VERSION && typeof chats.collect === 'function' ? chats : null;
}

// 有聊天消息的 AI 楼：[{ floor, hash, text, anchor }]。hashCache（WeakMap）按消息对象缓存原文哈希。
export function indexChatFloors(chat, hashCache = null) {
    const floors = [];
    (Array.isArray(chat) ? chat : []).forEach((message, floor) => {
        if (!message || message.is_user === true || message.is_system === true || typeof message.mes !== 'string') return;
        if (!message.mes.includes(CHAT_MARKER)) return;
        const cached = hashCache?.get(message);
        const hash = cached && cached.text === message.mes ? cached.hash : hashText(message.mes);
        if (hashCache && (!cached || cached.text !== message.mes)) hashCache.set(message, { text: message.mes, hash });
        floors.push({ floor, hash, text: message.mes, anchor: messageFingerprint(message) });
    });
    return floors;
}

// 当前聊天里还在的聊天楼原文哈希，含被 /hide 隐藏的楼（隐藏不等于删掉，导入的消息不能因此被删）。
export function chatFloorHashes(chat, hashCache = null) {
    const hashes = new Set();
    for (const message of Array.isArray(chat) ? chat : []) {
        if (!message || message.is_user === true || typeof message.mes !== 'string' || !message.mes.includes(CHAT_MARKER)) continue;
        const cached = hashCache?.get(message);
        hashes.add(cached && cached.text === message.mes ? cached.hash : hashText(message.mes));
    }
    return hashes;
}

// IGS 消息 → 天音消息文字；不存的返回空串。图片、语音、转账拼成天音认的「（图片：…）」格式。
export function chatMessageText(message) {
    const text = clip(message?.text, 2000);
    const type = String(message?.type || '').trim().toLowerCase();
    if (SKIP_TYPES.has(type)) return '';
    const special = SPECIAL_TYPES.find(([aliases]) => aliases.includes(type));
    if (special) return text ? `（${special[1]}：${text}）` : '';
    return text;
}

function storyDateOf(text) {
    const match = /(\d{4})\s*[-/.年]\s*(\d{1,2})\s*[-/.月]\s*(\d{1,2})/.exec(String(text || ''));
    return match ? `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}` : '';
}

// 排序键：导入消息按（楼层标记, 块内序号）；手机里自己发的同层消息排在导入消息之后；没有楼层标记的旧消息最前。
function sortKeyOf(entry) {
    const floor = Number.isSafeInteger(entry?.floor) ? entry.floor : -1;
    const parsed = entry?.source?.type === 'igs' ? parseIgsKey(entry.source.key) : null;
    return parsed ? [floor, 0, parsed.offset] : [floor, 1, 0];
}
const compareKeys = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];

function insertEntry(history, entry, now) {
    const key = sortKeyOf(entry);
    let at = history.findIndex(item => compareKeys(sortKeyOf(item), key) > 0);
    if (at < 0) at = history.length;
    const prev = history[at - 1];
    const next = history[at];
    entry.sentAt = Number.isFinite(prev?.sentAt) ? prev.sentAt + 1 : Number.isFinite(next?.sentAt) ? next.sentAt - 1 : now;
    history.splice(at, 0, entry);
}

function findGroup(groups, { name, members }) {
    const target = normalizeChatName(name);
    const entries = Object.entries(groups);
    if (target) {
        const byName = entries.find(([, meta]) => normalizeChatName(meta?.name) === target);
        if (byName) return byName[0];
    }
    if (!members) return '';
    const wanted = [...members].sort().join('\u0000');
    const byMembers = entries.find(([, meta]) => (Array.isArray(meta?.members) ? meta.members : [])
        .map(normalizeChatName).sort().join('\u0000') === wanted);
    return byMembers ? byMembers[0] : '';
}

// 一个块落到哪个会话。返回 { key, isGroup, create?: { name, members } } 或 null（跳过）。
// lastRoute：上一块落到的群，用于「标题空、这一楼群里只有一个人说话」时延续。
export function routeChatBlock(block, { histories, groups, selfNames, lastRoute = null }) {
    const others = new Map();
    for (const message of block.messages) {
        if (message.kind !== 'msg' || message.system || !chatMessageText(message)) continue;
        if (selfNames.has(normalizeChatName(message.sender))) continue;
        const name = clip(message.sender, 20);
        const normalized = normalizeChatName(name);
        if (normalized && !RESERVED_KEYS.has(name) && !others.has(normalized)) others.set(normalized, name);
    }
    if (!others.size) return null;
    const title = clip(block.title, 80);
    const byTitle = title ? findGroup(groups, { name: title }) : '';
    if (byTitle) return { key: byTitle, isGroup: true };
    if (!title && others.size === 1 && lastRoute?.isGroup) {
        const members = new Set((groups[lastRoute.key]?.members || lastRoute.create?.members || []).map(normalizeChatName));
        if (members.has([...others.keys()][0])) return lastRoute;
    }
    if (others.size === 1) {
        const [normalized, name] = [...others][0];
        const key = Object.keys(histories).find(item => !item.startsWith('__group_') && normalizeChatName(item) === normalized);
        return key ? { key, isGroup: false } : { key: name, isGroup: false, create: { name } };
    }
    const names = [...others.values()];
    const groupName = title || names.join('、');
    const existing = findGroup(groups, { name: groupName, members: new Set(others.keys()) });
    return existing ? { key: existing, isGroup: true } : { key: '', isGroup: true, create: { name: groupName, members: names } };
}

// 对账：只替换改到的会话数组与群对象，传入的数组和群原样不动（调用方浅拷贝外层即可，不用整份深拷贝）。
// 1. 来源楼本身已不在当前聊天里（删楼、重新生成、滑动换掉）的导入消息：用户没改过的删掉，改过的保留。
//    来源楼还在、只是正文被改写（插件回写、编辑）时导入的消息照常保留：导入后就是手机自己的记录。
// 2. adding 里的楼（null 为全部）：按楼层顺序走块，补上还没有的消息；会话不存在时按 autoCreate 新建。
// floors 为当前聊天全部聊天楼（indexChatFloors），window 为本轮要走的楼（最近 N 层或全部）；
// anchors 为当前聊天全部楼的 messageFingerprint，缺省按 floors 取。
export function applyIgsChatSync(scope, { floors, liveHashes = null, anchors = null, window = floors, collect, adding = null, selfNames, autoCreate = true, now = Date.now(), createGroupKey }) {
    const result = { added: 0, removed: 0, touched: new Set(), changedGroups: new Set(), createdContacts: [], createdGroups: [] };
    const histories = scope.histories;
    const groups = scope.groups;
    // 本轮已换成副本的会话与群：同一个只复制一次。
    const owned = new Set();
    const ownHistory = key => {
        if (!owned.has(key)) { histories[key] = Array.isArray(histories[key]) ? histories[key].slice() : []; owned.add(key); }
        return histories[key];
    };
    const ownGroup = key => {
        if (!result.changedGroups.has(key)) { groups[key] = { ...groups[key], members: [...(groups[key]?.members || [])] }; result.changedGroups.add(key); }
        return groups[key];
    };
    const live = liveHashes || new Set(floors.map(info => info.hash));
    const liveAnchors = anchors || new Set(floors.map(info => info.anchor));
    const existing = new Set();
    const remember = (entry, parsed) => {
        existing.add(entry.source.key);
        const anchor = sourceAnchorOf(entry);
        if (anchor) existing.add(anchorKeyOf(anchor, parsed.offset, parsed.signature));
    };
    for (const [key, history] of Object.entries(histories)) {
        if (!Array.isArray(history)) continue;
        let drop = null;
        history.forEach((entry, index) => {
            const parsed = entry?.source?.type === 'igs' ? parseIgsKey(entry.source.key) : null;
            if (!parsed) return;
            // 主线一个聊天楼都没有（新聊天、切换途中）、原文还在、来源楼还在或无从判断：都保留。
            const anchor = sourceAnchorOf(entry);
            const gone = live.size && !live.has(parsed.hash) && anchor && !liveAnchors.has(anchor);
            if (gone && hashText(entry.content) === parsed.signature) (drop || (drop = new Set())).add(index);
            else remember(entry, parsed);
        });
        if (drop) {
            histories[key] = history.filter((_, index) => !drop.has(index));
            owned.add(key);
            result.removed += drop.size;
            result.touched.add(key);
        }
    }
    let lastRoute = null;
    // 上一块落到的会话（私聊或群）。只有 User 自己发言的块（旁白把一段聊天拆开时常见）没有对方可认，
    // 跟同一楼后面第一个能落地的块走；后面没有，跟这个走。
    let lastPlaced = null;
    for (const info of window) {
        const blocks = collect(info);
        if (!Array.isArray(blocks)) continue;
        const writable = !adding || adding.has(info.hash);
        let selfOnly = [];
        for (const block of blocks) {
            if (!block || !Array.isArray(block.messages)) continue;
            const route = routeChatBlock(block, { histories, groups, selfNames, lastRoute });
            if (!route) {
                if (hasSelfMessage(block, selfNames)) selfOnly.push(block);
                continue;
            }
            lastRoute = route.isGroup ? route : null;
            lastPlaced = route;
            if (!writable) { selfOnly = []; continue; }
            place(block, info, route);
            for (const pending of selfOnly) place(pending, info, route);
            selfOnly = [];
        }
        if (writable && lastPlaced) for (const pending of selfOnly) place(pending, info, lastPlaced);
    }
    return result;

    function place(block, info, route) {
        const fresh = freshEntries(block, info, existing, selfNames, route.isGroup);
        if (!fresh.length) return;
        if (route.create && !autoCreate) return;
        if (route.create) {
            if (route.isGroup) {
                route.key = createGroupKey();
                groups[route.key] = { name: route.create.name, members: [...route.create.members] };
                result.changedGroups.add(route.key);
                result.createdGroups.push(route.key);
            } else {
                histories[route.key] = [];
                owned.add(route.key);
                result.createdContacts.push(route.key);
            }
            delete route.create;
        }
        if (route.isGroup) {
            const missing = missingMembers(groups[route.key], fresh.map(item => item.sender).filter(Boolean));
            if (missing.length) ownGroup(route.key).members.push(...missing);
        }
        const history = ownHistory(route.key);
        const members = route.isGroup ? groups[route.key].members : [];
        for (const item of fresh) {
            const entry = buildEntry(item, info, route.isGroup, members);
            insertEntry(history, entry, now);
            existing.add(item.key);
            result.added += 1;
        }
        result.touched.add(route.key);
    }
}

// 块里有 User 自己发的、能存的消息。
function hasSelfMessage(block, selfNames) {
    return block.messages.some(message => message.kind === 'msg' && !message.system && chatMessageText(message)
        && selfNames.has(normalizeChatName(message.sender)));
}

// 群里还没有的发送者（不计大小写、括号），按出现顺序去重。
function missingMembers(meta, senders) {
    const known = new Set((Array.isArray(meta?.members) ? meta.members : []).map(normalizeChatName));
    const missing = [];
    for (const name of senders) {
        const normalized = normalizeChatName(name);
        if (normalized && !known.has(normalized)) { missing.push(name); known.add(normalized); }
    }
    return missing;
}

// 块里还没导入过的消息：[{ key, role, sender, content, storyDate }]。序号 = 块序号 × 1000 + 消息序号，排序与去重共用；
// 签名是存进记录的 content 的哈希，删楼时据此判断用户有没有改过。群聊里对方的消息写成「发送者：内容」。
function freshEntries(block, info, existing, selfNames, isGroup) {
    const items = [];
    let storyDate = '';
    block.messages.forEach((message, index) => {
        if (message.kind === 'time') { storyDate = storyDateOf(message.text) || storyDate; return; }
        if (message.kind !== 'msg' || message.system) return;
        const text = chatMessageText(message);
        if (!text) return;
        const self = selfNames.has(normalizeChatName(message.sender));
        const sender = self ? '' : clip(message.sender, 20);
        if (RESERVED_KEYS.has(sender)) return;
        const content = isGroup && !self ? `${sender}：${text}` : text;
        const offset = (Number(block.index) || 0) * 1000 + index;
        const signature = hashText(content);
        const key = `igs:${info.hash}:${offset}:${signature}`;
        // 来源楼正文被改写后哈希变了：同一楼、同一位置、同样内容的消息已导入过，不再重复导入。
        if (existing.has(key) || (info.anchor && existing.has(anchorKeyOf(info.anchor, offset, signature)))) return;
        items.push({ key, role: self ? 'user' : 'assistant', sender, content, storyDate });
    });
    return items;
}

// 导入的消息：楼层标记记来源楼（发送时主线长度 = 楼号 + 1，锚点是来源楼本身），删楼回退据此判断。
function buildEntry(item, info, isGroup, members) {
    const probe = { role: item.role, content: item.content };
    const descriptors = describeMessageEntry(probe, { isGroup, groupMembers: members });
    const entry = createMessageEntry({ role: item.role, content: item.content, descriptors, ...(item.storyDate ? { storyDate: item.storyDate } : {}) });
    entry.floor = info.floor + 1;
    entry.floorAnchor = info.anchor;
    entry.source = { type: 'igs', floor: info.floor, key: item.key, ...(info.anchor ? { anchor: info.anchor } : {}) };
    return entry;
}

// 来源楼标识：source.anchor 导入时写定、删楼回退不会改；旧记录没有时退回 floorAnchor。
const sourceAnchorOf = entry => (typeof entry?.source?.anchor === 'string' && entry.source.anchor)
    || (typeof entry?.floorAnchor === 'string' ? entry.floorAnchor : '');
const anchorKeyOf = (anchor, offset, signature) => `${anchor}\u0000${offset}\u0000${signature}`;

export function summarizeChats(result) {
    if (result?.status === 'deferred') return '聊天稍后同步（手机正在回复或记录未读完）';
    if (!result || result.status !== 'ok') return '';
    return [
        result.added && `聊天 ${result.added} 条`, result.removed && `移除聊天 ${result.removed} 条`,
        result.createdContacts && `新联系人 ${result.createdContacts} 个`, result.createdGroups && `新群聊 ${result.createdGroups} 个`,
    ].filter(Boolean).join('，');
}
