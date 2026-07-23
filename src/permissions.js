import { INTERACTIVE_STORE_VERSION, normalizeScene } from './interactive-scene-model.js';

const UNKNOWN_STORAGE_ID = 'sms_unknown__default';
const plainRecord = value => value && typeof value === 'object' && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);

function ownData(object, key) {
    if (!plainRecord(object)) return { found: false, invalid: true, value: undefined };
    const descriptor = Object.getOwnPropertyDescriptor(object, key);
    if (!descriptor) return { found: false, invalid: false, value: undefined };
    if (!Object.hasOwn(descriptor, 'value')) return { found: false, invalid: true, value: undefined };
    return { found: true, invalid: false, value: descriptor.value };
}

function dataArraySnapshot(value) {
    if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype
        || Object.getOwnPropertySymbols(value).length) return { valid: false, value: [] };
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const unsupported = Object.keys(descriptors)
        .find(key => key !== 'length' && !/^(0|[1-9]\d*)$/.test(key));
    if (unsupported) return { valid: false, value: [] };
    const snapshot = new Array(value.length);
    for (let index = 0; index < value.length; index += 1) {
        const descriptor = descriptors[index];
        if (!descriptor || !Object.hasOwn(descriptor, 'value')) return { valid: false, value: [] };
        snapshot[index] = descriptor.value;
    }
    return { valid: true, value: snapshot };
}

function optionalData(object, key) {
    const entry = ownData(object, key);
    return entry.invalid ? { valid: false, value: undefined } : { valid: true, value: entry.value };
}

function snapshotGroup(group) {
    if (!plainRecord(group)) return { valid: false, value: null };
    const name = optionalData(group, 'name');
    const membersEntry = ownData(group, 'members');
    if (!name.valid || membersEntry.invalid || !membersEntry.found) {
        return { valid: false, value: null };
    }
    const members = dataArraySnapshot(membersEntry.value);
    if (!members.valid || members.value.some(member => typeof member !== 'string')) {
        return { valid: false, value: null };
    }
    return {
        valid: true,
        value: Object.freeze({
            name: typeof name.value === 'string' ? name.value : '',
            members: Object.freeze(members.value.slice()),
        }),
    };
}

function snapshotCommunitySelection(value, storageId, sceneId) {
    if (value === undefined || value === null) {
        return { valid: true, value: Object.freeze({ mode: 'all', postIds: Object.freeze([]) }) };
    }
    const storageEntry = ownData(value, storageId);
    if (storageEntry.invalid) return { valid: false, value: null };
    if (!storageEntry.found) {
        return { valid: true, value: Object.freeze({ mode: 'all', postIds: Object.freeze([]) }) };
    }
    const sceneEntry = ownData(storageEntry.value, sceneId);
    if (sceneEntry.invalid) return { valid: false, value: null };
    if (!sceneEntry.found) {
        return { valid: true, value: Object.freeze({ mode: 'all', postIds: Object.freeze([]) }) };
    }
    if (!plainRecord(sceneEntry.value)) return { valid: false, value: null };
    const modeEntry = ownData(sceneEntry.value, 'mode');
    const postIdsEntry = ownData(sceneEntry.value, 'postIds');
    if (modeEntry.invalid || !modeEntry.found || postIdsEntry.invalid) return { valid: false, value: null };
    if (modeEntry.value === 'all') {
        return { valid: true, value: Object.freeze({ mode: 'all', postIds: Object.freeze([]) }) };
    }
    if (modeEntry.value !== 'selected' || !postIdsEntry.found) return { valid: false, value: null };
    const postIds = dataArraySnapshot(postIdsEntry.value);
    if (!postIds.valid) return { valid: false, value: null };
    const clean = [];
    for (const postId of postIds.value) {
        if (typeof postId !== 'string') return { valid: false, value: null };
        const normalized = postId.trim();
        if (!normalized || normalized.length > 80) return { valid: false, value: null };
        if (!clean.includes(normalized)) clean.push(normalized);
    }
    return {
        valid: true,
        value: Object.freeze({ mode: 'selected', postIds: Object.freeze(clean) }),
    };
}

