import { BUDGET_CONFIG_KEY, normalizeBudgetConfig } from './budget.js';
import { normalizeCharacterBehaviorStore, normalizeGroupMetaStore } from './behavior-config.js';
import { normalizeCalendarStore } from './calendar-model.js';
import { normalizeOccasionStore } from './calendar-occasion-model.js';
import { normalizeCycleStore } from './calendar-cycle-model.js';
import { normalizeOutfitStore } from './calendar-outfit-model.js';
import { normalizeRecipeStore } from './calendar-recipe-model.js';
import { deriveInteractiveActorId, normalizeInteractiveStore, normalizePhoneUiState } from './interactive-scene-model.js';
import { getCurrentChatId, getStorageIdFor } from './host-context.js';
import { copyTodayTrendScope, createEmptyTodayTrendStore, normalizeTodayTrendStore } from './today-trend-model.js';
import {
    CALENDAR_CYCLE_STORAGE_KEY, CALENDAR_OCCASION_STORAGE_KEY, CALENDAR_OUTFIT_STORAGE_KEY, CALENDAR_RECIPE_STORAGE_KEY,
    CALENDAR_STORAGE_KEY, CHARACTER_BEHAVIOR_KEY, IDB_MARKER,
} from './constants.js';
import {
    commitBranchLineage, loadBranchLineage, pmIDBGet, pmIDBKeys,
    PHONE_UI_STORAGE_KEY,
    readHistoriesSnapshot,
    saveBidirectional, saveCharacterBehavior, saveGroupMeta, saveHistoriesStrict, saveInteractiveScenes,
    savePhoneUiState, savePokeConfig, saveBudgetConfig,
} from './storage.js';
import { awaitDirectoryOperations, completeDirectoryBranchScope, enqueueDirectoryOperation, markDirectoryBranchScope } from './directory-save-coordinator.js';
import { saveBgLocal } from './storage-background.js';
import {
    saveCalendar, saveCalendarCycles, saveCalendarOccasions, saveCalendarOutfits, saveCalendarRecipes,
} from './calendar-storage.js';
import { loadTodayTrendStore, saveTodayTrendStore } from './today-trend-storage.js';

const clone = value => structuredClone(value);
const own = (value, key) => !!value && typeof value === 'object' && Object.hasOwn(value, key);
const validText = value => typeof value === 'string' && value.trim() ? value.trim() : '';
const BRANCH_INTERACTIVE_STORE_KEY = 'ST_INTERACTIVE_SCENES_V1';
const BRANCH_SOURCE_ASYNC_STORES = Object.freeze(['histories', 'groupMeta', 'interactive', 'backgrounds', 'todayTrend']);
const pendingByTarget = new Map();

export function resolveBranchInheritance(context) {
    const avatar = validText(context?.characters?.[context.characterId]?.avatar);
    const targetChatId = validText(getCurrentChatId(context));
    const parentChatId = validText(context?.chatMetadata?.main_chat || context?.chat_metadata?.main_chat);
    if (!avatar || !targetChatId || !parentChatId || parentChatId === targetChatId) return null;
    const sourceId = getStorageIdFor(avatar, parentChatId);
    const targetId = getStorageIdFor(avatar, targetChatId);
    if (sourceId === 'sms_unknown__default' || targetId === 'sms_unknown__default' || sourceId === targetId) return null;
    return { avatar, parentChatId, targetChatId, sourceId, targetId };
}

function scopeBackgroundKeys(storageId, backgrounds) {
    const prefix = `${storageId}_`;
    return Object.keys(backgrounds || {}).filter(key => key.startsWith(prefix));
}

function hasContent(value) {
    if (Array.isArray(value)) return value.some(hasContent);
    if (value && typeof value === 'object') return Object.values(value).some(hasContent);
    return typeof value === 'string' ? value.length > 0 : value !== null && value !== undefined;
}

