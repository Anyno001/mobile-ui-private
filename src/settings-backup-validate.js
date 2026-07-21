import {
    INTERACTIVE_ACTOR_TYPES, INTERACTIVE_LIMITS, INTERACTIVE_STORE_VERSION,
    deriveInteractiveActorId, normalizeAmbientStatus, normalizeInteractiveStore, normalizePhoneUiState,
} from './interactive-scene-model.js';
import { applyCalendarBackupFields } from './settings-backup.js';

const clone = value => JSON.parse(JSON.stringify(value));
const objectValue = (value, field) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`备份字段 ${field} 必须是对象`);
    return clone(value);
};
const arrayValue = (value, field) => {
    if (!Array.isArray(value)) throw new Error(`备份字段 ${field} 必须是数组`);
    return clone(value);
};
export const legacyBackupTheme = value => {
    const theme = objectValue(value || {}, 'theme');
    delete theme.ambientStatusEnabled;
    return theme;
};
const isUnsafeDictionaryKey = value => value === 'prototype' || Object.hasOwn(Object.prototype, value);
const assertSafeDictionaryKey = (value, field) => {
    if (isUnsafeDictionaryKey(value)) throw new Error(`备份字段 ${field} 包含危险键 ${value}`);
    return value;
};
const assertNormalizedDictionaryKey = (value, field, max) => {
    assertNormalizedText(value, field, max);
    return assertSafeDictionaryKey(value, field);
};
const normalizeLegacyDictionaryKey = (value, field, max) => assertSafeDictionaryKey(String(value ?? '').trim().slice(0, max), field);
const assertAllowedKeys = (value, field, allowedKeys) => {
    const allowed = new Set(allowedKeys);
    const unsupported = Object.keys(value).find(key => !allowed.has(key));
    if (unsupported) throw new Error(`备份字段 ${field}.${unsupported} 不受支持`);
};
const assertNormalizedText = (value, field, max, { allowEmpty = false } = {}) => {
    if (typeof value !== 'string') throw new Error(`备份字段 ${field} 必须是字符串`);
    if (value !== value.trim()) throw new Error(`备份字段 ${field} 不能包含首尾空白`);
    if (!allowEmpty && !value) throw new Error(`备份字段 ${field} 必须是非空字符串`);
    if (value.length > max) throw new Error(`备份字段 ${field} 长度不能超过 ${max}`);
};
const assertOptionalNormalizedText = (item, key, field, max, options) => {
    if (Object.hasOwn(item, key)) assertNormalizedText(item[key], `${field}.${key}`, max, options);
};
const assertOptionalLegacyText = (item, key, field) => {
    if (Object.hasOwn(item, key) && typeof item[key] !== 'string') throw new Error(`备份字段 ${field}.${key} 必须是字符串`);
};
const assertOptionalTimestamp = (item, key, field) => {
    if (!Object.hasOwn(item, key)) return;
    const value = item[key];
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) throw new Error(`备份字段 ${field}.${key} 必须是有效时间戳`);
};
const assertInteractiveActor = (value, actorId, field, scopeId) => {
    const actor = objectValue(value, field);
    assertAllowedKeys(actor, field, ['actorId', 'type', 'displayName', 'bindingKey', 'profile', 'createdAt']);
    if (actor.actorId !== actorId) throw new Error(`备份字段 ${field}.actorId 必须与 actor 键一致`);
    assertNormalizedText(actor.actorId, `${field}.actorId`, 80);
    if (!INTERACTIVE_ACTOR_TYPES.includes(actor.type)) throw new Error(`备份字段 ${field}.type 无效`);
    assertNormalizedText(actor.displayName, `${field}.displayName`, 80);
    assertNormalizedText(actor.bindingKey, `${field}.bindingKey`, 240);
    assertNormalizedText(actor.profile, `${field}.profile`, 1000, { allowEmpty: true });
    assertOptionalTimestamp(actor, 'createdAt', field);
    if (!Object.hasOwn(actor, 'createdAt')) throw new Error(`备份字段 ${field}.createdAt 缺失`);
    if (deriveInteractiveActorId(scopeId, actor.type, actor.bindingKey) !== actorId) throw new Error(`备份字段 ${field}.actorId 与绑定信息不一致`);
};
const assertInteractiveItem = (value, field, { kind = 'post', version = 1, actorIds = null } = {}) => {
    const item = objectValue(value, field);
    const authorKeys = version === INTERACTIVE_STORE_VERSION ? ['authorId', 'authorNameSnapshot'] : ['author'];
    const allowedKeys = kind === 'post'
        ? ['id', ...authorKeys, 'content', 'tags', 'createdAt', 'comments', 'liked', ...(version === INTERACTIVE_STORE_VERSION ? ['shareCount', 'shared'] : [])]
        : ['id', ...authorKeys, 'content', 'createdAt'];
    assertAllowedKeys(item, field, allowedKeys);
    assertOptionalNormalizedText(item, 'id', field, 80);
    if (version === INTERACTIVE_STORE_VERSION) {
        const contentMax = kind === 'post' ? 4000 : kind === 'comment' ? 1000 : 200;
        assertNormalizedText(item.content, `${field}.content`, contentMax);
        assertNormalizedText(item.authorId, `${field}.authorId`, 80);
        assertNormalizedText(item.authorNameSnapshot, `${field}.authorNameSnapshot`, 80);
        if (!actorIds?.has(item.authorId)) throw new Error(`备份字段 ${field}.authorId 未指向有效 actor`);
    } else {
        assertOptionalLegacyText(item, 'content', field);
        assertOptionalLegacyText(item, 'author', field);
    }
    assertOptionalTimestamp(item, 'createdAt', field);
    if (kind === 'post') {
        if (Object.hasOwn(item, 'liked') && typeof item.liked !== 'boolean') throw new Error(`备份字段 ${field}.liked 必须是布尔值`);
        if (Object.hasOwn(item, 'shared') && typeof item.shared !== 'boolean') throw new Error(`备份字段 ${field}.shared 必须是布尔值`);
        if (Object.hasOwn(item, 'shareCount') && (!Number.isSafeInteger(item.shareCount) || item.shareCount < 0)) {
            throw new Error(`备份字段 ${field}.shareCount 必须是非负安全整数`);
        }
        if (Object.hasOwn(item, 'tags')) {
            if (!Array.isArray(item.tags) || item.tags.some(tag => typeof tag !== 'string')) throw new Error(`备份字段 ${field}.tags 必须是字符串数组`);
            if (item.tags.length > 5) throw new Error(`备份字段 ${field}.tags 不能超过 5 项`);
            if (version === INTERACTIVE_STORE_VERSION) {
                item.tags.forEach((tag, index) => assertNormalizedText(tag, `${field}.tags.${index}`, 30));
            }
        }
        if (Object.hasOwn(item, 'comments')) {
            if (!Array.isArray(item.comments)) throw new Error(`备份字段 ${field}.comments 必须是数组`);
            if (item.comments.length > INTERACTIVE_LIMITS.comments) throw new Error(`备份字段 ${field}.comments 不能超过 ${INTERACTIVE_LIMITS.comments} 项`);
            item.comments.forEach((comment, index) => assertInteractiveItem(
                comment, `${field}.comments.${index}`, { kind: 'comment', version, actorIds },
            ));
        }
    }
};
const assertInteractiveBackupStore = value => {
    normalizeInteractiveStore(value);
    const store = objectValue(value, 'interactiveScenes');
    assertAllowedKeys(store, 'interactiveScenes', ['version', 'scopes']);
    if (store.version !== undefined && (!Number.isInteger(store.version) || ![1, INTERACTIVE_STORE_VERSION].includes(store.version))) throw new Error('备份字段 interactiveScenes.version 必须是数字 1 或 2');
    const sourceVersion = store.version === INTERACTIVE_STORE_VERSION ? INTERACTIVE_STORE_VERSION : 1;
    const scopes = objectValue(store.scopes, 'interactiveScenes.scopes');
    const normalizedScopeIds = new Set();
    for (const [scopeId, scopeValue] of Object.entries(scopes)) {
        const normalizedScopeId = sourceVersion === INTERACTIVE_STORE_VERSION
            ? scopeId
            : normalizeLegacyDictionaryKey(scopeId, 'interactiveScenes.scopes', 160);
        if (sourceVersion === INTERACTIVE_STORE_VERSION) {
            assertNormalizedDictionaryKey(scopeId, 'interactiveScenes.scopes', 160);
        }
        if (normalizedScopeIds.has(normalizedScopeId)) throw new Error(`备份字段 interactiveScenes.scopes 归一化后包含重复 scope ${normalizedScopeId}`);
        normalizedScopeIds.add(normalizedScopeId);
        const field = `interactiveScenes.scopes.${scopeId}`;
        const scope = objectValue(scopeValue, field);
        const scopeKeys = sourceVersion === INTERACTIVE_STORE_VERSION
            ? ['activeSceneId', 'sceneOrder', 'scenes', 'actors']
            : ['activeSceneId', 'sceneOrder', 'scenes'];
        assertAllowedKeys(scope, field, scopeKeys);
        const actorIds = new Set();
        if (sourceVersion === INTERACTIVE_STORE_VERSION) {
            const actors = objectValue(scope.actors, `${field}.actors`);
            for (const [actorId, actorValue] of Object.entries(actors)) {
                assertNormalizedDictionaryKey(actorId, `${field}.actors`, 80);
                assertInteractiveActor(actorValue, actorId, `${field}.actors.${actorId}`, scopeId);
                actorIds.add(actorId);
            }
        }
        if (!Array.isArray(scope.sceneOrder)) throw new Error(`备份字段 ${field}.sceneOrder 必须是数组`);
        if (sourceVersion === INTERACTIVE_STORE_VERSION && scope.sceneOrder.length > INTERACTIVE_LIMITS.scenes) throw new Error(`备份字段 ${field}.sceneOrder 不能超过 ${INTERACTIVE_LIMITS.scenes} 项`);
        const scenes = objectValue(scope.scenes, `${field}.scenes`);
        const normalizedScenes = new Map();
        for (const sceneId of Object.keys(scenes)) {
            const normalizedSceneId = sourceVersion === INTERACTIVE_STORE_VERSION
                ? assertNormalizedDictionaryKey(sceneId, `${field}.scenes`, 80)
                : normalizeLegacyDictionaryKey(sceneId, `${field}.scenes`, 80);
            if (normalizedScenes.has(normalizedSceneId)) throw new Error(`备份字段 ${field}.scenes 归一化后包含重复场景 ${normalizedSceneId}`);
            normalizedScenes.set(normalizedSceneId, scenes[sceneId]);
        }
        if (Object.hasOwn(scope, 'activeSceneId') && scope.activeSceneId !== null && typeof scope.activeSceneId !== 'string') throw new Error(`备份字段 ${field}.activeSceneId 必须是字符串或 null`);
        const normalizedOrder = scope.sceneOrder.map(rawSceneId => {
            if (typeof rawSceneId !== 'string') throw new Error(`备份字段 ${field}.sceneOrder 必须是字符串数组`);
            return sourceVersion === INTERACTIVE_STORE_VERSION
                ? assertNormalizedDictionaryKey(rawSceneId, `${field}.sceneOrder`, 80)
                : normalizeLegacyDictionaryKey(rawSceneId, `${field}.sceneOrder`, 80);
        }).filter(Boolean);
        const retainedOrder = sourceVersion === INTERACTIVE_STORE_VERSION ? normalizedOrder : normalizedOrder.slice(-INTERACTIVE_LIMITS.scenes);
        const orderedIds = new Set();
        for (const sceneId of retainedOrder) {
            if (orderedIds.has(sceneId)) throw new Error(`备份字段 ${field}.sceneOrder 包含重复场景 ${sceneId}`);
            orderedIds.add(sceneId);
            const scene = objectValue(normalizedScenes.get(sceneId), `${field}.scenes.${sceneId}`);
            const sceneKeys = ['id', 'title', 'preset', 'styleInput', 'generatedPrompt', 'themeAccent', 'createdAt', 'updatedAt', 'posts', 'live'];
            if (sourceVersion !== INTERACTIVE_STORE_VERSION) sceneKeys.push('contentRating');
            assertAllowedKeys(scene, `${field}.scenes.${sceneId}`, sceneKeys);
            if (Object.hasOwn(scene, 'id')) {
                if (typeof scene.id !== 'string') throw new Error(`备份字段 ${field}.scenes.${sceneId}.id 必须是字符串`);
                const normalizedSceneValueId = sourceVersion === INTERACTIVE_STORE_VERSION
                    ? assertNormalizedDictionaryKey(scene.id, `${field}.scenes.${sceneId}.id`, 80)
                    : normalizeLegacyDictionaryKey(scene.id, `${field}.scenes.${sceneId}.id`, 80);
                if (normalizedSceneValueId !== sceneId) throw new Error(`备份字段 ${field}.scenes.${sceneId}.id 必须与场景键一致`);
            }
            if (sourceVersion === INTERACTIVE_STORE_VERSION) {
                assertOptionalNormalizedText(scene, 'title', `${field}.scenes.${sceneId}`, 80);
                assertOptionalNormalizedText(scene, 'preset', `${field}.scenes.${sceneId}`, 30);
                assertOptionalNormalizedText(scene, 'styleInput', `${field}.scenes.${sceneId}`, 2000, { allowEmpty: true });
                assertOptionalNormalizedText(scene, 'generatedPrompt', `${field}.scenes.${sceneId}`, 6000, { allowEmpty: true });
                assertOptionalNormalizedText(scene, 'themeAccent', `${field}.scenes.${sceneId}`, 7, { allowEmpty: true });
                if (scene.themeAccent && !/^#[0-9a-f]{6}$/.test(scene.themeAccent)) {
                    throw new Error(`备份字段 ${field}.scenes.${sceneId}.themeAccent 必须是小写六位十六进制颜色`);
                }
            } else {
                for (const key of ['title', 'preset', 'styleInput', 'generatedPrompt', 'themeAccent']) {
                    assertOptionalLegacyText(scene, key, `${field}.scenes.${sceneId}`);
                }
            }
            assertOptionalTimestamp(scene, 'createdAt', `${field}.scenes.${sceneId}`);
            assertOptionalTimestamp(scene, 'updatedAt', `${field}.scenes.${sceneId}`);
            if (Object.hasOwn(scene, 'posts')) {
                if (!Array.isArray(scene.posts)) throw new Error(`备份字段 ${field}.scenes.${sceneId}.posts 必须是数组`);
                if (scene.posts.length > INTERACTIVE_LIMITS.posts) throw new Error(`备份字段 ${field}.scenes.${sceneId}.posts 不能超过 ${INTERACTIVE_LIMITS.posts} 项`);
                scene.posts.forEach((post, index) => assertInteractiveItem(
                    post, `${field}.scenes.${sceneId}.posts.${index}`, { version: sourceVersion, actorIds },
                ));
            }
            if (Object.hasOwn(scene, 'live')) {
                const live = objectValue(scene.live, `${field}.scenes.${sceneId}.live`);
                assertAllowedKeys(live, `${field}.scenes.${sceneId}.live`, ['title', 'status', 'danmaku']);
                if (sourceVersion === INTERACTIVE_STORE_VERSION) {
                    assertOptionalNormalizedText(live, 'title', `${field}.scenes.${sceneId}.live`, 100);
                } else {
                    assertOptionalLegacyText(live, 'title', `${field}.scenes.${sceneId}.live`);
                }
                if (Object.hasOwn(live, 'status') && live.status !== 'idle') throw new Error(`备份字段 ${field}.scenes.${sceneId}.live.status 必须是 idle`);
                if (Object.hasOwn(live, 'danmaku')) {
                    if (!Array.isArray(live.danmaku)) throw new Error(`备份字段 ${field}.scenes.${sceneId}.live.danmaku 必须是数组`);
                    if (live.danmaku.length > INTERACTIVE_LIMITS.danmaku) throw new Error(`备份字段 ${field}.scenes.${sceneId}.live.danmaku 不能超过 ${INTERACTIVE_LIMITS.danmaku} 项`);
                    live.danmaku.forEach((item, index) => assertInteractiveItem(
                        item, `${field}.scenes.${sceneId}.live.danmaku.${index}`, { kind: 'danmaku', version: sourceVersion, actorIds },
                    ));
                }
            }
        }
        if (sourceVersion === INTERACTIVE_STORE_VERSION) {
            const extraSceneIds = [...normalizedScenes.keys()].filter(sceneId => !orderedIds.has(sceneId));
            if (extraSceneIds.length) throw new Error(`备份字段 ${field}.scenes 包含未列入 sceneOrder 的场景 ${extraSceneIds[0]}`);
            if (scope.activeSceneId === null && orderedIds.size) throw new Error(`备份字段 ${field}.activeSceneId 不能在存在场景时为 null`);
            if (typeof scope.activeSceneId === 'string' && !orderedIds.has(scope.activeSceneId)) throw new Error(`备份字段 ${field}.activeSceneId 未指向有效场景`);
        } else if (typeof scope.activeSceneId === 'string') {
            normalizeLegacyDictionaryKey(scope.activeSceneId, `${field}.activeSceneId`, 80);
        }
    }
    return store;
};

