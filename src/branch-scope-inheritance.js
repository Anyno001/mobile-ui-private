import { BUDGET_CONFIG_KEY, normalizeBudgetConfig } from './budget.js';
import { normalizeCharacterBehaviorStore, normalizeGroupMetaStore } from './behavior-config.js';
import { normalizeCalendarStore } from './calendar-model.js';
import { normalizeOccasionStore } from './calendar-occasion-model.js';
import { normalizeCycleStore } from './calendar-cycle-model.js';
import { normalizeRecipeStore } from './calendar-recipe-model.js';
import { deriveInteractiveActorId, normalizeInteractiveStore, normalizePhoneUiState } from './interactive-scene-model.js';
import { getCurrentChatId, getStorageIdFor } from './host-context.js';
import {
    CALENDAR_CYCLE_STORAGE_KEY, CALENDAR_OCCASION_STORAGE_KEY, CALENDAR_RECIPE_STORAGE_KEY,
    CALENDAR_STORAGE_KEY, CHARACTER_BEHAVIOR_KEY, IDB_MARKER,
} from './constants.js';
import {
    commitBranchLineage, loadBranchLineage, pmIDBGet, pmIDBKeys,
    PHONE_UI_STORAGE_KEY,
    saveBidirectional, saveCharacterBehavior, saveGroupMeta, saveHistoriesStrict, saveInteractiveScenes,
    savePhoneUiState, savePokeConfig, saveBudgetConfig,
} from './storage.js';
import { completeDirectoryBranchScope, enqueueDirectoryOperation, markDirectoryBranchScope } from './directory-save-coordinator.js';
import { saveBgLocal } from './storage-background.js';
import {
    saveCalendar, saveCalendarCycles, saveCalendarOccasions, saveCalendarRecipes,
} from './calendar-storage.js';

const clone = value => structuredClone(value);
const own = (value, key) => !!value && typeof value === 'object' && Object.hasOwn(value, key);
const validText = value => typeof value === 'string' && value.trim() ? value.trim() : '';
const BRANCH_INTERACTIVE_STORE_KEY = 'ST_INTERACTIVE_SCENES_V1';
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

