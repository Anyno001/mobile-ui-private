import { getReadableWorldBookNames, getTavernDbColumn, isMemberPrivateWorldBookEntryAllowed, isWorldBookEntryAllowed, normalizeWorldBookConfig, WORLD_BOOK_MODULES } from './worldbook-config.js';

const text = value => typeof value === 'string' ? value : '';
const visibleText = value => text(value)
    .replace(/```[\s\S]*?(?:```|$)/g, '')
    .replace(/<think\b[^>]*>[\s\S]*?(?:<\/think\s*>|$)/gi, '')
    .replace(/<[^>]+>/g, '')
    .trim();
const isAbortError = error => error?.name === 'AbortError';
const entryOrder = entry => {
    const value = entry.displayIndex ?? entry.extensions?.display_index ?? entry.order ?? entry.insertion_order ?? entry.uid;
    return Number.isFinite(Number(value)) ? Number(value) : Number.MAX_SAFE_INTEGER;
};

function scanMatches(entry, messages) {
    if (entry.constant === true) return true;
    const keys = Array.isArray(entry.key) ? entry.key : Array.isArray(entry.keys) ? entry.keys : [];
    if (!keys.length) return false;
    const haystack = messages.join('\n').toLocaleLowerCase();
    return keys.some(key => text(key).trim() && haystack.includes(text(key).trim().toLocaleLowerCase()));
}

function normalizeBookEntries(bookName, book) {
    const entries = book && typeof book === 'object' && !Array.isArray(book) ? book.entries : null;
    const pairs = Array.isArray(entries)
        ? entries.map((value, index) => [index, value])
        : entries && typeof entries === 'object' ? Object.entries(entries) : [];
    return pairs.flatMap(([fallbackUid, value]) => {
        if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
        const uid = value.uid ?? value.id ?? fallbackUid;
        const content = text(value.content);
        const comment = text(value.comment);
        const column = getTavernDbColumn(comment);
        const hostDisabled = value.disable === true || value.enabled === false;
        if ((typeof uid !== 'number' && typeof uid !== 'string') || !String(uid).trim() || !content || (hostDisabled && !column)) return [];
        return [{ bookName, uid, content, comment, column,
            constant: value.constant === true, key: value.key ?? value.keys, order: entryOrder(value) }];
    }).sort((left, right) => left.order - right.order || String(left.uid).localeCompare(String(right.uid)));
}

function contextScope(context) {
    const groupId = String(context?.groupId ?? '').trim();
    if (groupId) return { kind: 'group', id: groupId };
    const character = context?.characters?.[context?.characterId];
    const characterId = text(character?.avatar) || String(context?.characterId ?? '').trim();
    return characterId ? { kind: 'character', id: characterId } : null;
}

function throwIfAborted(signal) {
    if (!signal?.aborted) return;
    const error = new Error('请求已取消');
    error.name = 'AbortError';
    throw error;
}

export async function buildWorldBookContext(context, {
    module, config = globalThis.window?.__pmWorldBookConfig, signal, scope: requestedScope = null, memberIds = [], maxChars, worldBookOptions = {}, bookNames = null, activationMode = 'chat',
} = {}) {
    const current = normalizeWorldBookConfig(config);
    if (!WORLD_BOOK_MODULES.includes(module)) return '';
    if (typeof context?.loadWorldInfo !== 'function') return '';
    if (!['chat', 'selected'].includes(activationMode)) throw new TypeError('世界书激活模式无效');
    if (activationMode === 'selected' && (!Array.isArray(bookNames) || !bookNames.some(name => text(name).trim()))) {
        throw new TypeError('独立世界书读取必须显式指定书籍');
    }
    throwIfAborted(signal);
    const requestedNames = Array.isArray(bookNames)
        ? new Set(bookNames.map(name => text(name).trim()).filter(Boolean)) : null;
    const selectedNames = getReadableWorldBookNames(context, current, worldBookOptions)
        .filter(name => !requestedNames || requestedNames.has(name));
    if (!selectedNames.length) return '';
    const requestedMaxChars = Number(maxChars);
    const outputMaxChars = Number.isFinite(requestedMaxChars) && requestedMaxChars > 0
        ? Math.min(current.maxChars, Math.trunc(requestedMaxChars)) : current.maxChars;
    const messages = (Array.isArray(context.chat) ? context.chat : [])
        .slice(-current.scanMessages).map(message => visibleText(message?.mes));
    const scope = requestedScope?.kind === 'group' || requestedScope?.kind === 'character' || requestedScope?.kind === 'public'
        ? requestedScope : contextScope(context);
    const groupMemberIds = scope?.kind === 'group'
        ? [...new Set(memberIds.map(memberId => text(memberId).trim()).filter(Boolean))] : [];
    const privateMemberIds = current.groups[scope?.id]?.allowMemberPrivateMemory === true ? groupMemberIds : [];
    let length = 0;
    const contents = [];
    const appendContent = (entry, privateMemberId = '') => {
        const content = privateMemberId
            ? `【成员私有记忆：仅${privateMemberId}知晓，不得让其他成员知晓、转述或据此发言】\n${entry.content}`
            : entry.content;
        const nextLength = length + content.length + (contents.length ? 2 : 0);
        if (nextLength > outputMaxChars) return false;
        contents.push(content);
        length = nextLength;
        return true;
    };
    for (const rawName of selectedNames) {
        throwIfAborted(signal);
        const bookName = text(rawName).trim();
        if (!bookName) continue;
        let book;
        try { book = await context.loadWorldInfo(bookName); } catch (error) {
            if (signal?.aborted) throwIfAborted(signal);
            if (isAbortError(error)) throw error;
            continue;
        }
        throwIfAborted(signal);
        for (const entry of normalizeBookEntries(bookName, book)) {
            throwIfAborted(signal);
            if (activationMode === 'chat' && !scanMatches(entry, messages)) continue;
            const memberPrivate = scope?.kind === 'group'
                && groupMemberIds.some(memberId => isMemberPrivateWorldBookEntryAllowed(current, entry, memberId));
            const groupExplicitlyAllowsColumn = scope?.kind === 'group'
                && current.groups[scope.id]?.columns?.[entry.column]?.[module] === true;
            if (isWorldBookEntryAllowed(current, entry, { module, scope })
                && (!memberPrivate || groupExplicitlyAllowsColumn)) {
                appendContent(entry);
                continue;
            }
            for (const memberId of privateMemberIds) {
                if (isMemberPrivateWorldBookEntryAllowed(current, entry, memberId)) {
                    appendContent(entry, memberId);
                }
            }
        }
    }
    return contents.join('\n\n');
}