function scopePresence(storageId, stores, contentOnly = false) {
    const flat = ['histories', 'groupMeta', 'pokeConfig', 'characterBehavior', 'bidirectional'];
    const scoped = ['interactive', 'phoneUi', 'calendar', 'occasions', 'cycles', 'recipes', 'outfits', 'todayTrend'];
    const presence = {};
    const included = value => !contentOnly || hasContent(value);
    for (const key of flat) {
        const present = own(stores[key], storageId) && included(stores[key][storageId]);
        presence[key] = { present, count: present ? 1 : 0 };
    }
    const backgroundCount = scopeBackgroundKeys(storageId, stores.backgrounds)
        .filter(key => included(stores.backgrounds[key])).length;
    presence.backgrounds = { present: backgroundCount > 0, count: backgroundCount };
    for (const key of scoped) {
        const present = own(stores[key]?.scopes, storageId) && included(stores[key].scopes[storageId]);
        presence[key] = { present, count: present ? 1 : 0 };
    }
    const budgetCount = Number(own(stores.budget?.communitySceneIdsByStorage, storageId)
        && included(stores.budget.communitySceneIdsByStorage[storageId]))
        + Number(own(stores.budget?.communitySelectionsByStorage, storageId)
        && included(stores.budget.communitySelectionsByStorage[storageId]));
    presence.budget = { present: budgetCount > 0, count: budgetCount };
    return Object.freeze(presence);
}

function hasScopeData(presence) {
    return Object.values(presence).some(value => value.present);
}

function hasTargetData(targetId, stores) {
    return hasScopeData(scopePresence(targetId, stores, false));
}

function copyEntry(target, source, sourceId, targetId) {
    if (own(source, sourceId)) target[targetId] = clone(source[sourceId]);
}

function remapInteractiveScope(sourceScope, targetId) {
    const scope = clone(sourceScope);
    const actorIdMap = new Map();
    const actors = {};
    for (const [sourceActorId, actor] of Object.entries(scope.actors || {})) {
        const targetActorId = deriveInteractiveActorId(targetId, actor.type, actor.bindingKey);
        actorIdMap.set(sourceActorId, targetActorId);
        actors[targetActorId] = { ...actor, actorId: targetActorId };
    }
    const remapAuthor = item => {
        if (actorIdMap.has(item.authorId)) item.authorId = actorIdMap.get(item.authorId);
    };
    for (const scene of Object.values(scope.scenes || {})) {
        for (const post of scene.posts || []) {
            remapAuthor(post);
            for (const comment of post.comments || []) remapAuthor(comment);
        }
        for (const danmaku of scene.live?.danmaku || []) remapAuthor(danmaku);
    }
    scope.actors = actors;
    return scope;
}

function createCandidates(sourceId, targetId, stores) {
    const next = clone(stores);
    for (const key of ['histories', 'groupMeta', 'pokeConfig', 'characterBehavior', 'bidirectional']) {
        copyEntry(next[key], stores[key], sourceId, targetId);
    }
    for (const key of scopeBackgroundKeys(sourceId, stores.backgrounds)) {
        next.backgrounds[`${targetId}${key.slice(sourceId.length)}`] = clone(stores.backgrounds[key]);
    }
    if (own(stores.interactive.scopes, sourceId)) {
        next.interactive.scopes[targetId] = remapInteractiveScope(stores.interactive.scopes[sourceId], targetId);
    }
    for (const key of ['phoneUi', 'calendar', 'occasions', 'cycles', 'recipes', 'outfits']) {
        copyEntry(next[key].scopes, stores[key].scopes, sourceId, targetId);
    }
    if (own(stores.todayTrend.scopes, sourceId)) {
        next.todayTrend.scopes[targetId] = copyTodayTrendScope(stores.todayTrend.scopes[sourceId], targetId);
    }
    copyEntry(next.budget.communitySceneIdsByStorage, stores.budget.communitySceneIdsByStorage, sourceId, targetId);
    copyEntry(next.budget.communitySelectionsByStorage, stores.budget.communitySelectionsByStorage, sourceId, targetId);
    next.groupMeta = normalizeGroupMetaStore(next.groupMeta);
    next.characterBehavior = normalizeCharacterBehaviorStore(next.characterBehavior);
    next.interactive = normalizeInteractiveStore(next.interactive);
    next.phoneUi = normalizePhoneUiState(next.phoneUi, next.interactive);
    next.calendar = normalizeCalendarStore(next.calendar);
    next.occasions = normalizeOccasionStore(next.occasions);
    next.cycles = normalizeCycleStore(next.cycles);
    next.recipes = normalizeRecipeStore(next.recipes);
    next.outfits = normalizeOutfitStore(next.outfits);
    next.budget = normalizeBudgetConfig(next.budget);
    next.todayTrend = normalizeTodayTrendStore(next.todayTrend);
    return next;
}

function replaceEntry(target, source, key) {
    if (own(source, key)) target[key] = clone(source[key]);
    else delete target[key];
}