export function parseBackupData(data, current) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('备份根节点必须是对象');
    const version = data.schemaVersion === undefined ? 1 : data.schemaVersion;
    if (!Number.isInteger(version) || version < 1) throw new Error('备份版本无效');
    if (version > 6) throw new Error(`备份版本 ${version} 高于当前支持版本 6`);
    const result = clone(current);
    if (Object.hasOwn(data, 'histories')) result.histories = objectValue(data.histories, 'histories');
    if (Object.hasOwn(data, 'config')) result.config = objectValue(data.config, 'config');
    if (Object.hasOwn(data, 'theme')) {
        const importedTheme = legacyBackupTheme(data.theme);
        result.theme = { ...importedTheme, ambientStatusEnabled: version < 4
            ? current.theme?.ambientStatusEnabled === true : false };
    }
    if (Object.hasOwn(data, 'profiles')) result.profiles = arrayValue(data.profiles, 'profiles');
    if (Object.hasOwn(data, 'groupMeta')) result.groupMeta = objectValue(data.groupMeta, 'groupMeta');
    if (Object.hasOwn(data, 'pokeConfig')) result.pokeConfig = objectValue(data.pokeConfig, 'pokeConfig');
    if (Object.hasOwn(data, 'bidirectional')) result.bidirectional = objectValue(data.bidirectional, 'bidirectional');
    if (Object.hasOwn(data, 'emojis')) result.emojis = arrayValue(data.emojis, 'emojis');
    if (Object.hasOwn(data, 'characterBehavior')) result.characterBehavior = objectValue(data.characterBehavior, 'characterBehavior');
    if (Object.hasOwn(data, 'wordyLimit')) {
        if (typeof data.wordyLimit !== 'boolean') throw new Error('备份字段 wordyLimit 必须是布尔值');
        result.wordyLimit = data.wordyLimit;
    }
    if (version >= 6) {
        if (Object.hasOwn(data, 'desktopBg')) {
            if (typeof data.desktopBg !== 'string') throw new Error('备份字段 desktopBg 必须是字符串');
            result.desktopBg = data.desktopBg;
        } else {
            result.desktopBg = '';
        }
    }
    if (Object.hasOwn(data, 'bgGlobal')) {
        if (typeof data.bgGlobal !== 'string') throw new Error('备份字段 bgGlobal 必须是字符串');
        result.bgGlobal = data.bgGlobal;
    }
    if (Object.hasOwn(data, 'bgLocal')) result.bgLocal = objectValue(data.bgLocal, 'bgLocal');
    if (Object.hasOwn(data, 'interactiveScenes')) result.interactiveScenes = normalizeInteractiveStore(assertInteractiveBackupStore(data.interactiveScenes));
    if (version >= 4) {
        result.phoneUiState = Object.hasOwn(data, 'phoneUiState')
            ? normalizePhoneUiState(objectValue(data.phoneUiState, 'phoneUiState'), result.interactiveScenes)
            : normalizePhoneUiState(null, result.interactiveScenes);
        result.ambientStatus = Object.hasOwn(data, 'ambientStatus')
            ? normalizeAmbientStatus(objectValue(data.ambientStatus, 'ambientStatus')) : normalizeAmbientStatus();
        result.theme.ambientStatusEnabled = result.ambientStatus.enabled;
    }
    if (version >= 5) applyCalendarBackupFields(data, result, objectValue);
    return result;
}
