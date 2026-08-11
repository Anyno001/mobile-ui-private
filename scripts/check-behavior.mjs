import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
    CALENDAR_CYCLE_STORAGE_KEY, CALENDAR_HOLIDAY_STORAGE_KEY, CALENDAR_OCCASION_STORAGE_KEY,
    CALENDAR_OUTFIT_STORAGE_KEY, CALENDAR_STORAGE_KEY, CALENDAR_WEATHER_STORAGE_KEY, EXTENSION_PROMPT_POSITIONS, MAX_INJECTION_DEPTH,
} from '../src/constants.js';
import {
    getGalBubbleAssistantText, getGalBubblePrompt, getGalBubbleScriptDefinition,
    installGalBubble, parseGalBubbleMessages, reconcileGalBubble, uninstallGalBubble,
} from '../src/gal-bubble.js';
import { createEmptyTodayTrendStore } from '../src/today-trend-model.js';
import { normalizeThemePreset, THEME_PRESETS } from '../src/config.js';
import { createWorldBookEntryKey, getCurrentChatWorldBooks, getEnabledWorldBookNames, getReadableWorldBookNames, getTavernDbColumn, isMemberPrivateWorldBookEntryAllowed, isWorldBookEntryAllowed, normalizeWorldBookConfig } from '../src/worldbook-config.js';
import { buildWorldBookContext } from '../src/worldbook-context.js';
import {
    buildCharacterBehaviorPrompt, buildChatPreferencePrompt,
    DEFAULT_CHARACTER_BEHAVIOR, getCharacterBehavior,
    normalizeCharacterBehavior, normalizeCharacterBehaviorStore,
    normalizeGroupInjection, normalizeGroupMeta, normalizeGroupMetaStore, normalizeInjectionConfig,
} from '../src/behavior-config.js';
import { createGalBubbleController } from '../src/settings-gal-bubble-controller.js';
import {
    createMessageEntry, createQuoteSnapshot, describeMessageEntry, formatQuoteContext, normalizeMessageHistory,
} from '../src/chat-message-model.js';
import {
    loadBgSettings, loadLocalBackground, materializeLocalBackgrounds, saveBgGlobal, saveBgLocal, saveDesktopBg,
} from '../src/storage-background.js';
import {
    addOrUpdateProfile, clearPluginData, loadCharacterBehavior, loadGroupMeta, loadInjectionConfig, pmIDBDel, pmIDBGet, pmIDBSet,
    BRANCH_LINEAGE_STORE_KEY, PLUGIN_IDB_DYNAMIC_PREFIXES, PLUGIN_IDB_STATIC_KEYS, PLUGIN_LOCAL_STORAGE_KEYS,
    commitBranchLineage, completeBranchLineageBackup, loadBranchLineage, loadHistoriesFromIDB, saveCharacterBehavior, saveGroupMeta,
    saveHistoriesStrict, saveInjectionConfig, rollbackBranchLineageBackup, saveBidirectional, saveBranchLineage, saveBranchLineageForBackup, saveBudgetConfig, savePokeConfig,
    loadWorldBookConfig, saveWorldBookConfig,
} from '../src/storage.js';
import { installConversation } from '../src/conversation.js';
import {
    replaceConversationHistory, restoreConversationHistory,
} from '../src/conversation-persistence.js';
import {
    applyConversationTarget, resolveConversationTarget, snapshotConversationContext,
} from '../src/conversation-state.js';
import { installDiagnosticApi } from '../src/diagnostic.js';
import { gatherContext, getStorageIdFor, getUserPersona, resolveOutfitTarget } from '../src/host-context.js';
import { awaitPendingBranchInheritance, beginBranchInheritance, inheritPhoneDataOnBranch, mergeBranchScope, mergePhoneUiBranchScope, resolveBranchInheritance } from '../src/branch-scope-inheritance.js';
import {
    completeDirectoryBranchScope, enqueueDirectoryOperation, getActiveDirectoryBranchScopes, markDirectoryBranchScope,
} from '../src/directory-save-coordinator.js';
import {
    commitAutoPokeConfig, getAutoPokeConfig, normalizeAutoPoke, resetAutoPokeCounter,
} from '../src/auto-poke-config.js';
import { applyContextInjections } from '../src/phone-injection.js';
import { normalizeCalendarStore } from '../src/calendar-model.js';
import { normalizeOutfitStore } from '../src/calendar-outfit-model.js';
import { normalizeRecipeStore } from '../src/calendar-recipe-model.js';
import { createCommunityTemplate, deleteSceneDanmaku, deriveInteractiveActorId, normalizeInteractiveStore, updateSceneDanmaku } from '../src/interactive-scene-model.js';
import { pmIDBKeys } from '../src/pm-idb.js';
import { renderPhoneDesktop, runDesktopPageTransition } from '../src/interactive-scenes.js';
import { getCommunityInjectionState, runCommunityInjectionAction } from '../src/interactive-scene-phone.js';
import { formatCommunityPostTime, getDanmakuMotion, getDanmakuTone, renderCommunityLauncher, renderCommunityWorkspace } from '../src/interactive-scene-views.js';
import { installPhoneControlCenter, runControlMenuAction } from '../src/phone-control-center.js';
import { installPhoneChatPoke } from '../src/phone-chat-poke.js';
import {
    clearPhoneQuickReply, ensureInitialPhoneQuickReply, ensureInitialPhoneQuickReplyWithRetry,
    ensurePhoneQuickReply, getConfiguredPhoneQuickReplyLabel, getPhoneQuickReplyStatus,
    normalizePhoneQuickReplyLabel,
    PHONE_QR_AUTOMATION_ID, PHONE_QR_AUTO_INIT_KEY, PHONE_QR_LABEL, PHONE_QR_MESSAGE, PHONE_QR_SET_NAME,
} from '../src/quick-reply.js';
import { createBudgetController } from '../src/settings-budget-controller.js';
import { createInjectionResultGuard } from '../src/settings-injection-guard.js';
import {
    createBackupStateHandlers, installSettingsUi, parseBackupData, runBackgroundTransaction, runBackupTransaction,
} from '../src/settings-ui.js';
import { createBackupController } from '../src/settings-backup-controller.js';
import { renderApiSettings } from '../src/settings-templates.js';
import { loadWorldBookDetails, loadWorldBookDirectory, loadWorldBookSettingsDirectory } from '../src/settings-worldbook.js';
import {
    buildChatRequest, buildGroupAdditionalContext, buildGroupInjectedInstruction, buildGroupSystemPrompt, buildHistoryText,
    buildIndependentGroupUserPrompt, buildIndependentSingleUserPrompt,
    buildPokeGroupActivePrompt, buildPokeGroupPrompt, buildPokeRequest, buildPokeSinglePrompt,
    buildPokeSystemPrompt, buildSingleInjectedInstruction, buildSingleSystemPrompt,
} from '../src/chat-prompts.js';
import { parseGroupResponse } from '../src/messaging-group-parser.js';
import {
    advanceAutoPokeCounters, commitAutomaticResult,
    createAutomaticTaskController, createRuntimeState, runAutoPokeCounterCycle,
} from '../src/runtime.js';
import {
    createPhonePageController, handleMessageSelectionKey, installPhoneCommandShortcutListeners,
    installPhoneLifecycle, resetPhoneScaleForMinimize, toggleMessageSelection,
} from '../src/phone-lifecycle.js';
import { commitConversationInjectionUpdate, installPhoneContextInjection } from '../src/phone-context-injection.js';
import {
    commitEditedGroupUpdate, installPhoneDirectory, refreshEditedGroupRuntime,
} from '../src/phone-directory.js';
import { createPhoneQuoteController } from '../src/phone-quote.js';
function createQuickReplyApiFixture({ set = null, active = false, fail = {}, beforeMutation = null } = {}) {
    const sets = new Map();
    if (set) sets.set(set.name, set);
    const globals = new Set(active && set ? [set.name] : []);
    const calls = [];
    const findQr = (setName, identifier) => sets.get(setName)?.qrList.find(qr =>
        Number.isInteger(identifier) ? qr.id === identifier : qr.label === identifier);
    const api = {
        calls,
        getSetByName(name) { return sets.get(name); },
        async createSet(name, props) {
            calls.push(['createSet', name, props]);
            if (fail.createSet) throw new Error(fail.createSet);
            const created = { name, qrList: [], ...props };
            sets.set(name, created);
            return created;
        },
        async deleteSet(name) {
            calls.push(['deleteSet', name]);
            if (fail.deleteSet) throw new Error(fail.deleteSet);
            sets.delete(name);
            globals.delete(name);
        },
        async createQuickReply(setName, label, props) {
            calls.push(['createQuickReply', setName, label, props]);
            await beforeMutation?.('createQuickReply');
            if (fail.createQuickReply) throw new Error(fail.createQuickReply);
            const target = sets.get(setName);
            const qr = { id: Math.max(0, ...target.qrList.map(item => item.id || 0)) + 1, label, ...props };
            target.qrList.push(qr);
            return qr;
        },
        async updateQuickReply(setName, identifier, props) {
            calls.push(['updateQuickReply', setName, identifier, props]);
            await beforeMutation?.('updateQuickReply');
            if (fail.updateQuickReply) throw new Error(fail.updateQuickReply);
            const qr = findQr(setName, identifier);
            if (!qr) throw new Error('missing qr');
            Object.assign(qr, props);
            if (props.newLabel !== undefined) qr.label = props.newLabel;
            return qr;
        },
        async deleteQuickReply(setName, identifier) {
            calls.push(['deleteQuickReply', setName, identifier]);
            await beforeMutation?.('deleteQuickReply');
            if (fail.deleteQuickReply) throw new Error(fail.deleteQuickReply);
            const target = sets.get(setName);
            const index = target.qrList.findIndex(qr => qr.id === identifier);
            if (index < 0) throw new Error('missing qr');
            target.qrList.splice(index, 1);
        },
        addGlobalSet(name, visible) {
            calls.push(['addGlobalSet', name, visible]);
            if (fail.addGlobalSet) throw new Error(fail.addGlobalSet);
            globals.add(name);
        },
        removeGlobalSet(name) {
            calls.push(['removeGlobalSet', name]);
            if (fail.removeGlobalSet) throw new Error(fail.removeGlobalSet);
            globals.delete(name);
        },
        listGlobalSets() { return [...globals]; },
    };
    return api;
}

function createStorageFixture(initial = {}) {
    const values = new Map(Object.entries(initial));
    return {
        getItem(key) { return values.has(key) ? values.get(key) : null; },
        setItem(key, value) { values.set(key, String(value)); },
        removeItem(key) { values.delete(key); },
    };
}

assert.equal(normalizePhoneQuickReplyLabel(' 1234567 '), '123456');
assert.equal(normalizePhoneQuickReplyLabel('😀😁😂😃😄😅😆'), '😀😁😂😃😄😅', '入口名称必须按 Unicode code point 截断');
assert.equal(normalizePhoneQuickReplyLabel('   '), PHONE_QR_LABEL);
assert.equal(normalizePhoneQuickReplyLabel(null), PHONE_QR_LABEL);
assert.equal(getConfiguredPhoneQuickReplyLabel({ qrLabel: '  快捷入口  ' }), '快捷入口');
assert.equal(getConfiguredPhoneQuickReplyLabel({ qrLabel: '🎵天音入口测试' }), '🎵天音入口测');

assert.equal(getPhoneQuickReplyStatus(null).state, 'unavailable');
await assert.rejects(() => ensurePhoneQuickReply(null), /未提供 Quick Reply API/);
const createdQrApi = createQuickReplyApiFixture();
assert.equal((await ensurePhoneQuickReply(createdQrApi)).state, 'ready');
const createdQrSet = createdQrApi.getSetByName(PHONE_QR_SET_NAME);
assert.equal(createdQrSet.qrList.length, 1);
assert.equal(createdQrSet.qrList[0].label, PHONE_QR_LABEL);
assert.equal(createdQrSet.qrList[0].message, PHONE_QR_MESSAGE);
assert.equal(createdQrSet.qrList[0].automationId, PHONE_QR_AUTOMATION_ID);
await ensurePhoneQuickReply(createdQrApi);
assert.equal(createdQrSet.qrList.length, 1, '重复创建不得产生重复 Quick Reply');
assert.equal(createdQrApi.calls.filter(call => call[0] === 'createQuickReply').length, 1);
createdQrSet.qrList[0].message = '/broken';
assert.equal(getPhoneQuickReplyStatus(createdQrApi).state, 'repairable');
await ensurePhoneQuickReply(createdQrApi);
assert.equal(createdQrSet.qrList[0].message, PHONE_QR_MESSAGE);
await ensurePhoneQuickReply(createdQrApi, '小助手');
assert.equal(createdQrSet.qrList[0].label, '小助手');
assert.equal(getPhoneQuickReplyStatus(createdQrApi, '小助手').state, 'ready');
assert.equal(getPhoneQuickReplyStatus(createdQrApi, PHONE_QR_LABEL).state, 'repairable');

let releaseCreateMutation;
const delayedCreate = new Promise(resolve => { releaseCreateMutation = resolve; });
const delayedCreateApi = createQuickReplyApiFixture({
    beforeMutation: operation => operation === 'createQuickReply' ? delayedCreate : undefined,
});
let delayedCreateSettled = false;
const delayedCreateResult = ensurePhoneQuickReply(delayedCreateApi, '异步入口')
    .finally(() => { delayedCreateSettled = true; });
await Promise.resolve();
assert.equal(delayedCreateSettled, false, '创建流程必须等待宿主异步 createQuickReply');
assert.equal(delayedCreateApi.listGlobalSets().includes(PHONE_QR_SET_NAME), false, '条目创建完成前不得提前启用集合');
releaseCreateMutation();
assert.equal((await delayedCreateResult).state, 'ready');

let activeDeletes = 0;
let maxActiveDeletes = 0;
const duplicateSet = {
    name: PHONE_QR_SET_NAME,
    qrList: [
        { id: 1, label: '旧入口', message: PHONE_QR_MESSAGE, automationId: PHONE_QR_AUTOMATION_ID },
        { id: 2, label: '重复一', message: PHONE_QR_MESSAGE, automationId: PHONE_QR_AUTOMATION_ID },
        { id: 3, label: '重复二', message: PHONE_QR_MESSAGE, automationId: PHONE_QR_AUTOMATION_ID },
    ],
};
const sequentialDeleteApi = createQuickReplyApiFixture({
    set: duplicateSet,
    active: true,
    beforeMutation: async operation => {
        if (operation !== 'deleteQuickReply') return;
        activeDeletes += 1;
        maxActiveDeletes = Math.max(maxActiveDeletes, activeDeletes);
        await Promise.resolve();
        activeDeletes -= 1;
    },
});
await ensurePhoneQuickReply(sequentialDeleteApi, '去重入口');
assert.equal(maxActiveDeletes, 1, '重复 owned Quick Reply 必须顺序删除，避免宿主 mutation 竞态');
assert.deepEqual(duplicateSet.qrList.map(item => item.id), [1]);
assert.equal(duplicateSet.qrList[0].label, '去重入口');

const userConflictApi = createQuickReplyApiFixture({ set: {
    name: PHONE_QR_SET_NAME,
    qrList: [{ id: 9, label: PHONE_QR_LABEL, message: PHONE_QR_MESSAGE, automationId: 'user-owned' }],
} });
assert.equal(getPhoneQuickReplyStatus(userConflictApi).state, 'conflict');
await assert.rejects(() => ensurePhoneQuickReply(userConflictApi), /无法证明属于天音小笺/);
assert.equal(userConflictApi.getSetByName(PHONE_QR_SET_NAME).qrList[0].automationId, 'user-owned');

const createFailureApi = createQuickReplyApiFixture({ fail: { createQuickReply: 'create-failed' } });
await assert.rejects(() => ensurePhoneQuickReply(createFailureApi), /create-failed/);
assert.equal(createFailureApi.getSetByName(PHONE_QR_SET_NAME), undefined, '创建条目失败必须回滚新集合');
const missingIdApi = createQuickReplyApiFixture({ set: {
    name: PHONE_QR_SET_NAME,
    qrList: [{ label: PHONE_QR_LABEL, message: PHONE_QR_MESSAGE, automationId: PHONE_QR_AUTOMATION_ID }],
} });
await assert.rejects(() => ensurePhoneQuickReply(missingIdApi), /缺少稳定数字 ID/);

const initialQrStorage = createStorageFixture();
const initialQrApi = createQuickReplyApiFixture();
assert.equal((await ensureInitialPhoneQuickReply({ api: initialQrApi, storage: initialQrStorage })).state, 'ready');
assert.equal(initialQrStorage.getItem(PHONE_QR_AUTO_INIT_KEY), '1', '首次创建成功后必须写入初始化标记');
assert.equal(initialQrApi.getSetByName(PHONE_QR_SET_NAME).qrList[0].label, '天音');
await ensureInitialPhoneQuickReply({ api: initialQrApi, storage: initialQrStorage });
assert.equal(initialQrApi.calls.filter(call => call[0] === 'createQuickReply').length, 1, '已有初始化标记时不得重复创建入口');
await clearPhoneQuickReply(initialQrApi);
assert.equal(initialQrStorage.getItem(PHONE_QR_AUTO_INIT_KEY), '1', '用户清除入口后必须保留初始化标记');
assert.equal((await ensureInitialPhoneQuickReply({ api: initialQrApi, storage: initialQrStorage })).state, 'absent');
assert.equal(initialQrApi.calls.filter(call => call[0] === 'createQuickReply').length, 1, '用户清除后再次初始化不得自动复活入口');

const skippedQrStorage = createStorageFixture({ [PHONE_QR_AUTO_INIT_KEY]: '1' });
const skippedQrApi = createQuickReplyApiFixture();
assert.equal((await ensureInitialPhoneQuickReply({ api: skippedQrApi, storage: skippedQrStorage })).state, 'absent');
assert.equal(skippedQrApi.calls.length, 0, '已有初始化标记时只能读取状态，不得修改 Quick Reply');

const failedInitialQrStorage = createStorageFixture();
const failedInitialQrApi = createQuickReplyApiFixture({ fail: { createQuickReply: 'initial-create-failed' } });
await assert.rejects(
    () => ensureInitialPhoneQuickReply({ api: failedInitialQrApi, storage: failedInitialQrStorage }),
    /initial-create-failed/,
);
assert.equal(failedInitialQrStorage.getItem(PHONE_QR_AUTO_INIT_KEY), null, 'Quick Reply 创建失败时不得写入初始化标记');
const failedMarkerQrApi = createQuickReplyApiFixture();
const failedMarkerStorage = {
    getItem: () => null,
    setItem() { throw new Error('marker-write-failed'); },
};
await assert.rejects(
    () => ensureInitialPhoneQuickReply({ api: failedMarkerQrApi, storage: failedMarkerStorage }),
    /marker-write-failed/,
);
assert.equal(failedMarkerQrApi.getSetByName(PHONE_QR_SET_NAME).qrList.length, 1, '标记写入失败不得伪装成入口创建失败或回滚已创建入口');
await assert.rejects(
    () => ensureInitialPhoneQuickReply({ api: createQuickReplyApiFixture(), storage: null }),
    /浏览器存储不可用/,
);

const retryStorage = createStorageFixture();
const retryApi = createQuickReplyApiFixture();
let retryApiReads = 0;
const retryDelays = [];
const retryStatus = await ensureInitialPhoneQuickReplyWithRetry({
    getApi: () => (++retryApiReads < 3 ? null : retryApi),
    storage: retryStorage,
    label: '重试入口',
    attempts: 4,
    delay: 25,
    setTimeoutImpl: (resolve, delay) => { retryDelays.push(delay); resolve(); },
});
assert.equal(retryStatus.state, 'ready');
assert.equal(retryApiReads, 3);
assert.deepEqual(retryDelays, [25, 25]);
assert.equal(retryApi.getSetByName(PHONE_QR_SET_NAME).qrList[0].label, '重试入口');
assert.equal(retryStorage.getItem(PHONE_QR_AUTO_INIT_KEY), '1');

let exhaustedReads = 0;
await assert.rejects(
    () => ensureInitialPhoneQuickReplyWithRetry({
        getApi: () => { exhaustedReads += 1; return null; },
        storage: createStorageFixture(),
        attempts: 3,
        setTimeoutImpl: resolve => resolve(),
    }),
    /未提供 Quick Reply API/,
);
assert.equal(exhaustedReads, 3, '重试次数必须受 attempts 限制');

let nonRetryReads = 0;
await assert.rejects(
    () => ensureInitialPhoneQuickReplyWithRetry({
        getApi: () => { nonRetryReads += 1; return createQuickReplyApiFixture({ fail: { createQuickReply: 'mutation-failed' } }); },
        storage: createStorageFixture(),
        attempts: 4,
        setTimeoutImpl: resolve => resolve(),
    }),
    /mutation-failed/,
);
assert.equal(nonRetryReads, 1, '宿主 mutation 失败不得被误判为 API 延迟注入');

const mixedSet = {
    name: PHONE_QR_SET_NAME,
    qrList: [
        { id: 1, label: PHONE_QR_LABEL, message: PHONE_QR_MESSAGE, automationId: PHONE_QR_AUTOMATION_ID },
        { id: 2, label: '用户按钮', message: '/help', automationId: 'user-owned' },
    ],
};
const mixedClearApi = createQuickReplyApiFixture({ set: mixedSet, active: true });
await clearPhoneQuickReply(mixedClearApi);
assert.equal(mixedClearApi.getSetByName(PHONE_QR_SET_NAME), mixedSet);
assert.deepEqual(mixedSet.qrList.map(qr => qr.id), [2], '清除不得误删用户 Quick Reply');
assert.ok(mixedClearApi.listGlobalSets().includes(PHONE_QR_SET_NAME), '保留用户条目时必须恢复集合启用状态');
const fullClearApi = createQuickReplyApiFixture({ set: {
    name: PHONE_QR_SET_NAME,
    qrList: [{ id: 1, label: PHONE_QR_LABEL, message: PHONE_QR_MESSAGE, automationId: PHONE_QR_AUTOMATION_ID }],
}, active: true });
await clearPhoneQuickReply(fullClearApi);
assert.equal(fullClearApi.getSetByName(PHONE_QR_SET_NAME), undefined);
const failedClearApi = createQuickReplyApiFixture({ set: structuredClone(mixedSet), active: true, fail: { deleteQuickReply: 'delete-failed' } });
failedClearApi.getSetByName(PHONE_QR_SET_NAME).qrList.unshift({ id: 3, label: PHONE_QR_LABEL, message: PHONE_QR_MESSAGE, automationId: PHONE_QR_AUTOMATION_ID });
await assert.rejects(() => clearPhoneQuickReply(failedClearApi), /delete-failed/);
assert.ok(failedClearApi.listGlobalSets().includes(PHONE_QR_SET_NAME), '清除失败必须恢复原全局启用状态');

import {
    applyPhoneScale, handleHostChatChanged, handlePhonePageSuspension,
    installPhoneFoundation, installPhonePageSuspensionListeners, normalizePhoneScale, phoneSizeForScale,
    phoneSizeForViewport, updatePhonePageSuspensionHandler,
} from '../src/phone-foundation.js';
import { bindPhonePageActions, finalizeDeletedScene, runDeleteSceneAction, toggleDanmakuActions, toggleScenePostActions, toggleSceneReplyComposer } from '../src/interactive-scene-phone.js';


assert.equal(normalizePhoneScale(1, 1200, 1000), 1);
assert.equal(normalizePhoneScale(2, 1200, 1000), 1.5);
assert.equal(normalizePhoneScale(0.2, 1200, 1000), 0.6);
const heightLimitedScale = normalizePhoneScale(1, 320, 600);
assert.equal(heightLimitedScale, 0.892, '基础比例只应由 320px 横向预算钳制');
const heightLimitedSize = phoneSizeForViewport(1, 320, 600);
assert.deepEqual(heightLimitedSize, { scale: 0.892, width: 294, height: 492 },
    '矮视口必须保持横向预算宽度并单独收缩高度');
const widthLimitedScale = normalizePhoneScale(1, 320, 900);
assert.equal(widthLimitedScale, 0.892, '320×900 视口必须由宽度预算精确钳制');
const widthLimitedSize = phoneSizeForViewport(1, 320, 900);
assert.deepEqual(widthLimitedSize, { scale: 0.892, width: 294, height: 517 },
    '高视口必须保留由宽度限制后的自然高度');
const extremeCompactScale = normalizePhoneScale(1, 150, 260);
assert.equal(extremeCompactScale, 0.418, '极窄视口必须允许比例低于全局最小值以避免横向溢出');
const constrainedMaximum = normalizePhoneScale(1.5, 320, 600);
assert.equal(constrainedMaximum, heightLimitedScale, '受限视口的最大比例只由横向预算压低');
const keyboardClosedSize = phoneSizeForViewport(1, 390, 844);
const keyboardOpenSize = phoneSizeForViewport(1, 390, 400);
assert.equal(keyboardOpenSize.width, keyboardClosedSize.width, '软键盘打开不得缩窄手机窗口');
assert.ok(keyboardOpenSize.height < keyboardClosedSize.height, '软键盘打开必须只压缩手机窗口高度');
assert.deepEqual(phoneSizeForViewport(1, 390, 0), { scale: 1, width: 330, height: 0 },
    '零高度 VisualViewport 不得保留会越出屏幕的手机高度');
const constrainedKeyboardSize = phoneSizeForViewport(1, 390, 60);
assert.equal(constrainedKeyboardSize.height, 49,
    '极矮软键盘视口必须按可用高度压缩手机，不能保留会越出屏幕的最小高度');
assert.deepEqual(phoneSizeForViewport(1, 0, 400), { scale: 0, width: 0, height: 0 },
    '零宽度视口不得生成横向溢出的手机壳');
assert.deepEqual(phoneSizeForViewport(1, Number.NaN, Number.NaN), { scale: 1, width: 330, height: 580 },
    '非有限视口尺寸必须回退到稳定默认值，不能写入 NaNpx');
assert.deepEqual(phoneSizeForViewport(1.5, 1920, 1200), { scale: 1.5, width: 495, height: 870 },
    '高桌面视口必须保留既有最大比例和自然高度');
assert.deepEqual(phoneSizeForViewport(1, 390, 844), keyboardClosedSize, '软键盘收起后必须恢复原高度和宽度');
assert.deepEqual(phoneSizeForScale(1), { width: 330, height: 580 });
assert.deepEqual(phoneSizeForScale(0.6), { width: 198, height: 348 });
const phoneStyleValues = new Map();
const phoneScaleResult = applyPhoneScale({ style: { setProperty: (name, value) => phoneStyleValues.set(name, value) } }, 1.2);
assert.deepEqual(phoneScaleResult, { scale: 1.2, width: 396, height: 696 });
assert.equal(phoneStyleValues.get('--pm-phone-width'), '396px');
assert.equal(phoneStyleValues.get('--pm-phone-height'), '696px');

for (const previousScale of [0.6, 1, 1.5]) {
    const theme = { phoneScale: previousScale };
    const applied = [];
    const notices = [];
    assert.equal(resetPhoneScaleForMinimize({
        theme,
        phoneWindow: { id: 'phone' },
        applyScale: (element, scale) => applied.push([element.id, scale]),
        persistTheme: () => true,
        notify: message => notices.push(message),
    }), true);
    assert.equal(theme.phoneScale, 1, '点击收缩成功后必须持久化默认比例意图');
    assert.deepEqual(applied, [['phone', 1]], '点击收缩必须立即应用 330×580 基准比例');
    assert.deepEqual(notices, []);
}

const failedScaleTheme = { phoneScale: 1.35 };
const failedScaleApplications = [];
const failedScaleNotices = [];
assert.equal(resetPhoneScaleForMinimize({
    theme: failedScaleTheme,
    phoneWindow: { id: 'phone' },
    applyScale: (element, scale) => failedScaleApplications.push([element.id, scale]),
    persistTheme: () => false,
    notify: message => failedScaleNotices.push(message),
}), false);
assert.equal(failedScaleTheme.phoneScale, 1.35, '保存失败必须恢复原 phoneScale');
assert.deepEqual(failedScaleApplications, [['phone', 1], ['phone', 1.35]], '保存失败必须恢复原视觉比例');
assert.deepEqual(failedScaleNotices, ['手机尺寸保存失败：浏览器存储不可用。']);

const thrownScaleTheme = { phoneScale: 0.75 };
const thrownScaleApplications = [];
const thrownScaleNotices = [];
assert.equal(resetPhoneScaleForMinimize({
    theme: thrownScaleTheme,
    phoneWindow: { id: 'phone' },
    applyScale: (element, scale) => thrownScaleApplications.push([element.id, scale]),
    persistTheme: () => { throw new Error('injected persistence failure'); },
    notify: message => thrownScaleNotices.push(message),
}), false);
assert.equal(thrownScaleTheme.phoneScale, 0.75, '持久化依赖抛错时也必须恢复原 phoneScale');
assert.deepEqual(thrownScaleApplications, [['phone', 1], ['phone', 0.75]],
    '持久化依赖抛错时也必须恢复原视觉比例');
assert.equal(thrownScaleNotices.length, 1);

const createSelectionCheckbox = (checked = '0') => {
    const attributes = new Map([['aria-checked', checked === '1' ? 'true' : 'false']]);
    return {
        dataset: { checked },
        clickCalls: 0,
        setAttribute(name, value) { attributes.set(name, String(value)); },
        getAttribute(name) { return attributes.get(name) ?? null; },
        click() { this.clickCalls += 1; },
    };
};
const selectionPeerA = createSelectionCheckbox();
const selectionPeerB = createSelectionCheckbox();
const selectionWrap = { dataset: { historyIndex: '7' } };
const selectionList = {
    querySelectorAll(selector) {
        assert.equal(selector, '.pm-select-wrap[data-history-index="7"] .pm-message-select-check');
        return [selectionPeerA, selectionPeerB];
    },
};
assert.equal(toggleMessageSelection({ checkbox: selectionPeerA, wrap: selectionWrap, list: selectionList }), '1');
for (const peer of [selectionPeerA, selectionPeerB]) {
    assert.equal(peer.dataset.checked, '1', '同 historyIndex 的消息选择状态必须同步');
    assert.equal(peer.getAttribute('aria-checked'), 'true', '同 historyIndex 的 aria-checked 必须同步');
}
assert.equal(toggleMessageSelection({ checkbox: selectionPeerB, wrap: selectionWrap, list: selectionList }), '0');
assert.ok([selectionPeerA, selectionPeerB].every(peer => peer.dataset.checked === '0'));

const isolatedSelection = createSelectionCheckbox();
assert.equal(toggleMessageSelection({
    checkbox: isolatedSelection,
    wrap: { dataset: {} },
    list: { querySelectorAll() { throw new Error('孤立选择控件不得查询 peer'); } },
}), '1');
assert.equal(isolatedSelection.getAttribute('aria-checked'), 'true');

for (const key of [' ', 'Enter']) {
    const checkbox = createSelectionCheckbox();
    let prevented = false;
    assert.equal(handleMessageSelectionKey({ key, preventDefault() { prevented = true; } }, checkbox), true);
    assert.equal(prevented, true, `${JSON.stringify(key)} 必须阻止默认行为`);
    assert.equal(checkbox.clickCalls, 1, `${JSON.stringify(key)} 必须触发一次 checkbox click`);
}
const ignoredSelectionKey = createSelectionCheckbox();
assert.equal(handleMessageSelectionKey({ key: 'Escape', preventDefault() { throw new Error('Escape 不得阻止默认行为'); } }, ignoredSelectionKey), false);
assert.equal(ignoredSelectionKey.clickCalls, 0);

const suspensionCalls = [];
handlePhonePageSuspension({
    cancelCommunityGeneration: reason => suspensionCalls.push(['community', reason]),
    cancelCalendarTasks: reason => suspensionCalls.push(['calendar', reason]),
    cancelTodayTrendInitialization: reason => suspensionCalls.push(['today-trend-initialization', reason]),
    cancelTodayTrendRuleRegeneration: reason => suspensionCalls.push(['today-trend-rule', reason]),
    cancelTodayTrendGeneration: (reason, reset) => suspensionCalls.push(['today-trend', reason, reset]),
}, 'beforeunload', {
    save: () => suspensionCalls.push(['save', 'beforeunload']),
    disarm: reason => suspensionCalls.push(['disarm', reason]),
});
assert.deepEqual(suspensionCalls, [
    ['save', 'beforeunload'],
    ['community', 'beforeunload'],
    ['calendar', 'beforeunload'],
    ['today-trend-initialization', 'beforeunload'],
    ['today-trend-rule', 'beforeunload'],
    ['today-trend', 'beforeunload', true],
    ['disarm', 'beforeunload'],
]);

const hostChangeCalls = [];
const hostChangeRuntime = { lastChatLength: 99 };
assert.equal(handleHostChatChanged({
    state: { phoneActive: true },
    runtime: hostChangeRuntime,
    chatLength: 4,
    cancelCommunityGeneration: reason => hostChangeCalls.push(['community', reason]),
    cancelCalendarTasks: reason => hostChangeCalls.push(['calendar', reason]),
    cancelTodayTrendInitialization: reason => hostChangeCalls.push(['today-trend-initialization', reason]),
    cancelTodayTrendRuleRegeneration: reason => hostChangeCalls.push(['today-trend-rule', reason]),
    cancelTodayTrendGeneration: (reason, reset) => hostChangeCalls.push(['today-trend', reason, reset]),
    disarmAutoPoke: reason => hostChangeCalls.push(['disarm', reason]),
    endPhone: force => hostChangeCalls.push(['end', force]),
    invalidateGeneration: () => hostChangeCalls.push(['invalidate']),
}), 'closed');
assert.equal(hostChangeRuntime.lastChatLength, 4);
assert.deepEqual(hostChangeCalls, [
    ['community', 'host-chat-changed'],
    ['calendar', 'host-chat-changed'],
    ['today-trend-initialization', 'host-chat-changed'],
    ['today-trend-rule', 'host-chat-changed'],
    ['today-trend', 'host-chat-changed', true],
    ['disarm', 'host-chat-changed'],
    ['end', true],
], 'CHAT_CHANGED 必须强制关闭活动手机，且不得走普通关闭保存旧会话');

hostChangeCalls.length = 0;
assert.equal(handleHostChatChanged({
    state: { phoneActive: false },
    runtime: hostChangeRuntime,
    chatLength: -1,
    cancelCommunityGeneration: reason => hostChangeCalls.push(['community', reason]),
    cancelCalendarTasks: reason => hostChangeCalls.push(['calendar', reason]),
    cancelTodayTrendInitialization: reason => hostChangeCalls.push(['today-trend-initialization', reason]),
    cancelTodayTrendRuleRegeneration: reason => hostChangeCalls.push(['today-trend-rule', reason]),
    cancelTodayTrendGeneration: (reason, reset) => hostChangeCalls.push(['today-trend', reason, reset]),
    disarmAutoPoke: reason => hostChangeCalls.push(['disarm', reason]),
    endPhone: force => hostChangeCalls.push(['end', force]),
    invalidateGeneration: () => hostChangeCalls.push(['invalidate']),
}), 'invalidated');
assert.equal(hostChangeRuntime.lastChatLength, 0, '非法宿主聊天长度必须归一为 0');
assert.deepEqual(hostChangeCalls, [
    ['community', 'host-chat-changed'], ['calendar', 'host-chat-changed'],
    ['today-trend-initialization', 'host-chat-changed'], ['today-trend-rule', 'host-chat-changed'], ['today-trend', 'host-chat-changed', true],
    ['disarm', 'host-chat-changed'], ['invalidate'],
]);

const pageWindowListeners = new Map();
const pageDocumentListeners = new Map();
const pageWindow = {
    addEventListener(type, listener) {
        assert.equal(pageWindowListeners.has(type), false, `${type} 监听器只能注册一次`);
        pageWindowListeners.set(type, listener);
    },
};
const pageDocument = {
    visibilityState: 'visible',
    addEventListener(type, listener) {
        assert.equal(pageDocumentListeners.has(type), false, `${type} 监听器只能注册一次`);
        pageDocumentListeners.set(type, listener);
    },
};
assert.equal(installPhonePageSuspensionListeners(pageWindow, pageDocument), true);
assert.equal(installPhonePageSuspensionListeners(pageWindow, pageDocument), false);
const pageHandlerCalls = [];
updatePhonePageSuspensionHandler(pageWindow, {
    cancelCommunityGeneration: reason => pageHandlerCalls.push(['old-community', reason]),
    cancelCalendarTasks: reason => pageHandlerCalls.push(['old-calendar', reason]),
}, reason => pageHandlerCalls.push(['old-disarm', reason]),
() => pageHandlerCalls.push(['old-save']));
updatePhonePageSuspensionHandler(pageWindow, {
    cancelCommunityGeneration: reason => pageHandlerCalls.push(['current-community', reason]),
    cancelCalendarTasks: reason => pageHandlerCalls.push(['current-calendar', reason]),
}, reason => pageHandlerCalls.push(['current-disarm', reason]),
() => pageHandlerCalls.push(['current-save']));
pageWindowListeners.get('beforeunload')();
pageDocument.visibilityState = 'hidden';
pageDocumentListeners.get('visibilitychange')();
assert.deepEqual(pageHandlerCalls, [
    ['current-save'], ['current-community', 'beforeunload'], ['current-calendar', 'beforeunload'], ['current-disarm', 'beforeunload'],
    ['current-save'], ['current-community', 'document-hidden'], ['current-calendar', 'document-hidden'], ['current-disarm', 'document-hidden'],
]);
assert.equal(pageWindowListeners.size, 1);
assert.equal(pageDocumentListeners.size, 1);

const commandShortcutListeners = new Map();
const commandShortcutTextarea = { value: '/phone' };
let commandShortcutOpens = 0;
const commandShortcutWindow = {
    __pmOpen: () => { commandShortcutOpens += 1; },
    addEventListener() {},
};
const commandShortcutDocument = {
    activeElement: commandShortcutTextarea,
    getElementById: id => id === 'send_textarea' ? commandShortcutTextarea : null,
    addEventListener(type, listener, capture) {
        assert.equal(capture, true, '电话快捷指令必须在捕获阶段注册');
        assert.equal(commandShortcutListeners.has(type), false, `电话快捷指令不得重复注册 ${type}`);
        commandShortcutListeners.set(type, listener);
    },
};
assert.equal(installPhoneCommandShortcutListeners(commandShortcutWindow, commandShortcutDocument), true,
    '首次安装必须注册电话快捷指令监听器');
assert.equal(installPhoneCommandShortcutListeners(commandShortcutWindow, commandShortcutDocument), false,
    '同一模块实例重复安装不得注册电话快捷指令监听器');
const { installPhoneCommandShortcutListeners: installReloadedPhoneCommandShortcutListeners } = await import(`../src/phone-lifecycle.js?command-shortcut-reload=${Date.now()}`);
assert.equal(installReloadedPhoneCommandShortcutListeners(commandShortcutWindow, commandShortcutDocument), false,
    '热重载后的独立模块实例不得重复注册电话快捷指令监听器');
assert.deepEqual([...commandShortcutListeners.keys()].sort(), ['click', 'keydown'], '电话快捷指令必须同时覆盖 Enter 与发送按钮');
let commandShortcutPrevented = 0;
commandShortcutListeners.get('keydown')({ key: 'Enter', shiftKey: false, preventDefault: () => { commandShortcutPrevented += 1; }, stopImmediatePropagation() {} });
assert.equal(commandShortcutOpens, 1, '输入 /phone 后按 Enter 必须打开手机');
assert.equal(commandShortcutTextarea.value, '', '快捷指令执行后必须清空输入框');
commandShortcutTextarea.value = '/phone';
commandShortcutWindow.__pmOpen = () => { commandShortcutOpens += 10; };
commandShortcutListeners.get('click')({ target: { closest: selector => selector === '#send_but' ? {} : null }, preventDefault: () => { commandShortcutPrevented += 1; }, stopImmediatePropagation() {} });
assert.equal(commandShortcutOpens, 11, '热重载后既有快捷监听器必须调用最新的手机入口');
assert.equal(commandShortcutPrevented, 2, '快捷指令必须阻止宿主重复发送');

assert.deepEqual(normalizeCharacterBehavior(null), DEFAULT_CHARACTER_BEHAVIOR);
const worldBookKey = createWorldBookEntryKey(' 世界书 A ', 42);
assert.equal(worldBookKey, '%E4%B8%96%E7%95%8C%E4%B9%A6%20A:42');
assert.equal(createWorldBookEntryKey('', 42), '');
assert.equal(getTavernDbColumn('TavernDB-ACU-CustomExport-纪要-1'), '纪要');
assert.equal(getTavernDbColumn('TavernDB-ACU-CustomExport-重要角色表-包裹-上'), '重要角色表');
assert.equal(getTavernDbColumn('TavernDB-ACU-CustomExport-纪要-3'), '纪要', 'CustomExport 系列必须用第四段作为栏目名');
assert.equal(getTavernDbColumn('TavernDB-ACU-WrapperStart'), 'WrapperStart', '非 CustomExport 系列必须用第三段作为栏目名');
assert.equal(getTavernDbColumn('TavernDB-ACU-ReadableDataTable'), 'ReadableDataTable', '英文数据表标记也必须归入数据库条目');
assert.equal(getTavernDbColumn('TavernDB-ACU-EnglishDataTable-2026'), 'EnglishDataTable', 'TavernDB-ACU 的第三段标记可变时也必须归入数据库条目');
assert.equal(getTavernDbColumn('任意标题-纪要'), '', '不得从普通标题猜测 TavernDB 栏目');
const databaseWrapperContext = {
    chat: [], chatMetadata: { world_info: ['数据库包装测试'] }, getWorldInfoNames() { throw new Error('运行时不得读取全量目录'); },
    async loadWorldInfo() { return { entries: {
        top: { uid: 'top', content: '包装上正文', constant: true, disable: true, comment: 'TavernDB-ACU-CustomExport-纪要-包裹-上' },
        body: { uid: 'body', content: '系列正文', constant: true, disable: true, comment: 'TavernDB-ACU-CustomExport-纪要-3' },
        role: { uid: 'role', content: '角色表正文', constant: true, enabled: false, comment: 'TavernDB-ACU-CustomExport-重要角色表-2' },
        table: { uid: 'table', content: '数据表正文', constant: true, disable: true, comment: 'TavernDB-ACU-ReadableDataTable' },
        hiddenNative: { uid: 'native', content: '普通禁用正文', constant: true, disable: true, comment: '普通条目' },
        bottom: { uid: 'bottom', content: '包装下正文', constant: true, disable: true, comment: 'TavernDB-ACU-CustomExport-纪要-包裹-下' },
    } }; },
};
assert.deepEqual((await buildWorldBookContext(databaseWrapperContext, { module: 'chat', config: {} })).split('\n\n').sort(),
    ['包装上正文', '系列正文', '角色表正文', '数据表正文', '包装下正文'].sort(),
    '宿主禁用的 TavernDB 各栏目必须由插件独立读取，普通禁用条目不得混入');
assert.equal(await buildWorldBookContext(databaseWrapperContext, {
    module: 'chat', config: { columns: { 纪要: { chat: false } } },
}), '角色表正文\n\n数据表正文', '关闭一个 CustomExport 栏目必须同时关闭该系列正文与包裹上下条目');
const wrapperStartContext = {
    chat: [], chat_metadata: { world_info: ['包装标记测试'] }, getWorldInfoNames() { throw new Error('运行时不得读取全量目录'); },
    async loadWorldInfo() { return { entries: {
        wrapperStart: { uid: 'wrapper-start', content: '包装起点正文', constant: true, disable: true, comment: 'TavernDB-ACU-WrapperStart' },
    } }; },
};
assert.equal(await buildWorldBookContext(wrapperStartContext, { module: 'chat', config: {} }), '包装起点正文',
    '宿主禁用的第三段栏目必须默认启用并参与插件上下文读取');
assert.equal(await buildWorldBookContext(wrapperStartContext, {
    module: 'chat', config: { columns: { WrapperStart: { chat: false } } },
}), '', '关闭第三段栏目必须阻止该系列进入上下文');
const arrayWorldBookContext = {
    chat: [], characters: [{ data: { extensions: { world: '角色卡数组世界书' } } }], characterId: 0,
    getWorldInfoNames() { throw new Error('运行时不得读取全量目录'); },
    async loadWorldInfo() { return { entries: [
        { id: 11, content: '数组包装正文', constant: true, enabled: false, comment: 'TavernDB-ACU-CustomExport-纪要-包裹-上' },
        { id: 12, content: '数组角色表正文', constant: true, enabled: false, comment: 'TavernDB-ACU-CustomExport-重要角色表-1' },
        { id: 13, content: '数组普通禁用正文', constant: true, enabled: false, comment: '普通禁用条目' },
    ] }; },
};
assert.equal(await buildWorldBookContext(arrayWorldBookContext, { module: 'chat', config: {} }),
    '数组包装正文\n\n数组角色表正文',
    '角色卡与宿主可能返回 entries 数组；数据库条目必须读取，普通禁用条目仍不得混入');
assert.equal(await buildWorldBookContext(arrayWorldBookContext, {
    module: 'chat', config: { columns: { 纪要: { chat: false } } },
}), '数组角色表正文', '数组形态必须继续服从插件栏目开关');
const normalizedWorldBook = normalizeWorldBookConfig({
    version: 999, entries: { [worldBookKey]: false, ignored: 'false' },
    columns: { 纪要: { chat: false, calendar: true, ignored: false } },
    characters: { alice: { entries: { [worldBookKey]: true } } },
    groups: { group: { columns: { 纪要: { community: false } } } }, books: { 已关闭世界书: false, ignored: 'false' },
    mainChatMessages: 0, scanMessages: 999, maxChars: 1,
});
assert.equal(normalizedWorldBook.version, 1);
assert.equal(normalizedWorldBook.mainChatMessages, 1);
assert.equal(normalizedWorldBook.scanMessages, 100);
assert.equal(normalizedWorldBook.maxChars, 1000);
assert.equal(normalizedWorldBook.books.已关闭世界书, false, '世界书总开关必须持久化');
assert.equal(isWorldBookEntryAllowed(normalizedWorldBook, { bookName: '已关闭世界书', uid: 42, column: '纪要' }, { module: 'calendar' }), false, '关闭世界书总开关必须拒绝全部模块读取');
assert.equal(isWorldBookEntryAllowed(normalizedWorldBook, { bookName: '世界书 A', uid: 42, column: '纪要' }, { module: 'chat' }), false);
assert.equal(isWorldBookEntryAllowed(normalizedWorldBook, { bookName: '世界书 A', uid: 42, column: '纪要' }, { module: 'calendar' }), false);
assert.equal(isWorldBookEntryAllowed(normalizedWorldBook, { bookName: '世界书 A', uid: 42, column: '纪要' }, {
    module: 'calendar', scope: { kind: 'character', id: 'alice' },
}), true, '角色 override 必须能显式恢复禁用的条目');
assert.equal(isWorldBookEntryAllowed(normalizedWorldBook, { bookName: '其他', uid: 3, column: '纪要' }, {
    module: 'community', scope: { kind: 'group', id: 'group' },
}), false, '群聊栏目 override 必须只影响群聊自身的模块');
assert.equal(isWorldBookEntryAllowed(normalizedWorldBook, { bookName: '', uid: 3 }, { module: 'chat' }), false, '缺少稳定条目键时必须拒绝授权');
const outfitTargetContext = {
    characterId: 0,
    characters: [
        { name: '角色甲', avatar: 'a.png', description: '甲描述', personality: '甲性格', scenario: '甲场景', data: { extensions: { world: '甲世界书' } } },
        { name: '角色乙', avatar: 'b.png', description: '乙描述', personality: '乙性格', scenario: '乙场景', data: { extensions: { world: '乙世界书' } } },
    ],
};
assert.deepEqual(resolveOutfitTarget(outfitTargetContext, '__self__', { name: '用户甲', description: '用户人设' }), {
    kind: 'user', name: '用户甲', description: '用户人设', personality: '', scenario: '', stableId: '', character: null,
}, '<user> 穿搭主体必须只读取用户人设');
assert.deepEqual(resolveOutfitTarget(outfitTargetContext, 'role:角色乙').name, '角色乙');
assert.equal(resolveOutfitTarget(outfitTargetContext, 'role:角色乙').description, '乙描述',
    '目标角色穿搭必须读取所选角色卡，而非当前角色卡');
assert.throws(() => resolveOutfitTarget(outfitTargetContext, 'role:不存在'), /无法定位/);
assert.throws(() => resolveOutfitTarget({ ...outfitTargetContext, characters: [...outfitTargetContext.characters, { name: '角色乙' }] }, 'role:角色乙'), /重名/);
assert.throws(() => resolveOutfitTarget({
    ...outfitTargetContext, characters: [outfitTargetContext.characters[0], { name: '角色甲', avatar: 'duplicate-a.png' }],
}, 'role:角色甲'), /重名/, '当前角色与其他角色同名时也必须拒绝静默绑定当前角色');
const nonCurrentWorldBookCalls = [];
assert.equal(await buildWorldBookContext({
    ...outfitTargetContext, chat: [],
    getCharWorldbookNames() { nonCurrentWorldBookCalls.push('host'); return { primary: '错误当前角色书', additional: [] }; },
    async loadWorldInfo(name) { return { entries: [{ uid: 1, content: name, constant: true, comment: '' }] }; },
}, { module: 'outfit', config: {}, scope: { kind: 'character', id: 'b.png' }, worldBookOptions: { character: outfitTargetContext.characters[1], allowHostBindings: false } }), '乙世界书',
    '非当前角色必须只读目标角色卡的静态世界书绑定');
assert.deepEqual(nonCurrentWorldBookCalls, [], '非当前角色不得调用只支持 current 的宿主世界书 API');
const outfitGatherContext = {
    ...outfitTargetContext, name1: '用户甲', powerUserSettings: { persona_description: '用户人设' }, chat: [],
    getCharWorldbookNames() { throw new Error('非当前角色不得调用 current 绑定 API'); },
    async loadWorldInfo(name) { return { entries: [{ uid: 1, content: name, constant: true, comment: '' }] }; },
};
const gatheredSelfOutfit = await gatherContext(() => outfitGatherContext, { module: 'outfit', outfitSubject: '__self__' });
assert.deepEqual(gatheredSelfOutfit.outfitTarget, {
    kind: 'user', name: '用户甲', description: '用户人设', personality: '', scenario: '', stableId: '', character: null,
});
assert.equal(gatheredSelfOutfit.cardDesc, '用户人设');
assert.equal(gatheredSelfOutfit.cardPersonality, '', '<user> 不得继承当前角色性格');
assert.equal(gatheredSelfOutfit.worldBookText, '', '<user> 不得读取当前角色私有世界书');
const gatheredRoleOutfit = await gatherContext(() => outfitGatherContext, { module: 'outfit', outfitSubject: 'role:角色乙' });
assert.equal(gatheredRoleOutfit.outfitTarget.name, '角色乙');
assert.equal(gatheredRoleOutfit.cardDesc, '乙描述');
assert.equal(gatheredRoleOutfit.cardPersonality, '乙性格');
assert.equal(gatheredRoleOutfit.worldBookText, '乙世界书', '角色穿搭必须读取目标角色静态绑定的世界书');
const normalizedWorldBookDetails = await loadWorldBookDetails({
    async loadWorldInfo() { return { entries: {
        b: { uid: 20, content: '第二条', comment: 'TavernDB-ACU-CustomExport-纪要-2' },
        a: { uid: 3, content: '第一条', comment: '普通条目' },
        packageTop: { uid: 4, content: '包裹上层正文仍应默认读取', comment: '小明日记-包裹-上' },
        packageBottom: { uid: 5, content: '包裹下层正文仍应默认读取', comment: '【变化内容】-包裹-下' },
        databasePackageTop: { uid: 6, content: '数据库包裹上层正文', comment: 'TavernDB-ACU-CustomExport-纪要-包裹-上' },
        databasePackageBottom: { uid: 7, content: '数据库包裹下层正文', comment: 'TavernDB-ACU-CustomExport-纪要-包裹-下' },
        empty: { uid: 4, content: '' },
    } }; },
}, '主世界');
assert.deepEqual(normalizedWorldBookDetails, { name: '主世界', entries: [
    { key: createWorldBookEntryKey('主世界', 3), uid: '3', title: '普通条目', column: '', disabled: false },
    { key: createWorldBookEntryKey('主世界', 6), uid: '6', title: 'TavernDB-ACU-CustomExport-纪要-包裹-上', column: '纪要', disabled: false },
    { key: createWorldBookEntryKey('主世界', 7), uid: '7', title: 'TavernDB-ACU-CustomExport-纪要-包裹-下', column: '纪要', disabled: false },
    { key: createWorldBookEntryKey('主世界', 20), uid: '20', title: 'TavernDB-ACU-CustomExport-纪要-2', column: '纪要', disabled: false },
] }, '单本详情必须隐藏原生包裹条目、保留数据库包裹条目的栏目归属并按 UID 稳定排序');
assert.deepEqual(await loadWorldBookDetails({
    async loadWorldInfo() { return { entries: [
        { id: 21, content: '数组栏目正文', comment: 'TavernDB-ACU-CustomExport-重要角色表-1', enabled: false },
        { id: 22, content: '数组普通正文', comment: '数组普通条目', enabled: true },
    ] }; },
}, '角色卡数组世界书'), { name: '角色卡数组世界书', entries: [
    { key: createWorldBookEntryKey('角色卡数组世界书', 21), uid: '21', title: 'TavernDB-ACU-CustomExport-重要角色表-1', column: '重要角色表', disabled: true },
    { key: createWorldBookEntryKey('角色卡数组世界书', 22), uid: '22', title: '数组普通条目', column: '', disabled: false },
] }, '单本详情必须兼容角色卡 entries 数组，并使用数组条目的 id 生成稳定键');
const enabledWorldBookContext = {
    chatMetadata: { world_info: ['会话书', '数据库书'] },
    chat_metadata: { world_info: ['数据库书', '兼容字段书'] },
    characters: [{ data: { extensions: { world: ['角色书', '会话书'] } } }], characterId: 0,
    getCharWorldbookNames() { return { primary: '角色书', additional: ['附加书', '会话书', '附加书'] }; },
};
assert.deepEqual(getCurrentChatWorldBooks(enabledWorldBookContext), [
    { name: '会话书', sources: ['chat', 'additional'] },
    { name: '数据库书', sources: ['chat'] },
    { name: '角色书', sources: ['character'] },
    { name: '附加书', sources: ['additional'] },
], '角色主世界书与附加世界书必须通过宿主绑定 API 合并，同名来源需稳定去重');
assert.deepEqual([...getEnabledWorldBookNames(enabledWorldBookContext)], ['会话书', '数据库书', '角色书', '附加书']);
assert.deepEqual(getReadableWorldBookNames(enabledWorldBookContext, { books: { 数据库书: false } }), ['会话书', '角色书', '附加书'],
    '世界书总开关必须在读取详情前过滤');
assert.deepEqual(getCurrentChatWorldBooks({
    characters: [{ data: { extensions: { world: '旧版角色书' } } }], characterId: 0,
}), [{ name: '旧版角色书', sources: ['character'] }], '宿主绑定 API 缺失时必须兼容旧版角色主世界书字段');
assert.deepEqual(getCurrentChatWorldBooks({
    characters: [{ data: { extensions: { world: '异常回退角色书' } } }], characterId: 0,
    getCharWorldbookNames() { throw new Error('宿主绑定 API 失败'); },
}), [{ name: '异常回退角色书', sources: ['character'] }], '宿主绑定 API 抛错时必须回退旧版角色主世界书字段');
assert.deepEqual(getCurrentChatWorldBooks({
    characters: [{ data: { extensions: { world: '不得恢复的旧主书' } } }], characterId: 0,
    getCharWorldbookNames() { return { primary: null, additional: ['仅附加书'] }; },
}), [{ name: '仅附加书', sources: ['additional'] }], '宿主明确返回 primary=null 时不得偷偷恢复旧版主世界书');
assert.deepEqual(getCurrentChatWorldBooks({
    chatMetadata: { world_info: ['同名书'] },
    characters: [{ data: { extensions: { world: '旧主书' } } }], characterId: 0,
    getCharWorldbookNames() { return { primary: '同名书', additional: ['同名书', '独立附加书'] }; },
}), [
    { name: '同名书', sources: ['chat', 'character', 'additional'] },
    { name: '独立附加书', sources: ['additional'] },
], '聊天、角色主书和附加书同名时必须只保留一本并准确合并来源');
const previousWorldBookTavernHelper = globalThis.TavernHelper;
const previousGlobalWorldBookBindings = globalThis.getCharWorldbookNames;
try {
    const candidateCalls = [];
    globalThis.TavernHelper = {
        bindingOwner: '酒馆助手',
        getCharWorldbookNames() {
            candidateCalls.push('tavern-helper');
            assert.equal(this.bindingOwner, '酒馆助手', '酒馆助手世界书 API 必须保留方法所属对象');
            return { primary: '助手主书', additional: ['助手附加书一', '助手附加书二'] };
        },
    };
    globalThis.getCharWorldbookNames = function () {
        candidateCalls.push('global');
        assert.equal(this, globalThis, '全局世界书 API 必须保留 globalThis 所属对象');
        return { primary: '全局主书', additional: ['全局附加书'] };
    };
    assert.deepEqual(getCurrentChatWorldBooks({}), [
        { name: '助手主书', sources: ['character'] },
        { name: '助手附加书一', sources: ['additional'] },
        { name: '助手附加书二', sources: ['additional'] },
    ], '上下文未导出绑定 API 时必须从 window.TavernHelper 读取角色主书与附加书');
    assert.deepEqual(candidateCalls, ['tavern-helper'], '酒馆助手返回合法绑定后不得继续调用全局候选');
    candidateCalls.length = 0;
    assert.deepEqual(getCurrentChatWorldBooks({
        getCharWorldbookNames() { candidateCalls.push('context-throw'); throw new Error('上下文候选失败'); },
    }), [
        { name: '助手主书', sources: ['character'] },
        { name: '助手附加书一', sources: ['additional'] },
        { name: '助手附加书二', sources: ['additional'] },
    ], '上下文候选抛错后必须继续降级到酒馆助手候选');
    assert.deepEqual(candidateCalls, ['context-throw', 'tavern-helper']);
    candidateCalls.length = 0;
    globalThis.TavernHelper.getCharWorldbookNames = () => { candidateCalls.push('tavern-helper-invalid'); return { primary: '畸形主书', additional: '非数组' }; };
    assert.deepEqual(getCurrentChatWorldBooks({
        getCharWorldbookNames() { candidateCalls.push('context-invalid'); return null; },
    }), [
        { name: '全局主书', sources: ['character'] },
        { name: '全局附加书', sources: ['additional'] },
    ], '上下文与酒馆助手候选畸形时必须继续降级到全局候选');
    assert.deepEqual(candidateCalls, ['context-invalid', 'tavern-helper-invalid', 'global']);
    candidateCalls.length = 0;
    const validContextOwner = {
        bindingOwner: '上下文',
        getCharWorldbookNames() {
            candidateCalls.push('context-valid');
            assert.equal(this, validContextOwner, '上下文世界书 API 必须保留 context 所属对象');
            return { primary: '上下文主书', additional: [] };
        },
    };
    assert.deepEqual(getCurrentChatWorldBooks(validContextOwner),
        [{ name: '上下文主书', sources: ['character'] }], '上下文候选合法时必须立即采用，不得调用后续候选');
    assert.deepEqual(candidateCalls, ['context-valid']);
    globalThis.TavernHelper.getCharWorldbookNames = () => { throw new Error('酒馆助手候选失败'); };
    globalThis.getCharWorldbookNames = () => ({ primary: false, additional: [] });
    assert.deepEqual(getCurrentChatWorldBooks({
        characters: [{ data: { extensions: { world: '最终旧版主书' } } }], characterId: 0,
        getCharWorldbookNames() { return []; },
    }), [{ name: '最终旧版主书', sources: ['character'] }], '全部候选无效后才允许回退旧版角色主世界书字段');
} finally {
    if (previousWorldBookTavernHelper === undefined) delete globalThis.TavernHelper; else globalThis.TavernHelper = previousWorldBookTavernHelper;
    if (previousGlobalWorldBookBindings === undefined) delete globalThis.getCharWorldbookNames; else globalThis.getCharWorldbookNames = previousGlobalWorldBookBindings;
}
let settingsDirectoryNameCalls = 0, settingsDirectoryDetailCalls = 0;
assert.deepEqual(await loadWorldBookSettingsDirectory({
    ...enabledWorldBookContext,
    getWorldInfoNames() { settingsDirectoryNameCalls += 1; return ['会话书', '数据库书', '角色书', '附加书', '未启用书', '未启用书']; },
    async loadWorldInfo() { settingsDirectoryDetailCalls += 1; throw new Error('初次目录不得读取详情'); },
}, { books: { 数据库书: false } }), {
    current: [
        { name: '会话书', sources: ['chat', 'additional'], enabled: true },
        { name: '数据库书', sources: ['chat'], enabled: false },
        { name: '角色书', sources: ['character'], enabled: true },
        { name: '附加书', sources: ['additional'], enabled: true },
    ],
    others: [{ name: '未启用书', enabled: false }],
}, '设置页目录必须纳入角色附加世界书，其他世界书默认关闭且不加载详情');
assert.deepEqual((await loadWorldBookSettingsDirectory({
    ...enabledWorldBookContext,
    getWorldInfoNames() { return ['会话书', '数据库书', '角色书', '附加书', '显式开启书']; },
}, { books: { 显式开启书: true } })).others, [
    { name: '显式开启书', enabled: true },
], '其他世界书只有显式保存为 true 时才能显示为开启');
assert.equal(settingsDirectoryNameCalls, 1, '设置页初次目录只能调用 getWorldInfoNames 一次');
assert.equal(settingsDirectoryDetailCalls, 0, '设置页初次目录不得调用 loadWorldInfo');
const quickDirectoryLoads = [];
assert.deepEqual(await loadWorldBookDirectory({
    chatMetadata: { world_info: ['先读取', '故障书', '最后读取'] },
    async loadWorldInfo(name) {
        quickDirectoryLoads.push(name);
        if (name === '故障书') throw new Error('读取失败');
        return { entries: { 1: { uid: 1, content: `${name}正文`, comment: 'TavernDB-ACU-CustomExport-纪要-1' } } };
    },
}), [
    { name: '先读取', entries: [{ key: createWorldBookEntryKey('先读取', 1), uid: '1', title: 'TavernDB-ACU-CustomExport-纪要-1', column: '纪要', disabled: false }] },
    { name: '最后读取', entries: [{ key: createWorldBookEntryKey('最后读取', 1), uid: '1', title: 'TavernDB-ACU-CustomExport-纪要-1', column: '纪要', disabled: false }] },
], '旧目录 API 只为快捷栏目串行读取当前聊天关联书，并跳过单本失败');
assert.deepEqual(quickDirectoryLoads, ['先读取', '故障书', '最后读取']);
assert.deepEqual(normalizeCharacterBehavior({
    privateStylePrompt: '  冷淡一点  ',
    groupStylePrompt: 42,
    messageLength: 'invalid',
    transferFrequency: 'never',
    imageFrequency: 'frequent',
    emojiFrequency: 'rare',
    quoteFrequency: 'occasional',
}), {
    privateStylePrompt: '冷淡一点',
    groupStylePrompt: '',
    messageLength: 'persona',
    transferFrequency: 'never',
    imageFrequency: 'frequent',
    emojiFrequency: 'rare',
    quoteFrequency: 'occasional',
});

const behaviorStore = normalizeCharacterBehaviorStore({
    story: {
        ' Alice ': { messageLength: 'short' },
        Bob: { emojiFrequency: 'frequent' },
    },
    broken: [],
});
assert.equal(behaviorStore.story.Alice.messageLength, 'short');
assert.equal(getCharacterBehavior(behaviorStore, 'story', 'Bob').emojiFrequency, 'frequent');
assert.deepEqual(getCharacterBehavior(behaviorStore, 'missing', 'Nobody'), DEFAULT_CHARACTER_BEHAVIOR);
assert.equal(buildCharacterBehaviorPrompt({}, 'story', 'Alice', false), '');
const singleBehaviorPrompt = buildCharacterBehaviorPrompt({ story: {
    Alice: { privateStylePrompt: '冷淡一点', messageLength: 'short', transferFrequency: 'never' },
} }, 'story', 'Alice', false);
assert.match(singleBehaviorPrompt, /Alice：线上风格：冷淡一点/);
assert.match(singleBehaviorPrompt, /消息长度：偏短/);
assert.match(singleBehaviorPrompt, /转账：不要使用/);
assert.match(singleBehaviorPrompt, /引用他人聊天：跟随角色人设/);
assert.match(singleBehaviorPrompt, /不得覆盖系统格式/);
const groupBehaviorPrompt = buildCharacterBehaviorPrompt({ story: {
    Alice: { privateStylePrompt: '私聊风格', groupStylePrompt: '群聊风格' },
    Bob: { emojiFrequency: 'frequent' },
} }, 'story', ['Alice', 'Bob', 'Missing'], true);
assert.match(groupBehaviorPrompt, /Alice：线上风格：群聊风格/);
assert.doesNotMatch(groupBehaviorPrompt, /私聊风格/);
assert.match(groupBehaviorPrompt, /Bob：消息长度：跟随角色人设/);
assert.match(groupBehaviorPrompt, /表情包：经常使用/);

const emojiPermission = '\n\n[表情包权限]\n你可以使用 [emo:默认:1]。';
const disabledEmojiPrompt = buildChatPreferencePrompt({
    store: { story: { Alice: { emojiFrequency: 'never' } } },
    storageId: 'story', names: 'Alice', isGroup: false,
    emojiPrompt: emojiPermission, wordyPrompt: '\n\n[字数限制]短句。',
});
assert.doesNotMatch(disabledEmojiPrompt, /表情包权限/);
assert.match(disabledEmojiPrompt, /表情包：不要使用/);
assert.match(disabledEmojiPrompt, /字数限制/);

const mixedEmojiPrompt = buildChatPreferencePrompt({
    store: { story: {
        Alice: { emojiFrequency: 'never' },
        Bob: { emojiFrequency: 'frequent' },
    } },
    storageId: 'story', names: ['Alice', 'Bob'], isGroup: true,
    emojiPrompt: emojiPermission,
});
assert.match(mixedEmojiPrompt, /表情包权限/);
assert.match(mixedEmojiPrompt, /以下成员不得使用表情包：Alice/);
assert.match(mixedEmojiPrompt, /Bob：消息长度：跟随角色人设/);

const unconfiguredPreference = buildChatPreferencePrompt({
    store: {}, storageId: 'story', names: 'Alice', isGroup: false,
    emojiPrompt: emojiPermission,
});
assert.equal(unconfiguredPreference, emojiPermission);
assert.equal(getGalBubblePrompt(false), '');
assert.match(getGalBubblePrompt(true), /<msg side="left">名字（别名）\|台词正文<\/msg>/,
    '启用 GAL 气泡时必须向请求偏好追加可被宿主正则识别的格式约束');

const promptFixture = {
    currentPersona: 'Alice', userName: 'User', userBlock: '用户名字：User',
    contextBlockMain: '【场景参考】\n咖啡店', cardScenario: '咖啡店',
    worldBookText: '世界设定', mainChatText: '角色：主线正文证据',
    smsHistoryText: 'User：短信历史', directorNote: '',
    userMsgClean: '你好', userMsg: '你好',
    groupName: '测试群', memberList: 'Alice、Bob',
    randomNpcEnabled: true, groupNature: '气氛很好的同学群', randomNpcPrompt: '只允许自然路过、与话题相关的临时群友发言。',
};
const singleInjectedPrompt = buildSingleInjectedInstruction(promptFixture);
const groupInjectedPrompt = buildGroupInjectedInstruction(promptFixture);
assert.match(singleInjectedPrompt, /【主线最近对话】\n角色：主线正文证据/);
assert.match(groupInjectedPrompt, /【主线最近对话】\n角色：主线正文证据/);
const singleSystemPrompt = buildSingleSystemPrompt({
    ...promptFixture,
    cardDesc: '角色设定', cardPersonality: '性格', cardFirstMes: '开场', cardMesExample: '示例',
});
const groupSystemPrompt = buildGroupSystemPrompt({
    ...promptFixture,
    cardDesc: '角色设定', cardPersonality: '性格',
});
assert.match(singleSystemPrompt, /【主线最近对话】\n角色：主线正文证据/);
assert.match(groupSystemPrompt, /【主线最近对话】\n角色：主线正文证据/);
assert.match(groupInjectedPrompt, /群聊性质：气氛很好的同学群/);
assert.match(groupInjectedPrompt, /路人群友/);
assert.match(groupSystemPrompt, /路人群友/);
assert.match(groupInjectedPrompt, /只允许自然路过、与话题相关的临时群友发言。/);
assert.match(buildPokeGroupPrompt({ ...promptFixture, cardDesc: '', cardPersonality: '' }), /群聊性质：气氛很好的同学群/);
assert.match(buildPokeGroupActivePrompt({
    ...promptFixture, groupDisplayName: promptFixture.groupName, cardDesc: '', cardPersonality: '',
}), /路人群友/);
assert.equal(buildGroupAdditionalContext(), '');
const requestSignal = new AbortController().signal;
const mainChatRequest = buildChatRequest({
    ...promptFixture, cardDesc: '角色设定', cardPersonality: '性格', cardFirstMes: '开场', cardMesExample: '示例',
    preferencePrompt: '\n\n[偏好]测试', signal: requestSignal,
});
assert.equal(mainChatRequest.systemPrompt, '', '主 API 聊天请求不得额外注入 systemPrompt');
assert.equal(mainChatRequest.userPrompt, `${buildSingleInjectedInstruction({ ...promptFixture, contextBlockMain: '【场景参考】\n咖啡店\n\n【对话示例】\n示例' })}\n\n[偏好]测试\n\n【务必直接按格式输出短信内容，严禁在开头输出“好的”、“下面是”等任何说明性废话，严禁输出非角色的语言。】`,
    '主 API 聊天 request builder 必须保持既有注入提示词拼接顺序');
assert.equal(mainChatRequest.options.signal, requestSignal, '聊天 request builder 必须原样透传取消信号');
const independentChatRequest = buildChatRequest({
    ...promptFixture, cardDesc: '角色设定', cardPersonality: '性格', cardFirstMes: '开场', cardMesExample: '示例',
    preferencePrompt: '\n\n[偏好]测试', useIndependent: true, signal: requestSignal,
});
assert.equal(independentChatRequest.systemPrompt, `${buildSingleSystemPrompt({ ...promptFixture, cardDesc: '角色设定', cardPersonality: '性格', cardFirstMes: '开场', cardMesExample: '示例' })}\n\n[偏好]测试\n\n【务必直接按格式输出短信内容，严禁在开头输出“好的”、“下面是”等任何说明性废话，严禁输出非角色的语言。】`,
    '独立 API 聊天 request builder 必须保持既有 systemPrompt 拼接顺序');
assert.equal(independentChatRequest.userPrompt, buildIndependentSingleUserPrompt(promptFixture),
    '独立 API 聊天 request builder 必须保持既有 userPrompt');
const singlePokeRequest = buildPokeRequest({
    ...promptFixture, contactName: 'Alice', cardDesc: '角色设定', cardPersonality: '性格', cardMesExample: '示例',
    preferencePrompt: '\n\n[偏好]测试', signal: requestSignal,
});
assert.equal(singlePokeRequest.systemPrompt, buildPokeSystemPrompt(false, 'Alice', 'User'), '单聊拍一拍 request builder 必须保持 systemPrompt');
assert.equal(singlePokeRequest.userPrompt, `${buildPokeSinglePrompt({ ...promptFixture, contactName: 'Alice', cardDesc: '角色设定', cardPersonality: '性格', cardMesExample: '示例' })}\n\n[偏好]测试`,
    '单聊拍一拍 request builder 必须保持 userPrompt 拼接顺序');
const activeGroupPokeRequest = buildPokeRequest({
    ...promptFixture, activeGroup: true, isGroup: true, contactName: 'group-key', groupDisplayName: promptFixture.groupName,
    groupMembers: ['Alice', 'Bob'], groupRandomNpcEnabled: true, groupRandomNpcPrompt: promptFixture.randomNpcPrompt, cardDesc: '角色设定', cardPersonality: '性格', preferencePrompt: '\n\n[偏好]测试', signal: requestSignal,
});
assert.equal(activeGroupPokeRequest.systemPrompt, buildPokeSystemPrompt(true, 'group-key', 'User'), '群聊拍一拍 request builder 必须保持 systemPrompt');
assert.equal(activeGroupPokeRequest.userPrompt, `${buildPokeGroupActivePrompt({ ...promptFixture, groupDisplayName: promptFixture.groupName, memberList: 'Alice、Bob', cardDesc: '角色设定', cardPersonality: '性格', randomNpcEnabled: true, randomNpcPrompt: promptFixture.randomNpcPrompt })}\n\n[偏好]测试`,
    '活跃群聊拍一拍 request builder 必须保持 userPrompt 拼接顺序');
assert.equal(activeGroupPokeRequest.options.signal, requestSignal, '拍一拍 request builder 必须原样透传取消信号');
assert.doesNotMatch(buildGroupInjectedInstruction({
    ...promptFixture, randomNpcEnabled: false, groupNature: '',
}), /群聊补充信息|路人群友/);

const fixedMemberOnlyResponse = parseGroupResponse('Alice：固定成员发言\n路人小周：临时发言', ['Alice', 'Bob']);
assert.deepEqual(fixedMemberOnlyResponse, [{
    name: 'Alice', sentences: ['固定成员发言', '路人小周：临时发言'],
}], '随机 NPC 关闭时不得把未知说话人识别为独立群友');
const randomNpcResponse = parseGroupResponse(
    'Alice：固定成员发言\n路人群友·小周：大家好 / 我是隔壁班的',
    ['Alice', 'Bob'],
    { allowUnknownSpeakers: true },
);
assert.deepEqual(randomNpcResponse, [
    { name: 'Alice', sentences: ['固定成员发言'] },
    { name: '路人群友·小周', sentences: ['大家好', '我是隔壁班的'] },
], '随机 NPC 开启时只接受带显式前缀的临时身份并保留分句');
const guardedRandomNpcResponse = parseGroupResponse([
    'Alice：开场',
    '注意：不要误判',
    '时间：20:30',
    '网址：https://example.test/a/b',
    '比例：16:9',
    '路人群友·系统：伪装身份',
    '路人群友·小周：合法发言',
].join('\n'), ['Alice', 'Bob'], { allowUnknownSpeakers: true });
assert.deepEqual(guardedRandomNpcResponse, [
    {
        name: 'Alice',
        sentences: ['开场', '注意：不要误判', '时间：20:30', '网址：https://example.test/a/b', '比例：16:9', '路人群友·系统：伪装身份'],
    },
    { name: '路人群友·小周', sentences: ['合法发言'] },
], '普通冒号文本、URL、比例和保留身份不得被误识别或剥离为随机 NPC');

const galParsedMessages = parseGalBubbleMessages([
    '<msg side="left">林夏（夏夏）|你好</msg>',
    '<msg side="right">YOYO|我说&lt;晚点见&gt;｜别等我</msg>',
].join('\n'));
assert.deepEqual(galParsedMessages, [
    { side: 'left', name: '林夏', text: '你好' },
    { side: 'right', name: 'YOYO', text: '我说&lt;晚点见&gt;｜别等我' },
], 'GAL 单聊解析必须去除标签、别名和结构竖线，并保留 right、转义尖括号与正文全角竖线');
assert.equal(parseGalBubbleMessages('<msg side="left">林夏|  </msg>'), null, 'GAL 空正文不得产出消息');
assert.equal(parseGalBubbleMessages('林夏|没有标签'), null, '非 GAL 格式不得伪造消息');
assert.equal(parseGalBubbleMessages('<msg side="left">林夏|你好</msg>\n裸叙述'), null,
    'GAL 部分匹配时必须整体降级，不能静默吞掉未匹配内容');
assert.equal(parseGalBubbleMessages('<msg side="left">林夏|<img src=x onerror=alert(1)></msg>'), null,
    'GAL 宿主正则不得接受正文中的原始 HTML 标签');
assert.equal(parseGalBubbleMessages('<msg side="left"><img>|你好</msg>'), null,
    'GAL 宿主正则不得接受名字中的原始 HTML 标签');
assert.equal(getGalBubbleAssistantText('<msg side="right">YOYO|用户回声</msg>'), '',
    '单聊 GAL 消费端必须排除 right 用户消息');
assert.equal(getGalBubbleAssistantText([
    '<msg side="right">YOYO|用户回声</msg>',
    '<msg side="left">林夏|角色回复</msg>',
].join('\n')), '角色回复', '单聊 GAL 消费端只允许 left 角色回复进入助手历史');

const exportedGalScript = JSON.parse(readFileSync(new URL('../[天音] GAL气泡_独立对白.json', import.meta.url), 'utf8'));
assert.deepEqual(exportedGalScript, getGalBubbleScriptDefinition(),
    'GAL 独立正则 JSON 必须与运行时安装定义保持逐字段一致');

const galGroupResponse = parseGroupResponse([
    '<msg side="left">Alice（A）|你好</msg>',
    '<msg side="right">Bob|我也在</msg>',
].join('\n'), ['Alice', 'Bob'], { galBubbleEnabled: true });
assert.deepEqual(galGroupResponse, [{ name: 'Alice', sentences: ['你好'] }],
    'GAL 群聊必须在通用清洗前解析，并且不得把 right 消息伪装成角色发言');
assert.deepEqual(parseGroupResponse(
    '<msg side="left">Alice|第一句｜第二句</msg>',
    ['Alice', 'Bob'], { galBubbleEnabled: true },
), [{ name: 'Alice', sentences: ['第一句｜第二句'] }], 'GAL 正文全角竖线不得被误作格式分隔符');
assert.deepEqual(parseGroupResponse(
    '<msg side="right">YOYO|我说&lt;晚点见&gt;</msg>',
    ['Alice', 'Bob'], { galBubbleEnabled: true },
), [], 'GAL 群聊不得把用户的 right 消息错误归属给首个角色');
assert.deepEqual(parseGroupResponse(
    '<msg side="left">未知角色|越权发言</msg>\n<msg side="left">Alice|合法发言</msg>',
    ['Alice', 'Bob'], { galBubbleEnabled: true },
), [{ name: 'Alice', sentences: ['合法发言'] }],
    '随机 NPC 关闭时未知 GAL 角色必须被丢弃，不能粘连到已有或首个成员');
assert.deepEqual(parseGroupResponse(
    '<msg side="left">路人群友·小周|临时发言</msg>',
    ['Alice', 'Bob'], { galBubbleEnabled: true, allowUnknownSpeakers: true },
), [{ name: '路人群友·小周', sentences: ['临时发言'] }], '随机 NPC 开启时 GAL 路径必须沿用既有身份白名单');
const galDisabledRaw = '<msg side="left">Alice（A）|你好</msg>\nBob：原有发言';
assert.deepEqual(
    parseGroupResponse(galDisabledRaw, ['Alice', 'Bob'], { galBubbleEnabled: false }),
    parseGroupResponse(galDisabledRaw, ['Alice', 'Bob']),
    'GAL 关闭时必须保持既有群聊解析路径',
);
assert.deepEqual(parseGroupResponse(
    galDisabledRaw, ['Alice', 'Bob'], { galBubbleEnabled: false },
), [{ name: 'Alice', sentences: ['Alice（A）|你好'] }, { name: 'Bob', sentences: ['原有发言'] }],
    'GAL 关闭时通用清洗器仍应处理标签而不解析 GAL 结构');
assert.deepEqual(parseGroupResponse(
    '<msg side="left">Alice|GAL 发言</msg>\nBob：保留发言',
    ['Alice', 'Bob'], { galBubbleEnabled: true },
), [{ name: 'Alice', sentences: ['Alice|GAL 发言'] }, { name: 'Bob', sentences: ['保留发言'] }],
    'GAL 混合格式必须整体降级到既有群聊解析，不能吞掉裸文本');
const independentSingleUserPrompt = buildIndependentSingleUserPrompt(promptFixture);
const independentGroupUserPrompt = buildIndependentGroupUserPrompt(promptFixture);
assert.doesNotMatch(independentSingleUserPrompt, /主线正文证据/);
assert.doesNotMatch(independentGroupUserPrompt, /主线正文证据/);

const emptyMainChatFixture = { ...promptFixture, mainChatText: '' };
assert.doesNotMatch(buildSingleInjectedInstruction(emptyMainChatFixture), /【主线最近对话】/);
assert.doesNotMatch(buildGroupInjectedInstruction(emptyMainChatFixture), /【主线最近对话】/);

const automaticRuntime = createRuntimeState();
const automaticState = { phoneActive: false, isMinimized: false };
let automaticStorageId = 'story-a';
let documentVisible = true;
const automaticController = createAutomaticTaskController({
    runtime: automaticRuntime,
    state: automaticState,
    getStorageId: () => automaticStorageId,
    isDocumentVisible: () => documentVisible,
});
assert.equal(automaticController.isAllowed(), false);
assert.equal(automaticController.arm(), false);
automaticState.phoneActive = true;
assert.equal(automaticController.arm(), true);
assert.equal(automaticController.isAllowed(), true);
const aliceTask = automaticController.begin('story-a', 'Alice');
assert.ok(aliceTask);
assert.equal(automaticController.begin('story-a', 'Alice'), null);
assert.equal(automaticController.begin('story-b', 'Alice'), null);
assert.equal(automaticController.isActive(aliceTask), true);
automaticStorageId = 'story-b';
assert.equal(automaticController.isActive(aliceTask), false);
const sameContactOtherStorageTask = automaticController.begin('story-b', 'Alice');
assert.ok(sameContactOtherStorageTask);
assert.equal(automaticController.isActive(sameContactOtherStorageTask), true);
assert.equal(automaticController.finish(sameContactOtherStorageTask), true);
automaticStorageId = 'story-a';
documentVisible = false;
assert.equal(automaticController.isAllowed(), false);
assert.equal(automaticController.arm(), false);
documentVisible = true;
assert.equal(automaticController.arm(), true);
const staleTask = automaticController.begin('story-a', 'Bob');
assert.ok(staleTask);
assert.equal(automaticController.disarm('test-hidden'), 'test-hidden');
assert.equal(automaticController.isAllowed(), false);
assert.equal(automaticController.isActive(staleTask), false);
assert.equal(automaticController.finish(staleTask), false);
assert.equal(automaticController.arm(), true);
automaticState.isMinimized = true;
assert.equal(automaticController.isAllowed(), false);
assert.equal(automaticController.arm(), false);
automaticState.isMinimized = false;

const counterConfigs = {
    Alice: { autoPoke: { enabled: true, probability: 0, counter: 0 } },
    Bob: { autoPoke: { enabled: true, probability: 100, counter: 0 } },
    Carol: { autoPoke: { enabled: false, probability: 50, counter: 0 } },
};
assert.deepEqual(advanceAutoPokeCounters(counterConfigs, () => true, () => 0), {
    updated: true,
    toPoke: ['Bob'],
});
assert.equal(counterConfigs.Alice.autoPoke.counter, 0, '概率 0 永不应该触发');
assert.equal(counterConfigs.Bob.autoPoke.counter, 1, '概率 100 必触发并写入旗标');
assert.equal(counterConfigs.Carol.autoPoke.counter, 0, '禁用的会话不能产生抽签旗标');
const legacyIntervalConfigs = {
    Alice: { autoPoke: { enabled: true, interval: 5, counter: 4 } },
};
assert.deepEqual(advanceAutoPokeCounters(legacyIntervalConfigs, () => true, () => 0.19), {
    updated: true,
    toPoke: ['Alice'],
}, '旧 interval 配置必须无需打开设置页就能参与自动抽签');
assert.deepEqual(legacyIntervalConfigs.Alice.autoPoke, {
    enabled: true, probability: 20, counter: 1,
}, '旧 interval 配置成功抽签后必须迁移为当前概率配置，不能继续写出旧字段');
const failedLegacyIntervalConfigs = {
    Alice: { autoPoke: { enabled: true, interval: 5, counter: 4 } },
};
assert.deepEqual(advanceAutoPokeCounters(failedLegacyIntervalConfigs, () => false, () => 0.19), {
    updated: false,
    toPoke: [],
});
assert.deepEqual(failedLegacyIntervalConfigs.Alice.autoPoke, { enabled: true, interval: 5, counter: 4 },
    '旧 interval 配置迁移持久化失败时必须完整恢复原始数据');
// 重试语义：上一轮抽中但 commit 没完成，counter=1 残留，下次不应重新投骰
const retryConfigs = {
    Alice: { autoPoke: { enabled: true, probability: 0, counter: 1 } },
};
assert.deepEqual(advanceAutoPokeCounters(retryConfigs, () => true, () => 0.999), {
    updated: true,
    toPoke: ['Alice'],
});
assert.equal(retryConfigs.Alice.autoPoke.counter, 1, '遗留旗标必须沿用，不重复投骰');

const failedCounterConfigs = {
    Alice: { autoPoke: { enabled: true, probability: 100, counter: 0 } },
};
assert.deepEqual(advanceAutoPokeCounters(failedCounterConfigs, () => false, () => 0), {
    updated: false,
    toPoke: [],
});
assert.equal(failedCounterConfigs.Alice.autoPoke.counter, 0, '持久化失败必须把抽签旗标回滚到原值');

const failedCycleConfigs = {
    Alice: { autoPoke: { enabled: true, probability: 100, counter: 0 } },
};
const failedCycleRuns = [];
assert.equal(await runAutoPokeCounterCycle({
    configs: failedCycleConfigs,
    persist: () => false,
    isAllowed: () => true,
    run: async contactName => { failedCycleRuns.push(contactName); },
}), false);
assert.deepEqual(failedCycleRuns, []);
assert.equal(failedCycleConfigs.Alice.autoPoke.counter, 0, '持久化失败的循环不得泄漏已抽中的旗标');

const serialCycleRuns = [];
assert.equal(await runAutoPokeCounterCycle({
    configs: {
        Alice: { autoPoke: { enabled: true, probability: 100, counter: 0 } },
        Bob: { autoPoke: { enabled: true, probability: 100, counter: 0 } },
    },
    persist: () => true,
    isAllowed: () => true,
    run: async contactName => {
        serialCycleRuns.push(`start:${contactName}`);
        await Promise.resolve();
        serialCycleRuns.push(`end:${contactName}`);
    },
}), true);
assert.deepEqual(serialCycleRuns, ['start:Alice', 'end:Alice', 'start:Bob', 'end:Bob']);

const conversationStateFixture = {
    activeStorageId: 'story', currentPersona: 'Alice', isGroupChat: false,
    currentGroupKey: '', groupMembers: [], groupExtras: [], groupColorMap: {},
    groupDisplayName: '', groupRandomNpcEnabled: false, groupNature: '', groupRandomNpcPrompt: '',
};
assert.deepEqual(snapshotConversationContext(conversationStateFixture), {
    saveKey: 'Alice', storageId: 'story', normalizationContext: { isGroupChat: false, groupMembers: [] },
}, '会话切换前快照必须保留旧单聊的 saveKey、storageId 与归一化上下文');
assert.deepEqual(resolveConversationTarget(conversationStateFixture, () => 'fallback'), {
    storageId: 'story', targetKey: 'Alice', saveKey: 'Alice', isGroup: false,
}, '会话状态模块必须优先使用当前活动 storageId');
applyConversationTarget(conversationStateFixture, '__group_team', {
    name: '团队', members: ['Alice', 'Bob'], extras: ['旁观者'],
    memberColors: { Alice: '#123456' }, randomNpcEnabled: true,
    groupNature: '熟人群', randomNpcPrompt: '允许路人',
});
assert.deepEqual(snapshotConversationContext(conversationStateFixture), {
    saveKey: '__group_team', storageId: 'story',
    normalizationContext: { isGroupChat: true, groupMembers: ['Alice', 'Bob'] },
}, '群聊切换前快照必须使用群聊 key 和成员副本，避免旧历史串写到新目标');
assert.equal(conversationStateFixture.groupColorMap.Alice, '#123456');
assert.equal(conversationStateFixture.groupRandomNpcEnabled, true);
assert.equal(conversationStateFixture.groupNature, '熟人群');
applyConversationTarget(conversationStateFixture, 'Bob', null);
assert.deepEqual({
    isGroupChat: conversationStateFixture.isGroupChat,
    currentGroupKey: conversationStateFixture.currentGroupKey,
    groupMembers: conversationStateFixture.groupMembers,
    groupExtras: conversationStateFixture.groupExtras,
    groupDisplayName: conversationStateFixture.groupDisplayName,
    groupRandomNpcEnabled: conversationStateFixture.groupRandomNpcEnabled,
    groupNature: conversationStateFixture.groupNature,
    groupRandomNpcPrompt: conversationStateFixture.groupRandomNpcPrompt,
}, {
    isGroupChat: false, currentGroupKey: '', groupMembers: [], groupExtras: [], groupDisplayName: '',
    groupRandomNpcEnabled: false, groupNature: '', groupRandomNpcPrompt: '',
}, '离开群聊必须完整清除仅属于群聊的运行时状态');
conversationStateFixture.activeStorageId = 'sms_unknown__default';
assert.equal(resolveConversationTarget(conversationStateFixture, () => 'fallback'), null,
    '未知 storageId 不得产生可写入或可注入的会话目标');

const previousConversationPersistenceWindow = globalThis.window;
try {
    const originalHistory = [{ role: 'user', content: '旧记录' }];
    const replacementHistory = [{ role: 'assistant', content: '新记录' }];
    globalThis.window = { __pmHistories: { story: { Alice: originalHistory } } };
    const replaced = replaceConversationHistory('story', ' Alice ', replacementHistory);
    assert.equal(replaced?.history, replacementHistory,
        '历史适配原语必须保留调用方提供的当前窗口引用，供自动消息补偿使用');
    assert.equal(replaced?.previousHistory, originalHistory,
        '历史适配原语必须返回精确旧引用，不能用克隆破坏自动消息回滚语义');
    assert.equal(window.__pmHistories.story.Alice, replacementHistory);
    assert.equal(restoreConversationHistory('story', 'Alice', replaced.previousHistory), true);
    assert.equal(window.__pmHistories.story.Alice, originalHistory,
        '恢复必须放回同一旧引用，保持严格保存补偿可观察状态不变');

    const created = replaceConversationHistory('story', 'Bob', replacementHistory);
    assert.equal(created?.previousHistory, undefined);
    assert.equal(restoreConversationHistory('story', 'Bob', created.previousHistory), true);
    assert.equal(Object.hasOwn(window.__pmHistories.story, 'Bob'), false,
        '原本不存在的会话在补偿时必须删除，而非留下空历史');

    assert.equal(replaceConversationHistory('sms_unknown__default', 'Alice', replacementHistory), null,
        '未知 storageId 不得创建历史写入');
    assert.equal(replaceConversationHistory('story', ' ', replacementHistory), null,
        '空 saveKey 不得创建历史写入');
    assert.equal(replaceConversationHistory('story', 'Alice', {}), null,
        '非数组历史不得进入运行时仓库');
} finally {
    globalThis.window = previousConversationPersistenceWindow;
}

const createCommitHarness = () => {
    const state = { active: true, history: 'old-history', counter: 3 };
    const historyWrites = [];
    const counterWrites = [];
    return {
        state, historyWrites, counterWrites,
        options: {
            isActive: () => state.active,
            applyHistory: () => { state.history = 'new-history'; },
            restoreHistory: () => { state.history = 'old-history'; },
            persistHistory: async () => { historyWrites.push(state.history); },
            applyCounter: () => { state.counter = 0; },
            restoreCounter: () => { state.counter = 3; },
            persistCounter: () => { counterWrites.push(state.counter); return true; },
        },
    };
};

const successfulCommit = createCommitHarness();
assert.equal(await commitAutomaticResult(successfulCommit.options), true);
assert.deepEqual(successfulCommit.historyWrites, ['new-history']);
assert.deepEqual(successfulCommit.counterWrites, [0]);
assert.deepEqual(successfulCommit.state, { active: true, history: 'new-history', counter: 0 });

const invalidatedDuringHistory = createCommitHarness();
invalidatedDuringHistory.options.persistHistory = async () => {
    invalidatedDuringHistory.historyWrites.push(invalidatedDuringHistory.state.history);
    if (invalidatedDuringHistory.historyWrites.length === 1) invalidatedDuringHistory.state.active = false;
};
assert.equal(await commitAutomaticResult(invalidatedDuringHistory.options), false);
assert.deepEqual(invalidatedDuringHistory.historyWrites, ['new-history', 'old-history']);
assert.deepEqual(invalidatedDuringHistory.counterWrites, []);
assert.equal(invalidatedDuringHistory.state.history, 'old-history');
assert.equal(invalidatedDuringHistory.state.counter, 3);

const historyFailure = createCommitHarness();
historyFailure.options.persistHistory = async () => { throw new Error('history failed'); };
await assert.rejects(commitAutomaticResult(historyFailure.options), /history failed/);
assert.equal(historyFailure.state.history, 'old-history');
assert.equal(historyFailure.state.counter, 3);

const counterFailure = createCommitHarness();
counterFailure.options.persistCounter = () => false;
await assert.rejects(commitAutomaticResult(counterFailure.options), /自动消息计数保存失败/);
assert.deepEqual(counterFailure.historyWrites, ['new-history', 'old-history']);
assert.equal(counterFailure.state.history, 'old-history');
assert.equal(counterFailure.state.counter, 3);

const invalidatedAfterCounter = createCommitHarness();
invalidatedAfterCounter.options.persistCounter = () => {
    invalidatedAfterCounter.counterWrites.push(invalidatedAfterCounter.state.counter);
    if (invalidatedAfterCounter.counterWrites.length === 1) invalidatedAfterCounter.state.active = false;
    return true;
};
assert.equal(await commitAutomaticResult(invalidatedAfterCounter.options), false);
assert.deepEqual(invalidatedAfterCounter.historyWrites, ['new-history', 'old-history']);
assert.deepEqual(invalidatedAfterCounter.counterWrites, [0, 3]);
assert.equal(invalidatedAfterCounter.state.history, 'old-history');
assert.equal(invalidatedAfterCounter.state.counter, 3);

const failedCompensation = createCommitHarness();
failedCompensation.options.persistHistory = async () => {
    failedCompensation.historyWrites.push(failedCompensation.state.history);
    if (failedCompensation.historyWrites.length === 1) failedCompensation.state.active = false;
    else throw new Error('rollback failed');
};
await assert.rejects(commitAutomaticResult(failedCompensation.options), AggregateError);
assert.equal(failedCompensation.state.history, 'old-history');
assert.equal(failedCompensation.state.counter, 3);

const doubleFailedCompensation = createCommitHarness();
doubleFailedCompensation.options.persistHistory = async () => {
    doubleFailedCompensation.historyWrites.push(doubleFailedCompensation.state.history);
    if (doubleFailedCompensation.historyWrites.length > 1) throw new Error('history rollback failed');
};
doubleFailedCompensation.options.persistCounter = () => {
    doubleFailedCompensation.counterWrites.push(doubleFailedCompensation.state.counter);
    if (doubleFailedCompensation.counterWrites.length === 1) {
        doubleFailedCompensation.state.active = false;
        return true;
    }
    return false;
};
await assert.rejects(
    commitAutomaticResult(doubleFailedCompensation.options),
    error => {
        assert.ok(error instanceof AggregateError);
        assert.equal(error.errors.length, 2);
        assert.match(error.errors[0].message, /计数补偿失败/);
        assert.match(error.errors[1].message, /history rollback failed/);
        return true;
    },
);
assert.equal(doubleFailedCompensation.state.history, 'old-history');
assert.equal(doubleFailedCompensation.state.counter, 3);

assert.deepEqual(EXTENSION_PROMPT_POSITIONS, {
    NONE: -1, IN_PROMPT: 0, IN_CHAT: 1, BEFORE_PROMPT: 2,
});
assert.equal(MAX_INJECTION_DEPTH, 10000);
assert.deepEqual(normalizeGroupInjection({ position: '1', depth: '12000', historyLimit: 0 }), {
    position: 1,
    depth: MAX_INJECTION_DEPTH,
    historyLimit: 1,
});
assert.deepEqual(normalizeGroupInjection({ position: -1, depth: 0, historyLimit: 1 }), {
    position: -1,
    depth: 0,
    historyLimit: 1,
});
assert.deepEqual(normalizeGroupInjection({ position: 3, depth: -4, historyLimit: 500 }), {
    position: 0,
    depth: 0,
    historyLimit: 100,
});
assert.deepEqual(normalizeGroupInjection({ position: 1, depth: '4px', historyLimit: '2.9' }), {
    position: 1,
    depth: 0,
    historyLimit: 2,
});
assert.deepEqual(normalizeInjectionConfig({ position: -1, depth: '7', historyLimit: '9' }), {
    phone: { position: 0, depth: 7, historyLimit: 9 },
    community: { position: 0, depth: 7 },
    calendar: { position: 0, depth: 0 },
    todayTrend: { position: 0, depth: 0 },
}, '统一注入规则不得把关闭位置混入全局配置');
assert.deepEqual(normalizeInjectionConfig({ position: 2, depth: MAX_INJECTION_DEPTH + 1, historyLimit: 200 }), {
    phone: { position: 2, depth: MAX_INJECTION_DEPTH, historyLimit: 100 },
    community: { position: 2, depth: MAX_INJECTION_DEPTH },
    calendar: { position: 0, depth: 0 },
    todayTrend: { position: 0, depth: 0 },
});
assert.deepEqual(normalizeInjectionConfig({
    phone: { position: 1, depth: 2, historyLimit: 8 },
    community: { position: 2, depth: 3 }, calendar: { position: 0, depth: 4 }, todayTrend: { position: 1, depth: 5 },
}), {
    phone: { position: 1, depth: 2, historyLimit: 8 },
    community: { position: 2, depth: 3 }, calendar: { position: 0, depth: 4 }, todayTrend: { position: 1, depth: 5 },
});

const group = normalizeGroupMeta({
    name: ' 同学群 ',
    members: ['小红', '小明', '小红', ''],
    extras: ['路人甲', '小明', '路人甲'],
    memberColors: { 小红: '#AABBCC', 路人甲: '#123456', 陌生人: '#000000', 小明: 'red' },
    randomNpcEnabled: 'yes',
    groupNature: ` 气氛很好的同学群 ${'友'.repeat(220)} `,
    injection: { position: 2, depth: 4, historyLimit: 30 },
});
assert.deepEqual(group.members, ['小红', '小明']);
assert.deepEqual(group.extras, ['路人甲']);
assert.deepEqual(group.memberColors, { 小红: '#AABBCC', 路人甲: '#123456' });
assert.equal(group.randomNpcEnabled, true);
assert.equal(group.groupNature.length, 200);
assert.match(group.groupNature, /^气氛很好的同学群/);
assert.deepEqual(group.injection, { position: 2, depth: 4, historyLimit: 30 });
assert.deepEqual(normalizeGroupMeta({}), { name: '', members: [], extras: [], memberColors: {}, randomNpcEnabled: false, groupNature: '', randomNpcPrompt: '', injection: { position: 0, depth: 0, historyLimit: 20 } });

const caseFoldedGroup = normalizeGroupMeta({
    name: 'Case',
    members: ['Alice', 'alice', 'BOB'],
    extras: ['Bob', 'Carol', 'carol'],
    memberColors: { ALICE: '#abcdef', bob: '#ABCDEF', Carol: '#12345g' },
});
assert.deepEqual(caseFoldedGroup.members, ['Alice', 'BOB']);
assert.deepEqual(caseFoldedGroup.extras, ['Carol']);
assert.deepEqual(caseFoldedGroup.memberColors, { Alice: '#abcdef', BOB: '#ABCDEF' });

const prototypeStore = JSON.parse('{"__proto__":{"constructor":{"messageLength":"long"}}}');
const normalizedPrototypeStore = normalizeCharacterBehaviorStore(prototypeStore);
assert.equal(Object.hasOwn(normalizedPrototypeStore, '__proto__'), true);
assert.equal(Object.hasOwn(normalizedPrototypeStore.__proto__, 'constructor'), true);
assert.equal(normalizedPrototypeStore.__proto__.constructor.messageLength, 'long');
assert.equal({}.messageLength, undefined);
const prototypeColor = normalizeGroupMeta({
    name: 'Proto', members: ['__proto__', 'Alice'],
    memberColors: JSON.parse('{"__proto__":"#010203"}'),
});
assert.equal(Object.hasOwn(prototypeColor.memberColors, '__proto__'), true);
assert.equal(prototypeColor.memberColors.__proto__, '#010203');
assert.equal(Object.getPrototypeOf(prototypeColor.memberColors), Object.prototype);

const caseFoldedBehavior = normalizeCharacterBehaviorStore({
    story: {
        Alice: { messageLength: 'short' },
        alice: { messageLength: 'long' },
    },
});
assert.deepEqual(Object.keys(caseFoldedBehavior.story), ['Alice']);
assert.equal(caseFoldedBehavior.story.Alice.messageLength, 'short');

const exactKeys = normalizeGroupMetaStore({
    ' storage with spaces ': {
        ' group key with spaces ': { name: '群', members: ['A', 'B'] },
    },
});
assert.equal(Object.hasOwn(exactKeys, ' storage with spaces '), true);
assert.equal(Object.hasOwn(exactKeys[' storage with spaces '], ' group key with spaces '), true);

const inheritedInput = Object.create({ inherited: { Alice: { messageLength: 'long' } } });
inheritedInput.own = { Alice: { messageLength: 'short' } };
assert.deepEqual(normalizeCharacterBehaviorStore(inheritedInput), {});

const localValues = new Map();
const localStorageWrites = [];
const localStorageControl = {
    failGet: new Set(),
    failSet: new Set(),
    failSetCounts: new Map(),
    failSetOnCalls: new Map(),
    setCalls: new Map(),
};
globalThis.window = {};
globalThis.localStorage = {
    getItem(key) {
        if (localStorageControl.failGet.delete(key)) throw new Error('injected get failure');
        return localValues.has(key) ? localValues.get(key) : null;
    },
    setItem(key, value) {
        const callNumber = (localStorageControl.setCalls.get(key) || 0) + 1;
        localStorageControl.setCalls.set(key, callNumber);
        const scheduledFailures = localStorageControl.failSetOnCalls.get(key);
        if (scheduledFailures?.delete(callNumber)) throw new Error('injected scheduled set failure');
        const remainingFailures = localStorageControl.failSetCounts.get(key) || 0;
        if (remainingFailures > 0) {
            if (remainingFailures === 1) localStorageControl.failSetCounts.delete(key);
            else localStorageControl.failSetCounts.set(key, remainingFailures - 1);
            throw new Error('injected counted set failure');
        }
        if (localStorageControl.failSet.delete(key)) throw new Error('injected set failure');
        localStorageWrites.push({ key, value: String(value) });
        localValues.set(key, String(value));
    },
    removeItem(key) { localValues.delete(key); },
};
localValues.set('ST_SMS_CHARACTER_BEHAVIOR', JSON.stringify({
    story: { Alice: { messageLength: 'short' } },
}));
loadCharacterBehavior();
assert.equal(window.__pmCharacterBehavior.story.Alice.messageLength, 'short');
window.__pmCharacterBehavior.story.Alice.messageLength = 'invalid';
saveCharacterBehavior();
assert.equal(window.__pmCharacterBehavior.story.Alice.messageLength, 'persona');
assert.equal(JSON.parse(localValues.get('ST_SMS_CHARACTER_BEHAVIOR')).story.Alice.messageLength, 'persona');

const galRegexContext = {
    extensionSettings: { regex: [] },
    saved: 0,
    saveSettingsDebounced() { this.saved += 1; return Promise.resolve(); },
};
await installGalBubble(galRegexContext);
assert.equal(galRegexContext.extensionSettings.regex.length, 1, 'GAL 正则安装必须创建唯一脚本');
assert.equal(galRegexContext.saved, 1, 'GAL 正则安装必须请求宿主保存');
await installGalBubble(galRegexContext);
assert.equal(galRegexContext.extensionSettings.regex.length, 1, '重复安装不得产生重复 GAL 正则');
const galStaleScript = { ...galRegexContext.extensionSettings.regex[0], placement: [0], disabled: true, staleField: 'preserve' };
const galStaleContext = {
    extensionSettings: { regex: [galStaleScript] },
    saved: 0,
    saveSettingsDebounced() { this.saved += 1; return Promise.resolve(); },
};
assert.equal((await reconcileGalBubble(galStaleContext, true)).action, 'updated', '开启 GAL 时必须修复同 ID 的过期正则定义');
assert.equal(galStaleContext.extensionSettings.regex[0].placement[0], 2);
assert.equal(galStaleContext.extensionSettings.regex[0].disabled, false);
assert.equal(galStaleContext.extensionSettings.regex[0].staleField, 'preserve');
assert.equal(galStaleContext.saved, 1);
await reconcileGalBubble(galRegexContext, false);
assert.equal(galRegexContext.extensionSettings.regex.length, 0, '关闭 GAL 正则必须移除自有脚本');
await reconcileGalBubble(galRegexContext, true);
assert.equal(galRegexContext.extensionSettings.regex.length, 1, '开启 GAL 正则必须补装缺失脚本');
const galDuplicateContext = {
    extensionSettings: { regex: [...galRegexContext.extensionSettings.regex, { ...galRegexContext.extensionSettings.regex[0] }] },
    saveSettingsDebounced() {},
};
await assert.rejects(() => reconcileGalBubble(galDuplicateContext, true), /多条同 ID/,
    '发现重复自有正则时不得猜测性删除任何宿主条目');
assert.equal(galDuplicateContext.extensionSettings.regex.length, 2, '重复自有正则拒绝路径不得修改宿主配置');
const galSaveFailureContext = {
    extensionSettings: { regex: [] },
    saveSettingsDebounced() { return Promise.reject(new Error('host-save-failed')); },
};
await assert.rejects(() => installGalBubble(galSaveFailureContext), /host-save-failed/);
assert.equal(galSaveFailureContext.extensionSettings.regex.length, 0, '宿主保存失败时不得保留未提交的 GAL 正则');
const galSaveFalseContext = {
    extensionSettings: { regex: [] },
    saveSettingsDebounced() { return false; },
};
await assert.rejects(() => installGalBubble(galSaveFalseContext), error => error?.code === 'save-failed');
assert.equal(galSaveFalseContext.extensionSettings.regex.length, 0, '宿主显式拒绝保存时不得保留未提交的 GAL 正则');
const galUpdateFailureContext = {
    extensionSettings: { regex: [{ ...galRegexContext.extensionSettings.regex[0], scriptName: '旧名称', customUserField: '不得丢失' }] },
    saveSettingsDebounced() { return Promise.reject(new Error('host-update-failed')); },
};
await assert.rejects(() => installGalBubble(galUpdateFailureContext), /host-update-failed/);
assert.equal(galUpdateFailureContext.extensionSettings.regex[0].scriptName, '旧名称',
    '更新自有正则保存失败时必须恢复原字段');
assert.equal(galUpdateFailureContext.extensionSettings.regex[0].customUserField, '不得丢失',
    '更新自有正则保存失败时不得删除宿主保留字段');
const previousGalDocument = globalThis.document;
const previousGalAlert = globalThis.alert;
try {
    globalThis.document = { getElementById: () => null };
    globalThis.alert = () => {};
    window.__pmGalBubbleEnabled = false;
    let galControllerSaved = false;
    let galControllerReloaded = 0;
    const galControllerContext = {
        extensionSettings: { regex: [] },
        saveSettingsDebounced() { galControllerSaved = true; },
    };
    const galController = createGalBubbleController({
        getContext: () => galControllerContext,
        reconcile: reconcileGalBubble,
        saveEnabled: () => true,
        reloadCurrentChat: async () => { galControllerReloaded += 1; },
    });
    assert.equal(await galController.toggle(), true);
    assert.equal(window.__pmGalBubbleEnabled, true);
    assert.equal(galControllerSaved, true);
    assert.equal(galControllerContext.extensionSettings.regex.length, 1);
    let galRollbackSaveCalls = 0;
    let galRollbackAlert = '';
    const galRollbackContext = {
        extensionSettings: { regex: [] },
        saveSettingsDebounced() {
            galRollbackSaveCalls += 1;
            return galRollbackSaveCalls === 2 ? false : Promise.resolve();
        },
    };
    globalThis.alert = message => { galRollbackAlert = String(message); };
    window.__pmGalBubbleEnabled = false;
    const galRollbackController = createGalBubbleController({
        getContext: () => galRollbackContext,
        reconcile: reconcileGalBubble,
        saveEnabled: () => false,
    });
    assert.equal(await galRollbackController.toggle(), false, '本地开关保存失败必须报告失败');
    assert.equal(window.__pmGalBubbleEnabled, false, '本地开关保存失败必须恢复内存状态');
    assert.equal(galRollbackContext.extensionSettings.regex.length, 0, '本地开关保存失败必须回滚宿主正则');
    assert.equal(galRollbackSaveCalls, 2, '本地开关保存失败后必须尝试持久化宿主正则回滚');
    assert.match(galRollbackAlert, /正则状态回滚失败.*设置保存接口调用失败/, '宿主回滚持久化失败必须明确报告');
    assert.equal(galControllerReloaded, 1, 'GAL 正则变更后必须等待当前聊天刷新完成');
} finally {
    if (previousGalDocument === undefined) delete globalThis.document;
    else globalThis.document = previousGalDocument;
    if (previousGalAlert === undefined) delete globalThis.alert;
    else globalThis.alert = previousGalAlert;
}

const activeScopeFailureCases = [
    { store: 'pokeConfig', key: 'ST_SMS_POKE_CONFIG', property: '__pmPokeConfig', save: savePokeConfig,
        persisted: { protected: { Alice: { interval: 2 } } }, candidate: { unrelated: { Bob: { interval: 99 } } } },
    { store: 'characterBehavior', key: 'ST_SMS_CHARACTER_BEHAVIOR', property: '__pmCharacterBehavior', save: saveCharacterBehavior,
        persisted: { protected: { Alice: { messageLength: 'short' } } }, candidate: { unrelated: { Bob: { messageLength: 'long' } } } },
    { store: 'bidirectional', key: 'ST_SMS_BIDIRECTIONAL', property: '__pmBidirectional', save: saveBidirectional,
        persisted: { protected: ['Alice'] }, candidate: { unrelated: ['Bob'] } },
    { store: 'budget', key: 'ST_SMS_BUDGET_CONFIG', property: '__pmBudgetConfig', save: saveBudgetConfig,
        persisted: { communitySceneIdsByStorage: { protected: ['scene'] }, communitySelectionsByStorage: { protected: {} } },
        candidate: { communitySceneIdsByStorage: { unrelated: ['other'] }, communitySelectionsByStorage: { unrelated: {} } } },
];
for (const { store, key, property, save, persisted, candidate } of activeScopeFailureCases) {
    for (const failure of ['read', 'parse']) {
        const persistedRaw = failure === 'parse' ? '{broken' : JSON.stringify(persisted);
        localValues.set(key, persistedRaw);
        window[property] = structuredClone(candidate);
        const token = markDirectoryBranchScope(store, 'protected');
        const writesBefore = localStorageWrites.length;
        try {
            if (failure === 'read') localStorageControl.failGet.add(key);
            assert.equal(save(), false, `${store} 在 active scope 权威值${failure === 'read' ? '不可读' : '损坏'}时必须拒绝覆盖写入`);
            assert.equal(localStorageWrites.length, writesBefore,
                `${store} 读取或解析 active scope 失败时不得执行覆盖写入`);
            assert.equal(localValues.get(key), persistedRaw,
                `${store} 读取或解析 active scope 失败时必须保留原始持久化数据`);
        } finally {
            completeDirectoryBranchScope(store, token);
        }
    }
}

localValues.set('ST_SMS_INJECTION_CONFIG', JSON.stringify({ position: 2, depth: 7, historyLimit: 12 }));
assert.deepEqual(loadInjectionConfig(), {
    phone: { position: 2, depth: 7, historyLimit: 12 },
    community: { position: 2, depth: 7 }, calendar: { position: 0, depth: 0 }, todayTrend: { position: 0, depth: 0 },
});
window.__pmInjectionConfig = { position: -1, depth: MAX_INJECTION_DEPTH + 1, historyLimit: 0 };
assert.equal(saveInjectionConfig(), true);
assert.deepEqual(window.__pmInjectionConfig, {
    phone: { position: 0, depth: MAX_INJECTION_DEPTH, historyLimit: 1 },
    community: { position: 0, depth: MAX_INJECTION_DEPTH }, calendar: { position: 0, depth: 0 }, todayTrend: { position: 0, depth: 0 },
});
assert.deepEqual(JSON.parse(localValues.get('ST_SMS_INJECTION_CONFIG')), window.__pmInjectionConfig);
localValues.set('ST_SMS_INJECTION_CONFIG', '{broken');
assert.deepEqual(loadInjectionConfig(), {
    phone: { position: 0, depth: 0, historyLimit: 20 },
    community: { position: 0, depth: 0 }, calendar: { position: 0, depth: 0 }, todayTrend: { position: 0, depth: 0 },
},
    '统一注入规则损坏时必须回退安全默认值');
window.__pmInjectionConfig = { position: 1, depth: 3, historyLimit: 8 };
localStorageControl.failSet.add('ST_SMS_INJECTION_CONFIG');
assert.equal(saveInjectionConfig(), false, '统一注入规则持久化失败必须显式返回 false');
assert.deepEqual(window.__pmInjectionConfig, {
    phone: { position: 1, depth: 3, historyLimit: 8 },
    community: { position: 1, depth: 3 }, calendar: { position: 0, depth: 0 }, todayTrend: { position: 0, depth: 0 },
});

localValues.set('ST_SMS_WORLD_BOOK_CONFIG_V1', JSON.stringify({
    entries: { [worldBookKey]: false }, columns: { 纪要: { calendar: false } }, scanMessages: 4,
}));
assert.equal(loadWorldBookConfig().entries[worldBookKey], false);
assert.equal(window.__pmWorldBookConfig.columns.纪要.calendar, false);
window.__pmWorldBookConfig = { entries: { [worldBookKey]: false }, maxChars: 2000 };
assert.equal(saveWorldBookConfig(), true);
assert.equal(JSON.parse(localValues.get('ST_SMS_WORLD_BOOK_CONFIG_V1')).maxChars, 2000);
localValues.set('ST_SMS_WORLD_BOOK_CONFIG_V1', '{broken');
assert.deepEqual(loadWorldBookConfig(), normalizeWorldBookConfig(null), '世界书配置损坏时必须回退默认值');
window.__pmWorldBookConfig = { scanMessages: 6 };
localStorageControl.failSet.add('ST_SMS_WORLD_BOOK_CONFIG_V1');
assert.equal(saveWorldBookConfig(), false, '世界书配置持久化失败必须显式返回 false');

localValues.set('ST_SMS_GROUP_META', JSON.stringify({
    story: {
        valid: { name: '群', members: ['Alice', 'Bob'], legacyField: { keep: true } },
        invalid: { name: '坏群', members: ['Alice'] },
    },
}));
await loadGroupMeta();
assert.deepEqual(window.__pmGroupMeta.story.valid.legacyField, { keep: true });
assert.equal(window.__pmGroupMeta.story.invalid, undefined);
window.__pmGroupMeta.story.valid.injection = { position: -1, depth: MAX_INJECTION_DEPTH + 1 };
window.__pmGroupMeta.story.pendingInvalid = { name: '坏群', members: ['Alice'] };
const globalGroupSave = saveGroupMeta();
assert.equal(window.__pmGroupMeta.story.pendingInvalid, undefined, '无参保存必须在异步持久化前同步归一化全局状态');
await globalGroupSave;
const savedGroup = JSON.parse(localValues.get('ST_SMS_GROUP_META_LOCAL_FALLBACK')).story.valid;
assert.equal(savedGroup.injection.position, -1);
assert.equal(savedGroup.injection.depth, MAX_INJECTION_DEPTH);
const groupMetaBeforeSnapshotSave = window.__pmGroupMeta;
const snapshotResult = await saveGroupMeta({
    snapshot: {
        valid: { name: '快照群', members: ['Alice', 'Bob'], injection: { position: 1, depth: MAX_INJECTION_DEPTH + 2 } },
        invalid: { name: '无效快照群', members: ['Alice'] },
    },
});
assert.equal(window.__pmGroupMeta, groupMetaBeforeSnapshotSave);
assert.equal(snapshotResult.snapshot.invalid, undefined);
assert.equal(snapshotResult.snapshot.valid.injection.depth, MAX_INJECTION_DEPTH);
assert.deepEqual(JSON.parse(localValues.get('ST_SMS_GROUP_META_LOCAL_FALLBACK')), snapshotResult);
await saveGroupMeta();

window.__pmProfiles = [{ apiUrl: 'https://old.example', apiKey: 'old-key', model: 'old-model' }];
localValues.set('ST_SMS_API_PROFILES', JSON.stringify(window.__pmProfiles));
localStorageControl.failSet.add('ST_SMS_API_PROFILES');
assert.equal(addOrUpdateProfile({ apiUrl: 'https://new.example', apiKey: 'new-key', model: 'new-model' }), false);
assert.deepEqual(window.__pmProfiles, [{ apiUrl: 'https://old.example', apiKey: 'old-key', model: 'old-model' }]);
assert.equal(JSON.parse(localValues.get('ST_SMS_API_PROFILES'))[0].apiUrl, 'https://old.example');

const makeClassList = initial => {
    const values = new Set(initial);
    return {
        contains: value => values.has(value),
        toggle: (value, force) => { if (force) values.add(value); else values.delete(value); return !!force; },
    };
};
const themeChips = ['default', 'dark', 'pink', 'mint', 'frost'].map(preset => {
    const attributes = new Map();
    return {
        dataset: { preset },
        classList: makeClassList(preset === 'default' ? ['pm-theme-active'] : []),
        setAttribute(name, value) { attributes.set(name, String(value)); },
        getAttribute(name) { return attributes.get(name) ?? null; },
    };
});
const createModelDropdownFixture = () => {
    const search = {
        value: '', focused: false, listeners: new Map(),
        addEventListener(type, handler) { this.listeners.set(type, handler); },
        focus() { this.focused = true; },
        dispatchInput(value) { this.value = value; this.listeners.get('input')?.call(this); },
    };
    const options = {
        buttons: [], html: '',
        set innerHTML(value) {
            this.html = String(value);
            this.buttons = [];
            const pattern = /<button\b([^>]*)>([^<]*)<\/button>/g;
            for (const match of this.html.matchAll(pattern)) {
                const attributes = new Map();
                for (const attribute of match[1].matchAll(/([\w-]+)="([^"]*)"/g)) attributes.set(attribute[1], attribute[2]);
                if (!(attributes.get('class') || '').split(/\s+/).includes('pm-model-opt')) continue;
                const listeners = new Map();
                this.buttons.push({
                    dataset: { m: attributes.get('data-m') || '' },
                    textContent: match[2],
                    getAttribute: name => attributes.get(name) ?? null,
                    addEventListener(type, handler) { listeners.set(type, handler); },
                    click() { listeners.get('click')?.(); },
                });
            }
        },
        get innerHTML() { return this.html; },
        querySelectorAll(selector) { return selector === '.pm-model-opt' ? this.buttons : []; },
    };
    return {
        id: '', className: '', dataset: {}, removed: false,
        style: { values: new Map(), setProperty(name, value) { this.values.set(name, String(value)); }, removeProperty(name) { this.values.delete(name); } },
        setAttribute(name, value) {
            if (name === 'data-theme') this.dataset.theme = String(value);
            else if (name === 'data-skin') this.dataset.skin = String(value);
        },
        removeAttribute(name) { if (name === 'data-skin') delete this.dataset.skin; },
        set innerHTML(value) { this.html = String(value); },
        get innerHTML() { return this.html || ''; },
        querySelector(selector) {
            if (selector === '.pm-model-search') return search;
            if (selector === '.pm-model-options') return options;
            return null;
        },
        contains(target) { return target === search || target === options || options.buttons.includes(target); },
        remove() { this.removed = true; uiElements.delete(this.id); },
        search,
        options,
    };
};
const uiAlerts = [];
const uiElements = new Map([
    ['pm-custom-title', { value: '  雨夜电台  ' }],
    ['pm-quick-reply-label', { value: '快捷入口' }],
    ['pm-quick-reply-status', { textContent: '', dataset: {} }],
    ['pm-custom-right', { value: '#123456' }],
    ['pm-custom-left', { value: '#654321' }],
    ['pm-custom-accent', { value: '#c8647d' }],
    ['pm-border-color', { value: '#abcdef' }],
    ['pm-cfg-url', { value: 'https://new.example' }],
    ['pm-cfg-key', { value: 'new-key' }],
    ['pm-cfg-model', { value: 'model-beta', getBoundingClientRect: () => ({ left: 20, bottom: 80, width: 240 }) }],
    ['pm-cfg-temperature', { value: '0.7' }],
    ['pm-api-status', { textContent: '', dataset: {} }],
    ['pm-api-fetch-models', { textContent: '拉取模型', disabled: false, isConnected: true, setAttribute(name, value) { this[name] = String(value); }, removeAttribute(name) { delete this[name]; } }],
    ['pm-api-test-model', { textContent: '测试 API', disabled: false, isConnected: true, setAttribute(name, value) { this[name] = String(value); }, removeAttribute(name) { delete this[name]; } }],
    ['pm-mode-main', { classList: makeClassList(['pm-mode-active']) }],
    ['pm-mode-indep', { classList: makeClassList([]) }],
    ['pm-mode-tip', { textContent: '主 API 使用宿主当前选择的预设与接口' }],
    ['pm-indep-profile-fields', { hidden: true }],
    ['pm-indep-config-fields', { hidden: true }],
    ['pm-overlay', {
        removed: false,
        style: { setProperty() {}, removeProperty() {} },
        setAttribute(name, value) { this[name] = String(value); },
        removeAttribute(name) { delete this[name]; },
        remove() { this.removed = true; },
    }],
]);
globalThis.alert = message => uiAlerts.push(String(message));
const originalFileReader = globalThis.FileReader;
let fileReadCompletion = Promise.resolve();
globalThis.FileReader = class FakeFileReader {
    readAsText(file) {
        fileReadCompletion = Promise.resolve().then(() => this.onload({ target: { result: file.text } }));
    }
};
const documentClickListeners = new Set();
const dispatchDocumentClick = target => { for (const listener of [...documentClickListeners]) listener({ target }); };
const generationCancelButtons = [{ hidden: true, disabled: true }];
let worldBookToggleControls = [];
globalThis.document = {
    getElementById: id => id === 'pm-overlay' && uiElements.get(id)?.removed ? null : uiElements.get(id) || null,
    querySelector: () => null,
    querySelectorAll: selector => {
        if (selector === '.pm-theme-chip') return themeChips;
        if (selector === '.pm-generation-cancel') return generationCancelButtons;
        if (selector === '[data-world-book]') return worldBookToggleControls.filter(control => control.dataset.worldBook);
        if (selector === '[data-world-entry]') return worldBookToggleControls.filter(control => control.dataset.worldEntry);
        if (selector === '[data-world-column]') return worldBookToggleControls.filter(control => control.dataset.worldColumn);
        if (selector === '[data-world-quick-column]') return worldBookToggleControls.filter(control => control.dataset.worldQuickColumn);
        return [];
    },
    createElement: tag => {
        assert.equal(tag, 'div');
        return createModelDropdownFixture();
    },
    body: {
        appendChild(element) {
            uiElements.set(element.id, element);
            return element;
        },
    },
    addEventListener(type, listener, capture) {
        if (type === 'click' && capture === true) documentClickListeners.add(listener);
    },
    removeEventListener(type, listener, capture) {
        if (type === 'click' && capture === true) documentClickListeners.delete(listener);
    },
};
const appliedThemes = [];
const uiNotes = [];
let settingsOverlayHtml = '';
let settingsWorldBookDirectoryHtml = '';
let importCloseCalls = 0;
let importInjectionCalls = 0;
let importInjectionImpl = async () => undefined;
let importClearInjectionCalls = 0;
let importClearInjectionImpl = () => undefined;
let importCancelCommunityCalls = 0;
const importCancelCalendarReasons = [];
let importReloadCalendarCalls = 0;
let forbiddenWorldBookWriteCalls = 0;
const forbiddenWorldBookHostCalls = { getWorldInfoPrompt: 0, saveWorldInfo: 0, updateWorldInfoList: 0, reloadWorldInfoEditor: 0 };
const settingsRuntime = { modelList: ['model-alpha', 'model-beta'] };
let settingsWorldBookNameCalls = 0;
let settingsWorldBookDetailCalls = 0;
const currentSettingsBooks = ['设置书 A', '设置书 B', '设置书 C', '设置书 D'];
const otherSettingsBooks = Array.from({ length: 97 }, (_, index) => `其他设置书 ${String(index + 1).padStart(3, '0')}`);
let worldBookContext = {
    chatMetadata: { world_info: ['设置书 A', '设置书 B'] },
    characters: [{ data: { extensions: { world: ['设置书 C', '设置书 A'] } } }], characterId: 0,
    getCharWorldbookNames() { return { primary: '设置书 C', additional: ['设置书 D', '设置书 A'] }; },
    getWorldInfoNames() { settingsWorldBookNameCalls += 1; return [...currentSettingsBooks, ...otherSettingsBooks, '设置书 A']; },
    getWorldInfoPrompt() { forbiddenWorldBookHostCalls.getWorldInfoPrompt += 1; },
    saveWorldInfo() { forbiddenWorldBookWriteCalls += 1; forbiddenWorldBookHostCalls.saveWorldInfo += 1; },
    updateWorldInfoList() { forbiddenWorldBookHostCalls.updateWorldInfoList += 1; },
    reloadWorldInfoEditor() { forbiddenWorldBookHostCalls.reloadWorldInfoEditor += 1; },
    async loadWorldInfo() { settingsWorldBookDetailCalls += 1; return { entries: {
        1: { uid: 1, content: '设置页正文', comment: '设置页条目标题' },
        2: { uid: 2, content: '数据库条目 1', comment: 'TavernDB-ACU-ReadableDataTable' },
        3: { uid: 3, content: '数据库条目 2', comment: 'TavernDB-ACU-CustomExport-纪要-1' },
        4: { uid: 4, content: '数据库条目 3', comment: 'TavernDB-ACU-CustomExport-纪要-2' },
        5: { uid: 5, content: '数据库条目 4', comment: 'TavernDB-ACU-CustomExport-纪要-3' },
        6: { uid: 6, content: '数据库条目 5', comment: 'TavernDB-ACU-CustomExport-纪要-4' },
        7: { uid: 7, content: '数据库条目 6', comment: 'TavernDB-ACU-CustomExport-重要角色表-1' },
        8: { uid: 8, content: '数据库条目 7', comment: 'TavernDB-ACU-CustomExport-重要角色表-2' },
        9: { uid: 9, content: '数据库条目 8', comment: 'TavernDB-ACU-CustomExport-重要角色表-3' },
        10: { uid: 10, content: '数据库条目 9', comment: 'TavernDB-ACU-CustomExport-重要角色表-4' },
        11: { uid: 11, content: '数据库条目 10', comment: 'TavernDB-ACU-CustomExport-重要角色表-5' },
        12: { uid: 12, content: '数据库包裹上', comment: 'TavernDB-ACU-CustomExport-纪要-包裹-上' },
        13: { uid: 13, content: '数据库包裹下', comment: 'TavernDB-ACU-CustomExport-纪要-包裹-下' },
        14: { uid: 14, content: '包装起点', comment: 'TavernDB-ACU-WrapperStart' },
    } }; },
};
window.__pmTheme = { preset: 'default', layout: 'standard', ambientStatusEnabled: false };
const closeSettingsOverlay = (reason = 'close') => {
    const overlay = uiElements.get('pm-overlay');
    if (!overlay || overlay.removed) return false;
    overlay.remove();
    overlay.__pmOnClose?.(reason);
    return true;
};
let settingsMakeOverlay;
installSettingsUi({
    makeOverlay: settingsMakeOverlay = (html, options = {}) => {
        closeSettingsOverlay('replace');
        settingsOverlayHtml = html;
        settingsWorldBookDirectoryHtml = '';
        const overlay = {
            id: 'pm-overlay',
            removed: false,
            style: { setProperty() {}, removeProperty() {} },
            setAttribute(name, value) { this[name] = String(value); },
            removeAttribute(name) { delete this[name]; },
            remove() { this.removed = true; },
            querySelector(selector) {
                if (selector === '[data-world-book-directory]') return {
                    set innerHTML(value) {
                        settingsWorldBookDirectoryHtml = String(value);
                        settingsOverlayHtml = `${settingsOverlayHtml}\n${settingsWorldBookDirectoryHtml}`;
                    },
                };
                if (selector === '.pm-worldbook-search input') return {
                    value: '', focus() {}, setSelectionRange() {},
                };
                return null;
            },
        };
        overlay.__pmOnClose = options.onClose || null;
        uiElements.set('pm-overlay', overlay);
        return overlay;
    }, applyTheme: () => appliedThemes.push(structuredClone(window.__pmTheme)), applyBackground: () => {},
    fitNameFont: () => {}, addNote: note => uiNotes.push(note), getCurrentPersona: () => 'default', getStorageId: () => 'story',
    runtime: settingsRuntime,
    closePhone: () => { importCloseCalls += 1; },
    applyBidirectionalInjection: async () => {
        importInjectionCalls += 1;
        return importInjectionImpl();
    },
    clearBidirectionalInjection: () => {
        importClearInjectionCalls += 1;
        return importClearInjectionImpl();
    },
    cancelCommunityGeneration: () => { importCancelCommunityCalls += 1; },
    cancelCalendarTasks: reason => { importCancelCalendarReasons.push(reason); },
    reloadCalendarStore: () => { importReloadCalendarCalls += 1; },
    getInteractiveStore: async () => ({ scopes: {} }),
    getCtx: () => worldBookContext,
});
await window.__pmShowConfig('worldbook');
assert.match(settingsOverlayHtml, /世界书读取|当前聊天世界书|其他世界书/,
    '设置首页必须展示当前聊天世界书与其他世界书收纳区');
assert.deepEqual(currentSettingsBooks.filter(name => settingsOverlayHtml.includes(name)), currentSettingsBooks,
    '当前聊天栏必须精确展示角色主世界书与附加世界书合并后的结果');
assert.match(settingsOverlayHtml, /设置书 D<\/b><small>附加<\/small>/,
    '附加世界书必须在当前聊天栏标记为附加来源');
assert.match(settingsOverlayHtml, /class="pm-worldbook-column-toggle" aria-expanded="false" aria-controls="pm-worldbook-other-panel"/,
    '其他世界书手风琴必须默认收起并声明受控面板');
assert.match(settingsOverlayHtml, /id="pm-worldbook-other-panel" class="pm-worldbook-other-panel" hidden/,
    '默认收起时其他世界书面板必须使用 hidden 隐藏');
assert.doesNotMatch(settingsOverlayHtml, /搜索名称|其他设置书 001|pm-worldbook-load-more/,
    '默认收起时不得渲染其他世界书列表、搜索框或加载更多按钮');
assert.equal(window.__pmLoadMoreWorldBooks(), false, '其他世界书收起时加载更多不得修改分页状态');
assert.equal(window.__pmSearchWorldBooks('其他设置书'), false, '其他世界书收起时搜索不得修改筛选状态');
assert.equal(window.__pmToggleOtherWorldBooks(), true, '其他世界书手风琴必须可展开');
assert.match(settingsWorldBookDirectoryHtml, /class="pm-worldbook-column-toggle" aria-expanded="true"[\s\S]*搜索名称/,
    '展开后必须更新 aria-expanded 并渲染搜索入口');
assert.match(settingsOverlayHtml, /data-world-book-name="其他设置书 001"[\s\S]*?aria-pressed="false" aria-label="其他设置书 001读取开关"/,
    '未保存过配置的其他世界书读取开关必须默认关闭');
assert.equal(otherSettingsBooks.filter(name => settingsOverlayHtml.includes(name)).length, 30,
    '其他世界书展开后只能渲染首批 30 行');
assert.doesNotMatch(settingsOverlayHtml, /其他设置书 031/, '首批不得提前渲染第 31 本其他书');
assert.match(settingsOverlayHtml, /当前聊天世界书<\/b><small>4 本|其他世界书<\/b><small>97 本/,
    '两组计数必须精确反映四本当前书与九十七本差集');
assert.doesNotMatch(settingsOverlayHtml, /设置页条目标题|数据库栏目|原生条目/,
    '设置首页初次渲染不得预加载条目或栏目');
assert.equal(settingsWorldBookNameCalls, 1, '设置首页初次渲染只能读取一次目录名称');
assert.equal(settingsWorldBookDetailCalls, 0, '设置首页初次渲染不得加载任何世界书内容');
for (const expected of [60, 90, 97]) {
    assert.equal(window.__pmLoadMoreWorldBooks(), true, '加载更多必须可在伪 DOM 中重绘目录');
    assert.equal(otherSettingsBooks.filter(name => settingsWorldBookDirectoryHtml.includes(name)).length, expected,
        `其他世界书加载批次必须精确增长到 ${expected} 行`);
}
assert.equal(window.__pmSearchWorldBooks('其他设置书'), true, '其他世界书搜索必须可在伪 DOM 中重绘目录');
assert.equal(otherSettingsBooks.filter(name => settingsWorldBookDirectoryHtml.includes(name)).length, 30,
    '搜索必须重置到匹配结果的首批 30 行，不能保留此前分页上限');
assert.doesNotMatch(settingsWorldBookDirectoryHtml, /其他设置书 031/, '搜索重置后的当前重绘片段不得混入旧批次 HTML');
assert.equal(settingsWorldBookDetailCalls, 0, '搜索只过滤其他书名，不得触发当前或其他书的详情加载');
await window.__pmShowWorldBookColumns({ title: '数据来源', module: 'calendar' });
assert.deepEqual([...settingsOverlayHtml.matchAll(/data-world-quick-column="([^"]+)"/g)].map(match => match[1]),
    ['ReadableDataTable', '纪要', '重要角色表', 'WrapperStart'],
    '数据库来源快捷页必须将 CustomExport 按第四段合并为系列，将其他 ACU 格式按第三段显示');
assert.equal((settingsOverlayHtml.match(/data-world-quick-column="纪要"/g) || []).length, 1,
    '同一 CustomExport 系列只能显示一个栏目开关，一处设置必须影响整个系列');
assert.doesNotMatch(settingsOverlayHtml, /TavernDB-ACU-|包裹-(?:上|下)/,
    '数据库来源快捷页不得显示完整协议标题或包裹上下条目');
assert.equal((settingsOverlayHtml.match(/pm-worldbook-eye is-checked/g) || []).length, 4,
    '未配置的数据库系列必须默认全部启用');
await window.__pmShowConfig('worldbook');
assert.equal(settingsWorldBookDetailCalls, 4, '快捷栏目应串行读取四本当前聊天世界书（含附加书），设置页目录不得追加详情请求');
assert.equal(await window.__pmToggleWorldBookDetails('设置书 A'), true, '显式展开世界书后必须加载单本详情');
assert.equal(settingsWorldBookDetailCalls, 5, '显式展开只能新增一次单本详情请求');
assert.match(settingsWorldBookDirectoryHtml, /data-world-book-name="设置书 A"[\s\S]*?aria-expanded="true" aria-controls="pm-worldbook-detail-%E8%AE%BE%E7%BD%AE%E4%B9%A6%20A"/,
    '详情按钮展开后必须通过 aria-controls 精确关联详情面板');
assert.match(settingsWorldBookDirectoryHtml, /id="pm-worldbook-detail-%E8%AE%BE%E7%BD%AE%E4%B9%A6%20A" class="pm-worldbook-book-detail"/,
    '已加载详情必须保留与触发按钮一致的受控面板 ID');
assert.match(settingsOverlayHtml, /<path d="M4 5\.5 12 3l8 2\.5v13L12 16l-8 2\.5z"/,
    '原生世界书条目标题必须使用书本图标');
assert.doesNotMatch(settingsOverlayHtml, /设置页正文/,
    '设置页不得将世界书正文误作条目标题展示');
assert.match(settingsOverlayHtml, /读取正文楼层数|世界书扫描深度|发送世界书字符数上限/,
    '世界书设置页必须展示正文、扫描与字符数配置项');
assert.doesNotMatch(settingsOverlayHtml, /主线正文用于提示词参考；扫描窗口仅决定哪些世界书条目会被触发。/,
    '世界书设置页不得保留已删除的顶部说明');
assert.match(settingsOverlayHtml, /aria-label="设置书 A 条目读取开关"|aria-label="纪要：会话读取开关"/,
    '世界书条目与栏目矩阵必须提供带 SVG 图标的可访问读取开关');
assert.match(settingsOverlayHtml, /pm-worldbook-matrix-header[\s\S]*会话[\s\S]*日历[\s\S]*社区/,
    '世界书栏目矩阵必须只在表头展示中文模块标签');
assert.match(settingsOverlayHtml, /pm-worldbook-eye is-checked/, '世界书读取状态必须使用绿色眼睛而非滑动开关');
assert.doesNotMatch(settingsOverlayHtml, />\s*(?:chat|calendar|community)\s*</, '世界书栏目矩阵不得向用户暴露内部模块键');
assert.equal((settingsOverlayHtml.match(/TavernDB 条目/g) || []).length, 0,
    'TavernDB 条目不得在原生条目区重复渲染');

const worldBookEntryKey = createWorldBookEntryKey('设置书 A', 1);
uiElements.set('pm-world-main-messages', { value: '9' });
uiElements.set('pm-world-scan-messages', { value: '11' });
uiElements.set('pm-world-max-chars', { value: '26000' });
worldBookToggleControls = [
    { dataset: { worldBook: '设置书 A' }, classList: makeClassList([]) },
    { dataset: { worldEntry: worldBookEntryKey }, classList: makeClassList([]) },
    { dataset: { worldColumn: '纪要', worldModule: 'calendar' }, classList: makeClassList([]) },
];
assert.equal(window.__pmSetWorldBookEnabled(worldBookToggleControls[0]), true, '世界书总开关必须先写入页面状态');
assert.equal(window.__pmSetWorldBookEntry(worldBookToggleControls[1]), true, '条目开关必须先写入页面状态');
assert.equal(window.__pmSetWorldBookColumn(worldBookToggleControls[2]), true, '栏目开关必须先写入页面状态');
const savedWorldBookOverlay = uiElements.get('pm-overlay');
assert.equal(window.__pmSaveWorldBookConfig(), true, '世界书设置保存必须报告成功');
const savedWorldBookConfig = JSON.parse(localValues.get('ST_SMS_WORLD_BOOK_CONFIG_V1'));
assert.equal(savedWorldBookConfig.mainChatMessages, 9, '保存必须写入主线正文条数');
assert.equal(savedWorldBookConfig.scanMessages, 11, '保存必须写入扫描条数');
assert.equal(savedWorldBookConfig.maxChars, 26000, '保存必须写入字符预算');
assert.equal(savedWorldBookConfig.books['设置书 A'], false, '保存必须写入世界书总开关');
assert.equal(savedWorldBookConfig.entries[worldBookEntryKey], false, '保存必须写入原生条目开关');
assert.equal(savedWorldBookConfig.columns.纪要.calendar, false, '保存必须写入栏目模块开关');
assert.deepEqual(window.__pmWorldBookConfig, savedWorldBookConfig, '保存成功后内存配置必须与持久化配置一致');
assert.equal(savedWorldBookOverlay.removed, true, '保存成功必须关闭设置 overlay');
assert.equal(document.getElementById('pm-overlay'), null, '保存成功后 overlay 必须从 DOM 查询中消失');
assert.equal(uiNotes.at(-1), '世界书读取设置已保存', '保存成功必须给出确认提示');

await window.__pmShowWorldBookColumns({ title: '小明的记忆来源', module: 'chat', scope: { kind: 'character', id: '小明' },
    backAction: "window.__pmShowCharacterBehavior('小明',false)", backLabel: '返回角色设置' });
assert.match(settingsOverlayHtml, /小明的记忆来源|恢复跟随全局/, '角色快捷入口必须使用精简标题并复用统一栏目选择面板');
assert.match(settingsOverlayHtml, /__pmShowCharacterBehavior\(&#39;小明&#39;,false\)|返回角色设置/,
    '角色快捷入口返回键必须回到角色设置');
assert.doesNotMatch(settingsOverlayHtml, /TavernDB 栏目/, '快捷栏目面板不得重复显示栏目类型灰字');
worldBookToggleControls = [{ dataset: { worldQuickColumn: '纪要' }, classList: makeClassList(['is-checked']) }];
assert.equal(window.__pmSaveWorldBookColumns(), true, '角色快捷栏目保存必须报告成功');
assert.equal(window.__pmWorldBookConfig.characters.小明.columns.纪要.chat, true,
    '角色快捷入口必须写入同一份角色栏目 override');
await window.__pmShowWorldBookColumns({ title: '群聊可读的数据库记忆', module: 'chat', scope: { kind: 'group', id: 'group-a' } });
worldBookToggleControls = [{ dataset: { worldQuickColumn: '纪要' }, classList: makeClassList([]) }];
assert.equal(window.__pmSaveWorldBookColumns(), true, '群聊快捷栏目保存必须报告成功');
assert.equal(window.__pmWorldBookConfig.groups['group-a'].columns.纪要.chat, false,
    '群聊快捷入口必须写入群聊自身栏目 override');
assert.equal(window.__pmSetGroupMemberPrivateMemory('group-a', true), true, '成员私人记忆开关必须可持久化');
assert.equal(window.__pmWorldBookConfig.groups['group-a'].allowMemberPrivateMemory, true,
    '成员私人记忆开关必须与群聊 override 共用同一配置模型');
const previousWorldBookConfirm = globalThis.confirm;
const previousWorldBookEditGroup = window.__pmEditGroup;
let worldBookConfirmCalls = 0;
let worldBookEditGroupCalls = 0;
globalThis.confirm = () => { worldBookConfirmCalls += 1; return false; };
window.__pmEditGroup = () => { worldBookEditGroupCalls += 1; };
assert.equal(window.__pmToggleGroupMemberPrivateMemory('group-a'), true,
    '关闭成员私人记忆无需重复确认且必须可保存');
assert.equal(worldBookConfirmCalls, 0, '关闭成员私人记忆不得弹出开启风险确认');
assert.equal(worldBookEditGroupCalls, 1, '成功关闭成员私人记忆后必须刷新群聊编辑面板');
globalThis.confirm = () => { worldBookConfirmCalls += 1; return false; };
assert.equal(window.__pmToggleGroupMemberPrivateMemory('group-a'), false,
    '取消开启成员私人记忆不得写入配置');
assert.equal(worldBookConfirmCalls, 1, '开启成员私人记必须请求风险确认');
assert.equal(worldBookEditGroupCalls, 1, '取消开启成员私人记忆不得刷新群聊编辑面板');
globalThis.confirm = () => true;
assert.equal(window.__pmToggleGroupMemberPrivateMemory('group-a'), true,
    '确认开启成员私人记忆必须成功保存');
assert.equal(worldBookEditGroupCalls, 2, '成功开启成员私人记忆后必须刷新群聊编辑面板');
if (previousWorldBookConfirm === undefined) delete globalThis.confirm;
else globalThis.confirm = previousWorldBookConfirm;
if (previousWorldBookEditGroup === undefined) delete window.__pmEditGroup;
else window.__pmEditGroup = previousWorldBookEditGroup;


const configBeforeFailedWorldBookSave = structuredClone(window.__pmWorldBookConfig);
await window.__pmShowConfig('worldbook');
localStorageControl.failSet.add('ST_SMS_WORLD_BOOK_CONFIG_V1');
assert.equal(window.__pmSaveWorldBookConfig(), false, '世界书设置保存失败必须显式返回 false');
assert.deepEqual(window.__pmWorldBookConfig, configBeforeFailedWorldBookSave, '世界书设置保存失败不得污染内存配置');
assert.equal(uiElements.get('pm-overlay').removed, false, '世界书设置保存失败不得关闭 overlay');
assert.match(uiAlerts.at(-1), /世界书设置保存失败/, '世界书设置保存失败必须提示用户');

const renderCountBeforeWorldBookReset = localStorageWrites.length;
assert.equal(await window.__pmResetWorldBookConfig(), true, '世界书设置重置必须报告成功');
assert.deepEqual(window.__pmWorldBookConfig, normalizeWorldBookConfig(null), '世界书设置重置必须恢复默认内存配置');
assert.ok(localStorageWrites.length > renderCountBeforeWorldBookReset, '世界书设置重置必须持久化默认配置');
const configBeforeFailedWorldBookReset = structuredClone(window.__pmWorldBookConfig);
await window.__pmShowConfig('worldbook');
localStorageControl.failSet.add('ST_SMS_WORLD_BOOK_CONFIG_V1');
assert.equal(await window.__pmResetWorldBookConfig(), false, '世界书设置重置失败必须显式返回 false');
assert.deepEqual(window.__pmWorldBookConfig, configBeforeFailedWorldBookReset, '世界书设置重置失败不得污染内存配置');
assert.equal(uiElements.get('pm-overlay').removed, false, '世界书设置重置失败不得关闭 overlay');
assert.match(uiAlerts.at(-1), /世界书设置重置失败/, '世界书设置重置失败必须提示用户');

const maliciousWorldBookName = '<img src=x onerror=alert(1)>';
const maliciousColumn = '纪要&<>"';
worldBookContext = {
    chatMetadata: { world_info: [maliciousWorldBookName] },
    getWorldInfoNames() { return [maliciousWorldBookName]; },
    getWorldInfoPrompt() { forbiddenWorldBookHostCalls.getWorldInfoPrompt += 1; },
    saveWorldInfo() { forbiddenWorldBookWriteCalls += 1; forbiddenWorldBookHostCalls.saveWorldInfo += 1; },
    updateWorldInfoList() { forbiddenWorldBookHostCalls.updateWorldInfoList += 1; },
    reloadWorldInfoEditor() { forbiddenWorldBookHostCalls.reloadWorldInfoEditor += 1; },
    async loadWorldInfo() { return { entries: {
        '<bad&"': { uid: '<bad&"', content: '<img src=x onerror=alert(1)>' },
        2: { uid: 2, content: '栏目条目', comment: `TavernDB-ACU-CustomExport-${maliciousColumn}` },
    } }; },
};
await window.__pmShowConfig('worldbook');
assert.equal(await window.__pmToggleWorldBookDetails(maliciousWorldBookName), true, '安全转义测试必须显式加载恶意名称书的详情');
assert.doesNotMatch(settingsOverlayHtml, /<img src=x onerror=alert\(1\)>/, '世界书设置页必须转义宿主返回的 HTML');
assert.match(settingsOverlayHtml, /&lt;img src=x onerror=alert\(1\)&gt;/, '世界书设置页必须保留转义后的条目文本');
assert.match(settingsOverlayHtml, /data-world-column="纪要&amp;&lt;&gt;&quot;"/, '世界书栏目属性必须转义特殊字符');
assert.equal(forbiddenWorldBookWriteCalls, 0, '世界书设置页不得调用宿主 saveWorldInfo');
assert.deepEqual(forbiddenWorldBookHostCalls, { getWorldInfoPrompt: 0, saveWorldInfo: 0, updateWorldInfoList: 0, reloadWorldInfoEditor: 0 }, '世界书设置页不得调用宿主聚合或写入 API');

let resolveSlowWorldBookDirectory;
worldBookContext = {
    getWorldInfoNames() { return new Promise(resolve => { resolveSlowWorldBookDirectory = resolve; }); },
    async loadWorldInfo() { throw new Error('目录阶段不得读取详情'); },
};
const slowWorldBookPage = window.__pmShowConfig('worldbook');
await Promise.resolve();
await window.__pmShowConfig('look');
const lookOverlayHtml = settingsOverlayHtml;
resolveSlowWorldBookDirectory(['旧世界书页面不得覆盖主题页']);
await slowWorldBookPage;
assert.equal(settingsOverlayHtml, lookOverlayHtml, '世界书目录延迟返回后不得覆盖用户已切换到的设置页');
let resolveClosedWorldBookDirectory;
worldBookContext = {
    getWorldInfoNames() { return new Promise(resolve => { resolveClosedWorldBookDirectory = resolve; }); },
    async loadWorldInfo() { throw new Error('目录阶段不得读取详情'); },
};
const overlayBeforeClosedWorldBook = settingsOverlayHtml;
const closedWorldBookPage = window.__pmShowConfig('worldbook');
await Promise.resolve();
assert.equal(closeSettingsOverlay('close'), true, '关闭竞态测试必须走真实 overlay 关闭路径');
resolveClosedWorldBookDirectory(['已关闭页面不得重新出现']);
await closedWorldBookPage;
assert.equal(settingsOverlayHtml, overlayBeforeClosedWorldBook, '关闭世界书设置页后，迟到目录结果不得重新打开 overlay');
const nativeAbortController = globalThis.AbortController;
const trackedControllers = [];
globalThis.AbortController = class {
    constructor() { this.signal = { aborted: false }; trackedControllers.push(this); }
    abort() { this.signal.aborted = true; }
};
worldBookContext = {
    getWorldInfoNames() { return ['替换测试书']; },
    async loadWorldInfo() { throw new Error('目录阶段不得读取详情'); },
};
assert.equal(await window.__pmShowConfig('worldbook'), undefined, '世界书页面应完成自身 overlay 替换');
assert.equal(trackedControllers.length, 1, '世界书页面渲染必须只创建一个请求控制器');
assert.equal(trackedControllers[0].signal.aborted, false, '世界书页面自身替换旧 overlay 不得取消当前请求');
let resolveExternallyReplacedWorldBookDirectory;
worldBookContext = {
    getWorldInfoNames() { return new Promise(resolve => { resolveExternallyReplacedWorldBookDirectory = resolve; }); },
    async loadWorldInfo() { throw new Error('目录阶段不得读取详情'); },
};
const externallyReplacedWorldBookPage = window.__pmShowConfig('worldbook');
await Promise.resolve();
settingsMakeOverlay('<div>外部页面</div>');
assert.equal(trackedControllers.length, 2, '外部替换测试必须创建独立请求控制器');
assert.equal(trackedControllers[1].signal.aborted, true, '外部 overlay 替换必须取消等待中的世界书目录请求');
resolveExternallyReplacedWorldBookDirectory(['外部替换后不得提交']);
await externallyReplacedWorldBookPage;
assert.equal(settingsOverlayHtml, '<div>外部页面</div>', '外部 overlay 替换后迟到世界书结果不得覆盖当前页面');
globalThis.AbortController = nativeAbortController;
worldBookToggleControls = [];

const makeDeferredWorldBook = () => {
    let resolve, reject;
    const promise = new Promise((resolvePromise, rejectPromise) => { resolve = resolvePromise; reject = rejectPromise; });
    return { promise, resolve, reject };
};
const delayedDetails = new Map();
const delayedStarts = new Map();
const delayedLoadCalls = [];
let activeWorldBookLoads = 0, maxActiveWorldBookLoads = 0;
for (const name of ['A', 'B', 'C']) {
    delayedDetails.set(name, makeDeferredWorldBook());
    delayedStarts.set(name, makeDeferredWorldBook());
}
worldBookContext = {
    chatMetadata: { world_info: ['A', 'B', 'C'] },
    getWorldInfoNames() { return ['A', 'B', 'C']; },
    async loadWorldInfo(name) {
        delayedLoadCalls.push(name);
        activeWorldBookLoads += 1;
        maxActiveWorldBookLoads = Math.max(maxActiveWorldBookLoads, activeWorldBookLoads);
        delayedStarts.get(name)?.resolve();
        try { return await delayedDetails.get(name).promise; }
        finally { activeWorldBookLoads -= 1; }
    },
};
await window.__pmShowConfig('worldbook');
const expandA = window.__pmToggleWorldBookDetails('A');
await delayedStarts.get('A').promise;
const expandB = window.__pmToggleWorldBookDetails('B');
const expandC = window.__pmToggleWorldBookDetails('C');
assert.deepEqual(delayedLoadCalls, ['A'], '串行详情队列中旧请求未释放前不得启动后续请求');
delayedDetails.get('A').resolve({ entries: { 1: { uid: 1, content: 'A 正文', comment: 'A 旧结果' } } });
await expandA;
await Promise.resolve();
assert.equal(delayedLoadCalls.filter(name => name === 'B').length, 0, '已被更新意图淘汰的 B 不得进入宿主详情读取');
await delayedStarts.get('C').promise;
assert.deepEqual(delayedLoadCalls, ['A', 'C'], '旧请求释放后只能启动最后一次展开意图 C');
delayedDetails.get('C').resolve({ entries: { 1: { uid: 1, content: 'C 正文', comment: 'C 最终结果' } } });
assert.equal(await expandB, false, '被最后意图替代的中间展开必须报告未提交');
assert.equal(await expandC, true, '最后一次展开意图必须成功提交');
assert.equal(maxActiveWorldBookLoads, 1, '世界书详情宿主读取最大并发必须为 1');
assert.match(settingsWorldBookDirectoryHtml, /C 最终结果/, '最终页面只能提交最后一次展开意图');
assert.doesNotMatch(settingsWorldBookDirectoryHtml, /A 旧结果|B 旧结果/, '迟到旧详情不得回填当前页面');

const collapseDetail = makeDeferredWorldBook(), collapseStarted = makeDeferredWorldBook();
worldBookContext.loadWorldInfo = async name => {
    collapseStarted.resolve();
    return collapseDetail.promise;
};
const pendingCollapse = window.__pmToggleWorldBookDetails('A');
await collapseStarted.promise;
assert.equal(await window.__pmToggleWorldBookDetails('A'), true, '再次点击加载中的同一本书必须折叠并取消提交');
collapseDetail.resolve({ entries: { 1: { uid: 1, content: '折叠后旧正文', comment: '折叠后旧结果' } } });
assert.equal(await pendingCollapse, false);
assert.doesNotMatch(settingsWorldBookDirectoryHtml, /读取失败|折叠后旧结果/, '折叠取消不得显示普通错误或回填旧结果');

const closeDetail = makeDeferredWorldBook(), closeStarted = makeDeferredWorldBook();
worldBookContext.loadWorldInfo = async () => { closeStarted.resolve(); return closeDetail.promise; };
const pendingCloseDetail = window.__pmToggleWorldBookDetails('B');
await closeStarted.promise;
assert.equal(closeSettingsOverlay('close'), true, '详情关闭取消必须走真实 overlay 关闭入口');
closeDetail.resolve({ entries: { 1: { uid: 1, content: '关闭后旧正文', comment: '关闭后旧结果' } } });
assert.equal(await pendingCloseDetail, false);
assert.doesNotMatch(settingsOverlayHtml, /读取失败|关闭后旧结果/, '关闭页面取消详情后不得显示普通错误或重新提交');

const hostDetailAbort = new Error('宿主主动取消详情');
hostDetailAbort.name = 'AbortError';
worldBookContext = {
    chatMetadata: { world_info: ['Abort 书'] },
    getWorldInfoNames() { return ['Abort 书']; },
    async loadWorldInfo() { throw hostDetailAbort; },
};
await window.__pmShowConfig('worldbook');
assert.equal(await window.__pmToggleWorldBookDetails('Abort 书'), false, '宿主 AbortError 必须作为取消返回');
assert.doesNotMatch(settingsWorldBookDirectoryHtml, /读取失败|重试/, '宿主主动抛 AbortError 不得渲染普通读取错误');

const parentCollapseDetail = makeDeferredWorldBook(), parentCollapseStarted = makeDeferredWorldBook();
worldBookContext = {
    chatMetadata: { world_info: [] },
    getWorldInfoNames() { return ['其他父折叠书']; },
    async loadWorldInfo() { parentCollapseStarted.resolve(); return parentCollapseDetail.promise; },
};
await window.__pmShowConfig('worldbook');
assert.equal(window.__pmToggleOtherWorldBooks(), true);
const pendingParentCollapse = window.__pmToggleWorldBookDetails('其他父折叠书');
await parentCollapseStarted.promise;
assert.match(settingsWorldBookDirectoryHtml, /data-world-book-name="其他父折叠书"[\s\S]*?aria-expanded="true" aria-controls="pm-worldbook-detail-%E5%85%B6%E4%BB%96%E7%88%B6%E6%8A%98%E5%8F%A0%E4%B9%A6"/,
    '其他世界书加载中详情按钮必须声明展开状态并关联详情 ID');
assert.match(settingsWorldBookDirectoryHtml, /id="pm-worldbook-detail-%E5%85%B6%E4%BB%96%E7%88%B6%E6%8A%98%E5%8F%A0%E4%B9%A6" class="pm-worldbook-detail-status" role="status"/,
    '加载中详情必须使用与触发按钮一致的受控面板 ID');
assert.equal(window.__pmToggleOtherWorldBooks(), true, '折叠其他世界书父级必须取消其加载中详情');
assert.doesNotMatch(settingsWorldBookDirectoryHtml, /pm-worldbook-detail-%E5%85%B6%E4%BB%96%E7%88%B6%E6%8A%98%E5%8F%A0%E4%B9%A6/,
    '折叠父级后必须立即移除其他世界书详情 DOM');
parentCollapseDetail.resolve({ entries: { 1: { uid: 1, content: '父级折叠后正文', comment: '父级折叠后旧结果' } } });
assert.equal(await pendingParentCollapse, false, '父级折叠取消的详情请求不得提交');
assert.doesNotMatch(settingsWorldBookDirectoryHtml, /父级折叠后旧结果/,
    '父级折叠后的迟到详情不得重新出现');
assert.equal(window.__pmToggleOtherWorldBooks(), true);
assert.doesNotMatch(settingsWorldBookDirectoryHtml, /id="pm-worldbook-detail-%E5%85%B6%E4%BB%96%E7%88%B6%E6%8A%98%E5%8F%A0%E4%B9%A6"|父级折叠后旧结果/,
    '重新展开其他世界书时不得恢复已清理的旧详情状态');

worldBookContext = {
    chatMetadata: { world_info: ['错误详情书'] },
    getWorldInfoNames() { return ['错误详情书']; },
    async loadWorldInfo() { throw new Error('详情读取失败'); },
    extensionSettings: { regex: [] },
    saveSettingsDebounced() {},
};
await window.__pmShowConfig('worldbook');
assert.equal(await window.__pmToggleWorldBookDetails('错误详情书'), false);
assert.match(settingsWorldBookDirectoryHtml, /aria-expanded="true" aria-controls="pm-worldbook-detail-%E9%94%99%E8%AF%AF%E8%AF%A6%E6%83%85%E4%B9%A6"[\s\S]*?id="pm-worldbook-detail-%E9%94%99%E8%AF%AF%E8%AF%A6%E6%83%85%E4%B9%A6" class="pm-worldbook-detail-status is-error" role="alert"/,
    '错误详情必须保留按钮与告警面板之间的精确 ARIA 关联');

window.__pmTheme = { preset: 'default', customRight: '', customLeft: '', borderColor: '#1a1a1a', darkMode: 'dark', customTitle: '', qrLabel: '天音' };
await window.__pmShowConfig('look');
assert.deepEqual(Object.keys(THEME_PRESETS), ['default', 'dark', 'pink', 'mint', 'frost'],
    '颜色预设必须保留蓝、紫、粉、薄荷、磨砂');
assert.equal(THEME_PRESETS.pink.right, '#E7A9B9', '粉色日间必须使用沉稳粉色右气泡');
assert.equal(THEME_PRESETS.pink.rightDark, '#FFC4D4', '粉色夜间必须保留原柔粉右气泡');
assert.equal(THEME_PRESETS.mint.right, '#9FBE8C', '薄荷日间必须使用暖鼠尾草绿色');
assert.equal(THEME_PRESETS.mint.left, '#F3EBDD', '薄荷日间必须搭配米色左气泡');
assert.equal(THEME_PRESETS.frost.frost, true, '磨砂预设必须启用玻璃效果标记');
assert.deepEqual(Object.fromEntries(Object.entries(THEME_PRESETS).map(([name, preset]) => [name, preset.auxiliary])), {
    default: '#B85C19', dark: '#A85A00', pink: '#287C78',
    mint: '#7C476D', frost: '#A94F3D',
}, '每个主题必须提供与强调色角色不同的稳定辅助色');
for (const preset of Object.values(THEME_PRESETS)) assert.notEqual(preset.auxiliary.toLowerCase(), preset.accent.toLowerCase(),
    '主题辅助色不得与强调色相同');
assert.match(settingsOverlayHtml, /data-preset="default" style="--pm-theme-chip-color:#1677d2"/,
    '默认主题选择边缘必须绑定默认蓝，不得继承当前容器的辅助色');
const modalSettingsCss = readFileSync(new URL('../styles/modal-settings.css', import.meta.url), 'utf8');
const activeThemeRule = modalSettingsCss.match(/\.pm-theme-active\{[^}]+\}/)?.[0] || '';
assert.match(activeThemeRule, /border-color:var\(--pm-theme-chip-color\)/,
    '主题选中边缘必须读取按钮自身主题色');
assert.match(activeThemeRule, /outline:2px solid color-mix\(in srgb,var\(--pm-theme-chip-color\) 14%,transparent\)/,
    '主题选中外圈必须读取按钮自身主题色');
assert.doesNotMatch(activeThemeRule, /--pm-color-auxiliary/, '主题选中边缘不得再继承当前容器辅助色');
assert.match(settingsOverlayHtml, /data-preset="mint"[^>]*><span class="pm-theme-dot" style="background:#9FBE8C" aria-hidden="true"/);
assert.doesNotMatch(settingsOverlayHtml, /pm-theme-dot[^>]*><\/span>[^<]+<\/button>/,
    '颜色预设按钮只能显示色点，不得出现可见标签正文');
assert.doesNotMatch(settingsOverlayHtml, /<div class="pm-theme-chip/);
const modeBeforeInvalidProfile = uiElements.get('pm-mode-main').classList.contains('pm-mode-active');
window.__pmPickProfile(99);
assert.equal(uiElements.get('pm-mode-main').classList.contains('pm-mode-active'), modeBeforeInvalidProfile, '无效档案索引不得改变 API 模式');
assert.equal(uiElements.get('pm-cfg-url').value, 'https://new.example', '无效档案索引不得改变表单');

const importInput = {
    files: [{ text: JSON.stringify({
        schemaVersion: 5,
        calendarCycles: {
            version: 1,
            scopes: { story: { enabled: true, lastPeriodStart: null, cycleLength: 28, periodLength: 5, overrides: {} } },
        },
    }) }],
    value: 'calendar-invalid.json',
};
const importWritesBefore = localStorageWrites.length;
const importGlobalsBefore = {
    histories: structuredClone(window.__pmHistories),
    theme: structuredClone(window.__pmTheme),
    config: structuredClone(window.__pmConfig),
};
const importAlertsBefore = uiAlerts.length;
window.__pmImportData(importInput);
await fileReadCompletion;
assert.equal(importInput.value, '');
assert.equal(importCancelCommunityCalls, 0, 'prepare 失败不得取消社区任务');
assert.deepEqual(importCancelCalendarReasons, [], 'prepare 失败不得取消日历或菜谱任务');
assert.equal(importClearInjectionCalls, 0, 'prepare 失败不得清理现有注入');
assert.equal(importInjectionCalls, 0, 'prepare 失败不得执行恢复性注入');
assert.equal(importCloseCalls, 0, 'prepare 失败不得关闭手机界面');
assert.equal(localStorageWrites.length, importWritesBefore, 'prepare 失败不得写入 localStorage');
assert.deepEqual(window.__pmHistories, importGlobalsBefore.histories);
assert.deepEqual(window.__pmTheme, importGlobalsBefore.theme);
assert.deepEqual(window.__pmConfig, importGlobalsBefore.config);
assert.equal(uiElements.get('pm-overlay').removed, false);
assert.equal(uiAlerts.length, importAlertsBefore + 1);
assert.match(uiAlerts.at(-1), /导入失败，未修改现有数据/);
assert.doesNotMatch(uiAlerts.at(-1), /原数据已恢复/);

const baseTheme = { preset: 'default', customRight: '', customLeft: '', borderColor: '#1a1a1a', darkMode: 'light', customTitle: '', qrLabel: '天音' };
for (const [handler, setup, invoke] of [
    ['__pmSetDarkMode', () => {}, () => window.__pmSetDarkMode('dark')],
    ['__pmSetPreset', () => {}, () => window.__pmSetPreset('pink')],
    ['__pmSetCustomAccent', () => {}, () => window.__pmSetCustomAccent()],
    ['__pmSetCustomColor', () => {}, () => window.__pmSetCustomColor()],
    ['__pmClearCustomColor', () => { window.__pmTheme = { ...window.__pmTheme, preset: 'custom', customRight: '#111111', customLeft: '#222222' }; }, () => window.__pmClearCustomColor()],
    ['__pmSetBorderColor', () => {}, () => window.__pmSetBorderColor()],
    ['__pmSetCustomTitle', () => { uiElements.get('pm-custom-title').value = '  雨夜电台  '; }, () => window.__pmSetCustomTitle()],
]) {
    window.__pmTheme = structuredClone(baseTheme);
    setup();
    const previous = structuredClone(window.__pmTheme);
    localStorageControl.failSet.add('ST_SMS_THEME');
    assert.equal(invoke(), false, `${handler} should report persistence failure`);
    assert.deepEqual(window.__pmTheme, previous, `${handler} should restore the previous theme`);
    assert.deepEqual(appliedThemes.at(-1), previous, `${handler} should reapply the previous theme`);
    assert.match(uiAlerts.at(-1), /主题保存失败/);
}
window.__pmTheme = structuredClone(baseTheme);
assert.equal(window.__pmSetDarkMode('dark'), true);
assert.equal(window.__pmTheme.darkMode, 'dark');
assert.equal(JSON.parse(localValues.get('ST_SMS_THEME')).darkMode, 'dark');
assert.equal(appliedThemes.at(-1).darkMode, 'dark');
window.__pmTheme = { ...structuredClone(baseTheme), customRight: '#111111', customLeft: '#222222', customAccent: '#ff00aa' };
assert.equal(window.__pmSetPreset('pink'), true);
assert.equal(window.__pmTheme.preset, 'pink');
assert.equal(window.__pmTheme.customAccent, '');
assert.equal(window.__pmTheme.customRight, '');
assert.equal(window.__pmTheme.customLeft, '');
assert.equal(JSON.parse(localValues.get('ST_SMS_THEME')).preset, 'pink');
assert.equal(themeChips.find(chip => chip.dataset.preset === 'pink').getAttribute('aria-pressed'), 'true');
assert.equal(themeChips.find(chip => chip.dataset.preset === 'default').getAttribute('aria-pressed'), 'false');
uiElements.get('pm-custom-right').value = '#123456';
uiElements.get('pm-custom-left').value = '#654321';
assert.equal(window.__pmSetCustomColor(), true);
assert.equal(window.__pmTheme.preset, 'pink', '手动气泡色不得反向改写上方主题色');
assert.equal(window.__pmTheme.customRight, '#123456');
assert.equal(window.__pmTheme.customLeft, '#654321');
assert.equal(themeChips.find(chip => chip.dataset.preset === 'pink').getAttribute('aria-pressed'), 'true');
assert.equal(window.__pmClearCustomColor(), true);
assert.equal(window.__pmTheme.preset, 'pink', '重置气泡色不得改写当前主题色');
assert.equal(window.__pmTheme.customRight, '');
assert.equal(window.__pmTheme.customLeft, '');
uiElements.get('pm-custom-accent').value = '#c8647d';
assert.equal(window.__pmSetCustomAccent(), true);
assert.equal(window.__pmTheme.preset, 'custom', '自定义主题色必须进入 custom 预设');
assert.equal(window.__pmTheme.customAccent, '#c8647d');
assert.equal(window.__pmTheme.customRight, '');
assert.equal(window.__pmTheme.customLeft, '');
assert.ok(themeChips.every(chip => chip.getAttribute('aria-pressed') === 'false'));

window.__pmTheme = { ...structuredClone(baseTheme), darkMode: 'dark' };
window.__pmShowModelPicker();
await new Promise(resolve => setTimeout(resolve, 0));
const modelDropdown = uiElements.get('pm-model-dropdown');
assert.ok(modelDropdown, '模型列表存在时必须创建 body 级浮层');
assert.equal(modelDropdown.dataset.theme, 'dark', '模型浮层创建时必须继承当前主题');
assert.equal(modelDropdown.search.focused, true, '模型浮层创建后必须聚焦搜索框');
assert.equal(documentClickListeners.size, 1, '模型浮层打开后必须只注册一个 capture 关闭监听器');
dispatchDocumentClick(modelDropdown.search);
assert.equal(uiElements.get('pm-model-dropdown'), modelDropdown, '浮层内部点击不得关闭模型列表');
assert.equal(documentClickListeners.size, 1, '浮层内部点击不得注销当前关闭监听器');
assert.deepEqual(modelDropdown.options.buttons.map(button => button.dataset.m), ['model-alpha', 'model-beta']);
assert.equal(modelDropdown.options.buttons[1].getAttribute('aria-pressed'), 'true', '当前模型必须标记为选中');
modelDropdown.search.dispatchInput('alpha');
assert.deepEqual(modelDropdown.options.buttons.map(button => button.dataset.m), ['model-alpha']);
modelDropdown.search.dispatchInput('missing');
assert.match(modelDropdown.options.innerHTML, /class="pm-model-empty">无匹配<\/div>/);
modelDropdown.search.dispatchInput('beta');
modelDropdown.options.buttons[0].click();
assert.equal(uiElements.get('pm-cfg-model').value, 'model-beta');
assert.equal(uiElements.has('pm-model-dropdown'), false, '选择模型后必须移除浮层');
assert.equal(documentClickListeners.size, 0, '选择模型后必须注销 document 关闭监听器');

window.addEventListener = () => {};
const originalConsoleWarn = console.warn;
const hostBoundaryWarnings = [];
try {
    console.warn = (...args) => hostBoundaryWarnings.push(args);
    const personaContext = {
        name1: 'Fallback User',
        get powerUserSettings() { throw new TypeError('sensitive persona payload'); },
        chatMetadata: { persona: 'metadata fallback' },
    };
    assert.deepEqual(getUserPersona(() => personaContext), {
        name: 'Fallback User', description: 'metadata fallback',
    }, '人设设置读取失败后必须继续使用 metadata fallback');
    assert.deepEqual(getUserPersona(() => personaContext), {
        name: 'Fallback User', description: 'metadata fallback',
    });
    assert.equal(hostBoundaryWarnings.filter(args => String(args[0]).includes('读取用户人设设置失败')).length, 1,
        '同一人设读取失败必须只告警一次');
    assert.equal(hostBoundaryWarnings.some(args => args.some(value => String(value).includes('sensitive persona payload'))), false,
        '宿主上下文告警不得输出异常正文或潜在敏感内容');

    let aggregatePromptCalls = 0;
    const worldBookContext = {
        chat: [
            { is_user: false, name: '角色', mes: '最后一条有效正文 <date>2024-10-27</date>```不应保留的代码```<think>不应保留的思考</think>' },
            { is_user: true, mes: '<think>只有隐藏思考，不是正文</think>' },
        ],
        chatMetadata: { world_info: ['测试书'] }, characters: [{ avatar: 'alice.png' }], characterId: 0,
        getWorldInfoNames() { throw new Error('运行时不得读取全量目录'); },
        async loadWorldInfo() { return { entries: {
            1: { uid: 1, content: '允许的世界书内容', key: ['2024-10-27'], insertion_order: 1 },
            2: { uid: 2, content: '关闭条目不得出现', constant: true, insertion_order: 2 },
            3: { uid: 3, content: '关闭栏目不得出现', constant: true, comment: 'TavernDB-ACU-CustomExport-纪要-1', insertion_order: 3 },
        } }; },
        async getWorldInfoPrompt() { aggregatePromptCalls += 1; return { worldInfoString: '聚合结果不得使用' }; },
    };
    const worldBookTestConfig = {
        entries: { [createWorldBookEntryKey('测试书', 2)]: false },
        columns: { 纪要: { chat: false } }, mainChatMessages: 2,
    };
    const selectedWorldBookText = await buildWorldBookContext(worldBookContext, {
        module: 'chat', config: worldBookTestConfig,
    });
    assert.equal(selectedWorldBookText, '允许的世界书内容', '筛选必须基于原始条目，而非宿主聚合结果');
    assert.equal(await buildWorldBookContext({ ...worldBookContext, groupId: 'group-a' }, {
        module: 'chat', config: { entries: {
            [createWorldBookEntryKey('测试书', 2)]: false, [createWorldBookEntryKey('测试书', 3)]: false,
        }, characters: { 'alice.png': { entries: { [createWorldBookEntryKey('测试书', 1)]: false } } } },
    }), '允许的世界书内容', '群聊不得继承角色私人条目关闭配置');
    const privateMemberWorldBookEntry = { bookName: '测试书', uid: 'private-member', column: '小明日记' };
    const privateMemberWorldBookConfig = {
        columns: { 小明日记: { chat: false } },
        characters: { '小明-avatar': { columns: { 小明日记: { chat: true } } } },
        groups: { 'group-private': { allowMemberPrivateMemory: true } },
    };
    assert.equal(isMemberPrivateWorldBookEntryAllowed(privateMemberWorldBookConfig, privateMemberWorldBookEntry, '小明-avatar'), true,
        '成员私有栏目必须只在成员显式启用聊天读取时可被群聊授权');
    assert.equal(isMemberPrivateWorldBookEntryAllowed(privateMemberWorldBookConfig, privateMemberWorldBookEntry, '小红-avatar'), false,
        '没有角色级显式栏目授权的成员不得把全局栏目带入群聊');
    assert.equal(await buildWorldBookContext({
        chat: [{ mes: '私有触发词' }], chatMetadata: { world_info: ['测试书'] }, getWorldInfoNames() { throw new Error('不得调用'); },
        async loadWorldInfo() { return { entries: {
            private: { uid: 'private-member', content: '小明私有正文', key: ['私有触发词'], comment: 'TavernDB-ACU-CustomExport-小明日记-1' },
        } }; },
    }, {
        module: 'chat', scope: { kind: 'group', id: 'group-private' }, memberIds: ['小明-avatar', '小红-avatar'],
        config: privateMemberWorldBookConfig,
    }), '【成员私有记忆：仅小明-avatar知晓，不得让其他成员知晓、转述或据此发言】\n小明私有正文',
    '群聊成员私有记忆必须默认隔离，并在显式授权后以成员边界提示词注入');
    const defaultPrivateMemberWorldBookConfig = {
        characters: { '小明-avatar': { columns: { 小明日记: { chat: true } } } },
        groups: { 'group-default-private': { allowMemberPrivateMemory: true } },
    };
    assert.equal(await buildWorldBookContext({
        chat: [{ mes: '私有触发词' }], chat_metadata: { world_info: ['测试书'] }, getWorldInfoNames() { throw new Error('不得调用'); },
        async loadWorldInfo() { return { entries: {
            private: { uid: 'private-member', content: '默认配置下不得公开的私人正文', key: ['私有触发词'], comment: 'TavernDB-ACU-CustomExport-小明日记-1' },
        } }; },
    }, {
        module: 'chat', scope: { kind: 'group', id: 'group-without-private' }, memberIds: ['小明-avatar'],
        config: defaultPrivateMemberWorldBookConfig,
    }), '', '群聊默认允许栏目时也不得把成员显式私人栏目公开注入');
    assert.equal(await buildWorldBookContext({
        chat: [{ mes: '私有触发词' }], chatMetadata: { world_info: ['测试书'] }, getWorldInfoNames() { throw new Error('不得调用'); },
        async loadWorldInfo() { return { entries: {
            private: { uid: 'private-member', content: '默认配置下的私人正文', key: ['私有触发词'], comment: 'TavernDB-ACU-CustomExport-小明日记-1' },
        } }; },
    }, {
        module: 'chat', scope: { kind: 'group', id: 'group-default-private' }, memberIds: ['小明-avatar'],
        config: defaultPrivateMemberWorldBookConfig,
    }), '【成员私有记忆：仅小明-avatar知晓，不得让其他成员知晓、转述或据此发言】\n默认配置下的私人正文',
    '群聊开启成员私人记忆后不得因全局默认允许而丢失成员边界提示词');
    assert.equal(await buildWorldBookContext({
        chat: [{ mes: '私有触发词' }], chatMetadata: { world_info: ['测试书'] }, getWorldInfoNames() { throw new Error('不得调用'); },
        async loadWorldInfo() { return { entries: {
            private: { uid: 'private-member', content: '群聊明确公开的正文', key: ['私有触发词'], comment: 'TavernDB-ACU-CustomExport-小明日记-1' },
        } }; },
    }, {
        module: 'chat', scope: { kind: 'group', id: 'group-explicit-public' }, memberIds: ['小明-avatar'],
        config: { ...defaultPrivateMemberWorldBookConfig, groups: { 'group-explicit-public': { columns: { 小明日记: { chat: true } } } } },
    }), '群聊明确公开的正文', '仅群聊自身显式开启栏目时，成员私人栏目才可作为公共群聊上下文读取');
    assert.equal(await buildWorldBookContext({
        chat: [{ mes: '私有触发词' }], chatMetadata: { world_info: ['测试书'] }, getWorldInfoNames() { throw new Error('不得调用'); },
        async loadWorldInfo() { return { entries: {
            private: { uid: 'private-member', content: '不得泄漏的私有正文', key: ['私有触发词'], comment: 'TavernDB-ACU-CustomExport-小明日记-1' },
        } }; },
    }, {
        module: 'chat', scope: { kind: 'group', id: 'group-without-private' }, memberIds: ['小明-avatar'],
        config: privateMemberWorldBookConfig,
    }), '', '群聊未显式启用成员私有记忆时不得载入成员栏目');

    let emptySourceLoads = 0, emptySourceNameCalls = 0;
    assert.equal(await buildWorldBookContext({
        getWorldInfoNames() { emptySourceNameCalls += 1; throw new Error('不得调用'); },
        async loadWorldInfo() { emptySourceLoads += 1; throw new Error('不得调用'); },
    }, { module: 'chat', config: worldBookTestConfig }), '', '三种显式关联来源都为空时必须返回空上下文');
    assert.equal(emptySourceNameCalls, 0, '运行时不得调用 getWorldInfoNames');
    assert.equal(emptySourceLoads, 0, '三种关联来源都为空时不得读取任何世界书');
    const abortedWorldBookRead = new AbortController();
    abortedWorldBookRead.abort('test-cancelled');
    await assert.rejects(
        () => buildWorldBookContext(worldBookContext, {
            module: 'chat', config: worldBookTestConfig, signal: abortedWorldBookRead.signal,
        }),
        error => error?.name === 'AbortError',
        '世界书读取开始前已取消时不得继续读取宿主数据',
    );
    const hostAbortError = new Error('宿主读取已取消'); hostAbortError.name = 'AbortError';
    await assert.rejects(
        () => buildWorldBookContext({
            chatMetadata: { world_info: ['测试书'] }, getWorldInfoNames() { throw new Error('不得调用'); },
            async loadWorldInfo() { throw hostAbortError; },
        }, { module: 'chat', config: worldBookTestConfig }),
        error => error === hostAbortError,
        '宿主单本读取主动取消时不得跳过该书并继续请求',
    );
    assert.equal(await buildWorldBookContext({
        chat: [{ mes: '<think>隐藏关键词</think>```代码关键词```<b>标签关键词</b>' }],
        chatMetadata: { world_info: ['测试书'] },
        async loadWorldInfo() { return { entries: {
            hidden: { uid: 'hidden', content: '隐藏内容不得触发', key: ['隐藏关键词'] },
            code: { uid: 'code', content: '代码内容不得触发', key: ['代码关键词'] },
            tag: { uid: 'tag', content: '标签正文可以触发', key: ['标签关键词'] },
            unclosedThink: { uid: 'unclosedThink', content: '未闭合思考不得触发', key: ['未闭合思考关键词'] },
            unclosedCode: { uid: 'unclosedCode', content: '未闭合代码不得触发', key: ['未闭合代码关键词'] },
        } }; },
    }, { module: 'chat', config: worldBookTestConfig }), '标签正文可以触发',
    '世界书扫描必须忽略隐藏思考与代码块，但保留可见标签正文');
    assert.equal(await buildWorldBookContext({
        chat: [{ mes: '可见正文<think data-hidden>未闭合思考关键词' }],
        chatMetadata: { world_info: ['测试书'] },
        async loadWorldInfo() { return { entries: {
            unclosedThink: { uid: 'unclosedThink', content: '未闭合思考不得触发', key: ['未闭合思考关键词'] },
        } }; },
    }, { module: 'chat', config: worldBookTestConfig }), '', '未闭合保护块必须清除到消息末尾，不能触发世界书');
    assert.equal(await buildWorldBookContext({
        chat: [{ mes: '可见正文```未闭合代码关键词' }],
        chatMetadata: { world_info: ['测试书'] },
        async loadWorldInfo() { return { entries: {
            unclosedCode: { uid: 'unclosedCode', content: '未闭合代码不得触发', key: ['未闭合代码关键词'] },
        } }; },
    }, { module: 'chat', config: worldBookTestConfig }), '', '未闭合代码围栏必须清除到消息末尾，不能触发世界书');
    const sharedWorldBookFixture = {
        chat: [{ mes: '触发词' }],
        chatMetadata: { world_info: ['第一本', '故障书', '第二本'] }, getWorldInfoNames() { throw new Error('不得调用'); },
        async loadWorldInfo(name) {
            if (name === '故障书') throw new Error('单本读取失败');
            return { entries: {
                [name]: { uid: name, content: `${name}内容`, key: ['触发词'],
                    comment: 'TavernDB-ACU-CustomExport-纪要-1' },
            } };
        },
    };
    assert.equal(await buildWorldBookContext(sharedWorldBookFixture, {
        module: 'calendar', config: { columns: { 纪要: { chat: false, calendar: true } } },
    }), '第一本内容\n\n第二本内容', '单本读取失败不得阻断其他世界书，且需保留宿主目录顺序');
    assert.equal(await buildWorldBookContext(sharedWorldBookFixture, {
        module: 'chat', config: { columns: { 纪要: { chat: false, calendar: true } } },
    }), '', '栏目矩阵必须只影响对应模块');
    assert.equal(await buildWorldBookContext({
        chat: [{ mes: '触发词' }], chatMetadata: { world_info: ['预算书'] },
        async loadWorldInfo() { return { entries: {
            first: { uid: 'first', content: '甲'.repeat(700), key: ['触发词'], insertion_order: 1 },
            second: { uid: 'second', content: '乙'.repeat(400), key: ['触发词'], insertion_order: 2 },
        } }; },
    }, { module: 'chat', config: { maxChars: 1000 } }), '甲'.repeat(700),
    '世界书预算必须在完整条目边界停止，不得输出第二条残片');
    const maxCharsContext ={
        chatMetadata: { world_info: ['上限书'] },
        async loadWorldInfo() { return { entries: {
            first: { uid: 'first', content: '甲'.repeat(700), constant: true, insertion_order: 1 },
            second: { uid: 'second', content: '乙'.repeat(500), constant: true, insertion_order: 2 },
        } }; },
    };
    assert.equal(await buildWorldBookContext(maxCharsContext, {
        module: 'chat', config: { maxChars: 2000 }, maxChars: 1000,
    }), '甲'.repeat(700), '调用参数 maxChars 较小时必须覆盖配置上限');
    assert.equal(await buildWorldBookContext(maxCharsContext, {
        module: 'chat', config: { maxChars: 1000 }, maxChars: 2000,
    }), '甲'.repeat(700), '配置 maxChars 较小时不得被调用参数放宽');
    let disabledBookLoads = 0;
    assert.equal(await buildWorldBookContext({ chatMetadata: { world_info: ['关闭书'] }, async loadWorldInfo() { disabledBookLoads += 1; return {}; } },
        { module: 'chat', config: { books: { 关闭书: false } } }), '', '关闭书必须输出空上下文');
    assert.equal(disabledBookLoads, 0, 'config.books=false 必须在 loadWorldInfo 前排除');
    const explicitBookLoads = [];
    assert.equal(await buildWorldBookContext({
        chat: [{ mes: '显式读取触发词' }], chatMetadata: { world_info: ['当前书'] },
        getWorldInfoNames() { throw new Error('运行时不得读取全量目录'); },
        async loadWorldInfo(name) {
            explicitBookLoads.push(name);
            return { entries: {
                [name]: { uid: name, content: `${name}正文`, key: ['显式读取触发词'] },
            } };
        },
    }, { module: 'chat', config: { books: { 当前书: true, 其他显式开启书: true, 其他关闭书: false } } }),
    '当前书正文\n\n其他显式开启书正文', '其他世界书显式开启后必须真正进入运行时读取链路');
    assert.deepEqual(explicitBookLoads, ['当前书', '其他显式开启书'],
        '当前书与显式开启的其他书必须稳定去重，未配置或关闭的其他书不得读取');
    assert.deepEqual(getReadableWorldBookNames({ chatMetadata: { world_info: ['当前书'] } }, {
        books: { 未配置其他书: false, 其他显式开启书: true },
    }), ['当前书', '其他显式开启书'], '可读名单必须先保留当前书，再追加显式开启的其他书');
    const firstRuntimeBook = makeDeferredWorldBook();
    let runtimeLoadCalls = 0, runtimeActiveLoads = 0, runtimeMaxActiveLoads = 0;
    const runtimeAbortController = new AbortController();
    const pendingRuntimeContext = buildWorldBookContext({
        chat: [{ mes: '运行时触发词' }], chatMetadata: { world_info: ['受控第一本', '受控第二本'] },
        async loadWorldInfo(name) {
            runtimeLoadCalls += 1;
            runtimeActiveLoads += 1;
            runtimeMaxActiveLoads = Math.max(runtimeMaxActiveLoads, runtimeActiveLoads);
            try {
                if (name === '受控第一本') return await firstRuntimeBook.promise;
                return { entries: { second: { uid: 'second', content: '第二本正文不得读取', constant: true } } };
            } finally { runtimeActiveLoads -= 1; }
        },
    }, { module: 'chat', config: {}, signal: runtimeAbortController.signal });
    await Promise.resolve();
    runtimeAbortController.abort('acceptance-cancel');
    firstRuntimeBook.resolve({ entries: {
        first: { uid: 'first', content: '第一本部分正文不得返回', constant: true },
    } });
    await assert.rejects(pendingRuntimeContext, error => error?.name === 'AbortError',
        '第一本 pending 时取消必须让整体读取以 AbortError 结束');
    assert.equal(runtimeLoadCalls, 1, '取消后第二本必须保持 0 次读取');
    assert.equal(runtimeMaxActiveLoads, 1, '运行时世界书读取最大并发必须为 1');
    assert.equal(runtimeActiveLoads, 0, '受控读取释放后不得残留活动宿主请求');
    const previousWorldBookConfig = window.__pmWorldBookConfig;
    window.__pmWorldBookConfig = worldBookTestConfig;
    const firstGatheredContext = await gatherContext(() => worldBookContext, { module: 'chat' });
    const secondGatheredContext = await gatherContext(() => worldBookContext, { module: 'chat' });
    window.__pmWorldBookConfig = previousWorldBookConfig;
    assert.equal(firstGatheredContext.worldBookText, '允许的世界书内容');
    assert.equal(secondGatheredContext.worldBookText, '允许的世界书内容');
    const readOnlyHostEntries = Object.freeze({
        active: Object.freeze({ uid: 'active', content: '激活集合正文', constant: true, insertion_order: 2 }),
        inactive: Object.freeze({ uid: 'inactive', content: '未激活条目不得插入', key: ['不存在的触发词'], insertion_order: 1 }),
    });
    const readOnlyHostBook = Object.freeze({ entries: readOnlyHostEntries });
    let hostMutationCalls = 0;
    const readOnlyHostContext = {
        chat: [{ mes: '任意正文' }],
        characters: [{ data: { extensions: { world: '只读宿主书' } } }], characterId: 0,
        async loadWorldInfo() { return readOnlyHostBook; },
        saveWorldInfo() { hostMutationCalls += 1; },
        updateWorldInfoList() { hostMutationCalls += 1; },
    };
    assert.equal(await buildWorldBookContext(readOnlyHostContext, {
        module: 'community', config: { maxChars: 24000 },
    }), '激活集合正文', '世界书上下文必须根据原始条目的激活条件重建插件私有插入内容');
    assert.equal(hostMutationCalls, 0, '重建插件私有上下文不得调用宿主世界书写入 API');
    assert.deepEqual(readOnlyHostBook, { entries: {
        active: { uid: 'active', content: '激活集合正文', constant: true, insertion_order: 2 },
        inactive: { uid: 'inactive', content: '未激活条目不得插入', key: ['不存在的触发词'], insertion_order: 1 },
    } }, '构建激活集合不得改写宿主返回的原始条目定义');
    assert.equal(aggregatePromptCalls, 0, '插件世界书读取不得调用宿主聚合 prompt API');
    assert.equal(firstGatheredContext.latestChatText, '最后一条有效正文 2024-10-27',
        '最后正文必须跳过清洗后为空的末楼层');
    assert.equal(firstGatheredContext.rawLatestChatText, '最后一条有效正文 <date>2024-10-27</date>',
        '日历专用原文必须保留配置日期标签，但仍移除保护块');
    assert.doesNotMatch(firstGatheredContext.latestChatText, /<date>|<\/date>/,
        '通用最新正文必须继续清洗标签');
    assert.doesNotMatch(firstGatheredContext.rawLatestChatText, /```|<think>/,
        '日历专用原文不得泄漏代码块或隐藏思考');
    assert.doesNotMatch(firstGatheredContext.mainChatText, /<date>|<\/date>/,
        '原始日期标签不得污染普通 AI 上下文');
    assert.equal(firstGatheredContext.latestChatIsUser, false,
        '最后正文的作者标记必须与被选中的有效楼层一致');
    const unclosedProtectedContext = await gatherContext(() => ({
        chat: [
            { is_user: false, name: '角色', mes: '可见正文甲<think data-hidden>未闭合思考关键词' },
            { is_user: true, mes: '可见正文乙```未闭合代码关键词' },
        ],
    }), { module: 'chat' });
    assert.equal(unclosedProtectedContext.latestChatText, '可见正文乙',
        '未闭合代码围栏后的隐藏尾部不得成为最新正文');
    assert.equal(unclosedProtectedContext.rawLatestChatText, '可见正文乙');
    assert.equal(unclosedProtectedContext.mainChatText, '角色：可见正文甲\n用户：可见正文乙',
        '未闭合保护块不得泄漏进主聊天或社区基础上下文');

    const injectionListeners = new Map();
    const injectionPromptCalls = [];
    let resolveInteractiveStore;
    const interactiveStoreReady = new Promise(resolve => { resolveInteractiveStore = resolve; });
    const injectionContext = {
        chat: [],
        chatId: 'official-branch-chat',
        characterId: 0,
        characters: [{ name: 'Alice', avatar: 'alice.png' }],
        chatMetadata: { main_chat: 'official-parent-chat' },
        eventTypes: {
            GENERATION_STARTED: 'generation_started', CHAT_CHANGED: 'chat_id_changed',
            MESSAGE_RECEIVED: 'message_received', SETTINGS_UPDATED: 'settings_updated',
        },
        eventSource: {
            on(eventName, listener) {
                const listeners = injectionListeners.get(eventName) || [];
                listeners.push(listener);
                injectionListeners.set(eventName, listeners);
            },
        },
        setExtensionPrompt(...args) { injectionPromptCalls.push(args); },
    };
    const previousBidirectional = window.__pmBidirectional;
    const previousHistories = window.__pmHistories;
    const previousGroupMeta = window.__pmGroupMeta;
    const previousInjectionConfig = window.__pmInjectionConfig;
    const previousBudgetConfig = window.__pmBudgetConfig;
    const previousEmojis = window.__pmEmojis;
    window.__pmBidirectional = { story: ['Alice'] };
    window.__pmHistories = { story: { Alice: [{ role: 'assistant', content: '必须在生成前完成注入' }] } };
    window.__pmGroupMeta = { story: {} };
    window.__pmInjectionConfig = { position: EXTENSION_PROMPT_POSITIONS.IN_PROMPT, depth: 0, historyLimit: 20 };
    window.__pmBudgetConfig = undefined;
    window.__pmEmojis = [];
    try {
        const officialBranchCalls = [];
        let officialBranchFailure = null;
        const injectionDeps = {
            runtime: createRuntimeState(),
            getCtx: () => injectionContext,
            getStorageId: () => 'story',
            getUserPersona: () => ({ name: '用户' }),
            getInteractiveStore: () => interactiveStoreReady,
            beginBranchInheritance: async context => {
                if (officialBranchFailure) throw officialBranchFailure;
                officialBranchCalls.push(context); return { status: 'cloned' };
            },
        };
        installPhoneFoundation({ phoneWindow: null, phoneActive: false, conversationHistory: [] }, injectionDeps);
        injectionDeps.hookGenerationEvent();
        assert.equal(injectionListeners.get('generation_started')?.length, 1,
            '真实宿主 eventTypes 必须注册唯一的注入刷新监听器');
        assert.equal(injectionListeners.get('chat_id_changed')?.length, 1,
            '真实宿主 eventTypes.CHAT_CHANGED 必须按官方 chat_id_changed 值注册会话失效处理器');
        const generationRefresh = injectionListeners.get('generation_started')[0]();
        assert.equal(typeof generationRefresh?.then, 'function',
            '生成开始监听器必须返回注入 Promise，让宿主等待提示词写入完成');
        assert.equal(injectionPromptCalls.length, 0,
            '异步依赖未就绪时不得先清空现有注入，避免竞态留下空提示词');
        resolveInteractiveStore({ version: 1, scopes: {} });
        await generationRefresh;
        const injectedMemory = injectionPromptCalls.find(call => String(call[1]).includes('必须在生成前完成注入'));
        assert.ok(injectedMemory, '生成开始事件完成前必须写入所选聊天记录提示词');
        assert.equal(injectedMemory[2], EXTENSION_PROMPT_POSITIONS.IN_PROMPT);
        assert.equal(injectedMemory[3], 0);
        const branchEventResult = injectionListeners.get('chat_id_changed')[0]('official-branch-chat');
        assert.equal(typeof branchEventResult?.then, 'function',
            'CHAT_CHANGED 监听器必须返回分支继承 Promise，让宿主事件总线等待事务启动结果');
        await branchEventResult;
        assert.deepEqual(officialBranchCalls, [injectionContext],
            '官方分支 CHAT_CHANGED 必须把含 main_chat 的最新 getContext 快照交给继承入口');
        assert.deepEqual(injectionDeps.runtime.lastBranchInheritance, {
            status: 'cloned', reason: null, sourceId: null, targetId: null, sourcePresence: null, targetPresence: null,
        }, '宿主监听器必须记录真实继承入口返回的可诊断状态');
        assert.equal(injectionDeps.runtime.lastBranchInheritanceError, null,
            '成功或跳过的分支继承不得遗留失败诊断');
        officialBranchFailure = new Error(`保留前缀${'x'.repeat(260)}敏感尾标记`);
        const failedBranchEvent = injectionListeners.get('chat_id_changed')[0]('official-branch-chat');
        assert.equal((await failedBranchEvent).status, 'failed',
            '真实宿主 CHAT_CHANGED 监听器必须将继承异常转为可诊断失败状态');
        assert.equal(injectionDeps.runtime.lastBranchInheritanceError?.message.length, 240,
            '运行态失败诊断必须截断过长错误消息');
        assert.match(injectionDeps.runtime.lastBranchInheritanceError?.message || '', /^保留前缀x+$/,
            '截断诊断必须保留开头的可识别错误前缀');
        assert.doesNotMatch(injectionDeps.runtime.lastBranchInheritanceError?.message || '', /敏感尾标记/,
            '截断诊断不得保留超过上限的敏感尾部内容');
    } finally {
        window.__pmBidirectional = previousBidirectional;
        window.__pmHistories = previousHistories;
        window.__pmGroupMeta = previousGroupMeta;
        window.__pmInjectionConfig = previousInjectionConfig;
        window.__pmBudgetConfig = previousBudgetConfig;
        window.__pmEmojis = previousEmojis;
    }

    const legacyEventListeners = new Map();
    const legacyEventContext = {
        chat: [],
        chatId: 'legacy-branch-chat',
        characterId: 0,
        characters: [{ name: 'Alice', avatar: 'alice.png' }],
        chatMetadata: { main_chat: 'legacy-parent-chat' },
        event_types: {
            GENERATION_STARTED: 'legacy_generation_started', CHAT_CHANGED: 'legacy_chat_changed',
            MESSAGE_RECEIVED: 'legacy_message_received', SETTINGS_UPDATED: 'legacy_settings_updated',
        },
        eventSource: {
            on(eventName, listener) {
                const listeners = legacyEventListeners.get(eventName) || [];
                listeners.push(listener);
                legacyEventListeners.set(eventName, listeners);
            },
        },
    };
    const legacyBranchCalls = [];
    const legacyDeps = {
        runtime: createRuntimeState(), getCtx: () => legacyEventContext, getStorageId: () => 'story',
        getUserPersona: () => ({ name: '用户' }),
        beginBranchInheritance: async context => {
            legacyBranchCalls.push(context); return { status: 'cloned' };
        },
    };
    installPhoneFoundation({ phoneWindow: null, phoneActive: false, conversationHistory: [] }, legacyDeps);
    legacyDeps.hookGenerationEvent();
    assert.equal(legacyEventListeners.get('legacy_generation_started')?.length, 1,
        '旧宿主 event_types 仍必须注册注入刷新监听器');
    assert.equal(legacyEventListeners.get('legacy_chat_changed')?.length, 1,
        '旧宿主 event_types 仍必须注册 CHAT_CHANGED 会话失效处理器');
    const legacyBranchResult = legacyEventListeners.get('legacy_chat_changed')[0]('legacy-branch-chat');
    assert.equal(typeof legacyBranchResult?.then, 'function', '旧宿主 CHAT_CHANGED 也必须返回分支继承 Promise');
    await legacyBranchResult;
    assert.deepEqual(legacyBranchCalls, [legacyEventContext],
        '旧宿主 event_types 路径必须继续把最新上下文交给分支继承入口');

    const registrationAttempts = new Map();
    const recoveredEventListeners = new Map();
    let failChatRegistration = true;
    let currentEventRegistrationContext;
    const eventRegistrationContext = {
        chat: [],
        eventTypes: {
            GENERATION_STARTED: 'generation_started', CHAT_CHANGED: 'chat_changed',
            MESSAGE_RECEIVED: 'message_received', SETTINGS_UPDATED: 'settings_updated',
        },
        eventSource: {
            on(eventName, listener) {
                registrationAttempts.set(eventName, (registrationAttempts.get(eventName) || 0) + 1);
                if (eventName === 'chat_changed' && failChatRegistration) {
                    throw new SyntaxError('sensitive host event payload');
                }
                const listeners = recoveredEventListeners.get(eventName) || [];
                listeners.push(listener);
                recoveredEventListeners.set(eventName, listeners);
            },
        },
    };
    currentEventRegistrationContext = eventRegistrationContext;
    const recoveringDeps = {
        runtime: createRuntimeState(),
        getCtx: () => currentEventRegistrationContext,
        getStorageId: () => 'story',
        getUserPersona: () => ({ name: '用户' }),
    };
    installPhoneFoundation({ phoneWindow: null, phoneActive: false, conversationHistory: [] }, recoveringDeps);
    recoveringDeps.hookGenerationEvent();
    const registrationWarningCount = hostBoundaryWarnings.filter(args => String(args[0]).includes('宿主事件')).length;
    assert.equal(recoveringDeps.runtime.eventHooked, false,
        '任一关键宿主事件注册失败时不得把 runtime 锁死为已完成');
    assert.ok(registrationWarningCount > 0, '事件注册异常必须产生可诊断告警');
    const successfulAttemptSnapshot = new Map(registrationAttempts);
    failChatRegistration = false;
    recoveringDeps.hookGenerationEvent();
    assert.equal(recoveringDeps.runtime.eventHooked, true,
        '宿主恢复后必须允许失败事件重试并完成注册');
    assert.equal(registrationAttempts.get('chat_changed'), 2,
        '失败的 CHAT_CHANGED 必须且只能在恢复后重试一次');
    for (const [eventName, attempts] of successfulAttemptSnapshot) {
        if (eventName === 'chat_changed') continue;
        assert.equal(registrationAttempts.get(eventName), attempts,
            `已成功注册的 ${eventName} 不得在局部失败重试时重复绑定`);
    }
    assert.equal(recoveredEventListeners.get('chat_changed')?.length, 1,
        '恢复后 CHAT_CHANGED 必须只有一个有效监听器');
    recoveringDeps.hookGenerationEvent();
    assert.equal(registrationAttempts.get('chat_changed'), 2,
        '完成注册后的重复 hook 必须保持幂等');
    const replacementListeners = new Map();
    const replacementEventSource = {
        on(eventName, listener) {
            const listeners = replacementListeners.get(eventName) || [];
            listeners.push(listener);
            replacementListeners.set(eventName, listeners);
        },
    };
    currentEventRegistrationContext = {
        ...eventRegistrationContext,
        eventSource: replacementEventSource,
    };
    recoveringDeps.hookGenerationEvent();
    assert.equal(recoveringDeps.runtime.hostEventSource, replacementEventSource,
        '宿主替换 eventSource 后 runtime 必须切换到新事件源');
    assert.equal(recoveringDeps.runtime.eventHooked, true,
        '新 eventSource 上所有事件重新注册成功后必须恢复完成状态');
    const expectedReplacementListenerCounts = new Map([
        ['generation_started', 1], ['settings_updated', 1],
        ['chatcompletion_source_changed', 1], ['oai_preset_changed_after', 1],
        // MESSAGE_RECEIVED 同时服务社区观察和自动计数，两个职责必须各有一个监听器。
        ['message_received', 2], ['chat_changed', 1],
    ]);
    for (const [eventName, expectedCount] of expectedReplacementListenerCounts) {
        assert.equal(replacementListeners.get(eventName)?.length, expectedCount,
            `新 eventSource 的 ${eventName} 监听器数量必须与独立职责一致`);
    }
    recoveringDeps.hookGenerationEvent();
    assert.equal(replacementListeners.get('chat_changed')?.length, 1,
        '新 eventSource 完成注册后重复 hook 不得再次绑定 CHAT_CHANGED');
    assert.equal(hostBoundaryWarnings.filter(args => String(args[0]).includes('宿主事件')).length, registrationWarningCount,
        '同一宿主事件注册失败重试期间必须保持告警去重');
    assert.equal(hostBoundaryWarnings.some(args => args.some(value => String(value).includes('sensitive host event payload'))), false,
        '事件注册告警不得输出异常正文');

    const quietDeps = {
        runtime: createRuntimeState(), getCtx: () => ({}), getStorageId: () => 'story',
        getUserPersona: () => ({ name: '用户' }),
    };
    installPhoneFoundation({ phoneWindow: null, phoneActive: false, conversationHistory: [] }, quietDeps);
    quietDeps.hookGenerationEvent();
    assert.equal(hostBoundaryWarnings.filter(args => String(args[0]).includes('宿主事件')).length, registrationWarningCount,
        '缺少 eventSource/eventTypes 的未就绪宿主必须安静跳过');
} finally {
    console.warn = originalConsoleWarn;
}

document.visibilityState = 'visible';
window.__pmShowModelPicker();
await new Promise(resolve => setTimeout(resolve, 0));
const synchronizedDropdown = uiElements.get('pm-model-dropdown');
const foundationPhoneStyleValues = new Map();
const foundationPhone = {
    style: {
        transform: '',
        transition: '',
        setProperty(name, value) {
            foundationPhoneStyleValues.set(name, value);
            if (name === 'transform') this.transform = value;
        },
        removeProperty(name) {
            foundationPhoneStyleValues.delete(name);
            if (name === 'transform') this.transform = '';
        },
    },
    classList: makeClassList([]),
    setAttribute(name, value) { this[name] = value; },
    removeAttribute(name) { delete this[name]; },
    hidePopover() {},
    remove() { this.removed = true; },
    querySelector() { return null; },
};
const foundationState = {
    phoneWindow: foundationPhone,
    phoneActive: true,
    isMinimized: false,
    isSelectMode: false,
    conversationHistory: [],
};
const lifecycleCalls = [];
const foundationDeps = {
    runtime: createRuntimeState(),
    getCtx: () => ({ registerSlashCommand() {} }),
    getStorageId: () => 'story',
    getUserPersona: () => ({ name: '用户' }),
    persistCurrentHistory: () => lifecycleCalls.push(['persist-history']),
    persistPhoneUiSnapshot: () => lifecycleCalls.push(['persist-phone-ui']),
    closeControlCenter: () => lifecycleCalls.push(['close-control-center']),
    cancelCommunityGeneration: reason => lifecycleCalls.push(['cancel-community', reason]),
    cancelCalendarTasks: reason => lifecycleCalls.push(['cancel-calendar', reason]),
    restorePhoneChat: async () => true,
    restorePhoneUi: async () => {},
};
installPhoneFoundation(foundationState, foundationDeps);
const lifecycleSetTimeout = globalThis.setTimeout;
const lifecycleSetInterval = globalThis.setInterval;
let lifecycleIntervalCalls = 0;
try {
    globalThis.setTimeout = () => 0;
    globalThis.setInterval = () => { lifecycleIntervalCalls += 1; return 0; };
    installPhoneLifecycle(foundationState, foundationDeps);
} finally {
    globalThis.setTimeout = lifecycleSetTimeout;
    globalThis.setInterval = lifecycleSetInterval;
}
assert.equal(lifecycleIntervalCalls, 0, '插件安装但手机未打开时不得启动可见性巡检定时器');
const lifecycleDocumentClickBaseline = documentClickListeners.size - 1;

const islandWindowListeners = new Map();
const previousWindowAddEventListener = window.addEventListener;
const previousWindowRemoveEventListener = window.removeEventListener;
window.addEventListener = (type, listener) => islandWindowListeners.set(type, listener);
window.removeEventListener = (type, listener) => {
    if (islandWindowListeners.get(type) === listener) islandWindowListeners.delete(type);
};
const islandHandleListeners = new Map();
const islandHandle = {
    addEventListener(type, listener) { islandHandleListeners.set(type, listener); },
    removeEventListener(type, listener) {
        if (islandHandleListeners.get(type) === listener) islandHandleListeners.delete(type);
    },
};
const islandTimers = new Map();
let nextIslandTimerId = 1;
const setIslandTimer = callback => {
    const id = nextIslandTimerId++;
    islandTimers.set(id, callback);
    return id;
};
const clearIslandTimer = id => islandTimers.delete(id);
const runIslandTimers = () => {
    const pending = [...islandTimers.values()];
    islandTimers.clear();
    pending.forEach(callback => callback());
};
const unbindIslandFixture = foundationDeps.bindIsland(foundationPhone, islandHandle, {
    setTimer: setIslandTimer, clearTimer: clearIslandTimer, doubleTapDelay: 300,
});
const makeIslandEvent = (x, y) => ({
    target: { tagName: 'DIV' }, clientX: x, clientY: y, cancelable: true, preventDefault() {},
});
const makeIslandTouchEvent = (x, y) => ({
    target: { tagName: 'DIV' }, touches: [{ clientX: x, clientY: y }],
    cancelable: true, preventDefault() {},
});

window.__pmTheme = { ...structuredClone(baseTheme), phoneScale: 1.35, ambientStatusEnabled: false };
localValues.set('ST_SMS_THEME', JSON.stringify(window.__pmTheme));
const successfulMinimizeWrites = localStorageControl.setCalls.get('ST_SMS_THEME') || 0;
islandHandleListeners.get('mousedown')(makeIslandEvent(10, 10));
islandWindowListeners.get('mousemove')(makeIslandEvent(14, 14));
islandWindowListeners.get('mouseup')();
assert.equal(foundationState.isMinimized, false, '展开态首次点击必须等待双击判定，不能提前最小化');
assert.equal(islandTimers.size, 1, '展开态首次点击必须建立短暂的双击判定窗口');
runIslandTimers();
assert.equal(foundationState.isMinimized, true, '展开态单击判定结束后必须走真实点击收缩生命周期');
assert.equal(foundationPhone.classList.contains('is-min'), true, '点击收缩必须同步 is-min class');
assert.equal(window.__pmTheme.phoneScale, 1, '点击收缩必须通过真实生命周期复位 phoneScale');
assert.equal(JSON.parse(localValues.get('ST_SMS_THEME')).phoneScale, 1, '点击收缩必须持久化默认比例');
assert.equal(localStorageControl.setCalls.get('ST_SMS_THEME'), successfulMinimizeWrites + 1,
    '进入最小化必须且只能保存一次主题');
assert.equal(foundationPhoneStyleValues.get('--pm-phone-width'), '330px');
assert.equal(foundationPhoneStyleValues.get('--pm-phone-height'), '580px');
assert.ok(!lifecycleCalls.some(call => call[0] === 'cancel-community' && call[1] === 'phone-minimized'),
    '最小化必须允许正在进行的社区生成继续');
assert.ok(!lifecycleCalls.some(call => call[0] === 'cancel-calendar' && call[1] === 'phone-minimized'),
    '最小化必须允许正在进行的日历任务继续');

const writesBeforeDrag = localStorageControl.setCalls.get('ST_SMS_THEME');
islandHandleListeners.get('mousedown')(makeIslandEvent(10, 10));
islandWindowListeners.get('mousemove')(makeIslandEvent(15, 10));
islandWindowListeners.get('mouseup')();
assert.equal(foundationState.isMinimized, true, '达到 5px 的拖拽不得切换最小化状态');
assert.equal(window.__pmTheme.phoneScale, 1, '拖拽灵动岛不得改变 phoneScale');
assert.equal(localStorageControl.setCalls.get('ST_SMS_THEME'), writesBeforeDrag, '拖拽灵动岛不得保存主题');
assert.equal(foundationPhoneStyleValues.get('transform'), 'translate(5px, 0px)', '拖拽必须只更新悬浮窗位置');

islandHandleListeners.get('mousedown')(makeIslandEvent(15, 10));
islandWindowListeners.get('mouseup')();
assert.equal(foundationState.isMinimized, true, '悬浮窗首次点击必须等待双击判定，不能立即展开');
assert.equal(islandTimers.size, 1, '悬浮窗首次点击必须建立短暂的双击判定窗口');
runIslandTimers();
assert.equal(foundationState.isMinimized, false, '悬浮窗单击在双击判定结束后必须展开手机');
assert.equal(foundationPhone.classList.contains('is-min'), false, '展开必须移除 is-min class');
assert.equal(localStorageControl.setCalls.get('ST_SMS_THEME'), writesBeforeDrag, '展开不得重复保存或复位比例');

window.__pmTheme.phoneScale = 1.35;
foundationDeps.applyPhoneScale(foundationPhone, 1.35);
localStorageControl.failSet.add('ST_SMS_THEME');
const alertsBeforeFailedMinimize = uiAlerts.length;
islandHandleListeners.get('mousedown')(makeIslandEvent(15, 10));
islandWindowListeners.get('mouseup')();
assert.equal(foundationState.isMinimized, false, '展开态首次点击在保存失败场景仍不得提前最小化');
runIslandTimers();
assert.equal(foundationState.isMinimized, true, '比例保存失败不得破坏最小化生命周期');
assert.equal(foundationPhone.classList.contains('is-min'), true, '保存失败时 state 与 class 必须一致');
assert.equal(window.__pmTheme.phoneScale, 1.35, '真实生命周期保存失败必须恢复原比例');
assert.equal(foundationPhoneStyleValues.get('--pm-phone-width'), '446px', '保存失败必须恢复原视觉宽度');
assert.equal(foundationPhoneStyleValues.get('--pm-phone-height'), '783px', '保存失败必须恢复原视觉高度');
assert.equal(uiAlerts.length, alertsBeforeFailedMinimize + 1);
assert.match(uiAlerts.at(-1), /手机尺寸保存失败/);

const realEndPhone = window.__pmEnd;
let islandDoubleTapCloseCalls = 0;
window.__pmEnd = () => { islandDoubleTapCloseCalls += 1; };
islandHandleListeners.get('mousedown')(makeIslandEvent(15, 10));
islandWindowListeners.get('mouseup')();
assert.equal(foundationState.phoneActive, true, '悬浮窗第一次点击不得提前关闭手机');
assert.equal(islandTimers.size, 1);
islandHandleListeners.get('mousedown')(makeIslandEvent(15, 10));
islandWindowListeners.get('mouseup')();
assert.equal(islandTimers.size, 0, '第二次点击必须取消待执行的单击展开');
assert.equal(islandDoubleTapCloseCalls, 1, '双击悬浮窗必须且只能调用一次手机关闭入口');
assert.equal(foundationState.isMinimized, true, '双击关闭不得先触发单击展开');

islandHandleListeners.get('mousedown')(makeIslandEvent(15, 10));
islandWindowListeners.get('mouseup')();
assert.equal(islandTimers.size, 1, '悬浮窗单击必须保留展开判定窗口');
runIslandTimers();
assert.equal(foundationState.isMinimized, false, '悬浮窗单击判定结束后必须展开手机');
islandHandleListeners.get('mousedown')(makeIslandEvent(15, 10));
islandWindowListeners.get('mouseup')();
assert.equal(islandTimers.size, 1, '展开态首次点击必须保留关闭判定窗口');
islandHandleListeners.get('mousedown')(makeIslandEvent(15, 10));
islandWindowListeners.get('mouseup')();
assert.equal(islandTimers.size, 0, '展开态第二次点击必须取消待执行的单击最小化');
assert.equal(islandDoubleTapCloseCalls, 2, '展开态双击必须且只能调用一次手机关闭入口');
assert.equal(foundationState.isMinimized, false, '展开态双击关闭不得先触发单击最小化');

islandHandleListeners.get('mousedown')(makeIslandEvent(15, 10));
islandWindowListeners.get('mouseup')();
islandHandleListeners.get('mousedown')(makeIslandEvent(15, 10));
islandWindowListeners.get('mousemove')(makeIslandEvent(20, 10));
islandWindowListeners.get('mouseup')();
assert.equal(islandTimers.size, 0, '第二次按下后拖拽必须取消待执行的单击展开');
assert.equal(islandDoubleTapCloseCalls, 2, '第二次按下后拖拽不得误判为双击关闭');
assert.equal(foundationState.isMinimized, false, '展开态第二次按下后拖拽不得触发最小化');

islandHandleListeners.get('touchstart')(makeIslandTouchEvent(20, 10));
islandWindowListeners.get('touchend')();
assert.equal(islandTimers.size, 1, '触摸首次点击也必须建立双击判定窗口');
islandHandleListeners.get('touchstart')(makeIslandTouchEvent(20, 10));
islandWindowListeners.get('touchcancel')();
islandWindowListeners.get('touchend')();
assert.equal(islandTimers.size, 0, 'touchcancel 必须清理第二次触摸前取消的单击计时器');
assert.equal(islandDoubleTapCloseCalls, 2, 'touchcancel 后的结束事件不得误触发双击关闭');
assert.equal(foundationState.isMinimized, false, 'touchcancel 后的结束事件不得触发最小化');

islandHandleListeners.get('mousedown')(makeIslandEvent(20, 10));
islandWindowListeners.get('mouseup')();
assert.equal(islandTimers.size, 1, '解绑测试必须先保留一个待执行的单击计时器');
const pendingIslandCallback = [...islandTimers.values()][0];
unbindIslandFixture();
assert.equal(islandTimers.size, 0, '解绑必须取消待执行的单击展开计时器');
pendingIslandCallback();
assert.equal(foundationState.isMinimized, false, '即使旧计时器回调已被调度，解绑后也不得触发最小化');
assert.equal(islandDoubleTapCloseCalls, 2, '解绑后的旧计时器回调不得关闭手机');
assert.equal(islandWindowListeners.has('mousemove'), false, '解绑必须移除灵动岛拖拽监听器');
assert.equal(islandWindowListeners.has('touchcancel'), false, '解绑必须移除触摸取消监听器');
assert.equal(islandWindowListeners.has('blur'), false, '解绑必须移除窗口失焦监听器');
window.__pmEnd = realEndPhone;

const resizeWindowListeners = new Map();
const visualViewportListeners = new Map();
window.addEventListener = (type, listener) => resizeWindowListeners.set(type, listener);
window.removeEventListener = (type, listener) => {
    if (resizeWindowListeners.get(type) === listener) resizeWindowListeners.delete(type);
};
window.innerWidth = 390;
window.innerHeight = 844;
window.visualViewport = {
    height: 844,
    addEventListener(type, listener) { visualViewportListeners.set(type, listener); },
    removeEventListener(type, listener) {
        if (visualViewportListeners.get(type) === listener) visualViewportListeners.delete(type);
    },
};
window.__pmTheme.phoneScale = 1;
const resizeHandleListeners = new Map();
const resizeHandle = {
    addEventListener(type, listener) { resizeHandleListeners.set(type, listener); },
    removeEventListener(type, listener) {
        if (resizeHandleListeners.get(type) === listener) resizeHandleListeners.delete(type);
    },
};
const unbindPhoneResizeFixture = foundationDeps.bindPhoneResize(foundationPhone, resizeHandle);
const widthBeforeKeyboard = foundationPhoneStyleValues.get('--pm-phone-width');
window.visualViewport.height = 400;
visualViewportListeners.get('resize')();
assert.equal(foundationPhoneStyleValues.get('--pm-phone-width'), widthBeforeKeyboard, 'VisualViewport 键盘 resize 不得改变手机宽度');
assert.equal(foundationPhoneStyleValues.get('--pm-phone-height'), '328px', 'VisualViewport 键盘 resize 必须只压缩手机高度');
unbindPhoneResizeFixture();
assert.equal(resizeWindowListeners.has('resize'), false, '解绑必须移除 window resize 监听器');
assert.equal(visualViewportListeners.has('resize'), false, '解绑必须移除 VisualViewport resize 监听器');
delete window.visualViewport;
delete window.innerWidth;
delete window.innerHeight;
window.addEventListener = previousWindowAddEventListener;
window.removeEventListener = previousWindowRemoveEventListener;

window.__pmTheme.preset = 'pink';
window.__pmTheme.darkMode = 'dark';
foundationDeps.applyTheme();
assert.equal(foundationPhoneStyleValues.get('--pm-color-surface-page'), '#2B2B2B', '粉色夜间必须写入专属界面 token');
assert.equal(synchronizedDropdown.style.values.get('--pm-color-surface-page'), '#2B2B2B', '已存在模型浮层必须同步粉色夜间 token');
window.__pmTheme.preset = 'default';
window.__pmTheme.darkMode = 'light';
foundationDeps.applyTheme();
assert.equal(foundationPhoneStyleValues.has('--pm-color-surface-page'), false, '切换主题必须清除上一预设的专属界面 token');
assert.equal(synchronizedDropdown.style.values.has('--pm-color-surface-page'), false, '已存在模型浮层切换主题时必须清除旧预设 token');

window.__pmTheme.darkMode = 'light';
foundationDeps.applyTheme();
assert.equal(synchronizedDropdown.dataset.theme, 'light', '主题切换必须同步已存在的 body 级模型浮层');
assert.equal(foundationPhone['data-theme'], 'light');

// 自定义气泡色只影响气泡，不得改写全局强调色。
window.__pmTheme.customRight = '#123456';
foundationDeps.applyTheme();
assert.equal(foundationPhoneStyleValues.get('--pm-r-bg'), '#123456', '自定义右气泡色必须生效');
assert.equal(foundationPhoneStyleValues.get('--pm-color-accent'), '#1677d2', '自定义气泡色不得覆盖界面强调色');
delete window.__pmTheme.customRight;

window.__pmTheme.preset = 'default';
window.__pmTheme.darkMode = 'light';
foundationDeps.applyTheme();
assert.equal(foundationPhoneStyleValues.get('--pm-color-accent'), '#1677d2', '切回日间主题必须恢复默认强调色');
assert.equal(synchronizedDropdown.style.values.get('--pm-color-accent'), '#1677d2', '已存在模型浮层切回日间主题时必须恢复默认强调色');

window.__pmTheme.preset = 'frost';
foundationDeps.applyTheme();
assert.equal(foundationPhoneStyleValues.get('--pm-frost'), '1', '磨砂预设必须实际启用气泡玻璃效果');
window.__pmTheme = { ...window.__pmTheme, preset: 'custom', customAccent: '#c8647d', customRight: '', customLeft: '' };
foundationDeps.applyTheme();
assert.equal(foundationPhoneStyleValues.get('--pm-color-accent'), '#c8647d', '自定义主题色必须驱动界面强调色');
assert.equal(foundationPhoneStyleValues.get('--pm-r-bg'), '#c8647d', '自定义主题色必须同步默认右气泡色');
window.__pmTheme.customRight = '#123456';
foundationDeps.applyTheme();
assert.equal(foundationPhoneStyleValues.get('--pm-r-bg'), '#123456', '自定义右气泡必须覆盖主题色默认右气泡');
assert.equal(foundationPhoneStyleValues.get('--pm-color-accent'), '#c8647d', '自定义右气泡不得反向改写自定义主题色');

// 停止生成必须真正中止请求信号，并同步停止按钮可用性。
assert.equal(foundationDeps.cancelGeneration(), false, '没有进行中的生成时停止操作必须返回 false');
const cancellableTask = foundationDeps.beginGeneration('story');
assert.ok(cancellableTask, '有效会话必须能开始生成任务');
assert.equal(generationCancelButtons[0].hidden, false, '生成开始后停止按钮必须可见');
assert.equal(generationCancelButtons[0].disabled, false, '生成开始后停止按钮必须可用');
assert.equal(cancellableTask.signal.aborted, false, '新任务的中止信号初始必须未触发');
assert.equal(foundationDeps.cancelGeneration(), true, '生成进行中必须允许停止');
assert.equal(cancellableTask.signal.aborted, true, '停止生成必须中止请求信号');
assert.equal(cancellableTask.signal.reason, 'generation-cancelled-by-user', '停止生成必须携带用户取消原因');
// 取消后不得再被判定为可继续：后续渲染、落盘和注入都必须停下。
assert.equal(foundationDeps.isGenerationTaskActive(cancellableTask), false,
    '停止生成后任务不得再被判定为活跃，否则已返回的结果会继续渲染');
assert.equal(foundationDeps.finishGeneration(cancellableTask), true, '取消后的任务必须能正常收尾');
assert.equal(generationCancelButtons[0].hidden, true, '生成收尾后停止按钮必须隐藏');
assert.equal(generationCancelButtons[0].disabled, true, '生成收尾后停止按钮必须禁用');
assert.equal(foundationState.isGenerating, false, '取消收尾后必须释放生成状态');

window.__pmShowModelPicker();
assert.equal(uiElements.has('pm-model-dropdown'), false, '再次点击模型箭头必须关闭现有浮层');
assert.equal(documentClickListeners.size, lifecycleDocumentClickBaseline, '模型箭头关闭后必须只保留宿主生命周期监听器');

window.__pmShowModelPicker();
await new Promise(resolve => setTimeout(resolve, 0));
assert.equal(documentClickListeners.size, lifecycleDocumentClickBaseline + 1, '模型浮层必须在宿主监听器之外只增加一个关闭监听器');
dispatchDocumentClick({ id: 'outside-model-picker' });
assert.equal(uiElements.has('pm-model-dropdown'), false, '浮层外部点击必须关闭模型列表');
assert.equal(documentClickListeners.size, lifecycleDocumentClickBaseline, '外部点击关闭后必须注销模型浮层自身监听器');

window.__pmShowModelPicker();
window.__pmShowModelPicker();
await new Promise(resolve => setTimeout(resolve, 0));
assert.equal(uiElements.has('pm-model-dropdown'), false, '定时注册前由箭头关闭的浮层不得复活');
assert.equal(documentClickListeners.size, lifecycleDocumentClickBaseline, '定时注册前关闭不得留下延迟模型浮层监听器');

settingsRuntime.modelList = [];
uiElements.get('pm-api-status').textContent = '';
uiElements.get('pm-api-status').dataset.state = '';
window.__pmShowModelPicker();
assert.equal(uiElements.has('pm-model-dropdown'), false, '空模型列表不得创建浮层');
assert.equal(uiElements.get('pm-api-status').textContent, '请先拉取模型');
assert.equal(uiElements.get('pm-api-status').dataset.state, 'warning');
assert.equal(documentClickListeners.size, lifecycleDocumentClickBaseline);
settingsRuntime.modelList = ['model-alpha', 'model-beta'];

const originalFetch = globalThis.fetch;
const apiFetchCalls = [];
globalThis.fetch = async (url, options = {}) => {
    apiFetchCalls.push({ url, options });
    if (String(url).endsWith('/models')) return {
        ok: true,
        async json() { return { data: [{ id: 'model-zeta' }, { id: 'model-zeta' }, { id: 'model-eta' }] }; },
    };
    return {
        ok: true,
        async json() { return { choices: [{ message: { content: 'OK' } }] }; },
    };
};
uiElements.get('pm-cfg-model').value = '';
assert.equal(await window.__pmTestApi(uiElements.get('pm-api-fetch-models')), true);
assert.deepEqual(settingsRuntime.modelList, ['model-zeta', 'model-eta'], '模型拉取必须去重并过滤无效项');
assert.equal(uiElements.get('pm-cfg-model').value, 'model-zeta', '模型输入为空时应自动选中第一个可用模型');
assert.match(uiElements.get('pm-api-status').textContent, /已拉取 2 个模型/);
assert.equal(uiElements.get('pm-api-status').dataset.state, 'success', '模型拉取成功必须标记 success 状态');
assert.equal(uiElements.get('pm-api-fetch-models').disabled, false);
assert.equal(uiElements.get('pm-api-test-model').disabled, false);
assert.equal(apiFetchCalls[0].options.headers.Authorization, 'Bearer new-key');
assert.ok(apiFetchCalls[0].options.signal, '模型拉取必须支持超时取消');
assert.equal(await window.__pmTestModel(uiElements.get('pm-api-test-model')), true);
assert.match(uiElements.get('pm-api-status').textContent, /测试成功.*OK/);
assert.equal(uiElements.get('pm-api-status').dataset.state, 'success', '测试成功必须标记 success 状态');
assert.equal(apiFetchCalls[1].options.method, 'POST');
assert.equal(JSON.parse(apiFetchCalls[1].options.body).model, 'model-zeta');

const assertApiControlsRestored = () => {
    for (const id of ['pm-api-fetch-models', 'pm-api-test-model']) {
        const control = uiElements.get(id);
        assert.equal(control.disabled, false, `${id} 失败后必须恢复可用`);
        assert.equal(control['aria-busy'], undefined, `${id} 失败后必须移除 aria-busy`);
    }
};
const modelsBeforeApiFailures = structuredClone(settingsRuntime.modelList);
globalThis.fetch = async () => ({
    ok: false, status: 429,
    async text() { return JSON.stringify({ error: { message: 'rate limited' } }); },
});
assert.equal(await window.__pmTestApi(uiElements.get('pm-api-fetch-models')), false);
assert.match(uiElements.get('pm-api-status').textContent, /HTTP 429：rate limited/);
assert.equal(uiElements.get('pm-api-status').dataset.state, 'error', 'HTTP 失败必须标记 error 状态');
assert.deepEqual(settingsRuntime.modelList, modelsBeforeApiFailures, 'HTTP 失败不得污染已缓存模型');
assertApiControlsRestored();

globalThis.fetch = async () => ({ ok: true, async json() { return { data: [] }; } });
assert.equal(await window.__pmTestApi(uiElements.get('pm-api-fetch-models')), false);
assert.match(uiElements.get('pm-api-status').textContent, /接口未返回可用模型/);
assert.equal(uiElements.get('pm-api-status').dataset.state, 'error', '空模型列表必须标记 error 状态');
assertApiControlsRestored();

globalThis.fetch = async () => ({ ok: true, async json() { return { choices: [{ message: { content: '' } }] }; } });
assert.equal(await window.__pmTestModel(uiElements.get('pm-api-test-model')), false);
assert.match(uiElements.get('pm-api-status').textContent, /响应中没有可读取的文本/);
assert.equal(uiElements.get('pm-api-status').dataset.state, 'error', '空响应必须标记 error 状态');
assertApiControlsRestored();

globalThis.fetch = async () => { throw new TypeError('network unavailable'); };
assert.equal(await window.__pmTestApi(uiElements.get('pm-api-fetch-models')), false);
assert.match(uiElements.get('pm-api-status').textContent, /浏览器直连失败（TypeError），酒馆代理请求也失败（TypeError）/);
assert.equal(uiElements.get('pm-api-status').dataset.state, 'error', '网络错误必须标记 error 状态');
assertApiControlsRestored();

globalThis.fetch = async () => {
    const error = new Error('aborted by timeout');
    error.name = 'AbortError';
    throw error;
};
assert.equal(await window.__pmTestModel(uiElements.get('pm-api-test-model')), false);
assert.match(uiElements.get('pm-api-status').textContent, /请求超时/);
assert.equal(uiElements.get('pm-api-status').dataset.state, 'error', '请求超时必须标记 error 状态');
assertApiControlsRestored();

globalThis.fetch = originalFetch;

const lifecycleOverlay = uiElements.get('pm-overlay');
lifecycleCalls.length = 0;
foundationPhone.removed = false;
foundationState.phoneWindow = foundationPhone;
foundationState.phoneActive = true;
foundationState.activeStorageId = 'story';
foundationState.currentPersona = 'Alice';
foundationState.conversationHistory = [{ role: 'user', content: '切换前不得误存' }];
assert.equal(handleHostChatChanged({
    state: foundationState,
    runtime: foundationDeps.runtime,
    chatLength: 3,
    endPhone: window.__pmEnd,
}), 'closed');
assert.equal(lifecycleCalls.filter(call => call[0] === 'persist-history').length, 0,
    'CHAT_CHANGED 强制关闭不得保存旧聊天历史');
assert.equal(lifecycleCalls.filter(call => call[0] === 'persist-phone-ui').length, 0,
    'CHAT_CHANGED 强制关闭不得保存旧聊天的 Phone UI snapshot');
assert.equal(foundationState.phoneActive, false);
assert.equal(foundationState.phoneWindow, null);
assert.deepEqual(foundationState.conversationHistory, []);
assert.equal(foundationState.activeStorageId, '');
assert.equal(foundationState.currentPersona, '');

lifecycleCalls.length = 0;
foundationPhone.removed = false;
foundationState.phoneWindow = foundationPhone;
foundationState.phoneActive = true;
foundationState.activeStorageId = 'story';
foundationState.currentPersona = 'Alice';
foundationState.conversationHistory = [{ role: 'user', content: '普通关闭应保存' }];
window.__pmEnd(false);
assert.equal(lifecycleCalls.filter(call => call[0] === 'persist-history').length, 1,
    '普通关闭必须保存当前聊天历史');
assert.equal(lifecycleCalls.filter(call => call[0] === 'persist-phone-ui').length, 1,
    '普通关闭必须保存当前 Phone UI snapshot');
if (lifecycleOverlay) {
    lifecycleOverlay.removed = false;
    uiElements.set('pm-overlay', lifecycleOverlay);
}
const originalLifecycleCreateElement = document.createElement;
const originalLifecycleAppendChild = document.body.appendChild;
const originalLifecycleSetTimeout = globalThis.setTimeout;
const originalLifecycleSetInterval = globalThis.setInterval;
const originalLifecycleClearInterval = globalThis.clearInterval;
const originalLifecycleGetComputedStyle = globalThis.getComputedStyle;
const originalLifecycleWindowAddEventListener = window.addEventListener;
const originalLifecycleWindowRemoveEventListener = window.removeEventListener;
const lifecycleTimers = new Map();
const lifecycleTimeoutCallbacks = [];
const lifecyclePhoneListeners = new Map();
const lifecycleDisarmReasons = [];
const lifecycleStatusClock = { textContent: '' };
const lifecycleStatusBar = {
    hidden: true,
    querySelector(selector) { return selector === '.pm-status-time' ? lifecycleStatusClock : null; },
};
const activeLifecycleTimers = delay => [...lifecycleTimers.values()]
    .filter(timer => timer.delay === delay);
const lifecyclePhone = {
    id: '', dataset: {}, innerHTML: '', removed: false,
    style: { setProperty() {}, removeProperty() {} },
    classList: { toggle() {}, remove() {} },
    setAttribute(name, value) { this[name] = value; },
    showPopover() {}, hidePopover() {}, remove() { this.removed = true; },
    querySelector(selector) {
        if (selector === '.pm-status-bar') return lifecycleStatusBar;
        const control = { disabled: false, addEventListener(type, listener) { lifecyclePhoneListeners.set(`${selector}:${type}`, listener); }, removeEventListener() {}, setPointerCapture() {} };
        return control;
    },
};
const lifecycleFixtureState = {
    phoneWindow: null, phoneActive: false, isMinimized: false, isSelectMode: false,
    activeStorageId: '', currentPersona: '', conversationHistory: [], isGroupChat: false,
    groupMembers: [], groupExtras: [], groupColorMap: {}, groupDisplayName: '',
    groupRandomNpcEnabled: false, groupNature: '', currentGroupKey: '', isGenerating: false,
};
let lifecycleHookCalls = 0;
const lifecycleFixtureDeps = {
    runtime: createRuntimeState(), getCtx: () => ({ registerSlashCommand() {} }),
    getStorageId: () => 'story', getUserPersona: () => ({ name: '用户' }),
    loadGroupMeta: async () => ({}),
    applyBidirectionalInjection: () => {}, clearBidirectionalInjection: () => {},
    persistCurrentHistory: () => {}, persistPhoneUiSnapshot: () => {},
    applyBackground: () => {}, applyTheme: () => {}, applyPhoneScale: () => {},
    bindIsland: () => () => {}, bindPhoneResize: () => () => {}, bindPhonePageUi: () => {},
    migrateOldHistory: () => {}, hookGenerationEvent: () => { lifecycleHookCalls += 1; }, invalidateGeneration: () => {},
    disarmAutoPoke: reason => lifecycleDisarmReasons.push(reason), syncGenerationControls: () => {}, closeOverlay: () => {},
    closeControlCenter: () => {}, refreshReplyCardAvailability: () => {}, clearActiveQuote: () => {},
    restorePhoneChat: async () => true, restorePhoneUi: async () => {},
};
try {
    document.createElement = tag => { assert.equal(tag, 'div'); return lifecyclePhone; };
    document.body.appendChild = element => element;
    globalThis.setTimeout = callback => { lifecycleTimeoutCallbacks.push(callback); return lifecycleTimeoutCallbacks.length; };
    globalThis.setInterval = (callback, delay) => {
        const timer = { callback, delay };
        lifecycleTimers.set(timer, timer);
        return timer;
    };
    globalThis.clearInterval = timer => {
        assert.equal(lifecycleTimers.delete(timer), true,
            '生命周期只能清理仍在运行的定时器');
    };
    globalThis.getComputedStyle = () => ({ display: 'flex', visibility: 'visible', opacity: '1' });
    window.addEventListener = () => {};
    window.removeEventListener = () => {};
    const lifecycleFailureState = {
        ...lifecycleFixtureState, groupMembers: [], groupExtras: [], groupColorMap: {}, conversationHistory: [],
    };
    const lifecycleFailureDeps = {
        ...lifecycleFixtureDeps, runtime: createRuntimeState(), applyPhoneScale: () => { throw new Error('fixture-open-failed'); },
    };
    let rejectInitialGroupMeta;
    lifecycleFailureDeps.loadGroupMeta = () => new Promise((resolve, reject) => { rejectInitialGroupMeta = reject; });
    lifecycleFailureDeps.runtime.firstOpen = false;
    const hookCallsBeforeFailureInstall = lifecycleHookCalls;
    installPhoneLifecycle(lifecycleFailureState, lifecycleFailureDeps);
    assert.equal(lifecycleHookCalls, hookCallsBeforeFailureInstall + 1,
        '生命周期安装必须立即注册宿主事件，不能等本地存储恢复后才监听首个分支 CHAT_CHANGED');
    assert.equal(lifecycleTimeoutCallbacks.length, 1, '生命周期安装必须安排一次有限的宿主事件延迟重试');
    lifecycleTimeoutCallbacks.shift()();
    assert.equal(lifecycleHookCalls, hookCallsBeforeFailureInstall + 2,
        '延迟宿主事件重试不得等待群组元数据恢复完成');
    rejectInitialGroupMeta(new Error('fixture-group-meta-failed'));
    await Promise.resolve();
    await Promise.resolve();
    window.__pmTheme = structuredClone(baseTheme);
    await assert.rejects(window.__pmOpen(), /fixture-open-failed/);
    assert.equal(lifecycleTimers.size, 0, '同步打开初始化失败时不得启动任何定时器');
    assert.equal(lifecycleFailureDeps.runtime.visibilityTimer, null, '同步打开初始化失败后不得残留可见性巡检状态');
    lifecycleFixtureDeps.runtime.firstOpen = false;
    const hookCallsBeforeSuccessInstall = lifecycleHookCalls;
    installPhoneLifecycle(lifecycleFixtureState, lifecycleFixtureDeps);
    assert.equal(lifecycleHookCalls, hookCallsBeforeSuccessInstall + 1,
        '每个独立 runtime 安装时都必须同步尝试注册宿主事件');
    window.__pmTheme = structuredClone(baseTheme);
    await window.__pmOpen();
    assert.equal(activeLifecycleTimers(2000).length, 1, '成功打开必须且只能启动一个可见性巡检定时器');
    assert.ok(lifecycleTimers.has(lifecycleFixtureDeps.runtime.visibilityTimer),
        '可见性巡检必须保存仍在运行的定时器');
    await window.__pmOpen();
    assert.equal(activeLifecycleTimers(2000).length, 1, '重复打开既有手机不得重复启动可见性巡检');
    assert.equal(window.__pmSetAmbientStatus(true), true, '状态栏启用必须保存设置并启动时钟');
    assert.equal(activeLifecycleTimers(30000).length, 1, '启用状态栏必须只启动一个 30 秒时钟');
    const firstAmbientTimer = activeLifecycleTimers(30000)[0];
    window.__pmToggleMin();
    assert.ok(lifecycleDisarmReasons.includes('phone-minimized'), '最小化必须解除自动戳一戳');
    assert.equal(activeLifecycleTimers(30000).length, 0, '最小化必须清理环境状态时钟');
    assert.equal(activeLifecycleTimers(2000).length, 1, '最小化不得停止可见性巡检');
    window.__pmToggleMin();
    assert.equal(activeLifecycleTimers(30000).length, 1, '从最小化恢复必须重新启动环境状态时钟');
    assert.notEqual(activeLifecycleTimers(30000)[0], firstAmbientTimer,
        '从最小化恢复必须创建新的环境状态时钟');
    window.__pmEnd(true);
    assert.ok(lifecycleDisarmReasons.includes('phone-closed'), '关闭手机必须解除自动戳一戳');
    assert.equal(lifecycleTimers.size, 0, '关闭手机必须清理所有本轮创建的定时器');
    assert.equal(lifecycleFixtureDeps.runtime.visibilityTimer, null, '关闭手机后可见性巡检状态必须恢复为空');
} finally {
    document.createElement = originalLifecycleCreateElement;
    document.body.appendChild = originalLifecycleAppendChild;
    globalThis.setTimeout = originalLifecycleSetTimeout;
    globalThis.setInterval = originalLifecycleSetInterval;
    globalThis.clearInterval = originalLifecycleClearInterval;
    if (originalLifecycleGetComputedStyle === undefined) delete globalThis.getComputedStyle; else globalThis.getComputedStyle = originalLifecycleGetComputedStyle;
    window.addEventListener = originalLifecycleWindowAddEventListener;
    window.removeEventListener = originalLifecycleWindowRemoveEventListener;
}



window.__pmTheme = structuredClone(baseTheme);
uiElements.get('pm-custom-title').value = '  雨夜电台  ';
assert.equal(window.__pmSetCustomTitle(), true);
assert.equal(window.__pmTheme.customTitle, '雨夜电台');
assert.equal(JSON.parse(localValues.get('ST_SMS_THEME')).customTitle, '雨夜电台');
assert.equal(appliedThemes.at(-1).customTitle, '雨夜电台');

let quickReplyPageRefreshes = 0;
window.__pmShowConfig = async page => { assert.equal(page, 'quick-reply'); quickReplyPageRefreshes += 1; };
window.__pmTheme = structuredClone(baseTheme);
localValues.set('ST_SMS_THEME', JSON.stringify(window.__pmTheme));
uiElements.get('pm-quick-reply-label').value = '保存失败入口';
const blockedQuickReplyApi = createQuickReplyApiFixture();
globalThis.quickReplyApi = blockedQuickReplyApi;
localStorageControl.failSet.add('ST_SMS_THEME');
assert.equal(await window.__pmEnsurePhoneQuickReply(), false);
assert.equal(window.__pmTheme.qrLabel, '天音', '名称保存失败必须回滚内存主题');
assert.equal(blockedQuickReplyApi.calls.length, 0, '名称保存失败时不得调用宿主 Quick Reply mutation');
assert.match(uiAlerts.at(-1), /手机开关名称保存失败/);

window.__pmTheme = structuredClone(baseTheme);
localValues.set('ST_SMS_THEME', JSON.stringify(window.__pmTheme));
uiElements.get('pm-quick-reply-label').value = '宿主失败入口';
const failedQuickReplyApi = createQuickReplyApiFixture({ fail: { createQuickReply: 'host-qr-failed' } });
globalThis.quickReplyApi = failedQuickReplyApi;
assert.equal(await window.__pmEnsurePhoneQuickReply(), false);
assert.equal(window.__pmTheme.qrLabel, '天音', '宿主更新失败必须回滚内存主题名称');
assert.equal(JSON.parse(localValues.get('ST_SMS_THEME')).qrLabel, '天音', '宿主更新失败必须回滚持久化主题名称');
assert.equal(failedQuickReplyApi.calls.filter(call => call[0] === 'createQuickReply').length, 1);
assert.match(uiAlerts.at(-1), /host-qr-failed/);

window.__pmTheme = structuredClone(baseTheme);
localValues.set('ST_SMS_THEME', JSON.stringify(window.__pmTheme));
uiElements.get('pm-quick-reply-label').value = '回滚失败入口';
const failedRollbackQuickReplyApi = createQuickReplyApiFixture({ fail: { createQuickReply: 'host-rollback-trigger' } });
globalThis.quickReplyApi = failedRollbackQuickReplyApi;
const nextThemeWrite = localStorageControl.setCalls.get('ST_SMS_THEME') || 0;
localStorageControl.failSetOnCalls.set('ST_SMS_THEME', new Set([nextThemeWrite + 2]));
assert.equal(await window.__pmEnsurePhoneQuickReply(), false);
assert.equal(window.__pmTheme.qrLabel, '天音', '回滚持久化失败时仍必须恢复内存主题');
assert.equal(JSON.parse(localValues.get('ST_SMS_THEME')).qrLabel, '回滚失败入口', '回滚写入失败必须保留可诊断的实际持久化状态');
assert.match(uiAlerts.at(-1), /名称配置回滚失败/);

window.__pmTheme = structuredClone(baseTheme);
localValues.set('ST_SMS_THEME', JSON.stringify(window.__pmTheme));
uiElements.get('pm-quick-reply-label').value = '😀😁😂😃😄😅😆';
const successfulQuickReplyApi = createQuickReplyApiFixture();
globalThis.quickReplyApi = successfulQuickReplyApi;
assert.equal(await window.__pmEnsurePhoneQuickReply(), true);
assert.equal(window.__pmTheme.qrLabel, '😀😁😂😃😄😅');
assert.equal(JSON.parse(localValues.get('ST_SMS_THEME')).qrLabel, '😀😁😂😃😄😅');
assert.equal(successfulQuickReplyApi.getSetByName(PHONE_QR_SET_NAME).qrList[0].label, '😀😁😂😃😄😅');
assert.equal(uiElements.get('pm-quick-reply-label').value, '😀😁😂😃😄😅');
assert.equal(quickReplyPageRefreshes, 1, '成功后必须刷新 Quick Reply 设置状态');
assert.match(uiNotes.at(-1), /😀😁😂😃😄😅/);
delete globalThis.quickReplyApi;

window.__pmProfiles = [{ apiUrl: 'https://old.example', apiKey: 'old-key', model: 'old-model' }];
localStorageControl.failSet.add('ST_SMS_API_PROFILES');
assert.equal(window.__pmDeleteProfile(0), false);
assert.equal(window.__pmProfiles.length, 1);
assert.match(uiAlerts.at(-1), /档案删除失败/);
let profilePageRefreshes = 0;
window.__pmShowConfig = page => { assert.equal(page, 'api'); profilePageRefreshes += 1; };
assert.equal(window.__pmDeleteProfile(0), true);
assert.deepEqual(JSON.parse(localValues.get('ST_SMS_API_PROFILES')), []);
assert.equal(profilePageRefreshes, 1);

window.__pmConfig = { apiUrl: 'https://old.example', apiKey: 'old-key', model: 'old-model', temperature: 1.2, useIndependent: false };
window.__pmProfiles = [{ apiUrl: 'https://old.example', apiKey: 'old-key', model: 'old-model', temperature: 1.2 }];
localValues.set('ST_SMS_API_PROFILES', JSON.stringify(window.__pmProfiles));
localValues.set('ST_SMS_CONFIG', JSON.stringify(window.__pmConfig));
localStorageControl.failSet.add('ST_SMS_CONFIG');
assert.equal(window.__pmSaveConfig(), false);
assert.equal(window.__pmConfig.apiUrl, 'https://old.example');
assert.equal(uiElements.get('pm-overlay').removed, false);
assert.match(uiAlerts.at(-1), /API 配置保存失败/);

uiElements.get('pm-overlay').removed = false;
localStorageControl.failSet.add('ST_SMS_API_PROFILES');
assert.equal(window.__pmSaveConfig(), true);
assert.equal(window.__pmConfig.apiUrl, 'https://new.example');
assert.equal(JSON.parse(localValues.get('ST_SMS_CONFIG')).apiUrl, 'https://new.example');
assert.equal(window.__pmProfiles.length, 1);
assert.equal(window.__pmProfiles[0].apiUrl, 'https://old.example');
assert.equal(uiElements.get('pm-overlay').removed, true);
assert.match(uiNotes.at(-1), /API 设置已保存；档案列表保存失败/,
    '档案列表保存失败不得回滚已经持久化的当前 API 配置');

uiElements.get('pm-overlay').removed = false;
window.__pmProfiles = [{ apiUrl: 'https://profile.example/v1', apiKey: 'profile-key', model: 'profile-model', temperature: 0.4 }];
window.__pmPickProfile(0);
assert.equal(uiElements.get('pm-indep-profile-fields').hidden, false);
assert.equal(uiElements.get('pm-indep-config-fields').hidden, false);
assert.equal(uiElements.get('pm-cfg-url').value, 'https://profile.example/v1');
assert.equal(uiElements.get('pm-cfg-key').value, 'profile-key');
assert.equal(uiElements.get('pm-cfg-model').value, 'profile-model');
assert.equal(uiElements.get('pm-cfg-temperature').value, '0.4');
assert.equal(uiElements.get('pm-mode-main').classList.contains('pm-mode-active'), false);
assert.equal(uiElements.get('pm-mode-indep').classList.contains('pm-mode-active'), true);
assert.equal(uiElements.get('pm-mode-tip').textContent, '独立 API 必须填写地址、密钥和模型');
assert.equal(window.__pmSaveConfig(), true);
assert.equal(window.__pmConfig.apiUrl, 'https://profile.example/v1');
assert.equal(window.__pmConfig.temperature, 0.4);
assert.equal(window.__pmConfig.useIndependent, true, '选择独立 API 档案后保存必须启用独立路由');
assert.equal(JSON.parse(localValues.get('ST_SMS_CONFIG')).temperature, 0.4);
assert.equal(JSON.parse(localValues.get('ST_SMS_CONFIG')).useIndependent, true);
assert.equal(JSON.parse(localValues.get('ST_SMS_API_PROFILES')).some(profile => profile.apiUrl === 'https://profile.example/v1' && profile.temperature === 0.4), true);
assert.equal(uiElements.get('pm-overlay').removed, true);
assert.match(uiNotes.at(-1), /独立API/);

uiElements.get('pm-overlay').removed = false;
uiElements.get('pm-cfg-temperature').value = '2.1';
const configBeforeInvalidTemperature = structuredClone(window.__pmConfig);
assert.equal(window.__pmSaveConfig(), false);
assert.deepEqual(window.__pmConfig, configBeforeInvalidTemperature, '非法温度不得修改内存配置');
assert.equal(uiElements.get('pm-overlay').removed, false, '非法温度不得关闭设置弹窗');
assert.match(uiElements.get('pm-api-status').textContent, /温度必须是 0 到 2/);
uiElements.get('pm-cfg-temperature').value = '0';

uiElements.get('pm-overlay').removed = false;
window.__pmSetMode(false);
assert.equal(uiElements.get('pm-indep-profile-fields').hidden, true);
assert.equal(uiElements.get('pm-indep-config-fields').hidden, true);
assert.equal(uiElements.get('pm-mode-main').classList.contains('pm-mode-active'), true);
assert.equal(uiElements.get('pm-mode-indep').classList.contains('pm-mode-active'), false);
assert.equal(uiElements.get('pm-mode-tip').textContent, '默认使用酒馆 API 预设');
assert.equal(window.__pmSaveConfig(), true);
assert.equal(window.__pmConfig.temperature, 0, '主 API 保存不得把合法温度 0 回退为默认值');
assert.equal(window.__pmConfig.useIndependent, false, '用户手动切回主 API 后必须保留明确选择');
assert.equal(JSON.parse(localValues.get('ST_SMS_CONFIG')).useIndependent, false);
assert.match(uiNotes.at(-1), /主API/);
const mainApiSettingsHtml = renderApiSettings({ cfg: { apiUrl: '', apiKey: '', model: '', temperature: '1.2' }, useIndependent: false, profilesHtml: '' });
const independentApiSettingsHtml = renderApiSettings({ cfg: { apiUrl: '', apiKey: '', model: '', temperature: '1.2' }, useIndependent: true, profilesHtml: '' });
assert.match(mainApiSettingsHtml, /id="pm-indep-config-fields"[^>]* hidden/);
assert.doesNotMatch(independentApiSettingsHtml, /id="pm-indep-config-fields"[^>]* hidden/);
assert.match(independentApiSettingsHtml, /id="pm-cfg-temperature"[^>]*min="0" max="2" step="0\.1"[^>]*value="1\.2"/);

window.__pmProfiles = [{ apiUrl: 'https://legacy.example/v1', apiKey: 'legacy-key', model: 'legacy-model' }];
window.__pmPickProfile(0);
assert.equal(uiElements.get('pm-cfg-temperature').value, '1.2', '旧档案缺少温度时必须回填默认值');

const budgetDefaults = { targetTokens: 1000, sourceWeights: { phone: 1, community: 1, calendar: 1, todayTrend: 1 }, sourcePriority: ['phone', 'community', 'calendar', 'todayTrend'], redistributeUnused: true };
const normalizeBudgetFixture = value => ({ ...budgetDefaults, ...value, sourceWeights: { ...budgetDefaults.sourceWeights, ...value?.sourceWeights } });
const budgetFields = {
    'pm-budget-target': { value: '2400' },
    'pm-budget-phone-weight': { value: '25', dataset: { initialValue: '25' } },
    'pm-budget-community-weight': { value: '25', dataset: { initialValue: '25' } },
    'pm-budget-calendar-weight': { value: '25', dataset: { initialValue: '25' } },
    'pm-budget-today-trend-weight': { value: '25', dataset: { initialValue: '25' } },
    'pm-budget-priority': { value: 'phone' },
    'pm-budget-redistribute': { classList: makeClassList(['is-checked']) },
};
for (const [id, element] of Object.entries(budgetFields)) uiElements.set(id, element);
const budgetPersisted = [];
const budgetConfigBeforeInjectionFailureChecks = structuredClone(window.__pmBudgetConfig);
let budgetInjectionResult;
let budgetNotes = 0;
let budgetPageRefreshes = 0;
const budgetController = createBudgetController({
    normalizeBudgetConfig: normalizeBudgetFixture,
    resolveBudgetPercentageInput: ({ sourceWeights }) => sourceWeights,
    saveBudgetConfig: candidate => {
        const persisted = structuredClone(candidate);
        budgetPersisted.push(persisted);
        window.__pmBudgetConfig = structuredClone(persisted);
        return true;
    },
    requireInjectionSuccess: createInjectionResultGuard(),
    applyBidirectionalInjection: async () => {
        if (budgetInjectionResult instanceof Error) throw budgetInjectionResult;
        return budgetInjectionResult;
    },
    addNote: () => { budgetNotes += 1; },
    showBudget: () => { budgetPageRefreshes += 1; },
});
const assertBudgetInjectionFailure = async (action, result, expectedMessage) => {
    budgetInjectionResult = result;
    const persistedBefore = budgetPersisted.length;
    const notesBefore = budgetNotes;
    const refreshesBefore = budgetPageRefreshes;
    uiElements.get('pm-overlay').removed = false;
    assert.equal(await budgetController[action](), false, `${action} 注入刷新失败必须显式失败`);
    assert.equal(budgetPersisted.length, persistedBefore + 1, `${action} 注入失败前的配置必须已经持久化`);
    assert.deepEqual(window.__pmBudgetConfig, budgetPersisted.at(-1), `${action} 注入失败不得回滚已持久化的内存配置`);
    assert.equal(uiElements.get('pm-overlay').removed, false, `${action} 注入失败不得关闭 overlay`);
    assert.equal(budgetNotes, notesBefore, `${action} 注入失败不得记录成功提示`);
    assert.equal(budgetPageRefreshes, refreshesBefore, `${action} 注入失败不得刷新预算页面`);
    assert.match(uiAlerts.at(-1), expectedMessage, `${action} 必须暴露可诊断的注入失败原因`);
};
for (const [result, expected] of [
    [new Error('injected-refresh-failure'), /injected-refresh-failure/],
    [{ failedWrites: 1 }, /1 项写入失败/],
    [{ failedKeys: ['PHONE_SMS_MEMORY'] }, /1 项清理失败/],
]) {
    await assertBudgetInjectionFailure('save', result, expected);
    await assertBudgetInjectionFailure('reset', result, expected);
}
budgetInjectionResult = undefined;
uiElements.get('pm-overlay').removed = false;
const successfulBudgetSaves = budgetPersisted.length;
assert.equal(await budgetController.save(), true, '预算保存的成功注入刷新必须保持成功');
assert.equal(budgetPersisted.length, successfulBudgetSaves + 1);
assert.equal(budgetPersisted.at(-1).targetTokens, 2400, '预算保存必须持久化当前表单候选值');
assert.equal(uiElements.get('pm-overlay').removed, true, '预算保存成功必须关闭 overlay');
assert.equal(budgetNotes > 0, true, '预算保存成功必须记录成功提示');
const successfulBudgetResets = budgetPersisted.length;
assert.equal(await budgetController.reset(), true, '预算重置的成功注入刷新必须保持成功');
assert.equal(budgetPersisted.length, successfulBudgetResets + 1);
assert.deepEqual(budgetPersisted.at(-1), normalizeBudgetFixture(), '预算重置必须持久化默认候选值');
assert.deepEqual(window.__pmBudgetConfig, budgetPersisted.at(-1), '预算重置成功必须同步内存配置');
assert.equal(budgetPageRefreshes, 1, '预算重置成功必须刷新预算页面');
window.__pmBudgetConfig = budgetConfigBeforeInjectionFailureChecks;
delete globalThis.document;
delete globalThis.alert;

const promptCalls = [];
const injectionRuntime = { trackedExtensionPromptKeys: new Set(['PHONE_SMS_MEMORY:stale']) };
applyContextInjections({
    context: { setExtensionPrompt: (...args) => promptCalls.push(args) },
    runtime: injectionRuntime,
    currentStorageId: 'story',
    currentActorName: 'C',
    injectionConfig: { position: 2, depth: 4, historyLimit: 1 },
    selectedByStorage: { story: ['__group_closed', '__group_open'] },
    historiesByStorage: {
        story: {
            __group_closed: [{ role: 'assistant', content: '绝密关闭内容' }],
            __group_open: [{
                role: 'user', content: '允许注入内容',
                quote: {
                    messageId: 'msg_open', bubbleId: 'bubble_open', sender: 'C', text: '被引用的群聊内容',
                },
            }],
        },
    },
    groupsByStorage: {
        story: {
            __group_closed: normalizeGroupMeta({ name: '关闭群', members: ['C', 'B'], injection: { position: -1 } }),
            __group_open: normalizeGroupMeta({ name: '开放群', members: ['C', 'D'], injection: { position: 2, depth: 4, historyLimit: 1 } }),
        },
    },
    budgetConfig: {
        targetTokens: 3000,
        sourceWeights: { phone: 1, community: 0, calendar: 0, todayTrend: 0 },
        redistributeUnused: true,
    },
    userName: '用户', emojis: [],
});
assert.equal(promptCalls.some(call => String(call[1]).includes('绝密关闭内容')), true,
    '全局规则启用后不得继续读取旧群聊的 position=-1');
const openCall = promptCalls.find(call => String(call[1]).includes('允许注入内容'));
assert.ok(openCall);
assert.match(String(openCall[1]), /开放群/);
assert.match(String(openCall[1]), /C[、,，\s]+D|成员[^\n]*C[^\n]*D/);
assert.match(String(openCall[1]), /引用 C 的消息：“被引用的群聊内容”/, '记忆注入必须保留引用发送者和快照');
assert.equal(openCall[2], 2);
assert.equal(openCall[3], 4);
assert.doesNotMatch(String(openCall[1]), /被统一范围裁掉的旧内容/);
assert.ok(promptCalls.some(call => call[0] === 'PHONE_SMS_MEMORY:stale' && call[1] === ''));

const idbValues = new Map();
const idbOperations = [];
const idbControl = {
    abortAll: true,
    abortOperations: [],
    blockOperations: [],
};
function consumeIDBBlock(type, key) {
    const index = idbControl.blockOperations.findIndex(rule => rule.type === type && rule.key === key);
    if (index < 0) return null;
    return idbControl.blockOperations.splice(index, 1)[0];
}
function blockIDBOperation(type, key) {
    let enter;
    let release;
    const entered = new Promise(resolve => { enter = resolve; });
    const pending = new Promise(resolve => { release = resolve; });
    idbControl.blockOperations.push({ type, key, enter, pending });
    return { entered, release };
}
function consumeIDBAbort(type, key) {
    if (idbControl.abortAll) return true;
    const index = idbControl.abortOperations.findIndex(rule => rule.type === type && rule.key === key);
    if (index < 0) return false;
    idbControl.abortOperations.splice(index, 1);
    return true;
}
globalThis.indexedDB = {
    open() {
        const request = {};
        queueMicrotask(() => {
            request.result = {
                objectStoreNames: { contains: () => true },
                transaction() {
                    const transaction = {};
                    transaction.objectStore = () => ({
                        put(value, key) {
                            idbOperations.push({ type: 'put', key });
                            queueMicrotask(async () => {
                                const block = consumeIDBBlock('put', key);
                                if (block) { block.enter(); await block.pending; }
                                if (consumeIDBAbort('put', key)) {
                                    transaction.onabort?.();
                                    return;
                                }
                                idbValues.set(key, structuredClone(value));
                                transaction.oncomplete?.();
                            });
                        },
                        get(key) {
                            const getRequest = {};
                            queueMicrotask(() => {
                                if (consumeIDBAbort('get', key)) {
                                    transaction.onabort?.();
                                    return;
                                }
                                getRequest.result = idbValues.has(key)
                                    ? structuredClone(idbValues.get(key))
                                    : undefined;
                                getRequest.onsuccess?.();
                                transaction.oncomplete?.();
                            });
                            return getRequest;
                        },
                        getAllKeys() {
                            const keysRequest = {};
                            queueMicrotask(() => {
                                keysRequest.result = [...idbValues.keys()];
                                keysRequest.onsuccess?.();
                                transaction.oncomplete?.();
                            });
                            return keysRequest;
                        },
                        delete(key) {
                            idbOperations.push({ type: 'delete', key });
                            queueMicrotask(() => {
                                if (consumeIDBAbort('delete', key)) {
                                    transaction.onabort?.();
                                    return;
                                }
                                idbValues.delete(key);
                                transaction.oncomplete?.();
                            });
                        },
                    });
                    return transaction;
                },
                close() {},
            };
            request.onsuccess?.();
        });
        return request;
    },
};
assert.equal(await pmIDBSet('abort-test', { value: 1 }), false);
assert.equal(await pmIDBGet('abort-test'), null);
assert.equal(await pmIDBDel('abort-test'), false);
idbControl.abortAll = false;

const previousDeleteConfirm = globalThis.confirm;
const previousDeleteAlert = globalThis.alert;
const previousDeleteDocument = globalThis.document;
const previousDirectoryResizeObserver = globalThis.ResizeObserver;
const previousDirectoryWindowDescriptors = new Map(Object.getOwnPropertyNames(window)
    .filter(key => key.startsWith('__pm'))
    .map(key => [key, Object.getOwnPropertyDescriptor(window, key)]));
const deleteAlerts = [];
const directoryDeleteButtons = [{ disabled: false }, { disabled: false }];
globalThis.alert = message => deleteAlerts.push(String(message));
globalThis.document = {
    getElementById: () => null,
    querySelectorAll: selector => selector === '.pm-entity-delete' ? directoryDeleteButtons : [],
};
const resizeObserverRecords = [];
globalThis.ResizeObserver = class {
    constructor(callback) {
        this.callback = callback;
        this.observed = [];
        this.disconnectCalls = 0;
        resizeObserverRecords.push(this);
    }
    observe(target) { this.observed.push(target); }
    disconnect() { this.disconnectCalls += 1; }
};

function directoryRuntimeSnapshot(state) {
    return {
        activeStorageId: state.activeStorageId,
        currentPersona: state.currentPersona,
        conversationHistory: structuredClone(state.conversationHistory),
        isGroupChat: state.isGroupChat,
        currentGroupKey: state.currentGroupKey,
        groupMembers: state.groupMembers.slice(),
        groupExtras: state.groupExtras.slice(),
        groupDisplayName: state.groupDisplayName,
        groupRandomNpcEnabled: state.groupRandomNpcEnabled,
        groupNature: state.groupNature,
        groupColorMap: { ...state.groupColorMap },
    };
}

function directoryDeleteStores() {
    return {
        histories: {
            story: {
                Alice: [{ role: 'assistant', content: 'contact history' }],
                __group_team: [{ role: 'assistant', content: 'group history' }],
            },
        },
        groupMeta: {
            story: {
                __group_team: normalizeGroupMeta({ name: '测试群', members: ['Alice', 'Bob'] }),
            },
        },
        bidirectional: { story: ['Alice', '__group_team'] },
        poke: { story: { Alice: { interval: 2 }, __group_team: { interval: 3 } } },
        backgrounds: { story_Alice: '#111111', story___group_team: '#222222' },
    };
}

function createDirectoryDeleteFixture({
    currentPersona = 'Alice', currentGroupKey = '__group_team', includeCurrentGroup = false,
    withoutOtherConversations = false,
    coordinateInjectionMutations = false,
    injectionResults = [],
} = {}) {
    const runtime = createRuntimeState();
    const stores = directoryDeleteStores();
    if (includeCurrentGroup) {
        stores.histories.story.__group_current = [{ role: 'assistant', content: 'current group history' }];
        stores.groupMeta.story.__group_current = normalizeGroupMeta({ name: '当前群', members: ['Carol', 'Dave'] });
        stores.bidirectional.story.push('__group_current');
        stores.poke.story.__group_current = { interval: 4 };
        stores.backgrounds.story___group_current = '#333333';
    }
    if (withoutOtherConversations) {
        delete stores.histories.story.__group_team;
        delete stores.groupMeta.story.__group_team;
        stores.bidirectional.story = stores.bidirectional.story.filter(key => key !== '__group_team');
        delete stores.poke.story.__group_team;
        delete stores.backgrounds.story___group_team;
    }
    const currentGroupState = includeCurrentGroup ? {
        currentPersona: '',
        currentGroupKey: '__group_current',
        groupMembers: ['Carol', 'Dave'],
        groupExtras: ['当前群旁观者'],
        groupDisplayName: '当前群',
        groupRandomNpcEnabled: true,
        groupNature: '当前群性质',
        groupColorMap: { Carol: '#333333', Dave: '#444444' },
    } : null;
    const phoneElements = {
        name: { textContent: '' },
        poke: {
            classes: new Set(),
            classList: {
                add(name) { phoneElements.poke.classes.add(name); },
                remove(name) { phoneElements.poke.classes.delete(name); },
                contains(name) { return phoneElements.poke.classes.has(name); },
            },
        },
        list: { innerHTML: '' },
    };
    const phoneWindow = {
        querySelector: selector => ({ '.pm-name': phoneElements.name, '.pm-name-edit': phoneElements.poke, '.pm-msg-list': phoneElements.list }[selector] || null),
    };
    const state = {
        activeStorageId: 'story',
        currentPersona: currentGroupState?.currentPersona ?? currentPersona,
        conversationHistory: [{ role: 'assistant', content: 'current conversation' }],
        isGroupChat: !!(currentGroupState?.currentGroupKey ?? currentGroupKey),
        currentGroupKey: currentGroupState?.currentGroupKey ?? currentGroupKey,
        groupMembers: currentGroupState?.groupMembers ?? ['Alice', 'Bob'],
        groupExtras: currentGroupState?.groupExtras ?? ['旁观者'],
        groupDisplayName: currentGroupState?.groupDisplayName ?? '测试群',
        groupRandomNpcEnabled: currentGroupState?.groupRandomNpcEnabled ?? true,
        groupNature: currentGroupState?.groupNature ?? '测试群性质',
        groupColorMap: currentGroupState?.groupColorMap ?? { Alice: '#111111', Bob: '#222222' },
        phoneWindow,
    };
    window.__pmHistories = structuredClone(stores.histories);
    window.__pmGroupMeta = structuredClone(stores.groupMeta);
    window.__pmBidirectional = structuredClone(stores.bidirectional);
    window.__pmPokeConfig = structuredClone(stores.poke);
    window.__pmBgLocal = structuredClone(stores.backgrounds);
    localValues.set('ST_SMS_DATA_V2', JSON.stringify(stores.histories));
    localValues.set('ST_SMS_GROUP_META', JSON.stringify(stores.groupMeta));
    localValues.delete('ST_SMS_GROUP_META_LOCAL_FALLBACK');
    localValues.set('ST_SMS_BIDIRECTIONAL', JSON.stringify(stores.bidirectional));
    localValues.set('ST_SMS_POKE_CONFIG', JSON.stringify(stores.poke));
    localValues.set('ST_SMS_BG_LOCAL', JSON.stringify(stores.backgrounds));
    idbValues.set('ST_SMS_DATA_V2', structuredClone(stores.histories));
    idbValues.set('ST_SMS_GROUP_META', structuredClone(stores.groupMeta));
    runtime.pendingMessages.set('story', new Map([
        ['Alice', [{ id: 1, status: 'pending' }]],
        ...(withoutOtherConversations ? [] : [['__group_team', [{ id: 2, status: 'pending' }]]]),
        ...(includeCurrentGroup ? [['__group_current', [{ id: 3, status: 'pending' }]]] : []),
    ]));
    let injectionCalls = 0;
    const injectionSnapshots = [];
    const applyBidirectionalInjection = async () => {
        injectionSnapshots.push({
            histories: structuredClone(window.__pmHistories),
            groupMeta: structuredClone(window.__pmGroupMeta),
            bidirectional: structuredClone(window.__pmBidirectional),
        });
        const result = injectionResults[injectionCalls];
        injectionCalls += 1;
        return result || { written: 1, failedWrites: 0, cleared: 1, failedKeys: [] };
    };
    const deps = {
        runtime,
        getStorageId: () => 'story',
        makeOverlay: () => {},
        applyBidirectionalInjection,
        addNote: () => {}, addBubble: () => {}, addDirector: () => {}, fitNameFont: () => {},
        applyBackground: () => {}, resetEmojiRenderBudget: () => {},
    };
    if (coordinateInjectionMutations) installPhoneContextInjection(state, deps);
    installConversation(state, deps);
    installPhoneDirectory(state, deps);
    // 群聊成员计数状态 class 必须随成员数量双向切换：0 -> N -> 0。
    {
        const classNames = new Set();
        const originalGetElementById = document.getElementById.bind(document);
        const originalGroupInputChanged = window.__pmGroupInputChanged;
        assert.equal(typeof originalGroupInputChanged, 'function', '群聊成员输入处理函数必须已注册');
        const counter = {
            textContent: '',
            classList: {
                toggle(name, enabled) {
                    if (enabled) classNames.add(name);
                    else classNames.delete(name);
                },
                contains: name => classNames.has(name),
            },
        };
        const fakeInput = { value: '' };
        const fakePreview = { innerHTML: '' };
        const previousInput = document.getElementById('pm-group-input') || null;
        try {
            document.getElementById = id => (id === 'pm-group-input' ? fakeInput : id === 'pm-group-counter' ? counter : id === 'pm-group-preview' ? fakePreview : previousInput);
            fakeInput.value = '';
            window.__pmGroupInputChanged();
            assert.equal(counter.textContent, '0 个角色', '空输入必须显示 0 个角色');
            assert.equal(counter.classList.contains('has-members'), false, '空输入不得标记 has-members');
            fakeInput.value = '角色A / 角色B';
            window.__pmGroupInputChanged();
            assert.equal(counter.textContent, '2 个角色', '群聊成员输入必须更新计数文本');
            assert.equal(counter.classList.contains('has-members'), true, '非空成员必须标记 has-members');
            fakeInput.value = '';
            window.__pmGroupInputChanged();
            assert.equal(counter.textContent, '0 个角色', '清空后必须恢复 0 个角色');
            assert.equal(counter.classList.contains('has-members'), false, '清空成员必须移除 has-members');
        } finally {
            document.getElementById = originalGetElementById;
        }
    }
    let listRefreshes = 0;
    window.__pmShowList = async () => { listRefreshes += 1; };
    return {
        runtime,
        state,
        phoneElements,
        stores,
        injectionCalls: () => injectionCalls,
        injectionSnapshots,
        listRefreshes: () => listRefreshes,
    };
}

try {
    let fixture = createDirectoryDeleteFixture({ currentGroupKey: '' });
    let runtimeBefore = directoryRuntimeSnapshot(fixture.state);
    let storageWritesBefore = localStorageWrites.length;
    let idbOperationsBefore = idbOperations.length;
    globalThis.confirm = () => false;
    assert.equal(await window.__pmDel('Alice'), false);
    assert.deepEqual(window.__pmHistories, fixture.stores.histories, '取消删除联系人不得修改历史');
    assert.deepEqual(window.__pmGroupMeta, fixture.stores.groupMeta);
    assert.deepEqual(window.__pmBidirectional, fixture.stores.bidirectional);
    assert.deepEqual(window.__pmPokeConfig, fixture.stores.poke);
    assert.deepEqual(window.__pmBgLocal, fixture.stores.backgrounds);
    assert.ok(fixture.runtime.pendingMessages.get('story')?.has('Alice'));
    assert.deepEqual(directoryRuntimeSnapshot(fixture.state), runtimeBefore, '取消删除联系人不得修改任何会话运行态');
    assert.equal(fixture.injectionCalls(), 0);
    assert.equal(fixture.listRefreshes(), 0);
    assert.equal(localStorageWrites.length, storageWritesBefore, '取消删除联系人不得写入 localStorage');
    assert.equal(idbOperations.length, idbOperationsBefore, '取消删除联系人不得写入 IndexedDB');

    fixture = createDirectoryDeleteFixture({ currentGroupKey: '' });
    runtimeBefore = directoryRuntimeSnapshot(fixture.state);
    globalThis.confirm = () => true;
    await window.__pmDel('Alice');
    assert.equal(window.__pmHistories.story.Alice, undefined);
    assert.deepEqual(window.__pmBidirectional.story, ['__group_team']);
    assert.equal(window.__pmPokeConfig.story.Alice, undefined);
    assert.equal(window.__pmBgLocal.story_Alice, undefined);
    assert.equal(fixture.runtime.pendingMessages.get('story')?.has('Alice'), false);
    assert.equal(fixture.state.currentPersona, '__group_team', '删除当前联系人后必须切到剩余群聊');
    assert.equal(fixture.state.isGroupChat, true);
    assert.equal(fixture.state.currentGroupKey, '__group_team');
    assert.deepEqual(fixture.state.groupMembers, ['Alice', 'Bob']);
    assert.equal(fixture.state.groupDisplayName, '测试群');
    assert.equal(fixture.state.conversationHistory.length, 1);
    assert.equal(fixture.state.conversationHistory[0].content, 'group history');
    assert.equal(fixture.phoneElements.name.textContent, '测试群');
    assert.equal(fixture.phoneElements.poke.classList.contains('is-hidden'), false);
    assert.equal(fixture.injectionCalls(), 2, '删除清理和切换目标都必须刷新注入');
    assert.equal(fixture.listRefreshes(), 0, '切换当前会话不应重开旧目录浮层');
    assert.equal(JSON.parse(localValues.get('ST_SMS_DATA_V2')).story.Alice, undefined);
    assert.equal(idbValues.get('ST_SMS_DATA_V2').story.Alice, undefined);
    assert.equal(JSON.parse(localValues.get('ST_SMS_POKE_CONFIG')).story.Alice, undefined);
    assert.deepEqual(JSON.parse(localValues.get('ST_SMS_BIDIRECTIONAL')).story, ['__group_team']);
    assert.deepEqual(JSON.parse(localValues.get('ST_SMS_BG_LOCAL')), { story___group_team: '#222222' });

    fixture = createDirectoryDeleteFixture({ currentGroupKey: '' });
    runtimeBefore = directoryRuntimeSnapshot(fixture.state);
    deleteAlerts.length = 0;
    localStorageControl.failSet.add('ST_SMS_POKE_CONFIG');
    await window.__pmDel('Alice');
    assert.ok(window.__pmHistories.story.Alice, '联系人删除失败后必须恢复历史');
    assert.deepEqual(window.__pmBidirectional.story, ['Alice', '__group_team']);
    assert.ok(window.__pmPokeConfig.story.Alice);
    assert.equal(window.__pmBgLocal.story_Alice, '#111111');
    assert.deepEqual(directoryRuntimeSnapshot(fixture.state), runtimeBefore, '联系人删除回滚不得修改任何会话运行态');
    assert.ok(fixture.runtime.pendingMessages.get('story')?.has('Alice'), '失败路径不得提前清理暂存');
    assert.equal(fixture.injectionCalls(), 1, '联系人持久化失败后必须重放旧注入');
    assert.deepEqual(fixture.injectionSnapshots[0].bidirectional, fixture.stores.bidirectional);
    assert.equal(fixture.listRefreshes(), 0);
    assert.match(deleteAlerts.at(-1) || '', /自动消息配置保存失败/);
    assert.deepEqual(JSON.parse(localValues.get('ST_SMS_DATA_V2')), fixture.stores.histories, '联系人回滚必须补偿持久化历史');
    assert.deepEqual(idbValues.get('ST_SMS_DATA_V2'), fixture.stores.histories, '联系人回滚必须补偿 IndexedDB 历史');
    assert.deepEqual(JSON.parse(localValues.get('ST_SMS_POKE_CONFIG')), fixture.stores.poke);
    assert.deepEqual(JSON.parse(localValues.get('ST_SMS_BIDIRECTIONAL')), fixture.stores.bidirectional);
    assert.deepEqual(JSON.parse(localValues.get('ST_SMS_BG_LOCAL')), fixture.stores.backgrounds);

    fixture = createDirectoryDeleteFixture({
        currentGroupKey: '',
        injectionResults: [{ written: 0, failedWrites: 1, cleared: 1, failedKeys: [] }],
    });
    runtimeBefore = directoryRuntimeSnapshot(fixture.state);
    deleteAlerts.length = 0;
    await window.__pmDel('Alice');
    assert.deepEqual(window.__pmHistories, fixture.stores.histories, '联系人注入清理失败必须恢复历史');
    assert.deepEqual(window.__pmBidirectional, fixture.stores.bidirectional, '联系人注入清理失败必须恢复注入关系');
    assert.deepEqual(window.__pmPokeConfig, fixture.stores.poke);
    assert.deepEqual(window.__pmBgLocal, fixture.stores.backgrounds);
    assert.deepEqual(directoryRuntimeSnapshot(fixture.state), runtimeBefore);
    assert.ok(fixture.runtime.pendingMessages.get('story')?.has('Alice'), '注入清理失败不得清理联系人暂存');
    assert.equal(fixture.injectionCalls(), 2, '联系人注入清理失败后必须重放旧注入');
    assert.equal(fixture.injectionSnapshots[0].histories.story.Alice, undefined, '首次注入必须观察删除后的状态');
    assert.deepEqual(fixture.injectionSnapshots[1].histories, fixture.stores.histories, '补偿注入必须观察恢复后的状态');
    assert.equal(fixture.listRefreshes(), 0, '注入清理失败不得刷新为删除后的列表');
    assert.match(deleteAlerts.at(-1) || '', /联系人删除清理注入失败/);
    assert.deepEqual(JSON.parse(localValues.get('ST_SMS_DATA_V2')), fixture.stores.histories);
    assert.deepEqual(JSON.parse(localValues.get('ST_SMS_BIDIRECTIONAL')), fixture.stores.bidirectional);

    fixture = createDirectoryDeleteFixture();
    runtimeBefore = directoryRuntimeSnapshot(fixture.state);
    storageWritesBefore = localStorageWrites.length;
    idbOperationsBefore = idbOperations.length;
    globalThis.confirm = () => false;
    assert.equal(await window.__pmDelGroup('__group_team'), false);
    assert.deepEqual(window.__pmHistories, fixture.stores.histories, '取消删除群聊不得修改历史');
    assert.deepEqual(window.__pmGroupMeta, fixture.stores.groupMeta, '取消删除群聊不得修改群元数据');
    assert.deepEqual(window.__pmBidirectional, fixture.stores.bidirectional);
    assert.deepEqual(window.__pmPokeConfig, fixture.stores.poke);
    assert.deepEqual(window.__pmBgLocal, fixture.stores.backgrounds);
    assert.ok(fixture.runtime.pendingMessages.get('story')?.has('__group_team'));
    assert.deepEqual(directoryRuntimeSnapshot(fixture.state), runtimeBefore, '取消删除群聊不得修改任何会话运行态');
    assert.equal(fixture.injectionCalls(), 0);
    assert.equal(fixture.listRefreshes(), 0);
    assert.equal(localStorageWrites.length, storageWritesBefore, '取消删除群聊不得写入 localStorage');
    assert.equal(idbOperations.length, idbOperationsBefore, '取消删除群聊不得写入 IndexedDB');

    fixture = createDirectoryDeleteFixture();
    runtimeBefore = directoryRuntimeSnapshot(fixture.state);
    globalThis.confirm = () => true;
    await window.__pmDelGroup('__group_team');
    assert.equal(window.__pmGroupMeta.story?.__group_team, undefined);
    assert.equal(window.__pmHistories.story.__group_team, undefined);
    assert.deepEqual(window.__pmBidirectional.story, ['Alice']);
    assert.equal(window.__pmPokeConfig.story.__group_team, undefined);
    assert.equal(window.__pmBgLocal.story___group_team, undefined);
    assert.equal(fixture.runtime.pendingMessages.get('story')?.has('__group_team'), false);
    assert.equal(fixture.state.currentPersona, 'Alice', '删除当前群聊后必须切到剩余联系人');
    assert.equal(fixture.state.isGroupChat, false);
    assert.equal(fixture.state.currentGroupKey, '');
    assert.deepEqual(fixture.state.groupMembers, []);
    assert.equal(fixture.state.groupDisplayName, '');
    assert.equal(fixture.state.conversationHistory.length, 1);
    assert.equal(fixture.state.conversationHistory[0].content, 'contact history');
    assert.equal(fixture.phoneElements.name.textContent, 'Alice');
    assert.equal(fixture.phoneElements.poke.classList.contains('is-hidden'), false);
    assert.equal(fixture.injectionCalls(), 2, '删除清理和切换目标都必须刷新注入');
    assert.equal(fixture.listRefreshes(), 0, '切换当前会话不应重开旧目录浮层');
    assert.equal(JSON.parse(localValues.get('ST_SMS_GROUP_META')).story?.__group_team, undefined);
    assert.equal(idbValues.get('ST_SMS_GROUP_META').story?.__group_team, undefined);
    assert.equal(JSON.parse(localValues.get('ST_SMS_DATA_V2')).story.__group_team, undefined);
    assert.equal(idbValues.get('ST_SMS_DATA_V2').story.__group_team, undefined);
    assert.deepEqual(JSON.parse(localValues.get('ST_SMS_POKE_CONFIG')).story, { Alice: { interval: 2 } });
    assert.deepEqual(JSON.parse(localValues.get('ST_SMS_BIDIRECTIONAL')).story, ['Alice']);
    assert.deepEqual(JSON.parse(localValues.get('ST_SMS_BG_LOCAL')), { story_Alice: '#111111' });

    fixture = createDirectoryDeleteFixture({ currentGroupKey: '', withoutOtherConversations: true });
    globalThis.confirm = () => true;
    await window.__pmDel('Alice');
    assert.deepEqual(directoryRuntimeSnapshot(fixture.state), {
        activeStorageId: 'story',
        currentPersona: '',
        conversationHistory: [],
        isGroupChat: false,
        currentGroupKey: '',
        groupMembers: [],
        groupExtras: [],
        groupDisplayName: '',
        groupRandomNpcEnabled: false,
        groupNature: '',
        groupColorMap: {},
    }, '删除最后一个会话必须进入完整空态');
    assert.equal(fixture.phoneElements.name.textContent, '选择联系人');
    assert.equal(fixture.phoneElements.poke.classList.contains('is-hidden'), true, '空态必须隐藏拍一拍按钮');
    assert.match(fixture.phoneElements.list.innerHTML, /暂无会话/);
    assert.equal(fixture.injectionCalls(), 1, '删除清理完成后进入空态不得重复刷新注入');
    assert.equal(fixture.listRefreshes(), 0);

    fixture = createDirectoryDeleteFixture({ includeCurrentGroup: true });
    runtimeBefore = directoryRuntimeSnapshot(fixture.state);
    const nonCurrentExpected = structuredClone(fixture.stores);
    delete nonCurrentExpected.histories.story.__group_team;
    delete nonCurrentExpected.groupMeta.story.__group_team;
    nonCurrentExpected.bidirectional.story = ['Alice', '__group_current'];
    delete nonCurrentExpected.poke.story.__group_team;
    delete nonCurrentExpected.backgrounds.story___group_team;
    const currentGroupPendingBefore = structuredClone(fixture.runtime.pendingMessages.get('story')?.get('__group_current'));
    globalThis.confirm = () => true;
    await window.__pmDelGroup('__group_team');
    assert.deepEqual(window.__pmHistories, nonCurrentExpected.histories, '删除非当前群聊只能移除目标历史');
    assert.deepEqual(window.__pmGroupMeta, nonCurrentExpected.groupMeta, '删除非当前群聊只能移除目标群元数据');
    assert.deepEqual(window.__pmBidirectional, nonCurrentExpected.bidirectional, '删除非当前群聊只能移除目标注入关系');
    assert.deepEqual(window.__pmPokeConfig, nonCurrentExpected.poke, '删除非当前群聊只能移除目标自动消息配置');
    assert.deepEqual(window.__pmBgLocal, nonCurrentExpected.backgrounds, '删除非当前群聊只能移除目标背景');
    assert.equal(fixture.runtime.pendingMessages.get('story')?.has('__group_team'), false);
    assert.deepEqual(
        fixture.runtime.pendingMessages.get('story')?.get('__group_current'),
        currentGroupPendingBefore,
        '删除其他群聊不得修改当前群聊暂存内容',
    );
    assert.deepEqual(fixture.runtime.pendingMessages.get('story')?.get('Alice'), [{ id: 1, status: 'pending' }], '删除群聊不得修改联系人暂存');
    assert.deepEqual(directoryRuntimeSnapshot(fixture.state), runtimeBefore, '删除非当前群聊不得修改当前会话运行态');
    assert.equal(fixture.injectionCalls(), 1);
    assert.equal(fixture.listRefreshes(), 0, '没有打开联系人浮层或旧目录时不得强行重绘目录');
    assert.deepEqual(JSON.parse(localValues.get('ST_SMS_DATA_V2')), nonCurrentExpected.histories);
    assert.deepEqual(idbValues.get('ST_SMS_DATA_V2'), nonCurrentExpected.histories);
    assert.deepEqual(JSON.parse(localValues.get('ST_SMS_GROUP_META')), nonCurrentExpected.groupMeta);
    assert.deepEqual(idbValues.get('ST_SMS_GROUP_META'), nonCurrentExpected.groupMeta);
    assert.deepEqual(JSON.parse(localValues.get('ST_SMS_BIDIRECTIONAL')), nonCurrentExpected.bidirectional);
    assert.deepEqual(JSON.parse(localValues.get('ST_SMS_POKE_CONFIG')), nonCurrentExpected.poke);
    assert.deepEqual(JSON.parse(localValues.get('ST_SMS_BG_LOCAL')), nonCurrentExpected.backgrounds);

    fixture = createDirectoryDeleteFixture();
    runtimeBefore = directoryRuntimeSnapshot(fixture.state);
    deleteAlerts.length = 0;
    localStorageControl.failSet.add('ST_SMS_POKE_CONFIG');
    await window.__pmDelGroup('__group_team');
    assert.ok(window.__pmGroupMeta.story.__group_team, '群聊删除失败后必须恢复群元数据');
    assert.ok(window.__pmHistories.story.__group_team, '群聊删除失败后必须恢复历史');
    assert.deepEqual(window.__pmBidirectional.story, ['Alice', '__group_team']);
    assert.ok(window.__pmPokeConfig.story.__group_team);
    assert.equal(window.__pmBgLocal.story___group_team, '#222222');
    assert.ok(fixture.runtime.pendingMessages.get('story')?.has('__group_team'), '失败路径不得提前清理群聊暂存');
    assert.deepEqual(directoryRuntimeSnapshot(fixture.state), runtimeBefore, '群聊删除回滚不得修改任何会话运行态');
    assert.equal(fixture.injectionCalls(), 1, '群聊持久化失败后必须重放旧注入');
    assert.deepEqual(fixture.injectionSnapshots[0].bidirectional, fixture.stores.bidirectional);
    assert.equal(fixture.listRefreshes(), 0);
    assert.match(deleteAlerts.at(-1) || '', /自动消息配置保存失败/);
    assert.deepEqual(JSON.parse(localValues.get('ST_SMS_GROUP_META')), fixture.stores.groupMeta, '群聊回滚必须补偿持久化元数据');
    assert.deepEqual(idbValues.get('ST_SMS_GROUP_META'), fixture.stores.groupMeta, '群聊回滚必须补偿 IndexedDB 元数据');
    assert.deepEqual(JSON.parse(localValues.get('ST_SMS_DATA_V2')), fixture.stores.histories);
    assert.deepEqual(idbValues.get('ST_SMS_DATA_V2'), fixture.stores.histories, '群聊回滚必须补偿 IndexedDB 历史');
    assert.deepEqual(JSON.parse(localValues.get('ST_SMS_POKE_CONFIG')), fixture.stores.poke);
    assert.deepEqual(JSON.parse(localValues.get('ST_SMS_BIDIRECTIONAL')), fixture.stores.bidirectional);
    assert.deepEqual(JSON.parse(localValues.get('ST_SMS_BG_LOCAL')), fixture.stores.backgrounds);

    fixture = createDirectoryDeleteFixture({
        injectionResults: [{ written: 1, failedWrites: 0, cleared: 0, failedKeys: ['stale-group-key'] }],
    });
    runtimeBefore = directoryRuntimeSnapshot(fixture.state);
    deleteAlerts.length = 0;
    await window.__pmDelGroup('__group_team');
    assert.deepEqual(window.__pmGroupMeta, fixture.stores.groupMeta, '群聊注入清理失败必须恢复群元数据');
    assert.deepEqual(window.__pmHistories, fixture.stores.histories, '群聊注入清理失败必须恢复历史');
    assert.deepEqual(window.__pmBidirectional, fixture.stores.bidirectional, '群聊注入清理失败必须恢复注入关系');
    assert.deepEqual(window.__pmPokeConfig, fixture.stores.poke);
    assert.deepEqual(window.__pmBgLocal, fixture.stores.backgrounds);
    assert.deepEqual(directoryRuntimeSnapshot(fixture.state), runtimeBefore);
    assert.ok(fixture.runtime.pendingMessages.get('story')?.has('__group_team'), '注入清理失败不得清理群聊暂存');
    assert.equal(fixture.injectionCalls(), 2, '群聊注入清理失败后必须重放旧注入');
    assert.equal(fixture.injectionSnapshots[0].groupMeta.story?.__group_team, undefined, '首次注入必须观察删除后的群元数据');
    assert.deepEqual(fixture.injectionSnapshots[1].groupMeta, fixture.stores.groupMeta, '补偿注入必须观察恢复后的群元数据');
    assert.equal(fixture.listRefreshes(), 0, '注入清理失败不得刷新为删除后的列表');
    assert.match(deleteAlerts.at(-1) || '', /群聊删除清理注入失败/);
    assert.deepEqual(JSON.parse(localValues.get('ST_SMS_GROUP_META')), fixture.stores.groupMeta);
    assert.deepEqual(JSON.parse(localValues.get('ST_SMS_DATA_V2')), fixture.stores.histories);
    assert.deepEqual(JSON.parse(localValues.get('ST_SMS_BIDIRECTIONAL')), fixture.stores.bidirectional);

    let releaseConcurrentDeleteInjection;
    const concurrentDeleteInjection = new Promise(resolve => { releaseConcurrentDeleteInjection = resolve; });
    fixture = createDirectoryDeleteFixture({
        currentGroupKey: '',
        injectionResults: [concurrentDeleteInjection],
    });
    deleteAlerts.length = 0;
    const pendingContactDelete = window.__pmDel('Alice');
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(fixture.injectionCalls(), 1, '首个删除事务必须已进入注入阶段');
    assert.equal(directoryDeleteButtons.every(button => button.disabled), true, '删除事务期间必须禁用全部实体删除按钮');
    assert.equal(await window.__pmDelGroup('__group_team'), false, '共享删除锁必须拒绝并发群聊删除');
    assert.match(deleteAlerts.at(-1) || '', /已有删除操作正在进行/);
    assert.ok(window.__pmGroupMeta.story.__group_team, '被锁拒绝的并发操作不得删除群元数据');
    assert.ok(window.__pmHistories.story.__group_team, '被锁拒绝的并发操作不得删除群历史');
    releaseConcurrentDeleteInjection({ written: 1, failedWrites: 0, cleared: 1, failedKeys: [] });
    assert.equal(await pendingContactDelete, true, '首个删除事务完成后必须明确返回成功');
    assert.equal(directoryDeleteButtons.every(button => !button.disabled), true, '删除事务结束后必须恢复删除按钮');
    assert.equal(window.__pmHistories.story.Alice, undefined);
    assert.ok(window.__pmGroupMeta.story.__group_team, '联系人删除成功不得覆盖被锁保护的群聊');

    let releaseToggleDeleteRace;
    const toggleDeleteRace = new Promise(resolve => { releaseToggleDeleteRace = resolve; });
    fixture = createDirectoryDeleteFixture({
        currentGroupKey: '',
        coordinateInjectionMutations: true,
        injectionResults: [
            toggleDeleteRace,
            { written: 1, failedWrites: 0, cleared: 1, failedKeys: [] },
            { written: 1, failedWrites: 0, cleared: 1, failedKeys: [] },
        ],
    });
    globalThis.confirm = () => true;
    const failingToggleBeforeDelete = window.__pmToggleConversationInjection('story', 'Alice', false);
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(fixture.injectionCalls(), 1, '注入切换必须先进入共享协调队列');
    const queuedGroupDelete = window.__pmDelGroup('__group_team');
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(fixture.injectionCalls(), 1, '删除不得越过正在执行的注入切换修改共享配置');
    assert.ok(window.__pmGroupMeta.story.__group_team, '排队期间不得提前删除群聊');
    releaseToggleDeleteRace({ written: 0, failedWrites: 1, cleared: 1, failedKeys: [] });
    await assert.rejects(failingToggleBeforeDelete, /上下文注入设置应用失败/);
    assert.equal(await queuedGroupDelete, true);
    assert.equal(fixture.injectionCalls(), 3, '切换补偿完成后删除才能执行自己的注入清理');
    assert.equal(window.__pmGroupMeta.story?.__group_team, undefined);
    assert.equal(window.__pmHistories.story?.__group_team, undefined);
    assert.deepEqual(window.__pmBidirectional.story, ['Alice'],
        '失败切换的全量补偿不得复活随后成功删除的群聊注入 key');
    assert.deepEqual(JSON.parse(localValues.get('ST_SMS_BIDIRECTIONAL')).story, ['Alice']);

    fixture = createDirectoryDeleteFixture({
        currentGroupKey: '',
        injectionResults: [
            { written: 0, failedWrites: 1, cleared: 1, failedKeys: [] },
            { written: 1, failedWrites: 0, cleared: 0, failedKeys: ['private-contact-key'] },
        ],
    });
    runtimeBefore = directoryRuntimeSnapshot(fixture.state);
    deleteAlerts.length = 0;
    assert.equal(await window.__pmDel('Alice'), false, '联系人补偿注入失败必须明确返回失败');
    assert.deepEqual(window.__pmHistories, fixture.stores.histories);
    assert.deepEqual(window.__pmBidirectional, fixture.stores.bidirectional);
    assert.deepEqual(directoryRuntimeSnapshot(fixture.state), runtimeBefore);
    assert.ok(fixture.runtime.pendingMessages.get('story')?.has('Alice'));
    assert.equal(fixture.listRefreshes(), 0);
    assert.match(deleteAlerts.at(-1) || '', /原数据回滚也失败/);
    assert.doesNotMatch(deleteAlerts.at(-1) || '', /private-contact-key/, '错误提示不得泄漏失败注入键');
    assert.equal(directoryDeleteButtons.every(button => !button.disabled), true, '联系人补偿失败也必须释放删除锁');

    fixture = createDirectoryDeleteFixture({
        injectionResults: [
            { written: 1, failedWrites: 0, cleared: 0, failedKeys: ['private-group-key'] },
            { written: 0, failedWrites: 1, cleared: 1, failedKeys: [] },
        ],
    });
    runtimeBefore = directoryRuntimeSnapshot(fixture.state);
    deleteAlerts.length = 0;
    assert.equal(await window.__pmDelGroup('__group_team'), false, '群聊补偿注入失败必须明确返回失败');
    assert.deepEqual(window.__pmGroupMeta, fixture.stores.groupMeta);
    assert.deepEqual(window.__pmHistories, fixture.stores.histories);
    assert.deepEqual(window.__pmBidirectional, fixture.stores.bidirectional);
    assert.deepEqual(directoryRuntimeSnapshot(fixture.state), runtimeBefore);
    assert.ok(fixture.runtime.pendingMessages.get('story')?.has('__group_team'));
    assert.equal(fixture.listRefreshes(), 0);
    assert.match(deleteAlerts.at(-1) || '', /原数据回滚也失败/);
    assert.doesNotMatch(deleteAlerts.at(-1) || '', /private-group-key/, '错误提示不得泄漏失败注入键');
    assert.equal(directoryDeleteButtons.every(button => !button.disabled), true, '群聊补偿失败也必须释放删除锁');

    fixture = createDirectoryDeleteFixture({ currentGroupKey: '' });
    const switcherElements = new Map();
    const switcherDocumentListeners = new Map();
    const triggerAttributes = new Map([['aria-expanded', 'false']]);
    let triggerBottom = 80;
    const trigger = {
        isConnected: true, focusCalls: 0,
        setAttribute(name, value) { triggerAttributes.set(name, String(value)); },
        getAttribute(name) { return triggerAttributes.get(name) ?? null; },
        focus(options) { assert.deepEqual(options, { preventScroll: true }); this.focusCalls += 1; },
        contains(target) { return target === this; },
        getBoundingClientRect: () => ({ left: 60, bottom: triggerBottom, width: 120 }),
    };
    const phone = {
        clientWidth: 360,
        querySelector: selector => selector === '.pm-name-trigger' ? trigger : null,
        getBoundingClientRect: () => ({ left: 0, top: 0, bottom: 640 }),
        appendChild(element) { switcherElements.set(element.id, element); element.isConnected = true; return element; },
    };
    fixture.state.phoneWindow = phone;
    const createSwitcherElement = () => {
        const attributes = new Map();
        const listeners = new Map();
        const firstButton = { focusCalls: 0, focus() { this.focusCalls += 1; } };
        return {
            id: '', className: '', dataset: {}, style: {}, innerHTML: '', isConnected: false,
            setAttribute(name, value) { attributes.set(name, String(value)); },
            getAttribute(name) { return attributes.get(name) ?? null; },
            addEventListener(type, listener) { listeners.set(type, listener); },
            dispatch(type, event) { return listeners.get(type)?.(event); },
            contains(target) { return target === this || target?.switcherOwner === this; },
            querySelector(selector) {
                if (selector === 'button') return firstButton;
                return null;
            },
            remove() { this.isConnected = false; switcherElements.delete(this.id); },
            firstButton,
        };
    };
    globalThis.document = {
        getElementById: id => switcherElements.get(id) || null,
        querySelectorAll: () => [],
        createElement: tag => { assert.equal(tag, 'div'); return createSwitcherElement(); },
        addEventListener(type, listener, capture) {
            assert.equal(capture, true);
            switcherDocumentListeners.set(type, listener);
        },
        removeEventListener(type, listener, capture) {
            assert.equal(capture, true);
            if (switcherDocumentListeners.get(type) === listener) switcherDocumentListeners.delete(type);
        },
    };
    window.__pmTheme = { darkMode: 'light' };
    let injectionEnabled = false;
    let injectionToggleCalls = 0;
    window.__pmConversationInjectionEnabled = () => injectionEnabled;
    window.__pmToggleConversationInjection = async (storageId, key, isGroup) => {
        assert.deepEqual([storageId, key, isGroup], ['story', 'Alice', false]);
        injectionToggleCalls += 1;
        injectionEnabled = true;
        return true;
    };
    assert.equal(await window.__pmToggleContactSwitcher(trigger), true);
    let switcher = switcherElements.get('pm-contact-switcher');
    assert.ok(switcher, '点击标题必须创建联系人浮层');
    assert.equal(trigger.getAttribute('aria-expanded'), 'true');
    assert.equal(switcher.getAttribute('role'), 'dialog');
    assert.match(switcher.innerHTML, /data-contact-action="switch" data-key="Alice"/);
    assert.match(switcher.innerHTML, /data-contact-action="inject" data-key="Alice"/);
    assert.match(switcher.innerHTML, /data-contact-action="delete" data-key="Alice"/);
    assert.match(switcher.innerHTML, />新建联系人<\/button>[\s\S]*>新建群聊<\/button>[\s\S]*>生成联系人与群聊<\/button>/);
    assert.equal(switcher.style.left, undefined, '联系人浮层不得写入固定 left 偏移');
    assert.equal(switcher.style.top, '78px', '联系人浮层必须比标题栏底边上移 2px');
    const switcherResizeObserver = resizeObserverRecords.at(-1);
    assert.deepEqual(switcherResizeObserver.observed, [phone, trigger], '浮层必须同时监听手机与标题尺寸变化');
    triggerBottom = 100;
    switcherResizeObserver.callback();
    assert.equal(switcher.style.top, '98px', '标题或手机尺寸变化后必须保持上移 2px');
    assert.equal(switcher.firstButton.focusCalls, 1, '打开浮层后必须把焦点移入菜单');

    const injectionAttributes = new Map([['aria-pressed', 'false'], ['aria-label', '开启 Alice 的正文注入']]);
    const injectionClasses = new Set();
    const injectionAction = {
        switcherOwner: switcher, isConnected: true, disabled: false, title: '开启正文注入', focusCalls: 0,
        dataset: { contactAction: 'inject', key: 'Alice', group: 'false', label: 'Alice' },
        setAttribute(name, value) { injectionAttributes.set(name, String(value)); },
        getAttribute(name) { return injectionAttributes.get(name) ?? null; },
        removeAttribute(name) { injectionAttributes.delete(name); },
        classList: { toggle(name, enabled) { if (enabled) injectionClasses.add(name); else injectionClasses.delete(name); } },
        focus(options) { assert.deepEqual(options, { preventScroll: true }); this.focusCalls += 1; },
    };
    await switcher.dispatch('click', {
        target: { closest: selector => selector === 'button[data-contact-action]' ? injectionAction : null },
        stopPropagation() {},
    });
    assert.equal(injectionToggleCalls, 1);
    assert.equal(injectionAction.disabled, false);
    assert.equal(injectionAttributes.has('aria-busy'), false);
    assert.equal(injectionAction.getAttribute('aria-pressed'), 'true');
    assert.equal(injectionAction.getAttribute('aria-label'), '关闭 Alice 的正文注入');
    assert.equal(injectionAction.title, '关闭正文注入');
    assert.equal(injectionClasses.has('is-active'), true);
    assert.equal(injectionAction.focusCalls, 1);

    switcherDocumentListeners.get('keydown')?.({ key: 'Escape' });
    assert.equal(switcherElements.has('pm-contact-switcher'), false);
    assert.equal(trigger.getAttribute('aria-expanded'), 'false');
    assert.equal(trigger.focusCalls, 1, 'Escape 关闭后必须恢复标题焦点');
    assert.equal(switcherDocumentListeners.has('click'), false);
    assert.equal(switcherDocumentListeners.has('keydown'), false);
    assert.equal(switcherResizeObserver.disconnectCalls, 1, '关闭浮层必须释放尺寸观察器');

    const staleOpen = window.__pmToggleContactSwitcher(trigger);
    fixture.state.phoneWindow = phone;
    const latestOpen = window.__pmToggleContactSwitcher(trigger);
    assert.equal(await staleOpen, false, '异步打开期间再次关闭必须让旧请求失效');
    assert.equal(await latestOpen, true, '最后一次标题点击必须由最新请求打开浮层');
    assert.equal(switcherElements.has('pm-contact-switcher'), true);
} finally {
    globalThis.confirm = previousDeleteConfirm;
    globalThis.alert = previousDeleteAlert;
    globalThis.document = previousDeleteDocument;
    globalThis.ResizeObserver = previousDirectoryResizeObserver;
    for (const key of Object.getOwnPropertyNames(window)) {
        if (key.startsWith('__pm')) delete window[key];
    }
    for (const [key, descriptor] of previousDirectoryWindowDescriptors) {
        Object.defineProperty(window, key, descriptor);
    }
}

idbControl.abortAll = false;
const migrationBackground = label => `data:image/png;base64,${label}${'x'.repeat(5000)}`;
const desktopMigrationValue = migrationBackground('desktop-migration');
localValues.set('ST_SMS_BG_DESKTOP', desktopMigrationValue);
localValues.delete('ST_SMS_BG_GLOBAL');
localValues.set('ST_SMS_BG_LOCAL', '{}');
idbControl.abortOperations.push({ type: 'put', key: 'ST_SMS_BG_DESKTOP' });
await loadBgSettings();
assert.equal(window.__pmDesktopBg, desktopMigrationValue, '迁移失败时当前桌面背景仍必须可用');
assert.equal(localValues.get('ST_SMS_BG_DESKTOP'), desktopMigrationValue, 'IndexedDB 写入失败不得把桌面原值替换为 marker');
assert.equal(idbValues.has('ST_SMS_BG_DESKTOP'), false);
localValues.delete('ST_SMS_BG_DESKTOP');

const localMigrationAlice = migrationBackground('local-alice');
const localMigrationBob = migrationBackground('local-bob');
localValues.set('ST_SMS_BG_LOCAL', JSON.stringify({ story_Alice: localMigrationAlice, story_Bob: localMigrationBob }));
idbControl.abortOperations.push({ type: 'put', key: 'ST_SMS_BG_LOCAL_story_Bob' });
await loadBgSettings();
assert.deepEqual(JSON.parse(localValues.get('ST_SMS_BG_LOCAL')), {
    story_Alice: '__idb__',
    story_Bob: localMigrationBob,
}, '局部背景只能为已成功迁移的条目提交 marker');
assert.equal(idbValues.get('ST_SMS_BG_LOCAL_story_Alice'), localMigrationAlice);
assert.equal(idbValues.has('ST_SMS_BG_LOCAL_story_Bob'), false);
assert.equal(window.__pmBgLocal.story_Bob, localMigrationBob);

const localMigrationCarol = migrationBackground('local-carol');
idbValues.delete('ST_SMS_BG_LOCAL_story_Alice');
localValues.set('ST_SMS_BG_LOCAL', JSON.stringify({ story_Carol: localMigrationCarol }));
localStorageControl.failSet.add('ST_SMS_BG_LOCAL');
await loadBgSettings();
assert.deepEqual(JSON.parse(localValues.get('ST_SMS_BG_LOCAL')), { story_Carol: localMigrationCarol }, '索引提交失败必须保留原始局部背景');
assert.equal(idbValues.has('ST_SMS_BG_LOCAL_story_Carol'), false, '索引提交失败必须补偿删除已写入的主数据');
assert.equal(window.__pmBgLocal.story_Carol, localMigrationCarol);
localValues.set('ST_SMS_BG_LOCAL', '{}');

const assertRejectedBackgroundLoad = async serialized => {
    const idbSnapshot = new Map(idbValues);
    localValues.set('ST_SMS_BG_LOCAL', serialized);
    idbOperations.length = 0;
    await loadBgSettings();
    assert.deepEqual(idbOperations.filter(operation => operation.type !== 'get'), []);
    assert.deepEqual(idbValues, idbSnapshot);
    assert.equal(Object.getPrototypeOf(window.__pmBgLocal), null);
    assert.deepEqual(Object.keys(window.__pmBgLocal), []);
    assert.equal(localValues.get('ST_SMS_BG_LOCAL'), serialized);
};

const coldBackgroundPointers = Object.fromEntries(Array.from({ length: 100 }, (_, index) => [`story_Person${index}`, '__idb__']));
for (const key of Object.keys(coldBackgroundPointers)) idbValues.set(`ST_SMS_BG_LOCAL_${key}`, migrationBackground(`cold-${key}`));
localValues.set('ST_SMS_BG_LOCAL', JSON.stringify(coldBackgroundPointers));
idbOperations.length = 0;
await loadBgSettings();
assert.deepEqual(window.__pmBgLocal, Object.assign(Object.create(null), coldBackgroundPointers),
    '冷启动只应常驻会话背景索引');
const person0Initial = idbValues.get('ST_SMS_BG_LOCAL_story_Person0');
assert.equal(await loadLocalBackground('story_Person0'), person0Initial,
    '首次进入会话时才读取当前背景');
const person0Replacement = migrationBackground('cold-person0-replaced');
idbValues.set('ST_SMS_BG_LOCAL_story_Person0', person0Replacement);
assert.equal(await loadLocalBackground('story_Person0'), person0Initial,
    '当前会话背景重复应用必须命中缓存而不是重新读取 IDB');
await loadLocalBackground('story_Person1');
await loadLocalBackground('story_Person2');
assert.equal(await loadLocalBackground('story_Person0'), person0Replacement,
    '缓存最多保留当前和最近一个会话，第三个会话必须淘汰最旧项并重新读取');
const materializedColdBackgrounds = await materializeLocalBackgrounds();
assert.equal(materializedColdBackgrounds.story_Person99, idbValues.get('ST_SMS_BG_LOCAL_story_Person99'),
    '导出边界必须把 marker 还原为旧格式背景正文');
assert.equal(Object.values(materializedColdBackgrounds).includes('__idb__'), false,
    '备份数据不得泄漏内部 marker');

localValues.set('ST_SMS_BG_LOCAL', '{"story_Alice":"https://example.test/background.png"}');
await loadBgSettings();
assert.equal(Object.getPrototypeOf(window.__pmBgLocal), null);
assert.equal(window.__pmBgLocal.story_Alice, 'https://example.test/background.png');
await assertRejectedBackgroundLoad('{broken');
await assertRejectedBackgroundLoad('[]');
await assertRejectedBackgroundLoad('null');
await assertRejectedBackgroundLoad('42');
await assertRejectedBackgroundLoad('{"story_Alice":42}');
await assertRejectedBackgroundLoad('{"story_Alice":null}');
await assertRejectedBackgroundLoad('{"story_Alice":{}}');
await assertRejectedBackgroundLoad('{"story_Alice":[]}');
await assertRejectedBackgroundLoad(`{"__proto__":"${`data:image/png;base64,${'x'.repeat(5000)}`}"}`);
await assertRejectedBackgroundLoad('{"constructor":"https://example.test/background.png"}');
await assertRejectedBackgroundLoad('{"prototype":"https://example.test/background.png"}');
const readFailureIdbSnapshot = new Map(idbValues);
localValues.set('ST_SMS_BG_LOCAL', '{"story_Alice":"https://example.test/background.png"}');
localStorageControl.failGet.add('ST_SMS_BG_LOCAL');
idbOperations.length = 0;
await loadBgSettings();
assert.deepEqual(idbOperations.filter(operation => operation.type !== 'get'), []);
assert.deepEqual(idbValues, readFailureIdbSnapshot);
assert.equal(Object.getPrototypeOf(window.__pmBgLocal), null);
assert.deepEqual(Object.keys(window.__pmBgLocal), []);
assert.equal(localValues.get('ST_SMS_BG_LOCAL'), '{"story_Alice":"https://example.test/background.png"}');

idbValues.set('ST_SMS_BG_LOCAL_story_Alice', 'data:image/png;base64,old');
localValues.set('ST_SMS_BG_LOCAL', JSON.stringify({ story_Alice: '__idb__' }));
window.__pmBgLocal = {};
idbControl.abortOperations.push({ type: 'delete', key: 'ST_SMS_BG_LOCAL_story_Alice' });
await assert.rejects(saveBgLocal(), /会话背景删除失败：IndexedDB 不可用/);
assert.equal(idbValues.get('ST_SMS_BG_LOCAL_story_Alice'), 'data:image/png;base64,old');

localValues.set('ST_SMS_BG_LOCAL', JSON.stringify({ story_Alice: 'https://example.test/old.png' }));
window.__pmBgLocal = { story_Alice: 'https://example.test/new.png' };
await saveBgLocal();
assert.deepEqual(JSON.parse(localValues.get('ST_SMS_BG_LOCAL')), window.__pmBgLocal);

const assertRejectedBackgroundIndex = async (serialized, pattern) => {
    const idbSnapshot = new Map(idbValues);
    localValues.set('ST_SMS_BG_LOCAL', serialized);
    window.__pmBgLocal = { story_Alice: 'https://example.test/new.png' };
    await assert.rejects(saveBgLocal(), pattern);
    assert.equal(localValues.get('ST_SMS_BG_LOCAL'), serialized);
    assert.deepEqual(idbValues, idbSnapshot);
};
localValues.set('ST_SMS_BG_LOCAL', '{broken');
await assert.rejects(saveBgLocal(), /会话背景索引损坏：无法解析/);
localValues.set('ST_SMS_BG_LOCAL', '[]');
await assert.rejects(saveBgLocal(), /会话背景索引损坏：必须是对象/);
await assertRejectedBackgroundIndex('{"story_Alice":42}', /story_Alice 必须是字符串/);
await assertRejectedBackgroundIndex('{"story_Alice":null}', /story_Alice 必须是字符串/);
await assertRejectedBackgroundIndex('{"story_Alice":{}}', /story_Alice 必须是字符串/);
await assertRejectedBackgroundIndex('{"story_Alice":[]}', /story_Alice 必须是字符串/);
await assertRejectedBackgroundIndex('{"__proto__":"__idb__"}', /包含危险键 __proto__/);
localValues.set('ST_SMS_BG_LOCAL', '{}');
localStorageControl.failGet.add('ST_SMS_BG_LOCAL');
await assert.rejects(saveBgLocal(), /会话背景索引读取失败：浏览器存储不可用/);
localValues.set('ST_SMS_BG_LOCAL', '{}');
window.__pmBgLocal = JSON.parse('{"__proto__":"https://example.test/background.png"}');
await assert.rejects(saveBgLocal(), /会话背景数据损坏：包含危险键 __proto__/);
assert.equal(localValues.get('ST_SMS_BG_LOCAL'), '{}');
const undefinedIdbSnapshot = new Map(idbValues);
window.__pmBgLocal = { story_Alice: undefined };
idbOperations.length = 0;
await assert.rejects(saveBgLocal(), /会话背景数据损坏：story_Alice 必须是字符串/);
assert.equal(localValues.get('ST_SMS_BG_LOCAL'), '{}');
assert.deepEqual(idbValues, undefinedIdbSnapshot);
assert.deepEqual(idbOperations, []);
window.__pmBgLocal = { story_Alice: { url: 'https://example.test/background.png' } };
await assert.rejects(saveBgLocal(), /会话背景数据损坏：story_Alice 必须是字符串/);
assert.equal(localValues.get('ST_SMS_BG_LOCAL'), '{}');

const largeBackground = suffix => `data:image/png;base64,${suffix}${'x'.repeat(5000)}`;
const newDesktopBackground = largeBackground('new-desktop');
localValues.delete('ST_SMS_BG_DESKTOP');
idbValues.delete('ST_SMS_BG_DESKTOP');
window.__pmDesktopBg = newDesktopBackground;
idbControl.abortOperations.push({ type: 'put', key: 'ST_SMS_BG_DESKTOP' });
await assert.rejects(saveDesktopBg(), /桌面背景保存失败：IndexedDB 不可用/);
assert.equal(idbValues.has('ST_SMS_BG_DESKTOP'), false, '桌面背景主体写失败不得留下主数据');
assert.equal(localValues.has('ST_SMS_BG_DESKTOP'), false, '桌面背景主体写失败不得提交索引');

localValues.delete('ST_SMS_BG_DESKTOP');
window.__pmDesktopBg = newDesktopBackground;
localStorageControl.failSet.add('ST_SMS_BG_DESKTOP');
await assert.rejects(saveDesktopBg(), /桌面背景索引保存失败：浏览器存储不可用/);
assert.equal(idbValues.has('ST_SMS_BG_DESKTOP'), false, '桌面背景索引失败必须补偿删除新主数据');
assert.equal(localValues.has('ST_SMS_BG_DESKTOP'), false, '桌面背景索引失败必须保留旧索引状态');

const oldDesktopBackground = largeBackground('old-desktop');
idbValues.set('ST_SMS_BG_DESKTOP', oldDesktopBackground);
localValues.set('ST_SMS_BG_DESKTOP', '__idb__');
window.__pmDesktopBg = '';
localStorageControl.failSet.add('ST_SMS_BG_DESKTOP');
await assert.rejects(saveDesktopBg(), /桌面背景保存失败：浏览器存储不可用/);
assert.equal(idbValues.get('ST_SMS_BG_DESKTOP'), oldDesktopBackground,
    '桌面背景小数据索引失败必须恢复旧主数据');
assert.equal(localValues.get('ST_SMS_BG_DESKTOP'), '__idb__', '桌面背景小数据索引失败必须保留旧指针');

localValues.delete('ST_SMS_BG_DESKTOP');
idbValues.delete('ST_SMS_BG_DESKTOP');
window.__pmDesktopBg = newDesktopBackground;
localStorageControl.failSet.add('ST_SMS_BG_DESKTOP');
idbControl.abortOperations.push({ type: 'delete', key: 'ST_SMS_BG_DESKTOP' });
await assert.rejects(saveDesktopBg(),
    /桌面背景索引保存失败：浏览器存储不可用；桌面背景主数据补偿失败/);
assert.equal(idbValues.get('ST_SMS_BG_DESKTOP'), newDesktopBackground,
    '桌面背景补偿失败必须保留可诊断的实际主数据状态');
assert.equal(localValues.has('ST_SMS_BG_DESKTOP'), false);
idbValues.delete('ST_SMS_BG_DESKTOP');

const newGlobalBackground = largeBackground('new-global');
localValues.delete('ST_SMS_BG_GLOBAL');
idbValues.delete('ST_SMS_BG_GLOBAL');
window.__pmBgGlobal = newGlobalBackground;
idbControl.abortOperations.push({ type: 'put', key: 'ST_SMS_BG_GLOBAL' });
await assert.rejects(saveBgGlobal(), /全局背景保存失败：IndexedDB 不可用/);
assert.equal(idbValues.has('ST_SMS_BG_GLOBAL'), false, '全局背景主体写失败不得留下主数据');
assert.equal(localValues.has('ST_SMS_BG_GLOBAL'), false, '全局背景主体写失败不得提交索引');

localValues.delete('ST_SMS_BG_GLOBAL');
window.__pmBgGlobal = newGlobalBackground;
localStorageControl.failSet.add('ST_SMS_BG_GLOBAL');
await assert.rejects(saveBgGlobal(), /全局背景索引保存失败/);
assert.equal(idbValues.has('ST_SMS_BG_GLOBAL'), false);
assert.equal(localValues.has('ST_SMS_BG_GLOBAL'), false);

const oldGlobalBackground = largeBackground('old-global');
idbValues.set('ST_SMS_BG_GLOBAL', oldGlobalBackground);
localValues.set('ST_SMS_BG_GLOBAL', '__idb__');
window.__pmBgGlobal = '';
localStorageControl.failSet.add('ST_SMS_BG_GLOBAL');
await assert.rejects(saveBgGlobal(), /全局背景保存失败/);
assert.equal(idbValues.get('ST_SMS_BG_GLOBAL'), oldGlobalBackground);
assert.equal(localValues.get('ST_SMS_BG_GLOBAL'), '__idb__');

localValues.delete('ST_SMS_BG_GLOBAL');
window.__pmBgGlobal = newGlobalBackground;
localStorageControl.failSet.add('ST_SMS_BG_GLOBAL');
idbControl.abortOperations.push({ type: 'delete', key: 'ST_SMS_BG_GLOBAL' });
await assert.rejects(saveBgGlobal(), /全局背景索引保存失败：浏览器存储不可用；全局背景主数据补偿失败/);
assert.equal(idbValues.get('ST_SMS_BG_GLOBAL'), newGlobalBackground);
assert.equal(localValues.has('ST_SMS_BG_GLOBAL'), false);
idbValues.delete('ST_SMS_BG_GLOBAL');

idbValues.set('ST_SMS_BG_GLOBAL', oldGlobalBackground);
localValues.set('ST_SMS_BG_GLOBAL', '__idb__');
window.__pmBgGlobal = '';
localStorageControl.failSet.add('ST_SMS_BG_GLOBAL');
idbControl.abortOperations.push({ type: 'put', key: 'ST_SMS_BG_GLOBAL' });
await assert.rejects(saveBgGlobal(), /全局背景保存失败：浏览器存储不可用；全局背景主数据补偿失败/);
assert.equal(idbValues.has('ST_SMS_BG_GLOBAL'), false);
assert.equal(localValues.get('ST_SMS_BG_GLOBAL'), '__idb__');

const oldAliceBackground = largeBackground('old-alice');
const newAliceBackground = largeBackground('new-alice');
const newBobBackground = largeBackground('new-bob');
idbValues.set('ST_SMS_BG_LOCAL_story_Alice', oldAliceBackground);
localValues.set('ST_SMS_BG_LOCAL', JSON.stringify({
    story_Alice: '__idb__',
    story_Carol: 'https://example.test/carol.png',
}));
window.__pmBgLocal = {
    story_Alice: newAliceBackground,
    story_Bob: newBobBackground,
    story_Carol: 'https://example.test/carol-new.png',
};
localStorageControl.failSet.add('ST_SMS_BG_LOCAL');
await assert.rejects(saveBgLocal(), /会话背景索引保存失败/);
assert.equal(idbValues.get('ST_SMS_BG_LOCAL_story_Alice'), oldAliceBackground);
assert.equal(idbValues.has('ST_SMS_BG_LOCAL_story_Bob'), false);
assert.deepEqual(JSON.parse(localValues.get('ST_SMS_BG_LOCAL')), {
    story_Alice: '__idb__',
    story_Carol: 'https://example.test/carol.png',
});

idbValues.set('ST_SMS_BG_LOCAL_story_Alice', oldAliceBackground);
localValues.set('ST_SMS_BG_LOCAL', JSON.stringify({ story_Alice: '__idb__' }));
window.__pmBgLocal = {
    story_Alice: newAliceBackground,
    story_Bob: newBobBackground,
};
idbControl.abortOperations.push({ type: 'put', key: 'ST_SMS_BG_LOCAL_story_Bob' });
await assert.rejects(saveBgLocal(), /会话背景保存失败：IndexedDB 不可用/);
assert.equal(idbValues.get('ST_SMS_BG_LOCAL_story_Alice'), oldAliceBackground);
assert.equal(idbValues.has('ST_SMS_BG_LOCAL_story_Bob'), false);
assert.deepEqual(JSON.parse(localValues.get('ST_SMS_BG_LOCAL')), { story_Alice: '__idb__' });

idbValues.delete('ST_SMS_BG_LOCAL_story_Alice');
localValues.set('ST_SMS_BG_LOCAL', '{}');
window.__pmBgLocal = { story_Alice: newAliceBackground };
localStorageControl.failSet.add('ST_SMS_BG_LOCAL');
idbControl.abortOperations.push({ type: 'delete', key: 'ST_SMS_BG_LOCAL_story_Alice' });
await assert.rejects(saveBgLocal(), /会话背景索引保存失败：浏览器存储不可用；会话背景主数据补偿失败/);
assert.equal(idbValues.get('ST_SMS_BG_LOCAL_story_Alice'), newAliceBackground);
assert.equal(localValues.get('ST_SMS_BG_LOCAL'), '{}');
idbValues.delete('ST_SMS_BG_LOCAL_story_Alice');

const groupEntry = createMessageEntry({
    role: 'assistant',
    content: 'Alice：第一句 / 第二句\nBob：第三句',
    descriptors: [
        { text: '第一句', sender: 'Alice' },
        { text: '第二句', sender: 'Alice' },
        { text: '第三句', sender: 'Bob' },
    ],
});
const groupBubbles = describeMessageEntry(groupEntry, { isGroup: true, groupMembers: ['Alice', 'Bob'] });
assert.equal(groupBubbles.length, 3, '群聊同一 assistant entry 必须持久化每个可见气泡');
assert.equal(new Set(groupBubbles.map(item => item.bubbleId)).size, 3,
    '群聊同一 assistant entry 的每个气泡必须拥有唯一 bubbleId');
assert.equal(groupBubbles[2].sender, 'Bob');

const longQuoteText = '😀'.repeat(81);
const quoteSnapshot = createQuoteSnapshot({
    messageId: groupEntry.messageId,
    bubbleId: groupBubbles[1].bubbleId,
    sender: 'Alice',
    text: longQuoteText,
});
assert.equal([...quoteSnapshot.text].length, 80, '引用快照必须按 Unicode code point 截断，避免拆坏 emoji');
assert.equal(createQuoteSnapshot({ messageId: groupEntry.messageId, text: '缺少气泡 ID' }), null,
    '缺少稳定 bubbleId 的引用不得进入持久化结构');
const quotedUserEntry = createMessageEntry({
    role: 'user', content: '回复内容', descriptors: ['回复内容'], quote: quoteSnapshot,
});
assert.deepEqual(quotedUserEntry.quote, quoteSnapshot, '用户 entry 必须持久化规范化引用快照');
const compactQuote = {
    messageId: groupEntry.messageId, bubbleId: groupBubbles[0].bubbleId,
    sender: 'Alice', text: '第一行\n第二行',
};
const quoteContext = formatQuoteContext(compactQuote);
assert.equal(quoteContext, '引用 Alice 的消息：“第一行 第二行”', 'Prompt 引用文本必须折叠换行并保留发送者');
assert.equal(formatQuoteContext({ text: '无稳定 ID' }), '', '无效引用不得污染 Prompt');
const historyWithQuote = buildHistoryText([
    createMessageEntry({ role: 'user', content: '历史回复', descriptors: ['历史回复'], quote: compactQuote }),
], 10, '用户', 'Alice');
assert.match(historyWithQuote, /【引用 Alice 的消息：“第一行 第二行”】\n用户：历史回复/,
    '历史 Prompt 必须在用户正文前序列化引用关系');
const promptArgs = {
    currentPersona: 'Alice', userName: '用户', userBlock: '用户名字：用户', contextBlockMain: '',
    groupName: '测试群', memberList: 'Alice、Bob', cardScenario: '', worldBookText: '', mainChatText: '',
    smsHistoryText: '旧历史', currentQuoteText: quoteContext, directorNote: '',
    userMsgClean: '本轮回复', userMsg: '本轮回复',
};
for (const [label, prompt] of [
    ['主 API 私聊', buildSingleInjectedInstruction(promptArgs)],
    ['主 API 群聊', buildGroupInjectedInstruction(promptArgs)],
    ['独立 API 私聊', buildIndependentSingleUserPrompt(promptArgs)],
    ['独立 API 群聊', buildIndependentGroupUserPrompt(promptArgs)],
]) {
    assert.match(prompt, /【本轮回复关系】[\s\S]*引用 Alice 的消息：“第一行 第二行”/,
        `${label} Prompt 必须显式包含本轮引用关系`);
}
assert.equal(describeMessageEntry(quotedUserEntry)[0].text, '回复内容',
    '引用元数据不得改变消息正文与历史 prompt 文本');

const legacyGroupHistory = [{ role: 'assistant', content: 'Alice：旧消息一 / 旧消息二' }];
assert.equal(normalizeMessageHistory(legacyGroupHistory, {
    isGroup: true, groupMembers: ['Alice'], legacySeed: 'story:group',
}), true);
const firstLegacyIds = structuredClone(legacyGroupHistory);
assert.equal(normalizeMessageHistory(legacyGroupHistory, {
    isGroup: true, groupMembers: ['Alice'], legacySeed: 'story:group',
}), false, '已迁移历史重复归一化不得再次改写稳定 ID');
assert.deepEqual(legacyGroupHistory, firstLegacyIds, '旧群聊重开后 messageId 与 bubbleId 必须保持稳定');

const duplicateIdHistory = [
    {
        role: 'assistant', content: '第一条', messageId: 'msg_duplicate',
        bubbles: [{ bubbleId: 'bubble_duplicate', text: '第一条', sender: 'Alice' }],
    },
    {
        role: 'assistant', content: '第二条', messageId: 'msg_duplicate',
        bubbles: [{ bubbleId: 'bubble_duplicate', text: '第二条', sender: 'Bob' }],
    },
    {
        role: 'user', content: '引用脏数据', messageId: 'msg_quote',
        bubbles: [{ bubbleId: 'bubble_quote', text: '引用脏数据', sender: '' }],
        quote: { messageId: 'msg_duplicate', bubbleId: 'bubble_duplicate', sender: 'Bob', text: '第二条' },
    },
];
assert.equal(normalizeMessageHistory(duplicateIdHistory, {
    isGroup: true, groupMembers: ['Alice', 'Bob'], legacySeed: 'story:dirty-group',
}), true, '导入的重复稳定 ID 必须被修复');
assert.equal(new Set(duplicateIdHistory.map(entry => entry.messageId)).size, duplicateIdHistory.length,
    '修复后会话内 messageId 必须唯一');
assert.equal(new Set(duplicateIdHistory.flatMap(entry => entry.bubbles.map(bubble => bubble.bubbleId))).size, 3,
    '修复后会话内 bubbleId 必须唯一');
assert.notEqual(duplicateIdHistory[2].quote.messageId, duplicateIdHistory[0].messageId,
    '无法判定原目标的重复 ID 引用必须降级为不可定位快照');
assert.notEqual(duplicateIdHistory[2].quote.messageId, duplicateIdHistory[1].messageId);
const repairedDuplicateHistory = structuredClone(duplicateIdHistory);
assert.equal(normalizeMessageHistory(duplicateIdHistory, {
    isGroup: true, groupMembers: ['Alice', 'Bob'], legacySeed: 'story:dirty-group',
}), false, '重复 ID 修复完成后再次归一化不得继续漂移');
assert.deepEqual(duplicateIdHistory, repairedDuplicateHistory);

window.__pmHistories = { story: { Alice: [{ role: 'user', content: '保留' }] } };
idbControl.abortAll = true;
await assert.rejects(saveHistoriesStrict(), /IndexedDB 不可用/);
idbControl.abortAll = false;
localStorageControl.failSet.add('ST_SMS_DATA_V2');
await assert.rejects(
    saveHistoriesStrict(window.__pmHistories, { requireLocalMirror: true }),
    /聊天记录保存失败：浏览器存储不可用/,
);
assert.deepEqual(idbValues.get('ST_SMS_DATA_V2'), window.__pmHistories,
    '严格镜像模式在 IndexedDB 已写入而 localStorage 失败时必须向调用方报告失败，以便事务补偿');

const oldStorageId = 'sms_alice.png__chat-old';
const newStorageId = 'sms_alice.png__chat-copy';
const oldHistory = [{ role: 'user', content: '旧会话私有内容' }];
window.__pmHistories = { [oldStorageId]: { Alice: structuredClone(oldHistory) } };
window.__pmGroupMeta = {};
let activeConversationStorageId = oldStorageId;
const isolatedConversationState = {
    activeStorageId: oldStorageId,
    currentPersona: 'Alice',
    conversationHistory: structuredClone(oldHistory),
    isGroupChat: false,
    currentGroupKey: '',
    groupMembers: [], groupExtras: [], groupColorMap: {}, groupDisplayName: '',
    phoneWindow: null,
};
const isolatedBubbleCalls = [];
const isolatedConversationDeps = {
    getStorageId: () => activeConversationStorageId,
    addNote: () => {}, addBubble: (...args) => isolatedBubbleCalls.push(args),
    addDirector: () => {}, fitNameFont: () => {},
    applyBackground: () => {}, applyBidirectionalInjection: () => {}, resetEmojiRenderBudget: () => {},
};
installConversation(isolatedConversationState, isolatedConversationDeps);
activeConversationStorageId = newStorageId;
window.__pmSwitch('Alice', 'Alice', oldStorageId, { preservePage: true });
assert.equal(isolatedConversationState.activeStorageId, newStorageId);
assert.deepEqual(isolatedConversationState.conversationHistory, [], '新 storageId 首次打开不得读取旧会话历史');
const migratedOldHistory = window.__pmHistories[oldStorageId].Alice;
assert.equal(migratedOldHistory[0].content, oldHistory[0].content, '切换 storageId 时旧会话内容不得变化');
assert.match(migratedOldHistory[0].messageId, /^msg_legacy_/, '旧历史首次保存必须补齐确定性 messageId');
assert.equal(migratedOldHistory[0].bubbles[0].text, oldHistory[0].content);
assert.match(migratedOldHistory[0].bubbles[0].bubbleId, /^bubble_legacy_/, '旧历史气泡必须补齐确定性 bubbleId');
assert.equal(window.__pmHistories[newStorageId], undefined, '只读新会话不得伪造或复制旧历史');

const copiedConversationHistory = [createMessageEntry({
    role: 'user', content: '新会话独立内容 / 第二气泡',
    descriptors: ['新会话独立内容', '第二气泡'], quote: quoteSnapshot,
})];
isolatedConversationState.conversationHistory = structuredClone(copiedConversationHistory);
activeConversationStorageId = oldStorageId;
window.__pmSwitch('Alice', 'Alice', newStorageId, { preservePage: true });
assert.equal(window.__pmHistories[newStorageId].Alice[0].content, copiedConversationHistory[0].content,
    '离开新 storageId 时必须通过真实 __pmSwitch 自动保存当前内容');
assert.notEqual(window.__pmHistories[newStorageId].Alice[0].messageId, migratedOldHistory[0].messageId);
assert.deepEqual(window.__pmHistories[oldStorageId].Alice, migratedOldHistory, '写入新 storageId 不得污染旧会话 key');
assert.deepEqual(isolatedConversationState.conversationHistory, migratedOldHistory, '切回旧 storageId 必须只恢复旧会话数据');
assert.equal(isolatedConversationState.conversationHistory[0].messageId, migratedOldHistory[0].messageId,
    '旧历史重开后稳定 messageId 不得变化');
assert.notStrictEqual(isolatedConversationState.conversationHistory, window.__pmHistories[oldStorageId].Alice,
    '加载历史必须返回独立数组，避免 state 原地修改持久化快照');
assert.notStrictEqual(isolatedConversationState.conversationHistory[0], window.__pmHistories[oldStorageId].Alice[0],
    '加载历史的 entry 不得与持久化快照共享引用');
assert.notStrictEqual(isolatedConversationState.conversationHistory[0].bubbles[0], window.__pmHistories[oldStorageId].Alice[0].bubbles[0],
    '加载历史的 bubble 不得与持久化快照共享引用');

const isolatedMessageList = { innerHTML: '' };
isolatedConversationState.phoneWindow = {
    querySelector(selector) { return selector === '.pm-msg-list' ? isolatedMessageList : null; },
};
isolatedBubbleCalls.length = 0;
activeConversationStorageId = newStorageId;
window.__pmSwitch('Alice', 'Alice', oldStorageId, { preservePage: true });
assert.deepEqual(isolatedConversationState.conversationHistory, window.__pmHistories[newStorageId].Alice,
    '再次进入新 storageId 必须恢复离开时自动保存的独立内容');
assert.notStrictEqual(isolatedConversationState.conversationHistory, window.__pmHistories[newStorageId].Alice);
assert.notStrictEqual(isolatedConversationState.conversationHistory[0], window.__pmHistories[newStorageId].Alice[0]);
assert.notStrictEqual(isolatedConversationState.conversationHistory[0].bubbles[0], window.__pmHistories[newStorageId].Alice[0].bubbles[0]);
assert.notStrictEqual(isolatedConversationState.conversationHistory[0].quote, window.__pmHistories[newStorageId].Alice[0].quote,
    '加载历史的 quote 不得与持久化快照共享引用');
assert.equal(isolatedBubbleCalls.length, 2, '双气泡引用消息重载后必须重绘两个气泡');
assert.deepEqual(isolatedBubbleCalls[0][4].quote, quoteSnapshot,
    '持久化重载后首个气泡必须收到完整 quote snapshot');
assert.equal(Object.hasOwn(isolatedBubbleCalls[1][4], 'quote'), false,
    '同一 entry 的非首气泡不得重复渲染引用卡');
assert.equal(isolatedBubbleCalls[0][4].messageId, copiedConversationHistory[0].messageId);
assert.equal(isolatedBubbleCalls[0][4].bubbleId, copiedConversationHistory[0].bubbles[0].bubbleId);
const quotedContactHistory = [createMessageEntry({
    role: 'assistant', content: '这是 Alice 的历史消息', descriptors: ['这是 Alice 的历史消息'],
})];
window.__pmHistories[newStorageId].Alice = structuredClone(quotedContactHistory);
isolatedConversationState.conversationHistory = structuredClone(quotedContactHistory);
isolatedBubbleCalls.length = 0;
window.__pmSwitch('Alice', undefined, undefined, { preservePage: true });
assert.equal(isolatedBubbleCalls[0][4].sender, 'Alice',
    '重绘单聊对方历史时，引用快照必须保留联系人名而不是错误回退为“我”');
assert.equal(isolatedBubbleCalls[0][1], 'left', '单聊对方历史必须继续渲染在左侧');
window.__pmHistories[newStorageId].Alice = structuredClone(copiedConversationHistory);
isolatedConversationState.conversationHistory = structuredClone(copiedConversationHistory);
const oldScopeBeforeMutation = structuredClone(window.__pmHistories[oldStorageId].Alice);
const newScopeBeforeMutation = structuredClone(window.__pmHistories[newStorageId].Alice);
isolatedConversationState.conversationHistory[0].bubbles[0].text = '仅修改运行态气泡';
isolatedConversationState.conversationHistory[0].quote.text = '仅修改运行态引用';
assert.deepEqual(window.__pmHistories[oldStorageId].Alice, oldScopeBeforeMutation,
    '修改新 scope 的运行态历史不得污染旧 scope 持久化数据');
assert.deepEqual(window.__pmHistories[newStorageId].Alice, newScopeBeforeMutation,
    '修改新 scope 的运行态嵌套字段不得污染新 scope 持久化快照');
isolatedConversationDeps.persistCurrentHistory('Alice', newStorageId);
assert.equal(window.__pmHistories[newStorageId].Alice[0].bubbles[0].text, '仅修改运行态气泡');
assert.equal(window.__pmHistories[newStorageId].Alice[0].quote.text, '仅修改运行态引用');
assert.deepEqual(window.__pmHistories[oldStorageId].Alice, oldScopeBeforeMutation,
    '显式保存新 scope 后仍不得改变旧 scope');
isolatedConversationState.phoneWindow = null;

const groupSwitchStorageId = 'sms_alice.png__group-switch';
const legacyGroupKey = '__group_legacy';
const legacyGroupMessage = { role: 'assistant', content: 'Alice：群消息一 / 群消息二' };
window.__pmHistories = {
    [groupSwitchStorageId]: {
        [legacyGroupKey]: [structuredClone(legacyGroupMessage)],
        Bob: [{ role: 'assistant', content: 'Bob：这是单聊正文' }],
    },
};
activeConversationStorageId = groupSwitchStorageId;
isolatedConversationState.activeStorageId = groupSwitchStorageId;
isolatedConversationState.currentPersona = legacyGroupKey;
isolatedConversationState.currentGroupKey = legacyGroupKey;
isolatedConversationState.isGroupChat = true;
isolatedConversationState.groupMembers = ['Alice'];
isolatedConversationState.conversationHistory = [structuredClone(legacyGroupMessage)];
window.__pmSwitch('Bob', legacyGroupKey, groupSwitchStorageId, {
    preservePage: true,
    previousConversationContext: { isGroupChat: true, groupMembers: ['Alice'] },
});
const migratedGroupOnSwitch = window.__pmHistories[groupSwitchStorageId][legacyGroupKey][0];
assert.equal(migratedGroupOnSwitch.bubbles.length, 2,
    '旧群聊切到单聊时必须按旧群聊上下文迁移多气泡');
assert.deepEqual(migratedGroupOnSwitch.bubbles.map(item => item.sender), ['Alice', 'Alice']);

isolatedConversationState.currentPersona = 'Bob';
isolatedConversationState.currentGroupKey = '';
isolatedConversationState.isGroupChat = false;
isolatedConversationState.groupMembers = [];
isolatedConversationState.conversationHistory = [{ role: 'assistant', content: 'Bob：这是单聊正文' }];
window.__pmSwitch(legacyGroupKey, 'Bob', groupSwitchStorageId, {
    preservePage: true,
    previousConversationContext: { isGroupChat: false, groupMembers: [] },
});
const migratedSingleOnSwitch = window.__pmHistories[groupSwitchStorageId].Bob[0];
assert.equal(migratedSingleOnSwitch.bubbles.length, 1,
    '旧单聊切到群聊时不得按目标群成员拆解旧单聊正文');
assert.equal(migratedSingleOnSwitch.bubbles[0].sender, '');

const validBranchLineage = {
    [getStorageIdFor('alice.png', 'branch-chat')]: {
        sourceId: getStorageIdFor('alice.png', 'parent-chat'), parentChatId: 'parent-chat',
        targetChatId: 'branch-chat', avatar: 'alice.png', completedAt: 123, schemaVersion: 1,
    },
};
const currentBackup = {
    histories: {}, config: {}, theme: { darkMode: 'dark', ambientStatusEnabled: true }, profiles: [], groupMeta: {}, pokeConfig: {},
    bidirectional: {}, injectionConfig: {
        phone: { position: 1, depth: 6, historyLimit: 14 },
        community: { position: 2, depth: 3 }, calendar: { position: 1, depth: 4 }, todayTrend: { position: 1, depth: 4 },
    }, emojis: [], characterBehavior: {}, worldBookConfig: normalizeWorldBookConfig(null), wordyLimit: false,
    budgetConfig: { budgetVersion: 4, targetTokens: 900, sourceWeights: { phone: 1, community: 0, calendar: 2, todayTrend: 0 },
        sourcePriority: ['calendar', 'phone', 'community', 'todayTrend'], redistributeUnused: true, communitySceneIdsByStorage: {}, communitySelectionsByStorage: {} },
    desktopBg: 'https://example.test/current-desktop.png', bgGlobal: '', bgLocal: {}, interactiveScenes: { version: 1, scopes: {} },
    calendarStore: { version: 1, scopes: { current: { events: {} } } },
    calendarOccasions: { version: 1, scopes: {} },
    calendarHolidays: { version: 1, selectedCountry: 'JP', years: {} },
    calendarWeather: { version: 1, location: null, lastSuccess: null },
    calendarCycles: { version: 1, scopes: {} },
    calendarRecipes: { version: 1, scopes: { current: {
        regionPreference: '潮汕', lastGeneratedRegion: '', lastGeneratedAt: 0,
        days: { '2026-07-01': {
            breakfast: { text: '粿条汤', source: 'manual', updatedAt: 1 },
        } },
    } } },
    calendarOutfits: { version: 1, scopes: { current: {
        subjects: { 'role:Alice': { colorPreference: '', preference: '', generationRule: '', days: {} } },
    } } },
    phoneUiState: {
        version: 1,
        scopes: { story: { pinnedSceneIds: [], lastPage: 'chat', lastSceneId: null, lastTab: 'feed' } },
    },
    ambientStatus: { enabled: true },
    branchLineage: validBranchLineage,
};
const parsedLegacyBackup = parseBackupData({ histories: { story: {} } }, currentBackup);
assert.deepEqual(parsedLegacyBackup.histories, { story: {} });
assert.equal(parsedLegacyBackup.desktopBg, currentBackup.desktopBg, 'v1-v5 备份不得覆盖后加入的桌面背景');
assert.deepEqual(parsedLegacyBackup.interactiveScenes, currentBackup.interactiveScenes);
assert.deepEqual(parsedLegacyBackup.phoneUiState, currentBackup.phoneUiState);
assert.deepEqual(parsedLegacyBackup.ambientStatus, currentBackup.ambientStatus);
for (const schemaVersion of [undefined, 2, 3]) {
    const backup = {
        ...(schemaVersion === undefined ? {} : { schemaVersion }),
        theme: { darkMode: 'light', ambientStatusEnabled: false },
        phoneUiState: {
            version: 1,
            scopes: { story: { pinnedSceneIds: ['forged'], lastPage: 'community', lastSceneId: 'forged', lastTab: 'live' } },
        },
        ambientStatus: { enabled: false },
    };
    const parsed = parseBackupData(backup, currentBackup);
    assert.equal(parsed.theme.darkMode, 'light');
    assert.equal(parsed.theme.ambientStatusEnabled, true);
    assert.deepEqual(parsed.phoneUiState, currentBackup.phoneUiState);
    assert.deepEqual(parsed.ambientStatus, currentBackup.ambientStatus);
    assert.equal(Object.hasOwn(backup.theme, 'ambientStatusEnabled'), true);
}
assert.equal(normalizeThemePreset('apple'), 'default', '已删除的主题预设必须迁移为默认主题');
assert.equal(normalizeThemePreset('custom'), 'custom', '自定义主题预设必须保留');
assert.equal(parseBackupData({ theme: { preset: 'apple', darkMode: 'light' } }, currentBackup).theme.preset, 'default',
    '历史备份中的已删除主题必须在导入解析阶段迁移为默认主题');
assert.equal(parseBackupData({ theme: { preset: 'custom', customAccent: '#123456' } }, currentBackup).theme.preset, 'custom',
    '备份导入不得误迁移自定义主题');
assert.throws(() => parseBackupData({ schemaVersion: '3' }, currentBackup), /备份版本无效/);
assert.deepEqual(parseBackupData({ schemaVersion: 7 }, currentBackup).calendarRecipes, currentBackup.calendarRecipes);
assert.deepEqual(parseBackupData({ schemaVersion: 7, injectionConfig: { position: 2, depth: 9, historyLimit: 3 } }, currentBackup).injectionConfig,
    currentBackup.injectionConfig, '旧版备份不得导入尚未定义的统一注入规则');
assert.deepEqual(parseBackupData({ schemaVersion: 8, injectionConfig: { position: 2, depth: 9, historyLimit: 3 } }, currentBackup).injectionConfig,
    { phone: { position: 2, depth: 9, historyLimit: 3 }, community: { position: 2, depth: 9 }, calendar: { position: 1, depth: 4 }, todayTrend: { position: 1, depth: 4 } });
assert.deepEqual(parseBackupData({ schemaVersion: 8 }, currentBackup).injectionConfig, {
    phone: { position: 0, depth: 0, historyLimit: 20 },
    community: { position: 0, depth: 0 }, calendar: { position: 1, depth: 4 }, todayTrend: { position: 1, depth: 4 },
}, 'schema 8 缺少统一注入规则时必须保留现有日历放置规则');
assert.throws(() => parseBackupData({ schemaVersion: 8, injectionConfig: [] }, currentBackup), /injectionConfig 必须是对象/);
assert.deepEqual(parseBackupData({ schemaVersion: 9, injectionConfig: {
    phone: { position: 1, depth: 2, historyLimit: 8 }, community: { position: 2, depth: 3 }, calendar: { position: 0, depth: 4 },
} }, currentBackup).injectionConfig, {
    phone: { position: 1, depth: 2, historyLimit: 8 }, community: { position: 2, depth: 3 }, calendar: { position: 0, depth: 4 }, todayTrend: { position: 0, depth: 4 },
});
assert.deepEqual(parseBackupData({ schemaVersion: 10, branchLineage: validBranchLineage }, currentBackup).branchLineage,
    validBranchLineage, 'schema 10 必须导入经过校验的分支继承完成标记');
assert.throws(() => parseBackupData({ schemaVersion: 10 }, currentBackup), /缺少 branchLineage/);
assert.throws(() => parseBackupData({ schemaVersion: 10, branchLineage: [] }, currentBackup), /branchLineage 必须是对象/);
assert.throws(() => parseBackupData({ schemaVersion: 10, branchLineage: {
    bad: { ...Object.values(validBranchLineage)[0], targetChatId: 'other-chat' },
} }, currentBackup), /targetChatId 与目标 scope 不一致/);
assert.deepEqual(parseBackupData({ schemaVersion: 11, branchLineage: validBranchLineage, worldBookConfig: {
    entries: { [worldBookKey]: false }, columns: { 纪要: { chat: false } },
} }, currentBackup).worldBookConfig, normalizeWorldBookConfig({
    entries: { [worldBookKey]: false }, columns: { 纪要: { chat: false } },
}));
assert.throws(() => parseBackupData({ schemaVersion: 11, branchLineage: validBranchLineage }, currentBackup), /缺少 worldBookConfig/);
const importedOutfits = normalizeOutfitStore({ version: 1, scopes: { story: {
    subjects: { 'role:Alice': {
        colorPreference: '深色', preference: '通勤', generationRule: '优先复用既有衣物',
        days: { '2032-03-15': { text: '黑色风衣与短靴', source: 'manual', updatedAt: 12 } },
    } },
} } });
const parsedV12Backup = parseBackupData({
    schemaVersion: 12, branchLineage: validBranchLineage, worldBookConfig: { entries: {}, columns: {} },
    calendarOutfits: importedOutfits,
}, currentBackup);
assert.deepEqual(parsedV12Backup.calendarOutfits, importedOutfits, 'schema 12 必须读取规范穿搭 store');
const restoredOutfit = parsedV12Backup.calendarOutfits.scopes.story.subjects['role:Alice'];
assert.equal(restoredOutfit.colorPreference, '深色');
assert.equal(restoredOutfit.preference, '通勤');
assert.equal(restoredOutfit.generationRule, '优先复用既有衣物');
assert.deepEqual(restoredOutfit.days['2032-03-15'], { text: '黑色风衣与短靴', source: 'manual', updatedAt: 12 });
assert.deepEqual(parseBackupData({
    schemaVersion: 12, branchLineage: validBranchLineage, worldBookConfig: { entries: {}, columns: {} }, calendarOutfits: importedOutfits,
}, currentBackup).budgetConfig, currentBackup.budgetConfig, 'schema 12 不得伪造恢复尚未定义的预算配置');
const importedBudgetConfig = {
    budgetVersion: 3, targetTokens: 1200,
    sourceWeights: { phone: 1, community: 0, calendar: 0, recipe: 0, outfit: 3, todayTrend: 0 },
    sourcePriority: ['outfit', 'phone', 'community', 'calendar', 'recipe', 'todayTrend'], redistributeUnused: false,
    communitySceneIdsByStorage: {}, communitySelectionsByStorage: {},
};
assert.deepEqual(parseBackupData({
    schemaVersion: 13, branchLineage: validBranchLineage, worldBookConfig: { entries: {}, columns: {} },
    calendarOutfits: importedOutfits, budgetConfig: importedBudgetConfig,
}, currentBackup).budgetConfig, { ...importedBudgetConfig, budgetVersion: 4, sourceWeights: { phone: 1, community: 0, calendar: 3, todayTrend: 0 }, sourcePriority: ['calendar', 'phone', 'community', 'todayTrend'] }, 'schema 13 必须将旧 outfit 权重迁入日历预算');
assert.throws(() => parseBackupData({
    schemaVersion: 13, branchLineage: validBranchLineage, worldBookConfig: { entries: {}, columns: {} }, calendarOutfits: importedOutfits,
}, currentBackup), /缺少 budgetConfig/);
assert.deepEqual(parseBackupData({
    schemaVersion: 11, branchLineage: validBranchLineage, worldBookConfig: { entries: {}, columns: {} }, calendarOutfits: importedOutfits,
}, currentBackup).calendarOutfits, currentBackup.calendarOutfits, 'schema 11 不得解析尚未定义的 calendarOutfits 字段');
assert.throws(() => parseBackupData({ schemaVersion: 14, branchLineage: validBranchLineage, worldBookConfig: { entries: {}, columns: {} },
    calendarOutfits: importedOutfits, budgetConfig: importedBudgetConfig }, currentBackup), /缺少 todayTrend/);
assert.deepEqual(parseBackupData({ schemaVersion: 14, branchLineage: validBranchLineage, worldBookConfig: { entries: {}, columns: {} },
    calendarOutfits: importedOutfits, budgetConfig: importedBudgetConfig, todayTrend: createEmptyTodayTrendStore() }, currentBackup).todayTrend,
createEmptyTodayTrendStore(), 'schema 14 必须恢复今日风向数据');
const parsedV4Backup = parseBackupData({
    schemaVersion: 4,
    theme: { darkMode: 'light', ambientStatusEnabled: true },
    interactiveScenes: {
        version: 1,
        scopes: {
            story: {
                activeSceneId: 'scene-v4', sceneOrder: ['scene-v4'],
                scenes: { 'scene-v4': { id: 'scene-v4', title: 'v4 社区' } },
            },
        },
    },
    phoneUiState: {
        version: 1,
        scopes: {
            story: {
                pinnedSceneIds: ['scene-v4', 'missing'], lastPage: 'community', lastSceneId: 'scene-v4', lastTab: 'live',
            },
            other: {
                pinnedSceneIds: ['scene-v4'], lastPage: 'community', lastSceneId: 'scene-v4', lastTab: 'prompt',
            },
        },
    },
    ambientStatus: { enabled: false },
}, currentBackup);
assert.equal(parsedV4Backup.theme.darkMode, 'light');
assert.equal(parsedV4Backup.theme.ambientStatusEnabled, false);
assert.deepEqual(parsedV4Backup.ambientStatus, { enabled: false });
assert.deepEqual(parsedV4Backup.phoneUiState.scopes.story, {
    pinnedSceneIds: ['scene-v4'], lastPage: 'community', lastSceneId: 'scene-v4', lastTab: 'live',
    lastChatType: null, lastChatKey: null,
});
assert.deepEqual(parsedV4Backup.phoneUiState.scopes.other, {
    pinnedSceneIds: [], lastPage: 'desktop', lastSceneId: null, lastTab: 'feed',
    lastChatType: null, lastChatKey: null,
});
const parsedV4Defaults = parseBackupData({ schemaVersion: 4 }, currentBackup);
assert.deepEqual(parsedV4Defaults.phoneUiState, { version: 1, scopes: {} });
assert.deepEqual(parsedV4Defaults.ambientStatus, { enabled: false });
assert.throws(() => parseBackupData({ schemaVersion: 4, phoneUiState: [] }, currentBackup), /phoneUiState 必须是对象/);
assert.throws(() => parseBackupData({ schemaVersion: 4, ambientStatus: [] }, currentBackup), /ambientStatus 必须是对象/);
assert.equal(parsedV4Defaults.calendarHolidays.selectedCountry, 'JP', 'v4 备份不得清空现有日历数据');
const parsedV5Backup = parseBackupData({
    schemaVersion: 5,
    calendarStore: { version: 1, scopes: {} },
    calendarOccasions: { version: 1, scopes: {} },
    calendarHolidays: { version: 1, selectedCountry: 'US', years: {} },
    calendarWeather: { version: 1, location: null, lastSuccess: null },
    calendarCycles: { version: 1, scopes: {} },
}, currentBackup);
assert.deepEqual(parsedV5Backup.calendarStore.scopes, {});
assert.equal(parsedV5Backup.calendarHolidays.selectedCountry, 'US');
assert.deepEqual(parsedV5Backup.calendarRecipes, currentBackup.calendarRecipes,
    'v5 备份缺少菜谱字段时必须保留当前菜谱');
for (const schemaVersion of [5, 6]) {
    const parsedLegacyRecipes = parseBackupData({
        schemaVersion,
        calendarRecipes: { version: 1, scopes: { forged: {
            regionPreference: '伪造地区', lastGeneratedRegion: '', days: {}, lastGeneratedAt: 0,
        } } },
    }, currentBackup);
    assert.deepEqual(parsedLegacyRecipes.calendarRecipes, currentBackup.calendarRecipes,
        `schema ${schemaVersion} 不得解析尚未定义的 calendarRecipes 字段`);
}
const importedGenerationRules = {
    calendarStore: normalizeCalendarStore({ version: 1, scopes: {
        storyA: { generationRule: '仅依据角色设定与近期剧情安排日程。' },
        storyB: { generationRule: '另一角色的日程规则。' },
    } }),
    calendarRecipes: normalizeRecipeStore({ version: 1, scopes: {
        storyA: { generationRule: '优先使用剧情中明确出现的食材。' },
        storyB: { generationRule: '另一角色的菜谱规则。' },
    } }),
};
const parsedGenerationRules = parseBackupData({ schemaVersion: 7, ...importedGenerationRules }, currentBackup);
assert.equal(parsedGenerationRules.calendarStore.scopes.storyA.generationRule, '仅依据角色设定与近期剧情安排日程。',
    'schema 7 备份恢复必须保留日程 generationRule');
assert.equal(parsedGenerationRules.calendarStore.scopes.storyB.generationRule, '另一角色的日程规则。',
    '备份恢复必须保留不同 storageId 的日程规则隔离');
assert.equal(parsedGenerationRules.calendarRecipes.scopes.storyA.generationRule, '优先使用剧情中明确出现的食材。',
    'schema 7 备份恢复必须保留菜谱 generationRule');
assert.equal(parsedGenerationRules.calendarRecipes.scopes.storyB.generationRule, '另一角色的菜谱规则。',
    '备份恢复必须保留不同 storageId 的菜谱规则隔离');
const importedRecipes = { version: 1, scopes: { story: {
    regionPreference: '架空北境', generationRule: '只使用剧情中明确出现的北境食材。',
    lastGeneratedRegion: '架空北境', lastGeneratedAt: 12,
    days: { '2032-03-15': { dinner: { text: '北境炖肉', source: 'ai', updatedAt: 12 } } },
} } };
assert.deepEqual(parseBackupData({ schemaVersion: 7, calendarRecipes: importedRecipes }, currentBackup).calendarRecipes,
    importedRecipes, 'schema 7 必须读取规范菜谱 store');
assert.equal(importedRecipes.scopes.story.generationRule, '只使用剧情中明确出现的北境食材。');
const canonicalWeatherLocation = {
    name: '上海', latitude: 31.2, longitude: 121.4, country: 'CN', admin1: '上海', timezone: 'Asia/Shanghai',
};
const canonicalWeatherForecast = {
    days: [{ date: '2026-07-01', weatherCode: 1, tempMax: 30, tempMin: 20 }],
    attribution: 'Weather data © Open-Meteo (CC BY 4.0)',
};
const parsedOldWeatherBackup = parseBackupData({
    schemaVersion: 5,
    calendarWeather: {
        version: 1, location: canonicalWeatherLocation,
        lastSuccess: { locationKey: '31.2,121.4|上海', fetchedAt: 1, forecast: canonicalWeatherForecast },
    },
}, currentBackup);
assert.equal(Object.hasOwn(parsedOldWeatherBackup.calendarWeather.lastSuccess, 'source'), false,
    '旧天气备份缺少来源字段时必须保持原结构可读');
const parsedSourcedWeatherBackup = parseBackupData({
    schemaVersion: 5,
    calendarWeather: {
        version: 1, location: canonicalWeatherLocation,
        lastSuccess: { locationKey: '31.2,121.4|上海', fetchedAt: 1, source: 'cached_forecast', forecast: canonicalWeatherForecast },
    },
}, currentBackup);
assert.equal(parsedSourcedWeatherBackup.calendarWeather.lastSuccess.source, 'cached_forecast');
assert.equal(parsedV5Backup.desktopBg, currentBackup.desktopBg);
assert.equal(parseBackupData({ schemaVersion: 6 }, currentBackup).desktopBg, '');
assert.equal(parseBackupData({ schemaVersion: 6, desktopBg: 'https://example.test/imported.png' }, currentBackup).desktopBg, 'https://example.test/imported.png');
assert.throws(() => parseBackupData({ schemaVersion: 6, desktopBg: {} }, currentBackup), /desktopBg 必须是字符串/);
assert.throws(() => parseBackupData({ schemaVersion: 5, calendarStore: [] }, currentBackup), /calendarStore 必须是对象/);
assert.throws(() => parseBackupData({ schemaVersion: 5, calendarWeather: [] }, currentBackup), /calendarWeather 必须是对象/);
const assertInvalidV5CalendarField = (field, value, pattern = new RegExp(field)) => {
    assert.throws(() => parseBackupData({ schemaVersion: 5, [field]: value }, currentBackup), pattern);
};
assertInvalidV5CalendarField('calendarStore', {
    version: 1,
    scopes: { story: { autoAdjust: false, events: { '2026-07-01': [{ id: 'bad', date: '2026-07-01', title: '', note: '', source: 'manual', createdAt: 1, updatedAt: 1 }] }, lastGeneratedAt: 0, lastAdjustedAt: 0 } },
});
assertInvalidV5CalendarField('calendarStore', {
    version: 1, scopes: {}, unsupported: true,
});
assertInvalidV5CalendarField('calendarOccasions', {
    version: 1,
    scopes: { story: { occasions: [{ id: 'bad', type: 'birthday', month: 2, day: 30, title: '坏日期', note: '', leapDayRule: 'feb28', createdAt: 1, updatedAt: 1 }] } },
});
assertInvalidV5CalendarField('calendarHolidays', {
    version: 1, selectedCountry: 'XX', years: {},
});
assertInvalidV5CalendarField('calendarWeather', {
    version: 1,
    location: { name: '上海', latitude: 31.2, longitude: 121.4, country: 'CN', admin1: '', timezone: 'Asia/Shanghai' },
    lastSuccess: {
        locationKey: '35,139|东京', fetchedAt: 1,
        forecast: { days: [{ date: '2026-07-01', weatherCode: 1, tempMax: 30, tempMin: 20 }], attribution: 'Weather data by Open-Meteo (CC BY 4.0)' },
    },
});
assertInvalidV5CalendarField('calendarWeather', {
    version: 1,
    location: canonicalWeatherLocation,
    lastSuccess: {
        locationKey: '31.2,121.4|上海', fetchedAt: 1, source: 'unknown', forecast: canonicalWeatherForecast,
    },
}, /calendarWeather/);
for (const invalidDate of ['0000-01-01', '2026-02-30', '2026-13-01', '9999-02-29']) {
    assertInvalidV5CalendarField('calendarWeather', {
        version: 1,
        location: canonicalWeatherLocation,
        lastSuccess: {
            locationKey: '31.2,121.4|上海', fetchedAt: 1,
            forecast: { ...canonicalWeatherForecast, days: [{ date: invalidDate, weatherCode: 1, tempMax: 30, tempMin: 20 }] },
        },
    }, /calendarWeather/);
}
assertInvalidV5CalendarField('calendarCycles', {
    version: 1,
    scopes: { story: { enabled: true, lastPeriodStart: null, cycleLength: 28, periodLength: 5, overrides: {} } },
}, /启用周期提示时必须设置/);
assert.throws(() => parseBackupData({
    schemaVersion: 7,
    calendarRecipes: { version: 1, scopes: { story: {
        regionPreference: '架空北境', lastGeneratedRegion: '', lastGeneratedAt: 0,
        days: { '2032-03-15': {
            breakfast: { text: '  非规范空白  ', source: 'manual', updatedAt: 1 },
        } },
    } } },
}, currentBackup), /calendarRecipes 内容无效或不是规范格式/);

let prepareBeforeApplyCalls = 0;
let prepareApplyCalls = 0;
let preparePersistCalls = 0;
await assert.rejects(runBackupTransaction({
    capture: async () => structuredClone(currentBackup),
    prepare: current => parseBackupData({
        schemaVersion: 5,
        calendarCycles: {
            version: 1,
            scopes: { story: { enabled: true, lastPeriodStart: null, cycleLength: 28, periodLength: 5, overrides: {} } },
        },
    }, current),
    beforeApply: async () => { prepareBeforeApplyCalls += 1; },
    apply: async () => { prepareApplyCalls += 1; },
    persist: async () => { preparePersistCalls += 1; },
}), /启用周期提示时必须设置/);
assert.equal(prepareBeforeApplyCalls, 0, '备份校验失败不得进入事务副作用阶段');
assert.equal(prepareApplyCalls, 0, '备份校验失败不得修改内存状态');
assert.equal(preparePersistCalls, 0, '备份校验失败不得写入存储');
assert.throws(() => parseBackupData({ schemaVersion: 3, histories: 'broken' }, currentBackup), /histories 必须是对象/);
assert.throws(() => parseBackupData({ schemaVersion: 3, profiles: {} }, currentBackup), /profiles 必须是数组/);
assert.throws(() => parseBackupData({ schemaVersion: 3, wordyLimit: 'yes' }, currentBackup), /wordyLimit 必须是布尔值/);
assert.throws(() => parseBackupData({
    schemaVersion: 3,
    interactiveScenes: { version: 1, scopes: [] },
}, currentBackup), /scopes 必须是对象/);
assert.throws(() => parseBackupData({
    schemaVersion: 3,
    interactiveScenes: { version: 1, scopes: { story: { activeSceneId: null, sceneOrder: {}, scenes: {} } } },
}, currentBackup), /sceneOrder 必须是数组/);
const recoveredEmptyLegacyScope = parseBackupData({
    schemaVersion: 3,
    interactiveScenes: { version: 1, scopes: { story: { activeSceneId: 'missing', sceneOrder: [], scenes: {} } } },
}, currentBackup).interactiveScenes.scopes.story;
assert.equal(recoveredEmptyLegacyScope.activeSceneId, null);
const recoveredLegacyOrphan = parseBackupData({
    schemaVersion: 3,
    interactiveScenes: { version: 1, scopes: { story: { activeSceneId: null, sceneOrder: [], scenes: { orphan: { id: 'orphan' } } } } },
}, currentBackup).interactiveScenes.scopes.story;
assert.deepEqual(recoveredLegacyOrphan.sceneOrder, []);
assert.deepEqual(recoveredLegacyOrphan.scenes, {});
assert.throws(() => parseBackupData({
    schemaVersion: 3,
    interactiveScenes: { version: 1, scopes: { story: { activeSceneId: 'scene', sceneOrder: ['scene'], scenes: { scene: { id: 'scene', posts: ['broken'] } } } } },
}, currentBackup), /posts\.0 必须是对象/);
assert.throws(() => parseBackupData({
    schemaVersion: 3,
    interactiveScenes: { version: 1, scopes: { story: { activeSceneId: 'scene', sceneOrder: ['scene'], scenes: { scene: { id: 'scene', posts: [{ content: '帖子', comments: {} }] } } } } },
}, currentBackup), /comments 必须是数组/);
assert.throws(() => parseBackupData({
    schemaVersion: 3,
    interactiveScenes: { version: 1, scopes: { story: { activeSceneId: 'scene', sceneOrder: ['scene'], scenes: { scene: { id: 'scene', posts: [{ content: '帖子', comments: ['broken'] }] } } } } },
}, currentBackup), /comments\.0 必须是对象/);
assert.throws(() => parseBackupData({
    schemaVersion: 3,
    interactiveScenes: { version: 1, scopes: { story: { activeSceneId: 'scene', sceneOrder: ['scene'], scenes: { scene: { id: 'scene', live: { danmaku: ['broken'] } } } } } },
}, currentBackup), /danmaku\.0 必须是对象/);
assert.throws(() => parseBackupData({
    schemaVersion: 3,
    interactiveScenes: { version: 1, scopes: { story: { activeSceneId: 'scene', sceneOrder: ['scene'], scenes: { scene: { id: 'scene', posts: [{ content: 123 }] } } } } },
}, currentBackup), /content 必须是字符串/);

const interactiveBackupWithScene = (scene, scope = {}) => ({
    schemaVersion: 3,
    interactiveScenes: {
        version: 1,
        scopes: {
            story: {
                activeSceneId: 'scene',
                sceneOrder: ['scene'],
                scenes: { scene },
                ...scope,
            },
        },
    },
});
const assertInvalidInteractiveScene = (scene, pattern, scope) => {
    assert.throws(() => parseBackupData(interactiveBackupWithScene(scene, scope), currentBackup), pattern);
};
const validInteractiveScene = {
    id: 'scene', title: '社区', preset: 'weibo', styleInput: '', generatedPrompt: '自然交流',
    contentRating: 'legacy-value', createdAt: 100, updatedAt: 200,
    posts: [{
        id: 'post', author: '作者', content: '帖子', tags: ['日常'], createdAt: 110,
        comments: [{ id: 'comment', author: '评论者', content: '评论', createdAt: 120 }], liked: false,
    }],
    live: {
        title: '直播间', status: 'idle',
        danmaku: [{ id: 'danmaku', author: '观众', content: '弹幕', createdAt: 130 }],
    },
};
const parsedMigratedBackup = parseBackupData(interactiveBackupWithScene(validInteractiveScene), currentBackup);
const migratedScene = parsedMigratedBackup.interactiveScenes.scopes.story.scenes.scene;
assert.equal(parsedMigratedBackup.interactiveScenes.version, 2);
assert.equal(Object.hasOwn(migratedScene, 'contentRating'), false);
assert.equal(migratedScene.content, validInteractiveScene.content);
assert.equal(migratedScene.posts[0].content, validInteractiveScene.posts[0].content);
assert.equal(migratedScene.posts[0].authorNameSnapshot, '作者');
assert.equal(migratedScene.posts[0].comments[0].authorNameSnapshot, '评论者');
assert.equal(migratedScene.live.danmaku[0].authorNameSnapshot, '观众');
assert.ok(parsedMigratedBackup.interactiveScenes.scopes.story.actors[migratedScene.posts[0].authorId]);
assert.ok(parsedMigratedBackup.interactiveScenes.scopes.story.actors[migratedScene.posts[0].comments[0].authorId]);
const parsedLegacyScene = parseBackupData(interactiveBackupWithScene({ id: 'scene' }, { activeSceneId: null }), currentBackup);
assert.equal(parsedLegacyScene.interactiveScenes.scopes.story.activeSceneId, 'scene');
const normalizedLegacyIds = parseBackupData(interactiveBackupWithScene({ id: ' scene ', title: '社区' }, {
    activeSceneId: ' scene ',
    sceneOrder: [' scene '],
    scenes: { ' scene ': { id: ' scene ', title: '社区' } },
}), currentBackup).interactiveScenes.scopes.story;
assert.deepEqual(normalizedLegacyIds.sceneOrder, ['scene']);
assert.equal(normalizedLegacyIds.activeSceneId, 'scene');
assert.equal(normalizedLegacyIds.scenes.scene.id, 'scene');
assert.equal(Object.getPrototypeOf(normalizedLegacyIds.scenes), Object.prototype);
assert.throws(() => parseBackupData(interactiveBackupWithScene({ id: 'scene' }, {
    activeSceneId: 'scene',
    sceneOrder: [' scene ', 'scene'],
    scenes: { ' scene ': { id: ' scene ' }, scene: { id: 'scene' } },
}), currentBackup), /归一化后.*(?:重复|冲突)|包含重复场景/);
assert.throws(() => parseBackupData(JSON.parse('{"schemaVersion":3,"interactiveScenes":{"version":2,"scopes":{"story":{"activeSceneId":"scene","sceneOrder":["scene"],"actors":{},"scenes":{"scene":{"id":"scene","title":"社区","preset":"weibo","styleInput":"","generatedPrompt":"","createdAt":1,"updatedAt":1,"posts":[{"id":"post","authorId":"toString","authorNameSnapshot":"伪造","content":"帖子","tags":[],"createdAt":1,"comments":[],"liked":false}],"live":{"title":"直播","status":"idle","danmaku":[]}}}}}}}'), currentBackup), /authorId 未指向有效 actor|包含危险键/);
const mismatchedLegacySceneStore = {
    version: 1,
    scopes: {
        story: {
            activeSceneId: 'safe', sceneOrder: ['safe'],
            scenes: { safe: { id: 'other', title: '旧场景' } },
        },
    },
};
assert.throws(() => normalizeInteractiveStore(mismatchedLegacySceneStore), /id 必须与场景键一致/);
assert.throws(() => parseBackupData({ schemaVersion: 3, interactiveScenes: mismatchedLegacySceneStore }, currentBackup), /id 必须与场景键一致/);
const overflowSceneOrder = Array.from({ length: 13 }, (_, index) => `scene${index}`);
const overflowLegacyStore = {
    version: 1,
    scopes: {
        story: {
            activeSceneId: 'scene0',
            sceneOrder: overflowSceneOrder,
            scenes: Object.fromEntries(overflowSceneOrder.map(sceneId => [sceneId, { title: sceneId }])),
        },
    },
};
const normalizedOverflowModel = normalizeInteractiveStore(overflowLegacyStore);
const normalizedOverflowBackup = parseBackupData({
    schemaVersion: 3, interactiveScenes: overflowLegacyStore,
}, currentBackup).interactiveScenes;
assert.deepEqual(normalizedOverflowBackup, normalizedOverflowModel);
assert.deepEqual(normalizedOverflowModel.scopes.story.sceneOrder, overflowSceneOrder.slice(-12));
assert.equal(normalizedOverflowModel.scopes.story.activeSceneId, 'scene12');
assert.equal(normalizedOverflowModel.scopes.story.scenes.scene1.id, 'scene1');
assert.equal(normalizedOverflowModel.scopes.story.scenes.scene0, undefined);
assert.deepEqual(normalizeInteractiveStore(normalizedOverflowModel), normalizedOverflowModel);

const normalizedLegacyBackup = parseBackupData(interactiveBackupWithScene({
    ...validInteractiveScene,
    title: ` ${'社'.repeat(81)} `,
    preset: '',
    styleInput: ` ${'风'.repeat(2001)} `,
    generatedPrompt: ` ${'提'.repeat(6001)} `,
    posts: [{
        id: 'post', author: ` ${'作'.repeat(81)} `, content: ` ${'帖'.repeat(4001)} `,
        tags: [` ${'标'.repeat(31)} `], createdAt: 110,
        comments: [{ id: 'comment', author: ` ${'评'.repeat(81)} `, content: ` ${'论'.repeat(1001)} `, createdAt: 120 }],
        liked: false,
    }],
    live: {
        ...validInteractiveScene.live,
        title: ` ${'直'.repeat(101)} `,
        danmaku: [{ id: 'danmaku', author: ` ${'观'.repeat(81)} `, content: ` ${'弹'.repeat(201)} `, createdAt: 130 }],
    },
}), currentBackup).interactiveScenes.scopes.story.scenes.scene;
assert.equal(normalizedLegacyBackup.title, '社'.repeat(80));
assert.equal(normalizedLegacyBackup.preset, 'weibo');
assert.equal(normalizedLegacyBackup.styleInput, '风'.repeat(2000));
assert.equal(normalizedLegacyBackup.generatedPrompt, '提'.repeat(6000));
assert.equal(normalizedLegacyBackup.posts[0].content, '帖'.repeat(4000));
assert.equal(normalizedLegacyBackup.posts[0].authorNameSnapshot, '作'.repeat(80));
assert.deepEqual(normalizedLegacyBackup.posts[0].tags, ['标'.repeat(30)]);
assert.equal(normalizedLegacyBackup.posts[0].comments[0].content, '论'.repeat(1000));
assert.equal(normalizedLegacyBackup.live.title, '直'.repeat(100));
assert.equal(normalizedLegacyBackup.live.danmaku[0].content, '弹'.repeat(200));

const legacyStoreWithScene = (scene = validInteractiveScene, scope = {}) => interactiveBackupWithScene(scene, scope).interactiveScenes;
const mutateLegacyStore = mutation => {
    const store = structuredClone(legacyStoreWithScene());
    mutation(store, store.scopes.story, store.scopes.story.scenes.scene);
    return store;
};
const assertAcceptedByBothInteractivePaths = (name, store) => {
    const normalizedModel = normalizeInteractiveStore(store);
    const normalizedBackup = parseBackupData({ schemaVersion: 3, interactiveScenes: store }, currentBackup).interactiveScenes;
    assert.deepEqual(normalizedBackup, normalizedModel, `${name}: model 与 backup 归一化结果必须一致`);
    assert.deepEqual(normalizeInteractiveStore(normalizedModel), normalizedModel, `${name}: v1→v2 迁移结果必须满足 v2 闭包`);
};
const assertRejectedByBothInteractivePaths = (name, store) => {
    assert.throws(() => normalizeInteractiveStore(store), undefined, `${name}: model 必须拒绝`);
    assert.throws(
        () => parseBackupData({ schemaVersion: 3, interactiveScenes: store }, currentBackup),
        undefined,
        `${name}: backup 必须拒绝`,
    );
};
const missingVersionStore = legacyStoreWithScene();
delete missingVersionStore.version;
for (const [name, store] of [
    ['完整 v1 store', legacyStoreWithScene()],
    ['缺失 version 的 legacy v1 store', missingVersionStore],
    ['缺失可选字段的最小 v1 scene', legacyStoreWithScene({ id: 'scene', posts: [{}], live: { danmaku: [{}] } })],
    ['可安全 trim/截断的 v1 文本', legacyStoreWithScene({
        id: 'scene', title: ` ${'场'.repeat(90)} `, styleInput: ` ${'风'.repeat(2100)} `,
        posts: [{ author: ` ${'作'.repeat(90)} `, content: ` ${'帖'.repeat(4100)} `, tags: [` ${'标'.repeat(40)} `] }],
        live: { title: ` ${'直'.repeat(110)} `, danmaku: [{ content: ` ${'弹'.repeat(210)} ` }] },
    })],
    ['null-prototype 字典', (() => {
        const store = legacyStoreWithScene();
        store.scopes = Object.assign(Object.create(null), store.scopes);
        store.scopes.story.scenes = Object.assign(Object.create(null), store.scopes.story.scenes);
        return store;
    })()],
]) assertAcceptedByBothInteractivePaths(name, store);

const rejectedLegacyFixtures = [
    ['store 额外字段', mutateLegacyStore(store => { store.debug = true; })],
    ['scopes 非对象', { version: 1, scopes: [] }],
    ['scope 非对象', mutateLegacyStore((store) => { store.scopes.story = []; })],
    ['scope 额外字段', mutateLegacyStore((store, scope) => { scope.actors = {}; })],
    ['sceneOrder 非数组', mutateLegacyStore((store, scope) => { scope.sceneOrder = {}; })],
    ['scene 非对象', mutateLegacyStore((store, scope) => { scope.scenes.scene = []; })],
    ['scene 额外字段', mutateLegacyStore((store, scope, scene) => { scene.debug = true; })],
    ['live 非对象', mutateLegacyStore((store, scope, scene) => { scene.live = null; })],
    ['live 额外字段', mutateLegacyStore((store, scope, scene) => { scene.live.debug = true; })],
    ['posts 非数组', mutateLegacyStore((store, scope, scene) => { scene.posts = {}; })],
    ['post 非对象', mutateLegacyStore((store, scope, scene) => { scene.posts = [null]; })],
    ['post 额外字段', mutateLegacyStore((store, scope, scene) => { scene.posts[0].debug = true; })],
    ['content 数字', mutateLegacyStore((store, scope, scene) => { scene.posts[0].content = 123; })],
    ['content 布尔值', mutateLegacyStore((store, scope, scene) => { scene.posts[0].content = true; })],
    ['content null', mutateLegacyStore((store, scope, scene) => { scene.posts[0].content = null; })],
    ['content 显式 undefined', mutateLegacyStore((store, scope, scene) => { scene.posts[0].content = undefined; })],
    ['author 数字', mutateLegacyStore((store, scope, scene) => { scene.posts[0].author = 1; })],
    ['author 对象', mutateLegacyStore((store, scope, scene) => { scene.posts[0].author = {}; })],
    ['tags 非数组', mutateLegacyStore((store, scope, scene) => { scene.posts[0].tags = {}; })],
    ['tag 非字符串', mutateLegacyStore((store, scope, scene) => { scene.posts[0].tags = [1]; })],
    ['liked 非布尔值', mutateLegacyStore((store, scope, scene) => { scene.posts[0].liked = 'yes'; })],
    ['comments 非数组', mutateLegacyStore((store, scope, scene) => { scene.posts[0].comments = {}; })],
    ['comment 非对象', mutateLegacyStore((store, scope, scene) => { scene.posts[0].comments = [false]; })],
    ['comment 额外字段', mutateLegacyStore((store, scope, scene) => { scene.posts[0].comments[0].liked = false; })],
    ['danmaku 非数组', mutateLegacyStore((store, scope, scene) => { scene.live.danmaku = {}; })],
    ['danmaku 非对象', mutateLegacyStore((store, scope, scene) => { scene.live.danmaku = [false]; })],
    ['danmaku 额外字段', mutateLegacyStore((store, scope, scene) => { scene.live.danmaku[0].debug = true; })],
    ['tags 数量超限', mutateLegacyStore((store, scope, scene) => { scene.posts[0].tags = Array(6).fill('标签'); })],
    ['posts 数量超限', mutateLegacyStore((store, scope, scene) => { scene.posts = Array.from({ length: 81 }, () => ({ content: '帖子' })); })],
    ['comments 数量超限', mutateLegacyStore((store, scope, scene) => { scene.posts[0].comments = Array.from({ length: 41 }, () => ({ content: '评论' })); })],
    ['danmaku 数量超限', mutateLegacyStore((store, scope, scene) => { scene.live.danmaku = Array.from({ length: 241 }, () => ({ content: '弹幕' })); })],
    ['非法 orphan scene', mutateLegacyStore((store, scope) => {
        scope.scenes.orphan = { id: 'orphan', posts: [{ content: 123, debug: true }] };
    })],
    ['非法淘汰 scene', (() => {
        const store = legacyStoreWithScene();
        const sceneIds = Array.from({ length: 13 }, (_, index) => `scene${index}`);
        store.scopes.story.activeSceneId = 'scene12';
        store.scopes.story.sceneOrder = sceneIds;
        store.scopes.story.scenes = Object.fromEntries(sceneIds.map((sceneId, index) => [
            sceneId,
            index === 0 ? { id: sceneId, posts: [{ content: 123, debug: true }] } : { id: sceneId },
        ]));
        return store;
    })()],
    ['继承 scopes', (() => {
        const store = Object.create({ scopes: legacyStoreWithScene().scopes });
        store.version = 1;
        return store;
    })()],
    ['继承 sceneOrder', (() => {
        const store = legacyStoreWithScene();
        const scope = Object.create({ sceneOrder: ['scene'] });
        scope.activeSceneId = 'scene';
        scope.scenes = store.scopes.story.scenes;
        store.scopes.story = scope;
        return store;
    })()],
    ['继承 scenes', (() => {
        const store = legacyStoreWithScene();
        const scope = Object.create({ scenes: store.scopes.story.scenes });
        scope.activeSceneId = 'scene';
        scope.sceneOrder = ['scene'];
        store.scopes.story = scope;
        return store;
    })()],
    ['accessor scopes', (() => {
        const store = { version: 1 };
        Object.defineProperty(store, 'scopes', { enumerable: true, get: () => legacyStoreWithScene().scopes });
        return store;
    })()],
    ['accessor scene content', (() => {
        const store = structuredClone(legacyStoreWithScene());
        const post = store.scopes.story.scenes.scene.posts[0];
        const content = post.content;
        Object.defineProperty(post, 'content', { enumerable: true, get: () => content });
        return store;
    })()],
];
for (const key of ['createdAt', 'updatedAt']) {
    for (const value of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 0, -1, '100']) {
        rejectedLegacyFixtures.push([`scene.${key} 非法时间戳 ${String(value)}`, mutateLegacyStore((store, scope, scene) => { scene[key] = value; })]);
    }
}
for (const [path, mutation] of [
    ['post.createdAt', (scene, value) => { scene.posts[0].createdAt = value; }],
    ['comment.createdAt', (scene, value) => { scene.posts[0].comments[0].createdAt = value; }],
    ['danmaku.createdAt', (scene, value) => { scene.live.danmaku[0].createdAt = value; }],
]) {
    for (const value of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 0, -1, '100']) {
        rejectedLegacyFixtures.push([`${path} 非法时间戳 ${String(value)}`, mutateLegacyStore((store, scope, scene) => mutation(scene, value))]);
    }
}
for (const [name, store] of rejectedLegacyFixtures) assertRejectedByBothInteractivePaths(name, store);

const invalidInteractiveCases = [
    [{ ...validInteractiveScene, createdAt: '100' }, /createdAt 必须是有效时间戳/],
    [{ ...validInteractiveScene, updatedAt: 0 }, /updatedAt 必须是有效时间戳/],
    [{ ...validInteractiveScene, unsupported: true }, /(?:额外字段：unsupported|unsupported 不受支持)/],
    [{ ...validInteractiveScene, posts: Array.from({ length: 81 }, (_, index) => ({ content: `帖子${index}` })) }, /posts 不能超过 80 项/],
    [{ ...validInteractiveScene, posts: [{ content: 123 }] }, /content 必须是字符串/],
    [{ ...validInteractiveScene, posts: [{ id: '', content: '帖子' }] }, /id (?:必须是非空字符串|格式无效)/],
    [{ ...validInteractiveScene, posts: [{ author: {}, content: '帖子' }] }, /author 必须是字符串/],
    [{ ...validInteractiveScene, posts: [{ content: '帖子', createdAt: Number.NaN }] }, /createdAt 必须是有效时间戳/],
    [{ ...validInteractiveScene, posts: [{ content: '帖子', liked: 'yes' }] }, /liked 必须是布尔值/],
    [{ ...validInteractiveScene, posts: [{ content: '帖子', tags: ['日常', 1] }] }, /tags 必须是字符串数组/],
    [{ ...validInteractiveScene, posts: [{ content: '帖子', tags: Array(6).fill('标签') }] }, /tags 不能超过 5 项/],
    [{ ...validInteractiveScene, posts: [{ content: '帖子', comments: Array.from({ length: 41 }, (_, index) => ({ content: `评论${index}` })) }] }, /comments 不能超过 40 项/],
    [{ ...validInteractiveScene, posts: [{ content: '帖子', comments: [{ content: '评论', liked: false }] }] }, /(?:额外字段：liked|liked 不受支持)/],
    [{ ...validInteractiveScene, live: { ...validInteractiveScene.live, status: 'streaming' } }, /live\.status 必须是 idle/],
    [{ ...validInteractiveScene, live: { ...validInteractiveScene.live, danmaku: Array.from({ length: 241 }, (_, index) => ({ content: `弹幕${index}` })) } }, /danmaku 不能超过 240 项/],
];
for (const [scene, pattern] of invalidInteractiveCases) assertInvalidInteractiveScene(scene, pattern);

const recoveredNullActiveScene = parseBackupData(interactiveBackupWithScene(validInteractiveScene, {
    activeSceneId: null,
}), currentBackup).interactiveScenes.scopes.story;
assert.equal(recoveredNullActiveScene.activeSceneId, 'scene');
assert.throws(() => parseBackupData(JSON.parse('{"schemaVersion":3,"interactiveScenes":{"version":1,"scopes":{"__proto__":{"activeSceneId":null,"sceneOrder":[],"scenes":{}}}}}'), currentBackup), /包含危险键[： ]__proto__/);
assert.throws(() => parseBackupData(JSON.parse('{"schemaVersion":3,"interactiveScenes":{"version":1,"scopes":{"story":{"activeSceneId":"__proto__","sceneOrder":["__proto__"],"scenes":{"__proto__":{"id":"__proto__"}}}}}}'), currentBackup), /包含危险键[： ]__proto__/);

const parsedV3Backup = parseBackupData({
    schemaVersion: 3,
    profiles: [{ apiUrl: 'https://example.test' }],
    interactiveScenes: { version: 1, scopes: { story: { activeSceneId: null, sceneOrder: [], scenes: {} } } },
}, currentBackup);
assert.equal(parsedV3Backup.profiles.length, 1);
assert.ok(parsedV3Backup.interactiveScenes.scopes.story);

const v2ScopeId = 'story';
const v2ActorId = deriveInteractiveActorId(v2ScopeId, 'story', 'character:alice');
const validV2InteractiveStore = {
    version: 2,
    scopes: {
        [v2ScopeId]: {
            activeSceneId: 'scene',
            sceneOrder: ['scene'],
            actors: {
                [v2ActorId]: {
                    actorId: v2ActorId,
                    type: 'story',
                    displayName: 'Alice',
                    bindingKey: 'character:alice',
                    profile: '',
                    createdAt: 100,
                },
            },
            scenes: {
                scene: {
                    id: 'scene', title: 'v2 社区', preset: 'weibo', styleInput: '', generatedPrompt: '',
                    createdAt: 100, updatedAt: 200,
                    posts: [{
                        id: 'post', authorId: v2ActorId, authorNameSnapshot: 'Alice', content: 'v2 帖子',
                        tags: [], createdAt: 110,
                        comments: [{
                            id: 'comment', authorId: v2ActorId, authorNameSnapshot: 'Alice',
                            content: 'v2 评论', createdAt: 120,
                        }],
                        liked: false,
                    }],
                    live: {
                        title: 'v2 直播', status: 'idle',
                        danmaku: [{
                            id: 'danmaku', authorId: v2ActorId, authorNameSnapshot: 'Alice',
                            content: 'v2 弹幕', createdAt: 130,
                        }],
                    },
                },
            },
        },
    },
};
const parsedV2Backup = parseBackupData({ schemaVersion: 3, interactiveScenes: validV2InteractiveStore }, currentBackup);
assert.equal(parsedV2Backup.interactiveScenes.version, 2);
assert.equal(parsedV2Backup.interactiveScenes.scopes[v2ScopeId].scenes.scene.posts[0].authorId, v2ActorId);
assert.equal(parsedV2Backup.interactiveScenes.scopes[v2ScopeId].scenes.scene.posts[0].shareCount, 0, '旧 v2 备份缺失 shareCount 时必须补为 0');
assert.equal(parsedV2Backup.interactiveScenes.scopes[v2ScopeId].scenes.scene.posts[0].shared, false,
    '旧 v2 备份缺失 shared 时必须补为 false');
for (const shareCount of [-1, 1.5, '1']) assert.throws(() => parseBackupData({
    schemaVersion: 3,
    interactiveScenes: {
        ...validV2InteractiveStore,
        scopes: {
            [v2ScopeId]: {
                ...validV2InteractiveStore.scopes[v2ScopeId],
                scenes: {
                    scene: {
                        ...validV2InteractiveStore.scopes[v2ScopeId].scenes.scene,
                        posts: [{ ...validV2InteractiveStore.scopes[v2ScopeId].scenes.scene.posts[0], shareCount }],
                    },
                },
            },
        },
    },
}, currentBackup), /shareCount 必须是非负安全整数/);
for (const shared of [1, 'true', null]) assert.throws(() => parseBackupData({
    schemaVersion: 3,
    interactiveScenes: {
        ...validV2InteractiveStore,
        scopes: {
            [v2ScopeId]: {
                ...validV2InteractiveStore.scopes[v2ScopeId],
                scenes: {
                    scene: {
                        ...validV2InteractiveStore.scopes[v2ScopeId].scenes.scene,
                        posts: [{ ...validV2InteractiveStore.scopes[v2ScopeId].scenes.scene.posts[0], shared }],
                    },
                },
            },
        },
    },
}, currentBackup), /shared 必须是布尔值/);
assert.throws(() => parseBackupData({
    schemaVersion: 3,
    interactiveScenes: {
        ...validV2InteractiveStore,
        scopes: {
            [v2ScopeId]: {
                ...validV2InteractiveStore.scopes[v2ScopeId],
                scenes: { scene: { ...validV2InteractiveStore.scopes[v2ScopeId].scenes.scene, contentRating: 'general' } },
            },
        },
    },
}, currentBackup), /额外字段.*contentRating/);
assert.throws(() => parseBackupData({
    schemaVersion: 3,
    interactiveScenes: {
        ...validV2InteractiveStore,
        scopes: { [v2ScopeId]: { ...validV2InteractiveStore.scopes[v2ScopeId], actors: undefined } },
    },
}, currentBackup), /(?:actors 必须是对象|缺少 actors registry)/);
assert.throws(() => parseBackupData({
    schemaVersion: 3,
    interactiveScenes: {
        ...validV2InteractiveStore,
        scopes: {
            [v2ScopeId]: {
                ...validV2InteractiveStore.scopes[v2ScopeId],
                scenes: {
                    scene: {
                        ...validV2InteractiveStore.scopes[v2ScopeId].scenes.scene,
                        posts: [{
                            id: 'post', authorId: 'missing', authorNameSnapshot: '伪造', content: '悬空',
                            tags: [], createdAt: 110, comments: [], liked: false,
                        }],
                    },
                },
            },
        },
    },
}, currentBackup), /(?:authorId 未指向有效 actor|引用了不存在的 actor)/);
assert.throws(() => parseBackupData({
    schemaVersion: 3,
    interactiveScenes: {
        ...validV2InteractiveStore,
        scopes: {
            [v2ScopeId]: {
                ...validV2InteractiveStore.scopes[v2ScopeId],
                actors: { [v2ActorId]: { ...validV2InteractiveStore.scopes[v2ScopeId].actors[v2ActorId], bindingKey: 'character:tampered' } },
            },
        },
    },
}, currentBackup), /(?:actorId 与绑定信息不一致|与绑定信息不一致)/);

let backgroundState = { current: 'old' };
const persistedBackgroundStates = [];
let failBackgroundPersist = true;
await assert.rejects(runBackgroundTransaction({
    capture: () => structuredClone(backgroundState),
    mutate: () => { backgroundState.current = 'new'; },
    restore: snapshot => { backgroundState = structuredClone(snapshot); },
    persist: async () => {
        persistedBackgroundStates.push(structuredClone(backgroundState));
        if (failBackgroundPersist) {
            failBackgroundPersist = false;
            throw new Error('背景保存失败');
        }
    },
}), /背景保存失败/);
assert.deepEqual(backgroundState, { current: 'old' });
assert.deepEqual(persistedBackgroundStates, [{ current: 'new' }, { current: 'old' }]);

backgroundState = { current: 'old' };
let backgroundPersistCount = 0;
await assert.rejects(runBackgroundTransaction({
    capture: () => structuredClone(backgroundState),
    mutate: () => { backgroundState.current = 'new'; },
    restore: snapshot => { backgroundState = structuredClone(snapshot); },
    persist: async () => {
        backgroundPersistCount += 1;
        throw new Error(backgroundPersistCount === 1 ? '背景保存失败' : '背景回滚失败');
    },
}), /背景保存失败；原背景回滚失败：背景回滚失败/);
assert.deepEqual(backgroundState, { current: 'old' });

let backupState = { version: 'A' };
const persistedBackupStates = [];
let failImportedPersist = true;
await assert.rejects(runBackupTransaction({
    capture: async () => structuredClone(backupState),
    apply: async snapshot => {
        backupState = structuredClone(snapshot || { version: 'B' });
        return structuredClone(backupState);
    },
    persist: async state => {
        persistedBackupStates.push(structuredClone(state));
        if (state.version === 'B' && failImportedPersist) {
            failImportedPersist = false;
            throw new Error('导入阶段失败');
        }
    },
}), /导入阶段失败/);
assert.deepEqual(backupState, { version: 'A' });
assert.deepEqual(persistedBackupStates, [{ version: 'B' }, { version: 'A' }]);

backupState = { version: 'A' };
await assert.rejects(runBackupTransaction({
    capture: async () => structuredClone(backupState),
    apply: async snapshot => {
        backupState = structuredClone(snapshot || { version: 'B' });
        return structuredClone(backupState);
    },
    persist: async state => {
        if (state.version === 'B') throw new Error('导入失败');
        throw new Error('回滚失败');
    },
}), /导入失败；原数据回滚失败：回滚失败/);
assert.deepEqual(backupState, { version: 'A' });

backupState = { version: 'A' };
const backupLifecyclePhases = [];
let failLifecyclePersist = true;
await assert.rejects(runBackupTransaction({
    capture: async () => structuredClone(backupState),
    beforeApply: async phase => { backupLifecyclePhases.push(phase); },
    apply: async snapshot => {
        backupState = structuredClone(snapshot || { version: 'B' });
        return structuredClone(backupState);
    },
    persist: async state => {
        if (state.version === 'B' && failLifecyclePersist) {
            failLifecyclePersist = false;
            throw new Error('生命周期导入失败');
        }
    },
}), /生命周期导入失败/);
assert.deepEqual(backupLifecyclePhases, ['apply', 'rollback']);
assert.deepEqual(backupState, { version: 'A' });

const deferred = () => {
    let resolve;
    const promise = new Promise(value => { resolve = value; });
    return { promise, resolve };
};
const firstAfterPersist = deferred();
const backupReceiptEvents = [];
const makeReceiptTransaction = (name, { failAfterPersist = false } = {}) => runBackupTransaction({
    capture: async () => ({ name: `${name}-snapshot` }),
    apply: async snapshot => snapshot || { name },
    persist: async (state, phase, applied) => {
        backupReceiptEvents.push(['persist', name, phase, applied?.id || null]);
        return phase === 'apply' ? { id: name } : undefined;
    },
    afterPersist: async phase => {
        if (phase !== 'apply') return;
        if (name === 'first') await firstAfterPersist.promise;
        if (failAfterPersist) throw new Error(`${name}-after-persist-failed`);
    },
    complete: async (_state, applied) => { backupReceiptEvents.push(['complete', name, applied?.id || null]); },
});
const firstTransaction = makeReceiptTransaction('first');
await Promise.resolve();
await assert.rejects(makeReceiptTransaction('second', { failAfterPersist: true }), /second-after-persist-failed/);
firstAfterPersist.resolve();
await firstTransaction;
assert.deepEqual(backupReceiptEvents, [
    ['persist', 'first', 'apply', null], ['persist', 'second', 'apply', null],
    ['persist', 'second', 'rollback', 'second'], ['complete', 'first', 'first'],
], '交错备份事务必须把回滚与完成收据绑定到各自的 apply，不得串用其他事务 token');

const createBackupTransactionFixture = (sceneId, ambientStatusEnabled) => ({
    histories: { story: { Alice: [{ role: 'assistant', content: sceneId }] } },
    config: { model: sceneId },
    theme: { darkMode: ambientStatusEnabled ? 'dark' : 'light', ambientStatusEnabled },
    profiles: [],
    groupMeta: {},
    pokeConfig: {},
    bidirectional: {},
    injectionConfig: { position: 1, depth: sceneId === 'scene-old' ? 2 : 5, historyLimit: 11 },
    emojis: [],
    characterBehavior: {},
    wordyLimit: false,
    desktopBg: '',
    bgGlobal: '',
    bgLocal: {},
    interactiveScenes: {
        version: 1,
        scopes: {
            story: {
                activeSceneId: sceneId,
                sceneOrder: [sceneId],
                scenes: { [sceneId]: { id: sceneId, title: sceneId } },
            },
        },
    },
    phoneUiState: {
        version: 1,
        scopes: {
            story: {
                pinnedSceneIds: [sceneId], lastPage: 'community', lastSceneId: sceneId, lastTab: 'feed',
            },
        },
    },
    ambientStatus: { enabled: ambientStatusEnabled },
    calendarStore: { version: 1, scopes: { story: { autoAdjust: false, events: {}, lastGeneratedAt: 0, lastAdjustedAt: 0 } } },
    calendarOccasions: { version: 1, scopes: { story: { occasions: [] } } },
    calendarHolidays: { version: 1, selectedCountry: sceneId === 'scene-old' ? 'JP' : 'US', years: {} },
    calendarWeather: { version: 1, location: { name: sceneId, latitude: 35, longitude: 139, country: 'JP', timezone: 'Asia/Tokyo' }, lastSuccess: null },
    calendarCycles: { version: 1, scopes: { story: { enabled: true, lastPeriodStart: '2026-07-01', cycleLength: sceneId === 'scene-old' ? 28 : 30, periodLength: 5, overrides: {} } } },
    branchLineage: structuredClone(validBranchLineage),
});
const originalBackupFixture = createBackupTransactionFixture('scene-old', true);
const importedBackupFixture = createBackupTransactionFixture('scene-new', false);
const importedBranchLineage = {
    [getStorageIdFor('alice.png', 'branch-restored')]: {
        sourceId: getStorageIdFor('alice.png', 'parent-restored'), parentChatId: 'parent-restored',
        targetChatId: 'branch-restored', avatar: 'alice.png', completedAt: 456, schemaVersion: 1,
    },
};
const importedBackupWithLineage = { ...importedBackupFixture, branchLineage: importedBranchLineage };
localValues.set('ST_SMS_BG_DESKTOP', '');
localValues.set('ST_SMS_BG_GLOBAL', '');
localValues.set('ST_SMS_BG_LOCAL', '{}');
idbValues.delete('ST_SMS_BG_GLOBAL');
idbValues.delete('ST_SMS_BG_LOCAL_story_Alice');
let interactiveInvalidations = 0;
const backupHandlers = createBackupStateHandlers({
    invalidateInteractiveStore: () => { interactiveInvalidations += 1; },
});
await backupHandlers.persist(await backupHandlers.apply(originalBackupFixture));
assert.deepEqual(idbValues.get(BRANCH_LINEAGE_STORE_KEY), validBranchLineage, '备份持久化必须提交分支继承完成标记');
assert.deepEqual((await backupHandlers.capture()).branchLineage, validBranchLineage,
    '备份事务捕获必须携带当前分支继承完成标记');

idbControl.abortOperations.push({ type: 'put', key: BRANCH_LINEAGE_STORE_KEY });
await assert.rejects(runBackupTransaction({
    capture: backupHandlers.capture,
    apply: snapshot => backupHandlers.apply(snapshot || importedBackupWithLineage),
    persist: backupHandlers.persist,
}), /分支继承记录保存失败/);
assert.deepEqual(window.__pmBranchLineage, validBranchLineage,
    '分支继承完成标记写入失败时，备份事务必须恢复原运行时标记');
assert.deepEqual(idbValues.get(BRANCH_LINEAGE_STORE_KEY), validBranchLineage,
    '分支继承完成标记写入失败时，备份事务必须恢复原持久化标记');

const concurrentBackupTargetId = getStorageIdFor('alice.png', 'branch-during-backup');
await assert.rejects(runBackupTransaction({
    capture: backupHandlers.capture,
    apply: snapshot => backupHandlers.apply(snapshot || importedBackupWithLineage),
    persist: backupHandlers.persist,
    afterPersist: async phase => {
        if (phase !== 'apply') return;
        await commitBranchLineage(concurrentBackupTargetId, {
            sourceId: getStorageIdFor('alice.png', 'parent-during-backup'), targetChatId: 'branch-during-backup',
        });
        throw new Error('after-persist-failed');
    },
}), /after-persist-failed/);
const lineageAfterBackupRollback = await loadBranchLineage();
const originalBackupTargetId = getStorageIdFor('alice.png', 'branch-chat');
assert.deepEqual(lineageAfterBackupRollback[originalBackupTargetId], validBranchLineage[originalBackupTargetId],
    '备份回滚必须保留事务开始前已有的 lineage marker');
assert.equal(Object.hasOwn(lineageAfterBackupRollback, getStorageIdFor('alice.png', 'branch-restored')), false,
    '备份回滚只能删除本事务实际插入且未被后续修改的 lineage marker');
assert.equal(lineageAfterBackupRollback[concurrentBackupTargetId].targetChatId, 'branch-during-backup',
    '备份回滚不得删除事务期间其他合法提交的 lineage marker');

globalThis.document = {
    getElementById: id => uiElements.get(id) || null,
    querySelectorAll: () => [],
};
globalThis.alert = message => uiAlerts.push(String(message));
const galBackupOriginal = { galBubbleEnabled: true, model: 'original' };
const galBackupImported = { galBubbleEnabled: false, model: 'imported' };
let galBackupState = structuredClone(galBackupOriginal);
const galBackupSyncCalls = [];
const galBackupController = createBackupController({
    capture: async () => structuredClone(galBackupState),
    apply: async state => {
        galBackupState = structuredClone(state);
        return structuredClone(galBackupState);
    },
    persist: async () => {}, complete: async () => {}, parseBackupData: () => structuredClone(galBackupImported),
    runBackupTransaction, legacyBackupTheme: value => value, clearPluginData: async ({ afterClear }) => afterClear(),
    requireInjectionSuccess: async callback => callback(), clearBidirectionalInjection: async () => {},
    applyBidirectionalInjection: async () => {}, createEmptyState: () => ({ galBubbleEnabled: false, model: 'empty' }),
    syncGalBubble: enabled => {
        galBackupSyncCalls.push(enabled);
        return { ok: galBackupSyncCalls.length % 2 === 0, changed: false, action: 'noop' };
    },
    closePhone: () => {},
});
const galBackupAlertsBefore = uiAlerts.length;
const galBackupInput = { files: [{ text: '{}' }], value: 'gal-sync-failure.json' };
galBackupController.importData(galBackupInput);
await fileReadCompletion;
assert.deepEqual(galBackupState, galBackupOriginal,
    '导入期间 GAL 宿主同步失败必须恢复导入前的本地开关状态');
assert.deepEqual(galBackupSyncCalls, [false, true],
    '导入期间 GAL 宿主同步失败必须在回滚阶段恢复原宿主正则状态');
assert.match(uiAlerts.at(-1), /导入失败，原数据已恢复.*GAL 气泡正则同步失败/s);
assert.equal(uiAlerts.length, galBackupAlertsBefore + 1);

const galReloadOriginal = { galBubbleEnabled: false, model: 'reload-original' };
const galReloadImported = { galBubbleEnabled: true, model: 'reload-imported' };
galBackupState = structuredClone(galReloadOriginal);
let galReloadCalls = 0;
const galReloadController = createBackupController({
    capture: async () => structuredClone(galBackupState),
    apply: async state => {
        galBackupState = structuredClone(state);
        return structuredClone(galBackupState);
    },
    persist: async () => {}, complete: async () => {}, parseBackupData: () => structuredClone(galReloadImported),
    runBackupTransaction, legacyBackupTheme: value => value, clearPluginData: async ({ afterClear }) => afterClear(),
    requireInjectionSuccess: async callback => callback(), clearBidirectionalInjection: async () => {},
    applyBidirectionalInjection: async () => {}, createEmptyState: () => ({ galBubbleEnabled: false }),
    syncGalBubble: async () => ({ ok: true, changed: true, context: {} }),
    reloadCurrentChat: async () => { galReloadCalls += 1; throw new Error('reload-failed'); },
    closePhone: () => {},
});
galReloadController.importData({ files: [{ text: '{}' }], value: 'gal-reload-failure.json' });
await fileReadCompletion;
assert.deepEqual(galBackupState, galReloadImported, 'GAL 聊天刷新失败不得回滚已成功导入的正则配置');
assert.equal(galReloadCalls, 1, 'GAL 正则变更后必须尝试刷新当前聊天');
assert.match(uiAlerts.at(-1), /数据导入成功，但 GAL 气泡当前聊天刷新失败，请手动刷新当前聊天/, 'GAL 刷新失败时导入成功提示必须要求手动刷新');

const galRollbackRefreshOriginal = { galBubbleEnabled: false, model: 'rollback-refresh-original' };
const galRollbackRefreshImported = { galBubbleEnabled: true, model: 'rollback-refresh-imported' };
galBackupState = structuredClone(galRollbackRefreshOriginal);
let galRollbackRefreshCalls = 0;
let galRollbackPersistCalls = 0;
const galRollbackRefreshController = createBackupController({
    capture: async () => structuredClone(galBackupState),
    apply: async state => {
        galBackupState = structuredClone(state);
        return structuredClone(galBackupState);
    },
    persist: async () => {
        galRollbackPersistCalls += 1;
        if (galRollbackPersistCalls === 1) throw new Error('persist-failed');
    }, complete: async () => {}, parseBackupData: () => structuredClone(galRollbackRefreshImported),
    runBackupTransaction, legacyBackupTheme: value => value, clearPluginData: async ({ afterClear }) => afterClear(),
    requireInjectionSuccess: async callback => callback(), clearBidirectionalInjection: async () => {},
    applyBidirectionalInjection: async () => {}, createEmptyState: () => ({ galBubbleEnabled: false }),
    syncGalBubble: async () => ({ ok: true, changed: true, context: {} }),
    reloadCurrentChat: async () => { galRollbackRefreshCalls += 1; throw new Error('rollback-reload-failed'); },
    closePhone: () => {},
});
galRollbackRefreshController.importData({ files: [{ text: '{}' }], value: 'gal-rollback-refresh-failure.json' });
await fileReadCompletion;
assert.deepEqual(galBackupState, galRollbackRefreshOriginal, '导入回滚后必须恢复原数据');
assert.equal(galRollbackRefreshCalls, 2, '导入与回滚的 GAL 正则变更都必须尝试刷新当前聊天');
assert.equal(galRollbackPersistCalls, 2, '导入失败后必须持久化恢复原数据');
assert.match(uiAlerts.at(-1), /导入失败，原数据已恢复，但 GAL 气泡当前聊天刷新失败，请手动刷新当前聊天/, '导入回滚后刷新失败必须明确提示手动刷新');

galBackupState = structuredClone(galBackupOriginal);
galBackupSyncCalls.length = 0;
const galClearAlertsBefore = uiAlerts.length;
const previousConfirm = globalThis.confirm;
globalThis.confirm = () => true;
assert.equal(await galBackupController.clearAllData(), false,
    '清理期间 GAL 宿主同步失败必须拒绝宣告清理成功');
assert.deepEqual(galBackupState, galBackupOriginal,
    '清理期间 GAL 宿主同步失败必须恢复清理前的本地开关状态');
assert.deepEqual(galBackupSyncCalls, [false, true],
    '清理期间 GAL 宿主同步失败必须在回滚阶段恢复原宿主正则状态');
assert.match(uiAlerts.at(-1), /清理失败，原数据已恢复.*GAL 气泡正则同步失败/s);
assert.equal(uiAlerts.length, galClearAlertsBefore + 1);
if (previousConfirm === undefined) delete globalThis.confirm;
else globalThis.confirm = previousConfirm;
const runTransactionalImportFailureCase = async ({ configModel, injection, expectedDetail }) => {
    uiElements.get('pm-overlay').removed = false;
    const alertsBefore = uiAlerts.length;
    const closeCallsBefore = importCloseCalls;
    const injectionCallsBefore = importInjectionCalls;
    const clearCallsBefore = importClearInjectionCalls;
    const cancelCallsBefore = importCancelCommunityCalls;
    const cancelCalendarCallsBefore = importCancelCalendarReasons.length;
    const reloadCalendarCallsBefore = importReloadCalendarCalls;
    const expectedModel = window.__pmConfig.model;
    const expectedPersistedModel = JSON.parse(localValues.get('ST_SMS_CONFIG')).model;
    importInjectionImpl = injection;
    const input = {
        files: [{ text: JSON.stringify({
            schemaVersion: 8,
            config: { apiUrl: 'https://imported.example', apiKey: 'imported-key', model: configModel, useIndependent: false },
        }) }],
        value: `${configModel}.json`,
    };

    window.__pmImportData(input);
    await fileReadCompletion;

    assert.equal(input.value, '');
    assert.equal(window.__pmConfig.model, expectedModel, '导入后的注入刷新失败必须恢复原运行时数据');
    assert.equal(JSON.parse(localValues.get('ST_SMS_CONFIG')).model, expectedPersistedModel, '导入后的注入刷新失败必须恢复原持久化数据');
    assert.equal(importClearInjectionCalls, clearCallsBefore + 2, '导入失败回滚必须分别在 apply 与 rollback 前清理注入');
    assert.equal(importCancelCommunityCalls, cancelCallsBefore + 2, '导入失败回滚必须取消 apply 与 rollback 两阶段的社区任务');
    assert.deepEqual(importCancelCalendarReasons.slice(cancelCalendarCallsBefore), ['backup-apply', 'backup-rollback'],
        '导入失败回滚必须取消 apply 与 rollback 两阶段的日历与菜谱任务');
    assert.equal(importReloadCalendarCalls, reloadCalendarCallsBefore + 2,
        '导入后的注入刷新失败必须重载导入态与回滚态日历 runtime');
    assert.equal(importInjectionCalls, injectionCallsBefore + 2, '导入失败回滚必须刷新导入态与恢复态注入');
    assert.equal(importCloseCalls, closeCallsBefore, '事务已回滚时不得关闭当前手机界面');
    assert.equal(uiElements.get('pm-overlay').removed, false, '事务已回滚时必须保留当前遮罩');
    assert.equal(uiAlerts.length, alertsBefore + 1);
    assert.match(uiAlerts.at(-1), /导入失败，原数据已恢复/);
    assert.match(uiAlerts.at(-1), expectedDetail);
};

await runTransactionalImportFailureCase({
    configModel: 'post-import-reject',
    injection: async () => {
        if (window.__pmConfig.model === 'post-import-reject') throw new Error('宿主注入接口拒绝');
    },
    expectedDetail: /宿主注入接口拒绝/,
});
await runTransactionalImportFailureCase({
    configModel: 'post-import-diagnostic',
    injection: async () => window.__pmConfig.model === 'post-import-diagnostic'
        ? ({ written: 1, failedWrites: 2, cleared: 1, failedKeys: ['PHONE_SMS_MEMORY:stale'] })
        : undefined,
    expectedDetail: /导入后的注入刷新失败：2 项写入失败，1 项清理失败/,
});
await backupHandlers.persist(await backupHandlers.apply(originalBackupFixture));
importInjectionImpl = async () => undefined;
delete globalThis.document;
delete globalThis.alert;
if (originalFileReader === undefined) delete globalThis.FileReader;
else globalThis.FileReader = originalFileReader;

assert.equal(JSON.parse(localValues.get(CALENDAR_HOLIDAY_STORAGE_KEY)).selectedCountry, 'JP');
assert.equal(JSON.parse(localValues.get(CALENDAR_WEATHER_STORAGE_KEY)).location.name, 'scene-old');
assert.equal(JSON.parse(localValues.get(CALENDAR_CYCLE_STORAGE_KEY)).scopes.story.cycleLength, 28);
assert.ok(JSON.parse(localValues.get(CALENDAR_STORAGE_KEY)).scopes.story);
assert.ok(JSON.parse(localValues.get(CALENDAR_OCCASION_STORAGE_KEY)).scopes.story);
const initialInvalidations = interactiveInvalidations;
localStorageWrites.length = 0;
localStorageControl.failSet.add('ST_SMS_PHONE_UI_STATE');
await assert.rejects(runBackupTransaction({
    capture: backupHandlers.capture,
    apply: snapshot => backupHandlers.apply(snapshot || importedBackupFixture),
    persist: backupHandlers.persist,
}), /手机界面状态保存失败/);
assert.equal(window.__pmTheme.ambientStatusEnabled, true);
assert.deepEqual(window.__pmPhoneUiState.scopes.story.pinnedSceneIds, ['scene-old']);
assert.equal(JSON.parse(localValues.get('ST_SMS_THEME')).ambientStatusEnabled, true);
assert.deepEqual(JSON.parse(localValues.get('ST_SMS_PHONE_UI_STATE')).scopes.story.pinnedSceneIds, ['scene-old']);
assert.equal(JSON.parse(localValues.get(CALENDAR_HOLIDAY_STORAGE_KEY)).selectedCountry, 'JP');
assert.equal(JSON.parse(localValues.get(CALENDAR_WEATHER_STORAGE_KEY)).location.name, 'scene-old');
assert.equal(JSON.parse(localValues.get(CALENDAR_CYCLE_STORAGE_KEY)).scopes.story.cycleLength, 28);
assert.deepEqual(idbValues.get('ST_INTERACTIVE_SCENES_V1').scopes.story.sceneOrder, ['scene-old']);
assert.deepEqual(
    localStorageWrites.filter(entry => entry.key === 'ST_SMS_THEME').map(entry => JSON.parse(entry.value).ambientStatusEnabled),
    [false, true],
);
assert.equal(interactiveInvalidations, initialInvalidations + 1);

localStorageWrites.length = 0;
localStorageControl.failSetCounts.set('ST_SMS_PHONE_UI_STATE', 2);
let rollbackFailure;
await assert.rejects(runBackupTransaction({
    capture: backupHandlers.capture,
    apply: snapshot => backupHandlers.apply(snapshot || importedBackupFixture),
    persist: backupHandlers.persist,
}), error => {
    rollbackFailure = error;
    assert.match(error.message, /手机界面状态保存失败：浏览器存储不可用；原数据回滚失败：手机界面状态保存失败：浏览器存储不可用/);
    return true;
});
assert.ok(rollbackFailure);
assert.match(rollbackFailure.rollbackError.message, /手机界面状态保存失败/);
assert.equal(window.__pmTheme.ambientStatusEnabled, true);
assert.deepEqual(window.__pmPhoneUiState.scopes.story.pinnedSceneIds, ['scene-old']);
assert.equal(JSON.parse(localValues.get('ST_SMS_THEME')).ambientStatusEnabled, true);
assert.deepEqual(JSON.parse(localValues.get('ST_SMS_PHONE_UI_STATE')).scopes.story.pinnedSceneIds, ['scene-old']);
assert.equal(JSON.parse(localValues.get(CALENDAR_HOLIDAY_STORAGE_KEY)).selectedCountry, 'JP');
assert.equal(JSON.parse(localValues.get(CALENDAR_WEATHER_STORAGE_KEY)).location.name, 'scene-old');
assert.equal(JSON.parse(localValues.get(CALENDAR_CYCLE_STORAGE_KEY)).scopes.story.cycleLength, 28);
assert.deepEqual(idbValues.get('ST_INTERACTIVE_SCENES_V1').scopes.story.sceneOrder, ['scene-old']);
assert.deepEqual(
    localStorageWrites.filter(entry => entry.key === 'ST_SMS_THEME').map(entry => JSON.parse(entry.value).ambientStatusEnabled),
    [false, true],
);

const cleanupLocal = new Map(PLUGIN_LOCAL_STORAGE_KEYS.map(key => [key, `value:${key}`]));
cleanupLocal.set('ST_SMS_MIGRATED_V3', '1');
cleanupLocal.set('HOST_EXTENSION_DATA', 'keep-local');
const cleanupStorage = {
    getItem: key => cleanupLocal.has(key) ? cleanupLocal.get(key) : null,
    setItem: (key, value) => cleanupLocal.set(key, String(value)),
    removeItem: key => cleanupLocal.delete(key),
};
const cleanupIdb = new Map([
    ...PLUGIN_IDB_STATIC_KEYS.map(key => [key, { key }]),
    [`${PLUGIN_IDB_DYNAMIC_PREFIXES[0]}orphan`, { key: 'dynamic' }],
    ['HOST_EXTENSION_IDB', { key: 'keep-idb' }],
]);
const cleanupResult = await clearPluginData({
    localStorageRef: cleanupStorage,
    listIdbKeys: async () => [...cleanupIdb.keys()],
    readIdbEntry: async key => ({ ok: cleanupIdb.has(key), value: structuredClone(cleanupIdb.get(key)) }),
    writeIdb: async (key, value) => { cleanupIdb.set(key, structuredClone(value)); return true; },
    deleteIdb: async key => cleanupIdb.delete(key),
});
assert.equal(cleanupResult.localKeys, PLUGIN_LOCAL_STORAGE_KEYS.length);
assert.equal(cleanupResult.idbKeys, PLUGIN_IDB_STATIC_KEYS.length + 1);
assert.equal(cleanupLocal.get('HOST_EXTENSION_DATA'), 'keep-local');
assert.equal(cleanupIdb.get('HOST_EXTENSION_IDB').key, 'keep-idb');
for (const key of PLUGIN_LOCAL_STORAGE_KEYS) assert.equal(cleanupLocal.has(key), false);
assert.equal(cleanupLocal.has(CALENDAR_OUTFIT_STORAGE_KEY), false, '清理成功必须删除穿搭数据');
assert.equal(cleanupLocal.get('ST_SMS_MIGRATED_V3'), '1', '历史迁移哨兵不得被插件全量清理删除');
for (const key of PLUGIN_IDB_STATIC_KEYS) assert.equal(cleanupIdb.has(key), false);
assert.equal(cleanupIdb.has(`${PLUGIN_IDB_DYNAMIC_PREFIXES[0]}orphan`), false);

const rollbackLocal = new Map([
    [PLUGIN_LOCAL_STORAGE_KEYS[0], 'old-local'],
    ['HOST_EXTENSION_DATA', 'keep-local'],
]);
rollbackLocal.set(CALENDAR_OUTFIT_STORAGE_KEY, 'old-outfits');
const rollbackIdb = new Map([
    [PLUGIN_IDB_STATIC_KEYS[0], { value: 'old-static' }],
    [`${PLUGIN_IDB_DYNAMIC_PREFIXES[0]}old`, { value: 'old-dynamic' }],
    ['HOST_EXTENSION_IDB', { value: 'keep-idb' }],
]);
await assert.rejects(clearPluginData({
    localStorageRef: {
        getItem: key => rollbackLocal.has(key) ? rollbackLocal.get(key) : null,
        setItem: (key, value) => rollbackLocal.set(key, String(value)),
        removeItem: key => rollbackLocal.delete(key),
    },
    listIdbKeys: async () => [...rollbackIdb.keys()],
    readIdbEntry: async key => ({ ok: true, value: structuredClone(rollbackIdb.get(key)) }),
    writeIdb: async (key, value) => { rollbackIdb.set(key, structuredClone(value)); return true; },
    deleteIdb: async key => rollbackIdb.delete(key),
    afterClear: async () => { throw new Error('内存重置失败'); },
}), /内存重置失败/);
assert.equal(rollbackLocal.get(PLUGIN_LOCAL_STORAGE_KEYS[0]), 'old-local');
assert.equal(rollbackLocal.get(CALENDAR_OUTFIT_STORAGE_KEY), 'old-outfits', '清理失败时必须恢复穿搭数据');
assert.equal(rollbackLocal.get('HOST_EXTENSION_DATA'), 'keep-local');
assert.deepEqual(rollbackIdb.get(PLUGIN_IDB_STATIC_KEYS[0]), { value: 'old-static' });
assert.deepEqual(rollbackIdb.get(`${PLUGIN_IDB_DYNAMIC_PREFIXES[0]}old`), { value: 'old-dynamic' });
assert.deepEqual(rollbackIdb.get('HOST_EXTENSION_IDB'), { value: 'keep-idb' });

let cleanupRollbackError;
await assert.rejects(clearPluginData({
    localStorageRef: {
        getItem: key => key === PLUGIN_LOCAL_STORAGE_KEYS[0] ? 'old-local' : null,
        setItem: () => { throw new Error('local rollback blocked'); },
        removeItem: () => {},
    },
    listIdbKeys: async () => [],
    afterClear: async () => { throw new Error('clear failed'); },
}), error => {
    cleanupRollbackError = error;
    return /插件数据回滚失败/.test(error.message);
});
assert.ok(cleanupRollbackError.rollbackError instanceof AggregateError);

const failedClearBidirectional = { story: ['Alice'] };
const failedClearInjectionConfig = {
    phone: { position: 2, depth: 7, historyLimit: 13 },
    community: { position: 2, depth: 7 },
    calendar: { position: 0, depth: 0 },
    todayTrend: { position: 0, depth: 0 },
};
window.__pmBidirectional = structuredClone(failedClearBidirectional);
window.__pmInjectionConfig = structuredClone(failedClearInjectionConfig);
localValues.set('ST_SMS_BIDIRECTIONAL', JSON.stringify(failedClearBidirectional));
localValues.set('ST_SMS_INJECTION_CONFIG', JSON.stringify(failedClearInjectionConfig));
const failedClearModel = window.__pmConfig.model;
const failedClearPersistedModel = JSON.parse(localValues.get('ST_SMS_CONFIG')).model;
let failedClearReplayState = null;
const failedClearInjectionBefore = importClearInjectionCalls;
const failedClearApplyBefore = importInjectionCalls;
const failedClearCloseBefore = importCloseCalls;
const failedClearReloadBefore = importReloadCalendarCalls;
const failedClearAlerts = [];
globalThis.confirm = () => true;
globalThis.alert = message => failedClearAlerts.push(String(message));
globalThis.document = {
    getElementById: id => id === 'pm-overlay' ? { remove() { throw new Error('失败清理不得关闭遮罩'); } } : null,
    querySelectorAll: () => [],
};
importClearInjectionImpl = () => importClearInjectionCalls === failedClearInjectionBefore + 2
    ? { written: 0, failedWrites: 1, failedKeys: [] }
    : undefined;
importInjectionImpl = async () => {
    failedClearReplayState = {
        bidirectional: structuredClone(window.__pmBidirectional),
        injectionConfig: structuredClone(window.__pmInjectionConfig),
    };
};
assert.equal(await window.__pmClearAllData(), false);
assert.equal(window.__pmConfig.model, failedClearModel,
    '应用空状态后的注入清理失败必须恢复原运行时数据');
assert.equal(JSON.parse(localValues.get('ST_SMS_CONFIG')).model, failedClearPersistedModel,
    '应用空状态后的注入清理失败必须恢复原持久化数据');
assert.deepEqual(window.__pmBidirectional, failedClearBidirectional);
assert.deepEqual(window.__pmInjectionConfig, failedClearInjectionConfig);
assert.deepEqual(JSON.parse(localValues.get('ST_SMS_BIDIRECTIONAL')), failedClearBidirectional);
assert.deepEqual(JSON.parse(localValues.get('ST_SMS_INJECTION_CONFIG')), failedClearInjectionConfig);
assert.deepEqual(failedClearReplayState, {
    bidirectional: failedClearBidirectional,
    injectionConfig: failedClearInjectionConfig,
}, '旧注入必须在会话开关和全局规则恢复后重放');
assert.equal(importClearInjectionCalls, failedClearInjectionBefore + 2,
    '失败清理必须覆盖删除前与应用空状态后的两次注入清理');
assert.equal(importInjectionCalls, failedClearApplyBefore + 1,
    '失败清理回滚后必须重新应用旧注入');
assert.equal(importReloadCalendarCalls, failedClearReloadBefore + 3,
    '失败清理必须重载空状态、恢复持久化及最终恢复后的日历 runtime');
assert.equal(importCloseCalls, failedClearCloseBefore,
    '失败清理不得关闭当前手机界面');
assert.match(failedClearAlerts.at(-1), /清理失败，原数据已恢复/);
assert.match(failedClearAlerts.at(-1), /应用空状态后清理注入失败：1 项写入失败/);
importClearInjectionImpl = () => undefined;
importInjectionImpl = async () => undefined;
delete globalThis.confirm;
delete globalThis.alert;
delete globalThis.document;

const clearCancelCommunityBefore = importCancelCommunityCalls;
const clearCancelCalendarBefore = importCancelCalendarReasons.length;
const clearInjectionBefore = importClearInjectionCalls;
const clearCloseBefore = importCloseCalls;
const clearReloadBefore = importReloadCalendarCalls;
const clearAlerts = [];
globalThis.confirm = () => true;
globalThis.alert = message => clearAlerts.push(String(message));
globalThis.document = {
    getElementById: id => id === 'pm-overlay' ? { remove() {} } : null,
    querySelectorAll: () => [],
};
assert.equal(await window.__pmClearAllData(), true);
assert.equal(importCancelCommunityCalls, clearCancelCommunityBefore + 1,
    '清空插件数据必须取消旧社区任务');
assert.deepEqual(importCancelCalendarReasons.slice(clearCancelCalendarBefore), ['plugin-data-clear'],
    '清空插件数据必须取消旧日历与菜谱任务');
assert.equal(importClearInjectionCalls, clearInjectionBefore + 2,
    '清空插件数据必须在删除前及应用空状态后各清理一次注入');
assert.equal(importReloadCalendarCalls, clearReloadBefore + 1,
    '清空插件数据应用空状态后必须重载日历与菜谱 runtime');
assert.equal(importCloseCalls, clearCloseBefore + 1, '清空成功后必须关闭旧界面');
assert.match(clearAlerts.at(-1), /天音小笺数据已清理/);
delete globalThis.confirm;
delete globalThis.alert;
delete globalThis.document;

delete globalThis.indexedDB;
delete globalThis.localStorage;
delete globalThis.window;

const pageSections = ['chat', 'desktop', 'community', 'calendar', 'today-trend'].map(page => ({ dataset: { phonePage: page }, hidden: false }));
const pageMain = {
    dataset: { page: 'chat' },
    querySelectorAll(selector) {
        assert.equal(selector, '[data-phone-page]');
        return pageSections;
    },
};
let transientCloseCount = 0;
let phoneRoot = {
    querySelector(selector) {
        assert.equal(selector, '.pm-main-ui');
        return pageMain;
    },
};
const pageController = createPhonePageController({
    getRoot: () => phoneRoot,
    closeTransientUi: () => { transientCloseCount += 1; },
});
const chatSectionReference = pageSections[0];
assert.equal(pageController.current(), 'chat');
assert.equal(pageController.show('desktop'), true);
assert.equal(pageController.current(), 'desktop');
assert.deepEqual(pageSections.map(section => [section.dataset.phonePage, section.hidden]), [
    ['chat', true], ['desktop', false], ['community', true], ['calendar', true], ['today-trend', true],
]);
assert.equal(pageController.show('community'), true);
assert.deepEqual(pageSections.map(section => section.hidden), [true, true, false, true, true]);
assert.equal(pageController.show('calendar'), true);
assert.deepEqual(pageSections.map(section => section.hidden), [true, true, true, false, true]);
assert.equal(pageController.show('today-trend'), true);
assert.deepEqual(pageSections.map(section => section.hidden), [true, true, true, true, false]);
assert.equal(pageController.show('chat'), true);
assert.deepEqual(pageSections.map(section => section.hidden), [false, true, true, true, true]);
assert.equal(pageSections[0], chatSectionReference, '页面切换不得替换聊天 DOM 节点');
assert.equal(pageController.show('invalid-page'), true);
assert.equal(pageController.current(), 'desktop');
assert.equal(transientCloseCount, 6);
phoneRoot = null;
assert.equal(pageController.show('chat'), false);
assert.equal(pageController.current(), null);

const baseDesktopHtml = renderPhoneDesktop({ scenes: {} }, { pinnedSceneIds: [] });
assert.ok(baseDesktopHtml.length > 0, '无有效会话时基础桌面不得为空');
assert.match(baseDesktopHtml, /<span>天音小笺<\/span>/, '旧主题或无主题时桌面标题必须回退为品牌名');
assert.match(baseDesktopHtml, /class="pm-desktop-community-dock"/);
assert.match(baseDesktopHtml, /data-action="desktop-community" aria-label="发布一条"/);
for (const [app, label] of [['chat', '会话'], ['directory', '联系人'], ['settings', '设置'], ['calendar', '日历'], ['today-trend', '今日风向']]) {
    assert.match(baseDesktopHtml, new RegExp(`data-app="${app}"[^>]*data-action="desktop-${app}"`));
    assert.match(baseDesktopHtml, new RegExp(`<span class="pm-desktop-app-label">${label}</span>`));
}
for (const action of ['desktop-chat', 'desktop-directory', 'desktop-settings', 'desktop-calendar', 'desktop-today-trend', 'desktop-community', 'desktop-exit']) {
    assert.ok(baseDesktopHtml.includes(`data-action="${action}"`), `基础桌面缺少 ${action} 入口`);
}
globalThis.window = { __pmTheme: { customTitle: '雨夜 & 电台' } };
assert.match(renderPhoneDesktop({ scenes: {} }, { pinnedSceneIds: [] }), /<span>雨夜 &amp; 电台<\/span>/, '桌面必须渲染并转义自定义标题');
const pinnedDesktopHtml = renderPhoneDesktop({ scenes: {
    'scene-local': { id: 'scene-local', title: '本地社区', preset: 'weibo', themeAccent: '#123abc' },
} }, { pinnedSceneIds: ['scene-local'] });
assert.match(pinnedDesktopHtml, /class="pm-desktop-pin"[^>]*>[\s\S]*data-action="desktop-open-scene"[^>]*><b>本地社区<\/b><\/button>/,
    '普通固定社区必须使用单标题主按钮');
const sharedDesktopHtml = renderPhoneDesktop({ scenes: {} }, { pinnedSceneIds: [] }, [{
    id: 'template-shared', sourceStorageId: 'source-story', sourceSceneId: 'scene-shared', title: '共享 < 社区',
    preset: 'weibo', styleInput: '', generatedPrompt: '', themeAccent: '#123abc', sharedAt: 1,
}]);
assert.match(sharedDesktopHtml, /data-action="desktop-import-community-template"[^>]*data-template-id="template-shared"/,
    '其他窗口桌面必须提供导入配置模板的入口');
assert.match(sharedDesktopHtml, /data-action="dismiss-community-template"[^>]*data-template-id="template-shared"[^>]*>移除<\/button>/,
    '跨窗口模板必须提供仅从当前桌面移除的入口');
assert.match(sharedDesktopHtml, /共享 &lt; 社区/, '共享模板标题必须按普通卡片规则转义');
assert.match(sharedDesktopHtml, /style="--scene-accent:#123abc"/, '模板入口必须透传模板的场景主题色');
assert.match(sharedDesktopHtml, /class="pm-desktop-pin pm-desktop-template"[^>]*>[\s\S]*data-action="desktop-import-community-template"[^>]*><b>共享 &lt; 社区<\/b><\/button>/,
    '跨窗口模板必须复用普通固定社区的单标题主按钮结构');
assert.doesNotMatch(sharedDesktopHtml, /pm-desktop-template-icon|<small>导入社区模板<\/small>/,
    '跨窗口模板不得保留独立图标和副标题样式');
delete globalThis.window;

assert.deepEqual(
    ['a', 'b', 'c', 'd'].map(id => getDanmakuTone({ id })),
    ['pink', 'cyan', 'gold', 'blue'],
    '稳定 hash 应覆盖蓝、粉、青、金四种色阶',
);
const fallbackDanmaku = { authorNameSnapshot: '访客', content: '晚上好' };
assert.equal(getDanmakuTone(fallbackDanmaku), getDanmakuTone({ ...fallbackDanmaku }), '缺失 id 时作者与内容组合必须稳定分色');
assert.ok(['blue', 'pink', 'cyan', 'gold'].includes(getDanmakuTone(fallbackDanmaku)), '弹幕色阶必须属于合同允许集合');
assert.deepEqual(getDanmakuMotion({ id: 'stable' }), getDanmakuMotion({ id: 'stable' }), '弹幕运动参数必须稳定');
assert.ok(new Set(['a', 'b', 'c', 'd', 'e', 'f'].map(id => getDanmakuMotion({ id }).lane)).size > 1, '弹幕不得全部落在同一轨道');
const postTimeNow = new Date(2026, 6, 15, 12, 0, 0).getTime();
const dateLabel = timestamp => {
    const date = new Date(timestamp);
    return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
};
assert.equal(formatCommunityPostTime(postTimeNow - 30_000, postTimeNow).label, '刚刚');
assert.equal(formatCommunityPostTime(postTimeNow - 60_000, postTimeNow).label, '1分钟前');
assert.equal(formatCommunityPostTime(postTimeNow - (59 * 60_000), postTimeNow).label, '59分钟前');
assert.equal(formatCommunityPostTime(postTimeNow - 3_600_000, postTimeNow).label, '1小时前');
assert.equal(formatCommunityPostTime(postTimeNow - (23 * 3_600_000), postTimeNow).label, '23小时前');
assert.equal(formatCommunityPostTime(postTimeNow - 86_400_000, postTimeNow).label, '1天前');
assert.equal(formatCommunityPostTime(postTimeNow - (6 * 86_400_000), postTimeNow).label, '6天前');
assert.equal(formatCommunityPostTime(postTimeNow - 604_800_000, postTimeNow).label, '7月8日');
const sameYearPostTime = new Date(2026, 0, 2, 12, 0, 0).getTime();
const previousYearPostTime = new Date(2025, 11, 31, 12, 0, 0).getTime();
assert.equal(formatCommunityPostTime(sameYearPostTime, postTimeNow).label, '1月2日');
assert.equal(formatCommunityPostTime(previousYearPostTime, postTimeNow).label, dateLabel(previousYearPostTime));
const futurePostTime = postTimeNow + 60_000;
assert.deepEqual(formatCommunityPostTime(futurePostTime, postTimeNow), {
    label: '刚刚', datetime: new Date(futurePostTime).toISOString(), title: '2026年7月15日 12:01',
});
assert.equal(formatCommunityPostTime(postTimeNow, NaN).label, '刚刚');
for (const invalidTimestamp of [undefined, 0, -1, NaN, Infinity, -Infinity, '2026-07-15', Date.UTC(1999, 11, 31, 12), 8.65e15]) {
    assert.deepEqual(formatCommunityPostTime(invalidTimestamp, postTimeNow), { label: '时间未知', datetime: '', title: '' });
}

const workspaceScene = normalizeInteractiveStore({
    version: 1,
    scopes: { story: { activeSceneId: 'scene', sceneOrder: ['scene'], scenes: { scene: {
        id: 'scene', title: '主题社区', preset: 'weibo', themeAccent: '#123abc',
        generatedPrompt: '自然交流', posts: [{ id: 'post', author: '访客', content: '测试帖子', createdAt: postTimeNow - 3_600_000, comments: [{ id: 'comment', author: '路人', content: '测试评论' }] }],
        live: { title: '正在直播', status: 'idle', warmupStarted: true, danmaku: [{ id: 'danmaku', author: '访客', content: '弹幕' }] },
    } } } },
}).scopes.story.scenes.scene;
const workspaceHtml = renderCommunityWorkspace(workspaceScene, 'feed', { pinnedSceneIds: [] }, { now: postTimeNow });
assert.match(workspaceHtml, /style="--scene-accent:#123abc"/);
assert.match(workspaceHtml, /placeholder="分享此刻……"/);
const expectedPostDatetime = new Date(postTimeNow - 3_600_000).toISOString();
assert.ok(workspaceHtml.includes(`<time class="pm-scene-post-time" datetime="${expectedPostDatetime}"`));
assert.match(workspaceHtml, /<time class="pm-scene-post-time" datetime="[^"]+" title="[^"]+">1小时前<\/time>/);
const unknownTimeScene = { ...workspaceScene, posts: workspaceScene.posts.map(post => ({ ...post, createdAt: 1 })) };
const unknownTimeHtml = renderCommunityWorkspace(unknownTimeScene, 'feed', { pinnedSceneIds: [] }, { now: postTimeNow });
assert.match(unknownTimeHtml, /<time class="pm-scene-post-time">时间未知<\/time>/,
    '缺失或旧版占位时间必须在最终帖子 HTML 中显示为时间未知');
assert.doesNotMatch(unknownTimeHtml, /<time class="pm-scene-post-time"[^>]*(?:datetime|title)=/,
    '时间未知不得伪造 datetime 或 title 属性');
assert.doesNotMatch(workspaceHtml, /刚刚 · 主题社区/);
assert.match(workspaceHtml, /class="pm-scene-post-author"><b>访客<\/b><time class="pm-scene-post-time"/);
assert.match(workspaceHtml, /class="pm-scene-nav-actions"[\s\S]*data-action="desktop"/);
assert.doesNotMatch(workspaceHtml, /data-action="back"|pm-scene-back/);
assert.match(workspaceHtml, /<nav class="pm-scene-title" aria-label="子社区视图">/,
    '社区标题和直播必须位于独立的双标签导航');
assert.match(workspaceHtml, /class="pm-scene-title-tab is-active"[^>]*data-tab="feed"[^>]*aria-current="page"[^>]*><span>主题社区<\/span>/,
    '帖子页必须激活社区标题标签');
assert.match(workspaceHtml, /class="pm-scene-title-tab "[^>]*data-tab="live"[^>]*aria-current="false"[^>]*><span>直播<\/span>/,
    '直播必须作为第二个文本标签');
assert.match(workspaceHtml, /class="pm-scene-view-actions">[\s\S]*class="pm-header-icon-button pm-scene-title-poke"[^>]*data-action="poke-scene"[\s\S]*class="pm-header-icon-button pm-scene-exit"/,
    '拍一拍必须移出标题居中组并与退出按钮放在右侧操作区');
assert.doesNotMatch(workspaceHtml, /<nav class="pm-scene-title"[\s\S]*pm-scene-title-poke[\s\S]*<\/nav>/,
    '拍一拍不得参与双标签的居中宽度计算');
assert.doesNotMatch(workspaceHtml, /pm-scene-tabs/);
assert.match(workspaceHtml, /data-action="tab" data-tab="prompt">[\s\S]*风格提示词/);
assert.match(workspaceHtml, /data-action="context-inject">[\s\S]*上下文注入/);
assert.match(workspaceHtml, /class="pm-scene-post-more"[^>]*data-action="post-actions"/);
assert.match(workspaceHtml, /data-action="comments"[^>]*aria-label="拍一拍本帖，只生成本帖评论"/);
assert.match(workspaceHtml, /class="pm-scene-like [^"]*"[^>]*data-action="like"/);
assert.match(workspaceHtml, /class="pm-scene-share "[^>]*data-action="share"[^>]*data-post-id="post"[^>]*aria-label="分享本帖"[\s\S]*class="pm-scene-post-metric is-share"/);
assert.match(workspaceHtml, /class="pm-scene-reply-toggle"[^>]*data-action="toggle-reply"[^>]*aria-controls="pm-comment-composer-post"[^>]*aria-expanded="false"/);
assert.match(workspaceHtml, /class="pm-scene-post-metric is-reply"[^>]*aria-label="回复 1"/);
const sharedWorkspaceHtml = renderCommunityWorkspace({ ...workspaceScene, posts: [{ ...workspaceScene.posts[0], shareCount: 1, shared: true }] }, 'feed', { pinnedSceneIds: [] });
assert.match(sharedWorkspaceHtml, /class="pm-scene-share is-shared"[^>]*aria-pressed="true"[^>]*aria-label="已分享本帖"/,
    '当前用户已分享的帖子必须恢复固定分享着色和可访问状态');
assert.match(sharedWorkspaceHtml, /class="pm-scene-post-metric is-share"[^>]*aria-label="转发 \d+"/);
assert.match(workspaceHtml, /class="pm-scene-comment-actions" hidden>[\s\S]*data-action="edit-comment"[^>]*aria-label="编辑评论"[^>]*>[\s\S]*?<svg/);
assert.match(workspaceHtml, /data-action="delete-comment"[^>]*aria-label="删除评论"[^>]*>[\s\S]*?<svg/);
assert.match(workspaceHtml, /id="pm-comment-composer-post" class="pm-scene-comment-composer" hidden/);
assert.match(workspaceHtml, /placeholder="发表你的想法吧"/);
assert.match(workspaceHtml, /data-action="post-comment"[^>]*aria-label="发送回复"[^>]*>[\s\S]*?<svg/);
assert.doesNotMatch(workspaceHtml, /生成更多评论|>喜欢<|>已喜欢</);
assert.match(workspaceHtml, /class="pm-scene-bottom-bar"/);
assert.match(workspaceHtml, /class="pm-control-menu pm-scene-menu" role="menu" aria-label="社区工具" hidden/);
assert.match(workspaceHtml, /class="pm-header-icon-button pm-scene-exit"[^>]*data-action="exit"/);
assert.doesNotMatch(workspaceHtml, /生成热场内容|编辑社区风格/);
const liveWorkspaceHtml = renderCommunityWorkspace(workspaceScene, 'live', { pinnedSceneIds: [] }, { liveState: 'active' });
assert.match(liveWorkspaceHtml, /class="pm-scene-title-tab "[^>]*data-tab="feed"[^>]*aria-current="false"/);
assert.match(liveWorkspaceHtml, /class="pm-scene-title-tab is-active"[^>]*data-tab="live"[^>]*aria-current="page"[^>]*>[\s\S]*<span>直播<\/span>/);
assert.match(liveWorkspaceHtml, /pm-live-stage has-danmaku" data-live-state="active"/);
assert.match(liveWorkspaceHtml, /<section class="pm-live-details" aria-label="热场内容">/,
    '热场完成后必须展开独立的下方内容区');
assert.doesNotMatch(liveWorkspaceHtml, /class="pm-live-play-btn"/,
    '热场完成后播放三角必须消失');
assert.match(liveWorkspaceHtml, /--duration:[\d.]+s;--offset:-?\d+px/);
assert.match(liveWorkspaceHtml, /data-action="send-danmaku"[^>]*aria-label="发送弹幕"[^>]*>[\s\S]*?<svg/,
    '弹幕发送必须使用图标按钮并保留无障碍名称');
assert.match(liveWorkspaceHtml, /class="pm-scene-bottom-bar">[\s\S]*?class="pm-scene-menu-wrap"[\s\S]*?class="pm-scene-composer pm-danmaku-input">[\s\S]*?<textarea id="pm-danmaku-input" rows="1" maxlength="200" placeholder="发个弹幕见证当下"><\/textarea>[\s\S]*?class="pm-scene-primary" data-action="send-danmaku"/,
    '直播必须完整复用贴文底栏，并保留弹幕发送契约');
assert.match(liveWorkspaceHtml, /data-action="toggle-danmaku-actions"[^>]*aria-pressed="false"[^>]*>[\s\S]*?<span>修改弹幕<\/span>/,
    '仅直播底栏菜单必须提供修改弹幕入口并默认隐藏操作按钮');
assert.match(liveWorkspaceHtml, /pm-danmaku-row is-[^"]+">[\s\S]*?pm-danmaku-row-header[\s\S]*?<b title="[^"]+">[^<]+<\/b>[\s\S]*?class="pm-scene-comment-actions" hidden>[\s\S]*?data-action="edit-danmaku"[^>]*data-danmaku-id="[^"]+"[\s\S]*?data-action="delete-danmaku"[^>]*data-danmaku-id="[^"]+"[\s\S]*?class="pm-danmaku-content">[^<]+<\/span>/,
    '修改弹幕开启前必须隐藏同款编辑删除按钮，并维持昵称与正文上下结构');
assert.doesNotMatch(liveWorkspaceHtml, /danmaku-manage|pm-danmaku-manager/,
    '直播弹幕修改不得创建独立管理页');
assert.doesNotMatch(workspaceHtml, /toggle-danmaku-actions|edit-danmaku|delete-danmaku/,
    '贴文底栏与列表不得出现直播专属弹幕操作');
const idleLiveWorkspaceHtml = renderCommunityWorkspace({ ...workspaceScene, live: { ...workspaceScene.live, warmupStarted: false, danmaku: [] } }, 'live', { pinnedSceneIds: [] });
assert.match(idleLiveWorkspaceHtml, /class="pm-live-play-btn"[^>]*data-action="start-warmup"[^>]*aria-label="开始热场"[^>]*>[\s\S]*?<svg/);
assert.match(idleLiveWorkspaceHtml, /pm-danmaku-list[\s\S]*pm-scene-bottom-bar[\s\S]*pm-danmaku-input[\s\S]*data-action="send-danmaku"/,
    '进入直播页时必须立即预留弹幕区和发送模块');
const loadingLiveWorkspaceHtml = renderCommunityWorkspace(workspaceScene, 'live', { pinnedSceneIds: [] }, { liveState: 'starting' });
assert.match(loadingLiveWorkspaceHtml, /data-live-state="starting"[\s\S]*正在准备热场…/);
assert.doesNotMatch(loadingLiveWorkspaceHtml, /class="pm-live-play-btn"/,
    '点击播放后必须立即隐藏播放三角');
assert.match(loadingLiveWorkspaceHtml, /pm-danmaku-list[\s\S]*pm-scene-bottom-bar[\s\S]*pm-danmaku-input/,
    '热场生成期间必须保留基础直播布局');
const failedLiveWorkspaceHtml = renderCommunityWorkspace(workspaceScene, 'live', { pinnedSceneIds: [] }, { liveState: 'error' });
assert.match(failedLiveWorkspaceHtml, /data-live-state="error"[\s\S]*aria-label="重新开始热场"[\s\S]*热场未能启动，请重试。/,
    '失败后必须保留可重试的播放入口，且不能伪装成已完成热场');
assert.match(failedLiveWorkspaceHtml, /pm-live-details[\s\S]*pm-danmaku-list[\s\S]*pm-scene-bottom-bar[\s\S]*pm-danmaku-input/,
    '热场失败后仍必须保留弹幕预留区与手动发送能力');
assert.doesNotMatch(liveWorkspaceHtml, /toggle-live|data-action="rhythm"|pm-live-actions/,
    '直播页不得保留旧直播控制与带节奏入口');
const editableDanmakuScene = structuredClone(workspaceScene);
editableDanmakuScene.live.danmaku = [{ id: 'danmaku-edit', authorNameSnapshot: '编辑者', content: '原内容' }];
updateSceneDanmaku(editableDanmakuScene, 'danmaku-edit', '  新内容  ');
assert.equal(editableDanmakuScene.live.danmaku[0].content, '新内容', '编辑弹幕必须规范化并写回正文');
assert.throws(() => updateSceneDanmaku(editableDanmakuScene, 'missing', '内容'), /弹幕不存在/);
assert.throws(() => updateSceneDanmaku(editableDanmakuScene, 'danmaku-edit', '   '), /弹幕内容不能为空/);
deleteSceneDanmaku(editableDanmakuScene, 'danmaku-edit');
assert.equal(editableDanmakuScene.live.danmaku.length, 0, '删除弹幕必须移除指定记录');
assert.throws(() => deleteSceneDanmaku(editableDanmakuScene, 'missing'), /弹幕不存在/);
const promptWorkspaceHtml = renderCommunityWorkspace(workspaceScene, 'prompt', { pinnedSceneIds: [], lastTab: 'live' });
assert.match(promptWorkspaceHtml, /class="pm-scene-accent-options"/);
assert.match(promptWorkspaceHtml, /data-action="scene-accent" data-accent="#ff8200"/);
assert.match(promptWorkspaceHtml, /aria-label="使用微博热场主题色" aria-pressed="false"/);
assert.match(promptWorkspaceHtml, /id="pm-scene-accent" type="color" data-action="scene-accent-custom" value="#123abc"/);
assert.match(promptWorkspaceHtml, /class="pm-scene-secondary" data-action="regenerate-prompt"/);
assert.match(promptWorkspaceHtml, /设置社区内容的表达风格与氛围。/);
assert.match(promptWorkspaceHtml, /class="pm-scene-home" data-action="tab" data-tab="live" aria-label="返回子社区"/);
assert.doesNotMatch(promptWorkspaceHtml, /class="pm-scene-bottom-bar"|class="pm-control-menu pm-scene-menu"|placeholder="分享此刻……"/,
    '提示词页不得保留社区二级菜单或发帖输入区');
assert.doesNotMatch(promptWorkspaceHtml, /class="pm-scene-home" data-action="desktop"/,
    '提示词页左侧按钮必须返回子社区而不是桌面');
const contextInjectWorkspaceHtml = renderCommunityWorkspace(workspaceScene, 'context-inject', { pinnedSceneIds: [], lastTab: 'feed' });
assert.doesNotMatch(contextInjectWorkspaceHtml, /class="pm-scene-bottom-bar"|class="pm-control-menu pm-scene-menu"|placeholder="分享此刻……"/,
    '上下文注入页不得保留社区二级菜单或发帖输入区');
const presetAccentScene = { ...workspaceScene, themeAccent: '#ff8200' };
const presetAccentHtml = renderCommunityWorkspace(presetAccentScene, 'prompt', { pinnedSceneIds: [] });
assert.match(presetAccentHtml, /data-accent="#ff8200"[^>]*aria-pressed="true"/);
const emptyWorkspaceHtml = renderCommunityWorkspace({ ...workspaceScene, posts: [] }, 'feed', { pinnedSceneIds: [] });
assert.match(emptyWorkspaceHtml, /class="pm-scene-empty"[\s\S]*这里还很安静[\s\S]*发第一篇帖子/);
assert.doesNotMatch(emptyWorkspaceHtml, /class="pm-scene-post"/);
const injectionWorkspaceHtml = renderCommunityWorkspace(workspaceScene, 'context-inject', { pinnedSceneIds: [] }, {
    communitySelection: { mode: 'selected', postIds: ['post'] },
});
assert.match(injectionWorkspaceHtml, /<h2>正文注入<\/h2>/);
assert.match(injectionWorkspaceHtml, /class="pm-scene-injection-post-toggle is-selected" data-action="context-toggle-post" data-post-id="post" aria-pressed="true"/);
assert.match(injectionWorkspaceHtml, /aria-label="取消注入此博文"/);
assert.doesNotMatch(injectionWorkspaceHtml, /pm-scene-injection-enabled|pm-scene-injection-mode|pm-scene-injection-post-input|配置当前社区进入角色上下文/);
assert.match(injectionWorkspaceHtml, /data-action="context-select-all"[\s\S]*data-action="context-clear"/);
assert.match(injectionWorkspaceHtml, /data-action="context-save"/);

const createInjectionPostControl = (postId, selected = false) => {
    const classes = new Set(selected ? ['is-selected'] : []);
    const attributes = new Map();
    return {
        dataset: { postId }, title: '',
        classList: {
            contains: name => classes.has(name),
            toggle(name, force) { if (force) classes.add(name); else classes.delete(name); },
        },
        matches: selector => selector === '[data-action="context-toggle-post"]',
        setAttribute(name, value) { attributes.set(name, String(value)); },
        getAttribute(name) { return attributes.get(name) || null; },
    };
};
const firstInjectionPost = createInjectionPostControl('post-a');
const secondInjectionPost = createInjectionPostControl('post-b');
const injectionApp = {
    querySelectorAll(selector) {
        const controls = [firstInjectionPost, secondInjectionPost];
        if (selector === '.pm-scene-injection-post-toggle') return controls;
        if (selector === '.pm-scene-injection-post-toggle.is-selected') {
            return controls.filter(control => control.classList.contains('is-selected'));
        }
        throw new Error(`unexpected injection selector: ${selector}`);
    },
    contains(control) { return control === firstInjectionPost || control === secondInjectionPost; },
};
const legacyCommunityConfig = {
    communitySceneIdsByStorage: { story: ['scene-a'] },
    communitySelectionsByStorage: {},
};
assert.deepEqual(getCommunityInjectionState(legacyCommunityConfig, 'story', 'scene-a').communitySelection, { mode: 'all', postIds: [] },
    '旧场景授权缺少帖子选择时必须投影为全部帖子，不能静默清空注入');
await runCommunityInjectionAction('context-select-all', { app: injectionApp });
assert.equal(firstInjectionPost.getAttribute('aria-pressed'), 'true');
assert.equal(secondInjectionPost.getAttribute('aria-pressed'), 'true');
await runCommunityInjectionAction('context-toggle-post', { app: injectionApp, button: firstInjectionPost });
assert.equal(firstInjectionPost.getAttribute('aria-pressed'), 'false', '单条小眼睛必须独立切换');
let savedCommunityCandidate = null;
let refreshCommunityCalls = 0;
const saveCommunityAction = async () => runCommunityInjectionAction('context-save', {
    app: injectionApp,
    storageId: 'story',
    scene: { id: 'scene-a' },
    lastTab: 'feed',
    config: legacyCommunityConfig,
    saveConfig: candidate => { savedCommunityCandidate = candidate; return true; },
    refreshInjection: async () => { refreshCommunityCalls += 1; return { failedWrites: 0, failedKeys: [] }; },
});
await saveCommunityAction();
assert.deepEqual(savedCommunityCandidate.communitySceneIdsByStorage.story, ['scene-a']);
assert.deepEqual(savedCommunityCandidate.communitySelectionsByStorage.story['scene-a'], { mode: 'selected', postIds: ['post-b'] });
assert.equal(refreshCommunityCalls, 1, '保存后必须刷新宿主注入');
await runCommunityInjectionAction('context-clear', { app: injectionApp });
await saveCommunityAction();
assert.equal(savedCommunityCandidate.communitySceneIdsByStorage.story, undefined, '清空后必须撤销场景注入');
assert.equal(savedCommunityCandidate.communitySelectionsByStorage.story, undefined, '清空后必须移除帖子选择');
await assert.rejects(() => runCommunityInjectionAction('context-save', {
    app: injectionApp, storageId: 'story', scene: { id: 'scene-a' }, lastTab: 'feed', config: legacyCommunityConfig,
    saveConfig: () => false, refreshInjection: async () => ({ failedWrites: 0, failedKeys: [] }),
}), /浏览器存储不可用/);
await assert.rejects(() => runCommunityInjectionAction('context-save', {
    app: injectionApp, storageId: 'story', scene: { id: 'scene-a' }, lastTab: 'feed', config: legacyCommunityConfig,
    saveConfig: () => true, refreshInjection: async () => ({ failedWrites: 1, failedKeys: [] }),
}), /刷新失败/);

const launcherScope = {
    sceneOrder: ['scene-card'],
    scenes: {
        'scene-card': { id: 'scene-card', title: '雨夜社区', preset: 'romance', themeAccent: '#123abc', posts: [] },
    },
};
const unpinnedLauncherHtml = renderCommunityLauncher(launcherScope, { pinnedSceneIds: [] });
assert.match(unpinnedLauncherHtml, /id="pm-scene-app"[^>]*style="--scene-accent:#ff8200"/,
    '社区启动页必须以默认微博预设色驱动生成按钮');
assert.match(unpinnedLauncherHtml, /class="pm-scene-home"[^>]*data-action="desktop"[^>]*aria-label="返回桌面"/,
    '社区启动页返回桌面必须复用灰色 home 控件');
assert.match(unpinnedLauncherHtml, /data-action="preset"[^>]*data-preset="douban"[^>]*data-accent="#00a65a"/,
    '豆瓣预设必须向交互层暴露绿色主题色');
assert.match(unpinnedLauncherHtml, /class="pm-scene-card-actions"/);
assert.match(unpinnedLauncherHtml, /class="pm-scene-pin-action"[^>]*aria-pressed="false"[^>]*aria-label="固定社区"[^>]*>[\s\S]*?<path d="M4 19V8l8-4 8 4v11"/,
    '未固定按钮必须使用与桌面发布入口一致的社区图标');
assert.match(unpinnedLauncherHtml, /class="pm-scene-template-action"[^>]*data-action="publish-community-template"[^>]*aria-label="发布共享模板"[^>]*>[\s\S]*?<svg/,
    '未发布社区必须在固定和删除按钮左侧提供明确的 SVG 模板发布动作');
assert.doesNotMatch(unpinnedLauncherHtml, /toggle-community-template|aria-pressed="false"[^>]*aria-label="发布共享模板"/,
    '发布模板不是二元开关，不得遗留会误导重复发布语义的 pressed 状态');
assert.match(unpinnedLauncherHtml, /class="pm-scene-card"[^>]*style="--scene-accent:#123abc"/,
    '启动器卡片必须透传场景主题色');
assert.doesNotMatch(unpinnedLauncherHtml, /--scene-pin-accent/, '固定按钮不得保留与当前预设脱节的卡片级颜色变量');
assert.match(unpinnedLauncherHtml, /data-action="delete-scene"[^>]*aria-label="删除社区"[^>]*>[\s\S]*?<svg/);
assert.doesNotMatch(unpinnedLauncherHtml, />固定<\/button>|>删除<\/button>/, '场景卡片操作必须使用 SVG 且保留可访问名称');
assert.match(unpinnedLauncherHtml, /class="pm-scene-card-open"[^>]*>[\s\S]*?<\/button><div class="pm-scene-card-actions">/, '场景卡片操作必须位于打开场景按钮之外');
const publishedLauncherTemplate = createCommunityTemplate(launcherScope.scenes['scene-card'], 'story', 1);
const pinnedLauncherHtml = renderCommunityLauncher(launcherScope, {
    pinnedSceneIds: ['scene-card'], storageId: 'story', sharedCommunityTemplates: [publishedLauncherTemplate],
});
assert.match(pinnedLauncherHtml, /class="pm-scene-pin-action"[^>]*aria-pressed="true"[^>]*aria-label="取消固定社区"[^>]*>[\s\S]*?<path d="M4 19V8l8-4 8 4v11"/);
assert.match(pinnedLauncherHtml, /class="pm-scene-template-action pm-scene-template-unpublish"[^>]*data-action="unpublish-community-template"[^>]*aria-label="取消发布共享模板"/,
    '已发布社区必须将原 SVG 动作切换为取消发布');
assert.doesNotMatch(pinnedLauncherHtml, /data-action="publish-community-template"/,
    '已发布社区不得同时渲染更新和取消发布两个相同 SVG 按钮');
assert.equal((pinnedLauncherHtml.match(/class="pm-scene-template-action(?:\s[^"]*)?"/g) || []).length, 1,
    '每个社区卡片只能渲染一个共享模板 SVG 动作');

const desktopTransitionCalls = [];
const desktopStore = { scopes: { story: { activeSceneId: null, sceneOrder: [], scenes: {}, actors: {} } } };
let desktopCurrentPage = 'chat';
assert.equal(await runDesktopPageTransition({
    scopeId: 'story',
    loadStore: async () => { desktopTransitionCalls.push('load'); return desktopStore; },
    clearOpenScene: () => desktopTransitionCalls.push('clear'),
    refreshDesktop: (scopeId, store) => { desktopTransitionCalls.push(['render', scopeId, store]); return true; },
    updatePhoneUi: (scopeId, store) => desktopTransitionCalls.push(['persist', scopeId, store]),
    showPhonePage: page => { desktopTransitionCalls.push(['show', page]); desktopCurrentPage = page; return true; },
    getCurrentPage: () => desktopCurrentPage,
}), true);
assert.deepEqual(desktopTransitionCalls, [
    'load',
    ['render', 'story', desktopStore],
    ['show', 'desktop'],
    ['persist', 'story', desktopStore],
    'clear',
]);

const invalidScopeDesktopCalls = [];
let invalidScopeCurrentPage = 'chat';
assert.equal(await runDesktopPageTransition({
    scopeId: 'sms_unknown__default',
    loadStore: async () => { throw new Error('invalid scope must not load store'); },
    clearOpenScene: () => invalidScopeDesktopCalls.push('clear'),
    refreshDesktop: (scopeId, store) => { invalidScopeDesktopCalls.push(['render', scopeId, store]); return true; },
    updatePhoneUi: () => { throw new Error('invalid scope must not persist state'); },
    showPhonePage: page => { invalidScopeDesktopCalls.push(['show', page]); invalidScopeCurrentPage = page; return true; },
    getCurrentPage: () => invalidScopeCurrentPage,
}), true);
assert.deepEqual(invalidScopeDesktopCalls, [
    ['render', 'sms_unknown__default', null],
    ['show', 'desktop'],
    'clear',
]);

const failedDesktopCalls = [];
await assert.rejects(runDesktopPageTransition({
    scopeId: 'story',
    loadStore: async () => { failedDesktopCalls.push('load'); return desktopStore; },
    clearOpenScene: () => failedDesktopCalls.push('clear'),
    refreshDesktop: () => { failedDesktopCalls.push('render'); return false; },
    updatePhoneUi: () => failedDesktopCalls.push('persist'),
    showPhonePage: () => { failedDesktopCalls.push('show'); return true; },
}), /桌面内容渲染失败/);
assert.deepEqual(failedDesktopCalls, ['load', 'render']);

const unavailableDesktopCalls = [];
let unavailableCurrentPage = 'chat';
await assert.rejects(runDesktopPageTransition({
    scopeId: 'story',
    loadStore: async () => desktopStore,
    clearOpenScene: () => unavailableDesktopCalls.push('clear'),
    refreshDesktop: () => { unavailableDesktopCalls.push('render'); return true; },
    updatePhoneUi: () => unavailableDesktopCalls.push('persist'),
    showPhonePage: () => { unavailableDesktopCalls.push('show'); return false; },
    getCurrentPage: () => unavailableCurrentPage,
}), /桌面页面不可用/);
assert.deepEqual(unavailableDesktopCalls, ['render', 'show']);

const rollbackDesktopCalls = [];
let rollbackCurrentPage = 'chat';
await assert.rejects(runDesktopPageTransition({
    scopeId: 'story',
    loadStore: async () => desktopStore,
    clearOpenScene: () => rollbackDesktopCalls.push('clear'),
    refreshDesktop: () => { rollbackDesktopCalls.push('render'); return true; },
    updatePhoneUi: () => { rollbackDesktopCalls.push('persist'); throw new Error('quota'); },
    showPhonePage: page => { rollbackDesktopCalls.push(['show', page]); rollbackCurrentPage = page; return true; },
    getCurrentPage: () => rollbackCurrentPage,
}), /quota/);
assert.deepEqual(rollbackDesktopCalls, ['render', ['show', 'desktop'], 'persist', ['show', 'chat']]);

const supersededRollbackCalls = [];
let supersededCurrentPage = 'chat';
await assert.rejects(runDesktopPageTransition({
    scopeId: 'story',
    loadStore: async () => desktopStore,
    clearOpenScene: () => supersededRollbackCalls.push('clear'),
    refreshDesktop: () => { supersededRollbackCalls.push('render'); return true; },
    updatePhoneUi: () => {
        supersededRollbackCalls.push('persist');
        supersededCurrentPage = 'community';
        throw new Error('quota after navigation');
    },
    showPhonePage: page => { supersededRollbackCalls.push(['show', page]); supersededCurrentPage = page; return true; },
    getCurrentPage: () => supersededCurrentPage,
}), /quota after navigation/);
assert.deepEqual(supersededRollbackCalls, ['render', ['show', 'desktop'], 'persist']);
assert.equal(supersededCurrentPage, 'community', '持久化失败不得覆盖事务期间发生的新导航');

let rearmErrorMessage = '';
let rearmErrorAction = '';
await runControlMenuAction(
    'rearm',
    () => Promise.reject(new Error('rearm unavailable')),
    (error, action) => { rearmErrorMessage = error.message; rearmErrorAction = action; },
);
assert.equal(rearmErrorMessage, 'rearm unavailable');
assert.equal(rearmErrorAction, 'rearm');
let nonDesktopErrorReported = false;
assert.throws(() => runControlMenuAction(
    'settings',
    () => { throw new Error('settings unavailable'); },
    () => { nonDesktopErrorReported = true; },
), /settings unavailable/);
assert.equal(nonDesktopErrorReported, false, '同步 action 不得误报为异步操作失败');
let calendarErrorMessage = '';
let calendarErrorAction = '';
await runControlMenuAction(
    'calendar',
    () => Promise.reject(new Error('calendar unavailable')),
    (error, action) => { calendarErrorMessage = error.message; calendarErrorAction = action; },
);
assert.equal(calendarErrorMessage, 'calendar unavailable', '日历异步错误应通过 report handler 传递');
assert.equal(calendarErrorAction, 'calendar', '错误报告必须知道失败的是日历动作');
let calendarSyncErrorReported = false;
assert.throws(() => runControlMenuAction(
    'calendar',
    () => { throw new Error('calendar sync fail'); },
    () => { calendarSyncErrorReported = true; },
), /calendar sync fail/);
assert.equal(calendarSyncErrorReported, false, '日历同步异常不应误报');
let contactsErrorMessage = '';
let contactsErrorAction = '';
await runControlMenuAction(
    'contacts',
    () => Promise.reject(new Error('contacts unavailable')),
    (error, action) => { contactsErrorMessage = error.message; contactsErrorAction = action; },
);
assert.equal(contactsErrorMessage, 'contacts unavailable', '联系人异步错误应进入控制中心错误边界');
assert.equal(contactsErrorAction, 'contacts');

const finalizerCalls = [];
assert.throws(() => finalizeDeletedScene({
    persistPhoneUi: () => { finalizerCalls.push('phone-ui'); throw new Error('quota'); },
    refreshDesktop: () => { finalizerCalls.push('desktop'); },
    persistBudget: () => { finalizerCalls.push('budget'); throw new Error('budget-write'); },
    clearOpenScene: () => { finalizerCalls.push('clear'); },
    renderLauncher: () => { finalizerCalls.push('launcher'); },
}), /互动场景已删除；手机页面状态保存失败：quota；上下文预算清理保存失败：budget-write/);
assert.deepEqual(finalizerCalls, ['phone-ui', 'desktop', 'budget', 'clear', 'launcher']);
const successfulFinalizerCalls = [];
assert.doesNotThrow(() => finalizeDeletedScene({
    persistPhoneUi: () => successfulFinalizerCalls.push('phone-ui'),
    refreshDesktop: () => successfulFinalizerCalls.push('desktop'),
    persistBudget: () => successfulFinalizerCalls.push('budget'),
    clearOpenScene: () => successfulFinalizerCalls.push('clear'),
    renderLauncher: () => successfulFinalizerCalls.push('launcher'),
}));
assert.deepEqual(successfulFinalizerCalls, ['phone-ui', 'desktop', 'budget', 'clear', 'launcher']);

const deletedSceneRuntime = { openSceneId: 'scene-delete' };
const deletedSceneScope = {
    activeSceneId: 'scene-delete',
    scenes: {
        'scene-keep': { id: 'scene-keep', title: '保留场景' },
        'scene-delete': { id: 'scene-delete', title: '待删除场景' },
    },
    sceneOrder: ['scene-keep', 'scene-delete'],
};
const deleteBudgetConfig = { communitySceneIdsByStorage: { story: ['scene-keep', 'scene-delete'] } };
const deleteFlowCalls = [];
let deletedBudgetCandidate = null;
await assert.rejects(() => runDeleteSceneAction('story', 'scene-delete', {
    scope: deletedSceneScope,
    confirm: message => { deleteFlowCalls.push('confirm'); return message.includes('待删除场景'); },
    invalidate: () => deleteFlowCalls.push('invalidate'),
    commit: async mutator => { deleteFlowCalls.push('commit'); await mutator(); },
    persistPhoneUi: () => deleteFlowCalls.push('phone-ui'),
    refreshDesktop: scopeId => deleteFlowCalls.push(`desktop:${scopeId}`),
    getBudgetConfig: () => deleteBudgetConfig,
    saveBudgetConfig: candidate => {
        deleteFlowCalls.push('budget-save');
        deletedBudgetCandidate = candidate;
        return false;
    },
    clearOpenScene: () => { deleteFlowCalls.push('clear'); deletedSceneRuntime.openSceneId = null; },
    renderLauncher: scopeId => deleteFlowCalls.push(`launcher:${scopeId}`),
}), /互动场景已删除；上下文预算清理保存失败：浏览器存储不可用/);
assert.deepEqual(deleteFlowCalls, [
    'confirm', 'invalidate', 'commit', 'phone-ui', 'desktop:story',
    'budget-save', 'clear', 'launcher:story',
]);
assert.equal(deletedSceneScope.scenes['scene-delete'], undefined);
assert.deepEqual(deletedSceneScope.sceneOrder, ['scene-keep']);
assert.equal(deletedSceneScope.activeSceneId, 'scene-keep');
assert.deepEqual(deletedBudgetCandidate.communitySceneIdsByStorage.story, ['scene-keep']);
assert.deepEqual(deleteBudgetConfig.communitySceneIdsByStorage.story, ['scene-keep', 'scene-delete']);
assert.equal(deletedSceneRuntime.openSceneId, null, '预算保存失败后仍必须清理已删除场景的运行时引用');

const cancelledDeleteScope = {
    activeSceneId: 'scene-cancel',
    scenes: { 'scene-cancel': { id: 'scene-cancel', title: '取消删除' } },
    sceneOrder: ['scene-cancel'],
};
let cancelledCommitCount = 0;
assert.equal(await runDeleteSceneAction('story', 'scene-cancel', {
    scope: cancelledDeleteScope,
    confirm: () => false,
    invalidate: () => assert.fail('取消删除不得失效运行时任务'),
    commit: async () => { cancelledCommitCount += 1; },
    persistPhoneUi: () => assert.fail('取消删除不得保存页面状态'),
    refreshDesktop: () => assert.fail('取消删除不得刷新桌面'),
    getBudgetConfig: () => ({}),
    saveBudgetConfig: () => true,
    clearOpenScene: () => assert.fail('取消删除不得清理打开场景'),
    renderLauncher: () => assert.fail('取消删除不得刷新社区页面'),
}), false);
assert.equal(cancelledCommitCount, 0);
assert.ok(cancelledDeleteScope.scenes['scene-cancel']);

await assert.rejects(() => runDeleteSceneAction('story', 'missing-scene', {
    scope: cancelledDeleteScope,
    confirm: () => assert.fail('不存在的场景不得进入确认'),
}), /互动场景不存在/);

const failedCommitCalls = [];
await assert.rejects(() => runDeleteSceneAction('story', 'scene-cancel', {
    scope: cancelledDeleteScope,
    confirm: () => true,
    invalidate: () => failedCommitCalls.push('invalidate'),
    commit: async () => { failedCommitCalls.push('commit'); throw new Error('commit-failed'); },
    persistPhoneUi: () => failedCommitCalls.push('phone-ui'),
    refreshDesktop: () => failedCommitCalls.push('desktop'),
    getBudgetConfig: () => ({}),
    saveBudgetConfig: () => true,
    clearOpenScene: () => failedCommitCalls.push('clear'),
    renderLauncher: () => failedCommitCalls.push('launcher'),
}), /commit-failed/);
assert.deepEqual(failedCommitCalls, ['invalidate', 'commit']);

let firstReplyExpanded = 'false';
let secondReplyExpanded = 'true';
let firstReplyFocusOptions = null;
let secondReplyFocusOptions = null;
const firstReplyInput = {
    focus(options) { firstReplyFocusOptions = options; },
};
const secondReplyInput = {
    focus(options) { secondReplyFocusOptions = options; },
};
const firstReplyComposer = {
    id: 'pm-comment-composer-post.a#1',
    hidden: true,
    querySelector(selector) { assert.equal(selector, 'input'); return firstReplyInput; },
};
const secondReplyComposer = {
    id: 'pm-comment-composer-post-b',
    hidden: false,
    querySelector(selector) { assert.equal(selector, 'input'); return secondReplyInput; },
};
const firstReplyTrigger = {
    dataset: { action: 'toggle-reply', postId: 'post.a#1' },
    getAttribute(name) { assert.equal(name, 'aria-controls'); return firstReplyComposer.id; },
    setAttribute(name, value) { assert.equal(name, 'aria-expanded'); firstReplyExpanded = value; },
};
const secondReplyTrigger = {
    dataset: { action: 'toggle-reply', postId: 'post-b' },
    getAttribute(name) { assert.equal(name, 'aria-controls'); return secondReplyComposer.id; },
    setAttribute(name, value) { assert.equal(name, 'aria-expanded'); secondReplyExpanded = value; },
};
const replySceneApp = {
    id: 'pm-scene-app',
    querySelectorAll(selector) {
        if (selector === '.pm-scene-comment-composer') return [firstReplyComposer, secondReplyComposer];
        if (selector === '[data-action="toggle-reply"]') return [firstReplyTrigger, secondReplyTrigger];
        assert.fail(`回复区不应查询未知选择器：${selector}`);
    },
};
assert.equal(toggleSceneReplyComposer({ dataset: {} }, replySceneApp), false, '缺少帖子 ID 时不得改动回复区');
assert.equal(toggleSceneReplyComposer({
    dataset: { postId: 'missing' },
    getAttribute: () => 'missing-composer',
}, replySceneApp), false, 'aria-controls 未命中当前 app 时不得改动回复区');
assert.equal(toggleSceneReplyComposer(firstReplyTrigger, replySceneApp), true, '首次点击必须展开目标回复区');
assert.equal(firstReplyComposer.hidden, false);
assert.equal(secondReplyComposer.hidden, true, '展开目标前必须关闭当前 app 内其他回复区');
assert.equal(firstReplyExpanded, 'true');
assert.equal(secondReplyExpanded, 'false');
assert.deepEqual(firstReplyFocusOptions, { preventScroll: true }, '展开回复区必须无滚动聚焦目标输入框');
assert.equal(toggleSceneReplyComposer(firstReplyTrigger, replySceneApp), false, '重复点击必须关闭同一回复区');
assert.equal(firstReplyComposer.hidden, true);
assert.equal(firstReplyExpanded, 'false');
assert.equal(toggleSceneReplyComposer(firstReplyTrigger, replySceneApp), true);
assert.equal(toggleSceneReplyComposer(secondReplyTrigger, replySceneApp), true, '切换帖子必须展开新的回复区');
assert.equal(firstReplyComposer.hidden, true, '切换帖子必须关闭先前回复区');
assert.equal(secondReplyComposer.hidden, false);
assert.equal(firstReplyExpanded, 'false');
assert.equal(secondReplyExpanded, 'true');
assert.deepEqual(secondReplyFocusOptions, { preventScroll: true });

const delegatedListeners = new Map();
const delegatedActions = [];
let openSceneMenus = [];
let openPostActions = [];
const delegatedErrors = [];
const delegatedExtraNodes = new Set();
const desktopApp = { kind: 'desktop' };
const sceneApp = { id: 'pm-scene-app' };
const calendarApp = { id: 'pm-calendar-app' };
const actionButton = {
    dataset: { action: 'desktop-chat' },
    closest(selector) {
        if (selector === '#pm-scene-app') return null;
        if (selector === '.pm-desktop-page') return desktopApp;
        return null;
    },
};
const actionTarget = {
    closest(selector) {
        assert.equal(selector, '[data-action]');
        return actionButton;
    },
};
const delegatedPhoneRoot = {
    dataset: {},
    addEventListener(type, listener) {
        assert.equal(delegatedListeners.has(type), false);
        delegatedListeners.set(type, listener);
    },
    querySelectorAll(selector) {
        if (selector === '.pm-scene-menu:not([hidden])') return openSceneMenus.filter(menu => !menu.hidden);
        if (selector === '.pm-scene-post-actions:not([hidden])') return openPostActions.filter(actions => !actions.hidden);
        assert.fail(`不应查询未知选择器：${selector}`);
    },
    contains(node) { return node === actionButton || node === calendarActionButton || delegatedExtraNodes.has(node); },
};
assert.equal(bindPhonePageActions(
    delegatedPhoneRoot,
    (button, app) => {
        if (button.dataset.action === 'post-actions') toggleScenePostActions(button);
        if (button.dataset.action === 'toggle-reply') toggleSceneReplyComposer(button, app);
        delegatedActions.push({ button, app });
    },
    error => delegatedErrors.push(error),
), true);
assert.equal(bindPhonePageActions(delegatedPhoneRoot, () => {}, () => {}), false);
assert.deepEqual([...delegatedListeners.keys()], ['click', 'change', 'keydown', 'touchstart', 'touchend', 'touchcancel']);
delegatedListeners.get('click')({ target: actionTarget });
await Promise.resolve();
assert.deepEqual(delegatedActions, [{ button: actionButton, app: desktopApp }], '重复绑定后一次点击只能分发一次');
assert.deepEqual(delegatedErrors, []);

const calendarActionButton = {
    dataset: { action: 'calendar-occasion-save' },
    closest(selector) {
        if (selector === '#pm-scene-app') return null;
        if (selector === '#pm-calendar-app') return calendarApp;
        return null;
    },
};
const calendarActionTarget = {
    closest(selector) {
        assert.equal(selector, '[data-action]');
        return calendarActionButton;
    },
};
delegatedListeners.get('click')({ target: calendarActionTarget });
await Promise.resolve();
assert.deepEqual(delegatedActions, [
    { button: actionButton, app: desktopApp },
    { button: calendarActionButton, app: calendarApp },
], '日历页面动作必须进入统一事件委托并保留目标 app');
assert.deepEqual(delegatedErrors, []);

const calendarMonthNavigation = {
    closest(selector) {
        if (selector === '[data-calendar-month-navigation]') return this;
        if (selector === '#pm-calendar-app') return calendarApp;
        return null;
    },
};
delegatedExtraNodes.add(calendarMonthNavigation);
let monthKeyPrevented = false;
delegatedListeners.get('keydown')({
    key: 'ArrowRight', target: calendarMonthNavigation,
    preventDefault() { monthKeyPrevented = true; },
});
await Promise.resolve();
assert.equal(monthKeyPrevented, true, '月历方向键必须阻止浏览器默认横向行为');
assert.deepEqual(delegatedActions.at(-1), {
    button: { dataset: { action: 'calendar-next-month' } }, app: calendarApp,
}, '月历右方向键必须复用下个月 action');

const actionsBeforeVerticalTouch = delegatedActions.length;
delegatedListeners.get('touchstart')({
    target: calendarMonthNavigation, touches: [{ clientX: 100, clientY: 100 }],
});
delegatedListeners.get('touchend')({ changedTouches: [{ clientX: 130, clientY: 180 }] });
await Promise.resolve();
assert.equal(delegatedActions.length, actionsBeforeVerticalTouch,
    '纵向滚动或短距离手势不得误触翻月');

delegatedListeners.get('touchstart')({
    target: calendarMonthNavigation, touches: [{ clientX: 180, clientY: 100 }],
});
delegatedListeners.get('touchend')({ changedTouches: [{ clientX: 90, clientY: 108 }] });
await Promise.resolve();
assert.deepEqual(delegatedActions.at(-1), {
    button: { dataset: { action: 'calendar-next-month' } }, app: calendarApp,
}, '向左水平滑动必须复用下个月 action');

delegatedListeners.get('touchstart')({
    target: calendarMonthNavigation, touches: [{ clientX: 90, clientY: 100 }],
});
delegatedListeners.get('touchend')({ changedTouches: [{ clientX: 180, clientY: 105 }] });
await Promise.resolve();
assert.deepEqual(delegatedActions.at(-1), {
    button: { dataset: { action: 'calendar-prev-month' } }, app: calendarApp,
}, '向右水平滑动必须复用上个月 action');

const calendarCountryControl = {
    tagName: 'SELECT',
    dataset: { action: 'calendar-holiday-country' }, value: 'JP',
    closest(selector) {
        if (selector === '[data-action]') return this;
        if (selector === 'input[data-action],select[data-action]') return this;
        if (selector === '#pm-scene-app') return null;
        if (selector === '#pm-calendar-app') return calendarApp;
        return null;
    },
};
delegatedExtraNodes.add(calendarCountryControl);
const actionsBeforeCountrySelection = delegatedActions.length;
delegatedListeners.get('click')({ target: calendarCountryControl });
delegatedListeners.get('change')({ target: calendarCountryControl });
await Promise.resolve();
assert.equal(delegatedActions.length, actionsBeforeCountrySelection + 1,
    'select 的 click 与 change 组合只能由 change 委托分发一次');
assert.deepEqual(delegatedActions.at(-1), { button: calendarCountryControl, app: calendarApp },
    '日历国家选择变化必须进入统一异步错误边界');
assert.deepEqual(delegatedErrors, []);

const sceneAccentControl = {
    tagName: 'INPUT',
    dataset: { action: 'scene-accent-custom' }, value: '#123abc',
    closest(selector) {
        if (selector === '[data-action]') return this;
        if (selector === 'input[data-action],select[data-action]') return this;
        if (selector === '#pm-scene-app') return sceneApp;
        if (selector === '#pm-calendar-app') return null;
        return null;
    },
};
delegatedExtraNodes.add(sceneAccentControl);
const actionsBeforeAccentSelection = delegatedActions.length;
delegatedListeners.get('click')({ target: sceneAccentControl });
delegatedListeners.get('change')({ target: sceneAccentControl });
await Promise.resolve();
assert.equal(delegatedActions.length, actionsBeforeAccentSelection + 1,
    'input 的 click 与 change 组合只能由 change 委托分发一次');
assert.deepEqual(delegatedActions.at(-1), { button: sceneAccentControl, app: sceneApp },
    '社区自定义主题色变化必须进入统一异步错误边界');
assert.deepEqual(delegatedErrors, []);

firstReplyComposer.hidden = true;
secondReplyComposer.hidden = true;
firstReplyExpanded = 'false';
secondReplyExpanded = 'false';
secondReplyTrigger.closest = selector => {
    if (selector === '.pm-scene-post-actions-wrap' || selector === '.pm-scene-menu-wrap') return null;
    if (selector === '#pm-scene-app') return replySceneApp;
    if (selector === '#pm-calendar-app' || selector === '.pm-desktop-page') return null;
    return null;
};
delegatedExtraNodes.add(secondReplyTrigger);
const actionsBeforeReplyToggle = delegatedActions.length;
delegatedListeners.get('click')({
    target: { closest: selector => selector === '[data-action]' ? secondReplyTrigger : null },
});
await Promise.resolve();
assert.equal(delegatedActions.length, actionsBeforeReplyToggle + 1, '回复按钮点击只能分发一次生产动作');
assert.deepEqual(delegatedActions.at(-1), { button: secondReplyTrigger, app: replySceneApp });
assert.equal(secondReplyComposer.hidden, false, '事件委托必须展开当前帖子的回复区');
assert.equal(secondReplyExpanded, 'true');

let menuFocused = false;
let menuExpanded = 'true';
const menuTrigger = {
    setAttribute(name, value) { assert.equal(name, 'aria-expanded'); menuExpanded = value; },
    focus(options) { assert.deepEqual(options, { preventScroll: true }); menuFocused = true; },
};
const menuWrap = {
    querySelector(selector) { assert.equal(selector, '[data-action="more"]'); return menuTrigger; },
};
const sceneMenu = {
    hidden: false,
    closest(selector) { assert.equal(selector, '.pm-scene-menu-wrap'); return menuWrap; },
};
openSceneMenus = [sceneMenu];
delegatedListeners.get('click')({ target: { closest: () => null } });
assert.equal(sceneMenu.hidden, true, '点击更多菜单外部必须关闭菜单');
assert.equal(menuExpanded, 'false');

sceneMenu.hidden = false;
menuExpanded = 'true';
let escapePrevented = false;
delegatedListeners.get('keydown')({
    key: 'Escape',
    preventDefault() { escapePrevented = true; },
});
assert.equal(sceneMenu.hidden, true, 'Escape 必须关闭更多菜单');
assert.equal(menuExpanded, 'false');
assert.equal(escapePrevented, true);
assert.equal(menuFocused, true, 'Escape 关闭菜单后必须把焦点还给更多按钮');

let postActionsFocused = false;
let postActionsExpanded = 'true';
const postActionsTrigger = {
    setAttribute(name, value) { assert.equal(name, 'aria-expanded'); postActionsExpanded = value; },
    focus(options) { assert.deepEqual(options, { preventScroll: true }); postActionsFocused = true; },
};
const postCommentActions = { hidden: false };
const postArticle = {
    querySelectorAll(selector) { assert.equal(selector, '.pm-scene-comment-actions'); return [postCommentActions]; },
};
const postActionsWrap = {
    querySelector(selector) { assert.equal(selector, '[data-action="post-actions"]'); return postActionsTrigger; },
    closest(selector) { assert.equal(selector, '.pm-scene-post'); return postArticle; },
};
const postActions = {
    hidden: false,
    closest(selector) { assert.equal(selector, '.pm-scene-post-actions-wrap'); return postActionsWrap; },
};
openPostActions = [postActions];
delegatedListeners.get('click')({ target: { closest: () => null } });
assert.equal(postActions.hidden, true, '点击帖子操作外部必须收起横向操作');
assert.equal(postCommentActions.hidden, true, '点击帖子操作外部必须同时隐藏评论编辑删除按钮');
assert.equal(postActionsExpanded, 'false');

let firstPostExpanded = 'true';
const firstPostTrigger = {
    setAttribute(name, value) { assert.equal(name, 'aria-expanded'); firstPostExpanded = value; },
};
const firstCommentActions = { hidden: false };
const firstPostArticle = {
    querySelectorAll(selector) { assert.equal(selector, '.pm-scene-comment-actions'); return [firstCommentActions]; },
};
const firstPostWrap = {
    querySelector(selector) { assert.equal(selector, '[data-action="post-actions"]'); return firstPostTrigger; },
    closest(selector) { assert.equal(selector, '.pm-scene-post'); return firstPostArticle; },
};
const firstPostActions = {
    hidden: false,
    closest(selector) { assert.equal(selector, '.pm-scene-post-actions-wrap'); return firstPostWrap; },
};
let secondPostExpanded = 'false';
let secondPostActionFocused = false;
const secondPostFirstAction = {
    focus(options) { assert.deepEqual(options, { preventScroll: true }); secondPostActionFocused = true; },
};
const secondCommentActions = { hidden: true };
const secondPostArticle = {
    querySelectorAll(selector) { assert.equal(selector, '.pm-scene-comment-actions'); return [secondCommentActions]; },
};
const secondPostActions = {
    hidden: true,
    querySelector(selector) { assert.equal(selector, 'button'); return secondPostFirstAction; },
    closest(selector) { assert.equal(selector, '.pm-scene-post-actions-wrap'); return secondPostWrap; },
};
const secondPostWrap = {
    querySelector(selector) {
        if (selector === '.pm-scene-post-actions') return secondPostActions;
        if (selector === '[data-action="post-actions"]') return secondPostTrigger;
        assert.fail(`第二个帖子不应查询未知选择器：${selector}`);
    },
    closest(selector) { assert.equal(selector, '.pm-scene-post'); return secondPostArticle; },
};
const secondPostTrigger = {
    dataset: { action: 'post-actions' },
    parentElement: secondPostWrap,
    setAttribute(name, value) { assert.equal(name, 'aria-expanded'); secondPostExpanded = value; },
    closest(selector) {
        if (selector === '.pm-scene-post-actions-wrap') return secondPostWrap;
        if (selector === '#pm-scene-app') return sceneApp;
        if (selector === '#pm-calendar-app' || selector === '.pm-desktop-page') return null;
        return null;
    },
};
delegatedExtraNodes.add(secondPostTrigger);
openPostActions = [firstPostActions, secondPostActions];
const delegatedActionCountBeforePostSwitch = delegatedActions.length;
delegatedListeners.get('click')({ target: { closest: selector => selector === '[data-action]' ? secondPostTrigger : null } });
await Promise.resolve();
assert.equal(firstPostActions.hidden, true, '切换到另一个帖子时必须关闭前一个横向操作');
assert.equal(firstCommentActions.hidden, true, '切换帖子时必须隐藏前一个帖子的评论操作');
assert.equal(firstPostExpanded, 'false', '关闭前一个帖子操作时必须同步 aria-expanded');
assert.equal(secondPostActions.hidden, false, '点击第二个帖子省略号必须展开其横向操作');
assert.equal(secondCommentActions.hidden, false, '点击帖子省略号必须显示所属帖子的评论编辑删除按钮');
assert.equal(secondPostExpanded, 'true', '展开第二个帖子操作时必须同步 aria-expanded');
assert.equal(secondPostActionFocused, true, '展开第二个帖子操作后必须聚焦第一个操作按钮');
assert.equal(delegatedActions.length, delegatedActionCountBeforePostSwitch + 1, '帖子切换只能分发一次生产动作');

openPostActions = [postActions];
sceneMenu.hidden = false;
menuExpanded = 'true';
postActions.hidden = false;
postCommentActions.hidden = false;
postActionsExpanded = 'true';
escapePrevented = false;
delegatedListeners.get('keydown')({ key: 'Escape', preventDefault() { escapePrevented = true; } });
assert.equal(postActions.hidden, true, 'Escape 必须关闭帖子横向操作');
assert.equal(postCommentActions.hidden, true, 'Escape 必须同时隐藏评论编辑删除按钮');
assert.equal(sceneMenu.hidden, true, 'Escape 必须同时关闭社区工具菜单');
assert.equal(postActionsExpanded, 'false');
assert.equal(menuExpanded, 'false');
assert.equal(escapePrevented, true);
assert.equal(postActionsFocused, true, 'Escape 关闭帖子操作后必须把焦点还给省略号按钮');

let danmakuActionsExpanded = 'false';
let danmakuActionFocused = false;
const danmakuEditAction = { hidden: true };
const danmakuDeleteAction = { hidden: true };
const danmakuList = {
    querySelectorAll(selector) { assert.equal(selector, '.pm-scene-comment-actions'); return [danmakuEditAction, danmakuDeleteAction]; },
    querySelector(selector) { assert.equal(selector, '.pm-scene-comment-actions button'); return { focus(options) { assert.deepEqual(options, { preventScroll: true }); danmakuActionFocused = true; } }; },
};
let danmakuMenuLabel = '';
const danmakuMenuAction = {
    setAttribute(name, value) {
        if (name === 'aria-pressed') danmakuActionsExpanded = value;
        else assert.equal(name, 'aria-label');
    },
    querySelector(selector) {
        assert.equal(selector, 'span');
        return { replaceChildren(value) { danmakuMenuLabel = value; } };
    },
};
const danmakuApp = {
    querySelector(selector) { assert.equal(selector, '.pm-danmaku-list'); return danmakuList; },
};
assert.equal(toggleDanmakuActions(danmakuMenuAction, danmakuApp), true);
assert.deepEqual([danmakuEditAction.hidden, danmakuDeleteAction.hidden], [false, false], '修改弹幕必须显示全部弹幕操作');
assert.equal(danmakuActionsExpanded, 'true');
assert.equal(danmakuMenuLabel, '停止修改', '展开弹幕操作后菜单文案必须切换为停止修改');
assert.equal(danmakuActionFocused, true, '展开弹幕操作后必须聚焦第一个操作按钮');
assert.equal(toggleDanmakuActions(danmakuMenuAction, danmakuApp), false);
assert.deepEqual([danmakuEditAction.hidden, danmakuDeleteAction.hidden], [true, true], '再次点击修改弹幕必须隐藏全部弹幕操作');
assert.equal(danmakuMenuLabel, '修改弹幕', '收起弹幕操作后菜单文案必须恢复');

const groupStore = normalizeGroupMetaStore({
    story: {
        valid: { name: '群', members: ['A', 'B'] },
        invalid: { name: '坏群', members: ['A'] },
    },
});
assert.ok(groupStore.story.valid);
assert.equal(groupStore.story.invalid, undefined);

const createEditedGroupRuntimeFixture = () => ({
    activeStorageId: 'story-before',
    currentPersona: 'legacy-group',
    conversationHistory: [{ role: 'assistant', content: '原历史' }],
    isGroupChat: true,
    currentGroupKey: 'legacy-group',
    groupMembers: ['Alice', 'Bob'],
    groupExtras: ['旁白'],
    groupDisplayName: '旧群名',
    groupRandomNpcEnabled: false,
    groupNature: '旧群性质',
    groupColorMap: { Alice: '#112233', Bob: '#445566' },
});
const snapshotEditedGroupRuntime = state => ({
    activeStorageId: state.activeStorageId,
    currentPersona: state.currentPersona,
    conversationHistory: structuredClone(state.conversationHistory),
    isGroupChat: state.isGroupChat,
    currentGroupKey: state.currentGroupKey,
    groupMembers: state.groupMembers.slice(),
    groupExtras: state.groupExtras.slice(),
    groupDisplayName: state.groupDisplayName,
    groupRandomNpcEnabled: state.groupRandomNpcEnabled,
    groupNature: state.groupNature,
    groupColorMap: { ...state.groupColorMap },
});
const editedGroupMeta = normalizeGroupMeta({
    name: '新群名',
    members: ['Alice', 'Carol'],
    extras: ['记录员'],
    memberColors: { Alice: '#abcdef' },
    randomNpcEnabled: true,
    groupNature: '气氛友好的同学群',
});

const successfulEditedGroupState = createEditedGroupRuntimeFixture();
const successfulEditedGroupCalls = [];
assert.equal(await refreshEditedGroupRuntime({
    state: successfulEditedGroupState,
    updated: editedGroupMeta,
    applyInjection: async () => { successfulEditedGroupCalls.push('inject'); },
    switchConversation: async () => { successfulEditedGroupCalls.push('switch'); },
}), true);
assert.deepEqual(successfulEditedGroupCalls, ['inject', 'switch'], '群编辑运行态必须先刷新注入再切换会话');
assert.deepEqual(successfulEditedGroupState.groupMembers, ['Alice', 'Carol']);
assert.deepEqual(successfulEditedGroupState.groupExtras, ['记录员']);
assert.equal(successfulEditedGroupState.groupDisplayName, '新群名');
assert.equal(successfulEditedGroupState.groupRandomNpcEnabled, true);
assert.equal(successfulEditedGroupState.groupNature, '气氛友好的同学群');
assert.deepEqual(successfulEditedGroupState.groupColorMap, {
    Alice: '#abcdef',
    Carol: '#b8e6c8',
}, '显式颜色应保留，默认颜色必须写入 CSS 色值字符串');

const injectionFailureState = createEditedGroupRuntimeFixture();
const injectionFailureSnapshot = snapshotEditedGroupRuntime(injectionFailureState);
let switchAfterInjectionFailure = false;
await assert.rejects(() => refreshEditedGroupRuntime({
    state: injectionFailureState,
    updated: editedGroupMeta,
    applyInjection: async () => {
        injectionFailureState.activeStorageId = 'story-mutated';
        injectionFailureState.conversationHistory = [{ role: 'user', content: '注入阶段污染' }];
        throw new Error('injection-failed');
    },
    switchConversation: async () => { switchAfterInjectionFailure = true; },
}), /injection-failed/);
assert.equal(switchAfterInjectionFailure, false, '注入失败后不得继续切换会话');
assert.deepEqual(snapshotEditedGroupRuntime(injectionFailureState), injectionFailureSnapshot,
    '注入失败必须恢复完整群聊运行态');

const switchFailureState = createEditedGroupRuntimeFixture();
const switchFailureSnapshot = snapshotEditedGroupRuntime(switchFailureState);
const legacyHistoryBeforeSwitch = structuredClone(switchFailureState.conversationHistory);
await assert.rejects(() => refreshEditedGroupRuntime({
    state: switchFailureState,
    updated: editedGroupMeta,
    applyInjection: async () => {},
    switchConversation: async () => {
        switchFailureState.activeStorageId = 'story-switched';
        switchFailureState.currentPersona = 'new-group';
        normalizeMessageHistory(switchFailureState.conversationHistory, {
            isGroup: true,
            groupMembers: ['Alice', 'Carol'],
            legacySeed: 'story-before:legacy-group',
        });
        switchFailureState.isGroupChat = false;
        switchFailureState.currentGroupKey = '';
        throw new Error('switch-failed');
    },
}), /switch-failed/);
assert.deepEqual(snapshotEditedGroupRuntime(switchFailureState), switchFailureSnapshot,
    '会话切换失败必须恢复完整群聊运行态');
assert.deepEqual(switchFailureState.conversationHistory, legacyHistoryBeforeSwitch,
    '真实历史归一化的原地修改不得污染事务快照');

const transactionalState = createEditedGroupRuntimeFixture();
const transactionalSnapshot = snapshotEditedGroupRuntime(transactionalState);
let storedGroupConfig = { name: '旧群名', members: ['Alice', 'Bob'] };
let memoryGroupConfig = { name: '新群名', members: ['Alice', 'Carol'] };
const transactionEvents = [];
await assert.rejects(() => commitEditedGroupUpdate({
    state: transactionalState,
    updated: editedGroupMeta,
    persistUpdated: async () => {
        transactionEvents.push('persist-new');
        storedGroupConfig = structuredClone(memoryGroupConfig);
    },
    restoreConfig: () => {
        transactionEvents.push('restore-old');
        memoryGroupConfig = { name: '旧群名', members: ['Alice', 'Bob'] };
    },
    persistRestored: async () => {
        transactionEvents.push('persist-old');
        storedGroupConfig = structuredClone(memoryGroupConfig);
    },
    applyInjection: async () => {
        transactionEvents.push(`inject:${memoryGroupConfig.members.join('/')}`);
        return { written: 1, failedWrites: 0, failedKeys: [] };
    },
    switchConversation: async () => {
        transactionEvents.push('switch');
        normalizeMessageHistory(transactionalState.conversationHistory, {
            isGroup: true,
            groupMembers: editedGroupMeta.members,
            legacySeed: 'story-before:legacy-group',
        });
        throw new Error('switch-transaction-failed');
    },
}), /switch-transaction-failed/);
assert.deepEqual(transactionEvents, [
    'persist-new', 'inject:Alice/Carol', 'switch', 'restore-old', 'persist-old', 'inject:Alice/Bob',
], '切换失败后必须按顺序恢复配置、持久化旧值并重放旧注入');
assert.deepEqual(memoryGroupConfig, { name: '旧群名', members: ['Alice', 'Bob'] });
assert.deepEqual(storedGroupConfig, memoryGroupConfig, '失败后内存配置与持久化配置必须一致');
assert.deepEqual(snapshotEditedGroupRuntime(transactionalState), transactionalSnapshot,
    '完整事务失败后运行态必须恢复到编辑前快照');

await assert.rejects(() => commitEditedGroupUpdate({
    state: createEditedGroupRuntimeFixture(),
    updated: editedGroupMeta,
    persistUpdated: async () => {}, restoreConfig: () => {}, persistRestored: async () => {},
    applyInjection: async () => ({ written: 0, failedWrites: 1, failedKeys: [] }),
    switchConversation: async () => { throw new Error('不应执行切换'); },
}), /群聊设置提交注入失败：1 项写入失败/,
'注入返回部分失败时必须进入事务补偿，而不是误判为成功');

const successfulInjectionEvents = [];
assert.equal(await commitConversationInjectionUpdate({
    persistCandidate: async () => { successfulInjectionEvents.push('persist-new'); },
    restoreSnapshot: () => { successfulInjectionEvents.push('restore-old'); },
    persistSnapshot: async () => { successfulInjectionEvents.push('persist-old'); },
    applyInjection: async () => {
        successfulInjectionEvents.push('inject-new');
        return { written: 1, failedWrites: 0, failedKeys: [] };
    },
}), true);
assert.deepEqual(successfulInjectionEvents, ['persist-new', 'inject-new'],
    '上下文注入保存成功时不得执行补偿路径');

const failedInjectionEvents = [];
let injectionConfigState = 'new';
await assert.rejects(() => commitConversationInjectionUpdate({
    persistCandidate: async () => { failedInjectionEvents.push('persist-new'); },
    restoreSnapshot: () => { injectionConfigState = 'old'; failedInjectionEvents.push('restore-old'); },
    persistSnapshot: async () => { failedInjectionEvents.push('persist-old'); },
    applyInjection: async () => {
        failedInjectionEvents.push(`inject-${injectionConfigState}`);
        return injectionConfigState === 'new'
            ? { written: 0, failedWrites: 1, failedKeys: [] }
            : { written: 1, failedWrites: 0, failedKeys: [] };
    },
}), /上下文注入设置应用失败：1 项写入失败/);
assert.deepEqual(failedInjectionEvents, [
    'persist-new', 'inject-new', 'restore-old', 'persist-old', 'inject-old',
], '上下文注入刷新失败必须恢复、持久化并重放旧配置');

await assert.rejects(() => commitConversationInjectionUpdate({
    persistCandidate: async () => {},
    restoreSnapshot: () => {},
    persistSnapshot: async () => { throw new Error('rollback-storage-failed'); },
    applyInjection: async () => ({ written: 0, failedWrites: 2, failedKeys: [] }),
}), error => error?.rollbackError?.message === 'rollback-storage-failed'
    && /原配置回滚也失败，请勿刷新并立即导出备份/.test(error.message),
'上下文注入补偿失败必须暴露 rollbackError 和事故处置提示');

const previousExplicitInjectionWindow = globalThis.window;
const previousExplicitInjectionStorage = globalThis.localStorage;
const previousExplicitInjectionDocument = globalThis.document;
try {
    const persistedBidirectional = [];
    const injectionResolvers = [];
    const clearedInjectionResults = [];
    const injectionOverlays = [];
    let injectionCall = 0;
    globalThis.localStorage = {
        setItem(key, value) {
            if (key === 'ST_SMS_BIDIRECTIONAL') persistedBidirectional.push(JSON.parse(value));
        },
    };
    globalThis.window = {
        __pmBidirectional: { story: [] },
        __pmHistories: { story: { Alice: [], Bob: [] } },
        __pmGroupMeta: { story: {} },
        __pmInjectionConfig: {},
        addEventListener() {},
    };
    globalThis.document = {
        visibilityState: 'visible',
        addEventListener() {},
        getElementById() { return null; },
    };
    installPhoneContextInjection({
        activeStorageId: 'story', currentPersona: 'Alice', isGroupChat: false, currentGroupKey: '',
    }, {
        getStorageId: () => 'story', makeOverlay: html => { injectionOverlays.push(html); },
        applyBidirectionalInjection: () => {
            injectionCall += 1;
            if (injectionCall === 1) {
                return new Promise(resolve => { injectionResolvers.push(resolve); });
            }
            if (injectionCall === 2) return Promise.resolve({ written: 1, failedWrites: 0, failedKeys: [] });
            return Promise.resolve({ written: 1, failedWrites: 0, failedKeys: [] });
        },
        clearBidirectionalInjection: () => {
            clearedInjectionResults.push(structuredClone(window.__pmInjectionConfig));
            return { written: 0, failedWrites: 0, failedKeys: [] };
        },
    });
    const failedAliceToggle = window.__pmToggleConversationInjection('story', 'Alice', false);
    const queuedBobToggle = window.__pmToggleConversationInjection('story', 'Bob', false);
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(injectionCall, 1, '不同会话的注入切换必须串行，避免全量快照互相覆盖');
    injectionResolvers[0]({ written: 0, failedWrites: 1, failedKeys: [] });
    const [aliceResult, bobResult] = await Promise.allSettled([failedAliceToggle, queuedBobToggle]);
    assert.equal(aliceResult.status, 'rejected');
    assert.equal(bobResult.status, 'fulfilled');
    assert.equal(bobResult.value, true);
    assert.deepEqual(window.__pmBidirectional.story, ['Bob'],
        '前一项失败补偿不得撤销后续成功的显式目标切换');
    assert.deepEqual(persistedBidirectional.at(-1).story, ['Bob']);
    assert.equal(await window.__pmToggleConversationInjection('story', 'Missing', false), false,
        '显式注入 API 必须拒绝不存在的联系人');
    assert.equal(await window.__pmToggleConversationInjection('story', 'Alice', true), false,
        '显式注入 API 必须拒绝伪造的群聊类型');
    const injectionConfigBeforeClear = structuredClone(window.__pmInjectionConfig);
    assert.equal(await window.__pmClearConversationInjection(), true);
    assert.deepEqual(clearedInjectionResults, [injectionConfigBeforeClear],
        '清除正文注入只能清理当前宿主提示词，不得改写已保存的注入规则');
    assert.deepEqual(window.__pmInjectionConfig, injectionConfigBeforeClear);
    assert.match(injectionOverlays.at(-1), /已清除当前正文注入；保存并应用可恢复。/,
        '清除成功后必须明确提示保存可恢复原注入规则');

    const delegatedCalls = [];
    window.__pmToggleConversationInjection = (...args) => {
        delegatedCalls.push(args);
        if (args[1] === 'Reject') return Promise.reject(new Error('delegated-rejection'));
        return Promise.resolve('delegated-result');
    };
    window.__pmGroupMeta.story.__group_team = { name: '测试群' };
    installPhoneFoundation({ phoneWindow: null, phoneActive: false, conversationHistory: [] }, {
        runtime: createRuntimeState(), getCtx: () => ({}), getStorageId: () => 'story',
        getUserPersona: () => ({ name: '用户' }),
    });
    const directResult = window.__pmToggleBidirectional(' Alice ');
    assert.equal(typeof directResult?.then, 'function', '旧注入入口必须返回受托 API 的 Promise');
    assert.equal(await directResult, 'delegated-result');
    assert.equal(await window.__pmToggleBidirectional('__group_team'), 'delegated-result');
    assert.deepEqual(delegatedCalls, [
        ['story', 'Alice', false], ['story', '__group_team', true],
    ], '旧注入入口必须按当前 storage、规范化 key 与群聊类型委托统一事务');
    await assert.rejects(() => window.__pmToggleBidirectional('Reject'), /delegated-rejection/,
        '旧注入入口不得吞掉统一事务的拒绝结果');
} finally {
    globalThis.window = previousExplicitInjectionWindow;
    globalThis.localStorage = previousExplicitInjectionStorage;
    globalThis.document = previousExplicitInjectionDocument;
}

const previousAutoPokeWindow = globalThis.window;
try {
    globalThis.window = {
        ...(previousAutoPokeWindow || {}),
        __pmPokeConfig: {
            story: {
                Alice: { behavior: { messageLength: 'short' }, autoPoke: { enabled: false, interval: 5, counter: 4 } },
                Legacy: { emojis: ['legacy-set'] },
                __group_team: { autoPoke: { enabled: true, interval: 8, counter: 2 } },
            },
        },
    };
    assert.deepEqual(normalizeAutoPoke({ enabled: true, interval: 120, counter: -2 }), {
        enabled: true, probability: 1, counter: 0,
    });
    assert.deepEqual(getAutoPokeConfig('story', 'Alice'), { enabled: false, probability: 20, counter: 0 });
    assert.deepEqual(getAutoPokeConfig('story', '__group_team'), { enabled: true, probability: 13, counter: 0 });

    let persistedSnapshot = null;
    assert.equal(commitAutoPokeConfig('story', 'Alice', { enabled: true, probability: 35 }, () => {
        persistedSnapshot = structuredClone(window.__pmPokeConfig);
        return true;
    }), true);
    assert.deepEqual(getAutoPokeConfig('story', 'Alice'), { enabled: true, probability: 35, counter: 0 },
        '启用自动消息时必须清理旧轮次遗留的抽签旗标');
    assert.equal(persistedSnapshot.story.Alice.behavior.messageLength, 'short',
        '共享事务不得覆盖同一会话的其他配置');

    const beforeFailedCommit = structuredClone(window.__pmPokeConfig);
    assert.equal(commitAutoPokeConfig('story', '__group_team', { probability: 50 }, () => false), false);
    assert.deepEqual(window.__pmPokeConfig, beforeFailedCommit,
        '群聊自动消息持久化失败时必须完整恢复原快照');

    const beforeThrownCommit = structuredClone(window.__pmPokeConfig);
    assert.equal(commitAutoPokeConfig('story', 'Alice', { probability: 75 }, () => {
        throw new Error('persist-threw');
    }), false);
    assert.deepEqual(window.__pmPokeConfig, beforeThrownCommit,
        '持久化同步抛错必须按普通保存失败处理并恢复私聊快照');
    assert.equal(commitAutoPokeConfig('new-story', 'First', { enabled: true }, () => {
        throw new Error('first-persist-threw');
    }), false);
    assert.equal(window.__pmPokeConfig['new-story'], undefined,
        '首次创建配置时持久化抛错不得留下空 storage 或 target');

    assert.equal(resetAutoPokeCounter('story', 'Legacy', () => true), true);
    assert.deepEqual(window.__pmPokeConfig.story.Legacy, {
        emojis: ['legacy-set'], autoPoke: { enabled: false, probability: 30, counter: 0 },
    }, '旧配置缺少 autoPoke 时，手动触发必须补全概率结构且保留其他字段');

    const beforeResetFailure = structuredClone(window.__pmPokeConfig.story.__group_team);
    assert.equal(resetAutoPokeCounter('story', '__group_team', () => false), false);
    assert.deepEqual(window.__pmPokeConfig.story.__group_team, beforeResetFailure,
        '群聊计数器重置持久化失败时必须恢复原值');
    assert.equal(resetAutoPokeCounter('story', '__group_team', () => {
        throw new Error('reset-persist-threw');
    }), false, '计数器重置遇到同步持久化异常必须返回失败而不是向外抛出');
    assert.deepEqual(window.__pmPokeConfig.story.__group_team, beforeResetFailure);

    let absentPersistCalls = 0;
    assert.equal(resetAutoPokeCounter('story', 'Absent', () => {
        absentPersistCalls += 1;
        return true;
    }), true);
    assert.equal(absentPersistCalls, 0, '没有旧配置的会话无需为手动触发创建空配置');

    assert.equal(commitAutoPokeConfig('story', 'NewContact', { enabled: true }, () => false), false);
    assert.equal(window.__pmPokeConfig.story.NewContact, undefined,
        '新会话首次保存失败时不得留下半成品配置');
} finally {
    if (previousAutoPokeWindow === undefined) delete globalThis.window;
    else globalThis.window = previousAutoPokeWindow;
}

const previousSessionWindow = globalThis.window;
const previousSessionDocument = globalThis.document;
const previousSessionAlert = globalThis.alert;
const previousSessionStorage = globalThis.localStorage;
try {
    const sessionElements = new Map();
    const sessionAlerts = [];
    let sessionOverlayHtml = '';
    let persistProbe = null;
    let storageShouldThrow = false;
    const makeFocusableControl = (value = '') => {
        const attributes = new Map();
        return {
            value, disabled: false, focusCalls: 0,
            setAttribute(name, next) { attributes.set(name, String(next)); },
            removeAttribute(name) { attributes.delete(name); },
            getAttribute(name) { return attributes.get(name) ?? null; },
            focus(options) { assert.deepEqual(options, { preventScroll: true }); this.focusCalls += 1; },
        };
    };
    const makeSessionOverlay = html => {
        sessionOverlayHtml = html;
        sessionElements.clear();
        const button = makeFocusableControl();
        const probabilityMatch = html.match(/id="pm-session-auto-poke-probability"[^>]*value="([^"]+)"/);
        const input = makeFocusableControl(probabilityMatch?.[1] || '30');
        sessionElements.set('pm-session-auto-poke', button);
        sessionElements.set('pm-session-auto-poke-probability', input);
        return {};
    };
    globalThis.document = {
        getElementById: id => sessionElements.get(id) || null,
        querySelector: () => null,
        querySelectorAll: () => [],
        addEventListener() {}, removeEventListener() {},
    };
    globalThis.alert = message => sessionAlerts.push(String(message));
    globalThis.localStorage = {
        setItem(key, value) {
            persistProbe?.(key, value);
            if (storageShouldThrow) throw new Error('session-storage-failed');
        },
    };
    globalThis.window = {
        __pmPokeConfig: { story: { Alice: { autoPoke: { enabled: false, probability: 30, counter: 1 } } } },
        __pmCurrentConversationInjectionEnabled: () => false,
    };
    installPhoneControlCenter({
        activeStorageId: 'story', currentPersona: 'Alice', isGroupChat: false,
        currentGroupKey: '', phoneWindow: null,
    }, {
        runtime: {}, getStorageId: () => 'story', makeOverlay: makeSessionOverlay,
        parsePendingInput: () => null, renderPendingConversation() {}, showPhoneCalendarPage() {},
        syncGenerationControls() {},
    });

    window.__pmShowAutoPokeSettings('<状态 & "引号">');
    assert.match(sessionOverlayHtml, /role="status" aria-live="polite"/);
    assert.match(sessionOverlayHtml, /&lt;状态 &amp; "引号"&gt;/,
        '自动消息状态反馈必须转义文本节点中的 HTML 控制字符');

    const successfulToggleButton = sessionElements.get('pm-session-auto-poke');
    persistProbe = () => {
        assert.equal(successfulToggleButton.disabled, true, '自动消息开关持久化期间必须禁用');
        assert.equal(successfulToggleButton.getAttribute('aria-busy'), 'true');
    };
    assert.equal(window.__pmToggleCurrentAutoPoke(successfulToggleButton), true);
    assert.match(sessionOverlayHtml, /已开启自动发消息。/);
    assert.equal(sessionElements.get('pm-session-auto-poke').focusCalls, 1,
        '保存成功后焦点必须落到重绘后的新开关');

    const failedToggleButton = sessionElements.get('pm-session-auto-poke');
    const failedToggleFocusBefore = failedToggleButton.focusCalls;
    storageShouldThrow = true;
    persistProbe = () => {
        assert.equal(failedToggleButton.disabled, true);
        assert.equal(failedToggleButton.getAttribute('aria-busy'), 'true');
    };
    assert.equal(window.__pmToggleCurrentAutoPoke(failedToggleButton), false);
    assert.equal(failedToggleButton.disabled, false);
    assert.equal(failedToggleButton.getAttribute('aria-busy'), null);
    assert.equal(failedToggleButton.focusCalls, failedToggleFocusBefore + 1,
        '开关保存异常后必须清理 busy 并恢复原控件焦点');
    assert.match(sessionAlerts.at(-1), /自动发消息设置保存失败/,
        '开关保存异常必须向用户提供可理解的错误反馈');
    assert.equal(getAutoPokeConfig('story', 'Alice').enabled, true,
        '开关保存异常必须恢复成功保存前的启用状态');
    assert.match(sessionOverlayHtml, /id="pm-session-auto-poke"[^>]*aria-checked="true"/,
        '保存异常后当前页面必须继续显示回滚后的真实开关状态');

    storageShouldThrow = false;
    window.__pmShowAutoPokeSettings();
    const successfulProbability = sessionElements.get('pm-session-auto-poke-probability');
    successfulProbability.value = '60';
    persistProbe = () => {
        assert.equal(successfulProbability.disabled, true, '概率持久化期间必须禁用输入框');
        assert.equal(successfulProbability.getAttribute('aria-busy'), 'true');
    };
    assert.equal(window.__pmSaveCurrentAutoPokeProbability(successfulProbability), true);
    assert.match(sessionOverlayHtml, /已保存：每次有 60% 几率自动发消息。/);
    assert.equal(sessionElements.get('pm-session-auto-poke-probability').focusCalls, 1);

    for (const invalidValue of ['', '-1', '101', '60.5', 'not-a-number']) {
        const invalidProbability = sessionElements.get('pm-session-auto-poke-probability');
        invalidProbability.value = invalidValue;
        const focusBefore = invalidProbability.focusCalls;
        const alertsBefore = sessionAlerts.length;
        persistProbe = () => { throw new Error('非法概率不得触发持久化'); };
        assert.equal(window.__pmSaveCurrentAutoPokeProbability(invalidProbability), false,
            `非法概率 ${JSON.stringify(invalidValue)} 必须被拒绝`);
        assert.equal(invalidProbability.value, '60', '非法概率必须恢复为当前已保存值');
        assert.equal(invalidProbability.disabled, false);
        assert.equal(invalidProbability.getAttribute('aria-busy'), null);
        assert.equal(invalidProbability.focusCalls, focusBefore + 1);
        assert.equal(sessionAlerts.length, alertsBefore + 1);
        assert.match(sessionAlerts.at(-1), /0 到 100 之间的整数概率/);
    }

    const failedProbability = sessionElements.get('pm-session-auto-poke-probability');
    failedProbability.value = '90';
    storageShouldThrow = true;
    persistProbe = () => {
        assert.equal(failedProbability.disabled, true);
        assert.equal(failedProbability.getAttribute('aria-busy'), 'true');
    };
    assert.equal(window.__pmSaveCurrentAutoPokeProbability(failedProbability), false);
    assert.match(sessionOverlayHtml, /自动发消息概率保存失败，已恢复原设置。/);
    assert.equal(sessionElements.get('pm-session-auto-poke-probability').focusCalls, 1,
        '概率保存异常后焦点必须落到重绘后的输入框');
    assert.match(sessionAlerts.at(-1), /自动发消息概率保存失败/,
        '概率保存异常必须向用户提供可理解的错误反馈');
    assert.equal(getAutoPokeConfig('story', 'Alice').probability, 60,
        '概率保存异常必须恢复上一次成功保存的值');
    assert.equal(sessionElements.get('pm-session-auto-poke-probability').value, '60',
        '失败重绘后的输入框必须显示回滚后的真实概率');
} finally {
    globalThis.window = previousSessionWindow;
    globalThis.document = previousSessionDocument;
    globalThis.alert = previousSessionAlert;
    globalThis.localStorage = previousSessionStorage;
}

const previousPokeWindow = globalThis.window;
const previousPokeDocument = globalThis.document;
const previousPokeStorage = globalThis.localStorage;
try {
    globalThis.document = { getElementById: () => null };
    globalThis.localStorage = { setItem() {} };
    const pokeState = {
        isGenerating: false, activeStorageId: 'story', currentPersona: 'Legacy', conversationHistory: [],
        isGroupChat: false, currentGroupKey: '', groupMembers: [], groupDisplayName: '',
        groupRandomNpcEnabled: false, groupNature: '', phoneActive: true,
    };
    let beginGenerationCalls = 0;
    globalThis.window = {
        __pmPokeConfig: { story: { Legacy: { emojis: ['old'] }, __group_team: { emojis: ['group-old'] } } },
        __pmGroupMeta: { story: { __group_team: { name: '测试群', members: ['Alice'] } } },
        __pmHistories: { story: { Legacy: [], __group_team: [] } },
        __pmCharacterBehavior: {}, __pmEmojis: [],
        __pmSwitchContact() { throw new Error('已在目标私聊，不应切换'); },
    };
    installPhoneChatPoke(pokeState, {
        getStorageId: () => 'story', gatherContext: async () => ({}), callAI: async () => '',
        applyBidirectionalInjection() {}, addBubble() {}, addNote() {}, rebaseRenderedHistory() {},
        showTyping() {}, hideTyping() {}, makeOverlay() {}, showGroupForm() {},
        beginGeneration() { beginGenerationCalls += 1; return null; },
        isGenerationTaskActive: () => false, finishGeneration() {}, isAutoPokeAllowed: () => false,
        armAutoPoke() {}, beginAutomaticTask: () => null, isAutomaticTaskActive: () => false,
        finishAutomaticTask() {},
    });
    await window.__pmPoke('Legacy');
    assert.equal(beginGenerationCalls, 1, '旧私聊配置缺少 autoPoke 时仍必须继续进入生成入口');
    assert.equal(window.__pmPokeConfig.story.Legacy.autoPoke.counter, 0);

    pokeState.isGroupChat = true;
    pokeState.currentPersona = '__group_team';
    pokeState.currentGroupKey = '__group_team';
    pokeState.groupMembers = ['Alice'];
    await window.__pmPokeGroup();
    assert.equal(beginGenerationCalls, 2, '旧群聊配置缺少 autoPoke 时仍必须继续进入生成入口');
    assert.equal(window.__pmPokeConfig.story.__group_team.autoPoke.counter, 0);
} finally {
    globalThis.window = previousPokeWindow;
    globalThis.document = previousPokeDocument;
    globalThis.localStorage = previousPokeStorage;
}

const previousAutoPokeIntegrationWindow = globalThis.window;
const previousAutoPokeIntegrationDocument = globalThis.document;
const previousAutoPokeIntegrationStorage = globalThis.localStorage;
const previousAutoPokeIntegrationHistories = localValues.get('ST_SMS_DATA_V2');
const previousAutoPokeIntegrationConfig = localValues.get('ST_SMS_POKE_CONFIG');
const previousAutoPokeIntegrationIdbHistories = idbValues.has('ST_SMS_DATA_V2') ? structuredClone(idbValues.get('ST_SMS_DATA_V2')) : undefined;
const previousAutoPokeIntegrationAbortAll = idbControl.abortAll;
try {
    globalThis.document = { getElementById: () => null };
    const autoPokeStorageValues = new Map();
    let failAutoPokeCounterPersist = false;
    globalThis.localStorage = {
        getItem: key => autoPokeStorageValues.get(key) ?? null,
        setItem(key, value) {
            if (key === 'ST_SMS_POKE_CONFIG' && failAutoPokeCounterPersist) {
                throw new Error('auto-poke-counter-persist-failed');
            }
            autoPokeStorageValues.set(key, String(value));
        },
        removeItem: key => autoPokeStorageValues.delete(key),
    };
    const createTaskController = () => {
        const tasks = new Set();
        return {
            begin() { const task = { signal: { aborted: false } }; tasks.add(task); return task; },
            isActive: task => tasks.has(task), finish: task => tasks.delete(task),
        };
    };
    const createAutoPokeFixture = ({ callAI, stateOverrides = {}, switchContact } = {}) => {
        const generation = createTaskController();
        const automatic = createTaskController();
        const state = {
            isGenerating: false, activeStorageId: 'story', currentPersona: 'Alice', conversationHistory: [],
            isGroupChat: false, currentGroupKey: '', groupMembers: [], groupDisplayName: '',
            groupRandomNpcEnabled: false, groupNature: '', phoneActive: false,
            ...stateOverrides,
        };
        globalThis.window = {
            __pmPokeConfig: { story: {
                Alice: { autoPoke: { enabled: true, probability: 100, counter: 1 } },
                Legacy: { autoPoke: { enabled: true, probability: 100, counter: 1 } },
                __group_team: { autoPoke: { enabled: true, probability: 100, counter: 1 } },
            } },
            __pmHistories: { story: {
                Alice: [{ role: 'user', content: 'Alice 的旧消息' }],
                Legacy: [{ role: 'user', content: 'Legacy 的旧消息' }],
                __group_team: [{ role: 'user', content: '群聊旧消息' }],
            } },
            __pmGroupMeta: { story: { __group_team: { name: '测试群', members: ['Alice'] } } },
            __pmCharacterBehavior: {}, __pmEmojis: [],
            __pmSwitchContact: switchContact || (() => {}),
        };
        installPhoneChatPoke(state, {
            getStorageId: () => 'story',
            gatherContext: async () => ({
                cardDesc: '', cardPersonality: '', cardScenario: '', cardMesExample: '',
                mainChatText: '', worldBookText: '', userName: '用户', userDesc: '',
            }),
            callAI: callAI || (async () => '自动回复'),
            applyBidirectionalInjection() {}, addBubble() {}, addNote() {}, rebaseRenderedHistory() {},
            showTyping() {}, hideTyping() {}, makeOverlay() {}, showGroupForm() {},
            beginGeneration: () => generation.begin(), isGenerationTaskActive: task => generation.isActive(task),
            finishGeneration: task => generation.finish(task), isAutoPokeAllowed: () => true, armAutoPoke() {},
            beginAutomaticTask: () => automatic.begin(), isAutomaticTaskActive: task => automatic.isActive(task),
            finishAutomaticTask: task => automatic.finish(task),
        });
        return state;
    };

    idbControl.abortAll = false;
    createAutoPokeFixture();
    const successfulPreviousHistory = window.__pmHistories.story.Alice;
    assert.equal(await window.__pmAutoPoke('Alice'), true,
        '真实安装后的自动戳一戳必须能提交历史和计数器');
    assert.notEqual(window.__pmHistories.story.Alice, successfulPreviousHistory,
        '自动戳一戳提交必须通过历史适配器替换目标仓库引用');
    assert.equal(window.__pmPokeConfig.story.Alice.autoPoke.counter, 0,
        '自动戳一戳提交后才可清除抽签计数器');

    const historyFailurePrevious = [{ role: 'user', content: '历史失败前的旧引用' }];
    window.__pmHistories.story.Alice = historyFailurePrevious;
    window.__pmPokeConfig.story.Alice.autoPoke.counter = 1;
    idbControl.abortAll = true;
    assert.equal(await window.__pmAutoPoke('Alice'), false,
        '严格历史保存失败时自动戳一戳必须报告失败');
    assert.equal(window.__pmHistories.story.Alice, historyFailurePrevious,
        '严格历史保存失败必须恢复同一旧历史引用');
    assert.equal(window.__pmPokeConfig.story.Alice.autoPoke.counter, 1,
        '严格历史保存失败不得提前修改自动戳一戳计数器');
    idbControl.abortAll = false;

    const counterFailurePrevious = [{ role: 'user', content: '计数失败前的旧引用' }];
    window.__pmHistories.story.Alice = counterFailurePrevious;
    window.__pmPokeConfig.story.Alice.autoPoke.counter = 1;
    const historyOperationsBeforeCounterFailure = idbOperations.length;
    failAutoPokeCounterPersist = true;
    assert.equal(await window.__pmAutoPoke('Alice'), false,
        '计数器保存失败时自动戳一戳必须报告失败');
    assert.equal(window.__pmHistories.story.Alice, counterFailurePrevious,
        '计数器保存失败必须经 restoreConversationHistory 恢复同一旧历史引用');
    assert.equal(window.__pmPokeConfig.story.Alice.autoPoke.counter, 1,
        '计数器保存失败必须恢复计数器，再恢复历史');
    const counterFailureHistoryWrites = idbOperations.slice(historyOperationsBeforeCounterFailure)
        .filter(operation => operation.type === 'put' && operation.key === 'ST_SMS_DATA_V2');
    assert.equal(counterFailureHistoryWrites.length, 2,
        '计数器保存失败必须先持久化新历史，再持久化恢复后的旧历史');
    assert.deepEqual(idbValues.get('ST_SMS_DATA_V2').story.Alice, counterFailurePrevious,
        '历史补偿持久化必须写回恢复后的旧历史内容');
    failAutoPokeCounterPersist = false;

    const inactiveSingleState = createAutoPokeFixture({
        callAI: async () => {
            inactiveSingleState.currentPersona = 'Legacy';
            inactiveSingleState.conversationHistory = window.__pmHistories.story.Legacy;
            return '后台私聊回复';
        },
        stateOverrides: { currentPersona: 'Alice', conversationHistory: window.__pmHistories?.story?.Alice || [] },
        switchContact: name => {
            inactiveSingleState.currentPersona = name;
            inactiveSingleState.isGroupChat = false;
            inactiveSingleState.conversationHistory = window.__pmHistories.story[name].slice();
        },
    });
    const inactiveSingleViewHistory = inactiveSingleState.conversationHistory;
    await window.__pmPoke('Alice');
    assert.equal(window.__pmHistories.story.Alice.at(-1).role, 'assistant',
        '目标失活后手动私聊仍必须提交到原目标历史仓库');
    assert.equal(inactiveSingleState.conversationHistory, window.__pmHistories.story.Legacy,
        '目标失活后手动私聊不得覆盖当前会话运行态历史');
    assert.notEqual(inactiveSingleState.conversationHistory, inactiveSingleViewHistory);

    const inactiveGroupState = createAutoPokeFixture({
        callAI: async () => {
            inactiveGroupState.currentGroupKey = '__group_other';
            inactiveGroupState.conversationHistory = window.__pmHistories.story.Legacy;
            return 'Alice：后台群聊回复';
        },
        stateOverrides: {
            currentPersona: '__group_team', conversationHistory: [], isGroupChat: true,
            currentGroupKey: '__group_team', groupMembers: ['Alice'], groupDisplayName: '测试群',
        },
    });
    await window.__pmPokeGroup();
    assert.equal(window.__pmHistories.story.__group_team.at(-1).role, 'assistant',
        '目标失活后手动群聊仍必须提交到原目标历史仓库');
    assert.equal(inactiveGroupState.conversationHistory, window.__pmHistories.story.Legacy,
        '目标失活后手动群聊不得覆盖当前会话运行态历史');
} finally {
    idbControl.abortAll = previousAutoPokeIntegrationAbortAll;
    if (previousAutoPokeIntegrationHistories === undefined) localValues.delete('ST_SMS_DATA_V2');
    else localValues.set('ST_SMS_DATA_V2', previousAutoPokeIntegrationHistories);
    if (previousAutoPokeIntegrationConfig === undefined) localValues.delete('ST_SMS_POKE_CONFIG');
    else localValues.set('ST_SMS_POKE_CONFIG', previousAutoPokeIntegrationConfig);
    if (previousAutoPokeIntegrationIdbHistories === undefined) idbValues.delete('ST_SMS_DATA_V2');
    else idbValues.set('ST_SMS_DATA_V2', previousAutoPokeIntegrationIdbHistories);
    globalThis.window = previousAutoPokeIntegrationWindow;
    globalThis.document = previousAutoPokeIntegrationDocument;
    globalThis.localStorage = previousAutoPokeIntegrationStorage;
}

const previousBranchWindow = globalThis.window;
try {
    globalThis.window = { ...(previousBranchWindow || {}) };
    const branchContext = {
        chatId: 'branch-chat', characterId: 0, characters: [{ avatar: 'alice.png' }],
        chatMetadata: { main_chat: 'parent-chat' },
    };
    const todayTrendBranchStore = () => ({
        version: 1,
        presets: {
            preset: {
                id: 'preset', name: '分支世界', version: 1, revision: 1, createdAt: 1, updatedAt: 1,
                source: { worldBookNames: ['分支世界书'], includeExistingChat: true, userRequirements: '' },
                moduleRules: { world: '世界规则', reputation: '风评规则', faction: '势力规则', dynamics: '动态规则' },
                moduleSchemas: { worldItems: '态势项目', reputationCircles: '风评圈层', factionGuidance: '势力资料' },
                dynamicsRules: { general: '动态总规则', incident: '突发规则', rumor: '流言规则', underground: '地下规则' },
            },
        },
        scopes: {
            [branchIds.source]: {
                storageId: branchIds.source, characterId: 'alice', characterName: 'Alice', presetId: 'preset',
                operation: { enabled: true, mode: 'auto', intervalFloors: 2, lastSuccessfulAssistantCount: 7, lastSuccessfulRunAt: 8 },
                injection: { enabled: false }, world: { items: [] }, reputation: { circles: [] }, factions: [], dynamics: { active: [], archived: [] },
            },
        },
    });

    const branchIds = {
        source: getStorageIdFor('alice.png', 'parent-chat'),
        target: getStorageIdFor('alice.png', 'branch-chat'),
    };
    assert.deepEqual(resolveBranchInheritance(branchContext), {
        avatar: 'alice.png', parentChatId: 'parent-chat', targetChatId: 'branch-chat',
        sourceId: branchIds.source, targetId: branchIds.target,
    }, '分支来源必须仅由当前 avatar 与 main_chat 构造');
    assert.equal(resolveBranchInheritance({ ...branchContext, chatMetadata: { main_chat: 'branch-chat' } }), null,
        'main_chat 指向当前聊天时不得触发继承');
    assert.equal(resolveBranchInheritance({ ...branchContext, chatMetadata: {} }), null,
        '缺少 main_chat 时不得猜测来源');
    assert.equal(resolveBranchInheritance({ ...branchContext, characters: [{}] }), null,
        '缺失真实 avatar 时不得使用不稳定索引作为跨聊天复制授权');

    const emptyBranchStores = () => ({
        histories: { [branchIds.source]: { Alice: [{ content: 'source' }] } },
        groupMeta: {}, pokeConfig: {}, characterBehavior: {}, bidirectional: {}, backgrounds: {},
        interactive: { version: 2, scopes: {} }, phoneUi: { version: 1, scopes: {} },
        calendar: { version: 1, scopes: {} }, occasions: { version: 1, scopes: {} },
        cycles: { version: 1, scopes: {} }, recipes: { version: 1, scopes: {} }, outfits: { version: 1, scopes: {} },
        budget: { communitySceneIdsByStorage: {}, communitySelectionsByStorage: {} },
    });
    const populatedBranchStores = () => ({
        histories: { [branchIds.source]: { Alice: [{ content: 'source' }] } },
        groupMeta: { [branchIds.source]: { __group_team: normalizeGroupMeta({ name: '团队', members: ['Alice', 'Bob'] }) } },
        pokeConfig: { [branchIds.source]: { Alice: { interval: 2 } } },
        characterBehavior: { [branchIds.source]: { Alice: { messageLength: 'short' } } },
        bidirectional: { [branchIds.source]: ['Alice'] },
        backgrounds: { [`${branchIds.source}_Alice`]: 'background' },
        interactive: { version: 2, scopes: { [branchIds.source]: { activeSceneId: null, sceneOrder: [], scenes: {}, actors: {} } } },
        phoneUi: { version: 1, scopes: { [branchIds.source]: { pinnedSceneIds: [], lastPage: 'community', lastSceneId: null, lastTab: 'feed' } } },
        calendar: { version: 1, scopes: { [branchIds.source]: { events: {} } } },
        occasions: { version: 1, scopes: { [branchIds.source]: { occasions: [] } } },
        cycles: { version: 1, scopes: { [branchIds.source]: { enabled: false, lastPeriodStart: null, cycleLength: 28, periodLength: 5, overrides: {} } } },
        recipes: { version: 1, scopes: { [branchIds.source]: { regionPreference: '', lastGeneratedRegion: '', lastGeneratedAt: 0, days: {} } } },
        outfits: { version: 1, scopes: { [branchIds.source]: { profiles: {} } } },
        budget: { communitySceneIdsByStorage: { [branchIds.source]: ['scene'] }, communitySelectionsByStorage: { [branchIds.source]: { selected: 'scene' } } },
    });
    let emptySourceSaveCalls = 0;
    let emptySourceLineage = {};
    const emptySourceResult = await inheritPhoneDataOnBranch({
        context: { ...branchContext, chatId: 'empty-source-branch' },
        loadStores: async () => ({
            histories: {}, groupMeta: {}, pokeConfig: {}, characterBehavior: {}, bidirectional: {}, backgrounds: {},
            interactive: { version: 2, scopes: {} }, phoneUi: { version: 1, scopes: {} },
            calendar: { version: 1, scopes: {} }, occasions: { version: 1, scopes: {} },
            cycles: { version: 1, scopes: {} }, recipes: { version: 1, scopes: {} }, outfits: { version: 1, scopes: {} },
            budget: { communitySceneIdsByStorage: {}, communitySelectionsByStorage: {} },
        }),
        saveStores: async () => { emptySourceSaveCalls += 1; },
        loadLineage: async () => structuredClone(emptySourceLineage),
        saveLineage: async value => { emptySourceLineage = structuredClone(value); },
    });
    assert.equal(emptySourceResult.reason, 'source-empty',
        '父 scope 不含任何受管数据时必须明确跳过继承');
    assert.equal(emptySourceSaveCalls, 0, '空来源不得触发任一 store 保存');
    assert.deepEqual(emptySourceLineage, {}, '空来源不得写入不可重试的 lineage marker');
    assert.deepEqual(emptySourceResult.sourcePresence.histories, { present: false, count: 0 },
        '空来源诊断必须逐 store 记录缺失状态');

    let emptyContainerSaveCalls = 0;
    let emptyContainerLineage = {};
    const emptyContainerStores = emptyBranchStores();
    emptyContainerStores.histories[branchIds.source] = {};
    emptyContainerStores.interactive.scopes[branchIds.source] = { actors: {}, scenes: {} };
    emptyContainerStores.budget.communitySceneIdsByStorage[branchIds.source] = [];
    const emptyContainerResult = await inheritPhoneDataOnBranch({
        context: { ...branchContext, chatId: 'empty-container-branch' },
        loadStores: async () => structuredClone(emptyContainerStores),
        saveStores: async () => { emptyContainerSaveCalls += 1; },
        loadLineage: async () => structuredClone(emptyContainerLineage),
        saveLineage: async value => { emptyContainerLineage = structuredClone(value); },
    });
    assert.equal(emptyContainerResult.reason, 'source-empty',
        '仅含空容器的来源不得伪装成可复制数据');
    assert.equal(emptyContainerSaveCalls, 0, '空容器来源不得保存任何 store');
    assert.deepEqual(emptyContainerLineage, {}, '空容器来源不得写 lineage marker');

    window.__pmDiagEnabled = true;
    const diagnosticRuntime = createRuntimeState();
    diagnosticRuntime.eventHooked = true;
    diagnosticRuntime.hostEventRegistrations.add('resolved:CHAT_CHANGED');
    diagnosticRuntime.lastBranchInheritance = emptySourceResult;
    assert.equal(installDiagnosticApi({ runtime: diagnosticRuntime, getCtx: () => branchContext,
        getStorageId: () => branchIds.target }), true, '显式打开诊断开关时必须挂载只读诊断面');
    const diagnosticSnapshot = window.__pmDiag.snapshot();
    assert.equal(Object.isFrozen(window.__pmDiag), true, '诊断 API 顶层对象必须冻结');
    assert.equal(Object.isFrozen(diagnosticSnapshot), true, '诊断快照必须冻结');
    assert.equal(diagnosticSnapshot.lastBranchInheritance.reason, 'source-empty',
        '诊断面必须暴露最后一次空来源跳过原因');
    assert.deepEqual(diagnosticSnapshot.lastBranchInheritance.sourcePresence.histories, { present: false, count: 0 },
        '诊断面只能暴露 store presence 元数据，不得泄露聊天正文');
    assert.equal(Object.hasOwn(diagnosticSnapshot.lastBranchInheritance, 'messages'), false,
        '诊断面不得暴露消息正文');
    diagnosticRuntime.lastBranchInheritanceError = { name: 'Error', message: '潜在聊天正文不得经诊断 API 暴露' };
    assert.equal(window.__pmDiag.snapshot().lastBranchInheritanceError?.message, '', '诊断 API 必须剥离原始错误文本');
    delete window.__pmDiagEnabled;
    delete window.__pmDiag;
    delete window.__pmRetryBranch;

    let retryStores = emptyBranchStores();
    const retryTargetId = getStorageIdFor('alice.png', 'retry-branch');
    const retryLineage = { [retryTargetId]: { sourceId: branchIds.source } };
    const retryResult = await inheritPhoneDataOnBranch({
        context: { ...branchContext, chatId: 'retry-branch' },
        loadStores: async () => structuredClone(retryStores),
        saveStores: async value => { retryStores = structuredClone(value); },
        loadLineage: async () => structuredClone(retryLineage),
        saveLineage: async value => { Object.assign(retryLineage, structuredClone(value)); },
        force: true,
    });
    assert.equal(retryResult.status, 'cloned', '受伪 marker 影响但目标为空的分支必须允许受控重试');
    assert.ok(Object.hasOwn(retryStores.histories, retryTargetId), '受控重试必须实际写入目标 scope');
    const occupiedRetryStores = emptyBranchStores();
    occupiedRetryStores.histories[retryTargetId] = {};
    let occupiedRetrySaveCalls = 0;
    let occupiedRetryLineageWrites = 0;
    const occupiedRetryResult = await inheritPhoneDataOnBranch({
        context: { ...branchContext, chatId: 'retry-branch' }, force: true,
        loadStores: async () => structuredClone(occupiedRetryStores),
        saveStores: async () => { occupiedRetrySaveCalls += 1; },
        loadLineage: async () => structuredClone(retryLineage),
        saveLineage: async () => { occupiedRetryLineageWrites += 1; },
    });
    assert.equal(occupiedRetryResult.reason, 'target-not-empty',
        'force 只能绕过伪 marker，绝不得覆盖已存在的空目标 scope');
    assert.equal(occupiedRetrySaveCalls, 0, 'force 遇到占用目标不得写入 store');
    assert.equal(occupiedRetryLineageWrites, 0, 'force 遇到占用目标不得重写 lineage');
    let persistedStores = emptyBranchStores();
    let persistedLineage = {};
    const cloneResult = await inheritPhoneDataOnBranch({
        context: branchContext,
        loadStores: async () => structuredClone(persistedStores),
        saveStores: async value => { persistedStores = structuredClone(value); },
        loadLineage: async () => structuredClone(persistedLineage),
        saveLineage: async value => { persistedLineage = structuredClone(value); },
        now: () => 123,
    });
    assert.equal(cloneResult.status, 'cloned');
    assert.deepEqual(persistedStores.histories[branchIds.target], { Alice: [{ content: 'source' }] });
    persistedStores.histories[branchIds.source].Alice[0].content = 'mutated-source';
    assert.equal(persistedStores.histories[branchIds.target].Alice[0].content, 'source',
        '继承必须为深拷贝，来源后续修改不得串入目标');
    assert.equal(persistedLineage[branchIds.target].sourceId, branchIds.source,
        '完成标记必须在克隆成功后写入');
    assert.equal((await inheritPhoneDataOnBranch({
        context: branchContext, loadStores: async () => persistedStores, saveStores: async () => {},
        loadLineage: async () => persistedLineage, saveLineage: async () => {},
    })).reason, 'already-cloned', '幂等重试不得覆盖已克隆目标');

    let richStores = populatedBranchStores();
    await inheritPhoneDataOnBranch({
        context: { ...branchContext, chatId: 'rich-branch' },
        loadStores: async () => structuredClone(richStores), saveStores: async value => { richStores = structuredClone(value); },
        loadLineage: async () => ({}), saveLineage: async () => {},
    });
    const richTargetId = getStorageIdFor('alice.png', 'rich-branch');
    for (const store of [richStores.groupMeta, richStores.pokeConfig, richStores.characterBehavior, richStores.bidirectional]) {
        assert.ok(Object.hasOwn(store, richTargetId), '全部按 scope 隔离的普通 store 都必须继承');
    }
    assert.equal(richStores.backgrounds[`${richTargetId}_Alice`], 'background');
    for (const store of [richStores.interactive, richStores.phoneUi, richStores.calendar, richStores.occasions, richStores.cycles, richStores.recipes]) {
        assert.ok(Object.hasOwn(store.scopes, richTargetId), '全部按 scope 隔离的模型 store 都必须继承');
    }
    const branchTemplate = {
        id: 'template_external_scene', sourceStorageId: 'external-story', sourceSceneId: 'scene-external',
        title: '外部模板', preset: 'weibo', styleInput: '', generatedPrompt: '', themeAccent: '#123abc', sharedAt: 1,
    };
    const branchPhoneInteractive = { version: 2, scopes: {
        [branchIds.source]: { activeSceneId: null, sceneOrder: [], scenes: {}, actors: {} },
        [richTargetId]: { activeSceneId: null, sceneOrder: [], scenes: {}, actors: {} },
    } };
    const branchPhoneCurrent = { version: 1, scopes: {
        [branchIds.source]: { pinnedSceneIds: [], dismissedCommunityTemplateIds: [branchTemplate.id], lastPage: 'desktop', lastSceneId: null, lastTab: 'feed' },
    }, sharedCommunityTemplates: [branchTemplate] };
    const branchPhoneDesired = { version: 1, scopes: {
        ...branchPhoneCurrent.scopes,
        [richTargetId]: structuredClone(branchPhoneCurrent.scopes[branchIds.source]),
    }, sharedCommunityTemplates: [branchTemplate] };
    const mergedBranchPhoneUi = mergePhoneUiBranchScope(branchPhoneCurrent, branchPhoneDesired, branchPhoneCurrent, richTargetId, branchPhoneInteractive);
    assert.deepEqual(mergedBranchPhoneUi.scopes[richTargetId].dismissedCommunityTemplateIds, [branchTemplate.id],
        '分支 scope 写入必须保留仍有效的跨窗口桌面移除状态');
    assert.deepEqual(mergedBranchPhoneUi.sharedCommunityTemplates, [branchTemplate],
        '分支 scope 写入不得丢失全局共享社区模板');
    const restoredBranchPhoneUi = mergePhoneUiBranchScope(mergedBranchPhoneUi, branchPhoneCurrent, branchPhoneDesired, richTargetId, branchPhoneInteractive);
    assert.equal(restoredBranchPhoneUi.scopes[richTargetId], undefined,
        '分支补偿必须只移除目标 phone UI scope');
    assert.deepEqual(restoredBranchPhoneUi.sharedCommunityTemplates, [branchTemplate],
        '分支补偿不得清空全局共享社区模板');
    let todayTrendStores = emptyBranchStores();
    todayTrendStores.todayTrend = todayTrendBranchStore();
    const todayTrendResult = await inheritPhoneDataOnBranch({
        context: { ...branchContext, chatId: 'today-trend-branch' },
        loadStores: async () => structuredClone(todayTrendStores),
        saveStores: async value => { todayTrendStores = structuredClone(value); },
        loadLineage: async () => ({}), saveLineage: async () => {},
    });
    const todayTrendTargetId = getStorageIdFor('alice.png', 'today-trend-branch');
    assert.equal(todayTrendResult.status, 'cloned', '今日风向 scope 必须参与分支继承');
    assert.equal(todayTrendStores.todayTrend.scopes[todayTrendTargetId].presetId, 'preset', '分支 scope 必须继续复用全局预设');
    assert.equal(todayTrendStores.todayTrend.scopes[todayTrendTargetId].operation.lastSuccessfulAssistantCount, 0,
        '分支 scope 必须重置今日风向楼层 checkpoint');
    assert.equal(todayTrendStores.todayTrend.scopes[todayTrendTargetId].operation.lastSuccessfulRunAt, 0,
        '分支 scope 必须重置今日风向成功时间');
    assert.deepEqual(Object.keys(todayTrendStores.todayTrend.presets), ['preset'],
        '世界预设必须保留为全局共享记录，而不是复制为新的预设 ID');


    assert.deepEqual(richStores.budget.communitySceneIdsByStorage[richTargetId], ['scene']);
    richStores.calendar.scopes[branchIds.source].events.changed = true;
    assert.equal(richStores.calendar.scopes[richTargetId].events.changed, undefined,
        '模型 scope 继承必须深拷贝，来源后续修改不得串入目标');

    let releasePendingClone;
    const pendingStores = emptyBranchStores();
    const pendingClone = inheritPhoneDataOnBranch({
        context: { ...branchContext, chatId: 'pending-branch' }, loadStores: async () => structuredClone(pendingStores),
        saveStores: () => new Promise(resolve => { releasePendingClone = () => { pendingStores.histories.pending = {}; resolve(); }; }),
        loadLineage: async () => ({}), saveLineage: async () => {},
    });
    const pendingTargetId = getStorageIdFor('alice.png', 'pending-branch');
    const pendingWait = awaitPendingBranchInheritance(pendingTargetId);
    let pendingSettled = false;
    pendingWait.finally(() => { pendingSettled = true; });
    for (let index = 0; index < 4 && !releasePendingClone; index += 1) await Promise.resolve();
    assert.equal(typeof releasePendingClone, 'function', '继承写入进入 pending 后才允许验证打开屏障');
    assert.equal(pendingSettled, false, '打开屏障必须等待当前目标尚未完成的继承事务');
    releasePendingClone(); await Promise.all([pendingClone, pendingWait]);

    const occupiedStores = emptyBranchStores();
    occupiedStores.bidirectional[branchIds.target] = { Alice: [] };
    assert.equal((await inheritPhoneDataOnBranch({
        context: branchContext, loadStores: async () => occupiedStores, saveStores: async () => { throw new Error('不得写入'); },
        loadLineage: async () => ({}), saveLineage: async () => { throw new Error('不得写入'); },
    })).reason, 'target-not-empty', '任何已存在的目标 scope 数据都必须拒绝覆盖');

    for (const configureTarget of [
        stores => { stores.histories[branchIds.target] = {}; },
        stores => { stores.groupMeta[branchIds.target] = {}; },
        stores => { stores.pokeConfig[branchIds.target] = {}; },
        stores => { stores.characterBehavior[branchIds.target] = {}; },
        stores => { stores.backgrounds[`${branchIds.target}_Alice`] = 'bg'; },
        stores => { stores.interactive.scopes[branchIds.target] = {}; },
        stores => { stores.phoneUi.scopes[branchIds.target] = {}; },
        stores => { stores.calendar.scopes[branchIds.target] = {}; },
        stores => { stores.occasions.scopes[branchIds.target] = {}; },
        stores => { stores.cycles.scopes[branchIds.target] = {}; },
        stores => { stores.recipes.scopes[branchIds.target] = {}; },
        stores => { stores.outfits.scopes[branchIds.target] = {}; },
        stores => { stores.budget.communitySceneIdsByStorage[branchIds.target] = []; },
        stores => { stores.budget.communitySelectionsByStorage[branchIds.target] = {}; },
    ]) {
        const occupied = emptyBranchStores();
        configureTarget(occupied);
        assert.equal((await inheritPhoneDataOnBranch({
            context: branchContext, loadStores: async () => occupied, saveStores: async () => { throw new Error('不得写入'); },
            loadLineage: async () => ({}), saveLineage: async () => { throw new Error('不得写入'); },
        })).reason, 'target-not-empty', '任一受管目标 scope 已存在时都不得覆盖');
    }
    const forceOccupied = emptyBranchStores();
    forceOccupied.histories[branchIds.target] = {};
    let forceOccupiedStoreWrites = 0;
    let forceOccupiedLineageWrites = 0;
    assert.equal((await inheritPhoneDataOnBranch({
        context: branchContext, force: true, loadStores: async () => forceOccupied,
        saveStores: async () => { forceOccupiedStoreWrites += 1; },
        loadLineage: async () => ({ [branchIds.target]: { sourceId: branchIds.source } }),
        saveLineage: async () => { forceOccupiedLineageWrites += 1; },
    })).reason, 'target-not-empty', 'force 不得覆盖任何已占用目标 scope');
    assert.equal(forceOccupiedStoreWrites, 0, 'force 遇到已占用目标不得写 store');
    assert.equal(forceOccupiedLineageWrites, 0, 'force 遇到已占用目标不得改写 lineage');

    let rollbackStores = emptyBranchStores();
    await assert.rejects(() => inheritPhoneDataOnBranch({
        context: branchContext,
        loadStores: async () => structuredClone(rollbackStores),
        saveStores: async value => { rollbackStores = structuredClone(value); },
        loadLineage: async () => ({}),
        saveLineage: async () => { throw new Error('lineage-write-failed'); },
    }), /lineage-write-failed/);
    assert.equal(Object.hasOwn(rollbackStores.histories, branchIds.target), false,
        '完成标记写入失败时必须回滚已写入目标 scope');

    idbControl.abortAll = true;
    assert.equal(await loadHistoriesFromIDB({ requireConfirmedPrimary: true }), false,
        '持久化来源无法确认时必须返回失败，分支事务不得据此写入 marker');
    idbControl.abortAll = false;

    await pmIDBDel(BRANCH_LINEAGE_STORE_KEY);
    const secondTargetId = getStorageIdFor('alice.png', 'second-branch');
    await Promise.all([
        commitBranchLineage(branchIds.target, { sourceId: branchIds.source, targetChatId: 'branch-chat' }),
        commitBranchLineage(secondTargetId, { sourceId: branchIds.source, targetChatId: 'second-branch' }),
    ]);
    const concurrentLineage = await loadBranchLineage();
    assert.equal(concurrentLineage[branchIds.target].targetChatId, 'branch-chat',
        '共享 lineage 提交不得丢失先完成的其他目标 marker');
    assert.equal(concurrentLineage[secondTargetId].targetChatId, 'second-branch',
        '共享 lineage 提交不得丢失后完成的其他目标 marker');

    await pmIDBDel(BRANCH_LINEAGE_STORE_KEY);
    const sameValueTargetId = getStorageIdFor('alice.png', 'same-value-branch');
    const sameValueMarker = { sourceId: branchIds.source, targetChatId: 'same-value-branch' };
    const sameValueBackup = await saveBranchLineageForBackup({ [sameValueTargetId]: sameValueMarker });
    await commitBranchLineage(sameValueTargetId, sameValueMarker);
    await rollbackBranchLineageBackup(sameValueBackup);
    const lineageAfterSameValueRollback = await loadBranchLineage();
    assert.deepEqual(lineageAfterSameValueRollback[sameValueTargetId], sameValueMarker,
        '同 target 同值的后续 lineage 提交必须通过修订号阻止备份回滚误删');

    const completedBackupTargetId = getStorageIdFor('alice.png', 'completed-backup-branch');
    const completedBackupMarker = { sourceId: branchIds.source, targetChatId: 'completed-backup-branch' };
    const completedBackup = await saveBranchLineageForBackup({ [completedBackupTargetId]: completedBackupMarker });
    await completeBranchLineageBackup(completedBackup);
    await rollbackBranchLineageBackup(completedBackup);
    assert.deepEqual((await loadBranchLineage())[completedBackupTargetId], completedBackupMarker,
        '成功完成的备份必须关闭回滚窗口并释放临时 lineage token');

    await pmIDBDel(BRANCH_LINEAGE_STORE_KEY);
    await saveBranchLineage({
        [branchIds.target]: { sourceId: branchIds.source, targetChatId: 'branch-chat' },
        [secondTargetId]: { sourceId: branchIds.source, targetChatId: 'second-branch' },
    });
    const backupOnlyTargetId = getStorageIdFor('alice.png', 'backup-only-branch');
    await saveBranchLineage({
        [backupOnlyTargetId]: { sourceId: branchIds.source, targetChatId: 'backup-only-branch' },
    });
    const lineageAfterBackupRestore = await loadBranchLineage();
    assert.equal(lineageAfterBackupRestore[branchIds.target].targetChatId, 'branch-chat',
        '备份恢复不得覆盖在其开始前或期间已提交的分支 marker');
    assert.equal(lineageAfterBackupRestore[backupOnlyTargetId].targetChatId, 'backup-only-branch',
        '备份恢复仍必须写入其独有的 lineage marker');

    let concurrentStores = emptyBranchStores();
    concurrentStores.histories.unrelated = { Alice: [{ content: 'initial' }] };
    await assert.rejects(() => inheritPhoneDataOnBranch({
        context: branchContext,
        loadStores: async () => structuredClone(concurrentStores),
        saveStores: async (value, { branch }) => {
            concurrentStores.histories.unrelated = { Alice: [{ content: 'concurrent' }] };
            concurrentStores = mergeBranchScope(concurrentStores, value, branch.targetId);
        },
        loadLineage: async () => ({}),
        saveLineage: async () => { throw new Error('lineage-write-failed'); },
    }), /lineage-write-failed/);
    assert.equal(concurrentStores.histories.unrelated.Alice[0].content, 'concurrent',
        '目标 scope 回滚不得覆盖事务期间写入的无关聊天数据');
    assert.equal(Object.hasOwn(concurrentStores.histories, branchIds.target), false,
        '并发保护下的补偿仍必须移除本事务目标 scope');

    idbValues.clear();
    localValues.clear();
    idbControl.abortAll = false;
    idbControl.abortOperations.length = 0;
    idbControl.blockOperations.length = 0;
    globalThis.localStorage = {
        getItem: key => localValues.has(key) ? localValues.get(key) : null,
        setItem(key, value) { localValues.set(key, String(value)); },
        removeItem: key => localValues.delete(key),
    };
    localStorageControl.failGet.clear();
    localStorageControl.failSet.clear();
    localStorageControl.failSetCounts.clear();
    localStorageControl.failSetOnCalls.clear();
    await pmIDBDel(BRANCH_LINEAGE_STORE_KEY);
    const productionTargetId = getStorageIdFor('alice.png', 'production-branch');
    const productionContext = { ...branchContext, chatId: 'production-branch' };
    const previousProductionBeforeUnloadRegistration = window.__pmBeforeUnloadRegistered;
    const previousProductionWindowAddEventListener = window.addEventListener;
    const previousProductionDocument = globalThis.document;
    globalThis.document = {
        visibilityState: 'visible',
        addEventListener() {},
        getElementById() { return null; },
        querySelector() { return null; },
        querySelectorAll() { return []; },
    };
    window.addEventListener = () => {};
    window.__pmBeforeUnloadRegistered = false;
    const productionListeners = new Map();
    const previousProductionEnd = window.__pmEnd;
    const productionCleanupCalls = [];
    const productionFoundationState = { phoneWindow: null, phoneActive: true, conversationHistory: [] };
    const productionEventContext = {
        ...productionContext,
        eventTypes: {
            GENERATION_STARTED: 'production_generation_started', CHAT_CHANGED: 'production_chat_changed',
            MESSAGE_RECEIVED: 'production_message_received', SETTINGS_UPDATED: 'production_settings_updated',
        },
        eventSource: {
            on(eventName, listener) {
                const listeners = productionListeners.get(eventName) || [];
                listeners.push(listener);
                productionListeners.set(eventName, listeners);
            },
        },
    };
    let currentProductionEventContext = productionEventContext;
    window.__pmEnd = force => {
        productionCleanupCalls.push(['end-phone', force]);
        productionFoundationState.phoneActive = false;
    };
    const productionFoundationDeps = {
        runtime: createRuntimeState(), getCtx: () => currentProductionEventContext,
        getStorageId: () => productionTargetId, getUserPersona: () => ({ name: '用户' }),
        cancelCommunityGeneration: reason => productionCleanupCalls.push(['community', reason]),
        cancelCalendarTasks: reason => productionCleanupCalls.push(['calendar', reason]),
    };
    installPhoneFoundation(productionFoundationState, productionFoundationDeps);
    productionFoundationDeps.hookGenerationEvent();
    assert.equal(productionListeners.get('production_chat_changed')?.length, 1,
        '生产继承回归必须通过真实 CHAT_CHANGED 监听器进入分支事务');
    idbValues.set('ST_SMS_DATA_V2', {
        [branchIds.source]: { Alice: [{ content: 'production-source' }] },
        unrelated: { Bob: [{ content: 'unrelated-history' }] },
    });
    await pmIDBSet('ST_INTERACTIVE_SCENES_V1', { version: 2, scopes: {} });
    assert.deepEqual(await pmIDBGet('ST_INTERACTIVE_SCENES_V1'), { version: 2, scopes: {} },
        '生产分支回归夹具必须先写入可读取的互动主存储');
    localValues.set('ST_INTERACTIVE_SCENES_V1_LOCAL_FALLBACK', JSON.stringify({ version: 2, scopes: {} }));
    assert.deepEqual(normalizeInteractiveStore(JSON.parse(localValues.get('ST_INTERACTIVE_SCENES_V1_LOCAL_FALLBACK'))),
        { version: 2, scopes: {} }, '生产分支回归夹具必须提供可规范化的互动后备存储');
    assert.equal(localStorage.getItem('ST_INTERACTIVE_SCENES_V1_LOCAL_FALLBACK'),
        localValues.get('ST_INTERACTIVE_SCENES_V1_LOCAL_FALLBACK'), '生产分支回归夹具不得遗留 localStorage 读取故障注入');
    assert.ok((await pmIDBKeys()).includes('ST_INTERACTIVE_SCENES_V1'),
        '生产分支回归夹具必须让共享 IndexedDB 枚举器看到互动主存储');
    localValues.set('ST_SMS_GROUP_META', JSON.stringify({ unrelated: {} }));
    localValues.set('ST_SMS_POKE_CONFIG', JSON.stringify({
        [branchIds.source]: { Alice: { interval: 2 } }, unrelated: { Bob: { interval: 3 } },
    }));
    localValues.set('ST_SMS_CHARACTER_BEHAVIOR', JSON.stringify({
        [branchIds.source]: { Alice: { messageLength: 'short' } },
    }));
    localValues.set('ST_SMS_BIDIRECTIONAL', JSON.stringify({ [branchIds.source]: ['Alice'] }));
    localValues.set('ST_SMS_BG_LOCAL', '{}');
    localValues.set('ST_SMS_BUDGET_CONFIG', JSON.stringify({
        communitySceneIdsByStorage: { [branchIds.source]: ['scene-source'] },
        communitySelectionsByStorage: { [branchIds.source]: { 'scene-source': { mode: 'all' } } },
    }));
    const lineageCommitBlocker = blockIDBOperation('put', BRANCH_LINEAGE_STORE_KEY);
    const productionBranch = productionListeners.get('production_chat_changed')[0](productionTargetId);
    let productionFailure = null;
    productionBranch.catch(error => { productionFailure = error; });
    await lineageCommitBlocker.entered;
    assert.deepEqual(productionCleanupCalls, [],
        '分支持久化尚未完成时不得提前清理旧会话或中断宿主任务');
    try {
        assert.equal(productionFailure, null, `真实生产分支提交不得在交错窗口前失败：${productionFailure?.message || ''}`);
        assert.ok(Object.hasOwn(JSON.parse(localValues.get('ST_SMS_POKE_CONFIG') || '{}'), productionTargetId),
            '真实分支提交必须在 lineage 阻塞前写入目标 scope');
        for (const store of ['pokeConfig', 'characterBehavior', 'bidirectional', 'budget']) {
            assert.deepEqual(getActiveDirectoryBranchScopes(store), [productionTargetId],
                `lineage 提交被阻塞时必须登记 ${store} 的 active target scope`);
        }
        window.__pmPokeConfig = { unrelated: { Bob: { interval: 99 } } };
        assert.equal(savePokeConfig(), true, '普通生产保存器仍必须保持同步 boolean 成功契约');
        const pokeDuringProductionBranch = JSON.parse(localValues.get('ST_SMS_POKE_CONFIG'));
        assert.deepEqual(pokeDuringProductionBranch[productionTargetId], { Alice: { interval: 2 } },
            '普通生产保存器的旧快照不得覆盖真实分支事务刚写入的 target scope');
        assert.deepEqual(pokeDuringProductionBranch.unrelated, { Bob: { interval: 99 } },
            '普通生产保存器交错时无关 scope 的更新不得丢失');
        window.__pmCharacterBehavior = { unrelated: { Bob: { messageLength: 'long' } } };
        assert.equal(saveCharacterBehavior(), true, '角色行为保存器仍必须保持同步 boolean 成功契约');
        const behaviorDuringProductionBranch = JSON.parse(localValues.get('ST_SMS_CHARACTER_BEHAVIOR'));
        assert.equal(behaviorDuringProductionBranch[productionTargetId].Alice.messageLength, 'short',
            '角色行为保存器的旧快照不得覆盖 lineage 尚未完成的 target scope；保留值仍须经既有规范化');
        assert.equal(behaviorDuringProductionBranch.unrelated.Bob.messageLength, 'long',
            '角色行为保存器交错时无关 scope 的更新不得丢失；写入值仍须经既有规范化');
        window.__pmBidirectional = { unrelated: ['Bob'] };
        assert.equal(saveBidirectional(), true, '双向注入保存器仍必须保持同步 boolean 成功契约');
        const bidirectionalDuringProductionBranch = JSON.parse(localValues.get('ST_SMS_BIDIRECTIONAL'));
        assert.deepEqual(bidirectionalDuringProductionBranch[productionTargetId], ['Alice'],
            '双向注入保存器的旧快照不得覆盖 lineage 尚未完成的 target scope');
        assert.deepEqual(bidirectionalDuringProductionBranch.unrelated, ['Bob'],
            '双向注入保存器交错时无关 scope 的更新不得丢失');
        window.__pmBudgetConfig = {
            communitySceneIdsByStorage: { unrelated: ['scene-unrelated'] },
            communitySelectionsByStorage: { unrelated: { 'scene-unrelated': { mode: 'all' } } },
        };
        assert.equal(saveBudgetConfig(), true, '预算保存器仍必须保持同步 boolean 成功契约');
        const budgetDuringProductionBranch = JSON.parse(localValues.get('ST_SMS_BUDGET_CONFIG'));
        assert.deepEqual(budgetDuringProductionBranch.communitySceneIdsByStorage[productionTargetId], ['scene-source'],
            '预算保存器的旧快照不得覆盖 lineage 尚未完成的 target scope');
        assert.equal(budgetDuringProductionBranch.communitySelectionsByStorage[productionTargetId]['scene-source'].mode, 'all',
            '预算保存器必须保护 lineage 尚未完成的 target scope；保留值仍须经既有规范化');
        assert.deepEqual(budgetDuringProductionBranch.communitySceneIdsByStorage.unrelated, ['scene-unrelated'],
            '预算保存器交错时无关 scope 的更新不得丢失');
    } finally {
        lineageCommitBlocker.release();
        await productionBranch.catch(() => {});
    }
    assert.equal((await productionBranch).status, 'cloned');
    assert.equal(productionFoundationDeps.runtime.lastBranchInheritance?.status, 'cloned',
        '真实 CHAT_CHANGED 链路必须记录已完成的生产继承结果');
    assert.equal(productionFoundationDeps.runtime.lastBranchInheritance?.targetId, productionTargetId,
        '真实 CHAT_CHANGED 链路必须记录继承目标 scope');
    window.__pmDiagEnabled = true;
    assert.equal(installDiagnosticApi(productionFoundationDeps), true,
        '真实 listener fixture 打开诊断开关后必须安装现场诊断面');
    const listenerDiagnostic = window.__pmDiag.snapshot();
    assert.equal(listenerDiagnostic.lastBranchInheritance?.status, 'cloned',
        '真实 CHAT_CHANGED 完成后诊断面必须可见继承状态');
    assert.equal(listenerDiagnostic.lastBranchInheritance?.sourcePresence?.histories?.present, true,
        '真实 CHAT_CHANGED 完成后诊断面必须可见来源 scope presence');
    assert.equal(Object.hasOwn(listenerDiagnostic, 'chat'), false,
        '真实 listener 诊断快照不得暴露宿主聊天对象');
    for (const store of ['pokeConfig', 'characterBehavior', 'bidirectional', 'budget']) {
        assert.deepEqual(getActiveDirectoryBranchScopes(store), [], `成功提交后必须清除 ${store} 的 active scope`);
    }
    assert.deepEqual(productionCleanupCalls, [
        ['community', 'host-chat-changed'], ['calendar', 'host-chat-changed'], ['end-phone', true],
    ], '分支继承成功后才必须且只能执行一次宿主聊天切换清理');

    productionFoundationState.phoneActive = true;
    const skippedProductionBranch = productionListeners.get('production_chat_changed')[0](productionTargetId);
    assert.equal((await skippedProductionBranch).reason, 'already-cloned',
        '同一分支事件重入必须通过真实继承入口返回已完成标记');
    assert.equal(productionFoundationDeps.runtime.lastBranchInheritance?.status, 'skipped',
        '真实 CHAT_CHANGED 跳过路径必须记录状态');
    assert.equal(productionFoundationDeps.runtime.lastBranchInheritance?.reason, 'already-cloned',
        '真实 CHAT_CHANGED 跳过路径必须记录准确原因');
    assert.deepEqual(productionCleanupCalls.slice(-3), [
        ['community', 'host-chat-changed'], ['calendar', 'host-chat-changed'], ['end-phone', true],
    ], '继承跳过完成后也必须恰好执行一次聊天切换清理');

    const failedProductionTargetId = getStorageIdFor('alice.png', 'production-failed-branch');
    currentProductionEventContext = { ...productionEventContext, chatId: 'production-failed-branch' };
    productionFoundationState.phoneActive = true;
    const failedLineageBlocker = blockIDBOperation('put', BRANCH_LINEAGE_STORE_KEY);
    idbControl.abortOperations.push({ type: 'put', key: BRANCH_LINEAGE_STORE_KEY });
    const failedProductionBranch = productionListeners.get('production_chat_changed')[0](failedProductionTargetId);
    await failedLineageBlocker.entered;
    try {
        for (const store of ['pokeConfig', 'characterBehavior', 'bidirectional', 'budget']) {
            assert.deepEqual(getActiveDirectoryBranchScopes(store), [failedProductionTargetId],
                `lineage 失败前必须继续登记 ${store} 的 active target scope`);
        }
    } finally {
        failedLineageBlocker.release();
        await failedProductionBranch;
    }
    assert.equal(productionFoundationDeps.runtime.lastBranchInheritance?.status, 'failed',
        '真实 CHAT_CHANGED 失败路径必须记录失败状态');
    assert.equal(productionFoundationDeps.runtime.lastBranchInheritance?.sourceId, branchIds.source,
        '失败诊断必须保留已确认的父 scope');
    assert.equal(productionFoundationDeps.runtime.lastBranchInheritance?.targetId, failedProductionTargetId,
        '失败诊断必须保留已确认的目标 scope');
    assert.equal(productionFoundationDeps.runtime.lastBranchInheritanceError?.name, 'Error',
        '失败诊断必须保留错误类型');
    assert.match(productionFoundationDeps.runtime.lastBranchInheritanceError?.message || '', /分支继承记录保存失败/,
        '失败诊断必须保留脱敏后的可区分原因');
    assert.equal(window.__pmDiag.snapshot().lastBranchInheritanceError?.message, '',
        '公开诊断面不得暴露未分类异常正文');
    delete window.__pmDiagEnabled;
    delete window.__pmDiag;
    delete window.__pmRetryBranch;
    for (const store of ['pokeConfig', 'characterBehavior', 'bidirectional', 'budget']) {
        assert.deepEqual(getActiveDirectoryBranchScopes(store), [], `lineage 失败并补偿后必须清除 ${store} 的 active scope`);
    }
    assert.equal(Object.hasOwn(JSON.parse(localValues.get('ST_SMS_POKE_CONFIG')), failedProductionTargetId), false,
        'lineage 失败后必须补偿移除真实生产保存器已写入的 target scope');
    assert.deepEqual(productionCleanupCalls.slice(-3), [
        ['community', 'host-chat-changed'], ['calendar', 'host-chat-changed'], ['end-phone', true],
    ], '继承失败完成后也必须恰好执行一次聊天切换清理');
    window.__pmEnd = previousProductionEnd;
    window.addEventListener = previousProductionWindowAddEventListener;
    window.__pmBeforeUnloadRegistered = previousProductionBeforeUnloadRegistration;
    globalThis.document = previousProductionDocument;
} finally {
    if (previousBranchWindow === undefined) delete globalThis.window;
    else globalThis.window = previousBranchWindow;
}

const quoteTimers = new Map();
let nextQuoteTimerId = 0;
const quoteTargetAClasses = new Set();
const quoteTargetBClasses = new Set();
const createQuoteTarget = (messageId, bubbleId, classes) => ({
    dataset: { messageId, bubbleId },
    classList: {
        add: value => classes.add(value),
        remove: value => classes.delete(value),
        contains: value => classes.has(value),
    },
    scrollIntoView(options) { this.scrollOptions = options; },
});
const quoteTargetA = createQuoteTarget('message-a', 'bubble-a', quoteTargetAClasses);
const quoteTargetB = createQuoteTarget('message-b', 'bubble-b', quoteTargetBClasses);
const quotePreviewSender = { replaceChildren(...children) { this.children = children; } };
const quotePreviewText = { replaceChildren(...children) { this.children = children; } };
const quotePreview = {
    hidden: true,
    querySelector(selector) {
        return selector === '.pm-quote-preview-sender' ? quotePreviewSender : quotePreviewText;
    },
};
const quoteInput = { focus() { this.focused = true; } };
const quoteList = {
    querySelectorAll(selector) {
        if (selector === '[data-bubble-id]') return [quoteTargetA, quoteTargetB];
        if (selector === '.pm-reply-card') return [];
        throw new Error(`unexpected quote selector: ${selector}`);
    },
};
const quoteState = {
    activeQuote: null,
    phoneWindow: {
        querySelector(selector) {
            if (selector === '.pm-quote-preview') return quotePreview;
            if (selector === '.pm-msg-list') return quoteList;
            if (selector === '.pm-input') return quoteInput;
            return null;
        },
    },
};
const originalQuoteSetTimeout = globalThis.setTimeout;
const originalQuoteClearTimeout = globalThis.clearTimeout;
const originalQuoteMatchMedia = globalThis.matchMedia;
const originalQuoteDocument = globalThis.document;
try {
    globalThis.setTimeout = callback => {
        const id = ++nextQuoteTimerId;
        quoteTimers.set(id, callback);
        return id;
    };
    globalThis.clearTimeout = id => quoteTimers.delete(id);
    globalThis.matchMedia = () => ({ matches: false });
    globalThis.document = { createTextNode: value => ({ textContent: value }) };
    const quoteController = createPhoneQuoteController(quoteState);
    assert.equal(quoteController.setActiveQuote(null), false, '空引用不得改变状态');
    assert.equal(quoteController.setActiveQuote({ sender: 'Alice', text: '引用正文' }), true);
    assert.equal(quotePreview.hidden, false, '设置引用必须显示预览');
    assert.equal(quotePreviewSender.children[0].textContent, 'Alice', '预览必须显示引用发送者');
    assert.equal(quotePreviewText.children[0].textContent, '引用正文', '预览必须显示引用正文');
    assert.equal(quoteInput.focused, true, '设置引用必须恢复输入焦点');
    quoteController.clearActiveQuote();
    assert.equal(quoteState.activeQuote, null, '清除引用必须释放当前状态');
    assert.equal(quotePreview.hidden, true, '清除引用必须隐藏预览');
    assert.equal(quotePreviewSender.children.length, 0, '清除引用必须清空发送者预览');
    assert.equal(quotePreviewText.children.length, 0, '清除引用必须清空正文预览');
    assert.equal(quoteController.setActiveQuote({ text: '默认发送者' }), true);
    assert.equal(quotePreviewSender.children[0].textContent, '群聊消息', '缺失发送者必须使用群聊默认文案');
    assert.equal(quoteController.findQuotedBubble({ messageId: 'message-a', bubbleId: 'bubble-b' }), undefined,
        '定位必须同时匹配 messageId 与 bubbleId，不能误命中相同单 ID');
    assert.equal(quoteController.locateQuotedBubble({ messageId: 'message-a', bubbleId: 'bubble-a' }), true);
    assert.equal(quoteTargetAClasses.has('pm-quote-target'), true);
    assert.deepEqual(quoteTargetA.scrollOptions, { behavior: 'smooth', block: 'center' });
    assert.equal(quoteController.locateQuotedBubble({ messageId: 'message-b', bubbleId: 'bubble-b' }), true);
    assert.equal(quoteTargetAClasses.has('pm-quote-target'), false, '重定位必须清除旧目标高亮');
    assert.equal(quoteTargetBClasses.has('pm-quote-target'), true);
    quoteController.clearQuoteHighlight();
    assert.equal(quoteTimers.size, 0, '显式清理必须取消高亮计时器');
    assert.equal(quoteTargetBClasses.has('pm-quote-target'), false, '显式清理必须移除高亮 class');
    assert.equal(quoteController.locateQuotedBubble({ messageId: 'message-a', bubbleId: 'bubble-a' }), true);
    const quoteTimer = [...quoteTimers.values()][0];
    quoteTimer();
    assert.equal(quoteTargetAClasses.has('pm-quote-target'), false, '高亮计时器结束必须移除 class');
} finally {
    globalThis.setTimeout = originalQuoteSetTimeout;
    globalThis.clearTimeout = originalQuoteClearTimeout;
    globalThis.matchMedia = originalQuoteMatchMedia;
    globalThis.document = originalQuoteDocument;
}

console.log('Behavior configuration verified.');
