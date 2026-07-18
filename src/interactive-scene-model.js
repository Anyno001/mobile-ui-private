export const INTERACTIVE_LIMITS = Object.freeze({ scenes: 12, posts: 80, comments: 40, danmaku: 240 });
export const INTERACTIVE_STORE_VERSION = 2;
export const INTERACTIVE_ACTOR_TYPES = Object.freeze(['user', 'story', 'passerby', 'legacy']);
export const PHONE_UI_STATE_VERSION = 1;
export const PHONE_UI_PAGES = Object.freeze(['desktop', 'chat', 'community', 'calendar']);
export const PHONE_UI_TABS = Object.freeze(['feed', 'live', 'prompt']);

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
const assertV2Keys = (raw, allowedKeys, label) => {
    assertDataObject(raw, `互动场景 v2 ${label}`);
    const allowed = new Set(allowedKeys);
    const unsupported = Object.keys(raw).find(key => !allowed.has(key));
    if (unsupported) throw new Error(`互动场景 v2 ${label} 包含额外字段：${unsupported}`);
};
const assertV2Text = (value, max, label, { allowEmpty = false } = {}) => {
    if (typeof value !== 'string') throw new Error(`互动场景 v2 ${label} 必须是字符串`);
    if (value !== value.trim()) throw new Error(`互动场景 v2 ${label} 不能包含首尾空白`);
    if (!allowEmpty && !value) throw new Error(`互动场景 v2 ${label} 不能为空`);
    if (value.length > max) throw new Error(`互动场景 v2 ${label} 长度不能超过 ${max}`);
};
const assertV2Timestamp = (value, label) => {
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) throw new Error(`互动场景 v2 ${label} 必须是有效时间戳`);
};
const assertV2AuthorFields = (raw, label) => {
    assertV2Text(raw.authorId, 80, `${label}.authorId`);
    assertV2Text(raw.authorNameSnapshot, 80, `${label}.authorNameSnapshot`);
};
const assertV2List = (value, label) => {
    assertDataArray(value, `互动场景 v2 ${label}`);
};
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
    assertV1Keys(live, ['title', 'status', 'danmaku'], liveLabel);
    assertV1OptionalText(live, 'title', liveLabel);
    if (Object.hasOwn(live, 'status') && live.status !== 'idle') throw new Error(`互动场景 v1 ${liveLabel}.status 必须是 idle`);
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
    return assertSafeDictionaryKey(value, `v2 ${label}`);
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
    if (rawStore === null || rawStore === undefined || typeof rawStore !== 'object' || Array.isArray(rawStore)) return { store: rawStore, changed: false };
    assertDataObject(rawStore, '互动场景持久化 store');
    if (rawStore.version !== INTERACTIVE_STORE_VERSION) return { store: rawStore, changed: false };
    assertDataObject(rawStore.scopes, '互动场景持久化 scopes');
    let changed = false;
    const scopes = { ...rawStore.scopes };
    for (const [scopeId, rawScope] of Object.entries(rawStore.scopes)) {
        assertDataObject(rawScope, `互动场景持久化 scope ${scopeId}`);
        assertDataObject(rawScope.scenes, `互动场景持久化 scope ${scopeId}.scenes`);
        let scenes = rawScope.scenes;
        for (const [sceneId, rawScene] of Object.entries(rawScope.scenes)) {
            assertDataObject(rawScene, `互动场景持久化 scope ${scopeId}.scene ${sceneId}`);
            const ratingDescriptor = Object.getOwnPropertyDescriptor(rawScene, 'contentRating');
            if (!ratingDescriptor || ratingDescriptor.enumerable !== true || typeof ratingDescriptor.value !== 'string') continue;
            if (scenes === rawScope.scenes) scenes = { ...rawScope.scenes };
            const scene = { ...rawScene };
            delete scene.contentRating;
            scenes[sceneId] = scene;
            changed = true;
        }
        if (scenes !== rawScope.scenes) scopes[scopeId] = { ...rawScope, scenes };
    }
    return { store: changed ? { ...rawStore, scopes } : rawStore, changed };
}