export function mergeBranchScope(current, desired, targetId) {
    const next = clone(normalizeStores(current));
    const source = normalizeStores(desired);
    for (const key of ['histories', 'groupMeta', 'pokeConfig', 'characterBehavior', 'bidirectional']) {
        replaceEntry(next[key], source[key], targetId);
    }
    for (const key of scopeBackgroundKeys(targetId, next.backgrounds)) delete next.backgrounds[key];
    for (const key of scopeBackgroundKeys(targetId, source.backgrounds)) next.backgrounds[key] = clone(source.backgrounds[key]);
    for (const key of ['interactive', 'phoneUi', 'calendar', 'occasions', 'cycles', 'recipes', 'outfits']) {
        replaceEntry(next[key].scopes, source[key].scopes, targetId);
    }
    replaceEntry(next.todayTrend.scopes, source.todayTrend.scopes, targetId);
    replaceEntry(next.budget.communitySceneIdsByStorage, source.budget.communitySceneIdsByStorage, targetId);
    replaceEntry(next.budget.communitySelectionsByStorage, source.budget.communitySelectionsByStorage, targetId);
    return normalizeStores(next);
}

function normalizeStores(stores) {
    return {
        histories: stores.histories || {}, groupMeta: stores.groupMeta || {}, pokeConfig: stores.pokeConfig || {},
        characterBehavior: stores.characterBehavior || {}, bidirectional: stores.bidirectional || {}, backgrounds: stores.backgrounds || {},
        interactive: stores.interactive || { version: 2, scopes: {} }, phoneUi: stores.phoneUi || { version: 1, scopes: {} },
        calendar: stores.calendar || { version: 1, scopes: {} }, occasions: stores.occasions || { version: 1, scopes: {} },
        cycles: stores.cycles || { version: 1, scopes: {} }, recipes: stores.recipes || { version: 1, scopes: {} }, outfits: stores.outfits || { version: 1, scopes: {} },
        budget: stores.budget || normalizeBudgetConfig(),
        todayTrend: normalizeTodayTrendStore(stores.todayTrend || createEmptyTodayTrendStore()),
    };
}

function same(value, other) {
    return JSON.stringify(value) === JSON.stringify(other);
}

function replaceScope(store, desired, targetId) {
    const next = clone(store || {});
    replaceEntry(next, desired || {}, targetId);
    return next;
}

export function mergePhoneUiBranchScope(currentState, desiredState, expectedState, targetId, interactiveStore) {
    const current = normalizePhoneUiState(currentState, interactiveStore);
    const desired = normalizePhoneUiState(desiredState, interactiveStore);
    const expected = normalizePhoneUiState(expectedState, interactiveStore);
    const restoring = !own(desired.scopes, targetId);
    if (!restoring && own(current.scopes, targetId)) {
        throw new Error('分支继承保存失败：目标 scope 已被并发写入 (手机页面状态)');
    }
    if (restoring && own(current.scopes, targetId) && !same(current.scopes[targetId], expected.scopes[targetId])) {
        throw new Error('分支继承补偿取消：目标 scope 已在事务后被更新 (手机页面状态)');
    }
    const scopes = replaceScope(current.scopes, desired.scopes, targetId);
    return normalizePhoneUiState({
        version: 1,
        scopes,
        ...(current.sharedCommunityTemplates?.length
            ? { sharedCommunityTemplates: current.sharedCommunityTemplates }
            : {}),
    }, interactiveStore);
}

async function readHistoriesForBranch() {
    try {
        return await readHistoriesSnapshot({ requireConfirmedPrimary: true });
    } catch (error) {
        throw new Error(`分支继承来源读取失败：${error?.message || '聊天记录不可用'}`);
    }
}

async function readGroupMetaForBranch() {
    const fallback = localStorage.getItem('ST_SMS_GROUP_META_LOCAL_FALLBACK');
    if (fallback) return normalizeGroupMetaStore(JSON.parse(fallback));
    const value = await pmIDBGet('ST_SMS_GROUP_META');
    if (value && typeof value === 'object' && !Array.isArray(value)) return normalizeGroupMetaStore(value);
    const raw = localStorage.getItem('ST_SMS_GROUP_META');
    return normalizeGroupMetaStore(raw ? JSON.parse(raw) : {});
}

function readLocalStoreForBranch(key, normalize, label) {
    try {
        const raw = localStorage.getItem(key);
        return normalize(raw ? JSON.parse(raw) : {});
    } catch (error) {
        throw new Error(`分支继承来源读取失败：${label}`);
    }
}

