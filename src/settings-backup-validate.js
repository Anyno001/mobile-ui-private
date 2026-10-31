import { normalizeInjectionConfig } from './behavior-config.js';
import { normalizeBudgetConfig } from './budget.js';
import { normalizeThemePreset } from './config.js';
import { normalizeDesktopIconBackupPayload } from './desktop-icon-storage.js';
import {
    COMMUNITY_PLATFORMS, INTERACTIVE_ACTOR_TYPES, INTERACTIVE_LIMITS, INTERACTIVE_STORE_VERSION, LIVE_DANMAKU_KINDS, LIVE_HOST_SETTING_MAX,
    deriveInteractiveActorId, normalizeAmbientStatus, normalizeInteractiveStore, normalizePhoneUiState,
} from './interactive-scene-model.js';
import { getStorageIdFor } from './host-context.js';
import { B2_POST_KEYS } from './interactive-scene-post-fields.js';
import { VIDEO_LIMITS } from './video-schema.js';
import { applyCalendarBackupFields } from './settings-backup.js';
import { createEmptyTodayTrendStore, normalizeTodayTrendStore } from './today-trend-model.js';
import { normalizeTodayTrendMigrationBackup } from './today-trend-v2-authority.js';
import { migrateLegacyTodayTrendV2Store, normalizeTodayTrendV2Store } from './today-trend-v2-model.js';
import { createEmptyUserGenerationStore, normalizeUserGenerationStore } from './user-generation-model.js';
import { normalizeWorldBookConfig } from './worldbook-config.js';
import { assertShopBackupStore } from './shop-model.js';

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
    theme.preset = normalizeThemePreset(theme.preset);
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
const isStrictBackupVersion = version => version === 2 || version === INTERACTIVE_STORE_VERSION;
const assertInteractiveItem = (value, field, { kind = 'post', version = 1, actorIds = null } = {}) => {
    const item = objectValue(value, field);
    const authorKeys = isStrictBackupVersion(version) ? ['authorId', 'authorNameSnapshot'] : ['author'];
    const allowedKeys = kind === 'post'
        ? ['id', ...authorKeys, 'content', 'tags', 'createdAt', 'comments', 'liked', ...(isStrictBackupVersion(version) ? ['shareCount', 'shared', 'work', 'rating'] : []),
            ...(version === INTERACTIVE_STORE_VERSION ? ['title', 'flag', 'repost', 'mood', 'workAuthor', 'to', 'sign', 'source', 'image', ...B2_POST_KEYS] : [])]
        : ['id', ...authorKeys, 'content', 'createdAt', ...(version === INTERACTIVE_STORE_VERSION ? (kind === 'danmaku' ? ['kind', 'source'] : ['quoteId', 'rating']) : [])];
    assertAllowedKeys(item, field, allowedKeys);
    assertOptionalNormalizedText(item, 'id', field, 80);
    if (isStrictBackupVersion(version)) {
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
    if (kind === 'danmaku' && Object.hasOwn(item, 'kind') && !LIVE_DANMAKU_KINDS.includes(item.kind)) throw new Error(`备份字段 ${field}.kind 无效`);
    if (kind === 'post') {
        if (Object.hasOwn(item, 'liked') && typeof item.liked !== 'boolean') throw new Error(`备份字段 ${field}.liked 必须是布尔值`);
        if (Object.hasOwn(item, 'shared') && typeof item.shared !== 'boolean') throw new Error(`备份字段 ${field}.shared 必须是布尔值`);
        // 配图只存画面描述，图片本身在生图目录里。
        if (Object.hasOwn(item, 'image')) {
            const image = objectValue(item.image, `${field}.image`);
            assertAllowedKeys(image, `${field}.image`, ['desc']);
            assertNormalizedText(image.desc, `${field}.image.desc`, 200);
        }
        if (Object.hasOwn(item, 'shareCount') && (!Number.isSafeInteger(item.shareCount) || item.shareCount < 0)) {
            throw new Error(`备份字段 ${field}.shareCount 必须是非负安全整数`);
        }
        if (Object.hasOwn(item, 'tags')) {
            if (!Array.isArray(item.tags) || item.tags.some(tag => typeof tag !== 'string')) throw new Error(`备份字段 ${field}.tags 必须是字符串数组`);
            if (item.tags.length > 5) throw new Error(`备份字段 ${field}.tags 不能超过 5 项`);
            if (isStrictBackupVersion(version)) {
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
// 视频：完整的字段校验已由 normalizeInteractiveStore 完成；这里补备份层的结构核对（成对出现、顺序与字典一致、条数上限、作者指向有效 actor）。
const assertVideoBackup = (scope, field, actorIds) => {
    const hasVideos = Object.hasOwn(scope, 'videos');
    const hasOrder = Object.hasOwn(scope, 'videoOrder');
    if (!hasVideos && !hasOrder) return;
    if (hasVideos !== hasOrder) throw new Error(`备份字段 ${field}.videos 与 videoOrder 必须同时存在`);
    const videos = objectValue(scope.videos, `${field}.videos`);
    if (!Array.isArray(scope.videoOrder)) throw new Error(`备份字段 ${field}.videoOrder 必须是数组`);
    if (scope.videoOrder.length > VIDEO_LIMITS.videos) throw new Error(`备份字段 ${field}.videoOrder 不能超过 ${VIDEO_LIMITS.videos} 项`);
    const ordered = new Set();
    for (const videoId of scope.videoOrder) {
        assertNormalizedDictionaryKey(videoId, `${field}.videoOrder`, 80);
        if (ordered.has(videoId)) throw new Error(`备份字段 ${field}.videoOrder 包含重复视频 ${videoId}`);
        ordered.add(videoId);
        if (!Object.hasOwn(videos, videoId)) throw new Error(`备份字段 ${field}.videoOrder 引用了不存在的视频 ${videoId}`);
        const videoField = `${field}.videos.${videoId}`;
        const video = objectValue(videos[videoId], videoField);
        if (video.id !== videoId) throw new Error(`备份字段 ${videoField}.id 必须与视频键一致`);
        if (Object.hasOwn(video, 'uploaderActorId') && !actorIds.has(video.uploaderActorId)) throw new Error(`备份字段 ${videoField}.uploaderActorId 未指向有效 actor`);
        if (Object.hasOwn(video, 'pending') && video.pending !== true) throw new Error(`备份字段 ${videoField}.pending 只能是 true`);
        if (Object.hasOwn(video, 'draft')) {
            const draft = objectValue(video.draft, `${videoField}.draft`);
            assertAllowedKeys(draft, `${videoField}.draft`, ['titleTyped', 'categoryTyped', 'aiScenes']);
            for (const key of ['titleTyped', 'categoryTyped', 'aiScenes']) {
                if (typeof draft[key] !== 'boolean') throw new Error(`备份字段 ${videoField}.draft.${key} 必须是布尔值`);
            }
        }
        if (!Array.isArray(video.scenes) || video.scenes.length < 1 || video.scenes.length > VIDEO_LIMITS.scenes) throw new Error(`备份字段 ${videoField}.scenes 必须是 1-${VIDEO_LIMITS.scenes} 项的数组`);
        if (!Array.isArray(video.danmaku) || video.danmaku.length > VIDEO_LIMITS.danmaku) throw new Error(`备份字段 ${videoField}.danmaku 必须是不超过 ${VIDEO_LIMITS.danmaku} 项的数组`);
        if (!Array.isArray(video.comments) || video.comments.length > VIDEO_LIMITS.comments) throw new Error(`备份字段 ${videoField}.comments 必须是不超过 ${VIDEO_LIMITS.comments} 项的数组`);
        const authors = [...video.danmaku, ...video.comments, ...video.comments.flatMap(comment => (Array.isArray(comment?.replies) ? comment.replies : []))];
        if (authors.some(item => !actorIds.has(item?.authorId))) throw new Error(`备份字段 ${videoField} 含有未指向有效 actor 的作者`);
    }
    const orphan = Object.keys(videos).find(videoId => !ordered.has(videoId));
    if (orphan) throw new Error(`备份字段 ${field}.videos 包含未列入 videoOrder 的视频 ${orphan}`);
};

const assertInteractiveBackupStore = value => {
    normalizeInteractiveStore(value);
    const store = objectValue(value, 'interactiveScenes');
    assertAllowedKeys(store, 'interactiveScenes', ['version', 'scopes']);
    if (store.version !== undefined && (!Number.isInteger(store.version) || ![1, 2, INTERACTIVE_STORE_VERSION].includes(store.version))) throw new Error('备份字段 interactiveScenes.version 必须是数字 1、2 或 3');
    const sourceVersion = isStrictBackupVersion(store.version) ? store.version : 1;
    const isV3 = sourceVersion === INTERACTIVE_STORE_VERSION;
    const scopes = objectValue(store.scopes, 'interactiveScenes.scopes');
    const normalizedScopeIds = new Set();
    for (const [scopeId, scopeValue] of Object.entries(scopes)) {
        const normalizedScopeId = isStrictBackupVersion(sourceVersion)
            ? scopeId
            : normalizeLegacyDictionaryKey(scopeId, 'interactiveScenes.scopes', 160);
        if (isStrictBackupVersion(sourceVersion)) {
            assertNormalizedDictionaryKey(scopeId, 'interactiveScenes.scopes', 160);
        }
        if (normalizedScopeIds.has(normalizedScopeId)) throw new Error(`备份字段 interactiveScenes.scopes 归一化后包含重复 scope ${normalizedScopeId}`);
        normalizedScopeIds.add(normalizedScopeId);
        const field = `interactiveScenes.scopes.${scopeId}`;
        const scope = objectValue(scopeValue, field);
        const scopeKeys = isStrictBackupVersion(sourceVersion)
            ? ['activeSceneId', 'sceneOrder', 'scenes', 'actors', ...(isV3 ? ['liveRooms', 'liveOrder', 'videos', 'videoOrder'] : [])]
            : ['activeSceneId', 'sceneOrder', 'scenes'];
        assertAllowedKeys(scope, field, scopeKeys);
        const actorIds = new Set();
        if (isStrictBackupVersion(sourceVersion)) {
            const actors = objectValue(scope.actors, `${field}.actors`);
            for (const [actorId, actorValue] of Object.entries(actors)) {
                assertNormalizedDictionaryKey(actorId, `${field}.actors`, 80);
                assertInteractiveActor(actorValue, actorId, `${field}.actors.${actorId}`, scopeId);
                actorIds.add(actorId);
            }
        }
        if (!Array.isArray(scope.sceneOrder)) throw new Error(`备份字段 ${field}.sceneOrder 必须是数组`);
        if (isStrictBackupVersion(sourceVersion) && scope.sceneOrder.length > INTERACTIVE_LIMITS.scenes) throw new Error(`备份字段 ${field}.sceneOrder 不能超过 ${INTERACTIVE_LIMITS.scenes} 项`);
        const scenes = objectValue(scope.scenes, `${field}.scenes`);
        const normalizedScenes = new Map();
        for (const sceneId of Object.keys(scenes)) {
            const normalizedSceneId = isStrictBackupVersion(sourceVersion)
                ? assertNormalizedDictionaryKey(sceneId, `${field}.scenes`, 80)
                : normalizeLegacyDictionaryKey(sceneId, `${field}.scenes`, 80);
            if (normalizedScenes.has(normalizedSceneId)) throw new Error(`备份字段 ${field}.scenes 归一化后包含重复场景 ${normalizedSceneId}`);
            normalizedScenes.set(normalizedSceneId, scenes[sceneId]);
        }
        if (Object.hasOwn(scope, 'activeSceneId') && scope.activeSceneId !== null && typeof scope.activeSceneId !== 'string') throw new Error(`备份字段 ${field}.activeSceneId 必须是字符串或 null`);
        const normalizedOrder = scope.sceneOrder.map(rawSceneId => {
            if (typeof rawSceneId !== 'string') throw new Error(`备份字段 ${field}.sceneOrder 必须是字符串数组`);
            return isStrictBackupVersion(sourceVersion)
                ? assertNormalizedDictionaryKey(rawSceneId, `${field}.sceneOrder`, 80)
                : normalizeLegacyDictionaryKey(rawSceneId, `${field}.sceneOrder`, 80);
        }).filter(Boolean);
        const retainedOrder = isStrictBackupVersion(sourceVersion) ? normalizedOrder : normalizedOrder.slice(-INTERACTIVE_LIMITS.scenes);
        const orderedIds = new Set();
        for (const sceneId of retainedOrder) {
            if (orderedIds.has(sceneId)) throw new Error(`备份字段 ${field}.sceneOrder 包含重复场景 ${sceneId}`);
            orderedIds.add(sceneId);
            const scene = objectValue(normalizedScenes.get(sceneId), `${field}.scenes.${sceneId}`);
            const sceneKeys = isV3
                ? ['id', 'title', 'platform', 'nsfw', 'autoRespond', 'igsSync', 'preset', 'styleInput', 'generatedPrompt', 'themeAccent', 'tonight', 'hot', 'createdAt', 'updatedAt', 'posts']
                : ['id', 'title', 'preset', 'styleInput', 'generatedPrompt', 'themeAccent', 'createdAt', 'updatedAt', 'posts', 'live'];
            if (!isStrictBackupVersion(sourceVersion)) sceneKeys.push('contentRating');
            assertAllowedKeys(scene, `${field}.scenes.${sceneId}`, sceneKeys);
            if (Object.hasOwn(scene, 'id')) {
                if (typeof scene.id !== 'string') throw new Error(`备份字段 ${field}.scenes.${sceneId}.id 必须是字符串`);
                const normalizedSceneValueId = isStrictBackupVersion(sourceVersion)
                    ? assertNormalizedDictionaryKey(scene.id, `${field}.scenes.${sceneId}.id`, 80)
                    : normalizeLegacyDictionaryKey(scene.id, `${field}.scenes.${sceneId}.id`, 80);
                if (normalizedSceneValueId !== sceneId) throw new Error(`备份字段 ${field}.scenes.${sceneId}.id 必须与场景键一致`);
            }
            if (isStrictBackupVersion(sourceVersion)) {
                assertOptionalNormalizedText(scene, 'title', `${field}.scenes.${sceneId}`, 80);
                assertOptionalNormalizedText(scene, 'preset', `${field}.scenes.${sceneId}`, 30);
                if (isV3) {
                    if (!COMMUNITY_PLATFORMS.includes(scene.platform)) throw new Error(`备份字段 ${field}.scenes.${sceneId}.platform 无效`);
                    if (typeof scene.nsfw !== 'boolean') throw new Error(`备份字段 ${field}.scenes.${sceneId}.nsfw 必须是布尔值`);
                    if (Object.hasOwn(scene, 'autoRespond') && typeof scene.autoRespond !== 'boolean') throw new Error(`备份字段 ${field}.scenes.${sceneId}.autoRespond 必须是布尔值`);
                    if (Object.hasOwn(scene, 'igsSync') && scene.igsSync !== true) throw new Error(`备份字段 ${field}.scenes.${sceneId}.igsSync 只能是 true`);
                }
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
            if (!isV3 && Object.hasOwn(scene, 'live')) {
                const live = objectValue(scene.live, `${field}.scenes.${sceneId}.live`);
                assertAllowedKeys(live, `${field}.scenes.${sceneId}.live`, ['title', 'status', 'warmupStarted', 'danmaku']);
                if (isStrictBackupVersion(sourceVersion)) {
                    assertOptionalNormalizedText(live, 'title', `${field}.scenes.${sceneId}.live`, 100);
                } else {
                    assertOptionalLegacyText(live, 'title', `${field}.scenes.${sceneId}.live`);
                }
                if (Object.hasOwn(live, 'status') && live.status !== 'idle') throw new Error(`备份字段 ${field}.scenes.${sceneId}.live.status 必须是 idle`);
                if (Object.hasOwn(live, 'warmupStarted') && typeof live.warmupStarted !== 'boolean') throw new Error(`备份字段 ${field}.scenes.${sceneId}.live.warmupStarted 必须是布尔值`);
                if (Object.hasOwn(live, 'danmaku')) {
                    if (!Array.isArray(live.danmaku)) throw new Error(`备份字段 ${field}.scenes.${sceneId}.live.danmaku 必须是数组`);
                    if (live.danmaku.length > INTERACTIVE_LIMITS.danmaku) throw new Error(`备份字段 ${field}.scenes.${sceneId}.live.danmaku 不能超过 ${INTERACTIVE_LIMITS.danmaku} 项`);
                    live.danmaku.forEach((item, index) => assertInteractiveItem(
                        item, `${field}.scenes.${sceneId}.live.danmaku.${index}`, { kind: 'danmaku', version: sourceVersion, actorIds },
                    ));
                }
            }
        }
        if (isV3) {
            const liveRooms = objectValue(scope.liveRooms, `${field}.liveRooms`);
            if (!Array.isArray(scope.liveOrder)) throw new Error(`备份字段 ${field}.liveOrder 必须是数组`);
            if (scope.liveOrder.length > INTERACTIVE_LIMITS.liveRooms) throw new Error(`备份字段 ${field}.liveOrder 不能超过 ${INTERACTIVE_LIMITS.liveRooms} 项`);
            const orderedRoomIds = new Set();
            for (const roomId of scope.liveOrder) {
                assertNormalizedDictionaryKey(roomId, `${field}.liveOrder`, 80);
                if (orderedRoomIds.has(roomId)) throw new Error(`备份字段 ${field}.liveOrder 包含重复直播间 ${roomId}`);
                orderedRoomIds.add(roomId);
                if (!Object.hasOwn(liveRooms, roomId)) throw new Error(`备份字段 ${field}.liveOrder 引用了不存在的直播间 ${roomId}`);
                const roomField = `${field}.liveRooms.${roomId}`;
                const room = objectValue(liveRooms[roomId], roomField);
                assertAllowedKeys(room, roomField, ['id', 'title', 'hostIsUser', 'hostActorId', 'hostNameSnapshot', 'hostSetting', 'category', 'nsfw', 'sourceSceneId', 'createdAt', 'updatedAt', 'danmaku', 'source', 'ended']);
                if (Object.hasOwn(room, 'ended') && room.ended !== true) throw new Error(`备份字段 ${roomField}.ended 只能是 true`);
                if (Object.hasOwn(room, 'source')) {
                    const source = objectValue(room.source, `${roomField}.source`);
                    assertAllowedKeys(source, `${roomField}.source`, ['type', 'key']);
                    if (source.type !== 'igs') throw new Error(`备份字段 ${roomField}.source.type 必须是 igs`);
                    assertNormalizedText(source.key, `${roomField}.source.key`, 120);
                }
                if (room.id !== roomId) throw new Error(`备份字段 ${roomField}.id 必须与直播间键一致`);
                assertNormalizedText(room.title, `${roomField}.title`, 100);
                assertOptionalNormalizedText(room, 'hostSetting', roomField, LIVE_HOST_SETTING_MAX, { allowEmpty: true });
                if (typeof room.hostIsUser !== 'boolean') throw new Error(`备份字段 ${roomField}.hostIsUser 必须是布尔值`);
                if (typeof room.nsfw !== 'boolean') throw new Error(`备份字段 ${roomField}.nsfw 必须是布尔值`);
                if (Object.hasOwn(room, 'hostActorId') && !actorIds.has(room.hostActorId)) throw new Error(`备份字段 ${roomField}.hostActorId 未指向有效 actor`);
                assertOptionalTimestamp(room, 'createdAt', roomField);
                assertOptionalTimestamp(room, 'updatedAt', roomField);
                if (!Array.isArray(room.danmaku)) throw new Error(`备份字段 ${roomField}.danmaku 必须是数组`);
                if (room.danmaku.length > INTERACTIVE_LIMITS.danmaku) throw new Error(`备份字段 ${roomField}.danmaku 不能超过 ${INTERACTIVE_LIMITS.danmaku} 项`);
                room.danmaku.forEach((item, index) => assertInteractiveItem(
                    item, `${roomField}.danmaku.${index}`, { kind: 'danmaku', version: sourceVersion, actorIds },
                ));
            }
            const orphanRoomId = Object.keys(liveRooms).find(roomId => !orderedRoomIds.has(roomId));
            if (orphanRoomId) throw new Error(`备份字段 ${field}.liveRooms 包含未列入 liveOrder 的直播间 ${orphanRoomId}`);
            assertVideoBackup(scope, field, actorIds);
        }
        if (isStrictBackupVersion(sourceVersion)) {
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

const assertBranchLineageText = (value, field) => {
    if (typeof value !== 'string' || !value || value !== value.trim()) throw new Error(`备份字段 ${field} 必须是非空且无首尾空白的字符串`);
    return value;
};

const assertBranchLineage = value => {
    const lineage = objectValue(value, 'branchLineage');
    for (const [targetId, entryValue] of Object.entries(lineage)) {
        assertSafeDictionaryKey(assertBranchLineageText(targetId, 'branchLineage'), 'branchLineage');
        const entry = objectValue(entryValue, `branchLineage.${targetId}`);
        assertAllowedKeys(entry, `branchLineage.${targetId}`, [
            'sourceId', 'parentChatId', 'targetChatId', 'avatar', 'completedAt', 'schemaVersion',
        ]);
        for (const key of ['sourceId', 'parentChatId', 'targetChatId', 'avatar']) {
            assertBranchLineageText(entry[key], `branchLineage.${targetId}.${key}`);
        }
        if (getStorageIdFor(entry.avatar, entry.targetChatId) !== targetId) {
            throw new Error(`备份字段 branchLineage.${targetId}.targetChatId 与目标 scope 不一致`);
        }
        if (getStorageIdFor(entry.avatar, entry.parentChatId) !== entry.sourceId) {
            throw new Error(`备份字段 branchLineage.${targetId}.sourceId 与来源聊天不一致`);
        }
        assertOptionalTimestamp(entry, 'completedAt', `branchLineage.${targetId}`);
        if (!Object.hasOwn(entry, 'completedAt')) throw new Error(`备份字段 branchLineage.${targetId}.completedAt 缺失`);
        if (entry.schemaVersion !== 1) throw new Error(`备份字段 branchLineage.${targetId}.schemaVersion 必须为 1`);
    }
    return lineage;
};

const assertTodayTrendBackupStore = value => {
    const store = objectValue(value, 'todayTrend');
    const normalized = normalizeTodayTrendStore(store);
    if (JSON.stringify(store) !== JSON.stringify(normalized)) {
        throw new Error('备份字段 todayTrend 内容无效或不是规范格式');
    }
    return normalized;
};

const assertTodayTrendV2Backup = value => {
    if (value === null) return null;
    const backup = objectValue(value, 'todayTrendV2');
    const legacyStore = backup.v2Store?.globalEnvelope?.schemaVersion === 1;
    const normalized = {
        v2Store: legacyStore ? migrateLegacyTodayTrendV2Store(backup.v2Store) : normalizeTodayTrendV2Store(backup.v2Store),
        migrationBackup: backup.migrationBackup === null ? null : normalizeTodayTrendMigrationBackup(backup.migrationBackup),
        storeRevision: backup.storeRevision,
    };
    const v2StoreRevision = normalized.v2Store.globalEnvelope.revision;
    if (!Number.isSafeInteger(normalized.storeRevision) || normalized.storeRevision < 1
        || normalized.storeRevision !== v2StoreRevision) throw new Error('备份字段 todayTrendV2 内容无效或不是规范格式');
    if (legacyStore) {
        if (Object.keys(backup).length !== 3 || !Object.hasOwn(backup, 'migrationBackup')) {
            throw new Error('备份字段 todayTrendV2 内容无效或不是规范格式');
        }
    } else if (JSON.stringify(backup) !== JSON.stringify(normalized)) {
        throw new Error('备份字段 todayTrendV2 内容无效或不是规范格式');
    }
    return normalized;
};

export function parseBackupData(data, current) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('备份根节点必须是对象');
    const version = data.schemaVersion === undefined ? 1 : data.schemaVersion;
    if (!Number.isInteger(version) || version < 1) throw new Error('备份版本无效');
    if (version > 17) throw new Error(`备份版本 ${version} 高于当前支持版本 17`);
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
    if (version >= 8) {
        const config = Object.hasOwn(data, 'injectionConfig') ? objectValue(data.injectionConfig, 'injectionConfig') : null;
        result.injectionConfig = version >= 9 ? normalizeInjectionConfig(config)
            : normalizeInjectionConfig(config, current.injectionConfig?.calendar);
    }
    if (version >= 13) {
        if (!Object.hasOwn(data, 'budgetConfig')) throw new Error('备份版本 13 缺少 budgetConfig');
        result.budgetConfig = normalizeBudgetConfig(objectValue(data.budgetConfig, 'budgetConfig'));
    }
    if (Object.hasOwn(data, 'emojis')) result.emojis = arrayValue(data.emojis, 'emojis');
    if (Object.hasOwn(data, 'characterBehavior')) result.characterBehavior = objectValue(data.characterBehavior, 'characterBehavior');
    if (Object.hasOwn(data, 'wordyLimit')) {
        if (typeof data.wordyLimit !== 'boolean') throw new Error('备份字段 wordyLimit 必须是布尔值');
        result.wordyLimit = data.wordyLimit;
    }
    if (version >= 15) {
        if (!Object.hasOwn(data, 'galBubbleEnabled')) throw new Error('备份版本 15 缺少 galBubbleEnabled');
        if (typeof data.galBubbleEnabled !== 'boolean') throw new Error('备份字段 galBubbleEnabled 必须是布尔值');
        result.galBubbleEnabled = data.galBubbleEnabled;
    }
    if (version >= 11) {
        if (!Object.hasOwn(data, 'worldBookConfig')) throw new Error('备份版本 11 缺少 worldBookConfig');
        result.worldBookConfig = normalizeWorldBookConfig(objectValue(data.worldBookConfig, 'worldBookConfig'));
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
    if (version >= 5) applyCalendarBackupFields(data, result, objectValue, { includeRecipes: version >= 7, includeOutfits: version >= 12 });
    if (version >= 10) {
        if (!Object.hasOwn(data, 'branchLineage')) throw new Error('备份版本 10 缺少 branchLineage');
        result.branchLineage = assertBranchLineage(data.branchLineage);
    }
    if (version >= 14) {
        if (!Object.hasOwn(data, 'todayTrend')) throw new Error('备份版本 14 缺少 todayTrend');
        result.todayTrend = assertTodayTrendBackupStore(data.todayTrend);
    } else {
        result.todayTrend = createEmptyTodayTrendStore();
    }
    if (version >= 16) {
        result.todayTrendV2 = Object.hasOwn(data, 'todayTrendV2') ? assertTodayTrendV2Backup(data.todayTrendV2) : null;
        result.userGeneration = Object.hasOwn(data, 'userGeneration')
            ? normalizeUserGenerationStore(objectValue(data.userGeneration, 'userGeneration'))
            : createEmptyUserGenerationStore();
    } else {
        result.todayTrendV2 = null;
        result.userGeneration = createEmptyUserGenerationStore();
    }
    if (version >= 17) {
        if (!Object.hasOwn(data, 'desktopIcons')) throw new Error('备份版本 17 缺少 desktopIcons');
        result.desktopIcons = normalizeDesktopIconBackupPayload(data.desktopIcons);
    } else {
        result.desktopIcons = {};
    }
    // 桃宝：可选字段，旧备份没有时保留现有数据；有时必须是规范格式。
    if (Object.hasOwn(data, 'shop')) {
        result.shop = assertShopBackupStore(data.shop);
        delete result.shopUnreadable;
    }
    return result;
}