export function createDefaultPhoneUiScope() {
    return { pinnedSceneIds: [], lastPage: 'desktop', lastSceneId: null, lastTab: 'feed' };
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
    const interactiveScopes = interactiveStore?.scopes && typeof interactiveStore.scopes === 'object'
        ? interactiveStore.scopes
        : {};
    for (const [storageId, value] of Object.entries(raw.scopes)) {
        if (!storageId || storageId !== storageId.trim() || storageId.length > 160 || isUnsafeDictionaryKey(storageId)) continue;
        if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
        const scenes = interactiveScopes[storageId]?.scenes;
        const availableSceneIds = new Set(scenes && typeof scenes === 'object' ? Object.keys(scenes) : []);
        const pinnedSceneIds = [];
        const seenPins = new Set();
        for (const candidate of Array.isArray(value.pinnedSceneIds) ? value.pinnedSceneIds : []) {
            if (typeof candidate !== 'string' || !candidate || candidate !== candidate.trim() || candidate.length > 80) continue;
            if (!availableSceneIds.has(candidate) || seenPins.has(candidate)) continue;
            seenPins.add(candidate);
            pinnedSceneIds.push(candidate);
        }
        const validLastSceneId = typeof value.lastSceneId === 'string'
            && value.lastSceneId
            && value.lastSceneId === value.lastSceneId.trim()
            && value.lastSceneId.length <= 80
            && availableSceneIds.has(value.lastSceneId);
        const lastSceneId = validLastSceneId ? value.lastSceneId : null;
        let lastPage = PHONE_UI_PAGES.includes(value.lastPage) ? value.lastPage : 'desktop';
        if (lastPage === 'community' && !lastSceneId) lastPage = 'desktop';
        result.scopes[storageId] = {
            pinnedSceneIds,
            lastPage,
            lastSceneId,
            lastTab: PHONE_UI_TABS.includes(value.lastTab) ? value.lastTab : 'feed',
        };
    }
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
                pinnedSceneIds: Object.hasOwn(patch, 'pinnedSceneIds')
                    ? [...(Array.isArray(patch.pinnedSceneIds) ? patch.pinnedSceneIds : [])]
                    : [...currentScope.pinnedSceneIds],
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
    const scope = normalized.scopes[storageId] || createDefaultPhoneUiScope();
    const pinnedSceneIds = scope.pinnedSceneIds.includes(sceneId)
        ? scope.pinnedSceneIds.filter(idValue => idValue !== sceneId)
        : [...scope.pinnedSceneIds, sceneId];
    return patchPhoneUiScope(normalized, storageId, { pinnedSceneIds }, interactiveStore);
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
    if (sourceVersion === INTERACTIVE_STORE_VERSION) {
        const actorId = assertV2DictionaryKey(raw?.authorId, 80, '内容 authorId');
        if (!Object.hasOwn(scope.actors || {}, actorId)) throw new Error(`互动场景 v2 内容引用了不存在的 actor：${actorId}`);
        return { authorId: actorId, authorNameSnapshot: snapshot };
    }
    return actorReference(ensureLegacyActor(scope, scopeId, snapshot, createdAt), snapshot);
}

function normalizeComment(raw, context) {
    if (context.sourceVersion === INTERACTIVE_STORE_VERSION) {
        assertV2Keys(raw, ['id', 'authorId', 'authorNameSnapshot', 'content', 'createdAt'], 'comment');
        assertV2Text(raw.id, 80, 'comment.id'); assertV2AuthorFields(raw, 'comment'); assertV2Text(raw.content, 1000, 'comment.content'); assertV2Timestamp(raw.createdAt, 'comment.createdAt');
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
    };
}