async function readInteractiveForBranch() {
    try {
        const fallback = localStorage.getItem(`${BRANCH_INTERACTIVE_STORE_KEY}_LOCAL_FALLBACK`);
        if (fallback) return normalizeInteractiveStore(JSON.parse(fallback));
        const keys = await pmIDBKeys();
        if (!Array.isArray(keys)) throw new Error('无法枚举 IndexedDB');
        if (!keys.includes(BRANCH_INTERACTIVE_STORE_KEY)) return normalizeInteractiveStore(null);
        const value = await pmIDBGet(BRANCH_INTERACTIVE_STORE_KEY);
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('主存储无效');
        return normalizeInteractiveStore(value);
    } catch (error) {
        throw new Error('分支继承来源读取失败：互动社区数据无效');
    }
}

function readPhoneUiForBranch(interactive) {
    try {
        return normalizePhoneUiState(JSON.parse(localStorage.getItem(PHONE_UI_STORAGE_KEY) || 'null'), interactive);
    } catch (error) {
        throw new Error('分支继承来源读取失败：手机界面状态无效');
    }
}

function readCalendarForBranch(key, normalize, label) {
    return readLocalStoreForBranch(key, value => normalize({ version: 1, scopes: value?.scopes || {} }), label);
}

async function readBackgroundsForBranch() {
    const pointers = readLocalStoreForBranch('ST_SMS_BG_LOCAL', value => value, '会话背景索引');
    const backgrounds = {};
    for (const [key, pointer] of Object.entries(pointers)) {
        if (typeof pointer !== 'string') throw new Error('分支继承来源读取失败：会话背景索引无效');
        if (pointer !== IDB_MARKER) {
            backgrounds[key] = pointer;
            continue;
        }
        const value = await pmIDBGet(`ST_SMS_BG_LOCAL_${key}`);
        if (typeof value !== 'string') throw new Error('分支继承来源读取失败：会话背景主存储无效');
        backgrounds[key] = value;
    }
    return backgrounds;
}

function readBudgetForBranch() {
    return readLocalStoreForBranch(BUDGET_CONFIG_KEY, normalizeBudgetConfig, '社区预算配置');
}

function commitBudgetScope({ desired, expected, targetId }) {
    const current = readBudgetForBranch();
    const restoring = !own(desired.communitySceneIdsByStorage, targetId)
        && !own(desired.communitySelectionsByStorage, targetId);
    const targetChanged = !same(current.communitySceneIdsByStorage[targetId], expected.communitySceneIdsByStorage[targetId])
        || !same(current.communitySelectionsByStorage[targetId], expected.communitySelectionsByStorage[targetId]);
    if (!restoring && (own(current.communitySceneIdsByStorage, targetId) || own(current.communitySelectionsByStorage, targetId))) {
        throw new Error('分支继承保存失败：目标 scope 已被并发写入 (社区预算配置)');
    }
    if (restoring && targetChanged) {
        throw new Error('分支继承补偿取消：目标 scope 已在事务后被更新 (社区预算配置)');
    }
    const merged = clone(current);
    replaceEntry(merged.communitySceneIdsByStorage, desired.communitySceneIdsByStorage, targetId);
    replaceEntry(merged.communitySelectionsByStorage, desired.communitySelectionsByStorage, targetId);
    try {
        localStorage.setItem(BUDGET_CONFIG_KEY, JSON.stringify(normalizeBudgetConfig(merged)));
    } catch (error) {
        throw new Error('分支继承保存失败：社区预算配置不可用');
    }
    return normalizeBudgetConfig(merged);
}

function commitLocalScope({ key, desired, expected, targetId, normalize, label }) {
    const current = readLocalStoreForBranch(key, normalize, label);
    const restoring = !own(desired, targetId);
    if (!restoring && own(current, targetId)) {
        throw new Error(`分支继承保存失败：目标 scope 已被并发写入 (${label})`);
    }
    if (restoring && own(current, targetId) && !same(current[targetId], expected[targetId])) {
        throw new Error(`分支继承补偿取消：目标 scope 已在事务后被更新 (${label})`);
    }
    const merged = replaceScope(current, desired, targetId);
    try {
        localStorage.setItem(key, JSON.stringify(normalize(merged)));
    } catch (error) {
        throw new Error(`分支继承保存失败：${label}不可用`);
    }
    return merged;
}

async function commitLocalScopeCoordinated(store, options) {
    const token = markDirectoryBranchScope(store, options.targetId);
    try {
        return await enqueueDirectoryOperation(store, () => commitLocalScope(options));
    } finally {
        completeDirectoryBranchScope(store, token);
    }
}

