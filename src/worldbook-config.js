export const WORLD_BOOK_CONFIG_VERSION = 1;
export const WORLD_BOOK_MODULES = Object.freeze(['chat', 'calendar', 'community']);

const MAX_KEY_LENGTH = 240;
const MAX_COLUMN_LENGTH = 120;
const plainObject = value => value && typeof value === 'object' && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null) ? value : {};
const cleanText = (value, max) => typeof value === 'string' ? value.trim().slice(0, max) : '';
const boundedInteger = (value, fallback, min, max) => {
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(min, Math.min(max, Math.trunc(number))) : fallback;
};
const setOwn = (target, key, value) => Object.defineProperty(target, key, {
    value, enumerable: true, configurable: true, writable: true,
});

export function createWorldBookEntryKey(bookName, uid) {
    const book = cleanText(bookName, 120);
    const id = typeof uid === 'number' || typeof uid === 'string' ? String(uid).trim() : '';
    return book && id && id.length <= 80 ? `${encodeURIComponent(book)}:${encodeURIComponent(id)}` : '';
}

function normalizeSwitches(value) {
    const result = {};
    for (const [key, enabled] of Object.entries(plainObject(value))) {
        const cleanKey = cleanText(key, MAX_KEY_LENGTH);
        if (cleanKey && typeof enabled === 'boolean') setOwn(result, cleanKey, enabled);
    }
    return result;
}

function activeBookNames(value, target) {
    const values = Array.isArray(value) ? value : [value];
    for (const candidate of values) {
        const name = cleanText(candidate, 120);
        if (name) target.add(name);
    }
}

export function getEnabledWorldBookNames(context) {
    const names = new Set();
    const globalSelector = globalThis.document?.getElementById?.('world_info');
    const metadata = plainObject(context?.chatMetadata || context?.chat_metadata);
    const character = context?.characters?.[context?.characterId];
    if (globalSelector?.selectedOptions) activeBookNames([...globalSelector.selectedOptions].map(option => option.textContent || option.label), names);
    activeBookNames(metadata.world_info, names);
    activeBookNames(character?.data?.extensions?.world, names);
    return names;
}

export function hasWorldBookSelectionSource(context) {
    const character = context?.characters?.[context?.characterId];
    const globalSelector = globalThis.document?.getElementById?.('world_info');
    return Boolean(globalSelector?.selectedOptions || context?.chatMetadata?.world_info || context?.chat_metadata?.world_info || character?.data?.extensions?.world);
}

function normalizeColumnModes(value) {
    const result = {};
    for (const [column, modes] of Object.entries(plainObject(value))) {
        const cleanColumn = cleanText(column, MAX_COLUMN_LENGTH);
        if (!cleanColumn) continue;
        const normalized = {};
        for (const module of WORLD_BOOK_MODULES) {
            if (typeof plainObject(modes)[module] === 'boolean') normalized[module] = plainObject(modes)[module];
        }
        if (Object.keys(normalized).length) setOwn(result, cleanColumn, normalized);
    }
    return result;
}

function normalizeOverride(value, { group = false } = {}) {
    const source = plainObject(value);
    return {
        entries: normalizeSwitches(source.entries),
        columns: normalizeColumnModes(source.columns),
        ...(group ? { allowMemberPrivateMemory: source.allowMemberPrivateMemory === true } : {}),
    };
}

function normalizeOverrides(value, options) {
    const result = {};
    for (const [scopeId, override] of Object.entries(plainObject(value))) {
        const cleanScopeId = cleanText(scopeId, MAX_KEY_LENGTH);
        if (!cleanScopeId) continue;
        const normalized = normalizeOverride(override, options);
        if (Object.keys(normalized.entries).length || Object.keys(normalized.columns).length || normalized.allowMemberPrivateMemory) {
            setOwn(result, cleanScopeId, normalized);
        }
    }
    return result;
}

export function createDefaultWorldBookConfig() {
    return { version: WORLD_BOOK_CONFIG_VERSION, books: {}, entries: {}, columns: {}, characters: {}, groups: {},
        mainChatMessages: 8, scanMessages: 2, maxChars: 24000 };
}

export function normalizeWorldBookConfig(value) {
    const source = plainObject(value);
    const defaults = createDefaultWorldBookConfig();
    return { version: WORLD_BOOK_CONFIG_VERSION, books: normalizeSwitches(source.books), entries: normalizeSwitches(source.entries),
        columns: normalizeColumnModes(source.columns), characters: normalizeOverrides(source.characters),
        groups: normalizeOverrides(source.groups, { group: true }),
        mainChatMessages: boundedInteger(source.mainChatMessages, defaults.mainChatMessages, 1, 100),
        scanMessages: boundedInteger(source.scanMessages, defaults.scanMessages, 1, 100),
        maxChars: boundedInteger(source.maxChars, defaults.maxChars, 1000, 80000) };
}

// TavernDB-ACU exports encode their column in a producer-owned comment grammar.
// This is intentionally strict: arbitrary titles and content never become a column.
export function getTavernDbColumn(comment) {
    const value = cleanText(comment, 240);
    const customExport = /^TavernDB-ACU-CustomExport-([^\n-]+)(?:-|$)/.exec(value);
    if (customExport) return cleanText(customExport[1], MAX_COLUMN_LENGTH);
    const dataTable = /^TavernDB-ACU-([^\n-]+)(?:-|$)/.exec(value);
    return dataTable ? cleanText(dataTable[1], MAX_COLUMN_LENGTH) : '';
}

function scopeOverride(config, scope) {
    if (scope?.kind === 'group') return config.groups[cleanText(scope.id, MAX_KEY_LENGTH)] || null;
    if (scope?.kind === 'character') return config.characters[cleanText(scope.id, MAX_KEY_LENGTH)] || null;
    return null;
}

export function isWorldBookEntryAllowed(config, entry, { module, scope = null } = {}) {
    if (!WORLD_BOOK_MODULES.includes(module)) return false;
    const current = normalizeWorldBookConfig(config);
    const entryKey = createWorldBookEntryKey(entry?.bookName, entry?.uid);
    if (!entryKey) return false;
    const column = cleanText(entry?.column, MAX_COLUMN_LENGTH);
    const bookName = cleanText(entry?.bookName, 120);
    if (!bookName || current.books[bookName] === false) return false;
    const override = scopeOverride(current, scope);
    const entrySetting = override?.entries?.[entryKey] ?? current.entries[entryKey];
    if (entrySetting === false) return false;
    const columnSetting = override?.columns?.[column]?.[module] ?? current.columns[column]?.[module];
    return columnSetting !== false;
}

export function isMemberPrivateWorldBookEntryAllowed(config, entry, memberId) {
    const current = normalizeWorldBookConfig(config);
    const column = cleanText(entry?.column, MAX_COLUMN_LENGTH);
    if (!column) return false;
    const member = current.characters[cleanText(memberId, MAX_KEY_LENGTH)];
    // An absent character override means “follow global” for private chat, not “export it to a group”.
    return member?.columns?.[column]?.chat === true
        && isWorldBookEntryAllowed(current, entry, { module: 'chat', scope: { kind: 'character', id: memberId } });
}