function normalizePost(raw, context) {
    if (context.sourceVersion === INTERACTIVE_STORE_VERSION) {
        assertV2Keys(raw, ['id', 'authorId', 'authorNameSnapshot', 'content', 'tags', 'createdAt', 'comments', 'liked'], 'post');
        assertV2Text(raw.id, 80, 'post.id'); assertV2AuthorFields(raw, 'post'); assertV2Text(raw.content, 4000, 'post.content'); assertV2Timestamp(raw.createdAt, 'post.createdAt');
        assertV2List(raw.tags, 'post.tags');
        if (raw.tags.length > 5) throw new Error('互动场景 v2 post.tags 不能超过 5 项');
        raw.tags.forEach((tag, index) => assertV2Text(tag, 30, `post.tags.${index}`));
        assertV2List(raw.comments, 'post.comments');
        if (raw.comments.length > INTERACTIVE_LIMITS.comments) throw new Error(`互动场景 v2 post.comments 不能超过 ${INTERACTIVE_LIMITS.comments} 项`);
        if (typeof raw.liked !== 'boolean') throw new Error('互动场景 v2 post.liked 必须是布尔值');
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
        comments: list(raw?.comments).map((comment, index) => normalizeComment(comment, {
            ...context, path: `${context.path}.comments.${index}`,
        })).filter(Boolean).slice(-INTERACTIVE_LIMITS.comments),
        liked: !!raw?.liked,
    };
}

function normalizeDanmaku(raw, context) {
    if (context.sourceVersion === INTERACTIVE_STORE_VERSION) {
        assertV2Keys(raw, ['id', 'authorId', 'authorNameSnapshot', 'content', 'createdAt'], 'danmaku');
        assertV2Text(raw.id, 80, 'danmaku.id'); assertV2AuthorFields(raw, 'danmaku'); assertV2Text(raw.content, 200, 'danmaku.content'); assertV2Timestamp(raw.createdAt, 'danmaku.createdAt');
    } else if (context.strictLegacy) {
        assertV1Item(raw, 'danmaku', context.path);
    }
    const content = text(raw?.content, 200);
    if (!content) return null;
    const createdAt = finitePositiveNumber(raw?.createdAt) || 1;
    return {
        id: text(raw?.id, 80) || deterministicItemId('danmaku', context.scopeId, context.path, content),
        ...normalizeAuthor(raw, context.scope, context.scopeId, context.sourceVersion, createdAt),
        content,
        createdAt,
    };
}

function normalizeThemeAccent(value) {
    const accent = String(value ?? '').trim();
    return /^#[0-9a-fA-F]{6}$/.test(accent) ? accent.toLowerCase() : '';
}


