import {
    COMMUNITY_PLATFORMS, COMMUNITY_POST_FLAGS, IGS_SYNC_PLATFORMS, INTERACTIVE_ACTOR_TYPES, INTERACTIVE_LIMITS, LIVE_DANMAKU_KINDS, PHONE_UI_PAGES, PHONE_UI_TABS,
    MOMENTS_LIKERS_MAX, platformForPreset,
} from './interactive-scene-constants.js';
import { stripPersistedV2ContentRating as stripPersistedV2ContentRatingImpl } from './interactive-scene-store-migration.js';
import { B2_POST_KEYS, findB2PostFieldError, normalizeB2PostFields } from './interactive-scene-post-fields.js';
import { normalizeScopeVideos } from './video-schema.js';
import { communityFloorMark, normalizeCommunityRollbackRecord, recordCommunityChange } from './community-floor-rollback.js';
import {
    createCommunityTemplate, createSceneFromCommunityTemplate as createSceneFromCommunityTemplateSnapshot, normalizeImportedTemplateSceneIds,
    normalizeSharedCommunityTemplates, validPhoneUiId,
} from './interactive-scene-community-template.js';

export const INTERACTIVE_STORE_VERSION = 3;
const LEGACY_V2_STORE_VERSION = 2;
export const PHONE_UI_STATE_VERSION = 1;
export {
    COMMUNITY_PLATFORMS, COMMUNITY_POST_FLAGS, INTERACTIVE_ACTOR_TYPES, INTERACTIVE_LIMITS, LIVE_DANMAKU_KINDS, PHONE_UI_PAGES, PHONE_UI_TABS,
    platformForPreset,
};
export { createCommunityTemplate, createSceneFromCommunityTemplateSnapshot as createSceneFromCommunityTemplate };