async function commitPhoneUiScopeCoordinated({ desired, expected, targetId, interactive }) {
    const token = markDirectoryBranchScope('phoneUi', targetId);
    try {
        return await enqueueDirectoryOperation('phoneUi', () => {
            const current = readPhoneUiForBranch(interactive);
            const merged = mergePhoneUiBranchScope(current, desired, expected, targetId, interactive);
            try {
                localStorage.setItem(PHONE_UI_STORAGE_KEY, JSON.stringify(merged));
            } catch (error) {
                throw new Error('分支继承保存失败：手机页面状态不可用');
            }
            return merged;
        });
    } finally {
        completeDirectoryBranchScope('phoneUi', token);
    }
}

async function commitBudgetScopeCoordinated(options) {
    const token = markDirectoryBranchScope('budget', options.targetId);
    try {
        return await enqueueDirectoryOperation('budget', () => commitBudgetScope(options));
    } finally {
        completeDirectoryBranchScope('budget', token);
    }
}

function mergeCalendarBranchScope({ key, desired, expected, targetId, normalize, label }) {
    const current = readCalendarForBranch(key, normalize, label);
    const restoring = !own(desired.scopes, targetId);
    if (!restoring && own(current.scopes, targetId)) {
        throw new Error(`分支继承保存失败：目标 scope 已被并发写入 (${label})`);
    }
    if (restoring && own(current.scopes, targetId) && !same(current.scopes[targetId], expected.scopes[targetId])) {
        throw new Error(`分支继承补偿取消：目标 scope 已在事务后被更新 (${label})`);
    }
    const merged = clone(current);
    replaceEntry(merged.scopes, desired.scopes, targetId);
    return normalize(merged);
}

async function commitCalendarScopes({ desired, expected, targetId }) {
    const token = markDirectoryBranchScope('schedule', targetId);
    try {
        return await enqueueDirectoryOperation('schedule', async () => {
        const calendar = mergeCalendarBranchScope({ key: CALENDAR_STORAGE_KEY, desired: desired.calendar, expected: expected.calendar, targetId,
            normalize: normalizeCalendarStore, label: '日历数据' });
        const occasions = mergeCalendarBranchScope({ key: CALENDAR_OCCASION_STORAGE_KEY, desired: desired.occasions, expected: expected.occasions, targetId,
            normalize: normalizeOccasionStore, label: '生日与纪念日数据' });
        try {
            localStorage.setItem(CALENDAR_STORAGE_KEY, JSON.stringify(calendar));
            localStorage.setItem(CALENDAR_OCCASION_STORAGE_KEY, JSON.stringify(occasions));
        } catch (error) {
            throw new Error('分支继承保存：日程数据不可用');
        }
        return { calendar, occasions };
        });
    } finally {
        completeDirectoryBranchScope('schedule', token);
    }
}

async function commitInteractiveScope({ desired, expected, targetId }) {
    const token = markDirectoryBranchScope('interactive', targetId);
    try {
        return await enqueueDirectoryOperation('interactive', async () => {
            const current = await readInteractiveForBranch();
            const restoring = !own(desired.scopes, targetId);
            if (!restoring && own(current.scopes, targetId)) {
                throw new Error('分支继承保存失败：目标 scope 已被并发写入 (互动社区数据)');
            }
            if (restoring && own(current.scopes, targetId) && !same(current.scopes[targetId], expected.scopes[targetId])) {
                throw new Error('分支继承补偿取消：目标 scope 已在事务后被更新 (互动社区数据)');
            }
            const merged = clone(current);
            replaceEntry(merged.scopes, desired.scopes, targetId);
            await saveInteractiveScenes(normalizeInteractiveStore(merged), { coordinated: true });
            return merged;
        });
    } finally {
        completeDirectoryBranchScope('interactive', token);
    }
}

async function commitBackgroundScope({ desired, expected, targetId }) {
    const token = markDirectoryBranchScope('backgrounds', targetId);
    try {
        return await enqueueDirectoryOperation('backgrounds', async () => {
        const current = await readBackgroundsForBranch();
        const expectedKeys = scopeBackgroundKeys(targetId, expected);
        const currentKeys = scopeBackgroundKeys(targetId, current);
        const desiredKeys = scopeBackgroundKeys(targetId, desired);
        const restoring = desiredKeys.length === 0;
        const currentMatchesExpected = currentKeys.length === expectedKeys.length
            && currentKeys.every(key => expectedKeys.includes(key) && same(current[key], expected[key]));
        if (!restoring && currentKeys.length) {
            throw new Error('分支继承保存失败：目标 scope 已被并发写入 (会话背景)');
        }
        if (restoring && currentKeys.length && !currentMatchesExpected) {
            throw new Error('分支继承补偿取消：目标 scope 已在事务后被更新 (会话背景)');
        }
        const merged = clone(current);
        for (const key of currentKeys) delete merged[key];
        for (const key of desiredKeys) merged[key] = clone(desired[key]);
        return saveBgLocal({ data: merged, coordinated: true });
        });
    } finally {
        completeDirectoryBranchScope('backgrounds', token);
    }
}