export function normalizeScene(raw, options = {}) {
    const scope = options.scope || { actors: {} };
    const scopeId = text(options.scopeId, 160) || '__standalone__';
    const sourceVersion = options.sourceVersion === INTERACTIVE_STORE_VERSION ? INTERACTIVE_STORE_VERSION : 1;
    const strictLegacy = sourceVersion === 1 && options.strictLegacy === true;
    if (sourceVersion === INTERACTIVE_STORE_VERSION) {
        assertV2Keys(raw, ['id', 'title', 'preset', 'styleInput', 'generatedPrompt', 'themeAccent', 'createdAt', 'updatedAt', 'posts', 'live'], 'scene');
        if (raw?.live !== undefined) assertV2Keys(raw.live, ['title', 'status', 'danmaku'], 'live');
        assertV2Text(raw.id, 80, 'scene.id');
        assertV2Text(raw.title, 80, 'scene.title');
        assertV2Text(raw.preset, 30, 'scene.preset');
        assertV2Text(raw.styleInput, 2000, 'scene.styleInput', { allowEmpty: true });
        assertV2Text(raw.generatedPrompt, 6000, 'scene.generatedPrompt', { allowEmpty: true });
        if (raw.themeAccent !== undefined) {
            assertV2Text(raw.themeAccent, 7, 'scene.themeAccent', { allowEmpty: true });
            if (raw.themeAccent && normalizeThemeAccent(raw.themeAccent) !== raw.themeAccent) {
                throw new Error('互动场景 v2 scene.themeAccent 必须是小写六位十六进制颜色');
            }
        }
        assertV2Timestamp(raw.createdAt, 'scene.createdAt'); assertV2Timestamp(raw.updatedAt, 'scene.updatedAt');
        assertV2List(raw.posts, 'scene.posts');
        if (raw.posts.length > INTERACTIVE_LIMITS.posts) throw new Error(`互动场景 v2 scene.posts 不能超过 ${INTERACTIVE_LIMITS.posts} 项`);
        assertV2Text(raw.live.title, 100, 'live.title');
        if (raw.live.status !== 'idle') throw new Error('互动场景 v2 live.status 必须是 idle');
        assertV2List(raw.live.danmaku, 'live.danmaku');
        if (raw.live.danmaku.length > INTERACTIVE_LIMITS.danmaku) throw new Error(`互动场景 v2 live.danmaku 不能超过 ${INTERACTIVE_LIMITS.danmaku} 项`);
    } else if (strictLegacy) {
        assertV1Scene(raw, `scope ${scopeId}.scene ${raw?.id || '(空)'}`);
    }
    const sceneId = text(raw?.id, 80) || id('scene');
    const createdAt = finitePositiveNumber(raw?.createdAt) || 1;
    return {
        id: sceneId,
        title: text(raw?.title, 80) || '未命名互动场景',
        preset: text(raw?.preset, 30) || 'weibo',
        styleInput: text(raw?.styleInput, 2000),
        generatedPrompt: text(raw?.generatedPrompt, 6000),
        themeAccent: normalizeThemeAccent(raw?.themeAccent),
        createdAt,
        updatedAt: finitePositiveNumber(raw?.updatedAt) || createdAt,
        posts: list(raw?.posts).map((post, index) => normalizePost(post, {
            scope, scopeId, sourceVersion, strictLegacy, path: `scenes.${sceneId}.posts.${index}`,
        })).filter(Boolean).slice(-INTERACTIVE_LIMITS.posts),
        live: {
            title: text(raw?.live?.title, 100) || '正在直播',
            status: 'idle',
            danmaku: list(raw?.live?.danmaku).map((item, index) => normalizeDanmaku(item, {
                scope, scopeId, sourceVersion, strictLegacy, path: `scenes.${sceneId}.live.danmaku.${index}`,
            })).filter(Boolean).slice(-INTERACTIVE_LIMITS.danmaku),
        },
    };
}

export function addSceneComment(scope, scopeId, scene, postId, authorSeed, content) {
    const post = scene?.posts?.find(item => item.id === postId);
    const normalizedContent = text(content, 1000);
    if (!post) throw new Error('帖子不存在');
    if (!normalizedContent) throw new Error('评论内容不能为空');
    const author = resolveInteractiveAuthor(scope, scopeId, authorSeed?.displayName, authorSeed);
    post.comments.push({
        id: id('comment'), ...author, content: normalizedContent, createdAt: Date.now(),
    });
    post.comments = post.comments.slice(-INTERACTIVE_LIMITS.comments);
    scene.updatedAt = Date.now();
    return post.comments.at(-1);
}

export function appendScenePosts(scope, scopeId, scene, items, actorSeeds = []) {
    if (!scope || !scene) throw new Error('互动场景不存在');
    const prepared = list(items).flatMap(item => {
        const content = text(item?.content, 4000);
        if (!content) return [];
        const comments = list(item?.comments).flatMap(comment => {
            const commentContent = text(comment?.content, 1000);
            return commentContent ? [{ author: comment?.author, content: commentContent }] : [];
        }).slice(0, INTERACTIVE_LIMITS.comments);
        return [{
            author: item?.author, authorSeed: item?.authorSeed || null, content,
            tags: list(item?.tags).map(tag => text(tag, 30)).filter(Boolean).slice(0, 5), comments,
        }];
    });
    if (!prepared.length) return [];
    const actorsSnapshot = { ...(scope.actors || {}) };
    const createdAt = Date.now();
    let posts;
    try {
        for (const seed of actorSeeds) ensureInteractiveActor(scope, scopeId, seed);
        posts = prepared.map(item => ({
            id: id('post'),
            ...resolveInteractiveAuthor(scope, scopeId, item.author, item.authorSeed),
            content: item.content, tags: item.tags,
            comments: item.comments.map(comment => ({
                id: id('comment'), ...resolveInteractiveAuthor(scope, scopeId, comment.author),
                content: comment.content, createdAt,
            })),
            liked: false, createdAt,
        }));
    } catch (error) {
        scope.actors = actorsSnapshot;
        throw error;
    }
    scene.posts.push(...posts);
    scene.posts = scene.posts.slice(-INTERACTIVE_LIMITS.posts);
    scene.updatedAt = createdAt;
    return posts;
}