function snapshotHistory(value) {
    const history = dataArraySnapshot(value);
    if (!history.valid) return { valid: false, value: [] };
    const snapshot = [];
    for (let index = 0; index < history.value.length; index += 1) {
        const message = history.value[index];
        if (!plainRecord(message)) return { valid: false, value: [] };
        const role = optionalData(message, 'role');
        const content = optionalData(message, 'content');
        const directorNote = optionalData(message, 'directorNote');
        if (!role.valid || !content.valid || !directorNote.valid
            || (role.value !== undefined && typeof role.value !== 'string')
            || (content.value !== undefined && typeof content.value !== 'string')
            || (directorNote.value !== undefined && typeof directorNote.value !== 'string')) {
            return { valid: false, value: [] };
        }
        snapshot.push(Object.freeze({
            role: role.value || '', content: content.value || '', directorNote: directorNote.value || '',
        }));
    }
    return { valid: true, value: Object.freeze(snapshot) };
}

export function isValidContextStorageId(value) {
    return typeof value === 'string' && !!value && value !== UNKNOWN_STORAGE_ID;
}

export function resolvePhoneSources({
    currentStorageId, currentActorName, selectedByStorage, historiesByStorage, groupsByStorage,
} = {}) {
    try {
        if (!isValidContextStorageId(currentStorageId)) return { allowed: false, reason: 'invalid-storage', sources: [] };
        const actorName = typeof currentActorName === 'string' ? currentActorName.trim() : '';
        if (!actorName) return { allowed: false, reason: 'unknown-audience', sources: [] };
        const selectedEntry = ownData(selectedByStorage, currentStorageId);
        if (selectedEntry.invalid) return { allowed: false, reason: 'invalid-selection-store', sources: [] };
        if (!selectedEntry.found) return { allowed: true, reason: 'no-selection', sources: [] };
        const selected = dataArraySnapshot(selectedEntry.value);
        if (!selected.valid) return { allowed: false, reason: 'invalid-selection', sources: [] };
        const historiesEntry = ownData(historiesByStorage, currentStorageId);
        const groupsEntry = ownData(groupsByStorage, currentStorageId);
        if (historiesEntry.invalid) return { allowed: false, reason: 'invalid-history-store', sources: [] };
        if (!historiesEntry.found || !plainRecord(historiesEntry.value)) {
            return { allowed: false, reason: 'invalid-history-bucket', sources: [] };
        }
        if (groupsEntry.invalid || (groupsEntry.found && !plainRecord(groupsEntry.value))) {
            return { allowed: false, reason: 'invalid-group-bucket', sources: [] };
        }
        const groups = groupsEntry.found && plainRecord(groupsEntry.value) ? groupsEntry.value : {};
        const sources = [];
        const seen = new Set();
        for (let index = 0; index < selected.value.length; index += 1) {
            const selectedName = selected.value[index];
            if (typeof selectedName !== 'string') return { allowed: false, reason: 'invalid-selection', sources: [] };
            const name = selectedName.trim();
            if (!name || seen.has(name)) continue;
            seen.add(name);
            const historyEntry = ownData(historiesEntry.value, name);
            if (historyEntry.invalid) return { allowed: false, reason: 'invalid-history-source', sources: [] };
            if (!historyEntry.found) continue;
            const isGroup = name.startsWith('__group_');
            const groupEntry = isGroup ? ownData(groups, name) : { found: false };
            let group = null;
            if (isGroup) {
                if (groupEntry.invalid || !groupEntry.found) return { allowed: false, reason: 'invalid-group-source', sources: [] };
                const groupSnapshot = snapshotGroup(groupEntry.value);
                if (!groupSnapshot.valid) return { allowed: false, reason: 'invalid-group-source', sources: [] };
                group = groupSnapshot.value;
                let actorIncluded = false;
                for (let memberIndex = 0; memberIndex < group.members.length; memberIndex += 1) {
                    if (group.members[memberIndex] === actorName) { actorIncluded = true; break; }
                }
                if (!actorIncluded) continue;
            } else if (name !== actorName) {
                continue;
            }
            const history = snapshotHistory(historyEntry.value);
            if (!history.valid) return { allowed: false, reason: 'invalid-history-source', sources: [] };
            sources.push(Object.freeze({
                type: 'phone', storageId: currentStorageId, sourceId: name,
                name, isGroup, history: history.value, meta: group,
            }));
        }
        return { allowed: true, reason: null, sources };
    } catch (error) {
        return { allowed: false, reason: 'resolver-error', sources: [] };
    }
}

