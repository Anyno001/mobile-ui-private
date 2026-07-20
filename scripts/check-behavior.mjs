import assert from 'node:assert/strict';
import {
    CALENDAR_CYCLE_STORAGE_KEY, CALENDAR_HOLIDAY_STORAGE_KEY, CALENDAR_OCCASION_STORAGE_KEY,
    CALENDAR_STORAGE_KEY, CALENDAR_WEATHER_STORAGE_KEY, EXTENSION_PROMPT_POSITIONS, MAX_INJECTION_DEPTH,
} from '../src/constants.js';
import {
    buildCharacterBehaviorPrompt, buildChatPreferencePrompt,
    DEFAULT_CHARACTER_BEHAVIOR, getCharacterBehavior,
    normalizeCharacterBehavior, normalizeCharacterBehaviorStore,
    normalizeGroupInjection, normalizeGroupMeta, normalizeGroupMetaStore,
} from '../src/behavior-config.js';
import {
    createMessageEntry, createQuoteSnapshot, describeMessageEntry, normalizeMessageHistory,
} from '../src/chat-message-model.js';
import {
    loadBgSettings, saveBgGlobal, saveBgLocal, saveDesktopBg,
} from '../src/storage-background.js';
import {
    addOrUpdateProfile, clearPluginData, loadCharacterBehavior, loadGroupMeta, pmIDBDel, pmIDBGet, pmIDBSet,
    PLUGIN_IDB_DYNAMIC_PREFIXES, PLUGIN_IDB_STATIC_KEYS, PLUGIN_LOCAL_STORAGE_KEYS,
    saveCharacterBehavior, saveGroupMeta, saveHistoriesStrict,
} from '../src/storage.js';
import { installConversation } from '../src/conversation.js';
import { gatherContext, getUserPersona } from '../src/host-context.js';
import { applyConversationInjections } from '../src/phone-injection.js';
import { deriveInteractiveActorId, normalizeInteractiveStore } from '../src/interactive-scene-model.js';
import { renderPhoneDesktop, runDesktopPageTransition } from '../src/interactive-scenes.js';
import { getDanmakuMotion, getDanmakuTone, renderCommunityLauncher, renderCommunityWorkspace } from '../src/interactive-scene-views.js';
import { runControlMenuAction } from '../src/phone-control-center.js';
import {
    clearPhoneQuickReply, ensureInitialPhoneQuickReply, ensureInitialPhoneQuickReplyWithRetry,
    ensurePhoneQuickReply, getConfiguredPhoneQuickReplyLabel, getPhoneQuickReplyStatus,
    normalizePhoneQuickReplyLabel,
    PHONE_QR_AUTOMATION_ID, PHONE_QR_AUTO_INIT_KEY, PHONE_QR_LABEL, PHONE_QR_MESSAGE, PHONE_QR_SET_NAME,
} from '../src/quick-reply.js';
import {
    createBackupStateHandlers, installSettingsUi, parseBackupData, runBackgroundTransaction, runBackupTransaction,
} from '../src/settings-ui.js';
import { renderApiSettings } from '../src/settings-templates.js';
import {
    buildGroupInjectedInstruction, buildGroupSystemPrompt,
    buildIndependentGroupUserPrompt, buildIndependentSingleUserPrompt,
    buildSingleInjectedInstruction, buildSingleSystemPrompt,
} from '../src/chat-prompts.js';
import {
    advanceAutoPokeCounters, commitAutomaticResult,
    createAutomaticTaskController, createRuntimeState, runAutoPokeCounterCycle,
} from '../src/runtime.js';
import {
    createPhonePageController, handleMessageSelectionKey, installPhoneLifecycle,
    resetPhoneScaleForMinimize, toggleMessageSelection,
} from '../src/phone-lifecycle.js';
import { commitEditedGroupUpdate, refreshEditedGroupRuntime } from '../src/phone-directory.js';
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
import { bindPhonePageActions, finalizeDeletedScene, runDeleteSceneAction, toggleScenePostActions, toggleSceneReplyComposer } from '../src/interactive-scene-phone.js';


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
}, 'beforeunload', {
    save: () => suspensionCalls.push(['save', 'beforeunload']),
    disarm: reason => suspensionCalls.push(['disarm', reason]),
});
assert.deepEqual(suspensionCalls, [
    ['save', 'beforeunload'],
    ['community', 'beforeunload'],
    ['calendar', 'beforeunload'],
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
    disarmAutoPoke: reason => hostChangeCalls.push(['disarm', reason]),
    endPhone: force => hostChangeCalls.push(['end', force]),
    invalidateGeneration: () => hostChangeCalls.push(['invalidate']),
}), 'closed');
assert.equal(hostChangeRuntime.lastChatLength, 4);
assert.deepEqual(hostChangeCalls, [
    ['community', 'host-chat-changed'],
    ['calendar', 'host-chat-changed'],
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
    disarmAutoPoke: reason => hostChangeCalls.push(['disarm', reason]),
    endPhone: force => hostChangeCalls.push(['end', force]),
    invalidateGeneration: () => hostChangeCalls.push(['invalidate']),
}), 'invalidated');
assert.equal(hostChangeRuntime.lastChatLength, 0, '非法宿主聊天长度必须归一为 0');
assert.deepEqual(hostChangeCalls, [
    ['community', 'host-chat-changed'], ['calendar', 'host-chat-changed'],
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

assert.deepEqual(normalizeCharacterBehavior(null), DEFAULT_CHARACTER_BEHAVIOR);
assert.deepEqual(normalizeCharacterBehavior({
    privateStylePrompt: '  冷淡一点  ',
    groupStylePrompt: 42,
    messageLength: 'invalid',
    transferFrequency: 'never',
    imageFrequency: 'frequent',
    emojiFrequency: 'rare',
}), {
    privateStylePrompt: '冷淡一点',
    groupStylePrompt: '',
    messageLength: 'persona',
    transferFrequency: 'never',
    imageFrequency: 'frequent',
    emojiFrequency: 'rare',
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

const promptFixture = {
    currentPersona: 'Alice', userName: 'User', userBlock: '用户名字：User',
    contextBlockMain: '【场景参考】\n咖啡店', cardScenario: '咖啡店',
    worldBookText: '世界设定', mainChatText: '角色：主线正文证据',
    smsHistoryText: 'User：短信历史', directorNote: '',
    userMsgClean: '你好', userMsg: '你好',
    groupName: '测试群', memberList: 'Alice、Bob',
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
    Alice: { autoPoke: { enabled: true, interval: 2, counter: 1 } },
    Bob: { autoPoke: { enabled: true, interval: 3, counter: 0 } },
    Carol: { autoPoke: { enabled: false, interval: 1, counter: 0 } },
};
assert.deepEqual(advanceAutoPokeCounters(counterConfigs, () => true), {
    updated: true,
    toPoke: ['Alice'],
});
assert.equal(counterConfigs.Alice.autoPoke.counter, 2);
assert.equal(counterConfigs.Bob.autoPoke.counter, 1);
const failedCounterConfigs = {
    Alice: { autoPoke: { enabled: true, interval: 2, counter: 1 } },
};
assert.deepEqual(advanceAutoPokeCounters(failedCounterConfigs, () => false), {
    updated: false,
    toPoke: [],
});
assert.equal(failedCounterConfigs.Alice.autoPoke.counter, 1);

const failedCycleConfigs = {
    Alice: { autoPoke: { enabled: true, interval: 2, counter: 1 } },
};
const failedCycleRuns = [];
assert.equal(await runAutoPokeCounterCycle({
    configs: failedCycleConfigs,
    persist: () => false,
    isAllowed: () => true,
    run: async contactName => { failedCycleRuns.push(contactName); },
}), false);
assert.deepEqual(failedCycleRuns, []);
assert.equal(failedCycleConfigs.Alice.autoPoke.counter, 1);

const serialCycleRuns = [];
assert.equal(await runAutoPokeCounterCycle({
    configs: {
        Alice: { autoPoke: { enabled: true, interval: 1, counter: 0 } },
        Bob: { autoPoke: { enabled: true, interval: 1, counter: 0 } },
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

const group = normalizeGroupMeta({
    name: ' 同学群 ',
    members: ['小红', '小明', '小红', ''],
    extras: ['路人甲', '小明', '路人甲'],
    memberColors: { 小红: '#AABBCC', 路人甲: '#123456', 陌生人: '#000000', 小明: 'red' },
    injection: { position: 2, depth: 4, historyLimit: 30 },
});
assert.deepEqual(group.members, ['小红', '小明']);
assert.deepEqual(group.extras, ['路人甲']);
assert.deepEqual(group.memberColors, { 小红: '#AABBCC', 路人甲: '#123456' });
assert.deepEqual(group.injection, { position: 2, depth: 4, historyLimit: 30 });

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
const themeChips = ['default', 'pink', 'frost'].map(preset => {
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
        style: { values: new Map(), setProperty(name, value) { this.values.set(name, String(value)); } },
        setAttribute(name, value) {
            if (name === 'data-theme') this.dataset.theme = String(value);
        },
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
    ['pm-border-color', { value: '#abcdef' }],
    ['pm-cfg-url', { value: 'https://new.example' }],
    ['pm-cfg-key', { value: 'new-key' }],
    ['pm-cfg-model', { value: 'model-beta', getBoundingClientRect: () => ({ left: 20, bottom: 80, width: 240 }) }],
    ['pm-api-status', { textContent: '', style: {} }],
    ['pm-mode-main', { classList: makeClassList(['pm-mode-active']) }],
    ['pm-mode-indep', { classList: makeClassList([]) }],
    ['pm-mode-tip', { textContent: '主 API 使用宿主当前选择的预设与接口' }],
    ['pm-indep-profile-fields', { hidden: true }],
    ['pm-indep-config-fields', { hidden: true }],
    ['pm-overlay', {
        removed: false,
        style: { setProperty() {} },
        setAttribute(name, value) { this[name] = String(value); },
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
globalThis.document = {
    getElementById: id => uiElements.get(id) || null,
    querySelector: () => null,
    querySelectorAll: selector => selector === '.pm-theme-chip' ? themeChips : [],
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
let importCloseCalls = 0;
let importInjectionCalls = 0;
let importInjectionImpl = async () => undefined;
let importClearInjectionCalls = 0;
let importCancelCommunityCalls = 0;
const settingsRuntime = { modelList: ['model-alpha', 'model-beta'] };
installSettingsUi({
    makeOverlay: html => { settingsOverlayHtml = html; }, applyTheme: () => appliedThemes.push(structuredClone(window.__pmTheme)), applyBackground: () => {},
    fitNameFont: () => {}, addNote: note => uiNotes.push(note), getCurrentPersona: () => 'default', getStorageId: () => 'story',
    runtime: settingsRuntime,
    closePhone: () => { importCloseCalls += 1; },
    applyBidirectionalInjection: async () => {
        importInjectionCalls += 1;
        return importInjectionImpl();
    },
    clearBidirectionalInjection: () => { importClearInjectionCalls += 1; },
    cancelCommunityGeneration: () => { importCancelCommunityCalls += 1; },
    getInteractiveStore: async () => ({ scopes: {} }),
});
window.__pmTheme = { preset: 'frost', customRight: '', customLeft: '', borderColor: '#1a1a1a', darkMode: 'dark', customTitle: '', qrLabel: '天音' };
await window.__pmShowConfig('look');
assert.match(settingsOverlayHtml, /<button type="button" class="pm-theme-chip pm-theme-active" data-preset="frost"/);
assert.match(settingsOverlayHtml, /aria-label="使用磨砂玻璃气泡主题" aria-pressed="true"/);
assert.match(settingsOverlayHtml, /style="background:rgba\(0,122,255,0\.55\)" aria-hidden="true"/);
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
window.__pmTheme = { ...structuredClone(baseTheme), customRight: '#111111', customLeft: '#222222' };
assert.equal(window.__pmSetPreset('frost'), true);
assert.equal(window.__pmTheme.preset, 'frost');
assert.equal(window.__pmTheme.customRight, '');
assert.equal(window.__pmTheme.customLeft, '');
assert.equal(JSON.parse(localValues.get('ST_SMS_THEME')).preset, 'frost');
assert.equal(themeChips.find(chip => chip.dataset.preset === 'frost').getAttribute('aria-pressed'), 'true');
assert.equal(themeChips.find(chip => chip.dataset.preset === 'default').getAttribute('aria-pressed'), 'false');
uiElements.get('pm-custom-right').value = '#123456';
uiElements.get('pm-custom-left').value = '#654321';
assert.equal(window.__pmSetCustomColor(), true);
assert.equal(window.__pmTheme.preset, 'custom');
assert.equal(window.__pmTheme.customRight, '#123456');
assert.equal(window.__pmTheme.customLeft, '#654321');
assert.ok(themeChips.every(chip => chip.getAttribute('aria-pressed') === 'false'));
assert.equal(window.__pmClearCustomColor(), true);
assert.equal(window.__pmTheme.preset, 'default');
assert.equal(window.__pmTheme.customRight, '');
assert.equal(window.__pmTheme.customLeft, '');
assert.equal(themeChips.find(chip => chip.dataset.preset === 'default').getAttribute('aria-pressed'), 'true');

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

    const worldBookContext = {
        chat: [{ is_user: true, mes: '保密聊天正文' }],
        async getWorldInfoPrompt() { throw new RangeError('sensitive world book payload'); },
    };
    const firstGatheredContext = await gatherContext(() => worldBookContext);
    const secondGatheredContext = await gatherContext(() => worldBookContext);
    assert.equal(firstGatheredContext.worldBookText, '', '世界书读取失败必须回退为空文本');
    assert.equal(secondGatheredContext.worldBookText, '');
    assert.equal(hostBoundaryWarnings.filter(args => String(args[0]).includes('读取世界书上下文失败')).length, 1,
        '同一世界书读取失败必须只告警一次');
    assert.equal(hostBoundaryWarnings.some(args => args.some(value => String(value).includes('sensitive world book payload'))), false,
        '世界书告警不得输出异常正文');

    const eventRegistrationContext = {
        chat: [],
        event_types: {
            GENERATION_STARTED: 'generation_started', CHAT_CHANGED: 'chat_changed',
            MESSAGE_RECEIVED: 'message_received', SETTINGS_UPDATED: 'settings_updated',
        },
        eventSource: { on() { throw new SyntaxError('sensitive host event payload'); } },
    };
    const installFailingFoundation = () => {
        const state = { phoneWindow: null, phoneActive: false, conversationHistory: [] };
        const deps = {
            runtime: createRuntimeState(),
            getCtx: () => eventRegistrationContext,
            getStorageId: () => 'story',
            getUserPersona: () => ({ name: '用户' }),
        };
        installPhoneFoundation(state, deps);
        deps.hookGenerationEvent();
        return deps.runtime;
    };
    const firstFailedRuntime = installFailingFoundation();
    const registrationWarningCount = hostBoundaryWarnings.filter(args => String(args[0]).includes('宿主事件')).length;
    assert.equal(firstFailedRuntime.eventHooked, true, '事件注册异常不得中断 foundation 初始化');
    assert.ok(registrationWarningCount > 0, '事件注册异常必须产生可诊断告警');
    installFailingFoundation();
    assert.equal(hostBoundaryWarnings.filter(args => String(args[0]).includes('宿主事件')).length, registrationWarningCount,
        '同一宿主事件注册失败跨重复安装必须保持去重');
    assert.equal(hostBoundaryWarnings.some(args => args.some(value => String(value).includes('sensitive host event payload'))), false,
        '事件注册告警不得输出异常正文');

    const quietDeps = {
        runtime: createRuntimeState(), getCtx: () => ({}), getStorageId: () => 'story',
        getUserPersona: () => ({ name: '用户' }),
    };
    installPhoneFoundation({ phoneWindow: null, phoneActive: false, conversationHistory: [] }, quietDeps);
    quietDeps.hookGenerationEvent();
    assert.equal(hostBoundaryWarnings.filter(args => String(args[0]).includes('宿主事件')).length, registrationWarningCount,
        '缺少 eventSource/event_types 的未就绪宿主必须安静跳过');
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
try {
    globalThis.setTimeout = () => 0;
    globalThis.setInterval = () => 0;
    installPhoneLifecycle(foundationState, foundationDeps);
} finally {
    globalThis.setTimeout = lifecycleSetTimeout;
    globalThis.setInterval = lifecycleSetInterval;
}
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
const unbindIslandFixture = foundationDeps.bindIsland(foundationPhone, islandHandle);
const makeIslandEvent = (x, y) => ({
    target: { tagName: 'DIV' }, clientX: x, clientY: y, cancelable: true, preventDefault() {},
});

window.__pmTheme = { ...structuredClone(baseTheme), phoneScale: 1.35, ambientStatusEnabled: false };
localValues.set('ST_SMS_THEME', JSON.stringify(window.__pmTheme));
const successfulMinimizeWrites = localStorageControl.setCalls.get('ST_SMS_THEME') || 0;
islandHandleListeners.get('mousedown')(makeIslandEvent(10, 10));
islandWindowListeners.get('mousemove')(makeIslandEvent(14, 14));
islandWindowListeners.get('mouseup')();
assert.equal(foundationState.isMinimized, true, '不足 5px 的移动必须走真实点击收缩生命周期');
assert.equal(foundationPhone.classList.contains('is-min'), true, '点击收缩必须同步 is-min class');
assert.equal(window.__pmTheme.phoneScale, 1, '点击收缩必须通过真实生命周期复位 phoneScale');
assert.equal(JSON.parse(localValues.get('ST_SMS_THEME')).phoneScale, 1, '点击收缩必须持久化默认比例');
assert.equal(localStorageControl.setCalls.get('ST_SMS_THEME'), successfulMinimizeWrites + 1,
    '进入最小化必须且只能保存一次主题');
assert.equal(foundationPhoneStyleValues.get('--pm-phone-width'), '330px');
assert.equal(foundationPhoneStyleValues.get('--pm-phone-height'), '580px');
assert.ok(lifecycleCalls.some(call => call[0] === 'cancel-community' && call[1] === 'phone-minimized'));
assert.ok(lifecycleCalls.some(call => call[0] === 'cancel-calendar' && call[1] === 'phone-minimized'));

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
assert.equal(foundationState.isMinimized, false, '第二次点击必须展开手机');
assert.equal(foundationPhone.classList.contains('is-min'), false, '展开必须移除 is-min class');
assert.equal(localStorageControl.setCalls.get('ST_SMS_THEME'), writesBeforeDrag, '展开不得重复保存或复位比例');

window.__pmTheme.phoneScale = 1.35;
foundationDeps.applyPhoneScale(foundationPhone, 1.35);
localStorageControl.failSet.add('ST_SMS_THEME');
const alertsBeforeFailedMinimize = uiAlerts.length;
islandHandleListeners.get('mousedown')(makeIslandEvent(15, 10));
islandWindowListeners.get('mouseup')();
assert.equal(foundationState.isMinimized, true, '比例保存失败不得破坏最小化生命周期');
assert.equal(foundationPhone.classList.contains('is-min'), true, '保存失败时 state 与 class 必须一致');
assert.equal(window.__pmTheme.phoneScale, 1.35, '真实生命周期保存失败必须恢复原比例');
assert.equal(foundationPhoneStyleValues.get('--pm-phone-width'), '446px', '保存失败必须恢复原视觉宽度');
assert.equal(foundationPhoneStyleValues.get('--pm-phone-height'), '783px', '保存失败必须恢复原视觉高度');
assert.equal(uiAlerts.length, alertsBeforeFailedMinimize + 1);
assert.match(uiAlerts.at(-1), /手机尺寸保存失败/);

unbindIslandFixture();
assert.equal(islandWindowListeners.has('mousemove'), false, '解绑必须移除灵动岛拖拽监听器');

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

window.__pmTheme.darkMode = 'light';
foundationDeps.applyTheme();
assert.equal(synchronizedDropdown.dataset.theme, 'light', '主题切换必须同步已存在的 body 级模型浮层');
assert.equal(foundationPhone['data-theme'], 'light');
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
uiElements.get('pm-api-status').style.color = '';
window.__pmShowModelPicker();
assert.equal(uiElements.has('pm-model-dropdown'), false, '空模型列表不得创建浮层');
assert.equal(uiElements.get('pm-api-status').textContent, '请先拉取模型');
assert.equal(uiElements.get('pm-api-status').style.color, '#ff9500');
assert.equal(documentClickListeners.size, lifecycleDocumentClickBaseline);
settingsRuntime.modelList = ['model-alpha', 'model-beta'];

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

window.__pmConfig = { apiUrl: 'https://old.example', apiKey: 'old-key', model: 'old-model', useIndependent: false };
window.__pmProfiles = [{ apiUrl: 'https://old.example', apiKey: 'old-key', model: 'old-model' }];
localValues.set('ST_SMS_API_PROFILES', JSON.stringify(window.__pmProfiles));
localValues.set('ST_SMS_CONFIG', JSON.stringify(window.__pmConfig));
localStorageControl.failSet.add('ST_SMS_CONFIG');
assert.equal(window.__pmSaveConfig(), false);
assert.equal(window.__pmConfig.apiUrl, 'https://old.example');
assert.equal(uiElements.get('pm-overlay').removed, false);
assert.match(uiAlerts.at(-1), /API 配置保存失败/);

localStorageControl.failSet.add('ST_SMS_API_PROFILES');
assert.equal(window.__pmSaveConfig(), false);
assert.equal(window.__pmConfig.apiUrl, 'https://old.example');
assert.equal(JSON.parse(localValues.get('ST_SMS_CONFIG')).apiUrl, 'https://old.example');
assert.equal(window.__pmProfiles.length, 1);
assert.equal(uiElements.get('pm-overlay').removed, false);
assert.match(uiAlerts.at(-1), /API 档案保存失败，API 配置已恢复/);

const nextConfigWrite = (localStorageControl.setCalls.get('ST_SMS_CONFIG') || 0) + 1;
localStorageControl.failSet.add('ST_SMS_API_PROFILES');
localStorageControl.failSetOnCalls.set('ST_SMS_CONFIG', new Set([nextConfigWrite + 1]));
assert.equal(window.__pmSaveConfig(), false);
assert.equal(window.__pmConfig.apiUrl, 'https://new.example');
assert.equal(JSON.parse(localValues.get('ST_SMS_CONFIG')).apiUrl, 'https://new.example');
assert.equal(window.__pmProfiles[0].apiUrl, 'https://old.example');
assert.equal(uiElements.get('pm-overlay').removed, false);
assert.match(uiAlerts.at(-1), /API 配置回滚也失败/);

uiElements.get('pm-overlay').removed = false;
window.__pmProfiles = [{ apiUrl: 'https://profile.example/v1', apiKey: 'profile-key', model: 'profile-model' }];
window.__pmPickProfile(0);
assert.equal(uiElements.get('pm-indep-profile-fields').hidden, false);
assert.equal(uiElements.get('pm-indep-config-fields').hidden, false);
assert.equal(uiElements.get('pm-cfg-url').value, 'https://profile.example/v1');
assert.equal(uiElements.get('pm-cfg-key').value, 'profile-key');
assert.equal(uiElements.get('pm-cfg-model').value, 'profile-model');
assert.equal(uiElements.get('pm-mode-main').classList.contains('pm-mode-active'), false);
assert.equal(uiElements.get('pm-mode-indep').classList.contains('pm-mode-active'), true);
assert.equal(uiElements.get('pm-mode-tip').textContent, '独立 API 必须填写地址、密钥和模型');
assert.equal(window.__pmSaveConfig(), true);
assert.equal(window.__pmConfig.apiUrl, 'https://profile.example/v1');
assert.equal(window.__pmConfig.useIndependent, true, '选择独立 API 档案后保存必须启用独立路由');
assert.equal(JSON.parse(localValues.get('ST_SMS_CONFIG')).useIndependent, true);
assert.equal(JSON.parse(localValues.get('ST_SMS_API_PROFILES')).some(profile => profile.apiUrl === 'https://profile.example/v1'), true);
assert.equal(uiElements.get('pm-overlay').removed, true);
assert.match(uiNotes.at(-1), /独立API/);

uiElements.get('pm-overlay').removed = false;
window.__pmSetMode(false);
assert.equal(uiElements.get('pm-indep-profile-fields').hidden, true);
assert.equal(uiElements.get('pm-indep-config-fields').hidden, true);
assert.equal(uiElements.get('pm-mode-main').classList.contains('pm-mode-active'), true);
assert.equal(uiElements.get('pm-mode-indep').classList.contains('pm-mode-active'), false);
assert.equal(uiElements.get('pm-mode-tip').textContent, '默认使用酒馆 API 预设');
assert.equal(window.__pmSaveConfig(), true);
assert.equal(window.__pmConfig.useIndependent, false, '用户手动切回主 API 后必须保留明确选择');
assert.equal(JSON.parse(localValues.get('ST_SMS_CONFIG')).useIndependent, false);
assert.match(uiNotes.at(-1), /主API/);
assert.match(renderApiSettings({ cfg: { apiUrl: '', apiKey: '', model: '' }, useIndependent: false, profilesHtml: '' }), /id="pm-indep-config-fields"[^>]* hidden/);
assert.doesNotMatch(renderApiSettings({ cfg: { apiUrl: '', apiKey: '', model: '' }, useIndependent: true, profilesHtml: '' }), /id="pm-indep-config-fields"[^>]* hidden/);
delete globalThis.document;
delete globalThis.alert;

const promptCalls = [];
const injectionRuntime = { trackedExtensionPromptKeys: new Set(['PHONE_SMS_MEMORY:stale']) };
applyConversationInjections({
    context: { setExtensionPrompt: (...args) => promptCalls.push(args) },
    runtime: injectionRuntime,
    checked: ['__group_closed', '__group_open'],
    histories: {
        __group_closed: [{ role: 'assistant', content: '绝密关闭内容' }],
        __group_open: [{ role: 'assistant', content: '允许注入内容' }],
    },
    groups: {
        __group_closed: normalizeGroupMeta({ name: '关闭群', members: ['A', 'B'], injection: { position: -1 } }),
        __group_open: normalizeGroupMeta({ name: '开放群', members: ['C', 'D'], injection: { position: 2, depth: 4, historyLimit: 1 } }),
    },
    userName: '用户', emojis: [],
});
assert.equal(promptCalls.some(call => String(call[1]).includes('绝密关闭内容')), false);
const openCall = promptCalls.find(call => String(call[1]).includes('允许注入内容'));
assert.ok(openCall);
assert.match(String(openCall[1]), /开放群/);
assert.match(String(openCall[1]), /C[、,，\s]+D|成员[^\n]*C[^\n]*D/);
assert.doesNotMatch(String(openCall[1]), /关闭群|绝密关闭内容/);
assert.equal(openCall[2], 2);
assert.equal(openCall[3], 4);
assert.ok(promptCalls.some(call => call[0] === 'PHONE_SMS_MEMORY:stale' && call[1] === ''));

const idbValues = new Map();
const idbOperations = [];
const idbControl = {
    abortAll: true,
    abortOperations: [],
};
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
                            queueMicrotask(() => {
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

const currentBackup = {
    histories: {}, config: {}, theme: { darkMode: 'dark', ambientStatusEnabled: true }, profiles: [], groupMeta: {}, pokeConfig: {},
    bidirectional: {}, emojis: [], characterBehavior: {}, wordyLimit: false,
    desktopBg: 'https://example.test/current-desktop.png', bgGlobal: '', bgLocal: {}, interactiveScenes: { version: 1, scopes: {} },
    calendarStore: { version: 1, scopes: { current: { events: {} } } },
    calendarOccasions: { version: 1, scopes: {} },
    calendarHolidays: { version: 1, selectedCountry: 'JP', years: {} },
    calendarWeather: { version: 1, location: null, lastSuccess: null },
    calendarCycles: { version: 1, scopes: {} },
    phoneUiState: {
        version: 1,
        scopes: { story: { pinnedSceneIds: [], lastPage: 'chat', lastSceneId: null, lastTab: 'feed' } },
    },
    ambientStatus: { enabled: true },
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
assert.throws(() => parseBackupData({ schemaVersion: '3' }, currentBackup), /备份版本无效/);
assert.throws(() => parseBackupData({ schemaVersion: 7 }, currentBackup), /高于当前支持版本 6/);
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
assertInvalidV5CalendarField('calendarCycles', {
    version: 1,
    scopes: { story: { enabled: true, lastPeriodStart: null, cycleLength: 28, periodLength: 5, overrides: {} } },
}, /启用周期提示时必须设置/);

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

const createBackupTransactionFixture = (sceneId, ambientStatusEnabled) => ({
    histories: { story: { Alice: [{ role: 'assistant', content: sceneId }] } },
    config: { model: sceneId },
    theme: { darkMode: ambientStatusEnabled ? 'dark' : 'light', ambientStatusEnabled },
    profiles: [],
    groupMeta: {},
    pokeConfig: {},
    bidirectional: {},
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
});
const originalBackupFixture = createBackupTransactionFixture('scene-old', true);
const importedBackupFixture = createBackupTransactionFixture('scene-new', false);
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

globalThis.document = {
    getElementById: id => uiElements.get(id) || null,
    querySelectorAll: () => [],
};
globalThis.alert = message => uiAlerts.push(String(message));
const runCommittedImportFailureCase = async ({ configModel, injection, expectedDetail }) => {
    uiElements.get('pm-overlay').removed = false;
    const alertsBefore = uiAlerts.length;
    const closeCallsBefore = importCloseCalls;
    const injectionCallsBefore = importInjectionCalls;
    const clearCallsBefore = importClearInjectionCalls;
    const cancelCallsBefore = importCancelCommunityCalls;
    importInjectionImpl = injection;
    const input = {
        files: [{ text: JSON.stringify({
            schemaVersion: 5,
            config: { apiUrl: 'https://imported.example', apiKey: 'imported-key', model: configModel, useIndependent: false },
        }) }],
        value: `${configModel}.json`,
    };

    window.__pmImportData(input);
    await fileReadCompletion;

    assert.equal(input.value, '');
    assert.equal(window.__pmConfig.model, configModel, '后处理注入失败前导入数据必须已经应用到运行时');
    assert.equal(JSON.parse(localValues.get('ST_SMS_CONFIG')).model, configModel, '后处理注入失败前导入数据必须已经持久化');
    assert.equal(importClearInjectionCalls, clearCallsBefore + 1, '成功事务必须在 apply 前清理旧注入');
    assert.equal(importCancelCommunityCalls, cancelCallsBefore + 1, '成功事务必须取消旧社区任务');
    assert.equal(importInjectionCalls, injectionCallsBefore + 1, '事务提交后必须尝试刷新注入');
    assert.equal(importCloseCalls, closeCallsBefore + 1, '数据已提交时即使注入失败也必须关闭旧界面');
    assert.equal(uiElements.get('pm-overlay').removed, true, '数据已提交时即使注入失败也必须移除旧遮罩');
    assert.equal(uiAlerts.length, alertsBefore + 1);
    assert.match(uiAlerts.at(-1), /数据已导入，但注入刷新失败/);
    assert.match(uiAlerts.at(-1), expectedDetail);
    assert.doesNotMatch(uiAlerts.at(-1), /未修改现有数据|原数据已恢复/);
};

await runCommittedImportFailureCase({
    configModel: 'post-import-reject',
    injection: async () => { throw new Error('宿主注入接口拒绝'); },
    expectedDetail: /宿主注入接口拒绝/,
});
await runCommittedImportFailureCase({
    configModel: 'post-import-diagnostic',
    injection: async () => ({ written: 1, failedWrites: 2, cleared: 1, failedKeys: ['PHONE_SMS_MEMORY:stale'] }),
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
for (const key of PLUGIN_IDB_STATIC_KEYS) assert.equal(cleanupIdb.has(key), false);
assert.equal(cleanupIdb.has(`${PLUGIN_IDB_DYNAMIC_PREFIXES[0]}orphan`), false);

const rollbackLocal = new Map([
    [PLUGIN_LOCAL_STORAGE_KEYS[0], 'old-local'],
    ['HOST_EXTENSION_DATA', 'keep-local'],
]);
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

delete globalThis.indexedDB;
delete globalThis.localStorage;
delete globalThis.window;

const pageSections = ['chat', 'desktop', 'community', 'calendar'].map(page => ({ dataset: { phonePage: page }, hidden: false }));
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
    ['chat', true], ['desktop', false], ['community', true], ['calendar', true],
]);
assert.equal(pageController.show('community'), true);
assert.deepEqual(pageSections.map(section => section.hidden), [true, true, false, true]);
assert.equal(pageController.show('calendar'), true);
assert.deepEqual(pageSections.map(section => section.hidden), [true, true, true, false]);
assert.equal(pageController.show('chat'), true);
assert.deepEqual(pageSections.map(section => section.hidden), [false, true, true, true]);
assert.equal(pageSections[0], chatSectionReference, '页面切换不得替换聊天 DOM 节点');
assert.equal(pageController.show('invalid-page'), true);
assert.equal(pageController.current(), 'desktop');
assert.equal(transientCloseCount, 5);
phoneRoot = null;
assert.equal(pageController.show('chat'), false);
assert.equal(pageController.current(), null);

const baseDesktopHtml = renderPhoneDesktop({ scenes: {} }, { pinnedSceneIds: [] });
assert.ok(baseDesktopHtml.length > 0, '无有效会话时基础桌面不得为空');
assert.match(baseDesktopHtml, /<span>天音小笺<\/span>/, '旧主题或无主题时桌面标题必须回退为品牌名');
assert.match(baseDesktopHtml, /class="pm-desktop-community-dock"/);
assert.match(baseDesktopHtml, /data-action="desktop-community" aria-label="发布一条"/);
for (const [app, label] of [['chat', '聊天'], ['directory', '联系人'], ['settings', '设置'], ['calendar', '日历']]) {
    assert.match(baseDesktopHtml, new RegExp(`data-app="${app}"[^>]*data-action="desktop-${app}"`));
    assert.match(baseDesktopHtml, new RegExp(`<span class="pm-desktop-app-label">${label}</span>`));
}
for (const action of ['desktop-chat', 'desktop-directory', 'desktop-settings', 'desktop-calendar', 'desktop-community', 'desktop-exit']) {
    assert.ok(baseDesktopHtml.includes(`data-action="${action}"`), `基础桌面缺少 ${action} 入口`);
}
globalThis.window = { __pmTheme: { customTitle: '雨夜 & 电台' } };
assert.match(renderPhoneDesktop({ scenes: {} }, { pinnedSceneIds: [] }), /<span>雨夜 &amp; 电台<\/span>/, '桌面必须渲染并转义自定义标题');
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
const workspaceScene = normalizeInteractiveStore({
    version: 1,
    scopes: { story: { activeSceneId: 'scene', sceneOrder: ['scene'], scenes: { scene: {
        id: 'scene', title: '主题社区', preset: 'weibo', themeAccent: '#123abc',
        generatedPrompt: '自然交流', posts: [{ id: 'post', author: '访客', content: '测试帖子', comments: [{ id: 'comment', author: '路人', content: '测试评论' }] }],
        live: { title: '正在直播', status: 'idle', danmaku: [{ id: 'danmaku', author: '访客', content: '弹幕' }] },
    } } } },
}).scopes.story.scenes.scene;
const workspaceHtml = renderCommunityWorkspace(workspaceScene, 'feed', { pinnedSceneIds: [] });
assert.match(workspaceHtml, /style="--scene-accent:#123abc"/);
assert.match(workspaceHtml, /placeholder="分享此刻……"/);
assert.match(workspaceHtml, /<span>刚刚<\/span>/);
assert.doesNotMatch(workspaceHtml, /刚刚 · 主题社区/);
assert.match(workspaceHtml, /class="pm-scene-post-author"><b>访客<\/b><span>刚刚<\/span>/);
assert.match(workspaceHtml, /class="pm-scene-nav-actions"[\s\S]*data-action="desktop"/);
assert.doesNotMatch(workspaceHtml, /data-action="back"|pm-scene-back/);
assert.match(workspaceHtml, /class="pm-scene-title">[\s\S]*class="pm-scene-title-poke"[^>]*data-action="poke-scene"[\s\S]*class="pm-scene-view-toggle"[^>]*data-tab="live"[^>]*aria-label="切换到直播"[\s\S]*<\/div><div class="pm-scene-view-actions">/,
    '社区标题、拍一拍和视图切换必须位于同一个视觉居中组');
assert.match(workspaceHtml, /class="pm-scene-view-actions"><button[^>]*class="pm-scene-exit"/,
    '右侧操作区只保留退出按钮');
assert.doesNotMatch(workspaceHtml, /pm-scene-tabs/);
assert.match(workspaceHtml, /data-action="tab" data-tab="prompt">[\s\S]*风格提示词/);
assert.match(workspaceHtml, /data-action="context-inject">[\s\S]*上下文注入/);
assert.match(workspaceHtml, /class="pm-scene-post-more"[^>]*data-action="post-actions"/);
assert.match(workspaceHtml, /data-action="comments"[^>]*aria-label="拍一拍本帖，只生成本帖评论"/);
assert.match(workspaceHtml, /class="pm-scene-like [^"]*"[^>]*data-action="like"/);
assert.match(workspaceHtml, /class="pm-scene-post-metric is-share"/);
assert.match(workspaceHtml, /class="pm-scene-reply-toggle"[^>]*data-action="toggle-reply"[^>]*aria-controls="pm-comment-composer-post"[^>]*aria-expanded="false"/);
assert.match(workspaceHtml, /class="pm-scene-post-metric is-reply"[^>]*aria-label="回复 1"/);
assert.match(workspaceHtml, /class="pm-scene-comment-actions">[\s\S]*data-action="edit-comment"[^>]*aria-label="编辑评论"[^>]*>[\s\S]*?<svg/);
assert.match(workspaceHtml, /data-action="delete-comment"[^>]*aria-label="删除评论"[^>]*>[\s\S]*?<svg/);
assert.match(workspaceHtml, /id="pm-comment-composer-post" class="pm-scene-comment-composer" hidden/);
assert.match(workspaceHtml, /placeholder="输入你的高见吧"/);
assert.match(workspaceHtml, /data-action="post-comment"[^>]*aria-label="发送回复"[^>]*>[\s\S]*?<svg/);
assert.doesNotMatch(workspaceHtml, /生成更多评论|>喜欢<|>已喜欢</);
assert.match(workspaceHtml, /class="pm-scene-bottom-bar"/);
assert.match(workspaceHtml, /class="pm-control-menu pm-scene-menu" role="menu" aria-label="社区工具" hidden/);
assert.match(workspaceHtml, /class="pm-scene-exit"[^>]*data-action="exit"/);
assert.doesNotMatch(workspaceHtml, /生成热场内容|编辑社区风格/);
const liveWorkspaceHtml = renderCommunityWorkspace(workspaceScene, 'live', { pinnedSceneIds: [] });
assert.match(liveWorkspaceHtml, /class="pm-scene-view-toggle"[^>]*data-tab="feed"[^>]*aria-label="返回社区"/);
assert.match(liveWorkspaceHtml, /pm-live-stage has-danmaku/);
assert.match(liveWorkspaceHtml, /--duration:[\d.]+s;--offset:-?\d+px/);
const promptWorkspaceHtml = renderCommunityWorkspace(workspaceScene, 'prompt', { pinnedSceneIds: [], lastTab: 'live' });
assert.match(promptWorkspaceHtml, /class="pm-scene-accent-options"/);
assert.match(promptWorkspaceHtml, /data-action="scene-accent" data-accent="#ff8200"/);
assert.match(promptWorkspaceHtml, /aria-label="使用微博热场主题色" aria-pressed="false"/);
assert.match(promptWorkspaceHtml, /id="pm-scene-accent" type="color" data-action="scene-accent-custom" value="#123abc"/);
assert.match(promptWorkspaceHtml, /class="pm-scene-secondary" data-action="regenerate-prompt"/);
assert.match(promptWorkspaceHtml, /class="pm-scene-home" data-action="tab" data-tab="live" aria-label="返回子社区"/);
assert.doesNotMatch(promptWorkspaceHtml, /class="pm-scene-bottom-bar"|class="pm-control-menu pm-scene-menu"|placeholder="分享此刻……"/,
    '提示词页不得保留社区二级菜单或发帖输入区');
assert.doesNotMatch(promptWorkspaceHtml, /class="pm-scene-home" data-action="desktop"/,
    '提示词页左侧按钮必须返回子社区而不是桌面');
const presetAccentScene = { ...workspaceScene, themeAccent: '#ff8200' };
const presetAccentHtml = renderCommunityWorkspace(presetAccentScene, 'prompt', { pinnedSceneIds: [] });
assert.match(presetAccentHtml, /data-accent="#ff8200"[^>]*aria-pressed="true"/);
const emptyWorkspaceHtml = renderCommunityWorkspace({ ...workspaceScene, posts: [] }, 'feed', { pinnedSceneIds: [] });
assert.match(emptyWorkspaceHtml, /class="pm-scene-empty"[\s\S]*这里还很安静[\s\S]*发第一篇帖子/);
assert.doesNotMatch(emptyWorkspaceHtml, /class="pm-scene-post"/);
const injectionWorkspaceHtml = renderCommunityWorkspace(workspaceScene, 'context-inject', { pinnedSceneIds: [] }, {
    communitySceneAllowed: true,
    communitySelection: { mode: 'selected', postIds: ['post'] },
});
assert.match(injectionWorkspaceHtml, /id="pm-scene-injection-enabled"[^>]*checked/);
assert.match(injectionWorkspaceHtml, /id="pm-scene-injection-mode"[\s\S]*value="selected" selected/);
assert.match(injectionWorkspaceHtml, /class="pm-scene-injection-post-input" value="post" checked/);
assert.match(injectionWorkspaceHtml, /data-action="context-select-all"[\s\S]*data-action="context-clear"/);
assert.match(injectionWorkspaceHtml, /data-action="context-save"/);

const launcherScope = {
    sceneOrder: ['scene-card'],
    scenes: {
        'scene-card': { id: 'scene-card', title: '雨夜社区', preset: 'weibo', posts: [] },
    },
};
const unpinnedLauncherHtml = renderCommunityLauncher(launcherScope, { pinnedSceneIds: [] });
assert.match(unpinnedLauncherHtml, /class="pm-scene-card-actions"/);
assert.match(unpinnedLauncherHtml, /data-action="toggle-scene-pin"[^>]*aria-pressed="false"[^>]*>固定<\/button>/);
assert.match(unpinnedLauncherHtml, /data-action="delete-scene"[^>]*>删除<\/button>/);
assert.match(unpinnedLauncherHtml, /class="pm-scene-card-open"[^>]*>[\s\S]*?<\/button><div class="pm-scene-card-actions">/, '场景卡片操作必须位于打开场景按钮之外');
const pinnedLauncherHtml = renderCommunityLauncher(launcherScope, { pinnedSceneIds: ['scene-card'] });
assert.match(pinnedLauncherHtml, /data-action="toggle-scene-pin"[^>]*aria-pressed="true"[^>]*>取消固定<\/button>/);

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
    contains(node) { return node === actionButton || node === calendarActionButton || node === calendarCountryControl || delegatedExtraNodes.has(node); },
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
assert.deepEqual([...delegatedListeners.keys()], ['click', 'change', 'keydown']);
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
const postActionsWrap = {
    querySelector(selector) { assert.equal(selector, '[data-action="post-actions"]'); return postActionsTrigger; },
};
const postActions = {
    hidden: false,
    closest(selector) { assert.equal(selector, '.pm-scene-post-actions-wrap'); return postActionsWrap; },
};
openPostActions = [postActions];
delegatedListeners.get('click')({ target: { closest: () => null } });
assert.equal(postActions.hidden, true, '点击帖子操作外部必须收起横向操作');
assert.equal(postActionsExpanded, 'false');

let firstPostExpanded = 'true';
const firstPostTrigger = {
    setAttribute(name, value) { assert.equal(name, 'aria-expanded'); firstPostExpanded = value; },
};
const firstPostWrap = {
    querySelector(selector) { assert.equal(selector, '[data-action="post-actions"]'); return firstPostTrigger; },
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
assert.equal(firstPostExpanded, 'false', '关闭前一个帖子操作时必须同步 aria-expanded');
assert.equal(secondPostActions.hidden, false, '点击第二个帖子省略号必须展开其横向操作');
assert.equal(secondPostExpanded, 'true', '展开第二个帖子操作时必须同步 aria-expanded');
assert.equal(secondPostActionFocused, true, '展开第二个帖子操作后必须聚焦第一个操作按钮');
assert.equal(delegatedActions.length, delegatedActionCountBeforePostSwitch + 1, '帖子切换只能分发一次生产动作');

openPostActions = [postActions];
sceneMenu.hidden = false;
menuExpanded = 'true';
postActions.hidden = false;
postActionsExpanded = 'true';
escapePrevented = false;
delegatedListeners.get('keydown')({ key: 'Escape', preventDefault() { escapePrevented = true; } });
assert.equal(postActions.hidden, true, 'Escape 必须关闭帖子横向操作');
assert.equal(sceneMenu.hidden, true, 'Escape 必须同时关闭社区工具菜单');
assert.equal(postActionsExpanded, 'false');
assert.equal(menuExpanded, 'false');
assert.equal(escapePrevented, true);
assert.equal(postActionsFocused, true, 'Escape 关闭帖子操作后必须把焦点还给省略号按钮');

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
    groupColorMap: { ...state.groupColorMap },
});
const editedGroupMeta = normalizeGroupMeta({
    name: '新群名',
    members: ['Alice', 'Carol'],
    extras: ['记录员'],
    memberColors: { Alice: '#abcdef' },
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

console.log('Behavior configuration verified.');