async function commitDirectoryScope(store, desired, expected, targetId) {
    const token = markDirectoryBranchScope(store, targetId);
    try {
        return await enqueueDirectoryOperation(store, async () => {
            const current = store === 'histories' ? await readHistoriesForBranch() : await readGroupMetaForBranch();
            const restoring = !own(desired, targetId);
            if (!restoring && own(current, targetId)) {
                throw new Error(`分支继承保存失败：目标 scope 已被并发写入 (${store})`);
            }
            if (restoring && own(current, targetId) && !same(current[targetId], expected[targetId])) {
                throw new Error(`分支继承补偿取消：目标 scope 已在事务后被更新 (${store})`);
            }
            const merged = replaceScope(current, desired, targetId);
            if (store === 'histories') await saveHistoriesStrict(merged, { requireLocalMirror: true, coordinated: true });
            else await saveGroupMeta(merged, { coordinated: true });
            return merged;
        });
    } finally {
        completeDirectoryBranchScope(store, token);
    }
}

async function commitTodayTrendScope({ desired, expected, targetId }) {
    const token = markDirectoryBranchScope('todayTrend', targetId);
    try {
        return await enqueueDirectoryOperation('todayTrend', async () => {
            const current = normalizeTodayTrendStore(await loadTodayTrendStore());
            const restoring = !own(desired.scopes, targetId);
            if (!restoring && own(current.scopes, targetId)) {
                throw new Error('分支继承保存失败：目标 scope 已被并发写入 (今日风向)');
            }
            if (restoring && own(current.scopes, targetId) && !same(current.scopes[targetId], expected.scopes[targetId])) {
                throw new Error('分支继承补偿取消：目标 scope 已在事务后被更新 (今日风向)');
            }
            const merged = clone(current);
            replaceEntry(merged.scopes, desired.scopes, targetId);
            const normalized = normalizeTodayTrendStore(merged);
            await saveTodayTrendStore(normalized);
            return normalized;
        });
    } finally {
        completeDirectoryBranchScope('todayTrend', token);
    }
}

export async function inheritPhoneDataOnBranch({ context, loadStores, saveStores, loadLineage, saveLineage, commitLineage, now = Date.now, force = false }) {
    const branch = resolveBranchInheritance(context);
    if (!branch) return { status: 'skipped', reason: 'not-branch' };
    if (pendingByTarget.has(branch.targetId)) return pendingByTarget.get(branch.targetId);
    const operation = (async () => {
        const lineage = await loadLineage();
        if (own(lineage, branch.targetId) && !force) return { status: 'skipped', reason: 'already-cloned', ...branch };
        const stores = normalizeStores(await loadStores());
        const sourcePresence = scopePresence(branch.sourceId, stores, true);
        const targetPresence = scopePresence(branch.targetId, stores, false);
        const diagnostics = { sourcePresence, targetPresence };
        if (hasTargetData(branch.targetId, stores)) return { status: 'skipped', reason: 'target-not-empty', ...branch, ...diagnostics };
        if (!hasScopeData(sourcePresence)) return { status: 'skipped', reason: 'source-empty', ...branch, ...diagnostics };
        const candidate = createCandidates(branch.sourceId, branch.targetId, stores);
        const nextLineage = {
            ...lineage,
            [branch.targetId]: {
                sourceId: branch.sourceId, parentChatId: branch.parentChatId, targetChatId: branch.targetChatId,
                avatar: branch.avatar, completedAt: now(), schemaVersion: 1,
            },
        };
        let storesSaved = false;
        try {
            await saveStores(candidate, { branch, previous: stores });
            storesSaved = true;
            if (commitLineage) await commitLineage(branch.targetId, nextLineage[branch.targetId]);
            else await saveLineage(nextLineage);
            return { status: 'cloned', ...branch, ...diagnostics };
        } catch (error) {
            if (storesSaved) {
                try { await saveStores(stores, { branch, previous: candidate }); }
                catch (rollbackError) {
                    const combined = new Error(`${error.message}；分支继承数据回滚失败：${rollbackError.message}`);
                    combined.cause = error; combined.rollbackError = rollbackError; throw combined;
                }
            }
            throw error;
        }
    })().finally(() => pendingByTarget.delete(branch.targetId));
    pendingByTarget.set(branch.targetId, operation);
    return operation;
}