export function updateScenePost(scene, postId, content) {
    const post = scene?.posts?.find(item => item.id === postId);
    const normalizedContent = text(content, 4000);
    if (!post) throw new Error('帖子不存在');
    if (!normalizedContent) throw new Error('帖子内容不能为空');
    post.content = normalizedContent;
    scene.updatedAt = Date.now();
}

export function updateSceneComment(scene, postId, commentId, content) {
    const post = scene?.posts?.find(item => item.id === postId);
    const comment = post?.comments?.find(item => item.id === commentId);
    const normalizedContent = text(content, 1000);
    if (!post || !comment) throw new Error('评论不存在');
    if (!normalizedContent) throw new Error('评论内容不能为空');
    comment.content = normalizedContent;
    scene.updatedAt = Date.now();
}

export function deleteScenePost(scene, postId) {
    if (!scene?.posts?.some(item => item.id === postId)) throw new Error('帖子不存在');
    scene.posts = scene.posts.filter(item => item.id !== postId);
    scene.updatedAt = Date.now();
}

export function deleteSceneComment(scene, postId, commentId) {
    const post = scene?.posts?.find(item => item.id === postId);
    if (!post?.comments?.some(item => item.id === commentId)) throw new Error('评论不存在');
    post.comments = post.comments.filter(item => item.id !== commentId);
    scene.updatedAt = Date.now();
}

export function deleteInteractiveScene(scope, sceneId) {
    if (!scope?.scenes?.[sceneId]) throw new Error('互动场景不存在');
    delete scope.scenes[sceneId];
    scope.sceneOrder = scope.sceneOrder.filter(idValue => idValue !== sceneId);
    scope.activeSceneId = scope.scenes[scope.activeSceneId] ? scope.activeSceneId : scope.sceneOrder.at(-1) || null;
}

export function enforceInteractiveSceneLimit(scope) {
    while (scope.sceneOrder.length > INTERACTIVE_LIMITS.scenes) {
        const removedId = scope.sceneOrder.shift();
        delete scope.scenes[removedId];
    }
}