const text = (value, max) => String(value ?? '').trim().slice(0, max);
const list = value => Array.isArray(value) ? value : [];
const id = prefix => `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
const finitePositiveNumber = value => {
    const number = Number(value); return Number.isFinite(number) && number > 0 ? number : null;
};
const assertDataObject = (value, label) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} 必须是对象`);
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) throw new Error(`${label} 必须是纯数据对象`);
    if (Object.getOwnPropertySymbols(value).length) throw new Error(`${label} 不能包含 symbol 字段`);
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const accessor = Object.entries(descriptors)
        .find(([, descriptor]) => !Object.hasOwn(descriptor, 'value'));
    if (accessor) throw new Error(`${label}.${accessor[0]} 不能是访问器属性`);
    const hidden = Object.entries(descriptors).find(([, descriptor]) => descriptor.enumerable !== true);
    if (hidden) throw new Error(`${label}.${hidden[0]} 必须是可枚举属性`);
};
const assertDataArray = (value, label) => {
    if (!Array.isArray(value)) throw new Error(`${label} 必须是数组`);
    if (Object.getPrototypeOf(value) !== Array.prototype) throw new Error(`${label} 必须是纯数据数组`);
    if (Object.getOwnPropertySymbols(value).length) throw new Error(`${label} 不能包含 symbol 字段`);
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const unsupported = Object.keys(descriptors).find(key => key !== 'length' && !/^(0|[1-9]\d*)$/.test(key));
    if (unsupported) throw new Error(`${label} 包含额外字段：${unsupported}`);
    for (let index = 0; index < value.length; index += 1) {
        const descriptor = descriptors[index];
        if (!descriptor) throw new Error(`${label} 不能包含空位`);
        if (!Object.hasOwn(descriptor, 'value')) throw new Error(`${label}.${index} 不能是访问器属性`);
    }
};
// v2 与 v3 共用同一套严格校验（assertV2* 命名沿用），仅错误信息中的版本标签不同；标签在同步归一化入口处设置。
let strictTag = `v${INTERACTIVE_STORE_VERSION}`;
const withStrictTag = (version, run) => {
    const previous = strictTag;
    strictTag = `v${version}`;
    try { return run(); } finally { strictTag = previous; }
};
const assertV2Keys = (raw, allowedKeys, label) => {
    assertDataObject(raw, `互动场景 ${strictTag} ${label}`);
    const allowed = new Set(allowedKeys);
    const unsupported = Object.keys(raw).find(key => !allowed.has(key));
    if (unsupported) throw new Error(`互动场景 ${strictTag} ${label} 包含额外字段：${unsupported}`);
};
const assertV2Text = (value, max, label, { allowEmpty = false } = {}) => {
    if (typeof value !== 'string') throw new Error(`互动场景 ${strictTag} ${label} 必须是字符串`);
    if (value !== value.trim()) throw new Error(`互动场景 ${strictTag} ${label} 不能包含首尾空白`);
    if (!allowEmpty && !value) throw new Error(`互动场景 ${strictTag} ${label} 不能为空`);
    if (value.length > max) throw new Error(`互动场景 ${strictTag} ${label} 长度不能超过 ${max}`);
};
const assertV2Timestamp = (value, label) => {
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) throw new Error(`互动场景 ${strictTag} ${label} 必须是有效时间戳`);
};
const assertV2AuthorFields = (raw, label) => {
    assertV2Text(raw.authorId, 80, `${label}.authorId`);
    assertV2Text(raw.authorNameSnapshot, 80, `${label}.authorNameSnapshot`);
};
const assertV2List = (value, label) => {
    assertDataArray(value, `互动场景 ${strictTag} ${label}`);
};
const isStrictVersion = version => version === LEGACY_V2_STORE_VERSION || version === INTERACTIVE_STORE_VERSION;
const assertV1Object = (value, label) => {
    assertDataObject(value, `互动场景 v1 ${label}`);
};
const assertV1Keys = (raw, allowedKeys, label) => {
    assertV1Object(raw, label);
    const allowed = new Set(allowedKeys);
    const unsupported = Object.keys(raw).find(key => !allowed.has(key));
    if (unsupported) throw new Error(`互动场景 v1 ${label} 包含额外字段：${unsupported}`);
};
const assertV1OptionalText = (raw, key, label) => {
    if (Object.hasOwn(raw, key) && typeof raw[key] !== 'string') throw new Error(`互动场景 v1 ${label}.${key} 必须是字符串`);
};
const assertV1OptionalId = (raw, key, label, max = 80) => {
    if (!Object.hasOwn(raw, key)) return;
    const value = raw[key];
    if (typeof value !== 'string' || !value || value !== value.trim() || value.length > max) throw new Error(`互动场景 v1 ${label}.${key} 格式无效`);
};
const assertV1OptionalTimestamp = (raw, key, label) => {
    if (!Object.hasOwn(raw, key)) return;
    const value = raw[key];
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) throw new Error(`互动场景 v1 ${label}.${key} 必须是有效时间戳`);
};
const assertV1OptionalArray = (raw, key, label, max) => {
    if (!Object.hasOwn(raw, key)) return [];
    assertDataArray(raw[key], `互动场景 v1 ${label}.${key}`);
    if (Number.isInteger(max) && raw[key].length > max) throw new Error(`互动场景 v1 ${label}.${key} 不能超过 ${max} 项`);
    return raw[key];
};
const assertV1Item = (raw, kind, label) => {
    const isPost = kind === 'post';
    assertV1Keys(raw, isPost
        ? ['id', 'author', 'content', 'tags', 'createdAt', 'comments', 'liked']
        : ['id', 'author', 'content', 'createdAt'], label);
    assertV1OptionalId(raw, 'id', label);
    assertV1OptionalText(raw, 'author', label);
    assertV1OptionalText(raw, 'content', label);
    assertV1OptionalTimestamp(raw, 'createdAt', label);
    if (!isPost) return;
    if (Object.hasOwn(raw, 'liked') && typeof raw.liked !== 'boolean') throw new Error(`互动场景 v1 ${label}.liked 必须是布尔值`);
    const tags = assertV1OptionalArray(raw, 'tags', label, 5);
    if (tags.some(tag => typeof tag !== 'string')) throw new Error(`互动场景 v1 ${label}.tags 必须是字符串数组`);
    const comments = assertV1OptionalArray(raw, 'comments', label, INTERACTIVE_LIMITS.comments);
    comments.forEach((comment, index) => assertV1Item(comment, 'comment', `${label}.comments.${index}`));
};
const assertV1Scene = (raw, label) => {
    assertV1Keys(raw, ['id', 'title', 'preset', 'styleInput', 'generatedPrompt', 'themeAccent', 'contentRating', 'createdAt', 'updatedAt', 'posts', 'live'], label);
    if (Object.hasOwn(raw, 'id') && typeof raw.id !== 'string') throw new Error(`互动场景 v1 ${label}.id 必须是字符串`);
    for (const key of ['title', 'preset', 'styleInput', 'generatedPrompt', 'themeAccent']) assertV1OptionalText(raw, key, label);
    assertV1OptionalTimestamp(raw, 'createdAt', label);
    assertV1OptionalTimestamp(raw, 'updatedAt', label);
    const posts = assertV1OptionalArray(raw, 'posts', label, INTERACTIVE_LIMITS.posts);
    posts.forEach((post, index) => assertV1Item(post, 'post', `${label}.posts.${index}`));
    if (!Object.hasOwn(raw, 'live')) return;
    const liveLabel = `${label}.live`;
    const live = raw.live;
    assertV1Keys(live, ['title', 'status', 'warmupStarted', 'danmaku'], liveLabel);
    assertV1OptionalText(live, 'title', liveLabel);
    if (Object.hasOwn(live, 'status') && live.status !== 'idle') throw new Error(`互动场景 v1 ${liveLabel}.status 必须是 idle`);
    if (Object.hasOwn(live, 'warmupStarted') && typeof live.warmupStarted !== 'boolean') throw new Error(`互动场景 v1 ${liveLabel}.warmupStarted 必须是布尔值`);
    const danmaku = assertV1OptionalArray(live, 'danmaku', liveLabel, INTERACTIVE_LIMITS.danmaku);
    danmaku.forEach((item, index) => assertV1Item(item, 'danmaku', `${liveLabel}.danmaku.${index}`));
};
const isUnsafeDictionaryKey = value => value === 'prototype' || Object.hasOwn(Object.prototype, value);
const assertSafeDictionaryKey = (value, label) => {
    if (isUnsafeDictionaryKey(value)) throw new Error(`互动场景 ${label} 包含危险键：${value}`);
    return value;
};
const assertV2DictionaryKey = (value, max, label) => {
    assertV2Text(value, max, label);
    return assertSafeDictionaryKey(value, `${strictTag} ${label}`);
};
const normalizeV1DictionaryKey = (value, max, label) => {
    const normalized = text(value, max);
    return normalized ? assertSafeDictionaryKey(normalized, `v1 ${label}`) : '';
};
const canonicalName = value => text(value, 80).toLocaleLowerCase();
const stableHash = value => {
    let hash = 2166136261;
    for (const character of String(value)) {
        hash ^= character.codePointAt(0);
        hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
};

export function deriveInteractiveActorId(scopeId, type, bindingKey) {
    const safeType = INTERACTIVE_ACTOR_TYPES.includes(type) ? type : 'legacy';
    const key = text(bindingKey, 240) || 'unknown';
    return `actor_${safeType}_${stableHash(`${scopeId}\u0000${safeType}\u0000${key}`)}`;
}

export function createEmptyInteractiveStore() {
    return { version: INTERACTIVE_STORE_VERSION, scopes: {} };
}

export function stripPersistedV2ContentRating(rawStore) {
    return stripPersistedV2ContentRatingImpl(rawStore, LEGACY_V2_STORE_VERSION);
}

export function createDefaultPhoneUiScope() {
    return {
        lastPage: 'desktop',
        lastSceneId: null,
        lastTab: 'feed',
        lastChatType: null,
        lastChatKey: null,
    };
}

export function createEmptyPhoneUiState() {
    return { version: PHONE_UI_STATE_VERSION, scopes: {} };
}

export function normalizeAmbientStatus(value) {
    return { enabled: value?.enabled === true };
}

export function normalizePhoneUiState(raw, interactiveStore = createEmptyInteractiveStore()) {
    const result = createEmptyPhoneUiState();
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return result;
    if (raw.version !== PHONE_UI_STATE_VERSION || !raw.scopes || typeof raw.scopes !== 'object' || Array.isArray(raw.scopes)) return result;
    const sharedCommunityTemplates = normalizeSharedCommunityTemplates(raw.sharedCommunityTemplates);
    const sharedTemplateIds = new Set(sharedCommunityTemplates.map(template => template.id));
    const interactiveScopes = interactiveStore?.scopes && typeof interactiveStore.scopes === 'object'
        ? interactiveStore.scopes
        : {};
    // 全局固定：[{ storageId, sceneId }]，按固定先后保持顺序并去重。该聊天的社区已加载却没有这个社区时视为已删除；未加载的不清。
    const globalPins = [];
    const seenPins = new Set();
    const addGlobalPin = (pinStorageId, pinSceneId) => {
        if (typeof pinStorageId !== 'string' || !pinStorageId || pinStorageId !== pinStorageId.trim() || pinStorageId.length > 160 || isUnsafeDictionaryKey(pinStorageId)) return;
        if (typeof pinSceneId !== 'string' || !pinSceneId || pinSceneId !== pinSceneId.trim() || pinSceneId.length > 80) return;
        const pinScenes = interactiveScopes[pinStorageId]?.scenes;
        if (pinScenes && typeof pinScenes === 'object' && !Object.hasOwn(pinScenes, pinSceneId)) return;
        const key = `${pinStorageId} ${pinSceneId}`;
        if (seenPins.has(key)) return;
        seenPins.add(key);
        globalPins.push({ storageId: pinStorageId, sceneId: pinSceneId });
    };
    for (const pin of Array.isArray(raw.globalPins) ? raw.globalPins : []) {
        if (pin && typeof pin === 'object') addGlobalPin(pin.storageId, pin.sceneId);
    }
    for (const [storageId, value] of Object.entries(raw.scopes)) {
        if (!storageId || storageId !== storageId.trim() || storageId.length > 160 || isUnsafeDictionaryKey(storageId)) continue;
        if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
        const scenes = interactiveScopes[storageId]?.scenes;
        const availableSceneIds = new Set(scenes && typeof scenes === 'object' ? Object.keys(scenes) : []);
        // 这个聊天的社区不在传入的数据里（未加载）时不按「已删除」清掉固定项；渲染时找不到的社区自然不显示。
        const scopeLoaded = !!scenes && typeof scenes === 'object';
        // 旧版按聊天保存的固定项迁入全局固定列表；之后这里不再保留 pinnedSceneIds。
        for (const candidate of Array.isArray(value.pinnedSceneIds) ? value.pinnedSceneIds : []) addGlobalPin(storageId, candidate);
        const validLastSceneId = typeof value.lastSceneId === 'string'
            && value.lastSceneId
            && value.lastSceneId === value.lastSceneId.trim()
            && value.lastSceneId.length <= 80
            && availableSceneIds.has(value.lastSceneId);
        const lastSceneId = validLastSceneId ? value.lastSceneId : null;
        let lastPage = PHONE_UI_PAGES.includes(value.lastPage) ? value.lastPage : 'desktop';
        if (lastPage === 'community' && !lastSceneId) lastPage = 'desktop';
        const lastChatType = value.lastChatType === 'contact' || value.lastChatType === 'group'
            ? value.lastChatType
            : null;
        const lastChatKey = lastChatType && typeof value.lastChatKey === 'string'
            && value.lastChatKey && value.lastChatKey === value.lastChatKey.trim() && value.lastChatKey.length <= 160
            ? value.lastChatKey : null;
        const importedTemplateSceneIds = normalizeImportedTemplateSceneIds(value.importedTemplateSceneIds, scenes);
        const dismissedCommunityTemplateIds = [];
        const seenDismissedTemplateIds = new Set();
        for (const templateId of Array.isArray(value.dismissedCommunityTemplateIds) ? value.dismissedCommunityTemplateIds : []) {
            if (!validPhoneUiId(templateId, 120) || !sharedTemplateIds.has(templateId) || seenDismissedTemplateIds.has(templateId)) continue;
            seenDismissedTemplateIds.add(templateId);
            dismissedCommunityTemplateIds.push(templateId);
        }
        result.scopes[storageId] = {
            ...(Object.keys(importedTemplateSceneIds).length ? { importedTemplateSceneIds } : {}),
            ...(dismissedCommunityTemplateIds.length ? { dismissedCommunityTemplateIds } : {}),
            lastPage,
            lastSceneId,
            lastTab: PHONE_UI_TABS.includes(value.lastTab) ? value.lastTab : 'feed', // 旧状态的 'live' 在此归一为 'feed'
            lastChatType: lastChatKey ? lastChatType : null,
            lastChatKey,
        };
    }
    if (sharedCommunityTemplates.length) result.sharedCommunityTemplates = sharedCommunityTemplates;
    if (globalPins.length) result.globalPins = globalPins;
    return result;
}

const assertPhoneUiStorageId = storageId => {
    if (typeof storageId !== 'string' || !storageId || storageId !== storageId.trim() || storageId.length > 160 || isUnsafeDictionaryKey(storageId)) {
        throw new Error('手机页面 storageId 格式无效');
    }
};

export function patchPhoneUiScope(phoneUiState, storageId, patch, interactiveStore = createEmptyInteractiveStore()) {
    assertPhoneUiStorageId(storageId);
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new Error('手机页面状态补丁必须是对象');
    const normalized = normalizePhoneUiState(phoneUiState, interactiveStore);
    const currentScope = normalized.scopes[storageId] || createDefaultPhoneUiScope();
    return normalizePhoneUiState({
        ...normalized,
        scopes: {
            ...normalized.scopes,
            [storageId]: {
                ...currentScope,
                ...patch,
                dismissedCommunityTemplateIds: Object.hasOwn(patch, 'dismissedCommunityTemplateIds')
                    ? [...(Array.isArray(patch.dismissedCommunityTemplateIds) ? patch.dismissedCommunityTemplateIds : [])] : [...(currentScope.dismissedCommunityTemplateIds || [])],
                importedTemplateSceneIds: Object.hasOwn(patch, 'importedTemplateSceneIds')
                    ? { ...(patch.importedTemplateSceneIds || {}) } : { ...currentScope.importedTemplateSceneIds },
            },
        },
    }, interactiveStore);
}

export function toggleScenePin(phoneUiState, storageId, sceneId, interactiveStore) {
    assertPhoneUiStorageId(storageId);
    if (typeof sceneId !== 'string' || !sceneId || sceneId !== sceneId.trim() || sceneId.length > 80) {
        throw new Error('互动场景标识格式无效');
    }
    const scenes = interactiveStore?.scopes?.[storageId]?.scenes;
    if (!scenes || typeof scenes !== 'object' || !Object.hasOwn(scenes, sceneId)) throw new Error('互动场景不存在');
    const normalized = normalizePhoneUiState(phoneUiState, interactiveStore);
    const pins = normalized.globalPins || [];
    const exists = pins.some(pin => pin.storageId === storageId && pin.sceneId === sceneId);
    const globalPins = exists
        ? pins.filter(pin => !(pin.storageId === storageId && pin.sceneId === sceneId))
        : [...pins, { storageId, sceneId }];
    const next = { ...normalized };
    if (globalPins.length) next.globalPins = globalPins; else delete next.globalPins;
    return normalizePhoneUiState(next, interactiveStore);
}

/** 某个聊天里被固定的社区编号（来自全局固定列表）。 */
export function pinnedSceneIdsOf(phoneUiState, storageId) {
    return (phoneUiState?.globalPins || []).filter(pin => pin.storageId === storageId).map(pin => pin.sceneId);
}

export function dismissCommunityTemplate(phoneUiState, storageId, templateId, interactiveStore) {
    assertPhoneUiStorageId(storageId);
    if (!validPhoneUiId(templateId, 120)) throw new Error('社区模板标识格式无效');
    const normalized = normalizePhoneUiState(phoneUiState, interactiveStore);
    const template = (normalized.sharedCommunityTemplates || []).find(item => item.id === templateId);
    if (!template) throw new Error('共享社区模板不存在或已取消发布');
    if (template.sourceStorageId === storageId) throw new Error('源窗口模板必须在社区中取消发布');
    const scope = normalized.scopes[storageId] || createDefaultPhoneUiScope();
    if (scope.dismissedCommunityTemplateIds?.includes(templateId)) return normalized;
    return patchPhoneUiScope(normalized, storageId, {
        dismissedCommunityTemplateIds: [...(scope.dismissedCommunityTemplateIds || []), templateId],
    }, interactiveStore);
}

function assertCommunityTemplateSource(storageId, sceneId, interactiveStore) {
    assertPhoneUiStorageId(storageId);
    if (typeof sceneId !== 'string' || !sceneId || sceneId !== sceneId.trim() || sceneId.length > 80) {
        throw new Error('互动场景标识格式无效');
    }
    const scene = interactiveStore?.scopes?.[storageId]?.scenes?.[sceneId];
    if (!scene) throw new Error('互动场景不存在');
    return scene;
}

export function publishCommunityTemplate(phoneUiState, storageId, sceneId, interactiveStore, sharedAt = Date.now()) {
    const scene = assertCommunityTemplateSource(storageId, sceneId, interactiveStore);
    const normalized = normalizePhoneUiState(phoneUiState, interactiveStore);
    const template = createCommunityTemplate(scene, storageId, sharedAt);
    const templates = normalized.sharedCommunityTemplates || [];
    return normalizePhoneUiState({
        ...normalized,
        sharedCommunityTemplates: [...templates.filter(item => item.id !== template.id), template],
    }, interactiveStore);
}

export function unpublishCommunityTemplate(phoneUiState, storageId, sceneId, interactiveStore) {
    const scene = assertCommunityTemplateSource(storageId, sceneId, interactiveStore);
    const normalized = normalizePhoneUiState(phoneUiState, interactiveStore);
    const templateId = createCommunityTemplate(scene, storageId, 1).id;
    return normalizePhoneUiState({
        ...normalized,
        sharedCommunityTemplates: (normalized.sharedCommunityTemplates || []).filter(template => template.id !== templateId),
    }, interactiveStore);
}

export function removeCommunityTemplatesForSourceScene(phoneUiState, storageId, sceneId, interactiveStore) {
    assertPhoneUiStorageId(storageId);
    if (!validPhoneUiId(sceneId, 80)) throw new Error('互动场景标识格式无效');
    const normalized = normalizePhoneUiState(phoneUiState, interactiveStore);
    const templates = normalized.sharedCommunityTemplates || [];
    const remaining = templates.filter(template => template.sourceStorageId !== storageId || template.sourceSceneId !== sceneId);
    if (remaining.length === templates.length) return normalized;
    return normalizePhoneUiState({
        ...normalized,
        sharedCommunityTemplates: remaining,
    }, interactiveStore);
}

function normalizeActor(raw, actorId) {
    const type = INTERACTIVE_ACTOR_TYPES.includes(raw?.type) ? raw.type : 'legacy';
    const displayName = text(raw?.displayName, 80) || (type === 'user' ? '我' : type === 'passerby' ? '路人' : '匿名用户');
    return {
        actorId: text(actorId || raw?.actorId, 80),
        type,
        displayName,
        bindingKey: text(raw?.bindingKey, 240),
        profile: text(raw?.profile, 1000),
        createdAt: finitePositiveNumber(raw?.createdAt) || 1,
    };
}

function assertV2Actor(raw, actorId, scopeId) {
    assertV2Keys(raw, ['actorId', 'type', 'displayName', 'bindingKey', 'profile', 'createdAt'], `actor ${actorId || '(空)'}`);
    if (!actorId || raw.actorId !== actorId) throw new Error(`互动场景 v2 actor ${actorId || '(空)'} 标识不一致`);
    if (!INTERACTIVE_ACTOR_TYPES.includes(raw.type)) throw new Error(`互动场景 v2 actor ${actorId} 类型无效`);
    assertV2Text(raw.displayName, 80, `actor ${actorId}.displayName`);
    assertV2Text(raw.bindingKey, 240, `actor ${actorId}.bindingKey`);
    assertV2Text(raw.profile, 1000, `actor ${actorId}.profile`, { allowEmpty: true });
    assertV2Timestamp(raw.createdAt, `actor ${actorId}.createdAt`);
    const expectedId = deriveInteractiveActorId(scopeId, raw.type, raw.bindingKey);
    if (expectedId !== actorId) throw new Error(`互动场景 v2 actor ${actorId} 与绑定信息不一致`);
}


export function ensureInteractiveActor(scope, scopeId, seed) {
    if (!scope.actors || typeof scope.actors !== 'object' || Array.isArray(scope.actors)) scope.actors = {};
    const type = INTERACTIVE_ACTOR_TYPES.includes(seed?.type) ? seed.type : 'legacy';
    const displayName = text(seed?.displayName, 80) || (type === 'user' ? '我' : '匿名用户');
    const bindingKey = text(seed?.bindingKey, 240) || `${type}:${canonicalName(displayName) || 'anonymous'}`;
    const actorId = deriveInteractiveActorId(scopeId, type, bindingKey);
    const previous = Object.hasOwn(scope.actors, actorId) ? scope.actors[actorId] : null;
    scope.actors[actorId] = normalizeActor({
        ...previous,
        ...seed,
        type,
        displayName,
        bindingKey,
        createdAt: finitePositiveNumber(previous?.createdAt) || finitePositiveNumber(seed?.createdAt) || Date.now(),
    }, actorId);
    return scope.actors[actorId];
}

function ensureLegacyActor(scope, scopeId, displayName, createdAt) {
    const name = text(displayName, 80) || '匿名用户';
    return ensureInteractiveActor(scope, scopeId, {
        type: 'legacy', displayName: name,
        bindingKey: `legacy:${canonicalName(name) || 'anonymous'}`,
        createdAt: finitePositiveNumber(createdAt) || 1,
    });
}


function actorReference(actor, snapshot) {
    return {
        authorId: actor.actorId,
        authorNameSnapshot: text(snapshot, 80) || actor.displayName,
    };
}

export function resolveInteractiveAuthor(scope, scopeId, displayName, seed = null) {
    if (seed) {
        const actor = ensureInteractiveActor(scope, scopeId, seed);
        return actorReference(actor, seed.displayName);
    }
    const name = text(displayName, 80) || '匿名用户';
    const matches = Object.values(scope.actors || {}).filter(actor => actor.type === 'story'
        && canonicalName(actor.displayName) === canonicalName(name));
    if (matches.length === 1) return actorReference(matches[0], name);
    const actor = ensureInteractiveActor(scope, scopeId, {
        type: 'passerby', displayName: name,
        bindingKey: `passerby:${canonicalName(name) || 'anonymous'}`,
    });
    return actorReference(actor, name);
}

function deterministicItemId(prefix, scopeId, path, content) {
    return `${prefix}_${stableHash(`${scopeId}\u0000${path}\u0000${content}`)}`;
}

function normalizeAuthor(raw, scope, scopeId, sourceVersion, createdAt) {
    const snapshot = text(raw?.authorNameSnapshot ?? raw?.author, 80) || '匿名用户';
    if (isStrictVersion(sourceVersion)) {
        const actorId = assertV2DictionaryKey(raw?.authorId, 80, '内容 authorId');
        if (!Object.hasOwn(scope.actors || {}, actorId)) throw new Error(`互动场景 ${strictTag} 内容引用了不存在的 actor：${actorId}`);
        return { authorId: actorId, authorNameSnapshot: snapshot };
    }
    return actorReference(ensureLegacyActor(scope, scopeId, snapshot, createdAt), snapshot);
}

const validRatingValue = value => Number.isInteger(value) && value >= 1 && value <= 5;

// v3 评论可选字段：quoteId（豆瓣引用楼层）与 rating（书评短评）；缺省不输出该键。quoteId 是否指向同帖评论在帖子层统一核对。
function normalizeCommentExtras(raw) {
    const quoteId = typeof raw?.quoteId === 'string' ? text(raw.quoteId, 80) : '';
    return { ...(quoteId ? { quoteId } : {}), ...(validRatingValue(raw?.rating) ? { rating: raw.rating } : {}) };
}

// 删楼回退的楼层标记（community-floor-rollback.js）：floor 为发出时主线的长度，floorAnchor 为当时最后一楼的标识。
function assertFloorMark(raw, label) {
    if (Object.hasOwn(raw, 'floor') && !(Number.isSafeInteger(raw.floor) && raw.floor >= 0)) throw new Error(`互动场景 ${strictTag} ${label}.floor 必须是非负整数`);
    if (Object.hasOwn(raw, 'floorAnchor') && typeof raw.floorAnchor !== 'string') throw new Error(`互动场景 ${strictTag} ${label}.floorAnchor 必须是字符串`);
}

function floorMarkOf(raw) {
    if (!(Number.isSafeInteger(raw?.floor) && raw.floor >= 0)) return {};
    return { floor: raw.floor, floorAnchor: typeof raw.floorAnchor === 'string' ? raw.floorAnchor.slice(0, 200) : '' };
}

// 旧版本记录：形状不对或被删的项本身不合规的，单条丢掉，不让整个社区或直播间读不出来。
function normalizeFloorRollback(value, context) {
    const output = [];
    list(value).forEach((raw, index) => {
        const record = normalizeCommunityRollbackRecord(raw);
        if (!record) return;
        if (record.op === 'remove') {
            const itemContext = { ...context, path: `${context.path}.${index}` };
            let entry = null;
            try {
                entry = record.target === 'post' ? normalizePost(record.entry, itemContext)
                    : record.target === 'comment' ? normalizeComment(record.entry, itemContext)
                        : normalizeDanmaku(record.entry, itemContext);
            } catch (error) { entry = null; }
            if (!entry) return;
            record.entry = entry;
        }
        output.push(record);
    });
    return output;
}

const rollbackField = records => (records.length ? { floorRollback: records } : {});

function normalizeComment(raw, context) {
    if (isStrictVersion(context.sourceVersion)) {
        const allowed = ['id', 'authorId', 'authorNameSnapshot', 'content', 'createdAt'];
        if (context.sourceVersion === INTERACTIVE_STORE_VERSION) allowed.push('quoteId', 'rating', 'floor', 'floorAnchor');
        assertV2Keys(raw, allowed, 'comment');
        assertV2Text(raw.id, 80, 'comment.id'); assertV2AuthorFields(raw, 'comment'); assertV2Text(raw.content, 1000, 'comment.content'); assertV2Timestamp(raw.createdAt, 'comment.createdAt');
        if (Object.hasOwn(raw, 'quoteId')) assertV2Text(raw.quoteId, 80, 'comment.quoteId');
        if (Object.hasOwn(raw, 'rating') && !validRatingValue(raw.rating)) throw new Error(`互动场景 ${strictTag} comment.rating 必须是 1-5 的整数`);
        assertFloorMark(raw, 'comment');
    } else if (context.strictLegacy) {
        assertV1Item(raw, 'comment', context.path);
    }
    const content = text(raw?.content, 1000);
    if (!content) return null;
    const createdAt = finitePositiveNumber(raw?.createdAt) || 1;
    return {
        id: text(raw?.id, 80) || deterministicItemId('comment', context.scopeId, context.path, content),
        ...normalizeAuthor(raw, context.scope, context.scopeId, context.sourceVersion, createdAt),
        content,
        createdAt,
        ...normalizeCommentExtras(raw),
        ...floorMarkOf(raw),
    };
}

// 引用楼层只能指向同帖另一条评论；目标被删除或截断后丢弃 quoteId，评论本身保留。
function pruneDanglingQuotes(comments) {
    const ids = new Set(comments.map(comment => comment.id));
    return comments.map(comment => {
        if (!Object.hasOwn(comment, 'quoteId') || (comment.quoteId !== comment.id && ids.has(comment.quoteId))) return comment;
        const { quoteId: _dropped, ...rest } = comment;
        return rest;
    });
}

const optionalText = (value, max) => typeof value === 'string' ? text(value, max) : '';

function normalizeRepost(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const author = optionalText(value.author, 80);
    const content = optionalText(value.content, 1000);
    return author && content ? { author, content } : null;
}

// 配图：只存画面描述，图片本身由生图目录按 sceneId/postId 关联。
function normalizePostImage(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const desc = optionalText(value.desc, 200);
    return desc ? { desc } : null;
}

function normalizePostSource(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const key = optionalText(value.key, 120);
    if (value.type !== 'igs' || !Number.isSafeInteger(value.floor) || value.floor < 0 || !key) return null;
    // stale：正文楼层已改或已删，但用户动过这条（编辑、评论、点赞），所以保留并标记「原文已变」。
    return { type: 'igs', floor: value.floor, key, ...(value.stale === true ? { stale: true } : {}) };
}

// 帖子可选字段（书评 work/rating 为 v2 已有，其余为 v3 新增）：缺省不输出该键，非法值丢弃而不让整条帖子失效。
function normalizePostExtras(raw) {
    const work = text(raw?.work, 40);
    const rating = validRatingValue(raw?.rating) ? raw.rating : null;
    const title = optionalText(raw?.title, 40);
    const flag = COMMUNITY_POST_FLAGS.includes(raw?.flag) ? raw.flag : '';
    const repost = normalizeRepost(raw?.repost);
    const mood = optionalText(raw?.mood, 12);
    const workAuthor = optionalText(raw?.workAuthor, 40);
    const to = optionalText(raw?.to, 40);
    const sign = optionalText(raw?.sign, 40);
    const source = normalizePostSource(raw?.source);
    const image = normalizePostImage(raw?.image);
    return {
        ...(title ? { title } : {}), ...(flag ? { flag } : {}), ...(repost ? { repost } : {}), ...(mood ? { mood } : {}),
        ...(work ? { work } : {}), ...(workAuthor ? { workAuthor } : {}), ...(rating ? { rating } : {}),
        ...(to ? { to } : {}), ...(sign ? { sign } : {}), ...(source ? { source } : {}), ...(image ? { image } : {}),
        ...normalizeB2PostFields(raw),
    };
}

function assertV3PostExtras(raw) {
    if (Object.hasOwn(raw, 'title')) assertV2Text(raw.title, 40, 'post.title');
    if (Object.hasOwn(raw, 'flag') && !COMMUNITY_POST_FLAGS.includes(raw.flag)) throw new Error(`互动场景 ${strictTag} post.flag 必须是 ${COMMUNITY_POST_FLAGS.join('、')} 之一`);
    if (Object.hasOwn(raw, 'repost')) {
        assertV2Keys(raw.repost, ['author', 'content'], 'post.repost');
        assertV2Text(raw.repost.author, 80, 'post.repost.author');
        assertV2Text(raw.repost.content, 1000, 'post.repost.content');
    }
    if (Object.hasOwn(raw, 'mood')) assertV2Text(raw.mood, 12, 'post.mood');
    if (Object.hasOwn(raw, 'workAuthor')) assertV2Text(raw.workAuthor, 40, 'post.workAuthor');
    if (Object.hasOwn(raw, 'to')) assertV2Text(raw.to, 40, 'post.to');
    if (Object.hasOwn(raw, 'sign')) assertV2Text(raw.sign, 40, 'post.sign');
    if (Object.hasOwn(raw, 'image')) {
        assertV2Keys(raw.image, ['desc'], 'post.image');
        assertV2Text(raw.image.desc, 200, 'post.image.desc');
    }
    if (Object.hasOwn(raw, 'source')) {
        assertV2Keys(raw.source, ['type', 'floor', 'key', 'stale'], 'post.source');
        if (raw.source.type !== 'igs') throw new Error(`互动场景 ${strictTag} post.source.type 必须是 igs`);
        if (!Number.isSafeInteger(raw.source.floor) || raw.source.floor < 0) throw new Error(`互动场景 ${strictTag} post.source.floor 必须是非负整数`);
        assertV2Text(raw.source.key, 120, 'post.source.key');
        if (Object.hasOwn(raw.source, 'stale') && raw.source.stale !== true) throw new Error(`互动场景 ${strictTag} post.source.stale 只能是 true`);
    }
    const b2Error = findB2PostFieldError(raw);
    if (b2Error) throw new Error(`互动场景 ${strictTag} ${b2Error[0]} ${b2Error[1]}`);
}

function normalizePost(raw, context) {
    if (isStrictVersion(context.sourceVersion)) {
        const isV3 = context.sourceVersion === INTERACTIVE_STORE_VERSION;
        assertV2Keys(raw, [
            'id', 'authorId', 'authorNameSnapshot', 'content', 'tags', 'createdAt', 'comments', 'liked', 'shareCount', 'shared', 'work', 'rating',
            ...(isV3 ? ['title', 'flag', 'repost', 'mood', 'workAuthor', 'to', 'sign', 'source', 'image', 'floor', 'floorAnchor', ...B2_POST_KEYS] : []),
        ], 'post');
        assertV2Text(raw.id, 80, 'post.id'); assertV2AuthorFields(raw, 'post'); assertV2Text(raw.content, 4000, 'post.content'); assertV2Timestamp(raw.createdAt, 'post.createdAt');
        if (Object.hasOwn(raw, 'work')) assertV2Text(raw.work, 40, 'post.work');
        if (Object.hasOwn(raw, 'rating') && !validRatingValue(raw.rating)) {
            throw new Error(`互动场景 ${strictTag} post.rating 必须是 1-5 的整数`);
        }
        if (isV3) { assertV3PostExtras(raw); assertFloorMark(raw, 'post'); }
        assertV2List(raw.tags, 'post.tags');
        if (raw.tags.length > 5) throw new Error(`互动场景 ${strictTag} post.tags 不能超过 5 项`);
        raw.tags.forEach((tag, index) => assertV2Text(tag, 30, `post.tags.${index}`));
        assertV2List(raw.comments, 'post.comments');
        if (raw.comments.length > INTERACTIVE_LIMITS.comments) throw new Error(`互动场景 ${strictTag} post.comments 不能超过 ${INTERACTIVE_LIMITS.comments} 项`);
        if (typeof raw.liked !== 'boolean') throw new Error(`互动场景 ${strictTag} post.liked 必须是布尔值`);
        if (Object.hasOwn(raw, 'shared') && typeof raw.shared !== 'boolean') throw new Error(`互动场景 ${strictTag} post.shared 必须是布尔值`);
        if (Object.hasOwn(raw, 'shareCount') && (!Number.isSafeInteger(raw.shareCount) || raw.shareCount < 0)) {
            throw new Error(`互动场景 ${strictTag} post.shareCount 必须是非负安全整数`);
        }
    } else if (context.strictLegacy) {
        assertV1Item(raw, 'post', context.path);
    }
    const content = text(raw?.content, 4000);
    if (!content) return null;
    const createdAt = finitePositiveNumber(raw?.createdAt) || 1;
    const postId = text(raw?.id, 80) || deterministicItemId('post', context.scopeId, context.path, content);
    return {
        id: postId,
        ...normalizeAuthor(raw, context.scope, context.scopeId, context.sourceVersion, createdAt),
        content,
        tags: list(raw?.tags).map(tag => text(tag, 30)).filter(Boolean).slice(0, 5),
        createdAt,
        comments: pruneDanglingQuotes(list(raw?.comments).map((comment, index) => normalizeComment(comment, {
            ...context, path: `${context.path}.comments.${index}`,
        })).filter(Boolean).slice(-INTERACTIVE_LIMITS.comments)),
        liked: !!raw?.liked,
        shareCount: Number.isSafeInteger(raw?.shareCount) && raw.shareCount >= 0 ? raw.shareCount : 0,
        shared: typeof raw?.shared === 'boolean' ? raw.shared
            : Number.isSafeInteger(raw?.shareCount) && raw.shareCount > 0,
        ...normalizePostExtras(raw),
        ...floorMarkOf(raw),
    };
}

// 弹幕：v1/v2 来自 scene.live.danmaku（无 kind，一律视为 chat），v3 来自直播间（带 kind）。
function normalizeDanmaku(raw, context) {
    const isV3 = context.sourceVersion === INTERACTIVE_STORE_VERSION;
    if (isStrictVersion(context.sourceVersion)) {
        assertV2Keys(raw, ['id', 'authorId', 'authorNameSnapshot', 'content', 'createdAt', ...(isV3 ? ['kind', 'source', 'floor', 'floorAnchor'] : [])], 'danmaku');
        if (isV3) assertFloorMark(raw, 'danmaku');
        if (isV3 && Object.hasOwn(raw, 'source')) {
            assertV2Keys(raw.source, ['type', 'floor', 'key'], 'danmaku.source');
            if (raw.source.type !== 'igs') throw new Error(`互动场景 ${strictTag} danmaku.source.type 必须是 igs`);
            if (!Number.isSafeInteger(raw.source.floor) || raw.source.floor < 0) throw new Error(`互动场景 ${strictTag} danmaku.source.floor 必须是非负整数`);
            assertV2Text(raw.source.key, 120, 'danmaku.source.key');
        }
        assertV2Text(raw.id, 80, 'danmaku.id'); assertV2AuthorFields(raw, 'danmaku'); assertV2Text(raw.content, 200, 'danmaku.content'); assertV2Timestamp(raw.createdAt, 'danmaku.createdAt');
        if (isV3 && Object.hasOwn(raw, 'kind') && !LIVE_DANMAKU_KINDS.includes(raw.kind)) {
            throw new Error(`互动场景 ${strictTag} danmaku.kind 必须是 ${LIVE_DANMAKU_KINDS.join('、')} 之一`);
        }
    } else if (context.strictLegacy) {
        assertV1Item(raw, 'danmaku', context.path);
    }
    const content = text(raw?.content, 200);
    if (!content) return null;
    const createdAt = finitePositiveNumber(raw?.createdAt) || 1;
    // 从 gal 正文同步来的弹幕带来源，用于去重与跟随楼层修改；弹幕不用 stale（用户改过的直接保留）。
    const source = normalizePostSource(raw?.source);
    return {
        id: text(raw?.id, 80) || deterministicItemId('danmaku', context.scopeId, context.path, content),
        ...normalizeAuthor(raw, context.scope, context.scopeId, context.sourceVersion, createdAt),
        content,
        createdAt,
        kind: LIVE_DANMAKU_KINDS.includes(raw?.kind) ? raw.kind : 'chat',
        ...(source ? { source: { type: 'igs', floor: source.floor, key: source.key } } : {}),
        ...floorMarkOf(raw),
    };
}

function normalizeThemeAccent(value) {
    const accent = String(value ?? '').trim();
    return /^#[0-9a-fA-F]{6}$/.test(accent) ? accent.toLowerCase() : '';
}


const HOT_BADGES = Object.freeze(['沸', '热', '新', '']);
const HOT_LIMIT = 5;

// 热榜条目：最多 5 项，非法项丢弃；空数组或缺省时调用方不输出该键。
function normalizeHot(value) {
    const items = [];
    for (const item of Array.isArray(value) ? value : []) {
        if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
        const title = optionalText(item.title, 30);
        const badge = item.badge === undefined ? '' : item.badge;
        if (!title || !HOT_BADGES.includes(badge)) continue;
        items.push({ title, badge });
        if (items.length >= HOT_LIMIT) break;
    }
    return items;
}

function normalizeTonight(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const title = optionalText(value.title, 60);
    const openedAt = finitePositiveNumber(value.openedAt);
    return title && openedAt ? { title, openedAt } : null;
}

// 返回 { scene, live }：v1/v2 的 scene.live 不进入 v3 scene，交给调用方迁成直播间；v3 来源时 live 为 null。
function normalizeSceneWithLegacyLive(raw, options = {}) {
    const scope = options.scope || { actors: {} };
    const scopeId = text(options.scopeId, 160) || '__standalone__';
    const sourceVersion = options.sourceVersion === INTERACTIVE_STORE_VERSION || options.sourceVersion === LEGACY_V2_STORE_VERSION
        ? options.sourceVersion : 1;
    const strictLegacy = sourceVersion === 1 && options.strictLegacy === true;
    const isV3 = sourceVersion === INTERACTIVE_STORE_VERSION;
    if (isStrictVersion(sourceVersion)) {
        assertV2Keys(raw, isV3
            ? ['id', 'title', 'platform', 'nsfw', 'autoRespond', 'igsSync', 'preset', 'styleInput', 'generatedPrompt', 'themeAccent', 'tonight', 'hot', 'createdAt', 'updatedAt', 'posts', 'floorRollback']
            : ['id', 'title', 'preset', 'styleInput', 'generatedPrompt', 'themeAccent', 'createdAt', 'updatedAt', 'posts', 'live'], 'scene');
        if (!isV3 && raw?.live !== undefined) assertV2Keys(raw.live, ['title', 'status', 'warmupStarted', 'danmaku'], 'live');
        assertV2Text(raw.id, 80, 'scene.id');
        assertV2Text(raw.title, 80, 'scene.title');
        if (isV3 && !COMMUNITY_PLATFORMS.includes(raw.platform)) {
            throw new Error(`互动场景 ${strictTag} scene.platform 必须是 ${COMMUNITY_PLATFORMS.join('、')} 之一`);
        }
        if (isV3 && typeof raw.nsfw !== 'boolean') throw new Error(`互动场景 ${strictTag} scene.nsfw 必须是布尔值`);
        if (isV3 && Object.hasOwn(raw, 'autoRespond') && typeof raw.autoRespond !== 'boolean') throw new Error(`互动场景 ${strictTag} scene.autoRespond 必须是布尔值`);
        if (isV3 && Object.hasOwn(raw, 'igsSync') && raw.igsSync !== true) throw new Error(`互动场景 ${strictTag} scene.igsSync 只能是 true`);
        assertV2Text(raw.preset, 30, 'scene.preset');
        assertV2Text(raw.styleInput, 2000, 'scene.styleInput', { allowEmpty: true });
        assertV2Text(raw.generatedPrompt, 6000, 'scene.generatedPrompt', { allowEmpty: true });
        if (raw.themeAccent !== undefined) {
            assertV2Text(raw.themeAccent, 7, 'scene.themeAccent', { allowEmpty: true });
            if (raw.themeAccent && normalizeThemeAccent(raw.themeAccent) !== raw.themeAccent) {
                throw new Error(`互动场景 ${strictTag} scene.themeAccent 必须是小写六位十六进制颜色`);
            }
        }
        if (isV3 && Object.hasOwn(raw, 'tonight')) {
            assertV2Keys(raw.tonight, ['title', 'openedAt'], 'scene.tonight');
            assertV2Text(raw.tonight.title, 60, 'scene.tonight.title');
            assertV2Timestamp(raw.tonight.openedAt, 'scene.tonight.openedAt');
        }
        if (isV3 && Object.hasOwn(raw, 'hot')) {
            assertV2List(raw.hot, 'scene.hot');
            if (raw.hot.length > HOT_LIMIT) throw new Error(`互动场景 ${strictTag} scene.hot 不能超过 ${HOT_LIMIT} 项`);
            raw.hot.forEach((item, index) => {
                assertV2Keys(item, ['title', 'badge'], `scene.hot.${index}`);
                assertV2Text(item.title, 30, `scene.hot.${index}.title`);
                if (!HOT_BADGES.includes(item.badge)) throw new Error(`互动场景 ${strictTag} scene.hot.${index}.badge 必须是 ${HOT_BADGES.map(badge => badge || '空').join('、')} 之一`);
            });
        }
        assertV2Timestamp(raw.createdAt, 'scene.createdAt'); assertV2Timestamp(raw.updatedAt, 'scene.updatedAt');
        assertV2List(raw.posts, 'scene.posts');
        if (raw.posts.length > INTERACTIVE_LIMITS.posts) throw new Error(`互动场景 ${strictTag} scene.posts 不能超过 ${INTERACTIVE_LIMITS.posts} 项`);
        if (!isV3) {
            assertV2Text(raw.live.title, 100, 'live.title', { allowEmpty: true });
            if (raw.live.status !== 'idle') throw new Error(`互动场景 ${strictTag} live.status 必须是 idle`);
            if (Object.hasOwn(raw.live, 'warmupStarted') && typeof raw.live.warmupStarted !== 'boolean') throw new Error(`互动场景 ${strictTag} live.warmupStarted 必须是布尔值`);
            assertV2List(raw.live.danmaku, 'live.danmaku');
            if (raw.live.danmaku.length > INTERACTIVE_LIMITS.danmaku) throw new Error(`互动场景 ${strictTag} live.danmaku 不能超过 ${INTERACTIVE_LIMITS.danmaku} 项`);
        }
    } else if (strictLegacy) {
        assertV1Scene(raw, `scope ${scopeId}.scene ${raw?.id || '(空)'}`);
    }
    const sceneId = text(raw?.id, 80) || id('scene');
    const createdAt = finitePositiveNumber(raw?.createdAt) || 1;
    const preset = text(raw?.preset, 30) || 'weibo';
    const platform = COMMUNITY_PLATFORMS.includes(raw?.platform) ? raw.platform : platformForPreset(preset);
    const tonight = platform === 'night' ? normalizeTonight(raw?.tonight) : null;
    const hot = normalizeHot(raw?.hot);
    const scene = {
        id: sceneId,
        title: text(raw?.title, 80) || '未命名互动场景',
        platform,
        nsfw: raw?.nsfw === true,
        // 「发布后自动回应」缺省视为开；宽松读入只认明确的 false，且只在关闭时写出该键，老数据与模板保持原样。
        ...(raw?.autoRespond === false ? { autoRespond: false } : {}),
        // 接收 gal 正文（IGS）同平台帖子的「同步社区」：只在为 true 时写出；不能接收的平台丢弃。
        ...(raw?.igsSync === true && IGS_SYNC_PLATFORMS.includes(platform) ? { igsSync: true } : {}),
        preset,
        styleInput: text(raw?.styleInput, 2000),
        generatedPrompt: text(raw?.generatedPrompt, 6000),
        themeAccent: normalizeThemeAccent(raw?.themeAccent),
        ...(tonight ? { tonight } : {}),
        ...(hot.length ? { hot } : {}),
        createdAt,
        updatedAt: finitePositiveNumber(raw?.updatedAt) || createdAt,
        posts: list(raw?.posts).map((post, index) => normalizePost(post, {
            scope, scopeId, sourceVersion, strictLegacy, path: `scenes.${sceneId}.posts.${index}`,
        })).filter(Boolean).slice(-INTERACTIVE_LIMITS.posts),
    };
    if (isV3) {
        const floorRollback = normalizeFloorRollback(raw?.floorRollback, { scope, scopeId, sourceVersion, strictLegacy: false, path: `scenes.${sceneId}.floorRollback` });
        if (floorRollback.length) scene.floorRollback = floorRollback;
    }
    const live = isV3 ? null : {
        title: text(raw?.live?.title, 100),
        danmaku: list(raw?.live?.danmaku).map((item, index) => normalizeDanmaku(item, {
            scope, scopeId, sourceVersion, strictLegacy, path: `scenes.${sceneId}.live.danmaku.${index}`,
        })).filter(Boolean).slice(-INTERACTIVE_LIMITS.danmaku),
    };
    return { scene, live };
}

// 单独归一化一个 scene。旧版 scene.live 在此被丢弃；整库迁移请走 normalizeInteractiveStore。
export function normalizeScene(raw, options = {}) {
    const sourceVersion = options.sourceVersion;
    return withStrictTag(sourceVersion === LEGACY_V2_STORE_VERSION ? LEGACY_V2_STORE_VERSION : INTERACTIVE_STORE_VERSION,
        () => normalizeSceneWithLegacyLive(raw, options).scene);
}

// 豆瓣引用楼层：在 comments[0..beforeIndex) 里找与 quote（作者名）同名的最近一条评论，返回它的 id；找不到返回空串。
export function findQuoteTargetId(comments, quote, beforeIndex = list(comments).length) {
    const name = text(quote, 80);
    if (!name) return '';
    const source = list(comments);
    for (let index = Math.min(beforeIndex, source.length) - 1; index >= 0; index -= 1) {
        if (source[index]?.authorNameSnapshot === name && source[index]?.id) return source[index].id;
    }
    return '';
}

// extras.quoteId 必须指向同帖已有评论，extras.rating 必须是 1-5 的整数；非法值丢弃，不影响评论本身。
// 删除前记旧版本（删楼回退用）：从后往前记，回退时从新到旧撤销，前一项总会先被插回。正文同步来的不记。
function recordRemoval(container, target, items, ids, postId = '') {
    const wanted = new Set(ids);
    for (let index = items.length - 1; index >= 0; index -= 1) {
        const item = items[index];
        if (!wanted.has(item?.id) || item?.source?.type === 'igs') continue;
        recordCommunityChange(container, {
            target, op: 'remove', ...(postId ? { postId } : {}), entry: item,
            afterId: index > 0 ? items[index - 1].id : null, index,
        });
    }
}

export function addSceneComment(scope, scopeId, scene, postId, authorSeed, content, extras = {}) {
    const post = scene?.posts?.find(item => item.id === postId);
    const normalizedContent = text(content, 1000);
    if (!post) throw new Error('帖子不存在');
    if (!normalizedContent) throw new Error('评论内容不能为空');
    const author = resolveInteractiveAuthor(scope, scopeId, authorSeed?.displayName, authorSeed);
    const quoteId = typeof extras?.quoteId === 'string' && post.comments.some(comment => comment.id === extras.quoteId) ? extras.quoteId : '';
    post.comments.push({
        id: id('comment'), ...author, content: normalizedContent, createdAt: Date.now(),
        ...(quoteId ? { quoteId } : {}), ...(validRatingValue(extras?.rating) ? { rating: extras.rating } : {}),
        ...communityFloorMark(),
    });
    post.comments = post.comments.slice(-INTERACTIVE_LIMITS.comments);
    scene.updatedAt = Date.now();
    return post.comments.at(-1);
}

// 微博热搜：只给 weibo 社区写；条目经 normalizeHot 校验，空结果不改动原有热搜。
export function setSceneHot(scene, hot) {
    if (!scene) throw new Error('互动场景不存在');
    const items = normalizeHot(hot);
    if (!items.length) return false;
    scene.hot = items;
    scene.updatedAt = Date.now();
    return true;
}

// 夜间信箱：只给 night 社区写；openedAt 记当前时间，title 非法时不改动。
export function setSceneTonight(scene, tonight, openedAt = Date.now()) {
    if (!scene) throw new Error('互动场景不存在');
    const normalized = normalizeTonight({ title: tonight?.title, openedAt });
    if (!normalized) return false;
    scene.tonight = normalized;
    scene.updatedAt = Date.now();
    return true;
}

// options.place(posts, post)：单条帖子时由调用方决定插入位置（用户新帖随机插入），缺省仍追加到末尾。
export function appendScenePosts(scope, scopeId, scene, items, actorSeeds = [], options = {}) {
    if (!scope || !scene) throw new Error('互动场景不存在');
    const prepared = list(items).flatMap(item => {
        const content = text(item?.content, 4000);
        if (!content) return [];
        const comments = list(item?.comments).flatMap(comment => {
            const commentContent = text(comment?.content, 1000);
            return commentContent ? [{
                author: comment?.author, content: commentContent, quote: text(comment?.quote, 80),
                rating: validRatingValue(comment?.rating) ? comment.rating : 0,
            }] : [];
        }).slice(0, INTERACTIVE_LIMITS.comments);
        return [{
            author: item?.author, authorSeed: item?.authorSeed || null, content,
            tags: list(item?.tags).map(tag => text(tag, 30)).filter(Boolean).slice(0, 5), comments,
            review: normalizePostExtras(item),
        }];
    });
    if (!prepared.length) return [];
    const actorsSnapshot = { ...(scope.actors || {}) };
    const createdAt = Date.now();
    const mark = communityFloorMark();
    let posts;
    try {
        for (const seed of actorSeeds) ensureInteractiveActor(scope, scopeId, seed);
        posts = prepared.map(item => {
            const comments = [];
            item.comments.forEach(comment => {
                // quote 是被引用楼层的作者名：在同帖更靠前的评论里找同名作者的最近一条，找不到就不带 quoteId。
                const quoteId = findQuoteTargetId(comments, comment.quote);
                // 正文同步来的帖子连同自带的回帖由同步对账跟随楼层，不记删楼回退的楼层。
                comments.push({
                    id: id('comment'), ...resolveInteractiveAuthor(scope, scopeId, comment.author),
                    content: comment.content, createdAt,
                    ...(quoteId ? { quoteId } : {}), ...(comment.rating ? { rating: comment.rating } : {}),
                    ...(item.review.source ? {} : mark),
                });
            });
            return {
                id: id('post'),
                ...resolveInteractiveAuthor(scope, scopeId, item.author, item.authorSeed),
                content: item.content, tags: item.tags, comments,
                liked: false, shareCount: 0, shared: false, createdAt, ...item.review,
                ...(item.review.source ? {} : mark),
            };
        });
    } catch (error) {
        scope.actors = actorsSnapshot;
        throw error;
    }
    if (typeof options?.place === 'function' && posts.length === 1) options.place(scene.posts, posts[0]);
    else scene.posts.push(...posts);
    scene.posts = scene.posts.slice(-INTERACTIVE_LIMITS.posts);
    scene.updatedAt = createdAt;
    return posts;
}

export function updateScenePost(scene, postId, content) {
    const post = scene?.posts?.find(item => item.id === postId);
    const normalizedContent = text(content, 4000);
    if (!post) throw new Error('帖子不存在');
    if (!normalizedContent) throw new Error('帖子内容不能为空');
    if (normalizedContent !== post.content) recordCommunityChange(scene, { target: 'post', op: 'edit', id: post.id, content: post.content });
    post.content = normalizedContent;
    scene.updatedAt = Date.now();
}

export function updateSceneComment(scene, postId, commentId, content) {
    const post = scene?.posts?.find(item => item.id === postId);
    const comment = post?.comments?.find(item => item.id === commentId);
    const normalizedContent = text(content, 1000);
    if (!post || !comment) throw new Error('评论不存在');
    if (!normalizedContent) throw new Error('评论内容不能为空');
    if (normalizedContent !== comment.content) recordCommunityChange(scene, { target: 'comment', op: 'edit', postId: post.id, id: comment.id, content: comment.content });
    comment.content = normalizedContent;
    scene.updatedAt = Date.now();
}

export function deleteScenePost(scene, postId) {
    if (!scene?.posts?.some(item => item.id === postId)) throw new Error('帖子不存在');
    recordRemoval(scene, 'post', scene.posts, [postId]);
    scene.posts = scene.posts.filter(item => item.id !== postId);
    scene.updatedAt = Date.now();
}

// 书评区删除整本书：这本书名下的书评连同短评一起删掉。
export function deleteSceneWork(scene, work) {
    const name = String(work || '');
    if (!name || !scene?.posts?.some(item => item.work === name)) throw new Error('这本书不存在');
    recordRemoval(scene, 'post', scene.posts, scene.posts.filter(item => item.work === name).map(item => item.id));
    scene.posts = scene.posts.filter(item => item.work !== name);
    scene.updatedAt = Date.now();
}

export function deleteSceneComment(scene, postId, commentId) {
    const post = scene?.posts?.find(item => item.id === postId);
    if (!post?.comments?.some(item => item.id === commentId)) throw new Error('评论不存在');
    recordRemoval(scene, 'comment', post.comments, [commentId], post.id);
    post.comments = post.comments.filter(item => item.id !== commentId);
    scene.updatedAt = Date.now();
}

// 清空社区贴文：帖子连同评论一起删除，社区本身与风格设定保留。批量清空不进删楼回退，旧版本记录一并作废。
export function clearScenePosts(scene) {
    if (!scene || !Array.isArray(scene.posts)) throw new Error('互动场景不存在');
    const removed = scene.posts.length;
    scene.posts = [];
    delete scene.floorRollback;
    scene.updatedAt = Date.now();
    return removed;
}

// 导入共享模板时带上原社区的贴文：发帖人按同一身份在目标聊天重建；楼层标记与正文来源属于原聊天，不带过来。
export function copyScenePostsAcrossScopes(sourceScope, targetScope, targetScopeId, posts) {
    const remap = item => {
        const actor = sourceScope?.actors?.[item.authorId];
        const seed = actor
            ? { type: actor.type, displayName: actor.displayName, bindingKey: actor.bindingKey, profile: actor.profile, createdAt: actor.createdAt }
            : { type: 'legacy', displayName: item.authorNameSnapshot, bindingKey: `legacy:${canonicalName(item.authorNameSnapshot) || 'anonymous'}` };
        const { floor: _floor, floorAnchor: _anchor, source: _source, ...rest } = structuredClone(item);
        return { ...rest, authorId: ensureInteractiveActor(targetScope, targetScopeId, seed).actorId };
    };
    return list(posts).map(post => {
        const copy = remap(post);
        copy.comments = list(post.comments).map(remap);
        return copy;
    });
}

// likerName：朋友圈点赞时把用户名写进点赞名单（取消赞时移除）；其余平台不传。
export function toggleScenePostLike(scene, postId, likerName = '') {
    const post = scene?.posts?.find(item => item.id === postId);
    if (!post) throw new Error('帖子不存在');
    post.liked = !post.liked;
    const name = text(likerName, 80);
    if (name) {
        const others = list(post.likers).filter(item => item !== name);
        const likers = post.liked ? [...others, name].slice(-MOMENTS_LIKERS_MAX) : others;
        if (likers.length) post.likers = likers; else delete post.likers;
    }
    scene.updatedAt = Date.now();
}

export function incrementScenePostShare(scene, postId) {
    const post = scene?.posts?.find(item => item.id === postId);
    if (!post) throw new Error('帖子不存在');
    if (!Number.isSafeInteger(post.shareCount) || post.shareCount < 0) throw new Error('帖子分享数无效');
    if (post.shared === true) return false;
    post.shareCount += 1;
    post.shared = true;
    scene.updatedAt = Date.now();
    return true;
}

// 直播是独立 App：社区被删除时保留其直播间，只去掉 sourceSceneId，使它成为独立房间。
function detachLiveRoomsFromScene(scope, sceneId) {
    for (const room of Object.values(scope?.liveRooms || {})) {
        if (room?.sourceSceneId === sceneId) delete room.sourceSceneId;
    }
}

export function deleteInteractiveScene(scope, sceneId) {
    if (!scope?.scenes?.[sceneId]) throw new Error('互动场景不存在');
    detachLiveRoomsFromScene(scope, sceneId);
    delete scope.scenes[sceneId];
    scope.sceneOrder = scope.sceneOrder.filter(idValue => idValue !== sceneId);
    scope.activeSceneId = scope.scenes[scope.activeSceneId] ? scope.activeSceneId : scope.sceneOrder.at(-1) || null;
}

export function enforceInteractiveSceneLimit(scope) {
    while (scope.sceneOrder.length > INTERACTIVE_LIMITS.scenes) {
        const removedId = scope.sceneOrder.shift();
        detachLiveRoomsFromScene(scope, removedId);
        delete scope.scenes[removedId];
    }
}

export function createEmptyInteractiveScope() {
    return { activeSceneId: null, sceneOrder: [], scenes: {}, actors: {}, liveRooms: {}, liveOrder: [], videos: {}, videoOrder: [] };
}

const liveRoomIdFor = (scopeId, sceneId) => `live_${stableHash(`${scopeId}\u0000${sceneId}`)}`;
export const LIVE_HOST_SETTING_MAX = 1000;

function normalizeLiveRoom(raw, roomId, scope, scopeId) {
    const label = `liveRoom ${roomId}`;
    assertV2Keys(raw, [
        'id', 'title', 'hostIsUser', 'hostActorId', 'hostNameSnapshot', 'hostSetting', 'category', 'nsfw', 'sourceSceneId', 'createdAt', 'updatedAt', 'danmaku', 'source', 'ended', 'floorRollback',
    ], label);
    assertV2Text(raw.id, 80, `${label}.id`);
    // 从 gal 正文（IGS）同步来的直播间：source.key 是「主播 + 标题」的标识；ended 表示正文里已下播。
    if (Object.hasOwn(raw, 'source')) {
        assertV2Keys(raw.source, ['type', 'key'], `${label}.source`);
        if (raw.source.type !== 'igs') throw new Error(`互动场景 ${strictTag} ${label}.source.type 必须是 igs`);
        assertV2Text(raw.source.key, 120, `${label}.source.key`);
    }
    if (Object.hasOwn(raw, 'ended') && raw.ended !== true) throw new Error(`互动场景 ${strictTag} ${label}.ended 只能是 true`);
    if (raw.id !== roomId) throw new Error(`互动场景 ${strictTag} scope ${scopeId}.${label}.id 必须与直播间键一致`);
    assertV2Text(raw.title, 100, `${label}.title`);
    if (typeof raw.hostIsUser !== 'boolean') throw new Error(`互动场景 ${strictTag} ${label}.hostIsUser 必须是布尔值`);
    if (Object.hasOwn(raw, 'hostActorId')) {
        const hostActorId = assertV2DictionaryKey(raw.hostActorId, 80, `${label}.hostActorId`);
        if (!Object.hasOwn(scope.actors, hostActorId)) throw new Error(`互动场景 ${strictTag} ${label} 引用了不存在的 actor：${hostActorId}`);
    }
    assertV2Text(raw.hostNameSnapshot, 80, `${label}.hostNameSnapshot`, { allowEmpty: true });
    if (Object.hasOwn(raw, 'hostSetting')) assertV2Text(raw.hostSetting, LIVE_HOST_SETTING_MAX, `${label}.hostSetting`, { allowEmpty: true });
    assertV2Text(raw.category, 12, `${label}.category`, { allowEmpty: true });
    if (typeof raw.nsfw !== 'boolean') throw new Error(`互动场景 ${strictTag} ${label}.nsfw 必须是布尔值`);
    if (Object.hasOwn(raw, 'sourceSceneId')) assertV2Text(raw.sourceSceneId, 80, `${label}.sourceSceneId`);
    assertV2Timestamp(raw.createdAt, `${label}.createdAt`); assertV2Timestamp(raw.updatedAt, `${label}.updatedAt`);
    assertV2List(raw.danmaku, `${label}.danmaku`);
    if (raw.danmaku.length > INTERACTIVE_LIMITS.danmaku) throw new Error(`互动场景 ${strictTag} ${label}.danmaku 不能超过 ${INTERACTIVE_LIMITS.danmaku} 项`);
    return {
        id: roomId,
        title: raw.title,
        hostIsUser: raw.hostIsUser,
        ...(Object.hasOwn(raw, 'hostActorId') ? { hostActorId: raw.hostActorId } : {}),
        hostNameSnapshot: raw.hostNameSnapshot,
        ...(raw.hostSetting ? { hostSetting: raw.hostSetting } : {}),
        category: raw.category,
        nsfw: raw.nsfw,
        ...(Object.hasOwn(raw, 'sourceSceneId') ? { sourceSceneId: raw.sourceSceneId } : {}),
        ...(Object.hasOwn(raw, 'source') ? { source: { type: 'igs', key: raw.source.key } } : {}),
        ...(raw.ended === true ? { ended: true } : {}),
        createdAt: raw.createdAt,
        updatedAt: raw.updatedAt,
        danmaku: raw.danmaku.map((item, index) => normalizeDanmaku(item, {
            scope, scopeId, sourceVersion: INTERACTIVE_STORE_VERSION, strictLegacy: false, path: `liveRooms.${roomId}.danmaku.${index}`,
        })).filter(Boolean),
        ...rollbackField(normalizeFloorRollback(raw.floorRollback, { scope, scopeId, sourceVersion: INTERACTIVE_STORE_VERSION, strictLegacy: false, path: `liveRooms.${roomId}.floorRollback` })),
    };
}

// 供权限层读取单个直播间：按 v3 严格规则校验并返回归一化副本，非法数据抛错。
export function normalizeLiveRoomSnapshot(raw, roomId, actors, scopeId) {
    return withStrictTag(INTERACTIVE_STORE_VERSION, () => normalizeLiveRoom(raw, roomId, { actors: actors || {} }, scopeId));
}

// v3 scope 的 liveRooms / liveOrder：校验规则与 scenes / sceneOrder 一致。
function normalizeScopeLiveRooms(value, scope, scopeId) {
    assertDataObject(value.liveRooms, `互动场景 ${strictTag} scope ${scopeId}.liveRooms`);
    assertV2List(value.liveOrder, `scope ${scopeId}.liveOrder`);
    if (value.liveOrder.length > INTERACTIVE_LIMITS.liveRooms) throw new Error(`互动场景 ${strictTag} scope ${scopeId}.liveOrder 不能超过 ${INTERACTIVE_LIMITS.liveRooms} 项`);
    const orderedIds = new Set();
    for (const roomId of value.liveOrder) {
        assertV2DictionaryKey(roomId, 80, `scope ${scopeId}.liveOrder item`);
        if (orderedIds.has(roomId)) throw new Error(`互动场景 ${strictTag} scope ${scopeId}.liveOrder 包含重复直播间：${roomId}`);
        orderedIds.add(roomId);
    }
    const roomKeys = Object.keys(value.liveRooms).map(roomKey => assertV2DictionaryKey(roomKey, 80, `scope ${scopeId}.liveRoom key`));
    const orphanRoomId = roomKeys.find(roomKey => !orderedIds.has(roomKey));
    if (orphanRoomId) throw new Error(`互动场景 ${strictTag} scope ${scopeId}.liveRooms 包含未列入 liveOrder 的直播间：${orphanRoomId}`);
    const missingRoomId = value.liveOrder.find(roomId => !Object.hasOwn(value.liveRooms, roomId));
    if (missingRoomId) throw new Error(`互动场景 ${strictTag} scope ${scopeId}.liveOrder 引用了不存在的直播间：${missingRoomId}`);
    for (const roomId of value.liveOrder) scope.liveRooms[roomId] = normalizeLiveRoom(value.liveRooms[roomId], roomId, scope, scopeId);
    scope.liveOrder = Object.keys(scope.liveRooms);
}

// v1/v2 → v3：每个有弹幕的 scene 生成一间直播间，id 由 scopeId + sceneId 稳定哈希得出，重复迁移结果一致；liveOrder 按 sceneOrder 顺序。
function migrateLegacyLivesToRooms(scope, scopeId, legacyLives) {
    for (const sceneId of scope.sceneOrder) {
        const live = legacyLives.get(sceneId);
        if (!live || !live.danmaku.length) continue;
        const scene = scope.scenes[sceneId];
        const roomId = liveRoomIdFor(scopeId, sceneId);
        scope.liveRooms[roomId] = {
            id: roomId,
            title: live.title || text(`${scene.title} 直播间`, 100),
            hostIsUser: false,
            hostNameSnapshot: text(scene.title, 80),
            category: '',
            nsfw: false,
            sourceSceneId: sceneId,
            createdAt: scene.createdAt,
            updatedAt: scene.updatedAt,
            danmaku: live.danmaku,
        };
        scope.liveOrder.push(roomId);
    }
}

export function enforceLiveRoomLimit(scope) {
    while (scope.liveOrder.length > INTERACTIVE_LIMITS.liveRooms) {
        const removedId = scope.liveOrder.shift();
        delete scope.liveRooms[removedId];
    }
}

export function findLiveRoomForScene(scope, sceneId) {
    for (const roomId of Array.isArray(scope?.liveOrder) ? scope.liveOrder : []) {
        const room = Object.hasOwn(scope.liveRooms || {}, roomId) ? scope.liveRooms[roomId] : null;
        if (room && room.sourceSceneId === sceneId) return room;
    }
    return null;
}

// 旧直播页没有「开播」字段：直播间里出现过非用户（热场）发言即视为已开播。
export function isLiveRoomWarmedUp(scope, room) {
    return (room?.danmaku || []).some(item => scope?.actors?.[item.authorId]?.type !== 'user');
}

export function createLiveRoom(scope, scopeId, seed = {}) {
    if (!scope) throw new Error('互动场景不存在');
    if (!scope.liveRooms || typeof scope.liveRooms !== 'object') scope.liveRooms = {};
    if (!Array.isArray(scope.liveOrder)) scope.liveOrder = [];
    const timestamp = Date.now();
    const sourceSceneId = optionalText(seed?.sourceSceneId, 80);
    const preferredId = sourceSceneId ? liveRoomIdFor(scopeId, sourceSceneId) : '';
    const roomId = preferredId && !Object.hasOwn(scope.liveRooms, preferredId) ? preferredId : id('live');
    const hostActorId = optionalText(seed?.hostActorId, 80);
    const room = {
        id: roomId,
        title: optionalText(seed?.title, 100) || '直播间',
        hostIsUser: seed?.hostIsUser === true,
        ...(hostActorId && Object.hasOwn(scope.actors || {}, hostActorId) ? { hostActorId } : {}),
        hostNameSnapshot: optionalText(seed?.hostNameSnapshot, 80),
        ...(optionalText(seed?.hostSetting, LIVE_HOST_SETTING_MAX) ? { hostSetting: optionalText(seed?.hostSetting, LIVE_HOST_SETTING_MAX) } : {}),
        category: optionalText(seed?.category, 12),
        nsfw: seed?.nsfw === true,
        ...(sourceSceneId ? { sourceSceneId } : {}),
        createdAt: timestamp,
        updatedAt: timestamp,
        danmaku: [],
    };
    scope.liveRooms[roomId] = room;
    scope.liveOrder.push(roomId);
    enforceLiveRoomLimit(scope);
    return room;
}

// 编辑直播间：只改开播页上的字段；弹幕、来源社区和创建时间保持不变。
// patch.hostActorId 为空时去掉主播绑定；调用方负责确认 actor 存在。
export function updateLiveRoom(scope, roomId, patch = {}) {
    const room = scope?.liveRooms && Object.hasOwn(scope.liveRooms, roomId) ? scope.liveRooms[roomId] : null;
    if (!room) throw new Error('直播间不存在');
    const title = optionalText(patch?.title, 100);
    if (!title) throw new Error('直播间标题不能为空');
    const hostActorId = optionalText(patch?.hostActorId, 80);
    if (hostActorId && !Object.hasOwn(scope.actors || {}, hostActorId)) throw new Error('主播角色不存在');
    const hostSetting = optionalText(patch?.hostSetting, LIVE_HOST_SETTING_MAX);
    room.title = title;
    room.category = optionalText(patch?.category, 12);
    room.hostIsUser = patch?.hostIsUser === true;
    if (hostActorId && !room.hostIsUser) room.hostActorId = hostActorId; else delete room.hostActorId;
    room.hostNameSnapshot = optionalText(patch?.hostNameSnapshot, 80);
    if (hostSetting) room.hostSetting = hostSetting; else delete room.hostSetting;
    room.nsfw = patch?.nsfw === true;
    room.updatedAt = Date.now();
    return room;
}

export function deleteLiveRoom(scope, roomId) {
    if (!scope?.liveRooms || !Object.hasOwn(scope.liveRooms, roomId)) throw new Error('直播间不存在');
    delete scope.liveRooms[roomId];
    scope.liveOrder = scope.liveOrder.filter(idValue => idValue !== roomId);
}

export function appendLiveDanmaku(scope, scopeId, room, items, actorSeeds = []) {
    if (!scope || !room) throw new Error('直播间不存在');
    const prepared = list(items).flatMap(item => {
        const content = text(item?.content, 200);
        return content ? [{
            author: item?.author, authorSeed: item?.authorSeed || null, content,
            kind: LIVE_DANMAKU_KINDS.includes(item?.kind) ? item.kind : 'chat',
        }] : [];
    });
    if (!prepared.length) return [];
    const actorsSnapshot = { ...(scope.actors || {}) };
    const createdAt = Date.now();
    let entries;
    try {
        for (const seed of actorSeeds) ensureInteractiveActor(scope, scopeId, seed);
        const mark = communityFloorMark();
        entries = prepared.map(item => ({
            id: id('danmaku'),
            ...resolveInteractiveAuthor(scope, scopeId, item.author, item.authorSeed),
            content: item.content, createdAt, kind: item.kind, ...mark,
        }));
    } catch (error) {
        scope.actors = actorsSnapshot;
        throw error;
    }
    room.danmaku.push(...entries);
    room.danmaku = room.danmaku.slice(-INTERACTIVE_LIMITS.danmaku);
    room.updatedAt = createdAt;
    return entries;
}

export function updateLiveDanmaku(room, danmakuId, content) {
    const danmaku = room?.danmaku?.find(item => item.id === danmakuId);
    const normalizedContent = text(content, 200);
    if (!danmaku) throw new Error('弹幕不存在');
    if (!normalizedContent) throw new Error('弹幕内容不能为空');
    if (normalizedContent !== danmaku.content) recordCommunityChange(room, { target: 'danmaku', op: 'edit', id: danmaku.id, content: danmaku.content });
    danmaku.content = normalizedContent;
    room.updatedAt = Date.now();
}

export function deleteLiveDanmaku(room, danmakuId) {
    if (!room?.danmaku?.some(item => item.id === danmakuId)) throw new Error('弹幕不存在');
    recordRemoval(room, 'danmaku', room.danmaku, [danmakuId]);
    room.danmaku = room.danmaku.filter(item => item.id !== danmakuId);
    room.updatedAt = Date.now();
}

// 接受 v1、v2、v3，输出永远是 v3：v1/v2 的 scene.live 迁成 scope 级直播间。
export function normalizeInteractiveStore(raw) {
    const result = createEmptyInteractiveStore();
    if (raw === null || raw === undefined) return result;
    assertDataObject(raw, '互动场景 store');
    const hasVersion = Object.hasOwn(raw, 'version');
    if (hasVersion && ![1, LEGACY_V2_STORE_VERSION, INTERACTIVE_STORE_VERSION].includes(raw.version)) throw new Error(`互动场景版本 ${raw.version} 不受支持`);
    const sourceVersion = hasVersion && isStrictVersion(raw.version) ? raw.version : 1;
    return withStrictTag(sourceVersion, () => normalizeStoreScopes(raw, result, sourceVersion));
}

function normalizeStoreScopes(raw, result, sourceVersion) {
    const isV3 = sourceVersion === INTERACTIVE_STORE_VERSION;
    if (isStrictVersion(sourceVersion)) {
        assertV2Keys(raw, ['version', 'scopes'], 'store');
        if (!Object.hasOwn(raw, 'scopes')) throw new Error(`互动场景 ${strictTag} scopes 缺失`);
        assertDataObject(raw.scopes, `互动场景 ${strictTag} scopes`);
    } else {
        assertV1Keys(raw, ['version', 'scopes'], 'store');
        if (!Object.hasOwn(raw, 'scopes')) throw new Error('互动场景 v1 store.scopes 缺失');
        assertV1Object(raw.scopes, 'store.scopes');
    }
    const normalizedScopeIds = new Set();
    for (const [rawScopeId, value] of Object.entries(raw.scopes || {})) {
        const scopeId = isStrictVersion(sourceVersion)
            ? assertV2DictionaryKey(rawScopeId, 160, 'scope key')
            : normalizeV1DictionaryKey(rawScopeId, 160, 'scope key');
        if (!scopeId) continue;
        if (normalizedScopeIds.has(scopeId)) throw new Error(`互动场景 v${sourceVersion} scope key 归一化后冲突：${scopeId}`);
        normalizedScopeIds.add(scopeId);
        if (isStrictVersion(sourceVersion)) {
            const scopeKeys = ['activeSceneId', 'sceneOrder', 'scenes', 'actors', ...(isV3 ? ['liveRooms', 'liveOrder'] : [])];
            // 视频是 v3 内的可选键（缺省视为空），不进必填清单。
            assertV2Keys(value, isV3 ? [...scopeKeys, 'videos', 'videoOrder'] : scopeKeys, `scope ${scopeId}`);
            for (const key of scopeKeys) {
                if (!Object.hasOwn(value, key)) throw new Error(`互动场景 ${strictTag} scope ${scopeId}.${key} 缺失`);
            }
            if (value.activeSceneId !== null && typeof value.activeSceneId !== 'string') throw new Error(`互动场景 ${strictTag} scope ${scopeId}.activeSceneId 无效`);
            if (typeof value.activeSceneId === 'string') assertV2Text(value.activeSceneId, 80, `scope ${scopeId}.activeSceneId`);
            assertV2List(value.sceneOrder, `scope ${scopeId}.sceneOrder`);
            if (value.sceneOrder.length > INTERACTIVE_LIMITS.scenes) throw new Error(`互动场景 ${strictTag} scope ${scopeId}.sceneOrder 不能超过 ${INTERACTIVE_LIMITS.scenes} 项`);
            value.sceneOrder.forEach((sceneId, index) => assertV2Text(sceneId, 80, `scope ${scopeId}.sceneOrder.${index}`));
            assertDataObject(value.scenes, `互动场景 ${strictTag} scope ${scopeId}.scenes`);
        } else {
            assertV1Keys(value, ['activeSceneId', 'sceneOrder', 'scenes'], `scope ${scopeId}`);
            if (Object.hasOwn(value, 'activeSceneId') && value.activeSceneId !== null && typeof value.activeSceneId !== 'string') throw new Error(`互动场景 v1 scope ${scopeId}.activeSceneId 必须是字符串或 null`);
            assertV1OptionalArray(value, 'sceneOrder', `scope ${scopeId}`);
            if (!Object.hasOwn(value, 'sceneOrder')) throw new Error(`互动场景 v1 scope ${scopeId}.sceneOrder 缺失`);
            assertV1Object(value.scenes, `scope ${scopeId}.scenes`);
        }
        const scope = createEmptyInteractiveScope();
        if (isStrictVersion(sourceVersion)) {
            if (!value.actors || typeof value.actors !== 'object' || Array.isArray(value.actors)) throw new Error(`互动场景 ${strictTag} scope ${scopeId} 缺少 actors registry`);
            for (const [rawActorId, actorValue] of Object.entries(value.actors)) {
                const actorId = assertV2DictionaryKey(rawActorId, 80, `scope ${scopeId}.actor key`);
                assertV2Actor(actorValue, actorId, scopeId);
                scope.actors[actorId] = normalizeActor(actorValue, actorId);
            }
        }
        const sceneValues = new Map();
        for (const [rawSceneId, sceneValue] of Object.entries(value.scenes || {})) {
            const sceneId = isStrictVersion(sourceVersion)
                ? assertV2DictionaryKey(rawSceneId, 80, `scope ${scopeId}.scene key`)
                : normalizeV1DictionaryKey(rawSceneId, 80, `scope ${scopeId}.scene key`);
            if (!sceneId) continue;
            if (sceneValues.has(sceneId)) throw new Error(`互动场景 v${sourceVersion} scope ${scopeId}.scene key 归一化后冲突：${sceneId}`);
            if (sourceVersion === 1) {
                assertV1Scene(sceneValue, `scope ${scopeId}.scene ${sceneId}`);
                if (Object.hasOwn(sceneValue, 'id')) {
                    const normalizedSceneValueId = normalizeV1DictionaryKey(sceneValue.id, 80, `scope ${scopeId}.scene ${sceneId}.id`);
                    if (normalizedSceneValueId !== sceneId) throw new Error(`互动场景 v1 scope ${scopeId}.scene ${sceneId}.id 必须与场景键一致`);
                }
            }
            sceneValues.set(sceneId, sceneValue);
        }
        const order = isStrictVersion(sourceVersion)
            ? [...value.sceneOrder]
            : value.sceneOrder.map(key => {
                if (typeof key !== 'string') throw new Error(`互动场景 v1 scope ${scopeId}.sceneOrder 必须是字符串数组`);
                return normalizeV1DictionaryKey(key, 80, `scope ${scopeId}.sceneOrder item`);
            }).filter(Boolean).slice(-INTERACTIVE_LIMITS.scenes);
        if (sourceVersion === 1 && new Set(order).size !== order.length) throw new Error(`互动场景 v1 scope ${scopeId}.sceneOrder 归一化后包含重复场景`);
        if (isStrictVersion(sourceVersion)) {
            const orderedIds = new Set();
            for (const sceneId of order) {
                assertV2DictionaryKey(sceneId, 80, `scope ${scopeId}.sceneOrder item`);
                if (orderedIds.has(sceneId)) throw new Error(`互动场景 ${strictTag} scope ${scopeId}.sceneOrder 包含重复场景：${sceneId}`);
                orderedIds.add(sceneId);
            }
            const sceneIds = [...sceneValues.keys()];
            const orphanSceneId = sceneIds.find(sceneId => !orderedIds.has(sceneId));
            if (orphanSceneId) throw new Error(`互动场景 ${strictTag} scope ${scopeId}.scenes 包含未列入 sceneOrder 的场景：${orphanSceneId}`);
            const missingSceneId = order.find(sceneId => !sceneValues.has(sceneId));
            if (missingSceneId) throw new Error(`互动场景 ${strictTag} scope ${scopeId}.sceneOrder 引用了不存在的场景：${missingSceneId}`);
            if (value.activeSceneId === null && order.length) throw new Error(`互动场景 ${strictTag} scope ${scopeId}.activeSceneId 不能在存在场景时为 null`);
            if (typeof value.activeSceneId === 'string' && !orderedIds.has(value.activeSceneId)) throw new Error(`互动场景 ${strictTag} scope ${scopeId}.activeSceneId 未指向有效场景`);
        }
        const legacyLives = new Map();
        for (const key of order) {
            if (!sceneValues.has(key)) throw new Error(`互动场景 v${sourceVersion} scope ${scopeId}.sceneOrder 引用了不存在的场景：${key}`);
            const rawSceneValue = sceneValues.get(key);
            if (!rawSceneValue || typeof rawSceneValue !== 'object' || Array.isArray(rawSceneValue)) {
                throw new Error(`互动场景 v${sourceVersion} scope ${scopeId}.scene ${key} 格式无效`);
            }
            let sceneValue = rawSceneValue;
            if (isStrictVersion(sourceVersion)) {
                if (sceneValue.id !== key) throw new Error(`互动场景 ${strictTag} scope ${scopeId}.scene ${key}.id 必须与场景键一致`);
            } else {
                if (Object.hasOwn(sceneValue, 'id') && typeof sceneValue.id !== 'string') throw new Error(`互动场景 v1 scope ${scopeId}.scene ${key}.id 必须是字符串`);
                const sceneId = Object.hasOwn(sceneValue, 'id') ? normalizeV1DictionaryKey(sceneValue.id, 80, `scope ${scopeId}.scene ${key}.id`) : key;
                if (sceneId !== key) throw new Error(`互动场景 v1 scope ${scopeId}.scene ${key}.id 必须与场景键一致`);
                sceneValue = { ...sceneValue, id: key };
            }
            const { scene, live } = normalizeSceneWithLegacyLive(sceneValue, { scope, scopeId, sourceVersion, strictLegacy: sourceVersion === 1 });
            scope.scenes[key] = scene;
            if (live) legacyLives.set(key, live);
        }
        scope.sceneOrder = Object.keys(scope.scenes);
        if (isV3) { normalizeScopeLiveRooms(value, scope, scopeId); withStrictTag(INTERACTIVE_STORE_VERSION, () => normalizeScopeVideos(value, scope, scopeId)); }
        else migrateLegacyLivesToRooms(scope, scopeId, legacyLives);
        if (sourceVersion === 1 && value.activeSceneId !== undefined && value.activeSceneId !== null && typeof value.activeSceneId !== 'string') throw new Error(`互动场景 v1 scope ${scopeId}.activeSceneId 必须是字符串或 null`);
        const normalizedActiveSceneId = isStrictVersion(sourceVersion) ? value.activeSceneId : normalizeV1DictionaryKey(value.activeSceneId, 80, `scope ${scopeId}.activeSceneId`);
        scope.activeSceneId = isStrictVersion(sourceVersion)
            ? value.activeSceneId
            : Object.hasOwn(scope.scenes, normalizedActiveSceneId) ? normalizedActiveSceneId : scope.sceneOrder.at(-1) || null;
        result.scopes[scopeId] = scope;
    }
    return result;
}