export function awaitPendingBranchInheritance(storageId) {
    return pendingByTarget.get(storageId) || Promise.resolve(null);
}

export function getPendingBranchInheritanceTargets() {
    return Object.freeze(Array.from(pendingByTarget.keys()));
}

async function loadProductionStores() {
    const interactive = await readInteractiveForBranch();
    return normalizeStores({
        histories: await readHistoriesForBranch(),
        groupMeta: await readGroupMetaForBranch(),
        pokeConfig: readLocalStoreForBranch('ST_SMS_POKE_CONFIG', value => value, '拍一拍配置'),
        characterBehavior: readLocalStoreForBranch(CHARACTER_BEHAVIOR_KEY, normalizeCharacterBehaviorStore, '角色行为配置'),
        bidirectional: readLocalStoreForBranch('ST_SMS_BIDIRECTIONAL', value => value, '双向注入配置'),
        backgrounds: await readBackgroundsForBranch(),
        interactive,
        phoneUi: readPhoneUiForBranch(interactive),
        calendar: readCalendarForBranch(CALENDAR_STORAGE_KEY, normalizeCalendarStore, '日历数据'),
        occasions: readCalendarForBranch(CALENDAR_OCCASION_STORAGE_KEY, normalizeOccasionStore, '生日与纪念日数据'),
        cycles: readCalendarForBranch(CALENDAR_CYCLE_STORAGE_KEY, normalizeCycleStore, '生理周期数据'),
        recipes: readCalendarForBranch(CALENDAR_RECIPE_STORAGE_KEY, normalizeRecipeStore, '菜谱数据'),
        outfits: readCalendarForBranch(CALENDAR_OUTFIT_STORAGE_KEY, normalizeOutfitStore, '穿搭数据'),
        budget: readBudgetForBranch(),
        todayTrend: await loadTodayTrendStore(),
    });
}

async function loadStableProductionStores() {
    await awaitDirectoryOperations(BRANCH_SOURCE_ASYNC_STORES);
    return loadProductionStores();
}