export function normalizeInteractiveStore(raw) {
    const result = createEmptyInteractiveStore();
    if (raw === null || raw === undefined) return result;
    assertDataObject(raw, '互动场景 store');
    const hasVersion = Object.hasOwn(raw, 'version');
    if (hasVersion && ![1, INTERACTIVE_STORE_VERSION].includes(raw.version)) throw new Error(`互动场景版本 ${raw.version} 不受支持`);
    const sourceVersion = hasVersion && raw.version === INTERACTIVE_STORE_VERSION ? INTERACTIVE_STORE_VERSION : 1;
    if (sourceVersion === INTERACTIVE_STORE_VERSION) {
        assertV2Keys(raw, ['version', 'scopes'], 'store');
        if (!Object.hasOwn(raw, 'scopes')) throw new Error('互动场景 v2 scopes 缺失');
        assertDataObject(raw.scopes, '互动场景 v2 scopes');
    } else {
        assertV1Keys(raw, ['version', 'scopes'], 'store');
        if (!Object.hasOwn(raw, 'scopes')) throw new Error('互动场景 v1 store.scopes 缺失');
        assertV1Object(raw.scopes, 'store.scopes');
    }
    const normalizedScopeIds = new Set();
    for (const [rawScopeId, value] of Object.entries(raw.scopes || {})) {
        const scopeId = sourceVersion === INTERACTIVE_STORE_VERSION
            ? assertV2DictionaryKey(rawScopeId, 160, 'scope key')
            : normalizeV1DictionaryKey(rawScopeId, 160, 'scope key');
        if (!scopeId) continue;
        if (normalizedScopeIds.has(scopeId)) throw new Error(`互动场景 v${sourceVersion} scope key 归一化后冲突：${scopeId}`);
        normalizedScopeIds.add(scopeId);
        if (sourceVersion === INTERACTIVE_STORE_VERSION) {
            assertV2Keys(value, ['activeSceneId', 'sceneOrder', 'scenes', 'actors'], `scope ${scopeId}`);
            for (const key of ['activeSceneId', 'sceneOrder', 'scenes', 'actors']) {
                if (!Object.hasOwn(value, key)) throw new Error(`互动场景 v2 scope ${scopeId}.${key} 缺失`);
            }
            if (value.activeSceneId !== null && typeof value.activeSceneId !== 'string') throw new Error(`互动场景 v2 scope ${scopeId}.activeSceneId 无效`);
            if (typeof value.activeSceneId === 'string') assertV2Text(value.activeSceneId, 80, `scope ${scopeId}.activeSceneId`);
            assertV2List(value.sceneOrder, `scope ${scopeId}.sceneOrder`);
            if (value.sceneOrder.length > INTERACTIVE_LIMITS.scenes) throw new Error(`互动场景 v2 scope ${scopeId}.sceneOrder 不能超过 ${INTERACTIVE_LIMITS.scenes} 项`);
            value.sceneOrder.forEach((sceneId, index) => assertV2Text(sceneId, 80, `scope ${scopeId}.sceneOrder.${index}`));
            assertDataObject(value.scenes, `互动场景 v2 scope ${scopeId}.scenes`);
        } else {
            assertV1Keys(value, ['activeSceneId', 'sceneOrder', 'scenes'], `scope ${scopeId}`);
            if (Object.hasOwn(value, 'activeSceneId') && value.activeSceneId !== null && typeof value.activeSceneId !== 'string') throw new Error(`互动场景 v1 scope ${scopeId}.activeSceneId 必须是字符串或 null`);
            assertV1OptionalArray(value, 'sceneOrder', `scope ${scopeId}`);
            if (!Object.hasOwn(value, 'sceneOrder')) throw new Error(`互动场景 v1 scope ${scopeId}.sceneOrder 缺失`);
            assertV1Object(value.scenes, `scope ${scopeId}.scenes`);
        }
        const scope = { activeSceneId: null, sceneOrder: [], scenes: {}, actors: {} };
        if (sourceVersion === INTERACTIVE_STORE_VERSION) {
            if (!value.actors || typeof value.actors !== 'object' || Array.isArray(value.actors)) throw new Error(`互动场景 v2 scope ${scopeId} 缺少 actors registry`);
            for (const [rawActorId, actorValue] of Object.entries(value.actors)) {
                const actorId = assertV2DictionaryKey(rawActorId, 80, `scope ${scopeId}.actor key`);
                assertV2Actor(actorValue, actorId, scopeId);
                scope.actors[actorId] = normalizeActor(actorValue, actorId);
            }
        }
        const sceneValues = new Map();
        for (const [rawSceneId, sceneValue] of Object.entries(value.scenes || {})) {
            const sceneId = sourceVersion === INTERACTIVE_STORE_VERSION
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
        const order = sourceVersion === INTERACTIVE_STORE_VERSION
            ? [...value.sceneOrder]
            : value.sceneOrder.map(key => {
                if (typeof key !== 'string') throw new Error(`互动场景 v1 scope ${scopeId}.sceneOrder 必须是字符串数组`);
                return normalizeV1DictionaryKey(key, 80, `scope ${scopeId}.sceneOrder item`);
            }).filter(Boolean).slice(-INTERACTIVE_LIMITS.scenes);
        if (sourceVersion === 1 && new Set(order).size !== order.length) throw new Error(`互动场景 v1 scope ${scopeId}.sceneOrder 归一化后包含重复场景`);
        if (sourceVersion === INTERACTIVE_STORE_VERSION) {
            const orderedIds = new Set();
            for (const sceneId of order) {
                assertV2DictionaryKey(sceneId, 80, `scope ${scopeId}.sceneOrder item`);
                if (orderedIds.has(sceneId)) throw new Error(`互动场景 v2 scope ${scopeId}.sceneOrder 包含重复场景：${sceneId}`);
                orderedIds.add(sceneId);
            }
            const sceneIds = [...sceneValues.keys()];
            const orphanSceneId = sceneIds.find(sceneId => !orderedIds.has(sceneId));
            if (orphanSceneId) throw new Error(`互动场景 v2 scope ${scopeId}.scenes 包含未列入 sceneOrder 的场景：${orphanSceneId}`);
            const missingSceneId = order.find(sceneId => !sceneValues.has(sceneId));
            if (missingSceneId) throw new Error(`互动场景 v2 scope ${scopeId}.sceneOrder 引用了不存在的场景：${missingSceneId}`);
            if (value.activeSceneId === null && order.length) throw new Error(`互动场景 v2 scope ${scopeId}.activeSceneId 不能在存在场景时为 null`);
            if (typeof value.activeSceneId === 'string' && !orderedIds.has(value.activeSceneId)) throw new Error(`互动场景 v2 scope ${scopeId}.activeSceneId 未指向有效场景`);
        }
        for (const key of order) {
            if (!sceneValues.has(key)) throw new Error(`互动场景 v${sourceVersion} scope ${scopeId}.sceneOrder 引用了不存在的场景：${key}`);
            const rawSceneValue = sceneValues.get(key);
            if (!rawSceneValue || typeof rawSceneValue !== 'object' || Array.isArray(rawSceneValue)) {
                throw new Error(`互动场景 v${sourceVersion} scope ${scopeId}.scene ${key} 格式无效`);
            }
            let sceneValue = rawSceneValue;
            if (sourceVersion === INTERACTIVE_STORE_VERSION) {
                if (sceneValue.id !== key) throw new Error(`互动场景 v2 scope ${scopeId}.scene ${key}.id 必须与场景键一致`);
            } else {
                if (Object.hasOwn(sceneValue, 'id') && typeof sceneValue.id !== 'string') throw new Error(`互动场景 v1 scope ${scopeId}.scene ${key}.id 必须是字符串`);
                const sceneId = Object.hasOwn(sceneValue, 'id') ? normalizeV1DictionaryKey(sceneValue.id, 80, `scope ${scopeId}.scene ${key}.id`) : key;
                if (sceneId !== key) throw new Error(`互动场景 v1 scope ${scopeId}.scene ${key}.id 必须与场景键一致`);
                sceneValue = { ...sceneValue, id: key };
            }
            scope.scenes[key] = normalizeScene(sceneValue, { scope, scopeId, sourceVersion, strictLegacy: sourceVersion === 1 });
        }
        scope.sceneOrder = Object.keys(scope.scenes);
        if (sourceVersion === 1 && value.activeSceneId !== undefined && value.activeSceneId !== null && typeof value.activeSceneId !== 'string') throw new Error(`互动场景 v1 scope ${scopeId}.activeSceneId 必须是字符串或 null`);
        const normalizedActiveSceneId = sourceVersion === INTERACTIVE_STORE_VERSION ? value.activeSceneId : normalizeV1DictionaryKey(value.activeSceneId, 80, `scope ${scopeId}.activeSceneId`);
        scope.activeSceneId = sourceVersion === INTERACTIVE_STORE_VERSION
            ? value.activeSceneId
            : Object.hasOwn(scope.scenes, normalizedActiveSceneId) ? normalizedActiveSceneId : scope.sceneOrder.at(-1) || null;
        result.scopes[scopeId] = scope;
    }
    return result;
}