function hasTargetData(targetId, stores) {
    const maps = [stores.histories, stores.groupMeta, stores.pokeConfig, stores.characterBehavior, stores.bidirectional];
    if (maps.some(store => own(store, targetId))) return true;
    if (scopeBackgroundKeys(targetId, stores.backgrounds).length) return true;
    if (own(stores.interactive?.scopes, targetId) || own(stores.phoneUi?.scopes, targetId)) return true;
    if (own(stores.calendar?.scopes, targetId) || own(stores.occasions?.scopes, targetId)
        || own(stores.cycles?.scopes, targetId) || own(stores.recipes?.scopes, targetId)) return true;
    return own(stores.budget?.communitySceneIdsByStorage, targetId)
        || own(stores.budget?.communitySelectionsByStorage, targetId);
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
    for (const key of ['phoneUi', 'calendar', 'occasions', 'cycles', 'recipes']) {
        copyEntry(next[key].scopes, stores[key].scopes, sourceId, targetId);
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
    next.budget = normalizeBudgetConfig(next.budget);
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
    for (const key of ['interactive', 'phoneUi', 'calendar', 'occasions', 'cycles', 'recipes']) {
        replaceEntry(next[key].scopes, source[key].scopes, targetId);
    }
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
        cycles: stores.cycles || { version: 1, scopes: {} }, recipes: stores.recipes || { version: 1, scopes: {} },
        budget: stores.budget || normalizeBudgetConfig(),
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

async function readHistoriesForBranch() {
    const keys = await pmIDBKeys();
    if (!Array.isArray(keys)) throw new Error('分支继承来源读取失败：无法枚举聊天记录');
    if (keys.includes('ST_SMS_DATA_V2')) {
        const value = await pmIDBGet('ST_SMS_DATA_V2');
        if (!value || typeof value !== 'object' || Array.isArray(value)) {
            throw new Error('分支继承来源读取失败：聊天记录主存储无效');
        }
        return value;
    }
    try {
        const raw = localStorage.getItem('ST_SMS_DATA_V2');
        if (!raw) return {};
        const value = JSON.parse(raw);
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('格式无效');
        return value;
    } catch (error) {
        throw new Error('分支继承来源读取失败：聊天记录后备存储无效');
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

async function commitBudgetScopeCoordinated(options) {
    const token = markDirectoryBranchScope('budget', options.targetId);
    try {
        return await enqueueDirectoryOperation('budget', () => commitBudgetScope(options));
    } finally {
        completeDirectoryBranchScope('budget', token);
    }
}

async function commitCalendarScope({ store, key, desired, expected, targetId, normalize, label }) {
    return enqueueDirectoryOperation(store, async () => {
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
    try {
        localStorage.setItem(key, JSON.stringify(normalize(merged)));
    } catch (error) {
        throw new Error(`分支继承保存失败：${label}不可用`);
    }
    return merged;
    });
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
        await saveBgLocal({ data: merged, coordinated: true });
        return merged;
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

export async function inheritPhoneDataOnBranch({ context, loadStores, saveStores, loadLineage, saveLineage, commitLineage, now = Date.now }) {
    const branch = resolveBranchInheritance(context);
    if (!branch) return { status: 'skipped', reason: 'not-branch' };
    if (pendingByTarget.has(branch.targetId)) return pendingByTarget.get(branch.targetId);
    const operation = (async () => {
        const lineage = await loadLineage();
        if (own(lineage, branch.targetId)) return { status: 'skipped', reason: 'already-cloned' };
        const stores = normalizeStores(await loadStores());
        if (hasTargetData(branch.targetId, stores)) return { status: 'skipped', reason: 'target-not-empty' };
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
            return { status: 'cloned', ...branch };
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
        budget: readBudgetForBranch(),
    });
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
            const phoneUiScopes = await commitLocalScopeCoordinated('phoneUi', {
                key: PHONE_UI_STORAGE_KEY, desired: desired.phoneUi.scopes, expected: expected.phoneUi.scopes, targetId,
                normalize: value => normalizePhoneUiState({ version: 1, scopes: value }, interactive), label: '手机页面状态',
            });
            globalThis.window.__pmPhoneUiState = normalizePhoneUiState({ version: 1, scopes: phoneUiScopes }, interactive);
            await commitCalendarScope({ store: 'calendar', key: CALENDAR_STORAGE_KEY,
                desired: desired.calendar, expected: expected.calendar, targetId,
                normalize: normalizeCalendarStore, label: '日历数据' });
            await commitCalendarScope({ store: 'occasions', key: CALENDAR_OCCASION_STORAGE_KEY,
                desired: desired.occasions, expected: expected.occasions, targetId,
                normalize: normalizeOccasionStore, label: '生日与纪念日数据' });
            await commitCalendarScope({ store: 'cycles', key: CALENDAR_CYCLE_STORAGE_KEY,
                desired: desired.cycles, expected: expected.cycles, targetId,
                normalize: normalizeCycleStore, label: '生理周期数据' });
            await commitCalendarScope({ store: 'recipes', key: CALENDAR_RECIPE_STORAGE_KEY,
                desired: desired.recipes, expected: expected.recipes, targetId,
                normalize: normalizeRecipeStore, label: '菜谱数据' });
        } else {
            globalThis.window.__pmBgLocal = desired.backgrounds;
            await saveBgLocal();
            await saveInteractiveScenes(desired.interactive);
            if (!savePhoneUiState(desired.phoneUi, desired.interactive)) throw new Error('分支继承保存失败：手机页面状态不可用');
            if (!saveCalendar(desired.calendar) || !saveCalendarOccasions(desired.occasions)
                || !saveCalendarCycles(desired.cycles) || !saveCalendarRecipes(desired.recipes)) {
                throw new Error('分支继承保存失败：日历 scope 不可用');
            }
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

export function beginBranchInheritance(context, { getStorageId, invalidateInteractiveStore, reloadCalendarStore } = {}) {
    const branch = resolveBranchInheritance(context);
    const branchScopeTokens = branch
        ? ['pokeConfig', 'characterBehavior', 'bidirectional', 'budget'].map(store => [store, markDirectoryBranchScope(store, branch.targetId)])
        : [];
    const operation = inheritPhoneDataOnBranch({
        context,
        loadStores: loadProductionStores,
        saveStores: persistProductionStores,
        loadLineage: loadBranchLineage,
        commitLineage: commitBranchLineage,
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
        }
        return result;
    });
}