async function persistProductionStores(next, { branch } = {}) {
    const targetId = branch?.targetId;
    const previous = clone(await loadProductionStores());
    const apply = async (desired, expected) => {
        if (targetId) {
            globalThis.window.__pmHistories = await commitDirectoryScope('histories', desired.histories, expected.histories, targetId);
            globalThis.window.__pmGroupMeta = await commitDirectoryScope('groupMeta', desired.groupMeta, expected.groupMeta, targetId);
        } else {
            globalThis.window.__pmHistories = desired.histories;
            await saveHistoriesStrict(desired.histories, { requireLocalMirror: true });
            globalThis.window.__pmGroupMeta = desired.groupMeta;
            await saveGroupMeta(desired.groupMeta);
        }

        if (targetId) {
            globalThis.window.__pmPokeConfig = await commitLocalScopeCoordinated('pokeConfig', {
                key: 'ST_SMS_POKE_CONFIG', desired: desired.pokeConfig, expected: expected.pokeConfig, targetId,
                normalize: value => value, label: '拍一拍配置',
            });
            globalThis.window.__pmCharacterBehavior = await commitLocalScopeCoordinated('characterBehavior', {
                key: CHARACTER_BEHAVIOR_KEY, desired: desired.characterBehavior, expected: expected.characterBehavior, targetId,
                normalize: normalizeCharacterBehaviorStore, label: '角色行为配置',
            });
            globalThis.window.__pmBidirectional = await commitLocalScopeCoordinated('bidirectional', {
                key: 'ST_SMS_BIDIRECTIONAL', desired: desired.bidirectional, expected: expected.bidirectional, targetId,
                normalize: value => value, label: '双向注入配置',
            });
            globalThis.window.__pmBudgetConfig = await commitBudgetScopeCoordinated({ desired: desired.budget, expected: expected.budget, targetId });
        } else {
            globalThis.window.__pmPokeConfig = desired.pokeConfig;
            if (!savePokeConfig()) throw new Error('分支继承保存失败：拍一拍配置不可用');
            globalThis.window.__pmCharacterBehavior = desired.characterBehavior;
            if (!saveCharacterBehavior()) throw new Error('分支继承保存失败：角色行为配置不可用');
            globalThis.window.__pmBidirectional = desired.bidirectional;
            if (!saveBidirectional()) throw new Error('分支继承保存失败：双向注入配置不可用');
            globalThis.window.__pmBudgetConfig = desired.budget;
            if (!saveBudgetConfig(desired.budget)) throw new Error('分支继承保存失败：社区预算配置不可用');
        }

        if (targetId) {
            globalThis.window.__pmBgLocal = await commitBackgroundScope({ desired: desired.backgrounds, expected: expected.backgrounds, targetId });
            const interactive = await commitInteractiveScope({ desired: desired.interactive, expected: expected.interactive, targetId });
            globalThis.window.__pmPhoneUiState = await commitPhoneUiScopeCoordinated({
                desired: desired.phoneUi, expected: expected.phoneUi, targetId, interactive,
            });
            await commitCalendarScopes({ desired, expected, targetId });
            await commitLocalScopeCoordinated('cycles', { key: CALENDAR_CYCLE_STORAGE_KEY,
                desired: desired.cycles, expected: expected.cycles, targetId,
                normalize: normalizeCycleStore, label: '生理周期数据' });
            await commitLocalScopeCoordinated('recipes', { key: CALENDAR_RECIPE_STORAGE_KEY,
                desired: desired.recipes, expected: expected.recipes, targetId,
                normalize: normalizeRecipeStore, label: '菜谱数据' });
            await commitLocalScopeCoordinated('outfits', { key: CALENDAR_OUTFIT_STORAGE_KEY,
                desired: desired.outfits, expected: expected.outfits, targetId,
                normalize: normalizeOutfitStore, label: '穿搭数据' });
            globalThis.window.__pmTodayTrend = await commitTodayTrendScope({ desired: desired.todayTrend, expected: expected.todayTrend, targetId });
        } else {
            globalThis.window.__pmBgLocal = await saveBgLocal({ data: desired.backgrounds });
            await saveInteractiveScenes(desired.interactive);
            if (!savePhoneUiState(desired.phoneUi, desired.interactive)) throw new Error('分支继承保存失败：手机页面状态不可用');
            if (!saveCalendar(desired.calendar) || !saveCalendarOccasions(desired.occasions)
                || !saveCalendarCycles(desired.cycles) || !saveCalendarRecipes(desired.recipes) || !saveCalendarOutfits(desired.outfits)) {
                throw new Error('分支继承保存失败：日历 scope 不可用');
            }
            globalThis.window.__pmTodayTrend = normalizeTodayTrendStore(desired.todayTrend);
            await saveTodayTrendStore(globalThis.window.__pmTodayTrend);
        }
    };
    try {
        await apply(next, previous);
    } catch (error) {
        try {
            const latest = await loadProductionStores();
            await apply(targetId ? mergeBranchScope(latest, previous, targetId) : previous, next);
        }
        catch (rollbackError) {
            const combined = new Error(`${error.message}；分支继承持久化回滚失败：${rollbackError.message}`);
            combined.cause = error; combined.rollbackError = rollbackError; throw combined;
        }
        throw error;
    }
}

export function beginBranchInheritance(context, { getStorageId, invalidateInteractiveStore, reloadCalendarStore, reloadTodayTrendStore, force = false } = {}) {
    const branch = resolveBranchInheritance(context);
    const branchScopeTokens = branch
        ? ['pokeConfig', 'characterBehavior', 'bidirectional', 'budget', 'todayTrend'].map(store => [store, markDirectoryBranchScope(store, branch.targetId)])
        : [];
    const operation = inheritPhoneDataOnBranch({
        context,
        loadStores: loadStableProductionStores,
        saveStores: persistProductionStores,
        loadLineage: loadBranchLineage,
        commitLineage: commitBranchLineage,
        force,
    }).finally(() => {
        for (const [store, token] of branchScopeTokens) completeDirectoryBranchScope(store, token);
    });
    return operation.then(result => {
        if (result.status === 'cloned' && (!getStorageId || getStorageId() === result.targetId)) {
            try {
                invalidateInteractiveStore?.();
            } catch (error) {
                console.warn('[phone-mode] 分支继承后的互动运行态刷新失败', error);
            }
            try {
                reloadCalendarStore?.();
            } catch (error) {
                console.warn('[phone-mode] 分支继承后的日历运行态刷新失败', error);
            }
            try {
                reloadTodayTrendStore?.();
            } catch (error) {
                console.warn('[phone-mode] 分支继承后的今日风向运行态刷新失败', error);
            }
        }
        return result;
    });
}
