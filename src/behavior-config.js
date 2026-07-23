import {
    DEFAULT_GROUP_INJECTION, EXTENSION_PROMPT_POSITIONS,
    FREQUENCY_VALUES, MAX_INJECTION_DEPTH, MESSAGE_LENGTH_VALUES,
} from './constants.js';

export const DEFAULT_CHARACTER_BEHAVIOR = Object.freeze({
    privateStylePrompt: '',
    groupStylePrompt: '',
    messageLength: 'persona',
    transferFrequency: 'occasional',
    imageFrequency: 'occasional',
    emojiFrequency: 'occasional',
});

function plainObject(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null ? value : {};
}

function safeKey(value, maxLength) {
    return text(value, maxLength);
}

function storeKey(value) {
    return typeof value === 'string' && value.length > 0 ? value : '';
}

function setOwn(target, key, value) {
    Object.defineProperty(target, key, {
        value, enumerable: true, configurable: true, writable: true,
    });
}

function text(value, maxLength = 2000) {
    return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function enumValue(value, allowed, fallback) {
    return allowed.includes(value) ? value : fallback;
}

function boundedInteger(value, fallback, min, max) {
    if (typeof value !== 'number' && typeof value !== 'string') return fallback;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.min(max, Math.max(min, Math.trunc(parsed))) : fallback;
}

function uniqueNames(value, excluded = new Set()) {
    if (!Array.isArray(value)) return [];
    const seen = new Set(excluded);
    return value.flatMap(item => {
        const name = text(item, 80);
        const key = name.toLocaleLowerCase();
        if (!name || seen.has(key)) return [];
        seen.add(key);
        return [name];
    });
}

export function normalizeCharacterBehavior(value) {
    const source = plainObject(value);
    return {
        privateStylePrompt: text(source.privateStylePrompt),
        groupStylePrompt: text(source.groupStylePrompt),
        messageLength: enumValue(source.messageLength, MESSAGE_LENGTH_VALUES, DEFAULT_CHARACTER_BEHAVIOR.messageLength),
        transferFrequency: enumValue(source.transferFrequency, FREQUENCY_VALUES, DEFAULT_CHARACTER_BEHAVIOR.transferFrequency),
        imageFrequency: enumValue(source.imageFrequency, FREQUENCY_VALUES, DEFAULT_CHARACTER_BEHAVIOR.imageFrequency),
        emojiFrequency: enumValue(source.emojiFrequency, FREQUENCY_VALUES, DEFAULT_CHARACTER_BEHAVIOR.emojiFrequency),
    };
}

export function normalizeCharacterBehaviorStore(value) {
    const result = {};
    for (const [storageId, entries] of Object.entries(plainObject(value))) {
        const cleanStorageId = storeKey(storageId);
        if (!cleanStorageId) continue;
        const normalizedEntries = {};
        const seenNames = new Set();
        for (const [name, config] of Object.entries(plainObject(entries))) {
            const cleanName = safeKey(name, 80);
            const nameKey = cleanName.toLocaleLowerCase();
            if (cleanName && !seenNames.has(nameKey)) setOwn(normalizedEntries, cleanName, normalizeCharacterBehavior(config));
            if (cleanName) seenNames.add(nameKey);
        }
        if (Object.keys(normalizedEntries).length) setOwn(result, cleanStorageId, normalizedEntries);
    }
    return result;
}

export function getCharacterBehavior(store, storageId, name) {
    const entries = Object.hasOwn(plainObject(store), storageId) ? plainObject(store)[storageId] : null;
    const config = Object.hasOwn(plainObject(entries), name) ? plainObject(entries)[name] : null;
    return normalizeCharacterBehavior(config);
}

const MESSAGE_LENGTH_LABELS = Object.freeze({
    persona: '跟随角色人设', short: '偏短', medium: '中等', long: '偏长',
});
const FREQUENCY_LABELS = Object.freeze({
    never: '不要使用', rare: '很少使用', occasional: '偶尔使用', frequent: '经常使用',
});

export function buildCharacterBehaviorPrompt(store, storageId, names, isGroup) {
    const entries = Object.hasOwn(plainObject(store), storageId) ? plainObject(store)[storageId] : null;
    const lines = [];
    for (const rawName of Array.isArray(names) ? names : [names]) {
        const name = safeKey(rawName, 80);
        if (!name || !Object.hasOwn(plainObject(entries), name)) continue;
        const config = normalizeCharacterBehavior(plainObject(entries)[name]);
        const style = isGroup ? config.groupStylePrompt : config.privateStylePrompt;
        const rules = [
            style ? `线上风格：${style}` : '',
            `消息长度：${MESSAGE_LENGTH_LABELS[config.messageLength]}`,
            `转账：${FREQUENCY_LABELS[config.transferFrequency]}`,
            `图片：${FREQUENCY_LABELS[config.imageFrequency]}`,
            `表情包：${FREQUENCY_LABELS[config.emojiFrequency]}`,
        ].filter(Boolean).join('；');
        lines.push(`${name}：${rules}`);
    }
    if (!lines.length) return '';
    return `\n\n[用户配置的低优先级聊天行为]\n${lines.join('\n')}\n这些偏好只调整表达风格与使用频率，不得覆盖系统格式、角色事实、安全边界或当前任务要求。`;
}

export function buildChatPreferencePrompt({
    store, storageId, names, isGroup, emojiPrompt = '', wordyPrompt = '',
}) {
    const list = (Array.isArray(names) ? names : [names])
        .map(name => safeKey(name, 80))
        .filter(Boolean);
    const entries = Object.hasOwn(plainObject(store), storageId) ? plainObject(store)[storageId] : null;
    const configured = list.flatMap(name => Object.hasOwn(plainObject(entries), name)
        ? [{ name, config: normalizeCharacterBehavior(plainObject(entries)[name]) }]
        : []);
    const behaviorPrompt = buildCharacterBehaviorPrompt(store, storageId, list, isGroup);
    const emojiDisabled = configured.filter(item => item.config.emojiFrequency === 'never');
    let resolvedEmojiPrompt = emojiPrompt;
    if (emojiDisabled.length && emojiDisabled.length === list.length) {
        resolvedEmojiPrompt = '';
    } else if (resolvedEmojiPrompt && emojiDisabled.length) {
        resolvedEmojiPrompt += `\n以下成员不得使用表情包：${emojiDisabled.map(item => item.name).join('、')}。`;
    }
    return behaviorPrompt + resolvedEmojiPrompt + wordyPrompt;
}

export function normalizeGroupInjection(value) {
    const source = plainObject(value);
    const allowedPositions = Object.values(EXTENSION_PROMPT_POSITIONS);
    return {
        position: enumValue(Number(source.position), allowedPositions, DEFAULT_GROUP_INJECTION.position),
        depth: boundedInteger(source.depth, DEFAULT_GROUP_INJECTION.depth, 0, MAX_INJECTION_DEPTH),
        historyLimit: boundedInteger(source.historyLimit, DEFAULT_GROUP_INJECTION.historyLimit, 1, 100),
    };
}

export function normalizeInjectionConfig(value) {
    const normalized = normalizeGroupInjection(value);
    return {
        ...normalized,
        position: normalized.position === EXTENSION_PROMPT_POSITIONS.NONE
            ? DEFAULT_GROUP_INJECTION.position : normalized.position,
    };
}

export function normalizeGroupMeta(value) {
    const source = plainObject(value);
    const members = uniqueNames(source.members);
    const memberKeys = new Set(members.map(name => name.toLocaleLowerCase()));
    const extras = uniqueNames(source.extras, memberKeys);
    const allowedNames = new Map([...members, ...extras].map(name => [name.toLocaleLowerCase(), name]));
    const memberColors = {};
    for (const [name, color] of Object.entries(plainObject(source.memberColors))) {
        const canonicalName = allowedNames.get(name.trim().toLocaleLowerCase());
        if (canonicalName && typeof color === 'string' && /^#[0-9a-f]{6}$/i.test(color)) setOwn(memberColors, canonicalName, color);
    }
    return {
        ...source,
        name: text(source.name, 80),
        members,
        extras,
        memberColors,
        randomNpcEnabled: Boolean(source.randomNpcEnabled),
        groupNature: text(source.groupNature, 200),
        injection: normalizeGroupInjection(source.injection),
    };
}

export function normalizeGroupMetaStore(value) {
    const result = {};
    for (const [storageId, groups] of Object.entries(plainObject(value))) {
        const cleanStorageId = storeKey(storageId);
        if (!cleanStorageId) continue;
        const normalizedGroups = {};
        for (const [groupKey, meta] of Object.entries(plainObject(groups))) {
            const cleanGroupKey = storeKey(groupKey);
            if (!cleanGroupKey) continue;
            const normalized = normalizeGroupMeta(meta);
            if (normalized.name && normalized.members.length >= 2) setOwn(normalizedGroups, cleanGroupKey, normalized);
        }
        if (Object.keys(normalizedGroups).length) setOwn(result, cleanStorageId, normalizedGroups);
    }
    return result;
}