export function resolveCommunitySources({
    currentStorageId, enabled, sceneIdsByStorage, selectionsByStorage, store,
} = {}) {
    try {
        if (!enabled) return { allowed: true, reason: 'disabled', sources: [] };
        if (!isValidContextStorageId(currentStorageId)) return { allowed: false, reason: 'invalid-storage', sources: [] };
        const sceneIdsEntry = ownData(sceneIdsByStorage, currentStorageId);
        if (sceneIdsEntry.invalid) return { allowed: false, reason: 'invalid-selection-store', sources: [] };
        if (!sceneIdsEntry.found) return { allowed: true, reason: 'no-selection', sources: [] };
        const sceneIds = dataArraySnapshot(sceneIdsEntry.value);
        if (!sceneIds.valid) return { allowed: false, reason: 'invalid-selection', sources: [] };
        const versionEntry = ownData(store, 'version');
        const scopesEntry = ownData(store, 'scopes');
        if (versionEntry.invalid || scopesEntry.invalid || !versionEntry.found
            || versionEntry.value !== INTERACTIVE_STORE_VERSION || !scopesEntry.found || !plainRecord(scopesEntry.value)) {
            return { allowed: false, reason: 'invalid-store-version', sources: [] };
        }
        const scopeEntry = ownData(scopesEntry.value, currentStorageId);
        if (scopeEntry.invalid) return { allowed: false, reason: 'invalid-scope', sources: [] };
        if (!scopeEntry.found || !plainRecord(scopeEntry.value)) return { allowed: true, reason: 'missing-scope', sources: [] };
        const scenesEntry = ownData(scopeEntry.value, 'scenes');
        const actorsEntry = ownData(scopeEntry.value, 'actors');
        if (scenesEntry.invalid || !scenesEntry.found || !plainRecord(scenesEntry.value)) {
            return { allowed: false, reason: 'invalid-scenes', sources: [] };
        }
        if (actorsEntry.invalid || !actorsEntry.found || !plainRecord(actorsEntry.value)) {
            return { allowed: false, reason: 'invalid-actors', sources: [] };
        }
        const sources = [];
        const seen = new Set();
        for (let index = 0; index < sceneIds.value.length; index += 1) {
            const rawSceneId = sceneIds.value[index];
            if (typeof rawSceneId !== 'string') return { allowed: false, reason: 'invalid-selection', sources: [] };
            const sceneId = rawSceneId.trim();
            if (!sceneId || seen.has(sceneId)) continue;
            seen.add(sceneId);
            const sceneEntry = ownData(scenesEntry.value, sceneId);
            if (sceneEntry.invalid) return { allowed: false, reason: 'invalid-scene', sources: [] };
            if (!sceneEntry.found) continue;
            const selection = snapshotCommunitySelection(selectionsByStorage, currentStorageId, sceneId);
            if (!selection.valid) {
                return { allowed: false, reason: 'invalid-post-selection', sources: [] };
            }
            const scene = normalizeScene(sceneEntry.value, {
                scope: { actors: actorsEntry.value }, scopeId: currentStorageId, sourceVersion: INTERACTIVE_STORE_VERSION,
            });
            if (scene.id !== sceneId) return { allowed: false, reason: 'invalid-scene-id', sources: [] };
            const actorIds = new Set();
            for (const post of scene.posts) {
                actorIds.add(post.authorId);
                for (const comment of post.comments) actorIds.add(comment.authorId);
            }
            for (const item of scene.live.danmaku) actorIds.add(item.authorId);
            const actors = {};
            for (const actorId of actorIds) {
                const actorEntry = ownData(actorsEntry.value, actorId);
                if (actorEntry.invalid || !actorEntry.found || !plainRecord(actorEntry.value)) {
                    return { allowed: false, reason: 'invalid-actor', sources: [] };
                }
                const displayNameEntry = ownData(actorEntry.value, 'displayName');
                if (displayNameEntry.invalid) return { allowed: false, reason: 'invalid-actor', sources: [] };
                actors[actorId] = Object.freeze({ displayName: displayNameEntry.found ? displayNameEntry.value : '' });
            }
            sources.push(Object.freeze({
                type: 'community', storageId: currentStorageId, sourceId: sceneId,
                scene: Object.freeze(scene), actors: Object.freeze(actors),
                selection: selection.value,
            }));
        }
        return { allowed: true, reason: null, sources };
    } catch (error) {
        return { allowed: false, reason: 'resolver-error', sources: [] };
    }
}
